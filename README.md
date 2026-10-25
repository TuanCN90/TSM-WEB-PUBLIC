# TS Bot Web

Local web app: **kết nối bền vững (stateful)** tới game qua Transport cắm được + Live Action Dispatcher + Script Runner (DSL `.ini`) + Web UI. Mặc định chỉ có `mock` (giả lập), không kết nối game thật.

## Chạy
```bash
npm install
npm run import-scripts        # (tuỳ chọn) chép Script/*.ini từ tool-reference vào data/scripts
npm run dev                   # server :8787 + web http://localhost:5173
# hoặc production: npm start  # build web rồi phục vụ tất cả ở http://127.0.0.1:8787
npm test
```
Server chỉ bind `127.0.0.1` (đổi bằng `HOST`, `PORT`, `DATA_DIR`). Chưa có xác thực nên đừng mở ra mạng.

## Kiến trúc
```
Login ─▶ GameConnection (1/tài khoản) ── heartbeat ──▶ Transport (driver)
          │  state: offline → connecting → online ⇄ reconnecting → offline
          ├─ dispatch(action, params)   Live Action Dispatcher (warp_map, move, chat, item, packet…)
          └─ runScript(script, vars)    Script Runner chạy TRÊN kết nối; xong/dừng vẫn ONLINE
```
Chỉ rời online khi **Logout** hoặc mất kết nối (rồi tự reconnect theo Cài đặt; hết lượt → offline kèm lỗi).

- `packages/protocol` – type dùng chung (REST/WS)
- `packages/engine` – parser DSL, interpreter, `GameConnection`, `liveActions`, Transport + MockTransport
- `packages/server` – Fastify REST `/api/*` + WebSocket `/ws`
- `apps/web` – Vite + React (tab: Kết nối · Kịch bản · Tạo kịch bản · Tài khoản · Cài đặt)
- `data/` – scripts (.ini), accounts.json (có mật khẩu, quyền 0600), servers.json, settings.json

## API
| | |
|---|---|
| `POST /api/connections/:accountId/login` `{transport?, speed?}` / `…/logout` | Vòng đời kết nối |
| `POST /api/connections/:accountId/dispatch` `{action, params}` | Lệnh trực tiếp, vd `{"action":"warp_map","params":{"mapId":12003}}` |
| `GET /api/actions` | Registry action (UI tự dựng form) |
| `POST …/script/run` `{scriptId, vars}`, `…/script/{pause,resume,stop}` | Script Runner |
| `GET /api/connections`, `…/:accountId/logs?after=` | Trạng thái, log |

WebSocket `/ws` (v=1): server đẩy `connection.upsert` (state, tên nhân vật, map, X/Y, HP/SP, script), `log`;
client gửi `subscribe`, `login`, `logout`, `dispatch`, `script.run`, `script.control` (kèm `requestId`, nhận `result`).

## Thêm action realtime mới
Thêm 1 entry vào `LIVE_ACTIONS` trong `packages/engine/src/runtime/liveActions.ts` (name, params, `toCommand`).
UI tự hiện form, API tự nhận; driver xử lý `GameCommand` tương ứng.

## Cắm driver của bạn
Implement `Transport` (`packages/engine/src/transport/Transport.ts`), export một `TransportDriver`, thêm vào
`packages/engine/src/transport/drivers/index.ts`. Driver cần: `connect` (đăng nhập bằng `ctx.credentials`, giữ kết nối),
xử lý Action `heartbeat`, gọi callback `onDisconnect` khi mất kết nối, cập nhật `getState()` (tên, map, X/Y, HP/SP) và gọi
callback `onState`. `packet <hex>` / action `packet` → `execute({type:"RawPacket", hex})`.

## Ngữ nghĩa DSL (suy ra từ script mẫu — cần bạn xác nhận)
Khối thụt lề: `loop N`, `if_map <op> <map>`. `end_event` = dừng script; `continue` = vòng lặp kế.
Biến `${tên:mặc định}` → ô nhập ở tab Kịch bản. Đối số tách bằng dấu phẩy/khoảng trắng; `chat_*` giữ nguyên dòng.

## TODO
- Trigger Timer/Quest theo giờ/sự kiện: `data/scripts/Timer`, `Quest` hiện chỉ chạy thủ công (cắm scheduler quanh `ConnectionManager.runScript`).
