import type { CharacterState, PetInfo } from "@tsbot/protocol";
import { useState } from "react";
import { ELEMENT, Gauge } from "./common";

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
}: {
  can: boolean;
  pets: PetInfo[];
  ch: CharacterState;
  act: Act;
}) {
  const [selectedModel, setSelectedModel] = useState<number | null>(null);

  // Mặc định chọn võ tướng đang xuất chiến, hoặc con đầu tiên trong danh sách
  const activePet = pets.find((p) => p.active);
  const sel = pets.find((p) => p.model === (selectedModel ?? activePet?.model ?? pets[0]?.model));

  return (
    <div className="home" style={{ gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 1.4fr)" }}>
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
                <button
                  className="primary"
                  disabled={!can || sel.active}
                  onClick={() => act("pet_out", { model: sel.model })}
                  style={{ padding: "4px 14px", fontSize: 12, fontWeight: 600 }}
                >
                  {sel.active ? "Đang Xuất Chiến" : "Xuất Chiến"}
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
                <h3 style={{ margin: "4px 0 6px", fontSize: 13, color: "var(--muted)" }}>Kỹ Năng Đã Học</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ch.petSkills.map((sk) => (
                    <span
                      key={sk.id}
                      className="chip"
                      style={{ fontSize: 12, padding: "3px 8px", background: "var(--panel-2)", border: "1px solid var(--line)" }}
                    >
                      ✨ {sk.name} {sk.sp ? <span style={{ color: "var(--primary)", fontWeight: 600 }}>({sk.sp} SP)</span> : ""} <small className="muted">(#{sk.id})</small>
                    </span>
                  ))}
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
  );
}
