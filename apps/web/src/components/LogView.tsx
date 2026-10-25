import type { LogEntry } from "@tsbot/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

const time = (ts: number) => new Date(ts).toLocaleTimeString("vi-VN", { hour12: false });
const SRC = { conn: "KẾT NỐI", script: "SCRIPT", action: "ACTION", game: "GAME" } as const;

export function LogView({ logs, onClear }: { logs: LogEntry[]; onClear?: () => void }) {
  const [level, setLevel] = useState("info");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const rank = { debug: 0, info: 1, warn: 2, error: 3 } as const;
  // Mới nhất ở đầu: lấy 1000 dòng cuối rồi đảo thứ tự.
  const shown = useMemo(() => logs.filter((l) => rank[l.level] >= rank[level as keyof typeof rank]).reverse(), [logs, level]);

  // Log mới nằm trên cùng → "Tự cuộn" giữ khung ở đầu; chỉ cuộn bên trong khung log, không đụng tới cả trang.
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = 0;
  }, [shown, follow]);

  const exportTxt = () => {
    const text = logs.map((l) => `${new Date(l.ts).toISOString()} [${l.level}] [${l.src}] ${l.line ? `L${l.line} ` : ""}${l.msg}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "connection.log";
    a.click();
  };

  return (
    <div className="logview">
      <div className="logbar">
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="debug">debug+</option><option value="info">info+</option><option value="warn">warn+</option><option value="error">error</option>
        </select>
        <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Tự cuộn</label>
        <span className="sp" />
        <button onClick={exportTxt}>Xuất file</button>
        {onClear && <button onClick={onClear}>Xoá</button>}
      </div>
      <div className="logbody" ref={box}>
        {shown.length === 0 && <div className="muted">Chưa có log.</div>}
        {shown.map((l) => (
          <div key={l.seq} className={`log ${l.level}`}>
            <span className="t">{time(l.ts)}</span>
            <span className={`src ${l.src}`}>{SRC[l.src]}</span>
            <span className="ln">{l.line ? `L${l.line}` : ""}</span>
            <span>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
