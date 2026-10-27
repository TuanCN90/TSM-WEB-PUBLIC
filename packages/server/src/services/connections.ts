import { EngineError, GameConnection, getDriver } from "@tsbot/engine";
import { getTaiwanDateKey, type ActionParams, type ActionResult, type CharacterState, type ConnectionInfo, type LogEntry, type LoginBody, type ScriptControl } from "@tsbot/protocol";
import { DungeonSoloService } from "./dungeonSolo";
import { DungeonTeamService } from "./dungeonTeam";
import { WorldBossService } from "./worldBoss";
import { EscortService } from "./escort";
import { PartyService, WARP_ACTIONS } from "./party";
import { TelegramService } from "./telegram";
import { CUSTOM_PREFIX, ClosedStore, DailyChecklistStore, DungeonSoloConfigStore, DungeonTeamConfigStore, EscortConfigStore, PartyConfigStore, WorldBossConfigStore, type AccountStore, type BattleConfigStore, type ItemListStore, type RunnableRegistry, type ScriptStore, type ServerStore, type SettingsStore } from "./store";

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
  /** Danh sách nhiệm vụ ngày Daily Checklist (reset 00:00 TW). */
  readonly dailyChecklist = new DailyChecklistStore();
  /** Phó bản đơn (xem services/dungeonSolo.ts + docs/DUNGEON_SOLO_KNOWLEDGE.md). */
  readonly dungeonSoloConfigs = new DungeonSoloConfigStore();
  readonly dungeonSolo = new DungeonSoloService(
    { entries: () => [...this.conns.entries()], pushCharacter: (id) => this.pushCharacter(id) },
    this.dungeonSoloConfigs,
    this.dailyChecklist,
    (id) => this.party.refresh(id),
  );
  /** Săn Boss Thế Giới (xem services/worldBoss.ts). */
  readonly worldBossConfigs = new WorldBossConfigStore();
  readonly worldBoss = new WorldBossService(
    {
      entries: () => [...this.conns.entries()],
      pushCharacter: (id) => this.pushCharacter(id),
      refreshParty: (id) => this.party.refresh(id),
    },
    this.worldBossConfigs,
    this.dailyChecklist,
  );
  /** Tự động Vận Tiêu & Nhà Trọ (xem services/escort.ts). */
  readonly escortConfigs = new EscortConfigStore();
  readonly escort = new EscortService(
    {
      entries: () => [...this.conns.entries()],
      get: (id) => this.conns.get(id),
      pushCharacter: (id) => this.pushCharacter(id),
    },
    this.escortConfigs,
    this.dailyChecklist,
  );
  /** Giám sát cảnh báo trạng thái Online qua Telegram Bot */
  readonly telegram: TelegramService;

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
  ) {
    this.telegram = new TelegramService(this.settings);
  }

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
    const worldBoss = this.worldBoss.stateFor(accountId);
    const dailyChecklist = this.dailyChecklist.get(accountId);
    if (plan === ch.partyPlan && dungeonTeam === ch.dungeonTeam && dungeonSolo === ch.dungeonSolo && worldBoss === ch.worldBoss && dailyChecklist === ch.dailyChecklist) return ch;
    return { ...ch, partyPlan: plan, dungeonTeam, dungeonSolo, worldBoss, dailyChecklist };
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
  isWorldBossRunning(accountId: string): boolean {
    return this.worldBoss.isRunning(accountId);
  }
  isDungeonSoloRunning(accountId: string): boolean {
    return this.dungeonSolo.isRunning(accountId);
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
        onLog: (e) => {
          if (
            e.msg.includes("[Tự động hợp] Hợp thành") ||
            e.msg.includes("[Tự động hợp] Hợp thành công") ||
            e.msg.includes("[Hợp hàng ngày]")
          ) {
            this.dailyChecklist?.recordProgress(accountId, "combine_item", 1);
            this.itemLists?.recordCombineToday(accountId);
            this.pushCharacter?.(accountId);
          }
          this.onLog(accountId, e);
        },
        onCharacter: (ch) => this.onCharacter(accountId, this.withPlan(accountId, ch)),
        onOnline: (reconnected) => {
          if (reconnected) {
            c?.log("info", "🔄 [Tự động khôi phục] Đồng bộ lại cấu hình trận đấu, vật phẩm và tổ đội sau khi kết nối lại...", "game");
            const acc = this.accounts.get(accountId);
            void this.telegram.notifyReconnect({
              accountId,
              username: acc?.username,
              server: acc?.server,
              characterName: c?.character()?.player?.name,
              mapId: c?.character()?.location?.map,
            });
            void this.applyAccountConfigs(accountId, c!).then(() => {
              this.party.refresh(accountId);
              this.dungeonTeam.refresh(accountId);
            }).catch(() => {});
          }
        },
        onDrop: (reason, details) => {
          const acc = this.accounts.get(accountId);
          const currentCfg = this.settings.get();
          const willReconnect = currentCfg.autoReconnect && currentCfg.maxReconnect > 0;
          void this.telegram.notifyDisconnect({
            accountId,
            username: acc?.username,
            server: acc?.server,
            characterName: details?.characterName || c?.character()?.player?.name,
            mapId: details?.mapId || c?.character()?.location?.map,
            reason,
            willReconnect,
          });
        },
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
    await this.applyAccountConfigs(accountId, c);
    this.party.refresh(accountId);
    this.dungeonTeam.refresh(accountId);
    if (cfg.autoCheckin) void this.autoCheckin(accountId, c);
    return c.info();
  }

  async applyAccountConfigs(accountId: string, c: GameConnection): Promise<void> {
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
      const today = getTaiwanDateKey();
      const combinedToday = lists.lastCombinedDate === today || this.dailyChecklist?.get(accountId)?.items?.["combine_item"]?.done === true;
      const effectiveLastDate = combinedToday ? today : (lists.lastCombinedDate ?? "");
      await c.dispatch("set_item_lists", {
        autoDropJson: JSON.stringify(lists.discard ?? []),
        autoOpenJson: JSON.stringify(lists.autoOpen ?? []),
        autoDissolveJson: JSON.stringify(lists.resolve ?? []),
        autoContributeJson: JSON.stringify(lists.contribute ?? []),
        autoCombineJson: JSON.stringify(lists.combine ?? []),
        sellJson: JSON.stringify(lists.sell ?? []),
        togglesJson: JSON.stringify({ ...lists.toggles, lastCombinedDate: effectiveLastDate }),
        autoSweepEnabled: lists.autoSweepEnabled ? "1" : "0",
        autoHealJson: JSON.stringify(lists.autoHeal ?? {}),
        lastCombinedDate: effectiveLastDate,
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
    const pCfg = this.partyConfigs?.get(accountId);
    if (pCfg) {
      const names = pCfg.members.map((m) => m.name).filter(Boolean);
      await c.dispatch("set_party_config", {
        inviteFrom: pCfg.enabled && pCfg.role === "member" ? pCfg.leaderName : "",
        requestFromJson: JSON.stringify(pCfg.enabled && pCfg.role === "leader" ? names : []),
        role: pCfg.role,
        leaderName: pCfg.role === "member" ? pCfg.leaderName : "",
        membersJson: JSON.stringify(pCfg.role === "leader" ? names : []),
        escapeIfNotFullParty: pCfg.escapeIfNotFullParty ? "1" : "0",
      }).catch(() => {});
    }
  }

  /**
   * Tự động điểm danh ngày sau khi đăng nhập thành công: chờ server gửi bộ đếm ngày (55/01, ~vài giây sau login) rồi `daily_checkin` (ngày = bộ đếm + 1).
   * Chưa có bộ đếm ⇒ thử lại (tối đa 4 lần cách 3s); đã điểm danh hôm nay / đủ 28 ngày ⇒ server/engine báo trong tab Sự kiện, không thử lại.
   */
  private async autoCheckin(accountId: string, c: GameConnection) {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await sleep(4000);
    let checkinOk = false;
    for (let i = 0; i < 4; i++) {
      if (c.isOffline) return;
      try {
        const r = await c.dispatch("daily_checkin", undefined, { quiet: true });
        if (r.ok) {
          checkinOk = true;
          this.dailyChecklist?.recordProgress(accountId, "checkin", 1);
          this.pushCharacter?.(accountId);
          break;
        }
        if (!/chưa đọc được bộ đếm/.test(r.message ?? "")) { c.log("info", `📅 [Điểm danh tự động] ${r.message ?? "không thực hiện được"}`, "game"); break; }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/chưa đọc được bộ đếm/.test(msg)) { c.log("info", `📅 [Điểm danh tự động] ${msg}`, "game"); break; }
      }
      await sleep(3000);
    }
    if (!checkinOk) {
      c.log("warn", "📅 [Điểm danh tự động] chưa đọc được bộ đếm ngày từ server — bấm nút 📅 để điểm danh tay", "game");
    }

    // Tự động tặng quà bạn bè nếu trong ngày chưa tặng
    try {
      if (!c.isOffline && this.dailyChecklist) {
        const cl = this.dailyChecklist.get(accountId);
        const item = cl?.items?.["gift_friend"];
        if (!item || !item.done) {
          await sleep(1000);
          const r = await c.dispatch("friend_gift_all", undefined, { quiet: true });
          if (r.ok) {
            this.dailyChecklist.recordProgress(accountId, "gift_friend", 1);
            this.pushCharacter?.(accountId);
          }
        }
      }
    } catch {}
  }

  async logout(accountId: string): Promise<ConnectionInfo> {
    const c = this.get(accountId);
    await c.logout();
    return c.info();
  }

  async dispatch(accountId: string, action: string, params?: ActionParams): Promise<ActionResult> {
    const conn = this.get(accountId);
    // Chủ PT warp ⇒ thành viên trong đội warp theo (chạy song song); chuỗi warp của chủ tự chờ đủ đội ở bước {gather}.
    if (WARP_ACTIONS.has(action)) this.party.mirrorWarp(accountId, action, params);
    const res = await conn.dispatch(action, params);
    if (res.ok) {
      if (action === "friend_gift_all" || action === "friend_send_gift") {
        this.dailyChecklist?.recordProgress(accountId, "gift_friend", 1);
        this.pushCharacter?.(accountId);
      } else if (action === "pull_secret") {
        this.dailyChecklist?.recordProgress(accountId, "pull_secret", 1);
        this.pushCharacter?.(accountId);
      } else if (action === "pull_card") {
        this.dailyChecklist?.recordProgress(accountId, "pull_card", 1);
        this.pushCharacter?.(accountId);
      } else if (action === "pull_all") {
        this.dailyChecklist?.recordProgress(accountId, "pull_secret", 1);
        this.dailyChecklist?.recordProgress(accountId, "pull_card", 1);
        this.pushCharacter?.(accountId);
      } else if (action === "combine_item") {
        this.dailyChecklist?.recordProgress(accountId, "combine_item", 1);
        this.itemLists?.recordCombineToday(accountId);
        this.pushCharacter?.(accountId);
      } else if (action === "spin_lap_ba" || action === "xu_lap_ba") {
        this.dailyChecklist?.recordProgress(accountId, "xu_lap_ba", 1);
        this.pushCharacter?.(accountId);
      } else if (action === "daily_quest_claim" || action === "claim_daily_quests") {
        this.dailyChecklist?.recordProgress(accountId, "daily_quest_reward", 1);
        this.pushCharacter?.(accountId);
      } else if (action === "battle_pass_claim" || action === "claim_battle_pass") {
        this.dailyChecklist?.recordProgress(accountId, "battle_pass_reward", 1);
        this.pushCharacter?.(accountId);
      }
    }
    return res;
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
