import bagRefresh from "./fixtures/bag-refresh-type1.json";
import { describe, expect, it } from "vitest";
import { getTaiwanDateKey } from "@tsbot/protocol";
import fx from "./fixtures/general-cap.json";
import itemNames from "../src/data/itemNames.json";
import { encodeFrame, tsOnlineCodec } from "../src/transport/socket/codecs/tsOnline";
import { buildSteps } from "../src/runtime/liveActions";

const frame = (cmd: number, sub: number, hex: string) => encodeFrame(Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(hex, "hex")]));

/** Túi đồ thật của một tài khoản test: (ô, itemId, số lượng, tên hiển thị trên tool gốc). Đã đối chiếu từng dòng với ảnh Thùng đồ của tool. */
const BAG: [number, number, number, string][] = [
  [1, 46285, 7, "Túi Dũng Thông Dụng"], [2, 20001, 1, "Thiết Đầu Khôi"], [3, 46512, 1, "Túi Bạn Hữu"], [4, 32453, 1, "Phiếu Ba Đậu Yêu"],
  [5, 46029, 3, "Hạo Giác"], [6, 46575, 1, "Ba Đậu 7 Ngày"], [7, 51789, 1, "Bí Cấp Trương Nhiệm"], [8, 49509, 10, "Võ Tướng Tử Đơn"],
  [11, 45509, 5, "Quyển Chọn Thiên Sứ"], [12, 44308, 1, "魔關羽選擇卷"], [13, 46038, 40, "Đại Phúc Thần"], [14, 45608, 1, "Túi Lông Cấp 2"],
  [15, 47041, 1, "K.Tỏa Thái Văn Cơ"], [16, 65414, 5, "Làm Mới Trang Bị"], [18, 32101, 10, "Tăng Cấp Kỵ Đơn"], [19, 45612, 20, "Túi Tọa Kỵ Đan"],
  [20, 43836, 5, "關羽唐豆人造型選擇卷"], [22, 65419, 5, "Làm Mới Hoàng Kim"], [24, 65415, 10, "Phiếu Rút Võ Tướng"], [25, 46241, 3, "Tiên Đơn Kiện Thể"],
  [26, 46239, 3, "Tiên Đơn Năng Lượng"], [28, 65401, 1, "Tăng Ô Túi"], [31, 19737, 1, "Áo Hiện Đại"],
];

describe("Túi đồ (17/05, 17/08)", () => {
  it("tên vật phẩm khớp tool gốc (VN + dự phòng tiếng Trung)", () => {
    for (const [, id, , name] of BAG) expect((itemNames as Record<string, string>)[id]).toBe(name);
  });

  it("17/05 → CharacterState.bag; 17/08 cập nhật/xoá ô", () => {
    let bag: { slot: number; id: number; qty: number }[] = [];
    const logs: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => logs.push(m), send() {}, patchState: (p: { bag?: typeof bag }) => { if (p.bag) bag = p.bag; } } as never);
    const payload = Buffer.alloc(4 + BAG.length * 36); // 00 | 00 (loại túi) | count u16 | mục 36 byte
    payload.writeUInt16LE(BAG.length, 2);
    BAG.forEach(([slot, id, qty], i) => { const o = 4 + i * 36; payload[o] = slot; payload.writeUInt16LE(id, o + 1); payload.writeUInt32LE(qty, o + 3); });
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));
    expect(bag.map((b) => [b.slot, b.id, b.qty])).toEqual(BAG.map(([slot, id, qty]) => [slot, id, qty]));

    // nhận thêm vào ô mới (như thưởng điểm danh): ô 10 ← Hạo Giác ×3
    s.onData(encodeFrame(Buffer.from("00001708000acdb303000000".replace(/ /g, ""), "hex").subarray(0, 12)));
    expect(bag).toHaveLength(BAG.length + 1);
    expect(logs.at(-1)).toContain("Ní nhận được 3 cái Hạo Giác");
    // dùng hết ô 10
    s.onData(encodeFrame(Buffer.from("00001708000acdb300000000", "hex")));
    expect(bag).toHaveLength(BAG.length);
  });
});

describe("Dị giới: phản hồi 61/01", () => {
  const mk = () => {
    const logs: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => logs.push(m), send() {}, patchState() {} } as never);
    return { s, logs };
  };
  it("mã 2 = server từ chối → báo ra tab Sự kiện và không gửi 61/02", () => {
    const { s, logs } = mk();
    s.encodeAction("dijie_open", []);
    s.onData(encodeFrame(Buffer.from("00006101" + "0002", "hex")));
    expect(logs.at(-1)).toBe("Ní bị Dị giới đuổi cổ rồi, mua thêm Dị giới phù để tiếp tục hoặc chờ ngày mai nha ní !!");
    expect(() => s.encodeAction("dijie_pick", ["2"])).toThrow(/mã 2/);
    expect(logs.some((m) => m.startsWith("Ní đang xin vào"))).toBe(false);
  });
  it("mã 0 hoặc 6 → vẫn gửi 61/02 chọn mốc", () => {
    for (const code of ["00", "06"]) {
      const { s } = mk();
      s.encodeAction("dijie_open", []);
      s.onData(encodeFrame(Buffer.from("00006101" + "00" + code, "hex")));
      expect(s.encodeAction("dijie_pick", ["2"])).toBeTruthy();
    }
  });
});

describe("Tiền Trang & Thao tác Thùng Đồ (1e/02, 1e/01, 1e/04, 1e/05, 17/66, 17/03, 17/0f)", () => {
  it("gửi đồ vào kho (1e/02) và rút đồ từ kho (1e/01) chuẩn theo PCAP TSM", () => {
    const s = tsOnlineCodec.create({ log() {}, game() {}, send() {}, patchState() {} } as never);
    // Kho chưa mở ⇒ bot chặn, không gửi gói (tránh server kick mã 37)
    expect(s.encodeAction("deposit_bank", ["3"])!.length).toBe(0);
    s.onData(encodeFrame(Buffer.from("00001d090000", "hex"))); // 1d/09: server mở kho
    // Gửi ô số 3 (SL=1) vào Tiền Trang -> 1e/02 00 03 01 00 00 00
    const depositBuf = s.encodeAction("deposit_bank", ["3"]);
    expect(depositBuf).toBeTruthy();
    expect(depositBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("00001e02000301000000", "hex")).toString("hex"));

    // Rút ô số 5 (SL=1) từ Tiền Trang về túi -> 1e/01 00 05 01 00 00 00
    const withdrawBuf = s.encodeAction("withdraw_bank", ["5"]);
    expect(withdrawBuf).toBeTruthy();
    expect(withdrawBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("00001e01000501000000", "hex")).toString("hex"));

    // Move toạ độ (06/01) và interact_prep (20/02)
    const moveBuf = s.encodeAction("move", ["450", "310"]);
    expect(moveBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("000006010000c2013601", "hex")).toString("hex"));

    const prepBuf = s.encodeAction("interact_prep", ["8"]);
    expect(prepBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("000020020008", "hex")).toString("hex"));

    // Đóng Tiền Trang (1e/08)
    const closeBuf = s.encodeAction("close_bank", []);
    expect(closeBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("00001e0800", "hex")).toString("hex"));
  });

  it("nhận gói 14/08 (0x2a) cam kết lưu dữ liệu kho Tiền Trang vào Database", () => {
    const logs: string[] = [];
    const s = tsOnlineCodec.create({ log(_lvl: string, m: string) { logs.push(m); }, game() {}, send() {}, patchState() {} } as never);
    s.onData(encodeFrame(Buffer.from("00001408002a", "hex")));
    expect(logs.some((m) => m.includes("Máy chủ đã cam kết lưu dữ liệu kho thành công"))).toBe(true);
  });

  it("chuỗi bước close_bank bao gồm cả 1e/08 và ready_1406 (14/06)", () => {
    const steps = buildSteps("close_bank");
    expect(steps.map((s) => ("cmd" in s ? s.cmd.name : ""))).toEqual(["close_bank", "ready_1406"]);
  });

  it("nhận gói 1e/04 (thêm vào kho) và 1e/05 (xoá khỏi kho) chuẩn theo PCAP", () => {
    let bank: { slot: number; id: number; qty: number }[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game() {},
      send() {},
      patchState: (p: { bank?: typeof bank }) => {
        if (p.bank) bank = p.bank;
      },
    } as never);

    // 1e/04: Slot 1: ID 46241 (Tiên Đơn Kiện Thể), Qty: 3
    s.onData(encodeFrame(Buffer.from("00001e040001a1b4030000000000000000000000000000000000000000000000000000000000000000", "hex")));
    expect(bank).toHaveLength(1);
    expect(bank[0]).toEqual({ slot: 1, id: 46241, qty: 3 });

    // 1e/04: Slot 2: ID 46575 (Ba Đậu 7 Ngày), Qty: 1
    s.onData(encodeFrame(Buffer.from("00001e040002efb5010000000000000000000000000000000000000000000000000000000000000000", "hex")));
    expect(bank).toHaveLength(2);
    expect(bank[1]).toEqual({ slot: 2, id: 46575, qty: 1 });

    // 1e/05: Slot 1: Rút Qty 1 -> còn lại Qty 2 (không bị xoá nhầm cả ô)
    s.onData(encodeFrame(Buffer.from("00001e05000101000000", "hex")));
    expect(bank).toHaveLength(2);
    expect(bank[0]).toEqual({ slot: 1, id: 46241, qty: 2 });

    // 1e/05: Slot 2: Rút Qty 1 -> xoá slot 2
    s.onData(encodeFrame(Buffer.from("00001e05000201000000", "hex")));
    expect(bank).toHaveLength(1);
    expect(bank[0]).toEqual({ slot: 1, id: 46241, qty: 2 });
  });

  it("gửi đồ vào kho mặc định gửi hết số lượng của ô nếu không chỉ định qty", () => {
    let bag: { slot: number; id: number; qty: number }[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game() {},
      send() {},
      patchState: (p: { bag?: typeof bag }) => {
        if (p.bag) bag = p.bag;
      },
    } as never);

    // Ô 5 có Xu Lạp Bá x2 (id 46239)
    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 5;
    payload.writeUInt16LE(46239, 5);
    payload.writeUInt32LE(2, 7);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    s.onData(encodeFrame(Buffer.from("00001d090000", "hex"))); // kho đã mở
    // Khi không truyền qty -> tự động lấy toàn bộ số lượng trong ô (x2)
    const depositFull = s.encodeAction("deposit_bank", ["5"]);
    expect(depositFull).toBeTruthy();
    // 1e/02 00 [slot=5] [qty=2 u32LE]
    expect(depositFull!.toString("hex")).toBe(encodeFrame(Buffer.from("00001e02000502000000", "hex")).toString("hex"));

    // Server trừ 1 cái (17/09 slot=5, qty=1) -> trong túi phải còn lại 1 cái (chứ KHÔNG bị xoá mất slot)
    s.onData(encodeFrame(Buffer.from("00001709000501000000", "hex")));
    expect(bag).toHaveLength(1);
    expect(bag[0]).toEqual({ slot: 5, id: 46239, qty: 1 });

    // Server trừ tiếp 1 cái nữa -> slot về 0 và biến mất khỏi túi
    s.onData(encodeFrame(Buffer.from("00001709000501000000", "hex")));
    expect(bag).toHaveLength(0);
  });

  it("nhận gói 1e/01 danh sách đầy đủ 4 slot kho Tiền Trang từ máy chủ TSM thật", () => {
    let bank: { slot: number; id: number; qty: number }[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game: (m: string) => games.push(m),
      send() {},
      patchState: (p: { bank?: typeof bank }) => {
        if (p.bank) bank = p.bank;
      },
    } as never);

    // Gói 1e/01 thực tế dài 153 byte từ log client thật
    const hex = "00001e010001a1b403000000000000000000000000000000000000000000000000000000000000000002efb5010000000000000000000000000000000000000000000000000000000000000000039fb40300000000000000000000000000000000000000000000000000000000000000000479ff010000000000000000000000000000000000000000000000000000000000000000";
    s.onData(encodeFrame(Buffer.from(hex, "hex")));

    expect(bank).toHaveLength(4);
    expect(bank[0]).toEqual({ slot: 1, id: 46241, qty: 3 });
    expect(bank[1]).toEqual({ slot: 2, id: 46575, qty: 1 });
    expect(bank[2]).toEqual({ slot: 3, id: 46239, qty: 3 });
    expect(bank[3]).toEqual({ slot: 4, id: 65401, qty: 1 });
    expect(games.some((g) => g.includes("Đã nạp danh sách kho Tiền Trang: 4 ô vật phẩm"))).toBe(true);
  });

  it("nhận gói danh sách kho Tiền Trang (17/66) -> cập nhật CharacterState.bank", () => {
    let bank: { slot: number; id: number; qty: number }[] = [];
    const logs: string[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game: (m: string) => logs.push(m),
      send() {},
      patchState: (p: { bank?: typeof bank }) => {
        if (p.bank) bank = p.bank;
      },
    } as never);

    // Gói 17/66 với 2 item trong kho: Ô 1 có item 46285 (x5), Ô 2 có item 20001 (x1)
    const payload = Buffer.alloc(4 + 2 * 36);
    payload.writeUInt16LE(2, 2); // 2 items
    // Item 1: slot 1, id 46285 (0xb4cd -> cdb4), qty 5
    payload[4] = 1;
    payload.writeUInt16LE(46285, 5);
    payload.writeUInt32LE(5, 7);
    // Item 2: slot 2, id 20001 (0x4e21 -> 214e), qty 1
    payload[40] = 2;
    payload.writeUInt16LE(20001, 41);
    payload.writeUInt32LE(1, 43);

    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x66]), payload])));
    expect(bank).toHaveLength(2);
    expect(bank[0]).toEqual({ slot: 1, id: 46285, qty: 5 });
    expect(bank[1]).toEqual({ slot: 2, id: 20001, qty: 1 });
    expect(logs.some((l) => l.includes("Đã mở kho Tiền Trang: 2 ô vật phẩm"))).toBe(true);
  });

  it("nhận gói danh sách kho Tiền Trang chuẩn TS Mobile (1d/09) -> cập nhật CharacterState.bank", () => {
    let bank: { slot: number; id: number; qty: number }[] = [];
    const logs: string[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game: (m: string) => logs.push(m),
      send() {},
      patchState: (p: { bank?: typeof bank }) => {
        if (p.bank) bank = p.bank;
      },
    } as never);

    // Case 1: Kho trống (1d/09 len=10)
    s.onData(encodeFrame(Buffer.from("00001d090000", "hex")));
    expect(bank).toHaveLength(0);
    expect(logs.at(-1)).toContain("0 ô vật phẩm");

    // Case 2: Kho có 2 vật phẩm (khớp layout TS Mobile 36B/slot)
    // Slot 1: id 46241 (Tiên Đơn Kiện Thể, 0xb4a1 -> a1b4), qty 3
    // Slot 2: id 46575 (Ba Đậu 7 Ngày, 0xb5ef -> efb5), qty 1
    const item1 = Buffer.alloc(36);
    item1[0] = 1; item1.writeUInt16LE(46241, 1); item1.writeUInt32LE(3, 3);
    const item2 = Buffer.alloc(36);
    item2[0] = 2; item2.writeUInt16LE(46575, 1); item2.writeUInt32LE(1, 3);

    const payload = Buffer.concat([
      Buffer.from([0x02, 0x00]), // count = 2
      item1,
      item2,
    ]);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x1d, 0x09]), payload])));
    expect(bank).toHaveLength(2);
    expect(bank[0]).toEqual({ slot: 1, id: 46241, qty: 3 });
    expect(bank[1]).toEqual({ slot: 2, id: 46575, qty: 1 });
    expect(logs.at(-1)).toContain("2 ô vật phẩm");

    // Case 3: Nhận gói 1d/06 thông tin tiền gửi
    const goldBuf = Buffer.alloc(5);
    goldBuf.writeUInt32LE(150000, 1);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x1d, 0x06]), goldBuf])));
    expect(logs.at(-1)).toContain("150.000 lượng");
  });

  it("gói 1a/01 và 1a/02 cập nhật chính xác tài chính khi bán và mua vật phẩm", () => {
    let economy: { gold?: number; xu?: number } = {};
    const logs: string[] = [];
    const s = tsOnlineCodec.create({
      log(_lvl: string, m: string) { logs.push(m); },
      game() {},
      send() {},
      patchState(p: { economy?: typeof economy }) {
        if (p.economy) economy = p.economy;
      },
    } as never);

    // Ban đầu nạp 300 vàng qua 23/05
    const initGold = Buffer.alloc(13);
    initGold.writeUInt32LE(300, 1);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x23, 0x05]), initGold])));
    expect(economy.gold).toBe(300);

    // Gói 1a/01 cộng 1000 vàng từ bán đồ
    const sellBuf = Buffer.alloc(5);
    sellBuf.writeUInt32LE(1000, 1);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x1a, 0x01]), sellBuf])));
    expect(economy.gold).toBe(1300);
    expect(logs.at(-1)).toContain("+1.000 Vàng từ bán vật phẩm (Tổng: 1.300)");

    // Gói 1a/02 trừ 200 vàng khi mua đồ
    const buyBuf = Buffer.alloc(5);
    buyBuf.writeUInt32LE(200, 1);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x1a, 0x02]), buyBuf])));
    expect(economy.gold).toBe(1100);
    expect(logs.at(-1)).toContain("-200 Vàng để mua vật phẩm (Tổng: 1.100)");
  });

  it("vứt bỏ vật phẩm (17/03) và sử dụng vật phẩm (17/0f) cho Char hoặc Pet", () => {
    const s = tsOnlineCodec.create({ log() {}, game() {}, send() {}, patchState() {} } as never);

    // Vứt vật phẩm ô 2, số lượng 3 -> 17/03 00 02 03 00 00 00
    const dropBuf = s.encodeAction("drop_item", ["2", "3"]);
    expect(dropBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("00001703000203000000", "hex")).toString("hex"));

    // Char dùng vật phẩm ô 1, số lượng 1 -> 17/0f 00 01 01 00 00 00 00 00 (khớp PCAP use_hpsp_char_pet.pcap)
    const useCharBuf = s.encodeAction("use_item", ["1", "1", "0"]);
    expect(useCharBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170f0001010000000000", "hex")).toString("hex"));

    // Pet dùng vật phẩm ô 1, số lượng 1 -> 17/0f 00 01 01 00 00 00 01 00 (khớp PCAP use_hpsp_char_pet.pcap)
    const usePetBuf = s.encodeAction("use_item", ["1", "1", "1"]);
    expect(usePetBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170f0001010000000100", "hex")).toString("hex"));
  });

  it("tự động quét và xử lý (auto-sweep) vứt bỏ và mở vật phẩm theo cấu hình", async () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game: (m: string) => games.push(m),
      send: (b: Buffer) => sent.push(b),
      patchState() {},
    } as never);

    // Nạp túi đồ có ô 1: 46285 (Túi Dũng), ô 2: 29466 (Vớ Trắng Đỏ Noel - rác/quest)
    const payload = Buffer.alloc(4 + 2 * 36);
    payload.writeUInt16LE(2, 2);
    payload[4] = 1;
    payload.writeUInt16LE(46285, 5);
    payload.writeUInt32LE(2, 7);

    payload[40] = 2;
    payload.writeUInt16LE(29466, 41);
    payload.writeUInt32LE(1, 43);

    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    // Cài đặt danh sách tự động: discard chứa 29466
    s.encodeAction("set_item_lists", [
      JSON.stringify([29466]), // discard
      "[]",
      "[]",
      "[]",
      "[]",
    ]);

    // Ngay khi cài đặt, triggerAutoSweep sẽ gửi lệnh vứt ô 2 (item 29466) -> 17/03 00 02 01 00 00 00
    expect(sent.length).toBe(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00001703000201000000", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Tự động vứt]"))).toBe(true);
  });

  it("tự động vứt vật phẩm theo match ItemId không ràng buộc loại vật phẩm (kể cả Hạo Giác 46029 hay Trang bị)", () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game: (m: string) => games.push(m),
      send: (b: Buffer) => sent.push(b),
      patchState() {},
    } as never);

    // Nạp túi đồ có ô 2: 46029 (Hạo Giác, SL 3)
    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 2;
    payload.writeUInt16LE(46029, 5);
    payload.writeUInt32LE(3, 7);

    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    // Cài đặt discard chứa 46029
    s.encodeAction("set_item_lists", [
      JSON.stringify([46029]),
      "[]",
      "[]",
      "[]",
      "[]",
    ]);

    // Gửi gói 17/03 vứt bỏ toàn bộ số lượng 3 ở ô 2 (u32 LE: 03 00 00 00)
    expect(sent.length).toBe(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00001703000203000000", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Tự động vứt]") && g.includes("Hạo Giác"))).toBe(true);
  });

  it("tự động quét và mở (auto-open) vật phẩm theo cấu hình", () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({
      log() {},
      game: (m: string) => games.push(m),
      send: (b: Buffer) => sent.push(b),
      patchState() {},
    } as never);

    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 1;
    payload.writeUInt16LE(46285, 5);
    payload.writeUInt32LE(2, 7);

    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    s.encodeAction("set_item_lists", [
      "[]",
      JSON.stringify([46285]), // autoOpen
      "[]",
      "[]",
      "[]",
    ]);
    expect(sent.length).toBe(1);
    // Gói đầy đủ 8 byte như DÙNG VẬT PHẨM của client thật (pcap use_hpsp_char_pet: `00 <ô> <sl u32> <đích> 00`). Bản cũ chỉ 4 byte (`00 01 01 00`) ⇒ server bỏ qua.
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170f0001010000000000", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Tự động mở]"))).toBe(true);
  });

  it("17/05 với f[9]=01 (server gửi lại sau khi mở/dùng vật phẩm, log thật 16:46) là TÚI ĐỒ — KHÔNG được coi là kho Tiền Trang", () => {
    const games: string[] = [];
    const patches: { bag?: { slot: number; id: number; qty: number }[]; bank?: unknown[]; bankOpen?: boolean }[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send() {}, patchState: (p: object) => patches.push(p) } as never);
    const f = Buffer.from((bagRefresh as { frame: string }).frame, "hex");
    s.onData(encodeFrame(f.subarray(4)));
    const bagPatch = patches.filter((p) => p.bag).at(-1)!;
    expect(bagPatch.bag).toHaveLength(20);
    expect(bagPatch.bag!.find((x) => x.slot === 2)).toMatchObject({ id: 46921, qty: 9 });
    expect(patches.some((p) => p.bank !== undefined || p.bankOpen === true)).toBe(false);
    expect(games.some((g) => g.includes("Tiền Trang"))).toBe(false);
  });

  it("tự mở Phó Bản Cấp 20 II (46921) ở ô 2: gói y hệt gói dùng vật phẩm trong pcap (wire có thật: ô 0x12 cùng định dạng)", () => {
    const sent: Buffer[] = [];
    const s = tsOnlineCodec.create({ log() {}, game() {}, send: (b: Buffer) => sent.push(b), patchState() {} } as never);
    const payload = Buffer.alloc(4 + 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 2;
    payload.writeUInt16LE(46921, 5);
    payload.writeUInt32LE(1, 7);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));
    s.encodeAction("set_item_lists", ["[]", JSON.stringify([46921]), "[]", "[]", "[]"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170f0002010000000000", "hex")).toString("hex"));
    // cùng định dạng với gói pcap `use_hpsp_char_pet` (ô 0x12, sl 1, nhân vật): 6d3cbdadadadbaa2adbfacadadadadad
    expect(encodeFrame(Buffer.from("0000170f0012010000000000", "hex")).toString("hex")).toBe("6d3cbdadadadbaa2adbfacadadadadad");
  });

  it("tự động quét và phân giải (auto-resolve 59/03) theo cấu hình", () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b), patchState() {} } as never);

    // Nạp túi đồ có ô 5: 51504 (Bí Cấp Tr.M.Thành)
    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 5;
    payload.writeUInt16LE(51504, 5);
    payload.writeUInt32LE(1, 7);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    // Cài đặt resolve chứa 51504
    s.encodeAction("set_item_lists", [
      "[]",
      "[]",
      JSON.stringify([51504]),
      "[]",
      "[]",
    ]);

    // Gửi gói 59/03 00 01 05 01 00 00 00
    expect(sent.length).toBe(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000590300010501000000", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Tự động phân giải]"))).toBe(true);
  });

  it("tự động quét và đóng góp bang (auto-contribute 27/0f) theo cấu hình", () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b), patchState() {} } as never);

    // Nạp túi đồ có ô 35: 26157 (Rượu Sake)
    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 35;
    payload.writeUInt16LE(26157, 5);
    payload.writeUInt32LE(1, 7);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    // Cài đặt contribute chứa 26157
    s.encodeAction("set_item_lists", [
      "[]",
      "[]",
      "[]",
      JSON.stringify([26157]),
      "[]",
    ]);

    // Gửi gói 27/0f 00 00 00 00 00 23 (35)
    expect(sent.length).toBe(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000270f000000000023", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Tự động đóng góp]"))).toBe(true);
  });

  it("mở rộng ô túi (open_bag_slot) tự động dùng vật phẩm Tăng Ô Túi 65401", () => {
    const games: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send() {}, patchState() {} } as never);

    // Chưa có vật phẩm 65401 -> thông báo ra log game
    const resNoItem = s.encodeAction("open_bag_slot", []);
    expect(resNoItem!.length).toBe(0);
    expect(games.some((g) => g.includes("không có vật phẩm 'Tăng Ô Túi'"))).toBe(true);

    // Có vật phẩm 65401 ở ô 28 (như tài khoản thật) -> gửi gói 17/0f ô 28
    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 28;
    payload.writeUInt16LE(65401, 5);
    payload.writeUInt32LE(1, 7);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    const buf = s.encodeAction("open_bag_slot", []);
    expect(buf!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170f001c0100", "hex")).toString("hex"));
  });

  it("thao tác phân giải (59/03) và đóng góp bang (27/0f) tạo đúng frame mã hóa", () => {
    const games: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send() {}, patchState() {} } as never);

    // Phân giải ô 5: 59/03 00 01 05 01 00 00 00
    const resBuf = s.encodeAction("resolve_item", ["51504", "5"]);
    expect(resBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("0000590300010501000000", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Phân giải]"))).toBe(true);

    // Đóng góp ô 35: 27/0f 00 00 00 00 00 23
    const conBuf = s.encodeAction("contribute_item", ["26157", "35"]);
    expect(conBuf!.toString("hex")).toBe(encodeFrame(Buffer.from("0000270f000000000023", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Đóng góp Bang]"))).toBe(true);

    s.encodeAction("auto_combine_dragon", []);
    expect(games.some((g) => g.includes("[Tự hợp Lông Vũ]"))).toBe(true);
  });

  it("bật/tắt quét tự động: khi toggle discard=false thì có item rác cũng không được vứt, bật true thì mới quét vứt", () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b), patchState() {} } as never);

    // Túi có ô 2: item 29466 (Vớ Trắng Đỏ Noel - rác/quest)
    const payload = Buffer.alloc(4 + 1 * 36);
    payload.writeUInt16LE(1, 2);
    payload[4] = 2;
    payload.writeUInt16LE(29466, 5);
    payload.writeUInt32LE(1, 7);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

    // Cài đặt danh sách vứt có 29466, NHƯNG toggle discard = false (TẮT)
    s.encodeAction("set_item_lists", [
      JSON.stringify([29466]), // discard
      "[]",
      "[]",
      "[]",
      "[]",
      JSON.stringify({ discard: false }), // TẮT VỨT
    ]);

    // Không được gửi lệnh vứt nào!
    expect(sent.length).toBe(0);
    expect(games.some((g) => g.includes("[Tự động vứt]"))).toBe(false);

    // Bật lại toggle discard = true
    s.encodeAction("set_item_lists", [
      JSON.stringify([29466]),
      "[]",
      "[]",
      "[]",
      "[]",
      JSON.stringify({ discard: true }), // BẬT VỨT
    ]);

    // Ngay lập tức gửi lệnh vứt ô 2
    expect(sent.length).toBe(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00001703000201000000", "hex")).toString("hex"));
    expect(games.some((g) => g.includes("[Tự động vứt]"))).toBe(true);
  });

  describe("Logic Hợp (Chế tạo) tự động", () => {
    it("nếu item trong list combine chỉ còn SL <= 1 thì không xử lý gì cả", () => {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log() {}, game() {}, send: (b: Buffer) => sent.push(b), patchState() {} } as never);

      // Túi chỉ có 1 item 46285 với SL = 1 tại ô 1
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 1;
      payload.writeUInt16LE(46285, 5);
      payload.writeUInt32LE(1, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      s.encodeAction("set_item_lists", ["[]", "[]", "[]", "[]", JSON.stringify([46285]), JSON.stringify({ combine: true })]);
      expect(sent.length).toBe(0); // Không xử lý gì cả
    });

    it("Case A: nếu item đó SL >= 2 thì chế tạo 2 item (cùng ID) với nhau", () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b), patchState() {} } as never);

      // Ô 3 có item 46001 với SL = 3
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 3;
      payload.writeUInt16LE(46001, 5);
      payload.writeUInt32LE(3, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      s.encodeAction("set_item_lists", ["[]", "[]", "[]", "[]", JSON.stringify([46001]), JSON.stringify({ combine: true })]);
      expect(sent.length).toBe(1);
      // Gói 17/0e chuẩn pcap (25 byte): 00 03 01 00 00 00 03 01 00 00 00 00 00 00 00 00 01
      expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170e0003010000000301000000000000000001", "hex")).toString("hex"));
      expect(games.some((g) => g.includes("[Tự động hợp]"))).toBe(true);
    });

    it("Case B: nếu có 2 itemIds khác nhau, mỗi loại còn 1 item thì mix 2 item (khác ID) với nhau", () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b), patchState() {} } as never);

      // Ô 2 có item 46001 (SL=1), Ô 5 có item 46002 (SL=1)
      const payload = Buffer.alloc(4 + 2 * 36);
      payload.writeUInt16LE(2, 2);
      payload[4] = 2;
      payload.writeUInt16LE(46001, 5);
      payload.writeUInt32LE(1, 7);

      payload[40] = 5;
      payload.writeUInt16LE(46002, 41);
      payload.writeUInt32LE(1, 43);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      // List combine chứa cả 2 item: 46001 và 46002
      s.encodeAction("set_item_lists", ["[]", "[]", "[]", "[]", JSON.stringify([46001, 46002]), JSON.stringify({ combine: true })]);
      expect(sent.length).toBe(1);
      // Gói 17/0e mix ô 2 và ô 5 chuẩn pcap (25 byte): 00 02 01 00 00 00 05 01 00 00 00 00 00 00 00 00 01
      expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170e0002010000000501000000000000000001", "hex")).toString("hex"));
      expect(games.some((g) => g.includes("[Tự động hợp]"))).toBe(true);
    });

    it("Case A xếp chồng: Bánh bao x100 tự hợp 1x1 xuống 98 và tiếp tục cho đến khi SL <= 1 hoặc tắt toggle", async () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      let bagState: { slot: number; id: number; qty: number }[] = [];
      const s = tsOnlineCodec.create({
        log() {},
        game: (m: string) => games.push(m),
        send: (b: Buffer) => sent.push(b),
        patchState: (p: { bag?: typeof bagState }) => {
          if (p.bag) bagState = p.bag;
        },
      } as never);

      // Ô 1 có Bánh bao (46001) xếp chồng SL = 100
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 1;
      payload.writeUInt16LE(46001, 5);
      payload.writeUInt32LE(100, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      // Bật chế tạo cho item 46001
      s.encodeAction("set_item_lists", ["[]", "[]", "[]", "[]", JSON.stringify([46001]), JSON.stringify({ combine: true })]);
      expect(sent.length).toBe(1);
      // 17/0e chuẩn pcap (25 byte): dùng 1 bánh bao ô 1 x 1 bánh bao ô 1
      expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170e0001010000000101000000000000000001", "hex")).toString("hex"));
      expect(games.some((g) => g.includes("Đã tự động chế tạo hợp thành 1x1"))).toBe(true);

      // Giả lập server gửi 17/08 cập nhật số lượng còn lại = 98 (giảm 2)
      await new Promise((r) => setTimeout(r, 260)); // đợi timer sweep mở khóa
      const slotUpdate98 = Buffer.from("000017080001b1b362000000", "hex"); // slot 1, id 46001 (b1b3), qty 98 (0x62)
      s.onData(encodeFrame(slotUpdate98));

      // Lần quét kế tiếp tiếp tục hợp
      expect(sent.length).toBe(2);
      expect(sent[1]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170e0001010000000101000000000000000001", "hex")).toString("hex"));

      // Giả lập server gửi 17/08 cập nhật số lượng còn lại = 1 (SL <= 1)
      await new Promise((r) => setTimeout(r, 260));
      const slotUpdate1 = Buffer.from("000017080001b1b301000000", "hex"); // slot 1, id 46001 (b1b3), qty 1
      s.onData(encodeFrame(slotUpdate1));

      // Khi SL <= 1, bot dừng lại và KHÔNG gửi thêm gói nào!
      expect(sent.length).toBe(2);

      // Nếu server gửi 17/09 xóa ô 1:
      const slotRemove = Buffer.from("00001709000101000000", "hex");
      s.onData(encodeFrame(slotRemove));
      expect(bagState.length).toBe(0);
    });

    it("Khi toggle combine = false: nếu chưa hợp trong ngày và có item trong list thì hợp đúng 1 lần cho daily checklist", async () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const logs: string[] = [];
      const s = tsOnlineCodec.create({
        log(_lvl: string, m: string) { logs.push(m); },
        game: (m: string) => games.push(m),
        send: (b: Buffer) => sent.push(b),
        patchState() {},
      } as never);

      // Ô 1 có Bánh bao (46001) SL = 10
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 1;
      payload.writeUInt16LE(46001, 5);
      payload.writeUInt32LE(10, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      // Cài đặt danh sách có 46001, toggle combine = false, chưa có cờ hợp trong ngày
      s.encodeAction("set_item_lists", [
        "[]",
        "[]",
        "[]",
        "[]",
        JSON.stringify([46001]),
        JSON.stringify({ combine: false }),
      ]);

      // Phải gửi đúng 1 lần
      expect(sent.length).toBe(1);
      expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000170e0001010000000101000000000000000001", "hex")).toString("hex"));
      expect(games.some((g) => g.includes("[Hợp hàng ngày] Tính năng hợp đang tắt: Tự động hợp"))).toBe(true);

      // Đợi timer và cập nhật túi đồ (vẫn còn 8 cái)
      await new Promise((r) => setTimeout(r, 260));
      const slotUpdate8 = Buffer.from("000017080001b1b308000000", "hex"); // slot 1, qty 8
      s.onData(encodeFrame(slotUpdate8));

      // Không gửi thêm gói nào nữa vì hôm nay đã hoàn thành 1 lần duy nhất
      expect(sent.length).toBe(1);
    });

    it("Khi toggle combine = false: nếu đã có cờ hợp trong ngày (lastCombinedDate) thì không hợp tiếp", () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const s = tsOnlineCodec.create({
        log() {},
        game: (m: string) => games.push(m),
        send: (b: Buffer) => sent.push(b),
        patchState() {},
      } as never);

      // Ô 1 có Bánh bao (46001) SL = 10
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 1;
      payload.writeUInt16LE(46001, 5);
      payload.writeUInt32LE(10, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      const today = getTaiwanDateKey();
      // Đã có cờ hợp trong ngày hôm nay (relogin sau khi đã hợp)
      s.encodeAction("set_item_lists", [
        "[]",
        "[]",
        "[]",
        "[]",
        JSON.stringify([46001]),
        JSON.stringify({ combine: false, lastCombinedDate: today }),
      ]);

      // Không gửi bất kỳ gói hợp nào
      expect(sent.length).toBe(0);
    });

    it("Khi toggle combine = false: nếu không đủ item trong list thì không xử lý gì cả", () => {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({
        log() {},
        game() {},
        send: (b: Buffer) => sent.push(b),
        patchState() {},
      } as never);

      // Ô 1 có Bánh bao (46001) nhưng chỉ có SL = 1 (không đủ hợp 1x1 hoặc ghép đôi)
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 1;
      payload.writeUInt16LE(46001, 5);
      payload.writeUInt32LE(1, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      s.encodeAction("set_item_lists", [
        "[]",
        "[]",
        "[]",
        "[]",
        JSON.stringify([46001]),
        JSON.stringify({ combine: false }),
      ]);

      // Không đủ nguyên liệu -> không gửi
      expect(sent.length).toBe(0);
    });
  });

  describe("Thao tác quét ngay (sweep_inventory) & Auto quét 1 phút", () => {
    it("quét ngay khi thùng đồ có item trong list Phân giải thì tự động gửi gói 59/03", () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const logs: string[] = [];
      const s = tsOnlineCodec.create({ log(_lvl: string, m: string) { logs.push(m); }, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b), patchState() {} } as never);

      // Thùng đồ có ô 1: item 51504 (như tài khoản tuancn11)
      const payload = Buffer.alloc(4 + 1 * 36);
      payload.writeUInt16LE(1, 2);
      payload[4] = 1;
      payload.writeUInt16LE(51504, 5);
      payload.writeUInt32LE(1, 7);
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), payload])));

      // Cài đặt danh sách resolve có 51504, toggle resolve = true
      s.encodeAction("set_item_lists", [
        "[]",
        "[]",
        JSON.stringify([51504]),
        "[]",
        "[]",
        JSON.stringify({ resolve: true }),
      ]);

      sent.length = 0;
      // Bấm nút "Quét ngay"
      s.encodeAction("sweep_inventory", []);

      expect(logs.some((l) => l.includes("[Quét túi đồ] Bắt đầu quét"))).toBe(true);
      expect(games.some((g) => g.includes("[Tự động phân giải] Đã tự động phân giải"))).toBe(true);
      expect(sent.length).toBe(1);
      expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("0000590300010101000000", "hex")).toString("hex"));
    });

    it("quét ngay khi không có item nào cần xử lý thì báo hoàn tất", () => {
      const logs: string[] = [];
      const s = tsOnlineCodec.create({ log(_lvl: string, m: string) { logs.push(m); }, game() {}, send() {}, patchState() {} } as never);

      s.encodeAction("sweep_inventory", []);
      expect(logs.some((g) => g.includes("Đã quét xong: Thùng đồ cá nhân không có vật phẩm nào cần xử lý"))).toBe(true);
    });

    it("bật auto quét định kỳ 1 phút ghi nhận thông báo vào game log", () => {
      const games: string[] = [];
      const s = tsOnlineCodec.create({ log() {}, game: (m: string) => games.push(m), send() {}, patchState() {} } as never);

      s.encodeAction("set_item_lists", [
        "[]", "[]", "[]", "[]", "[]", "{}", "true"
      ]);
      expect(games.some((g) => g.includes("[Auto Quét Túi] Đã BẬT tự động quét thùng đồ cá nhân định kỳ mỗi 1 phút"))).toBe(true);

      s.encodeAction("set_item_lists", [
        "[]", "[]", "[]", "[]", "[]", "{}", "false"
      ]);
      expect(games.some((g) => g.includes("[Auto Quét Túi] Đã TẮT tự động quét thùng đồ cá nhân định kỳ"))).toBe(true);
    });

    it("cập nhật chỉ số HP/SP qua gói 08/01 và 08/02 và tự động dùng HP/SP ưu tiên chỉ số + thấp nhất", () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const statePatches: any[] = [];
      const s = tsOnlineCodec.create({
        log() {},
        game: (m: string) => games.push(m),
        send: (b: Buffer) => sent.push(b),
        patchState: (p: any) => statePatches.push(p),
      } as never);

      // Thiết lập stats ban đầu cho player: max HP 1000, max SP 500, cur HP 300 (30%), cur SP 100 (20%)
      // Nhận 05/03 hoặc mock stats
      // Đặt túi đồ: có ô 1: Thương Dược (27004: +25 HP, x10), ô 2: Xôi (26001: +10 HP, x10), ô 3: Thuốc Hồng Hoa (27037: +25 SP, x10)
      const testItems = [
        { slot: 1, id: 27004, qty: 10 },
        { slot: 2, id: 26001, qty: 10 },
        { slot: 3, id: 27037, qty: 10 },
      ];
      const bagPayload = Buffer.alloc(4 + testItems.length * 36);
      bagPayload.writeUInt16LE(testItems.length, 2);
      testItems.forEach((it, i) => {
        const o = 4 + i * 36;
        bagPayload[o] = it.slot;
        bagPayload.writeUInt16LE(it.id, o + 1);
        bagPayload.writeUInt32LE(it.qty, o + 3);
      });
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), bagPayload])));

      // Giả lập nhận 05/03 ban đầu với max HP 500, max SP 200
      s.onData(frame(0x05, 0x03, fx.player_0503));

      // Kiểm tra nhận gói 08/01 cập nhật cur HP = 150 (150/500 = 30% < 50%)
      // 08/01: 00 [prop u16LE = 0x0119] [val u32LE = 150] 00 00 00 00
      s.onData(frame(0x08, 0x01, "0019019600000000000000"));
      expect(statePatches.some((p) => p.player?.hp?.cur === 150)).toBe(true);

      // Cấu hình AutoHeal: Player tự dùng HP khi dưới 50% (cần lên 200 HP; hiện có 150 HP, thiếu 50 HP)
      // Túi đồ có Xôi (+10 HP) và Thương Dược (+25 HP).
      // Theo thuật toán ưu tiên item chỉ số + thấp nhất trước:
      // Hệ thống PHẢI dùng Xôi (+10 HP) trước! Dùng 5 cái Xôi (5 * 10 = 50 HP) -> đạt 200 HP -> dừng lại!
      s.encodeAction("set_auto_heal", [
        JSON.stringify({
          enabled: true,
          player: { autoHp: true, hpPct: 50, autoSp: false, spPct: 50 },
          pet: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
        }),
      ]);

      // Kiểm tra gói gửi đi:
      expect(sent.length).toBeGreaterThan(0);
      expect(games.some((g) => g.includes("Xôi") && g.includes("+10 HP"))).toBe(true);
      // Trạng thái HP của player được cập nhật ngay lập tức: 150 + 5 * 10 = 200 HP
      expect(statePatches.some((p) => p.player?.hp?.cur === 200)).toBe(true);
    });

    it("tự động dùng SP cho Pet đúng mốc cấu hình, không bị gọi lặp qua emitBag (17/09) gây vượt mốc", () => {
      const sent: Buffer[] = [];
      const games: string[] = [];
      const statePatches: any[] = [];
      const s = tsOnlineCodec.create({
        log() {},
        game: (m: string) => games.push(m),
        send: (b: Buffer) => sent.push(b),
        patchState: (p: any) => statePatches.push(p),
      } as never);

      // Nạp Pet Ma Quan Vũ (max HP 1470, max SP 588)
      s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
      s.onData(frame(0x13, 0x04, fx.mqv_1304));

      // Cập nhật Pet SP = 200 (200 / 588 = 34% < 70%)
      // 08/02: 00 04 [petIdx=1] 00 [prop u16LE = 0x011a] [val u32LE = 200]
      s.onData(frame(0x08, 0x02, "000401001a01c800000000000000"));

      // Nạp túi đồ: ô 1: Thuốc Hồng Hoa (27037: +25 SP, x20), ô 2: Thiên Kim Du (27138: +62 SP, x10)
      const testItems = [
        { slot: 1, id: 27037, qty: 20 },
        { slot: 2, id: 27138, qty: 10 },
      ];
      const bagPayload = Buffer.alloc(4 + testItems.length * 36);
      bagPayload.writeUInt16LE(testItems.length, 2);
      testItems.forEach((it, i) => {
        const o = 4 + i * 36;
        bagPayload[o] = it.slot;
        bagPayload.writeUInt16LE(it.id, o + 1);
        bagPayload.writeUInt32LE(it.qty, o + 3);
      });
      s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x17, 0x05]), bagPayload])));

      // Cài mốc SP pet = 70% (cần 412 SP, thiếu 212 SP -> cần 9x Thuốc Hồng Hoa = 225 SP -> đạt 425 SP)
      sent.length = 0;
      games.length = 0;
      s.encodeAction("set_auto_heal", [
        JSON.stringify({
          enabled: true,
          player: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
          pet: { autoHp: false, hpPct: 50, autoSp: true, spPct: 70 },
        }),
      ]);

      // Chỉ gửi đúng 1 lệnh dùng 9x Thuốc Hồng Hoa
      expect(sent.length).toBe(1);
      expect(games.some((g) => g.includes("9x Thuốc Hồng Hoa (+25 SP) (Sau khi dùng: ~425/588 SP)"))).toBe(true);
      // Pet SP trong state phải được cập nhật lên 425 ngay lập tức
      expect(statePatches.some((p) => p.pet?.sp?.cur === 425)).toBe(true);

      // Khi server trả gói 17/09 trừ 9 bình Thuốc Hồng Hoa ở ô 1
      sent.length = 0;
      const removePayload = Buffer.from("00001709000109000000", "hex"); // slot 1, qty 9
      s.onData(encodeFrame(removePayload));

      // Không được gửi thêm bất kỳ gói dùng thuốc nào nữa (không được vượt mốc 70%)!
      expect(sent.length).toBe(0);
    });
  });
});



