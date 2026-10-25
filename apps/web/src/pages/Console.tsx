import { SessionTabs } from "../components/SessionTabs";
import { useToast } from "../components/Toast";
import { LIMIT_MSG, MAX_SESSIONS, useSessions } from "../sessions";
import { Home } from "./Home";

/** Bảng điều khiển đa tài khoản: cột tab dọc bên trái + màn hình điều khiển của tab đang chọn (mỗi tab giữ state riêng theo accountId). */
export function Console() {
  const { active, sessions, add } = useSessions();
  const toast = useToast();
  return (
    <div className="console">
      <SessionTabs />
      <div className="console-main">
        {active ? <Home key={active.key} session={active} /> : (
          <div className="card empty-console">
            <h2>Chưa có tài khoản nào</h2>
            <p className="muted">Tạo một phiên mới để đăng nhập và treo game (tối đa {MAX_SESSIONS} tài khoản đồng thời).</p>
            <button className="primary" disabled={sessions.length >= MAX_SESSIONS} onClick={() => { if (!add()) toast("error", LIMIT_MSG); }}>+ Thêm tài khoản</button>
          </div>
        )}
      </div>
    </div>
  );
}
