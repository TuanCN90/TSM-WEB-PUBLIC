import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CharacterState, InnPetInfo } from "@tsbot/protocol";
import { DailyChecklistStore, EscortConfigStore } from "../src/services/store";
import { EscortService, type EscortHost } from "../src/services/escort";

let tempDir: string;
const origEnv = process.env.DATA_DIR;
const origTsbotEnv = process.env.TSBOT_DATA_DIR;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tsbot-escort-test-"));
  process.env.DATA_DIR = tempDir;
  process.env.TSBOT_DATA_DIR = tempDir;
});

afterEach(() => {
  if (origEnv) process.env.DATA_DIR = origEnv;
  else delete process.env.DATA_DIR;
  if (origTsbotEnv) process.env.TSBOT_DATA_DIR = origTsbotEnv;
  else delete process.env.TSBOT_DATA_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("EscortConfigStore (Multi-account isolation)", () => {
  it("phân lập 100% dữ liệu cấu hình theo canonicalKey", () => {
    const store = new EscortConfigStore();

    store.set("user1@s1", { enabled: true, selectedPetSlot: 1, selectedPetName: "Thái Văn Cơ" });
    store.set("user2@s1", { enabled: false, selectedPetSlot: 2, selectedPetName: "Phong Ba Đậu Yêu" });

    const c1 = store.get("user1@s2");
    const c2 = store.get("user2");

    expect(c1.enabled).toBe(true);
    expect(c1.selectedPetSlot).toBe(1);
    expect(c1.selectedPetName).toBe("Thái Văn Cơ");

    expect(c2.enabled).toBe(false);
    expect(c2.selectedPetSlot).toBe(2);
    expect(c2.selectedPetName).toBe("Phong Ba Đậu Yêu");
  });
});

describe("EscortService — Vận Tiêu & Nhà Trọ", () => {
  function makeMockConn(initialState?: Partial<CharacterState>) {
    const defaultState: CharacterState = {
      player: { uid: "0102030405060708", name: "Player1", level: 50, hp: { cur: 500, max: 500 }, sp: { cur: 200, max: 200 }, exp: 10 },
      location: { map: 12007, x: 350, y: 450 },
      innPets: [
        { slot: 1, model: 14101, name: "Thái Văn Cơ", level: 1, exp: 6, hp: 205, status: 0 },
        { slot: 2, model: 22097, name: "Phong Ba Đậu Yêu", level: 10, exp: 500, hp: 300, status: 0 },
      ],
      escort: {
        phase: "idle",
        dailyCount: 0,
        maxDailyCount: 3,
      },
    };

    let state: CharacterState = { ...defaultState, ...initialState };
    const dispatched: { action: string; params?: Record<string, string | number> }[] = [];
    const logs: string[] = [];

    const conn = {
      character: () => state,
      log: (_level: string, msg: string) => logs.push(msg),
      dispatch: async (action: string, params?: Record<string, string | number>) => {
        dispatched.push({ action, params });
        if (action === "escort_start") {
          const slot = Number(params?.slot) || 1;
          const nextPets = (state.innPets || []).map((p) => (p.slot === slot ? { ...p, status: 1 } : p));
          state = {
            ...state,
            innPets: nextPets,
            escort: {
              phase: "escorting",
              dailyCount: (state.escort?.dailyCount ?? 0) + 1,
              maxDailyCount: 3,
              activeEscort: {
                slot,
                petName: nextPets.find((p) => p.slot === slot)?.name,
                startTime: Date.now(),
                endTime: Date.now() + 4 * 3600 * 1000,
                durationHours: 4,
              },
            },
          };
        }
        return { ok: true };
      },
    } as any;

    return {
      conn,
      dispatched,
      logs,
      getState: () => state,
      setState: (s: CharacterState) => { state = s; },
    };
  }

  it("cử đúng duy nhất pet được chọn đi vận tiêu và cập nhật checklist daily", async () => {
    const configStore = new EscortConfigStore();
    const checklistStore = new DailyChecklistStore("daily-checklist-test.json");
    configStore.set("acc1", { enabled: true, selectedPetSlot: 1, selectedPetName: "Thái Văn Cơ" });

    const mock = makeMockConn();
    const host: EscortHost = {
      entries: () => [["acc1", mock.conn]],
      get: (id: string) => (id === "acc1" ? mock.conn : undefined),
      pushCharacter: () => {},
    };

    const service = new EscortService(host, configStore, checklistStore);
    const result = await service.triggerFor("acc1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Thái Văn Cơ");
    expect(mock.dispatched.some((d) => d.action === "escort_start" && String(d.params?.slot) === "1")).toBe(true);

    // Checklist ghi nhận tiến độ 1/3
    const cl = checklistStore.get("acc1");
    expect(cl.items.escort?.currentCount).toBe(1);
    expect(cl.items.escort?.done).toBe(false);
  });

  it("TUYỆT ĐỐI KHÔNG dùng pet khác nếu pet chỉ định không tồn tại", async () => {
    const configStore = new EscortConfigStore();
    // Cấu hình slot 5 (không có trong Nhà Trọ)
    configStore.set("acc1", { enabled: true, selectedPetSlot: 5, selectedPetName: "Pet Hiếm" });

    const mock = makeMockConn();
    const host: EscortHost = {
      entries: () => [["acc1", mock.conn]],
      get: (id: string) => (id === "acc1" ? mock.conn : undefined),
      pushCharacter: () => {},
    };

    const service = new EscortService(host, configStore);
    const result = await service.triggerFor("acc1");

    // Phải từ chối và ghi log cảnh báo bảo mật, không tự ý chọn slot 1 hay 2
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không tìm thấy võ tướng ô 5");
    expect(mock.dispatched.some((d) => d.action === "escort_start")).toBe(false);
    expect(mock.logs.some((l) => l.includes("TUYỆT ĐỐI KHÔNG DÙNG PET KHÁC"))).toBe(true);
  });

  it("chặn không cho vận tiêu nếu đã hoàn thành 3/3 lượt trong ngày", async () => {
    const configStore = new EscortConfigStore();
    configStore.set("acc1", { enabled: true, selectedPetSlot: 1 });

    const mock = makeMockConn({
      escort: {
        phase: "completed_daily",
        dailyCount: 3,
        maxDailyCount: 3,
      },
    });
    const host: EscortHost = {
      entries: () => [["acc1", mock.conn]],
      get: (id: string) => (id === "acc1" ? mock.conn : undefined),
      pushCharacter: () => {},
    };

    const service = new EscortService(host, configStore);
    const result = await service.triggerFor("acc1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Đã hoàn thành tối đa 3/3 lượt");
    expect(mock.dispatched.some((d) => d.action === "escort_start")).toBe(false);
  });
});
