import type { DungeonTeamConfig, DungeonTeamPhase, DungeonTeamState } from "@tsbot/protocol";
import { DUNGEON_ROOM_CATALOG } from "@tsbot/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { charLabel } from "../components/common";
import { useToast } from "../components/Toast";
import { useLive } from "../live";

/**
 * Tab con "Phó bản đội" (trong tab Kịch bản). Logic ở server: services/dungeonTeam.ts, tài liệu: docs/DUNGEON_TEAM_KNOWLEDGE.md.
 *  • Chủ phòng có 3 nút: [Tạo phó bản đội] warp về cổng thành tương đương (tránh trận đấu quấy nhiễu) rồi tạo phòng;
 *    [Bắt đầu] chỉ sáng khi phòng đã mở và đủ thành viên; [Huỷ] huỷ phòng/kết thúc phiên.
 *  • Thành viên: chọn loại phó bản + nhập tên chủ phòng, bấm [Tìm Đội] ⇒ bot làm mới danh sách phòng, tìm ĐÚNG phòng của chủ (tên + loại), vào phòng rồi tự bấm Sẵn sàng.
 */
const EMPTY: DungeonTeamConfig = { enabled: false, role: "leader", leaderName: "", members: [], dungeonId: 1, usePassword: false, joinPassword: "", leaveParty: true };

const PHASE: Record<DungeonTeamPhase, { text: string; cls: string }> = {
  idle: { text: "Chưa chạy", cls: "" },
  warping: { text: "🏙 Về cổng thành", cls: "" },
  searching: { text: "🔎 Đang tìm đội", cls: "" },
  waiting_members: { text: "⏳ Chờ thành viên", cls: "warn" },
  leaving_party: { text: "↩ Rời đội", cls: "" },
  creating_room: { text: "🏗 Tạo phòng", cls: "" },
  room_open: { text: "🚪 Phòng đang mở", cls: "ok" },
  starting: { text: "▶ Bắt đầu", cls: "ok" },
  in_dungeon: { text: "⚔ Đang trong phó bản", cls: "ok" },
  done: { text: "✅ Hoàn tất", cls: "ok" },
  blocked: { text: "⛔ Chờ pcap", cls: "warn" },
  error: { text: "✖ Lỗi", cls: "warn" },
};
const MEMBER_TAG: Record<string, { text: string; cls: string }> = {
  offline: { text: "Offline", cls: "warn" },
  not_in_map: { text: "⌀ Khác map", cls: "warn" },
  ready: { text: "✔ Sẵn sàng", cls: "ok" },
  in_room: { text: "🚪 Đã vào phòng", cls: "ok" },
};
const chipStyle = { fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap" } as const;
/** Chủ phòng đang trong một phiên (từ lúc bấm Tạo đến xong/huỷ/lỗi). */
const SESSION = new Set<DungeonTeamPhase>(["warping", "searching", "waiting_members", "leaving_party", "creating_room", "room_open", "starting", "in_dungeon", "blocked"]);

function PhaseChip({ st }: { st?: DungeonTeamState }) {
  const p = PHASE[st?.phase ?? "idle"];
  return <span className={`chip ${p.cls}`} style={chipStyle}>{p.text}</span>;
}

export function DungeonTeam() {
  const { connections, characters } = useLive();
  const toast = useToast();
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof api.accounts>>>([]);
  useEffect(() => { api.accounts().then(setAccounts).catch(() => {}); }, [connections.length]);
  const online = useMemo(() => accounts.filter((a) => connections.find((c) => c.accountId === a.id)?.state === "online"), [accounts, connections]);

  const [sel, setSel] = useState<string>("");
  useEffect(() => { if (!online.some((a) => a.id === sel)) setSel(online[0]?.id ?? ""); }, [online, sel]);
  const account = online.find((a) => a.id === sel);
  const ch = sel ? characters[sel] : undefined;
  const st = ch?.dungeonTeam;

  const [cfg, setCfg] = useState<DungeonTeamConfig>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  // Phân lập theo tài khoản: đổi tài khoản ⇒ nạp lại cấu hình của tài khoản đó.
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    setLoaded(false);
    api.dungeonTeamConfig(sel).then((c) => { if (alive) { setCfg(c); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [sel]);

  const update = (patch: Partial<DungeonTeamConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void api.saveDungeonTeamConfig(sel, next).catch(() => {}); }, 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const leader = cfg.role === "leader";
  /** Đang ở trong map phó bản (theo map nhân vật) hoặc phiên đang ở bước vào/trong phó bản ⇒ cho phép Thoát. */
  const inDungeon = !!ch && (DUNGEON_ROOM_CATALOG.some((d) => d.map === ch.location.map) || st?.phase === "in_dungeon" || st?.phase === "starting");
  const inSession = leader ? !!st && SESSION.has(st.phase) : cfg.enabled;
  const dis = !loaded || inSession;
  const names = Array.from({ length: 4 }, (_, i) => cfg.members[i] ?? "");
  const setMember = (i: number, v: string) => update({ members: names.map((x, j) => (j === i ? v : x)).filter((x) => x.trim()) });
  const memberState = (name: string) => st?.members.find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase());
  /** Lưu cấu hình ngay (huỷ hẹn giờ lưu) rồi gọi lệnh của chủ phòng. */
  const run = async (action: "create" | "start" | "cancel" | "exit") => {
    setBusy(true);
    try {
      clearTimeout(saveTimer.current);
      if (action === "create") await api.saveDungeonTeamConfig(sel, cfg);
      await api.dungeonTeamAction(sel, action);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  /** Thành viên: bật/tắt "Sẵn sàng". */
  const setReady = async (enabled: boolean) => {
    clearTimeout(saveTimer.current);
    const next = { ...cfg, enabled };
    setCfg(next);
    try { setCfg(await api.saveDungeonTeamConfig(sel, next)); } catch { /* lỗi hiện ở log tài khoản */ }
  };

  return (
    <div className="grid2 dt-page">
      <section className="card dt">
        <h2>Tài khoản</h2>
        {online.length === 0 && <div className="muted small">Chưa có tài khoản nào online.</div>}
        <div className="dt-accounts">
          {online.map((a) => {
            const s = characters[a.id]?.dungeonTeam;
            return (
              <button type="button" key={a.id} className={`dt-acc ${a.id === sel ? "on" : ""}`} onClick={() => setSel(a.id)}>
                <span className="dt-acc-name">{charLabel(a, characters[a.id], a.id)}</span>
                {s && s.phase !== "idle" ? <PhaseChip st={s} /> : null}
              </button>
            );
          })}
        </div>
        <div className="muted small">Mỗi tài khoản cấu hình độc lập. Chủ phòng: chọn phó bản + thành viên rồi bấm "Tạo phó bản đội". Thành viên: chọn phó bản, nhập tên chủ phòng rồi bấm "Tìm Đội".</div>
      </section>

      <section className="card dt">
        {!account ? <div className="muted">Chọn một tài khoản online.</div> : (
          <>
            <div className="row">
              <h2>Phó bản đội · {ch?.player.name || account.username}</h2>
              <span className="sp" />
              <PhaseChip st={st} />
            </div>

            <div className="dt-field">
              <span className="dt-label">Vai trò</span>
              <div className="dt-seg" role="group" aria-label="Vai trò">
                <button type="button" className={leader ? "on" : ""} disabled={dis} onClick={() => update({ role: "leader" })}>👑 Chủ phòng</button>
                <button type="button" className={!leader ? "on" : ""} disabled={dis} onClick={() => update({ role: "member" })}>👤 Thành viên</button>
              </div>
            </div>

            {leader ? (
              <div className="dt-actions">
                <button type="button" className="primary" disabled={!loaded || busy || inSession} onClick={() => void run("create")}
                  title="Warp về cổng thành tương đương vị trí hiện tại (tránh bị vào trận đấu quấy nhiễu) rồi tạo phòng phó bản đội">
                  🏗 Tạo phó bản đội
                </button>
                <button type="button" className="primary" disabled={busy || !st?.canStart} onClick={() => void run("start")}
                  title="Bắt đầu phó bản. Không nhập tên thành viên nào ⇒ bắt đầu ngay để đi solo; có nhập tên ⇒ chờ đủ thành viên đã khai báo vào phòng mới bấm được">
                  ▶ Bắt đầu
                </button>
                <button type="button" className="danger" disabled={busy || !inSession} onClick={() => void run("cancel")} title="Huỷ phòng và kết thúc phiên">
                  ✖ Hủy
                </button>
              </div>
            ) : (
              <div className="dt-actions one">
                {cfg.enabled
                  ? <button type="button" className="danger" onClick={() => void setReady(false)} title="Dừng tìm đội (bot chưa có gói rời phòng nên nếu đã vào phòng hãy rời trong game)">⏹ Dừng</button>
                  : <button type="button" className="primary" disabled={!loaded || !cfg.leaderName.trim()} onClick={() => void setReady(true)}
                      title="Tự tìm đúng phòng phó bản của chủ phòng (theo tên + loại phó bản), vào phòng và bấm Sẵn sàng">🔎 Tìm Đội</button>}
              </div>
            )}

            <button type="button" className="dt-exit" disabled={busy || !inDungeon} onClick={() => void run("exit")}
              title="Dừng lộ trình và rời đội để ra khỏi phó bản (về map cũ) — dùng khi lộ trình không đi tiếp được / bị kẹt">
              🚪 Thoát phó bản
            </button>

            <div className="dt-form">
              {!leader && (
                <label className="dt-field">
                  <span className="dt-label">Tên chủ phòng</span>
                  <input placeholder="Tên nhân vật chủ phòng" value={cfg.leaderName} disabled={dis} onChange={(e) => update({ leaderName: e.target.value })} />
                </label>
              )}

              <label className="dt-field">
                <span className="dt-label">Phó bản</span>
                <select value={cfg.dungeonId} disabled={dis} onChange={(e) => update({ dungeonId: Number(e.target.value) })}>
                  {DUNGEON_ROOM_CATALOG.map((d) => <option key={d.id} value={d.id}>{d.name}{d.verified ? "" : " (chưa kiểm chứng)"}</option>)}
                </select>
              </label>

              {leader ? (
                <div className="dt-field">
                  <span className="dt-label">Thành viên (tối đa 4) — để trống = đi solo, có tên = chờ đủ mới Bắt đầu</span>
                  <div className="dt-members">
                    {names.map((m, i) => {
                      const ms = memberState(m);
                      const tag = ms ? MEMBER_TAG[ms.status] : undefined;
                      return (
                        <div key={i} className="dt-member">
                          <span className="dt-n">{i + 1}</span>
                          <input placeholder={`Tên thành viên ${i + 1}`} value={m} disabled={dis} onChange={(e) => setMember(i, e.target.value)} />
                          {m.trim() && inSession && tag ? <span className={`chip ${tag.cls}`} style={chipStyle} title={ms?.detail}>{tag.text}</span> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <label className="dt-field" title="Chỉ cần khi chủ phòng là client ngoài web và phòng có mật khẩu (chủ phòng là bot thì tự lấy). Layout gói có mật khẩu chưa kiểm chứng.">
                  <span className="dt-label">Mật khẩu phòng (nếu có)</span>
                  <input maxLength={16} placeholder="(không)" value={cfg.joinPassword} disabled={dis} onChange={(e) => update({ joinPassword: e.target.value })} />
                </label>
              )}

              <div className="dt-checks">
                {leader && (
                  <label title="Tạo phòng có mật khẩu: server tự cấp mã (hiện ở khung trạng thái)">
                    <input type="checkbox" checked={cfg.usePassword} disabled={dis} onChange={(e) => update({ usePassword: e.target.checked })} /> Phòng có mật khẩu
                  </label>
                )}
                <label title="Rời đội trước khi tạo/vào phòng (một số phó bản không cho vào khi đang trong tổ đội)">
                  <input type="checkbox" checked={cfg.leaveParty} disabled={dis} onChange={(e) => update({ leaveParty: e.target.checked })} /> Rời đội trước khi vào phòng
                </label>
              </div>
            </div>

            {st && st.phase !== "idle" && (
              <div className={`dt-status ${st.phase === "error" ? "bad" : st.phase === "done" ? "ok" : ""}`}>
                {st.gate && <div className="muted small">🏙 Cổng thành: {st.gate.city}</div>}
                <div className="dt-msg">{st.message}</div>
                {st.password && <div className="chip ok" style={chipStyle} title="Mật khẩu phòng do server cấp">🔑 Mật khẩu phòng: <b>{st.password}</b></div>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
