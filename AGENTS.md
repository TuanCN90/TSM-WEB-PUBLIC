# QUY TẮC PHÁT TRIỂN DỰ ÁN (PROJECT RULES) - TS-BOT-WEB

## 1. CẬP NHẬT TIẾN ĐỘ VÀO TRANG HOME (BẮT BUỘC)
- Trang chủ (`apps/web/src/pages/Overview.tsx`) là **lưới nút các tính năng đã hoàn thiện và dùng được**; bấm nút mở popup mô tả logic + ràng buộc.
- **Sau mỗi lần cập nhật tính năng**: thêm mục mới hoặc sửa mục tương ứng trong mảng `FEATURES` (icon, tên, màu, summary, `logic`, `rules`).
  - Chỉ thêm tính năng chính, dùng được; ràng buộc nhỏ ghi trong `rules` của popup, không tạo nút riêng.
  - Không đưa tính năng đang dở/chưa dùng được lên trang chủ; không dùng danh sách thông báo theo ngày.

## 2. NGUYÊN TẮC PHÂN LẬP ĐA TÀI KHOẢN (MULTI-ACCOUNT ISOLATION)
- Tất cả cấu hình, danh sách tự động (tự mở, tự bán, tự hợp, phân giải, đóng góp, vứt bỏ, ngoại lệ, kịch bản) phải phân lập độc lập 100% giữa các tài khoản.
- Chuẩn hóa định danh tài khoản bằng `canonicalKey(accountId)` (tách bỏ hậu tố server) khi truy vấn và lưu trữ trên ổ đĩa (`data/*.json`).
- Tài khoản này không được nhìn thấy hoặc ghi đè dữ liệu của tài khoản khác.

## 3. THIẾT KẾ GIAO DIỆN & TRẢI NGHIỆM NGƯỜI DÙNG (UI/UX)
- Không dùng Dialog/Modal dạng pop-up che toàn màn hình cho các chức năng tương tác liên tục (Trận đấu, Thùng đồ, Võ tướng). Thay vào đó, tích hợp thành các Tab cố định hoặc Card cùng cấp.
- Đảm bảo giao diện mang lại trải nghiệm mượt mà, phản hồi thời gian thực qua WebSocket/TCP.

## 4. KIỂM THỬ VÀ ĐẢM BẢO CHẤT LƯỢNG (TEST & VERIFICATION)
- Sau mỗi chỉnh sửa code:
  1. Chạy `npm run typecheck` kiểm tra kiểu dữ liệu TypeScript.
  2. Chạy `npm test` kiểm tra tính toàn vẹn của hệ thống.
  3. Chạy `npm run build` xác nhận web client đóng gói thành công.

## 5. QUY TẮC ĐỒNG BỘ 2 REPO (ORIGIN & PUBLIC)
- Khi người dùng yêu cầu commit/push:
  - Phải push lên cả 2 repo:
    1. **Repo gốc**: `https://github.com/TuanCN90/TS-Bot-Web.git` (origin)
    2. **Repo public**: `https://github.com/TuanCN90/TSM-WEB-PUBLIC.git` (public)
  - **BẢO MẬT TUYỆT ĐỐI**: Không bao giờ commit hay push các file dữ liệu tài khoản (`data/accounts.json`, `data/battle-configs.json`, v.v.) lên repo public. Luôn đảm bảo repo public chỉ chứa mã nguồn sạch.

