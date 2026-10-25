import type { Diagnostic, ScriptMeta } from "@tsbot/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Combobox } from "../components/Combobox";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { useToast } from "../components/Toast";
import { useBaseScripts, useCustomScripts } from "../scriptsData";

type Kind = "base" | "custom";
/** Mục đang mở: id=null nghĩa là script mới chưa lưu. */
interface Cur { kind: Kind; id: string | null }
interface Ask { title: string; body: React.ReactNode; okLabel?: string; danger?: boolean; onOk: () => void }

/** Nhóm kịch bản có sẵn (tạm hardcode); nhóm = thư mục con trong data/custom_scripts. */
const SCRIPT_GROUPS = ["Event", "Daily", "Phó Bản", "Quest"];
const splitId = (id: string) => { const i = id.indexOf("/"); return i < 0 ? { group: "", name: id } : { group: id.slice(0, i), name: id.slice(i + 1) }; };
const fullId = (group: string, name: string) => (group ? `${group}/${name}` : name);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tab "Tạo kịch bản": kho script gốc + script tự tạo (nháp), soạn thảo, xoá, duyệt vào danh mục chính thức. */
export function Scripts() {
  const toast = useToast();
  const base = useBaseScripts();
  const custom = useCustomScripts();
  const [q, setQ] = useState("");
  const [cur, setCur] = useState<Cur | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [group, setGroup] = useState("");
  const [saved, setSaved] = useState({ name: "", group: "", text: "" });
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: Kind; id: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  // Nhóm đang thu gọn (key "sect:custom" | "sect:base" | "grp:<thư mục>"); nhớ lại giữa các lần mở tab.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("scripts.collapsed") ?? "[]")); } catch { return new Set(); }
  });
  const searching = q.trim() !== "";
  const isOpen = (k: string) => searching || !collapsed.has(k); // đang tìm thì luôn mở để thấy kết quả
  const flip = (k: string) => setCollapsed((c) => {
    const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem("scripts.collapsed", JSON.stringify([...n])); } catch { /* bỏ qua */ }
    return n;
  });
  const setAll = (keys: string[], open: boolean) => setCollapsed((c) => {
    const n = new Set(c); for (const k of keys) { if (open) n.delete(k); else n.add(k); }
    try { localStorage.setItem("scripts.collapsed", JSON.stringify([...n])); } catch { /* bỏ qua */ }
    return n;
  });
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const dirty = cur !== null && (text !== saved.text || name !== saved.name || group !== saved.group);
  const isOfficial = (id: string) => custom.find((s) => s.id === id)?.official ?? false;

  const open = async (kind: Kind, id: string) => {
    try {
      const f = kind === "base" ? await api.script(id) : await api.customScript(id);
      const sp = kind === "custom" ? splitId(id) : { group: "", name: id };
      setCur({ kind, id }); setName(sp.name); setGroup(sp.group); setText(f.content); setSaved({ ...sp, text: f.content });
    } catch (e) { toast("error", errText(e)); }
  };
  const guard = (go: () => void) => {
    if (!dirty) return go();
    setAsk({ title: "Thay đổi chưa lưu", body: "Bỏ các thay đổi chưa lưu của kịch bản đang mở?", okLabel: "Bỏ thay đổi", danger: true, onOk: go });
  };
  const openGuarded = (kind: Kind, id: string) => guard(() => void open(kind, id));
  const startNew = () => guard(() => { setCur({ kind: "custom", id: null }); setName(""); setGroup(""); setText(""); setSaved({ name: "", group: "", text: "" }); });
  // Clone: mở form "tạo mới" nhưng nội dung nạp sẵn từ script nguồn; tên và nhóm để trống.
  const cloneFrom = (kind: Kind, id: string) => guard(() => void (async () => {
    try {
      const f = kind === "base" ? await api.script(id) : await api.customScript(id);
      setCur({ kind: "custom", id: null }); setName(""); setGroup(""); setText(f.content); setSaved({ name: "", group: "", text: "" });
      toast("info", `Đã nhân bản nội dung "${id}" — nhập tên (và nhóm) rồi bấm Lưu`);
    } catch (e) { toast("error", errText(e)); }
  })());
  const close = () => { setCur(null); setName(""); setGroup(""); setText(""); setSaved({ name: "", group: "", text: "" }); };

  // Script đang mở bị xoá/đổi từ nơi khác → đóng editor.
  useEffect(() => {
    if (!cur || cur.id === null) return;
    const list: ScriptMeta[] = cur.kind === "base" ? base : custom;
    if (list.length && !list.some((s) => s.id === cur.id)) { if (fullId(saved.group, saved.name) === cur.id || saved.name === cur.id) close(); }
  }, [base, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => api.validate(text).then((r) => setDiags(r.diagnostics)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [text]);

  const save = async () => {
    if (!cur) return;
    const n = name.trim();
    try {
      if (cur.kind === "base") {
        await api.saveScript(cur.id!, text);
      } else {
        if (!n) return toast("error", "Hãy nhập tên kịch bản");
        const full = fullId(group, n);
        if (full !== cur.id && custom.some((s) => s.id === full)) return toast("error", `Đã có kịch bản "${full}"`);
        await api.saveCustomScript(full, text, cur.id ?? undefined);
        setCur({ kind: "custom", id: full }); setName(n);
      }
      setSaved({ name: cur.kind === "base" ? cur.id! : n, group: cur.kind === "base" ? "" : group, text });
      // Kết quả kiểm tra cú pháp báo bằng toast (dòng lỗi vẫn được tô trên cột số dòng khi đang gõ).
      const { diagnostics } = await api.validate(text).catch(() => ({ diagnostics: [] as Diagnostic[] }));
      const errs = diagnostics.filter((d) => d.severity === "error"), warns = diagnostics.filter((d) => d.severity !== "error");
      const lines = (l: Diagnostic[]) => l.slice(0, 5).map((d) => `Dòng ${d.line}: ${d.message}`).join("\n") + (l.length > 5 ? `\n… và ${l.length - 5} mục khác` : "");
      if (errs.length) toast("error", `Đã lưu nhưng còn ${errs.length} lỗi:\n${lines(errs)}`);
      else if (warns.length) toast("info", `Đã lưu, có ${warns.length} cảnh báo:\n${lines(warns)}`);
      else toast("ok", "Đã lưu — không có vấn đề");
    } catch (e) { toast("error", errText(e)); }
  };

  const cancelEdit = () => { setName(saved.name); setGroup(saved.group); setText(saved.text); toast("info", "Đã hủy thay đổi — trả về bản đã lưu"); };

  const doDelete = async (kind: Kind, id: string) => {
    try {
      await (kind === "base" ? api.deleteScript(id) : api.deleteCustomScript(id));
      if (cur?.kind === kind && cur.id === id) close();
      toast("ok", `Đã xoá "${id}"`);
    } catch (e) { toast("error", errText(e)); }
  };
  const askDelete = (kind: Kind, id: string) => setAsk({
    title: "Xoá kịch bản", danger: true, okLabel: "Xoá", onOk: () => void doDelete(kind, id),
    body: <>Xoá kịch bản <b>{id}</b>{kind === "base" ? " (script gốc của tool)" : isOfficial(id) ? " (đang nằm trong danh sách chính thức, sẽ bị gỡ luôn)" : ""}? Không thể hoàn tác.</>,
  });
  const askApprove = (id: string) => setAsk({
    title: "Thêm vào Script chính thức", okLabel: "Đồng ý",
    body: <>Bạn có chắc chắn muốn đưa kịch bản <b>{id}</b> vào danh sách thực thi chính thức?</>,
    onOk: () => api.approveScript(id).then(() => toast("ok", `Đã thêm "${id}" vào danh sách chính thức`)).catch((e) => toast("error", errText(e))),
  });

  const menuItems = (kind: Kind, id: string): MenuItem[] => [
    { label: "Cập nhật", onClick: () => openGuarded(kind, id) },
    { label: "Clone (nhân bản)", onClick: () => cloneFrom(kind, id) },
    { label: "Xóa", danger: true, onClick: () => askDelete(kind, id) },
    ...(kind === "custom" ? [isOfficial(id)
      ? { label: "Gỡ khỏi Script chính thức", separator: true, onClick: () => void api.revokeScript(id).then(() => toast("ok", `Đã gỡ "${id}" khỏi danh sách chính thức`)).catch((e) => toast("error", errText(e))) }
      : { label: "Thêm vào Script chính thức", separator: true, onClick: () => askApprove(id) }] : []),
  ];

  const match = (s: ScriptMeta) => s.id.toLowerCase().includes(q.trim().toLowerCase());
  const baseGroups = useMemo(() => {
    const m = new Map<string, ScriptMeta[]>();
    for (const s of base.filter(match)) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, [base, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const customShown = custom.filter(match);
  const customGroups = useMemo(() => {
    const m = new Map<string, typeof customShown>();
    for (const s of customShown) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "vi")));
  }, [customShown]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupOptions = useMemo(() => {
    const names = [...SCRIPT_GROUPS, ...(group && !SCRIPT_GROUPS.includes(group) ? [group] : [])];
    return [{ value: "", label: "(Không nhóm)" }, ...names.map((g) => ({ value: g, label: g }))];
  }, [group]);

  const row = (kind: Kind, s: ScriptMeta & { official?: boolean }) => (
    <div key={`${kind}:${s.id}`} title={s.id} className={`item sitem ${cur?.kind === kind && cur.id === s.id ? "on" : ""}`}
      onClick={() => openGuarded(kind, s.id)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind, id: s.id }); }}>
      <span className="nm" title={s.id}>{s.name}</span>
      {kind === "custom" && <span className={`tag ${s.official ? "ok" : "draft"}`} title={s.official ? "Đã nằm trong danh sách chạy chính thức" : "Bản nháp — chưa được thêm vào Script chính thức nên chưa chạy được ở tab Kịch bản"}>{s.official ? "Chính thức" : "⚠ Nháp"}</span>}
      <button className="dots" title="Tuỳ chọn" aria-label={`Tuỳ chọn ${s.id}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2, kind, id: s.id }); }}>⋯</button>
    </div>
  );

  const insertTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void save(); return; }
    if (e.key !== "Tab") return;
    e.preventDefault();
    // execCommand giữ được lịch sử Undo/Redo gốc của trình duyệt; setRangeText chỉ là dự phòng.
    if (!document.execCommand("insertText", false, "\t")) {
      const t = e.currentTarget;
      t.setRangeText("\t", t.selectionStart, t.selectionEnd, "end");
      setText(t.value);
    }
  };

  const lineCount = text.split("\n").length;
  const bad = new Map(diags.map((d) => [d.line, d]));
  const readOnlyName = cur?.kind === "base";

  return (
    <div className="scripts">
      <aside className="card">
        <div className="row">
          <input placeholder="Tìm kịch bản…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="primary newbtn" onClick={startNew} title="Tạo kịch bản mới">Tạo mới</button>
        </div>
        <div className="treebar">
          <button className="linkbtn" onClick={() => setAll(["sect:custom", "sect:base", ...baseGroups.map(([g]) => `grp:${g}`), ...customGroups.map(([g]) => `cgrp:${g}`)], true)}>Mở hết</button>
          <button className="linkbtn" onClick={() => setAll(["sect:custom", "sect:base", ...baseGroups.map(([g]) => `grp:${g}`), ...customGroups.map(([g]) => `cgrp:${g}`)], false)}>Thu gọn hết</button>
        </div>
        <div className="tree">
          <button className="sect" aria-expanded={isOpen("sect:custom")} onClick={() => flip("sect:custom")}>
            <i className={`chev ${isOpen("sect:custom") ? "open" : ""}`} aria-hidden /> Của tôi <span className="muted">({custom.length})</span>
          </button>
          {isOpen("sect:custom") && <>
            {customShown.length === 0 && <div className="muted small pad">{custom.length ? "Không có kết quả." : "Chưa có — bấm “Tạo mới” để tạo."}</div>}
            {customGroups.map(([g, items]) => (
              <div key={g}>
                {g && (
                  <button className="grp" aria-expanded={isOpen(`cgrp:${g}`)} onClick={() => flip(`cgrp:${g}`)}>
                    <i className={`chev ${isOpen(`cgrp:${g}`) ? "open" : ""}`} aria-hidden /> {g}/ <span>({items.length})</span>
                  </button>
                )}
                {(!g || isOpen(`cgrp:${g}`)) && <div className={g ? "grpitems" : ""}>{items.map((s) => row("custom", s))}</div>}
              </div>
            ))}
          </>}
          <button className="sect" aria-expanded={isOpen("sect:base")} onClick={() => flip("sect:base")}>
            <i className={`chev ${isOpen("sect:base") ? "open" : ""}`} aria-hidden /> Script gốc <span className="muted">({base.length})</span>
          </button>
          {isOpen("sect:base") && baseGroups.map(([g, items]) => (
            <div key={g}>
              {g && (
                <button className="grp" aria-expanded={isOpen(`grp:${g}`)} onClick={() => flip(`grp:${g}`)}>
                  <i className={`chev ${isOpen(`grp:${g}`) ? "open" : ""}`} aria-hidden /> {g}/ <span>({items.length})</span>
                </button>
              )}
              {(!g || isOpen(`grp:${g}`)) && <div className={g ? "grpitems" : ""}>{items.map((s) => row("base", s))}</div>}
            </div>
          ))}
        </div>
      </aside>
      <section className="card editor">
        {cur === null ? <div className="muted">Chọn một kịch bản để xem/sửa, hoặc bấm “Tạo mới” để tạo kịch bản.</div> : (
          <>
            <div className="row">
              {!readOnlyName && (
                <div className="hfield group"><span className="hcap">Nhóm kịch bản</span>
                  <Combobox options={groupOptions} value={group} onChange={setGroup} />
                </div>
              )}
              <div className="hfield grow"><span className="hcap">Tên kịch bản</span>
                <input className="nameinp" placeholder="Nhập tên kịch bản" value={name} readOnly={readOnlyName}
                  title={readOnlyName ? "Script gốc không đổi tên được" : undefined} onChange={(e) => setName(e.target.value)} />
              </div>
              {dirty && <span className="unsaved" role="status"><span aria-hidden>⚠</span> Chưa lưu</span>}
              <span className="sp" />
              <button disabled={cur.id === null} onClick={() => cur.id !== null && cloneFrom(cur.kind, cur.id)} title="Tạo kịch bản mới với nội dung copy từ kịch bản này (tên và nhóm để trống)">Clone</button>
              <button disabled={!dirty} onClick={cancelEdit} title="Bỏ thay đổi, trả về bản đã lưu">Hủy</button>
              <button className="primary" disabled={!dirty} onClick={save}>Lưu</button>
              <button className="danger" disabled={cur.id === null} onClick={() => cur.id !== null && askDelete(cur.kind, cur.id)}>Xóa</button>
            </div>
            <div className="code">
              <div className="gutter" ref={gutter}>
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className={bad.get(i + 1)?.severity ?? ""} title={bad.get(i + 1)?.message}>{i + 1}</div>
                ))}
              </div>
              <textarea ref={area} spellCheck={false} wrap="off" value={text} onChange={(e) => setText(e.target.value)}
                onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }} onKeyDown={insertTab} />
            </div>
          </>
        )}
      </section>
      {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.id} items={menuItems(menu.kind, menu.id)} onClose={() => setMenu(null)} />}
      {ask && <ConfirmDialog {...ask} onOk={() => { const f = ask.onOk; setAsk(null); f(); }} onCancel={() => setAsk(null)} />}
    </div>
  );
}
