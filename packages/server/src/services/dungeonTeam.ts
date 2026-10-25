/**
 * DungeonTeamService — điều phối PHÓ BẢN ĐỘI giữa các tài khoản của web (tầng server, trên các GameConnection).
 * Tài liệu logic + giao thức: docs/DUNGEON_TEAM_KNOWLEDGE.md. Mô hình tham khảo: TSM + Pim-Bot (CreateRoomDungeon 2f/02, JoinDungeon 2f/03).
 *
 * CHỦ PHÒNG điều khiển bằng 3 nút (không tự chạy lặp):
 *   • TẠO  (create): warp về CỔNG THÀNH tương đương vị trí hiện tại (đứng chỗ an toàn, không bị trận đấu quấy nhiễu) → chờ thành viên cùng map
 *           → rời đội (nếu cấu hình) → tạo phòng (2f/02) ⇒ phase `room_open`. Phòng mở KHÔNG tự bắt đầu.
 *   • BẮT ĐẦU (start): chỉ khi `room_open` và đủ thành viên ⇒ gửi 2f/0c, chờ vào trận/đổi map ⇒ `in_dungeon` ⇒ ra khỏi phó bản ⇒ `done`.
 *   • Vào phó bản (đổi map) ⇒ CHỈ CHỦ PHÒNG chạy lộ trình của phó bản (DUNGEON_ROOM_CATALOG[].route, lấy từ script TSM: Thiên Sứ = warp_id ×3 chặng
 *           trong map 62002 rồi click NPC 20 + await_battle); script dừng giữa chừng ⇒ chạy lại tối đa 3 lần. Thành viên vẫn chung đội ⇒ tự theo chủ vào
 *           trận và cùng hoàn thành phó bản, KHÔNG chạy script nào.
 *   • HUỶ  (cancel): huỷ phòng (2f/0a) ở bất kỳ phase nào đang hoạt động, về `idle`.
 * THÀNH VIÊN (nút "Tìm Đội"): làm mới danh sách phòng (2f/01) theo chu kỳ, tìm ĐÚNG phòng có tên chủ + loại phó bản đã chọn (có thể có nhiều phòng
 *           cùng chờ) → vào phòng (2f/03) → tự bấm Sẵn sàng (2f/0b). Chủ phòng là bot trên web thì member còn tự về cùng cổng thành và rời đội.
 * Chủ phòng KHÔNG bị chặn bởi thành viên: thành viên (bot hoặc client thật) vào sau khi phòng mở; "Bắt đầu" chờ các thành viên là bot trên web đã sẵn sàng.
 */
import type { DungeonTeamConfig, DungeonTeamMemberState, DungeonTeamPhase, DungeonTeamState } from "@tsbot/protocol";
import { DUNGEON_ROOM_CATALOG } from "@tsbot/protocol";
import { DUNGEON_ROOM_JOIN_VERIFIED, gateForMap, type GameConnection } from "@tsbot/engine";
import type { DungeonTeamConfigStore } from "./store";

const TICK_MS = 2000;
/** Giãn cách tối thiểu giữa hai lần gửi cùng một action cho cùng một tài khoản. */
const ACTION_COOLDOWN_MS = 8000;
/** Chờ vào trận/đổi map sau khi bấm bắt đầu. */
const START_TIMEOUT_MS = 60_000;
/** Một phó bản tối đa (ra khỏi phó bản, về map cũ). */
const DUNGEON_TIMEOUT_MS = 30 * 60_000;
/** Warp/tạo phòng thất bại liên tiếp ngần này lần ⇒ dừng để không spam server. */
const MAX_FAILS = 3;

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();
const canon = (accountId: string) => {
  const raw = (accountId ?? "").trim();
  if (!raw) return "default";
  const at = raw.indexOf("@");
  return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
};

export interface DungeonTeamHost {
  entries(): [string, GameConnection][];
  pushCharacter(accountId: string): void;
}

interface Runtime {
  phase: DungeonTeamPhase;
  gate?: { id: number; city: string };
  phaseAt: number;
  fails: number;
  /** Thành viên (tên chuẩn hoá) đã vào phòng hiện tại. */
  joined: Set<string>;
  /** Member: thời điểm bắt đầu tìm đội; hubMap = map lúc vào phòng. */
  searchStart: number;
  hubMap: number;
  /** Lộ trình trong map phó bản: số lần đã chạy / lúc chạy gần nhất. */
  routeRuns: number;
  lastRouteAt: number;
  /** Checkpoint đang chạy (chỉ số trong DungeonRoomDef.steps; CHỈ chủ phòng — thành viên chỉ tham gia trận đấu). */
  stepIdx: number;
  /** Đội lúc bắt đầu checkpoint đầu tiên (tên thành viên, không gồm chủ) — để phát hiện có người mất kết nối. */
  teamNames?: string[];
  /** Thời điểm xử lý xong checkpoint cuối / đã gửi thoát dự phòng chưa. */
  finishedAt?: number;
  exitSent?: boolean;
  /** Số người trong phòng (từ danh sách phòng), cập nhật khi chủ phòng chờ đủ thành viên. */
  roomCount?: number;
  /** Phòng đã gửi tạo thành công (cần huỷ khi dừng). */
  roomCreated: boolean;
  password?: string;
  lastAction: Map<string, number>;
  lastLog: Map<string, string>;
  message: string;
  members: DungeonTeamMemberState[];
  canStart: boolean;
  state?: DungeonTeamState;
  stateJson?: string;
}

const isEnded = (r?: Runtime) => r?.phase === "done" || r?.phase === "error";
const ACTIVE_LEADER = new Set<DungeonTeamPhase>(["warping", "waiting_members", "leaving_party", "creating_room", "room_open", "starting", "in_dungeon", "blocked"]);
/** Thành viên tìm đội: giãn cách làm mới danh sách/thử vào phòng, và thời gian tìm tối đa. */
const SEARCH_POLL_MS = 4000;
const SEARCH_TIMEOUT_MS = 180_000;
/** Lộ trình trong phó bản: chạy lại tối đa ngần này lần (nếu script dừng giữa chừng mà vẫn ở map phó bản), cách nhau ít nhất ROUTE_RETRY_MS. */
const ROUTE_MAX_RUNS = 3;
const ROUTE_RETRY_MS = 15_000;

export class DungeonTeamService {
  private timer?: ReturnType<typeof setInterval>;
  private rt = new Map<string, Runtime>();
  private ticking = false;

  constructor(
    private host: DungeonTeamHost,
    private store: DungeonTeamConfigStore,
    private joinReady: boolean = DUNGEON_ROOM_JOIN_VERIFIED,
  ) {}

  start() { this.timer ??= setInterval(() => { void this.tick(); }, TICK_MS); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  /* ------------------------- lệnh từ UI ------------------------- */

  /** Nút "Tạo phó bản đội" (chủ phòng): bắt đầu phiên mới — warp cổng thành rồi tạo phòng. */
  create(accountId: string): { ok: boolean; message?: string } {
    const cfg = this.store.get(accountId);
    if (cfg.role !== "leader") return { ok: false, message: "Chỉ chủ phòng mới tạo phó bản đội" };
    const conn = this.conn(accountId);
    if (!conn || conn.isOffline || !conn.character()?.player.name) return { ok: false, message: "Tài khoản chưa online" };
    const cur = this.rt.get(canon(accountId));
    if (cur && ACTIVE_LEADER.has(cur.phase)) return { ok: false, message: "Đang có phiên phó bản đội — hãy Huỷ trước" };
    this.rt.delete(canon(accountId));
    this.store.set(accountId, { enabled: true });
    this.host.pushCharacter(accountId);
    void this.tick();
    return { ok: true };
  }

  /** Nút "Bắt đầu": chỉ khi phòng đã mở và đủ thành viên. */
  startRoom(accountId: string): { ok: boolean; message?: string } {
    const r = this.rt.get(canon(accountId));
    if (!r || r.phase !== "room_open") return { ok: false, message: "Chưa có phòng đang mở" };
    if (!r.canStart) return { ok: false, message: "Chưa đủ thành viên trong phòng" };
    r.lastAction.delete("dungeon_room_start");
    this.setPhase(r, "starting", "Bắt đầu phó bản…");
    void this.tick();
    return { ok: true };
  }

  /** Nút "Huỷ": huỷ phòng (nếu đã tạo) và kết thúc phiên. */
  async cancel(accountId: string): Promise<{ ok: boolean; message?: string }> {
    const k = canon(accountId);
    const r = this.rt.get(k);
    const conn = this.conn(accountId);
    if (r?.roomCreated && conn && !conn.isOffline) await conn.dispatch("dungeon_room_cancel", undefined, { quiet: true }).catch(() => undefined);
    this.rt.delete(k);
    this.store.set(accountId, { enabled: false });
    this.host.pushCharacter(accountId);
    return { ok: true };
  }

  /**
   * Nút "Thoát phó bản" (mọi tài khoản): dừng lộ trình đang chạy rồi RỜI ĐỘI (`0d/04 00 <uid mình>` — gói client thật dùng để rời phó bản đội,
   * pcap chupt_pbteam 81.9s ⇒ về map cũ) và kết thúc phiên của tài khoản này. Dùng khi lộ trình không đi tiếp được / bị kẹt.
   */
  async exitDungeon(accountId: string): Promise<{ ok: boolean; message?: string }> {
    const conn = this.conn(accountId);
    if (!conn || conn.isOffline) return { ok: false, message: "Tài khoản chưa online" };
    const k = canon(accountId);
    try { conn.stopScript(); } catch { /* không có script đang chạy */ }
    const r = await conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    this.rt.delete(k);
    this.store.set(accountId, { enabled: false });
    this.host.pushCharacter(accountId);
    conn.log(r.ok ? "info" : "warn", `🏰 [Phó bản đội] Thoát phó bản (rời đội)${r.ok ? "" : `: ${r.message ?? "thất bại"}`}`, "game");
    return r.ok ? { ok: true } : { ok: false, message: r.message ?? "Không rời được đội" };
  }

  /** User lưu cấu hình: thành viên bật/tắt sẵn sàng; chủ phòng chỉ đổi tuỳ chọn (không đụng phiên đang chạy). */
  refresh(accountId: string) {
    const cfg = this.store.get(accountId);
    if (cfg.role === "member") this.rt.delete(canon(accountId));
    this.host.pushCharacter(accountId);
    void this.tick();
  }

  stateFor(accountId: string): DungeonTeamState | undefined {
    return this.rt.get(canon(accountId))?.state;
  }

  /* ------------------------- tra cứu ------------------------- */

  private conn(accountId: string) {
    const k = canon(accountId);
    return this.host.entries().find(([id]) => canon(id) === k)?.[1];
  }
  private online() {
    const out: { id: string; conn: GameConnection; name: string }[] = [];
    for (const [id, conn] of this.host.entries()) {
      if (conn.isOffline) continue;
      const name = conn.character()?.player.name;
      if (name) out.push({ id, conn, name });
    }
    return out;
  }
  private byName(name: string) {
    const k = norm(name);
    return this.online().find((o) => norm(o.name) === k);
  }

  private note(conn: GameConnection, r: Runtime, key: string, level: "info" | "warn", msg: string) {
    if (r.lastLog.get(key) === msg) return;
    r.lastLog.set(key, msg);
    conn.log(level, `🏰 [Phó bản đội] ${msg}`, "game");
  }

  /** Gửi action có giãn cách; trả undefined nếu còn trong cooldown. */
  private async send(conn: GameConnection, r: Runtime, action: string, params?: Record<string, string | number>, cooldownMs = ACTION_COOLDOWN_MS) {
    const now = Date.now();
    if (now - (r.lastAction.get(action) ?? 0) < cooldownMs) return undefined;
    r.lastAction.set(action, now);
    try {
      return await conn.dispatch(action, params as never, { quiet: true });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  private runtime(k: string): Runtime {
    let r = this.rt.get(k);
    if (!r) {
      r = { phase: "idle", phaseAt: Date.now(), searchStart: 0, hubMap: 0, routeRuns: 0, lastRouteAt: 0, stepIdx: 0, fails: 0, joined: new Set(), roomCreated: false, lastAction: new Map(), lastLog: new Map(), message: "", members: [], canStart: false };
      this.rt.set(k, r);
    }
    return r;
  }

  private setPhase(r: Runtime, phase: DungeonTeamPhase, message: string) {
    if (r.phase !== phase) { r.phaseAt = Date.now(); r.fails = 0; if (phase === "in_dungeon") { r.routeRuns = 0; r.lastRouteAt = 0; r.stepIdx = 0; r.teamNames = undefined; r.finishedAt = undefined; r.exitSent = false; } }
    r.phase = phase;
    r.message = message;
  }

  /* ------------------------- vòng điều phối ------------------------- */

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const cfgs = this.store.all();
      const active: [string, GameConnection, DungeonTeamConfig][] = [];
      for (const [id, conn] of this.host.entries()) {
        const k = canon(id);
        const cfg = cfgs[k];
        if (cfg?.enabled) active.push([id, conn, cfg]);
        else if (isEnded(this.rt.get(k)) && cfg) this.publish(id, cfg);
        else if (this.rt.delete(k)) this.host.pushCharacter(id);
      }
      // Chủ phòng chạy trước để thành viên đọc được phase mới nhất trong cùng nhịp.
      active.sort((a, b) => (a[2].role === b[2].role ? 0 : a[2].role === "leader" ? -1 : 1));
      for (const [id, conn, cfg] of active) {
        if (conn.isOffline || !conn.character()?.player.name) continue;
        try {
          if (cfg.role === "leader") await this.tickLeader(id, conn, cfg);
          else await this.tickMember(id, conn, cfg);
        } catch (e) {
          conn.log("warn", `🏰 [Phó bản đội] lỗi điều phối: ${e instanceof Error ? e.message : e}`, "game");
        }
        this.publish(id, cfg);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async tickLeader(id: string, conn: GameConnection, cfg: DungeonTeamConfig) {
    const r = this.runtime(canon(id));
    const ch = conn.character()!;
    const now = Date.now();

    if (r.phase === "idle") {
      const g = gateForMap(ch.location.map);
      if (!g) { this.fail(id, r, `Không tìm được cổng thành tương đương map ${ch.location.map}`); return; }
      r.gate = { id: g.id, city: g.city };
      this.setPhase(r, "warping", `Về cổng thành ${g.city} để tạo phòng…`);
    }

    // Trạng thái từng thành viên (cùng map với chủ phòng).
    r.members = cfg.members.map((name): DungeonTeamMemberState => {
      const peer = this.byName(name);
      if (!peer) return { name, status: "offline", detail: "Tài khoản chưa online trên web" };
      if (r.joined.has(norm(name))) return { name, status: "in_room" };
      const map = peer.conn.character()?.location.map;
      if (map !== ch.location.map) return { name, status: "not_in_map", detail: `Đang ở map ${map}, chủ phòng ở map ${ch.location.map}` };
      return { name, status: "ready" };
    });

    switch (r.phase) {
      case "warping": {
        if (ch.inBattle) { r.message = "Đang trong trận đấu — chờ hết trận rồi về cổng thành…"; break; }
        if (ch.location.map === r.gate!.id) { this.setPhase(r, "waiting_members", "Đã ở cổng thành, đang kiểm tra thành viên…"); break; }
        const res = await this.send(conn, r, "teleport_gate", { mapId: r.gate!.id });
        if (res && !res.ok) {
          r.fails++;
          this.note(conn, r, "warp-fail", "warn", `Về cổng thành ${r.gate!.city} thất bại (${r.fails}/${MAX_FAILS}): ${res.message ?? "không rõ"}`);
          if (r.fails >= MAX_FAILS) this.fail(id, r, `Không về được cổng thành ${r.gate!.city}: ${res.message ?? "không rõ"}`);
        }
        break;
      }
      case "waiting_members":
        if (ch.location.map !== r.gate!.id && !ch.inBattle) { this.setPhase(r, "warping", `Về cổng thành ${r.gate!.city} để tạo phòng…`); break; }
        // Không chặn tạo phòng vì thành viên: họ (bot hoặc client thật) vào SAU khi phòng mở.
        if (cfg.leaveParty && ch.party.joined) this.setPhase(r, "leaving_party", "Rời đội trước khi tạo phòng…");
        else this.setPhase(r, "creating_room", "Đang tạo phòng…");
        break;
      case "blocked":
        this.setPhase(r, "waiting_members", "Đang kiểm tra thành viên…");
        break;
      case "leaving_party":
        if (!ch.party.joined) { this.setPhase(r, "creating_room", "Đang tạo phòng…"); break; }
        await this.send(conn, r, "leave_party");
        r.message = "Chờ rời đội (chủ phòng + thành viên)…";
        break;
      case "creating_room": {
        const res = await this.send(conn, r, "dungeon_room_create", { dungeon: cfg.dungeonId, password: cfg.usePassword ? 1 : 0 });
        if (!res) break;
        if (res.ok) {
          r.joined.clear();
          r.roomCreated = true;
          r.password = conn.character()?.dungeonRoom?.password;
          this.setPhase(r, "room_open", `Phòng đã mở${r.password ? ` (mật khẩu ${r.password})` : ""} — bấm "Bắt đầu" khi sẵn sàng`);
          break;
        }
        // Hết lượt trong ngày (mã 4): không thử lại, kết thúc phiên với thông báo thân thiện.
        if (/hoàn tất hôm nay/.test(res.message ?? "")) { this.fail(id, r, res.message!); break; }
        r.fails++;
        this.note(conn, r, "create-fail", "warn", `Tạo phòng thất bại (${r.fails}/${MAX_FAILS}): ${res.message ?? "không rõ"}`);
        r.message = `Tạo phòng thất bại: ${res.message ?? "không rõ"}`;
        if (r.fails >= MAX_FAILS) this.fail(id, r, `Tạo phòng thất bại ${MAX_FAILS} lần liên tiếp. ${res.message ?? ""}`.trim());
        break;
      }
      case "room_open": {
        // Có khai báo tên thành viên ⇒ làm mới danh sách phòng (2f/01) để biết số người đã vào (cả thành viên ngoài web); ô tên trống ⇒ không chờ ai.
        const named = cfg.members.filter((n) => n.trim()).length;
        if (named > 0) await this.send(conn, r, "dungeon_room_list", undefined, 4000);
        r.roomCount = this.ownRoomCount(conn, cfg);
        const missing = this.pendingBots(cfg, r);
        const pw = r.password ? ` (mật khẩu ${r.password})` : "";
        r.message = named === 0
          ? `Phòng đã mở${pw} — không khai báo thành viên, bấm "Bắt đầu" để đi solo`
          : this.membersOk(cfg, r)
            ? `Phòng đã mở${pw} — đủ ${named} thành viên, bấm "Bắt đầu"`
            : `Phòng đã mở${pw} — chờ đủ thành viên (${Math.max(0, (r.roomCount ?? 1) - 1)}/${named} trong phòng${missing.length ? `; chưa thấy ${missing.join(", ")}` : ""})`;
        break;
      }
      case "starting": {
        if (ch.inBattle || ch.location.map !== r.gate!.id) {
          this.setPhase(r, "in_dungeon", "Đang trong phó bản…");
          // Như client thật ~1s sau khi vào map phó bản (pcap phobandoi_02): `0c/01` để server gửi danh sách NPC + roster đội.
          setTimeout(() => { void conn.dispatch("sync_state", undefined, { quiet: true }).catch(() => undefined); }, 1000);
          break;
        }
        if (now - r.phaseAt > START_TIMEOUT_MS) { await this.cancelRoom(conn, r); this.fail(id, r, "Bấm bắt đầu nhưng không vào được phó bản (quá 60s) — đã huỷ phòng"); break; }
        const res = await this.send(conn, r, "dungeon_room_start");
        if (res && !res.ok) r.message = `Bắt đầu thất bại: ${res.message ?? "không rõ"}`;
        break;
      }
      case "in_dungeon": {
        this.runRoute(conn, r, cfg);
        // Xong phó bản: team được server tự warp về map mặc định (không nhất thiết là cổng thành) ⇒ rời map phó bản, hoặc 2f/0a st=03.
        const dm = DUNGEON_ROOM_CATALOG.find((d) => d.id === cfg.dungeonId)?.map;
        const back = !ch.inBattle && (dm ? ch.location.map !== dm : ch.location.map === r.gate!.id) || (!ch.inBattle && ch.dungeonRoom?.status === "left");
        if (back && now - r.phaseAt > 5000) {
          r.roomCreated = false;
          this.setPhase(r, "done", "Đã xong phó bản");
          this.store.set(id, { enabled: false });
        } else if (now - r.phaseAt > DUNGEON_TIMEOUT_MS) this.fail(id, r, "Phó bản chạy quá 30 phút chưa ra");
        break;
      }
    }
    r.canStart = r.phase === "room_open" && this.membersOk(cfg, r);
  }

  /** Số người trong phòng của chính chủ phòng (byte cuối bản ghi danh sách phòng 2f/01; 1 = chỉ chủ). Lấy phòng MỚI NHẤT cùng tên chủ + loại phó bản. */
  private ownRoomCount(conn: GameConnection, cfg: DungeonTeamConfig): number | undefined {
    const ch = conn.character();
    const mine = (ch?.dungeonRoom?.rooms ?? []).filter((x) => norm(x.leaderName) === norm(ch?.player.name ?? "") && x.dungeonId === cfg.dungeonId).sort((a, b) => b.roomId - a.roomId)[0];
    return mine?.count;
  }

  /**
   * Được bấm "Bắt đầu" khi: KHÔNG khai báo tên thành viên nào (đi solo / phó bản không quy định số người), hoặc mọi tên đã khai báo đã vào phòng —
   * thành viên là bot trên web: đã join+sẵn sàng; có thành viên ngoài web: phòng phải đủ 1 + số tên khai báo người (đọc từ danh sách phòng).
   */
  private membersOk(cfg: DungeonTeamConfig, r: Runtime): boolean {
    const names = cfg.members.filter((n) => n.trim());
    if (names.length === 0) return true;
    if (this.pendingBots(cfg, r).length > 0) return false;
    const external = names.some((n) => !this.byName(n));
    return external ? (r.roomCount ?? 0) >= 1 + names.length : true;
  }

  /** Thành viên là bot ĐANG online trên web nhưng chưa vào phòng/sẵn sàng. */
  private pendingBots(cfg: DungeonTeamConfig, r: Runtime): string[] {
    return cfg.members.filter((n) => this.byName(n) && !r.joined.has(norm(n)));
  }

  /** Thành viên (ngoài chủ) mà đội đang thiếu: không còn trong danh sách đội của chủ (đồng bộ với tab thông tin chung) hoặc tài khoản bot đã mất kết nối. */
  private teamMissing(conn: GameConnection, r: Runtime): string[] {
    const ch = conn.character();
    const roster = (ch?.party.members ?? []).map((m) => norm(m.name)).filter(Boolean);
    return (r.teamNames ?? []).filter((n) => {
      const bot = this.host.entries().find(([, c]) => norm(c.character()?.player.name ?? "") === norm(n))?.[1];
      if (bot && bot.info().state !== "online") return true; // mất kết nối / đang nối lại
      // Tên trong đội chưa phân giải được (spawn chưa tới) mà đội vẫn đủ người ⇒ không coi là thiếu.
      if ((ch?.party.members.length ?? 0) >= 1 + (r.teamNames?.length ?? 0)) return false;
      return !roster.includes(norm(n));
    });
  }

  /**
   * Đã ở map phó bản ⇒ CHỈ CHỦ PHÒNG chạy lần lượt các checkpoint (DungeonRoomDef.steps — script TSM tách từng cổng + Trương Giác); thành viên KHÔNG chạy script nào
   * (không di chuyển, không nói chuyện NPC; chỉ đánh trận). Đội trong phó bản chính là đội ngũ ở tab thông tin chung: TRƯỚC mỗi checkpoint (và khi đang đi giữa hai trận)
   * kiểm tra còn đủ thành viên — có người mất kết nối ⇒ DỪNG (dừng script đang đi bộ, không xử lý checkpoint kế tiếp) cho tới khi đủ lại hoặc bấm "Thoát phó bản".
   * Checkpoint lỗi ⇒ dừng hẳn; dừng giữa chừng ⇒ chạy lại checkpoint đó (≤3 lần). Không chạy chồng script đang chạy.
   */
  private runRoute(conn: GameConnection, r: Runtime, cfg: DungeonTeamConfig) {
    const def = DUNGEON_ROOM_CATALOG.find((d) => d.id === cfg.dungeonId);
    const ch = conn.character();
    const steps = def?.steps;
    if (!def || !steps?.length || !def.map || ch?.location.map !== def.map) return;
    const state = conn.info().script?.state;
    const active = state === "running" || state === "paused" || state === "stopping";
    const now = Date.now();

    // Chụp đội ngay lúc bắt đầu checkpoint đầu: roster đội ngũ (0d/06) ∪ thành viên khai báo đang online.
    if (!r.teamNames) {
      const names = new Set<string>();
      for (const m of ch.party.members) if (m.name && norm(m.name) !== norm(ch.player.name)) names.add(m.name);
      for (const n of cfg.members) if (this.byName(n)) names.add(n);
      r.teamNames = [...names];
    }
    const missing = this.teamMissing(conn, r);
    if (missing.length) {
      r.message = `⛔ Thành viên ${missing.join(", ")} mất kết nối / rời đội — dừng, không xử lý checkpoint kế tiếp (bấm "Thoát phó bản" nếu cần)`;
      this.note(conn, r, "team-missing", "warn", r.message);
      if (active && !ch.inBattle) { try { conn.stopScript(); } catch { /* không có script */ } }
      return;
    }
    r.lastLog.delete("team-missing");
    if (active) return;

    // Server báo hoàn thành (S→C 2f/0c) ⇒ dừng mọi checkpoint còn lại.
    if (ch.dungeonRoom?.status === "completed" && r.stepIdx < steps.length) { r.stepIdx = steps.length; conn.log("info", "🏰 [Phó bản đội] Server báo phó bản HOÀN THÀNH (2f/0c)", "game"); }
    if (r.stepIdx >= steps.length) {
      r.message = ch.dungeonRoom?.status === "completed" ? "✅ Phó bản đã hoàn thành — chờ ra khỏi phó bản" : "Đã xử lý hết checkpoint — chờ kết thúc phó bản";
      // Thắng trận cuối ⇒ chuỗi 10 câu/kết quả (engine tự ack) → `2f/0c` (hoàn thành) → `14/08 00 2a`; theo người chơi team được server warp về map mặc định.
      // Cả hai pcap đều thấy chủ phòng rời đội `0d/04` ~2s sau chốt ⇒ nếu 30s sau checkpoint cuối team VẪN ở map phó bản thì làm giống (một lần).
      r.finishedAt ??= now;
      if (!r.exitSent && !ch.inBattle && now - r.finishedAt > 30_000) {
        r.exitSent = true;
        conn.log("info", "🏰 [Phó bản đội] 30s sau checkpoint cuối team vẫn ở phó bản — rời đội để ra (0d/04, như client thật)", "game");
        void conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
      }
      return;
    }
    const step = steps[r.stepIdx]!;
    if (r.routeRuns > 0 && state === "error") {
      r.stepIdx = steps.length;
      r.message = `Checkpoint "${step.name}" lỗi — xem tab Log; có thể thao tác tay hoặc bấm "Thoát phó bản"`;
      this.note(conn, r, "route-error", "warn", `Checkpoint "${step.name}" dừng vì lỗi: ${conn.info().script?.error ?? "không rõ"} — không chạy lại`);
      return;
    }
    if (r.routeRuns > 0 && state === "completed") {
      conn.log("info", `🏰 [Phó bản đội] Xong checkpoint "${step.name}" (${r.stepIdx + 1}/${steps.length})`, "game");
      r.stepIdx++; r.routeRuns = 0;
      r.lastRouteAt = now - ROUTE_RETRY_MS + 2000; // sang checkpoint kế sau ~2s
      return;
    }
    if (ch.inBattle || now - r.lastRouteAt < ROUTE_RETRY_MS) return;
    if (r.routeRuns >= ROUTE_MAX_RUNS) { r.message = `Checkpoint "${step.name}" đã dừng ${ROUTE_MAX_RUNS} lần mà chưa xong — nếu bị kẹt hãy bấm "Thoát phó bản"`; return; }
    r.routeRuns++;
    r.lastRouteAt = now;
    try {
      conn.runScript(`phoban-doi-${def.id}-${r.stepIdx + 1}`, step.script);
      conn.log("info", `🏰 [Phó bản đội] Đang chạy checkpoint "${step.name}" ${def.name} (${r.stepIdx + 1}/${steps.length}, lần ${r.routeRuns}/${ROUTE_MAX_RUNS})`, "game");
    } catch (e) {
      conn.log("warn", `🏰 [Phó bản đội] Không chạy được checkpoint "${step.name}": ${e instanceof Error ? e.message : e}`, "game");
    }
  }

  private async cancelRoom(conn: GameConnection, r: Runtime) {
    if (r.roomCreated) await conn.dispatch("dungeon_room_cancel", undefined, { quiet: true }).catch(() => undefined);
    r.roomCreated = false;
  }

  private async tickMember(id: string, conn: GameConnection, cfg: DungeonTeamConfig) {
    const r = this.runtime(canon(id));
    const ch = conn.character()!;
    const now = Date.now();
    const leaderName = cfg.leaderName.trim();
    if (!leaderName) { this.fail(id, r, "Chưa nhập tên chủ phòng"); return; }
    if (r.phase === "idle") {
      r.searchStart = now;
      this.setPhase(r, "searching", `Đang tìm đội của ${leaderName}…`);
    }
    const lead = this.byName(leaderName);
    const lr = lead ? this.rt.get(canon(lead.id)) : undefined;
    const me = norm(ch.player.name);
    const name = DUNGEON_ROOM_CATALOG.find((d) => d.id === cfg.dungeonId)?.name ?? `phó bản ${cfg.dungeonId}`;

    switch (r.phase) {
      case "searching": {
        if (cfg.leaveParty && ch.party.joined) { await this.send(conn, r, "leave_party"); r.message = "Rời đội trước khi vào phòng…"; break; }
        // Chủ phòng là bot trên web ⇒ về cùng cổng thành với chủ (teleport đã xác nhận).
        if (lr?.gate && ACTIVE_LEADER.has(lr.phase) && !ch.inBattle && ch.location.map !== lr.gate.id) {
          r.message = `Về cổng thành ${lr.gate.city} theo ${leaderName}…`;
          await this.send(conn, r, "teleport_gate", { mapId: lr.gate.id });
          break;
        }
        if (ch.inBattle) { r.message = "Đang trong trận đấu — chờ hết trận rồi tìm đội…"; break; }
        const res = await this.send(conn, r, "dungeon_room_join", { leader: leaderName, dungeon: cfg.dungeonId, password: lr?.password ?? cfg.joinPassword }, SEARCH_POLL_MS);
        if (res?.ok) {
          r.hubMap = ch.location.map;
          this.note(conn, r, "joined", "info", `Đã vào phòng ${name} của ${leaderName}`);
          this.setPhase(r, "room_open", `Đã vào phòng của ${leaderName} — đang bật sẵn sàng…`);
        } else if (res) {
          if (/từ chối/.test(res.message ?? "")) { this.fail(id, r, `${res.message}`); break; }
          r.message = `${res.message ?? "Chưa thấy phòng"} — đang tìm tiếp…`;
        }
        if (r.phase === "searching" && now - r.searchStart > SEARCH_TIMEOUT_MS) this.fail(id, r, `Không tìm thấy phòng ${name} của "${leaderName}" sau ${SEARCH_TIMEOUT_MS / 1000}s`);
        break;
      }
      case "room_open": {
        const room = ch.dungeonRoom;
        if (room && (room.status === "cancelled" || room.status === "left")) { this.fail(id, r, "Phòng đã bị huỷ / bạn đã rời phòng"); break; }
        if (ch.inBattle || (r.hubMap && ch.location.map !== r.hubMap)) {
          lr?.joined.add(me);
          this.setPhase(r, "in_dungeon", "Đang trong phó bản…");
          // Như client thật sau khi vào map phó bản: `0c/01` để server gửi danh sách NPC + roster đội (đội trong phó bản đồng bộ với tab thông tin chung).
          void conn.dispatch("sync_state", undefined, { quiet: true }).catch(() => undefined);
          break;
        }
        if (!room?.ready) {
          const res = await this.send(conn, r, "dungeon_room_ready", undefined, SEARCH_POLL_MS);
          if (res && !res.ok) r.message = `Bật sẵn sàng thất bại: ${res.message ?? "không rõ"}`;
          break;
        }
        lr?.joined.add(me);
        this.setPhase(r, "room_open", `✔ Đã vào phòng của ${leaderName} và sẵn sàng — chờ chủ phòng bắt đầu`);
        break;
      }
      case "in_dungeon": {
        // Thành viên KHÔNG tự đi/đánh: vẫn chung đội với chủ nên tự theo chủ vào trận, hoàn thành phó bản cùng chủ.
        const dm = DUNGEON_ROOM_CATALOG.find((d) => d.id === cfg.dungeonId)?.map;
        const back = !ch.inBattle && (dm ? ch.location.map !== dm : ch.location.map === r.hubMap);
        if (back && now - r.phaseAt > 5000) { this.setPhase(r, "done", "Đã xong phó bản"); this.store.set(id, { enabled: false }); }
        else if (now - r.phaseAt > DUNGEON_TIMEOUT_MS) this.fail(id, r, "Phó bản chạy quá 30 phút chưa ra");
        break;
      }
    }
  }

  private fail(id: string, r: Runtime, message: string) {
    this.setPhase(r, "error", message);
    this.store.set(id, { enabled: false });
  }

  /** Dựng state cho UI; chỉ đẩy lên khi thay đổi. */
  private publish(id: string, cfg: DungeonTeamConfig) {
    const r = this.rt.get(canon(id));
    if (!r) return;
    const leader = cfg.role === "leader";
    const state: DungeonTeamState = {
      enabled: cfg.enabled,
      role: cfg.role,
      phase: r.phase,
      protocolReady: this.joinReady,
      gate: leader ? r.gate : undefined,
      canStart: leader && r.canStart,
      members: leader ? r.members : [],
      password: leader ? r.password : undefined,
      message: r.message,
    };
    const json = JSON.stringify(state);
    r.state = state;
    if (json !== r.stateJson) { r.stateJson = json; this.host.pushCharacter(id); }
  }
}
