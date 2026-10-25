import type { CharacterState } from "@tsbot/protocol";

/** Cầu nối giữa codec và SocketTransport. */
export interface CodecIO {
  /** Ghi bytes lên socket TCP đang mở. */
  send(data: Buffer): void;
  /** Cập nhật trạng thái nhân vật (gộp nông vào CharacterState hiện tại) → đẩy lên Web UI. */
  patchState(patch: Partial<CharacterState>): void;
  log(level: "debug" | "info" | "warn" | "error", msg: string): void;
  /** Sự kiện game dạng đọc được (hiện ở tab "Sự kiện" của UI), không kèm tiền tố kỹ thuật. */
  game(msg: string): void;
}

/**
 * Một phiên giao thức trên 1 socket. ĐÂY là nơi chứa mọi hiểu biết về giao thức game
 * (đóng gói, mã hoá, login, parse packet) — bạn tự triển khai dựa trên tài liệu/giao thức của bạn.
 */
export interface CodecSession {
  /** Nhận chunk byte thô từ socket (codec tự ghép/tách frame, tự parse, gọi io.patchState). */
  onData(chunk: Buffer): void;
  /** Thực hiện handshake + đăng nhập; resolve khi đã vào game (online), reject nếu sai/timeout. */
  login(creds: { server: string; username: string; password: string }, signal: AbortSignal): Promise<void>;
  /** Gói heartbeat/ping; null = giao thức không cần (TCP keep-alive là đủ). */
  heartbeat(): Buffer | null;
  /** Đóng gói 1 action (warp_map, move, ...). Trả null nếu codec chưa hỗ trợ action này. */
  encodeAction(name: string, args: string[]): Buffer | null;
  /** Thực thi action nâng cao/bất đồng bộ nhiều bước. Trả CommandResult hoặc null nếu không xử lý. */
  executeAction?(name: string, args: string[], write: (b: Buffer) => void, signal: AbortSignal): Promise<{ ok: boolean; message?: string } | null>;
  /** Bọc bytes của lệnh `packet <hex>` (mặc định gửi nguyên văn). */
  encodeRaw?(bytes: Buffer): Buffer;
  /** Chờ sự kiện game (await_battle...). Không có = codec không hỗ trợ await_*. */
  waitFor?(kind: string, args: string[], timeoutMs: number, signal: AbortSignal): Promise<void>;
  /** Gói đăng xuất (tuỳ chọn). */
  logout?(): Buffer | null;
}

export interface ProtocolCodec {
  name: string;
  description: string;
  create(io: CodecIO): CodecSession;
}
