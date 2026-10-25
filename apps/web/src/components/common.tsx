import type { Account, CharacterState, ConnectionInfo, ConnectionState, Element } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useLive } from "../live";

export const STATE_LABEL: Record<ConnectionState, string> = {
  offline: "Offline", connecting: "Đang kết nối…", online: "Online", reconnecting: "Đang kết nối lại…", disconnecting: "Đang đăng xuất…",
};

export const accountLabel = (a?: Account, id = "") => (a ? `${a.username} @ ${a.server}` : id);

export const ELEMENT: Record<Element, { icon: string; label: string }> = {
  earth: { icon: "🪨", label: "Địa" }, water: { icon: "💧", label: "Thủy" }, fire: { icon: "🔥", label: "Hỏa" }, wind: { icon: "🍃", label: "Phong" },
  heart: { icon: "💗", label: "Tâm" }, light: { icon: "✨", label: "Quang" }, dark: { icon: "🌑", label: "Ám" },
};

/** "Tên nhân vật - user đăng nhập - Hệ - Lv" (tool chỉ có một máy chủ nên không hiện server). */
export function charLabel(a?: Account, ch?: CharacterState, id = ""): string {
  if (!a) return id;
  const p = ch?.player;
  return [p?.name || "…", a.username, p?.element ? ELEMENT[p.element].label : "Vô hệ", `Lv ${p?.level ?? 0}`].join(" - ");
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { api.accounts().then(setAccounts).catch(() => {}); }, []);
  return accounts;
}

/** Chọn tài khoản/kết nối dùng chung giữa các tab. */
export function ConnPicker({ onlyOnline = false }: { onlyOnline?: boolean }) {
  const accounts = useAccounts();
  const { connections, selected, select } = useLive();
  const list = onlyOnline ? accounts.filter((a) => connections.find((c) => c.accountId === a.id)?.state === "online") : accounts;
  useEffect(() => {
    if (list.length && !list.some((a) => a.id === selected)) select(list[0].id);
  }, [list.map((a) => a.id).join(","), selected]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label>Tài khoản{onlyOnline ? " (đang online)" : ""}
      <select value={selected ?? ""} onChange={(e) => select(e.target.value)}>
        {list.length === 0 && <option value="">{onlyOnline ? "(chưa có tài khoản nào online — đăng nhập ở màn hình chính)" : "(chưa có tài khoản)"}</option>}
        {list.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
      </select>
    </label>
  );
}

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Thanh tiến trình có animation; `label` mặc định "cur / max". */
export function Gauge({ kind, cur, max, label }: { kind: "hp" | "sp" | "exp"; cur: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (cur / max) * 100)) : 0;
  return (
    <div className={`gauge ${kind} ${kind === "hp" && pct < 30 ? "low" : ""}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
      <b>{kind.toUpperCase()}</b>
      <span>{label ?? `${fmt(cur)} / ${fmt(max)}`}</span>
    </div>
  );
}

/** Thẻ gọn dùng ở danh sách kết nối. */
export function CharacterCard({ c, ch }: { c: ConnectionInfo; ch?: CharacterState }) {
  if (!ch) return null;
  const on = c.state === "online";
  return (
    <div className="char">
      <div className="row"><b>{ch.player.name || "—"}</b><span className="muted small">Lv {ch.player.level} · kênh {ch.location.channel + 1}</span></div>
      <div className="small">Map <code>{ch.location.map || "—"}</code> · X <code>{ch.location.x}</code> Y <code>{ch.location.y}</code></div>
      <Gauge kind="hp" cur={on ? ch.player.hp.cur : 0} max={ch.player.hp.max} />
      <Gauge kind="sp" cur={on ? ch.player.sp.cur : 0} max={ch.player.sp.max} />
      <div className="muted small">{ch.inBattle ? "⚔ đang đánh" : "rảnh"} · auto {ch.auto ? "bật" : "tắt"}</div>
    </div>
  );
}
