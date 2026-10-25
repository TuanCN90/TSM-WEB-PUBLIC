import { useEffect, useMemo, useRef, useState } from "react";
import names from "../data/mapNames.json";
import gates from "../data/warpGates.json";

/** Bỏ dấu tiếng Việt + về chữ thường để tìm "gần đúng" (vd "trac quan" khớp "Trác Quận"). */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

interface Item { id: number; name: string; hay: string }
const toItem = (id: number, name: string): Item => ({ id, name, hay: fold(`${id} ${name}`) });
const ALL: Item[] = Object.entries(names as Record<string, string>).map(([id, name]) => toItem(Number(id), name)).sort((a, b) => a.id - b.id);
/** 41 điểm truyền tống (menu "Teleport" của tool gốc) — gói `44/01` chỉ đi được tới các map này. Giữ thứ tự menu. */
const GATES: Item[] = (gates as { id: number; city: string; map: string }[]).map((g) => toItem(g.id, `${g.city} — ${g.map}`));

const MAX_SHOWN = 80;

/** Lọc theo mọi từ khoá (AND). Ưu tiên: đúng id → id bắt đầu bằng → tên bắt đầu bằng → còn lại theo id. */
function search(ITEMS: Item[], query: string): { list: Item[]; total: number } {
  const q = fold(query.trim());
  if (!q) return { list: ITEMS.slice(0, MAX_SHOWN), total: ITEMS.length };
  const words = q.split(/\s+/);
  const rank = (it: Item) => (String(it.id) === q ? 0 : String(it.id).startsWith(q) ? 1 : fold(it.name).startsWith(q) ? 2 : 3);
  const hits = ITEMS.filter((it) => words.every((w) => it.hay.includes(w))).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  return { list: hits.slice(0, MAX_SHOWN), total: hits.length };
}

/** mapId hợp lệ trong gói: số nguyên 1..65535 (u16). */
const asMapId = (t: string) => (/^\d{1,5}$/.test(t.trim()) && Number(t) > 0 && Number(t) < 65536 ? String(Number(t.trim())) : "");

export const mapLabel = (id: number) => (names as Record<string, string>)[String(id)] ?? "";

/**
 * Ô chọn map: gõ mã map hoặc một phần tên (không cần dấu) để lọc, chọn trong danh sách bằng chuột hoặc ↑/↓ + Enter.
 * `value` là mapId đã chọn ("" = chưa chọn). `source="all"` (mặc định): toàn bộ 3.642 map (số ngoài danh sách vẫn gõ được); `"gates"`: chỉ 41 cổng thành (menu Teleport của tool).
 */
export function MapSelect({ value, onChange, placeholder, source = "all" }: { value: string; onChange: (id: string) => void; placeholder?: string; source?: "gates" | "all" }) {
  const items = source === "gates" ? GATES : ALL;
  const labelOf = (id: number) => (source === "gates" ? items.find((it) => it.id === id)?.name ?? "" : mapLabel(id));
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typing = useRef(false); // true khi thay đổi `value` do chính người dùng đang gõ → không ghi đè ô gõ

  // Đồng bộ ô gõ khi giá trị chọn đổi từ ngoài (hoặc sau khi chọn một dòng).
  useEffect(() => {
    if (typing.current) { typing.current = false; return; }
    setText(value ? `${value}${labelOf(Number(value)) ? ` — ${labelOf(Number(value))}` : ""}` : ""); }, [value]);

  const query = open ? text : "";
  const { list, total } = useMemo(() => search(items, /^\d+ — /.test(query) ? "" : query), [items, query]);
  const typedId = asMapId(text);
  const extra = source === "all" && typedId && !list.some((it) => String(it.id) === typedId); // chỉ cho nhập số ngoài danh sách khi nguồn là toàn bộ map

  useEffect(() => { setCur(0); }, [text, open]);
  useEffect(() => { listRef.current?.children[cur]?.scrollIntoView({ block: "nearest" }); }, [cur]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const rows: { id: string; label: string; note?: string }[] = [
    ...(extra ? [{ id: typedId, label: `Map ${typedId}`, note: "không có trong danh sách" }] : []),
    ...list.map((it) => ({ id: String(it.id), label: it.name })),
  ];
  const pick = (id: string) => { onChange(id); setOpen(false); };

  return (
    <div className="mapsel" ref={box}>
      <input
        role="combobox" aria-expanded={open} aria-controls="mapsel-list" aria-autocomplete="list"
        placeholder={placeholder ?? (source === "gates" ? "Điểm truyền tống: mã hoặc tên…" : "Mã map hoặc tên map…")} value={text} spellCheck={false}
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { const id = asMapId(e.target.value); setText(e.target.value); setOpen(true); const ok = id && (source === "all" || GATES.some((g) => String(g.id) === id)) ? id : ""; if (ok !== value) { typing.current = true; onChange(ok); } }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCur((c) => Math.min(c + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open && rows[cur]) { e.preventDefault(); pick(rows[cur]!.id); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {value && <button type="button" className="mapsel-x" aria-label="Xoá lựa chọn" onClick={() => { onChange(""); setText(""); setOpen(true); }}>×</button>}
      {open && (
        <ul id="mapsel-list" role="listbox" ref={listRef} className="mapsel-list">
          {rows.length === 0 && <li className="muted small mapsel-empty">Không tìm thấy map nào</li>}
          {rows.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === cur} className={i === cur ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(r.id); }} onMouseEnter={() => setCur(i)}>
              <b>{r.id}</b><span className="nm">{r.label}</span>{r.note && <em>{r.note}</em>}
            </li>
          ))}
          {total > MAX_SHOWN && <li className="muted small mapsel-more">Hiện {MAX_SHOWN}/{total} — gõ thêm để lọc</li>}
        </ul>
      )}
    </div>
  );
}
