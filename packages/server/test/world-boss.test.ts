import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CharacterState } from "@tsbot/protocol";
import { DailyChecklistStore, WorldBossConfigStore } from "../src/services/store";
import { WorldBossService, type WorldBossHost } from "../src/services/worldBoss";

let tempDir: string;
const origEnv = process.env.DATA_DIR;
const origTsbotEnv = process.env.TSBOT_DATA_DIR;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tsbot-world-boss-test-"));
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

describe("WorldBossConfigStore (Multi-account isolation)", () => {
  it("phân lập 100% dữ liệu cấu hình theo canonicalKey", () => {
    const store = new WorldBossConfigStore();

    store.set("user1@s1", { enabled: true, attempts: 5, useTickets: true, bossPetId: 1001 });
    store.set("user2@s1", { enabled: false, attempts: 7, useTickets: false, bossPetId: 1002 });

    const c1 = store.get("user1@s2");
    const c2 = store.get("user2");

    expect(c1.enabled).toBe(true);
    expect(c1.attempts).toBe(5);
    expect(c1.useTickets).toBe(true);
    expect(c1.bossPetId).toBe(1001);

    expect(c2.enabled).toBe(false);
    expect(c2.attempts).toBe(7);
    expect(c2.useTickets).toBe(false);
    expect(c2.bossPetId).toBe(1002);
  });
});

describe("WorldBossService — điều phối săn Boss Thế Giới", () => {
  function makeMockConn(initialState?: Partial<CharacterState>) {
    let state: CharacterState = {
      player: { name: "Leader", level: 150, hp: { cur: 1000, max: 1000 }, sp: { cur: 500, max: 500 }, exp: 0 },
      pet: { name: "LuBo", level: 150, hp: { cur: 1500, max: 1500 }, sp: { cur: 300, max: 300 }, exp: 0 },
      pets: [
        { name: "LuBo", level: 150, hp: { cur: 1500, max: 1500 }, sp: { cur: 300, max: 300 }, exp: 0, idx: 1, model: 1001, active: true },
        { name: "TrieuVan", level: 150, hp: { cur: 1400, max: 1400 }, sp: { cur: 300, max: 300 }, exp: 0, idx: 2, model: 1002, active: false },
      ],
      party: { joined: false, isLeader: false, isAdvisor: false, count: 1, members: [] },
      location: { map: 12001, x: 1910, y: 1190 },
      inBattle: false,
      auto: true,
      bag: [{ slot: 1, id: 46629, qty: 5 }],
      ...initialState,
    };

    const dispatches: { action: string; params?: any }[] = [];
    const logs: string[] = [];

    return {
      character: () => state,
      setState: (patch: Partial<CharacterState>) => { state = { ...state, ...patch }; },
      dispatch: async (action: string, params?: any) => {
        dispatches.push({ action, params });
        if (action === "leave_party") {
          state.party = { joined: false, isLeader: false, isAdvisor: false, count: 1, members: [] };
          return { ok: true };
        }
        if (action === "warp_map") {
          state.location = { ...state.location, map: Number(params?.mapId ?? 12001) };
          return { ok: true };
        }
        return { ok: true };
      },
      stopScript: () => {},
      log: (_lvl: string, msg: string) => logs.push(msg),
      dispatches,
      logs,
    };
  }

  it("khởi tạo đúng lượt đánh và quản lý trạng thái săn boss", () => {
    const store = new WorldBossConfigStore();
    store.set("char1", { enabled: false, attempts: 5, useTickets: true });

    const mockConn = makeMockConn();
    const host: WorldBossHost = {
      entries: () => [["char1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new WorldBossService(host, store);
    const r = svc.startBoss("char1");
    expect(r.ok).toBe(true);

    const st = svc.stateFor("char1");
    expect(st.totalAttempts).toBe(1);
    expect(st.currentAttempt).toBe(0);
    expect(st.phase).toBe("preparing");
  });

  it("rời đội nếu đang trong đội ngũ trước khi săn boss", () => {
    const store = new WorldBossConfigStore();
    store.set("char1", { enabled: false, attempts: 7 });

    const mockConn = makeMockConn({
      party: { joined: true, isLeader: true, isAdvisor: false, count: 3, members: [] },
    });
    const host: WorldBossHost = {
      entries: () => [["char1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new WorldBossService(host, store);
    svc.startBoss("char1");

    const st = svc.stateFor("char1");
    expect(st.phase).toBe("leaving_party");
  });

  it("tự động chuyển sang reviving khi nhân vật tử vong về Quỷ Môn Quan 12007", async () => {
    const store = new WorldBossConfigStore();
    store.set("char1", { enabled: false, attempts: 5 });

    const mockConn = makeMockConn({ location: { map: 12007, x: 311, y: 428 } });
    const host: WorldBossHost = {
      entries: () => [["char1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new WorldBossService(host, store);
    svc.startBoss("char1");

    await (svc as any).tick();
    const st = svc.stateFor("char1");
    expect(st.phase).toBe("reviving");
    expect(st.message).toContain("Quỷ Môn Quan");
  });

  it("chạy chuẩn flow 1 lượt: walking -> healing (sweep_auto_heal) -> challenging -> kết thúc trận ghi checklist", async () => {
    const store = new WorldBossConfigStore();
    const checklistStore = new DailyChecklistStore();
    store.set("char1", { enabled: false, attempts: 1 });

    const mockConn = makeMockConn({ location: { map: 12001, x: 1910, y: 1190 } });
    const host: WorldBossHost = {
      entries: () => [["char1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new WorldBossService(host, store, checklistStore);
    svc.startBoss("char1");

    // Tick 1: preparing -> warping
    await (svc as any).tick();
    // Tick 2: warping -> walking
    await (svc as any).tick();
    // Tick 3: walking -> dist <= 120 -> healing
    await (svc as any).tick();
    expect(svc.stateFor("char1").phase).toBe("healing");

    // Tick 4: healing -> dispatch sweep_auto_heal -> challenging
    await (svc as any).tick();
    expect(mockConn.dispatches.some((d) => d.action === "sweep_auto_heal")).toBe(true);
    expect(svc.stateFor("char1").phase).toBe("challenging");

    // Giả lập vào trận
    mockConn.setState({ inBattle: true });
    await (svc as any).tick();
    expect(svc.stateFor("char1").phase).toBe("in_battle");

    // Giả lập hết trận -> finishing
    mockConn.setState({ inBattle: false });
    await (svc as any).tick();
    expect(svc.stateFor("char1").phase).toBe("finishing");
    expect(mockConn.logs.some((l) => l.includes("Hoàn thành 1 lượt khiêu chiến Boss Thế Giới"))).toBe(true);

    // Kiểm tra checklist được ghi nhận
    const cl = checklistStore.get("char1");
    expect(cl.items.world_boss?.done).toBe(true);
    expect(cl.items.world_boss?.currentCount).toBe(1);
  });
});

describe("DailyChecklistStore (Multi-account isolation & Taiwan reset)", () => {
  it("phân lập theo canonicalKey và hỗ trợ toggle / progress", () => {
    const store = new DailyChecklistStore();

    store.recordProgress("user1@s1", "escort", 1);
    const u1_1 = store.get("user1@s2");
    expect(u1_1.items.escort?.currentCount).toBe(1);
    expect(u1_1.items.escort?.done).toBe(false);

    // Vận tiêu 3 lượt hoàn thành
    store.recordProgress("user1", "escort", 2);
    const u1_2 = store.get("user1");
    expect(u1_2.items.escort?.currentCount).toBe(3);
    expect(u1_2.items.escort?.done).toBe(true);

    // User 2 độc lập không bị ảnh hưởng
    const u2 = store.get("user2");
    expect(u2.items.escort?.currentCount).toBe(0);
    expect(u2.items.escort?.done).toBe(false);

    // Toggle tay hoàn tất và bỏ hoàn tất
    store.toggle("user2", "checkin");
    expect(store.get("user2").items.checkin?.done).toBe(true);
    store.toggle("user2", "checkin");
    expect(store.get("user2").items.checkin?.done).toBe(false);
  });
});
