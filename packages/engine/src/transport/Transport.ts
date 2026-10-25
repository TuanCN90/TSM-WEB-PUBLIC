import type { CharacterState } from "@tsbot/protocol";

/** Lệnh cấp cao interpreter / live dispatcher phát ra cho driver. */
export type GameCommand =
  | { type: "RawPacket"; hex: string }
  | { type: "Action"; name: string; args: string[] };

export type WaitKind = "battle" | "dialog" | "party" | "item" | "map";

export interface CommandResult {
  ok: boolean;
  message?: string;
}

export interface TransportContext {
  accountId: string;
  /** Thông tin đăng nhập để driver tự dùng (Mock bỏ qua). */
  credentials: { server: string; username: string; password: string };
  log: (level: "debug" | "info" | "warn" | "error", msg: string, src?: "game") => void;
  /** Hệ số tua nhanh thời gian (chỉ Mock dùng). */
  speed: number;
  /** Địa chỉ TCP của server đã chọn (từ danh sách server), nếu có. */
  endpoint?: { host: string; port: number };
}

/**
 * Giao diện driver, 1 instance = 1 kết nối bền vững của 1 tài khoản.
 *  - connect(): đăng nhập và giữ kết nối mở. Có thể được gọi lại sau khi mất kết nối (reconnect).
 *  - Heartbeat: engine gọi định kỳ execute({type:"Action", name:"heartbeat"}); driver trả ok:false/ném lỗi nếu chết.
 *  - Mất kết nối bất ngờ: driver gọi các callback đăng ký qua onDisconnect().
 *  - execute()/waitFor() có thể được gọi đồng thời (script + live action); driver tự tuần tự hoá nếu cần.
 */
export interface Transport {
  readonly name: string;
  connect(ctx: TransportContext): Promise<void>;
  /** Đăng xuất chủ động. */
  disconnect(): Promise<void>;
  execute(cmd: GameCommand, signal: AbortSignal): Promise<CommandResult>;
  /** Chờ một sự kiện game; reject khi timeout/abort. */
  waitFor(kind: WaitKind, args: string[], timeoutMs: number, signal: AbortSignal): Promise<void>;
  getState(): CharacterState;
  onState(cb: (s: CharacterState) => void): () => void;
  onDisconnect(cb: (reason: string) => void): () => void;
}

export interface TransportDriver {
  name: string;
  description: string;
  create(opts?: { codec?: string }): Transport;
}
