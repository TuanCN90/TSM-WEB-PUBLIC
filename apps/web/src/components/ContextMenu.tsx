import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick?: () => void;
  children?: MenuItem[];
  danger?: boolean;
  disabled?: boolean;
  /** Đường kẻ ngăn nhóm, vẽ phía trên mục này. */
  separator?: boolean;
}

const MARGIN = 8;

/** Một bảng menu; submenu là `Panel` lồng bên trong mục cha, tự lật trái/lên khi sát mép màn hình. */
function Panel({ items, sub, onPick, title }: { items: MenuItem[]; sub?: boolean; onPick: () => void; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [cur, setCur] = useState(-1);
  const [shift, setShift] = useState<{ flipX: boolean; dy: number }>({ flipX: false, dy: 0 });

  // Đo sau khi vẽ: tràn phải → lật sang trái; tràn đáy → đẩy ngược lên.
  useLayoutEffect(() => {
    if (!sub || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const flipX = r.right > window.innerWidth - MARGIN;
    const dy = r.bottom > window.innerHeight - MARGIN ? -(r.bottom - (window.innerHeight - MARGIN)) : 0;
    setShift({ flipX, dy });
  }, [sub]);

  const activate = (i: number) => {
    const it = items[i];
    if (!it || it.disabled) return;
    if (it.children) setOpen(i); else { it.onClick?.(); onPick(); }
  };

  return (
    <div
      ref={ref} role="menu" className={`ctxmenu ${sub ? "sub" : ""}`} tabIndex={-1}
      style={sub ? { top: shift.dy, ...(shift.flipX ? { right: "100%" } : { left: "100%" }) } : undefined}
      onKeyDown={(e) => {
        const move = (d: number) => { e.preventDefault(); e.stopPropagation(); setCur((c) => { let n = c; do n = (n + d + items.length) % items.length; while (items[n]?.disabled && n !== c); return n; }); };
        if (e.key === "ArrowDown") move(1);
        else if (e.key === "ArrowUp") move(-1);
        else if (e.key === "ArrowRight" && items[cur]?.children) { e.preventDefault(); e.stopPropagation(); setOpen(cur); }
        else if (e.key === "ArrowLeft" && sub) { e.preventDefault(); e.stopPropagation(); (ref.current?.parentElement?.closest("[role=menu]") as HTMLElement | null)?.focus(); }
        else if (e.key === "Enter") { e.preventDefault(); activate(cur); }
      }}
    >
      {title && <div className="ctx-title" title={title}>{title}</div>}
      {items.map((it, i) => (
        <div key={i} className={it.separator ? "ctx-sepwrap" : undefined}>
          {it.separator && <div className="ctx-sep" role="separator" />}
          <div
            role="menuitem" aria-haspopup={it.children ? "menu" : undefined} aria-disabled={it.disabled || undefined}
            className={`ctx-item ${it.danger ? "danger" : ""} ${it.disabled ? "off" : ""} ${cur === i || open === i ? "on" : ""}`}
            onMouseEnter={() => { setCur(i); if (!it.disabled) setOpen(it.children ? i : null); }}
            onClick={(e) => { e.stopPropagation(); activate(i); }}
          >
            <span className="lb">{it.label}</span>
            {it.children && <span className="arrow" aria-hidden>▶</span>}
            {it.children && open === i && <Panel items={it.children} sub onPick={onPick} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Menu ngữ cảnh (chuột phải) có menu con. Đóng khi bấm ra ngoài, cuộn, đổi cỡ cửa sổ hoặc nhấn Esc. */
export function ContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title?: string; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN)),
    });
  }, [x, y]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[role=menu]")?.focus();
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("mousedown", away, true);
    document.addEventListener("contextmenu", away, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("contextmenu", away, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={box} className="ctx-root" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <Panel items={items} title={title} onPick={onClose} />
    </div>
  );
}
