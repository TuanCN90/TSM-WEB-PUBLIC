# Game Actions Protocol & Knowledge Base (TS Online)

> Cập nhật 2026-10-16. Phạm vi: **hành động tương tác trong game** (không gồm đăng nhập).
> Bổ sung cho `docs/KNOWLEDGE.md` (giao thức nền, giá trị trạng thái, UI). Nguồn: thư mục `tool-reference/BOT TSM/` (script, bảng dữ liệu) + các gói đã bắt/đối chiếu trong dự án.

---

## 0. Đọc trước: nguồn, phạm vi, giới hạn

**Đã phân tích:**

- **136 script** `.ini` (`Script/`, `Script/Config`, `Script/Quest`, `Script/Timer`): 4.034 lời gọi lệnh, 60 loại lệnh (Phụ lục A). Parser của engine đọc **0 lỗi**.
- **173 gói `packet` thô trong 51 script**: đây là **gói yêu cầu thật mà client gửi (C→S)**, đã đóng khung và mã hoá. Giải mã được toàn bộ, độ dài khớp header 173/173 (mục 1.2). Đây là nguồn quý nhất của tài liệu này.
- Bảng dữ liệu: `Data/Warp_C.dat` (41 cổng truyền tống), `Data/door.ini` (8.360 dòng), `Data/dialog.ini` (147 dòng), `Data/attackai.ini`; bảng tên map/NPC đã dựng ở `docs/KNOWLEDGE.md` A6.

**KHÔNG có (và vì sao):**

- **Mã dựng gói của các lệnh cấp cao** (`move`, `click`, `warp_*`, `teleport`, `use_item`, `buy`, `sell`, `pickup_item`, `drop_item`, `menu`, `send`, `select_pet*`, `leave_party`…). Các lệnh này nằm trong `SimpleBot.exe` — một stub .NET với khối dữ liệu mã hoá. **Đã quyết định không giải mã/gỡ bảo vệ**. Với các hành động này, mục "Packet gửi" ghi **❌ chưa có** và kèm cách lấy (mục 7).
- `Account/*.ini` là khối mã hoá (có thể chứa tài khoản đã lưu): **không đọc, không giải mã**.
- Không có lệnh/gói trong tool cũ cho: mở/cất/lấy rương, xuất chiến/thu hồi võ tướng, đổi vị trí võ tướng, mời/nhận lời mời đội, nhận quà online. Các mục này ghi rõ "không có trong tool cũ".

**Độ tin cậy:** ✅ khớp byte với gói thật (có kiểm chứng bằng code, mục 6) · ⚠ ý nghĩa **suy ra** từ tên script/chú thích/giá trị, cấu trúc byte thì chắc · ❌ chưa biết.

> ⚠ **Lưu ý phiên bản:** các script/gói này đến từ tool cũ (server trước đây). Khung gói và nhiều opcode (vd ping `01/10`) trùng với server hiện tại (`34.81.22.35:6614`), nhưng **chưa có gói nào được gửi thử trên server hiện tại**. Hãy coi mọi opcode C→S là *giả thuyết cần thử từng cái một, thận trọng* (xem `docs/KNOWLEDGE.md` A5, A9: không spam server).

---

## 1. Quy tắc packet

### 1.1 Khung và endian

```
WIRE:    [6d 3c][len u16][body …]      byte 0–1 = F4^99, 44^78 ; len và body XOR 0xAD
GIẢI MÃ: f[0..1]=6d 3c | f[2..3]=len (LE, TỔNG độ dài frame) | f[4..5]=00 00 | f[6]=cmd | f[7]=sub | f[8..]=payload
```

- **Little-Endian** cho mọi số nhiều byte (`u16`, `u32`). Chuỗi: `[len u8][bytes]` (ASCII/Big5 cho chữ Trung).
- Quy ước tài liệu: **payload = `f[8..]`**. Trong 173 gói của script, byte đầu payload luôn là `00`; các tham số đi sau nó.
- Mọi offset là từ byte 0 của frame đã giải mã (cùng quy ước `docs/KNOWLEDGE.md` A1).

### 1.2 Hex trong `packet` của script là WIRE (đã XOR)

Ví dụ `packet 6d3ca1adadade0a6ad2c92ad`:

| Bước | Kết quả |
|---|---|
| Giữ nguyên 2 byte đầu | `6d 3c` |
| `a1 ad` XOR `ad` | `0c 00` → len = 12 (đúng bằng số byte của chuỗi) |
| `ad ad` XOR `ad` | `00 00` |
| `e0 a6` XOR `ad` | cmd = `4d`, sub = `0b` |
| `ad 2c 92 ad` XOR `ad` | payload = `00 81 3f 00` |

### 1.3 Cảnh báo: lệnh `packet` của web bot KHÔNG nhận hex wire

`packet <hex>` của web bot (`encodeRaw`) nhận **body đã giải mã** (`00 00 cmd sub payload…`) và **tự đóng khung + XOR**. Dán thẳng hex wire của script vào sẽ bị XOR hai lần ⇒ gói sai. Cách dùng đúng:

- Gửi body: ví dụ `0000 4d0b 00813f00` (không có `6d3c`/len).
- Hoặc dùng `decodeWire()` ở mục 6, hoặc **đề xuất**: cho `encodeRaw` nhận diện hex bắt đầu `6d 3c` + độ dài khớp thì gửi nguyên văn (chưa áp dụng vì sửa engine làm backend khởi động lại và ngắt phiên đang treo).

### 1.4 Điểm cần kiểm tra thêm (chưa kết luận)

- Gói **ping `01/10`** trong script dài **9 byte** (payload `00`), còn heartbeat/INIT của codec hiện tại (dựng từ pcap server mới) dài **8 byte** (không có byte `00`). Có thể chỉ khác phiên bản; chưa biết server có kén không (và chưa chứng minh liên quan tới việc server đóng kết nối định kỳ).
- Các gói client trong script luôn có `f[8]=00`; một số gói INIT của codec thì `f[8]` là dữ liệu (vd `19/29` có `7b`) và được server hiện tại chấp nhận. Kiểu `f[8]=00` của script **chưa được thử** trên server hiện tại.

---

## 2. Opcode Cheat Sheet

### 2.1 Client → Server (từ script; số liệu: số lần / số script)

`payload` = `f[8..]`; `[…]` là phần tuỳ chọn. Tên hành động là **tên đề xuất** theo tên script/chú thích.

| Opcode | Hành động đề xuất | Payload (hex, mẫu) | Trường (suy ra) | Lần | Tin cậy |
|---|---|---|---|---:|---|
| `57/02` | `CLAIM_FIRST_14_DAYS` | `00 04 DD 00 00 00 01` | `DD` = ngày 1..14 | 14 | ✅ cấu trúc · ⚠ ý nghĩa |
| `4d/0b` | `CLAIM_REWARD` | `00 CC II [00]` | `CC` ∈ {`7a`,`80`,`81`}, `II` = mục nhận | 28 | ⚠ |
| `4d/03` | `EVENT_ACTION` | `00 EE 00` | `EE` ∈ {`01`,`15`,`3f`} = mã hoạt động | 12 | ⚠ yếu |
| `2f/02` | `DAILY_QUEST_ACCEPT` | `00 QQ 00 FF` | `QQ` = quest 1..14, `FF`=`01` cho quest 1 và 14 | 66 | ⚠ |
| `2f/0c` | `DAILY_QUEST_CONFIRM?` | `00` | — | 6 | ⚠ yếu |
| `2f/0a` | `CENTER?` | `00` | — | 4 | ❌ |
| `27/69` | `GUILD_CHECKIN` | `00` | — | 1 | ⚠ (tên script) |
| `27/77` | `GUILD_BOSS_ENTER?` | `00` | — | 3 | ⚠ |
| `30/01` | `TOWER_ENTER` | `00 FF FF FF FF` (u32) | tầng tháp: `c8`=200, `d2`=210 | 2 | ✅ khớp tên script |
| `61/01` | `DIJIE_REGION` | `00 RR` | `01` Lông Vũ, `02` Linh Thạch | 2 | ✅ khớp tên script |
| `48/02` | `LOTTERY_DRAW` | `00` | "Xổ quà" 1 lần | 2 | ⚠ |
| `5d/00` | `MONOPOLY_ROLL` | `00` | "quay xúc xắc" | 7 | ⚠ |
| `5d/01` | `MONOPOLY_NEXT?` | `00 00` | đi sau mỗi lần quay | 6 | ⚠ yếu |
| `54/02` | `SHOP_OFFER` | `00 02 23 00` · `00 02 2b 00 01 00` · `00 01 25 00 6e 01 00 65 a2` | mã ưu đãi + số lượng | 4 | ⚠ |
| `54/01` | `SHOP_OFFER_QUERY?` | `00 25 00 01 00 65 a2` | gacha script `0.1. Quay Lap Ba slot 1` | 1 | ❌ |
| `63/01` | `ARENA_ENTER` | `00` | đấu trường | 5 | ⚠ |
| `63/04` | `ARENA_CLAIM` | `00` | nhận thưởng đấu trường | 1 | ⚠ |
| `63/06` | `ARENA_MODE?` | `00 01 01` | chế độ "1 trận" | 1 | ⚠ yếu |
| `6f/00` | `SOUL_BOSS_OPEN?` | `00` | boss hồn | 1 | ⚠ yếu |
| `6f/04` | `SOUL_BOSS_PICK` | `00 NN` | `NN` = 1..4 | 4 | ⚠ |
| `21/01` | `PK_TOGGLE` | `00 01` | "mở pk" | 1 | ⚠ (tên script) |
| `21/02` | `JOIN_WAR` | `00 01` | "mở tham chiến" | 1 | ⚠ (tên script) |
| `01/10` | `PING` | `00` | keep-alive | 1 | ✅ |

### 2.2 Server → Client (đã giải mã trong dự án; xem `docs/KNOWLEDGE.md` A2)

| Opcode | Nội dung | Dùng để cập nhật UI |
|---|---|---|
| `03/00` | Spawn đơn vị (id 8 byte, hệ, level, map, x, y, tên) | Vào map mới / tên, hệ, level, vị trí |
| `07/00` | Vị trí 1 đơn vị: `uid[8] map u16 x u16 y u16` (`f[9..]`) | `location` khi UID là của mình |
| `05/03` | Snapshot nhân vật: HP/SP hiện tại + tối đa, level, exp tích luỹ | Thanh HP/SP/EXP |
| `0f/08` | Snapshot võ tướng: model id, level, HP, SP, exp tích luỹ | Thẻ võ tướng |
| `08/0e`, `08/02` | Cập nhật thuộc tính (mã `0x0124` = exp tích luỹ) | EXP nhân vật / võ tướng |
| `23/05`, `1a/04` | Vàng, Xu | Ô tài sản (và sự kiện "Vàng/Xu ±N") |
| `17/05` | **Túi đồ** (không phải trang bị): `00 00 count u16` + `count × 36 byte [slot u8][itemId u16][qty u32][29 byte phụ]`; `17/08` cập nhật 1 ô | `CharacterState.bag` → popup Thùng đồ |
| `02/0a` | Thông báo hệ thống (Big5) | Đối chiếu phần thưởng (chưa dùng cho state) |
| `55/01` (15 KB) | Gói lớn lúc login (nghi inventory) | ❌ chưa giải mã |
| `06/01` | Di chuyển của đơn vị khác | ❌ chưa giải mã layout |

---

## 3. Danh mục hành động

Mẫu cho mỗi hành động: **Hành vi · Packet gửi · Tham số/Điều kiện · Phản hồi/State · Mã mẫu · Tin cậy**.
Mã mẫu (`B.xxx`, `ACTIONS`) nằm ở **mục 6** và đã được kiểm chứng với gói thật.

### 3.1 Bản đồ / Di chuyển

#### `MOVE` — Di chuyển tới toạ độ (`move x y`, `walk x,y`)
- **Hành vi:** nhân vật đi tới `(x, y)` trên map hiện tại (script dùng 109 lần: 101 `move`, 8 `walk`).
- **Packet gửi:** ❌ chưa có (tool dựng nội bộ). Gợi ý khi bắt gói: dự kiến chứa `x u16`, `y u16` (toạ độ trong game là `u16`, xem `07/00`).
- **Tham số/Điều kiện:** `x`, `y` (số nguyên); không đang trong trận đánh.
- **Phản hồi/State:** `07/00` của chính mình → cập nhật `location.x/y` (đã làm sẵn trong codec); có thể kèm `06/01` (chưa giải mã).
- **Mã mẫu:** chưa có builder (cần pcap). Khung gợi ý: `pkt(CMD_MOVE, SUB_MOVE, ...u16(x), ...u16(y))`.
- **Tin cậy:** ❌ packet · ✅ phản hồi vị trí.

#### `WARP_TO_MAP` — Dịch chuyển tới map (`warp_map id`, `teleport id`, `teleport_warp id`)
- **Hành vi:** `warp_map` (108 lần) nhảy tới map theo id (có cả map sự kiện Giáng Sinh 49944–49946, cổng thành); `teleport` (43) và `teleport_warp` (44) truyền tống tới **cổng thành** trong `Warp_C.dat` (vd `12001` = Cửa thành Trác Quận, dùng nhiều nhất: 36+13 lần).
- **Packet gửi:** ❌ chưa có.
- **Tham số/Điều kiện:** `mapId` (`u16` — mọi id tìm thấy đều < 65536); phải ở map cho phép truyền tống, không đang đánh.
- **Phản hồi/State:** chuỗi `03/00` (spawn ở map mới) + `07/00` → cập nhật `location.map/x/y` và sự kiện "Đổi map" (đã làm sẵn).
- **Mã mẫu:** `getMapNameById(mapId)` để hiện tên; builder cần pcap.
- **Tin cậy:** ❌ packet · ✅ phản hồi. Khác biệt `teleport` vs `teleport_warp` chưa rõ.

#### `WARP_BY_ID` — `warp_id N,mapId,x,y` / `warp_d`
- **Hành vi:** 491 lần trong 51 script — nhiều nhất cùng `click`. Đi tới/qua điểm `(mapId,x,y)` với chỉ số `N`; thường lặp theo dãy map phó bản (12922…12959, 49984…).
- **Packet gửi:** ❌ chưa có.
- **Tham số:** `N` (ý nghĩa chưa xác định: chỉ 25/377 lời gọi khớp chỉ số cổng trong `door.ini`), `mapId`, `x`, `y`. Dạng rút gọn `warp_id N` (⚠ suy ra) dùng map hiện tại.
- **Phản hồi/State:** như `WARP_TO_MAP`.
- **Tin cậy:** ❌ packet · ❌ ý nghĩa `N`.

#### `SWITCH_CHANNEL` — Đổi kênh (`channel n`)
- **Hành vi:** chọn kênh của map. Script chỉ dùng `channel 0` (47 lần, 42 script) để về kênh đầu. Bot hỗ trợ đổi mọi kênh từ giao diện và script.
- **Packet gửi:** `07/02 00 <channel u8>` (`Change_Channel_07_02`).
- **Tham số:** `n` (0-based: 0 là Kênh 1, 1 là Kênh 2...).
- **Phản hồi/State:**
  - Thành công: S→C `07/02` độ dài ≥ 23 bytes (chứa toạ độ mới và byte kênh tại offset 23). Cập nhật `location.channel` và `location.channels`.
  - Thất bại / Kênh đầy: S→C `07/02` ngắn (< 23 bytes) hoặc gói `02/0a` mang TextData `10135` ("Kênh đã ĐẦY"). Kênh mục tiêu được gán trạng thái `"full"`.
  - Xem chi tiết tại `docs/CHANNEL_KNOWLEDGE.md`.
- **Tin cậy:** ✅.

### 3.2 Võ tướng (Pet)

> Trong script, các thao tác chọn võ tướng **không phải gói đơn lẻ** mà là tính năng của tool, và nhiều lệnh được truyền **qua chat** (`chat_local command …`) để các bot khác tự thực thi.

#### `PET_SELECT` — Chọn võ tướng (`select_pet npcId`, `select_pet_main`, `save_pet_main`)
- **Hành vi:** chọn võ tướng theo **model/NPC id** (script dùng `13016` = Tôn Quyền, `41387` = Yêu Quỷ Vương, `45505`); `save_pet_main` ghi nhớ võ tướng đang xuất chiến, `select_pet_main` chọn lại.
- **Packet gửi:** ❌ chưa có. Khi có, id là model id `u16` giống trường `0f/08` u16@11 (đã tra tên bằng `npcNames`).
- **Điều kiện:** võ tướng đang có trong danh sách.
- **Phản hồi/State:** `0f/08` → `pet.name/level/hp/sp/exp` (đã làm).
- **Tin cậy:** ❌ packet.

#### `PET_FILTER` — Lọc theo hệ/đạo đức/lượt/kỹ năng
- **Hành vi:** `select_pet_element n` (1 Địa, 2 Thủy, 3 Hỏa, 4 Phong — 20 lần), `select_pet_moral n` (1..5 — 19 lần), `select_pet_turn n` (0..2 — 5 lần), `select_pet_skill id` (3 lần).
- **Cơ chế quan sát được:** tất cả 65 lời gọi `chat_local` đều có dạng `command select_pet_*`/`command save_pet_main`/`command select_pet_main`, tức là **gửi chuỗi lệnh qua chat** cho các bot khác trong đội xử lý, và `chat_team script <tên>` để bảo thành viên chạy một script. ⚠ (suy ra từ mẫu lặp lại).
- **Packet gửi:** chat — ❌ chưa có opcode chat.
- **Tin cậy:** ❌ packet · ⚠ cơ chế.

#### `PET_USE_ITEM` — Cho võ tướng dùng vật phẩm (`use_item_pet itemId sl qty`)
- **Hành vi:** cho ăn/hồi phục. Chỉ 2 lần dùng (`use_item_pet 64541 sl 1`); chữ `sl` cố định (viết tắt "số lượng").
- **Packet gửi:** ❌ chưa có.
- **Phản hồi/State:** giảm số vật phẩm; HP/SP võ tướng đổi (chưa có gói HP/SP biến động).
- **Tin cậy:** ❌.

#### `PET_TOGGLE_BATTLE` / `PET_RECALL` / `PET_REORDER`
- **Không có trong tool cũ** (không có lệnh và không có gói tương ứng trong script). Cần bắt pcap khi thao tác trong game.

### 3.3 Thùng đồ (Inventory / Storage)

#### `INVENTORY_USE_ITEM` — `use_item itemId qty`
- **Hành vi:** dùng vật phẩm (dược phẩm, phù, bí kíp…); 17 lần, 9 script (vd `use_item 20001 1`).
- **Packet gửi:** ❌ chưa có. Khi bắt gói: dự kiến `itemId u32` + `qty u16/u32`.
- **Điều kiện:** có vật phẩm; không đang đánh (với vật phẩm ngoài trận).
- **Phản hồi/State:** giảm số lượng trong kho (túi đồ = `17/05` + `17/08`, đã giải mã; gói dùng vật phẩm thì chưa có); chỉ số HP/SP đổi nếu là dược phẩm.
- **Tin cậy:** ❌.

#### `INVENTORY_PICKUP_ITEM` / `INVENTORY_DROP_ITEM` — `pickup_item id`, `drop_item id qty`
- **Hành vi:** nhặt vật phẩm rơi (16 lần, id kiểu `29454`); vứt `qty` (đều `999` = bỏ hết, 4 lần).
- **Packet gửi:** ❌ chưa có. **Phản hồi:** thay đổi kho.
- **Tin cậy:** ❌.

#### `SHOP_BUY` / `SHOP_SELL` — `buy slot qty`, `sell itemId`
- **Hành vi:** mua (`buy 1 20`, `buy 1 999`… 7 lần) / bán (2 lần) với NPC shop; `slot` là vị trí món trong shop.
- **Packet gửi:** ❌ chưa có (đi sau `click NPC` + `menu`).
- **Phản hồi/State:** `23/05` / `1a/04` đổi Vàng/Xu (đã có sự kiện "Vàng/Xu ±N → tổng"), kho đổi.
- **Tin cậy:** ❌ packet · ✅ phần phản hồi tiền.

#### `STORAGE_OPEN` / `STORAGE_STORE` / `STORAGE_TAKE`
- **Không có trong tool cũ.** Cần pcap.

### 3.4 Hoạt động ngày & phần thưởng — gói thô **đã có** (✅ cấu trúc byte)

> Phần này là kết quả chính: các gói đều lấy nguyên văn từ script, **dựng lại bằng code và khớp byte** (mục 6). Ý nghĩa gán theo **tên script/chú thích**, nên ghi ⚠.

#### `CLAIM_FIRST_14_DAYS` — Nhận thưởng 14 ngày đầu (`57/02`)
- **Hành vi:** nhận quà theo ngày trong 14 ngày đầu (script `Quest/0. nhan thuong 14 ngay dau tien.ini`: 14 gói liên tiếp).
- **Packet gửi:** `cmd=57 sub=02`, payload `00 04 DD 00 00 00 01` — `DD` = ngày (`01`..`0e`); các byte `04`, `00 00 00`, `01` cố định.
- **Tham số/Điều kiện:** `day` 1..14; ngày đó chưa nhận.
- **Phản hồi/State:** cộng Vàng/Xu/vật phẩm → `23/05`, `1a/04`, thông báo `02/0a`; kho đổi.
- **Mã mẫu:** `B.claim14Day(day)` ✅ khớp 14/14.

#### `CLAIM_REWARD` — Nhận thưởng theo mục (`4d/0b`)
- **Hành vi:** nhận quà theo một **danh mục `CC` + chỉ số `II`**: `7a` (lượt/túi ngọc của Cờ Tỷ Phú: `01,02,05,06,07,08,0b`), `80`/`81` (Thẻ Tháng `81 3f..44`, `80 01`; "THC" `81 11..16`).
- **Packet gửi:** `cmd=4d sub=0b`, payload `00 CC II [00]` (có hoặc không byte `00` cuối tuỳ mục).
- **Tham số:** `category`, `index`; đã đủ điều kiện nhận.
- **Phản hồi/State:** tiền/vật phẩm đổi; thông báo `02/0a`.
- **Mã mẫu:** `B.claimReward(category, index)` ✅ khớp.
- **Tin cậy:** ✅ cấu trúc · ⚠ ý nghĩa `CC`.

#### `EVENT_ACTION` — Hoạt động theo mã (`4d/03`)
- **Hành vi:** kích hoạt hoạt động có mã `EE` (`3f` dùng trong script PvP "giảm điểm"; `01` trước `leave_party`/"vào cổng 2k"; `15` trong "`2. diem danh event tu dau`, `2. hit exp event tu dau`").
- **Packet gửi:** `cmd=4d sub=03`, payload `00 EE 00`. **Tin cậy:** ⚠ yếu.

#### `DAILY_QUEST_ACCEPT` — Nhiệm vụ ngày (`2f/02`, kèm `2f/0c`)
- **Hành vi:** chọn nhiệm vụ ngày `QQ` (1..14). Các script `NhiemVuNgay*`, `9cung0Boss`, `auto tim dau dau*` gửi lần lượt `QQ`=2..13 theo nhóm cấp (chú thích `15-80`, `81-150`, `151-200`, `201-400`, lặp 3 lần); `QQ`=1 và 14 có cờ `01` (chú thích `thao phat thien su`, `ngay tan hoan quan`).
- **Packet gửi:** `cmd=2f sub=02`, payload `00 QQ 00 FF`. Sau chuỗi này script gửi `2f/0c` (`00`) rồi `auto 1`.
- **Mã mẫu:** `B.dailyQuest(questId, flag)` ✅ khớp.
- **Tin cậy:** ✅ cấu trúc · ⚠ ý nghĩa; `2f/0c` ⚠ yếu.

#### `GUILD_CHECKIN` — Điểm danh đoàn (`27/69`)
- **Packet gửi:** `cmd=27 sub=69`, payload `00` (không tham số). Script: `Quest/2. diem danh doan.ini`.
- **Phản hồi:** thưởng điểm danh (tiền/vật phẩm). **Mã mẫu:** `B.guildCheckin()` ✅. **Tin cậy:** ✅ cấu trúc · ⚠ ý nghĩa.

#### `EVENT_CHECKIN` — Điểm danh sự kiện (`event tu dau`)
- Script `Quest/2. diem danh event tu dau.ini` ("điểm danh event") dùng `4d/03` payload `00 15 00`. **Tin cậy:** ⚠ yếu.

#### `TOWER_ENTER` — Vào tháp (`30/01`)
- **Packet gửi:** `cmd=30 sub=01`, payload `00` + `u32` tầng (`c8 00 00 00` = 200; `d2 00 00 00` = 210). Sau đó `await_battle`.
- **Mã mẫu:** `B.enterTower(floor)` ✅. **Tin cậy:** ✅ (giá trị khớp tên script `Thap 210`).

#### `DIJIE_REGION` — Chọn vùng Dị giới (`61/01`)
- **Packet gửi:** `cmd=61 sub=01`, payload `00 RR` — `01` = Lông Vũ, `02` = Linh Thạch. Script `1. di gioi long vu.ini`, `1. di linh thach.ini` (trước `setting 1`).
- **Phản hồi:** đổi map (map Dị giới `49942` = "Dị giới TS (lông vũ)"), bắt đầu tick exp ~60s.
- **Mã mẫu:** `B.dijieRegion(1|2)` ✅. **Tin cậy:** ✅.

#### `LOTTERY_DRAW` — Xổ quà (`48/02`)
- **Packet gửi:** `cmd=48 sub=02`, payload `00`. Script `Roll 1 Xu Vang.ini` (chú thích "Xổ quà"). **Mã mẫu:** thêm `pkt(0x48,0x02)`. **Tin cậy:** ⚠.

#### `MONOPOLY_ROLL` — Cờ Tỷ Phú (`5d/00`, `5d/01`)
- **Hành vi:** "vào cờ tỷ phú" rồi "quay xúc xắc" lặp 25 lần: `5d/00` (`00`), sleep, `5d/01` (`00 00`), cùng một `01/10` (ping) chen giữa. Nhận lượt/túi ngọc bằng `4d/0b` danh mục `7a`.
- **Mã mẫu:** `B.rollDice()` ✅. **Tin cậy:** ⚠.

#### `SHOP_OFFER` — Mua ưu đãi / quay lặp (`54/02`, `54/01`)
- **Raw đã thấy:** `54/02 00 02 23 00` ("boss đoàn thêm lượt" — mua thêm lượt), `54/02 00 02 2b 00 01 00` ("mua ưu đãi"), `54/02 00 01 25 00 6e 01 00 65 a2` và `54/01 00 25 00 01 00 65 a2` (script `0.1. Quay Lap Ba slot 1`). Cấu trúc `[loại][mã ưu đãi u16][...]` chỉ mới thấy 4 mẫu ⇒ **chưa dựng builder tổng quát**. **Tin cậy:** ⚠.
- **Bổ sung (cap 16/10, 2 script Daily `data/custom_scripts/Daily/`):** luồng `54/01 00 <offer u16> 01 00 [tail]` (server đáp `54/01 00 <offer> ff xx 79 01 00`) rồi `54/02 00 01 <offer u16> …` (server đáp `17/09 00 NN 01 00 00 00` + `54/02 00 <offer> 00 01`). Offer `0x25` (Xu Lặp Ba → exp võ tướng + `02/0a` "呂布"): buy `00 01 25 00 04 01 00 b9 36`; offer `0x0b` (Roll xu vàng): buy `00 01 0b 00 01 05 01 00 01 00`, sau đó `48/02 00` → `48/02 00 01 0e 2a 00 2d b2 01` + `17/08` (ô 0x2a, item 0xb22d Túi Linh Thạch). Byte `04`/`05` (trùng byte đầu `17/09`) và đuôi `b9 36` (mẫu cũ `6e … 65 a2`) **chưa rõ, có thể phụ thuộc trạng thái** ⇒ script phát lại nguyên văn từ cap, ⚠. `4c/05 00` / `48/05 00` = mở bảng (server đáp danh sách).

#### `ARENA_*` — Đấu trường (`63/01`, `63/04`, `63/06`)
- `63/01` (`00`) trước `pvp 0` trong các script đấu trường; `63/04` (`00`) trong `Quest/3. nhan thuong dau truong dinh cao.ini` (nhận thưởng); `63/06` (`00 01 01`) trong "1 trận". **Mã mẫu:** `B.arenaEnter()`, `B.arenaClaim()` ✅. **Tin cậy:** ⚠.

#### `SOUL_BOSS_PICK` — Boss hồn (`6f/00`, `6f/04`)
- Sau mỗi `await_battle`, script gửi `6f/04` với `00 NN`, `NN` = 1,2,3,4 (4 mục). **Mã mẫu:** `B.soulBossPick(n)` ✅. **Tin cậy:** ⚠.

#### `GUILD_BOSS_ENTER` — Boss đoàn (`27/77`)
- `27/77` (`00`) sau `leave_party; teleport 12001; …; warp_id 1` rồi `await_battle`. **Tin cậy:** ⚠.

#### `PK_TOGGLE` / `JOIN_WAR` (`21/01`, `21/02`)
- Payload `00 01`. Script `Quest/0. mở pk.ini`, `Quest/0. mở tham chiến.ini` (mỗi script chỉ gồm đúng 1 gói). **Mã mẫu:** `B.togglePk()`, `B.joinWar()` ✅. **Tin cậy:** ✅ cấu trúc · ⚠ ý nghĩa.

#### `PING` (`01/10`) · `2f/0a`
- `01/10` payload `00`, **Mã mẫu** `B.ping()` ✅. `2f/0a` (`00`): xuất hiện trong `center.ini`, "ngưng kịch bản", "Nv hàng ngày" trước `setting 0`; ý nghĩa **chưa rõ** (nghi "về trung tâm"). **Tin cậy:** ❌.

#### `DAILY_ONLINE_GIFT` — Nhận quà online
- **Không có trong tool cũ.** Cần pcap.

### 3.5 Tổ đội & hội thoại

#### `PARTY_LEAVE` — `leave_party`
- **Hành vi:** rời đội; **73 lần / 63 script** (gần như mọi script gọi trước khi bắt đầu). **Packet gửi:** ❌ chưa có. **Phản hồi/State:** `party.members` — chưa giải mã gói đội ngũ (UI luôn 4 slot trống). **Tin cậy:** ❌.

#### `PARTY_INVITE` / `PARTY_ACCEPT` / `PARTY_SET_LEADER`
- **Đã giải mã từ nguồn khác (Easytool.dll + Pim-Bot + pcap): opcode `0d/xx`** — xem `docs/PARTY_KNOWLEDGE.md` (đoạn dưới đây là ghi chú cũ trước khi có dữ liệu).
- **Không có lệnh tương ứng trong tool cũ** ngoài `leave_party`, `await_party`, `room_team a b` (1 lần), `if_leader`. Cần pcap.

#### `NPC_CLICK` / `DIALOG_MENU` / `DIALOG_SEND` — `click`, `menu n`, `send n`
- **Hành vi:** `click N,mapId,x,y[,waitMs]` (570 lần, hàng đầu) bấm NPC/đối tượng rồi `menu n` (116) chọn mục và `send n` (123) chọn đáp án hội thoại; `await_dialog` (44) chờ hộp thoại; `if_talk text` / `if_talkid id op n` rẽ nhánh theo lời NPC.
- **Dữ liệu hỗ trợ:** `Data/dialog.ini` — 147 dòng `a,b,c ⇥ n` (vd `12001,50,56 ⇥ 2`): bảng đáp án hội thoại; ý nghĩa 3 số đầu chưa rõ (⚠ nghi `npc/step/choice` → đáp án).
- **Packet gửi:** ❌ chưa có. **Tin cậy:** ❌.

#### `DUNGEON_START` / `PVP` — `dungeon stage diff`, `start_dungeon`, `pvp 0|5`
- `dungeon` (90 lần; stage 18..58, 40 giá trị) luôn đi cặp `start_dungeon`; `pvp 5` (95 lần), `pvp 0` (5 lần). **Packet gửi:** ❌ chưa có. **Tin cậy:** ❌.

### 3.6 Điều khiển auto (tính năng của tool, không phải gói)

`auto 0|1` (261 lần, 111 script), `setting 0|1` (171), `auto_hpsp 0|1` (28), `mode_attack`, `save_map`, `offline minutes`… là **trạng thái của tool/client** (bật auto đánh, tự hồi). Chưa biết gói tương ứng (nhân vật có cờ `auto` trong `CharacterState` nhưng UI luôn `false`). **Tin cậy:** ❌.

---

## 4. Phản hồi (S→C) và state UI cần cập nhật

| Sau hành động | Gói phản hồi **đã giải mã sẵn** | State UI | Gói **chưa biết** |
|---|---|---|---|
| Di chuyển / đổi map / đổi kênh | `07/00` (mình), `03/00`, `07/02` (đổi kênh) | `location.map/x/y/channel/channels`, sự kiện "Đổi map", "Kênh" | `06/01` |
| Nhận thưởng / mua / bán | `23/05` Vàng, `1a/04` Xu, `02/0a` thông báo | `economy`, sự kiện "Vàng/Xu ±N" | kho đồ (`55/01`, `17/05`) |
| Xuất chiến võ tướng | `0f/08` | `pet.*` | cờ xuất/thu hồi |
| Thắng trận / tick Dị giới | `08/0e`, `08/02` (mã `0x0124`) | `player.exp`, `pet.exp`, sự kiện exp | gói kết thúc trận, HP/SP biến động |
| Lên cấp | `05/03`, `03/00` | `player.level` | — |
| Đội ngũ | — | — | toàn bộ gói đội ngũ |

---

## 5. Dữ liệu hỗ trợ trong `tool-reference`

| File | Cấu trúc | Ý nghĩa |
|---|---|---|
| `Data/Warp_C.dat` | `u32 count`(41) + bản ghi 16 byte `[textId u32][mapA u16][mapB u16][x u32][y u32]` | Menu truyền tống: `textId` → nhãn ("1. Trác Quận"), `mapA` = map **cổng thành** (12001 = Cửa thành Trác Quận), `mapB` = id điểm truyền tống (vd 11804, chưa có tên), `x,y` = toạ độ (⚠ suy ra) |
| `Data/door.ini` | `fromMap ⇥ toMap ⇥ index` (8.360 dòng, index 1..53 + 1 dòng 1001) | Đồ thị cổng giữa các map. **Quan hệ với `warp_id N` chưa xác nhận** |
| `Data/dialog.ini` | `a,b,c ⇥ n` (147 dòng) | Bảng đáp án hội thoại tự động (⚠ ý nghĩa các số) |
| `Data/attackai.ini` | `attackid=27156,35062` | Danh sách id kỹ năng/đối tượng ưu tiên đánh (⚠ suy ra từ tên) |
| `Data/code.ini` | vài chuỗi mã ngắn | ý nghĩa chưa rõ — **không dùng, không ghi lại nội dung** |

---

## 6. Code mẫu TypeScript (đã kiểm chứng)

**Kiểm chứng:** 25/25 phép dựng lại khớp từng byte với hex trong script; **173/173 gói** giải mã rồi `encodeFrame` lại cho đúng bản gốc. Chạy được bằng `tsx` trong repo.

```ts
// packages/engine/src/transport/socket/codecs/actions.ts   (ĐỀ XUẤT — chưa thêm vào engine)
import { encodeFrame } from "./tsOnline";

/** Đóng gói 1 gói C→S: body = 00 00 cmd sub 00 params… rồi encodeFrame lo [6d 3c][len] + XOR 0xAD. */
export const pkt = (cmd: number, sub: number, ...params: number[]) =>
  encodeFrame(Buffer.from([0x00, 0x00, cmd, sub, 0x00, ...params]));
export const u16 = (n: number) => [n & 255, (n >> 8) & 255];                       // little-endian
export const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** Giải mã hex "wire" lấy từ script (`packet 6d3c…`) → { cmd, sub, payload }. */
export function decodeWire(hex: string) {
  const f = Buffer.from(hex, "hex");
  for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
  if (f.readUInt16LE(2) !== f.length) throw new Error("độ dài không khớp header");
  return { cmd: f[6]!, sub: f[7]!, payload: f.subarray(8) };
}

/** Builder cho các gói ĐÃ có mẫu thật trong script. Tên là đề xuất; ý nghĩa xem mục 3.4. */
export const B = {
  claim14Day: (day: number) => pkt(0x57, 0x02, 0x04, day, 0, 0, 0, 0x01),            // day 1..14
  claimReward: (category: number, index: number) => pkt(0x4d, 0x0b, category, index, 0x00),
  eventAction: (id: number) => pkt(0x4d, 0x03, id, 0x00),
  dailyQuest: (questId: number, flag = 0) => pkt(0x2f, 0x02, questId, 0x00, flag),   // flag=1 cho quest 1 và 14
  guildCheckin: () => pkt(0x27, 0x69),
  enterTower: (floor: number) => pkt(0x30, 0x01, ...u32(floor)),                    // 200, 210…
  dijieRegion: (region: 1 | 2) => pkt(0x61, 0x01, region),                           // 1 Lông Vũ, 2 Linh Thạch
  lotteryDraw: () => pkt(0x48, 0x02),
  rollDice: () => pkt(0x5d, 0x00),
  togglePk: () => pkt(0x21, 0x01, 0x01),
  joinWar: () => pkt(0x21, 0x02, 0x01),
  arenaEnter: () => pkt(0x63, 0x01),
  arenaClaim: () => pkt(0x63, 0x04),
  soulBossPick: (n: 1 | 2 | 3 | 4) => pkt(0x6f, 0x04, n),
  ping: () => pkt(0x01, 0x10),
};

/**
 * Gắn vào codec: `TsOnlineSession.encodeAction(name, args)` hiện trả null.
 * Tên action khớp `liveActions.ts` khi thêm; tham số lấy từ Web UI dưới dạng chuỗi.
 * Các hành động chưa có packet (move, warp, use_item, party…) PHẢI vẫn trả null cho tới khi có pcap.
 */
export function encodeAction(name: string, args: string[]): Buffer | null {
  const n = args.map(Number);
  switch (name) {
    case "claim_14day": return n[0]! >= 1 && n[0]! <= 14 ? B.claim14Day(n[0]!) : null;
    case "claim_reward": return B.claimReward(n[0]!, n[1]!);
    case "daily_quest": return B.dailyQuest(n[0]!, n[1] ?? 0);
    case "guild_checkin": return B.guildCheckin();
    case "tower_enter": return B.enterTower(n[0]!);
    case "dijie_region": return n[0] === 1 || n[0] === 2 ? B.dijieRegion(n[0]) : null;
    case "pk_toggle": return B.togglePk();
    default: return null;                         // move / warp_map / use_item / party… → chưa có packet
  }
}
```

**Cách thử an toàn, từng gói một:**

1. Chỉ thử gói **đọc/ít rủi ro** trước (ví dụ nhận thưởng quen thuộc), mỗi lần một gói, cách nhau vài chục giây.
2. Bật `logLevel=debug` **trước khi đăng nhập**; xem `[PKT …]`/`rx` để thấy server phản hồi gì (và `02/0a` thông báo).
3. Nếu server đóng kết nối ngay sau một gói ⇒ dừng, ghi lại opcode đó là "không hợp lệ trên server hiện tại".
4. Không thử gói có thể tiêu tài nguyên (mua/vứt/bán) cho tới khi hiểu rõ.

Có thể thử ngay bằng lệnh `packet` của web bot với **body** (mục 1.3), ví dụ ping: `0000 0110 00`.

---

## 7. Cần bắt thêm (kế hoạch pcap) — để lấp các ❌

Dùng Wireshark/PCAPdroid với client game thật, bắt `tcp port 6614`. Mỗi lần **làm đúng một thao tác**, ghi lại giờ, lưu thành một file riêng:

| Thao tác trong game | Mục tiêu |
|---|---|
| Đi bộ tới một điểm trên map; bấm vào bản đồ để đi | Gói `MOVE` + `06/01` |
| Dịch chuyển tới 1 map/cổng thành bằng menu truyền tống | `WARP_TO_MAP`, `TELEPORT` |
| Đổi kênh | `SWITCH_CHANNEL` (`07/02` — đã hoàn thành, xem `docs/CHANNEL_KNOWLEDGE.md`) |
| Bấm NPC → chọn menu → chọn đáp án | `NPC_CLICK`, `MENU`, `SEND` |
| Xuất chiến / thu hồi / đổi vị trí võ tướng | `PET_*` |
| Dùng 1 vật phẩm; nhặt; vứt 1 cái; mua 1; bán 1 | `INVENTORY_*`, `SHOP_*` |
| Mở rương, cất 1, lấy 1 | `STORAGE_*` |
| Mời/nhận/rời đội | `PARTY_*` + gói đội ngũ |
| Một trận đánh trọn vẹn | gói kết thúc trận, HP/SP biến động, thưởng exp |
| Nhận quà online, điểm danh hằng ngày | `DAILY_*` |

Phân tích: dùng `[PKT …]` và log `debug` của repo (mục 6 của `docs/KNOWLEDGE.md`/C1), giải mã bằng `decodeWire`, so sánh hai lần thao tác khác tham số để tìm trường (ví dụ đổi `mapId` đích).

---

## Phụ lục A. Danh mục 60 lệnh DSL trong script tool cũ

4.034 lời gọi / 136 script. "Số script" là số script có dùng lệnh đó. Lệnh có ghi ⚠ chưa nằm trong registry DSL của web bot (parser chỉ cảnh báo, không vỡ).

**Bản đồ/Di chuyển**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `warp_id` | 491 | 51 | `N,mapId,x,y` (rút gọn: `N`) | Dịch chuyển/đi tới điểm `(mapId,x,y)` kèm chỉ số `N`. **Ý nghĩa của `N` chưa xác định** (chỉ 25/377 lời gọi khớp chỉ số cổng trong `door.ini`) |
| `warp_map` | 108 | 11 | `mapId` | Dịch chuyển thẳng tới một map (id map, gồm cả map sự kiện như Giáng Sinh) |
| `move` | 101 | 24 | `x y` | Đi tới toạ độ trên map hiện tại |
| `save_map` | 90 | 42 | `0` hoặc `1` | Bật/tắt lưu map |
| `channel` | 47 | 42 | `n` (0-based) | Chọn kênh (mọi lần gọi đều là `channel 0`) |
| `teleport_warp` | 44 | 16 | `mapId` | Như `teleport` nhưng dùng cho cả id khác trong bảng cổng (vd 25415 Rừng Gia Manh); khác biệt chính xác chưa rõ |
| `teleport` | 43 | 32 | `mapId` | Truyền tống tới "cổng thành" trong bảng `Warp_C.dat` (vd 12001 = Cửa thành Trác Quận) |
| `if_map` | 30 | 4 | `op mapId` | Khối `if` theo mã map (`== != < > <= >=`) |
| `walk` | 8 | 3 | `x,y` | Đi bộ tới toạ độ |
| `center_position` | 6 | 6 | — | Ghi/đặt vị trí trung tâm của map — ⚠ chưa có trong registry DSL của web bot |
| `walk_center` | 6 | 6 | — | Đi về vị trí trung tâm đã đặt — ⚠ chưa có trong registry DSL của web bot |
| `warp_d` | 1 | 1 | `N,mapId,x,y` | Biến thể của `warp_id` (chỉ 1 lần dùng trong script) — ⚠ chưa có trong registry DSL của web bot |
| `await_map` | 1 | 1 | `[mapId]` | Chờ vào map |

**Võ tướng**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `select_pet_element` | 20 | 4 | `1..4` | Lọc/chọn võ tướng theo hệ: 1 Địa, 2 Thủy, 3 Hỏa, 4 Phong |
| `select_pet_moral` | 19 | 3 | `1..5` | Chọn theo "đạo đức" |
| `select_pet_main` | 14 | 8 | — | Chọn lại võ tướng chính đã lưu |
| `save_pet_main` | 10 | 10 | — | Ghi nhớ võ tướng đang xuất chiến làm "chính" |
| `select_pet_turn` | 5 | 4 | `0..2` | Chọn theo lượt chuyển sinh |
| `select_pet` | 5 | 5 | `npcId` | Chọn võ tướng theo **model/NPC id** (vd 13016 = Tôn Quyền, 41387 = Yêu Quỷ Vương) |
| `select_pet_skill` | 3 | 3 | `skillId` | Chọn kỹ năng |
| `use_item_pet` | 2 | 2 | `itemId sl qty` (chữ `sl` cố định) | Dùng vật phẩm cho võ tướng (cho ăn/hồi phục) |

**Thùng đồ**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `if_item` | 46 | 7 | `itemId op n` | Khối `if` theo số lượng vật phẩm — ⚠ chưa có trong registry DSL của web bot |
| `use_item` | 17 | 9 | `itemId qty` | Dùng vật phẩm |
| `pickup_item` | 16 | 2 | `itemId` | Nhặt vật phẩm theo id — ⚠ chưa có trong registry DSL của web bot |
| `buy` | 7 | 4 | `slot qty` | Mua ở shop NPC — ⚠ chưa có trong registry DSL của web bot |
| `drop_item` | 4 | 2 | `itemId qty` | Vứt vật phẩm — ⚠ chưa có trong registry DSL của web bot |
| `await_item` | 2 | 1 | `itemId n` | Chờ có đủ vật phẩm |
| `sell` | 2 | 2 | `itemId` | Bán vật phẩm — ⚠ chưa có trong registry DSL của web bot |

**Tương tác NPC/Hội thoại**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `click` | 570 | 73 | `N,mapId,x,y[,waitMs]` (rút gọn: `N`) | Bấm NPC/đối tượng có chỉ số `N` tại `(x,y)` của map; ý nghĩa `N` chưa xác định (thường 1..5, tới 49) |
| `send` | 123 | 18 | `n` | Gửi lựa chọn trả lời hội thoại |
| `menu` | 116 | 17 | `n` | Chọn mục menu của NPC |
| `chat_local` | 65 | 7 | `text` | Chat kênh local. Trong script dùng làm **kênh lệnh liên tài khoản**: `command <lệnh>` (xem mục 3.2) |
| `await_dialog` | 44 | 8 | — | Chờ hộp thoại hiện |
| `if_talk` | 24 | 3 | `text` | Khối `if` khi lời thoại NPC khớp văn bản — ⚠ chưa có trong registry DSL của web bot |
| `if_talkid` | 4 | 1 | `id op n` | Khối `if` theo id thoại — ⚠ chưa có trong registry DSL của web bot |

**Tổ đội**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `leave_party` | 73 | 63 | — | Rời đội |
| `await_party` | 9 | 9 | — | Chờ đủ thành viên đội |
| `chat_team` | 3 | 2 | `text` | Chat kênh đội; dùng để bảo thành viên chạy script: `script <tên>` |
| `if_leader` | 2 | 1 | `true` hoặc `false` | Khối `if` nếu là chủ đội — ⚠ chưa có trong registry DSL của web bot |
| `room_team` | 1 | 1 | `a b` | Tạo/chọn phòng đội — ⚠ chưa có trong registry DSL của web bot |

**Phó bản/PvP**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `pvp` | 100 | 4 | `0` hoặc `5` | Khiêu chiến PvP (mọi lần gọi là `pvp 5` hoặc `pvp 0`) |
| `dungeon` | 90 | 7 | `stage diff` | Chọn phó bản (stage 18..58, độ khó) |
| `start_dungeon` | 90 | 7 | — | Bắt đầu phó bản |
| `if_won` | 2 | 2 | `op n` | Khối `if` theo số trận thắng — ⚠ chưa có trong registry DSL của web bot |

**Hoạt động**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `event` | 18 | 15 | `N` | Kích hoạt hoạt động/sự kiện số N (ý nghĩa từng số chưa rõ) — ⚠ chưa có trong registry DSL của web bot |

**Điều khiển/Luồng**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `sleep` | 467 | 71 | `ms` | Chờ N ms |
| `await_battle` | 301 | 33 | — | Chờ trận đánh kết thúc |
| `auto` | 261 | 111 | `0` hoặc `1` | Bật/tắt auto đánh |
| `setting` | 171 | 71 | `0` hoặc `1` | Bật/tắt chế độ setting |
| `end_event` | 73 | 23 | — | Kết thúc script |
| `loop` | 31 | 17 | `n` | Lặp khối thụt lề N lần |
| `auto_hpsp` | 28 | 12 | `0` hoặc `1` | Bật/tắt tự hồi HP/SP |
| `if_level` | 23 | 4 | `op n` | Khối `if` theo level nhân vật — ⚠ chưa có trong registry DSL của web bot |
| `stop` | 10 | 8 | — | Dừng script — ⚠ chưa có trong registry DSL của web bot |
| `log` | 5 | 5 | `tag` | Ghi log của tool — ⚠ chưa có trong registry DSL của web bot |
| `clear` | 4 | 4 | — | Xoá trạng thái/bộ nhớ tạm của script — ⚠ chưa có trong registry DSL của web bot |
| `continue` | 2 | 2 | — | Sang lần lặp kế tiếp |
| `mode_attack` | 2 | 1 | `0` hoặc `1` | Chế độ tấn công — ⚠ chưa có trong registry DSL của web bot |
| `offline` | 1 | 1 | `minutes` | Treo offline N phút — ⚠ chưa có trong registry DSL của web bot |

**Gói thô**

| Lệnh | Số lần | Số script | Tham số | Ý nghĩa |
|---|---:|---:|---|---|
| `packet` | 173 | 51 | `hex` | Gửi nguyên văn một gói (hex **wire** đã XOR) — xem mục 1 và 3.4 |


> Ghi chú cú pháp: nhiều lệnh dùng **dấu phẩy** để phân tách tham số trong một token (`click 1,12007,311,428`, `warp_id 4,31421,2184,1797`, `walk 2670,830`); một số lệnh khác dùng khoảng trắng (`move 1910 1190`, `use_item 46629 1`).

---

## Phụ lục B. Xác nhận từ pcap của client thật (2026-10-16)

Nguồn: 3 capture có đối chiếu trực tiếp với server `34.81.22.35:6614`. Payload ghi theo `f[8..]` (luôn bắt đầu bằng `00`). Cách đăng nhập/INIT xem `docs/LOGIN_SPEC.md`.

| Hành động | Gói C→S | Phản hồi S→C | Tin cậy |
|---|---|---|---|
| **Truyền tống tới cổng thành** (menu "Teleport" của tool; **tính năng quan trọng**) | `44/01`, payload `00 <mapId u16 LE> 00` (vd 12001 = `00 e1 2e 00`; byte cuối chưa rõ nghĩa, giữ `00`). Sau ~0.1s client gửi `07/01` rồi `0c/01` (cách nhau vài ms) | `44/01 00 00` (mã 0 = nhận), `29/0c`, `0c/00` (trạng thái của mình: map + x + y mới), rồi lô dựng map (`03/00`, `07/00`…) | ✅ gói khớp byte pcap (1 mẫu, map 12001); web bot đã nối (`warp_map`), **chưa thử trên server thật** |
| **Chọn mốc Dị giới** | `61/01 00 01` rồi `61/02 00 NN` | `61/01 00 06` (đã ở Dị giới), rồi `18/02 00 51 33 <mốc cũ>` + `18/01 00 51 33 <mốc mới>` | ✅ web bot đã chạy: Lv.40 và Lv.55 đúng trong client |
| Mã mốc `NN` | 1=Lv10, 2=25, 3=40, 4=55, 5=70 | — | ✅ (5 mốc). 6..15 = Lv85…180 là **suy ra** theo thứ tự menu, chưa thử |
| Vào Dị giới từ map thường | `61/01 00 01` | `61/01 00 00` + lô dựng map 49942 | ✅ (pcap tool gốc) |

**Ghi chú:**
- **`44/01` chỉ đi được tới 41 cổng thành** trong `Data/Warp_C.dat` (12001 Trác Quận, 11011 Bắc Hải, 12061 Nghiệp Thành, … 32001 Ngạch Tế Nạp; danh sách đầy đủ ở `warpGates.json`, sinh bằng `npm run import-warp`). Bản ghi `Warp_C.dat` = `[textId u32][mapA u16][mapB u16][x u32][y u32]`: **mapA là mapId gửi trong gói**, `x,y` là toạ độ đến (12001 → 310,1530 khớp pcap và quan sát trên web). Gửi mapId ngoài danh sách (vd 12003) **bị server bỏ qua im lặng** (đã gặp 3 lần); engine nay chặn trước với lỗi rõ. **Warp tới map tuỳ ý** (web: nút Warp với danh sách toàn bộ map) = lập kế hoạch: `nearestGate(target)` (BFS trên `doors.json` sinh từ `door.ini`, `npm run import-doors`: cổng thành có ít cổng-chuyển-map nhất, hoà thì cổng đứng trước trong menu) → `teleport_gate` tới cổng đó → đi tiếp theo các cổng (`door.ini`: `from ⇥ to ⇥ index`). Ví dụ 12003: teleport 12001 rồi 12001→12002 (cổng #12) → 12003 (cổng #5); 21000: cổng Tương Dương 21001 rồi 21001→21000. **Chặng đi tiếp CHƯA làm được**: chưa có gói di chuyển/qua cổng (`move`, `warp_id`, `click`), web bot dừng sau khi teleport và báo tuyến còn lại. Cần capture: từ cổng thành đi bộ qua cổng tới map kế bên bằng tool gốc (AI tìm / warp_id).
- Lần bấm Warp đầu tiên sau login (~20s) từng không có tác dụng, lần sau ~11s thì được: chưa rõ nguyên nhân (nghi cần chờ sau login, hoặc thiếu bước INIT); log `debug` sẽ cho biết server có trả `44/01 00 00` không.
- Chọn mốc **không đổi map id** (vẫn 49942); mốc là trạng thái lưu phía server, lần login sau vẫn ở mốc đã chọn.
- Gói `55/01`: `00 | count u32 | count × [id u16, val u32, max u32]` — bảng **bộ đếm phía server** (1500 bản ghi lúc login, 1 bản ghi khi một bộ đếm đổi). Đã đối chiếu với log tool gốc: `0x1b` = **"Trực tuyến" (phút online hôm nay**, tăng 1/phút; tool ghi 194 phút), `0x6b` = **"Đã điểm danh ngày"** (tối đa 28), `0x6c` = **"Đã điểm danh ngày liên tiếp"** (tối đa 25). Đây **không** phải đồng hồ Dị giới như từng đoán (giả thuyết "120 − phút đã dùng" đã bỏ vì phút online đạt 194).
- **Điểm danh ngày ✅ `57/02`:** client game gửi `57/02`, payload `00 01 DD 00 00 00 01` (`01` = lịch 28 ngày trong `LoginAwardData_C.dat`, `DD` = ngày; mẫu duy nhất: `DD=1`). Server trả ngay `17/08` (`00 0a cd b3 03 00 00 00 …` = ô túi 10: item 46029 **Hạo Giác** × 3), `57/02 00 01 00`, `51/01`, và `55/01` cập nhật `0x6b` và `0x6c`. Quy tắc `DD` (= bộ đếm `0x6b` + 1) mới là suy ra; tài khoản test đã có ngày = 2, liên tiếp = 1 (khớp log tool).
- **Đã thử từ web bot (tài khoản đã điểm danh hôm nay, bộ đếm ngày 2, liên tiếp 1):** gửi `57/02 00 01 03 00 00 00 01` → server **từ chối**, trả `57/02` với mã kết quả `02` (phản hồi tức thì, không cộng quà, không đổi bộ đếm). Vậy server **có kiểm tra điều kiện** và gói của web bot được nhận/xử lý đúng; mã `00` = thành công (mẫu thật), mã `02` = bị từ chối (nhiều khả năng "đã điểm danh hôm nay" — suy ra, mới một mẫu).
- **Tool gốc không tự điểm danh lúc login**: tool chỉ in "Đã điểm danh ngày: N" từ bảng bộ đếm. Hai gói `42/01` chỉ có khi bật tính năng của tool là **dùng vật phẩm** (`5b b2` = 45659 "Triệu Tướng 1", `5c b2` = 45660 "Rút Thẻ 1"; suy ra), và log tool ghi "Nhận được 1 Bí Cấp Trương Nhiệm" — không phải điểm danh.

### Thùng đồ — các thao tác trong menu chuột phải (kết quả tra cứu tool gốc)

- **Dữ liệu túi** đã có (xem bảng S→C): danh sách ô lúc login + cập nhật từng ô. Tên vật phẩm: `Data/VN/Item_C.dat` (18.922 bản ghi).
- **Gói gửi** cho Nhân vật/Võ tướng sử dụng, Phân giải, Đóng góp, Vứt bỏ, Mở thêm ô túi, Tự hợp Lông Vũ: **chưa có** (tool cũ chỉ có lệnh DSL `use_item`, `use_item_pet`, `drop_item`, `sell`, không kèm hex `packet`). Cần capture từng thao tác bằng tool gốc (mỗi lần một thao tác trên một vật phẩm không quan trọng) rồi so `[slot][itemId][qty]` trong payload.
- Các action đã khai báo sẵn trong engine (hidden): `use_item`, `use_item_pet`, `drop_item`, `resolve_item`, `contribute_item`, `open_bag_slot`, `auto_combine_dragon`; codec trả "chưa có gói tin" cho tới khi bổ sung `encodeAction`.

#### General (cap 22/10): Exp Offline Free, Thư, Võ tướng xuất chiến
| Action | Gói gửi | Phản hồi | Tin cậy | Cap nguồn |
|---|---|---|---|---|
| `offline_exp_free` | `54/01 00 1e 00` rồi (~0.1s) `54/02 00 02 1e 00` | `54/01 00 1e 00 fe`, `08/0e` (exp +35715), `02/0a` id 40476 (tên + 35715), `54/02 00 1e 00 01` | ✅ Free · ❌ Xu/Vàng chưa cap | Nhan_exp_offline_Free |
| `mail_claim_all` | mỗi thư có quà: (cờ 0) `53/03 00 01 00 00 00 <id u32>` rồi `53/01` cùng payload | `53/04` ack mở; `17/08` + `53/02` ack nhận | ✅ 1 thư · 🟡 lặp nhiều thư; túi đầy: chưa có mẫu (đoán qua `02/0a` id 71328/90166/90077 hoặc không có ack) | Nhan_all_email_gifts |
| `pet_out` | `13/01 00 <model u16>` | `13/01` cùng nội dung | ✅ | Change_pet_xuat_chien |
| `pet_rest` | ❌ chưa có | | ❌ | cần cap "cho pet nghỉ" |
- `53/02` client gửi 26 id (toàn bộ thư) ngay sau khi nhận 1 thư, server chỉ echo `53/03`, không có quà ⇒ chưa rõ là "xoá hết" hay "nhận tất cả"; **không gửi**.
- Hệ/chi tiết võ tướng trong tổ đội: danh sách ở `0f/08` lúc login (Check_status_team_pet), xuất chiến = `13/04`; bản ghi: idx, model, exp, level, HP, SP, tên Big5. Chỉ số (popup pet): 6 u16 sau SP = chỉ số GỐC theo thứ tự int, atk, def, agi, hp, sp (✅ đối chiếu client với Ma Quan Vũ: 66/189/89/102/85/60; KHÔNG gồm điểm cộng từ trang bị/thẻ bài; đối chiếu hợp lý với lớp pet: Thái Văn Cơ int 122, Lữ Bố/Nhạn atk 147/178, Ma Quan Vũ atk 189), `fai` = byte rel 27 (=100 ở mọi pet đã thấy, có thể là độ trung thành) — ✅ thứ tự · 🟡 `fai` chưa chắc.
- Số exp/giờ offline/Xu/Vàng cần trả **không** có trong cap (client có thể tính cục bộ hoặc từ gói khác).
- **Điểm cộng từ đồ (đã sửa lại, ✅):** là thuộc tính theo gói `08/xx`, mã `0x1d2` atk · `0x1d3` def · `0x1d4` int · `0x1d6` agi (hp/sp không có). Nhân vật: `08/01 00 <mã u16> <giá trị u32>`; võ tướng: `08/02 00 04 <idx> 00 <mã u16> <giá trị u32>` (mỗi võ tướng riêng). acc01: 50/29/46/27 khớp client cho Ma Quan Vũ. (Khối u32@52..64 của `05/03` chỉ là bản sao của nhân vật.)
- **Trạng thái nhân vật:** `05/03` u16@35 = **Point** (điểm tiềm năng, 238 khớp tool gốc); `17/0b` = trang bị đang mặc (`00 | count | count×35B [itemId u16…]`, 5 ô: mũ/khăn, giáp, vũ khí, hộ uyển, giày). Gốc/Bonus của nhân vật chưa tìm thấy; opcode **cộng điểm** và **thay đồ**: ❌ không có trong script/`tool-reference` (cần cap).
- **Điểm cộng từ thẻ bài:** ❌ chưa tìm thấy trong gói login. Client không gửi yêu cầu nào khi mở bảng trạng thái pet (cap Check_status_team_pet chỉ có login + heartbeat) ⇒ client tự tính từ dữ liệu đã nhận + `CollectCard_C/CollectStyle_C/CollectStyleValue_C.dat`.

#### Exp Offline: bảng giá (cap `PCAPdroid Oct 23 10 56.pcap`)
- `57/03` (server, login + khi client gửi `57/03 00`): `00 | 03 | 3×[% exp u16, chi phí u32]` = (Free 50%, 0), (lựa chọn 2 70%, 441), (lựa chọn 3 100%, 5). Cap 22/10: 59 và 1. ⇒ chi phí lựa chọn 2 = số phút offline (1 Xu/phút, suy ra 🟡), lựa chọn 3 ≈ phút/88 làm tròn lên (🟡).
- `54/01 00 <offer> 00` hỏi giá từng lựa chọn: offer `0x1c` → `00 1c 00 03 <441 u32>`, `0x1d` → `00 1d 00 01 <5 u32>`, `0x1e` (Free) → `00 1e 00 fe`. Gói MUA lựa chọn 2/3 chưa cap (Free = `54/02 00 02 1e 00`) ⇒ nút Xu/Vàng vẫn khoá.
- Exp thu được khi nhận Free: `08/0e` + `02/0a` id 40476 (121.936 exp); server không báo trước.
- Chưa tìm thấy: trạng thái thẻ sưu tầm (client không gửi gói nào khi mở màn Sưu tầm/Trạng thái ⇒ dữ liệu có sẵn từ login). `5f/04` (168 byte = số bộ thẻ `CollectStyle_C`) ở tài khoản này toàn 0; ở cap tài khoản khác có `15 10 10 1f` (bitmask 5 thẻ/bộ). Chưa đối chiếu được 2 bộ thẻ của acc01 với gói nào.

#### Quà Online: 6 mốc thời gian (cap `Online Reward Capture.pcap`)
| Action | Gói gửi | Phản hồi | Tin cậy | Cap nguồn |
|---|---|---|---|---|
| `online_reward` / `online_reward_all` | `57/02 00 03 <minutes u32 LE> 01` | `17/08` (cộng quà vào túi đồ), `51/01` (bật cờ id 2..7), `57/02 00 03 00` (xác nhận thành công; mã 2 = đã nhận / chưa đủ điều kiện) | ✅ 6 mốc đầy đủ | Online Reward Capture.pcap |

- **6 mốc và phần thưởng tương ứng:**
  1. `10 phút` (`0a 00 00 00`, flag id 2): 20 Đại Phúc Thần (item 46038, ô 13: 40 → 60)
  2. `20 phút` (`14 00 00 00`, flag id 3): 1 Túi Lông Cấp 2 (item 45608, ô 14: 1 → 2)
  3. `30 phút` (`1e 00 00 00`, flag id 4): 1 Vé Bồi Dưỡng Toạ Kỵ (item 32231, ô 8: nhận 1)
  4. `60 phút` (`3c 00 00 00`, flag id 5): 1 Triệu Gọi Bảo Hộp (item 46420, ô 9: nhận 1)
  5. `90 phút` (`5a 00 00 00`, flag id 6): 2 Thiên Cơ Phù (item 55801, ô 10: nhận 2)
  6. `180 phút` (`b4 00 00 00`, flag id 7): 1 Xu Lạp Bá (item 31207, ô 17: nhận 1)
- **Kiểm tra điều kiện:**
  - **Thời gian online trong ngày:** đọc từ gói `55/01` bộ đếm id `10` (`0x0a`), đơn vị giây (max 86400).
  - **Trạng thái mốc đã nhận:** đọc từ bitset 1000 byte của `51/02` lúc login và cập nhật theo `51/01` (`00 01 00 00 00 <id u16> <val u8>`). Mốc 10..180m tương ứng cờ id `2..7` (bit 1..6 của byte đầu bitset; khi nhận đủ 6 mốc, byte đầu chuyển từ `0x01` thành `0x7f`).
- **Web bot:**
  - Bấm nút 🎁 "Nhận quà Online" (ở thanh công cụ hoặc menu General): duyệt qua 6 mốc; mốc nào đã nhận hoặc chưa đủ thời gian online thì thông báo sự kiện; các mốc đủ điều kiện sẽ được xếp hàng gửi tuần tự cách nhau ~800ms để nhận trọn vẹn quà.

#### Trận Đấu & Kỹ Năng (cap `Treo Rung 30 Dau Vat.pcap`)
| Action | Gói gửi | Phản hồi | Tin cậy | Cap nguồn |
|---|---|---|---|---|
| `set_battle_config` | Thiết lập cấu hình auto | State update `battleConfig` | ✅ | Treo Rung 30 Dau Vat.pcap |
| `battle_action` / Lượt đánh (`32/01`) | `32/01 00 <actorRow> <actorCol> <targetRow> <targetCol> <skillId u16 LE> 00 00` | `35/05 00 <actorRow> <actorCol>` (ack), `32/01` (diễn hoạt & sát thương) | ✅ Khớp byte pcap | Treo Rung 30 Dau Vat.pcap |

- **Vòng đời trận đấu (Battle Lifecycle):**
  1. `14/0c 00`: Bắt đầu trận đấu (`inBattle = true`, khởi tạo mảng `battleUnits = []`).
  2. `0b/05`: Tải đơn vị vào lưới chiến (len 58: quân mình tại hàng 2..3; len 51: NPC/quái tại hàng 0..1; đọc model, tọa độ `row, col`, level, HP/SP hiện tại & tối đa, tên).
  3. `33/01`: Cập nhật liên tục chỉ số máu/mana trên lưới chiến: chuỗi các khối 7 byte `[row][col][stat_type][val u32 LE]`. Mã `0x19` = HP hiện tại, `0x1a` = SP hiện tại, `0xcd` = Max HP. Khi `hp.cur = 0` → mục tiêu gục ngã (chết).
  4. `34/01 00`: Bắt đầu đếm ngược lượt đánh (Turn countdown timer). Nếu bật Auto (`autoFight: true`), client tự động chọn quái còn sống đầu tiên và gửi lệnh `32/01` cho Võ tướng (nếu có xuất chiến) rồi Nhân vật.
  5. `35/05 00 <actorRow> <actorCol>`: Server xác nhận đã nhận lệnh đánh của đơn vị.
  6. `32/01` (S→C): Diễn hoạt đòn đánh, kỹ năng và trừ máu.
  7. `14/08 00 2a`: Trận đấu kết thúc (`inBattle = false`, dọn dẹp `battleUnits`).

- **Quy tắc tọa độ lưới chiến & Đơn vị (Grid coordinates):**
  - Phe địch: Hàng 0 (hàng trước), Hàng 1 (hàng sau); các cột 0..4 từ trái qua phải.
  - Phe ta: Hàng 2 (hàng trước), Hàng 3 (hàng sau); các cột 0..4.
  - Nhân vật đứng tại: `Hàng 2, Cột 2` (`02 02`).
  - Võ tướng đứng tại: `Hàng 3, Cột 2` (`03 02`) (hoặc hàng trước nếu xuất chiến trước).
  - Quái NPC trong cap: 3 quái Lv.30 tại `(0, 2)`, `(0, 4)`, `(0, 3)` với HP 181, SP 134.

- **Cấu trúc gói Client gửi hành động lượt đánh (`32/01`):**
  - Chiều dài frame: 17 bytes (Wire length `0x000d` body, 9 bytes payload):
    - Byte 0: `00`
    - Byte 1..2: Vị trí người ra đòn `[actorRow] [actorCol]` (Nhân vật `02 02`, Võ tướng `03 02`).
    - Byte 3..4: Vị trí mục tiêu `[targetRow] [targetCol]` (Quái `00 02`, `00 03`, `00 04`; nếu Thủ thì target chính mình).
    - Byte 5..6: Mã kỹ năng `skillId` dạng `u16 LE` (10000 = `10 27` Đấu Vật, 17001 = `69 42` Thủ, 18001 = `51 46` Bỏ Chạy, 15001 = `99 3a` Bắt Cóc, hoặc skill ID cụ thể).
    - Byte 7..8: Nonce / Padding (`00 00` hoặc số ngẫu nhiên).

- **Hệ thống Kỹ năng & Thao tác tùy biến:**
  - **Hành động cơ bản:**
    - `10000`: Đấu Vật (Basic Attack)
    - `17001`: Phòng Ngự (Defend)
    - `18001`: Chạy Trốn (Escape)
    - `15001`: Bắt Cóc (Capture / Catch NPC)
  - **Kỹ năng nhân vật:** Giải mã từ gói `05/03` tại payload offset 95 (`f[103]`), gồm `count u16 LE`, theo sau là các bộ 3 byte `[skillId u16 LE][level u8]`. Ví dụ tài khoản acc01: Phóng Hỏa (12001), Trinh Thám (14001), Cưỡi Ngựa (14023), Kỵ Binh (14034).
  - **Kỹ năng võ tướng:** Tra cứu từ bảng NPC (`Data/VN/Npc_C.dat`, trích xuất 6.240 NPC vào `npcSkills.json`) theo model võ tướng đang xuất chiến.
  - **Tên & mô tả kỹ năng:** Trích xuất toàn bộ 444 kỹ năng từ `Data/VN/Skill_C.dat` vào `skillData.json`.

- **Web Bot UI Trận Đấu (`BattleDialog.tsx`):**
  - Mở qua nút `⚔️` ở thanh công cụ hoặc bấm vào chip `⚔ Đang chiến đấu` khi trong trận hoặc từ menu `General`.
  - Hiển thị trực tiếp lưới quái vật đang sống với thanh máu (HP/SP), trạng thái gục ngã.
  - Cung cấp dropdown chọn hành động độc lập cho Nhân vật và Võ tướng (gồm Đấu vật, Phòng ngự, Bỏ chạy, Bắt cóc và toàn bộ kỹ năng đã học/có sẵn).
  - Tùy chọn bật/tắt Tự động đánh (`autoFight`).
  - Hỗ trợ thao tác thủ công ngay trong lượt (chọn quái mục tiêu và bấm "Nhân vật đánh ngay" / "Pet đánh ngay").


