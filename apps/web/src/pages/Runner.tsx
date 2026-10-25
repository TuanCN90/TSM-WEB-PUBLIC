import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Combobox } from "../components/Combobox";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { LogPanel } from "../components/LogPanel";
import { useToast } from "../components/Toast";
import { charLabel } from "../components/common";
import { useLive } from "../live";
import { displayScriptName, fetchRunnableContent, useRunnableScripts } from "../scriptsData";

const ALL = "__all__";
const ACTIVE = ["running", "paused", "stopping"];

/** Tab "Kịch bản": chọn tài khoản (hoặc tất cả) + 1 kịch bản chính thức rồi chạy. Khoá giao diện khi đang chạy. */
export function Runner({ onSwitchToBuilder }: { onSwitchToBuilder?: () => void } = {}) {
  const { connections, characters, selected, select } = useLive();
  const toast = useToast();
  // Tab này chỉ liệt kê script của tôi đã được duyệt vào danh sách chính thức (script gốc của tool cũ không hiện ở đây).
  const allRunnable = useRunnableScripts();
  const scripts = useMemo(() => allRunnable.filter((s) => s.source === "custom"), [allRunnable]);
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof api.accounts>>>([]);
  useEffect(() => { api.accounts().then(setAccounts).catch(() => {}); }, [connections.length]);

  const online = useMemo(() => accounts.filter((a) => connections.find((c) => c.accountId === a.id)?.state === "online"), [accounts, connections]);
  const [target, setTarget] = useState(ALL);
  const [q, setQ] = useState("");
  /** Hàng đợi = các kịch bản đã tick, theo thứ tự tick (chạy từ trên xuống). */
  const [queue, setQueue] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [varSpecs, setVarSpecs] = useState<{ name: string; def?: string }[]>([]);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const targetIds = target === ALL ? online.map((a) => a.id) : online.some((a) => a.id === target) ? [target] : [];
  const label = (id: string) => charLabel(accounts.find((a) => a.id === id), characters[id], id);
  const conn = (id: string) => connections.find((c) => c.accountId === id);
  const running = targetIds.filter((id) => ACTIVE.includes(conn(id)?.script?.state ?? ""));
  const locked = running.length > 0 || busy;
  const runningScript = conn(running[0] ?? "")?.script;
  const runningName = displayScriptName(runningScript?.scriptId ?? queue[0] ?? "");
  const anyRunning = running.some((id) => conn(id)?.script?.state === "running");
  const anyPaused = running.some((id) => conn(id)?.script?.state === "paused");

  // Tài khoản đang chọn không còn online → quay về "Tất cả"; log luôn theo một tài khoản đang online.
  useEffect(() => { if (target !== ALL && !online.some((a) => a.id === target)) setTarget(ALL); }, [online, target]);
  const logAccount = target !== ALL ? target : online.some((a) => a.id === selected) ? selected : online[0]?.id ?? null;
  useEffect(() => { if (logAccount && logAccount !== selected) select(logAccount); }, [logAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setQueue((q) => (q.every((id) => scripts.some((s) => s.id === id)) ? q : q.filter((id) => scripts.some((s) => s.id === id)))); }, [scripts]);
  const queueKey = queue.join("\n");
  useEffect(() => {
    if (!queue.length) { setVarSpecs([]); return; }
    Promise.all(queue.map((id) => fetchRunnableContent(id).then((f) => f.content).catch(() => ""))).then((contents) => {
      const seen = new Map<string, { name: string; def?: string }>();
      for (const content of contents) for (const m of content.matchAll(/\$\{(\w+)(?::([^}]*))?\}/g)) if (!seen.has(m[1]) || (seen.get(m[1])!.def === undefined && m[2] !== undefined)) seen.set(m[1], { name: m[1], def: m[2] });
      setVarSpecs([...seen.values()]);
    });
  }, [queueKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = (id: string) => setQueue((q) => (q.includes(id) ? q : [...q, id]));
  const uncheck = (id: string) => setQueue((q) => q.filter((x) => x !== id));
  const menuItems = (id: string): MenuItem[] => [
    { label: "Chọn", disabled: queue.includes(id), onClick: () => check(id) },
    { label: "Bỏ chọn", disabled: !queue.includes(id), onClick: () => uncheck(id) },
    { label: "Thêm vào danh sách chạy", separator: true, onClick: () => { if (queue.includes(id)) toast("info", `"${displayScriptName(id)}" đã có trong danh sách chạy`); else { check(id); toast("ok", `Đã thêm "${displayScriptName(id)}" vào danh sách chạy (thứ ${queue.length + 1})`); } } },
  ];

  // Kịch bản kết thúc có lỗi → toast một lần cho mỗi lần chạy (key = tài khoản + thời điểm kết thúc).
  const toasted = useRef(new Set<string>());
  const mountedAt = useRef(Date.now()); // lỗi của lần chạy cũ (trước khi mở tab) không báo lại
  useEffect(() => {
    for (const c of connections) {
      const sc = c.script;
      if (!sc.error || !sc.endedAt || sc.endedAt < mountedAt.current || !accounts.some((a) => a.id === c.accountId)) continue;
      const key = `${c.accountId}:${sc.endedAt}`;
      if (toasted.current.has(key)) continue;
      toasted.current.add(key);
      toast("error", `${label(c.accountId)}: ${sc.error}`);
    }
  }, [connections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gom nhóm theo thư mục (nhóm kịch bản); script không nhóm nằm trên cùng. Trạng thái thu gọn được nhớ lại.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("runner.collapsed") ?? "[]")); } catch { return new Set(); }
  });
  const flip = (g: string) => setCollapsed((c) => {
    const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g);
    try { localStorage.setItem("runner.collapsed", JSON.stringify([...n])); } catch { /* bỏ qua */ }
    return n;
  });
  const shown = useMemo(() => scripts.filter((s) => displayScriptName(s.id).toLowerCase().includes(q.trim().toLowerCase())), [scripts, q]);
  const searching = q.trim() !== "";
  const groups = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const s of shown) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "vi")));
  }, [shown]);
  const options = [{ value: ALL, label: `Tất cả (${online.length} tài khoản online)` }, ...online.map((a) => ({ value: a.id, label: conn(a.id)?.script && ACTIVE.includes(conn(a.id)!.script!.state) ? `${label(a.id)} · đang chạy` : label(a.id) }))];

  const runAll = async () => {
    setBusy(true);
    try {
      const res = await Promise.allSettled(targetIds.map((id) => api.runQueue(id, queue, vars)));
      const bad = res.flatMap((r, i) => (r.status === "rejected" ? [`${label(targetIds[i]!)}: ${r.reason instanceof Error ? r.reason.message : r.reason}`] : []));
      if (bad.length) toast("error", bad.join("\n"));
    } finally { setBusy(false); }
  };
  const control = async (action: "pause" | "resume" | "stop") => {
    const ids = action === "pause" ? running.filter((id) => conn(id)?.script?.state === "running") : action === "resume" ? running.filter((id) => conn(id)?.script?.state === "paused") : running;
    const res = await Promise.allSettled(ids.map((id) => api.scriptControl(id, action)));
    const bad = res.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (bad) toast("error", bad.reason instanceof Error ? bad.reason.message : String(bad.reason));
  };

  return (
    <div className="grid2 runner">
      <section className="card runner-left">
        <h2 className="row">Kịch bản
          <span className="help" tabIndex={0} aria-label="Ghi chú">?
            <span className="tip" role="tooltip">Tick nhiều kịch bản để chạy lần lượt từ trên xuống (số cạnh ô tick là thứ tự). Dừng hoặc hoàn tất kịch bản không đăng xuất — nhân vật vẫn online. Menu ⋮ hoặc chuột phải mỗi dòng có Chọn / Bỏ chọn / Thêm vào danh sách chạy.</span>
          </span>
        </h2>
        <div className="form">
          <label>Tài khoản
            <Combobox options={options} value={target} onChange={setTarget} disabled={locked} empty="Chưa có tài khoản online" />
          </label>
          <label>Kịch bản
            <input placeholder="Tìm kịch bản…" value={q} disabled={locked} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className={`runlist ${locked ? "locked" : ""}`} role="group" aria-label="Danh sách kịch bản">
            {shown.length === 0 && (
              <div className="muted small">
                {scripts.length ? (
                  "Không có kịch bản khớp."
                ) : (
                  <>
                    Chưa có kịch bản nào. Vào tab{" "}
                    {onSwitchToBuilder ? (
                      <button
                        type="button"
                        onClick={onSwitchToBuilder}
                        style={{
                          display: "inline",
                          padding: 0,
                          border: "none",
                          background: "none",
                          color: "var(--accent)",
                          textDecoration: "underline",
                          cursor: "pointer",
                          font: "inherit",
                          fontWeight: 600,
                        }}
                      >
                        Tạo kịch bản
                      </button>
                    ) : (
                      <b>Tạo kịch bản</b>
                    )}
                    , chuột phải vào script của bạn → Thêm vào Script chính thức.
                  </>
                )}
              </div>
            )}
            {groups.map(([g, items]) => {
              const open = !g || searching || !collapsed.has(g);
              return (
                <div key={g}>
                  {g && (
                    <button type="button" className="grp" aria-expanded={open} onClick={() => flip(g)}>
                      <i className={`chev ${open ? "open" : ""}`} aria-hidden /> {g}/ <span>({items.length})</span>
                    </button>
                  )}
                  {open && <div className={g ? "grpitems" : ""}>{items.map((s) => {
              const pos = queue.indexOf(s.id);
              return (
                <label key={s.id} title={displayScriptName(s.id)} className={`runitem ${pos >= 0 ? "on" : ""}`} onContextMenu={(e) => { e.preventDefault(); if (!locked) setMenu({ x: e.clientX, y: e.clientY, id: s.id }); }}>
                  <span className="nm">{s.name}</span>
                  {s.source === "custom" && <span className="tag mine" title="Script do bạn tự tạo và đã duyệt">Của tôi</span>}
                  {pos >= 0 && <span className="ord" title={`Chạy thứ ${pos + 1}`}>{pos + 1}</span>}
                  <input type="checkbox" className="cbx" checked={pos >= 0} disabled={locked} onChange={() => (pos >= 0 ? uncheck(s.id) : check(s.id))} />
                  <button type="button" className="dots" disabled={locked} title="Tuỳ chọn" aria-label={`Tuỳ chọn ${displayScriptName(s.id)}`}
                    onClick={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2, id: s.id }); }}>⋮</button>
                </label>
              );
            })}</div>}
                </div>
              );
            })}
          </div>
          {varSpecs.map((v) => (
            <label key={v.name}>{v.name}{v.def !== undefined ? ` (mặc định ${v.def})` : ""}
              <input value={vars[v.name] ?? ""} disabled={locked} placeholder={v.def ?? "bắt buộc"} onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })} />
            </label>
          ))}
          <div className="row">
            <button className="primary" disabled={locked || queue.length === 0 || targetIds.length === 0} onClick={runAll}>▶ Chạy kịch bản{queue.length > 1 ? ` (${queue.length})` : ""}{target === ALL && targetIds.length > 1 ? ` · ${targetIds.length} tài khoản` : ""}</button>
            <button className="danger stopbtn" disabled={running.length === 0} onClick={() => control("stop")} title="Huỷ bước đang chạy và xoá cả hàng đợi">⏹ Dừng</button>
            {anyRunning && <button onClick={() => control("pause")}>⏸ Tạm dừng</button>}
            {anyPaused && <button onClick={() => control("resume")}>⏯ Tiếp tục</button>}
          </div>
          {online.length === 0 && <div className="muted small">Chưa có tài khoản nào online — đăng nhập ở màn hình chính.</div>}
        </div>
        {locked && (
          <div className="busy-banner" role="status">
            <span className="spin" aria-hidden /> <span>{runningScript?.queue ? `Đang chạy (${runningScript.queue.index}/${runningScript.queue.total}): ` : "Đang xử lý: "}<b>{runningName}</b>…</span>
            <div className="small muted">
              {running.map((id) => {
                const st = conn(id)?.script?.step;
                const qi = conn(id)?.script?.queue;
                return <div key={id}>{label(id)}{qi ? ` · (${qi.index}/${qi.total}) ${displayScriptName(conn(id)!.script!.scriptId ?? "")}` : ""}{st ? ` · dòng ${st.line}: ${st.cmd} ${st.args.join(",")}` : ""}</div>;
              })}
            </div>
          </div>
        )}
      </section>
      <section className="card homelog runner-log">
        {target === ALL && online.length > 1 && (
          <div className="row small" style={{ marginBottom: 6 }}><span className="muted">Log của</span>
            <select value={logAccount ?? ""} onChange={(e) => select(e.target.value)}>
              {online.map((a) => <option key={a.id} value={a.id}>{label(a.id)}</option>)}
            </select>
          </div>
        )}
        <LogPanel accountId={logAccount} empty="Chọn tài khoản online để xem log." />
      </section>
      {menu && <ContextMenu x={menu.x} y={menu.y} title={displayScriptName(menu.id)} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
    </div>
  );
}
