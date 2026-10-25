import type { CharacterState, ConnectionInfo, LogEntry, ServerMessage } from "@tsbot/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";

/** UI chỉ giữ 100 dòng MỚI NHẤT cho mỗi loại (sự kiện game / log kỹ thuật); dòng cũ hơn tự bị xoá để UI nhẹ. Backend vẫn giữ bộ đệm riêng. */
export const MAX_UI_LOGS = 100;

interface Live {
  connected: boolean;
  connections: ConnectionInfo[];
  /** Trạng thái nhân vật theo accountId, cập nhật realtime qua character.state_update. */
  characters: Record<string, CharacterState>;
  logs: Record<string, LogEntry[]>;
  /** Tài khoản đang được chọn (dùng chung cho mọi tab) — log của nó được đẩy realtime. */
  selected: string | null;
  select: (accountId: string | null) => void;
  clearLogs: (accountId: string) => void;
  /** Tăng mỗi khi backend báo kho script / danh mục chính thức đổi — dùng làm dependency để nạp lại danh sách. */
  scriptsVersion: number;
}
const Ctx = createContext<Live>(null as never);
export const useLive = () => useContext(Ctx);

/** Một WebSocket duy nhất, tự nối lại; log bù qua REST theo seq khi subscribe/reconnect. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [characters, setCharacters] = useState<Record<string, CharacterState>>({});
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const [selected, select] = useState<string | null>(null);
  const [scriptsVersion, setScriptsVersion] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const logsRef = useRef(logs);
  logsRef.current = logs;
  const selRef = useRef(selected);
  selRef.current = selected;

  const send = useCallback((m: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ v: 1, ...m }));
  }, []);

  const backfill = useCallback(async (id: string) => {
    const last = logsRef.current[id]?.at(-1)?.seq ?? 0;
    try {
      const missing = await api.logs(id, last);
      if (missing.length) setLogs((l) => ({ ...l, [id]: mergeLogs(l[id] ?? [], missing) }));
    } catch { /* chưa có kết nối */ }
  }, []);

  useEffect(() => {
    let closed = false;
    let timer: number | undefined;
    const open = () => {
      const s = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.current = s;
      s.onopen = () => {
        setConnected(true);
        if (selRef.current) { send({ type: "subscribe", accountId: selRef.current }); void backfill(selRef.current); }
      };
      s.onclose = () => {
        setConnected(false);
        if (!closed) timer = window.setTimeout(open, 1500);
      };
      s.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as ServerMessage;
        if (m.type === "hello") {
          setConnections(m.connections); setCharacters(m.characters);
          // Backend có thể vừa khởi động lại (bộ đếm seq của log reset) → bỏ log cũ và nạp lại từ đầu.
          logsRef.current = {};
          setLogs({});
          if (selRef.current) void backfill(selRef.current);
        }
        else if (m.type === "character.state_update") setCharacters((c) => ({ ...c, [m.accountId]: m.character }));
        else if (m.type === "connection.upsert") setConnections((cur) => (cur.some((x) => x.accountId === m.connection.accountId) ? cur.map((x) => (x.accountId === m.connection.accountId ? m.connection : x)) : [...cur, m.connection]));
        else if (m.type === "connection.removed") setConnections((cur) => cur.filter((x) => x.accountId !== m.accountId));
        else if (m.type === "scripts.changed") setScriptsVersion((v) => v + 1);
        else if (m.type === "log") setLogs((l) => ({ ...l, [m.accountId]: mergeLogs(l[m.accountId] ?? [], [m.entry]) }));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, [send, backfill]);

  useEffect(() => {
    if (!selected) return;
    send({ type: "subscribe", accountId: selected });
    void backfill(selected);
    return () => send({ type: "unsubscribe", accountId: selected });
  }, [selected, send, backfill]);

  const value = useMemo<Live>(() => ({
    connected, connections, characters, logs, selected, select, scriptsVersion,
    clearLogs: (id) => setLogs((l) => ({ ...l, [id]: [] })),
  }), [connected, connections, characters, logs, selected, scriptsVersion]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Giữ tối đa MAX_UI_LOGS dòng mới nhất cho mỗi loại (game / còn lại), giữ nguyên thứ tự thời gian. */
export function trimLogs(list: LogEntry[]): LogEntry[] {
  let game = 0, other = 0;
  const out: LogEntry[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.src === "game" ? game++ >= MAX_UI_LOGS : other++ >= MAX_UI_LOGS) continue;
    out.push(e);
  }
  return out.reverse();
}

export function mergeLogs(cur: LogEntry[], add: LogEntry[]): LogEntry[] {
  const lastEntry = cur.at(-1);
  // seq lùi mà thời gian đi tới = backend đã reset bộ đếm → coi là log mới, bỏ log cũ.
  if (lastEntry && add.length && add[0]!.seq <= lastEntry.seq && add[0]!.ts > lastEntry.ts) return trimLogs(add);
  const last = lastEntry?.seq ?? 0;
  const fresh = add.filter((e) => e.seq > last);
  if (!fresh.length) return cur;
  const next = cur.concat(fresh);
  return trimLogs(next);
}
