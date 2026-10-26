/**
 * WorldBossService — điều phối tự động SĂN BOSS THẾ GIỚI (1-7 lượt).
 * Phân lập độc lập 100% giữa các tài khoản theo Rule 2.
 * Hỗ trợ 5 lượt miễn phí hàng ngày + 2 lượt dùng Vé Khiêu Chiến Boss (Item 46629),
 * tự động đổi pet/vũ khí boss, hồi sinh tại Quỷ Môn Quan (12007) và quay lại bãi train.
 */
import type {
  WorldBossConfig,
  WorldBossPhase,
  WorldBossState,
} from "@tsbot/protocol";
import type { GameConnection } from "@tsbot/engine";
import type { DailyChecklistStore, WorldBossConfigStore } from "./store";

const TICK_MS = 2000;
const MAX_FAILS = 3;
const SAFE_HUB_MAP = 12001; // Trác Quận
const BOSS_COORDS = { x: 1910, y: 1190 };
const BOSS_NPC = 45;
const GHOST_MAP = 12007; // Quỷ Môn Quan
const REVIVE_COORDS = { x: 311, y: 428 };
const REVIVE_NPC = 1;
const TICKET_ITEM_ID = 46629; // Vé Khiêu Chiến Boss

const canon = (accountId: string) => {
  const raw = (accountId ?? "").trim();
  if (!raw) return "default";
  const at = raw.indexOf("@");
  return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
};

export interface WorldBossHost {
  entries(): [string, GameConnection][];
  pushCharacter(accountId: string): void;
}

interface Runtime {
  phase: WorldBossPhase;
  phaseAt: number;
  fails: number;
  currentAttempt: number;
  totalAttempts: number;
  ticketsUsed: number;
  message: string;
  originalMap?: number;
  originalX?: number;
  originalY?: number;
  savedPetModel?: number;
  petSwitched?: boolean;
  challengeSentAt?: number;
}

export class WorldBossService {
  private timer?: ReturnType<typeof setInterval>;
  private rt = new Map<string, Runtime>();
  private ticking = false;

  constructor(
    private host: WorldBossHost,
    private store: WorldBossConfigStore,
    private checklistStore?: DailyChecklistStore,
  ) {}

  start() {
    this.timer ??= setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private runtime(canonicalId: string): Runtime {
    let r = this.rt.get(canonicalId);
    if (!r) {
      r = {
        phase: "idle",
        phaseAt: Date.now(),
        fails: 0,
        currentAttempt: 0,
        totalAttempts: 7,
        ticketsUsed: 0,
        message: "",
      };
      this.rt.set(canonicalId, r);
    }
    return r;
  }

  stateFor(accountId: string): WorldBossState {
    const r = this.runtime(canon(accountId));
    return {
      phase: r.phase,
      currentAttempt: r.currentAttempt,
      totalAttempts: r.totalAttempts,
      ticketsUsed: r.ticketsUsed,
      message: r.message,
      phaseAt: r.phaseAt,
      canRun: r.phase === "idle" || r.phase === "done" || r.phase === "error",
    };
  }

  private setPhase(r: Runtime, phase: WorldBossPhase, message: string) {
    r.phase = phase;
    r.phaseAt = Date.now();
    r.message = message;
    r.fails = 0;
  }

  startBoss(accountId: string): { ok: boolean; message?: string } {
    const canonicalId = canon(accountId);
    const conn = this.host.entries().find(([id]) => canon(id) === canonicalId)?.[1];
    if (!conn) return { ok: false, message: "Tài khoản chưa kết nối" };

    const cfg = this.store.get(accountId);
    const r = this.runtime(canonicalId);
    const ch = conn.character();

    r.currentAttempt = 0;
    r.totalAttempts = 1; // Hiện tại active handle đánh 1 lượt
    r.ticketsUsed = 0;
    r.petSwitched = false;
    r.originalMap = ch?.location.map;
    r.originalX = ch?.location.x;
    r.originalY = ch?.location.y;
    const activePet = ch?.pets?.find((p) => p.active);
    r.savedPetModel = activePet?.model;

    this.store.set(accountId, { enabled: true });

    if (ch?.party.joined) {
      this.setPhase(r, "leaving_party", "Rời đội trước khi săn Boss Thế Giới...");
    } else {
      this.setPhase(r, "preparing", "Chuẩn bị trang bị và di chuyển tới Boss Thế Giới...");
    }

    conn.log("info", `🐉 [Boss Thế Giới] Bắt đầu săn Boss Thế Giới (1 lượt)!`, "game");
    this.host.pushCharacter(accountId);
    return { ok: true };
  }

  stopBoss(accountId: string): { ok: boolean; message?: string } {
    const canonicalId = canon(accountId);
    const conn = this.host.entries().find(([id]) => canon(id) === canonicalId)?.[1];
    const r = this.runtime(canonicalId);

    if (conn) {
      try { conn.stopScript(); } catch {}
    }

    this.setPhase(r, "idle", "Đã dừng săn Boss Thế Giới");
    this.store.set(accountId, { enabled: false });
    this.host.pushCharacter(accountId);
    return { ok: true };
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const [id, conn] of this.host.entries()) {
        const canonicalId = canon(id);
        const cfg = this.store.get(id);
        const r = this.runtime(canonicalId);

        if (!cfg.enabled && r.phase === "idle") continue;
        if (cfg.enabled && (r.phase === "idle" || r.phase === "done")) {
          this.startBoss(id);
          continue;
        }

        const ch = conn.character();
        if (!ch) continue;
        const now = Date.now();

        // Kiểm tra nếu nhân vật tử vong và bị chuyển sang map Quỷ Môn Quan (12007)
        if (ch.location.map === GHOST_MAP && r.phase !== "reviving" && r.phase !== "idle" && r.phase !== "done") {
          this.setPhase(r, "reviving", "Nhân vật đã tử vong — đang hồi sinh tại Quỷ Môn Quan...");
        }

        switch (r.phase) {
          case "leaving_party": {
            if (!ch.party.joined) {
              this.setPhase(r, "preparing", "Đã rời đội. Chuẩn bị săn Boss...");
              break;
            }
            await conn.dispatch("leave_party", undefined, { quiet: true }).catch(() => undefined);
            r.message = "Đang chờ rời đội...";
            break;
          }

          case "preparing": {
            // Tạm thời tắt auto HP/SP để tránh dùng lãng phí trong trận boss
            await conn.dispatch("set_auto_heal", { autoHealJson: JSON.stringify({ enabled: false }) }, { quiet: true }).catch(() => undefined);

            // Đổi pet nếu có cấu hình pet boss
            if (cfg.bossPetId && !r.petSwitched) {
              r.petSwitched = true;
              conn.log("info", `🐉 [Boss Thế Giới] Chọn võ tướng săn boss (Model ${cfg.bossPetId})...`, "game");
              await conn.dispatch("pet_out", { model: cfg.bossPetId }, { quiet: true }).catch(() => undefined);
              if (cfg.bossPetWeapon) {
                await conn.dispatch("use_item", { itemId: cfg.bossPetWeapon, count: 1, target: 1 }, { quiet: true }).catch(() => undefined);
              }
              await new Promise((res) => setTimeout(res, 1500));
            }

            this.setPhase(r, "warping", "Di chuyển tới Thành Trác Quận (12001)...");
            break;
          }

          case "warping": {
            if (ch.inBattle) {
              this.setPhase(r, "in_battle", `Đang trong trận đấu Boss (${r.currentAttempt + 1}/${r.totalAttempts})...`);
              break;
            }
            if (ch.location.map === SAFE_HUB_MAP) {
              r.fails = 0;
              this.setPhase(r, "walking", "Di chuyển tới vị trí Boss Thế Giới (1910, 1190)...");
              break;
            }

            const res = await conn.dispatch("warp_map", { mapId: SAFE_HUB_MAP }).catch((err: any) => ({ ok: false, message: String(err) }));
            if (res && !res.ok) {
              r.fails++;
              if (r.fails >= MAX_FAILS) {
                this.setPhase(r, "error", `Không thể di chuyển về Trác Quận (${SAFE_HUB_MAP}): ${res.message ?? ""}`);
                this.store.set(id, { enabled: false });
              }
            }
            break;
          }

          case "walking": {
            if (ch.inBattle) {
              this.setPhase(r, "in_battle", `Đang trong trận đấu Boss (${r.currentAttempt + 1}/${r.totalAttempts})...`);
              break;
            }
            if (ch.location.map !== SAFE_HUB_MAP) {
              this.setPhase(r, "warping", "Di chuyển về lại Trác Quận...");
              break;
            }

            const curX = ch.location.x ?? 0;
            const curY = ch.location.y ?? 0;
            const dist = Math.hypot(curX - BOSS_COORDS.x, curY - BOSS_COORDS.y);

            if (dist <= 120) {
              // Đã tiếp cận vị trí boss -> Quét ăn HP/SP trước khi vào trận
              this.setPhase(r, "healing", "Quét ăn HP/SP theo mốc cấu hình...");
              break;
            }

            // Gửi lệnh di chuyển thẳng tới vị trí boss
            await conn.dispatch("move", { x: BOSS_COORDS.x, y: BOSS_COORDS.y }, { quiet: true }).catch(() => undefined);
            r.message = `Đang di chuyển tới (${BOSS_COORDS.x}, ${BOSS_COORDS.y}) - Khoảng cách: ${Math.round(dist)}px...`;
            break;
          }

          case "healing": {
            conn.log("info", `💊 [Boss Thế Giới] Quét ăn HP/SP theo mốc cấu hình trước khi vào Boss...`, "game");
            await conn.dispatch("sweep_auto_heal", undefined, { quiet: true }).catch(() => undefined);
            await new Promise((res) => setTimeout(res, 800));
            this.setPhase(r, "challenging", "Đối thoại khiêu chiến NPC 45 tại Trác Quận (1910, 1190)...");
            break;
          }

          case "using_ticket": {
            // (Tạm thời disable flow nhiều lượt / ăn vé - Coming Soon)
            this.setPhase(r, "challenging", `Khiêu chiến Boss Thế Giới...`);
            break;
          }

          case "challenging": {
            if (ch.inBattle) {
              this.setPhase(r, "in_battle", `⚔️ Đang trong trận đấu Boss...`);
              break;
            }

            // Gửi lệnh click NPC 45 tại 12001 (1910, 1190)
            conn.log("info", `⚔️ [Boss Thế Giới] Khiêu chiến Boss Thế Giới (NPC 45)...`, "game");
            await conn.dispatch("click", { npc: BOSS_NPC }, { quiet: true }).catch(() => undefined);
            r.challengeSentAt = now;
            r.message = `Chờ vào trận đấu Boss...`;

            // Chờ 1.5s xem có vào trận không
            await new Promise((res) => setTimeout(res, 1500));
            if (conn.character()?.inBattle) {
              this.setPhase(r, "in_battle", `⚔️ Đang trong trận đấu Boss...`);
            }
            break;
          }

          case "in_battle": {
            if (ch.inBattle) {
              r.message = `⚔️ Đang trong trận chiến Boss Thế Giới...`;
              break;
            }

            // Trận đấu kết thúc! Ghi messlog sự kiện và kết thúc lượt
            r.currentAttempt++;
            conn.log("info", `🎉 [Boss Thế Giới] Trận đấu kết thúc! Hoàn thành 1 lượt khiêu chiến Boss Thế Giới.`, "game");
            this.checklistStore?.recordProgress(id, "world_boss", 1);

            // Kiểm tra nếu nhân vật tử vong
            if (ch.location.map === GHOST_MAP) {
              this.setPhase(r, "reviving", "Nhân vật đã tử vong — đang hồi sinh tại Quỷ Môn Quan...");
              break;
            }

            this.setPhase(r, "finishing", "Đã hoàn thành 1 lượt Boss Thế Giới...");
            break;
          }

          case "reviving": {
            if (ch.location.map === GHOST_MAP) {
              conn.log("info", `👻 [Boss Thế Giới] Đối thoại Ngưu Đầu / Đại Phu tại Quỷ Môn Quan để hồi sinh...`, "game");
              // Click NPC 1 tại (311, 428) menu 2 send 2
              await conn.dispatch("click", { npc: REVIVE_NPC }, { quiet: true }).catch(() => undefined);
              await conn.dispatch("send_menu", { option: 2 }, { quiet: true }).catch(() => undefined);
              await new Promise((res) => setTimeout(res, 1200));
              await conn.dispatch("warp_map", { mapId: SAFE_HUB_MAP }, { quiet: true }).catch(() => undefined);
              break;
            }

            if (ch.location.map === SAFE_HUB_MAP) {
              conn.log("info", `✨ [Boss Thế Giới] Đã hồi sinh thành công và trở lại Thành Trác Quận!`, "game");
              if (r.currentAttempt >= r.totalAttempts) {
                this.setPhase(r, "finishing", "Đã hoàn thành các trận boss...");
              } else {
                this.setPhase(r, "walking", `Tiếp tục trận boss thứ ${r.currentAttempt + 1}/${r.totalAttempts}...`);
              }
            }
            break;
          }

          case "finishing": {
            conn.log("info", `🎉 [Boss Thế Giới] Hoàn tất 1 lượt khiêu chiến Boss Thế Giới!`, "game");

            // Bật lại auto HP/SP
            await conn.dispatch("set_auto_heal", { autoHealJson: JSON.stringify({ enabled: true }) }, { quiet: true }).catch(() => undefined);

            // Đổi lại võ tướng chính nếu trước đó đã đổi sang pet boss
            if (r.savedPetModel) {
              const currentActive = conn.character()?.pets?.find((p) => p.active);
              if (currentActive?.model !== r.savedPetModel) {
                conn.log("info", `🐉 [Boss Thế Giới] Chuyển lại võ tướng chính ban đầu (Model ${r.savedPetModel})...`, "game");
                await conn.dispatch("pet_out", { model: r.savedPetModel }, { quiet: true }).catch(() => undefined);
              }
            }

            // Quay về map và bãi train ban đầu nếu được bật
            if (cfg.returnToTrain && r.originalMap && r.originalMap !== SAFE_HUB_MAP) {
              conn.log("info", `🚶 [Boss Thế Giới] Quay trở về bản đồ ban đầu (${r.originalMap})...`, "game");
              await conn.dispatch("warp_map", { mapId: r.originalMap }, { quiet: true }).catch(() => undefined);
              if (r.originalX && r.originalY) {
                await conn.dispatch("move", { x: r.originalX, y: r.originalY }, { quiet: true }).catch(() => undefined);
              }
            }

            this.setPhase(r, "done", `Đã hoàn thành ${r.currentAttempt}/${r.totalAttempts} trận Boss Thế Giới!`);
            this.store.set(id, { enabled: false });
            break;
          }
        }

        this.host.pushCharacter(id);
      }
    } finally {
      this.ticking = false;
    }
  }
}
