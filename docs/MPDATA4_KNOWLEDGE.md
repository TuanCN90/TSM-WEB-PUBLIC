# TÀI LIỆU CẤU TRÚC DỮ LIỆU MPDATA4_C.DAT (TS ONLINE MOBILE)

> **Tài liệu nghiên cứu & giải mã nhị phân:** `tool-reference/MPData4_C.Dat`  
> **Phiên bản client:** TS Online Mobile (TSM)  
> **Ngày phân tích:** 2026-10-21  

---

## 1. Bản Chất & Cơ Chế Đóng Gói (Format Specification)

File `MPData4_C.Dat` thực chất là một luồng nén **GZIP Deflate Stream** bị mã hóa toàn bộ bằng phép biến đổi **XOR với byte `0xDF`**.

- **Header gốc của file (sau khi XOR `0xDF`):**
  - Offset 0..2: `c0 54 d7` $\oplus$ `0xDF` = `1f 8b 08` (Magic bytes chuẩn của GZIP Header: ID1=0x1F, ID2=0x8B, CM=8 Deflate).
  - Offset 3..8: `df df df df df df` $\oplus$ `0xDF` = `00 00 00 00 00 00` (Timestamp & Extra flags = 0).
- **Kích thước file:**
  - File đóng gói (`.Dat`): **61.6 MB** (64.620.651 bytes).
  - Luồng JSON sau giải mã & giải nén: **454.68 MB** (476.770.318 bytes), cấu trúc JSON hợp lệ chuẩn UTF-8.

### Đoạn mã giải mã (Node.js Stream Pipeline):
```typescript
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";

const xorStream = new Transform({
  transform(chunk, _encoding, callback) {
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] ^= 0xdf;
    }
    callback(null, chunk);
  },
});

const readStream = createReadStream("tool-reference/MPData4_C.Dat");
const gunzip = createGunzip();
readStream.pipe(xorStream).pipe(gunzip);
```

---

## 2. Cấu Trúc Tổng Quan (Root JSON Object)

Object gốc chứa 11 tập dữ liệu (Root Keys) bao quát toàn bộ thế giới TS Online:

```json
{
  "listMap": [...],             // 8.975 cổng chuyển map kèm tọa độ đi bộ chuẩn X/Y
  "listNpcInMap": [...],        // 22.076 NPC trên toàn bộ các map (chứa listBattle)
  "listItemsInShop": [...],     // 1.728 mặt hàng bán trong Shop của NPC
  "listItemsInMap": [...],      // 1.634 điểm lượm tài nguyên / khoáng thạch / thảo dược
  "listItemsInQuest": [...],    // 5.318 vật phẩm liên quan đến nhiệm vụ
  "listPMapRoutes": [...],      // 3.748 lộ trình ma trận giữa các map
  "listPMapAreaRoutes": [...],  // 3.865 lộ trình khu vực
  "Eve_Suface": [...],          // 2.503 dữ liệu thoại / option trigger
  "SceneSet": {...},            // Cấu hình cảnh và hiệu ứng bản đồ
  "Mission": {...},             // Cây dữ liệu nhiệm vụ (innerDictionary)
  "listPMAP": {...}             // Dữ liệu phân vùng bản đồ
}
```

---

## 3. Chi Tiết Các Tập Dữ Liệu Quan Trọng & Hướng Triển Khai

### 3.1. `listNpcInMap` (22.076 bản ghi) — CƠ SỞ DỮ LIỆU BÃI TRAIN & SỐ LƯỢNG QUÁI

Mỗi bản ghi đại diện cho một NPC trên bản đồ:
```json
{
  "MapId": 12831,
  "MapName": "Rừng Nội Hoàng",
  "NpcNo": 4,
  "NpcId": 10201,
  "NpcName": "[10201]Hắc Sơn Chiến Sĩ",
  "Level": 30,
  "HP": 181,
  "AGI": 10,
  "Element": 2,
  "Event": 4,
  "PosX": 1070,
  "PosY": 1880,
  "listBattle": [
    {
      "Count": 4,
      "Location": "3,5,4"
    }
  ]
}
```

- **Ý nghĩa các trường trọng yếu:**
  - `listBattle`: Mảng các trận chiến xảy ra khi đụng vào NPC này.
  - `Count`: **Số lượng quái xuất hiện thực tế trong trận** (từ 1 đến 10 quái).
  - `Location`: Vị trí đứng của các quái trên ma trận chiến đấu (ví dụ `"3,5,4"`, `"2,3,4"`, `"1,2,3,4"`).
  - `AGI`: Tốc độ chuẩn của quái. Cực kỳ quan trọng để người chơi cài đặt AGI nhân vật/pet vượt trước quái hoặc canh combo 100%.
  - `HP`: Lượng máu cơ bản của quái.
  - `Event`: Loại sự kiện của NPC (Event $\ge 2$ thường là NPC chiến đấu / quái bãi train).
- **Phân bổ số lượng quái (`Count`):**
  - Trận 1 con: 144 bãi
  - Trận 2 con: 1.346 bãi
  - **Trận 3 con: 2.982 bãi** (phổ biến nhất)
  - **Trận 4 con: 1.245 bãi**
  - **Trận 5 con: 574 bãi**
  - Trận 6 con: 138 bãi
  - Trận 7..10 con: 458 bãi

---

### 3.2. `listMap` (8.975 bản ghi) — ĐỊNH VỊ CỔNG CHUYỂN BẢN ĐỒ & TỌA ĐỘ ĐI BỘ

Mỗi bản ghi chứa liên kết giữa 2 map:
```json
{
  "srcId": 12003,
  "srcName": "[12003]Quảng trường Trác Quận",
  "WarpId": 1,
  "DestId": 12002,
  "DestName": "[12002]Đường phố Trác Quận",
  "actionKind": 20,
  "actionKindPosX": 1245,
  "actionKindPosY": 852,
  "isTeleport": false,
  "isHiddenWarp": false,
  "isNavigationWarp": false,
  "ConditionPriority": 5,
  "PMapEdgeIndex": 0
}
```

- **Ứng dụng cho Web Bot:**
  - `actionKindPosX`, `actionKindPosY`: Tọa độ đứng an toàn trước cổng trước khi gửi gói qua cổng `14/08`.
  - Triệt tiêu 100% tình trạng máy chủ ngắt kết nối do di chuyển không hợp lý (kick anti-cheat mã 5 khi cự ly tới cửa $> 60$px).
  - Thay thế hoặc bổ sung hoàn hảo cho `doorCoordinates.json` (hiện tại mới chỉ có 377 cổng thủ công).

---

### 3.3. `listItemsInShop` (1.728 bản ghi) — DANH MỤC HÀNG HÓA SHOP NPC

```json
{
  "kind": 0,
  "MapId": 12992,
  "MapName": "Lôi Đài Hương Dũng",
  "ItemNo": 12,
  "ItemId": 27136,
  "ItemName": "Thuốc Vận Công",
  "PosX": 950,
  "PosY": 400,
  "HideTime": 0,
  "NpcId": 16034,
  "NpcName": "Thương Nhân"
}
```

- **Ứng dụng cho Web Bot:**
  - Xây dựng tính năng tự động tìm kiếm Shop NPC bán mặt hàng chỉ định (dược phẩm, xôi, bánh bao, trang bị, cẩm nang).
  - Tự động lập lộ trình đến đúng Shop gần nhất để mua nguyên liệu khi cạn kiệt.

---

### 3.4. `listItemsInMap` (1.634 bản ghi) — ĐIỂM THU THẬP TÀI NGUYÊN TỰ NHIÊN

```json
{
  "kind": 0,
  "MapId": 10965,
  "MapName": "",
  "ItemNo": 1,
  "ItemId": 31099,
  "ItemName": "Hoa Dại Đỏ",
  "PosX": 2228,
  "PosY": 126,
  "HideTime": 1,
  "NpcId": 0,
  "NpcName": null
}
```

- **Ứng dụng cho Web Bot:**
  - Chứa tọa độ các bãi khoáng thạch, gỗ, da, thảo dược rơi tự nhiên trên map và thời gian hồi sinh (`HideTime`).
  - Nền tảng cho tính năng Auto Lượm / Thu thập tài nguyên chế tạo.

---

### 3.5. `listItemsInQuest` (5.318 bản ghi) & `Mission` — NHIỆM VỤ & VẬT PHẨM QUEST

- Danh mục vật phẩm quest, NPC phát/nhận nhiệm vụ.
- Cung cấp dữ liệu phục vụ xây dựng Quest Runner và Script Engine tự động làm chuỗi nhiệm vụ tân thủ, phong thần, chuyển sinh.

---

## 4. Kế Hoạch Triển Khai

1. **Giai đoạn 1 (Hiện tại):** 
   - Trích xuất dữ liệu `AGI`, `HP` và `Count` (từ `listBattle`) để bổ sung vào [trainSpawns.json](file:///Users/user/TS-Bot-Web/packages/engine/src/data/trainSpawns.json).
   - Hiển thị cột AGI và số lượng quái trên bảng Web UI Tab Bãi Train.
2. **Giai đoạn 2 (Tương lai):**
   - Trích xuất `listMap` (8.975 cổng) cập nhật toàn diện vào hệ thống Route Navigation.
   - Xây dựng bộ tìm kiếm Shop mua bán vật phẩm tự động từ `listItemsInShop`.
   - Xây dựng chế độ auto thu thập tài nguyên từ `listItemsInMap`.
