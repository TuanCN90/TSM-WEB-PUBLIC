# PHÓ BẢN ĐỘI — KIẾN THỨC & LOGIC XỬ LÝ (bản tổng hợp)

> Tab con **🏰 Phó bản đội** (tab Kịch bản). Tài liệu này là nguồn sự thật duy nhất cho tính năng: giao thức, mô hình điều phối, flow từng phó bản, **bài học từ log/pcap thật**,
> playbook debug. Sửa logic phó bản ⇒ đọc §4 (checklist bắt buộc) và §7 (bài học) **trước**. Liên quan: `docs/PARTY_KNOWLEDGE.md` (đội ngũ 0d/xx).
>
> **Trạng thái (2026-10-21)**: **Thảo Phạt Thiên Sứ đã HOÀN THÀNH end-to-end** (tạo phòng → thành viên Tìm Đội → bắt đầu → cổng 1/2/3 → Trương Giác → thắng → hoàn thành).
> **Ngày Tàn Hoạn Quan**: đã giải mã từ pcap hoàn thành (`phobandoi_02_chupt_hoantat`) và cài; **chưa chạy thử live trên bot**.
>
> Code: protocol `packages/protocol/src/index.ts` (`DungeonTeamConfig/State`, `DUNGEON_ROOM_CATALOG`, `DungeonRoomState/Info`, `BattleUnit.owner`) ·
> engine `transport/socket/codecs/dungeonRoom.ts` (gói phòng + `DungeonRoomTracker`) + `tsOnline.ts` (`dungeonRoomAction`, `awaitEncounter`, `npcInteract`, `requestNpcList`, `ackDialog`, `click_boss`, `warp_id`) + `runtime/liveActions.ts` (`dungeon_room_*`, `dungeon_exit`) ·
> server `services/dungeonTeam.ts` (điều phối), `services/store.ts` (`DungeonTeamConfigStore` → `data/dungeon-team-configs.json`, khoá `canonicalKey`), REST trong `server/src/index.ts` ·
> web `apps/web/src/pages/DungeonTeam.tsx` (+ CSS `.dt-*` trong `styles.css`; card thường KHÔNG có gap, phải dùng grid riêng) ·
> test `engine/test/dungeon-room.test.ts` (+ `fixtures/battle-team-member.json`), `server/test/dungeon-team.test.ts`.

---

## 1. Nguồn tham khảo
- **TSM** (`tool-reference/BOT TSM/Script`): `Config/auto thao phat thien su.ini`, `Config/auto ngay tan hoan quan.ini` (+ `auto dai chien lu bo`, `auto hoa thieu boc duong`, `auto tan cong giang dong`); gói thô XOR 0xAD trong `Timer/NhiemVuNgay*.ini`, `9cung0Boss.ini` (`packet 6d3c…`). TSM KHÔNG có bước xử lý hội thoại riêng (bot gốc bật `auto 1` tự đáp thoại/đánh); NPC có lựa chọn thì dùng `menu n`/`send n`. `dungeon <stage> <diff>`/`start_dungeon` là **phó bản tuần** (gói khác, chưa pcap) — không phải phòng đội.
- **Pim-Bot** (PimBot.exe, tên THẬP PHÂN: `_47_02` = `2f/02`): `CreateRoomDungeon`, `JoinDungeon`, `PhoBanDoi_ThienSu/NgayTanHoanQuan/KhieuChienLuBu/HoaThieuBocDuong/TanCongGiangDong`, `WaitPartyLeaveBeforeDungeonJoin`… **Không có dữ liệu lộ trình** (chỉ tên hàm).
- **Dữ liệu game đã có**: `doorCoordinates.json` (toạ độ cửa nội bộ từng map), `doors.json`, `mapNames.json` — map `62002` Thảo phạt thiên sư, `62011` Ngày tàn của Thập Thường thị, `62012` Đại chiến Lữ Phụng Tiên, `62013` Hỏa thiêu Phục Dương, `62014` Bình định Giang Đông, `62016` Kế Trảm Xa Trụ.
- **Pcap**: `chupt_pbteam` (chủ phòng: tạo/huỷ/bắt đầu), `member_join_pbteam` (thành viên: list/join/ready), `chupt_phoban01` (chủ phòng đi cổng, trận cuối CHỦ ĐỘNG THUA), **`completed_phoban_khanvang_chupt` (hoàn thành — chuẩn nhất)**.

## 2. Giao thức (✅ = có pcap)
Khung: `6d 3c | len | 00 00 | cmd | sub | payload` (payload bắt đầu `00`), wire = body XOR 0xAD từ byte 2.

### 2.1 Phòng (opcode 0x2f)
| Hướng | cmd/sub | Payload | Ý nghĩa |
|---|---|---|---|
| C→S | `2f/01` | `00` | làm mới danh sách phòng ✅ |
| S→C | `2f/01` | `00 <n> {00 <roomId u32> <len><tên Big5> <uid chủ 8> 00 <dungeonId> 00 <số người>}×n` | danh sách phòng; byte cuối = số người trong phòng (1 = chỉ chủ) ✅ |
| C→S | `2f/02` | `00 <id> 00 <pw>` | TẠO phòng; id 1 = Thảo Phạt Thiên Sứ, 14 = Ngày Tàn Hoạn Quan (TSM); pw 01 có mật khẩu / 00 không ✅ |
| S→C | `2f/02` | `00 <code> <len> <mật khẩu>` | kết quả; có mật khẩu ⇒ server CẤP mã (vd "4010") ✅ |
| C→S | `2f/03` | `00 <roomId u32> <lenPw>` | VÀO phòng (không mật khẩu lenPw=00 ✅; layout có mật khẩu `len+ascii` là suy ra) |
| S→C | `2f/03` | `00 <code> <roomId> 01 <uid chủ> …` | vào được (code 00); từ chối là gói NGẮN `00 <code>` (code 03 = còn ở phòng cũ) ✅ |
| C→S | `2f/0b` | `00` | bật/tắt SẴN SÀNG (S→C `2f/0b 00 <uid> 01|00`) ✅ |
| C→S | `2f/0c` | `00` | BẮT ĐẦU (chủ phòng) ⇒ `29/0c`+`0c/00` đổi map phó bản ✅ |
| S→C | `2f/0c` | `00 00 01 00 03 …` | **phó bản HOÀN THÀNH** (sau thắng trận cuối) ✅ |
| C→S | `2f/0a` | `00` | HUỶ phòng / chủ rời phòng ✅ (thành viên rời phòng: suy ra, dùng khi mã 3) |
| S→C | `2f/0a` | `00 <uid> <st>` | 00 = đã huỷ, 03 = đã rời/kết thúc ✅ |
| S→C | `2f/0d` | `00 <uid> <len><tên> …` | một thành viên vừa vào phòng (kèm ngoại hình) ✅ |
| S→C | `2f/10`, `2f/12` | — | thông báo phụ (đếm giờ/đồng bộ), bot chỉ log |
- **Thoát/rời phó bản**: `0d/04 00 <uid mình>` (rời đội) ⇒ cả đội về map cũ (`0c/00`, `2f/0a st=03`) ✅. Bot: action `dungeon_exit` (không kiểm tra đang trong đội).

### 2.2 Trong map phó bản
| Hướng | cmd/sub | Ý nghĩa |
|---|---|---|
| C→S | `14/08 00 <N> 00` | bước qua cổng nội bộ N (KHÔNG đổi map; server đáp chuỗi thoại). Nhận = `06/02`+`14/01`; từ chối = `14/08 00 xx` (`23`) ✅ |
| C→S | `0c/01 00` | **"làm mới trạng thái": server mới gửi `16/04` (danh sách NPC của map) + `0d/06` roster đội + `0d/0b`** — client thật gửi ~0.35s sau cổng 1 ✅ |
| C→S | `20/02 00 08` + `14/01 00 <idx NPC> 00` | bấm NPC (luôn đi cặp, cách ~5ms) ✅ |
| S→C | `14/01 00 00 00 00 <idx> <loại> 03 <id> …` (len 24) | một câu thoại/sự kiện; client đáp `C→S 14/06 00` thì câu kế mới tới ✅ |
| S→C | `16/03 00 <idx> 00 d0 07` + `14/10 00` | kết quả từng người sau trận; mỗi `16/03` cần ĐÚNG 1 ack ✅ |
| S→C | `14/0d 00` | báo hết một đoạn (hết trận / hết chuỗi) — cần 1 ack ✅ |
| S→C | `14/08 00 2a` | chuỗi đã chốt (thành công); `26` = ack thừa ("không có gì chờ"); `27` = đáp thoại NPC bị từ chối ✅ |
| S→C | `0b/fa` + `0b/05`… + `14/09` | vào trận; `34/01` mỗi lượt; engine tự đánh |
| C→S | `06/01 00 <dir> <x u16> <y u16>` | di chuyển (dir 6 = phải, 7 = lên-phải; bước ~80px/~430ms; server dung sai rộng) ✅ |
- `0b/05`: `f[10]` = loại (`02` nhân vật người chơi khác — uid @11; `04` võ tướng — **uid chủ @21**; `07` quái); row/col @29/@30. `0b/fa` (len ~553) = bản ghi nhân vật CỦA MÌNH rồi nối đồng đội.
- KHÔNG gửi `14/09` đoán mò (không có menu ⇒ server đáp `14/08 00 01` rồi **kick mã 5**).

## 3. Thiết kế điều phối (`services/dungeonTeam.ts`, nhịp 2s)
**Chủ phòng = 3 nút** (`POST /api/accounts/:id/dungeon-team/create|start|cancel`; `exit` cho mọi tài khoản):
1. **🏗 Tạo**: `warping` (về **cổng thành tương đương** `gateForMap` — chờ hết trận nếu đang đánh — để tránh trận quấy nhiễu) → `waiting_members`(không chặn) → `leaving_party` (nếu bật) → `creating_room` (`dungeon_room_create`, chờ S→C 2f/02; lỗi 3 lần ⇒ dừng) → `room_open` (**không tự bắt đầu**; hiện mật khẩu server cấp).
2. **▶ Bắt đầu**: sáng khi `membersOk`: **ô tên thành viên TRỐNG ⇒ bắt đầu ngay để đi solo** (phó bản không quy định số người); **có tên ⇒ chờ đủ**: bot trên web phải đã join+sẵn sàng; thành viên ngoài web thì chủ làm mới danh sách phòng (`2f/01`, ≥4s) đếm số người phòng MỚI NHẤT của mình ≥ 1 + số tên. Rồi `starting` (2f/0c, chờ vào trận/đổi map ≤60s) → `in_dungeon`.
3. **✖ Hủy**: `2f/0a` nếu đã tạo phòng, xoá phiên. **🚪 Thoát phó bản**: dừng script + `dungeon_exit`.
- `PUT dungeon-team-config` bỏ qua `enabled` của chủ phòng (phiên chỉ do 3 nút điều khiển). Cấu hình theo `canonicalKey`.

**Thành viên — nút 🔎 Tìm Đội** (loại phó bản + tên chủ + mật khẩu nếu chủ ngoài web): `searching` (rời đội nếu bật; chủ là bot ⇒ về cùng cổng thành) → mỗi 4s `dungeon_room_join` = làm mới danh sách → chọn **phòng MỚI NHẤT có đúng tên chủ + loại** (bỏ qua phòng cũ/phòng khác) → `2f/03` → chờ S→C → `dungeon_room_ready` (2f/0b) → "✔ đã vào & sẵn sàng". Mã 3 ⇒ `2f/0a` rời phòng cũ rồi vào lại 1 lần; không thấy phòng 180s ⇒ lỗi. Trong phó bản thành viên **KHÔNG chạy script/di chuyển/đối thoại** — chỉ đánh trận (engine tự đánh; chỉ ra lệnh cho đơn vị CỦA MÌNH theo `owner`) và `sync_state` một lần khi vào map.

**Trong phó bản — CHỈ chủ phòng chạy checkpoint** (`DungeonRoomDef.steps`, mỗi checkpoint một script `phoban-doi-<id>-<n>`):
- Đội = đội ngũ ở tab thông tin chung (roster `0d/06`). Chụp đội lúc bắt đầu checkpoint đầu (roster ∪ thành viên khai báo đang online); **trước mỗi checkpoint và giữa hai trận**, thiếu thành viên (bot mất kết nối/đang nối lại, hoặc rời roster) ⇒ chủ **DỪNG** (dừng script đang đi bộ, không đụng khi đang trong trận) cho tới khi đủ lại hoặc bấm Thoát.
- Checkpoint lỗi ⇒ dừng hẳn; dừng giữa chừng ⇒ chạy lại (≤3 lần, cách ≥15s); không chạy chồng.
- Xong checkpoint cuối: chờ server đưa team ra (theo người chơi: tự warp về map mặc định); **30s sau vẫn ở phó bản** ⇒ chủ gửi `dungeon_exit` một lần (pcap: chủ rời đội `0d/04` ~2s sau chốt).
- "Xong" = rời map phó bản (map ≠ `DungeonRoomDef.map`) hoặc `2f/0a st=03`.

## 4. CHECKLIST BẮT BUỘC cho mọi phó bản (đã trả giá bằng nhiều vòng debug)
1. **Sau cổng 1 gửi `0c/01 00`** (~350ms) và chờ `16/04`: không có thì server không gửi danh sách NPC/roster ⇒ NPC "chưa hiển thị" ⇒ đáp thoại NPC bị `27`. (Engine: `requestNpcList` sau `warp_id` khi `mapNpcs` rỗng; trước `click`/`click_boss` nếu NPC chưa có.)
2. **Bấm NPC = `20/02 00 08` rồi `14/01 00 <idx>`**.
3. **Ack `14/06 00` đúng MỘT cho mỗi gói thoại/kết quả** (`14/01` len 24, `16/03`, `14/0d`); nhận `14/08` thì HUỶ ack đang xếp hàng; watchdog chỉ canh khi server im lặng ≥3s (≤3 lần rồi tự đóng cờ trận). Ack thừa ⇒ `14/08 00 26`, nghi làm lệch trạng thái thoại.
4. Ack câu thoại NPC trễ ~1.2s (pcap 1.17s/1.04s); các câu chuỗi cổng/kết quả ack ~0.45s là đủ.
5. Cổng nội bộ **không đổi map** ⇒ "đã nhận" = `06/02`/câu thoại `14/01` (không phải `0c/00`); gửi lặp cổng ⇒ **kick mã 13**. Lệnh `warp_id` lặp y hệt trong 8s bị bỏ qua (TSM viết 2 dòng giống nhau để bù trận chen ngang).
6. Sau khi nhận cổng/NPC phải **chờ trận bắt đầu (≤40s) → chờ hết trận (`14/08 2a`) + chuỗi kết quả** rồi mới sang bước kế; chờ trận giới hạn 5 phút.
7. Đứng điểm như client thật rồi **gửi lại vị trí 3 lần (~430ms)** và chờ trước khi bấm boss; **NPC cuối cần ~12s sau `14/08 2a` của chặng trước** mới tương tác được.
8. Đi bộ tạm dừng khi đang trong trận (gói di chuyển vô hiệu và dễ bị kick).
9. Chỉ ra lệnh cho đơn vị **của mình** trong trận (owner uid) — nếu không thành viên không có võ tướng bị kick **mã 42**.
10. Không gửi gói đoán mò lên server thật; thiếu pcap ⇒ chặn + ghi rõ trong UI/docs.

## 5. Thảo Phạt Thiên Sứ (map 62002, id 1) — flow đã xác nhận
Cổng nội bộ (`doorCoordinates.json`): 1=(50,780) (spawn (50,800), nhấn ngay), 2=(470,700) (client nhấn từ (550,690)), 3=(730,560) (nhấn từ (710,550)); cổng 5 → map 12003 (thoát). Mỗi cổng: 9 câu thoại → trận → `14/0d` → chuỗi kết quả (cổng 3 dài: 7×`16/03` + câu + 9 câu) → `14/08 2a`. Steps: `Cổng 1`, `Cổng 2`, `Cổng 3` (`warp_id N,62002,x,y` ×2) và `Trương Giác`: `click_boss 20,62002,650,390` → đứng (650,390) (cách NPC (590,340) ~78px), gửi lại vị trí ×3, chờ ≥12s sau `2a`, `20/02`+`14/01 00 14 00` → câu 1 (ack ~1.2s) → câu 2 (~1.0s) → `0b/fa` trận cuối → thắng ⇒ `14/01 …64 5d` → 10 ack (9×`16/03`+câu) → câu `…65 5d` → **`2f/0c` (hoàn thành)** + `14/0d` → ack → `14/08 2a`. `click_boss` bấm lại ≤3 lần (chờ thêm 8s mỗi lần) rồi báo lỗi.

## 6. Ngày Tàn Hoạn Quan (map 62011, id 14) — ĐÃ GIẢI MÃ từ pcap hoàn thành `phobandoi_02_chupt_hoantat.pcap`
- Tạo phòng `2f/02 00 0e 00 00` (không mật khẩu) ✅; phòng/Tìm Đội/bắt đầu như §3. Sau bắt đầu: `29/0c`+`0c/00` map 62011 vị trí (330,2940); client gửi `0c/01` ~1.1s sau (→ `16/04` 34 NPC + `0d/06` roster) — leader bot gửi `sync_state` ~1s sau khi vào phó bản.
- **4 chặng, mỗi chặng: đứng ở điểm cap → bấm NPC (`20/02`+`14/01`) → thoại → trận → chuỗi kết quả → (cổng)**:

| Chặng | Điểm đứng → NPC | Cổng (điểm nhấn) | Kết quả cổng |
|---|---|---|---|
| 1 | (470,2930) → NPC **1** (3 câu thoại) | cổng **2** @(550,2850) | DỊCH CHUYỂN: `29/0c`+`0c/00` → (1530,2070), không thoại/trận |
| 2 | (470,1970) → NPC **5** (2 câu) | cổng **4** @(110,1910) (client gửi `14/04 00 04 00` trước, server đáp `14/08 23`, không cần) | dịch chuyển → (630,750) |
| 3 | (670,390) → NPC **20** (2 câu) | cổng **8** @(1070,670) | cổng 8 mở chuỗi thoại 9 câu → TRẬN dài (~45s) → kết quả (không đổi vị trí) |
| 3b | — | cổng **6** @(1228,794) | dịch chuyển → (2290,530) |
| 4 | (2610,290) → NPC **31** | — | trận cuối → `2f/0c` S→C (`00 00 0e 00 03 …`, hoàn thành) + `14/0d` + `14/08 2a` |
- Mỗi lần bấm NPC client đứng yên gửi lại vị trí 3 lần (~430ms) trước khi bấm (như Thiên Sứ). Khoảng chờ từ chuỗi cuối tới lúc bấm NPC trong pcap: 3.4–8s (bot chờ tối thiểu 3s kể từ sự kiện chuỗi cuối; tham số `click N,map,x,y,<giây>` đổi được).
- Steps trong `DUNGEON_ROOM_CATALOG` dùng `click N,map,x,y` (dạng phó bản: 3× vị trí → chờ → NPC list nếu thiếu → `20/02`+`14/01` → đáp thoại ~1.2s → trận → kết quả; bị từ chối `27`/không phản hồi ⇒ chờ 8s bấm lại ≤3 lần) và `warp_id N,map,x,y` (đi tới điểm nhấn rồi cổng; **cổng dịch chuyển (chỉ 0c/00, không thoại) ⇒ xong sau ~1.2s, không chờ trận**; cổng có thoại ⇒ chờ trận + kết quả).
- Tracker: S→C `2f/0c` ⇒ `dungeonRoom.status = completed` ⇒ chủ phòng dừng mọi checkpoint còn lại và ghi "✅ Phó bản đã hoàn thành" (thoát dự phòng 30s như Thiên Sứ).
- ✅ Đã kiểm chứng live (2026-10-22): bot chạy trọn 4 chặng và hoàn thành Ngày Tàn Hoạn Quan (sau khi sửa ack 14/07 ở §9).

## 7. Bài học / mã lỗi đã gặp
| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| Chủ phòng không tạo được phòng khi có tên thành viên | bản cũ chặn khi thiếu gói join | chủ phòng KHÔNG bị chặn bởi thành viên |
| "Server không trả lời gói vào phòng" | gói từ chối NGẮN `2f/03 00 03` bị bỏ sót | tracker nhận len ≥10; mã 3 ⇒ rời phòng cũ |
| Script chết ngay ở dòng đầu | codec thiếu `auto`, `await_battle` | `auto` đổi cờ autoFight; `await_battle` chờ trận bắt đầu/kết thúc |
| Kick **mã 13** ở cổng 1 | gửi lặp cổng vì tưởng chưa nhận (cổng không đổi map) | nhận cổng bằng `06/02`/`14/01` |
| Kick **mã 5** | gửi `14/09 00 01` khi không có menu | bỏ hẳn |
| Kick **mã 42** của thành viên | ra lệnh võ tướng đồng đội (`0b/05` không phân owner) | `BattleUnit.owner` |
| Đứng yên sau hết trận | cờ trận chỉ đóng ở `14/08`; server chỉ gửi `14/0d` | ack `14/0d` + watchdog khi im lặng + tự đóng cờ |
| `14/08 00 27` ở Trương Giác (cả khi đủ đội, đã chờ 12s) | **thiếu `0c/01` ⇒ không có `16/04` NPC/roster**; (trước đó còn thiếu `20/02`, ack thừa) | mục §4.1–3 |
| `14/08 00 23` | cổng đã dùng/không hợp lệ | không retry mù |
| `14/08 00 26` | ack thừa | ack đúng 1/gói |
| Tạo phòng bị `2f/02 00 04` (mã 4) | **hết lượt phó bản đội trong ngày** | không thử lại; dừng ngay, thông báo "Phó bản đội [<shortName>] Ní đã hoàn tất hôm nay rồi, mai quay lại nha Ní ơi." (`MSG.dungeonDailyDone`, tên gọi từ `DungeonRoomDef.shortName`, vd "Thảo phạt khăn vàng") |
- Chẩn đoán nhanh: `GET /api/connections/<id>/logs?after=0` (id đã encode `@`); tìm `[Phó bản]`, `[click_boss]`, `[warp_id]`, `rx 14/08`, `rx 16/04`, `KICK`. Backend `tsx watch` restart khi sửa `packages/**` ⇒ mất phiên online.
- Pcap có thể gây hiểu sai: pcap `chupt_phoban01` có trận cuối chủ động THUA nên phần sau không phải flow thắng; client thật tự `0d/04` rời đội ~2s sau chốt (không nhất thiết server tự warp).

## 8. Còn thiếu / hướng mở rộng
- **Pcap**: thành viên vào phòng CÓ mật khẩu; thành viên rời phòng; Khiêu Chiến Lữ Bố (`62012`), Hoả Thiêu Bốc Dương (`62013`), Tấn Công Giang Đông (`62014`), Kế Trảm Xa Trụ (`62016`) — script TSM tương ứng đã có trong `Config/` (cần id phòng + checkpoint).
- Thêm phó bản mới: (1) id phòng từ pcap/TSM `2f/02 00 <id> 00 01`; (2) `map` từ `mapNames.json`; (3) `steps` = từng checkpoint (script DSL: `move`, `warp_id`, `click`, `click_boss`); (4) test parse DSL + replay pcap; (5) áp dụng checklist §4.
- `5b/02`, `41/01`, `41/02` mà client thật gửi trong trận: bot chưa cần (trận vẫn chạy).

## 9. Cổng dịch chuyển Ngày Tàn Hoạn Quan cần ack 14/07 (log thật 2026-10-22)
- Cổng 2/4 (warp_id) trả `06/02` + `14/07` + `0c/00`; client thật đáp **đúng 1 `14/06`** rồi server mới đáp `14/08 00 2a` (pcap phobandoi_02 56.5s, 92.5s). Thiếu ack ⇒ NPC kế tiếp (NPC 5) bị server im lặng 3 lần.
- Bot: `14/07` trong cửa sổ thoại ⇒ `ackDialog`; `awaitEncounter` nhận ra "dịch chuyển nội bộ" (có 14/07, không có 14/01) ⇒ không chờ trận 40s.

## 10. Trạng thái (2026-10-22)
- ✅ Hoàn tất & kiểm chứng live: Thảo Phạt Thiên Sứ (id 1), Ngày Tàn Hoạn Quan (id 14).
- Chưa có pcap: Lữ Bố 62012, Hoả Thiêu 62013, Giang Đông 62014, Xa Trụ 62016 — dùng skill get-action-from-cap-file rồi thêm vào DUNGEON_ROOM_CATALOG.
