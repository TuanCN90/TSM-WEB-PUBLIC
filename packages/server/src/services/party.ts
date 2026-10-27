/**
 * PartyService — điều phối LẬP ĐỘI giữa các tài khoản của web (tầng server, trên các GameConnection).
 * Tài liệu logic + cách debug: docs/PARTY_KNOWLEDGE.md (đọc §5–§8 trước khi sửa file này).
 *
 * Vai trò (cấu hình theo từng tài khoản, PartyConfigStore):
 *  • leader (chủ PT): khai báo ≤4 TÊN NHÂN VẬT thành viên (+ tick QSư). Mỗi nhịp:
 *      - thành viên chưa trong đội & ĐANG Ở CÙNG MAP ⇒ gửi MỜI (0d/07). Không cùng map ⇒ không gửi gì (status not_in_map).
 *      - tự chấp nhận lời XIN (0d/01) của đúng các tên đã khai báo (engine làm việc này, server chỉ đẩy danh sách xuống).
 *      - thành viên đã trong đội + được tick QSư ⇒ gán QSư (gói chưa biết ⇒ advisor_pending).
 *  • member: khai báo TÊN CHỦ PT. Mỗi nhịp: chưa trong đội của chủ ⇒ XIN VÀO ĐỘI (0d/01) nếu chủ đang cùng map;
 *      tự chấp nhận lời MỜI (0d/07) của đúng tên chủ PT.
 *  • Nhận diện người = TÊN NHÂN VẬT (không phân biệt hoa/thường), chỉ thấy được khi người đó đã spawn (03/00) trong map hiện tại.
 *
 * Đồng bộ warp: chủ PT chạy warp_map / teleport_gate / warp_to_spot ⇒ mirrorWarp() cho mọi thành viên ĐÃ VÀO ĐỘI teleport tới cùng cổng thành
 * (chỉ đoạn teleport; teleport làm TAN ĐỘI nên tick() mời lại ở map mới); chuỗi warp của chủ có bước `{gather}` (liveActions) ⇒ gather()
 * chờ đủ thành viên ĐÃ VÀO LẠI ĐỘI ở đúng map rồi mới cho đi bộ.
 */
import type { PartyConfig, PartyEntryStatus, PartyPlanEntry, PartyPlanState } from "@tsbot/protocol";
import { buildSteps, type GameConnection } from "@tsbot/engine";
import type { PartyConfigStore } from "./store";

/** Nhịp kiểm tra (ms). Chỉ đọc state trong RAM; gói chỉ gửi khi qua throttle bên dưới. */
const TICK_MS = 3000;
/** Giãn cách tối thiểu giữa 2 lần gửi mời/xin cho CÙNG một đối tượng (server giữ hộp thoại ~vài chục giây; không spam). */
const INVITE_COOLDOWN_MS = 25_000;
/** Mời/xin mãi không vào đội (vd gói đồng ý chưa đúng định dạng) ⇒ tăng dần giãn cách (×2 mỗi lần, tối đa 5 phút) để không spam hộp thoại trong game. */
const INVITE_COOLDOWN_MAX_MS = 300_000;
/** Giãn cách thăm dò khi chưa thấy đối tượng trong map (không gửi gói, chỉ kiểm tra danh sách người trong map). */
const PROBE_COOLDOWN_MS = 4_000;
/** Member chờ chút để chủ PT mời trước, tránh hai bên cùng gửi một lúc. */
const MEMBER_REQUEST_DELAY_MS = 8_000;
/** Gợi ý khi 2 tài khoản cùng map theo state bot nhưng chủ PT không thấy/không mời được: thường là khác KÊNH. */
const CHANNEL_HINT = "Cùng map (theo bot) nhưng không thấy nhau — nghi KHÁC KÊNH (kênh đầy bị đẩy sang kênh khác). Hãy đưa về cùng kênh; bot chưa đọc/đổi được kênh (cần pcap)";
/** Chờ gom đội tối đa trước khi bỏ chuỗi warp. */
const GATHER_TIMEOUT_MS = 150_000;
const GATHER_POLL_MS = 1000;
/** Không báo lỗi gán QSư dồn dập. */
const ADVISOR_COOLDOWN_MS = 20_000;

export const WARP_ACTIONS = new Set(["warp_map", "teleport_gate", "warp_to_spot"]);

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();
const canon = (accountId: string) => {
  const raw = (accountId ?? "").trim();
  if (!raw) return "default";
  const at = raw.indexOf("@");
  return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
};

/** Phần ConnectionManager mà PartyService cần (tránh phụ thuộc vòng). */
export interface PartyHost {
  entries(): [string, GameConnection][];
  /** Đẩy lại character state (kèm partyPlan mới) lên UI. */
  pushCharacter(accountId: string): void;
  isWorldBossRunning?(accountId: string): boolean;
  isDungeonSoloRunning?(accountId: string): boolean;
}

interface Runtime {
  firstSeen: number;
  lastSend: Map<string, number>; // key đối tượng → lần gửi mời/xin gần nhất
  sendCount: Map<string, number>; // key đối tượng → số lần gửi liên tiếp chưa thành công (để back-off)
  lastProbe: Map<string, number>;
  lastAdvisor: Map<string, number>;
  lastConfigHash: string;
  lastLog: Map<string, string>; // chống log lặp: key → thông điệp gần nhất
  plan?: PartyPlanState;
  planJson?: string;
  gathering: boolean;
  lastConnectedAt?: number;
}

export class PartyService {
  private timer?: ReturnType<typeof setInterval>;
  private rt = new Map<string, Runtime>(); // key canonical
  private ticking = false;

  constructor(private host: PartyHost, private store: PartyConfigStore) {}

  start() {
    this.timer ??= setInterval(() => { void this.tick(); }, TICK_MS);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Gọi khi user lưu cấu hình / tài khoản login: đẩy lại danh sách tự chấp nhận xuống engine và tính lại ngay. */
  refresh(accountId: string) {
    const r = this.rt.get(canon(accountId));
    if (r) { r.lastConfigHash = ""; r.lastSend.clear(); r.sendCount.clear(); r.lastProbe.clear(); r.firstSeen = Date.now(); }
    void this.tick();
  }

  planFor(accountId: string): PartyPlanState | undefined {
    return this.rt.get(canon(accountId))?.plan;
  }

  /** Tài khoản này đang là chủ PT với kế hoạch bật? (dùng để quyết định mirror/gather) */
  isActiveLeader(accountId: string): boolean {
    if (this.host.isWorldBossRunning?.(accountId) || this.host.isDungeonSoloRunning?.(accountId)) {
      return false;
    }
    const leaderConn = this.host.entries().find(([id]) => canon(id) === canon(accountId))?.[1];
    const lch = leaderConn?.character();
    if (lch?.dungeonSolo && lch.dungeonSolo.phase !== "idle" && lch.dungeonSolo.phase !== "done" && lch.dungeonSolo.phase !== "error") {
      return false;
    }
    if (lch?.worldBoss && lch.worldBoss.phase !== "idle" && lch.worldBoss.phase !== "done" && lch.worldBoss.phase !== "error") {
      return false;
    }
    const cfg = this.store.get(accountId);
    return cfg.enabled && cfg.role === "leader" && cfg.members.length > 0;
  }

  /* ------------------------- tiện ích tra cứu ------------------------- */

  private online(): { id: string; conn: GameConnection; name: string }[] {
    const out: { id: string; conn: GameConnection; name: string }[] = [];
    for (const [id, conn] of this.host.entries()) {
      if (conn.isOffline) continue;
      const ch = conn.character();
      if (ch?.player.name) out.push({ id, conn, name: ch.player.name });
    }
    return out;
  }

  /** Hai tài khoản (đều online trên web) đang cùng map theo state của chính bot — nguồn đáng tin hơn gói spawn. */
  private sameMap(conn: GameConnection, otherName: string): boolean {
    const peer = this.byName(otherName);
    const a = conn.character()?.location.map, b = peer?.conn.character()?.location.map;
    return !!peer && peer.conn !== conn && !!a && a === b;
  }

  private byName(name: string) {
    const k = norm(name);
    return this.online().find((o) => norm(o.name) === k);
  }

  private note(conn: GameConnection, rt: Runtime, key: string, level: "info" | "warn", msg: string) {
    if (rt.lastLog.get(key) === msg) return;
    rt.lastLog.set(key, msg);
    conn.log(level, `🤝 [Lập đội] ${msg}`, "game");
  }

  /** Giãn cách mời/xin lại cho 1 đối tượng: 25s, 50s, 100s, … tối đa 5 phút theo số lần đã gửi mà chưa vào đội. */
  private cooldown(rt: Runtime, key: string): number {
    return Math.min(INVITE_COOLDOWN_MS * 2 ** Math.max(0, (rt.sendCount.get(key) ?? 0) - 1), INVITE_COOLDOWN_MAX_MS);
  }

  /* ------------------------- vòng điều phối ------------------------- */

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      for (const o of this.online()) {
        const cfg = this.store.get(o.id);
        const key = canon(o.id);
        let rt = this.rt.get(key);
        if (!rt) {
          rt = { firstSeen: now, lastSend: new Map(), sendCount: new Map(), lastProbe: new Map(), lastAdvisor: new Map(), lastConfigHash: "", lastLog: new Map(), gathering: false };
          this.rt.set(key, rt);
        }
        const connTime = o.conn.info?.()?.connectedAt ?? 0;
        if (connTime > 0 && rt.lastConnectedAt !== connTime) {
          rt.lastConnectedAt = connTime;
          rt.lastConfigHash = "";
        }
        try {
          const ch = o.conn.character();
          // Nếu tài khoản đang chạy phó bản đơn hoặc Boss Thế Giới -> tạm bỏ qua lập đội, gỡ chốt chặn partyGate
          const inSolo = this.host.isDungeonSoloRunning?.(o.id) || (ch?.dungeonSolo && ch.dungeonSolo.phase !== "idle" && ch.dungeonSolo.phase !== "done" && ch.dungeonSolo.phase !== "error");
          const inBoss = this.host.isWorldBossRunning?.(o.id) || (ch?.worldBoss && ch.worldBoss.phase !== "idle" && ch.worldBoss.phase !== "done" && ch.worldBoss.phase !== "error");
          if (inSolo || inBoss) {
            o.conn.partyGate = undefined;
            continue;
          }

          if (!cfg.enabled) {
            this.setPlan(o.id, rt, undefined, cfg);
            o.conn.partyGate = undefined;
            await this.pushEngineConfig(o.conn, rt, {
              inviteFrom: "",
              requestFrom: [],
              role: cfg.role,
              leaderName: cfg.leaderName,
              members: cfg.members.map((m) => m.name).filter(Boolean),
              escapeIfNotFullParty: !!cfg.escapeIfNotFullParty,
            });
            continue;
          }
          if (cfg.role === "leader") await this.tickLeader(o.id, o.conn, cfg, rt, now);
          else await this.tickMember(o.id, o.conn, cfg, rt, now);
        } catch (e) {
          o.conn.log("warn", `🤝 [Lập đội] lỗi nhịp điều phối: ${e instanceof Error ? e.message : String(e)}`, "game");
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async pushEngineConfig(
    conn: GameConnection,
    rt: Runtime,
    auto: {
      inviteFrom: string;
      requestFrom: string[];
      role: "leader" | "member";
      leaderName: string;
      members: string[];
      escapeIfNotFullParty: boolean;
    }
  ) {
    const hash = JSON.stringify(auto);
    if (rt.lastConfigHash === hash) return;
    const r = await conn.dispatch(
      "set_party_config",
      {
        inviteFrom: auto.inviteFrom,
        requestFromJson: JSON.stringify(auto.requestFrom),
        role: auto.role,
        leaderName: auto.leaderName,
        membersJson: JSON.stringify(auto.members),
        escapeIfNotFullParty: auto.escapeIfNotFullParty ? "1" : "0",
      },
      { quiet: true }
    );
    if (r.ok) rt.lastConfigHash = hash;
  }

  private async tickLeader(accountId: string, conn: GameConnection, cfg: PartyConfig, rt: Runtime, now: number) {
    const ch = conn.character()!;
    const names = cfg.members.map((m) => m.name).filter(Boolean);
    conn.partyGate = (reason, signal) => this.gather(accountId, reason, signal);
    await this.pushEngineConfig(conn, rt, {
      inviteFrom: "",
      requestFrom: names,
      role: "leader",
      leaderName: "",
      members: names,
      escapeIfNotFullParty: !!cfg.escapeIfNotFullParty,
    });

    const party = ch.party;
    const inParty = (name: string) => party.joined && party.members.find((m) => m.name && norm(m.name) === norm(name));
    const entries: PartyPlanEntry[] = [];
    for (const m of cfg.members) {
      const peer = this.byName(m.name);
      if (peer && (this.host.isWorldBossRunning?.(peer.id) || this.host.isDungeonSoloRunning?.(peer.id))) {
        entries.push({
          name: m.name,
          advisor: m.advisor,
          status: "not_in_map",
          detail: `Đang bận ${this.host.isWorldBossRunning?.(peer.id) ? "Boss Thế Giới" : "Phó bản đơn"}`,
        });
        continue;
      }
      const slot = inParty(m.name);
      let status: PartyEntryStatus;
      let detail: string | undefined;
      if (slot) {
        rt.sendCount.delete(m.name);
        status = slot.isAdvisor ? "advisor" : m.advisor ? "advisor_pending" : "in_party";
        if (m.advisor && !slot.isAdvisor) {
          const last = rt.lastAdvisor.get(m.name) ?? 0;
          if (now - last >= ADVISOR_COOLDOWN_MS) {
            rt.lastAdvisor.set(m.name, now);
            const r = await conn.dispatch("party_set_advisor", { slot: m.name }, { quiet: true });
            detail = r.ok ? "Đã gửi lệnh gán QSư, chờ server xác nhận" : r.message;
            if (!r.ok) this.note(conn, rt, `adv:${m.name}`, "warn", `Chưa gán được QSư cho ${m.name}: ${r.message}`);
          } else detail = "Chưa gán được QSư (xem log)";
        }
      } else {
        const probeKey = m.name;
        const lastSend = rt.lastSend.get(probeKey) ?? 0;
        const lastProbe = rt.lastProbe.get(probeKey) ?? 0;
        if (now - lastSend < this.cooldown(rt, probeKey)) {
          status = "inviting";
          detail = "Đã mời, chờ đối phương đồng ý";
        } else if (now - lastProbe >= PROBE_COOLDOWN_MS) {
          rt.lastProbe.set(probeKey, now);
          let r = await conn.dispatch("party_invite", { name: m.name }, { quiet: true });
          if (!r.ok && /Không thấy/.test(r.message ?? "") && this.sameMap(conn, m.name)) {
            // Server không báo lại vị trí người từng cùng đội sau teleport ⇒ mời theo uid đã biết (xem PartyTracker.findAny)
            r = await conn.dispatch("party_invite", { name: m.name, force: "1" }, { quiet: true });
          }
          if (r.ok) {
            rt.lastSend.set(probeKey, now);
            rt.sendCount.set(probeKey, (rt.sendCount.get(probeKey) ?? 0) + 1);
            status = "inviting";
            detail = "Vừa gửi lời mời";
            this.note(conn, rt, `inv:${m.name}`, "info", `Đã mời ${m.name} vào đội`);
          } else {
            status = /Không thấy/.test(r.message ?? "") ? "not_in_map" : "error";
            detail = status === "not_in_map" && this.sameMap(conn, m.name) ? CHANNEL_HINT : r.message;
            if (detail === CHANNEL_HINT) this.note(conn, rt, `ch:${m.name}`, "warn", `${m.name}: ${CHANNEL_HINT}`);
          }
        } else {
          // Giữa hai lần thăm dò: giữ trạng thái đã tính ở nhịp trước.
          status = rt.plan?.entries.find((e) => e.name === m.name)?.status ?? "not_in_map";
          if (status === "in_party" || status === "advisor" || status === "advisor_pending") status = "not_in_map";
          detail = rt.plan?.entries.find((e) => e.name === m.name)?.detail;
        }
      }
      // Ghi chú tài khoản tương ứng có đang online trên web không (chỉ để hiển thị).
      if (!slot && !peer && status === "not_in_map") detail = `${detail ?? ""}${detail ? " · " : ""}tài khoản "${m.name}" chưa online trên web`.trim();
      entries.push({ name: m.name, advisor: m.advisor, status, detail });
    }
    const done = entries.filter((e) => e.status === "in_party" || e.status === "advisor" || e.status === "advisor_pending").length;
    const complete = entries.length > 0 && done === entries.length;
    const waiting = entries.filter((e) => e.status !== "in_party" && e.status !== "advisor" && e.status !== "advisor_pending").map((e) => e.name);
    const message = complete ? `Đã đủ đội ${done + 1}/${entries.length + 1}` : `Đã vào ${done}/${entries.length} · chờ: ${waiting.join(", ")}`;
    this.setPlan(accountId, rt, { enabled: true, role: "leader", leaderName: ch.player.name, complete, entries, message, gathering: rt.gathering }, cfg);
  }

  private async tickMember(accountId: string, conn: GameConnection, cfg: PartyConfig, rt: Runtime, now: number) {
    const ch = conn.character()!;
    conn.partyGate = undefined;
    await this.pushEngineConfig(conn, rt, {
      inviteFrom: cfg.leaderName,
      requestFrom: [],
      role: "member",
      leaderName: cfg.leaderName,
      members: [],
      escapeIfNotFullParty: !!cfg.escapeIfNotFullParty,
    });
    const party = ch.party;
    const leader = cfg.leaderName;
    let status: PartyEntryStatus;
    let detail: string | undefined;
    if (!leader) {
      status = "error";
      detail = "Chưa nhập tên chủ PT";
    } else if (party.joined && norm(party.leaderName ?? "") === norm(leader)) {
      rt.sendCount.delete(leader);
      const me = party.members.find((m) => m.isSelf);
      status = me?.isAdvisor ? "advisor" : "in_party";
    } else if (party.joined) {
      status = "error";
      detail = `Đang ở đội của "${party.leaderName}" — hãy rời đội trước`;
    } else {
      const leaderPeer = this.byName(leader);
      if (leaderPeer && (this.host.isWorldBossRunning?.(leaderPeer.id) || this.host.isDungeonSoloRunning?.(leaderPeer.id))) {
        status = "not_in_map";
        detail = `Chủ PT đang bận ${this.host.isWorldBossRunning?.(leaderPeer.id) ? "Boss Thế Giới" : "Phó bản đơn"}`;
        const entries: PartyPlanEntry[] = [{ name: leader, advisor: false, status, detail }];
        this.setPlan(accountId, rt, { enabled: true, role: "member", leaderName: leader, complete: false, entries, selfStatus: status, message: detail }, cfg);
        return;
      }
      const lastSend = rt.lastSend.get(leader) ?? 0;
      const lastProbe = rt.lastProbe.get(leader) ?? 0;
      if (now - rt.firstSeen < MEMBER_REQUEST_DELAY_MS) {
        status = "not_in_map";
        detail = "Chờ chủ PT mời trước…";
      } else if (now - lastSend < this.cooldown(rt, leader)) {
        status = "requesting";
        detail = "Đã xin vào đội, chờ chủ PT đồng ý";
      } else if (now - lastProbe >= PROBE_COOLDOWN_MS) {
        rt.lastProbe.set(leader, now);
        let r = await conn.dispatch("party_request", { name: leader }, { quiet: true });
        if (!r.ok && /Không thấy/.test(r.message ?? "") && this.sameMap(conn, leader)) {
          r = await conn.dispatch("party_request", { name: leader, force: "1" }, { quiet: true });
        }
        if (r.ok) {
          rt.lastSend.set(leader, now);
          rt.sendCount.set(leader, (rt.sendCount.get(leader) ?? 0) + 1);
          status = "requesting";
          detail = "Vừa gửi lời xin vào đội";
          this.note(conn, rt, `req:${leader}`, "info", `Đã xin vào đội của ${leader}`);
        } else {
          status = /Không thấy/.test(r.message ?? "") ? "not_in_map" : "error";
          detail = status === "not_in_map" && this.sameMap(conn, leader) ? CHANNEL_HINT : r.message;
          if (detail === CHANNEL_HINT) this.note(conn, rt, `ch:${leader}`, "warn", `${leader}: ${CHANNEL_HINT}`);
        }
      } else {
        status = rt.plan?.selfStatus ?? "not_in_map";
        if (status === "in_party" || status === "advisor") status = "not_in_map";
        detail = rt.plan?.entries[0]?.detail;
      }
    }
    const complete = status === "in_party" || status === "advisor";
    const message = complete ? `Đã vào đội của ${leader}` : status === "not_in_map" ? `Chưa thấy ${leader || "chủ PT"} trong map` : status === "requesting" ? `Đang chờ ${leader} đồng ý` : detail ?? "";
    this.setPlan(accountId, rt, { enabled: true, role: "member", leaderName: leader, complete, selfStatus: status, entries: [{ name: leader, advisor: false, status, detail }], message }, cfg);
  }

  private setPlan(accountId: string, rt: Runtime, plan: PartyPlanState | undefined, _cfg: PartyConfig) {
    const json = JSON.stringify(plan ?? null);
    rt.plan = plan;
    if (rt.planJson === json) return;
    rt.planJson = json;
    this.host.pushCharacter(accountId);
  }

  /* ------------------------- đồng bộ warp ------------------------- */

  /** Thành viên (theo cấu hình của chủ PT) đã nằm trong đội thật và tài khoản đang online trên web. */
  private partyPeers(accountId: string): { name: string; id: string; conn: GameConnection }[] {
    const cfg = this.store.get(accountId);
    const leader = this.host.entries().find(([id]) => canon(id) === canon(accountId))?.[1];
    const party = leader?.character()?.party;
    if (!party?.joined) return [];
    const out: { name: string; id: string; conn: GameConnection }[] = [];
    for (const m of cfg.members) {
      if (!party.members.some((x) => x.name && norm(x.name) === norm(m.name))) continue;
      const p = this.byName(m.name);
      if (p && !this.host.isWorldBossRunning?.(p.id) && !this.host.isDungeonSoloRunning?.(p.id)) {
        out.push({ name: m.name, id: p.id, conn: p.conn });
      }
    }
    return out;
  }

  /**
   * Chủ PT vừa ra lệnh warp ⇒ cho các thành viên ĐÃ VÀO ĐỘI chỉ làm ĐOẠN TELEPORT (44/01) tới cùng cổng thành, rồi ĐỨNG LẠI.
   * Vì sao không chạy cả lộ trình: (1) teleport làm TAN ĐỘI (server gửi 0d/04 cho mọi người — log thật 2026-10-21), nên sau teleport phải
   * lập đội lại ở map mới; (2) nếu thành viên chạy tiếp qua các cổng dịch chuyển thì họ rời map cổng thành trước khi chủ PT kịp mời lại
   * (log thật: thành viên sang 12002 trong vài giây, chủ PT chờ ở 12001 và hết 150s). Đoạn đi bộ do chủ PT làm, đội đi theo.
   * Lộ trình không có teleport (đi bộ thuần qua cổng) ⇒ không mirror: đội còn nguyên và đi cùng chủ PT.
   */
  mirrorWarp(accountId: string, action: string, params?: Record<string, string | number>) {
    if (!WARP_ACTIONS.has(action) || !this.isActiveLeader(accountId)) return;
    if (params?.mapId === undefined) return;
    const leaderConn = this.host.entries().find(([id]) => canon(id) === canon(accountId))?.[1];
    const peers = this.partyPeers(accountId);
    if (!peers.length) {
      leaderConn?.log("info", `🤝 [Lập đội] ${action} ${params.mapId}: chưa có thành viên nào trong đội để đồng bộ warp`, "game");
      return;
    }
    let gate: string | undefined;
    try {
      const steps = buildSteps(action, params, { map: leaderConn?.character()?.location.map ?? 0 });
      for (const st of steps) {
        if ("cmd" in st && st.cmd.type === "Action" && st.cmd.name === "teleport_gate") { gate = st.cmd.args[0]; break; }
      }
    } catch { /* tham số sai: để dispatch của chủ PT tự báo lỗi */ }
    if (!gate) {
      leaderConn?.log("info", `🤝 [Lập đội] ${action} ${params.mapId}: lộ trình không có đoạn teleport — đội đi bộ cùng chủ PT, không mirror`, "game");
      return;
    }
    for (const p of peers) {
      leaderConn?.log("info", `🤝 [Lập đội] chủ PT ${action} ${params.mapId} ⇒ ${p.name} teleport_gate ${gate} (rồi chờ chủ PT mời lại)`, "game");
      void p.conn.dispatch("teleport_gate", { mapId: gate }).then((r) => {
        if (!r.ok) leaderConn?.log("warn", `🤝 [Lập đội] ${p.name} teleport ${gate} thất bại: ${r.message ?? "?"}`, "game");
      });
    }
  }

  /**
   * Chốt chặn trước khi chủ PT đi bộ: chờ MỌI thành viên khai báo đã vào đội + đang ở cùng map với chủ PT (và không trong trận).
   * Hết GATHER_TIMEOUT_MS ⇒ trả ok=false để dừng chuỗi warp (đi bộ thiếu đội dễ thua trận NPC chặn cổng).
   */
  async gather(accountId: string, reason: string, signal: AbortSignal): Promise<{ ok: boolean; message?: string }> {
    const leaderConn = this.host.entries().find(([id]) => canon(id) === canon(accountId))?.[1];
    if (!leaderConn) return { ok: true };
    const lch = leaderConn.character();
    // Bỏ qua chờ đội ngũ nếu đang trong phó bản đơn hoặc Boss Thế Giới
    if (
      this.host.isWorldBossRunning?.(accountId) ||
      this.host.isDungeonSoloRunning?.(accountId) ||
      (lch?.dungeonSolo && lch.dungeonSolo.phase !== "idle" && lch.dungeonSolo.phase !== "done" && lch.dungeonSolo.phase !== "error") ||
      (lch?.worldBoss && lch.worldBoss.phase !== "idle" && lch.worldBoss.phase !== "done" && lch.worldBoss.phase !== "error")
    ) {
      leaderConn.partyGate = undefined;
      return { ok: true };
    }

    const cfg = this.store.get(accountId);
    if (!(cfg.enabled && cfg.role === "leader" && cfg.members.length > 0)) return { ok: true };
    const key = canon(accountId);
    const rt = this.rt.get(key);
    const started = Date.now();
    let lastMsg = "";
    if (rt) { rt.gathering = true; this.host.pushCharacter(accountId); }
    leaderConn.log("info", `🤝 [Lập đội] Chờ đủ đội (${reason})`, "game");
    try {
      for (;;) {
        if (signal.aborted) return { ok: false, message: "Đã huỷ khi đang chờ đủ đội" };
        const lch = leaderConn.character();
        const map = lch?.location.map ?? 0;
        const missing: string[] = [];
        const party = lch?.party;
        for (const m of cfg.members) {
          const peer = this.byName(m.name);
          if (peer && (this.host.isWorldBossRunning?.(peer.id) || this.host.isDungeonSoloRunning?.(peer.id))) {
            continue;
          }
          const inParty = !!party?.joined && party.members.some((x) => x.name && norm(x.name) === norm(m.name));
          const pch = peer?.conn.character();
          if (!inParty) missing.push(`${m.name} (chưa vào đội${peer && pch!.location.map === map ? "; cùng map nhưng có thể KHÁC KÊNH" : ""})`);
          else if (!peer) missing.push(`${m.name} (offline)`);
          else if (pch!.location.map !== map) missing.push(`${m.name} (đang ở map ${pch!.location.map}, cần ${map})`);
          else if (pch!.inBattle) missing.push(`${m.name} (đang trong trận)`);
        }
        if (!missing.length) {
          leaderConn.log("info", `🤝 [Lập đội] Đã đủ đội tại map ${map} — tiếp tục đi bộ`, "game");
          return { ok: true };
        }
        const msg = `Chờ đủ đội tại map ${map}: ${missing.join("; ")}`;
        if (msg !== lastMsg) { lastMsg = msg; leaderConn.log("info", `🤝 [Lập đội] ${msg}`, "game"); }
        if (Date.now() - started > GATHER_TIMEOUT_MS) {
          const fail = `Quá ${Math.round(GATHER_TIMEOUT_MS / 1000)}s chưa đủ đội — dừng chuỗi warp (${missing.join("; ")})`;
          leaderConn.log("warn", `🤝 [Lập đội] ${fail}`, "game");
          return { ok: false, message: fail };
        }
        await new Promise((r) => setTimeout(r, GATHER_POLL_MS));
      }
    } finally {
      if (rt) { rt.gathering = false; this.host.pushCharacter(accountId); }
    }
  }
}

