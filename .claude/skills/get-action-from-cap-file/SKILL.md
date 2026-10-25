---
name: get-action-from-cap-file
description: Đọc file pcap/pcapng trong captures/ (client game thật hoặc tool gốc), tìm đúng gói hành động người dùng vừa thao tác, giải mã cấu trúc và cài action đó vào web bot (engine + UI + test + docs). Dùng khi người dùng nói "đã cap xong", "đọc file cap", "xử lý action từ file cap", hoặc gọi /get-action-from-cap-file.
argument-hint: "[tên file trong captures/] [mô tả thao tác + giờ bấm, ví dụ: dùng Tiên Đơn Kiện Thể ô 25 lúc 00:32]"
---

# get-action-from-cap-file — từ file capture đến action chạy được trên web bot

Mục tiêu: người dùng làm **một thao tác** trên client game thật (hoặc tool gốc), bỏ file cap vào `captures/`, rồi gọi skill này; Claude tự đọc, tìm gói, đối chiếu docs, **cài action** và báo kết quả — hỏi lại tối thiểu.

`$ARGUMENTS` = [tên file] [mô tả thao tác, giờ bấm, tham số đã dùng]. Cả hai đều tuỳ chọn.

## 0. Nguyên tắc (đọc trước)

- **Không đăng nhập/gửi gói lên server game** trong lúc phân tích. Chỉ đọc file. Gửi thử lên server thật chỉ khi người dùng đồng ý, mỗi lần **một gói**, sau khi tài khoản đã login theo hướng dẫn (chờ ≥1 phút giữa các lần login; spam login ⇒ bị khoá).
- **Che thông tin đăng nhập**: frame `01/00` và `01/02` chứa user/mật khẩu; `tools/pcap-decode.ts` đã che. Không in/ghi lại hex của chúng, không đưa tên tài khoản vào code/docs.
- Sửa engine (`packages/engine/**`, `packages/server/**`) làm backend `tsx watch` **restart và ngắt phiên đang online**: kiểm tra `curl -s localhost:8787/api/connections`; nếu có phiên `online`, gom hết chỉnh sửa rồi báo người dùng sẽ phải login lại.
- Chỉ gán ý nghĩa khi có bằng chứng (đối chiếu số trong game/log tool/hai mẫu); phần còn lại ghi "suy ra / chưa rõ", **không bịa opcode**. Gói có tác dụng không hoàn tác (vứt, bán, phân giải…) không tự gửi thử.
- Đọc trước để khỏi làm lại: `docs/game_actions_knowledge.md` (Phụ lục B = các gói đã xác nhận), `docs/LOGIN_SPEC.md` (khung gói, INIT, heartbeat), `docs/KNOWLEDGE.md` (A2 bảng packet, A8b công cụ pcap).

## 1. Tìm file cap

1. Nếu `$ARGUMENTS` có tên file → dùng `captures/<tên>`. Nếu không → file `.pcap`/`.pcapng` **mới nhất** trong `captures/` (`ls -t captures`). Bỏ qua `.etl`.
2. Nếu thư mục không có file hợp lệ → nhắc người dùng chép file vào `captures/` (macOS chặn terminal đọc `~/Downloads`: dùng Finder để kéo thả).
3. Tóm tắt luồng: `npm run -s pcap -- <file> --stats | head -40`. Nếu báo mất gói hoặc nhiều luồng, dùng `--flow N`.

## 2. Tìm gói hành động

1. Chạy `npm run -s pcap -- <file> --candidates` — liệt kê gói **client** không thuộc khởi tạo/heartbeat/làm mới, kèm phản hồi server trong 1,5s.
2. Nếu người dùng nêu **giờ bấm**: đổi sang giây tương đối bằng cách so với dòng đầu luồng (`--from/--to` quanh thời điểm) hoặc xem gói nào có phản hồi tức thì. Giờ đồng hồ máy khác nhau nên chỉ dùng làm gợi ý khoảng cách giữa các thao tác.
3. Nếu có nhiều ứng viên: chọn theo (a) phản hồi tương ứng với mô tả (túi đồ đổi `17/08`, tiền `23/05`/`1a/04`, map đổi `0c/00`, bộ đếm `55/01`, thông báo `02/0a` — dùng `--text` để đọc), (b) thứ tự trong thao tác người dùng kể. Có hai capture "có/không có thao tác" → `--diff`.
4. Có id/số đã biết (itemId, mapId, số lượng)? Tìm trực tiếp: `--find u16:<id>` (và `u32:`), in offset từ `f[0]` (payload = `f[8..]`).
5. Tên vật phẩm/map để đối chiếu: `packages/engine/src/data/itemNames.json`, `apps/web/src/data/mapNames.json`.

Nếu vẫn mơ hồ sau các bước trên thì mới hỏi người dùng (một câu, kèm danh sách ứng viên đánh số).

## 3. Giải mã cấu trúc

- Frame: `6d 3c | len u16 | 00 00 | cmd | sub | payload`, payload = `f[8..]`, thường mở đầu bằng byte `00`. Số nhiều byte là little-endian.
- Phân loại từng byte payload: hằng số / id (so với bảng tên) / số lượng / chỉ số ô / cờ. **Hai mẫu khác tham số** (hai lần cap hoặc hai vật phẩm) là cách chắc nhất để tách trường; nếu chỉ có một mẫu, đánh dấu trường nào "chưa kiểm chứng".
- Ghi cả **phản hồi server** (opcode + payload) và gói client gửi kèm ngay sau (vd `07/01`, `0c/01`): web bot nên bắt chước đúng trình tự và độ trễ.
- Đối chiếu bảng opcode đã biết (`OPS` trong `tools/pcap-decode.ts`, bảng A2 trong KNOWLEDGE) để không đặt trùng tên.

## 4. Cài action vào web bot (checklist, theo thứ tự)

1. **Registry**: thêm entry vào `LIVE_ACTIONS` trong `packages/engine/src/runtime/liveActions.ts` (`name`, `label`, `params`, `toCommand`; nhiều bước dùng `toSteps` + `ActionStep` giống `warp_map`/`dijie_enter`; `hidden: true` nếu có UI riêng).
2. **Codec**: thêm `case` trong `encodeAction` của `packages/engine/src/transport/socket/codecs/tsOnline.ts` dựng đúng gói bằng `encodeFrame(cmdBody(cmd, sub, [0x00, …]))`; kiểm tra tham số và `throw new Error(...)` rõ ràng thay vì gửi gói sai.
3. **Phản hồi**: thêm nhánh trong `handle()` (đọc kết quả, cập nhật state qua `io.patchState`, phát sự kiện qua `io.game(MSG.xxx)`). Câu thông báo viết trong `packages/engine/src/data/messages.ts` theo **giọng vui "Ní"**, rồi rà `kind()` trong `apps/web/src/components/GameLog.tsx` để tô màu đúng.
4. **UI**: thêm nút/menu vào `apps/web/src/pages/Home.tsx` (thẻ Hành động: `iconbtn` + tooltip `data-tip`, popup dùng `.modal`); lỗi/lời nhắn dùng `useToast()`, không chèn chữ vào thẻ tính năng.
5. **Test byte-exact** trong `packages/engine/test/` (vd `bag.test.ts` là mẫu): dựng gói bằng codec rồi so với hex **lấy từ pcap** (wire = body XOR `0xAD` từ byte 2); thêm test phản hồi bằng frame dựng từ payload đã giải mã. Chạy `npm run -s typecheck` và `npm test`.
6. **Docs**: cập nhật bảng ở `docs/game_actions_knowledge.md` (Phụ lục B: gói gửi, phản hồi, độ tin cậy ✅/🟡/❌, file cap nguồn); nếu là gói mới của server thì thêm dòng vào bảng A2 của `docs/KNOWLEDGE.md` và `OPS` trong `tools/pcap-decode.ts`. Lưu memory (`~/.claude/projects/-Users-user-TS-Bot-Web/memory/`) nếu đó là tính năng quan trọng hoặc có điểm khó lường.

## 5. Báo cáo cho người dùng (ngắn, tiếng Việt)

1. **Gói tìm được**: bảng `thời gian | hướng | cmd/sub | payload | ý nghĩa | độ tin cậy`.
2. **Trường tham số**: byte nào là gì, byte nào chưa rõ.
3. **Đã cài**: danh sách file đã sửa và test đã chạy (kết quả thật).
4. **Chưa kiểm chứng/rủi ro**, và **bước thử an toàn trên server thật** (login một lần, thử đúng một gói, xem dòng nào ở tab Sự kiện / log `debug`). Nhắc nếu backend đã restart nên phải login lại.
5. Nếu thiếu dữ liệu: nói chính xác cần capture thêm gì (vd "làm lại thao tác với vật phẩm khác để tách byte itemId").

## Mẹo capture để lần sau ít phải hỏi lại

Bắt từ **trước khi login**, chờ ~1 phút, làm đúng **một thao tác**, ghi giờ và kết quả hiển thị (vd "dùng Tiên Đơn Kiện Thể, còn 2 cái"); mỗi thao tác một file; thao tác không hoàn tác thì dùng vật phẩm/tài khoản không quan trọng; nên làm hai lần với tham số khác nhau.
