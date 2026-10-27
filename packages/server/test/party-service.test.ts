import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CharacterState, PartyState } from "@tsbot/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** GameConnection giả: chỉ đủ phương thức mà PartyService dùng. */
class FakeConn {
  isOffline = false;
  partyGate?: (reason: string, signal: AbortSignal) => Promise<{ ok: boolean; message?: string }>;
  calls: { action: string; params?: Record<string, string> }[] = [];
  logs: string[] = [];
  /** Kết quả dispatch theo tên action (mặc định ok). */
  results: Record<string, { ok: boolean; message?: string }> = {};
  /** Nếu đặt: hàm quyết định kết quả (thấy params.force…). Ưu tiên hơn `results`. */
  respond?: (action: string, params?: Record<string, string>) => { ok: boolean; message?: string } | undefined;
  connectedAt = 1000;
  constructor(public name: string, public map: number, public party: PartyState = { members: [], inviteStatus: "" }, public inBattle = false) {}
  character() {
    return { player: { name: this.name }, location: { map: this.map }, party: this.party, inBattle: this.inBattle } as unknown as CharacterState;
  }
  info() {
    return { connectedAt: this.connectedAt } as unknown as import("@tsbot/protocol").ConnectionInfo;
  }
  async dispatch(action: string, params?: Record<string, string>) {
    this.calls.push({ action, params });
    return this.respond?.(action, params) ?? this.results[action] ?? { ok: true };
  }
  log(_l: string, m: string) { this.logs.push(m); }
}

const inParty = (leader: string, others: string[], advisor = ""): PartyState => ({
  joined: true, leaderName: leader, inviteStatus: "",
  members: [leader, ...others].map((n, i) => ({ slot: i + 1, name: n, isLeader: i === 0, isAdvisor: n === advisor })),
});

describe("PartyConfigStore", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "party-cfg-")); process.env.DATA_DIR = dir; });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} delete process.env.DATA_DIR; });

  it("phân lập theo canonicalKey, giới hạn 4 thành viên, bỏ trùng tên, tối đa 1 QSư", async () => {
    const { PartyConfigStore } = await import("../src/services/store");
    const st = new PartyConfigStore();
    st.set("chu1@server3", { enabled: true, role: "leader", members: [
      { name: "A", advisor: true }, { name: " a ", advisor: false }, { name: "B", advisor: true }, { name: "C", advisor: false },
      { name: "D", advisor: false }, { name: "E", advisor: false },
    ] });
    const c = st.get("CHU1");
    expect(c.members.map((m) => m.name)).toEqual(["A", "B", "C", "D"]);
    expect(c.members.filter((m) => m.advisor)).toHaveLength(1);
    expect(c.members[0]!.advisor).toBe(true);
    // tài khoản khác không thấy / không ghi đè
    expect(st.get("chu2").members).toEqual([]);
    expect(st.get("chu2").escapeIfNotFullParty).toBe(false);
    st.set("chu2", { role: "member", leaderName: "  Chu  ", escapeIfNotFullParty: true });
    expect(st.get("chu2").leaderName).toBe("Chu");
    expect(st.get("chu2").escapeIfNotFullParty).toBe(true);
    expect(st.get("chu1").role).toBe("leader");
  });
});

describe("PartyService", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "party-svc-")); process.env.DATA_DIR = dir; });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} delete process.env.DATA_DIR; vi.useRealTimers(); });

  async function setup() {
    const { PartyConfigStore } = await import("../src/services/store");
    const { PartyService } = await import("../src/services/party");
    const store = new PartyConfigStore();
    const conns = new Map<string, FakeConn>();
    const pushed: string[] = [];
    const svc = new PartyService({ entries: () => [...conns.entries()] as never, pushCharacter: (id) => pushed.push(id) }, store);
    const tick = () => (svc as unknown as { tick(): Promise<void> }).tick();
    return { store, conns, svc, tick, pushed };
  }

  it("chủ PT: mời người cùng map đúng 1 lần trong thời gian chờ; đẩy danh sách tự nhận lời xin xuống engine", async () => {
    const { store, conns, svc, tick } = await setup();
    const leader = new FakeConn("Chu", 12003);
    conns.set("chu@s3", leader);
    store.set("chu@s3", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    await tick();
    expect(leader.calls.filter((c) => c.action === "party_invite")).toHaveLength(1);
    expect(leader.calls.find((c) => c.action === "set_party_config")!.params).toEqual({
      inviteFrom: "",
      requestFromJson: JSON.stringify(["Lien"]),
      role: "leader",
      leaderName: "",
      membersJson: JSON.stringify(["Lien"]),
      escapeIfNotFullParty: "0",
    });
    expect(svc.planFor("chu@s3")!.entries[0]!.status).toBe("inviting");
    await tick(); // chưa hết cooldown ⇒ không mời lại
    expect(leader.calls.filter((c) => c.action === "party_invite")).toHaveLength(1);
    expect(leader.partyGate).toBeTypeOf("function");
  });

  it("sau teleport server không báo vị trí người từng cùng đội: 2 tài khoản cùng map theo bot ⇒ mời lại bằng force", async () => {
    const { store, conns, svc, tick } = await setup();
    const leader = new FakeConn("Chu", 12001);
    const lien = new FakeConn("Lien", 12001);
    leader.respond = (a, p) => (a === "party_invite" && !p?.force ? { ok: false, message: 'Không thấy "Lien" trong map 12001' } : undefined);
    conns.set("chu", leader); conns.set("lien", lien);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    await tick();
    const invites = leader.calls.filter((c) => c.action === "party_invite");
    expect(invites.map((c) => c.params?.force)).toEqual([undefined, "1"]);
    expect(svc.planFor("chu")!.entries[0]!.status).toBe("inviting");
  });

  it("cùng map theo bot nhưng không thấy trong map ⇒ gợi ý nghi KHÁC KÊNH (kênh đầy bị đẩy sang kênh khác)", async () => {
    const { store, conns, svc, tick } = await setup();
    const leader = new FakeConn("Chu", 12001);
    const lien = new FakeConn("Lien", 12001);
    leader.respond = (a) => (a === "party_invite" ? { ok: false, message: 'Không thấy "Lien" trong map 12001' } : undefined);
    conns.set("chu", leader); conns.set("lien", lien);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    await tick();
    const e = svc.planFor("chu")!.entries[0]!;
    expect(e.status).toBe("not_in_map");
    expect(e.detail).toMatch(/KÊNH/);
  });

  it("không force khi tài khoản kia ở map khác (theo bot)", async () => {
    const { store, conns, tick } = await setup();
    const leader = new FakeConn("Chu", 12001);
    const lien = new FakeConn("Lien", 12003);
    leader.respond = (a) => (a === "party_invite" ? { ok: false, message: 'Không thấy "Lien" trong map 12001' } : undefined);
    conns.set("chu", leader); conns.set("lien", lien);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    await tick();
    expect(leader.calls.filter((c) => c.action === "party_invite").map((c) => c.params?.force)).toEqual([undefined]);
  });

  it("thành viên cũng xin bằng force khi chủ PT cùng map theo bot", async () => {
    vi.useFakeTimers();
    const { store, conns, tick } = await setup();
    const leader = new FakeConn("Chu", 12001);
    const m = new FakeConn("Lien", 12001);
    m.respond = (a, p) => (a === "party_request" && !p?.force ? { ok: false, message: 'Không thấy "Chu" trong map 12001' } : undefined);
    conns.set("chu", leader); conns.set("lien", m);
    store.set("lien", { enabled: true, role: "member", leaderName: "Chu" });
    await tick(); // nhịp đầu: tạo runtime, còn chờ chủ PT mời trước
    vi.advanceTimersByTime(9000);
    await tick();
    expect(m.calls.filter((c) => c.action === "party_request").map((c) => c.params?.force)).toEqual([undefined, "1"]);
  });

  it("chủ PT: người chưa ở cùng map ⇒ tag not_in_map, KHÔNG gửi gói", async () => {
    const { store, conns, svc, tick } = await setup();
    const leader = new FakeConn("Chu", 12003);
    leader.results["party_invite"] = { ok: false, message: 'Không thấy "Lien" trong map 12003' };
    conns.set("chu", leader);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    await tick();
    expect(svc.planFor("chu")!.entries[0]!.status).toBe("not_in_map");
    expect(svc.planFor("chu")!.complete).toBe(false);
  });

  it("chủ PT: thành viên đã vào đội ⇒ tag in_party; tick QSư mà chưa có gói ⇒ advisor_pending + log 1 lần", async () => {
    const { store, conns, svc, tick } = await setup();
    const leader = new FakeConn("Chu", 12003, inParty("Chu", ["Lien", "Hai"]));
    leader.results["party_set_advisor"] = { ok: false, message: "Chưa có gói tin gán Quân sư" };
    conns.set("chu", leader);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: true }, { name: "Hai", advisor: false }] });
    await tick();
    const p = svc.planFor("chu")!;
    expect(p.entries.map((e) => e.status)).toEqual(["advisor_pending", "in_party"]);
    expect(p.complete).toBe(true);
    expect(leader.calls.some((c) => c.action === "party_invite")).toBe(false);
    expect(leader.logs.filter((l) => l.includes("Chưa gán được QSư"))).toHaveLength(1);
    leader.party = inParty("Chu", ["Lien", "Hai"], "Lien");
    await tick();
    expect(svc.planFor("chu")!.entries[0]!.status).toBe("advisor");
  });

  it("thành viên: tự nhận lời mời từ đúng chủ PT; xin vào đội khi chủ cùng map (sau thời gian chờ)", async () => {
    vi.useFakeTimers();
    const { store, conns, svc, tick } = await setup();
    const m = new FakeConn("Lien", 12003);
    conns.set("lien", m);
    store.set("lien", { enabled: true, role: "member", leaderName: "Chu" });
    await tick();
    expect(m.calls.find((c) => c.action === "set_party_config")!.params).toEqual({
      inviteFrom: "Chu",
      requestFromJson: "[]",
      role: "member",
      leaderName: "Chu",
      membersJson: "[]",
      escapeIfNotFullParty: "0",
    });
    expect(m.calls.some((c) => c.action === "party_request")).toBe(false); // còn chờ chủ PT mời trước
    expect(svc.planFor("lien")!.selfStatus).toBe("not_in_map");
    vi.advanceTimersByTime(9000);
    await tick();
    expect(m.calls.filter((c) => c.action === "party_request")).toHaveLength(1);
    expect(svc.planFor("lien")!.selfStatus).toBe("requesting");
    m.party = inParty("Chu", ["Lien"]);
    await tick();
    expect(svc.planFor("lien")!.selfStatus).toBe("in_party");
    expect(svc.planFor("lien")!.complete).toBe(true);
    void svc;
  });

  it("thành viên đang ở đội khác ⇒ status error, không xin", async () => {
    const { store, conns, svc, tick } = await setup();
    const m = new FakeConn("Lien", 12003, inParty("NguoiLa", ["Lien"]));
    conns.set("lien", m);
    store.set("lien", { enabled: true, role: "member", leaderName: "Chu" });
    await tick();
    expect(svc.planFor("lien")!.selfStatus).toBe("error");
    expect(m.calls.some((c) => c.action === "party_request")).toBe(false);
  });

  it("tắt lập đội ⇒ không mời/xin, gỡ hook gather", async () => {
    const { store, conns, svc, tick } = await setup();
    const leader = new FakeConn("Chu", 12003);
    conns.set("chu", leader);
    store.set("chu", { enabled: false, role: "leader", members: [{ name: "Lien", advisor: false }] });
    await tick();
    expect(leader.calls.some((c) => c.action === "party_invite")).toBe(false);
    expect(svc.planFor("chu")).toBeUndefined();
    expect(leader.partyGate).toBeUndefined();
  });

  it("mirrorWarp: thành viên đã vào đội chỉ teleport tới cổng thành của chủ PT (không chạy cả lộ trình); người chưa vào đội bị bỏ qua", async () => {
    const { store, conns, svc } = await setup();
    const leader = new FakeConn("Chu", 12003, inParty("Chu", ["Lien"]));
    const lien = new FakeConn("Lien", 12003);
    const hai = new FakeConn("Hai", 12003); // khai báo nhưng chưa vào đội
    conns.set("chu", leader); conns.set("lien", lien); conns.set("hai", hai);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }, { name: "Hai", advisor: false }] });
    svc.mirrorWarp("chu", "warp_to_spot", { mapId: 21261, x: 100, y: 200 }); // 12003 → 21261: teleport cổng 21001 rồi đi bộ qua 2 cổng
    await vi.waitFor(() => expect(lien.calls).toHaveLength(1));
    expect(lien.calls[0]).toEqual({ action: "teleport_gate", params: { mapId: "21001" } });
    expect(hai.calls).toHaveLength(0);
    svc.mirrorWarp("chu", "teleport_gate", { mapId: 12001 });
    await vi.waitFor(() => expect(lien.calls).toHaveLength(2));
    expect(lien.calls[1]).toEqual({ action: "teleport_gate", params: { mapId: "12001" } });
    svc.mirrorWarp("chu", "move", { x: 1 }); // không phải warp ⇒ không mirror
    expect(lien.calls).toHaveLength(2);
  });

  it("mirrorWarp: lộ trình không có teleport (đi bộ thuần) ⇒ không mirror", async () => {
    const { store, conns, svc } = await setup();
    const leader = new FakeConn("Chu", 21001, inParty("Chu", ["Lien"]));
    const lien = new FakeConn("Lien", 21001);
    conns.set("chu", leader); conns.set("lien", lien);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    svc.mirrorWarp("chu", "warp_map", { mapId: 21261 }); // 21001 → 21002 → 21261: chỉ qua cổng
    await new Promise((r) => setTimeout(r, 20));
    expect(lien.calls).toHaveLength(0);
    expect(leader.logs.some((l) => l.includes("không có đoạn teleport"))).toBe(true);
  });

  it("gather: chờ đủ thành viên cùng map rồi mới cho đi bộ; thiếu quá lâu ⇒ ok=false", async () => {
    vi.useFakeTimers();
    const { store, conns, svc } = await setup();
    const leader = new FakeConn("Chu", 21001, inParty("Chu", ["Lien"]));
    const lien = new FakeConn("Lien", 12003); // còn ở map cũ
    conns.set("chu", leader); conns.set("lien", lien);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    let done: { ok: boolean; message?: string } | undefined;
    void svc.gather("chu", "test", new AbortController().signal).then((r) => { done = r; });
    await vi.advanceTimersByTimeAsync(3500);
    expect(done).toBeUndefined(); // vẫn chờ
    expect(leader.logs.some((l) => l.includes("đang ở map 12003, cần 21001"))).toBe(true);
    lien.map = 21001; // thành viên tới nơi
    await vi.advanceTimersByTimeAsync(1500);
    expect(done).toEqual({ ok: true });

    // thiếu mãi ⇒ timeout
    lien.map = 12003;
    let fail: { ok: boolean; message?: string } | undefined;
    void svc.gather("chu", "test2", new AbortController().signal).then((r) => { fail = r; });
    await vi.advanceTimersByTimeAsync(151_000);
    expect(fail!.ok).toBe(false);
    expect(fail!.message).toMatch(/chưa đủ đội/);
  });

  it("gather: thành viên offline hoặc đang trong trận cũng coi là chưa đủ", async () => {
    vi.useFakeTimers();
    const { store, conns, svc } = await setup();
    const leader = new FakeConn("Chu", 21001, inParty("Chu", ["Lien"]));
    const lien = new FakeConn("Lien", 21001, { members: [], inviteStatus: "" }, true);
    conns.set("chu", leader); conns.set("lien", lien);
    store.set("chu", { enabled: true, role: "leader", members: [{ name: "Lien", advisor: false }] });
    let done: { ok: boolean } | undefined;
    void svc.gather("chu", "t", new AbortController().signal).then((r) => { done = r; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(done).toBeUndefined();
    expect(leader.logs.some((l) => l.includes("đang trong trận"))).toBe(true);
    lien.inBattle = false;
    await vi.advanceTimersByTimeAsync(1500);
    expect(done).toEqual({ ok: true });
  });

  it("gather không áp dụng khi không phải chủ PT đang bật (ok ngay)", async () => {
    const { store, conns, svc } = await setup();
    conns.set("chu", new FakeConn("Chu", 12003));
    store.set("chu", { enabled: false, role: "leader", members: [{ name: "Lien", advisor: false }] });
    expect(await svc.gather("chu", "x", new AbortController().signal)).toEqual({ ok: true });
  });

  it("reconnect: PartyService tự động phát hiện connectedAt thay đổi và đẩy lại set_party_config (escapeIfNotFullParty)", async () => {
    const { store, conns, svc, tick } = await setup();
    const conn = new FakeConn("Teemo", 12003);
    conns.set("teemo", conn);
    store.set("teemo", { enabled: true, role: "member", leaderName: "ChuTeam", escapeIfNotFullParty: true });

    // Lần 1: đẩy set_party_config
    await tick();
    const calls1 = conn.calls.filter((c) => c.action === "set_party_config");
    expect(calls1).toHaveLength(1);
    expect(calls1[0]!.params!.escapeIfNotFullParty).toBe("1");

    // Lần 2 (chưa reconnect): hash không đổi => không đẩy lại
    await tick();
    expect(conn.calls.filter((c) => c.action === "set_party_config")).toHaveLength(1);

    // Mô phỏng reconnect: connectedAt thay đổi timestamp mới
    conn.connectedAt = 5000;
    await tick();
    const calls3 = conn.calls.filter((c) => c.action === "set_party_config");
    expect(calls3).toHaveLength(2);
    expect(calls3[1]!.params!.escapeIfNotFullParty).toBe("1");
  });
});
