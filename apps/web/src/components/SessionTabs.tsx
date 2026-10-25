import type { ConnectionInfo } from "@tsbot/protocol";
import { useState } from "react";
import { api } from "../api";
import { useLive } from "../live";
import { useSessions, type Session } from "../sessions";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toast";

/** Màu chấm: xanh = Online, vàng = đang kết nối, đỏ = lỗi login/mất kết nối, xám = Disconnected. */
const dotOf = (c?: ConnectionInfo): { cls: string; tip: string } =>
  c?.state === "online" ? { cls: "on", tip: "Online" }
  : c && c.state !== "offline" ? { cls: "wait", tip: "Đang kết nối…" }
  : c?.error ? { cls: "err", tip: `Lỗi: ${c.error}` }
  : { cls: "off", tip: "Disconnected" };

const COLLAPSE_KEY = "tsbot.sessionTabs.collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

function computeTargetIndex(fromIndex: number, hoverIndex: number, position: "top" | "bottom"): number {
  if (position === "top") {
    return fromIndex < hoverIndex ? hoverIndex - 1 : hoverIndex;
  } else {
    return fromIndex < hoverIndex ? hoverIndex : hoverIndex + 1;
  }
}

/** Cột tab tài khoản dọc ở lề trái: chuyển tab không ngắt socket của tab khác. Hỗ trợ kéo thả đổi thứ tự. Thu gọn được (chỉ còn chấm trạng thái + 2 ký tự đầu). */
export function SessionTabs() {
  const { sessions, active, activate, close, reorder, loginAll, loggingAll, loginProgress, offlineTargets, logoutAll, loggingOutAll, onlineCount } = useSessions();
  const { connections, characters } = useLive();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Session | null>(null);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dropPos, setDropPos] = useState<"top" | "bottom" | null>(null);
  const toggle = () => setCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* private mode: bỏ qua */ }
    return next;
  });

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

  const doClose = async (s: Session) => {
    if (s.accountId) {
      try { await api.logout(s.accountId); } catch (e) { toast("error", e instanceof Error ? e.message : String(e)); }
    }
    close(s.key);
  };
  const req = (s: Session) => {
    const c = connections.find((x) => x.accountId === s.accountId);
    if (c && c.state !== "offline") setConfirm(s); else close(s.key);
  };

  return (
    <aside className={`stabs ${collapsed ? "collapsed" : ""}`} aria-label="Tài khoản">
      <div className="stabs-head">
        {!collapsed && <b>Tài khoản</b>}
        {!collapsed && <span className="muted small">{sessions.length}/15</span>}
        <button type="button" className="stabs-toggle" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? "Mở rộng danh sách tài khoản" : "Thu gọn về lề trái"}>
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <div style={{ padding: "6px 8px 6px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5 }}>
        <button
          type="button"
          className="primary"
          disabled={loggingAll || offlineTargets.length === 0}
          onClick={() => void handleLoginAll()}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "5px 8px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            cursor: loggingAll || offlineTargets.length === 0 ? "default" : "pointer",
            background: offlineTargets.length === 0 ? "var(--bg-subtle, rgba(255,255,255,0.04))" : undefined,
            color: offlineTargets.length === 0 ? "var(--muted)" : undefined,
            border: offlineTargets.length === 0 ? "1px solid var(--line)" : undefined,
            transition: "all 0.2s ease",
          }}
          title={
            loggingAll
              ? `Đang đăng nhập tuần tự (${loginProgress?.done ?? 0}/${loginProgress?.total ?? 0})`
              : offlineTargets.length > 0
              ? `Đăng nhập tuần tự ${offlineTargets.length} tài khoản đang offline (giãn cách an toàn 1.5s)`
              : "Tất cả tài khoản đều đã online"
          }
        >
          {loggingAll ? (
            <>
              <span className="spin" style={{ width: 10, height: 10 }} />
              {!collapsed && <span>Login {loginProgress?.done ?? 0}/{loginProgress?.total ?? 0}…</span>}
            </>
          ) : offlineTargets.length === 0 ? (
            <span>{collapsed ? "✓" : `✓ Đã online (${sessions.length})`}</span>
          ) : (
            <>
              <span>⚡</span>
              {!collapsed && <span>Login Tất Cả ({offlineTargets.length})</span>}
            </>
          )}
        </button>
        <button
          type="button"
          disabled={loggingOutAll || onlineCount === 0}
          onClick={() => setConfirmLogoutAll(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "5px 8px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            cursor: loggingOutAll || onlineCount === 0 ? "default" : "pointer",
            background: onlineCount > 0 ? "rgba(239, 68, 68, 0.12)" : "var(--bg-subtle, rgba(255,255,255,0.04))",
            color: onlineCount > 0 ? "var(--bad, #ef4444)" : "var(--muted)",
            border: onlineCount > 0 ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid var(--line)",
            transition: "all 0.2s ease",
          }}
          title={
            loggingOutAll
              ? "Đang đăng xuất toàn bộ tài khoản…"
              : onlineCount > 0
              ? `Đăng xuất an toàn ${onlineCount} tài khoản đang online (tự động commit kho/túi đồ)`
              : "Không có tài khoản nào đang online"
          }
        >
          {loggingOutAll ? (
            <>
              <span className="spin" style={{ width: 10, height: 10 }} />
              {!collapsed && <span>Đang logout…</span>}
            </>
          ) : (
            <>
              <span>🚪</span>
              {!collapsed && <span>Logout Tất Cả {onlineCount > 0 ? `(${onlineCount})` : ""}</span>}
            </>
          )}
        </button>
      </div>
      <div className="stabs-list" role="tablist" aria-orientation="vertical">
        {sessions.length === 0 && <div className="muted small pad">Chưa có tab. Bấm “+ Thêm tài khoản”.</div>}
        {sessions.map((s, i) => {
          const c = connections.find((x) => x.accountId === s.accountId);
          const d = dotOf(c);
          const char = s.accountId ? characters[s.accountId] : undefined;
          const charName = char?.player.name;
          const isChasing = !!char?.chaseConfig?.enabled;
          const name = (c?.state === "online" && charName) || s.username || `Tab ${i + 1}`;
          const isDragging = draggedIdx === i;
          const isOverTop = dragOverIdx === i && dropPos === "top";
          const isOverBottom = dragOverIdx === i && dropPos === "bottom";

          return (
            <div
              key={s.key}
              role="tab"
              aria-selected={active?.key === s.key}
              tabIndex={0}
              draggable
              className={`stab ${active?.key === s.key ? "on" : ""} ${isDragging ? "dragging" : ""} ${isOverTop ? "drag-over-top" : ""} ${isOverBottom ? "drag-over-bottom" : ""}`}
              onClick={() => activate(s.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") activate(s.key);
              }}
              onDragStart={(e) => {
                setDraggedIdx(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggedIdx === null || draggedIdx === i) {
                  if (dragOverIdx !== null) setDragOverIdx(null);
                  if (dropPos !== null) setDropPos(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const pos = e.clientY < midY ? "top" : "bottom";
                if (dragOverIdx !== i || dropPos !== pos) {
                  setDragOverIdx(i);
                  setDropPos(pos);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOverIdx === i) {
                    setDragOverIdx(null);
                    setDropPos(null);
                  }
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedIdx !== null && draggedIdx !== i && dropPos) {
                  const targetIdx = computeTargetIndex(draggedIdx, i, dropPos);
                  if (targetIdx !== draggedIdx) {
                    reorder(draggedIdx, targetIdx);
                  }
                }
                setDraggedIdx(null);
                setDragOverIdx(null);
                setDropPos(null);
              }}
              onDragEnd={() => {
                setDraggedIdx(null);
                setDragOverIdx(null);
                setDropPos(null);
              }}
              title={`${name} — ${d.tip}${isChasing ? " (🎯 Đang bật truy kích)" : ""} • Kéo thả để đổi thứ tự`}
            >
              {!collapsed && (
                <span className="sgrab" title="Kéo thả để di chuyển thứ tự">
                  ⋮⋮
                </span>
              )}
              <i className={`sdot ${d.cls}`} aria-label={d.tip} />
              <span className="sname">{collapsed ? Array.from(name).slice(0, 2).join("") : name}</span>
              {isChasing && !collapsed && (
                <span
                  style={{
                    fontSize: 11,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginLeft: 2,
                  }}
                  title={`Đang bật chế độ truy kích quái${char?.chaseConfig?.npcName ? ` [${char.chaseConfig.npcName}]` : ""}`}
                >
                  🎯
                </span>
              )}
              {!collapsed && (
                <button
                  className="sx"
                  draggable={false}
                  aria-label={`Đóng ${name}`}
                  title="Đóng tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    req(s);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      {confirm && (
        <ConfirmDialog title="Đóng tài khoản đang online?" danger okLabel="Logout & đóng"
          body={<>Tài khoản <b>{confirm.username || "này"}</b> đang online. Đóng tab sẽ <b>đăng xuất</b> khỏi game.</>}
          onOk={() => { const s = confirm; setConfirm(null); void doClose(s); }} onCancel={() => setConfirm(null)} />
      )}
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
    </aside>
  );
}
