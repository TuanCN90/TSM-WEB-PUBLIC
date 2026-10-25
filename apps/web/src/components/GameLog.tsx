import type { LogEntry } from "@tsbot/protocol";
import React, { useMemo } from "react";

const time = (ts: number) => new Date(ts).toLocaleTimeString("vi-VN", { hour12: false });

/** Phân loại để tô màu theo mẫu câu trong `packages/engine/src/data/messages.ts` (sửa câu bên đó thì sửa ở đây). */
const kind = (m: string) =>
  /^(Đăng nhập thành công|Kết nối lại được)/.test(m) ? "up"
  : /^Ní bị ngắt|^Ní bị Dị giới đuổi|^Server không cho|không được|túi đồ đầy|chưa nhận được|^Kéo Ní vào lại|đã dừng|thôi dừng/.test(m) ? "down"
  : /^(Đang kéo Ní|Ní chờ xíu|Server chưa cho)/.test(m) ? "wait"
  : /đăng xuất/.test(m) ? "off"
  : /lên cấp/.test(m) ? "lv"
  : /\bexp\b/.test(m) ? "exp"
  : /Xu 🪙|Vàng 🥇/.test(m) ? "money"
  : /^Ní đã (sang map|dịch chuyển)/.test(m) ? "map"
  : /^(Ní nhận được|Ní vừa điểm danh|Ní đã vào Dị giới|Nhận quà thư xong|Nhận quà Online xong|Ní vừa nhận thành công quà Online|Võ tướng .* đã xuất chiến)/.test(m) ? "gift"
  : /^(⚡ Combo|----|⚔️ Trận đấu|🎉 Trận đấu)/.test(m) ? "battle"
  : "";

const LOG_REGEX = /(⚡ Combo \(\d+\):|\[[^\]]+\]|-\s*\d+\s*(?:HP|hp)\b|\b\d+\/\d+\s*(?:HP|hp)\b|\b\d+\/\d+\s*(?:SP|sp)\b|-\s*\d+\s*(?:SP|sp)\b|\bMiss\b|\(Gục ngã\)|\(\d+,\d+\)|----)/g;

function formatLogLine(line: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  line.replace(LOG_REGEX, (match, _p1, offset) => {
    if (offset > last) {
      parts.push(line.slice(last, offset));
    }
    if (match.startsWith("⚡ Combo")) {
      parts.push(<span key={offset} className="log-combo">{match}</span>);
    } else if (match.startsWith("[")) {
      parts.push(<span key={offset} className="log-skill">{match}</span>);
    } else if (match.toLowerCase().includes("hp")) {
      if (match.startsWith("-")) {
        parts.push(<b key={offset} className="log-dmg">{match}</b>);
      } else {
        parts.push(<span key={offset} className="log-hp">{match}</span>);
      }
    } else if (match.toLowerCase().includes("sp")) {
      parts.push(<span key={offset} className="log-sp">{match}</span>);
    } else if (match === "Miss") {
      parts.push(<span key={offset} className="log-miss">Miss</span>);
    } else if (match === "(Gục ngã)") {
      parts.push(<b key={offset} className="log-dead">(Gục ngã)</b>);
    } else if (match.startsWith("(") && match.endsWith(")")) {
      parts.push(<span key={offset} className="log-coord">{match}</span>);
    } else if (match === "----") {
      parts.push(<span key={offset} className="log-bullet">----</span>);
    } else {
      parts.push(match);
    }
    last = offset + match.length;
    return match;
  });
  if (last < line.length) {
    parts.push(line.slice(last));
  }
  return parts;
}

export function FormattedLogMessage({ msg }: { msg: string }) {
  if (!msg.includes("\n") && !msg.startsWith("----") && !msg.startsWith("⚡ Combo")) {
    return <span>{formatLogLine(msg)}</span>;
  }
  const lines = msg.split("\n");
  return (
    <span className="log-multiline" style={{ display: "inline-block", verticalAlign: "top" }}>
      {lines.map((l, i) => (
        <span key={i} style={{ display: "block", minHeight: "1.25em" }}>
          {formatLogLine(l)}
        </span>
      ))}
    </span>
  );
}

/** Tab "Sự kiện": chỉ các sự kiện game đã dịch sang dạng dễ đọc (src = game), mới nhất ở đầu. */
export function GameLog({ logs, onClear }: { logs: LogEntry[]; onClear?: () => void }) {
  const rows = useMemo(() => logs.filter((l) => l.src === "game").reverse(), [logs]);
  return (
    <div className="logview">
      <div className="logbar">
        <span className="muted small">Kết nối, exp, lên cấp, Vàng/Xu, đổi map, điểm danh, Dị giới, túi đồ</span>
        <span className="sp" />
        {onClear && <button onClick={onClear}>Xoá</button>}
      </div>
      <div className="logbody">
        {rows.length === 0 && <div className="muted">Chưa có sự kiện nào.</div>}
        {rows.map((l) => (
          <div key={l.seq} className={`log gevt ${kind(l.msg)}`}>
            <span className="t">{time(l.ts)}</span>
            <FormattedLogMessage msg={l.msg} />
          </div>
        ))}
      </div>
    </div>
  );
}
