# TÍNH NĂNG TỰ ĐỘNG DI CHUYỂN & TUẦN TRA QUÁI (AUTO MOVEMENT & PATROL)

> Tài liệu này chuẩn hoá kiến thức, giao thức mạng và cơ chế vận hành của tính năng **Tự Động Di Chuyển (Auto Movement / Patrol / Chase)** trong dự án TS-Bot-Web.
>
> **Trạng thái (2026-10-22)**: **ĐÃ HOÀN THIỆN ĐẦY ĐỦ** (Tích hợp nút Bật/Tắt 1-click ngay cạnh ô Warp/MapID tại thẻ Vị trí & Bản đồ trên tab Thông tin chung, hỗ trợ tuần tra va chạm jiggle walk 35px, tiếp cận quái trong bán kính an toàn và tự động quay về tâm sau trận đấu).

---

## 1. Tổng quan & Bản chất Kỹ thuật

Trong các tool TS Online truyền thống (SimpleBot, ExtremeBot, TrueBot), khi treo máy tại các bãi quái đi tuần tra (patrol NPC / wandering mobs), quái không đứng cố định một chỗ mà liên tục di chuyển tự do trên bản đồ.

Nếu bot chỉ đứng im một chỗ:
1. Phải chờ quái ngẫu nhiên đi ngang qua va chạm (tỷ lệ rất thấp, tốn nhiều thời gian).
2. Khi nhân vật đứng yên quá lâu, máy chủ sẽ ngưng broadcast gói cập nhật tọa độ quái `16/02` xung quanh.
3. Nếu quái đứng yên, cơ chế server đòi hỏi client phải có bước chân di chuyển hoặc gửi gói tương tác chuột `14/01` thì mới kéo vào trận đấu.

**Tính năng Tự Động Di Chuyển (Auto Movement)** giải quyết triệt để vấn đề này với 4 cơ chế phối hợp:
- **Khóa Tọa Độ Neo (Anchor Point):** Ghi nhớ tọa độ tâm bãi train $(X_{\text{origin}}, Y_{\text{origin}})$ và $MapId$ hiện tại.
- **Tuần tra Va chạm (Patrol / Jiggle Walk 35px):** Nhích nhẹ 1 bước 35px theo 1 trong 4 hướng (Đông, Tây, Nam, Bắc) qua gói `06/01` sau mỗi 3-4 giây nếu chưa có quái.
- **Tiếp cận Quái Trong Vùng An Toàn (Safe Radius Chase):** Tự động phát hiện NPC trong bán kính an toàn ($\le 150\text{px}$) và bước tới cự ly gần để double-click `14/01` vào trận.
- **Tự Động Quay Về Tâm (Auto-Return):** Sau khi kết thúc trận đấu, bot tự động đi bộ quay về tâm neo $(X_{\text{origin}}, Y_{\text{origin}})$ nếu bị lệch xa $> 45\text{px}$.

---

## 2. Giao thức Mạng & Xử lý Codec

Tất cả các gói tin đều tuân thủ cơ chế mã hóa XOR 0xAD của TS Online:

| Hướng | Opcode | Payload | Chức năng |
|---|---|---|---|
| **C→S** | `06/01` | `00 <dir u8> <nextX u16> <nextY u16>` | Bước đi nội suy Isometric 8 hướng ($\le 85\text{px}$/bước, an toàn tuyệt đối chống kick mã 5). |
| **C→S** | `14/01` | `00 <npcIndex u16 LE>` | Đối thoại / Double-click vào quái khi tiếp cận cự ly $\le 65\text{px}$ để mở trận đấu ngay. |
| **S→C** | `16/04` | `count u16 + list NPC` | Nạp danh sách toàn bộ NPC hiện diện khi vào map. |
| **S→C** | `16/02` | `00 <index u16> <x u16> <y u16>` | Tọa độ NPC di chuyển thời gian thực trên bản đồ. |
| **S→C** | `0b/fa` | `battleSpawnPlayer` | Máy chủ kéo nhân vật vào trận đấu. |

### Cơ chế Tự động Ngắt khi Vào Trận:
- Thuật toán di chuyển liên tục kiểm tra cờ `inBattle`. Khi phát hiện `inBattle = true`, vòng lặp bước đi lập tức dừng lại để tránh gửi thừa gói tin lên server gây lag hoặc ngắt kết nối.
- Sau khi trận đấu kết thúc, sự kiện `battleEnd` tự động lên lịch quét lại sau 700ms (`scheduleChaseCheck(700)`).

---

## 3. Giao diện & Trải nghiệm Người dùng (UI/UX)

Nút điều khiển được tích hợp trực tiếp tại thẻ **Vị trí & Bản đồ** (`apps/web/src/pages/Home.tsx`):
- **Vị trí**: Đặt ngay cạnh nút **Warp** và bộ chọn **MapSelect**.
- **Trạng thái Nút bấm**:
  - **Khi TẮT**: Nút màu xanh dương nhạt với nhãn `🚶 Tự động di chuyển`.
  - **Khi BẬT tại Map hiện tại**: Nút chuyển sang trạng thái cảnh báo nổi bật với chấm xanh phát sáng và nhãn `🛑 Dừng tự di chuyển`.
  - **Khi BẬT ở Map khác**: Nút thông báo `🚶 Tự di chuyển map này` — cho phép người dùng click 1 lần để chuyển ngay tâm di chuyển sang vị trí và bản đồ hiện tại.
- **Hộp thông tin nổi bật (Info Banner)**:
  - Khi đang bật, phía trên thẻ Vị trí hiển thị banner hồng: `🎯 Đang Tự Động Di Chuyển / Truy Kích: Tâm Map N (X, Y) • Bán kính 150px` kèm nút `Dừng` nhanh.

---

## 4. Nguyên tắc Phân lập Đa Tài khoản (Multi-Account Isolation)

Tuân thủ nghiêm ngặt **Quy tắc 2** của dự án:
- Cấu hình tự động di chuyển được lưu trữ độc lập tại `data/chase-configs.json`.
- Khóa định danh được chuẩn hóa qua `canonicalKey(accountId)` (tách bỏ hậu tố server `@_3_...`).
- Tài khoản này bật hoặc tắt tự động di chuyển hoàn toàn không ảnh hưởng tới trạng thái di chuyển của tài khoản khác.
