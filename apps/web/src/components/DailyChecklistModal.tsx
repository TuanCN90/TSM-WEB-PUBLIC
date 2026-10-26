import { useEffect, useState } from "react";
import { DAILY_CHECKLIST_CATALOG, type DailyChecklistState } from "@tsbot/protocol";
import { api } from "../api";
import { useLive } from "../live";

interface DailyChecklistModalProps {
  open: boolean;
  onClose: () => void;
  selectedAccountId?: string;
}

export function DailyChecklistModal({ open, onClose, selectedAccountId }: DailyChecklistModalProps) {
  const { characters, selected } = useLive();
  const accountList = Object.keys(characters);
  const [activeAccount, setActiveAccount] = useState<string>(selectedAccountId || selected || accountList[0] || "");
  const [state, setState] = useState<DailyChecklistState | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Cập nhật tài khoản khi đổi selected từ bên ngoài
  useEffect(() => {
    if (selectedAccountId) setActiveAccount(selectedAccountId);
    else if (selected && !activeAccount) setActiveAccount(selected);
    else if (!activeAccount && accountList[0]) setActiveAccount(accountList[0]);
  }, [selectedAccountId, selected, accountList]);

  // Load checklist từ server khi mở popup hoặc đổi tài khoản
  useEffect(() => {
    if (!open || !activeAccount) return;
    let cancel = false;
    setLoading(true);

    api.dailyChecklist(activeAccount)
      .then((st) => {
        if (!cancel) setState(st);
      })
      .catch((err) => {
        console.error("Lỗi tải Daily Checklist:", err);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => {
      cancel = true;
    };
  }, [open, activeAccount]);

  // Đồng bộ thời gian thực từ live state nếu có character update
  useEffect(() => {
    if (activeAccount && characters[activeAccount]?.dailyChecklist) {
      setState(characters[activeAccount].dailyChecklist!);
    }
  }, [activeAccount, characters]);

  if (!open) return null;

  const handleToggle = async (key: string) => {
    if (!activeAccount) return;
    try {
      const updated = await api.dailyChecklistToggle(activeAccount, key);
      setState(updated);
    } catch (e) {
      console.error("Lỗi toggle checklist item:", e);
    }
  };

  const handleProgress = async (key: string) => {
    if (!activeAccount) return;
    try {
      const updated = await api.dailyChecklistProgress(activeAccount, key, 1);
      setState(updated);
    } catch (e) {
      console.error("Lỗi cập nhật tiến độ:", e);
    }
  };

  const handleRunAction = async (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    if (!activeAccount || actionLoading[key]) return;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      if (key === "gift_friend") {
        await api.friendGift(activeAccount);
      } else if (key === "checkin") {
        await api.dispatch(activeAccount, "daily_checkin");
      } else if (key === "onlineReward") {
        await api.dispatch(activeAccount, "online_reward_all");
      } else if (key === "pull_secret") {
        await api.dispatch(activeAccount, "pull_secret");
      } else if (key === "pull_card") {
        await api.dispatch(activeAccount, "pull_card");
      } else if (key === "pull_all") {
        await api.dispatch(activeAccount, "pull_all");
      } else if (key === "escort") {
        await api.escortRun(activeAccount);
      }
      const updated = await api.dailyChecklist(activeAccount);
      setState(updated);
    } catch (err) {
      console.error(`Lỗi thực hiện ${key}:`, err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const items = state?.items || {};
  const totalCompleted = DAILY_CHECKLIST_CATALOG.filter((def) => items[def.key]?.done).length;
  const progressPct = Math.round((totalCompleted / DAILY_CHECKLIST_CATALOG.length) * 100);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "90vh",
          background: "var(--card-bg, #0f172a)",
          border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(0, 0, 0, 0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>📋</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <span>Checklist Daily (Nhiệm Vụ Hàng Ngày)</span>
                <span style={{ fontSize: 11, background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                  Reset 00:00 TW (UTC+8)
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted, #94a3b8)" }}>
                Ngày: {state?.dateKey || "Hôm nay"} • Đã hoàn tất {totalCompleted}/{DAILY_CHECKLIST_CATALOG.length} mục ({progressPct}%)
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted, #94a3b8)",
              fontSize: 20,
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {/* Account Selector + Progress Bar */}
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border, rgba(255, 255, 255, 0.06))", display: "flex", flexDirection: "column", gap: 10, background: "rgba(0, 0, 0, 0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Tài khoản:</span>
              <select
                value={activeAccount}
                onChange={(e) => setActiveAccount(e.target.value)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "var(--input-bg, #1e293b)",
                  color: "inherit",
                  border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {accountList.length === 0 ? (
                  <option value="">(Chưa có tài khoản online)</option>
                ) : (
                  accountList.map((acc) => (
                    <option key={acc} value={acc}>
                      {characters[acc]?.player.name || acc} ({acc})
                    </option>
                  ))
                )}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                  color: "#fff",
                  border: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: actionLoading["pull_all"] ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  opacity: actionLoading["pull_all"] ? 0.7 : 1,
                }}
                disabled={actionLoading["pull_all"]}
                onClick={(e) => void handleRunAction(e, "pull_all")}
                title="Rút 1 bí cấp tướng và 1 thẻ tướng (tiêu tổng cộng 18.000 Xu)"
              >
                <span>✨</span>
                <span>{actionLoading["pull_all"] ? "Đang rút..." : "Rút Bí Cấp & Thẻ (18k xu)"}</span>
              </button>
              <div style={{ fontSize: 12, color: "var(--muted, #94a3b8)" }}>
                * Bấm vào từng mục để tick / chuyển đổi trạng thái thủ công
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ width: "100%", height: 6, background: "rgba(255, 255, 255, 0.08)", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: progressPct === 100 ? "#22c55e" : "var(--primary, #3b82f6)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Checklist Items list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
          {loading && !state ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--muted, #94a3b8)" }}>Đang tải danh sách nhiệm vụ ngày...</div>
          ) : (
            DAILY_CHECKLIST_CATALOG.map((def) => {
              const itemState = items[def.key] || { currentCount: 0, done: false };
              const isDone = itemState.done || itemState.currentCount >= def.maxCount;

              return (
                <div
                  key={def.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: isDone ? "rgba(34, 197, 94, 0.08)" : "rgba(255, 255, 255, 0.03)",
                    border: `1px solid ${isDone ? "rgba(34, 197, 94, 0.3)" : "rgba(255, 255, 255, 0.06)"}`,
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                  onClick={() => void handleToggle(def.key)}
                  title={`${def.description || def.title} (Bấm để đổi trạng thái)`}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Checkbox icon */}
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        border: `2px solid ${isDone ? "#22c55e" : "rgba(255, 255, 255, 0.25)"}`,
                        background: isDone ? "#22c55e" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {isDone ? "✓" : ""}
                    </div>

                    {/* Title */}
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: isDone ? "#22c55e" : "inherit",
                          textDecoration: isDone ? "none" : "none",
                        }}
                      >
                        {def.title}
                      </div>
                      {def.description && (
                        <div style={{ fontSize: 11, color: "var(--muted, #94a3b8)" }}>{def.description}</div>
                      )}
                    </div>
                  </div>

                  {/* Right side: Stars / Count indicator + Tag */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Render Stars for multi-count items */}
                    {def.maxCount > 1 && (
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 4 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleProgress(def.key);
                        }}
                        title="Bấm để tăng thêm 1 lần hoàn thành"
                      >
                        {Array.from({ length: def.maxCount }).map((_, idx) => {
                          const starLit = idx < itemState.currentCount;
                          return (
                            <span
                              key={idx}
                              style={{
                                fontSize: 16,
                                color: starLit ? "#f59e0b" : "rgba(255, 255, 255, 0.2)",
                                transition: "color 0.2s ease",
                              }}
                            >
                              ★
                            </span>
                          );
                        })}
                        <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)", marginLeft: 2 }}>
                          ({itemState.currentCount}/{def.maxCount})
                        </span>
                      </div>
                    )}

                    {/* Action button if available */}
                    {def.key === "gift_friend" && (
                      <button
                        type="button"
                        style={{
                          padding: "3px 10px",
                          borderRadius: 6,
                          background: isDone ? "rgba(255, 255, 255, 0.08)" : "#3b82f6",
                          color: "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: actionLoading[def.key] ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          opacity: actionLoading[def.key] ? 0.7 : 1,
                        }}
                        disabled={actionLoading[def.key]}
                        onClick={(e) => void handleRunAction(e, def.key)}
                        title="Tặng quà cho tất cả bạn bè và nhận tất cả quà gửi lại"
                      >
                        {actionLoading[def.key] ? "Đang gửi..." : "🎁 Tặng & Nhận"}
                      </button>
                    )}
                    {!isDone && def.key === "checkin" && (
                      <button
                        type="button"
                        style={{
                          padding: "3px 10px",
                          borderRadius: 6,
                          background: "#3b82f6",
                          color: "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: actionLoading[def.key] ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          opacity: actionLoading[def.key] ? 0.7 : 1,
                        }}
                        disabled={actionLoading[def.key]}
                        onClick={(e) => void handleRunAction(e, def.key)}
                        title="Điểm danh ngay cho tài khoản này"
                      >
                        {actionLoading[def.key] ? "Đang điểm danh..." : "📅 Điểm danh"}
                      </button>
                    )}
                    {!isDone && def.key === "onlineReward" && (
                      <button
                        type="button"
                        style={{
                          padding: "3px 10px",
                          borderRadius: 6,
                          background: "#3b82f6",
                          color: "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: actionLoading[def.key] ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          opacity: actionLoading[def.key] ? 0.7 : 1,
                        }}
                        disabled={actionLoading[def.key]}
                        onClick={(e) => void handleRunAction(e, def.key)}
                        title="Nhận toàn bộ mốc quà Online đã đủ điều kiện"
                      >
                        {actionLoading[def.key] ? "Đang nhận..." : "🎁 Nhận quà"}
                      </button>
                    )}
                    {!isDone && def.key === "pull_secret" && (
                      <button
                        type="button"
                        style={{
                          padding: "3px 10px",
                          borderRadius: 6,
                          background: "#8b5cf6",
                          color: "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: actionLoading[def.key] ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          opacity: actionLoading[def.key] ? 0.7 : 1,
                        }}
                        disabled={actionLoading[def.key]}
                        onClick={(e) => void handleRunAction(e, def.key)}
                        title="Rút 1 bí cấp tướng (tiêu 9.000 Xu)"
                      >
                        {actionLoading[def.key] ? "Đang rút..." : "📜 Rút (9k xu)"}
                      </button>
                    )}
                    {!isDone && def.key === "pull_card" && (
                      <button
                        type="button"
                        style={{
                          padding: "3px 10px",
                          borderRadius: 6,
                          background: "#ec4899",
                          color: "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: actionLoading[def.key] ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          opacity: actionLoading[def.key] ? 0.7 : 1,
                        }}
                        disabled={actionLoading[def.key]}
                        onClick={(e) => void handleRunAction(e, def.key)}
                        title="Rút 1 thẻ chiêu mộ võ tướng (tiêu 9.000 Xu)"
                      >
                        {actionLoading[def.key] ? "Đang rút..." : "🃏 Rút (9k xu)"}
                      </button>
                    )}
                    {!isDone && def.key === "escort" && (
                      <button
                        type="button"
                        style={{
                          padding: "3px 10px",
                          borderRadius: 6,
                          background: "var(--accent, #6366f1)",
                          color: "#fff",
                          border: "none",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: actionLoading[def.key] ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          opacity: actionLoading[def.key] ? 0.7 : 1,
                        }}
                        disabled={actionLoading[def.key]}
                        onClick={(e) => void handleRunAction(e, def.key)}
                        title="Cử võ tướng được chỉ định trong Nhà Trọ xuất phát vận tiêu"
                      >
                        {actionLoading[def.key] ? "Đang gửi..." : "🐎 Vận tiêu"}
                      </button>
                    )}

                    {/* Status Badge */}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: isDone ? "rgba(34, 197, 94, 0.15)" : "rgba(148, 163, 184, 0.12)",
                        color: isDone ? "#22c55e" : "#94a3b8",
                        border: `1px solid ${isDone ? "rgba(34, 197, 94, 0.3)" : "rgba(148, 163, 184, 0.2)"}`,
                        minWidth: 70,
                        textAlign: "center",
                      }}
                    >
                      {isDone ? "Đã hoàn tất" : "Chưa xong"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(0, 0, 0, 0.2)",
            fontSize: 12,
            color: "var(--muted, #94a3b8)",
          }}
        >
          <div>
            Hệ thống tự động đồng bộ khi thực hiện: Điểm danh, Quà Online, Phó bản đơn/đội, Săn Boss.
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              background: "var(--primary, #3b82f6)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
