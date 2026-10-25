import { mockDriver } from "../MockTransport";
import { socketDriver } from "../socket/SocketTransport";
import type { TransportDriver } from "../Transport";

/**
 * Đăng ký driver tại đây. Để cắm driver của bạn:
 *   1. Tạo file mới implements `Transport` (xem Transport.ts).
 *   2. Export 1 `TransportDriver` rồi thêm vào mảng bên dưới.
 */
export const drivers: TransportDriver[] = [mockDriver, socketDriver];

export function getDriver(name: string): TransportDriver | undefined {
  return drivers.find((d) => d.name === name);
}
