import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { ITEM_LIST_KEYS } from "@tsbot/protocol";
import type { Account, AutoHealConfig, AutoHealTargetConfig, BattleConfig, BuySettings, ChaseConfig, DungeonSoloConfig, DungeonTeamConfig, ItemListKey, PartyConfig, ItemLists, ScriptFile, ScriptMeta, Settings } from "@tsbot/protocol";
import { DATA_DIR, SCRIPTS_DIR } from "./paths";

/* ---------- Script store: file .ini nguyên bản, 2 chiều với tool cũ ---------- */
export class ScriptStore {
  constructor(private root = SCRIPTS_DIR) {
    mkdirSync(root, { recursive: true });
  }

  private pathOf(id: string): string {
    const p = resolve(this.root, id + ".ini");
    if (!p.startsWith(resolve(this.root) + sep)) throw new Error("Đường dẫn script không hợp lệ");
    return p;
  }

  private meta(id: string, file: string): ScriptMeta {
    const st = statSync(file);
    const slash = id.lastIndexOf("/");
    return { id, name: id.slice(slash + 1), group: slash < 0 ? "" : id.slice(0, slash), size: st.size, mtime: st.mtimeMs };
  }

  list(): ScriptMeta[] {
    const out: ScriptMeta[] = [];
    const walk = (rel: string) => {
      for (const e of readdirSync(join(this.root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(r);
        else if (e.name.toLowerCase().endsWith(".ini")) out.push(this.meta(r.slice(0, -4), join(this.root, r)));
      }
    };
    walk("");
    return out.sort((a, b) => a.id.localeCompare(b.id, "vi", { numeric: true }));
  }

  get(id: string): ScriptFile | undefined {
    const p = this.pathOf(id);
    if (!existsSync(p)) return undefined;
    return { ...this.meta(id, p), content: readFileSync(p, "utf8") };
  }

  put(id: string, content: string): ScriptMeta {
    const p = this.pathOf(id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
    return this.meta(id, p);
  }

  delete(id: string): boolean {
    const p = this.pathOf(id);
    if (!existsSync(p)) return false;
    rmSync(p);
    return true;
  }
}

/** Tiền tố id của script tự tạo trong danh mục chạy được (tránh trùng với script gốc). */
export const CUSTOM_PREFIX = "custom:";

/** runnable_scripts_registry.json: các script tự tạo đã được duyệt vào danh mục chính thức. Script gốc luôn chạy được, không cần ghi ở đây. */
export class RunnableRegistry {
  private f = new JsonFile<{ custom: string[] }>("runnable_scripts_registry.json", { custom: [] });
  list(): string[] {
    const v = this.f.read().custom;
    return Array.isArray(v) ? v : [];
  }
  has(id: string): boolean {
    return this.list().includes(id);
  }
  add(id: string) {
    if (!this.has(id)) this.f.write({ custom: [...this.list(), id] });
  }
  remove(id: string): boolean {
    if (!this.has(id)) return false;
    this.f.write({ custom: this.list().filter((x) => x !== id) });
    return true;
  }
  rename(from: string, to: string) {
    if (this.has(from)) this.f.write({ custom: this.list().map((x) => (x === from ? to : x)) });
  }
}

/* ---------- JSON store đơn giản ---------- */
class JsonFile<T> {
  private file: string;
  constructor(name: string, private fallback: T) {
    mkdirSync(DATA_DIR, { recursive: true });
    this.file = join(DATA_DIR, name);
  }
  read(): T {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as T;
    } catch {
      return structuredClone(this.fallback);
    }
  }
  write(v: T) {
    writeFileSync(this.file, JSON.stringify(v, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

export const DEFAULT_SETTINGS: Settings = {
  maxSessions: 15,
  defaultTransport: "mock",
  speed: 1,
  logLevel: "info",
  commandTimeoutMs: 60_000,
  heartbeatMs: 15_000,
  autoReconnect: true,
  maxReconnect: 5,
  socketCodec: "raw-tcp",
  autoCheckin: true,
};

export class SettingsStore {
  private f = new JsonFile<Settings>("settings.json", DEFAULT_SETTINGS);
  get(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.f.read() };
  }
  update(patch: Partial<Settings>): Settings {
    const cur = this.get();
    const next: Settings = {
      maxSessions: clamp(patch.maxSessions ?? cur.maxSessions, 1, 15),
      defaultTransport: patch.defaultTransport ?? cur.defaultTransport,
      speed: clamp(patch.speed ?? cur.speed, 0.1, 100),
      logLevel: patch.logLevel ?? cur.logLevel,
      commandTimeoutMs: clamp(patch.commandTimeoutMs ?? cur.commandTimeoutMs, 1000, 3_600_000),
      heartbeatMs: clamp(patch.heartbeatMs ?? cur.heartbeatMs, 1000, 300_000),
      autoReconnect: patch.autoReconnect ?? cur.autoReconnect,
      maxReconnect: clamp(patch.maxReconnect ?? cur.maxReconnect, 0, 100),
      socketCodec: patch.socketCodec ?? cur.socketCodec,
      autoCheckin: patch.autoCheckin ?? cur.autoCheckin,
    };
    this.f.write(next);
    return next;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(n) || lo));

export class AccountStore {
  private f = new JsonFile<Account[]>("accounts.json", []);
  /** Bản đầy đủ (có password) — chỉ dùng nội bộ để đưa cho transport. */
  get(id: string): Account | undefined {
    const list = this.f.read();
    const exact = list.find((a) => a.id === id);
    if (exact) return exact;
    const lower = id.toLowerCase();
    const byLower = list.find((a) => a.id.toLowerCase() === lower);
    if (byLower) return byLower;
    const at = id.indexOf("@");
    const cKey = (at > 0 ? id.slice(0, at) : id).toLowerCase();
    return list.find((a) => {
      const aAt = a.id.indexOf("@");
      const aKey = (aAt > 0 ? a.id.slice(0, aAt) : a.id).toLowerCase();
      return aKey === cKey || a.username.toLowerCase() === cKey;
    });
  }
  findByUser(server: string, username: string): Account | undefined {
    return this.f.read().find((a) => a.server === server && a.username === username);
  }
  /** Bản an toàn cho API: không có password. */
  list(): Account[] {
    return this.f.read().map(({ password, ...a }) => ({ ...a, hasPassword: !!password }));
  }
  upsert(a: Account): Account {
    const all = this.f.read();
    const id = a.id || slug(`${a.username}@${a.server}`);
    const i = all.findIndex((x) => x.id === id);
    // Để trống password khi sửa = giữ nguyên mật khẩu cũ.
    const password = a.password ? a.password : i >= 0 ? all[i].password : "";
    const rec: Account = { id, server: a.server, username: a.username, password, note: a.note, defaultScript: a.defaultScript };
    if (i >= 0) all[i] = rec;
    else all.push(rec);
    this.f.write(all);
    const { password: _p, ...safe } = rec;
    return { ...safe, hasPassword: !!password };
  }
  delete(id: string): boolean {
    const all = this.f.read();
    const lower = id.toLowerCase();
    const at = id.indexOf("@");
    const cKey = (at > 0 ? id.slice(0, at) : id).toLowerCase();

    const next = all.filter((a) => {
      if (a.id === id || a.id.toLowerCase() === lower) return false;
      const aAt = a.id.indexOf("@");
      const aKey = (aAt > 0 ? a.id.slice(0, aAt) : a.id).toLowerCase();
      if (aKey === cKey || a.username.toLowerCase() === cKey || a.username.toLowerCase() === lower) return false;
      return true;
    });
    this.f.write(next);
    return next.length !== all.length;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^\w.@-]+/g, "_");

/**
 * Danh sách server. Mỗi dòng: "Tên" hoặc "Tên | host:port" (host:port cần cho transport socket).
 */
export class ServerStore {
  private f = new JsonFile<string[]>("servers.json", []);
  list(): string[] {
    return this.f.read();
  }
  set(lines: string[]): string[] {
    const clean = [...new Set(lines.map((n) => String(n).trim()).filter(Boolean))];
    this.f.write(clean);
    return clean;
  }
  /** Thêm tên server nếu chưa có dòng nào cùng tên. */
  add(name: string) {
    const cur = this.list();
    if (name && !cur.some((l) => parseServerLine(l).name === name)) this.set([...cur, name]);
  }
  /** Server mặc định (cố định ở backend): dòng đầu tiên trong servers.json. */
  defaultName(): string | undefined {
    const first = this.list()[0];
    return first ? parseServerLine(first).name : undefined;
  }
  endpointOf(name: string): { host: string; port: number } | undefined {
    return this.list().map(parseServerLine).find((e) => e.name === name)?.endpoint;
  }
}

export function parseServerLine(line: string): { name: string; endpoint?: { host: string; port: number } } {
  const i = line.lastIndexOf("|");
  if (i < 0) return { name: line.trim() };
  const name = line.slice(0, i).trim();
  const m = /^\s*([^\s:]+):(\d{1,5})\s*$/.exec(line.slice(i + 1));
  return m && +m[2] > 0 && +m[2] < 65536 ? { name, endpoint: { host: m[1], port: +m[2] } } : { name };
}

/** Thời điểm đóng socket gần nhất theo accountId — để cooldown relog còn đúng sau khi restart server. */
export class ClosedStore {
  private f = new JsonFile<Record<string, number>>("last-closed.json", {});
  get(id: string): number | undefined {
    return this.f.read()[id];
  }
  set(id: string, ts: number) {
    this.f.write({ ...this.f.read(), [id]: ts });
  }
}

/** Danh sách vật phẩm tự động theo tài khoản (tự mở, ngoại lệ, hợp, bán, phân giải, đóng góp, vứt bỏ) — để các vòng auto sau này đọc. */
export class ItemListStore {
  private f = new JsonFile<Record<string, Partial<ItemLists>>>("item-lists.json", {});
  private empty = (): ItemLists => ({
    ...(Object.fromEntries(ITEM_LIST_KEYS.map((k) => [k, [] as number[]])) as Record<ItemListKey, number[]>),
    toggles: {
      discard: true,
      autoOpen: true,
      combine: true,
      resolve: false,
      contribute: false,
      sell: false,
      exception: true,
    },
    autoSweepEnabled: false,
    buySettings: {
      buyHpEnabled: true,
      buyHpQty: 999,
      buySpEnabled: true,
      buySpQty: 999,
    },
    autoHeal: {
      enabled: true,
      player: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
      pet: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
      slots: {},
    },
  });

  /**
   * Chuẩn hoá key tài khoản:
   * Nếu là accountId dạng "user_test_01" hoặc "user_test_01@server" -> chuẩn hoá về username "user_test_01".
   * Giúp dữ liệu cấu hình thùng đồ gắn liền với tài khoản một cách độc lập và nhất quán.
   */
  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  get(accountId: string): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    // Ưu tiên theo canonicalKey, fallback key gốc nếu trước đó đã lưu
    const data = all[cKey] ?? all[accountId] ?? {};
    const base = this.empty();
    return {
      ...base,
      ...data,
      autoSweepEnabled: data.autoSweepEnabled !== undefined ? Boolean(data.autoSweepEnabled) : base.autoSweepEnabled,
      toggles: {
        ...base.toggles,
        ...(data.toggles ?? {}),
      },
      buySettings: {
        buyHpEnabled: data.buySettings?.buyHpEnabled !== undefined ? Boolean(data.buySettings.buyHpEnabled) : (base.buySettings?.buyHpEnabled ?? true),
        buyHpQty: Number(data.buySettings?.buyHpQty ?? base.buySettings?.buyHpQty ?? 999),
        buySpEnabled: data.buySettings?.buySpEnabled !== undefined ? Boolean(data.buySettings.buySpEnabled) : (base.buySettings?.buySpEnabled ?? true),
        buySpQty: Number(data.buySettings?.buySpQty ?? base.buySettings?.buySpQty ?? 999),
      },
      autoHeal: {
        enabled: data.autoHeal?.enabled !== undefined ? Boolean(data.autoHeal.enabled) : (base.autoHeal?.enabled ?? true),
        player: {
          autoHp: Boolean(data.autoHeal?.player?.autoHp ?? base.autoHeal?.player.autoHp),
          hpPct: Math.max(1, Math.min(99, Number(data.autoHeal?.player?.hpPct ?? base.autoHeal?.player.hpPct ?? 50))),
          autoSp: Boolean(data.autoHeal?.player?.autoSp ?? base.autoHeal?.player.autoSp),
          spPct: Math.max(1, Math.min(99, Number(data.autoHeal?.player?.spPct ?? base.autoHeal?.player.spPct ?? 50))),
        },
        pet: {
          autoHp: Boolean(data.autoHeal?.pet?.autoHp ?? base.autoHeal?.pet.autoHp),
          hpPct: Math.max(1, Math.min(99, Number(data.autoHeal?.pet?.hpPct ?? base.autoHeal?.pet.hpPct ?? 50))),
          autoSp: Boolean(data.autoHeal?.pet?.autoSp ?? base.autoHeal?.pet.autoSp),
          spPct: Math.max(1, Math.min(99, Number(data.autoHeal?.pet?.spPct ?? base.autoHeal?.pet.spPct ?? 50))),
        },
        slots: data.autoHeal?.slots ?? base.autoHeal?.slots ?? {},
      },
    };
  }

  /** Thêm (hoặc xoá) một itemId khỏi một danh sách. Trả về danh sách mới của tài khoản. */
  update(accountId: string, key: ItemListKey, itemId: number, on: boolean): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const cur = this.get(accountId);
    const set = new Set(cur[key]);
    if (on) set.add(itemId); else set.delete(itemId);
    cur[key] = [...set].sort((a, b) => a - b);
    this.f.write({ ...all, [cKey]: cur });
    return cur;
  }

  /** Ghi đè toàn bộ danh sách itemId cho một key (dùng cho tính năng paste/clone danh sách). */
  setList(accountId: string, key: ItemListKey, itemIds: number[]): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const cur = this.get(accountId);
    const validIds = [...new Set(itemIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
    cur[key] = validIds;
    this.f.write({ ...all, [cKey]: cur });
    return cur;
  }

  /** Bật/tắt quét tự động cho từng action (discard, autoOpen, combine...). */
  setToggle(accountId: string, key: ItemListKey, enabled: boolean): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const cur = this.get(accountId);
    cur.toggles = {
      ...(cur.toggles ?? {}),
      [key]: Boolean(enabled),
    };
    this.f.write({ ...all, [cKey]: cur });
    return cur;
  }

  /** Bật/tắt tự động quét thùng đồ cá nhân định kỳ (mỗi 1 phút). */
  setAutoSweepEnabled(accountId: string, enabled: boolean): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const cur = this.get(accountId);
    cur.autoSweepEnabled = Boolean(enabled);
    this.f.write({ ...all, [cKey]: cur });
    return cur;
  }

  /** Cập nhật thiết lập mua HP/SP (Bật/tắt, số lượng) theo tài khoản. */
  setBuySettings(accountId: string, settings: Partial<BuySettings>): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const cur = this.get(accountId);
    cur.buySettings = {
      buyHpEnabled: settings.buyHpEnabled !== undefined ? Boolean(settings.buyHpEnabled) : (cur.buySettings?.buyHpEnabled ?? true),
      buyHpQty: Math.max(1, Math.min(9999, Number(settings.buyHpQty ?? cur.buySettings?.buyHpQty ?? 999) || 999)),
      buySpEnabled: settings.buySpEnabled !== undefined ? Boolean(settings.buySpEnabled) : (cur.buySettings?.buySpEnabled ?? true),
      buySpQty: Math.max(1, Math.min(9999, Number(settings.buySpQty ?? cur.buySettings?.buySpQty ?? 999) || 999)),
    };
    this.f.write({ ...all, [cKey]: cur });
    return cur;
  }

  /** Cập nhật cấu hình tự động sử dụng HP/SP ngoài trận đấu theo tài khoản. */
  setAutoHeal(accountId: string, cfg: Partial<AutoHealConfig>): ItemLists {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const cur = this.get(accountId);
    const prev = cur.autoHeal ?? {
      enabled: true,
      player: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
      pet: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
      slots: {},
    };

    cur.autoHeal = {
      enabled: cfg.enabled !== undefined ? Boolean(cfg.enabled) : prev.enabled,
      player: {
        autoHp: cfg.player?.autoHp !== undefined ? Boolean(cfg.player.autoHp) : prev.player.autoHp,
        hpPct: Math.max(1, Math.min(99, Number(cfg.player?.hpPct ?? prev.player.hpPct) || 50)),
        autoSp: cfg.player?.autoSp !== undefined ? Boolean(cfg.player.autoSp) : prev.player.autoSp,
        spPct: Math.max(1, Math.min(99, Number(cfg.player?.spPct ?? prev.player.spPct) || 50)),
      },
      pet: {
        autoHp: cfg.pet?.autoHp !== undefined ? Boolean(cfg.pet.autoHp) : prev.pet.autoHp,
        hpPct: Math.max(1, Math.min(99, Number(cfg.pet?.hpPct ?? prev.pet.hpPct) || 50)),
        autoSp: cfg.pet?.autoSp !== undefined ? Boolean(cfg.pet.autoSp) : prev.pet.autoSp,
        spPct: Math.max(1, Math.min(99, Number(cfg.pet?.spPct ?? prev.pet.spPct) || 50)),
      },
      slots: cfg.slots !== undefined ? cfg.slots : prev.slots,
    };
    this.f.write({ ...all, [cKey]: cur });
    return cur;
  }
}

/** Cấu hình trận đấu theo tài khoản (mặc định + 21 turns). Phân lập 100% bằng canonicalKey. */
export class BattleConfigStore {
  private f = new JsonFile<Record<string, BattleConfig>>("battle-configs.json", {});

  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  get(accountId: string): BattleConfig | undefined {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    return all[cKey] ?? all[accountId];
  }

  set(accountId: string, config: BattleConfig): BattleConfig {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const updated = { ...config };
    this.f.write({ ...all, [cKey]: updated });
    return updated;
  }
}

/** Cấu hình chế độ truy kích quái theo tài khoản. Phân lập 100% bằng canonicalKey. */
export class ChaseConfigStore {
  private f = new JsonFile<Record<string, ChaseConfig>>("chase-configs.json", {});

  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  get(accountId: string): ChaseConfig {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const data = all[cKey] ?? all[accountId];
    return data ?? {
      enabled: false,
      mapId: 0,
      originX: 0,
      originY: 0,
      maxRadius: 150,
      autoReturn: true,
    };
  }

  set(accountId: string, config: Partial<ChaseConfig>): ChaseConfig {
    const all = this.f.read();
    const cKey = this.canonicalKey(accountId);
    const prev = this.get(accountId);
    const updated: ChaseConfig = {
      enabled: config.enabled !== undefined ? Boolean(config.enabled) : prev.enabled,
      mapId: config.mapId !== undefined ? Number(config.mapId) : prev.mapId,
      originX: config.originX !== undefined ? Number(config.originX) : prev.originX,
      originY: config.originY !== undefined ? Number(config.originY) : prev.originY,
      maxRadius: config.maxRadius !== undefined ? Math.max(50, Math.min(500, Number(config.maxRadius))) : prev.maxRadius,
      npcId: config.npcId !== undefined ? (config.npcId ? Number(config.npcId) : undefined) : prev.npcId,
      npcName: config.npcName !== undefined ? config.npcName : prev.npcName,
      autoReturn: config.autoReturn !== undefined ? Boolean(config.autoReturn) : prev.autoReturn,
    };
    this.f.write({ ...all, [cKey]: updated });
    return updated;
  }
}

/**
 * Cấu hình lập đội theo tài khoản (Rule 2 — phân lập 100% bằng canonicalKey; chủ PT chỉ thấy tên thành viên của chính mình).
 * Ràng buộc: tối đa 4 thành viên (chủ + 4 = 5 người), tên không trùng (không phân biệt hoa/thường), tối đa 1 Quân sư.
 */
export class PartyConfigStore {
  private f = new JsonFile<Record<string, PartyConfig>>("party-configs.json", {});

  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  static empty(): PartyConfig {
    return { enabled: false, role: "leader", leaderName: "", members: [], escapeIfNotFullParty: false };
  }

  get(accountId: string): PartyConfig {
    const all = this.f.read();
    return PartyConfigStore.sanitize(all[this.canonicalKey(accountId)] ?? all[accountId] ?? PartyConfigStore.empty());
  }

  /** Mọi cấu hình đang bật (key = canonicalKey) — PartyService duyệt mỗi nhịp. */
  all(): Record<string, PartyConfig> {
    const out: Record<string, PartyConfig> = {};
    for (const [k, v] of Object.entries(this.f.read())) out[k] = PartyConfigStore.sanitize(v);
    return out;
  }

  set(accountId: string, patch: Partial<PartyConfig>): PartyConfig {
    const prev = this.get(accountId);
    const next = PartyConfigStore.sanitize({ ...prev, ...patch });
    this.f.write({ ...this.f.read(), [this.canonicalKey(accountId)]: next });
    return next;
  }

  static sanitize(c: Partial<PartyConfig>): PartyConfig {
    const seen = new Set<string>();
    const members: PartyConfig["members"] = [];
    let advisorUsed = false;
    for (const m of Array.isArray(c.members) ? c.members : []) {
      const name = String(m?.name ?? "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key) || members.length >= 4) continue;
      seen.add(key);
      const advisor: boolean = !!m?.advisor && !advisorUsed;
      if (advisor) advisorUsed = true;
      members.push({ name, advisor });
    }
    return {
      enabled: !!c.enabled,
      role: c.role === "member" ? "member" : "leader",
      leaderName: String(c.leaderName ?? "").trim(),
      members,
      escapeIfNotFullParty: !!c.escapeIfNotFullParty,
    };
  }
}

/**
 * Cấu hình PHÓ BẢN ĐỘI theo tài khoản (data/dungeon-team-configs.json), phân lập bằng canonicalKey (AGENTS.md §2).
 * Ràng buộc: tối đa 4 thành viên, tên không trùng, dungeonId 1..255.
 */
export class DungeonTeamConfigStore {
  private f = new JsonFile<Record<string, DungeonTeamConfig>>("dungeon-team-configs.json", {});

  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  static empty(): DungeonTeamConfig {
    return { enabled: false, role: "leader", leaderName: "", members: [], dungeonId: 1, usePassword: false, joinPassword: "", leaveParty: true };
  }

  get(accountId: string): DungeonTeamConfig {
    const all = this.f.read();
    return DungeonTeamConfigStore.sanitize(all[this.canonicalKey(accountId)] ?? DungeonTeamConfigStore.empty());
  }

  all(): Record<string, DungeonTeamConfig> {
    const out: Record<string, DungeonTeamConfig> = {};
    for (const [k, v] of Object.entries(this.f.read())) out[k] = DungeonTeamConfigStore.sanitize(v);
    return out;
  }

  set(accountId: string, patch: Partial<DungeonTeamConfig>): DungeonTeamConfig {
    const next = DungeonTeamConfigStore.sanitize({ ...this.get(accountId), ...patch });
    this.f.write({ ...this.f.read(), [this.canonicalKey(accountId)]: next });
    return next;
  }

  static sanitize(c: Partial<DungeonTeamConfig>): DungeonTeamConfig {
    const d = DungeonTeamConfigStore.empty();
    const int = (v: unknown, lo: number, hi: number, def: number) => {
      const n = Math.trunc(Number(v));
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
    };
    const seen = new Set<string>();
    const members: string[] = [];
    for (const m of Array.isArray(c.members) ? c.members : []) {
      const name = String(m ?? "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key) || members.length >= 4) continue;
      seen.add(key);
      members.push(name);
    }
    return {
      enabled: !!c.enabled,
      role: c.role === "member" ? "member" : "leader",
      leaderName: String(c.leaderName ?? "").trim(),
      members,
      dungeonId: int(c.dungeonId, 1, 255, d.dungeonId),
      usePassword: !!c.usePassword,
      joinPassword: String(c.joinPassword ?? "").trim().slice(0, 16),
      leaveParty: c.leaveParty === undefined ? d.leaveParty : !!c.leaveParty,
    };
  }
}

/**
 * Cấu hình PHÓ BẢN ĐƠN theo tài khoản (data/dungeon-solo-configs.json), phân lập bằng canonicalKey (AGENTS.md §2).
 */
export class DungeonSoloConfigStore {
  private f = new JsonFile<Record<string, DungeonSoloConfig>>("dungeon-solo-configs.json", {});

  canonicalKey(accountId: string): string {
    const raw = (accountId ?? "").trim();
    if (!raw) return "default";
    const at = raw.indexOf("@");
    return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
  }

  static empty(): DungeonSoloConfig {
    return { enabled: false, type: "all", bracket: 0, leaveParty: true };
  }

  get(accountId: string): DungeonSoloConfig {
    const all = this.f.read();
    return DungeonSoloConfigStore.sanitize(all[this.canonicalKey(accountId)] ?? DungeonSoloConfigStore.empty());
  }

  all(): Record<string, DungeonSoloConfig> {
    const out: Record<string, DungeonSoloConfig> = {};
    for (const [k, v] of Object.entries(this.f.read())) out[k] = DungeonSoloConfigStore.sanitize(v);
    return out;
  }

  set(accountId: string, patch: Partial<DungeonSoloConfig>): DungeonSoloConfig {
    const next = DungeonSoloConfigStore.sanitize({ ...this.get(accountId), ...patch });
    this.f.write({ ...this.f.read(), [this.canonicalKey(accountId)]: next });
    return next;
  }

  static sanitize(c: Partial<DungeonSoloConfig>): DungeonSoloConfig {
    const d = DungeonSoloConfigStore.empty();
    const validTypes = new Set(["khieu_chien", "san_kho_bau", "tim_dau_dau", "all"]);
    const type = validTypes.has(c.type as string) ? (c.type as DungeonSoloConfig["type"]) : d.type;
    const bracketNum = Number(c.bracket);
    const bracket = Number.isInteger(bracketNum) && bracketNum >= 0 && bracketNum <= 4 ? bracketNum : 0;
    return {
      enabled: !!c.enabled,
      type,
      bracket,
      leaveParty: c.leaveParty === undefined ? d.leaveParty : !!c.leaveParty,
    };
  }
}

