import type { CharacterState, OfflineExpInfo } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { Gauge } from "./common";

type Act = (action: string, params?: Record<string, string | number>) => Promise<void>;
const nf = (n: number) => n.toLocaleString("vi-VN");

/** Popup General: chỉ đóng bằng nút Đóng (bấm ra ngoài không đóng). Mỗi tính năng con mở popup riêng. */
export function GeneralDialog({ can, offline, ch, act, onClose }: { can: boolean; offline?: OfflineExpInfo; ch: CharacterState; act: Act; onClose: () => void }) {
  const [sub, setSub] = useState<"offline" | "char" | null>(null);
  return (
    <div className="modal-back">
      <div className="modal card" role="dialog" aria-label="General">
        <h2>General</h2>
        <div className="gen-list">
          <button className="gen-item" disabled={!can} onClick={() => act("online_reward_all")}>🎁 Nhận Quà Online</button>
          <button className="gen-item" disabled={!can} onClick={() => setSub("offline")}>⏳ Nhận Exp Offline</button>
          <button className="gen-item" disabled={!can} onClick={() => act("mail_claim_all")}>📬 Nhận Quà Thư</button>
          <button className="gen-item" onClick={() => setSub("char")}>📊 Trạng thái nhân vật</button>
        </div>
        <div className="row"><span className="sp" /><button onClick={onClose}>Đóng</button></div>
      </div>
      {sub === "offline" && <OfflineExpDialog can={can} info={offline} act={act} onClose={() => setSub(null)} />}
      {sub === "char" && <CharStatusDialog ch={ch} onClose={() => setSub(null)} />}
    </div>
  );
}

function OfflineExpDialog({ can, info, act, onClose }: { can: boolean; info?: OfflineExpInfo; act: Act; onClose: () => void }) {
  useEffect(() => { if (can) act("offline_exp_info"); }, []); // làm mới bảng giá như client khi mở popup
  const h = info ? `${Math.floor(info.minutes / 60)} giờ ${info.minutes % 60} phút` : "—";
  return (
    <div className="modal-back top">
      <div className="modal card" role="dialog" aria-label="Nhận Exp Offline">
        <h2>Nhận Exp Offline</h2>
        <div className="gen-info">
          <div><span className="muted small">Tổng thời gian offline</span><b title="Suy ra từ giá Xu (1 Xu / phút)">{h}</b></div>
          <div><span className="muted small">Exp thu được</span><b title="Server không báo trước; xem tab Sự kiện sau khi nhận">—</b></div>
          <div><span className="muted small">Xu cần trả (lựa chọn 2)</span><b>{info ? nf(info.xuCost) : "—"}</b></div>
          <div><span className="muted small">Vàng cần trả (lựa chọn 3)</span><b>{info ? nf(info.goldCost) : "—"}</b></div>
        </div>
        <div className="gen-list">
          <button className="gen-item primary" disabled={!can} onClick={() => { act("offline_exp_free"); onClose(); }}>🎁 Free{info ? ` · ${info.freePct}% exp` : ""}</button>
          <button className="gen-item" disabled data-tip="Chưa có gói tin mua (cần cap)">🪙 Xu{info ? ` · ${info.xuPct}% exp · ${nf(info.xuCost)} Xu` : ""}</button>
          <button className="gen-item" disabled data-tip="Chưa có gói tin mua (cần cap)">🥇 Vàng{info ? ` · ${info.goldPct}% exp · ${nf(info.goldCost)} Vàng` : ""}</button>
        </div>
        <div className="row"><span className="sp" /><button onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}

const SLOT_LABEL = ["Mũ / khăn", "Giáp", "Vũ khí", "Hộ uyển", "Giày"];
const CHAR_ROWS = ["int", "atk", "def", "hp", "sp", "agi"] as const;

/** Trạng thái nhân vật như tab "Nhân Vật" của tool gốc: điểm tiềm năng, bảng [Gốc]+[Trang bị]+[Bonus]=[Tổng], trang bị đang mặc. */
function CharStatusDialog({ ch, onClose }: { ch: CharacterState; onClose: () => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [equip, setEquip] = useState("");
  useEffect(() => { import("../data/itemNames.json").then((m) => setNames(m.default as Record<string, string>)); }, []);
  const u = ch.player;
  return (
    <div className="modal-back top">
      <div className="modal card" role="dialog" aria-label="Trạng thái nhân vật">
        <h2>Trạng thái nhân vật</h2>
        <div className="unit-head"><b className="unit-name"><span className="nm">{u.name || "—"}</span></b><span className="lv">Lv {u.level}</span></div>
        <Gauge kind="hp" cur={u.hp.cur} max={u.hp.max} />
        <Gauge kind="sp" cur={u.sp.cur} max={u.sp.max} />
        <div className="row"><b>Point: {ch.point != null ? nf(ch.point) : "—"}</b><span className="muted small">điểm tiềm năng chưa cộng</span></div>
        <div className="gen-stat">
          <div className="gen-stat-row head"><span /><span>Gốc</span><span>Trang bị</span><span>Bonus</span><span>Tổng</span></div>
          {CHAR_ROWS.map((k) => {
            const g = k === "hp" || k === "sp" ? 0 : ch.gear?.[k] ?? 0;
            return (
              <div key={k} className="gen-stat-row">
                <span className="muted small">{k.toUpperCase()} <button className="gen-plus" disabled data-tip="Chưa có gói cộng điểm (cần cap)">+</button></span>
                <span className="muted" title="Chỉ số gốc của nhân vật chưa tìm thấy trong gói tin">—</span>
                <span>{g ? `+${nf(g)}` : "0"}</span>
                <span className="muted" title="Bonus (thẻ bài…) chưa đọc được">—</span>
                <span className="muted">—</span>
              </div>
            );
          })}
          <div className="muted small">Gốc và Bonus của nhân vật chưa đọc được từ gói tin nên chưa tính Tổng.</div>
        </div>
        <div className="gen-list">
          {(ch.equipment ?? []).length === 0 && <div className="muted small">Chưa đọc được trang bị.</div>}
          {(ch.equipment ?? []).map((e) => (
            <div key={e.slot} className="gen-equip"><span className="muted small">{SLOT_LABEL[e.slot] ?? `Ô ${e.slot + 1}`}</span><b>{names[String(e.id)] ?? `#${e.id}`}</b></div>
          ))}
        </div>
        <div className="row">
          <input style={{ flex: 1, minWidth: 0 }} placeholder="Mã / tên trang bị" value={equip} onChange={(e) => setEquip(e.target.value)} />
          <button disabled data-tip="Chưa có gói thay đồ (cần cap)">Thay đồ</button>
        </div>
        <div className="row"><span className="sp" /><button onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}
