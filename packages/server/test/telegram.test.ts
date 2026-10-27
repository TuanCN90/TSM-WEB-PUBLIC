import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramService } from "../src/services/telegram";
import type { SettingsStore } from "../src/services/store";

describe("TelegramService - Giám sát Online qua Telegram", () => {
  let mockSettings: {
    telegram?: {
      enabled: boolean;
      botToken: string;
      chatId: string;
      notifyOnDisconnect: boolean;
      notifyOnReconnect?: boolean;
    };
  };
  let store: SettingsStore;
  let service: TelegramService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSettings = {
      telegram: {
        enabled: true,
        botToken: "123456:ABC-DEF",
        chatId: "-100987654321",
        notifyOnDisconnect: true,
        notifyOnReconnect: true,
      },
    };
    store = {
      get: () => mockSettings as any,
    } as unknown as SettingsStore;
    service = new TelegramService(store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("trả về lỗi nếu thiếu botToken hoặc chatId", async () => {
    mockSettings.telegram!.botToken = "";
    const res1 = await service.send("hello");
    expect(res1.ok).toBe(false);
    expect(res1.message).toContain("Bot Token");

    mockSettings.telegram!.botToken = "abc";
    mockSettings.telegram!.chatId = "";
    const res2 = await service.send("hello");
    expect(res2.ok).toBe(false);
    expect(res2.message).toContain("Chat ID");
  });

  it("gửi tin nhắn thành công qua Telegram Bot API", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 123 } }),
    } as Response);

    const res = await service.send("<b>Xin chào</b>");
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123456:ABC-DEF/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100987654321");
    expect(body.text).toBe("<b>Xin chào</b>");
    expect(body.parse_mode).toBe("HTML");
  });

  it("xử lý phản hồi lỗi từ Telegram API (sai token/chat id)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ ok: false, description: "chat not found" }),
    } as Response);

    const res = await service.test();
    expect(res.ok).toBe(false);
    expect(res.message).toContain("chat not found");
  });

  it("notifyDisconnect: không gửi tin khi telegram bị tắt hoặc notifyOnDisconnect bị tắt", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch");

    // Case 1: enabled = false
    mockSettings.telegram!.enabled = false;
    await service.notifyDisconnect({
      accountId: "acc1",
      reason: "server đóng kết nối",
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Case 2: notifyOnDisconnect = false
    mockSettings.telegram!.enabled = true;
    mockSettings.telegram!.notifyOnDisconnect = false;
    await service.notifyDisconnect({
      accountId: "acc1",
      reason: "server đóng kết nối",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("notifyDisconnect: gửi cảnh báo kèm chi tiết tài khoản, nhân vật, mã lỗi", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await service.notifyDisconnect({
      accountId: "acc01@ts",
      username: "acc01",
      server: "(3) Jiangling",
      characterName: "Triệu Vân",
      mapId: 12001,
      reason: "Lệnh thao tác không hợp lệ / sai lượt (mã 42)",
      willReconnect: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.text).toContain("CẢNH BÁO MẤT KẾT NỐI");
    expect(body.text).toContain("acc01");
    expect(body.text).toContain("Triệu Vân");
    expect(body.text).toContain("Map: 12001");
    expect(body.text).toContain("mã 42");
    expect(body.text).toContain("Đang tự động kết nối lại...");
  });

  it("chống spam (throttling): không gửi notify liên tục cho cùng 1 tài khoản trong 10 giây", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await service.notifyDisconnect({
      accountId: "acc_spam",
      reason: "mất mạng",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Gọi lần 2 ngay lập tức
    await service.notifyDisconnect({
      accountId: "acc_spam",
      reason: "mất mạng",
    });
    // Vẫn chỉ gọi 1 lần
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Tài khoản khác thì vẫn được gửi
    await service.notifyDisconnect({
      accountId: "acc_other",
      reason: "mất mạng",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("notifyReconnect: gửi thông báo khi tài khoản kết nối lại thành công", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await service.notifyReconnect({
      accountId: "acc01@ts",
      username: "acc01",
      characterName: "Triệu Vân",
      mapId: 12001,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.text).toContain("KẾT NỐI LẠI THÀNH CÔNG");
    expect(body.text).toContain("Triệu Vân");
  });
});
