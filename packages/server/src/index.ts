import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { EngineError, codecs, drivers, listLiveActions, parse } from "@tsbot/engine";
import type { Account, BattleConfig, ChaseConfig, ClientMessage, DungeonSoloConfig, DungeonTeamConfig, EscortConfig, PartyConfig, DispatchBody, LoginBody, RunQueueBody, RunScriptBody, SessionLoginBody, SessionLoginResult, ScriptControl, ServerMessage, Settings, WorldBossConfig } from "@tsbot/protocol";
import Fastify from "fastify";
import type { WebSocket } from "ws";
import { CUSTOM_SCRIPTS_DIR, ROOT } from "./services/paths";
import { ConnectionManager, HttpError } from "./services/connections";
import { ITEM_LIST_KEYS, type ItemListKey } from "@tsbot/protocol";
import { AccountStore, BattleConfigStore, ChaseConfigStore, CUSTOM_PREFIX, ItemListStore, RunnableRegistry, ScriptStore, ServerStore, SettingsStore } from "./services/store";

const VERSION = "0.1.1"; // 2026-10-20 multi-map navigation update
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1"; // chỉ local, đừng đổi nếu chưa thêm xác thực

const scripts = new ScriptStore();
const accounts = new AccountStore();
const itemLists = new ItemListStore();
const battleConfigs = new BattleConfigStore();
const chaseConfigs = new ChaseConfigStore();
const settings = new SettingsStore();
const servers = new ServerStore();
const customScripts = new ScriptStore(CUSTOM_SCRIPTS_DIR);
const registry = new RunnableRegistry();
const connections = new ConnectionManager(scripts, customScripts, registry, accounts, settings, servers, battleConfigs, itemLists, chaseConfigs);

const app = Fastify({ logger: { level: "warn" } });
await app.register(websocket);

// Cho phép POST không có body dù client gửi content-type: application/json
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch {
    done(Object.assign(new Error("JSON không hợp lệ"), { statusCode: 400 }), undefined);
  }
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  const status = err instanceof HttpError || err instanceof EngineError ? err.status : (err.statusCode ?? 500);
  reply.status(status).send({ error: err.message });
});

/* ---------- WebSocket ---------- */
const clients = new Map<WebSocket, Set<string>>();
const send = (ws: WebSocket, m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
const broadcast = (m: ServerMessage) => clients.forEach((_, ws) => send(ws, m));

connections.onChange = (connection) => broadcast({ v: 1, type: "connection.upsert", connection });
connections.onRemoved = (accountId) => broadcast({ v: 1, type: "connection.removed", accountId });
connections.onCharacter = (accountId, character) => broadcast({ v: 1, type: "character.state_update", accountId, character });
connections.onLog = (accountId, entry) => {
  for (const [ws, subs] of clients) if (subs.has(accountId)) send(ws, { v: 1, type: "log", accountId, entry });
};

app.get("/ws", { websocket: true }, (ws) => {
  clients.set(ws, new Set());
  send(ws, { v: 1, type: "hello", connections: connections.list(), characters: connections.characters() });
  ws.on("message", async (raw) => {
    let requestId: string | undefined;
    try {
      const m = JSON.parse(String(raw)) as ClientMessage;
      requestId = "requestId" in m ? m.requestId : undefined;
      if (m.type === "ping") return send(ws, { v: 1, type: "pong" });
      if (m.type === "subscribe") return void clients.get(ws)?.add(m.accountId);
      if (m.type === "unsubscribe") return void clients.get(ws)?.delete(m.accountId);
      let message: string | undefined;
      let ok = true;
      if (m.type === "login") await connections.login(m.accountId, { transport: m.transport, speed: m.speed });
      else if (m.type === "logout") await connections.logout(m.accountId);
      else if (m.type === "logoutAll") await connections.logoutAll();
      else if (m.type === "dispatch") ({ ok, message } = await connections.dispatch(m.accountId, m.action, m.params));
      else if (m.type === "script.run") connections.runScript(m.accountId, m.scriptId, m.vars);
      else if (m.type === "script.control") connections.scriptControl(m.accountId, m.action);
      send(ws, { v: 1, type: "result", requestId, ok, message });
    } catch (e) {
      send(ws, { v: 1, type: "result", requestId, ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  });
  ws.on("close", () => clients.delete(ws));
});

/* ---------- REST ---------- */
app.get("/api/health", async () => ({
  version: VERSION,
  transports: drivers.map((d) => ({ name: d.name, description: d.description })),
  codecs: codecs.map((c) => ({ name: c.name, description: c.description })),
  online: connections.onlineCount(),
  maxSessions: settings.get().maxSessions,
}));

// Scripts (id có thể chứa "/")
app.get("/api/scripts", async () => scripts.list());
app.get<{ Params: { "*": string } }>("/api/scripts/*", async (req) => {
  const f = scripts.get(req.params["*"]);
  if (!f) throw new HttpError(404, "Không có script");
  return f;
});
app.put<{ Params: { "*": string }; Body: { content: string } }>("/api/scripts/*", async (req) => {
  if (typeof req.body?.content !== "string") throw new HttpError(400, "Thiếu content");
  const meta = scripts.put(req.params["*"], req.body.content);
  broadcast({ v: 1, type: "scripts.changed" });
  return meta;
});
app.delete<{ Params: { "*": string } }>("/api/scripts/*", async (req) => {
  if (!scripts.delete(req.params["*"])) throw new HttpError(404, "Không có script");
  broadcast({ v: 1, type: "scripts.changed" });
  return { ok: true };
});

// Kho script tự tạo (nháp) — tách khỏi danh mục chạy chính thức. Mỗi item kèm `official`.
const customList = () => customScripts.list().map((s) => ({ ...s, source: "custom" as const, official: registry.has(s.id) }));
app.get("/api/custom-scripts", async () => customList());
app.get<{ Params: { "*": string } }>("/api/custom-scripts/*", async (req) => {
  const f = customScripts.get(req.params["*"]);
  if (!f) throw new HttpError(404, "Không có script");
  return { ...f, source: "custom", official: registry.has(f.id) };
});
app.put<{ Params: { "*": string }; Body: { content: string; renameFrom?: string } }>("/api/custom-scripts/*", async (req) => {
  const id = req.params["*"].trim();
  if (!id || id.split("/").some((p) => !p.trim() || p === "." || p === "..")) throw new HttpError(400, "Tên kịch bản không hợp lệ");
  if (typeof req.body?.content !== "string") throw new HttpError(400, "Thiếu content");
  const from = req.body.renameFrom;
  if (from && from !== id) {
    if (!customScripts.get(from)) throw new HttpError(404, "Không có script cần đổi tên");
    if (customScripts.get(id)) throw new HttpError(409, `Đã có kịch bản tên "${id}"`);
    customScripts.put(id, req.body.content);
    customScripts.delete(from);
    registry.rename(from, id);
  } else customScripts.put(id, req.body.content);
  broadcast({ v: 1, type: "scripts.changed" });
  return { ...customScripts.get(id)!, official: registry.has(id) };
});
app.delete<{ Params: { "*": string } }>("/api/custom-scripts/*", async (req) => {
  const id = req.params["*"];
  if (!customScripts.delete(id)) throw new HttpError(404, "Không có script");
  registry.remove(id);
  broadcast({ v: 1, type: "scripts.changed" });
  return { ok: true };
});

// Danh mục chạy chính thức = script gốc + script tự tạo đã duyệt (id có tiền tố "custom:")
app.get("/api/runnable-scripts", async () => [
  ...scripts.list().map((s) => ({ ...s, source: "base" as const })),
  ...customList().filter((s) => s.official).map(({ official: _o, ...s }) => ({ ...s, id: CUSTOM_PREFIX + s.id })),
]);
app.post<{ Body: { id: string } }>("/api/runnable-scripts", async (req) => {
  const id = req.body?.id;
  if (!id || !customScripts.get(id)) throw new HttpError(404, "Không có script tự tạo này");
  registry.add(id);
  broadcast({ v: 1, type: "scripts.changed" });
  return { ok: true };
});
app.delete<{ Params: { "*": string } }>("/api/runnable-scripts/*", async (req) => {
  if (!registry.remove(req.params["*"])) throw new HttpError(404, "Script này không nằm trong danh sách chính thức");
  broadcast({ v: 1, type: "scripts.changed" });
  return { ok: true };
});
app.post<{ Body: { content: string } }>("/api/validate", async (req) => ({ diagnostics: parse(req.body?.content ?? "").diagnostics }));

// Accounts
app.get("/api/accounts", async () => accounts.list());
app.post<{ Body: Account }>("/api/accounts", async (req) => {
  const b = req.body;
  if (!b?.server?.trim() || !b?.username?.trim()) throw new HttpError(400, "server và user là bắt buộc");
  if (b.id && !/^[\w.@-]+$/.test(b.id)) throw new HttpError(400, "id không hợp lệ");
  servers.add(b.server.trim());
  return accounts.upsert({ ...b, server: b.server.trim(), username: b.username.trim() });
});
// Đăng nhập nhanh: server mặc định cố định ở backend, luôn dùng SocketTransport.
app.post<{ Body: SessionLoginBody }>("/api/session/login", async (req): Promise<SessionLoginResult> => {
  const username = req.body?.username?.trim();
  const password = req.body?.password ?? "";
  if (!username) throw new HttpError(400, "Thiếu tài khoản");
  const server = servers.defaultName();
  if (!server) throw new HttpError(500, "Backend chưa cấu hình server mặc định (data/servers.json)");
  if (!servers.endpointOf(server)) throw new HttpError(500, `Server '${server}' thiếu host:port trong data/servers.json`);
  // password rỗng = dùng lại mật khẩu đã lưu của tài khoản (upsert giữ nguyên password cũ).
  const account = accounts.upsert({ id: accounts.findByUser(server, username)?.id ?? "", server, username, password });
  if (!account.hasPassword) throw new HttpError(400, "Thiếu mật khẩu");
  const connection = await connections.login(account.id, { transport: "socket" });
  return { accountId: account.id, connection };
});
app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req) => {
  connections.forget(req.params.id);
  if (!accounts.delete(req.params.id)) throw new HttpError(404, "Không có tài khoản");
  return { ok: true };
});

// Danh sách vật phẩm tự động (menu chuột phải ở Thùng đồ): GET lấy hết, PUT bật/tắt một itemId trong một danh sách
app.get<{ Params: { id: string } }>("/api/accounts/:id/item-lists", async (req) => itemLists.get(req.params.id));
app.put<{ Params: { id: string }; Body: { list: ItemListKey; itemId: number; on?: boolean } }>("/api/accounts/:id/item-lists", async (req) => {
  const { list, itemId, on = true } = req.body ?? ({} as never);
  if (!ITEM_LIST_KEYS.includes(list)) throw new HttpError(400, `list phải là một trong ${ITEM_LIST_KEYS.join(", ")}`);
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 2_147_483_647) throw new HttpError(400, "itemId phải là số nguyên dương hợp lệ");
  const updated = itemLists.update(req.params.id, list, itemId, on);
  try {
    const conn = connections.get(req.params.id);
    if (conn) {
      await conn.dispatch("set_item_lists", {
        autoDropJson: JSON.stringify(updated.discard ?? []),
        autoOpenJson: JSON.stringify(updated.autoOpen ?? []),
        autoDissolveJson: JSON.stringify(updated.resolve ?? []),
        autoContributeJson: JSON.stringify(updated.contribute ?? []),
        autoCombineJson: JSON.stringify(updated.combine ?? []),
        sellJson: JSON.stringify(updated.sell ?? []),
        togglesJson: JSON.stringify(updated.toggles ?? {}),
        autoSweepEnabled: updated.autoSweepEnabled ? "1" : "0",
      }).catch(() => {});
    }
  } catch {}
  return updated;
});

// Gán đè toàn bộ danh sách itemId (cho tính năng dán/clone danh sách sang tài khoản khác)
app.post<{ Params: { id: string }; Body: { list: ItemListKey; itemIds: number[] } }>("/api/accounts/:id/item-lists/batch", async (req) => {
  const { list, itemIds } = req.body ?? ({} as never);
  if (!ITEM_LIST_KEYS.includes(list)) throw new HttpError(400, `list phải là một trong ${ITEM_LIST_KEYS.join(", ")}`);
  if (!Array.isArray(itemIds)) throw new HttpError(400, "itemIds phải là mảng số nguyên");
  const updated = itemLists.setList(req.params.id, list, itemIds);
  try {
    const conn = connections.get(req.params.id);
    if (conn) {
      await conn.dispatch("set_item_lists", {
        autoDropJson: JSON.stringify(updated.discard ?? []),
        autoOpenJson: JSON.stringify(updated.autoOpen ?? []),
        autoDissolveJson: JSON.stringify(updated.resolve ?? []),
        autoContributeJson: JSON.stringify(updated.contribute ?? []),
        autoCombineJson: JSON.stringify(updated.combine ?? []),
        sellJson: JSON.stringify(updated.sell ?? []),
        togglesJson: JSON.stringify(updated.toggles ?? {}),
        autoSweepEnabled: updated.autoSweepEnabled ? "1" : "0",
      }).catch(() => {});
    }
  } catch {}
  return updated;
});

// Bật/tắt quét tự động cho từng action (discard, autoOpen, combine...)
app.put<{ Params: { id: string }; Body: { key: ItemListKey; enabled: boolean } }>("/api/accounts/:id/item-lists/toggle", async (req) => {
  const { key, enabled } = req.body ?? ({} as never);
  if (!ITEM_LIST_KEYS.includes(key)) throw new HttpError(400, `key phải là một trong ${ITEM_LIST_KEYS.join(", ")}`);
  const updated = itemLists.setToggle(req.params.id, key, enabled);
  try {
    const conn = connections.get(req.params.id);
    if (conn) {
      await conn.dispatch("set_item_lists", {
        autoDropJson: JSON.stringify(updated.discard ?? []),
        autoOpenJson: JSON.stringify(updated.autoOpen ?? []),
        autoDissolveJson: JSON.stringify(updated.resolve ?? []),
        autoContributeJson: JSON.stringify(updated.contribute ?? []),
        autoCombineJson: JSON.stringify(updated.combine ?? []),
        sellJson: JSON.stringify(updated.sell ?? []),
        togglesJson: JSON.stringify(updated.toggles ?? {}),
        autoSweepEnabled: updated.autoSweepEnabled ? "1" : "0",
      }).catch(() => {});
    }
  } catch {}
  return updated;
});

// Bật/tắt auto quét và xử lý thùng đồ cá nhân định kỳ (mỗi 1 phút quét 1 lần)
app.put<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/accounts/:id/item-lists/auto-sweep", async (req) => {
  const { enabled } = req.body ?? ({} as never);
  const updated = itemLists.setAutoSweepEnabled(req.params.id, Boolean(enabled));
  try {
    const conn = connections.get(req.params.id);
    if (conn) {
      await conn.dispatch("set_item_lists", {
        autoDropJson: JSON.stringify(updated.discard ?? []),
        autoOpenJson: JSON.stringify(updated.autoOpen ?? []),
        autoDissolveJson: JSON.stringify(updated.resolve ?? []),
        autoContributeJson: JSON.stringify(updated.contribute ?? []),
        autoCombineJson: JSON.stringify(updated.combine ?? []),
        sellJson: JSON.stringify(updated.sell ?? []),
        togglesJson: JSON.stringify(updated.toggles ?? {}),
        autoSweepEnabled: updated.autoSweepEnabled ? "1" : "0",
      }).catch(() => {});
    }
  } catch {}
  return updated;
});

// Cập nhật cấu hình mua HP/SP tại NPC Hương Dũng (Bật/tắt, số lượng)
app.put<{ Params: { id: string }; Body: import("@tsbot/protocol").BuySettings }>("/api/accounts/:id/item-lists/buy-settings", async (req) => {
  const updated = itemLists.setBuySettings(req.params.id, req.body ?? {});
  return updated;
});

// Cập nhật cấu hình tự động sử dụng HP/SP
app.put<{ Params: { id: string }; Body: Partial<import("@tsbot/protocol").AutoHealConfig> }>("/api/accounts/:id/item-lists/auto-heal", async (req) => {
  const updated = itemLists.setAutoHeal(req.params.id, req.body ?? {});
  try {
    const conn = connections.get(req.params.id);
    if (conn && !conn.isOffline) {
      await conn.dispatch("set_auto_heal", {
        autoHealJson: JSON.stringify(updated.autoHeal ?? {}),
      });
    }
  } catch {}
  return updated;
});

// Cấu hình trận đấu theo tài khoản (mặc định + 21 turns)
app.get<{ Params: { id: string } }>("/api/accounts/:id/battle-config", async (req) => {
  return battleConfigs.get(req.params.id) ?? {
    playerAction: { type: "attack", skillId: 10000, target: "F1" },
    petAction: { type: "attack", skillId: 10000, target: "F1" },
    autoFight: true,
    turns: [],
  };
});
app.put<{ Params: { id: string }; Body: BattleConfig }>("/api/accounts/:id/battle-config", async (req) => {
  const cfg = req.body ?? ({} as BattleConfig);
  const updated = battleConfigs.set(req.params.id, cfg);
  // Cập nhật ngay tới live connection nếu đang online
  try {
    const conn = connections.get(req.params.id);
    if (conn && !conn.isOffline) {
      await conn.dispatch("set_battle_config", {
        playerSkillId: String(updated.playerAction?.skillId ?? 10000),
        petSkillId: String(updated.petAction?.skillId ?? 10000),
        autoFight: updated.autoFight ? "1" : "0",
        playerTarget: updated.playerAction?.target ?? "F1",
        petTarget: updated.petAction?.target ?? "F1",
        turnsJson: updated.turns ? JSON.stringify(updated.turns) : "",
        strategyMode: updated.strategyMode ?? (updated.turns && updated.turns.length > 0 ? "turns" : "default"),
        autoEscape: updated.autoEscape ? "1" : "0",
      });
    }
  } catch {
    // Không online thì bỏ qua dispatch
  }
  return updated;
});

// Cấu hình chế độ truy kích quái theo tài khoản
app.get<{ Params: { id: string } }>("/api/accounts/:id/chase-config", async (req) => {
  return chaseConfigs.get(req.params.id);
});
app.put<{ Params: { id: string }; Body: Partial<ChaseConfig> }>("/api/accounts/:id/chase-config", async (req) => {
  const cfg = req.body ?? {};
  const updated = chaseConfigs.set(req.params.id, cfg);
  try {
    const conn = connections.get(req.params.id);
    if (conn && !conn.isOffline) {
      await conn.dispatch("set_chase_config", {
        enabled: updated.enabled ? "1" : "0",
        mapId: String(updated.mapId),
        originX: String(updated.originX),
        originY: String(updated.originY),
        maxRadius: String(updated.maxRadius),
        npcId: String(updated.npcId ?? 0),
        npcName: updated.npcName ?? "",
        autoReturn: updated.autoReturn ? "1" : "0",
      });
    }
  } catch {}
  return updated;
});

// Cấu hình lập đội theo tài khoản (phân lập canonicalKey). Chi tiết: docs/PARTY_KNOWLEDGE.md
app.get<{ Params: { id: string } }>("/api/accounts/:id/party-config", async (req) => connections.partyConfigs.get(req.params.id));
app.put<{ Params: { id: string }; Body: Partial<PartyConfig> }>("/api/accounts/:id/party-config", async (req) => {
  const updated = connections.partyConfigs.set(req.params.id, req.body ?? {});
  connections.party.refresh(req.params.id);
  return updated;
});
app.get<{ Params: { id: string } }>("/api/accounts/:id/party-plan", async (req) => connections.party.planFor(req.params.id) ?? null);

// Cấu hình phó bản đội theo tài khoản (phân lập canonicalKey). Chi tiết: docs/DUNGEON_TEAM_KNOWLEDGE.md
app.get<{ Params: { id: string } }>("/api/accounts/:id/dungeon-team-config", async (req) => connections.dungeonTeamConfigs.get(req.params.id));
app.put<{ Params: { id: string }; Body: Partial<DungeonTeamConfig> }>("/api/accounts/:id/dungeon-team-config", async (req) => {
  // Chủ phòng bật/tắt bằng nút Tạo/Huỷ (không qua PUT) — bỏ `enabled` để bản UI cũ không vô tình dừng phiên đang chạy.
  const body = { ...(req.body ?? {}) };
  const role = body.role ?? connections.dungeonTeamConfigs.get(req.params.id).role;
  if (role === "leader") delete body.enabled;
  const updated = connections.dungeonTeamConfigs.set(req.params.id, body);
  connections.dungeonTeam.refresh(req.params.id);
  return updated;
});

// Chủ phòng phó bản đội: 3 nút Tạo (warp cổng thành → tạo phòng) / Bắt đầu / Huỷ
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-team/create", async (req, reply) => {
  const r = connections.dungeonTeam.create(req.params.id);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-team/start", async (req, reply) => {
  const r = connections.dungeonTeam.startRoom(req.params.id);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-team/exit", async (req, reply) => {
  const r = await connections.dungeonTeam.exitDungeon(req.params.id);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-team/cancel", async (req) => connections.dungeonTeam.cancel(req.params.id));

// Cấu hình & điều phối phó bản đơn (phân lập canonicalKey). Chi tiết: docs/DUNGEON_SOLO_KNOWLEDGE.md
app.get<{ Params: { id: string } }>("/api/accounts/:id/dungeon-solo-config", async (req) => connections.dungeonSoloConfigs.get(req.params.id));
app.put<{ Params: { id: string }; Body: Partial<DungeonSoloConfig> }>("/api/accounts/:id/dungeon-solo-config", async (req) => {
  return connections.dungeonSoloConfigs.set(req.params.id, req.body ?? {});
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-solo/start", async (req, reply) => {
  const r = connections.dungeonSolo.startSolo(req.params.id);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-solo/stop", async (req) => connections.dungeonSolo.stopSolo(req.params.id));
app.post<{ Params: { id: string } }>("/api/accounts/:id/dungeon-solo/exit", async (req, reply) => {
  const r = await connections.dungeonSolo.exitDungeon(req.params.id);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});
app.post<{ Params: { id: string }; Body: { dungeonId?: number } }>("/api/accounts/:id/dungeon-solo/buy", async (req, reply) => {
  const r = await connections.dungeonSolo.buySolo(req.params.id, req.body?.dungeonId);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});

// Cấu hình & điều phối săn Boss Thế Giới (phân lập canonicalKey).
app.get<{ Params: { id: string } }>("/api/accounts/:id/world-boss-config", async (req) => connections.worldBossConfigs.get(req.params.id));
app.put<{ Params: { id: string }; Body: Partial<WorldBossConfig> }>("/api/accounts/:id/world-boss-config", async (req) => {
  return connections.worldBossConfigs.set(req.params.id, req.body ?? {});
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/world-boss/start", async (req, reply) => {
  const r = connections.worldBoss.startBoss(req.params.id);
  return r.ok ? r : reply.code(409).send({ error: r.message });
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/world-boss/stop", async (req) => connections.worldBoss.stopBoss(req.params.id));

// Daily Checklist (Nhiệm vụ ngày, reset 00:00 TW - UTC+8, phân lập canonicalKey).
app.get<{ Params: { id: string } }>("/api/accounts/:id/daily-checklist", async (req) => connections.dailyChecklist.get(req.params.id));
app.post<{ Params: { id: string }; Body: { key: string } }>("/api/accounts/:id/daily-checklist/toggle", async (req, reply) => {
  if (!req.body?.key) return reply.code(400).send({ error: "Thiếu key mục checklist" });
  const updated = connections.dailyChecklist.toggle(req.params.id, req.body.key);
  connections.pushCharacter(req.params.id);
  return updated;
});
app.post<{ Params: { id: string }; Body: { key: string; count?: number } }>("/api/accounts/:id/daily-checklist/progress", async (req, reply) => {
  if (!req.body?.key) return reply.code(400).send({ error: "Thiếu key mục checklist" });
  const updated = connections.dailyChecklist.recordProgress(req.params.id, req.body.key, req.body.count ?? 1);
  connections.pushCharacter(req.params.id);
  return updated;
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/friend-gift", async (req) => {
  return connections.dispatch(req.params.id, "friend_gift_all");
});

// Escort & Pet Inn (Vận tiêu & Nhà trọ, phân lập canonicalKey)
app.get<{ Params: { id: string } }>("/api/accounts/:id/escort-config", async (req) => connections.escortConfigs.get(req.params.id));
app.put<{ Params: { id: string }; Body: Partial<EscortConfig> }>("/api/accounts/:id/escort-config", async (req) => {
  return connections.escortConfigs.set(req.params.id, req.body ?? {});
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/escort/run", async (req, reply) => {
  const r = await connections.escort.triggerFor(req.params.id);
  return r.ok ? r : reply.code(400).send({ error: r.message });
});
app.post<{ Params: { id: string } }>("/api/accounts/:id/open-inn", async (req, reply) => {
  const r = await connections.escort.openInn(req.params.id);
  return r.ok ? r : reply.code(400).send({ error: r.message });
});

// Servers (danh sách cho dropdown)
app.get("/api/servers", async () => servers.list());
app.put<{ Body: { servers: string[] } }>("/api/servers", async (req) => {
  if (!Array.isArray(req.body?.servers)) throw new HttpError(400, "servers phải là mảng");
  return servers.set(req.body.servers);
});

// Live actions (registry để UI tự dựng form)
app.get("/api/actions", async () => listLiveActions());

// Connections (stateful session)
app.get("/api/connections", async () => connections.list());
app.post<{ Params: { accountId: string }; Body: LoginBody }>("/api/connections/:accountId/login", async (req) => connections.login(req.params.accountId, req.body ?? {}));
app.post<{ Params: { accountId: string } }>("/api/connections/:accountId/logout", async (req) => connections.logout(req.params.accountId));
app.post("/api/connections/logout-all", async () => connections.logoutAll());
app.post<{ Params: { accountId: string }; Body: DispatchBody }>("/api/connections/:accountId/dispatch", async (req) => {
  if (!req.body?.action) throw new HttpError(400, "Thiếu action");
  return connections.dispatch(req.params.accountId, req.body.action, req.body.params);
});
app.post<{ Params: { accountId: string }; Body: RunScriptBody }>("/api/connections/:accountId/script/run", async (req) => {
  if (!req.body?.scriptId) throw new HttpError(400, "Thiếu scriptId");
  return connections.runScript(req.params.accountId, req.body.scriptId, req.body.vars);
});
app.post<{ Params: { accountId: string }; Body: RunQueueBody }>("/api/connections/:accountId/script/run-queue", async (req) => {
  if (!Array.isArray(req.body?.scriptIds) || !req.body.scriptIds.length) throw new HttpError(400, "Thiếu scriptIds");
  return connections.runQueue(req.params.accountId, req.body.scriptIds, req.body.vars);
});
app.post<{ Params: { accountId: string; action: ScriptControl } }>("/api/connections/:accountId/script/:action", async (req) =>
  connections.scriptControl(req.params.accountId, req.params.action));
app.get<{ Params: { accountId: string } }>("/api/connections/:accountId/character", async (req) => {
  const ch = connections.get(req.params.accountId).character();
  if (!ch) throw new HttpError(404, "Chưa có dữ liệu nhân vật");
  return ch;
});
app.get<{ Params: { accountId: string }; Querystring: { after?: string } }>("/api/connections/:accountId/logs", async (req) => {
  const after = Number(req.query.after ?? 0);
  return connections.get(req.params.accountId).logs.filter((l) => l.seq > after);
});

// Settings
app.get("/api/settings", async () => settings.get());
app.put<{ Body: Partial<Settings> }>("/api/settings", async (req) => settings.update(req.body ?? {}));

/* ---------- Static (production) ---------- */
const dist = join(ROOT, "apps/web/dist");
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api") ? reply.status(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
}

const shutdown = () => {
  connections.logoutAll().finally(() => app.close().finally(() => process.exit(0)));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connections.party.start();
connections.dungeonTeam.start();
connections.dungeonSolo.start();
connections.worldBoss.start();
connections.escort.start();
await app.listen({ port: PORT, host: HOST });
console.log(`TS-Bot-Web engine: http://${HOST}:${PORT}  (dev UI: http://localhost:5173)`);
