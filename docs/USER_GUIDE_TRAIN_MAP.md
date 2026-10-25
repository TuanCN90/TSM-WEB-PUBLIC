# Hướng Dẫn Sử Dụng: Tính Năng Tìm Bãi Train & Di Chuyển Tự Động (Train Map Finder & Auto-Warp)

> **Dành cho:** Người chơi TS Online và Quản trị viên hệ thống **TS-Bot-Web**.  
> **Mục tiêu:** Tra cứu tức thì trong cơ sở dữ liệu gần **12.000 bãi quái** (trên 2.793 bản đồ), lọc chính xác theo cấp độ và ngũ hành, tự động di chuyển 1-click tiếp cận tận nơi quái đứng mà **không bao giờ bị máy chủ ngắt kết nối** (chống kick mã 5 và mã 44).

---

## 1. Tổng Quan Tính Năng

Tab **"Bãi Train"** được tích hợp trực tiếp trên thanh điều hướng chính của Web UI (ngang hàng bên cạnh tab **"Cài đặt"**).  
Tính năng này giải quyết triệt để 2 bài toán lớn nhất khi chơi TS Online:
1. **Tìm kiếm bãi luyện cấp tối ưu:** Tra cứu quái vật theo tên, cấp độ (Level), hệ ngũ hành, trạng thái chuyển sinh (CS) và số lượng quái xuất hiện trong một trận.
2. **Di chuyển tự động an toàn 100%:** Ứng dụng kiến trúc di chuyển 3 tầng (Teleport cổng thành `44/01` $\to$ Duyệt đồ thị cổng map BFS `14/08` $\to$ Đi bộ nội suy Isometric `06/01` $\le 85\text{px}$/bước), đưa nhân vật đến chính xác tọa độ $(X, Y)$ của quái.

---

## 2. Kiến Thức Cơ Bản Về Luyện Cấp (Leveling) Trong TS Online

Để tối ưu hóa tốc độ nhận kinh nghiệm (EXP) và độ bền của đội hình, người chơi cần nắm vững 3 quy tắc vàng:

### 2.1. Quy Tắc Chênh Lệch Cấp Độ (Level Difference & EXP Formula)
- **Nhận 100% EXP:** Cấp độ trung bình của đội hình (hoặc nhân vật solo) nằm trong khoảng **$\pm 19$ Level** so với cấp độ của quái.
  - *Ví dụ:* Nhân vật Level 35 train quái Level 20 đến Level 54 sẽ nhận trọn vẹn điểm kinh nghiệm.
- **Bị phạt EXP:**
  - Chênh lệch từ **20 đến 29 Level:** Lượng EXP bắt đầu giảm dần theo cấp số nhân ($80\% \to 50\% \to 20\%$).
  - Chênh lệch **$\ge 30$ Level:** Lượng EXP nhận được chỉ còn **1 điểm EXP** tượng trưng.

### 2.2. Quy Tắc Ngũ Hành Tương Khắc (Element Countering)
Sử dụng nhân vật / võ tướng có hệ khắc chế quái giúp gia tăng **$30\% - 50\%$ sát thương** và giảm sát thương gánh chịu:

```
          ⛰️ ĐỊA (Earth)
         /              \
     khắc                bị khắc
       /                  \
      v                    \
   💧 THỦY (Water) <---- 🍃 PHONG (Wind)
      \                    ^
       \                  /
      khắc              khắc
         \              /
          v            /
           🔥 HỎA (Fire)
```

- **Quy tắc vòng tròn:**
  - ⛰️ **Địa** khắc 💧 **Thủy**
  - 💧 **Thủy** khắc 🔥 **Hỏa**
  - 🔥 **Hỏa** khắc 🍃 **Phong**
  - 🍃 **Phong** khắc ⛰️ **Địa**
- **Các hệ đặc biệt:**
  - 🔮 **Tâm** / ☀️ **Quang** / 🌙 **Ám** / ⚪ **Vô hệ**: Có các quy tắc kháng và cộng sát thương theo trang bị và bí cấp.

### 2.3. Lựa Chọn Số Lượng Quái (Monster Count)
- **Nhóm 1 - 2 quái:** Rất phù hợp cho nhân vật đi solo hoặc đội hình chưa đủ mạnh, giúp dứt điểm nhanh trong 1 turn (combo 100%), không tốn nhiều HP/SP.
- **Nhóm 3 - 5 quái:** Thích hợp cho party đầy đủ (5 người) có kỹ năng đánh lan (Ném Đá, Cuồng Phong, Hỏa Luân, Băng Vũ...) để gom lượng EXP tổng cực lớn mỗi trận.

---

## 3. Hướng Dẫn Thao Tác Chi Tiết Trên Giao Diện Web

### Bước 1: Chọn Tài Khoản Thực Thi
- Ở góc trên cùng bên phải của tab **"Bãi Train"**, nhấp vào dropdown **"Tài khoản"** và chọn tài khoản bạn muốn ra lệnh di chuyển.
- Kiểm tra thanh thông tin bên cạnh:
  - Vị trí hiện tại: Hiển thị Map ID và tọa độ thực tế `(X, Y)` của nhân vật.
  - Trạng thái: Đảm bảo tài khoản đang **🟢 Online** và **không trong trận đấu** (⚔️).

### Bước 2: Thiết Lập Bộ Lọc Tìm Kiếm
Giao diện cung cấp bộ lọc đa chiều cực kỳ trực quan:
1. **Ô tìm kiếm nhanh:** Nhập tên quái (*Đấu Vật, Lưu Bị, Tào Tháo, Khăn Vàng...*), ID quái (*11047, 41082...*), tên Map (*Rừng 30, Cự Lộc, Lạc Dương...*) hoặc Map ID (*12815, 12001...*).
2. **Khoảng Level & Chip Preset:**
   - Nhập thủ công `Min Lv` và `Max Lv` (từ 1 đến 200).
   - Hoặc nhấp nhanh vào 8 nút mốc cấp độ phổ biến:
     - `1 - 30 (Tân thủ)`: Khu vực U Châu, Trác Quận, Rừng Cự Lộc.
     - `31 - 60 (Sơ cấp)`: Ký Châu, Duyện Châu, Thanh Châu.
     - `61 - 90 (Trung cấp)`: Từ Châu, Dự Châu, Thạch Động Cự Lộc.
     - `91 - 120 (Cao cấp)`: Kinh Bắc, Giang Đông, Trường An.
     - `121 - 150 (Chuyên gia)`: Ích Châu, Quan Trung, Lương Châu.
     - `151 - 180 (Đại sư)`: U Châu Tuyết Địa, Lô Long Khẩu, Rừng Sa Mạc.
     - `181 - 200 (Đỉnh cao)`: Các tháp thí luyện, động tiên nhân, boss đại lục.
3. **Lọc theo Hệ (Element):** Chọn Địa, Thủy, Hỏa, Phong, Tâm, Quang, Ám hoặc Vô hệ.
4. **Lọc theo Chuyển Sinh (CS):** Lọc theo quái Thường (CS 0), Chuyển Sinh 1 (CS 1) hoặc Tái Sinh (CS 2).
5. **Lọc theo Số lượng quái:** Lọc bãi có từ 1, 2, 3, 4 hoặc 5 quái trở lên.
6. **Sắp xếp kết quả:** Chọn sắp xếp theo Cấp độ (Thấp $\to$ Cao hoặc Cao $\to$ Thấp), Map ID, Tên NPC, hoặc Số lượng quái.

### Bước 3: Xem Danh Sách & Chọn Bãi Train
- Bảng hiển thị danh sách bãi train khớp bộ lọc kèm phân trang mượt mà (20, 30, 50, 100 bãi/trang).
- Mỗi hàng cung cấp đầy đủ:
  - **Tên quái & ID:** Kèm nhãn chuyển sinh nếu là quái CS1 / Tái sinh.
  - **Cấp độ (Level):** Tô màu phân cấp trực quan (Xanh lá $\le 100$, Vàng $\le 150$, Đỏ $\ge 150$).
  - **Hệ quái:** Huy hiệu icon kèm màu sắc đặc trưng (Địa vàng, Thủy lam, Hỏa đỏ, Phong xanh...).
  - **Số lượng quái:** Hiển thị `👥 x1`, `👥 x3`, `👥 x5`...
  - **Bản đồ & Tọa độ:** Tên map, ID map và tọa độ chính xác `(X, Y)`. Nếu nhân vật đang đứng sẵn ở map này, bảng sẽ gắn nhãn `📍 Đang ở map này`.

### Bước 4: Kích Hoạt Di Chuyển (1-Click Execution)
Trên hàng của bãi quái đã chọn, bạn có 2 lựa chọn hành động:
- 🚀 **Nút "Warp & Đến Train" (Khuyên dùng):**
  - Bot tự động lập lộ trình di chuyển tối ưu: Teleport về cổng thành gần nhất $\to$ Đi bộ qua các cửa liên kết $\to$ Khi vào map đích, tự động đi bộ tiếp cận sát tọa độ `(X, Y)` của bãi quái.
  - Giao diện hiển thị thanh trạng thái xoay kèm thông báo tiến trình: `Đang lập lộ trình & di chuyển đến [Tên quái]...`
  - Khi hoàn tất, bot phát âm báo và thông báo Toast: `✓ Đã tiếp cận thành công bãi train!`
- 🗺️ **Nút "Cổng Map":**
  - Chỉ teleport và di chuyển tới điểm spawn của bản đồ đích, không đi bộ sâu vào tọa độ quái. Lựa chọn này thích hợp khi bạn muốn tập kết đội ngũ ở cửa map trước khi cùng đi vào.

---

## 4. Phối Hợp Các Tính Năng Để Xây Dựng Chu Trình Auto Train 24/7

Để bot hoạt động bền vững và tự động hóa hoàn toàn mà không cần can thiệp thủ công, hãy kết hợp 4 tab theo quy trình chuẩn sau:

```
+-----------------------------------------------------------------------------------+
| BƯỚC 1: CHUẨN BỊ (Tab "Thùng Đồ" - Menu "🛒 Mua / Bán")                          |
| - Cài đặt mua đầy đủ Thuốc Vận Công (27136: +62 HP) và Thiên Kim Du (27138: +62 SP)|
| - Bấm "⚡ Bán xong rồi mua" để dọn rác và nạp đầy dược phẩm trước khi đi train.    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| BƯỚC 2: CẤU HÌNH TỰ ĐỘNG HỒI PHỤC (Tab "Cấu Hình Chung" - "💊 Sử Dụng HP / SP")   |
| - Bật "Tự động sử dụng HP khi dưới 60%" cho cả Nhân vật và Võ tướng.             |
| - Bật "Tự động sử dụng SP khi dưới 50%".                                          |
| - Sau mỗi trận đánh kết thúc, bot tự động dùng thuốc nhỏ nhất trước để hồi máu/mana|
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| BƯỚC 3: CÀI ĐẶT TRẬN ĐẤU (Tab "Trận Đấu")                                        |
| - Chọn Kỹ năng gây sát thương hoặc Combo cho Char & Pet.                          |
| - Bật công tắc "Tự động đánh" (Auto Fight = ON).                                  |
| - (Tùy chọn) Bật "Tự động bỏ chạy" nếu HP/SP quá thấp hoặc gặp Boss ngoài dự kiến. |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| BƯỚC 4: DI CHUYỂN ĐẾN BÃI TRAIN (Tab "Bãi Train")                                 |
| - Lọc bãi train phù hợp level và hệ khắc chế.                                     |
| - Bấm "🚀 Warp & Đến Train" ➜ Nhân vật tự động chạy đến bãi và bắt đầu train!     |
+-----------------------------------------------------------------------------------+
```

---

## 5. Câu Hỏi Thường Gặp & Xử Lý Sự Cố (FAQ & Troubleshooting)

### Q1: Tại sao nút "🚀 Warp & Đến Train" bị mờ (disabled) không bấm được?
> **Nguyên nhân:** 
> 1. Tài khoản bạn đang chọn đang ở trạng thái **Offline** (chưa đăng nhập vào game).
> 2. Hoặc nhân vật của bạn đang trong **trận đấu** (`inBattle = true`).
> 
> **Cách khắc phục:** Chờ trận đấu kết thúc hoặc vào tab "Điều khiển" để kiểm tra kết nối tài khoản.

### Q2: Nếu nhân vật bị quái chặn đánh giữa đường khi đang di chuyển qua các map thì sao?
> **Cơ chế an toàn:** Hệ thống kiểm soát di chuyển của bot được trang bị cảm biến trạng thái chiến đấu (`inBattle`). Khi bị quái chặn đánh, chuỗi di chuyển sẽ **tự động tạm dừng an toàn**, không spam gói tin di chuyển lên máy chủ (tránh ngắt kết nối).  
> Sau khi trận đấu kết thúc (thắng hoặc bỏ chạy), bạn chỉ cần nhấp lại nút **"🚀 Warp & Đến Train"**, bot sẽ tiếp tục hành trình từ vị trí hiện tại đến đích.

### Q3: Có bãi train nào bấm vào bị báo "Không tìm thấy đường tới map" không?
> **Nguyên nhân:** Một số bản đồ là **phó bản đặc biệt, mê cung nhiệm vụ hoặc map sự kiện** (như Lôi Đài, Đấu Trường Đỉnh Cao, Đảo Tiên...). Những map này không có liên kết cổng trong `door.ini` mà yêu cầu đối thoại với NPC đặc thù để được dịch chuyển vào.  
> Đối với các map này, bạn nên chọn các bãi quái tự nhiên ở đại lục U Châu, Ký Châu, Duyện Châu, Kinh Bắc... để bot có thể tự đi bộ đến nơi.

### Q4: Di chuyển bằng bot có bao giờ bị Admin hoặc Máy chủ khóa tài khoản (Ban/Kick) không?
> **Hoàn toàn an toàn:** Bot áp dụng cơ chế di chuyển mô phỏng người chơi thật:
> 1. Từng bước đi được chia nhỏ $\le 85\text{px}$ (khớp chuẩn độ dài sải chân nhân vật).
> 2. Nhịp delay cố định **420ms** (khớp chính xác thời gian phát hết frame hoạt ảnh bước chạy của engine client gốc).
> 3. Tuyệt đối không dùng Teleport-hack hay Speed-hack, triệt tiêu 100% các mã phạt anti-cheat của máy chủ TS Online (Kick mã 5 và mã 44).

---

## 6. Hướng Dẫn Sử Dụng: Chế Độ Tự Động Truy Kích Quái (Anchor-Point NPC Chase)

### 6.1. Khi Nào Cần Dùng Chế Độ Truy Kích?
Tại các bãi train dã ngoại (ví dụ: Rừng 30 Đấu Vật, Rừng Lương Thứ, Ngọn Núi Rừng Cây...), các NPC quái vật không đứng cố định mà liên tục tuần tra đi lại.  
Nếu chỉ đứng yên một chỗ, bạn sẽ phải chờ rất lâu quái mới tình cờ đi tới va chạm.  
**Chế độ Truy Kích** giúp nhân vật:
1. Tự động quan sát tọa độ thời gian thực của NPC trên map qua gói `16/02` và `16/04`.
2. Tự động đi bộ tiếp cận quái để máy chủ ghép cặp kích hoạt trận đấu.
3. **Tuyệt đối không đi xa khỏi bãi train:** Chỉ đuổi theo quái nếu khoảng cách từ quái đến tọa độ gốc $\le maxRadius$ (mặc định $150\text{px}$).
4. **Tự động quay về tâm:** Sau khi trận đấu kết thúc, nếu nhân vật bị lệch xa bãi train, bot tự động đi bộ quay về đúng tọa độ gốc và đứng đợi quái respawn.

### 6.2. Các Bước Kích Hoạt 1-Click
1. Mở tab **"Bãi Train"**.
2. Tìm bãi quái mong muốn trong bảng danh sách (ví dụ gõ "Đấu Vật" hoặc "12815").
3. Bấm nút màu tím nổi bật **"🎯 Truy Kích"**:
   - Bot sẽ tự động lưu cấu hình bãi train này làm **Tâm Truy Kích (Anchor Point)** cho tài khoản đang chọn.
   - Bot tự động Warp và đi bộ tiếp cận tọa độ bãi quái.
   - Khi đến nơi, bot sẽ tự động bắt đầu chu trình tìm quái, rượt đuổi trong bán kính an toàn và tự động quay về tâm sau mỗi trận đấu.
4. **Tùy chỉnh linh hoạt:**
   - Tại Card **"Chế Độ Tự Động Truy Kích Quái"** ở đầu trang:
     - Kéo thanh trượt **Bán kính an toàn** (từ $50\text{px}$ đến $400\text{px}$).
     - Bật/tắt tùy chọn **"Tự động quay về tâm sau trận"**.
     - Bấm **"🛑 Dừng Truy Kích"** bất cứ lúc nào muốn bot đứng yên.

