import type { Account, ConnectionState } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useLive } from "../live";
import { canonical, useSessions, type Session } from "../sessions";

type Badge = { cls: "off" | "wait" | "on"; label: string };
const badgeOf = (s: ConnectionState): Badge =>
  s === "online" ? { cls: "on", label: "Online" }
  : s === "offline" ? { cls: "off", label: "Disconnected" }
  : { cls: "wait", label: "Connecting" };

export function LoginPanel({ session }: { session: Session }) {
  const { connections } = useLive();
  const { sessions, update, accounts, reloadAccounts } = useSessions();
  const accountId = session.accountId;
  const [username, setUsername] = useState(session.username);
  const [password, setPassword] = useState("");
  // Mật khẩu đã lưu ở backend: UI chỉ hiện ******** và gửi rỗng để backend tự dùng.
  const [saved, setSaved] = useState(() => !!accounts.find((a) => a.id === session.accountId)?.hasPassword);
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");

  // Tài khoản đã lưu (khớp theo tên) → hiện mật khẩu đã lưu; gõ tên khác → phải nhập mật khẩu.
  useEffect(() => {
    const a = accounts.find((x) => x.id === accountId) ?? accounts.find((x) => x.username === username.trim());
    setSaved(!!a?.hasPassword);
  }, [accounts, accountId, username]);

  const conn = connections.find((c) => c.accountId === accountId);
  const state: ConnectionState = pending && (!conn || conn.state === "offline") ? "connecting" : conn?.state ?? "offline";
  const badge = badgeOf(state);
  const idle = state === "offline";
  const connecting = state === "connecting" || state === "reconnecting";

  const login = async () => {
    setErr("");
    setPending(true);
    try {
      const name = username.trim();
      const dup = sessions.find((x) => x.key !== session.key && (x.username.trim().toLowerCase() === name.toLowerCase() || (x.accountId && canonical(x.accountId) === canonical(name))));
      if (dup) throw new Error(`Tài khoản ${name} đã được mở ở một tab khác`);
      update(session.key, { username: name });
      const r = await api.sessionLogin(name, saved ? "" : password);
      update(session.key, { accountId: r.accountId, username: name });
      setPassword("");
      reloadAccounts();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const logout = async () => {
    if (!accountId) return;
    setErr("");
    try { await api.logout(accountId); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="card login">
      <form className="loginrow" onSubmit={(e) => { e.preventDefault(); if (idle && !pending) void login(); }}>
        <span className={`cbadge ${badge.cls}`}><i />{badge.label}</span>
        <input placeholder="Tài khoản" aria-label="Tài khoản" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!idle} autoComplete="username" spellCheck={false} />
        <span className="pw">
          <input placeholder="Mật khẩu" aria-label="Mật khẩu" type={show && !saved ? "text" : "password"} value={saved ? "********" : password} onChange={(e) => { setSaved(false); setPassword(e.target.value); }} onFocus={(e) => saved && e.target.select()} disabled={!idle} autoComplete="current-password" />
          {!saved && <button type="button" className="eye" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} title={show ? "Ẩn" : "Hiện"}>{show ? "🙈" : "👁"}</button>}
        </span>
        {(idle || connecting) && (
          <button type="submit" className="primary" disabled={connecting || !username.trim() || (!saved && !password)}>
            {connecting ? <><span className="spin" />Login…</> : "Login"}
          </button>
        )}
        {!idle && (
          <button type="button" className="logout" disabled={state === "disconnecting"} onClick={logout}>
            {state === "disconnecting" ? <><span className="spin" />Logout…</> : connecting ? "Huỷ" : "Logout"}
          </button>
        )}
      </form>
      {err && <div className="error small">{err}</div>}
      {conn?.error && idle && !err && <div className="error small">{conn.error}</div>}
    </div>
  );
}
