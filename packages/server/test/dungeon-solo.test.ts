import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DUNGEON_SOLO_CATALOG, getSoloDungeonDef, type CharacterState, type DungeonSoloConfig } from "@tsbot/protocol";
import { DungeonSoloConfigStore } from "../src/services/store";
import { DungeonSoloService, type DungeonSoloHost } from "../src/services/dungeonSolo";

let tempDir: string;
const origEnv = process.env.TSBOT_DATA_DIR;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tsbot-dungeon-solo-test-"));
  process.env.DATA_DIR = tempDir;
  process.env.TSBOT_DATA_DIR = tempDir;
});

afterEach(() => {
  if (origEnv) {
    process.env.DATA_DIR = origEnv;
    process.env.TSBOT_DATA_DIR = origEnv;
  } else {
    delete process.env.DATA_DIR;
    delete process.env.TSBOT_DATA_DIR;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("DungeonSolo Catalog & Helpers", () => {
  it("chứa đầy đủ 12 phó bản đơn của 3 loại qua 4 mốc cấp độ", () => {
    expect(DUNGEON_SOLO_CATALOG).toHaveLength(12);

    const khieuChien = DUNGEON_SOLO_CATALOG.filter((d) => d.type === "khieu_chien");
    const sanKhoBau = DUNGEON_SOLO_CATALOG.filter((d) => d.type === "san_kho_bau");
    const timDauDau = DUNGEON_SOLO_CATALOG.filter((d) => d.type === "tim_dau_dau");

    expect(khieuChien).toHaveLength(4);
    expect(sanKhoBau).toHaveLength(4);
    expect(timDauDau).toHaveLength(4);

    // ID đúng theo giải mã gói 2f/02 của TSM
    expect(khieuChien.map((d) => d.id)).toEqual([2, 3, 4, 5]);
    expect(sanKhoBau.map((d) => d.id)).toEqual([6, 7, 8, 9]);
    expect(timDauDau.map((d) => d.id)).toEqual([10, 11, 12, 13]);
  });

  it("getSoloDungeonDef tự động chọn đúng mốc theo cấp độ nhân vật", () => {
    // Cấp 50 -> mốc 1 (15-80)
    const d1 = getSoloDungeonDef("khieu_chien", 50);
    expect(d1?.id).toBe(2);
    expect(d1?.door).toBe(1);

    // Cấp 100 -> mốc 2 (81-150)
    const d2 = getSoloDungeonDef("san_kho_bau", 100);
    expect(d2?.id).toBe(7);
    expect(d2?.map).toBe(62004);

    // Cấp 160 -> mốc 3 (151-200)
    const d3 = getSoloDungeonDef("tim_dau_dau", 160);
    expect(d3?.id).toBe(12);
    expect(d3?.map).toBe(62009);

    // Cấp 250 -> mốc 4 (201-400)
    const d4 = getSoloDungeonDef("khieu_chien", 250);
    expect(d4?.id).toBe(5);
    expect(d4?.door).toBe(4);
  });

  it("getSoloDungeonDef ưu tiên bracket khi người dùng chỉ định cụ thể", () => {
    // Nhân vật cấp 250 nhưng chọn bracket 1 (15-80)
    const d = getSoloDungeonDef("san_kho_bau", 250, 1);
    expect(d?.id).toBe(6);
    expect(d?.bracket).toBe(1);
    expect(d?.map).toBe(62003);
  });
});

describe("DungeonSoloConfigStore (Multi-account isolation)", () => {
  it("phân lập 100% dữ liệu cấu hình theo canonicalKey", () => {
    const store = new DungeonSoloConfigStore();

    store.set("user1@s1", { enabled: true, type: "khieu_chien", bracket: 1, leaveParty: false });
    store.set("user2@s1", { enabled: false, type: "san_kho_bau", bracket: 2, leaveParty: true });

    const c1 = store.get("user1@s2"); // Cùng username clean -> cùng tài khoản
    const c2 = store.get("user2");

    expect(c1.enabled).toBe(true);
    expect(c1.type).toBe("khieu_chien");
    expect(c1.bracket).toBe(1);
    expect(c1.leaveParty).toBe(false);

    expect(c2.enabled).toBe(false);
    expect(c2.type).toBe("san_kho_bau");
    expect(c2.bracket).toBe(2);
    expect(c2.leaveParty).toBe(true);
  });

  it("sanitize giá trị không hợp lệ về mặc định an toàn", () => {
    const store = new DungeonSoloConfigStore();
    const cfg = store.set("user3", { type: "invalid" as any, bracket: 99 });
    expect(cfg.type).toBe("all");
    expect(cfg.bracket).toBe(0);
    expect(cfg.leaveParty).toBe(true);
  });
});

describe("DungeonSoloService — điều phối phó bản đơn", () => {
  function makeMockConn(
    initialState?: Partial<CharacterState>,
    customDispatch?: (action: string, params?: any) => Promise<any> | any
  ) {
    let state: CharacterState = {
      player: { name: "TestChar", level: 60, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 0 },
      pet: { name: "", level: 0, hp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, exp: 0 },
      economy: { gold: 1000, xu: 0 },
      party: { joined: false, isLeader: false, isAdvisor: false, count: 1, members: [] },
      location: { map: 12001, x: 100, y: 100 },
      inBattle: false,
      auto: true,
      bag: [],
      ...initialState,
    };

    const dispatches: { action: string; params?: any }[] = [];
    const scripts: { name: string; script: string }[] = [];
    const logs: string[] = [];

    return {
      character: () => state,
      setState: (patch: Partial<CharacterState>) => { state = { ...state, ...patch }; },
      dispatch: async (action: string, params?: any) => {
        dispatches.push({ action, params });
        if (customDispatch) {
          const custom = await customDispatch(action, params);
          if (custom !== undefined) return custom;
        }
        if (action === "dungeon_room_create") {
          state.dungeonRoom = { status: "open", roomId: 101 };
          return { ok: true };
        }
        if (action === "warp_id" || action === "warp_raw") {
          state.location = { ...state.location, map: 62001 };
          return { ok: true };
        }
        if (action === "leave_party") {
          state.party = { joined: false, isLeader: false, isAdvisor: false, count: 1, members: [] };
          return { ok: true };
        }
        if (action === "dungeon_exit") {
          state.location = { ...state.location, map: 12001 };
          state.dungeonRoom = { status: "left" };
          return { ok: true };
        }
        return { ok: true };
      },
      runScript: (name: string, script: string) => {
        scripts.push({ name, script });
      },
      stopScript: () => {},
      info: () => ({ script: { state: "idle" } }),
      log: (_lvl: string, msg: string) => logs.push(msg),
      dispatches,
      scripts,
      logs,
    };
  }

  it("bắt đầu chuỗi 3 phó bản và khởi tạo đúng queue", () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: false, type: "all" });

    const mockConn = makeMockConn();
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    const r = svc.startSolo("player1");
    expect(r.ok).toBe(true);

    const st = svc.stateFor("player1");
    expect(st.phase).toBe("creating_room"); // Do đã ở map 12001
    expect(st.currentType).toBe("khieu_chien");
    expect(store.get("player1").enabled).toBe(true);
  });

  it("rời đội nếu nhân vật đang trong tổ đội khi bắt đầu", () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: false, type: "san_kho_bau", leaveParty: true });

    const mockConn = makeMockConn({
      party: { joined: true, isLeader: false, isAdvisor: false, count: 2, members: [] },
    });
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    svc.startSolo("player1");

    const st = svc.stateFor("player1");
    expect(st.phase).toBe("leaving_party");
  });

  it("dừng phó bản và thoát phó bản về trạng thái an toàn", async () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: true, type: "tim_dau_dau" });

    const mockConn = makeMockConn({ location: { map: 62007, x: 200, y: 200 } });
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    const r = await svc.exitDungeon("player1");
    expect(r.ok).toBe(true);

    const st = svc.stateFor("player1");
    expect(st.phase).toBe("idle");
    expect(store.get("player1").enabled).toBe(false);
    expect(mockConn.dispatches.some((d) => d.action === "dungeon_exit")).toBe(true);
  });

  it("ghi nhận baseline EXP và ghi log + exp khi hoàn thành phó bản", async () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: false, type: "khieu_chien", attempts: 1, autoBuyAttempts: false });

    const mockConn = makeMockConn({
      location: { map: 12001, x: 100, y: 100 },
      player: { name: "Hero", level: 50, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 10.5, expCur: 1000, expMax: 10000 },
      pet: { name: "QuanVu", level: 50, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 5.0, expCur: 500, expMax: 10000 },
    });
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    svc.startSolo("player1");

    // 1. Tick creating_room -> entering (tạo phòng)
    await (svc as any).tick();
    expect(svc.stateFor("player1").phase).toBe("entering");

    // 2. Tick entering (gửi warp_id đổi map 62001)
    await (svc as any).tick();
    // 3. Tick xác nhận map 62001 -> in_dungeon
    await (svc as any).tick();
    expect(svc.stateFor("player1").phase).toBe("in_dungeon");

    // Giả lập tăng EXP trong trận và hoàn thành ra khỏi map
    mockConn.setState({
      player: { name: "Hero", level: 50, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 15.5, expCur: 1500, expMax: 10000 },
      pet: { name: "QuanVu", level: 50, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 8.0, expCur: 800, expMax: 10000 },
      location: { map: 12001, x: 100, y: 100 }, // Ra ngoài map
      dungeonRoom: { status: "left" },
    });

    // Làm giả phaseAt để vượt qua điều kiện > 5000ms
    (svc as any).runtime("player1").phaseAt = Date.now() - 6000;

    await (svc as any).tick();

    const st = svc.stateFor("player1");
    expect(st.phase).toBe("done");
    expect(st.results).toHaveLength(1);
    expect(st.results![0]!.playerExpGained).toBe(500);
    expect(st.results![0]!.petExpGained).toBe(300);

    // Kiểm tra log game chứa thông tin EXP
    const expLogs = mockConn.logs.filter((l) => l.includes("EXP"));
    expect(expLogs.length).toBeGreaterThan(0);
    expect(expLogs.some((l) => l.includes("+500 EXP") && l.includes("+300 EXP"))).toBe(true);
  });

  it("chuỗi 3 phó bản: sau khi xong pb 1 vẫn ở map 62001 thì thoát map về 12001 và chạy tiếp pb 2", async () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: false, type: "all" });

    const mockConn = makeMockConn({
      location: { map: 12001, x: 100, y: 100 },
      player: { name: "Hero", level: 100, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 10, expCur: 1000, expMax: 10000 },
      pet: { name: "QuanVu", level: 100, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 10, expCur: 1000, expMax: 10000 },
    });
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    svc.startSolo("player1");

    // PB1: Khởi tạo tạo phòng Khiêu chiến Ba Đậu Yêu
    await (svc as any).tick(); // creating_room -> entering
    await (svc as any).tick(); // entering -> dispatch warp_id 2
    mockConn.setState({ location: { map: 62001, x: 100, y: 100 } });
    await (svc as any).tick(); // entering -> in_dungeon
    expect(svc.stateFor("player1").phase).toBe("in_dungeon");
    expect(svc.stateFor("player1").currentType).toBe("khieu_chien");

    // Xong PB1: Trận kết thúc, server báo phòng completed, NHƯNG nhân vật VẪN Ở MAP 62001
    mockConn.setState({
      dungeonRoom: { status: "completed" },
      inBattle: false,
    });
    (svc as any).runtime("player1").phaseAt = Date.now() - 6000;

    // Tick xử lý hoàn thành PB1
    await (svc as any).tick();

    // Hệ thống phải chuyển sang phó bản 2 (san_kho_bau) ở phase warping và gửi dungeon_exit
    const stWarp = svc.stateFor("player1");
    expect(stWarp.phase).toBe("warping");
    expect(stWarp.currentType).toBe("san_kho_bau");
    expect(mockConn.dispatches.some((d) => d.action === "dungeon_exit")).toBe(true);

    // Khi nhân vật còn ở 62001 (server chưa kịp đổi map), tick không được finishAll mà tiếp tục chờ về 12001
    mockConn.setState({ location: { map: 62001, x: 100, y: 100 } });
    await (svc as any).tick();
    expect(svc.stateFor("player1").phase).toBe("warping");
    expect(svc.stateFor("player1").currentType).toBe("san_kho_bau");

    // Nhân vật về lại Trác Quận 12001
    mockConn.setState({ location: { map: 12001, x: 100, y: 100 } });
    await (svc as any).tick(); // warping -> creating_room
    expect(svc.stateFor("player1").phase).toBe("creating_room");
    expect(svc.stateFor("player1").currentType).toBe("san_kho_bau");

    // Tạo phòng pb2 thành công
    await (svc as any).tick(); // creating_room -> entering
    expect(svc.stateFor("player1").phase).toBe("entering");

    // Vào map 62004 của pb 2 (Săn kho báu)
    await (svc as any).tick(); // entering -> dispatch warp_id 1
    mockConn.setState({ location: { map: 62004, x: 100, y: 100 }, dungeonRoom: { status: "open" } });
    await (svc as any).tick(); // entering -> in_dungeon
    expect(svc.stateFor("player1").phase).toBe("in_dungeon");
    expect(svc.stateFor("player1").currentType).toBe("san_kho_bau");

    // Tick tiếp theo chạy script nhặt rương — có warp_id 1 để kích hoạt đối thoại mở màn và làm xuất hiện rương
    await (svc as any).tick();
    const pb2Script = mockConn.scripts.find((s) => s.name === "phoban-don-7");
    expect(pb2Script).toBeDefined();
    expect(pb2Script!.script.includes("warp_id 1")).toBe(true);
    expect(pb2Script!.script.includes("click 1")).toBe(true);
    expect(pb2Script!.script.includes("click 3")).toBe(true);
    expect(pb2Script!.script.includes("click 5")).toBe(true);

    // Giả lập script mở đủ 3 rương hoàn tất
    (mockConn as any).info = () => ({ script: { state: "completed" } });
    await (svc as any).tick(); // in_dungeon -> gửi dungeon_exit

    // Nhân vật được server đưa về Trác Quận 12001 và nhận EXP
    mockConn.setState({
      player: { name: "Hero", level: 100, hp: { cur: 100, max: 100 }, sp: { cur: 100, max: 100 }, exp: 12, expCur: 1200, expMax: 10000 },
      location: { map: 12001, x: 100, y: 100 },
      dungeonRoom: { status: "left" },
    });
    (svc as any).runtime("player1").phaseAt = Date.now() - 6000;
    await (svc as any).tick(); // in_dungeon hoàn tất pb2 -> nextInQueue sang tim_dau_dau

    const stPb3 = svc.stateFor("player1");
    expect(stPb3.currentType).toBe("tim_dau_dau");
    expect(stPb3.results).toHaveLength(2);
    expect(stPb3.results![1]!.name).toContain("Tìm bảo rương");

    // Tiếp tục tạo phòng pb3 (Tìm Ba Đậu Yêu)
    await (svc as any).tick(); // warping -> creating_room
    expect(svc.stateFor("player1").phase).toBe("creating_room");
    await (svc as any).tick(); // creating_room -> entering
    expect(svc.stateFor("player1").phase).toBe("entering");

    // Vào map 62008 của pb 3
    mockConn.setState({ location: { map: 62008, x: 100, y: 100 }, dungeonRoom: { status: "open" } });
    await (svc as any).tick();
    await (svc as any).tick();
    expect(svc.stateFor("player1").phase).toBe("in_dungeon");
    expect(svc.stateFor("player1").currentType).toBe("tim_dau_dau");

    // Chạy script pb 3 — kiểm tra các lệnh click chuẩn pcap
    (mockConn as any).info = () => ({ script: { state: "idle" } });
    await (svc as any).tick();
    const pb3Script = mockConn.scripts.find((s) => s.name === "phoban-don-11");
    expect(pb3Script).toBeDefined();
    expect(pb3Script!.script.includes("warp_id 1")).toBe(true);
    expect(pb3Script!.script.includes("click 2")).toBe(true);
    expect(pb3Script!.script.includes("click 3")).toBe(true);
    expect(pb3Script!.script.includes("click 4")).toBe(true);
  });

  it("chuỗi 3 phó bản: nếu phó bản 1 đã hoàn thành rồi (server từ chối mã 4) thì skip và log đúng câu, tiếp tục chạy phó bản 2", async () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: false, type: "all", attempts: 1, autoBuyAttempts: false });

    const mockConn = makeMockConn(
      { location: { map: 12001, x: 100, y: 100 }, player: { name: "Hero", level: 100 } as any },
      (action, params) => {
        // Giả lập phó bản 1 (id 3: Khiêu chiến Ba Đậu Yêu 81-150) đã hoàn thành hôm nay
        if (action === "dungeon_room_create" && params?.dungeon === 3) {
          return {
            ok: false,
            code: 4,
            message: "Ní đã hoàn thành phó bản [Khiêu chiến Ba Đậu Yêu] này rồi, mua thêm lượt hoặc chờ ngày mai nha ní ơi!!!",
          };
        }
        return undefined;
      }
    );
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    svc.startSolo("player1");

    // Tick 1: creating_room pb 1 (khiêu chiến) -> bị từ chối do hết lượt -> skip và sang warping pb 2 (san_kho_bau)
    await (svc as any).tick();

    // Kiểm tra log có thông báo chính xác
    expect(
      mockConn.logs.some((l) =>
        l.includes("Ní đã hoàn thành phó bản [Khiêu chiến Ba Đậu Yêu] này rồi, mua thêm lượt hoặc chờ ngày mai nha ní ơi!!!")
      )
    ).toBe(true);

    // Trạng thái đã chuyển sang phó bản tiếp theo (san_kho_bau)
    const stNext = svc.stateFor("player1");
    expect(stNext.currentType).toBe("san_kho_bau");

    // Tick tiếp theo (vì đang ở 12001): warping -> creating_room cho san_kho_bau
    await (svc as any).tick();
    expect(svc.stateFor("player1").phase).toBe("creating_room");
    expect(svc.stateFor("player1").currentType).toBe("san_kho_bau");

    // Tick tiếp theo: tạo phòng san_kho_bau (id 7) thành công -> entering
    await (svc as any).tick();
    expect(svc.stateFor("player1").phase).toBe("entering");
  });

  it("hỗ trợ chạy 2 lượt phó bản đơn khi attempts = 2 và tự mua lượt khi bật autoBuyAttempts", async () => {
    const store = new DungeonSoloConfigStore();
    store.set("player1", { enabled: false, type: "all", attempts: 2, autoBuyAttempts: true });

    const boughtIds: number[] = [];
    const mockConn = makeMockConn(
      { location: { map: 12001, x: 100, y: 100 }, player: { name: "Hero", level: 160 } as any },
      (action, params) => {
        if (action === "dungeon_buy") {
          boughtIds.push(Number(params?.dungeon));
          return { ok: true };
        }
        return undefined;
      }
    );
    const host: DungeonSoloHost = {
      entries: () => [["player1", mockConn as any]],
      pushCharacter: () => {},
    };

    const svc = new DungeonSoloService(host, store);
    svc.startSolo("player1");

    const st = svc.stateFor("player1");
    expect(st.currentRound).toBe(1);
    expect(st.totalRounds).toBe(2);

    // Mua lượt trực tiếp qua buySolo không truyền id: tự động mua cả 3 phó bản cấp 160 (id 4, 8, 12)
    const buyRes = await svc.buySolo("player1");
    expect(buyRes.ok).toBe(true);
    expect(boughtIds).toEqual([4, 8, 12]);
  });
});
