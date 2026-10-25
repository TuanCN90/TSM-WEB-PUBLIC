import type { ProtocolCodec } from "../codec";
import { rawTcpCodec } from "./rawTcp";
import { tsOnlineCodec } from "./tsOnline";

/**
 * Đăng ký codec tại đây. Để thêm giao thức thật của bạn:
 *   1. Tạo file mới export một `ProtocolCodec` (xem ../codec.ts).
 *   2. Thêm vào mảng dưới, rồi chọn tên codec ở tab Cài đặt.
 */
export const codecs: ProtocolCodec[] = [rawTcpCodec, tsOnlineCodec];

export const getCodec = (name: string) => codecs.find((c) => c.name === name);
