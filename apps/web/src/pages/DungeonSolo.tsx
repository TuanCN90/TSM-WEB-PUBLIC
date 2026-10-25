import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useLive } from "../live";
import type { DungeonSoloConfig, DungeonSoloPhase, DungeonSoloState, DungeonSoloType } from "@tsbot/protocol";
import { DUNGEON_SOLO_CATALOG } from "@tsbot/protocol";

const EMPTY: DungeonSoloConfig = {
  enabled: false,
  type: "all",
  bracket: 0,
  leaveParty: true,
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

  const [cfg, setCfg] = useState<DungeonSoloConfig>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const sel = selected ?? "";

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    void api.dungeonSoloConfig(sel).then((c) => {
      if (!cancel && c) setCfg(c);
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

  const isRunning = st && st.phase !== "idle" && st.phase !== "done" && st.phase !== "error";
  const inDungeon = !!ch && (
    (ch.location.map >= 62001 && ch.location.map <= 62010) ||
    st?.phase === "in_dungeon" ||
    st?.phase === "entering"
  );

  const phaseInfo = st?.phase ? (PHASE_META[st.phase] ?? { text: st.phase, cls: "muted" }) : PHASE_META.idle;
  const charLv = ch?.player.level || 1;

  return (
    <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", height: "100%" }}>
      {/* Header & Status Card */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: "0 0 4px 0", fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚔️</span> Phó Bản Đơn (Solo Dungeon)
          </h2>
          <div style={{ color: "var(--muted, #888)", fontSize: 13 }}>
            Tự động đi 3 loại phó bản đơn mỗi ngày: Khiêu chiến Ba Đậu Yêu, Săn Kho Báu, Tìm Đậu Đậu theo chuẩn TSM / tool gốc.
          </div>
        </div>

        {/* Phase chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              background: phaseInfo.cls === "ok" ? "rgba(34, 197, 94, 0.15)" : phaseInfo.cls === "err" ? "rgba(239, 68, 68, 0.15)" : phaseInfo.cls === "warn" ? "rgba(245, 158, 11, 0.15)" : "rgba(148, 163, 184, 0.12)",
              color: phaseInfo.cls === "ok" ? "#22c55e" : phaseInfo.cls === "err" ? "#ef4444" : phaseInfo.cls === "warn" ? "#f59e0b" : "#94a3b8",
              border: `1px solid ${phaseInfo.cls === "ok" ? "rgba(34, 197, 94, 0.3)" : phaseInfo.cls === "err" ? "rgba(239, 68, 68, 0.3)" : phaseInfo.cls === "warn" ? "rgba(245, 158, 11, 0.3)" : "rgba(148, 163, 184, 0.2)"}`,
            }}
          >
            {phaseInfo.text}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
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
              <option value="all">🔄 Chuỗi cả 3 loại (Daily Runner: Khiêu chiến ➜ Kho báu ➜ Tìm đậu)</option>
              <option value="khieu_chien">🥊 Khiêu chiến Ba Đậu Yêu</option>
              <option value="san_kho_bau">📦 Tìm bảo rương (Săn Kho Báu)</option>
              <option value="tim_dau_dau">🔍 Tìm Ba Đậu Yêu (Tìm Đậu Đậu)</option>
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

        {/* Checkbox auto leave party */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={cfg.leaveParty}
              disabled={isRunning}
              onChange={(e) => update({ leaveParty: e.target.checked })}
            />
            <span>Tự động rời đội trước khi vào (phó bản đơn không cho phép tổ đội)</span>
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
              {st.currentType && (
                <span style={{ color: "#38bdf8" }}>
                  Đang chạy: <strong>{TYPE_NAMES[st.currentType] || st.currentType}</strong>
                </span>
              )}
            </div>

            {/* Completed badges */}
            {st.completedTypes && st.completedTypes.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <span style={{ color: "var(--muted, #888)" }}>Đã hoàn tất:</span>
                {st.completedTypes.map((t) => (
                  <span
                    key={t}
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
          <div>• Map: 62001 (Cửa 1..4 tương ứng 4 mốc cấp)</div>
          <div>• Vào trận khiêu chiến trực tiếp với Ba Đậu Yêu.</div>
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
          <div>• Hoàn thành nhiệm vụ nhận exp và quà thưởng hàng ngày.</div>
        </div>
      </div>
    </div>
  );
}
