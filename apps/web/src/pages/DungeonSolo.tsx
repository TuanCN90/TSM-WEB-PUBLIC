import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useLive } from "../live";
import type {
  DungeonSoloConfig,
  DungeonSoloPhase,
  DungeonSoloState,
  DungeonSoloType,
  WorldBossConfig,
  WorldBossPhase,
  WorldBossState,
} from "@tsbot/protocol";
import { DUNGEON_SOLO_CATALOG } from "@tsbot/protocol";

const EMPTY_SOLO: DungeonSoloConfig = {
  enabled: false,
  type: "all",
  bracket: 0,
  leaveParty: true,
  attempts: 1,
  autoBuyAttempts: false,
};

const EMPTY_BOSS: WorldBossConfig = {
  enabled: false,
  attempts: 7,
  autoRevive: true,
  useTickets: true,
  returnToTrain: true,
};

const PHASE_META: Record<DungeonSoloPhase, { text: string; cls: string }> = {
  idle: { text: "💤 Chờ lệnh", cls: "muted" },
  leaving_party: { text: "🤝 Đang rời đội", cls: "warn" },
  warping: { text: "🚶 Đang về Trác Quận", cls: "warn" },
  creating_room: { text: "🏗 Đang tạo phòng", cls: "warn" },
  entering: { text: "🚪 Đang bước qua cổng", cls: "warn" },
  in_dungeon: { text: "⚔️ Đang trong phó bản", cls: "ok" },
  done: { text: "🎉 Đã hoàn thành", cls: "ok" },
  error: { text: "❌ Lỗi", cls: "err" },
};

const BOSS_PHASE_META: Record<WorldBossPhase, { text: string; cls: string }> = {
  idle: { text: "💤 Chờ lệnh", cls: "muted" },
  leaving_party: { text: "🤝 Đang rời đội", cls: "warn" },
  preparing: { text: "🎒 Chuẩn bị & đổi pet", cls: "warn" },
  warping: { text: "🚶 Về Trác Quận (12001)", cls: "warn" },
  walking: { text: "🏃 Di chuyển tới Boss", cls: "warn" },
  healing: { text: "💊 Quét ăn HP/SP", cls: "warn" },
  using_ticket: { text: "🎫 Đang dùng Vé Khiêu Chiến (46629)", cls: "warn" },
  challenging: { text: "⚔️ Khiêu chiến Boss", cls: "warn" },
  in_battle: { text: "🔥 Đang đánh Boss", cls: "ok" },
  reviving: { text: "👻 Hồi sinh tại Quỷ Môn Quan", cls: "warn" },
  finishing: { text: "🏁 Hoàn tất & về bãi train", cls: "warn" },
  done: { text: "🎉 Đã hoàn thành 1 lượt", cls: "ok" },
  error: { text: "❌ Lỗi", cls: "err" },
};

const TYPE_NAMES: Record<string, string> = {
  khieu_chien: "🥊 Khiêu chiến Ba Đậu Yêu",
  san_kho_bau: "📦 Tìm bảo rương (Săn Kho Báu)",
  tim_dau_dau: "🔍 Tìm Ba Đậu Yêu (Tìm Đậu Đậu)",
  all: "🔄 Chuỗi cả 3 loại phó bản đơn",
};

export function DungeonSolo() {
  const { characters, selected } = useLive();
  const ch = selected ? characters[selected] : undefined;
  const st: DungeonSoloState | undefined = ch?.dungeonSolo;
  const stBoss: WorldBossState | undefined = ch?.worldBoss;

  const [activeTab, setActiveTab] = useState<"solo" | "world_boss">("solo");
  const [cfg, setCfg] = useState<DungeonSoloConfig>(EMPTY_SOLO);
  const [bossCfg, setBossCfg] = useState<WorldBossConfig>(EMPTY_BOSS);
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const saveBossTimer = useRef<ReturnType<typeof setTimeout>>();

  const sel = selected ?? "";

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    void api.dungeonSoloConfig(sel).then((c) => {
      if (!cancel && c) setCfg(c);
    }).catch(() => {});
    void api.worldBossConfig(sel).then((c) => {
      if (!cancel && c) setBossCfg(c);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [sel]);

  const update = (patch: Partial<DungeonSoloConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.saveDungeonSoloConfig(sel, next).catch(() => {});
    }, 400);
  };

  const updateBoss = (patch: Partial<WorldBossConfig>) => {
    const next = { ...bossCfg, ...patch };
    setBossCfg(next);
    clearTimeout(saveBossTimer.current);
    saveBossTimer.current = setTimeout(() => {
      void api.saveWorldBossConfig(sel, next).catch(() => {});
    }, 400);
  };

  const showToast = (text: string, type: "ok" | "err") => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const handleAction = async (act: "start" | "stop" | "exit") => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      if (act === "start") {
        await api.saveDungeonSoloConfig(sel, cfg);
      }
      const res = await api.dungeonSoloAction(sel, act);
      if (res.ok) {
        showToast(
          act === "start" ? "Đã bắt đầu chạy phó bản đơn" : act === "stop" ? "Đã dừng phó bản đơn" : "Đã thoát phó bản",
          "ok"
        );
      } else {
        showToast(res.message ?? "Thao tác thất bại", "err");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const handleBuy = async (dungeonId?: number) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const res = await api.dungeonSoloBuy(sel, dungeonId);
      if (res.ok) {
        showToast("Đã gửi yêu cầu mua thêm lượt phó bản thành công!", "ok");
      } else {
        showToast(res.message ?? "Mua lượt thất bại", "err");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const handleBossAction = async (act: "start" | "stop") => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      if (act === "start") {
        await api.saveWorldBossConfig(sel, bossCfg);
      }
      const res = await api.worldBossAction(sel, act);
      if (res.ok) {
        showToast(
          act === "start" ? "Đã bắt đầu săn Boss Thế Giới" : "Đã dừng săn Boss Thế Giới",
          "ok"
        );
      } else {
        showToast(res.message ?? "Thao tác thất bại", "err");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const isRunning = st && st.phase !== "idle" && st.phase !== "done" && st.phase !== "error";
  const isBossRunning = stBoss && stBoss.phase !== "idle" && stBoss.phase !== "done" && stBoss.phase !== "error";
  const inDungeon = !!ch && (
    (ch.location.map >= 62001 && ch.location.map <= 62010) ||
    st?.phase === "in_dungeon" ||
    st?.phase === "entering"
  );

  const phaseInfo = st?.phase ? (PHASE_META[st.phase] ?? { text: st.phase, cls: "muted" }) : PHASE_META.idle;
  const bossPhaseInfo = stBoss?.phase ? (BOSS_PHASE_META[stBoss.phase] ?? { text: stBoss.phase, cls: "muted" }) : BOSS_PHASE_META.idle;
  const charLv = ch?.player.level || 1;

  return (
    <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", height: "100%" }}>
      {/* Tab Selector: Solo Dungeon vs World Boss */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, background: "rgba(0, 0, 0, 0.2)", padding: 4, borderRadius: 8, border: "1px solid var(--border, rgba(255, 255, 255, 0.08))" }}>
          <button
            type="button"
            onClick={() => setActiveTab("solo")}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              background: activeTab === "solo" ? "var(--primary, #3b82f6)" : "transparent",
              color: activeTab === "solo" ? "#fff" : "var(--muted, #94a3b8)",
            }}
          >
            ⚔️ Phó Bản Đơn (1-2 Lượt)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("world_boss")}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              background: activeTab === "world_boss" ? "var(--primary, #3b82f6)" : "transparent",
              color: activeTab === "world_boss" ? "#fff" : "var(--muted, #94a3b8)",
            }}
          >
            🐉 Săn Boss Thế Giới (1 Lượt)
          </button>
        </div>

        {/* Phase chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              background:
                activeTab === "solo"
                  ? phaseInfo.cls === "ok" ? "rgba(34, 197, 94, 0.15)" : phaseInfo.cls === "err" ? "rgba(239, 68, 68, 0.15)" : phaseInfo.cls === "warn" ? "rgba(245, 158, 11, 0.15)" : "rgba(148, 163, 184, 0.12)"
                  : bossPhaseInfo.cls === "ok" ? "rgba(34, 197, 94, 0.15)" : bossPhaseInfo.cls === "err" ? "rgba(239, 68, 68, 0.15)" : bossPhaseInfo.cls === "warn" ? "rgba(245, 158, 11, 0.15)" : "rgba(148, 163, 184, 0.12)",
              color:
                activeTab === "solo"
                  ? phaseInfo.cls === "ok" ? "#22c55e" : phaseInfo.cls === "err" ? "#ef4444" : phaseInfo.cls === "warn" ? "#f59e0b" : "#94a3b8"
                  : bossPhaseInfo.cls === "ok" ? "#22c55e" : bossPhaseInfo.cls === "err" ? "#ef4444" : bossPhaseInfo.cls === "warn" ? "#f59e0b" : "#94a3b8",
              border: `1px solid ${
                activeTab === "solo"
                  ? phaseInfo.cls === "ok" ? "rgba(34, 197, 94, 0.3)" : phaseInfo.cls === "err" ? "rgba(239, 68, 68, 0.3)" : phaseInfo.cls === "warn" ? "rgba(245, 158, 11, 0.3)" : "rgba(148, 163, 184, 0.2)"
                  : bossPhaseInfo.cls === "ok" ? "rgba(34, 197, 94, 0.3)" : bossPhaseInfo.cls === "err" ? "rgba(239, 68, 68, 0.3)" : bossPhaseInfo.cls === "warn" ? "rgba(245, 158, 11, 0.3)" : "rgba(148, 163, 184, 0.2)"
              }`,
            }}
          >
            {activeTab === "solo" ? phaseInfo.text : bossPhaseInfo.text}
          </span>
        </div>
      </div>

      {toastMsg && (
        <div
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            fontSize: 13,
            background: toastMsg.type === "ok" ? "rgba(34, 197, 94, 0.18)" : "rgba(239, 68, 68, 0.18)",
            color: toastMsg.type === "ok" ? "#22c55e" : "#ef4444",
            border: `1px solid ${toastMsg.type === "ok" ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)"}`,
          }}
        >
          {toastMsg.text}
        </div>
      )}

      {activeTab === "solo" ? (
        <>
          {/* Main Control Card */}
          <div
            style={{
              background: "var(--card-bg, rgba(255, 255, 255, 0.04))",
              border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
              borderRadius: 8,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              {/* Cấu hình loại phó bản */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Loại phó bản đơn:</label>
                <select
                  value={cfg.type}
                  disabled={isRunning}
                  onChange={(e) => update({ type: e.target.value as DungeonSoloType })}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "var(--input-bg, #1e293b)",
                    color: "inherit",
                    border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                    fontSize: 13,
                  }}
                >
                  <option value="all">🔄 Chuỗi cả 3 loại (Khiêu chiến ➜ Kho báu ➜ Tìm đậu)</option>
                  <option value="khieu_chien">🥊 Khiêu chiến Ba Đậu Yêu</option>
                  <option value="san_kho_bau">📦 Tìm bảo rương (Săn Kho Báu)</option>
                  <option value="tim_dau_dau">🔍 Tìm Ba Đậu Yêu (Tìm Đậu Đậu)</option>
                </select>
              </div>

              {/* Cấu hình số lượt chạy */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Số lượt chạy mỗi ngày:</label>
                <select
                  value={cfg.attempts ?? 1}
                  disabled={isRunning}
                  onChange={(e) => update({ attempts: Number(e.target.value) })}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "var(--input-bg, #1e293b)",
                    color: "inherit",
                    border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                    fontSize: 13,
                  }}
                >
                  <option value={1}>1 lượt (Mặc định miễn phí 3 phó bản đơn)</option>
                  <option value={2}>2 lượt (Chạy 2 lần 3 phó bản đơn — tự động chạy vòng 2)</option>
                </select>
              </div>

              {/* Cấu hình mốc cấp độ */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Mốc cấp độ tham gia:</label>
                <select
                  value={cfg.bracket}
                  disabled={isRunning}
                  onChange={(e) => update({ bracket: Number(e.target.value) })}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "var(--input-bg, #1e293b)",
                    color: "inherit",
                    border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                    fontSize: 13,
                  }}
                >
                  <option value={0}>⚡ Tự động theo cấp nhân vật (Hiện tại: Cấp {charLv})</option>
                  <option value={1}>Mốc 1: Cấp 15 – 80</option>
                  <option value={2}>Mốc 2: Cấp 81 – 150</option>
                  <option value={3}>Mốc 3: Cấp 151 – 200</option>
                  <option value={4}>Mốc 4: Cấp 201 – 400</option>
                </select>
              </div>
            </div>

            {/* Checkbox options */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={cfg.leaveParty}
                  disabled={isRunning}
                  onChange={(e) => update({ leaveParty: e.target.checked })}
                />
                <span>Tự động rời đội trước khi vào (phó bản đơn không cho phép tổ đội)</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!cfg.autoBuyAttempts}
                  disabled={isRunning}
                  onChange={(e) => update({ autoBuyAttempts: e.target.checked })}
                />
                <span style={{ color: cfg.autoBuyAttempts ? "#38bdf8" : "inherit" }}>
                  Tự động mua thêm lượt khi hết lượt miễn phí (qua Thương Thành bằng Vàng/Xu)
                </span>
              </label>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid var(--border, rgba(255, 255, 255, 0.08))" }}>
              {!isRunning ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !sel}
                  onClick={() => void handleAction("start")}
                  style={{
                    padding: "8px 18px",
                    fontWeight: 600,
                    borderRadius: 6,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>▶</span> Bắt Đầu Phó Bản Đơn
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAction("stop")}
                  style={{
                    padding: "8px 18px",
                    fontWeight: 600,
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.2)",
                    color: "#ef4444",
                    border: "1px solid rgba(239, 68, 68, 0.5)",
                    cursor: "pointer",
                  }}
                >
                  <span>⏹</span> Dừng Lại
                </button>
              )}

              <button
                type="button"
                disabled={busy || !inDungeon}
                onClick={() => void handleAction("exit")}
                title="Thoát phó bản ngay lập tức về map cũ"
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  background: "rgba(148, 163, 184, 0.15)",
                  border: "1px solid rgba(148, 163, 184, 0.3)",
                  color: inDungeon ? "inherit" : "var(--muted, #888)",
                  cursor: inDungeon ? "pointer" : "default",
                }}
              >
                <span>🚪</span> Thoát Phó Bản
              </button>

              <button
                type="button"
                disabled={busy || !sel}
                onClick={() => void handleBuy()}
                title={cfg.type === "all" ? "Mua 1 lượt cho cả 3 phó bản đơn theo cấp nhân vật (10 Vàng × 3 = 30 Vàng)" : `Mua 1 lượt ${TYPE_NAMES[cfg.type] ?? "phó bản"} (10 Vàng)`}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  background: "rgba(56, 189, 248, 0.15)",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  color: "#38bdf8",
                  cursor: "pointer",
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>🛒</span> {cfg.type === "all" ? "Mua Lượt (Cả 3 PB Đơn)" : `Mua Lượt (${TYPE_NAMES[cfg.type]?.replace(/^[^\w\s]*\s*/, "") ?? "PB Đơn"})`}
              </button>
            </div>

            {/* Progress & Live Message */}
            {st && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 6,
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span>
                    <strong>Trạng thái:</strong> {st.message || phaseInfo.text}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {st.totalRounds && st.totalRounds > 1 && (
                      <span style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                        Lượt {st.currentRound || 1}/{st.totalRounds}
                      </span>
                    )}
                    {st.currentType && (
                      <span style={{ color: "#38bdf8" }}>
                        Đang chạy: <strong>{TYPE_NAMES[st.currentType] || st.currentType}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Completed badges */}
                {st.completedTypes && st.completedTypes.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    <span style={{ color: "var(--muted, #888)" }}>Đã hoàn tất:</span>
                    {st.completedTypes.map((t, idx) => (
                      <span
                        key={`${t}-${idx}`}
                        style={{
                          background: "rgba(34, 197, 94, 0.15)",
                          color: "#22c55e",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          border: "1px solid rgba(34, 197, 94, 0.3)",
                        }}
                      >
                        ✔ {TYPE_NAMES[t] || t}
                      </span>
                    ))}
                  </div>
                )}

                {/* EXP & Results Summary */}
                {st.results && st.results.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#38bdf8", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>📊</span> Thống kê thưởng EXP các ải vừa hoàn thành:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {st.results.map((res, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            background: "rgba(255, 255, 255, 0.03)",
                            border: "1px solid rgba(255, 255, 255, 0.05)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{res.name} ({res.durationSec}s)</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#22c55e" }}>
                            <span>
                              Nhân vật:{" "}
                              <strong>
                                {res.playerExpGained > 0
                                  ? `+${res.playerExpGained.toLocaleString("vi-VN")} EXP`
                                  : res.playerExpPercent > 0
                                  ? `+${res.playerExpPercent}% EXP`
                                  : "0 EXP"}
                              </strong>
                              {res.playerExpGained > 0 && res.playerExpPercent > 0 ? ` (+${res.playerExpPercent}%)` : ""}
                            </span>
                            {(res.petExpGained > 0 || res.petExpPercent > 0) && (
                              <span style={{ color: "#a855f7" }}>
                                Võ tướng:{" "}
                                <strong>
                                  {res.petExpGained > 0
                                    ? `+${res.petExpGained.toLocaleString("vi-VN")} EXP`
                                    : `+${res.petExpPercent}% EXP`}
                                </strong>
                                {res.petExpGained > 0 && res.petExpPercent > 0 ? ` (+${res.petExpPercent}%)` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Information Cards for the 3 solo dungeons */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
            <div
              style={{
                background: "var(--card-bg, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#f87171" }}>
                🥊 1. Khiêu chiến Ba Đậu Yêu
              </div>
              <div>• Map: 62001 (Cổng 1..4 theo mốc cấp độ)</div>
              <div>• Vào trận khiêu chiến solo với Ba Đậu Yêu.</div>
              <div>• Bot tự động đánh theo cấu hình võ tướng & kỹ năng. Thắng trận tự động nhận quà và hoàn thành.</div>
            </div>

            <div
              style={{
                background: "var(--card-bg, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#fbbf24" }}>
                📦 2. Tìm bảo rương (Săn Kho Báu)
              </div>
              <div>• Map: 62003..62006 (theo mốc cấp độ)</div>
              <div>• Bot tự di chuyển tới chính xác 3 rương báu trong map.</div>
              <div>• Tự động mở rương và nhặt toàn bộ phần thưởng trang bị, vật phẩm quý.</div>
            </div>

            <div
              style={{
                background: "var(--card-bg, rgba(255, 255, 255, 0.03))",
                border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#38bdf8" }}>
                🔍 3. Tìm Ba Đậu Yêu (Tìm Đậu Đậu)
              </div>
              <div>• Map: 62007..62010 (theo mốc cấp độ)</div>
              <div>• Bot di chuyển tiếp cận và đối thoại với 3 NPC Ba Đậu Yêu ẩn nấp.</div>
              <div>• Đánh thắng 3 Ba Đậu Yêu nhận exp và máy chủ tự động đưa về Trác Quận.</div>
            </div>
          </div>
        </>
      ) : (
        /* World Boss Panel */
        <div
          style={{
            background: "var(--card-bg, rgba(255, 255, 255, 0.04))",
            border: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
            borderRadius: 8,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 16, display: "flex", alignItems: "center", gap: 8, color: "#f59e0b" }}>
              <span>🐉</span> Tự Động Săn Boss Thế Giới (World Boss - 1 Lượt)
            </h3>
            <div style={{ color: "var(--muted, #888)", fontSize: 13, lineHeight: 1.5 }}>
              Chu trình 1 lượt: Tự rời đội (nếu có) → Dịch chuyển Trác Quận (12001) → Đi bộ tới (1910, 1190) → Quét ăn HP/SP theo cấu hình → Đối thoại khiêu chiến NPC 45 → Sau khi kết thúc trận đấu ghi nhận log sự kiện và hoàn tất.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            {/* Số trận săn boss */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Số trận săn Boss:</label>
                <span style={{ fontSize: 11, background: "rgba(34, 197, 94, 0.15)", color: "#22c55e", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>Active 1 lượt</span>
              </div>
              <select
                value={bossCfg.attempts}
                disabled={isBossRunning}
                onChange={(e) => updateBoss({ attempts: Number(e.target.value) })}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--input-bg, #1e293b)",
                  color: "inherit",
                  border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                  fontSize: 13,
                }}
              >
                <option value={1}>1 trận (Đang kích hoạt)</option>
                <option value={5} disabled>5 trận (Toàn bộ 5 lượt miễn phí) - [Coming Soon]</option>
                <option value={7} disabled>7 trận (5 lượt + 2 vé 46629) - [Coming Soon]</option>
              </select>
            </div>

            {/* Model Pet Săn Boss */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Võ tướng săn Boss (Tùy chọn Model ID):</label>
              <input
                type="number"
                placeholder="VD: 41387 (Ma Quan Vũ)"
                value={bossCfg.bossPetId ?? ""}
                disabled={isBossRunning}
                onChange={(e) => updateBoss({ bossPetId: e.target.value ? Number(e.target.value) : undefined })}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--input-bg, #1e293b)",
                  color: "inherit",
                  border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                  fontSize: 13,
                }}
              />
            </div>

            {/* VKCD Pet */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Vũ khí chuyên dụng Pet (Tùy chọn ID item):</label>
              <input
                type="number"
                placeholder="VD: 64541 (Thanh Long Đao)"
                value={bossCfg.bossPetWeapon ?? ""}
                disabled={isBossRunning}
                onChange={(e) => updateBoss({ bossPetWeapon: e.target.value ? Number(e.target.value) : undefined })}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--input-bg, #1e293b)",
                  color: "inherit",
                  border: "1px solid var(--border, rgba(255, 255, 255, 0.15))",
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          {/* Checkboxes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "not-allowed", fontSize: 13, opacity: 0.6 }}>
              <input
                type="checkbox"
                checked={false}
                disabled={true}
              />
              <span>Tự động dùng Vé Khiêu Chiến Boss (Item 46629) cho trận 6 & 7 <strong style={{ color: "#f59e0b" }}>[Coming Soon]</strong></span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={bossCfg.autoRevive}
                disabled={isBossRunning}
                onChange={(e) => updateBoss({ autoRevive: e.target.checked })}
              />
              <span>Tự động đối thoại hồi sinh tại Quỷ Môn Quan (Map 12007) nếu nhân vật tử vong</span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={bossCfg.returnToTrain}
                disabled={isBossRunning}
                onChange={(e) => updateBoss({ returnToTrain: e.target.checked })}
              />
              <span>Tự động quay về bản đồ và bãi train ban đầu sau khi kết thúc lượt đánh</span>
            </label>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid var(--border, rgba(255, 255, 255, 0.08))" }}>
            {!isBossRunning ? (
              <button
                type="button"
                className="primary"
                disabled={busy || !sel}
                onClick={() => void handleBossAction("start")}
                style={{
                  padding: "8px 18px",
                  fontWeight: 600,
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>▶</span> Bắt Đầu Săn Boss Thế Giới
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleBossAction("stop")}
                style={{
                  padding: "8px 18px",
                  fontWeight: 600,
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.2)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.5)",
                  cursor: "pointer",
                }}
              >
                <span>⏹</span> Dừng Săn Boss
              </button>
            )}
          </div>

          {/* Live Progress for Boss */}
          {stBoss && (
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                background: "rgba(0, 0, 0, 0.2)",
                border: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
                fontSize: 13,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span>
                  <strong>Trạng thái:</strong> {stBoss.message || bossPhaseInfo.text}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                    Tiến độ: {stBoss.currentAttempt}/{stBoss.totalAttempts} trận
                  </span>
                  {stBoss.ticketsUsed > 0 && (
                    <span style={{ background: "rgba(168, 85, 247, 0.15)", color: "#a855f7", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                      Đã dùng: {stBoss.ticketsUsed}x vé 46629
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
