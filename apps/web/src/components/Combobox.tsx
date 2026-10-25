import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboOption { value: string; label: string }

/** Dropdown có ô gõ tìm nhanh. `value` rỗng/không khớp → hiện placeholder. */
export function Combobox({ options, value, onChange, placeholder = "Chọn…", disabled, empty = "Không có kết quả" }: {
  options: ComboOption[]; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())), [options, q]);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => { setCur(0); }, [q, open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const pick = (o: ComboOption) => { onChange(o.value); setOpen(false); setQ(""); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(shown.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[cur]) pick(shown[cur]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className={`combo ${disabled ? "disabled" : ""}`} ref={box}>
      {open ? (
        <input autoFocus className="combo-input" placeholder="Gõ để tìm…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} />
      ) : (
        <button type="button" className="combo-btn" disabled={disabled} onClick={() => setOpen(true)} aria-haspopup="listbox">
          <span className={selected ? "" : "muted"}>{selected?.label ?? placeholder}</span><span className="arrow" aria-hidden>▾</span>
        </button>
      )}
      {open && (
        <div className="combo-list" role="listbox">
          {shown.length === 0 && <div className="combo-empty muted small">{empty}</div>}
          {shown.map((o, i) => (
            <div key={o.value} role="option" aria-selected={o.value === value} className={`combo-opt ${i === cur ? "cur" : ""} ${o.value === value ? "on" : ""}`}
              title={o.label} onMouseEnter={() => setCur(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
