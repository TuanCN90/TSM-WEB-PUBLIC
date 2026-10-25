# HỆ THỐNG PHÓ BẢN ĐƠN (SOLO DUNGEON KNOWLEDGE)

> **Tài liệu tham chiếu chuẩn cho 3 loại phó bản đơn (Solo Dungeons) trong TS Online.**  
> Đối chiếu và kiểm chứng từ dữ liệu game gốc (`Dungeon_C.dat`, `TextData_C.dat`), kịch bản TSM (`auto khieu chien dau dau.ini`, `auto san kho bau.ini`, `auto tim dau dau.ini`, `NhiemVuNgay1.ini`) và Pim-Bot.

---

## 1. Tổng quan & Danh mục 3 loại phó bản đơn

Khác với **Phó bản đội** (cần tạo phòng, ghép tổ đội và chỉ chủ PT di chuyển), **Phó bản đơn** là tính năng cá nhân hàng ngày (mỗi ngày đi 1 lần cho từng loại). Nhân vật không được ở trong tổ đội khi tham gia.

Hệ thống hỗ trợ cả 3 loại phó bản đơn, mỗi loại chia thành 4 mốc cấp độ (tổng cộng 12 phó bản):

### 1.1. Khiêu chiến Ba Đậu Yêu (Khiêu chiến Đậu Đậu)
- **Tên gốc trong TextData**: `Khiêu chiến Ba Đậu Yêu` (id text `21294`).
- **Bản đồ**: `62001` (Khiêu chiến Ba Đậu Yêu).
- **Cơ chế**: Tạo phòng ➜ Bước qua cổng dịch chuyển tương ứng với cấp độ ➜ Vào trận đấu solo với Ba Đậu Yêu ➜ Đánh thắng nhận thưởng và hoàn thành.
- **Bảng mốc**:
  | Cấp độ | Dungeon ID | Cổng (Door) | Map | Script TSM |
  | :--- | :---: | :---: | :---: | :--- |
  | **15 – 80** | `2` | `1` | `62001` | `auto 1` ➜ `warp_id 1` ➜ `await_battle` ➜ `end_event` |
  | **81 – 150** | `3` | `2` | `62001` | `auto 1` ➜ `warp_id 2` ➜ `await_battle` ➜ `end_event` |
  | **151 – 200** | `4` | `3` | `62001` | `auto 1` ➜ `warp_id 3` ➜ `await_battle` ➜ `end_event` |
  | **201 – 400** | `5` | `4` | `62001` | `auto 1` ➜ `warp_id 4` ➜ `await_battle` ➜ `end_event` |

---

### 1.2. Tìm bảo rương (Săn Kho Báu)
- **Tên gốc trong TextData**: `Tìm bảo rương` (id text `21295`).
- **Bản đồ**: `62003`..`62006` (tùy mốc cấp).
- **Cơ chế**: Tạo phòng ➜ Bước qua cổng `warp_id 1` ➜ Di chuyển lần lượt tới vị trí của 3 rương báu trong map và mở rương nhặt vật phẩm ➜ Hoàn thành thoát ra ngoài.
- **Bảng mốc & Tọa độ mở rương**:
  | Cấp độ | Dungeon ID | Map | Tọa độ & NPC 3 rương báu |
  | :--- | :---: | :---: | :--- |
  | **15 – 80** | `6` | `62003` | Rương 1: `(3030, 1510)` click 5<br>Rương 2: `(2810, 190)` click 7<br>Rương 3: `(250, 2310)` click 3 |
  | **81 – 150** | `7` | `62004` | Rương 1: `(270, 2310)` click 1<br>Rương 2: `(2810, 1670)` click 3<br>Rương 3: `(3810, 210)` click 5 |
  | **151 – 200** | `8` | `62005` | Rương 1: `(2810, 180)` click 1<br>Rương 2: `(1950, 1460)` click 3<br>Rương 3: `(3930, 2900)` click 5 |
  | **201 – 400** | `9` | `62006` | Rương 1: `(390, 170)` click 1<br>Rương 2: `(2210, 2910)` click 3<br>Rương 3: `(3730, 2930)` click 5 |

---

### 1.3. Tìm Ba Đậu Yêu (Tìm Đậu Đậu)
- **Tên gốc trong TextData**: `Tìm Ba Đậu Yêu` (id text `21296`).
- **Bản đồ**: `62007`..`62010` (tùy mốc cấp).
- **Cơ chế**: Tạo phòng ➜ Bước qua cổng `warp_id 1` ➜ Di chuyển tiếp cận các NPC Ba Đậu Yêu đang ẩn nấp trong map ➜ Đối thoại ➜ **Vào trận đấu solo đánh bại Ba Đậu Yêu** ➜ Thu phục thành công ➜ Hoàn thành nhận exp/quà và server tự động đưa về Trác Quận.
- **Danh sách NPC trên map**: Máy chủ sinh ngẫu nhiên 6 NPC Ba Đậu Yêu (index 1..6) rải rác trên bản đồ (gói `16/04`). Người chơi chỉ cần tiếp cận và đánh thắng đủ **3 con Ba Đậu Yêu bất kỳ** là đạt điều kiện kết toán hoàn thành.
- **Bảng mốc & Tọa độ Đậu Đậu tối ưu (theo TSM gốc & Pcap thật)**:
  | Cấp độ | Dungeon ID | Map | Tọa độ & Lộ trình 3 Ba Đậu Yêu |
  | :--- | :---: | :---: | :--- |
  | **15 – 80** | `10` | `62007` | Đậu 1: click 2 tại `(210, 260)`<br>Đậu 2: click 3 tại `(1310, 420)`<br>Đậu 3: click 4 tại `(810, 1120)` |
  | **81 – 150** | `11` | `62008` | Đậu 1: click 2 tại `(210, 260)`<br>Đậu 2: click 3 tại `(1290, 440)`<br>Đậu 3: click 4 tại `(50, 980)` |
  | **151 – 200** | `12` | `62009` | Đậu 1: click 2 tại `(210, 260)`<br>Đậu 2: click 3 tại `(1290, 440)`<br>Đậu 3: click 4 tại `(50, 980)` |
  | **201 – 400** | `13` | `62010` | Đậu 1: click 2 tại `(210, 260)`<br>Đậu 2: click 3 tại `(1290, 440)`<br>Đậu 3: click 4 tại `(50, 980)` |

---

## 2. Giao thức mạng & Cấu trúc gói tin

1. **Tạo phòng phó bản đơn**:
   - Gói gửi: `2f/02 00 <dungeonId> 00 00` (8 byte payload sau cmd/sub).
   - Đối chiếu pcap / TSM (gói thô XOR 0xAD): `6d3ca1adadad82afadafadad` giải mã ra `c0 91 0c 00 00 00 2f 02 00 02 00 00`.
   - Kết quả phản hồi: `2f/02 00 <code>`. Mã `00` là thành công, mã `04` là đã hết lượt trong ngày.
2. **Bước qua cổng**:
   - Gói gửi: `14/08 00 <doorIndex LE>`.
   - Server đổi map sang map phó bản (`62001..62010`).
3. **Thoát phó bản**:
   - Sử dụng action `dungeon_exit` (`0d/04 00 <uid>`).

---

## 3. Chế độ Chuỗi 3 phó bản (Daily Runner)

Người chơi có thể chọn chạy riêng từng loại hoặc chọn **Chuỗi cả 3 loại**:
1. Tự động kiểm tra và rời đội nếu đang có tổ đội.
2. Di chuyển về điểm an toàn (Trác Quận 12001).
3. Tự động chọn mốc cấp độ tối ưu theo cấp nhân vật (`bracket = 0` - Auto).
4. Thực hiện tuần tự:
   - Chạy **Khiêu chiến Ba Đậu Yêu** ➜ đánh xong trận.
   - Chuyển sang **Tìm bảo rương** ➜ mở đủ 3 rương.
   - Chuyển sang **Tìm Ba Đậu Yêu** ➜ click đủ 3 Đậu Đậu.
5. **Xử lý phó bản đã hoàn thành / hết lượt trong ngày**:
   - Khi tạo phòng bị server trả về mã `04` (đã hoàn tất hôm nay), bot thông báo rõ:
     `Ní đã hoàn thành phó bản [<Tên phó bản>] này rồi, mua thêm lượt hoặc chờ ngày mai nha ní ơi!!!`
   - Bot lập tức đánh dấu phó bản này đã xử lý và skip chuyển sang phó bản tiếp theo trong chuỗi mà không bị dừng hay treo phiên.
6. **Cơ chế chuyển tiếp an toàn giữa các phó bản**:
   - Khi kết thúc phó bản trước, bot gửi lệnh `dungeon_exit` và `warp_map 12001` để đưa nhân vật về lại Trác Quận an toàn.
   - Phase `warping` sẽ không bao giờ nhảy tắt vào `in_dungeon` khi nhân vật còn ở map phó bản cũ (62001..62010), mà luôn chờ nhân vật về lại Trác Quận 12001 rồi mới tiến hành tạo phòng cho phó bản kế tiếp.
7. **Cơ chế tương tác đối thoại & mở rương chuẩn xác (Săn Kho Báu & Tìm Đậu Đậu)**:
   - **Đồng bộ thực thể map (`0c/01 00`)**: Khi vừa bước qua cổng vào map phó bản (`62003..62010`), hệ thống gửi gói `sync_state` (`0c/01 00`) để máy chủ khởi tạo instance và gửi danh sách thực thể rương báu / Ba Đậu Yêu (`16/04`).
   - Theo chuẩn giao thức TS Online (đối chiếu script TSM gốc): mọi tương tác mở rương và bắt Đậu Đậu đều gửi lệnh `14/01 00 <id LE> 00` trực tiếp. Không gửi chèn gói `20/02` vào rương báu (tránh server hủy trạng thái tương tác).
   - **Cơ chế đối thoại & khiêu chiến Ba Đậu Yêu (Tìm Đậu Đậu)**: Khác với mở rương, mỗi lần click vào Ba Đậu Yêu, máy chủ đưa nhân vật vào **TRẬN ĐẤU SOLO** (`awaitEncounter`). Bot tự động đánh bại Ba Đậu Yêu qua `battleTurn`, sau trận máy chủ gửi câu thoại thu phục và chốt gói `14/08 00 2a` rồi mới di chuyển sang Ba Đậu Yêu tiếp theo.
   - **Tránh mã phạt 47 khi khiêu chiến Ba Đậu Yêu**:
     + Máy chủ gửi `06/02` (mở hộp thoại) và `14/01` (câu thoại) trong cùng 1 frame TCP. Chỉ đáp duy nhất 1 gói `14/06 00` cho `14/01`, không đáp ack cho `06/02` để tránh gửi ack kép làm server kick mã 47.
     + Gửi gói chọn mục tiêu `20/02 00 08` ngay trước `14/01` như client game thật (`Phobandon Timbdy.pcap`).
     + Sau khi hết trận, máy chủ tự động đẩy chuỗi đối thoại kết quả; bot không gửi lại lệnh `14/01` để tránh bị phạt thao tác sai trạng thái.
   - **Tách biệt cổng dịch chuyển an toàn**: Khi bước qua cổng từ Trác Quận (12001), sử dụng `warp_raw` gửi đơn lẻ `14/08`, không gửi kèm `sync_state` (`0c/01`) hay `ready_1406` thừa để tránh xung đột mã 47 với máy chủ khi vào trận Khiêu chiến Ba Đậu Yêu.
   - **Tự động đáp thoại & sự kiện**: Bot tự động đáp `14/06 00` cho mọi gói thoại `14/01` và gói sự kiện `14/0c`, chờ máy chủ chốt gói kết thúc `14/08 00 2a` trước khi di chuyển tiếp.
   - **Giữ vị trí đứng yên khi tương tác**: Trước khi bấm NPC/rương, bot gửi xác nhận toạ độ đứng `06/01` và chờ chuỗi thoại/kết quả hoàn tất mới di chuyển sang toạ độ tiếp theo (tránh việc di chuyển làm huỷ ngang tiến trình mở rương trên server).
   - **Chặn cờ trận đấu giả (14/0c)**: Các map phó bản đơn `62003..62010` được cấu hình xử lý gói `14/0c` như một sự kiện tương tác phó bản và đáp `14/06`, tuyệt đối không bật cờ battle ảo khi nhặt rương hoặc bắt Đậu.
   - **Chờ máy chủ tự động kết toán phần thưởng**: Sau khi mở đủ 3 rương hoặc tương tác đủ 3 Ba Đậu Yêu, bot đợi máy chủ trao thưởng EXP và tự động đưa nhân vật về Trác Quận (12001) như tool gốc TSM; tuyệt đối không gửi `dungeon_exit` ngay để tránh máy chủ hiểu nhầm là người chơi hủy/rời phòng bỏ cuộc. Chỉ fallback gửi `dungeon_exit` nếu sau 10s máy chủ chưa tự chuyển map.

---

## 4. Cơ chế ghi nhận Log & Tính toán EXP thưởng

Hệ thống tích hợp theo dõi chỉ số EXP thời gian thực cho cả **Nhân vật** và **Võ tướng xuất chiến**:
1. **Lấy mốc ban đầu (Baseline EXP)**:
   - Ngay khi bước vào map phó bản, hệ thống lưu lại điểm EXP thô (`expCur`) và phần trăm EXP (`exp`) của nhân vật và võ tướng.
2. **Tính toán chênh lệch khi hoàn thành**:
   - Khi ra khỏi map phó bản, hệ thống so sánh với baseline:
     $$\Delta\text{EXP} = \text{EXP}_{\text{hiện tại}} - \text{EXP}_{\text{gốc}}$$
3. **Hiển thị & Báo cáo kết quả**:
   - **Log Game**: Bắn thông báo chi tiết:
     `🎉 [Phó bản đơn] Hoàn thành <Tên phó bản> (<thời gian>s)! • Thưởng: Nhân vật +X EXP (+Y%) | Võ tướng +A EXP (+B%)`
   - **Giao diện Web**: Hiển thị bảng tóm tắt thời gian thực tại tab "⚔️ Phó bản đơn" với thời gian vượt ải và mức EXP nhận được của từng ải.
   - **Tổng kết chuỗi**: Khi hoàn thành tất cả các ải trong ngày, log tổng kết toàn bộ số EXP tích lũy nhận được của nhân vật và võ tướng.
