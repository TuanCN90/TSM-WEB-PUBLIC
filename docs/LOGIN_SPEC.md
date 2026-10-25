# Spec: đăng nhập vào máy chủ TS Online (client tự viết)

> Cập nhật 2026-10-16. Tài liệu này chỉ mô tả **cách đăng nhập và giữ phiên**; không chứa tài khoản, mật khẩu, UID hay bất kỳ dữ liệu cá nhân nào. Mọi giá trị minh hoạ dùng placeholder (`<user>`, `<pass>`).
> Phạm vi: từ lúc mở TCP đến lúc phiên "đã vào thế giới" (server chấp nhận các gói hành động). Không gồm các hành động trong game.

**Độ tin cậy:** ✅ đã kiểm chứng trên server thật · ⚠ suy ra, chưa kiểm chứng trực tiếp.
**Nguồn:** pcap bắt từ client game thật (gồm một capture bắt từ trước lúc login) + kiểm chứng bằng client tự viết (`packages/engine/src/transport/socket/codecs/tsOnline.ts`).

---

## 1. Tóm tắt

1. Mở TCP tới `34.81.22.35:6614` (không TLS, không HTTP).
2. Gửi một frame đăng nhập `01/00` chứa user và mật khẩu (ASCII, **phân biệt hoa/thường**).
3. Server trả `01/02`. Nếu UID (8 byte) khác 0 thì thành công; toàn 0 thì bị từ chối.
4. Server tự đẩy snapshot trạng thái trong ~0.2–0.5 giây.
5. Client **phải** gửi chuỗi khởi tạo (INIT) gồm **hai lô** (mục 5). Thiếu lô 2 thì server vẫn cho online nhưng **bỏ qua im lặng mọi gói hành động**.
6. Giữ phiên bằng cặp heartbeat `07/01` + `0a/00` mỗi 12 giây.
7. Đăng xuất = đóng TCP (không có gói logout). Mỗi tài khoản chỉ có **một phiên**.

---

## 2. Khung gói (frame) ✅

Hai chiều dùng chung một khung.

```
WIRE:    [6d 3c][len u16 LE][body …]
GIẢI MÃ: f[0..1]=6d 3c | f[2..3]=len | f[4..5]=00 00 | f[6]=cmd | f[7]=sub | f[8..]=payload
```

- `len` là **tổng độ dài frame** (gồm cả header).
- Mã hoá: hai byte đầu `6d 3c` giữ nguyên; **mọi byte từ vị trí 2 trở đi XOR `0xAD`** (cả `len`, cả body). Không có checksum, không có số thứ tự, không có TLS.
- Mọi số nhiều byte là **little-endian**. Chuỗi: `[len u8][bytes]`; tiếng Trung dùng Big5.
- Tách gói từ TCP: cộng dồn buffer, đọc `len` (sau XOR) ở byte 2–3, cắt đúng từng frame. Một chunk TCP có thể chứa nhiều frame hoặc nửa frame.
- **Payload của mọi gói client gửi (`f[8..]`) luôn mở đầu bằng byte `00`**, trừ gói đăng nhập (mục 3). Thiếu byte này thì gói ngắn hơn bản của client chuẩn 1 byte.

Hàm dựng frame (giả mã):

```ts
function encodeFrame(cmd, sub, payload /* đã gồm byte 00 đầu */) {
  const body = [0x00, 0x00, cmd, sub, ...payload];
  const f = Buffer.alloc(4 + body.length);
  f[0] = 0x6d; f[1] = 0x3c;                 // 0xf4^0x99, 0x44^0x78
  f.writeUInt16LE(f.length, 2);
  Buffer.from(body).copy(f, 4);
  for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
  return f;
}
```

---

## 3. Gói đăng nhập (C→S) `01/00` ✅

Payload = hằng số 10 byte + `[len]user` + `[len]pass`:

```
00 02 01 15 00 00 00 00 00 01   [len u8]<user ASCII>   [len u8]<pass ASCII>
```

- Gửi ngay sau khi TCP kết nối, **một lần**.
- Mật khẩu **phân biệt hoa/thường**. Sai chữ hoa chữ thường sẽ bị từ chối giống sai mật khẩu.
- Không log, không lưu lại frame này (chứa user/mật khẩu chỉ bị XOR `0xAD`, đọc được ngay).

## 4. Phản hồi đăng nhập (S→C) `01/02` ✅

- UID là 8 byte ở `f[14..21]`.
- **UID khác 0 → thành công.** Giữ UID để nhận ra các gói "của mình" (`03/00` spawn có UID ở `f[9..16]`).
- **UID toàn 0 → bị từ chối.** Server đồng thời gửi `14/08` payload `00 30`. Server **không nói lý do**. Các nguyên nhân đã gặp:
  1. Sai user/mật khẩu (kể cả sai hoa/thường).
  2. **Phiên cũ của cùng tài khoản chưa được giải phóng** (mục 7).
  3. **Bị khoá tạm vì đăng nhập dồn dập** (mục 7).
- Chờ phản hồi tối đa khoảng 10 giây; quá hạn coi như thất bại.

---

## 5. Chuỗi khởi tạo sau login (INIT) ✅

Server tự đẩy một loạt gói trạng thái (nhân vật, võ tướng, vị trí, trang bị, danh sách đơn vị…) trong khoảng 0.2–0.5 giây sau login. Client **không** cần phản hồi các gói này, nhưng phải gửi chuỗi INIT dưới đây. Đây là phần quan trọng nhất và dễ bỏ sót.

Thời gian tính từ lúc nhận `01/02` thành công. Payload ghi đủ, đã gồm byte `00` đầu.

| Lô | Trễ | Gói (`cmd/sub`) | Payload |
|---|---|---|---|
| 1 | +0.7s | `19/29` | `00 7b` |
| 1 | +1.53s | `2b/04` | `00` |
| 1 | cùng lúc | `01/10` | `00` |
| 1 | cùng lúc | `4d/0b` | `00 80 00` |
| 1 | cùng lúc | `7c/04` | `00` |
| 1 | cùng lúc | `41/02` | `00` |
| 1 | cùng lúc | `0c/01` | `00` |
| 1 | cùng lúc | `57/03` | `00` |
| 2 | cùng lúc | `62/02` ×4 | `00 04 00 00 00`, `00 01 00 00 00`, `00 03 00 00 00`, `00 02 00 00 00` |
| 2 | +45ms | `0a/00` | `00` |
| 2 | cùng lúc | `21/01` | `00 00` |
| 2 | cùng lúc | `59/01` | `00` |
| 2 | cùng lúc | `07/01` | `00` |
| 2 | cùng lúc | `48/05` | `00` |
| 2 | +220ms | `19/29` | `00 7f` |

(Gửi mỗi gói thành một frame riêng; gửi nhiều frame liên tiếp trong cùng một lần ghi socket là được.)

Ghi chú: gói `19/29` thứ hai lúc thì `00 7f` lúc thì `00 7b` giữa các capture của client chuẩn (có vẻ là cờ cấu hình của client); web bot dùng `00 7f` và server chấp nhận. Tại sao `19/29` cần hai lần chưa rõ.

### Dấu hiệu xác nhận đã "vào thế giới" ✅

Sau lô 2, server trả các gói **chỉ xuất hiện khi INIT đủ**: `59/01` (~334 byte), `07/01` (~22 byte), `48/06`, `0a/00`, và mỗi heartbeat sau đó được đáp lại bằng `07/01` + `0a/00`. Nếu **không** thấy server đáp lại `07/01`, phiên chưa hợp lệ.

### Dữ liệu server đẩy lúc login ✅

Gồm snapshot nhân vật, võ tướng, vị trí, trang bị, danh sách đơn vị và **bảng bộ đếm `55/01`** (khoảng 15 KB, 1500 bản ghi 10 byte `[id u16][val u32][max u32]`). Client không cần phản hồi các gói này. Một số bộ đếm hữu ích cho client: `0x1b` phút online hôm nay, `0x6b` ngày điểm danh (≤28), `0x6c` ngày điểm danh liên tiếp (≤25).

### Hậu quả khi thiếu lô 2 ✅

Server **không báo lỗi**. Phiên vẫn "online", vẫn nhận gói đẩy, nhưng server **không trả lời `07/01` và bỏ qua mọi gói hành động** (ví dụ chọn mốc Dị giới `61/02`). Triệu chứng này đã tái hiện khi web bot chỉ gửi lô 1 (và thiếu byte `00` đầu payload).

### Gói tool chuẩn gửi thêm nhưng cố ý KHÔNG đưa vào INIT ✅

Các gói này có tác dụng lên tài khoản, không cần cho việc giữ phiên: `4d/03 00 3f 00`, `63/04` (nhận thưởng đấu trường), `5b/02` (danh sách 9 mục), `56/01`. Chỉ gửi khi có chủ đích.

---

## 6. Heartbeat ✅

- Mỗi **12 giây** gửi hai frame liên tiếp: `07/01` payload `00` và `0a/00` payload `00`.
- Server đáp lại cả hai. Dùng phản hồi này để biết kết nối còn sống.
- Wire mẫu (hai frame liền nhau): `6d3ca4adadadaaacad` + `6d3ca4adadada7adad`.
- Không dùng `01/10` làm heartbeat định kỳ (client chuẩn chỉ gửi `01/10` một lần trong INIT).

---

## 7. Quy tắc phiên (rất dễ gây khoá tài khoản)

- **Một tài khoản = một phiên.** Đăng nhập từ nơi khác (client game, tool trên VPS, bot) sẽ đá phiên đang có, hoặc bị từ chối. Hai nơi cùng tài khoản sẽ giành nhau.
- **Không có gói đăng xuất.** Đăng xuất = đóng TCP. Server giữ phiên cũ khoảng **50 giây đến ~2 phút** sau khi đóng; đăng nhập lại trong lúc đó dễ bị UID rỗng hoặc im lặng.
- **Server giới hạn đăng nhập dồn dập.** Nhiều lần thử liên tiếp (kể cả do vòng tự thử lại của bot) dẫn tới **khoá tạm**, biểu hiện là UID rỗng và `14/08 00 30` cho mọi lần thử, kể cả khi mật khẩu đúng. Thời hạn khoá không được thông báo. Mỗi lần thử trong lúc bị khoá có thể kéo dài khoá.
- Hiện trạng cấu hình trong repo (web bot): `SESSION_COOLDOWN_MS = 30s`, thử lại khi bị từ chối = 1 lần sau 30s, `maxReconnect = 1`, `heartbeatMs = 12000`.
- Chính sách khuyến nghị cho client tự viết:
  - Sau mỗi lần đóng socket, chờ **ít nhất 30 giây** rồi mới đăng nhập lại.
  - Khi bị từ chối: tối đa **1 lần thử lại, sau 30 giây**; sau đó dừng hẳn và báo người dùng, **không tự thử tiếp**.
  - Tự kết nối lại khi rớt giữa chừng: tối đa **1 lần**.
  - Cho phép huỷ ngay khi đang chờ thử lại.
  - Không đăng nhập song song nhiều phiên cùng tài khoản.
- Khi nhiều môi trường dùng chung tài khoản (client game để kiểm tra, tool trên VPS, bot), thoát hẳn khỏi bên kia và chờ ~1 phút trước khi đăng nhập bên còn lại.

---

## 8. Quy trình đề xuất cho client mới

```
1. Kiểm tra cooldown 30s kể từ lần đóng socket gần nhất.
2. Mở TCP 34.81.22.35:6614.
3. Gửi 01/00 (mục 3). Chờ 01/02 tối đa ~10s.
4. UID = 0  → dừng/thử lại tối đa 1 lần sau 30s (mục 7).
   UID ≠ 0  → lưu UID trong bộ nhớ (không ghi log/đĩa).
5. Gửi INIT theo bảng mục 5, đúng thứ tự và độ trễ.
6. Chờ phản hồi 59/01 + 07/01. Có → phiên hợp lệ. Không có sau ~5s → coi là lỗi INIT, đóng socket.
7. Mỗi 12s gửi 07/01 + 0a/00; nhận 07/01 + 0a/00 trả về. Mất phản hồi nhiều lần liên tiếp → coi như rớt.
8. Đăng xuất = đóng TCP.
```

---

## 9. Chưa biết / lưu ý

- Server trả về **không cho biết lý do từ chối** (mục 4); không phân biệt được "sai mật khẩu", "phiên cũ chưa giải phóng" và "bị khoá tạm" chỉ từ gói trả về.
- Thời hạn khoá tạm và ngưỡng số lần thử chưa đo được (đã gặp bị khoá sau nhiều lần đăng nhập trong thời gian ngắn).
- Ý nghĩa chính xác từng gói INIT chưa rõ (ví dụ `62/02`, `59/01`, `48/05`, `21/01`). Chuỗi được sao nguyên từ client chuẩn và đã chạy ổn; không thay đổi nếu chưa có lý do.
- Server có thể tự đóng kết nối (đã quan sát rớt không do client); xử lý như rớt ngoài ý muốn.
- Khi gỡ lỗi "server không trả lời": bật log mức debug (in mọi gói nhận) **trước khi** login; ở mức info phần lớn gói nhận không được in nên dễ kết luận sai.
- Kiến thức về gói **hành động** (di chuyển, Dị giới, điểm danh…) nằm ở `docs/game_actions_knowledge.md`, không thuộc spec này.
