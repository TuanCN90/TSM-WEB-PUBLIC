import type { ActionParams, ActionResult, CharacterState, ConnectionInfo, ConnectionState, LogEntry, LogLevel, LogSource, ScriptRunInfo, StepInfo } from "@tsbot/protocol";
import { parse } from "../dsl/parser";
import { AbortError, LoginRejectedError, sleep } from "../transport/abortable";
import type { Transport, TransportDriver } from "../transport/Transport";
import { MSG } from "../data/messages";
import { run } from "./interpreter";
import { EngineError, buildCommand, buildSteps } from "./liveActions";

export interface ConnectionOptions {
  accountId: string;
  onChange: (c: ConnectionInfo) => void;
  onLog: (e: LogEntry) => void;
  /** Gọi mỗi khi transport báo đổi trạng thái nhân vật. */
  onCharacter: (c: CharacterState) => void;
  maxLogs?: number;
  /** Thời điểm đóng socket gần nhất (ms) đã lưu từ lần chạy trước — để cooldown còn đúng sau khi restart. */
  lastClosedAt?: number;
  /** Gọi mỗi khi socket bị đóng, để lưu lại thời điểm. */
  onClosed?: (ts: number) => void;
  /** Gọi khi kết nối online (hoặc reconnect thành công). */
  onOnline?: (reconnected: boolean) => void;
  /** Gọi khi mất kết nối bất ngờ (disconnect). */
  onDrop?: (reason: string, details?: { characterName?: string; mapId?: number }) => void;
}

export interface LoginParams {
  driver: TransportDriver;
  credentials: { server: string; username: string; password: string };
  speed: number;
  endpoint?: { host: string; port: number };
  /** Tên codec cho transport "socket". */
  codec?: string;
  commandTimeoutMs: number;
  logLevel: LogLevel;
  heartbeatMs: number;
  autoReconnect: boolean;
  maxReconnect: number;
  /** Chờ trước lần reconnect đầu (nhân đôi mỗi lần, tối đa 30s). */
  reconnectBaseMs?: number;
  /** Chờ giữa các lần thử lại khi server từ chối login (mặc định 10s, 20s, 30s → tối đa 4 lần thử). */
  loginRetryDelaysMs?: number[];
}

// Giãn cách thử lại khi server tạm thời từ chối hoặc đang giải phóng phiên cũ (1.5s, 3s, 5s)
const DEFAULT_LOGIN_RETRY_MS = [1500, 3000, 5000];
/** Vừa đóng socket chưa quá ngần này ms thì chờ nhẹ để server giải phóng socket cũ, tránh bị kẹt quá lâu (3s). */
const SESSION_COOLDOWN_MS = 3_000;
/** Reconnect tự động: chờ 10s, 20s, 30s... — không relog dồn dập vì server có thể chặn. */
/** Chu kỳ đẩy lại trạng thái nhân vật mới nhất lên UI khi online (không gửi thêm packet nào lên server). */
const SYNC_INTERVAL_MS = 3000;
const DEFAULT_RECONNECT_BASE_MS = 10_000;

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Kết nối bền vững của 1 tài khoản (Stateful Session).
 *   login()  → connecting → online (heartbeat liên tục) ; chỉ rời online khi logout() hoặc mất kết nối.
 *   mất kết nối bất ngờ → reconnecting (tự thử lại) → online | offline (hết lượt thử).
 * Trong lúc online có 2 cách điều khiển, độc lập với vòng đời kết nối:
 *   dispatch()   – Live Action Dispatcher: lệnh tức thời (warp_map, move, ...).
 *   runScript()  – Script Runner: chạy kịch bản trên kết nối đang có; script xong KHÔNG logout.
 */
export class GameConnection {
  private state: ConnectionState = "offline";
  private error?: string;
  private transport?: Transport;
  private params?: LoginParams;
  private transportName = "";
  private speed = 1;
  private reconnectAttempt = 0;
  private connectedAt?: number;
  private lastHeartbeat?: number;
  private life?: AbortController; // sống trong 1 giai đoạn online
  private hbTimer?: ReturnType<typeof setTimeout>;
  private syncTimer?: ReturnType<typeof setInterval>;
  private reconnectAbort?: AbortController;
  private loginAbort?: AbortController;
  private lastClosedAt: number;
  private unsubs: Array<() => void> = [];
  private seq = 0;
  readonly logs: LogEntry[] = [];

  // script
  private script: ScriptRunInfo = { state: "idle" };
  private scriptAbort?: AbortController;
  private scriptResume?: () => void;
  private scriptPause?: Promise<void>;

  constructor(private o: ConnectionOptions) {
    this.lastClosedAt = o.lastClosedAt ?? 0;
  }

  get accountId() { return this.o.accountId; }
  get isOffline() { return this.state === "offline"; }
  /**
   * Hook chờ gom đội (do PartyService gắn cho tài khoản chủ PT). Gọi ở bước `{ gather }` của chuỗi warp:
   * resolve ok=false ⇒ dừng chuỗi (không đi bộ khi thiếu đội vì sẽ thua trận bắt buộc).
   */
  partyGate?: (reason: string, signal: AbortSignal) => Promise<{ ok: boolean; message?: string }>;

  info(): ConnectionInfo {
    return {
      accountId: this.o.accountId, transport: this.transportName, speed: this.speed, state: this.state,
      error: this.error, reconnectAttempt: this.reconnectAttempt || undefined,
      connectedAt: this.connectedAt, lastHeartbeat: this.lastHeartbeat,
      script: this.script,
    };
  }
  private emit() { this.o.onChange(this.info()); }
  /** Trạng thái nhân vật hiện tại (undefined khi chưa từng login). */
  character(): CharacterState | undefined { return this.transport?.getState(); }
  private setState(s: ConnectionState) { this.state = s; this.emit(); }

  log(level: LogLevel, msg: string, src: LogSource = "conn", line?: number) {
    if (LEVELS[level] < LEVELS[this.params?.logLevel ?? "info"]) return;
    const entry: LogEntry = { seq: ++this.seq, ts: Date.now(), level, src, msg, line };
    this.logs.push(entry);
    if (this.logs.length > (this.o.maxLogs ?? 5000)) this.logs.shift();
    this.o.onLog(entry);
  }

  /* ---------------- vòng đời ---------------- */

  async login(p: LoginParams): Promise<void> {
    if (this.state !== "offline") throw new EngineError(409, `Kết nối đang ở trạng thái '${this.state}'`);
    this.params = p;
    this.transportName = p.driver.name;
    this.speed = p.speed;
    try {
      this.transport = p.driver.create({ codec: p.codec });
    } catch (e) {
      throw new EngineError(400, msgOf(e));
    }
    this.error = undefined;
    this.reconnectAttempt = 0;
    this.script = { state: "idle" };
    this.setState("connecting");
    this.log("info", `Đăng nhập ${p.credentials.username} @ ${p.credentials.server} (${p.driver.name})`);
    try {
      await this.connectWithRetry();
    } catch (e) {
      if (e instanceof AbortError) {
        this.cleanupTransport();
        throw new EngineError(409, "Đã huỷ đăng nhập");
      }
      this.error = msgOf(e);
      this.log("error", `Đăng nhập thất bại: ${this.error}`);
      this.evt(MSG.loginFailed(this.error), "error");
      this.cleanupTransport();
      this.setState("offline");
      throw new EngineError(409, `Đăng nhập thất bại: ${this.error}`);
    }
    this.goOnline();
  }

  /** Server hay từ chối login khi phiên cũ chưa được giải phóng → thử lại có giãn cách thay vì báo lỗi ngay. */
  private async connectWithRetry() {
    const delays = this.params!.loginRetryDelaysMs ?? DEFAULT_LOGIN_RETRY_MS;
    const ac = (this.loginAbort = new AbortController());
    try {
      const cool = SESSION_COOLDOWN_MS - (Date.now() - this.lastClosedAt);
      if (cool > 0) {
        this.evt(MSG.cooldown(Math.ceil(cool / 1000)));
        this.log("info", `Vừa ngắt kết nối — chờ ${Math.ceil(cool / 1000)}s để server giải phóng phiên cũ rồi mới đăng nhập (tránh bị chặn relog)`);
        await sleep(cool, ac.signal);
      }
      for (let n = 0; ; n++) {
        try {
          return await this.connectTransport();
        } catch (e) {
          if (!(e instanceof LoginRejectedError) || n >= delays.length) throw e;
          this.log("warn", `${e.message} — thử lại ${n + 2}/${delays.length + 1} sau ${delays[n]! / 1000}s`);
          this.evt(MSG.retryLogin(n + 2, delays.length + 1, delays[n]! / 1000), "warn");
          await sleep(delays[n]!, ac.signal);
        }
      }
    } finally {
      this.loginAbort = undefined;
    }
  }

  /** Sự kiện kết nối dạng đọc được → tab "Sự kiện" trên UI. */
  private evt(msg: string, level: LogLevel = "info") {
    this.log(level, msg, "game");
  }

  private markClosed() {
    this.lastClosedAt = Date.now();
    this.o.onClosed?.(this.lastClosedAt);
  }

  private async connectTransport() {
    const p = this.params!;
    const t = this.transport!;
    await t.connect({ accountId: this.o.accountId, credentials: p.credentials, speed: p.speed, endpoint: p.endpoint, log: (l, m, src) => this.log(l, m, src ?? "conn") });
  }

  private goOnline(reconnected = false) {
    const t = this.transport!;
    this.life = new AbortController();
    this.connectedAt = Date.now();
    this.error = undefined;
    this.reconnectAttempt = 0;
    this.o.onCharacter(t.getState());
    this.unsubs.push(t.onState((c) => this.o.onCharacter(c)), t.onDisconnect((r) => this.handleDrop(r)));
    this.log("info", "ONLINE");
    this.evt(reconnected ? MSG.reconnected : MSG.loggedIn);
    this.setState("online");
    this.syncTimer = setInterval(() => { if (this.state === "online") this.o.onCharacter(t.getState()); }, SYNC_INTERVAL_MS);
    this.scheduleHeartbeat();
    if (this.o.onOnline) {
      setTimeout(() => {
        if (this.state === "online") {
          this.o.onOnline?.(reconnected);
        }
      }, 50);
    }
  }

  private scheduleHeartbeat() {
    const every = Math.max(1000, this.params!.heartbeatMs);
    this.hbTimer = setTimeout(async () => {
      if (this.state !== "online") return;
      try {
        const r = await this.transport!.execute({ type: "Action", name: "heartbeat", args: [] }, this.life!.signal);
        if (!r.ok) throw new Error(r.message ?? "heartbeat thất bại");
        this.lastHeartbeat = Date.now();
        this.log("debug", "heartbeat");
        this.emit();
        this.scheduleHeartbeat();
      } catch (e) {
        if (this.state === "online") this.handleDrop(`heartbeat lỗi: ${msgOf(e)}`);
      }
    }, every);
  }

  private stopLife() {
    clearTimeout(this.hbTimer);
    clearInterval(this.syncTimer);
    this.life?.abort();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  private cleanupTransport() {
    this.stopLife();
    this.connectedAt = undefined;
  }

  /** Mất kết nối ngoài ý muốn → huỷ script, thử reconnect nếu bật. */
  private handleDrop(reason: string) {
    if (this.state !== "online") return;
    const ch = this.transport?.getState();
    const charDetails = ch ? { characterName: ch.player?.name, mapId: ch.location?.map } : undefined;
    this.markClosed();
    this.log("warn", `Mất kết nối: ${reason}`);
    this.evt(MSG.dropped(reason), "warn");
    this.abortScript("Mất kết nối giữa chừng");
    this.cleanupTransport();
    this.o.onDrop?.(reason, charDetails);
    const p = this.params!;
    if (!p.autoReconnect || p.maxReconnect < 1) {
      this.error = reason;
      this.setState("offline");
      return;
    }
    void this.reconnectLoop(reason);
  }

  private async reconnectLoop(reason: string) {
    const p = this.params!;
    this.reconnectAbort = new AbortController();
    const signal = this.reconnectAbort.signal;
    this.setState("reconnecting");
    for (let n = 1; n <= p.maxReconnect; n++) {
      this.reconnectAttempt = n;
      const wait = Math.min(30_000, (p.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS) * 2 ** (n - 1));
      this.log("info", `Reconnect lần ${n}/${p.maxReconnect} sau ${Math.round(wait / 100) / 10}s`);
      this.evt(MSG.reconnecting(n, p.maxReconnect, wait));
      this.emit();
      try {
        await sleep(wait, signal);
        await this.connectTransport();
        if (signal.aborted) return;
        this.log("info", "Reconnect thành công");
        this.goOnline(true);
        return;
      } catch (e) {
        if (signal.aborted || e instanceof AbortError) return;
        this.log("warn", `Reconnect lần ${n} thất bại: ${msgOf(e)}`);
        this.evt(MSG.reconnectFailed(n, msgOf(e)), "warn");
      }
    }
    this.error = `Mất kết nối (${reason}); reconnect ${p.maxReconnect} lần không được`;
    this.log("error", this.error);
    this.evt(MSG.gaveUp(p.maxReconnect), "error");
    this.reconnectAttempt = 0;
    this.setState("offline");
  }

  /** Đăng xuất chủ động (Logout/Disconnect). */
  async logout(): Promise<void> {
    if (this.state === "offline" || this.state === "disconnecting") return;
    const wasReconnecting = this.state === "reconnecting";
    const wasOnline = this.state === "online";
    if (wasOnline && this.transport) {
      // Trước khi ngắt kết nối, gửi đóng kho và xác nhận thoại (1e/08 + 14/06)
      // để máy chủ cam kết lưu (commit) dữ liệu kho/túi vào Database, tránh tình trạng rollback vật phẩm
      try {
        await this.transport.execute({ type: "Action", name: "close_bank", args: [] }, AbortSignal.timeout(1000)).catch(() => {});
        await new Promise((r) => setTimeout(r, 100));
        await this.transport.execute({ type: "Action", name: "ready_1406", args: [] }, AbortSignal.timeout(1000)).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
      } catch {}
    }
    this.setState("disconnecting");
    this.reconnectAbort?.abort();
    this.loginAbort?.abort();
    this.abortScript("Đã đăng xuất");
    this.cleanupTransport();
    if (!wasReconnecting) await this.transport?.disconnect().catch(() => {});
    this.markClosed();
    this.reconnectAttempt = 0;
    this.error = undefined;
    this.log("info", "Đã đăng xuất (OFFLINE)");
    this.evt(MSG.loggedOut);
    this.setState("offline");
  }

  /* ---------------- Live Action Dispatcher ---------------- */

  /** `quiet`: dùng cho thăm dò định kỳ (vd PartyService thử mời) — chỉ ghi mức debug để không làm ngập log. */
  async dispatch(action: string, params?: ActionParams, opts: { quiet?: boolean } = {}): Promise<ActionResult> {
    buildCommand(action, params); // kiểm tra tên action + tham số (400) trước khi xét trạng thái
    if (this.state !== "online") throw new EngineError(409, `Chưa online (trạng thái: ${this.state})`);
    const steps = buildSteps(action, params, { map: this.transport!.getState().location.map });
    const label = `${action}${params && Object.keys(params).length ? " " + Object.values(params).join(",") : ""}`;
    const speed = this.params?.speed ?? 1;
    this.log(opts.quiet ? "debug" : "info", `▶ ${label}`, "action");
    try {
      let r: ActionResult = { ok: true };
      for (const step of steps) {
        if ("end" in step) { r = step.end; break; }
        if ("gather" in step) {
          // Chốt chặn đội ngũ (chỉ có hook khi tài khoản là chủ PT đang bật lập đội) — xem PartyService.gather
          if (this.partyGate) {
            const g = await this.partyGate(step.reason, this.life!.signal);
            if (!g.ok) { r = { ok: false, message: g.message ?? "Chưa đủ đội" }; break; }
          }
          continue;
        }
        r = await this.transport!.execute(step.cmd, this.life!.signal);
        if (!r.ok) break;

        if (step.expectMap && this.transport!.getState().location.map !== step.expectMap) {
          const targetMap = step.expectMap;
          const arrived = await this.waitForMap(targetMap, 6000 / Math.max(speed, 0.01), this.life!.signal);
          if (!arrived) {
            const inBattle = this.transport!.getState().inBattle;
            const reason = inBattle ? "vào trận đấu" : `chưa tới map ${targetMap}`;
            this.log("warn", `Dừng chuỗi di chuyển (${reason})`, "action");
            r = { ok: false, message: `Dừng chuỗi di chuyển (${reason})` };
            break;
          }
        }

        if (step.afterMs) await sleep(step.afterMs / Math.max(speed, 0.01), this.life!.signal);
      }
      this.log(opts.quiet ? "debug" : r.ok ? "info" : "warn", `${r.ok ? "✓" : "✗"} ${label}${r.message ? ` – ${r.message}` : ""}`, "action");
      return r;
    } catch (e) {
      this.log("error", `✗ ${label} – ${msgOf(e)}`, "action");
      return { ok: false, message: msgOf(e) };
    }
  }

  private async waitForMap(targetMap: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (this.transport?.getState().location.map === targetMap) return true;
    if (this.transport?.name === "mock") return true;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsub();
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => { cleanup(); resolve(false); };
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const unsub = this.transport!.onState((st) => {
        if (st.location.map === targetMap) {
          cleanup();
          resolve(true);
        } else if (st.inBattle) {
          cleanup();
          resolve(false);
        }
      });
    });
  }

  /* ---------------- Script Runner (trên kết nối đang online) ---------------- */

  private get scriptActive() { return ["running", "paused", "stopping"].includes(this.script.state); }

  runScript(scriptId: string, source: string, vars?: Record<string, string>): void {
    this.assertCanRun();
    const done = this.beginScript(scriptId, source, vars);
    void done.then((r) => this.endScript(r.state, r.error));
  }

  /** Hàng đợi nhiều script: chạy tuần tự; script lỗi chỉ ghi log rồi chuyển sang script kế tiếp. Dừng = huỷ bước dở + xoá phần còn lại. */
  runQueue(items: { scriptId: string; source: string }[], vars?: Record<string, string>): void {
    this.assertCanRun();
    if (!items.length) throw new EngineError(400, "Hàng đợi trống");
    const total = items.length;
    const names = items.map((i) => i.scriptId);
    this.queueCancelled = false;
    // Đặt trạng thái "running" ngay để UI khoá liền, không chờ vòng lặp bất đồng bộ.
    void (async () => {
      let failed = 0;
      for (let i = 0; i < total; i++) {
        if (this.queueCancelled) break;
        const it = items[i]!;
        const queue = { index: i + 1, total, names };
        let r: { state: ScriptRunInfo["state"]; error?: string };
        try {
          r = await this.beginScript(it.scriptId, it.source, vars, queue);
        } catch (e) {
          r = { state: "error", error: msgOf(e) };
          this.log("error", r.error!, "script");
        }
        if (this.queueCancelled || r.state === "stopped") break;
        if (r.state === "error") {
          failed++;
          const more = i + 1 < total;
          this.log("warn", `[Lỗi kịch bản ${it.scriptId}] -> ${more ? "Chuyển sang kịch bản tiếp theo..." : "Hết hàng đợi."}`, "script");
        }
      }
      const cancelled = this.queueCancelled;
      this.queueCancelled = false;
      if (cancelled) this.endScript("stopped");
      else {
        this.log("info", `Hàng đợi hoàn tất${failed ? ` (${failed}/${total} kịch bản lỗi)` : ""} — vẫn ONLINE`, "script");
        this.endScript("completed", failed ? `Lỗi ở ${failed}/${total} kịch bản` : undefined);
      }
    })();
  }

  private queueCancelled = false;

  private assertCanRun() {
    if (this.state !== "online") throw new EngineError(409, "Cần đăng nhập (online) trước khi chạy script");
    if (this.scriptActive) throw new EngineError(409, "Đang có script chạy");
  }

  /** Chạy một script; KHÔNG tự đặt trạng thái kết thúc (người gọi quyết định). Lỗi parse ném ngay. */
  private beginScript(scriptId: string, source: string, vars?: Record<string, string>, queue?: { index: number; total: number; names: string[] }): Promise<{ state: ScriptRunInfo["state"]; error?: string }> {
    const { nodes, diagnostics } = parse(source);
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length) throw new EngineError(400, `Script có ${errors.length} lỗi (dòng ${errors[0].line}: ${errors[0].message})`);
    for (const d of diagnostics) this.log("warn", d.message, "script", d.line);

    const abort = new AbortController();
    this.scriptAbort = abort;
    this.scriptResume?.();
    this.scriptPause = undefined;
    this.script = { state: "running", scriptId, startedAt: Date.now(), queue };
    this.emit();
    this.log("info", `Chạy script '${scriptId}'${queue ? ` (${queue.index}/${queue.total})` : ""}`, "script");
    const p = this.params!;
    return (async () => {
      try {
        await run(nodes, {
          transport: this.transport!, signal: abort.signal, speed: p.speed, vars, commandTimeoutMs: p.commandTimeoutMs,
          gate: () => this.scriptPause ?? Promise.resolve(),
          log: (l, m, line) => this.log(l, m, "script", line),
          onStep: (s: StepInfo) => { this.script = { ...this.script, step: s }; this.emit(); },
        });
        this.log("info", queue ? `Script '${scriptId}' hoàn tất` : "Script hoàn tất — vẫn ONLINE", "script");
        return { state: "completed" as const };
      } catch (e) {
        if (abort.signal.aborted || e instanceof AbortError) return { state: "stopped" as const };
        const err = msgOf(e);
        this.log("error", err, "script", this.script.step?.line);
        return { state: "error" as const, error: err };
      }
    })();
  }

  private endScript(state: ScriptRunInfo["state"], error?: string) {
    this.scriptResume?.();
    this.scriptPause = undefined;
    this.script = { ...this.script, state, error, endedAt: Date.now() };
    this.emit();
  }

  private abortScript(why: string) {
    if (!this.scriptActive) return;
    this.log("warn", `Script bị huỷ: ${why}`, "script");
    this.queueCancelled = true;
    this.scriptAbort?.abort();
    this.scriptResume?.();
  }

  pauseScript() {
    if (this.script.state !== "running") return;
    this.scriptPause = new Promise<void>((r) => (this.scriptResume = r));
    this.log("info", "Tạm dừng script", "script");
    this.script = { ...this.script, state: "paused" };
    this.emit();
  }
  resumeScript() {
    if (this.script.state !== "paused") return;
    this.scriptResume?.();
    this.scriptPause = undefined;
    this.log("info", "Tiếp tục script", "script");
    this.script = { ...this.script, state: "running" };
    this.emit();
  }
  stopScript() {
    if (!this.scriptActive) return;
    if (this.script.queue) this.log("warn", "Đã dừng thực thi kịch bản bởi người dùng", "script");
    this.queueCancelled = true;
    this.script = { ...this.script, state: "stopping" };
    this.emit();
    this.scriptAbort?.abort();
    this.scriptResume?.();
  }
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
