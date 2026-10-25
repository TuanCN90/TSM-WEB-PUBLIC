import { Socket, connect } from "node:net";
import type { CharacterState } from "@tsbot/protocol";
import { AbortError, LoginRejectedError } from "../abortable";
import type { CommandResult, GameCommand, Transport, TransportContext, TransportDriver, WaitKind } from "../Transport";
import type { CodecSession, ProtocolCodec } from "./codec";
import { getCodec } from "./codecs";

const CONNECT_TIMEOUT_MS = 10_000;
const LOGIN_TIMEOUT_MS = 10_000;

const emptyUnit = { name: "", level: 0, hp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, exp: 0 };
const initialState = (): CharacterState => ({
  player: { ...emptyUnit }, pet: { ...emptyUnit }, economy: { xu: 0, gold: 0 },
  party: { members: [1, 2, 3, 4, 5].map((slot) => ({ slot, name: "", isLeader: false, isAdvisor: false })), inviteStatus: "" },
  location: { map: 0, x: 0, y: 0, channel: 0, channels: [] }, inBattle: false, auto: false, bag: [],
});

/**
 * Kết nối TCP thật tới server game (module `net` của Node). Giao thức cụ thể nằm ở `ProtocolCodec`.
 * SocketTransport lo: mở/đóng socket, keep-alive TCP, timeout, phát hiện ngắt kết nối, chuyển lệnh qua codec.
 */
export class SocketTransport implements Transport {
  readonly name = "socket";
  private socket?: Socket;
  private session?: CodecSession;
  private state = initialState();
  private connected = false;
  private listeners = new Set<(s: CharacterState) => void>();
  private dropListeners = new Set<(r: string) => void>();
  private ctx!: TransportContext;

  constructor(private codec: ProtocolCodec) {}

  async connect(ctx: TransportContext): Promise<void> {
    this.ctx = ctx;
    const ep = ctx.endpoint;
    if (!ep) throw new Error(`Server '${ctx.credentials.server}' chưa có địa chỉ host:port (Tài khoản → Quản lý danh sách server: "Tên | host:port")`);
    this.teardown();
    this.state = this.state.player.name ? this.state : initialState();

    ctx.log("info", `[socket] TCP ${ep.host}:${ep.port} (codec ${this.codec.name})`);
    const sock = await new Promise<Socket>((resolve, reject) => {
      const s = connect({ host: ep.host, port: ep.port });
      const t = setTimeout(() => { s.destroy(); reject(new Error(`Hết thời gian kết nối ${CONNECT_TIMEOUT_MS / 1000}s`)); }, CONNECT_TIMEOUT_MS);
      s.once("connect", () => { clearTimeout(t); resolve(s); });
      s.once("error", (e) => { clearTimeout(t); reject(e); });
    });
    sock.setKeepAlive(true, 30_000);
    sock.setNoDelay(true);
    this.socket = sock;

    this.session = this.codec.create({
      send: (d) => this.write(d),
      patchState: (p) => this.emit(p),
      log: (l, m) => ctx.log(l, `[${this.codec.name}] ${m}`),
      game: (m) => ctx.log("info", m, "game"),
    });
    sock.on("data", (chunk) => {
      try { this.session?.onData(chunk); } catch (e) { ctx.log("error", `[socket] lỗi parse: ${e instanceof Error ? e.message : e}`); }
    });
    sock.on("error", (e) => this.dropped(`lỗi socket: ${e.message}`));
    sock.on("close", () => this.dropped("server đóng kết nối"));

    const ac = new AbortController();
    let socketClosedEarly = false;
    const onEarlyDrop = () => {
      socketClosedEarly = true;
      ac.abort();
    };
    sock.once("close", onEarlyDrop);
    sock.once("error", onEarlyDrop);
    const timer = setTimeout(() => ac.abort(), LOGIN_TIMEOUT_MS);
    try {
      await this.session.login(ctx.credentials, ac.signal);
    } catch (e) {
      this.teardown();
      if (socketClosedEarly) {
        throw new LoginRejectedError("Server đóng kết nối khi đang bắt tay đăng nhập (phiên cũ chưa thoát hoặc server quá tải)");
      }
      if (ac.signal.aborted) throw new LoginRejectedError(`Đăng nhập quá ${LOGIN_TIMEOUT_MS / 1000}s`);
      throw e;
    } finally {
      sock.off("close", onEarlyDrop);
      sock.off("error", onEarlyDrop);
      clearTimeout(timer);
    }
    this.connected = true;
    ctx.log("info", "[socket] đăng nhập xong");
  }

  private write(d: Buffer) {
    if (!this.socket || this.socket.destroyed) throw new Error("Socket đã đóng");
    this.socket.write(d);
  }

  private dropped(reason: string) {
    const was = this.connected;
    this.teardown();
    if (was) this.dropListeners.forEach((cb) => cb(reason));
  }

  private teardown() {
    this.connected = false;
    const s = this.socket;
    this.socket = undefined;
    this.session = undefined;
    s?.removeAllListeners();
    s?.on("error", () => {}); // nuốt lỗi muộn
    s?.destroy();
  }

  async disconnect(): Promise<void> {
    try {
      const bye = this.session?.logout?.();
      if (bye) this.write(bye);
    } catch { /* socket có thể đã chết */ }
    this.teardown();
    this.ctx?.log("info", "[socket] đã ngắt");
  }

  async execute(cmd: GameCommand, _signal: AbortSignal): Promise<CommandResult> {
    if (!this.connected || !this.session) throw new Error("Chưa kết nối tới game");
    if (cmd.type === "RawPacket") {
      const bytes = Buffer.from(cmd.hex, "hex");
      this.write(this.session.encodeRaw ? this.session.encodeRaw(bytes) : bytes);
      return { ok: true };
    }
    if (cmd.name === "heartbeat") {
      const hb = this.session.heartbeat();
      if (hb) this.write(hb);
      return { ok: true };
    }
    if (this.session.executeAction) {
      const res = await this.session.executeAction(cmd.name, cmd.args, (b) => this.write(b), _signal);
      if (res !== null) return res;
    }
    const buf = this.session.encodeAction(cmd.name, cmd.args);
    if (!buf) return { ok: false, message: `Chức năng '${cmd.name}' chưa có gói tin (codec '${this.codec.name}'); cần capture thao tác tương ứng từ tool gốc` };
    if (buf.length) this.write(buf);
    return { ok: true };
  }

  async waitFor(kind: WaitKind, args: string[], timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (!this.connected || !this.session) throw new Error("Chưa kết nối tới game");
    if (!this.session.waitFor) throw new Error(`Codec '${this.codec.name}' chưa hỗ trợ await_${kind}`);
    if (signal.aborted) throw new AbortError();
    await this.session.waitFor(kind, args, timeoutMs, signal);
  }

  private emit(patch: Partial<CharacterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((cb) => cb(this.state));
  }
  getState() { return this.state; }
  onState(cb: (s: CharacterState) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  onDisconnect(cb: (r: string) => void) { this.dropListeners.add(cb); return () => this.dropListeners.delete(cb); }
}

export const socketDriver: TransportDriver = {
  name: "socket",
  description: "TCP thật tới server game (giao thức do codec quyết định)",
  create: ({ codec } = {}) => {
    const c = getCodec(codec ?? "raw-tcp");
    if (!c) throw new Error(`Codec '${codec}' chưa đăng ký`);
    return new SocketTransport(c);
  },
};
