import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CharacterState, PartyState } from "@tsbot/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeConn {
  isOffline = false;
  password = "";
  calls: { action: string; params?: Record<string, string | number> }[] = [];
  logs: string[] = [];
  results: Record<string, { ok: boolean; message?: string }> = {};
  constructor(public name: string, public map: number, public party: PartyState = { members: [], inviteStatus: "" }, public inBattle = false) {}
  character() { return { player: { name: this.name }, location: { map: this.map }, party: this.party, inBattle: this.inBattle, dungeonRoom: this.room ?? (this.password ? { status: "open", password: this.password } : undefined) } as unknown as CharacterState; }
  onWarp?: (mapId: number) => void;
  scripts: { id: string; src: string }[] = [];
  scriptState = "idle";
  stopped = 0;
  stopScript() { this.stopped++; this.scriptState = "idle"; }
  info() { return { state: this.isOffline ? "offline" : "online", script: { state: this.scriptState } }; }
  runScript(id: string, src: string) { this.scripts.push({ id, src }); this.scriptState = "running"; }
  room?: { status: string; ready?: boolean; password?: string };
  async dispatch(action: string, params?: Record<string, string | number>) {
    this.calls.push({ action, params });
    if (action === "teleport_gate") this.onWarp?.(Number(params?.mapId));
    if (action === "dungeon_room_join" && !this.results[action]) this.room = { status: "joined", ready: false };
    if (action === "dungeon_room_ready") this.room = { status: "joined", ready: true };
    return this.results[action] ?? { ok: true };
  }
  log(_l: string, m: string) { this.logs.push(m); }
}

describe("DungeonTeamConfigStore", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dt-cfg-")); process.env.DATA_DIR = dir; });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} delete process.env.DATA_DIR; });

  it("phân lập theo canonicalKey, chuẩn hoá giới hạn", async () => {
    const { DungeonTeamConfigStore } = await import("../src/services/store");
    const st = new DungeonTeamConfigStore();
    st.set("chu@server3", { enabled: true, members: ["A", " a ", "B", "C", "D", "E"], dungeonId: 999, usePassword: true });
    const c = st.get("CHU");
    expect(c.members).toEqual(["A", "B", "C", "D"]);
    expect(c.dungeonId).toBe(255);
    expect(c.usePassword).toBe(true);
    expect(st.get("khac").enabled).toBe(false);
  });
});

describe("DungeonTeamService — chủ phòng 3 nút", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dt-svc-")); process.env.DATA_DIR = dir; vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T00:00:00Z")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} delete process.env.DATA_DIR; vi.useRealTimers(); });

  async function setup(joinReady: boolean) {
    const { DungeonTeamConfigStore } = await import("../src/services/store");
    const { DungeonTeamService } = await import("../src/services/dungeonTeam");
    const store = new DungeonTeamConfigStore();
    // DATA_DIR được chốt ở lần import đầu ⇒ xoá dữ liệu còn sót từ test trước.
    (store as unknown as { f: { write(v: object): void } }).f.write({});
    const conns = new Map<string, FakeConn>();
    const svc = new DungeonTeamService({ entries: () => [...conns.entries()] as never, pushCharacter: () => {} }, store, joinReady);
    const tick = () => (svc as unknown as { tick(): Promise<void> }).tick();
    /** create()/startRoom() chạy một tick nền — chờ nó xong để các tick giả lập không bị bỏ qua. */
    const flush = () => vi.advanceTimersByTimeAsync(5);
    const step = async (ms = 2000, n = 1) => { for (let i = 0; i < n; i++) { vi.advanceTimersByTime(ms); await tick(); } };
    return { store, conns, svc, tick, step, flush };
  }
  const actions = (c: FakeConn) => c.calls.map((x) => x.action);

  it("chưa bấm Tạo ⇒ không làm gì", async () => {
    const { store, conns, svc, step, flush } = await setup(false);
    const leader = new FakeConn("Chu", 12001);
    conns.set("chu", leader);
    store.set("chu", { role: "leader", dungeonId: 1 });
    await step(2000, 3);
    expect(leader.calls).toEqual([]);
    expect(svc.stateFor("chu")).toBeUndefined();
  });

  it("Tạo khi đang ở map thường ⇒ warp về cổng thành tương đương, đang trong trận thì chờ, rồi tạo phòng KHÔNG mật khẩu", async () => {
    const { store, conns, svc, step, flush } = await setup(false);
    const { gateForMap } = await import("@tsbot/engine");
    const field = 12003; // map thường gần Trác Quận
    const gate = gateForMap(field)!;
    expect(gate).toBeTruthy();
    const leader = new FakeConn("Chu", field, undefined, true);
    leader.onWarp = (id) => { leader.map = id; };
    conns.set("chu@s3", leader);
    store.set("chu@s3", { role: "leader", dungeonId: 1, usePassword: false, leaveParty: true });
    expect(svc.create("chu@s3")).toEqual({ ok: true });
    await flush();

    await step(2000, 2);
    expect(svc.stateFor("chu@s3")).toMatchObject({ phase: "warping", gate: { id: gate.id } });
    expect(actions(leader)).not.toContain("teleport_gate"); // đang trong trận ⇒ chưa warp

    leader.inBattle = false;
    await step(2000, 1);
    expect(leader.calls.find((c) => c.action === "teleport_gate")?.params).toEqual({ mapId: gate.id });
    await step(9000, 3);
    expect(leader.calls.find((c) => c.action === "dungeon_room_create")?.params).toEqual({ dungeon: 1, password: 0 });
    expect(svc.stateFor("chu@s3")).toMatchObject({ phase: "room_open", canStart: true });
    // phòng mở KHÔNG tự bắt đầu
    await step(9000, 4);
    expect(actions(leader)).not.toContain("dungeon_room_start");
  });

  it("Bắt đầu ⇒ gửi 2f/0c, vào phó bản rồi ra ⇒ done và tự tắt; Hủy ⇒ gửi huỷ phòng", async () => {
    const { store, conns, svc, step, flush } = await setup(false);
    const leader = new FakeConn("Chu", 12001);
    leader.password = "4010";
    conns.set("chu", leader);
    store.set("chu", { role: "leader", dungeonId: 1, usePassword: true });
    svc.create("chu"); await flush();
    await step(2000, 3);
    expect(leader.calls.find((c) => c.action === "dungeon_room_create")?.params).toEqual({ dungeon: 1, password: 1 });
    expect(svc.stateFor("chu")).toMatchObject({ phase: "room_open", password: "4010" });

    expect(svc.startRoom("chu")).toEqual({ ok: true });
    await flush();
    await step(2000, 1);
    expect(actions(leader)).toContain("dungeon_room_start");
    leader.map = 62002; leader.inBattle = true;
    await step(2000, 1);
    expect(svc.stateFor("chu")?.phase).toBe("in_dungeon");
    leader.inBattle = false; leader.map = 12001;
    await step(6000, 1);
    expect(svc.stateFor("chu")).toMatchObject({ phase: "done" });
    expect(store.get("chu").enabled).toBe(false);

    // phiên mới rồi Hủy ⇒ dispatch huỷ phòng
    svc.create("chu"); await flush();
    await step(2000, 3);
    expect(svc.stateFor("chu")?.phase).toBe("room_open");
    await svc.cancel("chu");
    expect(actions(leader).filter((a) => a === "dungeon_room_cancel")).toHaveLength(1);
    expect(svc.stateFor("chu")).toBeUndefined();
    expect(store.get("chu").enabled).toBe(false);
  });

  it("Bắt đầu bị từ chối khi chưa có phòng; thành viên là bot trên web phải vào phòng + sẵn sàng thì mới Bắt đầu được", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001), mem = new FakeConn("Lien", 12001);
    conns.set("chu", leader); conns.set("lien", mem);
    expect(svc.startRoom("chu").ok).toBe(false);
    store.set("chu", { role: "leader", members: ["Lien"], dungeonId: 1 });
    store.set("lien", { role: "member", leaderName: "Chu", dungeonId: 1, enabled: true });
    svc.create("chu"); await flush();
    expect(svc.startRoom("chu").ok).toBe(false); // chưa có phòng
    await step(5000, 6); // chủ tạo phòng; member tìm đội → vào phòng → sẵn sàng
    expect(mem.calls.find((c) => c.action === "dungeon_room_join")?.params).toEqual({ leader: "Chu", dungeon: 1, password: "" });
    expect(actions(mem)).toContain("dungeon_room_ready");
    expect(svc.stateFor("lien")?.message).toContain("sẵn sàng");
    await step(2000, 2);
    expect(svc.stateFor("chu")?.canStart).toBe(true);
    expect(svc.startRoom("chu").ok).toBe(true);
  });

  it("ô tên thành viên TRỐNG ⇒ Bắt đầu ngay để đi solo (phó bản không quy định số thành viên)", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001);
    conns.set("chu", leader);
    store.set("chu", { role: "leader", members: [] });
    svc.create("chu"); await flush();
    await step(2000, 4);
    expect(svc.stateFor("chu")).toMatchObject({ phase: "room_open", canStart: true });
    expect(svc.stateFor("chu")?.message).toContain("solo");
    expect(svc.startRoom("chu").ok).toBe(true);
  });

  it("có tên thành viên NGOÀI web ⇒ chờ phòng đủ (1 + số tên) rồi mới bật Bắt đầu; làm mới danh sách phòng để đếm", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001);
    conns.set("chu", leader);
    store.set("chu", { role: "leader", members: ["NgoaiWeb1", "NgoaiWeb2"], dungeonId: 1 });
    svc.create("chu"); await flush();
    await step(2000, 4);
    expect(leader.calls.some((c) => c.action === "dungeon_room_list")).toBe(true);
    expect(svc.stateFor("chu")).toMatchObject({ phase: "room_open", canStart: false });
    expect(svc.startRoom("chu").ok).toBe(false);
    leader.room = { status: "open", rooms: [{ roomId: 10, leaderName: "Chu", dungeonId: 1, count: 2 }, { roomId: 9, leaderName: "Chu", dungeonId: 1, count: 4 }] } as never; // phòng MỚI NHẤT mới tính: còn thiếu 1
    await step(5000, 2);
    expect(svc.stateFor("chu")?.canStart).toBe(false);
    expect(svc.stateFor("chu")?.message).toContain("1/2");
    leader.room = { status: "open", rooms: [{ roomId: 10, leaderName: "Chu", dungeonId: 1, count: 3 }] } as never; // đủ chủ + 2 người
    await step(5000, 2);
    expect(svc.stateFor("chu")?.canStart).toBe(true);
    expect(svc.startRoom("chu").ok).toBe(true);
  });

  it("Tìm Đội (chủ phòng ngoài web): thử lại khi chưa thấy phòng, truyền đúng tên chủ + loại phó bản + mật khẩu, vào được thì tự sẵn sàng", async () => {
    const { store, conns, svc, step } = await setup(true);
    const mem = new FakeConn("Lien", 12001);
    mem.results.dungeon_room_join = { ok: false, message: 'Chưa thấy phòng của "ChuNgoai" (phó bản 1) — đang có 0 phòng' };
    conns.set("lien", mem);
    store.set("lien", { role: "member", leaderName: "ChuNgoai", dungeonId: 1, joinPassword: "4010", leaveParty: false, enabled: true });
    await step(2000, 1);
    expect(svc.stateFor("lien")).toMatchObject({ phase: "searching" });
    await step(5000, 3);
    expect(mem.calls.filter((c) => c.action === "dungeon_room_join").length).toBeGreaterThanOrEqual(3);
    expect(mem.calls[0]!.params).toEqual({ leader: "ChuNgoai", dungeon: 1, password: "4010" });
    expect(svc.stateFor("lien")?.message).toContain("tìm tiếp");
    delete mem.results.dungeon_room_join; // phòng xuất hiện
    await step(5000, 3);
    expect(actions(mem)).toContain("dungeon_room_ready");
    expect(svc.stateFor("lien")?.message).toContain("sẵn sàng");
  });

  it("Tìm Đội: tìm quá 180s không thấy ⇒ báo lỗi và tự tắt; rời đội trước nếu bật", async () => {
    const { store, conns, svc, step } = await setup(true);
    const inParty: PartyState = { joined: true, leaderName: "X", inviteStatus: "", members: [] };
    const mem = new FakeConn("Lien", 12001, inParty);
    mem.results.dungeon_room_join = { ok: false, message: "Chưa thấy phòng" };
    conns.set("lien", mem);
    store.set("lien", { role: "member", leaderName: "ChuNgoai", enabled: true, leaveParty: true });
    await step(2000, 2);
    expect(actions(mem)).toContain("leave_party");
    expect(actions(mem)).not.toContain("dungeon_room_join"); // còn trong đội ⇒ chưa tìm
    mem.party = { members: [], inviteStatus: "" };
    await step(20_000, 10);
    expect(svc.stateFor("lien")).toMatchObject({ phase: "error" });
    expect(store.get("lien").enabled).toBe(false);
  });

  /** Chủ + 1 thành viên bot đã vào phòng, bắt đầu, cả hai ở map phó bản và đội ngũ (0d/06) đủ người. */
  async function inDungeon() {
    const ctx = await setup(true);
    const { store, conns, svc, step, flush } = ctx;
    const leader = new FakeConn("Chu", 12001), mem = new FakeConn("Lien", 12001);
    conns.set("chu", leader); conns.set("lien", mem);
    store.set("chu", { role: "leader", members: ["Lien"], dungeonId: 1 });
    store.set("lien", { role: "member", leaderName: "Chu", dungeonId: 1, enabled: true });
    svc.create("chu"); await flush();
    await step(5000, 6);
    expect(svc.startRoom("chu").ok).toBe(true);
    await flush();
    const team = (): PartyState => ({ joined: true, leaderName: "Chu", inviteStatus: "", members: [{ slot: 1, name: "Chu", isLeader: true, isAdvisor: false }, { slot: 2, name: "Lien", isLeader: false, isAdvisor: false }] });
    leader.party = team(); mem.party = team();
    leader.map = 62002; mem.map = 62002;
    await step(2000, 4);
    return { ...ctx, leader, mem, team };
  }

  it("vào map phó bản ⇒ CHỈ chủ phòng chạy checkpoint (thành viên không chạy script; không chạy chồng); dừng giữa chừng ⇒ chạy lại checkpoint đó sau 15s", async () => {
    const { svc, step, leader, mem } = await inDungeon();
    expect(leader.scripts.map((x) => x.id)).toEqual(["phoban-doi-1-1"]);
    expect(mem.scripts).toHaveLength(0);
    expect(svc.stateFor("lien")?.phase).toBe("in_dungeon");
    expect(leader.scripts[0]!.src).toContain("warp_id 1,62002,50,780");
    expect(leader.scripts[0]!.src).not.toContain("warp_id 2"); // mỗi checkpoint một script
    await step(2000, 3);
    expect(leader.scripts).toHaveLength(1); // đang chạy ⇒ không chạy chồng
    leader.scriptState = "idle"; // script dừng giữa chừng, vẫn ở map phó bản
    await step(16_000, 1);
    expect(leader.scripts.map((x) => x.id)).toEqual(["phoban-doi-1-1", "phoban-doi-1-1"]);
  });

  it("lần lượt cổng 1 → 2 → 3 → Trương Giác (click_boss); thành viên KHÔNG chạy script; checkpoint lỗi ⇒ dừng, không chạy lại", async () => {
    const { step, leader, mem } = await inDungeon();
    for (const n of [2, 3]) {
      leader.scriptState = "completed";
      await step(4000, 3);
      expect(leader.scripts[leader.scripts.length - 1]!.id).toBe(`phoban-doi-1-${n}`);
      expect(leader.scripts[leader.scripts.length - 1]!.src).toContain(`warp_id ${n},62002`);
    }
    leader.scriptState = "completed";
    await step(4000, 3);
    expect(leader.scripts.map((x) => x.id)).toEqual(["phoban-doi-1-1", "phoban-doi-1-2", "phoban-doi-1-3", "phoban-doi-1-4"]);
    expect(leader.scripts[3]!.src).toContain("click_boss 20,62002,650,390");
    expect(mem.scripts).toHaveLength(0);
    leader.scriptState = "error";
    await step(16_000, 3);
    expect(leader.scripts).toHaveLength(4);
    expect(leader.logs.some((l) => l.includes('Checkpoint "Trương Giác" dừng vì lỗi'))).toBe(true);
  });

  it("xong checkpoint cuối: server tự đưa team ra thì bot không làm gì; 30s sau vẫn ở phó bản ⇒ rời đội dự phòng đúng 1 lần", async () => {
    const { step, leader } = await inDungeon();
    for (let i = 0; i < 4; i++) { leader.scriptState = "completed"; await step(4000, 3); }
    expect(leader.scripts).toHaveLength(4);
    await step(5000, 4); // 20s
    expect(leader.calls.some((c) => c.action === "dungeon_exit")).toBe(false);
    await step(5000, 4); // > 30s
    expect(leader.calls.filter((c) => c.action === "dungeon_exit")).toHaveLength(1);
    await step(5000, 6);
    expect(leader.calls.filter((c) => c.action === "dungeon_exit")).toHaveLength(1);
  });

  it("thành viên mất kết nối (bot offline) giữa các checkpoint ⇒ chủ DỪNG, không xử lý checkpoint kế; nối lại và vào đội đủ ⇒ đi tiếp", async () => {
    const { svc, step, leader, mem, team } = await inDungeon();
    leader.scriptState = "completed"; // xong cổng 1
    mem.isOffline = true; // thành viên disconnect
    await step(4000, 4);
    expect(leader.scripts.map((x) => x.id)).toEqual(["phoban-doi-1-1"]); // KHÔNG chạy cổng 2
    expect(svc.stateFor("chu")?.message).toContain("mất kết nối");
    expect(svc.stateFor("chu")?.message).toContain("Lien");
    mem.isOffline = false; // nối lại + vào đội lại
    leader.party = team();
    await step(4000, 4);
    expect(leader.scripts.map((x) => x.id)).toEqual(["phoban-doi-1-1", "phoban-doi-1-2"]);
  });

  it("thành viên rời khỏi danh sách đội (đội ngũ tab thông tin chung) ⇒ chủ dừng; đang đi bộ giữa hai trận ⇒ dừng script đang chạy, nhưng KHÔNG dừng khi đang trong trận", async () => {
    const { step, leader } = await inDungeon();
    expect(leader.scriptState).toBe("running");
    leader.inBattle = true;
    leader.party = { joined: true, leaderName: "Chu", inviteStatus: "", members: [{ slot: 1, name: "Chu", isLeader: true, isAdvisor: false }] }; // Lien rời đội
    await step(3000, 2);
    expect(leader.stopped).toBe(0); // đang trong trận: không đụng vào script
    leader.inBattle = false;
    await step(3000, 2);
    expect(leader.stopped).toBe(1); // hết trận ⇒ dừng, không xử lý checkpoint tiếp
    expect(leader.scripts).toHaveLength(1);
  });

  it("lộ trình kết thúc LỖI (vd lệnh không hỗ trợ) ⇒ không chạy lại, báo rõ", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001);
    conns.set("chu", leader);
    store.set("chu", { role: "leader", dungeonId: 1 });
    svc.create("chu"); await flush();
    await step(2000, 3);
    expect(svc.startRoom("chu").ok).toBe(true);
    await flush();
    leader.map = 62002;
    await step(2000, 2);
    expect(leader.scripts).toHaveLength(1);
    leader.scriptState = "error";
    await step(16_000, 3);
    expect(leader.scripts).toHaveLength(1);
    expect(leader.logs.some((l) => l.includes("dừng vì lỗi"))).toBe(true);
  });

  it("Thoát phó bản: dừng script + gửi dungeon_exit + kết thúc phiên (chủ phòng và thành viên)", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001);
    conns.set("chu", leader);
    store.set("chu", { role: "leader", dungeonId: 1 });
    svc.create("chu"); await flush();
    await step(2000, 3);
    expect(svc.startRoom("chu").ok).toBe(true);
    await flush();
    leader.map = 62002;
    await step(2000, 2);
    expect(leader.scriptState).toBe("running");
    expect(await svc.exitDungeon("chu")).toEqual({ ok: true });
    expect(leader.stopped).toBe(1);
    expect(actions(leader)).toContain("dungeon_exit");
    expect(svc.stateFor("chu")).toBeUndefined();
    expect(store.get("chu").enabled).toBe(false);
    // tài khoản offline ⇒ báo lỗi, không ném
    leader.isOffline = true;
    expect((await svc.exitDungeon("chu")).ok).toBe(false);
  });

  it("hết lượt phó bản trong ngày (create trả thông báo mã 4) ⇒ KHÔNG thử lại, dừng ngay với đúng câu thân thiện", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001);
    const msg = "Phó bản đội [Thảo phạt khăn vàng] Ní đã hoàn tất hôm nay rồi, mai quay lại nha Ní ơi.";
    leader.results.dungeon_room_create = { ok: false, message: msg };
    conns.set("chu", leader);
    store.set("chu", { role: "leader", dungeonId: 1 });
    svc.create("chu"); await flush();
    await step(9000, 6);
    expect(leader.calls.filter((c) => c.action === "dungeon_room_create")).toHaveLength(1);
    expect(svc.stateFor("chu")).toMatchObject({ phase: "error", message: msg });
    expect(store.get("chu").enabled).toBe(false);
  });

  it("tạo phòng thất bại 3 lần ⇒ dừng (không spam server)", async () => {
    const { store, conns, svc, step, flush } = await setup(true);
    const leader = new FakeConn("Chu", 12001);
    leader.results.dungeon_room_create = { ok: false, message: "từ chối" };
    conns.set("chu", leader);
    store.set("chu", { role: "leader" });
    svc.create("chu"); await flush();
    await step(9000, 8);
    expect(leader.calls.filter((c) => c.action === "dungeon_room_create")).toHaveLength(3);
    expect(svc.stateFor("chu")).toMatchObject({ phase: "error" });
    expect(store.get("chu").enabled).toBe(false);
  });
});
