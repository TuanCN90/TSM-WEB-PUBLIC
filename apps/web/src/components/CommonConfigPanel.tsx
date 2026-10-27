import type { AutoHealConfig, AutoHealTargetConfig, CharacterState, PartyConfig } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Gauge } from "./common";
import itemHealEffects from "../data/itemHealEffects.json";
import itemNames from "../data/itemNames.json";

interface Props {
  accountId: string;
  can: boolean;
  ch: CharacterState;
  act: (action: string, params?: Record<string, string | number>) => Promise<void>;
  onToast: (type: "ok" | "info" | "error", message: string) => void;
}

const DEFAULT_TARGET = (defPct = 50): AutoHealTargetConfig => ({
  autoHp: false,
  hpPct: defPct,
  autoSp: false,
  spPct: defPct,
});

type CommonSubTab = "auto_heal" | "other";

export function CommonConfigPanel({ accountId, can, ch, act, onToast }: Props) {
  const [subTab, setSubTab] = useState<CommonSubTab>("auto_heal");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  const [cfg, setCfg] = useState<AutoHealConfig>({
    enabled: true,
    player: DEFAULT_TARGET(50),
    pet: DEFAULT_TARGET(50),
    slots: {},
    safeSpotOnFaint: false,
    autoReviveAlly: false,
  });

  const [partyCfg, setPartyCfg] = useState<PartyConfig | null>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  const [partySaving, setPartySaving] = useState(false);

  const hasReviveSkill = Boolean(ch.playerSkills?.some((s) => s.id === 11013));

  // Tải cấu hình theo accountId
  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setPartyLoading(true);
    api.itemLists(accountId)
      .then((res) => {
        const h = res.autoHeal;
        setCfg({
          enabled: h?.enabled ?? true,
          player: { ...DEFAULT_TARGET(50), ...(h?.player ?? {}) },
          pet: { ...DEFAULT_TARGET(50), ...(h?.pet ?? {}) },
          slots: h?.slots ?? {},
          safeSpotOnFaint: h?.safeSpotOnFaint ?? false,
          autoReviveAlly: h?.autoReviveAlly ?? false,
        });
      })
      .catch(() => {
        setCfg({
          enabled: true,
          player: DEFAULT_TARGET(50),
          pet: DEFAULT_TARGET(50),
          slots: {},
          safeSpotOnFaint: false,
          autoReviveAlly: false,
        });
      })
      .finally(() => setLoading(false));

    api.partyConfig(accountId)
      .then((c) => setPartyCfg(c))
      .catch(() => setPartyCfg(null))
      .finally(() => setPartyLoading(false));
  }, [accountId]);

  const savePartyConfig = async (nextPatch: Partial<PartyConfig>) => {
    if (!accountId || !partyCfg) return;
    setPartySaving(true);
    try {
      const next = { ...partyCfg, ...nextPatch };
      const saved = await api.savePartyConfig(accountId, next);
      setPartyCfg(saved);
      onToast("info", "Đã lưu cấu hình Tự động bỏ chạy khi chưa đủ tổ đội thành công.");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setPartySaving(false);
    }
  };

  const saveConfig = async (nextCfg = cfg) => {
    if (!accountId) return;
    setSaving(true);
    try {
      await api.setAutoHeal(accountId, nextCfg);
      setCfg(nextCfg);
      onToast("info", "Đã lưu cấu hình Tự động sử dụng vật phẩm thành công.");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSweepNow = async () => {
    setSweeping(true);
    try {
      await act("sweep_auto_heal");
      onToast("info", "Đã gửi lệnh quét và sử dụng HP/SP theo cấu hình.");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setSweeping(false);
    }
  };

  // Thống kê dược phẩm / thực phẩm hiện có trong thùng đồ
  const healEffectsMap = itemHealEffects as Record<string, { hp?: number; sp?: number }>;
  const namesMap = itemNames as Record<string, string>;

  const hpItemsInBag: { slot: number; name: string; qty: number; eff: number }[] = [];
  const spItemsInBag: { slot: number; name: string; qty: number; eff: number }[] = [];

  for (const it of ch.bag || []) {
    const eff = healEffectsMap[String(it.id)];
    if (!eff) continue;
    const name = namesMap[String(it.id)] ?? `#${it.id}`;
    if (eff.hp && eff.hp > 0) {
      hpItemsInBag.push({ slot: it.slot, name, qty: it.qty, eff: eff.hp });
    }
    if (eff.sp && eff.sp > 0) {
      spItemsInBag.push({ slot: it.slot, name, qty: it.qty, eff: eff.sp });
    }
  }

  hpItemsInBag.sort((a, b) => a.eff - b.eff);
  spItemsInBag.sort((a, b) => a.eff - b.eff);

  const playerHpPct = ch.player.hp.max > 0 ? Math.floor((ch.player.hp.cur / ch.player.hp.max) * 100) : 0;
  const playerSpPct = ch.player.sp.max > 0 ? Math.floor((ch.player.sp.cur / ch.player.sp.max) * 100) : 0;

  const petHpPct = ch.pet.hp.max > 0 ? Math.floor((ch.pet.hp.cur / ch.pet.hp.max) * 100) : 0;
  const petSpPct = ch.pet.sp.max > 0 ? Math.floor((ch.pet.sp.cur / ch.pet.sp.max) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* THANH TAB CON TRONG CẤU HÌNH CHUNG */}
      <div className="home-tabbar">
        <button
          type="button"
          className={`home-tab ${subTab === "auto_heal" ? "on" : ""}`}
          onClick={() => setSubTab("auto_heal")}
        >
          <span>💊</span> Sử Dụng Vật Phẩm (HP / SP)
        </button>
        <button
          type="button"
          className={`home-tab ${subTab === "other" ? "on" : ""}`}
          onClick={() => setSubTab("other")}
        >
          <span>⚙️</span> Cấu Hình Khác
        </button>
      </div>

      {subTab === "auto_heal" && (
        <div className="home" style={{ gridTemplateColumns: "minmax(380px, 1.3fr) minmax(300px, 1fr)" }}>
      {/* CỘT TRÁI: CẤU HÌNH SỬ DỤNG VẬT PHẨM */}
      <div className="home-col">
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="row" style={{ alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <span>💊</span> Sử Dụng Vật Phẩm (HP / SP)
              </h2>
              <div className="muted small" style={{ marginTop: 4 }}>
                Tự động dùng vật phẩm hồi phục trong túi đồ khi chỉ số dưới mốc % quy định.
              </div>
            </div>
            <span className="sp" />
            <button
              type="button"
              className="primary"
              disabled={!can || sweeping}
              onClick={handleSweepNow}
              title="Quét túi đồ và tự động dùng HP/SP ngay theo cấu hình hiện tại"
            >
              {sweeping ? "Đang quét..." : "⚡ Quét HP/SP ngay"}
            </button>
          </div>

          {/* Toggle tổng thể */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: "var(--panel-2)",
              borderRadius: 8,
              border: "1px solid var(--line)",
            }}
          >
            <div>
              <b style={{ fontSize: 14 }}>Kích hoạt tự động sử dụng HP/SP ngoài trận</b>
              <div className="muted small" style={{ fontSize: 11 }}>
                Hệ thống tự động kích hoạt sau mỗi trận đấu kết thúc hoặc định kỳ quét thùng đồ.
              </div>
            </div>
            <label className="switch" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => {
                  const next = { ...cfg, enabled: e.target.checked };
                  setCfg(next);
                  saveConfig(next);
                }}
              />
              <span style={{ fontWeight: 600, color: cfg.enabled ? "var(--ok)" : "var(--muted)" }}>
                {cfg.enabled ? "ĐANG BẬT" : "TẮT"}
              </span>
            </label>
          </div>

          {loading ? (
            <div className="muted" style={{ padding: 20, textAlign: "center" }}>Đang tải cấu hình...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* SLOT 1: NHÂN VẬT */}
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  background: "var(--panel-1)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <b style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>🧑</span> <span style={{ color: "var(--accent-ink)" }}>{ch.player.name || "Nhân vật"}</span>
                  </b>
                  <span className="muted small">
                    HP: <b>{ch.player.hp.cur}</b>/{ch.player.hp.max} ({playerHpPct}%) · SP: <b>{ch.player.sp.cur}</b>/{ch.player.sp.max} ({playerSpPct}%)
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Dòng 1: HP */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--panel-2)",
                      borderRadius: 6,
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={cfg.player.autoHp}
                        onChange={(e) => {
                          const next = {
                            ...cfg,
                            player: { ...cfg.player, autoHp: e.target.checked },
                          };
                          setCfg(next);
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>Tự động sử dụng HP khi HP dưới</span>
                    </label>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={cfg.player.hpPct}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                          setCfg({
                            ...cfg,
                            player: { ...cfg.player, hpPct: v },
                          });
                        }}
                        style={{ width: 64, textAlign: "center", padding: "4px 8px" }}
                      />
                      <span style={{ fontWeight: 600 }}>%</span>
                    </div>
                  </div>

                  {/* Dòng 2: SP */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--panel-2)",
                      borderRadius: 6,
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={cfg.player.autoSp}
                        onChange={(e) => {
                          const next = {
                            ...cfg,
                            player: { ...cfg.player, autoSp: e.target.checked },
                          };
                          setCfg(next);
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>Tự động sử dụng SP khi SP dưới</span>
                    </label>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={cfg.player.spPct}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                          setCfg({
                            ...cfg,
                            player: { ...cfg.player, spPct: v },
                          });
                        }}
                        style={{ width: 64, textAlign: "center", padding: "4px 8px" }}
                      />
                      <span style={{ fontWeight: 600 }}>%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SLOT 2: VÕ TƯỚNG XUẤT CHIẾN */}
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  background: "var(--panel-1)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <b style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>🐾</span> <span style={{ color: "var(--accent-ink)" }}>{ch.pet.name || "Võ tướng"}</span>
                  </b>
                  <span className="muted small">
                    HP: <b>{ch.pet.hp.cur}</b>/{ch.pet.hp.max} ({petHpPct}%) · SP: <b>{ch.pet.sp.cur}</b>/{ch.pet.sp.max} ({petSpPct}%)
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Dòng 1: HP Pet */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--panel-2)",
                      borderRadius: 6,
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={cfg.pet.autoHp}
                        onChange={(e) => {
                          const next = {
                            ...cfg,
                            pet: { ...cfg.pet, autoHp: e.target.checked },
                          };
                          setCfg(next);
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>Tự động sử dụng HP khi HP dưới</span>
                    </label>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={cfg.pet.hpPct}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                          setCfg({
                            ...cfg,
                            pet: { ...cfg.pet, hpPct: v },
                          });
                        }}
                        style={{ width: 64, textAlign: "center", padding: "4px 8px" }}
                      />
                      <span style={{ fontWeight: 600 }}>%</span>
                    </div>
                  </div>

                  {/* Dòng 2: SP Pet */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      background: "var(--panel-2)",
                      borderRadius: 6,
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={cfg.pet.autoSp}
                        onChange={(e) => {
                          const next = {
                            ...cfg,
                            pet: { ...cfg.pet, autoSp: e.target.checked },
                          };
                          setCfg(next);
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>Tự động sử dụng SP khi SP dưới</span>
                    </label>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={cfg.pet.spPct}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                          setCfg({
                            ...cfg,
                            pet: { ...cfg.pet, spPct: v },
                          });
                        }}
                        style={{ width: 64, textAlign: "center", padding: "4px 8px" }}
                      />
                      <span style={{ fontWeight: 600 }}>%</span>
                    </div>
                  </div>
                </div>
              </div>



              {/* Nút lưu cấu hình */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={saving}
                  onClick={() => saveConfig(cfg)}
                  style={{ padding: "8px 24px" }}
                >
                  {saving ? "Đang lưu..." : "💾 Lưu Cấu Hình"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* CỘT PHẢI: THỐNG KÊ DƯỢC PHẨM & CƠ CHẾ ƯU TIÊN */}
      <div className="home-col">
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
              <span>🎒</span> Vật Phẩm Phục Hồi Trong Túi
            </h2>
            <span className="sp" />
            <span className="muted small">Ưu tiên chỉ số thấp nhất trước</span>
          </div>

          <div
            style={{
              padding: "10px 12px",
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <b>ℹ️ Quy tắc sử dụng vật phẩm:</b>
            <div style={{ marginTop: 4 }}>
              Khi chỉ số rơi xuống dưới ngưỡng thiết lập, hệ thống sắp xếp toàn bộ vật phẩm hồi phục theo chỉ số cộng tăng dần.
              Vật phẩm có chỉ số cộng thấp nhất sẽ được sử dụng trước cho đến khi chỉ số đạt mốc cấu hình thì dừng lại ngay.
            </div>
          </div>

          {/* Danh sách vật phẩm HP */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 13, color: "var(--bad)" }}>❤️ Thuốc / Thực phẩm hồi HP ({hpItemsInBag.length})</b>
              <span className="muted small">Xếp theo HP cộng tăng dần</span>
            </div>
            {hpItemsInBag.length === 0 ? (
              <div className="muted small" style={{ padding: "12px 0", textAlign: "center", background: "var(--panel-2)", borderRadius: 6 }}>
                Không có vật phẩm hồi HP nào trong túi đồ.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                {hpItemsInBag.map((it, idx) => (
                  <div
                    key={`${it.slot}-${it.name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      background: "var(--panel-2)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="badge" style={{ fontSize: 10, padding: "1px 5px", background: idx === 0 ? "var(--accent)" : "var(--line)" }}>
                        #{idx + 1}
                      </span>
                      <span>{it.name}</span>
                      <span className="muted">(ô {it.slot})</span>
                    </div>
                    <div>
                      <b style={{ color: "var(--bad)" }}>+{it.eff} HP</b>
                      <span className="muted" style={{ marginLeft: 8 }}>x{it.qty}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danh sách vật phẩm SP */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 13, color: "var(--sp-ink, #2563eb)" }}>💙 Thuốc / Rượu hồi SP ({spItemsInBag.length})</b>
              <span className="muted small">Xếp theo SP cộng tăng dần</span>
            </div>
            {spItemsInBag.length === 0 ? (
              <div className="muted small" style={{ padding: "12px 0", textAlign: "center", background: "var(--panel-2)", borderRadius: 6 }}>
                Không có vật phẩm hồi SP nào trong túi đồ.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                {spItemsInBag.map((it, idx) => (
                  <div
                    key={`${it.slot}-${it.name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      background: "var(--panel-2)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="badge" style={{ fontSize: 10, padding: "1px 5px", background: idx === 0 ? "var(--accent)" : "var(--line)" }}>
                        #{idx + 1}
                      </span>
                      <span>{it.name}</span>
                      <span className="muted">(ô {it.slot})</span>
                    </div>
                    <div>
                      <b style={{ color: "var(--sp-ink, #2563eb)" }}>+{it.eff} SP</b>
                      <span className="muted" style={{ marginLeft: 8 }}>x{it.qty}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
      )}

      {subTab === "other" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Card: Tự Động Về Cổng Thành Tương Dương Khi Gục Ngã */}
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 24 }}>🏰</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>
                    Tự Động Về Tương Dương Khi Có Slot Gục Ngã
                  </h3>
                  <div className="muted small" style={{ fontSize: 12, marginTop: 2 }}>
                    Khi có bất kỳ slot nào trong tổ đội (nhân vật hoặc võ tướng) bị gục ngã trong trận, lập tức teleport về Cửa thành Tương Dương.
                  </div>
                </div>
              </div>
              <label className="switch" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  disabled={!can || loading || saving}
                  checked={!!cfg.safeSpotOnFaint}
                  onChange={(e) => saveConfig({ ...cfg, safeSpotOnFaint: e.target.checked })}
                />
                <span style={{ fontWeight: 700, fontSize: 13, color: cfg.safeSpotOnFaint ? "var(--ok)" : "var(--muted)" }}>
                  {cfg.safeSpotOnFaint ? "ĐANG BẬT" : "TẮT"}
                </span>
              </label>
            </div>

            {/* Quy tắc hoạt động */}
            <div style={{ background: "var(--panel-2)", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
              <b style={{ fontSize: 13, display: "block", marginBottom: 6, color: "var(--accent-ink)" }}>
                📋 Quy tắc hoạt động:
              </b>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: "var(--text)" }}>
                <li>
                  <b>Chủ PT bật tính năng:</b> Khi có <b>bất kỳ slot nào trong tổ đội</b> (nhân vật hoặc võ tướng của bất kỳ thành viên nào) bị đánh gục ngã trong trận $\rightarrow$ Hết trận, Chủ PT lập tức gửi lệnh warp / teleport (44/01) đưa <b>cả team về Cửa thành Tương Dương (21001)</b>.
                </li>
                <li>
                  <b>Chủ PT không bật mà Thành viên bật:</b> Khi có bất kỳ slot nào trong tổ đội bị gục ngã $\rightarrow$ Thành viên bật tính năng này sẽ <b>lập tức rời đội và teleport về Cửa thành Tương Dương (21001)</b>.
                </li>
                <li>
                  <b>Đi Solo (không trong đội):</b> Khi nhân vật hoặc võ tướng của mình bị gục ngã $\rightarrow$ Hết trận lập tức teleport về Cửa thành Tương Dương để treo máy an toàn.
                </li>
                <li>
                  <b>Dừng truy kích:</b> Ngay khi kích hoạt, bot lập tức ngắt bỏ tự động truy kích quái và di chuyển bãi để đảm bảo đứng treo tuyệt đối an toàn tại thành Tương Dương.
                </li>
              </ul>
            </div>
          </section>

          {/* Card: Sử Dụng Hồi Sinh Cho Đồng Đội Tử Trận */}
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 24 }}>💫</span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>
                      Sử Dụng Hồi Sinh Cho Đồng Đội Tử Trận
                    </h3>
                    {hasReviveSkill ? (
                      <span className="badge" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#16a34a", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>
                        Đã học Hồi Sinh (11013)
                      </span>
                    ) : (
                      <span className="badge" style={{ background: "rgba(239, 68, 68, 0.15)", color: "#dc2626", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>
                        Chưa học Hồi Sinh
                      </span>
                    )}
                  </div>
                  <div className="muted small" style={{ fontSize: 12, marginTop: 2 }}>
                    Khi có bất kỳ slot đồng đội nào (char hoặc pet) bị NPC đánh gục ngã trong trận, ở lượt sau nhân vật ưu tiên dùng kỹ năng Hồi Sinh vào vị trí đó.
                  </div>
                </div>
              </div>
              <div
                onClick={() => {
                  if (!hasReviveSkill) {
                    onToast("error", "Ní chưa lĩnh hội thần thông hồi sinh rồi");
                  }
                }}
              >
                <label className="switch" style={{ display: "flex", alignItems: "center", gap: 8, cursor: hasReviveSkill ? "pointer" : "not-allowed", opacity: hasReviveSkill ? 1 : 0.6 }}>
                  <input
                    type="checkbox"
                    disabled={!can || loading || saving || !hasReviveSkill}
                    checked={!!cfg.autoReviveAlly && hasReviveSkill}
                    onChange={(e) => {
                      if (!hasReviveSkill) {
                        onToast("error", "Ní chưa lĩnh hội thần thông hồi sinh rồi");
                        return;
                      }
                      saveConfig({ ...cfg, autoReviveAlly: e.target.checked });
                    }}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13, color: (cfg.autoReviveAlly && hasReviveSkill) ? "var(--ok)" : "var(--muted)" }}>
                    {(cfg.autoReviveAlly && hasReviveSkill) ? "ĐANG BẬT" : "TẮT"}
                  </span>
                </label>
              </div>
            </div>

            {/* Quy tắc hoạt động */}
            <div style={{ background: "var(--panel-2)", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
              <b style={{ fontSize: 13, display: "block", marginBottom: 6, color: "var(--accent-ink)" }}>
                📋 Quy tắc hoạt động:
              </b>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: "var(--text)" }}>
                <li>
                  <b>Điều kiện kích hoạt:</b> Nhân vật phải học kỹ năng <b>Hồi Sinh (11013 - Hệ Thủy)</b> và còn đủ 40 SP. Nếu chưa học skill, hệ thống sẽ tự động vô hiệu hóa tính năng và thông báo: <i>"Ní chưa lĩnh hội thần thông hồi sinh rồi"</i>.
                </li>
                <li>
                  <b>Ưu tiên tuyệt đối trong lượt:</b> Trong trận đấu, khi phát hiện có bất kỳ đồng đội nào (Nhân vật hoặc Võ tướng) bị NPC đánh gục ngã (HP = 0), ở lượt tiếp theo nhân vật sẽ lập tức <b>ưu tiên dùng kỹ năng Hồi Sinh vào đúng vị trí ô đồng đội đã gục ngã</b>, bỏ qua bất kỳ thiết lập kỹ năng nào của lượt đó.
                </li>
                <li>
                  <b>Thứ tự ưu tiên cứu trợ:</b> Ưu tiên cứu nhân vật đồng đội trước, sau đó tới võ tướng của đội hoặc của bản thân.
                </li>
                <li>
                  <b>Tự động trở lại chu kỳ:</b> Sau khi đồng đội được hồi sinh thành công (HP &gt; 0) và không còn slot nào gục ngã, nhân vật sẽ tự động quay lại sử dụng kỹ năng bình thường theo đúng cấu hình chiến thuật đã cài đặt.
                </li>
              </ul>
            </div>
          </section>

          {/* Card: Tự Động Bỏ Chạy Khi Chưa Đủ Thành Viên Tổ Đội */}
          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 24 }}>🛡️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>
                    Tự Động Bỏ Chạy Khi Chưa Đủ Đội Ngũ
                  </h3>
                  <div className="muted small" style={{ fontSize: 12, marginTop: 2 }}>
                    Tự động bỏ chạy (cả Nhân vật &amp; Võ tướng) nếu vào trận mà tổ đội chưa tập hợp đầy đủ thành viên đã cấu hình.
                  </div>
                </div>
              </div>
              <label className="switch" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  disabled={!can || partyLoading || partySaving || !partyCfg}
                  checked={!!partyCfg?.escapeIfNotFullParty}
                  onChange={(e) => savePartyConfig({ escapeIfNotFullParty: e.target.checked })}
                />
                <span style={{ fontWeight: 700, fontSize: 13, color: partyCfg?.escapeIfNotFullParty ? "var(--ok)" : "var(--muted)" }}>
                  {partyCfg?.escapeIfNotFullParty ? "ĐANG BẬT" : "TẮT"}
                </span>
              </label>
            </div>

            {/* Quy tắc hoạt động */}
            <div style={{ background: "var(--panel-2)", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
              <b style={{ fontSize: 13, display: "block", marginBottom: 6, color: "var(--accent-ink)" }}>
                📋 Quy tắc hoạt động:
              </b>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: "var(--text)" }}>
                <li>
                  <b>Nếu là Chủ PT:</b> Danh sách tổ đội còn thành viên chưa gia nhập mà cá nhân hoặc đội vào trận $\rightarrow$ <b>Tự động bỏ chạy cả nhân vật và võ tướng</b>.
                </li>
                <li>
                  <b>Nếu là Thành viên:</b> Chưa gia nhập được vào đội của chủ PT mà bị vào trận $\rightarrow$ <b>Tự động bỏ chạy cả nhân vật và võ tướng</b>.
                </li>
                <li>
                  <b>Đánh bình thường:</b> Chỉ khi tổ đội đã <b>đầy đủ 100%</b> các thành viên có nhập tên (các ô slot trống không tính) thì bot mới tiến hành đánh theo cấu hình trận.
                </li>
              </ul>
            </div>

            {/* Trạng thái hiện tại của tài khoản */}
            {partyLoading ? (
              <div className="muted small" style={{ padding: 12, textAlign: "center" }}>Đang tải trạng thái tổ đội...</div>
            ) : partyCfg ? (
              <div style={{ background: "var(--panel-1)", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <b style={{ fontSize: 13 }}>
                    {partyCfg.role === "leader" ? "👑 Vai trò: Chủ tổ đội (Leader)" : "🤝 Vai trò: Thành viên (Member)"}
                  </b>
                  <span className="badge" style={{ fontSize: 11, background: "var(--panel-2)" }}>
                    Cấu hình từ tab Đội ngũ
                  </span>
                </div>

                {partyCfg.role === "leader" ? (
                  <div>
                    <div className="muted small" style={{ marginBottom: 6 }}>
                      Thành viên cần có mặt ({partyCfg.members.filter((m) => m.name.trim()).length}/4 slot đã nhập tên):
                    </div>
                    {partyCfg.members.filter((m) => m.name.trim()).length === 0 ? (
                      <div className="muted small" style={{ fontStyle: "italic", color: "var(--amber)" }}>
                        ⚠️ Chưa có thành viên nào được nhập tên trong danh sách tổ đội (hãy vào tab Đội ngũ để thêm tên thành viên).
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {partyCfg.members.filter((m) => m.name.trim()).map((m) => {
                          const isJoined = ch.party.joined && ch.party.members.some((pm) => pm.name && pm.name.toLowerCase() === m.name.trim().toLowerCase());
                          return (
                            <span
                              key={m.name}
                              className="badge"
                              style={{
                                padding: "4px 8px",
                                fontSize: 12,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                background: isJoined ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                border: isJoined ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)",
                                color: isJoined ? "var(--ok)" : "var(--bad)",
                              }}
                            >
                              <span>{isJoined ? "✅" : "⏳"}</span>
                              <b>{m.name}</b>
                              {m.advisor && <span style={{ fontSize: 10, opacity: 0.8 }}>(QS)</span>}
                              <span style={{ fontSize: 10, opacity: 0.8 }}>({isJoined ? "Đã trong team" : "Chưa vào"})</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="muted small" style={{ marginBottom: 4 }}>
                      Chủ tổ đội cần theo:
                    </div>
                    {partyCfg.leaderName.trim() ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          className="badge"
                          style={{
                            padding: "4px 8px",
                            fontSize: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: (ch.party.joined && ch.party.leaderName && ch.party.leaderName.toLowerCase() === partyCfg.leaderName.trim().toLowerCase())
                              ? "rgba(34, 197, 94, 0.15)"
                              : "rgba(239, 68, 68, 0.15)",
                            border: (ch.party.joined && ch.party.leaderName && ch.party.leaderName.toLowerCase() === partyCfg.leaderName.trim().toLowerCase())
                              ? "1px solid rgba(34, 197, 94, 0.3)"
                              : "1px solid rgba(239, 68, 68, 0.3)",
                            color: (ch.party.joined && ch.party.leaderName && ch.party.leaderName.toLowerCase() === partyCfg.leaderName.trim().toLowerCase())
                              ? "var(--ok)"
                              : "var(--bad)",
                          }}
                        >
                          <span>{(ch.party.joined && ch.party.leaderName && ch.party.leaderName.toLowerCase() === partyCfg.leaderName.trim().toLowerCase()) ? "✅" : "⏳"}</span>
                          <b>{partyCfg.leaderName}</b>
                          <span style={{ fontSize: 10, opacity: 0.8 }}>
                            {(ch.party.joined && ch.party.leaderName && ch.party.leaderName.toLowerCase() === partyCfg.leaderName.trim().toLowerCase())
                              ? "(Đã vào đội của chủ PT)"
                              : "(Chưa vào đội)"}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <div className="muted small" style={{ fontStyle: "italic", color: "var(--amber)" }}>
                        ⚠️ Chưa nhập tên chủ PT (hãy vào tab Đội ngũ để nhập tên chủ PT).
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
