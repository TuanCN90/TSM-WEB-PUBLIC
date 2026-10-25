import { useEffect } from "react";

/** Popup xác nhận dùng chung (thay window.confirm). Esc / bấm nền = huỷ. */
export function ConfirmDialog({ title, body, okLabel = "Đồng ý", danger, onOk, onCancel }: {
  title: string; body: React.ReactNode; okLabel?: string; danger?: boolean; onOk: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="modal-back top" onClick={onCancel}>
      <div className="modal card" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div>{body}</div>
        <div className="row"><span className="sp" />
          <button onClick={onCancel}>Huỷ</button>
          <button autoFocus className={danger ? "danger" : "primary"} onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
