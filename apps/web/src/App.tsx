import { useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DailyChecklistModal } from "./components/DailyChecklistModal";
import { TaiwanClock } from "./components/TaiwanClock";
import { useLive } from "./live";
import { Console } from "./pages/Console";
import { Overview } from "./pages/Overview";
import { useToast } from "./components/Toast";
import { LIMIT_MSG, MAX_SESSIONS, useSessions } from "./sessions";
import { ScriptsHub } from "./pages/ScriptsHub";
import { SettingsPage } from "./pages/Settings";
import { TrainMapPage } from "./pages/TrainMapPage";

const TABS = [
  ["console", "Điều khiển"],
  ["scripts", "Kịch bản"],
  ["train", "Bãi Train"],
  ["settings", "Cài đặt"],
] as const;
type Tab = "home" | (typeof TABS)[number][0];

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const { connected } = useLive();
  const { sessions, add, loginAll, loggingAll, loginProgress, offlineTargets, logoutAll, loggingOutAll, onlineCount } = useSessions();
  const toast = useToast();
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [showDailyChecklist, setShowDailyChecklist] = useState(false);
  const full = sessions.length >= MAX_SESSIONS;
  const addAccount = () => {
    if (!add()) { toast("error", LIMIT_MSG); return; }
    setTab("console");
  };

  const handleLoginAll = async () => {
    if (offlineTargets.length === 0) {
      toast("info", "Tất cả tài khoản đều đã online!");
      return;
    }
    toast("info", `⚡ Đang bắt đầu đăng nhập tự động ${offlineTargets.length} tài khoản...`);
    const res = await loginAll();
    if (res) {
      if (res.failed === 0) {
        toast("ok", `✓ Đã đăng nhập thành công toàn bộ ${res.success} tài khoản!`);
      } else {
        toast("error", `Đăng nhập xong: ${res.success} thành công, ${res.failed} thất bại.`);
      }
    }
  };

  const handleLogoutAll = async () => {
    setConfirmLogoutAll(false);
    toast("info", "🚪 Đang tiến hành đăng xuất tất cả tài khoản...");
    const res = await logoutAll();
    if (res) {
      toast("ok", `✓ Đã đăng xuất an toàn toàn bộ ${res.count} tài khoản.`);
    }
  };

  return (
    <div className="app">
      <header>
        <h1
          className={`brand ${tab === "home" ? "on" : ""}`}
          style={{ cursor: "pointer", userSelect: "none" }}
          onClick={() => setTab("home")}
          title="Trang chủ: Thông tin & Tiến độ dự án"
        >
          <img src="/badau-demon.png" alt="Ba Đậu Yêu Ác Ma" className="brand-icon" />
          TS Bot Web
        </h1>
        <nav>
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
          ))}
        </nav>
        <div className="status">
          {!connected && <span className="wsdown" title="Mất kết nối tới backend — dữ liệu trên màn hình có thể đã cũ"><span className="dot bad" />Mất kết nối server</span>}
          <TaiwanClock />
          <button
            type="button"
            className="btn-checklist-daily"
            title="Xem danh sách nhiệm vụ ngày và tiến độ hoàn thành (Reset 00:00 TW)"
            onClick={() => setShowDailyChecklist(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              background: "rgba(245, 158, 11, 0.15)",
              color: "#f59e0b",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              cursor: "pointer",
            }}
          >
            <span>📋</span>
            <span>Checklist Daily</span>
          </button>
          <button
            type="button"
            className="btn-login-all"
            disabled={loggingAll || offlineTargets.length === 0}
            title={
              loggingAll
                ? `Đang đăng nhập tuần tự (${loginProgress?.done ?? 0}/${loginProgress?.total ?? 0})`
                : offlineTargets.length > 0
                ? `Đăng nhập tuần tự ${offlineTargets.length} tài khoản đang offline`
                : "Tất cả tài khoản đều đã online"
            }
            onClick={() => void handleLoginAll()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              background: offlineTargets.length > 0 ? "var(--accent-soft, rgba(56, 189, 248, 0.15))" : "transparent",
              color: offlineTargets.length > 0 ? "var(--accent-ink, #38bdf8)" : "var(--muted)",
              border: offlineTargets.length > 0 ? "1px solid var(--accent, #38bdf8)" : "1px solid var(--line)",
              cursor: loggingAll || offlineTargets.length === 0 ? "default" : "pointer",
            }}
          >
            {loggingAll ? (
              <>
                <span className="spin" style={{ width: 11, height: 11 }} />
                <span>Login {loginProgress?.done ?? 0}/{loginProgress?.total ?? 0}…</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Login Tất Cả {offlineTargets.length > 0 ? `(${offlineTargets.length})` : ""}</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="btn-logout-all"
            disabled={loggingOutAll || onlineCount === 0}
            title={
              loggingOutAll
                ? "Đang đăng xuất toàn bộ tài khoản…"
                : onlineCount > 0
                ? `Đăng xuất an toàn ${onlineCount} tài khoản đang online (tự động commit kho/túi đồ)`
                : "Không có tài khoản nào đang online"
            }
            onClick={() => setConfirmLogoutAll(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              background: onlineCount > 0 ? "rgba(239, 68, 68, 0.12)" : "transparent",
              color: onlineCount > 0 ? "var(--bad, #ef4444)" : "var(--muted)",
              border: onlineCount > 0 ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid var(--line)",
              cursor: loggingOutAll || onlineCount === 0 ? "default" : "pointer",
            }}
          >
            {loggingOutAll ? (
              <>
                <span className="spin" style={{ width: 11, height: 11 }} />
                <span>Đang logout…</span>
              </>
            ) : (
              <>
                <span>🚪</span>
                <span>Logout Tất Cả {onlineCount > 0 ? `(${onlineCount})` : ""}</span>
              </>
            )}
          </button>
          <button className="primary addacc" disabled={full} title={full ? LIMIT_MSG : "Tạo phiên tài khoản mới"} onClick={addAccount}>+ Thêm tài khoản</button>
        </div>
      </header>
      <main>
        {tab === "home" && <Overview onStart={() => setTab("console")} onGo={setTab} />}
        {tab === "console" && <Console />}
        {tab === "scripts" && <ScriptsHub />}
        {tab === "train" && <TrainMapPage />}
        {tab === "settings" && <SettingsPage />}
      </main>
      {confirmLogoutAll && (
        <ConfirmDialog
          title="Đăng xuất tất cả tài khoản?"
          danger
          okLabel="Đăng xuất tất cả"
          body={
            <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <p>Bạn có chắc muốn đăng xuất toàn bộ <b>{onlineCount} tài khoản</b> đang online không?</p>
              <p style={{ color: "var(--muted)", fontSize: 12 }}>
                ✓ Hệ thống sẽ tự động đóng kho và cam kết lưu dữ liệu túi đồ trước khi ngắt kết nối để chống rollback vật phẩm.
              </p>
            </div>
          }
          onOk={() => void handleLogoutAll()}
          onCancel={() => setConfirmLogoutAll(false)}
        />
      )}
      <DailyChecklistModal
        open={showDailyChecklist}
        onClose={() => setShowDailyChecklist(false)}
      />
    </div>
  );
}
