# Kiến Thức Hệ Thống Di Chuyển, Warp & Luyện Cấp (TS Online / TS-Bot-Web)

> Tài liệu nghiên cứu & chuẩn hoá từ reverse-engineering: **SimpleBot** (tool gốc trong repo), **ExtremeBot**, **TrueBot**, **PimBot** cùng các file pcap bắt gói thực tế (`Treo Rung 30 Dau Vat.pcap`, `ban_item_mua_hpsp.pcap`, `use_hpsp_char_pet.pcap`).

---

## 1. Bản Chất & Kiến Trúc Tổng Thể

Trong TS Online, thế giới Tam Quốc bao gồm hơn **3.600 bản đồ** (thành trì, thôn làng, đường lớn, sơn động, mỏ khoáng, đại lục...).
Để di chuyển từ điểm A tới điểm B bất kỳ trên toàn bộ thế giới game, hệ thống tự động hoá cần phối hợp **3 tầng cơ chế cốt lõi (3-Tier Movement Architecture)**:

```
                            [ Mục Tiêu Di Chuyển / Kịch Bản ]
                                           |
                                           v
                        TẦNG 1: TELEPORT CỔNG THÀNH (44/01)
                         Dịch chuyển tức thời đến 1 trong 41
                         thành trì lớn nhất (Warp_C.dat)
                                           |
                                           v
                       TẦNG 2: DUYỆT ĐỒ THỊ CỔNG MAP (14/08)
                         Tìm đường ngắn nhất (BFS) qua 8.360
                         cổng liên kết giữa các map (door.ini)
                                           |
                                           v
                 ★ TẦNG 3 (ROOT FEATURE): ĐI BỘ NỘI SUY (06/01) ★
                   Sau khi spawn vào map, nhân vật PHẢI ĐI BỘ
                   từng bước (isometric steps) đến đúng tọa độ cửa
                   hoặc tọa độ NPC trước khi tương tác!
```

---

## 2. Chi Tiết Giao Thức Mạng & Các Gói Tin (Network Protocols)

### 2.1. Cơ Chế 1: Teleport Cổng Thành (Thần Hành Bảo Điển / Menu Truyền Tống)
- **Tập tin dữ liệu:** `Data/Warp_C.dat` (41 bản ghi tương ứng 41 điểm truyền tống thành trì: Trác Quận 12001, Bắc Hải 11011, Lạc Dương 13001, Thành Đô 25001, Ngạch Tế Nạp 32001, v.v.).
- **Gói tin Client gửi (C→S):**
  - Opcode: `44/01`
  - Payload: `00 <mapId u16 LE> <gateIndex u8>`
  - Ví dụ: Trác Quận (12001, index 0): `44/01 00 e1 2e 00`. Điệp Thành (12061, index 2): `44/01 00 1d 2f 02`.
- **Gói tin Server phản hồi (S→C):**
  1. `44/01 00 00` (Xác nhận teleport thành công).
  2. `29/0c 00 00` (Tín hiệu chuyển bản đồ).
  3. `0c/00` (Trạng thái nhân vật trên map mới: Map ID offset 17, X offset 19, Y offset 21).
- **Client phản hồi (C→S):**
  - `07/01 00` (Ping keep-alive sau khi load map).
  - `0c/01 00` (Làm mới trạng thái nhân vật / sync state).
  - `14/06 00` (Báo client đã sẵn sàng sau khi đổi map).
- **Giới hạn an toàn:** Server chỉ chấp nhận đúng 41 cổng thành này. Nếu gửi Map ID nằm ngoài danh sách, server sẽ **bỏ qua im lặng (silent drop)**.

---

### 2.2. Cơ Chế 2: Bước Qua Cổng Dịch Chuyển (Door Warp / Portal Transit)
- **Tập tin dữ liệu:** `Data/door.ini` (8.360 liên kết map dạng `fromMap \t toMap \t doorIndex`).
- **Gói tin Client gửi (C→S):**
  - Opcode: **`14/08`**
  - Payload: `00 <doorIndex u16 LE>`
  - Đối chiếu từ pcap thật (`Treo Rung 30 Dau Vat.pcap`):
    - Cổng số 1 ra U Châu: Client gửi `14/08 00 01 00`.
    - Cổng số 18 vào Rừng 30: Client gửi `14/08 00 12 00`.
- **Gói tin Server phản hồi (S→C):**
  1. `06/02 00` (Xác nhận vị trí di chuyển).
  2. `14/07 00` (Xác nhận qua cổng thành công).
  3. `29/0c 00 00` (Đổi map).
  4. `0c/00` (Tọa độ và Map ID mới).
- **Client hoàn tất (C→S):**
  - `0c/01 00` (Đồng bộ trạng thái).
  - `14/06 00` (Báo client đã sẵn sàng).
  - Sau khi gửi `14/06 00`, server phản hồi `14/08 00 2a` xác nhận sẵn sàng hành động.

---

### 2.3. Cơ Chế 3: Gói Tin Đi Bộ (Opcode 06/01)
- **Client gửi (C→S):**
  ```
  Byte 0..1 : 06 01   (Opcode Move/Step)
  Byte 2    : 00      (Header subtype)
  Byte 3    : dir     (Hướng di chuyển: u8, giá trị 0..7)
  Byte 4..5 : nextX   (Tọa độ X kế tiếp: u16 Little-Endian)
  Byte 6..7 : nextY   (Tọa độ Y kế tiếp: u16 Little-Endian)
  ```
- **Kích thước gói:** Đúng 8 bytes (chuẩn hóa trên cả PC và Mobile).

---

## 3. ★ ROOT FEATURE: Cơ Chế Đi Bộ Isometric (06/01) & Định Vị Tọa Độ

Trong game 2.5D Isometric như TS Online, nhân vật **không thể "dịch chuyển tức thời" (teleport)** tới bất kỳ điểm nào trên bản đồ. Thay vào đó, mọi tương tác vật lý đều bị máy chủ kiểm tra khoảng cách Euclide nghiêm ngặt.

### 3.1. Hệ Tọa Độ Chiếu Trục Đo (Isometric 8 Directions)
Góc quay được tính toán từ vector độ dịch chuyển $(\Delta x, \Delta y)$ bằng hàm lượng giác:
$$\theta = \text{atan2}(\Delta y, \Delta x) \times \frac{180}{\pi}$$

| Hướng (Dir) | Tên Hướng | Phạm Vi Góc $\theta$ | Ý Nghĩa Chuyển Động |
|:---:|:---:|:---:|:---|
| **0** | Bắc (Up) | $[-112.5^\circ, -67.5^\circ)$ | Đi thẳng lên trên ($-\Delta y$) |
| **1** | Tây Bắc (Up-Left) | $[-157.5^\circ, -112.5^\circ)$ | Đi chéo lên trên bên trái |
| **2** | Tây (Left) | $< -157.5^\circ \lor \ge 157.5^\circ$ | Đi sang trái ($-\Delta x$) |
| **3** | Tây Nam (Down-Left) | $[112.5^\circ, 157.5^\circ)$ | Đi chéo xuống dưới bên trái |
| **4** | Nam (Down) | $[67.5^\circ, 112.5^\circ)$ | Đi thẳng xuống dưới ($+\Delta y$) |
| **5** | Đông Nam (Down-Right) | $[22.5^\circ, 67.5^\circ)$ | Đi chéo xuống dưới bên phải |
| **6** | Đông (Right) | $[-22.5^\circ, 22.5^\circ)$ | Đi sang phải ($+\Delta x$) |
| **7** | Đông Bắc (Up-Right) | $[-67.5^\circ, -22.5^\circ)$ | Đi chéo lên trên bên phải |

### 3.2. Các Hằng Số Vật Lý & Giới Hạn Server (Anti-Cheat Constraints)
1. **Độ dài bước đi an toàn ($stepSize$):** $\le 85\text{px}$ (khuyên dùng $75 - 85\text{px}$). Nếu gửi 1 bước nhảy vọt $> 100\text{px}$, server sẽ đánh cờ Speed-hack / Teleport-hack.
2. **Nhịp bước chân ($delayMs$):** $400 - 450\text{ms}$ (khuyên dùng **420ms**, khớp chính xác thời gian hoàn tất frame chuyển động nhân vật trong engine đồ họa gốc).
3. **Bán kính tương tác hợp lệ:**
   - **Tương tác Cổng (`14/08`):** Khoảng cách từ nhân vật đến cổng **phải $\le 60\text{px}$**.
   - **Tương tác NPC (`14/01`):** Khoảng cách từ nhân vật đến NPC **phải $\le 160\text{px}$**.

---

## 4. Cơ Chế Chống Ngắt Kết Nối (Anti-Cheat Kick Analysis)

| Mã Kick Server (`00/00`) | Nguyên Nhân Gốc (Root Cause) | Giải Pháp Khắc Phục Chuẩn (Standard Resolution) |
|---|---|---|
| **Mã 5 (Code 5)** | **Thao tác ngoài cự ly (Out-of-range action):**<br>- Gửi `14/08` khi đứng xa cửa $> 60\text{px}$.<br>- Gửi `14/01` khi đứng xa NPC $> 160\text{px}$. | Tự động chèn chuỗi `walkWaypoints` nội suy đưa nhân vật tiếp cận sát tọa độ mục tiêu ($\le 40\text{px}$) trước khi phát lệnh tương tác. |
| **Mã 44 (Code 0x2c)** | **Chuyển map quá nhanh (Speed-warp / Flood):**<br>Gửi liên tiếp các gói chuyển map khi server chưa load xong map trước. | Triển khai cơ chế `waitForMapId(targetMap)` chặn chờ gói `0c/00` từ server + handshake `0c/01` và `14/06`. |

---

## 5. Chiến Lược Xác Định Tọa Độ Cửa Khi Warp (Door Coordinate Resolution)

### 5.1. Vấn Đề Gốc
Trong file đồ thị `Data/door.ini`, mỗi dòng chỉ chứa:
```
fromMap    toMap    doorIndex
12001      63000    1
```
Tập tin này **hoàn toàn không có tọa độ $(x, y)$** của vị trí cổng trên bản đồ nguồn. Nếu bot chỉ dựa vào `door.ini` rồi phát ngay lệnh `warp_door 1`, nhân vật đang ở điểm spawn $(310, 1530)$ cách cổng số 1 $(90, 1650)$ hơn $250\text{px}$, server lập tức ngắt kết nối với **Mã 5**.

### 5.2. Giải Pháp Toàn Diện: Cơ Sở Dữ Liệu Tọa Độ Cổng (`doorCoordinates.json`)
Trong hệ thống kịch bản gốc (`SimpleBot`), các tác giả định nghĩa rõ tọa độ cổng thông qua câu lệnh:
```ini
warp_id <doorIndex>,<mapId>,<doorX>,<doorY>
```
1. **Trích xuất tự động:** Hệ thống quét toàn bộ kho kịch bản (`tool-reference/BOT TSM/Script/`), giải mã được **377 cổng** trên **102 bản đồ trọng yếu** (thành trì, hang động, tháp thí luyện, bãi train).
2. **Cơ chế Fallback thông minh:**
   - Khi định tuyến qua một cổng đã có tọa độ: Engine tự động kích hoạt `walkWaypoints([{ x: doorX, y: doorY }])` trước khi gửi `14/08`.
   - Khi gặp cổng mới chưa có tọa độ trong CSDL: Bot ghi nhận cảnh báo chi tiết, tạm thời giữ an toàn và cho phép người chơi ghi nhận tọa độ thực tế từ nhân vật (qua sự kiện `0c/00`) để bổ sung vào CSDL.

---

## 6. Thuật Toán Định Tuyến & Thực Thi Warp (BFS Route Planning)

Hệ thống điều hướng tự động (Route Planner) thực hiện theo quy trình 3 bước:

```
                            [ Điểm Hiện Tại: curMap ]
                                       |
                   +-------------------+-------------------+
                   |                                       |
                   v                                       v
         [ Tuyến Trực Tiếp ]                      [ Tuyến Qua Cổng Thành ]
       BFS từ curMap -> targetMap              Tìm nearestGate gần targetMap nhất
                   |                                       |
                   |                               BFS từ gate -> targetMap
                   |                                       |
                   +-------------------+-------------------+
                                       |
                                       v
                   So sánh tổng số bước di chuyển (hops.length)
                   Chọn tuyến có chi phí thấp nhất!
```

### Quy Trình Thực Thi Một Chặng (Hop Execution Sequence):
1. Kiểm tra vị trí hiện tại của nhân vật `(curX, curY)`.
2. Truy vấn tọa độ cổng `(doorX, doorY)` của hop kế tiếp.
3. Nếu cự ly $> 40\text{px}$, thực hiện chuỗi đi bộ nội suy `walkWaypoints` ($\le 85\text{px}$/bước, 420ms delay).
4. Dừng 200ms để server đồng bộ vị trí.
5. Gửi gói `14/08 00 <doorIndex u16 LE>`.
6. Chặn chờ máy chủ phản hồi `0c/00` xác nhận vào map mới (`waitForMapId`).
7. Bắt tay hoàn tất: gửi `0c/01 00` (sync state) và `14/06 00` (ready).

---

## 7. Triển Khai Toàn Diện: Tính Năng "Tìm Bãi Luyện Cấp & Di Chuyển An Toàn" (Train Map Finder)

### 7.1. Cấu Trúc Nhị Phân Cơ Sở Dữ Liệu Quái & Spawn

#### A. Cấu trúc tập tin lưu trữ bản đồ spawn `Data/Eve.emg` (10.4 MB, 3.788 map files `.eve`):
1. **Phần Bảng Mục Lục (TOC Header):**
   - 2 bytes đầu tiên: `fileCount` (u16 LE = 3.788 files).
   - Mỗi mục file chiếm đúng **32 bytes**:
     - `Byte 0` (u8): `nameLen` (độ dài tên file, vd: 9).
     - `Byte 1..23` (ASCII): `fileName` (vd: `10801.eve`), đệm byte 0 null-padded.
     - `Byte 24..27` (u32 LE): `fileOffset` (vị trí byte bắt đầu file trong archive).
     - `Byte 28..31` (u32 LE): `fileLen` (kích thước dữ liệu file).
2. **Cấu trúc bên trong mỗi file `.eve`:**
   - `Byte 0..1` (u16 LE): `mapId` (trùng khớp tên file `mapId.eve`).
   - Marker tìm kiếm: chuỗi ASCII **`Npc0002`** (dài 7 bytes).
   - `Offset + 7`: 18 bytes metadata header.
   - `Offset + 25` (u32 LE): `recordCount` (số lượng bãi quái / NPC spawn trên bản đồ).
   - `Offset + 29`: Bắt đầu mảng spawn records. Mỗi bản ghi có **bước nhảy cố định đúng 106 bytes**:
     - `Byte 0..1` (u16 LE): `index` (thứ tự 1, 2, 3...).
     - `Byte 2..3` (u16 LE): `npcId` (khớp 100% với `Npc_C.dat` và `npcNames.json`).
     - `Byte 4` (u8): `count` (số lượng quái trong nhóm spawn).
     - `Byte 56..59` (u32 LE): `x` (tọa độ X của bãi quái trên bản đồ).
     - `Byte 60..63` (u32 LE): `y` (tọa độ Y của bãi quái trên bản đồ).

#### B. Cấu trúc bản ghi NPC trong `Data/VN/Npc_C.dat`:
- Định dạng bản ghi: `[u16 byteLenName] [UTF-16LE Name] [81 bytes Tail]`.
- Phân tích đuôi 81 bytes:
  - `Byte 0` (u8): `typeByte` phân loại trạng thái Chuyển Sinh (CS):
    - `32` (0x20) / khác: Chưa CS (CS 0).
    - `33` (0x21) hoặc `37`: Chuyển Sinh Lần 1 (CS 1).
    - `36` (0x24) hoặc `38`: Tái Sinh (CS 2).
  - `Byte 1..2` (u16 LE): `modelId` (ID quái gửi trong packet trận đấu).
  - `Byte 26` (u8): **Level chính xác của quái / NPC** (1..200).
  - `Byte 50` (u8): **Mã hệ ngũ hành NPC**:
    - `1`: Địa (Earth) | `2`: Thủy (Water) | `3`: Hỏa (Fire) | `4`: Phong (Wind)
    - `5`: Tâm (Heart/Mind) | `7`: Quang (Light) | `8`: Ám (Dark) | `0`: Vô hệ (None).

#### C. Kết quả trích xuất & Thuật toán quét kép (Dual-Method Scanner):
- Tool trích xuất: `tools/import-train-spawns.ts`.
- **Cơ chế quét kép (Method A + Method B):** Kết hợp quét theo layer marker `Npc0002` (cho map có chuỗi tên layer) và bộ quét nhận diện nhị phân sâu (Deep Binary Record Scanner) 106-byte kèm cờ boundary `-20` (`0xecff`), đồng thời bóc tách bảng Encounter ở đuôi file `.eve` để trích xuất số lượng quái xuất hiện thực tế (1..5 quái).
- Khắc phục triệt để tình trạng thiếu map dã ngoại (như Rừng Hạ Khẩu 21836, Rừng Nội Hoàng 12831...).
- Thu được **11.995 bãi train độc nhất** trên **2.793 bản đồ** Tam Quốc, xuất đồng bộ ra:
  - `packages/engine/src/data/trainSpawns.json` (~1.66 MB).
  - `apps/web/src/data/trainSpawns.json`.

---

### 7.2. Action Cốt Lõi `warp_to_spot` (Engine & Connection)

Để người chơi chỉ cần **1 cú click**, bot tự động vượt qua mọi khoảng cách địa lý và tiếp cận tận nơi quái đứng:
```ts
// packages/engine/src/runtime/liveActions.ts:
{
  name: "warp_to_spot",
  label: "Warp & Đến bãi train",
  description: "Dịch chuyển tới map đích và tự động đi bộ tiếp cận tọa độ quái/NPC",
  params: [
    int("mapId", "Map ID"),
    int("x", "Tọa độ X"),
    int("y", "Tọa độ Y"),
    { name: "npcName", label: "Tên NPC", type: "string", required: false },
  ],
  toSteps: (p, ctx) => {
    // 1. Nếu khác map: kích hoạt lộ trình BFS (Warp cổng thành 44/01 + chuỗi cửa 14/08 kèm tọa độ an toàn doorCoordinates.json)
    // 2. Khi đã ở đúng map đích (hoặc đã ở sẵn cùng map):
    //    Chèn bước cuối: { cmd: { type: "Action", name: "move", args: [targetX, targetY] }, afterMs: 500 }
  }
}
```

- **Hành vi vật lý trong `tsOnline.ts` (`walkWaypoints`):**
  - Khi lệnh `move` được phát đi, codec lấy vị trí hiện tại `(curX, curY)`.
  - Phân rã vector độ dịch chuyển thành các bước nhảy an toàn $\le 85\text{px}$.
  - Tính góc xoay Isometric 8 chiều bằng $\text{atan2}$, gửi từng gói `06/01` với độ trễ 420ms.
  - Cập nhật tọa độ nhân vật real-time lên state và UI.
  - Khi tiếp cận cự ly $\le 40\text{px}$ so với quái thì dừng lại an toàn.
  - **Triệt tiêu hoàn toàn Kick mã 5 (out-of-range) và Kick mã 44 (speed-warp).**

---

### 7.3. Giao Diện Người Dùng Web UI (`TrainMapPage.tsx`)

- **Vị trí tích hợp:** Tab riêng biệt **"Bãi Train"** đặt ngang hàng ngay trước tab **"Cài đặt"** trên thanh Navigation chính của ứng dụng.
- **Tính năng nổi bật:**
  1. **Selector tài khoản:** Chọn tài khoản online để ra lệnh, hiển thị trực tiếp tọa độ hiện tại, map hiện tại, trạng thái online và inBattle (Rule 2).
  2. **Bộ lọc đa chiều:**
     - Tìm kiếm Text nhanh: Tên quái, NPC ID, Tên Map, Map ID.
     - Lọc Level Range (Min - Max) kèm 8 nút Preset tiện lợi: 1-30 (Tân thủ), 31-60, 61-90, 91-120, 121-150, 151-180, 181-200.
     - Lọc theo 8 Hệ ngũ hành kèm badge màu sắc trực quan (Địa vàng, Thủy lam, Hỏa đỏ, Phong lục, Tâm tím, Quang vàng sáng, Ám xám...).
     - Lọc theo Trạng thái Chuyển Sinh (Chưa CS, CS 1, Tái sinh).
     - Lọc theo Số lượng quái trong nhóm ($\ge 1, \ge 2, \ge 3, \ge 4, \ge 5$).
     - Sắp xếp linh hoạt: Theo Cấp độ, Map ID, Tên NPC, Số lượng quái.
  3. **Phân trang mượt mà:** Tùy chọn 20, 30, 50, 100 bãi mỗi trang kèm điều hướng Đầu / Trước / Sau / Cuối.
  4. **Nút 1-Click "🚀 Warp & Đến Train":**
     - Đầy đủ visual feedback (spinner loading, toast thông báo tiến trình).
     - Khóa an toàn khi tài khoản Offline hoặc đang trong trận đấu.
  5. **Nút phụ "🗺️ Cổng Map":** Cho phép chỉ teleport đến cổng bản đồ đích khi người chơi không muốn đi bộ sâu vào bãi quái.

---

## 8. Quy Chuẩn Kịch Bản & Cú Pháp Mở Rộng (.ini Scripts)

Để tái sử dụng trong toàn bộ hệ sinh thái kịch bản TS Online, engine hỗ trợ trọn vẹn cả 3 định dạng tham số:

### 8.1. Lệnh Đi Bộ Tự Do
```ini
move 886 279
walk 2670,830
```
- **Hành vi:** Engine tự động tính vector từ vị trí hiện tại đến $(x, y)$, phân rã thành các bước nhảy $\le 85\text{px}$, phát gói `06/01` với hướng xoay chính xác và độ trễ 420ms, đồng thời cập nhật tọa độ trên UI real-time.

### 8.2. Lệnh Bước Qua Cổng Kèm Tọa Độ
```ini
warp_id 3,12922,1170,504
```
- **Hành vi:** 
  1. Engine kiểm tra vị trí hiện tại. Nếu cách xa $(1170, 504) > 40\text{px}$, bot sẽ tự động đi bộ tiếp cận cổng.
  2. Dừng 200ms ổn định vị trí.
  3. Gửi gói `14/08 00 03 00` (bước qua cổng 3 an toàn 100%, không bao giờ bị Kick Code 5).

### 8.3. Lệnh Tương Tác NPC Kèm Tọa Độ
```ini
click 22,25415,303,1088
talk_npc 1 12263 425 236
```
- **Hành vi:**
  1. Tự động đi bộ đến tọa độ của NPC.
  2. Khi cự ly $\le 40\text{px}$, gửi gói đối thoại `14/01` với NPC.

---

## 9. Các Kịch Bản Ứng Dụng Tái Sử Dụng Thực Tế (Reusable Scenarios)

1. **Auto Mua Bán Dược Phẩm (Shop HP/SP):**
   - Teleport về 12001 $\to$ Đi bộ qua cửa Trác Quận vào U Châu 63000 $\to$ Đi bộ qua cửa vào Doanh trại Hương Dũng 12992 $\to$ Đi bộ qua cửa vào Quảng trường 12701 $\to$ Đi bộ tiếp cận NPC 12 tại $(970, 490)$ $\to$ Bán rác $\to$ Mua thuốc $\to$ Hoàn tất.
2. **Auto Mở Tiền Trang (Bank Keeper):**
   - Di chuyển tiếp cận quầy NPC Tiền Trang tại Trác Quận $(425, 236)$ hoặc Tương Dương $(450, 310)$ $\to$ Chuẩn bị tương tác `20/02` $\to$ Gửi gói `14/01` thoại $\to$ Mở rương và gửi/rút vật phẩm an toàn.
3. **Tìm Map Luyện Cấp Tự Động (Train Map Finder & Auto-Warp):**
   - Sau khi người dùng chọn bãi quái (ví dụ: Rừng 30, Thạch Động Cự Lộc, Rừng Trác Quận), Route Planner tìm chuỗi hops qua `door.ini`. Tại mỗi hop, nhân vật tự động đi bộ đến tọa độ cửa và bước qua cho đến khi tới bãi train.
4. **Chuỗi Nhiệm Vụ & Phó Bản (Quest Runner & Dungeons):**
   - Toàn bộ chuỗi Q (Chuyển Sinh, Nghề Bá/Hiệp/Hiền/Tiên, 40 Tầng NPC, Tháp 200) đều vận hành trên nền tảng: Đi bộ tới NPC $\to$ Đối thoại $\to$ Nhận Q $\to$ Đi bộ qua cửa $\to$ Đánh trận.

---

## 10. Kiến Trúc Lập Trình Trong Engine (`packages/engine`)

```ts
// 1. Primitive cốt lõi cho mọi hành vi di chuyển trong TsOnlineCodec:
public async walkWaypoints(
  waypoints: { x: number; y: number }[],
  write: (b: Buffer) => void,
  signal: AbortSignal,
  stepSize = 85,
  delayMs = 420
): Promise<void>

// 2. Chặn chờ máy chủ xác nhận vào map mới:
private waitForMapId(
  targetMap: number,
  timeoutMs: number,
  signal: AbortSignal
): Promise<boolean>

// 3. Dispatcher không đồng bộ xử lý an toàn mọi lệnh di chuyển & tương tác:
async executeAction(
  name: string,
  args: string[],
  write: (b: Buffer) => void,
  signal: AbortSignal
): Promise<{ ok: boolean; message?: string } | null>
```

---

## 11. Quy Trình Vận Hành, Bảo Trì & Cập Nhật Dữ Liệu (Operations & Maintenance)

### 11.1. Cập Nhật Dữ Liệu Bãi Train Khi Game Có Bản Cập Nhật
Khi máy chủ TS Online cập nhật phiên bản mới (thêm map mới, mở bãi quái mới, chỉnh sửa level hoặc chuyển sinh):
1. Copy các file dữ liệu mới vào thư mục:
   - `tool-reference/BOT TSM/Data/Eve.emg`
   - `tool-reference/BOT TSM/Data/VN/Npc_C.dat`
2. Chạy script trích xuất tự động:
   ```bash
   npx tsx tools/import-train-spawns.ts
   ```
3. Script sẽ tự động phân tích và ghi đè đồng bộ vào:
   - `packages/engine/src/data/trainSpawns.json`
   - `apps/web/src/data/trainSpawns.json`
4. Kiểm tra tính toàn vẹn:
   ```bash
   npm run typecheck && npm test && npm run build
   ```

### 11.2. Thêm Tọa Độ Cổng Mới Vào CSDL `doorCoordinates.json`
Nếu xuất hiện một cổng chuyển map mới mà khi bot di chuyển qua bị cảnh báo thiếu tọa độ:
1. Cho nhân vật di chuyển thực tế đến trước mặt cổng trong game.
2. Ghi nhận tọa độ $(X, Y)$ từ tab "Điều khiển" (hoặc từ gói `0c/00`).
3. Mở file `packages/engine/src/data/doorCoordinates.json` và thêm bản ghi theo định dạng:
   ```json
   {
     "fromMap": 12001,
     "doorIndex": 1,
     "doorX": 90,
     "doorY": 1650,
     "comment": "Cửa Trác Quận ra U Châu"
   }
   ```
4. Copy sang `apps/web/src/data/doorCoordinates.json`.

---

## 12. Hướng Dẫn Debugging & Chẩn Đoán Lỗi Mạng (Network Diagnostics)

Khi bot gặp vấn đề ngắt kết nối (Disconnect) hoặc không thể di chuyển:

| Hiện Tượng | Nguyên Nhân Kỹ Thuật | Cách Kiểm Tra & Khắc Phục |
|---|---|---|
| **Máy chủ ngắt kết nối với mã 5 (`00/00 00 05 00`)** | **Out-of-range action:** Nhân vật gửi lệnh qua cổng `14/08` khi đứng xa cổng $> 60\text{px}$, hoặc nói chuyện `14/01` khi đứng xa NPC $> 160\text{px}$. | Kiểm tra xem cổng đó đã có tọa độ trong `doorCoordinates.json` chưa. Đảm bảo bot luôn thực thi `walkWaypoints` tiếp cận $\le 40\text{px}$ trước khi gửi `14/08`. |
| **Máy chủ ngắt kết nối với mã 44 (`00/00 00 2c 00`)** | **Speed-warp / Packet flood:** Gửi lệnh chuyển map kế tiếp khi server chưa load xong map hiện tại, hoặc gửi sai gói `14/06` ngay sau lệnh teleport `44/01`. | Sau `44/01` chỉ gửi `07/01` (ping) và `0c/01` (sync). Tuyệt đối **không gửi `14/06` sau `44/01`**. Chờ xác nhận `0c/00` từ server với delay $\ge 1.2\text{s}$. |
| **Nhân vật đứng yên không chịu đi tiếp** | Đang có cờ chiến đấu `inBattle = true` (quái chặn đường) hoặc tín hiệu `AbortSignal` bị kích hoạt. | Kiểm tra log tab "Sự kiện". Sau khi kết thúc trận đánh, gọi lại lệnh di chuyển. |
| **Báo lỗi "Không tìm thấy đường tới map"** | Map đích là map độc lập (phó bản, lôi đài, Q riêng) không có cạnh nối trong đồ thị `door.ini`. | Kiểm tra `planRoute(from, to)`. Nếu là map Q, cần viết macro script tương tác NPC đưa vào. |

---

## 13. Cơ Chế Truy Kích NPC (Anchor-Point NPC Chase Engine) & Giao Thức 0x16

### 13.1. Bản Chất của Cơ Chế Truy Kích trong Tool Gốc
Trong các phiên bản tool TS Online gốc (SimpleBot, ExtremeBot, TrueBot), khi treo máy tại các bãi train quái đi lại (patrol NPC / wandering mobs), quái không đứng cố định một chỗ mà liên tục di chuyển tự do trên bản đồ.
Nếu bot chỉ đứng im tại một tọa độ:
- Phải đợi quái tình cờ đi ngang qua va chạm (rất lâu, giảm hiệu suất luyện cấp).
- Nếu bot rượt đuổi quái không giới hạn: Bot sẽ bị dẫn đi xa dần khỏi bãi train, đi lạc sang khu vực quái cấp cao khác, hoặc thậm chí rớt vào cổng chuyển map khác.

Do đó, **Cơ chế Truy kích Quái chuẩn (Anchor-Point Chase)** được thiết kế với nguyên lý then chốt:
1. **Khóa Tọa Độ Neo (Anchor Point):** Ghi nhớ tọa độ tâm bãi train $(X_{origin}, Y_{origin})$ và $MapId$.
2. **Khóa Bán Kính An Toàn Tối Đa ($maxRadius$):** Mặc định $150\text{px}$ (cho phép người dùng cấu hình từ $50\text{px}$ đến $400\text{px}$).
   - Điều kiện truy kích: $\text{dist}(NPC, Origin) = \sqrt{(X_{npc} - X_{origin})^2 + (Y_{npc} - Y_{origin})^2} \le maxRadius$.
   - **QUY TẮC SỐNG CÒN:** Nếu $\text{dist}(NPC, Origin) > maxRadius$, **tuyệt đối BỎ QUA**, không được rượt đuổi!
3. **Cơ Chế Tự Động Quay Về Tâm (Auto-Return):**
   - Sau khi trận đấu kết thúc, hoặc khi quét map không còn quái trong bán kính an toàn:
   - Nếu $\text{dist}(Char, Origin) > 40\text{px}$, bot tự động đi bộ quay về đúng tọa độ gốc $(X_{origin}, Y_{origin})$ và đứng đợi quái hồi sinh (respawn).

---

### 13.2. Giải Mã Chi Tiết Các Gói Tin Opcode 0x16 (NPC Tracking Packets)
Đối chiếu và xác thực từ file bắt gói thực tế `captures/Treo Rung 30 Dau Vat.pcap`:

#### A. Gói `16/04` — Danh Sách Toàn Bộ NPC Hiện Diện Khi Nạp Map (S→C)
- **Cấu trúc:**
  - Header: `cmd = 0x16, sub = 0x04`
  - Byte 9..10: `count` (u16 Little-Endian) — số lượng NPC trong map.
  - Từ Byte 11 trở đi: Danh sách các NPC, mỗi NPC dài **13 bytes**:
    - Offset +0..3: `index` (u32 Little-Endian) — Định danh phiên NPC trên map.
    - Offset +4..5: `x` (u16 Little-Endian) — Tọa độ X hiện tại.
    - Offset +6..7: `y` (u16 Little-Endian) — Tọa độ Y hiện tại.
    - Offset +8: `status` (u8) — Trạng thái (0x02: đang trong trận đấu, 0x01 / 0x00: nhàn rỗi).
    - Offset +9..12: cờ bổ sung.

#### B. Gói `16/02` — Tọa Độ NPC Di Chuyển Thời Gian Thực (S→C)
- **Độ dài frame:** 15 bytes.
- **Cấu trúc:**
  - Header: `cmd = 0x16, sub = 0x02`
  - Byte 8: `00`
  - Byte 9..10: `index` (u16 Little-Endian) — NPC ID đang di chuyển.
  - Byte 11..12: `x` (u16 Little-Endian) — Tọa độ X mới của NPC.
  - Byte 13..14: `y` (u16 Little-Endian) — Tọa độ Y mới của NPC.
- **Ứng dụng:** Codec cập nhật ngay lập tức vị trí của NPC trong `mapNpcs`. Nếu NPC di chuyển vào trong vùng an toàn ($\le maxRadius$), bot tự động kích hoạt truy kích tiếp cận.

#### C. Gói `16/06` — Cập Nhật Trạng Thái Chiến Đấu Của NPC (S→C)
- **Độ dài frame:** 12 bytes.
- **Cấu trúc:**
  - Header: `cmd = 0x16, sub = 0x06`
  - Byte 8: `00`
  - Byte 9..10: `index` (u16 Little-Endian).
  - Byte 11: `status` (u8) — `0x02` = Đang bận (bị người khác kéo vào trận), `0x01` = Rảnh rỗi / Respawn.
- **Ứng dụng:** Tránh việc bot chạy lại gần NPC đang đánh nhau với người chơi khác. Khi NPC chuyển về status 1, bot có thể tiếp cận ngay.

---

### 13.3. Thuật Toán Vào Trận Đấu Bằng Tiếp Cận Va Chạm
Trong cơ chế gốc của TS Online:
- Client thực hiện chuỗi bước đi nội suy `06/01` tiếp cận tọa độ của NPC sao cho $\text{dist}(Char, NPC) \le 35\text{px}$.
- Máy chủ sẽ tự động kích hoạt kiểm tra va chạm (collision check) và kéo nhân vật vào trận đấu bằng gói `0b/fa` (`battleSpawnPlayer`).
- Khi phát hiện `this.inBattle = true`, bot ngay lập tức hủy vòng lặp di chuyển truy kích.

---

### 13.4. Cơ Chế Double-Click Tương Tác NPC (Opcode `14/01`) Khi Tiếp Cận
- **Vấn đề thực tế:** 
  1. Với quái dã ngoại: Nếu cả người chơi và quái đều đứng yên hoặc đi song song, máy chủ có thể bị trễ nhịp quét va chạm, khiến nhân vật đứng cạnh quái mà không vào trận.
  2. Với quái đứng yên, NPC cản đường, qua ải, lôi đài hoặc Boss nhiệm vụ: Các NPC này **hoàn toàn không có cơ chế tự va chạm mở trận**. Bắt buộc client phải gửi gói click chuột tương tác để mở trận đấu hoặc mở thoại chiến đấu.
- **Giải pháp Double-Click 2 nhịp:**
  - Khi nhân vật tiếp cận cự ly an toàn $\text{dist}(Char, NPC) \le 65\text{px}$ (chuẩn client $\le 160\text{px}$):
  - Bot gửi nhịp Click 1: Gói tương tác `14/01 [0x00, npcIndex & 0xff, (npcIndex >> 8) & 0xff]`.
  - Giãn cách 130ms mô phỏng chuẩn nhịp nhấp đúp chuột người dùng.
  - Nếu máy chủ chưa spawn trận (`!this.inBattle`), bot gửi tiếp nhịp Click 2 (`14/01`).
  - Kiểm tra điều kiện nghiêm ngặt: Tự động ngắt ngay khi `this.inBattle = true` để triệt tiêu việc gửi thừa gói tin sau khi trận đấu đã mở.

---

### 13.5. Cơ Chế Tuần Tra Va Chạm (Patrol / Jiggle Walk 35px) Quanh Tâm Bãi Train
- **Vấn đề:** Nếu quái vật đứng yên hoặc chưa di chuyển (chưa có gói `16/02`), hoặc `mapNpcs` rỗng do nhân vật đã đứng ở bãi train từ trước khi bot login:
  - Nhân vật đứng yên tại tâm bãi train sẽ không thể kích hoạt thuật toán va chạm của server nếu không có bước chân di chuyển.
- **Giải pháp:**
  - Khi nhân vật đã ở đúng tâm bãi train ($\text{dist} \le 40\text{px}$):
  - Sau mỗi 2 chu kỳ kiểm tra (~3-4 giây) mà không phát hiện quái di chuyển hoặc chưa vào trận, bot tự động nhích một bước ngắn 35px theo 1 trong 4 hướng (Đông, Tây, Nam, Bắc) quanh tâm bãi train.
  - Bước nhích chân này gửi gói `06/01` lên server:
    1. Kích hoạt kiểm tra va chạm của máy chủ ngay lập tức kéo nhân vật vào trận nếu quái đang đứng gần.
    2. Kích hoạt máy chủ broadcast gói tọa độ `16/02` của toàn bộ quái vật xung quanh nhân vật.

---

### 13.6. Các Lỗi Giao Thức Thường Gặp & Cách Khắc Phục (Gotchas & Fixes)
1. **Lỗi parse tham số `set_chase_config` (Mismatch Protocol):**
   - *Triệu chứng:* Bật truy kích chỉ hiện toast, nhân vật đứng yên 1 chỗ, web không hiển thị active.
   - *Nguyên nhân:* `liveActions.ts` gửi mảng tham số vị trí `[enabled, mapId, originX...]`, nhưng codec lại gọi `JSON.parse(args[0])`. Khi `args[0] = "1"`, `JSON.parse` trả về số `1`. Merge `{ ...state, ...1 }` không có tác dụng, khiến `chaseConfig.enabled` luôn là `false`.
   - *Khắc phục:* Codec kiểm tra nếu `args[0]` bắt đầu bằng `{` thì `JSON.parse`, ngược lại đọc tuần tự từ `args[0]..args[7]`.
2. **Lỗi đọc định danh `index` trong gói danh sách quái `16/04`:**
   - *Triệu chứng:* Gói di chuyển `16/02` không cập nhật được tọa độ quái trong `mapNpcs`.
   - *Nguyên nhân:* `16/04` lưu `index` (u16) tại `off+0` và `npcId` (u16) tại `off+2`. Code cũ đọc `u32` tại `off+0` gộp cả 2 trường thành 1 số 32-bit, làm lệch key Map so với `16/02` (chỉ đọc `u16` tại byte 9).
   - *Khắc phục:* Đọc đúng `const index = f.readUInt16LE(off);` và `const npcId = f.readUInt16LE(off + 2);`.

---

## 14. Cơ Chế Đặc Thù Map Dị Giới (10851..10870, 49942, 49950) & Quy Tắc Thoát Về Map Chính

### 14.1. Vấn Đề Gốc: Máy Chủ Chặn Teleport Trong Không Gian Dị Giới
- Khi nhân vật đang ở trong map Dị giới (bất kỳ cấp độ nào từ Lv 10..180: map `10851..10870`), máy chủ TS Online **chặn hoàn toàn việc gửi gói tin truyền tống `44/01`**.
- Nếu gửi lệnh `44/01` trực tiếp khi đang ở Dị giới, máy chủ phản hồi lỗi `f[9] !== 0` và từ chối dịch chuyển, khiến chuỗi di chuyển thất bại.

### 14.2. Giải Mã Cấu Trúc Cổng Thoát Dị Giới (Eve.emg)
Từ phân tích nhị phân file `Eve.emg`:
- Tất cả các tầng Dị giới Lv 10..180 (`10852..10870`) đều có chung cấu trúc võ đài:
  - Cổng quay về map chính **Quảng trường Trác Quận (12003)** là **Cổng số 2** (`doorIndex = 2`).
  - Tọa độ cửa thoát chính xác: **`(688, 375)`**.
- Riêng Dị giới Tân Thủ Thôn (`10851`):
  - Cổng quay về 12003 là **Cổng số 1** (`doorIndex = 1`).
  - Tọa độ cửa thoát: **`(1436, 110)`**.

### 14.3. Quy Chuẩn Xử Lý Tự Động Trong Engine
1. **Kiểm tra trạng thái Dị giới:** Hàm `isDijieMap(currentMap)` xác định nếu nhân vật đang trong dải map Dị giới (`10851..10870`, `49942`, `49950`).
2. **Tự động chèn chuỗi thoát trước khi Warp/Teleport:**
   - **Bước 1:** Nhân vật đi bộ từng bước Isometric (`06/01`) tiếp cận đúng tọa độ cổng thoát `(688, 375)` để đảm bảo cự ly $\le 60\text{px}$, tránh kick anti-cheat mã 5.
   - **Bước 2:** Gửi gói qua cổng `14/08 00 02 00` (hoặc cổng 1 với 10851).
   - **Bước 3:** Gửi gói `0c/01` (sync state) kèm `expectMap: 12003`, chờ máy chủ chuyển bản đồ về Quảng trường Trác Quận.
   - **Bước 4:** Gửi `14/06` báo client sẵn sàng sau khi vào 12003.
   - **Bước 5:** Sau khi đã ở map chính `12003`, engine tự động lập lộ trình `planRoute(12003, targetMap)` để tiếp tục truyền tống hoặc chuyển tiếp tới map đích mà không gặp bất kỳ lỗi nào.

---

## 15. Giao Diện & Popup Modal Chi Tiết Đội Hình Chiến Đấu (`BattleFormationModal`)

### 15.1. Thiết Kế Popup Modal Xem & Chuyển Đổi Đội Hình
- **Cải tiến từ Tooltip sang Popup Modal:** Rê chuột chỉ phù hợp xem nhanh; đối với các bãi quái có nhiều cấu hình trận đấu (`listBattle`), người dùng nhấp vào chip `📍 [Location]` để mở bảng Popup Modal chi tiết.
- **Hệ thống Tabs đội hình:** Cho phép nhấp chọn tự do giữa `Đội hình 1`, `Đội hình 2`, `Đội hình 3`... Ma trận bàn cờ lập tức cập nhật lại các vị trí slot đứng thực tế.
- **Bàn cờ ma trận 2 hàng x 5 cột (Isometric Grid 2x5):**
  - **Hàng sau:** Slot 6, 7, 8, 9, 10 tương ứng `(1,0)` đến `(1,4)`.
  - **Hàng trước:** Slot 1, 2, 3, 4, 5 tương ứng `(0,0)` đến `(0,4)`.
  - Hiển thị trực quan icon quái vật (`👾`), badge số slot, và số lượng quái từng hàng.
- **Gợi ý combo kỹ năng tối ưu:** Phân tích thế đứng quái trong đội hình đang chọn để gợi ý kỹ năng đánh Cột dọc, Hàng ngang, Loạn kích hoặc Toàn thể.
- **Nút hành động tích hợp:** Nút `🚀 Warp & Đến Train`, nút `🎯 Kích Hoạt Truy Kích` / `🛑 Dừng Truy Kích`, và hỗ trợ đóng bằng phím `ESC` hoặc click ngoài backdrop.

### 15.2. Chỉ Báo Trạng Thái Truy Kích Toàn Diện Trên Web UI
- **Màn hình chính Console (`Home.tsx`):**
  - Khối cờ kinh tế: Hiển thị badge màu hồng tím `🎯 Truy kích: [Tên quái]` kèm nút tắt nhanh `✕`.
  - Thẻ Vị trí & Bản đồ: Hiển thị thanh chi tiết `🎯 Đang Truy Kích: [Tên quái] • Tâm (X, Y) • Bán kính R px` kèm nút `[Dừng]`.
- **Cột danh sách tài khoản (`SessionTabs.tsx`):**
  - Hiển thị icon `🎯` nhấp nháy bên cạnh tên tài khoản đang bật chế độ truy kích.
- **Trang Bãi Train (`TrainMapPage.tsx`):**
  - Card quản lý trên đầu trang phát sáng viền neon khi truy kích đang bật; nút "🎯 Bật Tại Vị Trí Này" tự động chốt tọa độ nhân vật đang đứng làm tâm gốc.
  - Bãi quái đang được nhắm phát sáng viền tím nổi bật và hiển thị badge động `🎯 ĐANG TRUY KÍCH`.

---

> 📖 **Xem thêm tài liệu hướng dẫn người dùng:** [docs/USER_GUIDE_TRAIN_MAP.md](file:///Users/user/TS-Bot-Web/docs/USER_GUIDE_TRAIN_MAP.md)


