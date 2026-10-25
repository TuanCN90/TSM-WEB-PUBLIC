# TS-Bot-Web — Tổng hợp kiến thức (cập nhật 2026-10-16)

Tài liệu này gom toàn bộ những gì đã làm, đã học và đã sai/sửa trong quá trình dựng Web UI cho bot TS Online.
**Phần A = xử lý dữ liệu** (giao thức, packet, **từ điển giá trị A2b**, tra cứu, phiên kết nối, log pipeline).
**Phần B = thiết kế UI** (layout, component, CSS, tương tác).
Phần C = quy trình, bài học, việc còn dang dở.

> **Hành động trong game** (di chuyển, warp, pet, thùng đồ, hoạt động ngày, tổ đội, danh mục opcode C→S lấy từ script tool cũ, và các gói đã xác nhận bằng pcap: warp, Dị giới, điểm danh): xem `docs/game_actions_knowledge.md`.
> **Kiến thức Di chuyển, Warp & Tìm Bãi Train (Root Feature)**: xem `docs/WARP_AND_TRAIN_MAP_KNOWLEDGE.md` (giải mã nhị phân `Eve.emg` & `Npc_C.dat`, 3 tầng di chuyển, đi bộ nội suy Isometric 8 hướng `06/01` chống kick mã 5 và mã 44).
> **Hướng dẫn sử dụng Bãi Train cho người dùng**: xem `docs/USER_GUIDE_TRAIN_MAP.md` (bộ lọc, công thức EXP ±19 level, ngũ hành tương khắc, chu trình cày cấp 24/7 khép kín).
> **Đội ngũ / lập đội (opcode 0x0d, mời/xin, đồng bộ warp, chờ đủ đội)**: xem `docs/PARTY_KNOWLEDGE.md` (root feature — đọc trước khi sửa).

> **Kiến thức Thùng Đồ, Tiền Trang & Auto-Heal**: xem `docs/ITEM_AND_STORAGE_KNOWLEDGE.md` (giải mã gói tin `17/0f`, `1e/01`, `1b/02`, `1b/01`, `59/03`, `27/0f`, trừ kho và đóng kho).
> **Đăng nhập & giữ phiên** (khung gói, gói login, chuỗi INIT hai lô, heartbeat, quy tắc phiên/khoá): xem `docs/LOGIN_SPEC.md` — bản gọn để gửi team, không chứa thông tin tài khoản.

Quy ước độ tin cậy: ✅ đã đối chiếu với game thật · 🟡 suy luận, chưa kiểm chứng đủ · ❌ chưa biết.

> Không ghi mật khẩu/tài khoản vào tài liệu hay mã nguồn. Mật khẩu chỉ nằm trong `data/accounts.json` (backend).

---

## 0. Kiến trúc & lệnh

```
tool-reference/BOT TSM/   ← tool Windows gốc (chỉ để đọc dữ liệu; KHÔNG chạy được trên Mac)
packages/protocol         ← kiểu dùng chung (CharacterState, LogEntry, WS message…) — chỉ type
packages/engine           ← codec giao thức, GameConnection (phiên), exp, dữ liệu tra cứu (JSON)
packages/server           ← Fastify: REST + WebSocket, store JSON trong data/
apps/web                  ← React + Vite (UI)
tools/                    ← script sinh dữ liệu từ tool-reference / web
captures/                 ← pcap do người dùng chép vào để phân tích (CÓ CHỨA frame đăng nhập: không chia sẻ, không commit)
data/                     ← accounts.json, servers.json, settings.json, last-closed.json, scripts/
```

| Việc | Lệnh |
|---|---|
| Chạy dev (server + web) | `npm run dev` (web `:5173`, backend `:8787`) |
| Chạy ổn định, không auto-restart | `npm run start` (build web rồi chạy server) |
| Kiểm tra kiểu | `npm run typecheck` |
| Test | `npm test` (vitest, hiện 15 test) |
| Sinh bảng tên map | `npm run import-maps` → `apps/web/src/data/mapNames.json` |
| Sinh bảng tên NPC/võ tướng | `npm run import-npcs` → `packages/engine/src/data/npcNames.json` |
| Sinh bảng tên vật phẩm (26.290 item) | `npm run import-items` → `itemNames.json` ở cả `packages/engine/src/data` và `apps/web/src/data`. Tên Việt từ `Data/VN/Item_C.dat` (18.922), id còn thiếu lấy tên Hán từ `Data/Item_C.dat` gốc (+7.368; vd 44308 = 魔關羽選擇卷). Cấu trúc bản ghi đã kiểm chứng (cả hai file kết thúc đúng cuối file): `[u16 len][tên UTF-16][113 byte: u8 + u16 id…][u16 len][mô tả]` |
| Sinh danh sách 41 điểm truyền tống | `npm run import-warp` → `warpGates.json` (cả `packages/engine/src/data` và `apps/web/src/data`) |
| Sinh bảng EXP theo cấp | `npm run import-exp [url\|file]` → `packages/engine/src/data/expTable.json` |
| Nhập script .ini cũ | `npm run import-scripts` |
| **Giải mã pcap/pcapng** | `npm run pcap -- <file> [--only 57/02 --find u16:46029 --text --stats --diff file2 --all --full --json]` (xem A8b) |

Luồng dữ liệu một chiều: **socket TCP → codec (giải mã) → `io.patchState` → `GameConnection` → backend `broadcast` → WebSocket → `live.tsx` → React**.

---

# PHẦN A — XỬ LÝ DỮ LIỆU

## A1. Giao thức `ts-online` (server `34.81.22.35:6614`)

> **Nguồn gốc giao thức và tính độc lập:** hiểu biết giao thức (frame, XOR, login, các gói trạng thái) đến từ **pcap bắt trực tiếp từ client game thật** (PCAPdroid, do người dùng cung cấp), cộng **pcap lưu lượng mạng của tool Windows gốc** chạy trên VPS của người dùng (chỉ quan sát gói trên đường truyền và đối chiếu log hiển thị của tool; **không giải mã, không gỡ bảo vệ** `SimpleBot.exe`/`Easytool.exe`), và kiểm chứng live bằng web bot. Web bot là một client tự viết, kết nối thẳng server game bằng user/pass, **không dùng và không phụ thuộc license/Easytool/SimpleBot** (mã chạy không tham chiếu `tool-reference`, không gọi license server). Từ `tool-reference` chỉ lấy **dữ liệu tra cứu** (tên map/NPC, A6) và **script `.ini`** (`data/scripts`). Xoá `tool-reference` thì web bot vẫn chạy; chỉ các lệnh `npm run import-*` cần thư mục đó.

Codec: `packages/engine/src/transport/socket/codecs/tsOnline.ts`.

- **Frame** (cả hai chiều): `[F4 44][len u16LE = TỔNG độ dài frame][body]`. Byte 0–1 XOR `0x99/0x78`, phần còn lại XOR `0xAD`.
- Body đã giải mã: `00 00 cmd sub payload`. Sau giải mã, byte 0–1 là `6d 3c`; **mọi offset trong tài liệu này tính từ byte 0 của frame đã giải mã** (cmd = `f[6]`, sub = `f[7]`).
- Tách gói: tích luỹ buffer, đọc `len` ở byte 2–3 (sau XOR), cắt đúng từng frame (xử lý gộp/xé chunk TCP). Đã kiểm tra, không có lỗi framing.
- **Đăng nhập**: C→S `01/00` + `[len]user[len]pass` (ASCII, **phân biệt hoa/thường**). S→C `01/02` có UID 8 byte ở `f[14..21]`. **UID toàn 0 = bị từ chối** (kèm `14/08 00 30`; xem A5: không phải lúc nào cũng là sai mật khẩu — có thể phiên cũ chưa giải phóng hoặc **bị khoá tạm vì login dồn dập**).
- Sau login: server **tự đẩy** snapshot trạng thái trong ~125–500ms (gồm bảng bộ đếm `55/01` ~15 KB). Client gửi chuỗi **INIT hai lô** (bảng chi tiết `docs/LOGIN_SPEC.md` mục 5): lô 1 (`19/29, 2b/04, 01/10, 4d/0b, 7c/04, 41/02, 0c/01, 57/03`) rồi lô 2 (`62/02`×4, `0a/00`, `21/01`, `59/01`, `07/01`, `48/05`, `19/29`), **mọi payload mở đầu bằng byte `00`**. **Thiếu lô 2 ⇒ server không báo lỗi nhưng bỏ qua im lặng mọi gói hành động** (đã tái hiện). Sau đó heartbeat **`07/01` + `0a/00` mỗi 12s** (server đáp lại cả hai); không dùng `01/10` định kỳ.
- Chuỗi tiếng Trung là **Big5** (tên pet trong `0f/04`, thông báo `02/0a`). Tên nhân vật trong spawn là ASCII/latin1.

## A2. Bảng packet đã giải mã

| Gói | Ý nghĩa | Trường (offset từ byte 0) | Tin cậy |
|---|---|---|---|
| `03/00` | Spawn đơn vị. **Của mình** khi UID tại `f[9..16]` = UID đăng nhập | `f[18]` hệ (0..7) · u32@20 level · u16@28 map · u16@30 x · u16@32 y · `f[53]` độ dài tên, tên từ `f[54]` | ✅ |
| `05/03` | Snapshot nhân vật | u32@10 HP hiện tại · u32@14 SP hiện tại · u32@46 HP tối đa · u16@50 SP tối đa · u8@28 level · **u32@29 EXP tích luỹ** | ✅ (HP/SP, level, exp) |
| `0f/08` | **Danh sách** võ tướng mang theo (`f[9]`=số lượng; bản ghi dài 254+độ dài tên: idx · model u16 · exp u32 · lv · HP u32 · SP u16 …). Pet xuất chiến = model trong `13/04` (`00 <model u16>`); `08/02` `00 04 <idx>` = exp của pet thứ idx (kể cả pet đang nghỉ) | u16@11 model id (→ `npcNames`) · u8@17 level · u32@18 HP · u16@22 SP · **u32@13 EXP tích luỹ** | ✅ level/HP/SP/tên · 🟡 EXP pet cộng dồn |
| `08/0e` | Cập nhật 1 thuộc tính nhân vật | u16@9 mã thuộc tính · u32@11 giá trị. Mã `0x0124` = **EXP tích luỹ** | ✅ |
| `08/02` | Cập nhật 1 thuộc tính võ tướng | u16@12 mã · u32@14 giá trị. Mã `0x0124` = EXP tích luỹ | ✅ |
| `07/00` | Vị trí 1 đơn vị. Của mình khi UID@9 khớp | u16@17 map · u16@19 x · u16@21 y | ✅ (bố cục) · 🟡 chưa có mẫu own-uid khi đang chạy |
| `23/05` | Vàng | u32@9 | ✅ |
| `1a/04` | Xu | u32@9 | ✅ |
| `02/0a` | Thông báo hệ thống (Big5) | Cuối gói có u32 số exp nhận (6000/2000) — **chỉ dùng để đối chiếu, không dùng để cập nhật state** | ✅ |
| `17/05` | **TÚI ĐỒ** đầy đủ (gửi lúc login; trước đây ghi nhầm là 12 ô trang bị): `00 | 00 (loại túi) | count u16 | count × 36 byte`, mỗi mục `[slot u8][itemId u16][qty u32][29 byte phụ, các mẫu đều 0]` | đã đối chiếu **23/23 ô** với ảnh Thùng đồ của tool (ô, id, số lượng, tên); test `packages/engine/test/bag.test.ts` | ✅ |
| `0f/04` | Danh sách đơn vị/pet quanh đó (uid, model id, tên Big5) | — | 🟡 |
| `55/01` | **Bảng bộ đếm phía server**: `00 | count u32 | count × [id u16, val u32, max u32]` (1500 bản ghi lúc login ~15 KB; 1 bản ghi khi một bộ đếm đổi) | `0x1b` = phút online hôm nay (log tool: "Trực tuyến") · `0x6b` = ngày điểm danh (≤28) · `0x6c` = ngày điểm danh liên tiếp (≤25) · `0xa9/0xab/0xac` chưa rõ | ✅ (3 id đầu đã đối chiếu log tool) |
| `17/08` | Cập nhật 1 ô túi (`qty = 0` ⇒ ô trống) | `00 | slot u8 | itemId u16 | qty u32` (qty = số trong ô) | ✅ (1 mẫu: ô 10, 46029 "Hạo Giác" × 3) |
| `13/04` · `13/01` | Võ tướng xuất chiến: `00 <model u16>` (login: `13/04`; sau khi client gửi `13/01 00 <model>` server đáp lại `13/01` cùng nội dung) | chỉ 1 pet xuất chiến, chọn pet khác ⇒ pet cũ tự nghỉ | ✅ (cap Change_pet_xuat_chien) · ❌ gói "Nghỉ" chưa có |
| `53/01` (S→C) | Danh sách thư lúc login: `00 | count u32 | [id u32, time f64, cờ u8 (0 chưa đọc, 2 đã mở), len u16, tiêu đề Big5, số quà u8, quà×36B (loại, itemId u16, qty u32…)]` | | ✅ cấu trúc |
| `53/03` · `53/01` · `53/02` (C→S) | Mở thư / nhận quà thư / (chưa rõ, 26 id — có thể xoá hoặc nhận tất cả): `00 01 00 00 00 <mailId u32>`; server đáp `53/04`, `17/08`+`53/02`, `53/03` | | ✅ mở+nhận 1 thư · ❌ `53/02` nhiều id |
| `54/01` · `54/02` | Ưu đãi: hỏi `00 <offer u16> 00` / nhận `00 <loại> <offer u16> 00`; Exp Offline Free = offer `0x1e`, loại `02`; đáp `54/02 00 <offer> <01=ok>` + `08/0e` + `02/0a` (id 40476 "%s tăng %s điểm kinh nghiệm") | | ✅ Free |
| `57/02` | Phản hồi điểm danh | `00 | loại | mã` (0 = thành công, 2 = từ chối) | ✅ cấu trúc · 🟡 nghĩa mã 2 |
| `18/02` + `18/01` | Mốc Dị giới cũ (02) rồi mới (01): `00 51 33 NN` | NN = vị trí mốc trong menu (1=Lv10 … 5=Lv70) | ✅ |
| `61/01` | Phản hồi mở menu Dị giới: `00 00` (vào được), `00 06` (đã ở Dị giới) | — | ✅ |
| `07/01` | Phản hồi heartbeat (danh sách bộ ba `(id, số, 20)`) | chưa rõ nghĩa; dùng làm dấu hiệu phiên hợp lệ | 🟡 |

Gói lặp dày, **không dump ở mức debug**: `06/01, 0b/00, 0b/04, 18/08, 01/01, 4d/01, 4d/02, 7c/00, 6e/09, 07/00 (của người khác), 23/32, 18/05`.

Chưa biết: gói kết thúc trận (thưởng exp), opcode đăng xuất (không có, chỉ đóng socket). Đã giải mã xong: kênh (`07/02`, xem `docs/CHANNEL_KNOWLEDGE.md`), đội ngũ (`0d/*`, xem `docs/PARTY_KNOWLEDGE.md`), warp/teleport (`44/01`, `14/08`), combo trận đấu (`32/01`).

## A2b. Từ điển giá trị (mỗi giá trị nghĩa là gì)

Đây là các trường trong `CharacterState` (`packages/protocol/src/index.ts`) — thứ UI nhận qua WebSocket. "Nguồn" là gói/offset trong codec (xem A2) hoặc cách tính.

### Thuật ngữ game

| Thuật ngữ | Nghĩa |
|---|---|
| **Nhân vật / Char** | Nhân vật người chơi (`player`) |
| **Võ tướng / Pet** | Tướng đi theo nhân vật khi xuất chiến (`pet`); mọi võ tướng dùng chung đường cong exp |
| **HP** | Máu |
| **SP** | Tinh lực (năng lượng dùng chiêu) |
| **EXP** | Kinh nghiệm |
| **Hệ** | Thuộc tính nguyên tố của đơn vị: Địa, Thủy, Hỏa, Phong, Tâm, Quang, Ám (+ Vô hệ) |
| **Turn / chuyển sinh** | Số lần chuyển sinh (0–3); mỗi turn đổi đường cong exp, level quay về 1 (Turn 3 chạy Lv 200–400) |
| **Xu** / **Vàng** | Hai loại tiền tệ khác nhau, hiển thị riêng |
| **Map** | Mã bản đồ (số); có bảng tên (A6) |
| **Kênh** | Phân luồng của một map (`07/02`, byte 23 của `07/00`/`0c/00`; xem `docs/CHANNEL_KNOWLEDGE.md`) |
| **Dị giới** | Map đặc biệt, nhân vật đứng yên vẫn nhận exp mỗi ~60s theo từng "tick" |
| **Chủ PT / QSư** | Chủ đội / Quân sư trong đội ngũ (chưa giải mã) |
| **UID** | Mã định danh 8 byte của một đơn vị; UID của **chính mình** nhận từ gói đăng nhập `01/02`, dùng để nhận ra gói của mình |
| **Model id** | Mã mẫu NPC/võ tướng (u16), tra tên trong `npcNames.json` |
| **Tick** | Một lần server thưởng exp định kỳ (~60s): nhân vật +6.000, võ tướng +2.000 |

### Đơn vị (`player` và `pet` dùng chung kiểu `UnitState`)

| Trường | Ý nghĩa | Kiểu / đơn vị | Nguồn | Hiển thị | Tin cậy |
|---|---|---|---|---|---|
| `player.name` | Tên nhân vật | chuỗi ASCII | Spawn `03/00` của mình: độ dài `f[53]`, tên từ `f[54]` (latin1) | Tên ở đầu thẻ Nhân vật | ✅ |
| `pet.name` | Tên võ tướng | chuỗi (tiếng Việt) | `0f/08` model id u16@11 → `npcNames[modelId]`; không có thì `#<modelId>` | Tên ở đầu thẻ Võ tướng | ✅ |
| `player.element` | **Hệ của nhân vật** | `earth/water/fire/wind/heart/light/dark` | Spawn `03/00` byte **`f[18]`**: 1 Địa, 2 Thủy, 3 Hỏa, 4 Phong, 5 Tâm, 6 Quang, 7 Ám, 0 Vô hệ (bỏ trống) | Ô hệ có viền trước tên (🔥 cho Hỏa…) | ✅ Hỏa=3 khớp game |
| `pet.element` | **Hệ của võ tướng** | như trên | **Không có trong packet — tra bảng client:** `Npc_C.dat` u8@50 của 81 byte đuôi theo model id (`npcElements.json`, sinh bởi `tools/import-npc-elements.ts`). 1 Địa·2 Thủy·3 Hỏa·4 Phong·8 Ám ✅ (đối chiếu Lữ Bố/Thái Văn Cơ Hỏa, Nhạn Điêu Tuyết Phong, Ma Quan Vũ Ám); 5 Tâm·7 Quang 🟡 suy theo thứ tự | Ô hệ | ✅ |
| `*.level` (Lv) | **Cấp độ** | số nguyên | Nhân vật: `05/03` u8@28 (và spawn u32@20). Võ tướng: `0f/08` u8@17. Tự tăng khi exp vượt mốc (`[Level Up]`) | Badge `Lv N` ở mép phải header thẻ | ✅ |
| `*.hp.cur` | **Máu hiện tại** | số nguyên | Nhân vật: `05/03` u32@10. Võ tướng: `0f/08` u32@18 | Thanh HP, chữ `cur / max` | ✅ nhân vật · 🟡 pet |
| `*.hp.max` | **Máu tối đa** | số nguyên | Nhân vật: `05/03` u32@46. Võ tướng: **bằng `hp.cur`** (mẫu chỉ có một giá trị khi đầy máu) | như trên | ✅ / 🟡 |
| `*.sp.cur` | **SP hiện tại** | số nguyên | Nhân vật: `05/03` u32@14. Võ tướng: `0f/08` u16@22 | Thanh SP | ✅ / 🟡 |
| `*.sp.max` | **SP tối đa** | số nguyên | Nhân vật: `05/03` u16@50. Võ tướng: bằng `sp.cur` | Thanh SP | ✅ / 🟡 |
| `*.exp` | **% EXP trong cấp** | số thực 0–100 (không làm tròn ở engine) | Tính: `expCur / expMax × 100` | Thanh EXP + chữ `toFixed(2)%` (vd `13.90%`) | ✅ |
| `*.expCur` | **EXP đã có trong cấp hiện tại** | số nguyên | `raw − cum(level)` (xem A3). `raw` = exp tích luỹ do server gửi | Dòng `EXP cur / max` | ✅ |
| `*.expMax` | **EXP cần để lên cấp kế** | số nguyên | `upExp(level + 1)` từ `expTable.json` | Dòng `EXP cur / max` | ✅ |

**Exp thô (không lưu vào state, chỉ dùng để tính):** u32 EXP **tích luỹ từ đầu** (không phải trong cấp). Nằm ở `05/03` u32@29 (nhân vật), `0f/08` u32@13 (võ tướng), và cập nhật sống bằng gói `08/0e` / `08/02` với mã thuộc tính `0x0124`.

### Tài sản

| Trường | Ý nghĩa | Kiểu | Nguồn | Hiển thị | Tin cậy |
|---|---|---|---|---|---|
| `economy.xu` | Số **Xu** đang có | u32 | Gói `1a/04` u32@9 | Ô "Xu" | ✅ |
| `economy.gold` | Số **Vàng** đang có | u32 | Gói `23/05` u32@9 | Ô "Vàng" | ✅ |

Mỗi lần Xu/Vàng đổi (sau lần đầu) sinh sự kiện `Xu: ±N → tổng` / `Vàng: ±N → tổng`.

### Vị trí

| Trường | Ý nghĩa | Kiểu | Nguồn | Hiển thị | Tin cậy |
|---|---|---|---|---|---|
| `location.map` | **Mã bản đồ** hiện tại | u16 | Spawn `03/00` u16@28; cập nhật bằng `07/00` của mình u16@17 | Số "Map" + tên map (tra `mapNames`) | ✅ |
| `location.x` | **Toạ độ X** | u16, đơn vị toạ độ game | Spawn u16@30; `07/00` u16@19 | Số "X" | ✅ (khớp tool gốc) |
| `location.y` | **Toạ độ Y** | u16 | Spawn u16@32; `07/00` u16@21 | Số "Y" | ✅ |
| `location.channel` | **Kênh** (0-based) | số nguyên | `07/02` (đổi kênh), byte 23 của `07/00` và `0c/00` (khi len ≥ 24) | Huy hiệu chấm tròn + ô chọn kênh (xem `docs/CHANNEL_KNOWLEDGE.md`) | ✅ |

Đổi map giữa chừng sinh sự kiện `Đổi map: A → B`.

### Trạng thái khác

| Trường | Ý nghĩa | Tin cậy |
|---|---|---|
| `inBattle` | Đang trong trận | ❌ luôn `false` (chưa có gói) |
| `auto` | Đang bật tự động | ❌ luôn `false` |
| `party.members[1..4]` | Đội ngũ: `slot`, `name` (rỗng = trống), `isLeader`, `isAdvisor` | ❌ luôn 4 slot trống (chưa giải mã) |
| `party.inviteStatus` | Trạng thái lời mời đội gần nhất | ❌ rỗng |

### Kết nối (`ConnectionInfo`, `GET /api/connections`)

| Trường | Ý nghĩa |
|---|---|
| `accountId` | Id tài khoản (mỗi tài khoản tối đa 1 kết nối) |
| `transport` | `socket` (game thật) hoặc `mock` (giả lập) |
| `state` | `offline` · `connecting` · `online` · `reconnecting` · `disconnecting`. Badge UI: online → **Online** (xanh); offline → **Disconnected** (xám); còn lại → **Connecting** (vàng) |
| `error` | Lý do lỗi gần nhất (vd "Server từ chối đăng nhập…") |
| `reconnectAttempt` | Số lần đang thử kết nối lại (1–`maxReconnect`) |
| `connectedAt` | Thời điểm (epoch ms) vào `online` lần gần nhất, đặt lại khi reconnect |
| `lastHeartbeat` | Thời điểm (epoch ms) **gửi ping thành công** lần cuối (không phải lúc nhận phản hồi) |
| `speed` | Hệ số tua cho `mock`; không dùng với `socket` |
| `script` | Trạng thái chạy script (`idle/running/paused/stopping/completed/stopped/error`) |

### Log (`LogEntry`)

| Trường | Ý nghĩa |
|---|---|
| `seq` | Số thứ tự tăng dần theo tài khoản; **reset về 1 khi backend khởi động lại** |
| `ts` | Thời điểm sinh dòng log (epoch ms, theo giờ máy backend); UI hiển thị theo giờ máy trình duyệt |
| `level` | `debug` · `info` · `warn` · `error` |
| `src` | `conn` (kết nối/kỹ thuật) · `script` · `action` · **`game`** (sự kiện tiếng người cho tab "Sự kiện") |
| `msg` | Nội dung |
| `line` | Dòng script (chỉ `src = script`) |

### Cài đặt (`data/settings.json`)

`maxSessions` (số kết nối song song tối đa, mặc định 4) · `defaultTransport` (`socket`) · `socketCodec` (`ts-online`) · `speed` · `logLevel` (chốt lúc đăng nhập) · `commandTimeoutMs` (60000) · `heartbeatMs` (12000 = chu kỳ heartbeat `07/01`+`0a/00`, khớp tool gốc) · `autoReconnect` (bật) · `maxReconnect` (1 — giảm từ 5 để không tự dồn dập login khi bị khoá).

### Trường trong packet CHƯA hiểu (để khỏi dò lại từ đầu)

| Vị trí | Quan sát | Ghi chú |
|---|---|---|
| `05/03` `f[9]` | luôn `3` (kể cả Lv3 và Lv120) | **Không phải level** |
| `05/03` u32@22 | `6` | chưa rõ |
| `05/03` u16@33, @35 | 118, 238 (Lv120) | có thể là chỉ số cơ bản |
| `05/03` u16@84..93 | `500, 625, 500, 500, 500` (năm giá trị) | có thể là chỉ số/kháng theo hệ; **đừng nhầm là hệ** |
| `0f/08` u16@24..35 | `66, 189, 89, 102, 85, 60` | có thể là chỉ số của võ tướng |
| `0f/08` `f[9]`, `f[10]` | luôn `1, 1` | **không phải hệ** (pet hệ Ám vẫn =1) |
| `03/00` `f[17]` | `1` hoặc `2` | chưa rõ (giới tính/phe?) |
| `08/01`, `08/02` lúc login | mã `0x013e`=1; `0x0142/0x0143/0x0145`=0; `0x01d2/0x01d3/0x01d4/0x01d6` = 50/29/46/27 | các thuộc tính khác của nhân vật/pet — chưa biết mã nào là gì |
| `02/0a` | Thông báo hệ thống Big5, có tên đơn vị + số exp nhận ở cuối | chỉ đối chiếu |

## A3. Cơ chế EXP (quan trọng nhất)

- Server **chỉ gửi EXP tích luỹ** (u32), không gửi %, không gửi mốc lên cấp. Server **tự đẩy** mỗi ~60s ở map đặc biệt (Dị giới): nhân vật +6.000, võ tướng +2.000; ở map thường đứng yên thì không có exp. Sau trận đánh server cũng thưởng exp (gói chưa giải mã). **Tuyệt đối không dùng timer để cộng exp giả lập.**
- Bảng exp lấy từ `https://tsexp.pages.dev/` (trang nhúng `const DATA = {t0,t1,t2,t3}`; mỗi hàng `[level, EXP lên cấp, EXP tích luỹ]`). Script `tools/import-exp-table.ts` tải, kiểm tra tổng tích luỹ từng hàng, ghi JSON `curves["0".."3"] = [[upExp, cum], …]` (index = level − 1).
  - Công thức: Turn 0 `trunc(round₂(L^2.9)) + 5`, Turn 1 `^3.1`, Turn 2 `^3.24`; Turn 3 (Lv 200–400) công thức riêng, răng cưa theo block 60.
  - Võ tướng dùng chung đường cong: chưa chuyển sinh → curve `0`; đã chuyển sinh (turn 2) → curve `1` (^3.1).
- **Tính**: `exp trong cấp = raw − cum(L)`, `mốc = upExp(L+1)`, `% = cur / mốc × 100` (giữ số thực, UI làm tròn 2 số).
  - Ví dụ đã đối chiếu: nhân vật Lv120 cum = 33.479.408, mốc 1.096.679; pet Lv96 cum = 33.400.969, mốc 1.442.095.
- Gói **không cho biết số lần chuyển sinh** ⇒ `lookupExp(level, raw, curves)` tự chọn đường cong thoả `cum(L) ≤ raw < cum(L) + upExp(L+1)`. Level thấp có thể trùng nhiều đường; level cao thì duy nhất.
- Lên cấp: nếu không khớp level hiện tại, thử level +1..+3, chỉ nhận khi khớp bảng, rồi phát `[Level Up]`.
- Không khớp bảng ⇒ **không đoán**, chỉ log cảnh báo.

## A4. Hệ (element)

- Thứ tự mã (lấy từ `TextData_C.dat` id 10462–10468 và 30003–30007): **0 Vô, 1 Địa, 2 Thủy, 3 Hỏa, 4 Phong, 5 Tâm, 6 Quang, 7 Ám**. ✅ Hỏa=3 khớp nhân vật thật (`03/00` byte 18).
- Hệ của võ tướng **không có trong packet**; lấy từ `Npc_C.dat` (u8@50 đuôi bản ghi, xem `tools/import-npc-elements.ts`). Mã 6 không NPC nào dùng; 5/7 chưa đối chiếu với pet thật.

## A5. Phiên kết nối (`GameConnection`)

Server game có hành vi mà code phải tôn trọng — đây là phần dễ gây khoá/khó hiểu nhất:

- Đóng socket **không có gói đăng xuất** (đã xác nhận bằng pcap: tool gốc cũng chỉ đóng TCP, client gửi FIN) ⇒ server **giữ phiên cũ 50 giây đến ~2 phút**. Đăng nhập lại trong lúc đó bị trả UID rỗng hoặc im lặng. **Mỗi tài khoản một phiên**: tool gốc trên VPS, client game, web bot giành nhau; đăng nhập nơi này đá nơi kia.
- Server **hạn chế relog dồn dập và khoá tạm** (đã gặp: nhiều lần thử liên tiếp ⇒ mọi lần login trả UID rỗng + `14/08 00 30` kể cả khi mật khẩu đúng; thời hạn khoá không báo, mỗi lần thử có thể kéo dài). **Không spam**:
  - `SESSION_COOLDOWN_MS = 30s` sau lần đóng socket gần nhất (lưu `data/last-closed.json`, nên restart vẫn nhớ), chờ hết rồi mới login.
  - Bị từ chối/im lặng: **thử lại đúng 1 lần sau 30s** (`DEFAULT_LOGIN_RETRY_MS = [30_000]`, trước đây 3 lần 10/20/30s), rồi dừng và báo lỗi. Timeout mỗi lần login 10s. Lỗi chuyên biệt `LoginRejectedError`.
  - Khi đang chờ/thử lại, bấm Huỷ/Đăng xuất dừng ngay (`loginAbort`).
- Rớt ngoài ý muốn (`handleDrop`: server đóng socket → `server đóng kết nối`; lỗi socket; heartbeat lỗi) ⇒ nếu `autoReconnect` bật thì tự reconnect (chờ 10s ×2ⁿ, tối đa 30s, tối đa `maxReconnect=1`). **Reconnect cũng đá tool gốc nếu hai bên cùng tài khoản** (giành nhau).
- Không có timer ngắt theo thời gian trong code. Lần rớt đã quan sát được là **server/mạng đóng** (không phải bot).
- **Backend `tsx watch` khởi động lại mỗi khi lưu file ⇒ `logoutAll` ⇒ mất phiên đang treo.** Treo game dài hạn: chạy `npm run start`, đừng sửa code backend lúc đó. Mỗi lần sửa engine khi đang online = phải login lại (tốn một lần login, cẩn thận với khoá).
- Đăng nhập nhanh từ UI: `POST /api/session/login {username, password}` — server mặc định là dòng đầu `data/servers.json`, transport luôn `socket`. **Password rỗng ⇒ dùng mật khẩu đã lưu** (`AccountStore.findByUser`). Không bao giờ trả mật khẩu về trình duyệt.
- Timer còn lại: heartbeat 12s (`07/01`+`0a/00`, log `debug`); `syncTimer` 3s **chỉ phát lại state sẵn có** cho UI (không đổi số liệu).

## A6. Dữ liệu tra cứu từ `tool-reference` (nhị phân, tự dựng bảng)

| Nguồn | Cấu trúc | Dùng cho |
|---|---|---|
| `Data/TextData_C.dat` | `u32 count` (9117) rồi từng bản ghi `[id u32][độ dài BYTE u16][chuỗi UTF-16LE]` | Tên map, tên hệ |
| `Data/SceneSet_C.dat` | `u32 count` (3642) rồi bản ghi **17 byte** `[textId u32][mapId u16][11 byte]` | map id → text id |
| `Data/VN/Npc_C.dat` | `u32 count` (7387) rồi `[u16 độ dài byte][tên UTF-16LE][81 byte]`; trong 81 byte: `u8`, **`u16 modelId`**, … | model id → tên võ tướng/NPC (hai bản ghi cùng tên là hai model khác nhau) |
| `Script/*.ini` | script DSL của tool cũ | `import-scripts` |

- Map: `mapId → SceneSet.textId → TextData[textId]`. Ví dụ 12002 = "Đường phố Trác Quận", 49942 = "Dị giới TS (lông vũ)". Hàm UI: `getMapNameById(mapId)` (rỗng nếu không có).
- **Không tìm thấy bảng exp trong tool gốc** (đã quét `.dat`, `.exe` ở nhiều dạng u32/u64/text). `SimpleBot.exe` là stub .NET với vùng `.data` ~1,75MB entropy 7,94 (mã hoá/nén) → chương trình thật nằm trong khối đó. **Quyết định: không giải mã/gỡ bảo vệ** (và `Easytool.exe` chỉ là license wrapper). Dùng nguồn công khai (tsexp) thay thế.

## A7. Pipeline log & sự kiện

- Nguồn log (`LogSource`): `conn`, `script`, `action`, **`game`** (sự kiện đã dịch sang tiếng người, hiển thị ở tab "Sự kiện").
- Codec phát sự kiện qua `io.game(msg)` (không tiền tố kỹ thuật); `io.log(level, msg)` cho log kỹ thuật (`[ts-online] …`).
- **Giọng thông báo**: mọi câu của tab Sự kiện nằm một chỗ ở `packages/engine/src/data/messages.ts` (`MSG`), giọng vui vui gọi người chơi là "Ní" (vd "Đăng nhập thành công rồi Ní ơi !!!", "Ní bị ngắt kết nối rồi :((", "Ní đã vào Dị giới Lv.55 rồi !!!"). Màu từng dòng do `kind()` trong `GameLog.tsx` quyết định theo **mẫu câu** — sửa câu trong `messages.ts` thì rà lại `kind()` và test `parser.test.ts` (kiểm tra vài câu kết nối).
- Sự kiện game hiện có (ý, không phải nguyên văn): exp `(Tên): +6.000 exp - (19.70%) 216.085/1.096.679`, `lên cấp → Lv N`, `Vàng/Xu: ±N → tổng`, `Đổi map: A → B`, `Dị giới: chọn mốc Lv.X` (lúc gửi) và `Dị giới: mốc Lv.A → Lv.B` (khi server xác nhận bằng `18/02`+`18/01`), `Điểm danh: ngày X/28, liên tiếp Y/25` (lúc login và khi bộ đếm đổi), `Điểm danh ngày N: đã gửi yêu cầu` / `Điểm danh thành công` / `Điểm danh không thành công — …`, `Túi đồ ô N: <tên> × số lượng`, và vòng đời kết nối (`Đã đăng nhập`, `Mất kết nối: …`, `Kết nối lại lần n/1 sau Ns`, `Kết nối lại thành công`, `Server từ chối đăng nhập — thử lại…`, `Đã đăng xuất`…).
- Đẩy **theo sự kiện, không polling**: `GameConnection.log()` gắn `seq` + thời gian → bộ đệm 5000 dòng/tài khoản → backend gửi qua WebSocket **tới client đã `subscribe` tài khoản đó** → trình duyệt gộp theo `seq`. REST `GET /api/connections/:id/logs?after=` chỉ để **bù** khi chọn tài khoản/nối lại WS.
- Log hex phục vụ reverse: `[PKT 08/0e] len=… <hex>` (gói thay đổi exp/ví), `[EXP Update] …`, `[EXP?]` (bộ dò gói lạ chứa u32 nằm trong khoảng exp: chỉ log, **không sửa state**, bật sau 5s kể từ login, siết bằng: chỉ tăng, ≤60.000, ≤1 byte 0; **có thể báo nhầm**). Mức `debug` dump mọi gói (trừ gói lặp dày và `01/02` vì chứa user/pass dạng rõ). **Ở mức `info` chỉ in `[PKT …]` cho 4 loại gói (`08/0e`, `08/02`, `23/05`, `1a/04`): thấy log im lặng không có nghĩa server im lặng** — bật `debug` trước khi login để kết luận.
- `logLevel` của một phiên **chốt lúc đăng nhập** (đổi trong Cài đặt chỉ có tác dụng từ lần login sau).

## A8. Phương pháp reverse-engineering (đã chứng minh hiệu quả)

1. **Có số thật làm "ground truth"**: người dùng chụp màn hình tool gốc (level, HP, SP, exp, xu, vàng, map, x/y). Mọi giả thuyết đều phải khớp số này.
2. **Bắt frame ở mức debug** rồi lưu ra JSON (bỏ gói chứa mật khẩu), **phát lại (replay)** vào codec để thử parser — không phải đăng nhập lại.
3. **Tìm số trong frame** ở nhiều dạng (u32/u16/u24, LE/BE). Coi chừng trùng ngẫu nhiên (đã nhầm: `f[9]` "level" thật ra hằng số; hai số ~33,48 triệu "exp thô" thật ra chứa SP).
4. **So sánh giữa hai phiên** khi một đại lượng đổi (exp 293 → 9.891 ⇒ u32@29 tăng đúng 9.598) để xác nhận trường tích luỹ.
5. **Quan sát cả đồng hồ**: gói tick xuất hiện đều ~60s ⇒ cơ chế do server đẩy, không cần polling.
6. **Không dò opcode bừa trên server thật** (rủi ro bị chặn). Gửi lại các gói INIT đã biết chỉ để kiểm tra giả thuyết, một lần, cách nhau.
7. Khi không chắc ⇒ hiện 0/ẩn và log cảnh báo, **không bịa**.

## A8b. Công cụ `tools/pcap-decode.ts` (đọc capture của client game / tool gốc)

- `npm run pcap -- file.pcap` (hoặc `.pcapng`; PCAPdroid, pktmon, Wireshark đều được). Tự ghép luồng TCP tới cổng 6614, tách frame, in `thời gian | C→S/S→C | cmd/sub | len | payload (f[8..]) | # tên gọi`. **Frame đăng nhập `01/00` và phản hồi `01/02` luôn bị che** ở mọi chế độ.
- Mặc định ẩn gói lặp dày (di chuyển, spawn, heartbeat…) và in dòng tổng "đã ẩn N gói"; `--all` để xem hết. Hay dùng: `--only 57/02,17/08` (lọc opcode), `--find u16:46029` (tìm itemId/mapId dạng little-endian trong mọi gói, in offset từ `f[0]`), `--from/--to` (cửa sổ giây), `--dir c` (chỉ client gửi), `--text` (giải mã thông báo 02/0a Big5), `--candidates` (chỉ liệt kê gói client không thuộc khởi tạo/heartbeat, kèm phản hồi server — cách nhanh nhất tìm gói hành động), `--stats` (đếm opcode), `--diff file2` (opcode chỉ có ở một bên — dùng so capture "có bật tính năng" với "không bật"), `--json`.
- **Skill `/get-action-from-cap-file`** (`.claude/skills/get-action-from-cap-file/SKILL.md`): bỏ file cap vào `captures/` rồi gọi skill → tự chọn file mới nhất, tìm gói hành động bằng `--candidates`/`--find`, giải mã, cài action (registry + codec + phản hồi + UI + test byte-exact + docs) và báo kết quả. Nguyên tắc: chỉ đọc file, không đăng nhập/gửi gói lên server khi chưa được đồng ý, che frame đăng nhập.
- Hay gặp: một số frame server mất 6 byte header (`00 00 xx xx xx xx`) trong pcap của tool gốc — công cụ vẫn tách được và gắn `⚠ header lỗi`; web bot không gặp vì nhận socket trực tiếp.
- Quy trình capture từng tính năng: bắt từ trước khi login, chờ ~1 phút, làm đúng một thao tác, ghi giờ; mỗi tính năng một file. File pcap để trong `captures/` (không chia sẻ nguyên file vì có frame đăng nhập).

## A9. An toàn & ràng buộc

- Không hardcode mật khẩu; không gửi mật khẩu về frontend; form hiện `********` khi dùng mật khẩu đã lưu.
- Không spam đăng nhập; không giải mã/gỡ bảo vệ phần mềm có license; không đụng `Easytool.exe`.
- Server backend chỉ nghe `127.0.0.1` (chưa có xác thực — đừng mở ra ngoài).
- File pcap trong `captures/` chứa **frame đăng nhập** (user/mật khẩu chỉ XOR `0xAD`): không gửi nguyên file cho ai, không commit; khi phân tích che frame `01/00`.
- Gói hành động lên server thật: **một lần, một gói, cách nhau**; gói có tác dụng không hoàn tác được (nhận thưởng, mua, vứt) chỉ gửi khi đã hiểu rõ. Đã cố ý **không** đưa vào INIT: `4d/03 3f`, `63/04`, `5b/02`, `56/01`.

---

# PHẦN B — THIẾT KẾ UI

## B1. Layout màn hình chính (`pages/Home.tsx`)

- Hai tab điều hướng cũ "Kết nối", "Nhân vật" đã **gộp thành `Home`**; thanh điều hướng còn: Kịch bản (chạy, nhiều tài khoản), Tạo kịch bản (soạn/quản lý), Tài khoản, Cài đặt. Tab "Điều khiển (Warp)" đã bỏ (warp nằm ở Home). Bấm tiêu đề "TS Bot Web" để về Home.
- **Hai cột** (không phải hai hàng cứng, để Log lấp khoảng trống dưới "Vị trí & Bản đồ"):
  - Trái: Đăng nhập → thẻ Nhân vật → thẻ Võ tướng → Đội ngũ → **thẻ Hành động** (hàng nút icon 64×64, tooltip tức thì bằng `data-tip`: 🌀 "Vào map Dị giới" mở popup chọn mốc, 📅 "Điểm danh ngày" gọi `daily_checkin`; thêm action mới = thêm một nút vào hàng).
  - Phải: Tài sản (Xu/Vàng) → Vị trí & Bản đồ → Log (tab Sự kiện | Log).
- Khi chưa có dữ liệu vẫn vẽ đủ khối với số 0 (`EMPTY` state); khi không online các khối dữ liệu mờ (`.home.stale`, opacity .55) và nút bị khoá, **đăng nhập và log vẫn sáng**.

- **Popup Dị giới**: lớp phủ `.modal-back` + thẻ `.modal`, 15 mốc Lv.10…180 xếp 2 cột (cuộn nếu thấp), mặc định Lv.25; Xác nhận gọi `dijie_enter { level }`. Click ra ngoài đóng. Nút chỉ bật khi `online`.

## B2. Quy tắc CSS chống "kéo cả trang"

Nguyên nhân từng gặp: cột phải chỉ có `min-height`, không có chiều cao giới hạn ⇒ khung log phình theo số dòng ⇒ cả trang cuộn.
- `html, body, #root { height:100% }`, `body { overflow:hidden }`, `.app` là flex cột 100%, header `flex:none`, `main { flex:1; min-height:0; overflow:auto }`.
- `.home { height:100%; grid-template-rows:minmax(0,1fr) }`; cột trái `overflow-y:auto`, cột phải `overflow:hidden`; thẻ log `flex:1; min-height:0`; `.logbody { flex:1; min-height:0; max-height:100%; overflow-y:auto; overscroll-behavior:contain }`.
- **Tự cuộn chỉ dùng `container.scrollTop`**, không dùng `scrollIntoView()`. Log mới nằm trên cùng ⇒ "Tự cuộn" đặt `scrollTop = 0`.
- Dưới 900px: về một cột, `height:auto`, bỏ cuộn riêng, log `min-height:360px`.

## B3. Component & quy ước

- **LoginPanel** (`components/LoginPanel.tsx`) — **một hàng**: badge trạng thái · ô tài khoản · ô mật khẩu (👁 chỉ khi tự gõ) · nút nhỏ. Không tiêu đề, không nhãn (placeholder + `aria-label`).
  - Badge: `Online` (xanh) / `Connecting` (vàng, nhấp nháy; gồm connecting, reconnecting, disconnecting) / `Disconnected` (xám).
  - Nút: `Đăng nhập` (primary) → khi kết nối: spinner + "Đang kết nối..." (kèm `Huỷ`) → khi online: `Đăng xuất` (cam đỏ).
  - `saved`: mật khẩu hiển thị `********` và **gửi chuỗi rỗng** để backend dùng mật khẩu đã lưu; gõ vào thì chuyển sang nhập thường.
  - Tự chọn tài khoản đã lưu để Log hiện ngay; khôi phục phiên đang online sau reload (theo dõi cả `accs` lẫn `connections` vì `connections` về sau).
- **UnitPanel** (thẻ Nhân vật / Võ tướng) — header: **[ô hệ có viền] Tên … Lv N**; bỏ nhãn "Nhân vật/Võ tướng" và avatar. Tên `1.2rem`, đậm 600; cắt `…` nếu dài. Ba thanh HP/SP/EXP cao 18px + dòng `EXP cur / max`. Padding 12px, hai thẻ cao bằng nhau.
  - Ô hệ 26×26, viền 1.5px **màu theo hệ** + nền tint: 🪨 `#b7791f` · 💧 `#3b82f6` · 🔥 `#f97316` · 🍃 `#34d399` · 💗 `#f472b6` · ✨ `#facc15` · 🌑 `#a855f7`; chưa biết hệ ⇒ ô xám `?`.
- **Vị trí & Bản đồ**: (1) hàng tiêu đề + tên map, bên phải 3 **ô nhỏ có viền** Map/X/Y (rộng vừa đủ nội dung, nhãn nhỏ trên giá trị); (2) hàng **Warp**: `MapSelect` (`components/MapSelect.tsx`, mặc định `source="all"`) = combobox tìm kiếm trên **3.642 map** của `mapNames.json` (nguồn `SceneSet_C.dat` + `TextData_C.dat`), gõ mã map hoặc một phần tên **không cần dấu** ("trac quan"), ↑/↓ + Enter chọn, hiện tối đa 80 dòng, số 1..65535 ngoài danh sách vẫn gõ được; + nút Warp + chọn kênh; (3) hàng X/Y + Đi / AI tìm / Bản đồ. **Warp** (`warp_map`) = *tới đúng map đã chọn*: engine **teleport tới cổng thành gần nhất** (`teleport_gate`, gói `44/01`) rồi di chuyển tiếp; **chặng đi tiếp chưa có gói** nên hiện dừng ở cổng thành và báo rõ tuyến còn lại (xem Phụ lục B của `docs/game_actions_knowledge.md`). **Dịch chuyển đến cổng thành** là nút riêng 🏯 trong thẻ Hành động (cạnh 🌀 và 📅): popup có `MapSelect source="gates"` (41 cổng của `Warp_C.dat`, `warpGates.json`) và nút "Dịch chuyển" → `teleport_gate`. Tên map ngay sau tiêu đề, màu `#34d399`, tính từ `location.map` mỗi lần render (tự đổi khi map đổi).
- **Đội ngũ**: bảng 4 dòng nén; placeholder ô nhập: "Tên chủ PT".
- **Định dạng số**: `toLocaleString("vi-VN")` cho số lớn; **% EXP luôn `toFixed(2)`**.

## B4. Khung Log (`GameLog.tsx`, `LogView.tsx`, `live.tsx`)

- Thẻ có hai tab: **Sự kiện** (mặc định) và **Log** (kỹ thuật). Không có chữ "Log" làm tiêu đề.
- **Mới nhất ở trên cùng** (đảo thứ tự khi vẽ; xuất file vẫn theo thời gian xuôi). Giữ nguyên cột giờ theo giờ máy (đồng hồ ở header là giờ Đài Loan → lệch +1h so với giờ VN).
- Tab Sự kiện: chỉ `src === "game"`; tô màu theo loại: exp xanh lá · lên cấp vàng · Vàng/Xu cam · đổi map xanh dương · mất kết nối/thất bại đỏ · đã đăng nhập/kết nối lại xanh lá đậm · đang chờ/thử lại vàng · đăng xuất xám.
- **Giới hạn 100 dòng/loại** (game và kỹ thuật tính riêng) bằng `trimLogs()` — giữ 100 dòng mới nhất, bỏ dòng cũ để UI nhẹ. Nạp bù 5000 dòng cũng chỉ còn 100. Backend vẫn giữ bộ đệm 5000.
- **Bẫy đã gặp — `seq` reset khi backend restart**: bộ đếm `seq` về 1, trình duyệt giữ `seq` cũ lớn hơn ⇒ lọc mất mọi dòng mới. Sửa: khi nhận WS `hello` thì xoá log và nạp lại; `mergeLogs` coi `seq` lùi mà `ts` tiến là reset.

## B5. Header

- Thanh trên cùng: tiêu đề · điều hướng · **đồng hồ giờ Đài Loan** (góc phải). Đã bỏ dòng "Đã kết nối · n/4 kết nối"; chỉ hiện chữ đỏ nhỏ "Mất kết nối server" khi **WebSocket tới backend đứt** (dữ liệu có thể đã cũ).
- **TaiwanClock** (`components/TaiwanClock.tsx`): pill kính tối (`rgba(30,41,59,.7)`, viền `rgba(255,255,255,.08)`, `border-radius:9999px`, `padding:4px 10px`), chấm xanh `#10b981` có hiệu ứng vòng sáng (tắt khi `prefers-reduced-motion`), **cờ Đài Loan vẽ bằng SVG** (emoji cờ không hiện trên Windows), giờ monospace `tabular-nums` `#e2e8f0` (độ rộng cố định, không giật), múi giờ `Asia/Taipei`. Tooltip tự dựng (hover/focus): "Giờ máy chủ Đài Loan (GMT+8) — Chênh lệch +1h so với giờ Việt Nam" + ngày đầy đủ.
- Pill dùng bảng màu tối cố định (ở chế độ sáng vẫn là chip tối).

## B4b. Thùng đồ (`components/InventoryDialog.tsx`, `ContextMenu.tsx`)

- Nút 🎒 trong thẻ Hành động mở popup **Thùng đồ**: bảng Ô · Vật phẩm · ID · SL từ `CharacterState.bag` (gói `17/05` + `17/08`), ô tìm theo tên không dấu hoặc ID, tên vật phẩm tra từ `apps/web/src/data/itemNames.json` (nạp lười). Mock transport có sẵn túi mẫu để thử UI.
- Tiêu đề popup hiện `N/50 ô` (số ô có đồ / sức chứa; 50 là mặc định hằng số `BAG_CAPACITY`, gói `17/05` không ghi sức chứa — mở rộng sẽ cần lấy từ server) và dấu **?** (rê chuột/focus để đọc hướng dẫn thay cho đoạn chữ dưới bảng). **Sắp xếp**: bấm tiêu đề cột Ô / Vật phẩm (A→Z, bấm tiếp Z→A; so sánh theo locale `vi`) / SL (tăng, bấm tiếp giảm); ô tìm theo tên không dấu hoặc ID.
- **Chuột phải** một dòng (hoặc nút ⋯ cho cảm ứng) → `ContextMenu` tối (`rgba(15,23,42,.95)`, viền `#334155`) có **tiêu đề = `Tên (itemId)`**, menu con (Phân giải ▶, Đóng góp ▶, Vứt bỏ ▶, Thêm tất cả ▶) tự lật trái/lên khi sát mép, đóng khi bấm ra ngoài/Esc, hỗ trợ ↑↓ → ← Enter.
- **Mục "Thêm …" chạy thật**: lưu vào backend `data/item-lists.json` theo tài khoản (`GET/PUT /api/accounts/:id/item-lists`, 7 danh sách: autoOpen, exception, combine, sell, resolve, contribute, discard); mục đã có hiện "✓ Đã thêm … (bấm để bỏ)", bấm lại để bỏ. "Id" chép ItemID vào clipboard. Chưa có vòng auto nào đọc các danh sách này.
- **Thao tác gửi gói CHƯA chạy**: Nhân vật/Võ tướng sử dụng, Phân giải/Đóng góp/Vứt bỏ vật phẩm, Mở thêm ô túi, Tự hợp Lông Vũ đã nối action (`use_item`, `use_item_pet`, `resolve_item`, `contribute_item`, `drop_item`, `open_bag_slot`, `auto_combine_dragon`) nhưng codec trả "chưa có gói tin" — cần capture từng thao tác từ tool gốc. Vứt bỏ có popup xác nhận.

## B4c. Tiêu đề popup

Mọi `.modal` (Thùng đồ, Dịch chuyển đến cổng thành, Vào map Dị giới, xác nhận vứt bỏ) dùng chung kiểu tiêu đề: `h2` trực tiếp hoặc khối `.mhead` (tiêu đề + chip/dấu ? + nút Đóng) có nền xanh đen (`#091428 → #0e3b55`), chữ sáng 20px đậm có bóng phát sáng, viền trái và viền dưới xanh dương (`#38bdf8`). Muốn popup mới đồng bộ chỉ cần đặt `<h2>` làm con đầu của `.modal`.

## B5b. Toast (`components/Toast.tsx`)

- `ToastProvider` bọc `<App />` trong `main.tsx`; dùng `const toast = useToast(); toast("error" | "ok" | "info", "nội dung")`. Thông báo nổi **góc dưới phải**, xếp chồng tối đa 4, tự tắt (ok 3,5s · info 5s · lỗi 8s), bấm để đóng; lỗi dùng `role=alert`.
- **Quy ước**: kết quả của hành động (lỗi, lời nhắn của server như "Đã teleport tới cổng thành … chặng tiếp theo cần gói di chuyển") hiện bằng toast, **không** chèn chữ vào thẻ tính năng. Thành công thông thường thì tab "Sự kiện" đã báo nên không bật toast. `Home.act()` đã theo quy ước này; các trang khác (Điều khiển, Runner…) còn dùng chữ tại chỗ, chưa đổi.

## B6. Phản ứng (reactivity)

- Một WebSocket duy nhất (`live.tsx`), tự nối lại sau 1,5s. Tin: `hello` (kết nối + nhân vật), `connection.upsert`, `connection.removed`, `character.state_update` (broadcast cho mọi client), `log` (chỉ client đã subscribe tài khoản).
- Mọi thanh/số/tên/log tự vẽ lại khi state đổi; không cần reload hay bấm nút.

## B7. Quy trình kiểm tra UI

- **Dùng Playwright CLI, không dùng Claude in Chrome.** Mẫu: `playwright-cli -s=lay open http://localhost:5173` → `resize 1440 900` → `eval "() => …"` (đo `scrollHeight/clientHeight`, kích thước phần tử) → `screenshot --filename=<đường dẫn tuyệt đối>` → `close`. Lệnh `resize` đôi khi không áp dụng ở lần chạy sau — kiểm tra lại `innerHeight`.
- Test layout không cần phiên game thật: chèn DOM giả vào `.logbody`, đo trang có cuộn không (`documentElement.scrollHeight === innerHeight`).
- Luôn đo số (độ cao, khoảng cách, độ rộng) **và** nhìn ảnh chụp.

---

# PHẦN C — Quy trình, bài học, việc dang dở

## C1. Checklist thêm một trường mới từ packet (dữ liệu)

1. Xin ground truth (ảnh/ số trong game) hoặc chuẩn bị đổi giá trị rồi so hai phiên.
2. Bật `logLevel=debug` **trước khi đăng nhập**, lấy frame, lưu ra file (loại gói `01/02`).
3. Tìm giá trị ở nhiều dạng, xác định `cmd/sub` + offset; kiểm tra trên ≥2 mẫu khác nhau.
4. Viết handler trong `tsOnline.ts` → `io.patchState(...)`; nếu cần, `io.game("…")` cho sự kiện.
5. Phát lại frame đã lưu, so với ground truth; thêm test vitest (đặc biệt với phép tính).
6. Cập nhật bảng A2 trong tài liệu này (đánh dấu ✅/🟡).

## C2. Checklist thêm một thành phần UI

1. Kiểu dữ liệu trong `packages/protocol` (nếu thêm trường vào `CharacterState`/`LogEntry`).
2. Component + CSS bằng biến màu (`--panel`, `--line`, `--muted`…); kiểm tra chế độ sáng/tối.
3. Đảm bảo không phá quy tắc B2 (chiều cao cố định, cuộn trong khung).
4. Đo bằng Playwright rồi chụp ảnh.

## C3. Bài học / sai lầm đã gặp

- Đoán trường từ một mẫu → sai khi dữ liệu đổi (level, hệ pet, "exp thô"). **Luôn kiểm chứng bằng mẫu thứ hai.**
- `UID rỗng` không đồng nghĩa sai mật khẩu: có thể phiên cũ chưa giải phóng hoặc tool gốc đang giữ phiên.
- Lưu code backend khi đang treo ⇒ mất phiên (dev watch). Gom nhiều chỉnh sửa vào một lần lưu; treo thật thì `npm run start`.
- `seq` log reset khi restart ⇒ UI trống log (đã sửa B4).
- Ghi mật khẩu vào mã nguồn/endpoint trả mật khẩu bị chặn ⇒ thiết kế "mật khẩu rỗng = dùng cái đã lưu".
- macOS: `sed -i` cần đối số khác; ưu tiên Edit hoặc script Python. `tsx` CJS không cho top-level `await` ⇒ bọc `main()`.
- Tool "Claude in Chrome" không phản hồi/không được dùng ⇒ dùng Playwright CLI.
- Đừng gửi gói dò lên server thật; đừng gỡ bảo vệ exe.
- **Phiên thiếu INIT lô 2 bị server bỏ qua mọi gói hành động mà không báo lỗi** (mất vài lượt thử mới ra). Khi gói "gửi được nhưng không có tác dụng": so trình tự gói với pcap **bắt từ lúc login** của client thật trước, đừng chỉ đổi mã tham số.
- Frame của client chuẩn luôn có byte `00` đầu payload; INIT cũ của web bot thiếu byte này.
- `logLevel=info` giấu phần lớn gói nhận (chỉ 4 loại in `[PKT]`): bật `debug` trước khi login rồi mới kết luận "server không trả lời".
- Log của tool gốc là nguồn đối chiếu quý: ghép giờ log với mốc gói trong pcap để biết gói nào sinh dòng nào (đã làm với "Đã điểm danh ngày", "Trực tuyến", "Nhận được …").
- Đồng hồ "đếm ngược Dị giới" từng bị đoán là `55/01` id `0x1b`; thực ra là **phút online hôm nay** (đạt 194 > 120). Đừng chốt ý nghĩa bộ đếm khi mới có hai mẫu gần nhau.
- macOS chặn terminal đọc `~/Downloads` (TCC): cho người dùng chép file vào `captures/` bằng Finder, hoặc cấp quyền Downloads/Full Disk Access cho terminal.
- Spam login ⇒ bị khoá tạm: mỗi lần test dùng đúng một lần login, chờ ≥1 phút giữa các lần, đừng để vòng thử lại tự chạy.

## C4. Việc còn dang dở

- ❌ Gói **kết thúc trận** (thưởng exp) và **HP/SP khi đánh trận** (pet hiện đặt cur = max). Dùng `[EXP?]` + `[PKT …]` khi đi train để tìm.
- ❌ Trường **hệ của võ tướng** trong packet (hiện gán theo tên).
- ✅ ~~Opcode đăng xuất~~: **không có** — đăng xuất chỉ là đóng TCP (xác nhận từ pcap tool gốc).
- ✅ **Kênh (Map Channel)**: đã hoàn thành giải mã kênh (`07/02`, `07/00@23`, `0c/00@23`, bắt lỗi kênh đầy `10135`; xem `docs/CHANNEL_KNOWLEDGE.md`).
- ✅ **Đội ngũ (Party)**: đã hoàn thành (`0d/*`, xem `docs/PARTY_KNOWLEDGE.md`).
- ❌ Gói làm mới trạng thái định kỳ ngoài `07/01`+`0a/00`. `encodeAction` hiện có: `channel`, `dijie_*`, `daily_checkin`, `warp_map`, `teleport_gate`, `party_*`.
- 🟡 **Điểm danh**: `57/02` ngày kế tiếp = bộ đếm `0x6b` + 1 mới suy ra; thành công (quà + `17/08`) chỉ có 1 mẫu từ client thật; web bot mới thử được trường hợp bị từ chối (mã 2). Cần một tài khoản chưa điểm danh để xác nhận.
- 🟡 **Dị giới**: mã mốc Lv.85…180 (6…15) suy ra theo thứ tự menu, chưa thử; **đồng hồ đếm ngược** chưa tìm thấy gói (không phải `55/01` `0x1b`).
- ❌ Ý nghĩa `5b/01` (trạng thái theo mục), `5b/02`, `56/01`, `63/0x`, `42/01` (nghi dùng vật phẩm "Triệu Tướng 1"/"Rút Thẻ 1"), `07/01` danh sách bộ ba, các id `0xa9/0xab/0xac` của `55/01`.
- 🟡 Turn 3 (Lv > 255): level đang đọc từ 1 byte ở `05/03`; spawn dùng u32 nên có thể đúng hơn — cần mẫu thật.
- 🟡 Ghi vùng đệm 30 gói cuối khi socket đóng để biết server có gửi lý do trước khi đóng.
- 🟡 `[EXP?]` có thể báo nhầm (vd gói `0e/05`, `0f/01`).

### Quản lý kịch bản (tab "Kịch bản" / "Tạo kịch bản")
- **Ba nơi lưu, tách bạch**: `data/scripts/` = script gốc import từ tool cũ (luôn chạy được; thư mục `tool-reference/Quest/` trong yêu cầu không tồn tại, nguồn thật là `tool-reference/BOT TSM/Script` → `npm run import-scripts`); `data/custom_scripts/` = script tự tạo (nháp, chỉ hiện ở "Tạo kịch bản", vẫn định dạng `.ini` để dùng chung parser); `data/runnable_scripts_registry.json` = `{custom: [id…]}` các script tự tạo đã duyệt.
- **API**: `/api/custom-scripts[/*]` (GET/PUT/DELETE, PUT nhận `renameFrom` để đổi tên và dời luôn mục trong registry); `/api/runnable-scripts` (GET = gốc + tự tạo đã duyệt, id tự tạo có tiền tố `custom:`; POST `{id}` duyệt; DELETE `/*` gỡ). Chạy script với id `custom:x` bị từ chối nếu chưa duyệt.
- **Đồng bộ**: mọi thay đổi phát WS `scripts.changed`; `useLive().scriptsVersion` tăng → các hook trong `scriptsData.ts` tự nạp lại, tab Kịch bản cập nhật không cần reload.
- **Chạy nhiều tài khoản**: UI gọi `runScript` song song cho từng tài khoản online (chọn "Tất cả"); khoá UI khi bất kỳ tài khoản trong phạm vi đang chạy. `maxSessions` mặc định nâng lên 15 (settings.json cũ giữ nguyên giá trị đã lưu).
- `LogPanel` (components/LogPanel.tsx) là khung log dùng chung giữa Home và tab Kịch bản.
- **Hàng đợi nhiều kịch bản** (tab Kịch bản): tick nhiều script (số thứ tự hiện cạnh ô tick = thứ tự chạy; menu ⋮ / chuột phải: Chọn, Bỏ chọn, Thêm vào danh sách chạy). Chạy ở **backend**: `POST /api/connections/:id/script/run-queue {scriptIds, vars}` → `GameConnection.runQueue()` chạy tuần tự, giữ trạng thái `running` suốt hàng đợi, `ScriptRunInfo.queue = {index,total,names}` cho badge "Đang chạy (i/n)". Script lỗi (kể cả lỗi parse) → log `[Lỗi kịch bản X] -> Chuyển sang kịch bản tiếp theo...` rồi chạy tiếp; kết thúc `completed` kèm `error: "Lỗi ở k/n kịch bản"` nếu có lỗi. Nút ⏹ Dừng (`stopScript`) huỷ bước dở, bỏ phần còn lại, log "Đã dừng thực thi kịch bản bởi người dùng". Mất kết nối/đăng xuất cũng huỷ cả hàng đợi.

### Giao diện: bảng màu & chữ (styles.css)
- **Token ở `:root`** (dark mặc định, light qua `prefers-color-scheme`), lấy từ báo cáo WS-5000/WS-5051: nền đen-xám ngả lục (`--bg #0e1315`, `--panel #161d20`, `--line #2a3639`), accent xanh ngọc `--accent #4cc3d1`, xanh lá `--ok #4bd2ac`, `--warn`, `--bad`. Mỗi màu trạng thái có `-rgb` và `-soft` để làm nền mờ: dùng `rgba(var(--accent-rgb),.15)`, **không** hardcode hex/slate mới. Chữ trên nền accent dùng `--accent-on`.
- **Font**: Be Vietnam Pro (thân, có đủ dấu tiếng Việt), Roboto Slab (h1/h2), IBM Plex Mono (code/số) — nạp từ Google Fonts trong `index.html`, có fallback hệ thống khi offline. Dùng `var(--sans|--serif|--mono)`.
- Bán kính `--r-sm/--r/--r-lg` = 6/8/12px; focus bàn phím = vòng accent; vẫn giữ nguyên màu ngữ nghĩa của game (HP đỏ, SP xanh dương, EXP xanh lá, vàng/xu, màu hệ).

### Vào Dị giới bị từ chối (`61/01 00 <mã>`)
- Phản hồi của `61/01`: `00` = vào được (rồi server dựng map 49942), `06` = đã ở trong Dị giới, **`02` = HẾT THỜI GIAN Dị giới hôm nay (đã xác nhận bởi người dùng; cần mua Dị giới phù hoặc chờ ngày mai)**, mã khác = từ chối chưa rõ (thấy mã 02 ngày 2026-10-16 18:22 với nhân vật Lv.120 đứng ở map 12001, không trong đội). Khi bị từ chối server **không gửi `02/0a` hay thông báo chữ nào**, chỉ đẩy lại lô đồng bộ (`0f/04`, `0d/06`, `16/04`, `17/04`, `27/09`, `05/04`) và không đổi map. 
- Chuỗi liên quan trong client (`Data/TextData_C.dat`, UTF-16LE): "Thời gian hôm nay đã hết", "Trong tổ đội, không thể vào!", "Không thể vào trong lúc sự kiện", "Thời gian còn lại trong dị giới TS" ⇒ Dị giới có **hạn mức thời gian mỗi ngày** (sự kiện có thể +120 phút/ngày). Bộ đếm `55/01` ứng viên chưa xác định (`0x0a` = 23940/86400, `0x44f` = 18000, `0x1b` = 120 phút online).
- Code: `dijieOpenReply()` trong `tsOnline.ts` báo thẳng ra tab Sự kiện và chặn gửi `61/02` khi bị từ chối. Cần xác nhận: bấm vào Dị giới ở client thật (cap pcap) để biết game báo gì rồi map mã → câu chữ.
