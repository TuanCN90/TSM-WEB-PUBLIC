import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastKind = "ok" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; text: string }

const Ctx = createContext<(kind: ToastKind, text: string) => void>(() => {});
/** `toast("error", "nội dung")` — hiện thông báo nổi góc dưới phải, tự tắt (lỗi tồn tại lâu hơn). */
export const useToast = () => useContext(Ctx);

const MAX = 4;
const LIFETIME: Record<ToastKind, number> = { ok: 3500, info: 5000, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setItems((l) => [{ id, kind, text }, ...l].slice(0, MAX));
    setTimeout(() => dismiss(id), LIFETIME[kind]);
  }, [dismiss]);
  const value = useMemo(() => toast, [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"} onClick={() => dismiss(t.id)}>
            <span className="ic" aria-hidden>{t.kind === "error" ? "⚠" : t.kind === "ok" ? "✓" : "ℹ"}</span>
            <span className="tx">{t.text}</span>
            <button className="x" aria-label="Đóng" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
