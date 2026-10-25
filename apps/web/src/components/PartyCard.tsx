import type { CharacterState, PartyConfig, PartyEntryStatus } from "@tsbot/protocol";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * Thẻ "Đội ngũ" — lập đội giữa các tài khoản theo TÊN NHÂN VẬT (logic ở server: services/party.ts, tài liệu: docs/PARTY_KNOWLEDGE.md).
 *  • Chủ PT: nhập tối đa 4 tên thành viên (+ tick QSư). Server tự MỜI người cùng map, tự nhận lời XIN của đúng các tên này.
 *  • Thành viên: nhập "Tên chủ PT". Server tự XIN vào đội khi chủ PT cùng map, tự nhận lời MỜI của chủ PT.
 *  • Tag trạng thái từng tên: lấy từ `ch.partyPlan` (server tính) — chủ PT thấy tag từng thành viên, thành viên thấy tag của chính mình.
 */
const EMPTY_CFG: PartyConfig = { enabled: false, role: "leader", leaderName: "", members: [] };

const TAG: Record<PartyEntryStatus, { text: string; cls: string; tip: string }> = {
  idle: { text: "Chưa bật", cls: "", tip: "Chưa bật lập đội" },
  offline: { text: "Offline", cls: "warn", tip: "Tài khoản này chưa online trên web" },
  not_in_map: { text: "⌀ Chưa thấy trong map", cls: "warn", tip: "Chỉ mời/xin được người đang đứng cùng map. Hãy đưa các nhân vật vào cùng map." },
  inviting: { text: "⏳ Đã mời", cls: "", tip: "Đã gửi lời mời, chờ đối phương đồng ý" },
  requesting: { text: "⏳ Đã xin vào đội", cls: "", tip: "Đã gửi lời xin gia nhập, chờ chủ PT đồng ý" },
  in_party: { text: "✔ Đã vào đội", cls: "ok", tip: "Đã party thành công" },
  advisor: { text: "★ Đã vào đội · QSư", cls: "ok", tip: "Đã party thành công và đang là Quân sư" },
  advisor_pending: { text: "✔ Đã vào đội · đang gán QSư", cls: "warn", tip: "Đã vào đội, đang chờ server xác nhận gán Quân sư (hoặc gán thất bại — xem log)" },
  error: { text: "✖ Lỗi", cls: "warn", tip: "Xem chi tiết trong tab Sự kiện / Log" },
};

function Tag({ status, detail }: { status: PartyEntryStatus; detail?: string }) {
  const t = TAG[status];
  return (
    <span className={`chip ${t.cls}`} title={detail ? `${t.tip}\n${detail}` : t.tip} style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px" }}>
      {t.text}
    </span>
  );
}

export function PartyCard({
  accountId, ch, can, act,
}: {
  accountId: string;
  ch: CharacterState;
  can: boolean;
  act: (action: string, params?: Record<string, string | number>) => Promise<void>;
}) {
  const [cfg, setCfg] = useState<PartyConfig>(EMPTY_CFG);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Phân lập theo tài khoản: đổi tài khoản ⇒ nạp lại cấu hình của tài khoản đó.
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    api.partyConfig(accountId).then((c) => { if (alive) { setCfg(c); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [accountId]);

  const update = (patch: Partial<PartyConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void api.savePartyConfig(accountId, next).catch(() => {}); }, 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const plan = ch.partyPlan;
  const names = Array.from({ length: 4 }, (_, i) => cfg.members[i] ?? { name: "", advisor: false });
  const setMember = (i: number, m: { name: string; advisor: boolean }) => {
    const arr = names.map((x, j) => (j === i ? m : x));
    // Chỉ 1 Quân sư trong đội: tick ô này thì bỏ tick các ô còn lại.
    const fixed = m.advisor ? arr.map((x, j) => (j === i ? x : { ...x, advisor: false })) : arr;
    update({ members: fixed.filter((x) => x.name.trim() || x.advisor) });
  };
  const statusOf = (name: string) => plan?.entries.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());
  const disabledEdit = !loaded;
  /** Chủ PT (theo server khi đã vào đội; chưa vào đội thì theo vai trò đã chọn) ⇒ nút là "Giải tán đội", thành viên là "Rời đội". */
  const isLeader = ch.party.joined ? !!ch.party.members.find((m) => m.isSelf)?.isLeader : cfg.role === "leader";
  const canSend = cfg.role === "leader" ? cfg.members.some((m) => m.name.trim()) : !!cfg.leaderName.trim();

  /** Lưu NGAY cấu hình + bật; server quét tức thì (reset cooldown) và gửi lời mời/xin cho người chưa vào đội. */
  const start = async () => {
    clearTimeout(saveTimer.current);
    const next = { ...cfg, enabled: true };
    setCfg(next);
    try { await api.savePartyConfig(accountId, next); } catch { /* UI chỉ không báo lỗi; log ở tab Sự kiện */ }
  };
  const stop = async () => {
    clearTimeout(saveTimer.current);
    const next = { ...cfg, enabled: false };
    setCfg(next);
    try { await api.savePartyConfig(accountId, next); } catch { /* bỏ qua */ }
  };

  return (
    <section className="card party compact">
      <div className="row">
        <h2>Đội ngũ</h2>
        <span className="sp" />
        {ch.party.joined && <span className="chip ok" style={{ fontSize: 11, padding: "2px 8px" }} title="Đang ở trong đội (theo server)">✔ Đang trong đội · {ch.party.leaderName}</span>}
        {!ch.party.joined && ch.party.inviteStatus && <span className="muted small">{ch.party.inviteStatus}</span>}
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="primary"
          disabled={disabledEdit || !can || !canSend}
          title={cfg.role === "leader" ? "Quét các thành viên đã nhập và gửi lời mời cho người chưa vào đội (cùng map). Bot sẽ tự mời lại sau mỗi lần teleport." : "Gửi yêu cầu gia nhập tới chủ PT (cùng map). Bot sẽ tự xin lại sau mỗi lần teleport."}
          onClick={() => void start()}
        >
          {cfg.role === "leader" ? "🤝 Gửi lời mời PT" : "🤝 Yêu cầu gia nhập"}
        </button>
        {cfg.enabled && (
          <button type="button" disabled={disabledEdit} title="Dừng tự động mời/xin/đồng bộ warp" onClick={() => void stop()}>⏹ Dừng</button>
        )}
        <span className="sp" />
        <select value={cfg.role} disabled={disabledEdit} onChange={(e) => update({ role: e.target.value as PartyConfig["role"] })} title="Vai trò của tài khoản này">
          <option value="leader">👑 Chủ PT</option>
          <option value="member">👤 Thành viên</option>
        </select>
      </div>
      {cfg.enabled && <div className="muted small">Đang lập đội tự động (tự mời/xin lại sau mỗi lần teleport). Bấm "Dừng" để tắt.</div>}

      {cfg.role === "member" ? (
        <div className="row" style={{ gap: 6 }}>
          <input
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Tên chủ PT"
            value={cfg.leaderName}
            disabled={disabledEdit}
            onChange={(e) => update({ leaderName: e.target.value })}
          />
          {cfg.enabled && plan?.role === "member" ? <Tag status={plan.selfStatus ?? "idle"} detail={plan.entries[0]?.detail} /> : <Tag status="idle" />}
        </div>
      ) : (
        <table className="ptable">
          <tbody>
            {names.map((m, i) => {
              const e = statusOf(m.name);
              return (
                <tr key={i} className={m.name ? "" : "empty"}>
                  <td className="n">{i + 1}</td>
                  <td className="nm">
                    <input style={{ width: "100%" }} placeholder={`Tên thành viên ${i + 1}`} value={m.name} disabled={disabledEdit} onChange={(ev) => setMember(i, { ...m, name: ev.target.value })} />
                  </td>
                  <td>
                    <label className="adv" title="Gán Quân sư cho nhân vật này sau khi vào đội">
                      <input type="checkbox" checked={m.advisor} disabled={disabledEdit || !m.name.trim()} onChange={(ev) => setMember(i, { ...m, advisor: ev.target.checked })} />
                      QSư
                    </label>
                  </td>
                  <td>{m.name.trim() ? <Tag status={cfg.enabled && e ? e.status : "idle"} detail={e?.detail} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Tự động bỏ chạy khi chưa đủ đội ngũ */}
      <div style={{ padding: "8px 12px", background: "var(--panel-2)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0" }}>
        <div style={{ fontSize: 13 }}>
          <b style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span>🏃</span> Tự động bỏ chạy khi chưa đủ thành viên tổ đội
          </b>
          <div className="muted small" style={{ fontSize: 11 }}>Vào trận mà thiếu thành viên đã nhập tên → tự động chạy cả Char &amp; Pet.</div>
        </div>
        <label className="switch" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!cfg.escapeIfNotFullParty}
            onChange={(e) => update({ escapeIfNotFullParty: e.target.checked })}
          />
          <span style={{ fontWeight: 600, color: cfg.escapeIfNotFullParty ? "var(--ok)" : "var(--muted)", fontSize: 12 }}>
            {cfg.escapeIfNotFullParty ? "BẬT" : "TẮT"}
          </span>
        </label>
      </div>

      {/* Dòng trạng thái ("Đã đủ đội 3/3") + nút Giải tán/Rời đội cùng một hàng */}
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        {cfg.enabled && plan ? (
          <span
            title="Trạng thái điều phối lập đội (server)"
            style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: plan.complete ? "var(--ok)" : "var(--bad)" }}
          >
            {plan.gathering ? "⏳ Đang chờ đủ đội trước khi đi bộ… " : plan.complete ? "✅ " : "❌ "}{plan.message}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <button
          type="button"
          className="danger"
          disabled={!can || !ch.party.joined}
          title={isLeader ? "Giải tán đội (chủ PT gửi 0d/04 với uid của mình)" : "Rời khỏi đội"}
          onClick={() => act("leave_party")}
          style={{ whiteSpace: "nowrap" }}
        >
          {isLeader ? "Giải tán đội" : "Rời đội"}
        </button>
      </div>
    </section>
  );
}
