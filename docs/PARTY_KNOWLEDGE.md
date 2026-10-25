# ĐỘI NGŨ / LẬP ĐỘI (PARTY) — KIẾN THỨC & LOGIC XỬ LÝ (bản tổng hợp)

> **Root feature** của web bot. Tài liệu này là nguồn sự thật duy nhất: giao thức, mô hình trạng thái, thuật toán điều phối, bài học từ log thật,
> playbook debug và hướng mở rộng (phó bản đội). Sửa logic party ⇒ đọc §3 (giao thức), §6 (luồng chuẩn), §7 (bài học) **trước**.
>
> **Trạng thái (2026-10-21): ĐÃ TEST PASS end-to-end trên 3 tài khoản thật**: lập đội (mời/xin) → gán Quân sư → chủ PT teleport →
> đội tan → thành viên teleport theo → lập đội lại tự động → chờ đủ đội → chủ PT đi bộ tới mapId đích.
>
> Code: `packages/engine/src/transport/socket/codecs/party.ts` (giao thức + bảng người chơi) · `tsOnline.ts` (nối vào codec, action) ·
> `packages/engine/src/runtime/liveActions.ts` (bước `{gather}`) · `packages/engine/src/runtime/connection.ts` (hook `partyGate`) ·
> `packages/server/src/services/party.ts` (điều phối) · `packages/server/src/services/store.ts` (`PartyConfigStore`) ·
> `apps/web/src/components/PartyCard.tsx` (UI). Test: `packages/engine/test/party.test.ts`, `packages/server/test/party-service.test.ts`.

---

## 1. Yêu cầu sản phẩm

1. Lập đội giữa các tài khoản **theo TÊN NHÂN VẬT**, chỉ với người **đang cùng mapId** (và cùng kênh).
2. Hai chiều ghép: **chủ PT gửi MỜI** hoặc **thành viên gửi XIN gia nhập**. Đối phương **tự chấp nhận** nếu đúng tên đã khai báo.
3. UI: **Thành viên** nhập "Tên chủ PT" → nút **🤝 Yêu cầu gia nhập**; **Chủ PT** nhập ≤4 tên thành viên (+ tick **QSư**) → nút **🤝 Gửi lời mời PT**.
   Bấm nút = quét ngay và gửi request cho người **chưa vào đội** (kể cả người đã add mà chưa party). **⏹ Dừng** để tắt.
4. Sau khi vào đội: tên nào tick QSư ⇒ gán Quân sư. **Tag** trạng thái từng thành viên trên UI chủ PT; tag của chính mình trên UI thành viên.
5. **Đồng bộ warp**: chủ PT warp ⇒ thành viên teleport theo ⇒ lập đội lại ⇒ **chờ đủ đội tại map vừa teleport tới** rồi mới đi bộ
   (nhiều map bắt buộc đánh NPC mới qua cổng; thiếu đội sẽ thua, không tới đích).

---

## 2. Kiến trúc (3 tầng, trách nhiệm tách bạch)

```
UI (PartyCard)  ──PUT /party-config──►  Server (PartyService, nhịp 3s)  ──dispatch(action)──►  Engine (codec ts-online + PartyTracker)
     ▲  character.partyPlan                  │  mirrorWarp / gather / invite / request                │  gói 0d/xx, 03/00, 0c/00
     └──────────── ConnectionManager.withPlan ◄──────────── character.party (joined, members, advisor)┘
```

| Tầng | Biết gì | Làm gì | Không làm |
|---|---|---|---|
| **Engine** (`party.ts`, `tsOnline.ts`) | gói game; uid↔tên↔map; roster đội; lời mời/xin đang chờ | parse `0d/*`, `03/00`, `0c/00`; gửi mời/xin/đồng ý/gán QSư/rời; **tự đồng ý** đúng tên (`partyAuto`) | không biết tài khoản khác |
| **Server** (`PartyService`) | **mọi kết nối online** + cấu hình từng tài khoản | quét thành viên, mời/xin có cooldown, mirror teleport, chốt chặn gom đội, tính `partyPlan` (tag) | không đụng gói |
| **UI** | `character.party`, `character.partyPlan` | nhập tên/QSư, nút kích hoạt, hiển thị tag | không tự quyết logic |

Luật gắn tầng: **mọi thứ cần nhìn nhiều tài khoản** (cùng map? đã online? ai đang ở đâu?) thuộc **server**; **mọi thứ cần gói/uid** thuộc **engine**.

---

## 3. Giao thức opcode `0x0d` (đã chốt)

Ký hiệu: ✅ xác nhận (pcap/log/hex nguồn) · ⚠ suy luận · ❓ đoán. Payload = `f[8..]`, `f[8]=00`. **UID = 8 byte** `XX XX 67 d3 ac a8 0a 00`.
> Pim-Bot ghi số gói **THẬP PHÂN**: `Request_Party_13_01` = `0d/01`, `ClickNpc_20_01` = `14/01`. Easytool.dll (`CompatibilityCodec`) có hex wire gói mời/xin.

### 3.1 Client → Server
| Gói | Payload | Ý nghĩa | |
|---|---|---|---|
| `0d/07` | `00 <uid>` | **MỜI** `<uid>` vào đội | ✅ hex Easytool |
| `0d/01` | `00 <uid>` | **XIN** vào đội của `<uid>` | ✅ hex Easytool |
| `0d/08` | `00 01 <uid>` | **ĐỒNG Ý lời mời** của `<uid>` (cờ `01` đứng **trước** uid) | ✅ pcap `thanhvien_accept_invite_` |
| `0d/03` | `00 01 <uid>` | **ĐỒNG Ý lời xin** của `<uid>` (chủ PT) | ✅ pcap `chupt_accept_request_…` |
| `0d/05` | `00 <uid>` | **GÁN QUÂN SƯ** cho thành viên `<uid>` | ✅ pcap (Pim `Sena_13_05`) |
| `0d/04` | `00 <uid MÌNH>` | **RỜI ĐỘI / chủ PT GIẢI TÁN** | ✅ pcap chủ PT; thành viên thường ⚠ cùng layout |
| `0d/09` | `00 <uid>` | đổi chủ PT | ❓ Pim `ChangeLeader_Party_13_09` |
| từ chối lời mời/xin | — | **không gửi gì** (chưa có pcap) | |

> Bản đồng ý `00 <uid>` và `00 <uid> 01` đã thử thật: **server im lặng**. Chỉ `00 01 <uid>` đúng.

### 3.2 Server → Client
| Gói | Payload | Ý nghĩa | |
|---|---|---|---|
| `0d/09` | `00 <uid>` | có người **MỜI** mình (uid = người mời). **Không phải `0d/07`** | ✅ log thật |
| `0d/01` | `00 <uid>` | có người **XIN** vào đội mình | ✅ log thật |
| `0d/0d` | `00 <code>` | server **đã nhận** lời mời/xin mình gửi (00 = ok) | ✅ log |
| `0d/05` | `00 <leader> <joiner>` | `<joiner>` **vào đội** của `<leader>` (kể cả chính mình) | ✅ pcap/log |
| `0d/06` | `00 {<leader 8> <n u8> <n×uid 8>}*` | **roster mọi đội trong map** (lọc đội chứa uid mình) | ✅ pcap/log |
| `0d/07` | `00 <uid>` | **đã gán QSư** cho `<uid>` (kèm `0d/0b`). **Không phải lời mời** | ✅ pcap |
| `0d/0b` | `00 {<uid 8>}*` | uid Quân sư của từng đội (1 uid/đội) | ✅ pcap gán QSư |
| `0d/08`, `0d/0c` | `00 <uid>` | QSư bị gỡ (cùng lúc giải tán) | ⚠ |
| `0d/04` | `00 <uid> <x u16> <y u16>` | `<uid>` **rời đội** (mỗi người một gói) — xảy ra khi giải tán **và khi teleport** | ✅ |
| `0d/02`, `0d/03`, `0d/0a` | `00 01 …` / `00 01 08 "Teemo_01"` … | gói báo kết quả/thông báo tên (đã gặp, chưa giải mã) | ❓ |

### 3.3 Gói liên quan ngoài `0d`
- **`03/00` spawn người chơi**: `uid@9, map u16@28, x@30, y@32, nameLen u8@53, name@54 (Big5)` — nguồn **tên↔uid↔map**.
- **`0c/00` trạng thái người khác**: `uid@9, map u16@17, x@19, y@21` — báo **map mới** của người **từng cùng đội** (server không gửi lại `03/00` cho họ).
- **`44/01` teleport cổng thành** ⇒ **làm TAN ĐỘI** (server gửi `0d/04` cho mọi người ngay lúc teleport).
- **Kênh**: Đã giải mã kênh (`07/00@23`, `0c/00@23`) và hỗ trợ chuyển kênh `07/02` (xem `docs/CHANNEL_KNOWLEDGE.md` và §9.2).

---

## 4. Mô hình trạng thái ở engine (`PartyTracker`)

| Dữ liệu | Nguồn | Dùng để |
|---|---|---|
| `players: uid → {name, map, x, y, seen}` (≤600) | `03/00` (tạo), `0c/00` (cập nhật map người đã biết) | tra uid theo tên (`findInMap`, `findAny`) |
| `parties: leader → members[]` | `0d/06` (thay toàn bộ), `0d/05` (thêm), `0d/04` (bớt) | đội của mình (`leaderOf`, `snapshot`) |
| `advisors: Set<uid>` | `0d/0b` (thay), `0d/07` (đặt, mỗi đội 1), `0d/08/0c` (gỡ) | cờ `isAdvisor` |
| `pending` (invite/request, TTL 90s) | `0d/09`, `0d/01` | trả lời thủ công / tự đồng ý |

`snapshot(self)` → `CharacterState.party = {members[5], inviteStatus, joined (≥2 người), leaderName}`; slot 1 = chủ PT, `isSelf`, `isAdvisor`.

**Quy tắc "thấy trong map" (thứ tự áp dụng)** — `party_invite|party_request {name}`:
1. `findInMap`: spawn/status mới nhất có `map == map hiện tại` (không phân biệt hoa/thường, NFKC).
2. Nếu thất bại và tham số `force`: `findAny` (bất kể map) — **chỉ do server quyết định** khi nó đã xác nhận 2 tài khoản cùng map (§5.3).
3. Không tìm thấy ⇒ `{ok:false, "Không thấy …"}` và **không gửi gói**.

Auto-accept (engine, `maybeAutoAccept`): server đẩy `set_party_config {inviteFrom, requestFromJson}`; khi nhận `0d/09` từ đúng `inviteFrom` ⇒ gửi `0d/08`; khi nhận `0d/01` từ tên trong `requestFrom` ⇒ gửi `0d/03`. Người lạ ⇒ bỏ qua (log).

---

## 5. Điều phối ở server (`PartyService`, nhịp 3 giây)

Cấu hình: `data/party-configs.json`, khoá `canonicalKey(accountId)` (Rule 2). `PartyConfigStore.sanitize`: ≤4 thành viên, bỏ trùng/trống, **≤1 QSư**.
REST: `GET/PUT /api/accounts/:id/party-config`, `GET …/party-plan`. `PUT` ⇒ `refresh()` = reset cooldown + quét ngay.

### 5.1 Kích hoạt
Nút ở UI lưu `enabled=true` rồi `refresh()`. `enabled` **giữ nguyên** cho tới khi bấm ⏹ Dừng vì nó điều khiển cả mirror/gather. Tắt ⇒ gỡ `partyGate`, đẩy auto-accept rỗng.

### 5.2 Chủ PT (`tickLeader`) — với từng tên thành viên
1. Đã trong đội thật (`ch.party.members`) ⇒ `in_party`; tick QSư & chưa là QSư ⇒ `party_set_advisor` (cooldown 20s) ⇒ `advisor_pending` → `advisor` khi nhận `0d/07/0b`.
2. Chưa vào đội ⇒ thăm dò `party_invite` (quiet, 4s/lần). Không thấy ⇒ (§5.3) hoặc `not_in_map`. Gửi được ⇒ `inviting`.
3. **Cooldown & back-off**: không mời lại cùng người trong `25s × 2^(lần-1)`, trần 5 phút; reset khi vào đội.
4. Đẩy `set_party_config {requestFrom = các tên}`; gắn `conn.partyGate = gather`.

### 5.3 Thành viên (`tickMember`)
1. Đẩy `set_party_config {inviteFrom = tên chủ PT}`.
2. `joined` & `leaderName` khớp ⇒ `in_party/advisor`; đang ở đội **khác** ⇒ `error` (không tự rời để khỏi phá đội người khác).
3. Chưa vào đội: chờ 8s (để chủ PT mời trước) rồi `party_request`, cùng cooldown/back-off.

### 5.4 Fallback "force theo uid đã biết"
Sau teleport server **không** gửi `03/00` (và đôi khi cả `0c/00`) cho người từng cùng đội. `PartyService.sameMap` xác nhận 2 tài khoản **cùng map theo state của chính bot**
(nguồn đáng tin hơn gói spawn) ⇒ gọi lại mời/xin với `force=1`. Nếu thực ra **khác kênh** (§9.2) thì server bỏ qua — vô hại; UI ghi gợi ý "nghi KHÁC KÊNH".

### 5.5 Tag UI (`PartyEntryStatus`)
`not_in_map` ⌀ · `inviting`/`requesting` ⏳ · `in_party` ✔ · `advisor` ★ · `advisor_pending` · `error` ✖ · `offline` · `idle`. `partyPlan` gắn vào `CharacterState` bởi `ConnectionManager.withPlan`, đẩy ngay khi đổi.

---

## 6. LUỜNG CHUẨN: teleport → lập đội lại → chờ đủ → đi bộ (đã test pass)

```
t0  Chủ PT bấm Warp (warp_map / teleport_gate / warp_to_spot)  → ConnectionManager.dispatch
     └─ PartyService.mirrorWarp: tính buildSteps của chủ PT, lấy teleport_gate ĐẦU TIÊN (cổng G)
        └─ mỗi thành viên ĐÃ VÀO ĐỘI + online: dispatch teleport_gate G  rồi ĐỨNG LẠI
t1  Chủ PT: teleport_gate G  (44/01) ──► server: 0d/04 cho MỌI người (ĐỘI TAN)
t2  Cả 3 tới map G (0c/00 + sync_state). Chủ PT chạy bước {gather} → PartyService.gather(): poll 1s
t3  tickLeader (3s): thấy thành viên cùng map (findInMap / 0c/00 / force theo uid) → 0d/07 MỜI; thành viên tự đồng ý 0d/08 (hoặc tự xin 0d/01, chủ PT tự đồng ý 0d/03)
t4  Server: 0d/05 (vào đội) ⇒ party.joined; tickLeader gán lại QSư (0d/05 C→S) nếu tick
t5  gather: MỌI thành viên khai báo = trong đội ∧ online ∧ cùng map ∧ không inBattle ⇒ qua chốt
t6  Chủ PT đi bộ (warp_door… / move) tới mapId đích (đội đi cùng nhờ cơ chế game); {gather} cuối ở map đích
```

Chèn bước `{gather}` (`liveActions.ts`): sau mỗi teleport cổng thành · trước `move` vào bãi (`warp_to_spot`) · cuối `warp_map`. Không hook (không phải chủ PT đang bật) ⇒ bỏ qua, hành vi cũ giữ nguyên.
Quá `150s` chưa đủ đội ⇒ `ok:false` ⇒ **dừng cả chuỗi warp** (đi bộ thiếu đội dễ thua trận NPC chặn cổng). `abort` ⇒ dừng ngay.

Lộ trình **không có teleport** (đi bộ thuần) ⇒ **không mirror** (đội còn nguyên).

---

## 7. Bài học từ log thật (invariants — đừng phá)

1. **Teleport luôn làm tan đội.** Mọi tính năng đi qua teleport phải coi "lập đội lại" là một bước bình thường, không phải lỗi.
2. **Thành viên chỉ mirror đoạn teleport rồi đứng lại.** Bản đầu cho chạy cả lộ trình ⇒ họ qua cổng sang map kế trong vài giây, chủ PT không còn ai để mời ⇒ hết 150s.
3. **Server báo lời mời = `0d/09`** (không phải `0d/07`); `0d/07` S→C là "đã gán QSư". Suy luận theo gương gói C→S đã sai.
4. **Gói đồng ý có cờ `01` ĐỨNG TRƯỚC uid** (`00 01 <uid>`). Hai biến thể khác bị server **im lặng** (không báo lỗi) — im lặng ≠ đã nhận; luôn chờ `0d/05`.
5. **Người từng cùng đội không có `03/00` mới sau teleport**: dùng `0c/00` (cập nhật map) rồi `force` theo uid khi 2 tài khoản cùng map theo bot.
6. **Nguồn sự thật "cùng map"** = state của bot (`location.map` từng kết nối), không phải gói spawn.
7. **Không spam hộp thoại**: cooldown 25s + back-off tới 5 phút; thăm dò "Không thấy" **không gửi gói** và chỉ log mức debug (`quiet`).
8. **Đừng dò gói trên server thật**: thiếu gói ⇒ xin pcap (skill `/get-action-from-cap-file`), không thử mò biến thể.
9. **Dị giới không cho vào khi đang trong đội** (TextData: "Trong tổ đội, không thể vào!"). Bot chặn từ `dijie_open` (cả chủ PT lẫn thành viên): báo `Không thể kéo cả bầy zô Dị Giới được Ní ơi, giải tán đội đi !!!` và **không gửi `61/01`**. Phải Giải tán/Rời đội trước (và tắt ⏹ lập đội kẻo bot mời lại). Áp dụng tương tự cho mọi nội dung "cấm vào khi có đội" sau này (xem §11.3 mục 4).
10. Mọi gói `0d/*` gửi/nhận đều log **info** có hex (`🤝 [Đội ngũ] rx/tx …`) — gói hiếm; đây là dữ liệu chính để sửa lỗi.

---

## 8. Playbook debug

| Triệu chứng | Kiểm tra |
|---|---|
| Tag mãi `⌀ Chưa thấy trong map` | Cùng mapId thật? Gõ đúng tên (Big5/dấu phải đúng)? Log `03/00`/`0c/00` của người đó? Nếu 2 bên cùng map theo bot ⇒ nghi **khác kênh** (§9.2). |
| `⏳ Đã mời` mãi | Phía được mời: có `rx 0d/09`? có `tx 0d/08 00 01 <uid>`? có dòng `tự chấp nhận`/`không nằm trong danh sách`? Đã bấm nút + đúng tên chủ PT? |
| Có `tx 0d/08|03` nhưng không `rx 0d/05` | Sai định dạng (phải `00 01 <uid>`). So với pcap §10. |
| Bị kick `00/00` sau `tx 0d/..` | Gói đó sai — chỉ `0d/09` (đổi chủ PT) và `0d/04` thành viên thường còn là đoán. |
| UI không thấy đã vào đội | `rx 0d/05`, `rx 0d/06`; tên hiện `#xxxx` ⇒ chưa có spawn của họ. `PartyTracker.snapshot`. |
| Quân sư không gán | `tx 0d/05 GÁN QUÂN SƯ` + `rx 0d/07/0b`. Chỉ chủ PT; chỉ người đã trong đội. |
| Sau warp đội tan, không mời lại | Bình thường (teleport tan đội). Xem `party_invite … Không thấy` (debug) / `rx 0c/00`. Thành viên phải **đứng lại** ở map cổng thành. |
| Chủ PT đứng chờ lâu sau teleport | Log `Chờ đủ đội tại map N: <tên> (lý do)`: chưa vào đội / offline / khác map / đang trong trận / nghi khác kênh. 150s tự dừng. |
| Thành viên không theo chủ PT warp | Chưa `in_party` theo state chủ PT? `player.name` online đúng tên khai báo? Log `chủ PT … ⇒ <tên> teleport_gate G`. |
| Script (không phải nút Warp) không đồng bộ | Chưa hỗ trợ (§9.1). |

---

## 9. Giới hạn đã biết & việc tiếp theo

1. **Script** (`runScript/runQueue`) chạy thẳng `transport.execute` ⇒ **chưa mirror/gather**. Cần đưa các lệnh warp của interpreter qua cùng cơ chế `ConnectionManager.dispatch`/`{gather}`.
2. **Kênh (channel)**: khi kênh đầy server đẩy 1 thành viên sang kênh khác ⇒ cùng mapId nhưng không thấy nhau (khớp ca Teemo_03: không có `03/00` lẫn `0c/00`).
   - **Hiện trạng (2026-10-22)**: Đã **HOÀN THÀNH** giải mã kênh (byte 23 của `07/00` và `0c/00`) và lệnh đổi kênh `07/02` (`Change_Channel_07_02`), xử lý phản hồi thành công và bắt lỗi kênh đầy `10135` (chi tiết xem `docs/CHANNEL_KNOWLEDGE.md`).
   - Bot có thể so sánh kênh giữa thành viên và chủ PT để tự động gửi action `channel` chuyển thành viên về kênh của chủ PT trước khi mời/xin vào đội.
3. Chưa có pcap: **từ chối** mời/xin, **đổi chủ PT**, **thành viên thường tự rời**, **chủ PT đá thành viên**, **bỏ/đổi QSư**.
4. Chưa biết thành viên có **tự đi theo** chủ PT qua cổng dịch chuyển hay không (đã test pass lộ trình thực tế nên có vẻ đi theo; cần xác nhận cho từng loại cổng/phó bản).
5. Không có gói "người chơi rời map" ⇒ bảng người chơi có thể giữ người đã đi (khoá bằng `map`).
6. Không tự rời đội cũ để vào đội khác (tránh phá đội người khác).

---

## 10. Pcap đã dùng & nhật ký thử nghiệm
- `thanhvien_accept_invite_.pcap`: S→C `0d/09 00 <chủ>` → C→S `0d/08 00 01 <chủ>` → S→C `0d/05 00 <chủ> <mình>` (+0.3s) + `08/03`, `51/01`, `18/05` (không có `0d/06` lại).
- `chupt_accept_request_assign_qsu_giai_tan_team.pcap` (chủ `8ede`, thành viên `b3de/b4de`): S→C `0d/01` (xin) → C→S `0d/03 00 01 <uid>` → S→C `0d/05`; C→S `0d/05 00 <uid>` (QSư) → S→C `0d/07`+`0d/0b`; C→S `0d/04 00 <uid mình>` (giải tán) → S→C `0d/08`,`0d/0c`,`0d/04`×3.
- Log thật 2026-10-21: (a) bản có byte `01`/không cờ: server im lặng; (b) thành viên chạy cả lộ trình ⇒ chủ PT chờ hết 150s; (c) sau teleport thiếu `03/00` ⇒ `0c/00` + `force`; (d) 1 thành viên không có gói nào ⇒ nghi khác kênh.
- Mẫu hệ thống 02/0a trong `Pim-Bot/language.ini`: "xin gia nhập đội ngũ", "mời bạn gia nhập đội ngũ", "đồng ý lời mời", "gia nhập đội ngũ", "rời khỏi đội ngũ", "đã được nâng làm đội trưởng", "là quân sư" — dấu hiệu dự phòng nhận biết sự kiện đội qua thông điệp.

---

## 11. MỞ RỘNG: PHÓ BẢN ĐỘI (kế hoạch)

> **Đã cài và chạy hoàn chỉnh Thảo Phạt Thiên Sứ (2026-10-21)** — toàn bộ giao thức/flow/bài học nằm ở `docs/DUNGEON_TEAM_KNOWLEDGE.md` (Ngày Tàn Hoạn Quan đã cài theo TSM, chưa kiểm chứng). Phần dưới là kế hoạch ban đầu (lịch sử).

### 11.1 Bằng chứng sẵn có (chưa có pcap phó bản đội)
- **Tool cũ (TSM)**: script phó bản dùng `dungeon <stage> <diff>` + `start_dungeon` + `await_battle`; trước/sau có `leave_party`, `await_party`, `room_team a b`, `if_leader` (mô hình leader/member bằng script, chat `command …` để đồng bộ pet giữa các bot). Map phó bản 12922…12959, 49984…
- **Pim-Bot** (tên metadata): `CreateRoomDungeon_47_02` (`2f/02`), `JoinDungeon_47_03` (`2f/03`), `JoinLimitDungeon_97_01` (`61/01`), `UIEternalDungeonOnClick_Battle_4801` (`30/01`), `UIEternalDungeonRequestInfo_4802` (`30/02`); logic `DungeonTeam_*` (SetJoinCommandMeta, SendJoinAck, TryRetryJoinAfterResult3, RunWithParty, ApplyQuickConfigIfNeeded, SessionState), `IsDungeonTeamRoomOwner`, `UpdateDungeonRoomOwnerFromSelection`, `WaitPartyLeaveBeforeDungeonJoin`, `UpdateDungeonPasswordInput…` (phòng có **mật khẩu**), `listDungeonMustFight`, `isTeamThamChien`.
  ⇒ Mô hình phỏng đoán: **chủ phòng tạo phòng (có thể mật khẩu) → thành viên Join theo phòng/mật khẩu → chủ phòng Start**; một số phó bản **yêu cầu rời đội** (`WaitPartyLeaveBeforeDungeonJoin`) và cũng có thông báo "Trong tổ đội, không thể vào!" (Dị giới, TextData).
- Hệ quả cho kiến trúc: **phó bản có thể KHÔNG dùng party `0d/*` mà dùng "room/team" riêng (`2f/xx`)** — cần pcap để biết.

### 11.2 Điểm cắm đã sẵn (tái sử dụng, không viết lại)
| Cần | Dùng lại |
|---|---|
| Biết ai trong đội/phòng, ai online, ai cùng map | `PartyService.online()/byName()/sameMap()`, `character.party` |
| Chờ đủ người trước bước nguy hiểm | `ActionStep { gather }` + `PartyService.gather` (thêm tham số điều kiện: map/phòng/trạng thái) |
| Đồng bộ hành động từ chủ → thành viên | `mirror*` (mẫu `mirrorWarp`: tính bước của chủ, chạy phần dùng chung cho thành viên) |
| Mời/xin theo tên + tự chấp nhận | `partyAction` + `partyAuto` (mở rộng cho "mời vào phòng") |
| Hiển thị tag/tiến độ | `PartyPlanState` (thêm `phase`, `room`) |
| Debug | log `🤝 rx/tx` + checklist §8 |

### 11.3 Thiết kế đề xuất (khi có pcap)
1. **Tổng quát hoá `gather`** thành `ActionStep { gather: { kind: "map" | "party" | "room"; reason } }`; `PartyService.gather(kind)` kiểm tra điều kiện tương ứng.
2. **Pha phó bản** trong `PartyPlanState.phase`: `forming → gathering → in_room → in_dungeon → done`; chủ phòng điều phối, thành viên tự `Join` khi nhận mã phòng/mật khẩu.
3. **Giao thức phòng** (mới, tách `dungeonRoom.ts` như `party.ts`): `create(stage, diff, password?)`, `join(roomId, password?)`, `start`, parse S→C danh sách phòng/trạng thái. **Mỗi gói ghi mức tin cậy** như §3.
4. **Quy tắc rời đội**: nếu phó bản yêu cầu rời đội ⇒ thêm bước `leave_party` (đã có `0d/04`) trước `Join`, rồi tái lập đội **sau khi ra** (tái dùng §6).
5. **Chủ động chiến đấu**: `listDungeonMustFight`/`isTeamThamChien` gợi ý có trận bắt buộc ⇒ `gather` phải kiểm tra `inBattle` (đã có) và **số thành viên đủ** trước mỗi tầng.
6. **Script**: giải quyết §9.1 trước (dispatch warp của script qua cùng cơ chế) để các kịch bản phó bản đội dùng được `leave_party`/`await_party`/`dungeon`/`start_dungeon` kèm điều phối.

### 11.4 Pcap cần bắt cho phó bản đội (mỗi thao tác một file, ghi giờ)
1. **Chủ phòng tạo phòng** (có/không mật khẩu), chọn stage/độ khó.
2. **Thành viên vào phòng** (nhập mật khẩu nếu có) + thành viên **rời phòng**.
3. **Chủ phòng bắt đầu** phó bản (kèm đội đủ/thiếu người), vào/ra giữa các tầng, **kết thúc/thoát phó bản** (đội có tan không? thành viên có tự theo vào không?).
4. Phó bản **bắt buộc rời đội** (nếu có thông báo) và hành vi sau khi ra.
