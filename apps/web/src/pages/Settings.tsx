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
  const [testingTg, setTestingTg] = useState(false);
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

  const updateTg = (patch: Partial<NonNullable<Settings["telegram"]>>) => {
    const curTg = s.telegram ?? {
      enabled: false,
      botToken: "",
      chatId: "",
      notifyOnDisconnect: true,
      notifyOnReconnect: false,
    };
    setS({ ...s, telegram: { ...curTg, ...patch } });
  };

  const handleTestTelegram = async () => {
    const tg = s.telegram;
    if (!tg?.botToken?.trim()) {
      toast("error", "Vui lòng nhập Telegram Bot Token trước khi kiểm tra");
      return;
    }
    if (!tg?.chatId?.trim()) {
      toast("error", "Vui lòng nhập Chat ID hoặc Group ID");
      return;
    }
    setTestingTg(true);
    try {
      const res = await api.testTelegram({
        botToken: tg.botToken,
        chatId: tg.chatId,
        apiRoot: tg.apiRoot || undefined,
      });
      if (res.ok) {
        toast("ok", "✓ Gửi tin nhắn Telegram thành công! Hãy kiểm tra bot/nhóm chat Telegram.");
      } else {
        toast("error", `✕ ${res.message || "Gửi thất bại"}`);
      }
    } catch (err) {
      toast("error", `✕ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingTg(false);
    }
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

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>📱 Giám sát Telegram (Monitor Online)</h2>
          <span className="muted small">Tự động push thông báo tới nhóm Telegram khi có tài khoản bị ngắt kết nối</span>
        </div>
        <div className="sgrid">
          <label className="sfield switch">
            <input
              type="checkbox"
              className="cbx"
              checked={s.telegram?.enabled ?? false}
              onChange={(e) => updateTg({ enabled: e.target.checked })}
            />
            <span className="sl"><b>Bật giám sát và gửi cảnh báo qua Telegram</b></span>
          </label>

          <Field label="Telegram Bot Token" hint="Nhận từ @BotFather trên Telegram (VD: 123456789:ABCdef...)">
            <input
              type="password"
              placeholder="VD: 7123456789:AAHk..."
              value={s.telegram?.botToken ?? ""}
              onChange={(e) => updateTg({ botToken: e.target.value })}
            />
          </Field>

          <Field label="Chat ID / Group ID" hint="ID nhóm hoặc cá nhân nhận tin (nhóm bắt đầu bằng dấu trừ '-', VD: -100123456789)">
            <input
              placeholder="VD: -1001987654321 hoặc 123456789"
              value={s.telegram?.chatId ?? ""}
              onChange={(e) => updateTg({ chatId: e.target.value })}
            />
          </Field>

          <Field label="API Endpoint / Reverse Proxy" hint="Mặc định: https://api.telegram.org (Nếu máy công ty/nhà mạng chặn, dán link Cloudflare Worker Proxy)">
            <input
              placeholder="https://api.telegram.org"
              value={s.telegram?.apiRoot ?? ""}
              onChange={(e) => updateTg({ apiRoot: e.target.value })}
            />
          </Field>

          <label className="sfield switch">
            <input
              type="checkbox"
              className="cbx"
              checked={s.telegram?.notifyOnDisconnect ?? true}
              disabled={!(s.telegram?.enabled ?? false)}
              onChange={(e) => updateTg({ notifyOnDisconnect: e.target.checked })}
            />
            <span className="sl">🚨 Thông báo khẩn khi có tài khoản bị ngắt kết nối (Disconnect / Kick / Rớt mạng)</span>
          </label>

          <label className="sfield switch">
            <input
              type="checkbox"
              className="cbx"
              checked={s.telegram?.notifyOnReconnect ?? false}
              disabled={!(s.telegram?.enabled ?? false)}
              onChange={(e) => updateTg({ notifyOnReconnect: e.target.checked })}
            />
            <span className="sl">✅ Thông báo khi tài khoản kết nối lại thành công</span>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleTestTelegram}
              disabled={testingTg || !s.telegram?.botToken || !s.telegram?.chatId}
              style={{ padding: "6px 14px", fontSize: 13 }}
            >
              {testingTg ? "⏳ Đang gửi thử nghiệm..." : "🔔 Gửi tin nhắn thử nghiệm (Test Bot)"}
            </button>
            <span className="muted small">
              💡 Mẹo: Tạo bot bằng @BotFather, thêm bot vào nhóm chat và cấp quyền gửi tin; lấy Chat ID từ @userinfobot hoặc @getmyid_bot.
            </span>
          </div>
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
