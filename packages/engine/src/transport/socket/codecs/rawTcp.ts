import type { ProtocolCodec } from "../codec";

/**
 * "raw-tcp": chỉ mở TCP và chuyển nguyên văn bytes.
 *  - KHÔNG tự đăng nhập, KHÔNG parse trạng thái (nhân vật hiện rỗng).
 *  - Bạn tự gửi packet (kể cả login, lấy từ nguồn hợp lệ của bạn) bằng lệnh `packet <hex>` hoặc action "packet".
 *  - Dữ liệu server trả về được ghi vào log ở mức debug dưới dạng hex.
 * Dùng để thử đường truyền / phân tích giao thức của chính bạn trước khi viết codec thật.
 */
export const rawTcpCodec: ProtocolCodec = {
  name: "raw-tcp",
  description: "Chỉ mở TCP, gửi/nhận hex nguyên văn; không login, không parse trạng thái",
  create: (io) => ({
    onData: (chunk) => io.log("debug", `◀ ${chunk.length}B ${chunk.subarray(0, 48).toString("hex")}${chunk.length > 48 ? "…" : ""}`),
    login: async () => io.log("warn", "raw-tcp: đã mở TCP nhưng CHƯA đăng nhập — hãy gửi gói login bằng `packet <hex>`"),
    heartbeat: () => null,
    encodeAction: () => null,
  }),
};
