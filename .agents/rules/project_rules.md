# QUY TẮC PHÁT TRIỂN DỰ ÁN (PROJECT RULES) - TS-BOT-WEB

## 1. CẬP NHẬT TIẾN ĐỘ VÀO TRANG HOME (BẮT BUỘC)
- **Sau mỗi lần cập nhật tính năng (update), luôn luôn cập nhật tiến độ vào trang chủ/home (`apps/web/src/pages/Overview.tsx`)**:
  - Di chuyển các tính năng vừa hoàn thiện từ mục `DEV` ("Đang phát triển") sang `DONE` ("Đã hoàn thiện") kèm tóm tắt ngắn gọn tính năng.
  - Cập nhật hoặc điều chỉnh danh sách mục tiêu kế tiếp trong `DEV` ("Đang phát triển").
  - Đảm bảo trang chủ Overview luôn phản ánh đúng tiến độ thực tế của dự án để người dùng nắm rõ.

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
