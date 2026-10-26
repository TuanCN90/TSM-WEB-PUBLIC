import type { Account, ActionParams, ActionResult, BattleConfig, ConnectionInfo, Diagnostic, HealthInfo, ItemListKey, ItemLists, LiveActionDef, LogEntry, LoginBody, ScriptFile, ScriptMeta, SessionLoginResult, Settings } from "@tsbot/protocol";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}
const enc = (id: string) => id.split("/").map(encodeURIComponent).join("/");

export type CustomScriptMeta = ScriptMeta & { official: boolean };

export const api = {
  health: () => req<HealthInfo>("GET", "/api/health"),
  scripts: () => req<ScriptMeta[]>("GET", "/api/scripts"),
  script: (id: string) => req<ScriptFile>("GET", `/api/scripts/${enc(id)}`),
  saveScript: (id: string, content: string) => req<ScriptMeta>("PUT", `/api/scripts/${enc(id)}`, { content }),
  deleteScript: (id: string) => req("DELETE", `/api/scripts/${enc(id)}`),
  customScripts: () => req<CustomScriptMeta[]>("GET", "/api/custom-scripts"),
  customScript: (id: string) => req<ScriptFile & { official: boolean }>("GET", `/api/custom-scripts/${enc(id)}`),
  saveCustomScript: (id: string, content: string, renameFrom?: string) => req<ScriptMeta>("PUT", `/api/custom-scripts/${enc(id)}`, { content, renameFrom }),
  deleteCustomScript: (id: string) => req("DELETE", `/api/custom-scripts/${enc(id)}`),
  runnableScripts: () => req<ScriptMeta[]>("GET", "/api/runnable-scripts"),
  approveScript: (id: string) => req("POST", "/api/runnable-scripts", { id }),
  revokeScript: (id: string) => req("DELETE", `/api/runnable-scripts/${enc(id)}`),
  validate: (content: string) => req<{ diagnostics: Diagnostic[] }>("POST", "/api/validate", { content }),
  accounts: () => req<Account[]>("GET", "/api/accounts"),
  saveAccount: (a: Account) => req<Account>("POST", "/api/accounts", a),
  deleteAccount: (id: string) => req("DELETE", `/api/accounts/${encodeURIComponent(id)}`),
  servers: () => req<string[]>("GET", "/api/servers"),
  saveServers: (servers: string[]) => req<string[]>("PUT", "/api/servers", { servers }),
  actions: () => req<LiveActionDef[]>("GET", "/api/actions"),
  connections: () => req<ConnectionInfo[]>("GET", "/api/connections"),
  login: (accountId: string, b: LoginBody) => req<ConnectionInfo>("POST", `/api/connections/${encodeURIComponent(accountId)}/login`, b),
  sessionLogin: (username: string, password: string) => req<SessionLoginResult>("POST", "/api/session/login", { username, password }),
  logout: (accountId: string) => req<ConnectionInfo>("POST", `/api/connections/${encodeURIComponent(accountId)}/logout`),
  logoutAll: () => req<{ count: number }>("POST", "/api/connections/logout-all"),
  dispatch: (accountId: string, action: string, params?: ActionParams) =>
    req<ActionResult>("POST", `/api/connections/${encodeURIComponent(accountId)}/dispatch`, { action, params }),
  runScript: (accountId: string, scriptId: string, vars?: Record<string, string>) =>
    req<ConnectionInfo>("POST", `/api/connections/${encodeURIComponent(accountId)}/script/run`, { scriptId, vars }),
  runQueue: (accountId: string, scriptIds: string[], vars?: Record<string, string>) =>
    req<ConnectionInfo>("POST", `/api/connections/${encodeURIComponent(accountId)}/script/run-queue`, { scriptIds, vars }),
  scriptControl: (accountId: string, action: "pause" | "resume" | "stop") =>
    req<ConnectionInfo>("POST", `/api/connections/${encodeURIComponent(accountId)}/script/${action}`),
  logs: (accountId: string, after = 0) => req<LogEntry[]>("GET", `/api/connections/${encodeURIComponent(accountId)}/logs?after=${after}`),
  itemLists: (accountId: string) => req<ItemLists>("GET", `/api/accounts/${encodeURIComponent(accountId)}/item-lists`),
  setItemList: (accountId: string, list: ItemListKey, itemId: number, on = true) =>
    req<ItemLists>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/item-lists`, { list, itemId, on }),
  batchSetItemList: (accountId: string, list: ItemListKey, itemIds: number[]) =>
    req<ItemLists>("POST", `/api/accounts/${encodeURIComponent(accountId)}/item-lists/batch`, { list, itemIds }),
  setItemListToggle: (accountId: string, key: ItemListKey, enabled: boolean) =>
    req<ItemLists>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/item-lists/toggle`, { key, enabled }),
  setAutoSweep: (accountId: string, enabled: boolean) =>
    req<ItemLists>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/item-lists/auto-sweep`, { enabled }),
  setBuySettings: (accountId: string, settings: Partial<import("@tsbot/protocol").BuySettings>) =>
    req<ItemLists>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/item-lists/buy-settings`, settings),
  setAutoHeal: (accountId: string, autoHeal: Partial<import("@tsbot/protocol").AutoHealConfig>) =>
    req<ItemLists>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/item-lists/auto-heal`, autoHeal),
  battleConfig: (accountId: string) => req<BattleConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/battle-config`),
  saveBattleConfig: (accountId: string, config: BattleConfig) =>
    req<BattleConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/battle-config`, config),
  partyConfig: (accountId: string) => req<import("@tsbot/protocol").PartyConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/party-config`),
  savePartyConfig: (accountId: string, config: Partial<import("@tsbot/protocol").PartyConfig>) =>
    req<import("@tsbot/protocol").PartyConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/party-config`, config),
  dungeonTeamConfig: (accountId: string) => req<import("@tsbot/protocol").DungeonTeamConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-team-config`),
  saveDungeonTeamConfig: (accountId: string, config: Partial<import("@tsbot/protocol").DungeonTeamConfig>) =>
    req<import("@tsbot/protocol").DungeonTeamConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-team-config`, config),
  dungeonTeamAction: (accountId: string, action: "create" | "start" | "cancel" | "exit") =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-team/${action}`),
  dungeonSoloConfig: (accountId: string) => req<import("@tsbot/protocol").DungeonSoloConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-solo-config`),
  saveDungeonSoloConfig: (accountId: string, config: Partial<import("@tsbot/protocol").DungeonSoloConfig>) =>
    req<import("@tsbot/protocol").DungeonSoloConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-solo-config`, config),
  dungeonSoloAction: (accountId: string, action: "start" | "stop" | "exit") =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-solo/${action}`),
  dungeonSoloBuy: (accountId: string, dungeonId?: number) =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/dungeon-solo/buy`, { dungeonId }),
  worldBossConfig: (accountId: string) => req<import("@tsbot/protocol").WorldBossConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/world-boss-config`),
  saveWorldBossConfig: (accountId: string, config: Partial<import("@tsbot/protocol").WorldBossConfig>) =>
    req<import("@tsbot/protocol").WorldBossConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/world-boss-config`, config),
  worldBossAction: (accountId: string, action: "start" | "stop") =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/world-boss/${action}`),
  dailyChecklist: (accountId: string) => req<import("@tsbot/protocol").DailyChecklistState>("GET", `/api/accounts/${encodeURIComponent(accountId)}/daily-checklist`),
  dailyChecklistToggle: (accountId: string, key: string) =>
    req<import("@tsbot/protocol").DailyChecklistState>("POST", `/api/accounts/${encodeURIComponent(accountId)}/daily-checklist/toggle`, { key }),
  dailyChecklistProgress: (accountId: string, key: string, count?: number) =>
    req<import("@tsbot/protocol").DailyChecklistState>("POST", `/api/accounts/${encodeURIComponent(accountId)}/daily-checklist/progress`, { key, count }),
  friendGift: (accountId: string) =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/friend-gift`),
  escortConfig: (accountId: string) => req<import("@tsbot/protocol").EscortConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/escort-config`),
  saveEscortConfig: (accountId: string, config: Partial<import("@tsbot/protocol").EscortConfig>) =>
    req<import("@tsbot/protocol").EscortConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/escort-config`, config),
  escortRun: (accountId: string) =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/escort/run`),
  escortClaim: (accountId: string) =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/escort/claim`),
  openInn: (accountId: string) =>
    req<{ ok: boolean; message?: string }>("POST", `/api/accounts/${encodeURIComponent(accountId)}/open-inn`),
  chaseConfig: (accountId: string) => req<import("@tsbot/protocol").ChaseConfig>("GET", `/api/accounts/${encodeURIComponent(accountId)}/chase-config`),
  saveChaseConfig: (accountId: string, config: Partial<import("@tsbot/protocol").ChaseConfig>) =>
    req<import("@tsbot/protocol").ChaseConfig>("PUT", `/api/accounts/${encodeURIComponent(accountId)}/chase-config`, config),
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => req<Settings>("PUT", "/api/settings", s),
};
