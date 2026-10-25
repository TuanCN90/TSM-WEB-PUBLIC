/**
 * DungeonSoloService — điều phối PHÓ BẢN ĐƠN (Khiêu chiến Ba Đậu Yêu, Săn Kho Báu, Tìm Đậu Đậu).
 * Phân lập độc lập 100% giữa các tài khoản theo Rule 2.
 * Hỗ trợ chạy đơn lẻ từng loại hoặc chạy chuỗi tự động cả 3 loại (Daily Solo Dungeon Runner).
 */
import type {
  DungeonSoloConfig,
  DungeonSoloDef,
  DungeonSoloPhase,
  DungeonSoloResult,
  DungeonSoloState,
  DungeonSoloType,
} from "@tsbot/protocol";
import { DUNGEON_SOLO_CATALOG, getSoloDungeonDef } from "@tsbot/protocol";
import { type GameConnection, MSG } from "@tsbot/engine";
import type { DungeonSoloConfigStore } from "./store";

const TICK_MS = 2000;
const MAX_FAILS = 3;
const SAFE_HUB_MAP = 12001; // Trác Quận

const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();
const canon = (accountId: string) => {
  const raw = (accountId ?? "").trim();
  if (!raw) return "default";
  const at = raw.indexOf("@");
  return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
};

export interface DungeonSoloHost {
  entries(): [string, GameConnection][];
  pushCharacter(accountId: string): void;
}

interface Runtime {
  phase: DungeonSoloPhase;
  phaseAt: number;
  fails: number;
  queue: ("khieu_chien" | "san_kho_bau" | "tim_dau_dau")[];
  currentType?: "khieu_chien" | "san_kho_bau" | "tim_dau_dau";
  currentDef?: DungeonSoloDef;
  completedTypes: ("khieu_chien" | "san_kho_bau" | "tim_dau_dau")[];
  results: DungeonSoloResult[];
  baselinePlayerExpCur?: number;
  baselinePlayerExpPct?: number;
  baselinePetExpCur?: number;
  baselinePetExpPct?: number;
  dungeonStartedAt?: number;
  routeRuns: number;
  lastRouteAt: number;
  roomCreated: boolean;
  message: string;
  exitSent?: boolean;
  scriptCompletedAt?: number;
}

export class DungeonSoloService {
  private timer?: ReturnType<typeof setInterval>;
  private rt = new Map<string, Runtime>();
  private ticking = false;

  constructor(
    private host: DungeonSoloHost,
    private store: DungeonSoloConfigStore,
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
        queue: [],
        completedTypes: [],
        results: [],
        routeRuns: 0,
        lastRouteAt: 0,
        roomCreated: false,
        message: "",
      };
      this.rt.set(canonicalId, r);
    }
    return r;
  }

  stateFor(accountId: string): DungeonSoloState {
    const r = this.runtime(canon(accountId));
    return {
      phase: r.phase,
      currentType: r.currentType,
      currentDungeonId: r.currentDef?.id,
      completedTypes: [...r.completedTypes],
      results: [...r.results],
      message: r.message,
      phaseAt: r.phaseAt,
      canRun: r.phase === "idle" || r.phase === "done" || r.phase === "error",
    };
  }

  private setPhase(r: Runtime, phase: DungeonSoloPhase, message: string) {
    r.phase = phase;
    r.phaseAt = Date.now();
    r.message = message;
    r.fails = 0;
  }

  startSolo(accountId: string): { ok: boolean; message?: string } {
    const canonicalId = canon(accountId);
    const conn = this.host.entries().find(([id]) => canon(id) === canonicalId)?.[1];
    if (!conn) return { ok: false, message: "Tài khoản chưa kết nối" };

    const cfg = this.store.get(accountId);
    const r = this.runtime(canonicalId);

    const queue: ("khieu_chien" | "san_kho_bau" | "tim_dau_dau")[] =
      cfg.type === "all"
        ? ["khieu_chien", "san_kho_bau", "tim_dau_dau"]
        : [cfg.type];

    r.queue = queue;
    r.currentType = queue[0];
    r.completedTypes = [];
    r.results = [];
    r.routeRuns = 0;
    r.exitSent = false;
    r.roomCreated = false;
    r.dungeonStartedAt = undefined;

    this.store.set(accountId, { enabled: true });

    const ch = conn.character();
    if (cfg.leaveParty && ch?.party.joined) {
      this.setPhase(r, "leaving_party", "Rời đội trước khi vào phó bản đơn...");
    } else if (ch?.location.map === SAFE_HUB_MAP) {
      this.setPhase(r, "creating_room", `Đang chuẩn bị vào ${r.currentType}...`);
    } else {
      this.setPhase(r, "warping", "Di chuyển về Trác Quận để bắt đầu phó bản đơn...");
    }

    conn.log("info", `⚔️ [Phó bản đơn] Bắt đầu chế độ: ${cfg.type === "all" ? "Chuỗi 3 phó bản đơn" : queue[0]}`, "game");
    this.host.pushCharacter(accountId);
    return { ok: true };
  }

  stopSolo(accountId: string): { ok: boolean; message?: string } {
    const canonicalId = canon(accountId);
    const conn = this.host.entries().find(([id]) => canon(id) === canonicalId)?.[1];
    const r = this.runtime(canonicalId);

    if (conn) {
      try { conn.stopScript(); } catch {}
      if (r.roomCreated) {
        void conn.dispatch("dungeon_room_cancel", undefined, { quiet: true }).catch(() => undefined);
      }
    }

    r.roomCreated = false;
    this.setPhase(r, "idle", "Đã dừng phó bản đơn");
    this.store.set(accountId, { enabled: false });
    this.host.pushCharacter(accountId);
    return { ok: true };
  }

  async exitDungeon(accountId: string): Promise<{ ok: boolean; message?: string }> {
    const canonicalId = canon(accountId);
    const conn = this.host.entries().find(([id]) => canon(id) === canonicalId)?.[1];
    const r = this.runtime(canonicalId);

    if (conn) {
      try { conn.stopScript(); } catch {}
      await conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
    }

    r.roomCreated = false;
    this.setPhase(r, "idle", "Đã thoát phó bản");
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
          this.startSolo(id);
          continue;
        }

        const ch = conn.character();
        if (!ch) continue;
        const now = Date.now();

        switch (r.phase) {
          case "leaving_party": {
            if (!ch.party.joined) {
              this.setPhase(r, "warping", "Đã rời đội. Về Trác Quận chuẩn bị vào phó bản...");
              break;
            }
            await conn.dispatch("leave_party", undefined, { quiet: true }).catch(() => undefined);
            r.message = "Đang chờ rời đội...";
            break;
          }

          case "warping": {
            if (ch.inBattle) {
              r.message = "Đang trong trận đấu — chờ xong trận...";
              break;
            }
            // Nếu đã ở Trác Quận (12001)
            if (ch.location.map === SAFE_HUB_MAP) {
              r.fails = 0;
              this.setPhase(r, "creating_room", `Đang chuẩn bị vào ${r.currentType}...`);
              break;
            }
            // Nếu vẫn đang ở map phó bản cũ (62001..62010), gửi thoát và warp về Trác Quận
            if (ch.location.map >= 62001 && ch.location.map <= 62010) {
              r.message = "Đang rời map phó bản cũ...";
              await conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
              await conn.dispatch("warp_map", { mapId: SAFE_HUB_MAP }, { quiet: true }).catch(() => undefined);
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

          case "creating_room": {
            if (!r.currentType) {
              this.finishAll(id, conn, r);
              break;
            }

            const level = ch.player.level || 1;
            const def = getSoloDungeonDef(r.currentType, level, cfg.bracket);
            if (!def) {
              this.setPhase(r, "error", `Không tìm thấy phó bản phù hợp cho loại ${r.currentType} (cấp ${level})`);
              this.store.set(id, { enabled: false });
              break;
            }
            r.currentDef = def;

            const res = await conn.dispatch("dungeon_room_create", { dungeon: def.id, password: 0 });
            if (!res) break;

            if (res.ok) {
              r.roomCreated = true;
              this.setPhase(r, "entering", `Phòng ${def.typeName} đã tạo. Đang bước vào cổng...`);
              break;
            }

            // Hết lượt trong ngày / đã hoàn thành (mã 4 hoặc server thông báo đã hoàn thành)
            const isDailyDone = (res as any).code === 4 || /hôm nay|hết lượt|hoàn thành|mua thêm lượt|mã 4/i.test(res.message ?? "");
            if (isDailyDone) {
              const skipMsg = MSG.dungeonSoloDailyDone(def.typeName);
              conn.log("info", `⚠️ [Phó bản đơn] ${skipMsg}`, "game");
              r.completedTypes.push(r.currentType);
              this.nextInQueue(id, conn, r);
              break;
            }

            r.fails++;
            if (r.fails >= MAX_FAILS) {
              this.setPhase(r, "error", `Tạo phòng ${def.name} thất bại ${MAX_FAILS} lần: ${res.message ?? ""}`);
              this.store.set(id, { enabled: false });
            }
            break;
          }

          case "entering": {
            const def = r.currentDef;
            if (!def) {
              this.setPhase(r, "error", "Không có thông tin phó bản");
              break;
            }

            // Chỉ vào in_dungeon khi nhân vật đã sang ĐÚNG map của phó bản hiện tại
            if (ch.location.map === def.map) {
              this.setPhase(r, "in_dungeon", `Đã vào ${def.name}. Bắt đầu thực thi...`);
              r.routeRuns = 0;
              r.exitSent = false;
              r.scriptCompletedAt = undefined;
              r.dungeonStartedAt = now;
              r.baselinePlayerExpCur = ch.player.expCur ?? ch.player.exp;
              r.baselinePlayerExpPct = ch.player.exp;
              r.baselinePetExpCur = ch.pet.expCur ?? ch.pet.exp;
              r.baselinePetExpPct = ch.pet.exp;
              // Đồng bộ thực thể map phó bản (0c/01 00) sau khi qua cổng để kích hoạt instance và NPC
              setTimeout(() => { void conn.dispatch("sync_state", undefined, { quiet: true }).catch(() => undefined); }, 400);
              break;
            }

            // Bước qua cổng từ Trác Quận (dùng warp_raw: chỉ 14/08, không sync_state / ready_1406 thừa)
            const res = await conn.dispatch("warp_raw", { door: def.door }).catch((err: any) => ({ ok: false, message: String(err) }));
            if (res && !res.ok) {
              r.fails++;
              if (r.fails >= MAX_FAILS) {
                this.setPhase(r, "error", `Không thể bước qua cổng ${def.door}: ${res.message ?? ""}`);
                this.store.set(id, { enabled: false });
              }
            }
            break;
          }

          case "in_dungeon": {
            let def = r.currentDef;
            if (!def && r.currentType) {
              const level = ch.player.level || 1;
              def = getSoloDungeonDef(r.currentType, level, cfg.bracket);
              r.currentDef = def;
            }
            if (!def) {
              this.finishAll(id, conn, r);
              break;
            }

            if (!r.dungeonStartedAt) {
              r.dungeonStartedAt = now;
              r.baselinePlayerExpCur = ch.player.expCur ?? ch.player.exp;
              r.baselinePlayerExpPct = ch.player.exp;
              r.baselinePetExpCur = ch.pet.expCur ?? ch.pet.exp;
              r.baselinePetExpPct = ch.pet.exp;
            }

            // Kiểm tra trạng thái hoàn thành / ra khỏi map phó bản
            const outside =
              !ch.inBattle &&
              ch.location.map !== def.map &&
              !(ch.location.map >= 62001 && ch.location.map <= 62010);

            const roomEnded = ch.dungeonRoom?.status === "left" || ch.dungeonRoom?.status === "completed";

            // Với Săn Kho Báu và Tìm Đậu Đậu: máy chủ tự động warp về Trác Quận khi hoàn tất (hoặc khi bot đã gửi thoát fallback)
            const isDone =
              r.currentType === "khieu_chien"
                ? outside || roomEnded
                : (outside || roomEnded) && (r.scriptCompletedAt !== undefined || r.exitSent);

            if (isDone && now - r.phaseAt > 3000) {
              const durationSec = Math.max(1, Math.round((now - (r.dungeonStartedAt || now)) / 1000));
              const pCur = ch.player.expCur ?? ch.player.exp;
              const pPct = ch.player.exp;
              const petCur = ch.pet.expCur ?? ch.pet.exp;
              const petPct = ch.pet.exp;

              const playerExpGained = Math.max(0, pCur - (r.baselinePlayerExpCur ?? pCur));
              const playerExpPercent = Math.max(0, Number((pPct - (r.baselinePlayerExpPct ?? pPct)).toFixed(2)));
              const petExpGained = Math.max(0, petCur - (r.baselinePetExpCur ?? petCur));
              const petExpPercent = Math.max(0, Number((petPct - (r.baselinePetExpPct ?? petPct)).toFixed(2)));

              const result: DungeonSoloResult = {
                type: r.currentType!,
                name: def.name,
                durationSec,
                completedAt: now,
                playerExpGained,
                playerExpPercent,
                petExpGained,
                petExpPercent,
              };
              const hasExp = playerExpGained > 0 || playerExpPercent > 0 || petExpGained > 0 || petExpPercent > 0;
              const actuallyCompleted = ch.dungeonRoom?.status === "completed" || hasExp;

              if (actuallyCompleted) {
                r.results.push(result);
                const expParts: string[] = [];
                if (playerExpGained > 0) {
                  expParts.push(`Nhân vật +${playerExpGained.toLocaleString("vi-VN")} EXP${playerExpPercent > 0 ? ` (+${playerExpPercent}%)` : ""}`);
                } else if (playerExpPercent > 0) {
                  expParts.push(`Nhân vật +${playerExpPercent}% EXP`);
                }
                if (ch.pet.name) {
                  if (petExpGained > 0) {
                    expParts.push(`${ch.pet.name} +${petExpGained.toLocaleString("vi-VN")} EXP${petExpPercent > 0 ? ` (+${petExpPercent}%)` : ""}`);
                  } else if (petExpPercent > 0) {
                    expParts.push(`${ch.pet.name} +${petExpPercent}% EXP`);
                  }
                }
                const expMsg = expParts.length > 0 ? ` (Thưởng: ${expParts.join(" • ")})` : "";
                conn.log("info", `🎉 [Phó bản đơn] Hoàn thành ${def.name} (${durationSec}s)!${expMsg}`, "game");
                r.completedTypes.push(r.currentType!);
              } else {
                conn.log("warn", `⚠️ [Phó bản đơn] ${def.name} kết thúc nhưng chưa nhận được EXP/xác nhận từ máy chủ.`, "game");
              }

              r.roomCreated = false;
              r.dungeonStartedAt = undefined;
              this.nextInQueue(id, conn, r);
              break;
            }

            // Chạy kịch bản phó bản
            const scriptState = conn.info().script?.state;
            const isScriptRunning = scriptState === "running" || scriptState === "paused";

            if (r.currentType === "khieu_chien") {
              // Khiêu chiến Ba Đậu Yêu: Trận đấu diễn ra, chờ hết trận
              if (ch.inBattle) {
                r.routeRuns = 1;
                r.message = `⚔️ Đang khiêu chiến Ba Đậu Yêu trong trận đấu...`;
              } else if (r.routeRuns === 0 && !isScriptRunning) {
                try {
                  conn.runScript(`phoban-don-${def.id}`, def.script);
                  r.routeRuns++;
                  conn.log("info", `⚔️ [Phó bản đơn] Đang kích hoạt trận đấu ${def.name}...`, "game");
                } catch {}
              } else if (r.routeRuns > 0 && !isScriptRunning && !ch.inBattle && !r.exitSent) {
                r.exitSent = true;
                void conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
              }
            } else {
              // Săn Kho Báu / Tìm Đậu Đậu: Chạy script nhặt rương / click Đậu Đậu
              if (!isScriptRunning && r.routeRuns === 0) {
                try {
                  conn.runScript(`phoban-don-${def.id}`, def.script);
                  r.routeRuns++;
                  r.lastRouteAt = now;
                  r.scriptCompletedAt = undefined;
                  conn.log("info", `⚔️ [Phó bản đơn] Đang chạy lộ trình ${def.name}...`, "game");
                } catch (err: any) {
                  conn.log("warn", `[Phó bản đơn] Lỗi chạy kịch bản ${def.name}: ${err?.message ?? err}`, "game");
                }
              } else if (scriptState === "completed" && !r.scriptCompletedAt) {
                // Kịch bản hoàn tất: chờ 2s cho gói kết toán 2f/0c và chốt 14/08 00 2a từ server rồi gửi dungeon_exit để server đưa nhân vật về Trác Quận (như pcap thật 172.76s)
                r.scriptCompletedAt = now;
                conn.log("info", `⚔️ [Phó bản đơn] Kịch bản hoàn tất, đang kết toán và chuẩn bị rời phó bản...`, "game");
                setTimeout(() => {
                  if (!r.exitSent) {
                    r.exitSent = true;
                    void conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
                  }
                }, 2000);
              } else if (r.scriptCompletedAt && !r.exitSent && now - r.scriptCompletedAt > 8_000) {
                // Fallback nếu sau 8s chưa gửi được exit
                r.exitSent = true;
                conn.log("info", `⚔️ [Phó bản đơn] Thực hiện thoát phó bản về Trác Quận...`, "game");
                void conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
              } else if (scriptState === "error" && !r.exitSent) {
                const errMsg = conn.info().script?.error ?? "Kịch bản bị lỗi";
                conn.log("warn", `[Phó bản đơn] Lộ trình ${def.name} dừng vì lỗi: ${errMsg}`, "game");
                r.exitSent = true;
                void conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
              }
            }
            break;
          }
        }

        this.host.pushCharacter(id);
      }
    } finally {
      this.ticking = false;
    }
  }

  private nextInQueue(accountId: string, conn: GameConnection, r: Runtime) {
    r.queue.shift();
    r.roomCreated = false;
    r.dungeonStartedAt = undefined;
    r.routeRuns = 0;
    r.exitSent = false;
    r.fails = 0;

    if (r.queue.length > 0) {
      r.currentType = r.queue[0];
      r.currentDef = undefined;
      this.setPhase(r, "warping", `Chuyển sang phó bản tiếp theo: ${r.currentType}...`);
      conn.log("info", `⚔️ [Phó bản đơn] Chuẩn bị sang phó bản tiếp theo: ${r.currentType}...`, "game");
      void conn.dispatch("dungeon_exit", undefined, { quiet: true }).catch(() => undefined);
      void conn.dispatch("warp_map", { mapId: SAFE_HUB_MAP }, { quiet: true }).catch(() => undefined);
    } else {
      this.finishAll(accountId, conn, r);
    }
  }

  private finishAll(accountId: string, conn: GameConnection, r: Runtime) {
    const totalExp = r.results.reduce((acc, x) => acc + x.playerExpGained, 0);
    const totalPetExp = r.results.reduce((acc, x) => acc + x.petExpGained, 0);
    const expSummaries: string[] = [];
    if (totalExp > 0) expSummaries.push(`Nhân vật: +${totalExp.toLocaleString("vi-VN")} EXP`);
    if (totalPetExp > 0) expSummaries.push(`Võ tướng: +${totalPetExp.toLocaleString("vi-VN")} EXP`);
    const expMsg = expSummaries.length > 0 ? ` (Tổng nhận: ${expSummaries.join(" • ")})` : "";

    this.setPhase(r, "done", `Đã hoàn thành tất cả phó bản đơn hôm nay!${expMsg}`);
    this.store.set(accountId, { enabled: false });
    conn.log("info", `🎉 [Phó bản đơn] Đã hoàn tất toàn bộ phó bản đơn!${expMsg}`, "game");
    this.host.pushCharacter(accountId);
  }
}
