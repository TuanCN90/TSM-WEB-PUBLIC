import type { HealthInfo, Settings } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { canonical, useSessions } from "../sessions";

/** Một ô cài đặt: nhãn đậm + ô nhập + dòng gợi ý nhỏ. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="sfield">
      <span className="sl">{label}</span>
      {children}
      {hint && <span className="sh">{hint}</span>}
    </label>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { accounts, reloadAccounts, sessions, close } = useSessions();
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [h, setH] = useState<HealthInfo | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newServer, setNewServer] = useState("");
  const [serverList, setServerList] = useState<string[]>([]);

  useEffect(() => {
    api.settings().then((v) => { setS(v); setSaved(v); }).catch((e) => toast("error", e.message));
    api.health().then(setH).catch(() => {});
    api.servers().then((srvs) => {
      setServerList(srvs);
      if (srvs.length > 0) setNewServer(srvs[0]!);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <div className="muted">Đang tải…</div>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const num = (k: "maxSessions" | "speed" | "commandTimeoutMs" | "heartbeatMs" | "maxReconnect") => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value));
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = async () => {
    try { const v = await api.saveSettings(s); setS(v); setSaved(v); toast("ok", "Đã lưu cài đặt"); } catch (e) { toast("error", e instanceof Error ? e.message : String(e)); }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) { toast("error", "Vui lòng nhập tên tài khoản"); return; }
    if (!newPassword) { toast("error", "Vui lòng nhập mật khẩu"); return; }
    try {
      await api.saveAccount({
        id: "",
        username: newUsername.trim(),
        password: newPassword,
        server: newServer || serverList[0] || "(3) Jiangling(mới)",
      });
      setNewUsername("");
      setNewPassword("");
      reloadAccounts();
      toast("ok", `✓ Đã thêm tài khoản ${newUsername.trim()}`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteAccount = async (id: string, name: string) => {
    if (!confirm(`Xoá tài khoản ${name} khỏi danh sách?`)) return;
    try {
      await api.deleteAccount(id);
      const s = sessions.find((x) => (x.accountId && x.accountId === id) || (x.username && canonical(x.username) === canonical(name)));
      if (s) close(s.key);
      reloadAccounts();
      toast("ok", `✓ Đã xoá tài khoản ${name}`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings">
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>📋 Danh Sách Tài Khoản ({accounts.length})</h2>
          <span className="muted small">Menu quản lý tài khoản dùng cho tính năng ⚡ Login Tất Cả</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "6px 8px" }}>STT</th>
                <th style={{ padding: "6px 8px" }}>Tài khoản</th>
                <th style={{ padding: "6px 8px" }}>Máy chủ</th>
                <th style={{ padding: "6px 8px" }}>Mật khẩu</th>
                <th style={{ padding: "6px 8px", textAlign: "center" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: 16, textAlign: "center" }}>
                    Chưa có tài khoản nào được lưu.
                  </td>
                </tr>
              )}
              {accounts.map((a, idx) => (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{idx + 1}</td>
                  <td style={{ padding: "6px 8px" }}><b>{a.username}</b></td>
                  <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{a.server}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ color: a.hasPassword ? "var(--accent-ink, #38bdf8)" : "#ef4444" }}>
                      {a.hasPassword ? "✓ Đã lưu" : "✕ Chưa lưu"}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void handleDeleteAccount(a.id, a.username)}
                      style={{ padding: "2px 8px", fontSize: 11, borderRadius: 4 }}
                      title={`Xoá ${a.username}`}
                    >
                      Xoá 🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleAddAccount} style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 12 }}>+ Thêm tài khoản mới:</span>
          <input
            placeholder="Tên tài khoản"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            style={{ width: 140, padding: "4px 8px", fontSize: 12 }}
          />
          <input
            type="password"
            placeholder="Mật khẩu"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ width: 140, padding: "4px 8px", fontSize: 12 }}
          />
          <select
            value={newServer}
            onChange={(e) => setNewServer(e.target.value)}
            style={{ padding: "4px 8px", fontSize: 12 }}
          >
            {serverList.map((srv) => (
              <option key={srv} value={srv}>{srv}</option>
            ))}
          </select>
          <button type="submit" className="primary" style={{ padding: "4px 12px", fontSize: 12 }}>
            + Thêm
          </button>
        </form>
      </section>
      <section className="card">
        <h2>Kết nối</h2>
        <div className="sgrid">
          <Field label="Số nhân vật online song song tối đa" hint="1 – 15">
            <input type="number" min={1} max={15} value={s.maxSessions} onChange={num("maxSessions")} />
          </Field>
          <Field label="Tốc độ mặc định ×" hint="1 = thời gian thực; lớn hơn = tua nhanh thời gian chờ">
            <input type="number" min={0.1} max={100} step={0.5} value={s.speed} onChange={num("speed")} />
          </Field>
          <Field label="Transport mặc định">
            <select value={s.defaultTransport} onChange={(e) => set("defaultTransport", e.target.value)}>
              {h?.transports.map((t) => <option key={t.name} value={t.name}>{t.name} — {t.description}</option>)}
              {!h && <option value={s.defaultTransport}>{s.defaultTransport}</option>}
            </select>
          </Field>
          <Field label="Codec giao thức" hint="Chỉ dùng cho transport socket">
            <select value={s.socketCodec} onChange={(e) => set("socketCodec", e.target.value)}>
              {h?.codecs.map((c) => <option key={c.name} value={c.name}>{c.name} — {c.description}</option>)}
              {!h && <option value={s.socketCodec}>{s.socketCodec}</option>}
            </select>
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Thời gian chờ &amp; log</h2>
        <div className="sgrid">
          <Field label="Timeout lệnh await_* (ms)" hint="Tối thiểu 1000">
            <input type="number" min={1000} step={1000} value={s.commandTimeoutMs} onChange={num("commandTimeoutMs")} />
          </Field>
          <Field label="Chu kỳ heartbeat (ms)" hint="Tối thiểu 1000">
            <input type="number" min={1000} step={1000} value={s.heartbeatMs} onChange={num("heartbeatMs")} />
          </Field>
          <Field label="Mức log">
            <select value={s.logLevel} onChange={(e) => set("logLevel", e.target.value as Settings["logLevel"])}>
              <option>debug</option><option>info</option><option>warn</option><option>error</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Tự kết nối lại</h2>
        <div className="sgrid">
          <label className="sfield switch">
            <input type="checkbox" className="cbx" checked={s.autoReconnect} onChange={(e) => set("autoReconnect", e.target.checked)} />
            <span className="sl">Tự động kết nối lại khi mất kết nối</span>
          </label>
          <Field label="Số lần kết nối lại tối đa" hint="0 – 100">
            <input type="number" min={0} max={100} value={s.maxReconnect} disabled={!s.autoReconnect} onChange={num("maxReconnect")} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Điểm danh ngày</h2>
        <div className="sgrid">
          <label className="sfield switch">
            <input type="checkbox" className="cbx" checked={s.autoCheckin} onChange={(e) => set("autoCheckin", e.target.checked)} />
            <span className="sl">Tự động điểm danh ngày sau mỗi lần đăng nhập thành công</span>
          </label>
        </div>
      </section>

      <div className="savebar">
        <span className="muted small">Áp dụng từ lần đăng nhập kế tiếp; kết nối đang online giữ cấu hình cũ. Engine {h?.version}.</span>
        <span className="sp" />
        {dirty && <span className="unsaved" role="status"><span aria-hidden>⚠</span> Chưa lưu</span>}
        <button onClick={() => setS(saved)} disabled={!dirty}>Hoàn tác</button>
        <button className="primary" onClick={save} disabled={!dirty}>Lưu</button>
      </div>
    </div>
  );
}
