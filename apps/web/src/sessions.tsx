import type { Account } from "@tsbot/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { useLive } from "./live";

/** Một tab tài khoản (phiên). `accountId` = null cho tới khi login lần đầu; trạng thái socket/nhân vật/log nằm ở backend + LiveProvider theo accountId. */
export interface Session { key: string; accountId: string | null; username: string }

export const MAX_SESSIONS = 15;
export const LIMIT_MSG = `Đã đạt giới hạn tối đa ${MAX_SESSIONS} tài khoản đồng thời`;
const LS = "tsbot.sessions.v1";

export interface LoginAllResult {
  success: number;
  failed: number;
  total: number;
}

interface Ctx {
  sessions: Session[];
  active: Session | null;
  /** Tạo tab mới (trạng thái Disconnected) và chuyển tới nó; null nếu đã đủ 15. */
  add: () => Session | null;
  activate: (key: string) => void;
  update: (key: string, patch: Partial<Omit<Session, "key">>) => void;
  /** Thay đổi vị trí thứ tự tab khi kéo thả. */
  reorder: (fromIndex: number, toIndex: number) => void;
  /** Đóng tab (không xoá tài khoản đã lưu). */
  close: (key: string) => void;
  accounts: Account[];
  reloadAccounts: () => void;
  loginAll: () => Promise<LoginAllResult | null>;
  loggingAll: boolean;
  loginProgress: { done: number; total: number } | null;
  offlineTargets: { key?: string; accountId?: string; username: string }[];
  logoutAll: () => Promise<{ count: number } | null>;
  loggingOutAll: boolean;
  onlineCount: number;
}
const C = createContext<Ctx>(null as never);
export const useSessions = () => useContext(C);

const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const load = (): { sessions: Session[]; active: string | null; seeded: boolean } => {
  try {
    const v = JSON.parse(localStorage.getItem(LS) ?? "null");
    if (v && Array.isArray(v.sessions)) return { sessions: v.sessions.slice(0, MAX_SESSIONS), active: v.active ?? null, seeded: !!v.seeded };
  } catch { /* localStorage có thể bị chặn */ }
  return { sessions: [], active: null, seeded: false };
};

export const canonical = (id?: string | null): string => {
  const raw = (id ?? "").trim().toLowerCase();
  const at = raw.indexOf("@");
  return at > 0 ? raw.slice(0, at) : raw;
};

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { connections, select } = useLive();
  const init = useMemo(load, []);
  const [sessions, setSessions] = useState<Session[]>(init.sessions);
  const [activeKey, setActiveKey] = useState<string | null>(init.active);
  const [seeded, setSeeded] = useState(init.seeded);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  const reloadAccounts = useCallback(() => { api.accounts().then((l) => { setAccounts(l); setAccountsLoaded(true); }).catch(() => {}); }, []);
  useEffect(reloadAccounts, [reloadAccounts]);

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ sessions, active: activeKey, seeded })); } catch { /* bỏ qua */ }
  }, [sessions, activeKey, seeded]);

  // Lần đầu: mỗi tài khoản đã lưu thành một tab. Sau đó: phiên đang chạy (vd. sau reload / mở từ máy khác) tự có tab.
  useEffect(() => {
    if (!accountsLoaded) return;
    setSessions((cur) => {
      const match = (s: Session, id: string, user?: string) => {
        const c1 = canonical(s.accountId);
        const c2 = canonical(id);
        if (c1 && c2 && c1 === c2) return true;
        if (s.accountId === id) return true;
        const u = (user ?? "").trim().toLowerCase();
        if (u && s.username.trim().toLowerCase() === u) return true;
        return false;
      };

      let next = cur.map((s) => ({ ...s }));

      // 1. Dọn các tab của tài khoản đã bị xoá khỏi accounts (và không online)
      next = next.filter((s) => {
        const cUser = canonical(s.username) || canonical(s.accountId);
        if (!cUser) return true; // tab mới chưa nhập gì thì giữ
        const isOnline = connections.some(
          (c) => c.state !== "offline" && ((s.accountId && c.accountId === s.accountId) || canonical(c.accountId) === cUser)
        );
        if (isOnline) return true;
        return accounts.some((a) => (s.accountId && a.id === s.accountId) || canonical(a.username) === cUser);
      });

      // 2. Chỉ nạp ban đầu (lần đầu mở web hoặc chưa có tab): nạp danh sách tài khoản đã lưu vào tab
      if (!seeded && next.length === 0) {
        for (const a of accounts) {
          if (next.length < MAX_SESSIONS && !next.some((s) => match(s, a.id, a.username))) {
            next.push({ key: uid(), accountId: a.id, username: a.username });
          }
        }
      }

      // 3. Đảm bảo mọi phiên kết nối đang online đều có tab để điều khiển
      for (const c of connections) {
        if (c.state === "offline") continue;
        const u = accounts.find((a) => a.id === c.accountId)?.username ?? canonical(c.accountId);
        const existing = next.find((s) => match(s, c.accountId, u));
        if (existing) {
          if (!existing.accountId) existing.accountId = c.accountId;
          if (!existing.username) existing.username = u;
        } else if (next.length < MAX_SESSIONS) {
          next.push({ key: uid(), accountId: c.accountId, username: u });
        }
      }

      // Khử trùng lặp triệt để theo canonicalKey:
      const seen = new Set<string>();
      const dedup: Session[] = [];
      for (const s of next) {
        const key = canonical(s.accountId) || s.username.trim().toLowerCase();
        if (key) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        dedup.push(s);
      }

      const changed = dedup.length !== cur.length || dedup.some((s, i) => s.key !== cur[i]?.key || s.accountId !== cur[i]?.accountId || s.username !== cur[i]?.username);
      return changed ? dedup : cur;
    });
    if (!seeded) setSeeded(true);
  }, [accountsLoaded, accounts, connections, seeded]);

  const active = sessions.find((s) => s.key === activeKey) ?? sessions[0] ?? null;
  // Log realtime + backfill của backend bám theo tab đang xem; các tab khác vẫn chạy ngầm ở backend.
  useEffect(() => { select(active?.accountId ?? null); }, [active?.accountId, active?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback((): Session | null => {
    if (sessions.length >= MAX_SESSIONS) return null;
    const s: Session = { key: uid(), accountId: null, username: "" };
    setSessions((l) => [...l, s]);
    setActiveKey(s.key);
    return s;
  }, [sessions.length]);
  const update = useCallback((key: string, patch: Partial<Omit<Session, "key">>) => {
    setSessions((l) => {
      const updated = l.map((s) => (s.key === key ? { ...s, ...patch } : s));
      const seen = new Set<string>();
      const dedup: Session[] = [];
      for (const s of updated) {
        const k = canonical(s.accountId) || s.username.trim().toLowerCase();
        if (k) {
          if (seen.has(k)) continue;
          seen.add(k);
        }
        dedup.push(s);
      }
      return dedup;
    });
  }, []);
  const close = useCallback((key: string) => {
    const i = sessions.findIndex((s) => s.key === key);
    const next = sessions.filter((s) => s.key !== key);
    setSessions(next);
    if (active?.key === key) setActiveKey(next[Math.min(i, next.length - 1)]?.key ?? null);
  }, [sessions, active?.key]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setSessions((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const [loggingAll, setLoggingAll] = useState(false);
  const [loginProgress, setLoginProgress] = useState<{ done: number; total: number } | null>(null);

  const offlineTargets = useMemo(() => {
    // NGUỒN CHUẨN: Lấy trực tiếp từ danh sách Tài khoản (accounts), KHÔNG lấy theo lịch sử sessions / localStorage
    const list: { key?: string; accountId: string; username: string }[] = [];
    const seenUsers = new Set<string>();

    for (const a of accounts) {
      if (!a.hasPassword) continue;
      const cUser = canonical(a.username);
      if (seenUsers.has(cUser)) continue;

      // Bỏ qua nếu tài khoản đang online hoặc đang kết nối
      const conn = connections.find(
        (c) => (a.id && c.accountId === a.id) || canonical(c.accountId) === cUser
      );
      if (conn && conn.state !== "offline") continue;

      // Tìm session tab tương ứng nếu có
      const s = sessions.find(
        (s) => (s.accountId && s.accountId === a.id) || canonical(s.username) === cUser
      );

      seenUsers.add(cUser);
      list.push({ key: s?.key, accountId: a.id, username: a.username });
    }

    return list;
  }, [accounts, connections, sessions]);

  const loginAll = useCallback(async (): Promise<LoginAllResult | null> => {
    if (loggingAll) return null;
    const targets = [...offlineTargets];
    if (targets.length === 0) return { success: 0, failed: 0, total: 0 };

    setLoggingAll(true);
    setLoginProgress({ done: 0, total: targets.length });
    let success = 0;
    let failed = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]!;
        setLoginProgress({ done: i, total: targets.length });

        try {
          let sKey = t.key;
          if (!sKey) {
            const newSession: Session = { key: uid(), accountId: t.accountId ?? null, username: t.username };
            setSessions((prev) => [...prev, newSession]);
            sKey = newSession.key;
          }

          const r = await api.sessionLogin(t.username, "");
          if (sKey) {
            update(sKey, { accountId: r.accountId, username: t.username });
          }
          success++;
        } catch (e) {
          failed++;
          console.error(`[LoginAll] Lỗi khi đăng nhập ${t.username}:`, e);
        }

        setLoginProgress({ done: i + 1, total: targets.length });

        // Giãn cách 1500ms giữa các lần đăng nhập liên tiếp,
        // đảm bảo game server TS Online xử lý tuần tự, tuyệt đối không bị ngắt kết nối (kick 00/00) hay từ chối TCP
        if (i < targets.length - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      reloadAccounts();
      return { success, failed, total: targets.length };
    } finally {
      setLoggingAll(false);
      setLoginProgress(null);
    }
  }, [loggingAll, offlineTargets, update, reloadAccounts]);

  const onlineCount = useMemo(() => {
    return connections.filter((c) => c.state !== "offline").length;
  }, [connections]);

  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const logoutAll = useCallback(async (): Promise<{ count: number } | null> => {
    if (loggingOutAll) return null;
    setLoggingOutAll(true);
    try {
      const res = await api.logoutAll();
      return res;
    } finally {
      setLoggingOutAll(false);
    }
  }, [loggingOutAll]);

  const value = useMemo<Ctx>(
    () => ({
      sessions,
      active,
      add,
      activate: setActiveKey,
      update,
      reorder,
      close,
      accounts,
      reloadAccounts,
      loginAll,
      loggingAll,
      loginProgress,
      offlineTargets,
      logoutAll,
      loggingOutAll,
      onlineCount,
    }),
    [
      sessions,
      active,
      add,
      update,
      reorder,
      close,
      accounts,
      reloadAccounts,
      loginAll,
      loggingAll,
      loginProgress,
      offlineTargets,
      logoutAll,
      loggingOutAll,
      onlineCount,
    ]
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
