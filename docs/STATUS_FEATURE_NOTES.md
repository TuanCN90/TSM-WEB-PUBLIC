# Ghi chú kiến thức: Trạng thái nhân vật / võ tướng (TẠM HOLD)

Tình trạng 16–17/10: code đọc dữ liệu + popup đã có (General → "Trạng thái nhân vật", popup "Võ tướng xuất chiến"); phần còn thiếu ghi bên dưới. Test: `packages/engine/test/general.test.ts` (frame lấy từ cap).

## 1. Đã xác nhận (✅)
| Dữ liệu | Gói | Ghi chú |
|---|---|---|
| Danh sách võ tướng | `0f/08` (login): `00 | count | bản ghi` | Bản ghi dài 254 + độ dài tên Big5: `idx u8 · model u16 · exp u32 · level u8 · HP u32 · SP u16 · 6×u16 chỉ số GỐC · … · byte27 = fai (trung thành) · byte31 = len tên · tên · 6 ô trang bị 37B` |
| 6 chỉ số gốc võ tướng | trong `0f/08` | **thứ tự `int, atk, def, agi, hp, sp`** (Ma Quan Vũ 66/189/89/102/85/60 khớp client) |
| Võ tướng xuất chiến | `13/04` (login), `13/01` (xác nhận) | `00 <model u16>`; chỉ 1 pet xuất chiến |
| Xuất chiến pet | C→S `13/01 00 <model>` | server echo `13/01` |
| Hệ võ tướng | KHÔNG có trong packet | tra `Npc_C.dat` (u8@50 đuôi bản ghi) → `npcElements.json`; 1 Địa·2 Thủy·3 Hỏa·4 Phong·8 Ám ✅, 5 Tâm·7 Quang 🟡 |
| Điểm cộng từ **trang bị** | `08/01` (nhân vật), `08/02 00 04 <idx> 00 <mã> <u32>` (võ tướng) | mã `0x1d2` atk · `0x1d3` def · `0x1d4` int · `0x1d6` agi (hp/sp không có). acc01: 50/29/46/27 |
| Point (điểm tiềm năng) | `05/03` u16@abs35 | 238 khớp tool gốc |
| Trang bị đang mặc (nhân vật) | `17/0b`: `00 | count | count×35B [itemId u16…]` | thứ tự ô: mũ/khăn, giáp, vũ khí, hộ uyển, giày |
| HP/SP/level/exp nhân vật | `05/03` | HP cur u32@10, SP cur u32@14, level u8@28, exp u32@29, HP max u32@46, SP max u16@50 |

Công thức hiển thị của client (tool gốc): `[Gốc] + [Trang bị] + [Bonus] = [Tổng]`. Ví dụ Ma Quan Vũ: INT 66+46+12=124, ATK 189+50+24=263, DEF 89+29+0=118, HP 85, SP 60, AGI 102+27+6=135; Bạo 0, Bạo kích 50, Né 0.

## 2. Chưa tìm thấy (❌)
- **Bonus (thẻ sưu tầm)**: MQV +12 int, +24 atk, +0 def, +6 agi; tổng của 2 bộ thẻ sở hữu, cộng cho nhân vật và MỌI võ tướng. Client KHÔNG gửi gói nào khi mở màn Sưu tầm/Trạng thái ⇒ dữ liệu có sẵn từ login nhưng chưa xác định gói. Đã loại trừ: `55/01` (counters), `17/05` (túi), `7b/01` (89 mục, toàn 0), `5f/09`, `5f/0a`. Nghi: `5f/04` (168 byte = số bộ thẻ `CollectStyle_C.dat`; ở tài khoản acc02 là bitmask `15 10 10 1f` = thẻ sở hữu mỗi bộ; ở acc01 toàn 0 ⇒ kết quả khó hiểu, cần đối chiếu thêm).
- Bảng thẻ nằm trong `tool-reference/BOT TSM/Data/`: `CollectStyle_C.dat` (168 bộ × 32B: id u16 · res u32 · 5 id thẻ u16 · u32 · 6×u16 chỉ số bộ), `CollectCard_C.dat` (59 thẻ × 61B), `CollectStyleValue_C.dat` (43 mốc điểm → thuộc tính 27..32). Chỉ số 6 số của một bộ (vd 3,3,3,2,3,6) cộng 2 bộ KHÔNG ra được 12/24/0/6 ⇒ công thức/ánh xạ chưa rõ.
- **Gốc & Bonus của nhân vật** (6 chỉ số): chưa biết vị trí trong `05/03`.
- Bạo / Bạo kích / Né % (có thể ở `4f/08`: các mã 0x1cf..0x1d4?), chưa đối chiếu.
- Opcode **cộng điểm** (nút +) và **thay trang bị**: không có trong script/DSL/tool-reference ⇒ cần cap. Gói **Nghỉ** của võ tướng: cần cap.
- Item_C.dat: chỉ số cộng của trang bị Sơ Tâm không nằm trong 113 byte cố định (ô thuộc tính để giá trị lọc `0x1A7DAF1C`); số trang bị lấy từ `08/01`/`08/02`, không tính từ bảng item.

## 3. Cần để làm tiếp
1. Số liệu tool gốc cho nhân vật: 6 chỉ số Gốc / Trang bị / Bonus / Tổng (ảnh hoặc chép).
2. Màn **Sưu tầm → Thẻ → lọc bộ đã sở hữu**: tên 2 bộ + chỉ số từng bộ (tra id trong `CollectStyle_C.dat`, rồi tìm id trong gói login).
3. Chỉ số thực của Ba Đậu Yêu (acc01) để kiểm tra bonus thẻ có chung cả đội không.
4. Cap: cộng 1 điểm vào chỉ số; đổi 1 món trang bị; cho võ tướng nghỉ.

## 4. Liên quan (đã xong, xem `game_actions_knowledge.md`)
Exp Offline (57/03 bảng giá, 54/01 hỏi giá, 54/02 nhận Free; Xu/Vàng chưa có gói mua), Nhận quà thư (53/xx), Xuất chiến pet.
