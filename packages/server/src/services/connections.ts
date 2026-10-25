import { EngineError, GameConnection, getDriver } from "@tsbot/engine";
import type { ActionParams, ActionResult, CharacterState, ConnectionInfo, LogEntry, LoginBody, ScriptControl } from "@tsbot/protocol";
import { DungeonSoloService } from "./dungeonSolo";
import { DungeonTeamService } from "./dungeonTeam";
import { PartyService, WARP_ACTIONS } from "./party";
import { CUSTOM_PREFIX, ClosedStore, DungeonSoloConfigStore, DungeonTeamConfigStore, PartyConfigStore, type AccountStore, type BattleConfigStore, type ItemListStore, type RunnableRegistry, type ScriptStore, type ServerStore, type SettingsStore } from "./store";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Quản lý các kết nối bền vững (mỗi tài khoản tối đa 1). */
export class ConnectionManager {
  private conns = new Map<string, GameConnection>();
  private closed = new ClosedStore();
  onChange: (c: ConnectionInfo) => void = () => {};
  onLog: (accountId: string, e: LogEntry) => void = () => {};
  onRemoved: (accountId: string) => void = () => {};
  onCharacter: (accountId: string, c: CharacterState) => void = () => {};
  /** Lập đội giữa các tài khoản (xem services/party.ts + docs/PARTY_KNOWLEDGE.md). */
  readonly partyConfigs = new PartyConfigStore();
  readonly party = new PartyService(
    { entries: () => [...this.conns.entries()], pushCharacter: (id) => this.pushCharacter(id) },
    this.partyConfigs,
  );
  /** Phó bản đội (xem services/dungeonTeam.ts + docs/DUNGEON_TEAM_KNOWLEDGE.md). */
  readonly dungeonTeamConfigs = new DungeonTeamConfigStore();
  readonly dungeonTeam = new DungeonTeamService(
    { entries: () => [...this.conns.entries()], pushCharacter: (id) => this.pushCharacter(id) },
    this.dungeonTeamConfigs,
  );
  /** Phó bản đơn (xem services/dungeonSolo.ts + docs/DUNGEON_SOLO_KNOWLEDGE.md). */
  readonly dungeonSoloConfigs = new DungeonSoloConfigStore();
  readonly dungeonSolo = new DungeonSoloService(
    { entries: () => [...this.conns.entries()], pushCharacter: (id) => this.pushCharacter(id) },
    this.dungeonSoloConfigs,
  );

  constructor(
    private scripts: ScriptStore,
    private customScripts: ScriptStore,
    private registry: RunnableRegistry,
    private accounts: AccountStore,
    private settings: SettingsStore,
    private servers: ServerStore,
    private battleConfigs?: BattleConfigStore,
    private itemLists?: ItemListStore,
    private chaseConfigs?: import("./store").ChaseConfigStore,
  ) {}

  list(): ConnectionInfo[] {
    return [...this.conns.values()].map((c) => c.info());
  }
  /** Trạng thái nhân vật của mọi kết nối đã từng login. */
  characters(): Record<string, CharacterState> {
    const out: Record<string, CharacterState> = {};
    for (const [id, c] of this.conns) {
      const ch = c.character();
      if (ch) out[id] = this.withPlan(id, ch);
    }
    return out;
  }

  /** Gắn kế hoạch lập đội và phó bản vào character state trước khi đẩy lên UI. */
  private withPlan(accountId: string, ch: CharacterState): CharacterState {
    const plan = this.party.planFor(accountId);
    const dungeonTeam = this.dungeonTeam.stateFor(accountId);
    const dungeonSolo = this.dungeonSolo.stateFor(accountId);
    if (plan === ch.partyPlan && dungeonTeam === ch.dungeonTeam && dungeonSolo === ch.dungeonSolo) return ch;
    return { ...ch, partyPlan: plan, dungeonTeam, dungeonSolo };
  }

  /** PartyService đổi kế hoạch ⇒ đẩy lại state ngay (không chờ nhịp đồng bộ 3s). */
  pushCharacter(accountId: string) {
    const ch = this.conns.get(accountId)?.character();
    if (ch) this.onCharacter(accountId, this.withPlan(accountId, ch));
  }

  /** Mọi kết nối (kể cả offline) — PartyService tự lọc online. */
  entries(): [string, GameConnection][] {
    return [...this.conns.entries()];
  }
  onlineCount(): number {
    return [...this.conns.values()].filter((c) => !c.isOffline).length;
  }
  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  get(accountId: string): GameConnection {
    const direct = this.conns.get(accountId);
    if (direct) return direct;
    const cKey = this.canonicalKey(accountId);
    for (const [id, conn] of this.conns) {
      if (this.canonicalKey(id) === cKey) return conn;
    }
    throw new HttpError(404, "Tài khoản này chưa đăng nhập lần nào");
  }

  private loginQueue: Promise<unknown> = Promise.resolve();

  private queueLogin<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      try {
        return await fn();
      } finally {
        // Giãn cách 1200ms giữa các lần bắt đầu kết nối TCP đến game server,
        // tránh việc game server TS Online từ chối/drop kết nối khi nhận nhiều handshake cùng lúc từ 1 IP.
        await new Promise((r) => setTimeout(r, 1200));
      }
    };
    const next = this.loginQueue.then(run, run);
    this.loginQueue = next.catch(() => {});
    return next;
  }

  async login(accountId: string, body: LoginBody = {}): Promise<ConnectionInfo> {
    const account = this.accounts.get(accountId);
    if (!account) throw new HttpError(404, "Tài khoản không tồn tại");
    const cfg = this.settings.get();
    const driver = getDriver(body.transport ?? cfg.defaultTransport);
    if (!driver) throw new HttpError(400, `Transport '${body.transport}' chưa đăng ký`);
    let c = this.conns.get(accountId);
    if (!c) {
      const cKey = this.canonicalKey(accountId);
      for (const [id, conn] of this.conns) {
        if (this.canonicalKey(id) === cKey) {
          c = conn;
          break;
        }
      }
    }
    if (!c) {
      c = new GameConnection({
        accountId,
        lastClosedAt: this.closed.get(accountId),
        onClosed: (ts) => this.closed.set(accountId, ts),
        onChange: (i) => this.onChange(i),
        onLog: (e) => this.onLog(accountId, e),
        onCharacter: (ch) => this.onCharacter(accountId, this.withPlan(accountId, ch)),
      });
      this.conns.set(accountId, c);
    }
    if (c.isOffline && this.onlineCount() >= cfg.maxSessions) {
      throw new HttpError(429, `Đã đạt giới hạn ${cfg.maxSessions} kết nối song song`);
    }
    await this.queueLogin(() =>
      c.login({
        driver, codec: cfg.socketCodec, endpoint: this.servers.endpointOf(account.server), speed: body.speed ?? cfg.speed, commandTimeoutMs: cfg.commandTimeoutMs, logLevel: cfg.logLevel,
        heartbeatMs: cfg.heartbeatMs, autoReconnect: cfg.autoReconnect, maxReconnect: cfg.maxReconnect,
        credentials: { server: account.server, username: account.username, password: account.password ?? "" },
      })
    );
    const bCfg = this.battleConfigs?.get(accountId);
    if (bCfg) {
      const mode = bCfg.strategyMode ?? (bCfg.turns && bCfg.turns.length > 0 ? "turns" : "default");
      await c.dispatch("set_battle_config", {
        playerSkillId: String(bCfg.playerAction?.skillId ?? 10000),
        petSkillId: String(bCfg.petAction?.skillId ?? 10000),
        autoFight: bCfg.autoFight ? "1" : "0",
        playerTarget: bCfg.playerAction?.target ?? "F1",
        petTarget: bCfg.petAction?.target ?? "F1",
        turnsJson: bCfg.turns ? JSON.stringify(bCfg.turns) : "",
        strategyMode: mode,
        autoEscape: bCfg.autoEscape ? "1" : "0",
      }).catch(() => {});
    }
    const lists = this.itemLists?.get(accountId);
    if (lists) {
      await c.dispatch("set_item_lists", {
        autoDropJson: JSON.stringify(lists.discard ?? []),
        autoOpenJson: JSON.stringify(lists.autoOpen ?? []),
        autoDissolveJson: JSON.stringify(lists.resolve ?? []),
        autoContributeJson: JSON.stringify(lists.contribute ?? []),
        autoCombineJson: JSON.stringify(lists.combine ?? []),
        sellJson: JSON.stringify(lists.sell ?? []),
        togglesJson: JSON.stringify(lists.toggles ?? {}),
        autoSweepEnabled: lists.autoSweepEnabled ? "1" : "0",
        autoHealJson: JSON.stringify(lists.autoHeal ?? {}),
      }).catch(() => {});
    }
    const chaseCfg = this.chaseConfigs?.get(accountId);
    if (chaseCfg && chaseCfg.enabled) {
      await c.dispatch("set_chase_config", {
        enabled: chaseCfg.enabled ? "1" : "0",
        mapId: String(chaseCfg.mapId),
        originX: String(chaseCfg.originX),
        originY: String(chaseCfg.originY),
        maxRadius: String(chaseCfg.maxRadius),
        npcId: String(chaseCfg.npcId ?? 0),
        npcName: chaseCfg.npcName ?? "",
        autoReturn: chaseCfg.autoReturn ? "1" : "0",
      }).catch(() => {});
    }
    this.party.refresh(accountId);
    this.dungeonTeam.refresh(accountId);
    if (cfg.autoCheckin) void this.autoCheckin(accountId, c);
    return c.info();
  }

  /**
   * Tự động điểm danh ngày sau khi đăng nhập thành công: chờ server gửi bộ đếm ngày (55/01, ~vài giây sau login) rồi `daily_checkin` (ngày = bộ đếm + 1).
   * Chưa có bộ đếm ⇒ thử lại (tối đa 4 lần cách 3s); đã điểm danh hôm nay / đủ 28 ngày ⇒ server/engine báo trong tab Sự kiện, không thử lại.
   */
  private async autoCheckin(accountId: string, c: GameConnection) {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await sleep(4000);
    for (let i = 0; i < 4; i++) {
      if (c.isOffline) return;
      try {
        const r = await c.dispatch("daily_checkin", undefined, { quiet: true });
        if (r.ok) return;
        if (!/chưa đọc được bộ đếm/.test(r.message ?? "")) { c.log("info", `📅 [Điểm danh tự động] ${r.message ?? "không thực hiện được"}`, "game"); return; }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/chưa đọc được bộ đếm/.test(msg)) { c.log("info", `📅 [Điểm danh tự động] ${msg}`, "game"); return; }
      }
      await sleep(3000);
    }
    c.log("warn", "📅 [Điểm danh tự động] chưa đọc được bộ đếm ngày từ server — bấm nút 📅 để điểm danh tay", "game");
  }

  async logout(accountId: string): Promise<ConnectionInfo> {
    const c = this.get(accountId);
    await c.logout();
    return c.info();
  }

  dispatch(accountId: string, action: string, params?: ActionParams): Promise<ActionResult> {
    const conn = this.get(accountId);
    // Chủ PT warp ⇒ thành viên trong đội warp theo (chạy song song); chuỗi warp của chủ tự chờ đủ đội ở bước {gather}.
    if (WARP_ACTIONS.has(action)) this.party.mirrorWarp(accountId, action, params);
    return conn.dispatch(action, params);
  }

  private resolveScript(scriptId: string) {
    let script;
    if (scriptId.startsWith(CUSTOM_PREFIX)) {
      const id = scriptId.slice(CUSTOM_PREFIX.length);
      if (!this.registry.has(id)) throw new HttpError(400, `Script tự tạo "${id}" chưa được đưa vào danh sách chính thức`);
      script = this.customScripts.get(id);
    } else script = this.scripts.get(scriptId);
    if (!script) throw new HttpError(400, `Script "${scriptId}" không tồn tại`);
    return { scriptId, source: script.content };
  }

  runScript(accountId: string, scriptId: string, vars?: Record<string, string>) {
    const s = this.resolveScript(scriptId);
    this.get(accountId).runScript(s.scriptId, s.source, vars);
    return this.get(accountId).info();
  }

  /** Chạy tuần tự nhiều script (theo thứ tự truyền vào) trên một tài khoản. */
  runQueue(accountId: string, scriptIds: string[], vars?: Record<string, string>) {
    const items = scriptIds.map((id) => this.resolveScript(id));
    this.get(accountId).runQueue(items, vars);
    return this.get(accountId).info();
  }

  scriptControl(accountId: string, action: ScriptControl) {
    const c = this.get(accountId);
    if (action === "pause") c.pauseScript();
    else if (action === "resume") c.resumeScript();
    else if (action === "stop") c.stopScript();
    else throw new HttpError(400, "action không hợp lệ");
    return c.info();
  }

  /** Xoá kết nối offline của tài khoản đã bị xoá. */
  forget(accountId: string) {
    const c = this.conns.get(accountId);
    if (!c) return;
    if (!c.isOffline) throw new HttpError(409, "Hãy đăng xuất tài khoản trước khi xoá");
    this.conns.delete(accountId);
    this.onRemoved(accountId);
  }

  async logoutAll(): Promise<{ count: number }> {
    const active = [...this.conns.values()].filter((c) => !c.isOffline);
    await Promise.all(active.map((c) => c.logout()));
    return { count: active.length };
  }
}

export { EngineError };
