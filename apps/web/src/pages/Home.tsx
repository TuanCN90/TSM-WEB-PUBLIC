import type { ChannelStatus, CharacterState, Element, MapChannelInfo, PartyMember, UnitState } from "@tsbot/protocol";
import { useState } from "react";
import { api } from "../api";
import { ELEMENT, Gauge } from "../components/common";
import { LoginPanel } from "../components/LoginPanel";
import { LogPanel } from "../components/LogPanel";
import { GeneralDialog } from "../components/GeneralDialog";
import { BattlePanel } from "../components/BattlePanel";
import { PetPanel } from "../components/PetPanel";
import { CommonConfigPanel } from "../components/CommonConfigPanel";
import { InventoryPanel } from "../components/InventoryPanel";
import { PartyCard } from "../components/PartyCard";
import { MapSelect } from "../components/MapSelect";
import { useToast } from "../components/Toast";
import { useLive } from "../live";
import type { Session } from "../sessions";
import { getMapNameById } from "../mapNames";

const CHANNEL_STATUS_META: Record<
  ChannelStatus,
  { label: string; color: string; bg: string; dot: string; border: string }
> = {
  free: {
    label: "Còn Trống",
    color: "#22c55e",
    bg: "rgba(34, 197, 94, 0.15)",
    border: "rgba(34, 197, 94, 0.4)",
    dot: "🟢",
  },
  busy: {
    label: "Đang đông",
    color: "#eab308",
    bg: "rgba(234, 179, 8, 0.15)",
    border: "rgba(234, 179, 8, 0.4)",
    dot: "🟡",
  },
  full: {
    label: "Đầy",
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.15)",
    border: "rgba(239, 68, 68, 0.4)",
    dot: "🔴",
  },
};

/** Mốc level Dị giới (khớp `DIJIE_LEVEL_LIST` của engine, đúng thứ tự menu tool gốc). */
const DIJIE_LEVELS = [10, 25, 40, 55, 70, 85, 100, 110, 120, 130, 140, 150, 160, 170, 180];
const nf = (n: number) => n.toLocaleString("vi-VN");

const emptyUnit = (): UnitState => ({ name: "", level: 0, hp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, exp: 0 });
const EMPTY: CharacterState = {
  player: emptyUnit(), pet: emptyUnit(), economy: { xu: 0, gold: 0 },
  party: { members: [1, 2, 3, 4, 5].map((slot) => ({ slot, name: "", isLeader: false, isAdvisor: false })), inviteStatus: "" },
  location: { map: 0, x: 0, y: 0, channel: 0 }, inBattle: false, auto: false, bag: [],
};

function UnitPanel({ u }: { u: UnitState }) {
  return (
    <section className="card unit">
      <div className="unit-head">
        <b className="unit-name">
          {u.name && <span className={`elem-box ${u.element ?? "none"}`} title={u.element ? `Hệ ${ELEMENT[u.element].label}` : "Chưa xác định hệ"}>{u.element ? ELEMENT[u.element].icon : "?"}</span>}
          <span className="nm">{u.name || "—"}</span>
        </b>
        <span className="lv">Lv {u.level}</span>
      </div>
      <Gauge kind="hp" cur={u.hp.cur} max={u.hp.max} />
      <Gauge kind="sp" cur={u.sp.cur} max={u.sp.max} />
      <Gauge kind="exp" cur={u.exp} max={100} label={`${u.exp.toFixed(2)}%`} />
      {u.expCur != null && u.expMax != null && <div className="muted small expnum">EXP {nf(u.expCur)} / {nf(u.expMax)}</div>}
    </section>
  );
}

/** Màn hình chính: đăng nhập + nhân vật/võ tướng + vị trí + đội ngũ + tài sản + sân đấu 20 ô + log. */
export function Home({ session }: { session: Session }) {
  const { connections, characters } = useLive();
  const selected = session.accountId;
  const conn = connections.find((c) => c.accountId === selected);
  const ch = (selected && characters[selected]) || EMPTY;
  const online = conn?.state === "online";
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [warp, setWarp] = useState("");
  const [dest, setDest] = useState({ x: "", y: "" });
  const [tab, setTabRaw] = useState<"general" | "config" | "inventory" | "pet" | "battle">("general");
  const [bankPending, setBankPending] = useState(false);
  const [leaveGo, setLeaveGo] = useState<(() => void) | null>(null);
  /** Còn gửi/rút Tiền Trang chưa Lưu & Đóng ⇒ hỏi xác nhận trước khi rời. */
  const guardLeave = (go: () => void) => {
    if (bankPending) setLeaveGo(() => go);
    else go();
  };
  const setTab = (t: typeof tab) => {
    if (t === tab) return;
    if (tab === "inventory") guardLeave(() => setTabRaw(t));
    else setTabRaw(t);
  };
  const [genOpen, setGenOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gate, setGate] = useState("");
  const [dijieOpen, setDijieOpen] = useState(false);
  const [dijiePick, setDijiePick] = useState(25);
  const [channelSelectorOpen, setChannelSelectorOpen] = useState(false);

  const act = async (action: string, params?: Record<string, string | number>) => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.dispatch(selected, action, params);
      // Thành công thì tab "Sự kiện" đã báo rồi; chỉ hiện toast khi lỗi hoặc server có lời nhắn kèm theo.
      if (!r.ok) toast("error", r.message ?? "Thao tác không thành công");
      else if (r.message) toast("info", r.message);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const can = online && !busy;
  const loc = ch.location ?? { map: 0, x: 0, y: 0, channel: 0 };
  const mapName = getMapNameById(loc.map);

  const activeChannels: MapChannelInfo[] =
    loc.channels && loc.channels.length > 0
      ? loc.channels
      : [
          {
            id: loc.channel ?? 0,
            name: `Kênh ${(loc.channel ?? 0) + 1}`,
            status: "free",
          },
        ];

  const currentChannelInfo = activeChannels.find((c) => c.id === loc.channel) ?? {
    id: loc.channel ?? 0,
    name: `Kênh ${(loc.channel ?? 0) + 1}`,
    status: (loc.channel ?? 0) === 0 ? "busy" : "free",
  };

  const isAutoMoving = !!ch.chaseConfig?.enabled;
  const isAutoMoveOnCurrentMap = isAutoMoving && ch.chaseConfig?.mapId === loc.map;

  const handleToggleAutoMove = async () => {
    if (!selected) return;
    if (isAutoMoveOnCurrentMap) {
      try {
        setBusy(true);
        await api.saveChaseConfig(selected, { enabled: false });
        toast("info", "🛑 Đã tắt tự động di chuyển.");
      } catch (err) {
        toast("error", `Lỗi: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    } else {
      try {
        setBusy(true);
        await api.saveChaseConfig(selected, {
          enabled: true,
          mapId: loc.map,
          originX: loc.x,
          originY: loc.y,
          maxRadius: ch.chaseConfig?.maxRadius || 150,
          npcId: undefined,
          npcName: undefined,
          autoReturn: true,
        });
        toast("ok", `🚶 Đã BẬT tự động di chuyển tại Map ${loc.map} (${loc.x}, ${loc.y})!`);
      } catch (err) {
        toast("error", `Lỗi: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    }
  };

  const handleMoveToSafeSpot = async () => {
    if (!can || !loc.map) return;
    const selfMember = ch.party?.members?.find((m) => m.isSelf);
    const isLeader = Boolean(selfMember?.isLeader);
    if (ch.party?.joined && !isLeader) {
      toast("error", "Ní đang trong tổ đội, không được phép chạy lung tung!!!");
      return;
    }
    toast("info", "🛡️ Đang di chuyển đến chỗ an toàn gần cổng vào...");
    await act("move_to_safe_spot");
  };

  return (
    <div className="home-wrapper">
      <div className="home-tabbar">
        <button
          type="button"
          className={`home-tab ${tab === "general" ? "on" : ""}`}
          onClick={() => setTab("general")}
        >
          <span>📋</span> Thông tin Chung
        </button>
        <button
          type="button"
          className={`home-tab ${tab === "config" ? "on" : ""}`}
          onClick={() => setTab("config")}
        >
          <span>⚙️</span> Cấu hình Chung
        </button>
        <button
          type="button"
          className={`home-tab ${tab === "inventory" ? "on" : ""}`}
          onClick={() => setTab("inventory")}
        >
          <span>🎒</span> Thùng Đồ
          {ch.bag && ch.bag.length > 0 && (
            <span className="muted small" style={{ fontSize: 11, marginLeft: 2 }}>
              ({ch.bag.length})
            </span>
          )}
        </button>
        <button
          type="button"
          className={`home-tab ${tab === "pet" ? "on" : ""}`}
          onClick={() => setTab("pet")}
        >
          <span>🐾</span> Võ Tướng
          {ch.pets && ch.pets.length > 0 && (
            <span className="muted small" style={{ fontSize: 11, marginLeft: 2 }}>
              ({ch.pets.length})
            </span>
          )}
        </button>
        <button
          type="button"
          className={`home-tab ${tab === "battle" ? "on" : ""}`}
          onClick={() => setTab("battle")}
        >
          <span>⚔️</span> Trận Đấu
          {ch.inBattle && <span className="chip warn glow tab-badge">Đang chiến đấu</span>}
        </button>
      </div>

      {tab === "general" && (
        <div className={`home ${online ? "" : "stale"}`}>
          <div className="home-col">
            <LoginPanel session={session} />
            <div className="home-units">
              <UnitPanel u={ch.player} />
              <UnitPanel u={ch.pet} />
            </div>

            <PartyCard accountId={selected || session.username || "default"} ch={ch} can={can} act={act} />

            <section className="card actions compact">
              <button className="iconbtn" data-tip="Vào map Dị giới" aria-label="Vào map Dị giới" disabled={!can} onClick={() => setDijieOpen(true)}>🌀</button>
              <button className="iconbtn" data-tip="Dịch chuyển đến cổng thành" aria-label="Dịch chuyển đến cổng thành" disabled={!can} onClick={() => setGateOpen(true)}>🏯</button>
              <button className="iconbtn" data-tip="General" aria-label="General" disabled={!online} onClick={() => setGenOpen(true)}>🧰</button>
              <button className="iconbtn" data-tip="Điểm danh ngày" aria-label="Điểm danh ngày" disabled={!can} onClick={() => act("daily_checkin")}>📅</button>
              <button className="iconbtn" data-tip="Nhận quà Online" aria-label="Nhận quà Online" disabled={!can} onClick={() => act("online_reward_all")}>🎁</button>
              <button className="iconbtn" data-tip="Tặng & Nhận quà bạn bè" aria-label="Tặng & Nhận quà bạn bè" disabled={!can} onClick={() => act("friend_gift_all")}>🤝</button>
              <button className="iconbtn" data-tip="Rút 1 bí cấp tướng (9.000 Xu)" aria-label="Rút 1 bí cấp tướng" disabled={!can} onClick={() => act("pull_secret")}>📜</button>
              <button className="iconbtn" data-tip="Rút 1 thẻ tướng (9.000 Xu)" aria-label="Rút 1 thẻ tướng" disabled={!can} onClick={() => act("pull_card")}>🃏</button>
            </section>
          </div>

          <div className="home-col">
            <section className="card econ compact">
              <div className="chip big xu"><span>🪙 Xu</span><b>{nf(ch.economy.xu)}</b></div>
              <div className="chip big gold"><span>🥇 Vàng</span><b>{nf(ch.economy.gold)}</b></div>
              <div className="econ-flags">
                {ch.inBattle && <span className="chip warn glow" style={{ cursor: "pointer" }} title="Bấm để mở tab Trận đấu" onClick={() => setTab("battle")}>⚔ Đang chiến đấu</span>}
                {ch.auto && <span className="chip ok">Auto bật</span>}
                {ch.chaseConfig?.enabled && (
                  <span
                    className="chip glow"
                    style={{
                      background: "rgba(236, 72, 153, 0.2)",
                      color: "#f472b6",
                      border: "1px solid #ec4899",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      cursor: "pointer",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                    title={`Đang truy kích quái${ch.chaseConfig.npcName ? ` [${ch.chaseConfig.npcName}]` : ""} tại Map ${ch.chaseConfig.mapId} (${ch.chaseConfig.originX}, ${ch.chaseConfig.originY}) • Bán kính ${ch.chaseConfig.maxRadius}px. Nhấp để dừng.`}
                    onClick={() => {
                      if (selected) {
                        void api.saveChaseConfig(selected, { enabled: false });
                        toast("info", "🛑 Đã tắt chế độ truy kích quái");
                      }
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ec4899" }} />
                    <span>🎯 Truy kích: {ch.chaseConfig.npcName || `Map ${ch.chaseConfig.mapId}`}</span>
                    <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 2 }}>✕</span>
                  </span>
                )}
              </div>
            </section>

            <section className="card loc compact">
              {ch.chaseConfig?.enabled && (
                <div
                  style={{
                    padding: "6px 10px",
                    background: "rgba(236, 72, 153, 0.12)",
                    border: "1px solid rgba(236, 72, 153, 0.35)",
                    borderRadius: 6,
                    fontSize: 11,
                    color: "#f472b6",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span>🎯</span>
                    <span>
                      <strong>Đang Tự Động Di Chuyển / Truy Kích:</strong> {ch.chaseConfig.npcName ? `${ch.chaseConfig.npcName} • ` : ""}Tâm Map {ch.chaseConfig.mapId} ({ch.chaseConfig.originX}, {ch.chaseConfig.originY}) • Bán kính {ch.chaseConfig.maxRadius}px
                    </span>
                  </span>
                  <button
                    type="button"
                    style={{
                      background: "rgba(239, 68, 68, 0.2)",
                      border: "1px solid #ef4444",
                      color: "#f87171",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                    onClick={() => {
                      if (selected) {
                        void api.saveChaseConfig(selected, { enabled: false });
                        toast("info", "🛑 Đã dừng tự động di chuyển");
                      }
                    }}
                  >
                    Dừng
                  </button>
                </div>
              )}
              <div className="row">
                <h2>Vị trí & Bản đồ</h2>
                {mapName && <b className="mapname" title={`Map ${loc.map}`}>{mapName}</b>}
                <span className="sp" />
                <div className="loc-now">
                  <div><span className="muted small">Map</span><b>{loc.map || "—"}</b></div>
                  <div><span className="muted small">X</span><b>{loc.x}</b></div>
                  <div><span className="muted small">Y</span><b>{loc.y}</b></div>
                  <div>
                    <span className="muted small">Kênh</span>
                    <b style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span title={CHANNEL_STATUS_META[currentChannelInfo.status].label}>
                        {CHANNEL_STATUS_META[currentChannelInfo.status].dot}
                      </span>
                      <span>{currentChannelInfo.name}</span>
                    </b>
                  </div>
                </div>
              </div>
              <div className="row wrap" style={{ alignItems: "center", gap: 8 }}>
                <form className="row warp" onSubmit={(e) => { e.preventDefault(); if (can && warp) act("warp_map", { mapId: warp }); }}>
                  <MapSelect value={warp} onChange={setWarp} />
                  <button className="primary" disabled={!can || !warp}>Warp</button>
                </form>

                {/* Button Đến Chỗ An Toàn */}
                <button
                  type="button"
                  id="btn-move-to-safe-spot"
                  disabled={!can || !loc.map}
                  onClick={() => void handleMoveToSafeSpot()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    fontWeight: 600,
                    fontSize: 12,
                    borderRadius: 6,
                    cursor: can && loc.map ? "pointer" : "default",
                    transition: "all 0.15s ease",
                    border: "1px solid rgba(16, 185, 129, 0.45)",
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "#34d399",
                  }}
                  title="Di chuyển đến vị trí an toàn cách cổng vào một ít px (không qua cổng) để chờ/lập đội mà không bị quái kéo vào trận"
                >
                  <span style={{ fontSize: 13 }}>🛡️</span>
                  <span>Đến Chỗ An Toàn</span>
                </button>

                {/* Button Bật/Tắt Tự Động Di Chuyển */}
                <button
                  type="button"
                  id="btn-toggle-auto-move"
                  disabled={!can || !loc.map}
                  onClick={handleToggleAutoMove}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    fontWeight: 600,
                    fontSize: 12,
                    borderRadius: 6,
                    cursor: can && loc.map ? "pointer" : "default",
                    transition: "all 0.15s ease",
                    border: isAutoMoving
                      ? "1px solid rgba(239, 68, 68, 0.6)"
                      : "1px solid rgba(56, 189, 248, 0.4)",
                    background: isAutoMoving
                      ? "rgba(239, 68, 68, 0.15)"
                      : "rgba(56, 189, 248, 0.12)",
                    color: isAutoMoving ? "#f87171" : "#38bdf8",
                  }}
                  title={
                    isAutoMoving
                      ? (isAutoMoveOnCurrentMap
                          ? `Đang BẬT tự động di chuyển tại Map ${ch.chaseConfig?.mapId} (${ch.chaseConfig?.originX}, ${ch.chaseConfig?.originY}) • Bán kính ${ch.chaseConfig?.maxRadius || 150}px. Bấm để TẮT.`
                          : `Đang bật ở Map ${ch.chaseConfig?.mapId}. Bấm để chuyển tự động di chuyển sang Map hiện tại ${loc.map} (${loc.x}, ${loc.y}).`)
                      : `Bật tự động di chuyển & tuần tra tại Map ${loc.map} (${loc.x}, ${loc.y})`
                  }
                >
                  <span style={{ fontSize: 13 }}>{isAutoMoving ? "🛑" : "🚶"}</span>
                  <span>{isAutoMoving ? (isAutoMoveOnCurrentMap ? "Dừng tự di chuyển" : "Tự di chuyển map này") : "Tự động di chuyển"}</span>
                  {isAutoMoving && isAutoMoveOnCurrentMap && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#22c55e",
                        display: "inline-block",
                        boxShadow: "0 0 6px #22c55e",
                      }}
                    />
                  )}
                </button>
                {/* Kênh hiện tại + công cụ đổi kênh */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", margin: "4px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="muted small">Kênh:</span>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: CHANNEL_STATUS_META[currentChannelInfo.status].color,
                        background: CHANNEL_STATUS_META[currentChannelInfo.status].bg,
                        border: `1px solid ${CHANNEL_STATUS_META[currentChannelInfo.status].border}`,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span>{CHANNEL_STATUS_META[currentChannelInfo.status].dot}</span>
                      <span>{currentChannelInfo.name}</span>
                      <span style={{ fontSize: 11, opacity: 0.85 }}>({CHANNEL_STATUS_META[currentChannelInfo.status].label})</span>
                    </span>
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        const next = !channelSelectorOpen;
                        setChannelSelectorOpen(next);
                        if (next && can) {
                          act("refresh_channels");
                        }
                      }}
                      style={{ padding: "3px 8px", fontSize: 12, borderRadius: 6 }}
                    >
                      {channelSelectorOpen ? "Đóng danh sách kênh ✕" : "Đổi kênh 📡"}
                    </button>
                  </div>
                </div>

                {channelSelectorOpen && (
                  <div
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--bg2, #1f2430)",
                      borderRadius: 8,
                      border: "1px solid var(--border, #333)",
                      marginBottom: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>📡 Danh sách Kênh {mapName ? `(Map ${loc.map} - ${mapName})` : `(Map ${loc.map})`}:</span>
                        <button
                          type="button"
                          className="small"
                          disabled={!can}
                          onClick={() => act("refresh_channels")}
                          title="Làm mới danh sách kênh từ máy chủ (gói 07/01)"
                          style={{ padding: "2px 6px", fontSize: 11, borderRadius: 4 }}
                        >
                          🔄 Làm mới
                        </button>
                      </span>
                      <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                        <span style={{ color: "#22c55e" }}>🟢 Còn Trống</span>
                        <span style={{ color: "#eab308" }}>🟡 Đang đông</span>
                        <span style={{ color: "#ef4444" }}>🔴 Đầy</span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
                      {activeChannels.map((chItem) => {
                        const isCurrent = chItem.id === loc.channel;
                        const meta = CHANNEL_STATUS_META[chItem.status];
                        return (
                          <button
                            key={chItem.id}
                            id={`channel-btn-${chItem.id}`}
                            disabled={!can}
                            onClick={async () => {
                              if (isCurrent) {
                                toast("info", `Nhân vật đang ở ${chItem.name} rồi.`);
                                return;
                              }
                              if (chItem.status === "full") {
                                const ok = window.confirm(
                                  `${chItem.name} đang ở trạng thái BÁO ĐẦY. Bạn có chắc chắn muốn thử chuyển sang kênh này không?`
                                );
                                if (!ok) return;
                              }
                              try {
                                toast("info", `Đang gửi lệnh chuyển sang ${chItem.name}...`);
                                await act("channel", { channel: chItem.id });
                              } catch (err) {
                                toast("error", `Không thể chuyển kênh: ${err instanceof Error ? err.message : String(err)}`);
                              }
                            }}
                            title={isCurrent ? "Đang ở kênh này" : `Bấm để chuyển sang ${chItem.name} (${meta.label})`}
                            style={{
                              padding: "6px 8px",
                              fontSize: 12,
                              borderRadius: 6,
                              border: isCurrent
                                ? "2px solid var(--accent, #4f8ef7)"
                                : `1px solid ${meta.border}`,
                              background: isCurrent ? "rgba(79, 142, 247, 0.2)" : meta.bg,
                              color: isCurrent ? "#fff" : meta.color,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              cursor: can ? "pointer" : "default",
                              fontWeight: isCurrent ? 700 : 500,
                              opacity: can ? 1 : 0.6,
                              transition: "all 0.15s ease",
                            }}
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span>{meta.dot}</span>
                              <span>{chItem.name} {chItem.max ? `(${chItem.cur ?? 0}/${chItem.max})` : ""}</span>
                            </span>
                            <span style={{ fontSize: 10, opacity: 0.9 }}>
                              {isCurrent ? "✓ Đứng đây" : meta.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="row wrap">
                <input style={{ width: 80 }} inputMode="numeric" placeholder="X mới" value={dest.x} onChange={(e) => setDest({ ...dest, x: e.target.value })} />
                <input style={{ width: 80 }} inputMode="numeric" placeholder="Y mới" value={dest.y} onChange={(e) => setDest({ ...dest, y: e.target.value })} />
                <button disabled={!can || !dest.x.trim() || !dest.y.trim()} onClick={() => act("move", dest)}>Đi</button>
                <button disabled={!can || !dest.x.trim() || !dest.y.trim()} onClick={() => act("ai_find", dest)} title="Tự tìm đường tới toạ độ">AI tìm</button>
                <button disabled={!can} onClick={() => act("open_map")}>Bản đồ</button>
              </div>
            </section>

            <section className="card homelog">
              <LogPanel accountId={selected} />
            </section>
          </div>
        </div>
      )}

      {tab === "config" && (
        <div className={`config-tab-wrapper ${online ? "" : "stale"}`} style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CommonConfigPanel
            key={selected || session.username || "default"}
            accountId={selected || session.username || "default"}
            can={can}
            ch={ch}
            act={act}
            onToast={toast}
          />
        </div>
      )}

      {tab === "inventory" && (
        <div className={`inv-tab-wrapper ${online ? "" : "stale"}`} style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <InventoryPanel accountId={selected || session.username || "default"} bag={ch.bag ?? []} bank={ch.bank ?? []} bankOpen={ch.bankOpen ?? false} canAct={can} act={act} onBankPendingChange={setBankPending} guardLeave={guardLeave} />
        </div>
      )}

      {tab === "pet" && (
        <div className={`pet-tab-wrapper ${online ? "" : "stale"}`} style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <PetPanel can={can} pets={ch.pets ?? []} ch={ch} act={act} accountId={selected || session.username || "default"} />
        </div>
      )}

      {leaveGo && (
        <div className="modal-back top" onClick={() => setLeaveGo(null)}>
          <div className="modal card" role="alertdialog" aria-label="Xác nhận Lưu - Đóng Tiền Trang" onClick={(e) => e.stopPropagation()}>
            <h2>Lưu - Đóng Tiền Trang?</h2>
            <p>Bạn đã gửi/rút vật phẩm nhưng chưa Lưu - Đóng Tiền Trang. Cần đóng kho để máy chủ lưu dữ liệu trước khi rời tab.</p>
            <div className="row">
              <span className="sp" />
              <button autoFocus onClick={() => setLeaveGo(null)}>Ở lại</button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const go = leaveGo;
                  setLeaveGo(null);
                  await act("close_bank");
                  go();
                }}
              >
                💾 Lưu - Đóng Tiền Trang
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "battle" && (
        <div className={`battle-tab-wrapper ${online ? "" : "stale"}`} style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <BattlePanel
            accountId={selected || session.username || "default"}
            can={can}
            ch={ch}
            act={act}
          />
        </div>
      )}

      {genOpen && (
        <GeneralDialog
          can={can}
          offline={ch.offlineExp}
          ch={ch}
          act={act}
          onClose={() => setGenOpen(false)}
        />
      )}
      {gateOpen && (
        <div className="modal-back" onClick={() => setGateOpen(false)}>
          <div className="modal card" role="dialog" aria-label="Dịch chuyển đến cổng thành" onClick={(e) => e.stopPropagation()}>
            <h2>Dịch chuyển đến cổng thành</h2>
            <MapSelect source="gates" value={gate} onChange={setGate} />
            <div className="row">
              <span className="sp" />
              <button onClick={() => setGateOpen(false)}>Huỷ</button>
              <button className="primary" disabled={!can || !gate} onClick={() => { setGateOpen(false); act("teleport_gate", { mapId: gate }); }}>Dịch chuyển</button>
            </div>
          </div>
        </div>
      )}
      {dijieOpen && (
        <div className="modal-back" onClick={() => setDijieOpen(false)}>
          <div className="modal card" role="dialog" aria-label="Vào map Dị giới" onClick={(e) => e.stopPropagation()}>
            <h2>Vào map Dị giới</h2>
            <div className="dijie-opts">
              {DIJIE_LEVELS.map((lv) => (
                <label key={lv} className={dijiePick === lv ? "on" : ""}>
                  <input type="radio" name="dijie" checked={dijiePick === lv} onChange={() => setDijiePick(lv)} /> Dị giới Lv.{lv}
                </label>
              ))}
            </div>
            <div className="row">
              <span className="sp" />
              <button onClick={() => setDijieOpen(false)}>Huỷ</button>
              <button className="primary" disabled={!can} onClick={() => { setDijieOpen(false); act("dijie_enter", { level: dijiePick }); }}>Xác nhận</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
