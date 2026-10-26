import type { CharacterState, EscortConfig, InnPetInfo, PetInfo } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { ELEMENT, Gauge } from "./common";
import { api } from "../api";

type Act = (action: string, params?: Record<string, string | number>) => Promise<void>;
const nf = (n: number) => n.toLocaleString("vi-VN");

const STAT_ROWS = ["int", "atk", "def", "hp", "sp", "agi"] as const;

function StatTable({ p }: { p: PetInfo }) {
  const st = p.stats;
  if (!st) return <div className="muted small">Chưa đọc được bảng chỉ số chi tiết của võ tướng này.</div>;

  return (
    <div className="gen-stat" style={{ marginTop: 8 }}>
      <div className="gen-stat-row head">
        <span>Thuộc tính</span>
        <span>Gốc</span>
        <span>Đồ</span>
        <span>Thẻ</span>
        <span>Tổng</span>
      </div>
      {STAT_ROWS.map((k) => {
        const g = k === "hp" || k === "sp" ? 0 : p.gear?.[k] ?? 0;
        return (
          <div key={k} className="gen-stat-row">
            <span className="muted small" style={{ fontWeight: 600 }}>{k.toUpperCase()}</span>
            <span>{nf(st[k])}</span>
            <span>{g ? `+${nf(g)}` : "0"}</span>
            <span className="muted" title="Điểm cộng từ thẻ bài chưa đọc được từ gói tin">—</span>
            <b style={{ color: "var(--accent-ink)" }}>{nf(st[k] + g)}</b>
          </div>
        );
      })}
      <div className="gen-stat-row" style={{ borderTop: "1px dashed var(--line)" }}>
        <span className="muted small" style={{ fontWeight: 600 }}>FAI</span>
        <span>{nf(st.fai)}</span>
        <span />
        <span />
        <b style={{ color: st.fai < 60 ? "var(--bad)" : "var(--ok)" }}>{nf(st.fai)}</b>
      </div>
      <div className="muted small" style={{ fontSize: 11, marginTop: 4 }}>
        * FAI: Độ trung thành (thấp hơn 60 có nguy cơ bỏ chạy hoặc không nghe lệnh trong trận).
      </div>
      <div className="muted small" style={{ fontSize: 11, marginTop: 2 }}>
        * Max HP = Cấp × 10 + Điểm HP × 6 · Max SP = Cấp × 3 + Điểm SP × 5 (tương thích thuộc tính TS Online).
      </div>
    </div>
  );
}

export function PetPanel({
  can,
  pets,
  ch,
  act,
  accountId,
}: {
  can: boolean;
  pets: PetInfo[];
  ch: CharacterState;
  act: Act;
  accountId?: string;
}) {
  const [subTab, setSubTab] = useState<"party" | "inn">("party");
  const [selectedModel, setSelectedModel] = useState<number | null>(null);

  // Escort Config state
  const [escortCfg, setEscortCfg] = useState<EscortConfig>({
    enabled: false,
    selectedPetSlot: 1,
    selectedPetName: "",
    autoClaimReward: true,
  });
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgSavedMsg, setCfgSavedMsg] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [remainingTime, setRemainingTime] = useState("");

  const acc = accountId || "default";

  // Load escort config khi chuyển subtab hoặc account
  useEffect(() => {
    if (subTab !== "inn" || !acc) return;
    setCfgLoading(true);
    api.escortConfig(acc)
      .then((c) => {
        setEscortCfg(c);
      })
      .catch((e) => console.error("Lỗi tải escort config:", e))
      .finally(() => setCfgLoading(false));
  }, [subTab, acc]);

  // Live countdown timer cho active escort
  useEffect(() => {
    const active = ch.escort?.activeEscort;
    if (!active) {
      setRemainingTime("");
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = active.endTime - now;
      if (diff <= 0) {
        setRemainingTime("Hoàn thành! Đang chờ làm mới trạng thái...");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemainingTime(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [ch.escort?.activeEscort]);

  const handleSaveConfig = async () => {
    try {
      setCfgLoading(true);
      const updated = await api.saveEscortConfig(acc, escortCfg);
      setEscortCfg(updated);
      setCfgSavedMsg("Đã lưu cấu hình!");
      setTimeout(() => setCfgSavedMsg(""), 3000);
    } catch (e) {
      setCfgSavedMsg(`Lỗi lưu: ${(e as Error).message}`);
    } finally {
      setCfgLoading(false);
    }
  };

  const handleOpenInn = async () => {
    setActionLoading(true);
    try {
      await api.openInn(acc);
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunEscort = async () => {
    setActionLoading(true);
    try {
      await api.escortRun(acc);
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleClaimEscort = async () => {
    setActionLoading(true);
    try {
      await api.escortClaim(acc);
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  // Mặc định chọn võ tướng đang xuất chiến, hoặc con đầu tiên trong danh sách
  const activePet = pets.find((p) => p.active);
  const sel = pets.find((p) => p.model === (selectedModel ?? activePet?.model ?? pets[0]?.model));

  const innPets = ch.innPets ?? [];
  const escortState = ch.escort;
  const dailyCount = escortState?.dailyCount ?? 0;
  const isEscorting = Boolean(escortState?.activeEscort && Date.now() < escortState.activeEscort.endTime);
  const isEscortDone = Boolean(escortState?.activeEscort && Date.now() >= escortState.activeEscort.endTime);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* THANH TAB PHỤ: VÕ TƯỚNG MANG THEO vs NHÀ TRỌ & VẬN TIÊU */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        <button
          type="button"
          className={subTab === "party" ? "primary" : ""}
          onClick={() => setSubTab("party")}
          style={{ fontSize: 13, fontWeight: 600, padding: "6px 16px", display: "flex", alignItems: "center", gap: 6, borderRadius: 6 }}
        >
          <span>🐾</span> Võ Tướng Mang Theo ({pets.length})
        </button>
        <button
          type="button"
          className={subTab === "inn" ? "primary" : ""}
          onClick={() => setSubTab("inn")}
          style={{ fontSize: 13, fontWeight: 600, padding: "6px 16px", display: "flex", alignItems: "center", gap: 6, borderRadius: 6 }}
        >
          <span>🏡</span> Nhà Trọ & Vận Tiêu {innPets.length > 0 ? `(${innPets.length})` : ""}
          {isEscorting && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />}
        </button>
      </div>

      {subTab === "party" ? (
        /* ==================== TAB 1: VÕ TƯỚNG MANG THEO ==================== */
        <div className="home" style={{ gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 1.4fr)", flex: 1, minHeight: 0 }}>
          {/* CỘT 1: DANH SÁCH VÕ TƯỚNG */}
          <div className="home-col">
            <section className="card compact" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🐾</span> Danh Sách Võ Tướng ({pets.length})
                </h2>
                <span className="sp" />
                <span className="muted small">Tối đa 5 con</span>
              </div>

              {pets.length === 0 ? (
                <div className="muted" style={{ padding: "20px 0", textAlign: "center" }}>
                  Chưa đọc được danh sách võ tướng hoặc nhân vật chưa mang theo võ tướng nào.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pets.map((p) => {
                    const isSelected = sel?.model === p.model;
                    return (
                      <div
                        key={p.model}
                        onClick={() => setSelectedModel(p.model)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: isSelected ? "2px solid var(--accent)" : "1px solid var(--line)",
                          background: isSelected ? "var(--accent-soft)" : "var(--panel-2)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span
                          className={`elem-box ${p.element ?? "none"}`}
                          title={p.element ? `Hệ ${ELEMENT[p.element].label}` : "Chưa xác định"}
                        >
                          {p.element ? ELEMENT[p.element].icon : "?"}
                        </span>

                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.name}
                            </b>
                            <span className="lv" style={{ fontSize: 11, padding: "1px 6px" }}>
                              Lv {p.level}
                            </span>
                          </div>
                          <div className="muted small" style={{ fontSize: 11 }}>
                            HP {nf(p.hp.cur)}/{nf(p.hp.max)} · SP {nf(p.sp.cur)}/{nf(p.sp.max)}
                          </div>
                        </div>

                        <span
                          className={`chip ${p.active ? "ok" : ""}`}
                          style={{ fontSize: 11, padding: "2px 8px", flexShrink: 0 }}
                        >
                          {p.active ? "Xuất chiến" : "Nghỉ"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* CỘT 2: CHI TIẾT VÕ TƯỚNG ĐƯỢC CHỌN */}
          <div className="home-col">
            {sel ? (
              <section className="card unit compact" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Header chi tiết */}
                <div className="unit-head" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                  <b className="unit-name" style={{ fontSize: "1.25rem" }}>
                    <span
                      className={`elem-box ${sel.element ?? "none"}`}
                      title={sel.element ? `Hệ ${ELEMENT[sel.element].label}` : "Chưa xác định hệ"}
                    >
                      {sel.element ? ELEMENT[sel.element].icon : "?"}
                    </span>
                    <span className="nm">{sel.name}</span>
                  </b>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className={`chip ${sel.active ? "ok glow" : ""}`}>
                      {sel.active ? "Đang xuất chiến" : "Đang nghỉ"}
                    </span>
                    {sel.active ? (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={!can}
                        onClick={() => act("pet_rest")}
                        style={{ padding: "4px 14px", fontSize: 12, fontWeight: 600 }}
                        title="Ngưng xuất chiến cho võ tướng này về trạng thái nghỉ"
                      >
                        Cho Nghỉ
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={!can}
                        onClick={() => act("pet_out", { model: sel.model })}
                        style={{ padding: "4px 14px", fontSize: 12, fontWeight: 600 }}
                      >
                        Xuất Chiến
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!can}
                      onClick={() => act("spin_lap_ba", { slot: 1 })}
                      style={{ padding: "4px 12px", fontSize: 12, fontWeight: 700, background: "#eab308", color: "#000", border: "none", borderRadius: 4, cursor: "pointer" }}
                      title="Quay Xu Lạp Bá cho võ tướng slot 1 (tự động: đang xuất chiến -> cho nghỉ -> quay -> xuất chiến lại)"
                    >
                      🎰 Quay Lạp Bá (Slot 1)
                    </button>
                  </div>
                </div>

                <div className="row" style={{ alignItems: "center", gap: 12, fontSize: 13 }}>
                  <span className="lv" style={{ padding: "2px 10px" }}>Lv {sel.level}</span>
                  {sel.element && <span>Hệ: <b>{ELEMENT[sel.element].label}</b></span>}
                  <span className="sp" />
                  {sel.expCur != null && sel.expMax != null && (
                    <span className="muted small">
                      EXP: {nf(sel.expCur)} / {nf(sel.expMax)}
                    </span>
                  )}
                </div>

                {/* Các thanh chỉ số Gauge */}
                <Gauge kind="hp" cur={sel.hp.cur} max={sel.hp.max} />
                <Gauge kind="sp" cur={sel.sp.cur} max={sel.sp.max} />
                <Gauge kind="exp" cur={sel.exp} max={100} label={`${sel.exp.toFixed(2)}%`} />

                {/* Bảng chỉ số chi tiết */}
                <div style={{ marginTop: 4 }}>
                  <h3 style={{ margin: "4px 0", fontSize: 13, color: "var(--muted)" }}>Bảng Thuộc Tính & Chỉ Số</h3>
                  <StatTable p={sel} />
                </div>

                {/* Kỹ năng của võ tướng xuất chiến nếu có */}
                {sel.active && ch.petSkills && ch.petSkills.length > 0 && (
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                    <h3 style={{ margin: "4px 0 6px", fontSize: 13, color: "var(--muted)" }}>Kỹ Năng Võ Tướng (Gốc / Mê / VKCD)</h3>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ch.petSkills.map((sk) => {
                        const isDis = sk.enabled === false;
                        const icon = sk.type === "exclusive_weapon" ? "🗡️" : sk.type === "awakened" ? "🌟" : "✨";
                        const tag = sk.type === "exclusive_weapon" ? "VKCD" : sk.type === "awakened" ? "Mê" : "Gốc";
                        return (
                          <span
                            key={sk.id}
                            className="chip"
                            style={{
                              fontSize: 12,
                              padding: "3px 8px",
                              background: isDis ? "rgba(255,255,255,0.03)" : "var(--panel-2)",
                              border: isDis ? "1px dashed var(--line)" : "1px solid var(--line)",
                              opacity: isDis ? 0.65 : 1,
                            }}
                            title={sk.desc ? `${sk.name}: ${sk.desc}` : sk.name}
                          >
                            {icon} {sk.name} <span style={{ fontSize: 10, color: "var(--muted)" }}>[{tag}]</span>{" "}
                            {sk.sp ? <span style={{ color: "var(--primary)", fontWeight: 600 }}>({sk.sp} SP)</span> : ""}{" "}
                            {isDis && (
                              <span style={{ color: "#f87171", fontSize: 10, marginLeft: 4 }}>({sk.disabledReason ?? "Chưa mở"})</span>
                            )}
                            <small className="muted" style={{ marginLeft: 4 }}>(#{sk.id})</small>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <section className="card compact" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
                Chọn một võ tướng từ danh sách bên trái để xem chi tiết chỉ số và điều khiển xuất chiến.
              </section>
            )}
          </div>
        </div>
      ) : (
        /* ==================== TAB 2: NHÀ TRỌ & VẬN TIÊU ==================== */
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0, overflowY: "auto" }}>
          {/* BANNER THÔNG TIN TIẾN ĐỘ & TRẠNG THÁI VẬN TIÊU */}
          <div className="card compact" style={{ padding: 14, background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(16, 185, 129, 0.08))", border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>🐎</span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 16 }}>Tiến Độ Vận Tiêu Hôm Nay:</b>
                    <span style={{ fontSize: 18, color: "#f59e0b", letterSpacing: 2 }}>
                      {dailyCount >= 3 ? "★★★" : dailyCount === 2 ? "★★☆" : dailyCount === 1 ? "★☆☆" : "☆☆☆"}
                    </span>
                    <span className="chip" style={{ fontSize: 12, fontWeight: 700 }}>
                      {dailyCount}/3 lượt
                    </span>
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    Mỗi ngày có tối đa 3 lần vận tiêu · Mỗi lượt mất 4 giờ · Tự động quét kiểm tra mỗi 30 phút.
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  disabled={!can || actionLoading}
                  onClick={handleOpenInn}
                  style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
                  title="Di chuyển đến Khách Sạn Trác Quận (12007) và tải danh sách võ tướng trong Nhà Trọ"
                >
                  <span>🏡</span> Đến Nhà Trọ
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!can || actionLoading || isEscorting || dailyCount >= 3}
                  onClick={handleRunEscort}
                  style={{ fontSize: 12, padding: "6px 14px", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}
                  title={dailyCount >= 3 ? "Đã hoàn thành 3 lượt hôm nay" : isEscorting ? "Đang có chuyến vận tiêu diễn ra" : "Cho võ tướng đã chọn xuất phát vận tiêu ngay"}
                >
                  <span>🐎</span> Cho Đi Vận Tiêu Ngay
                </button>
              </div>
            </div>

            {/* Trạng thái chuyến vận tiêu đang diễn ra */}
            {isEscorting && escortState?.activeEscort && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(16, 185, 129, 0.12)", border: "1px solid #10b981", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="chip ok glow" style={{ fontWeight: 700 }}>ĐANG VẬN TIÊU</span>
                  <span style={{ fontSize: 13 }}>
                    Võ tướng: <b>{escortState.activeEscort.petName ?? `Ô ${escortState.activeEscort.slot}`}</b> (Ô {escortState.activeEscort.slot})
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted small">Thời gian còn lại:</span>
                  <b style={{ color: "#10b981", fontSize: 15, fontFamily: "var(--mono)" }}>{remainingTime}</b>
                </div>
              </div>
            )}
            {/* Trạng thái chuyến vận tiêu ĐÃ HOÀN THÀNH - CHỜ NHẬN THƯỞNG */}
            {isEscortDone && escortState?.activeEscort && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(245, 158, 11, 0.15)", border: "1px solid #f59e0b", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="chip warn glow" style={{ fontWeight: 700 }}>HOÀN THÀNH</span>
                  <span style={{ fontSize: 13 }}>
                    Võ tướng: <b>{escortState.activeEscort.petName ?? `Ô ${escortState.activeEscort.slot}`}</b> (Ô {escortState.activeEscort.slot}) đã kết thúc vận tiêu!
                  </span>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={actionLoading}
                  onClick={() => void handleClaimEscort()}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, padding: "6px 14px" }}
                >
                  <span>🎁</span> Nhận Thưởng Vận Tiêu
                </button>
              </div>
            )}
            {!isEscorting && !isEscortDone && dailyCount >= 3 && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(234, 179, 8, 0.1)", border: "1px solid #eab308", borderRadius: 6, fontSize: 12, color: "#eab308", fontWeight: 600 }}>
                🎉 Đã hoàn thành toàn bộ 3 lượt vận tiêu trong ngày hôm nay! Hãy quay lại vào ngày mai (00:00 UTC+8).
              </div>
            )}
          </div>

          {/* CARD CẤU HÌNH TỰ ĐỘNG VẬN TIÊU */}
          <section className="card compact" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="row" style={{ alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <span>⚙️</span> Thiết Lập Tự Động Vận Tiêu
              </h2>
              <span className="sp" />
              {cfgSavedMsg && <span style={{ color: "#10b981", fontSize: 12, fontWeight: 600 }}>{cfgSavedMsg}</span>}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={escortCfg.enabled}
                  onChange={(e) => setEscortCfg({ ...escortCfg, enabled: e.target.checked })}
                />
                <b>Bật tự động Vận Tiêu</b> (quét 30 phút/lần, tối đa 3 lần/ngày)
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="muted small" style={{ fontWeight: 600 }}>Võ tướng chỉ định:</span>
                <select
                  value={escortCfg.selectedPetSlot ?? 1}
                  onChange={(e) => {
                    const slot = Number(e.target.value);
                    const found = innPets.find((p) => p.slot === slot);
                    setEscortCfg({
                      ...escortCfg,
                      selectedPetSlot: slot,
                      selectedPetName: found?.name ?? "",
                    });
                  }}
                  style={{ padding: "4px 10px", borderRadius: 6, minWidth: 220, fontSize: 13 }}
                >
                  {innPets.length === 0 ? (
                    <option value={1}>[Ô 1] (Chưa tải danh sách Nhà Trọ)</option>
                  ) : (
                    innPets.map((p) => (
                      <option key={p.slot} value={p.slot}>
                        [Ô {p.slot}] {p.name} (Lv.{p.level} - HP {nf(p.hp)}) {p.status === 1 ? "— Đang vận tiêu" : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <button
                type="button"
                className="primary"
                disabled={cfgLoading}
                onClick={handleSaveConfig}
                style={{ fontSize: 12, padding: "5px 16px" }}
              >
                Lưu Thiết Lập
              </button>
            </div>

            {/* Cảnh báo ràng buộc chỉ pet được chọn mới được vận tiêu */}
            <div style={{ fontSize: 12, padding: "8px 12px", background: "rgba(99, 102, 241, 0.08)", borderLeft: "3px solid var(--accent)", borderRadius: 4, color: "var(--text-soft)" }}>
              🛡️ <b>Ràng buộc an toàn:</b> Hệ thống tuân thủ nghiêm ngặt chỉ sử dụng đúng võ tướng được chọn ở trên để vận tiêu. Các võ tướng khác trong Nhà Trọ hoặc trong đội ngũ tuyệt đối không bao giờ bị đem đi vận tiêu.
            </div>
          </section>

          {/* DANH SÁCH VÕ TƯỚNG TRONG NHÀ TRỌ */}
          <section className="card compact" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="row" style={{ alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <span>📋</span> Danh Sách Võ Tướng Trong Nhà Trọ ({innPets.length})
              </h2>
              <span className="sp" />
              <button
                type="button"
                disabled={!can || actionLoading}
                onClick={handleOpenInn}
                style={{ fontSize: 11, padding: "3px 10px" }}
              >
                🔄 Mở Lại Nhà Trọ
              </button>
            </div>

            {innPets.length === 0 ? (
              <div className="muted" style={{ padding: "30px 10px", textAlign: "center", fontSize: 13 }}>
                Chưa có dữ liệu võ tướng trong Nhà Trọ hoặc chưa mở Nhà Trọ.<br />
                Bấm nút <b>"Đến Nhà Trọ"</b> ở trên để nhân vật tự động di chuyển tới Khách Sạn Trác Quận và tải danh sách.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line)", color: "var(--muted)" }}>
                      <th style={{ padding: "8px 6px" }}>Ô (Slot)</th>
                      <th style={{ padding: "8px 6px" }}>Võ Tướng</th>
                      <th style={{ padding: "8px 6px" }}>ID Model</th>
                      <th style={{ padding: "8px 6px" }}>Cấp</th>
                      <th style={{ padding: "8px 6px" }}>HP</th>
                      <th style={{ padding: "8px 6px" }}>EXP</th>
                      <th style={{ padding: "8px 6px" }}>Trạng Thái</th>
                      <th style={{ padding: "8px 6px", textAlign: "right" }}>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {innPets.map((pet) => {
                      const isTarget = escortCfg.selectedPetSlot === pet.slot;
                      const isPetEscorting = pet.status === 1;
                      return (
                        <tr
                          key={pet.slot}
                          style={{
                            borderBottom: "1px solid var(--line)",
                            background: isTarget ? "rgba(99, 102, 241, 0.05)" : "transparent",
                          }}
                        >
                          <td style={{ padding: "8px 6px", fontWeight: 700 }}>#{pet.slot}</td>
                          <td style={{ padding: "8px 6px" }}>
                            <b style={{ color: isTarget ? "var(--accent-ink)" : "inherit" }}>{pet.name}</b>
                            {isTarget && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--accent)" }}>[Được chọn]</span>}
                          </td>
                          <td style={{ padding: "8px 6px", fontFamily: "var(--mono)", fontSize: 12 }}>#{pet.model}</td>
                          <td style={{ padding: "8px 6px" }}>
                            <span className="lv" style={{ fontSize: 11, padding: "1px 6px" }}>Lv {pet.level}</span>
                          </td>
                          <td style={{ padding: "8px 6px" }}>{nf(pet.hp)}</td>
                          <td style={{ padding: "8px 6px" }}>{nf(pet.exp)}</td>
                          <td style={{ padding: "8px 6px" }}>
                            {isPetEscorting ? (
                              <span className="chip ok glow" style={{ fontSize: 11 }}>🐎 Đang Vận Tiêu</span>
                            ) : (
                              <span className="chip" style={{ fontSize: 11 }}>Trong Nhà Trọ</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 6px", textAlign: "right" }}>
                            {!isTarget && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEscortCfg({
                                    ...escortCfg,
                                    selectedPetSlot: pet.slot,
                                    selectedPetName: pet.name,
                                  });
                                }}
                                style={{ fontSize: 11, padding: "2px 8px" }}
                              >
                                Chọn Vận Tiêu
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
