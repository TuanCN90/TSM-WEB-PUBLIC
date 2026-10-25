# TỔNG HỢP KIẾN THỨC VẬT PHẨM & TIỀN TRANG (ITEM & BANK STORAGE KNOWLEDGE)

Tài liệu giải mã cấu trúc gói tin, logic nghiệp vụ và kiến trúc xử lý thùng đồ cho TS-Bot-Web, tham khảo từ reverse-engineering TS Online, SimpleBot, TrueBot, ExtremeBot và NewTS Server.

---

## 1. Cấu Trúc Bản Ghi Vật Phẩm (Item_C.dat & Item.Dat)

Tệp dữ liệu `Data/VN/Item_C.dat` (18.922 bản ghi Việt hoá) và `Data/Item_C.dat` (26.290 bản ghi gốc tiếng Trung):
Mỗi bản ghi tuân thủ định dạng:
```
[u16 length tên][tên UTF-16LE][113 bytes cố định][u16 length mô tả][mô tả UTF-16LE]
```

### Các trường quan trọng trong 113 byte cố định:
- **Byte 0**: Flag header (loại danh mục 1..14)
- **Bytes 1-2**: `itemId` (u16 LE)
- **Byte 9**: Mã loại thuộc tính cộng thêm 1 (Option Stat 1 Type):
  - `210` (0xD2): **ATK** (Công kích)
  - `211` (0xD3): **DEF** (Phòng ngự)
  - `212` (0xD4): **INT** (Trí tuệ / Trí lực)
  - `214` (0xD6): **AGI** (Nhanh nhẹn)
  - `207` (0xCF): **HP** (Sinh lực)
  - `208` (0xD0): **SP** (Nội lực)
  - `218`: **Bạo kích** (%)
  - `219`: **Bội mẫn** (%)
- **Byte 12**: Giá trị thô thuộc tính 1 (Offset 100 $\rightarrow$ `value = raw - 100`):
  - Ví dụ: `102` $\rightarrow$ `+2 DEF` (Thiết Đầu Khôi), `122` $\rightarrow$ `+22 INT` (Sơ Tâm Chi Cân), `90` $\rightarrow$ `-10 AGI` (10 Cân Chì).
- **Byte 16**: Mã loại thuộc tính cộng thêm 2 (Option Stat 2 Type, tương tự Byte 9).
- **Byte 19**: Giá trị thô thuộc tính 2 (Offset 100 $\rightarrow$ `value = raw - 100`):
  - Ví dụ: `103` $\rightarrow$ `+3 AGI` (Sơ Tâm Chi Cân), `102` $\rightarrow$ `+2 AGI` (Sơ Tâm Chi Giáp).
- **Byte 23**: Sprite / Animation / Graphic color index.
- **Byte 24**: Yêu cầu cấp độ (`reqLevel`).
- **Byte 25**: Vị trí trang bị chuẩn (**Equip Slot**):
  - `1`: **Mũ** (Nón / Khăn)
  - `2`: **Áo giáp** (Body Armor)
  - `3`: **Vũ khí** (Weapon)
  - `4`: **Cổ tay** (Hộ uyển / Wrist)
  - `5`: **Giày** (Ngoa / Shoes)
  - `6`: **Đặc thù** (Trang sức / Phụ kiện)
- **Byte 28-59**: 8 khối 4 byte thời gian / timestamp (mặc định `0x1A7DAF1C` = 444444444).
- **Byte 62-65**: Giá trị u32 LE (giá mua/bán NPC bằng vàng `price`).
- **Byte 9 & 16**: Loại thuộc tính (Option Stat Type 1 & 2):
  - `25` (0x19): Lượng **HP hồi phục** tiêu hao (đối với thuốc, thức ăn, bánh bao, trái cây)
  - `26` (0x1A): Lượng **SP hồi phục** tiêu hao (đối với rượu, trà, dược thảo)
  - `207` (0xCF): **Max HP** trang bị
  - `208` (0xD0): **Max SP** trang bị
  - `210` (0xD2): **ATK**
  - `211` (0xD3): **DEF**
  - `212` (0xD4): **INT**
  - `214` (0xD6): **AGI**
  - `218`: **Bạo kích** (%)
  - `219`: **Bội mẫn** (%)
- **Byte 12-13 & 19-20**: Giá trị thuộc tính (u16 LE, Offset 100 $\rightarrow$ `value = raw - 100`):
  - Ví dụ: Thuốc Vận Công (`27136`) type 25, raw = 162 $\rightarrow$ hồi phục **+62 HP**, đơn giá 20 vàng.
  - Ví dụ: Thiên Kim Du (`27138`) type 26, raw = 162 $\rightarrow$ hồi phục **+62 SP**, đơn giá 20 vàng.
  - Ví dụ: Bình Siêu HP (`27167`) type 25, raw = 300 $\rightarrow$ hồi phục **+200 HP**.
  - Ví dụ: Thuốc Song Dược (`27170`) type 25 raw = 350 (**+250 HP**), type 26 raw = 225 (**+125 SP**).
- **Byte 100**: Phân loại thuộc tính item (`106`: Thuốc/Bánh hồi HP, `107`: Trà/Rượu hồi SP).
- **Byte 105-107**: Độ bền trang bị tối đa (Durability).
- **Byte 111-112**: Phân loại hiển thị phụ (`111`: 3=Vũ khí, 4=Phòng cụ; `112`: 1=Mũ, 2=Áo, 3=Tay, 4=Giày, 5=Đặc thù).

---

## 2. Danh Mục Gói Tin Thao Tác Vật Phẩm (Opcode 0x17 & 0x1D)

Trong TS Online, opcode **`0x17`** (decimal 23) là bộ phân phối trung tâm cho toàn bộ tương tác vật phẩm trong túi đồ:

| Thao tác | C->S Opcode | Cấu trúc Payload (Client → Server) | S->C Phản hồi |
|---|---|---|---|
| **Vứt bỏ (Drop item)** | `17/03` | `00 [slot: u8] [qty: u32 LE]` (slot 1..50, qty 32-bit LE số lượng bỏ) | `17/09` / `17/08` (trừ hoặc xoá ô túi) |
| **Mở / Dùng vật phẩm** | `17/0f` | `00 [slot: u8] [qty: u32 LE] [target: u8] 00` (`target`: 0 = Char, 1..4 = Pet) — 8 byte, xem mục 246 | `17/08` (trừ số lượng) + HP/SP đổi |
| **Mặc trang bị (Equip)** | `17/0b` | `00 [slot: u8]` | `17/0b` (danh sách trang bị đang mặc) |
| **Tháo trang bị (Unequip)** | `17/0c` | `00 [equipSlot: u8] [targetBagSlot: u8]` | `17/0b` + `17/08` |
| **Đổi vị trí ô (Move item)** | `17/0a` | `00 [fromSlot: u8] [toSlot: u8] [qty: u8]` | `17/08` cập nhật cả 2 ô |
| **Chế tạo / Hợp lông vũ** | `17/0e` | `00 [slotA: u8] [qtyA: u8] [slotB: u8] [qtyB: u8] [targetSlot: u8]` | `17/09` + `17/08` + `17/0d` |
| **Gửi đồ vào Tiền Trang** | `17/33` | `00 [slot: u8]` | `17/09 [slot]` (xoá túi) + `17/66` (thêm kho) |
| **Rút đồ từ Tiền Trang** | `17/34` | `00 [bankSlot: u8]` | `17/66` (xoá kho) + `17/08` (thêm túi) |
| **Gửi tiền vào Tiền Trang**| `1D/01` | `00 [amount: u32 LE]` | `1D/01` + `1A/02` |
| **Rút tiền từ Tiền Trang** | `1D/02` | `00 [amount: u32 LE]` | `1D/02` + `1A/01` |
| **Đồng bộ kho Tiền Trang** | Server gửi | `17/66` danh sách vật phẩm trong kho | Đọc danh sách ô, item, số lượng |

---

## 3. Logic Auto Quét & Xử Lý Túi Đồ (Auto-Sweep System)

Khi người dùng cấu hình các danh sách tự động theo `accountId` (phân lập độc lập):
- `autoDrop`: Danh sách ID vật phẩm tự động vứt.
- `autoOpen`: Danh sách ID vật phẩm tự động mở / dùng.
- `autoDissolve`: Danh sách ID vật phẩm tự động phân giải.
- `autoContribute`: Danh sách ID vật phẩm tự động đóng góp.
- `autoCombine`: Danh sách ID vật phẩm tự động hợp.

### Cơ chế quét:
1. Mỗi khi server gửi cập nhật túi đồ (`17/05` lúc login hoặc `17/08` sau mỗi trận/nhặt đồ):
2. Engine kiểm tra từng ô trong túi đồ (`bag: ItemSlot[]`).
3. Nếu phát hiện `item.id` nằm trong danh sách kích hoạt:
   - Đưa lệnh xử lý vào hàng đợi có giãn cách an toàn (`debounce` 150-200ms) để tránh tràn socket hoặc dis game.
   - Với **Tự vứt**: gửi gói `17/03 00 [slot: u8] [qty: u32 LE]`. Không có bất kỳ ràng buộc nào về loại vật phẩm (trang bị, khoáng, phù, kèn hạo giác, rác...), chỉ cần khớp `item.id` là vứt bỏ thành công.
   - Với **Tự mở**: gửi gói ĐỦ 8 byte `17/0f 00 [slot] 01 00 00 00 00 00` (gói 4 byte cũ bị server bỏ qua — xem bài học cuối file).
   - Với **Tự phân giải**: gửi gói `59/03 00 01 [slot: u8] [qty: u32 LE]`.
   - Với **Tự đóng góp**: gửi gói `27/0f 00 00 00 00 00 [slot: u8]`.
   - Thực thi tuần tự cho đến khi túi đồ không còn bất kỳ vật phẩm nào thuộc danh sách chỉ định.

### Cơ chế Bộ đếm Thử lại & Reset Trạng thái (`sweepAttempts`):
- Để tránh vòng lặp vô hạn khi gặp vật phẩm khoá, máy chủ từ chối hoặc lag mạng, engine duy trì bộ đếm `sweepAttempts: Map<number, number>` theo ô túi đồ (giới hạn 3 lần thử).
- **Hiện tượng lỗi cũ (False-positive abort):** Đối với các vật phẩm xếp chồng số lượng lớn (ví dụ: x132 Bánh Bao Trắng, x50 Rượu Sake...), mỗi lần cống hiến/vứt server chỉ trừ một phần hoặc từng đơn vị. Việc tăng bộ đếm thử mà không reset khi server phản hồi thành công dẫn đến sau 2-3 mẻ trừ đồ thành công, bot lầm tưởng là lỗi và log cảnh báo dừng auto cho ô đó.
- **Cơ chế tối ưu chuẩn hoá:**
  - Khi nhận gói tin phản hồi thành công từ server (`17/09` trừ đồ, `17/08` cập nhật lại số lượng, `27/15` / `27/16` cống hiến điểm bang, hoặc `59/03` phân giải), engine lập tức reset `sweepAttempts[slot] = 0` và xoá timer chờ.
  - Khi người dùng bấm nút quét lại hoặc cập nhật cấu hình danh sách (`set_item_lists`), toàn bộ `sweepAttempts` được làm mới sạch sẽ, cho phép bot tiếp tục xử lý mượt mà toàn bộ số lượng vật phẩm mà không bao giờ bị dừng oan.

---

## 4. Kịch Bản & Giao Tiếp Tiền Trang Tương Dương

- **Map ID Tiền Trang Tương Dương**: `21261`
- **Cổng thành Tương Dương**: Gate `21001` (Gate index 13 trong `Warp_C.dat`)
- **Lộ trình BFS**:
  - Chặng 1: `teleport_gate 21001` (qua cổng thành)
  - Chặng 2: `warp_door 1` (từ `21001` sang `21002` Quảng trường Tương Dương)
  - Chặng 3: `warp_door 1` (từ `21002` sang `21261` Tiền trang Tương Dương)
- **Khai mở giao dịch Tiền Trang**:
  - Gửi lệnh `click 1` (gói thoại NPC `14/01 00 01 00`)
  - Gửi lựa chọn `send 1` (gói chọn menu `14/09 00 01`)
  - Server kích hoạt giao diện Tiền Trang và gửi gói danh mục lưu trữ `17/66`.

---

## 5. Chi Tiết Cơ Chế & Trạng Thái Thực Thi Của Các Action Khác

### 5.1. Bán vật phẩm (`sell`)
- **Bản chất game:** Trong TS Online, bán vật phẩm là hành động **phụ thuộc vị trí NPC** (Location-dependent). Người chơi **không thể** đứng ở giữa rừng hay trong trận đấu mà bán đồ lấy tiền được.
- **Quy trình chuẩn:**
  1. Di chuyển / Warp đến map có NPC thương nhân (ví dụ Tiệm buôn Trác Quận `12001 -> 12992`, Tiệm buôn Diệp Thành `12061`, v.v.).
  2. Gửi gói thoại NPC: `14/01 00 <npcId LE>` (tương đương lệnh DSL `click <npcId>`).
  3. Gửi lựa chọn mở tiệm bán đồ: `14/09 00 <menuOption>` (tương đương `menu 2`, `send 1`).
  4. Gửi lệnh bán các món đồ theo danh sách: `sell <itemId>`.
- **Trạng thái hiện tại:**
  - Hệ thống đã hỗ trợ lưu trữ danh mục ID cần bán (`sell` trong `ITEM_LIST_KEYS`) độc lập theo từng tài khoản.
  - Danh mục này được thiết kế để tích hợp trong các **Script/Macro tự động** (như kịch bản `10. mua ban hp sp.ini`: sau khi đầy túi thì tự động warp về thành, vào tiệm buôn, bán sạch các item có trong danh sách rồi quay lại bãi train).
  - Không thể chạy ngay trong hàm `autoSweep` tại chỗ như lệnh Vứt bỏ (`17/03`) vì không có NPC thương nhân.

### 5.2. Phân giải trang bị & bí kíp (`resolve_item` / `autoDissolve`)
- **Bản chất game:** Tính năng phân giải trang bị / bí kíp võ tướng dư thừa để lấy Tinh Thể hoặc Nguyên Liệu tinh luyện là tính năng đặc thù của bản TS Mobile (TSM).
- **Opcode giao thức (Xác thực từ pcap `phan_giai_and_dong_gop_item.pcap`):**
  ```
  Client -> Server: 59/03 00 01 [slot: u8] [qty: u32 LE]
  Server -> Client: 17/09 00 [slot: u8] [qty: u32 LE] (xoá/trừ item khỏi túi)
                    59/03 00 00 01 [kết quả & tinh thể nhận được]
  ```
- **Trạng thái hiện tại:** Đã giải mã thành công 100% từ file pcap (thao tác phân giải Bí Cấp Tr.M.Thành ID 51504 tại ô 5), tích hợp hoàn chỉnh vào hàm `autoSweep` và lệnh `resolve_item`.

### 5.3. Đóng góp Bang hội / Quân đoàn (`contribute_item` / `autoContribute`)
- **Bản chất game:** Yêu cầu nhân vật đã gia nhập Quân đoàn (Legion/Guild), mở giao diện Quân đoàn và chọn cống hiến vật phẩm / tài phú cho bang.
- **Opcode giao thức (Xác thực từ pcap `phan_giai_and_dong_gop_item.pcap` và `dong_gop_hp.pcap`):**
  ```
  Client -> Server: 27/0f 00 00 00 00 00 [slot: u8]
  Server -> Client: 17/09 00 [slot: u8] [qty: u32 LE] (trừ item khỏi túi)
                    27/15 00 01 ... (cập nhật điểm cống hiến cá nhân/quân đoàn)
                    27/16 00 00 (xác nhận thành công)
  ```
- **Phân tích thực nghiệm quan trọng về vật phẩm tiêu hao (HP/SP):**
  - File pcap `dong_gop_hp.pcap` đã chứng minh thực tế trong game: Client gửi cống hiến Bánh Bao Trắng (ID 26002, hồi 35 HP) tại ô số 5 bằng gói `27/0f 00 00 00 00 00 05`.
  - Server trả về ngay lập tức: `17/09 00 05 02 00 00 00` (trừ 2 bánh bao), tiếp đó `27/15 00 01 00 00 00 02 68 01 00 00` (+2 cống hiến, tổng điểm 360) và `27/16 00 00`.
  - **Kết luận nghiệp vụ:** Hệ thống Quân đoàn trong TS Online / TS Mobile **cho phép cống hiến cả vật phẩm tiêu hao (HP, SP, Thuốc, Rượu, Bánh bao), trang bị và vật phẩm khác**. Không có bất kỳ ràng buộc nào loại trừ đồ tiêu hao. Hệ thống tự động đóng góp (`autoContribute`) hoạt động 100% dựa trên danh sách ID người dùng chỉ định.

### 5.4. Chế tạo / Hợp vật phẩm (`combine` / `autoCombine`)
- **Opcode giao thức:**
  ```
  17/0e 00 [slotA: u8] [qtyA: u8] [slotB: u8] [qtyB: u8] [targetSlot: u8]
  ```
- **Quy tắc xử lý tự động (Auto-Combine Logic):**
  - Người dùng nhập các `itemId` cần hợp vào danh sách `combine` (phân lập 100% theo tài khoản).
  - Không cần phân biệt ưu tiên (priority), hệ thống quét và khớp linh hoạt 2 trường hợp:
    1. **Case A (Cùng itemId có SL $\ge 2$):**
       - **Trường hợp vật phẩm xếp chồng (stack) chung 1 ô** (ví dụ: Bánh bao 100 cái trong slot 5):
         - Bot dùng chính slot đó ghép với nhau: `slotA = 5, qtyA = 1, slotB = 5, qtyB = 1, targetSlot = 5`.
         - Sau khi server phản hồi, số lượng còn 98 cái; bot tiếp tục quét và tự hợp vòng lặp cho đến khi $\text{SL} \le 1$, hoặc tắt tính năng, hoặc xóa ID khỏi danh sách.
       - **Trường hợp cùng itemId ở 2 ô khác nhau** (ví dụ: slot 10 có 1 cái và slot 14 có 1 cái):
         - Bot ghép `slotA = 10, qtyA = 1, slotB = 14, qtyB = 1, targetSlot = 10`.
    2. **Case B (Hai itemId khác nhau trong list, mỗi loại còn $\ge 1$ item):**
       - Bot tự động ghép chéo 2 loại item với nhau: `slotA` chứa Item 1, `slotB` chứa Item 2.
    3. **Nếu item chỉ còn $\text{SL} \le 1$ và không có item nào khác ghép cặp:** Bỏ qua không xử lý.
- **Xử lý gói tin server phản hồi:**
  - `17/08`: Cập nhật số lượng mới của ô túi đồ.
  - `17/09`: Xóa ô túi đồ khi vật phẩm bị tiêu hao hết hoặc hợp thành món mới.
- **Tính năng Ghép Lông Vũ (`auto_combine_dragon`):** Tạm thời vô hiệu hóa để bảo đảm an toàn trang bị quý.

### 5.5. Mua & Bán Vật Phẩm Với NPC Thương Nhân (Shop Buy/Sell Flow)
- **Nguồn chứng thực PCAP:** File `/Users/user/TS-Bot-Web/captures/ban_item_mua_hpsp.pcap`.
- **NPC và Địa điểm:**
  - Map: `12701` (Quảng trường Hương Dũng quân).
  - NPC Thương nhân: ID `12` tại toạ độ `(990, 470)`.
- **Quy trình 5 bước tự động (`shop_sell_and_buy`):**
  1. **Di chuyển đến Map Hương Dũng (12701):**
     - Bot tự động warp chuyển map hoặc đi qua cửa chuyển map đến `12701`, di chuyển đến toạ độ `(990, 470)` gần NPC 12.
  2. **Mở phiên Bán (Sell Dialogue):**
     - Gửi `20/02 00 08`: Khởi tạo tương tác.
     - Gửi `14/01 00 0c 00`: Nói chuyện với NPC 12.
     - Gửi `14/09 00 1f`: Chọn menu tuỳ chọn 31 (`0x1f` = Bán vật phẩm).
     - Gửi `14/06 00`: Xác nhận mở giao diện bán hàng.
  3. **Thực thi Bán vật phẩm trong danh sách Bán (`lists.sell`):**
     - Opcode Bán:
       ```
       Client -> Server: 1b/02 00 01 [slot: u8] [qty: u32 LE]
       Server -> Client: 17/09 00 [slot: u8] [qty: u32 LE]  (trừ item khỏi ô túi đồ)
                         1a/01 00 [goldDelta: u32 LE]        (cộng tiền vàng nhận được)
       ```
     - Sau khi bán hết vật phẩm khớp danh sách bán:
       - Gửi `14/06 00`: Đóng giao diện bán hàng.
  4. **Mở phiên Mua (Buy Dialogue):**
     - Gửi `20/02 00 08`: Khởi tạo tương tác.
     - Gửi `14/01 00 0c 00`: Nói chuyện với NPC 12.
     - Gửi `14/09 00 1e`: Chọn menu tuỳ chọn 30 (`0x1e` = Mua vật phẩm).
     - Gửi `14/06 00`: Xác nhận mở shop hàng hoá.
  5. **Thực thi Mua HP & SP:**
     - Opcode Mua:
       ```
       Client -> Server: 1b/01 00 [shopSlot: u8] [qty: u32 LE]
       Server -> Client: 17/08 00 [slot: u8] [itemId: u16 LE] [qty: u32 LE] (thêm vào túi đồ)
                         1a/02 00 [goldCost: u32 LE]                         (trừ tiền vàng)
       ```
     - **Danh mục shop NPC 12 Hương Dũng:**
       - `shopSlot = 0`: **Thuốc Vận Công** (Item ID `27136`) - hồi phục +62 HP, đơn giá 20 vàng.
       - `shopSlot = 2`: **Thiên Kim Du** (Item ID `27138`) - hồi phục +62 SP, đơn giá 20 vàng.
     - **Cơ chế Batch Mua An Toàn:** Để tránh vượt quá giới hạn gói tin server khi mua số lượng lớn (tối đa 9999), bot tự động chia nhỏ thành các batch mua tối đa 999 bình/lần kèm delay an toàn 400ms giữa các đợt.
     - **Đóng phiên Mua:**
       - Gửi `14/09 00 28`: Chọn menu tuỳ chọn 40 (`0x28` = Thoát shop).
       - Gửi `14/06 00`: Xác nhận đóng giao dịch hoàn toàn.

---

## 6. Công Tắc Bật/Tắt Độc Lập Cho Từng Action (Action Toggle System)
- Mỗi hành động tự động (`autoOpen`, `combine`, `sell`, `resolve`, `contribute`, `discard`, `exception`) đều có công tắc **BẬT/TẮT** độc lập theo từng tài khoản (`enabled[key]`).
- Khi **TẮT**: Dù túi đồ có nhận được hoặc đang chứa vật phẩm nằm trong danh sách, bot tuyệt đối không quét và không thực thi hành động đó.
- Khi **BẬT**: Bot lập tức kích hoạt bộ quét `autoSweep` để kiểm tra túi đồ hiện tại và xử lý các vật phẩm theo cấu hình.
- Trạng thái công tắc được lưu bền vững trên ổ đĩa (`data/item-lists.json`) và phân lập 100% giữa các tài khoản.

---

## 7. Cơ Chế Tự Động Sử Dụng Vật Phẩm HP/SP Ngoài Trận (Auto-Heal System)

### 7.1. Nguồn Chứng Thực PCAP & Giải Mã Gói Tin Mạng
Dựa trên phân tích gói tin mạng thực tế từ capture `captures/use_hpsp_char_pet.pcap`:

- **Gói Client gửi yêu cầu sử dụng vật phẩm (`17/0f`):**
  - Cấu trúc Payload chuẩn **8 bytes**:
    ```
    Client -> Server: 17/0f 00 [slot: u8] [qty: u32 LE (4 bytes)] [target: u8] 00
    ```
  - **Quy định mục tiêu (`target`):**
    - `target = 0x00`: Sử dụng cho **Nhân vật (Char)**.
    - `target = 0x01` (hoặc index võ tướng): Sử dụng cho **Võ tướng xuất chiến (Pet)**.
  - **Số lượng (`qty`):** Được mã hóa dạng số nguyên 32-bit Little-Endian (4 bytes), cho phép dùng nhiều vật phẩm trong 1 lần gửi.

- **Gói Server phản hồi:**
  - `17/09 00 [slot: u8] [qty: u32 LE]`: Máy chủ trừ số lượng vật phẩm tương ứng trong ô túi đồ.
  - `08/01` (Nhân vật) và `08/02` (Võ tướng): Máy chủ cập nhật chỉ số thuộc tính thời gian thực:
    - Thuộc tính `0x0119` (decimal 281): Điểm HP hiện tại (**Current HP**).
    - Thuộc tính `0x011a` (decimal 282): Điểm SP hiện tại (**Current SP**).

- **Chuẩn hóa mốc cơ sở 100 trong `Item_C.dat`:**
  - Toàn bộ chỉ số hồi phục của vật phẩm tiêu hao trong game TS Online (Thức ăn type 17, Nước uống type 18, Đơn dược type 50, Thuốc bột type 52) được lưu trữ với mốc cơ sở 100:
    ```
    Chỉ_số_thực = raw_stat > 100 ? raw_stat - 100 : 0
    ```
  - Ví dụ giá trị chuẩn sau khi trừ mốc 100:
    - Thuốc Vận Công (`27136`): raw 162 $\rightarrow$ hồi phục **+62 HP**.
    - Thiên Kim Du (`27138`): raw 162 $\rightarrow$ hồi phục **+62 SP**.
    - Thương Dược (`27004`): raw 125 $\rightarrow$ hồi phục **+25 HP**.
    - Thuốc Hồng Hoa (`27037`): raw 125 $\rightarrow$ hồi phục **+25 SP**.
    - Xôi (`26001`): raw 110 $\rightarrow$ hồi phục **+10 HP**.

---

### 7.2. Thuật Toán Lựa Chọn Vật Phẩm (Ưu Tiên Chỉ Số Thấp Nhất)
- **Thiết lập mốc kích hoạt:** Cho phép người dùng nhập ngưỡng phần trăm từ $1\% \le X, Y \le 99\%$ độc lập cho cả HP và SP của Nhân vật và Võ tướng.
- **Tính toán lượng điểm thiếu hụt:**
  $$\text{thresholdVal} = \left\lceil \frac{\text{max} \times \text{thresholdPct}}{100} \right\rceil, \quad \text{needed} = \text{thresholdVal} - \text{cur}$$
- **Nguyên tắc ưu tiên:**
  - Lọc tất cả vật phẩm hồi phục tương ứng đang có trong thùng đồ cá nhân.
  - Sắp xếp tăng dần theo chỉ số cộng: $\text{eff}_A - \text{eff}_B$. Vật phẩm có lượng hồi phục thấp nhất sẽ luôn được ưu tiên sử dụng trước.
  - Tính toán số lượng cần dùng: $\text{needQty} = \lceil \text{needed} / \text{eff} \rceil$, $\text{useQty} = \min(\text{item.qty}, \text{needQty})$.
  - **Dừng lại ngay lập tức** khi chỉ số đạt mốc cấu hình ($\text{needed} \le 0$), không dùng dư thừa gây lãng phí thuốc.

---

### 7.3. Các Sửa Đổi Cốt Lõi & Cơ Chế An Toàn (Anti-Recursion, State Sync & Cooldown)

Nhằm khắc phục triệt để các rủi ro treo đúp gói tin, spam thuốc ngoài ý muốn và vòng lặp vô tận, hệ thống đã áp dụng 3 cơ chế an toàn trọng yếu:

#### 1. Triệt tiêu hoàn toàn vòng lặp phản hồi đệ quy:
- **Nguyên nhân tiềm ẩn:** Khi bot dùng thuốc, server gửi gói `17/09` trừ số lượng vật phẩm trong túi. Nếu hàm `emitBag()` tự động gọi lại `this.triggerAutoHeal()`, mỗi lần trừ thuốc sẽ kích hoạt thêm một chu kỳ quét mới trong khi chỉ số HP/SP chưa kịp nhận gói phản hồi từ server, dẫn đến vòng lặp đệ quy spam sạch thuốc trong túi.
- **Giải pháp:** Loại bỏ hoàn toàn lời gọi `this.triggerAutoHeal()` ra khỏi `emitBag()`. Khi túi đồ thay đổi số lượng (do trừ thuốc, vứt đồ, gửi kho...), bot chỉ cập nhật giao diện túi đồ, **tuyệt đối không được kích hoạt lại auto-heal**.

#### 2. Cập nhật ngay lập tức HP/SP State (Optimistic / Immediate State Sync):
- **Cơ chế:** Khi bot gửi lệnh sử dụng thuốc (`17/0f`), giá trị hồi phục (`healedAmount = useQty * item.eff`) được cộng trực tiếp ngay vào bộ nhớ trạng thái:
  - Nhân vật: `this.player.hp/sp.cur += healedAmount`.
  - Võ tướng: `this.pet.hp/sp.cur += healedAmount` và `roster.hp/sp += healedAmount`.
  - Đồng thời đẩy ngay `this.io.patchState()` và `this.publishPets()` lên Web UI.
- **Lợi ích:** Nhờ cập nhật tức thì, nếu có bất kỳ lệnh kiểm tra nào kế tiếp (hoặc thao tác thủ công từ người dùng), bot đã nhận diện đầy đủ số HP/SP mới và dừng lại ngay lập tức khi đã đạt mốc cấu hình, không bị trễ phụ thuộc vào thời điểm server trả về gói `08/01` / `08/02`.

#### 3. Cơ chế khóa Re-entrancy & Cooldown an toàn:
- **Khóa Re-entrancy:** Kích hoạt biến cờ `this.autoHealRunning = true` trong khối `try ... finally` để ngăn chặn hoàn toàn việc gọi đè nhiều luồng cùng lúc từ các sự kiện mạng khác nhau.
- **Cooldown an toàn 3 giây:** Thiết lập điều kiện kiểm tra thời gian giãn cách tối thiểu 3 giây giữa các lần quét tự động:
  ```ts
  const now = Date.now();
  if (!manual && now - this.lastAutoHealAt < 3000) return;
  ```
- **Thời điểm kích hoạt Auto-Heal hợp lệ:**
  - Tự động kích hoạt sau khi kết thúc trận đấu (`battleEnd`).
  - Định kỳ theo chu kỳ Auto-Sweep mỗi 60 giây.
  - Khi người dùng bấm nút thủ công "⚡ Quét HP/SP ngay" hoặc lưu cấu hình mới.

---

### 7.4. Phân Lập Đa Tài Khoản Tuyệt Đối (Rule 2) & Cấu Trúc Giao Diện
- **Cấu hình độc lập 100%:** Cấu hình `autoHeal` được lưu trữ dưới khóa chuẩn hóa `canonicalKey(accountId)` trong tệp `data/item-lists.json`. Việc điều chỉnh mốc HP/SP ở tài khoản này tuyệt đối không ảnh hưởng đến bất kỳ tài khoản nào khác.
- **Giao diện Tab con:** Tích hợp trực tiếp dưới dạng Tab con `"💊 Sử Dụng Vật Phẩm (HP / SP)"` trong Tab lớn `"⚙️ Cấu hình Chung"`, sẵn sàng mở rộng các tính năng cấu hình chung khác trong tương lai.

## Bài học: Tự động mở phải gửi ĐỦ gói `17/0f` (8 byte)
Gói DÙNG VẬT PHẨM (`17/0f`, pcap `use_hpsp_char_pet`) là `00 <ô> <số lượng u32 LE> <đích: 0 nhân vật / 1 võ tướng> 00` (8 byte payload). Bản cũ của **Tự động mở** chỉ gửi `00 <ô> 01 00` (4 byte) ⇒ server bỏ qua im lặng (không có phản hồi `17/xx`, túi không đổi) ⇒ log "Đã thử 3 lần không thành công… tạm dừng auto" với MỌI vật phẩm trong danh sách tự mở (gặp ở Phó Bản Cấp 20 II, id 46921 — túi phúc từ phó bản Thảo Phạt Thiên Sư). Đã sửa: tự mở gửi `00 <ô> 01 00 00 00 00 00`; test `bag.test.ts` kiểm tra wire cùng định dạng với gói trong pcap. Nếu vẫn không mở được thì kiểm tra túi đầy (server từ chối) hoặc cần số lượng/đích khác.

## Bài học: `17/05` luôn là TÚI ĐỒ, không phải kho Tiền Trang
Sau khi dùng/mở vật phẩm (vd tự mở Phó Bản Cấp 20 II), server gửi lại `17/05` với `f[9] = 01` (kèm `17/09` trừ 1 ô, `17/95`, `17/97`). Nội dung chính là TÚI ĐỒ (ô 1 = 46285, ô 2 = 46921 giảm dần 9→8→7…, 20 ô). Bản cũ coi `f[9] ≠ 0` là kho Tiền Trang ⇒ chép nhầm túi vào kho: log "🏦 Đã mở kho Tiền Trang: 20 ô vật phẩm" mỗi lần mở, và UI Tiền Trang hiện 19/60 dù chưa gửi gì. Đã sửa: mọi `17/05` ⇒ `bagList`. Kho thật chỉ về qua `1d/09` + `1e/01` (pcap `dong_gop_hp`, `PCAP nhap xuat item tien trang`). Test: `bag.test.ts` dùng đúng frame thật (`fixtures/bag-refresh-type1.json`). Lưu ý: `17/66` vẫn được coi là danh sách kho nhưng CHƯA có pcap xác nhận.

