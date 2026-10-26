import { LoginRejectedError } from "../../abortable";
import { dijieLevelLabel } from "../../../data/dijie";
import { MSG } from "../../../data/messages";
import warpGates from "../../../data/warpGates.json";
import mapNames from "../../../data/mapNames.json";
import itemNames from "../../../data/itemNames.json";
import itemDetails from "../../../data/itemDetails.json";
import itemHealEffects from "../../../data/itemHealEffects.json";
import npcNames from "../../../data/npcNames.json";
import npcElements from "../../../data/npcElements.json";
import { PET_CURVES, PLAYER_CURVES, expWindows, lookupExp, withExp } from "../../../runtime/exp";
import { isBankMap } from "../../../runtime/liveActions";
import { getSafeSpotForMap } from "../../../runtime/route";
import skillDataRaw from "../../../data/skillData.json";
import npcSkillsRaw from "../../../data/npcSkills.json";
import petSkillProfilesRaw from "../../../data/petSkillProfiles.json";
import dailyCheckinRewards from "../../../data/dailyCheckinRewards.json";
import { DUNGEON_ROOM_CATALOG, DUNGEON_SOLO_CATALOG, getTaiwanDateKey } from "@tsbot/protocol";
import type { AutoHealConfig, AutoMoveState, BattleActionConfig, BattleConfig, BattleTurnConfig, BattleUnit, ChaseConfig, EscortActiveInfo, EscortPhase, EscortState, InnPetInfo, SkillInfo } from "@tsbot/protocol";
import type { CodecIO, CodecSession, ProtocolCodec } from "../codec";
import { DUNGEON_ROOM_SUB, DungeonRoomTracker, createRoomPayload, isDungeonRoomAction, joinRoomPayload } from "./dungeonRoom";
import { PARTY_SUB, PartyTracker, partyPayload, partyReplyPayload, normName } from "./party";

/**
 * Codec "ts-online": server mới (vd 34.81.22.35:6614), login TRỰC TIẾP user/pass qua socket (không HTTP).
 * Nguồn: phân tích pcap PCAPdroid + kiểm chứng live.
 *
 *  Frame (2 chiều): [F4 44][len u16LE = TỔNG độ dài frame] [body]  — byte 0-1 XOR 99/78, phần còn lại XOR 0xAD.
 *  Body (đã giải mã): `00 00 cmd sub payload`.
 *  Login  C→S: cmd 01/00, payload = `00 02 01 15 00 00 00 00 00 01` + [len]user + [len]pass (ASCII, mật khẩu PHÂN BIỆT hoa/thường).
 *  Login  S→C: cmd 01/02, UID 8 byte ở body[10..18]; UID toàn 0 = bị từ chối.
 *  Sau login client gửi chuỗi khởi tạo (INIT) rồi heartbeat 07/01+0a/00 định kỳ.
 *  Self spawn S→C: cmd 03/00 có UID ở frame[9..17]; map u16LE ở frame[28]; tên: [len u8] ASCII ở frame[53].
 */
/**
 * Mã hệ theo bảng text của game (TextData 10462..10468 + 30003..30007): 0 Vô, 1 Địa, 2 Thủy, 3 Hỏa, 4 Phong, 5 Tâm, 6 Quang, 7 Ám.
 * Hỏa=3 đã đối chiếu với nhân vật thật (spawn[18]).
 */
const ELEMENTS = [undefined, "earth", "water", "fire", "wind", "heart", "light", "dark"] as const;
/**
 * Hệ của võ tướng KHÔNG nằm trong packet: tra theo model id trong Npc_C.dat (u8@50 của 81 byte đuôi, xem tools/import-npc-elements.ts).
 * Mã: 1 Địa, 2 Thủy, 3 Hỏa, 4 Phong (khớp bảng text), 8 Ám (Ma Quan Vũ). 5 = Tâm, 7 = Quang là suy theo thứ tự bảng text, chưa đối chiếu; 6 không có NPC nào dùng.
 */
const PET_ELEMENT_BY_CODE: Record<number, (typeof ELEMENTS)[number]> = { 1: "earth", 2: "water", 3: "fire", 4: "wind", 5: "heart", 7: "light", 8: "dark" };
/** Gói lặp dày (di chuyển/ping của người khác) — không dump ở mức debug để log đọc được. */
const NOISY = new Set(["06/01", "0b/04", "18/08", "01/01", "4d/01", "4d/02", "7c/00", "6e/09", "07/00", "23/32", "18/05", "16/02"]);
const CTR_CHECKIN_DAY = 0x6b, CTR_CHECKIN_STREAK = 0x6c;
const CTR_ONLINE_SEC = 0x0a; // bộ đếm 55/01: số giây online trong ngày (max 86400)
const CTR_ESCORT = 0x0008; // bộ đếm 55/01: số lượt vận tiêu trong ngày (max 3)
export const ONLINE_REWARD_MILESTONES = [
  { minutes: 10, flagId: 2, reward: "20 Đại Phúc Thần" },
  { minutes: 20, flagId: 3, reward: "1 Túi Lông Cấp 2" },
  { minutes: 30, flagId: 4, reward: "1 Vé Bồi Dưỡng Toạ Kỵ" },
  { minutes: 60, flagId: 5, reward: "1 Triệu Gọi Bảo Hộp" },
  { minutes: 90, flagId: 6, reward: "2 Thiên Cơ Phù" },
  { minutes: 180, flagId: 7, reward: "1 Xu Lạp Bá" },
] as const;
const zeroBytes = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24].filter((b) => b === 0).length;
const nf = (n: number) => n.toLocaleString("vi-VN");
const HDR = 4; // F4 44 + len(2)
/**
 * Chuỗi khởi tạo sau login, sao đúng theo pcap tool gốc (capture từ lúc login): payload `f[8..]` luôn bắt đầu bằng 00.
 * Thiếu lô 2 thì server không vào trạng thái "đã vào thế giới" và bỏ qua mọi gói hành động (vd 61/01, 61/02, 07/01).
 * CỐ Ý bỏ các gói có tác dụng lên tài khoản mà tool gửi sau đó: 4d/03 3f, 63/04 (nhận thưởng đấu trường), 5b/02, 56/01.
 * Mỗi phần tử: [trễ so với phần tử trước (ms), cmd, sub, payload].
 */
const INIT: Array<[number, number, number, number[]]> = [
  [700, 0x19, 0x29, [0x00, 0x7b]],
  [830, 0x2b, 0x04, [0x00]], [0, 0x01, 0x10, [0x00]], [0, 0x4d, 0x0b, [0x00, 0x80, 0x00]], [0, 0x7c, 0x04, [0x00]],
  [0, 0x41, 0x02, [0x00]], [0, 0x0c, 0x01, [0x00]], [0, 0x57, 0x03, [0x00]],
  [0, 0x62, 0x02, [0x00, 0x04, 0, 0, 0]], [0, 0x62, 0x02, [0x00, 0x01, 0, 0, 0]], [0, 0x62, 0x02, [0x00, 0x03, 0, 0, 0]], [0, 0x62, 0x02, [0x00, 0x02, 0, 0, 0]],
  [45, 0x0a, 0x00, [0x00]], [0, 0x21, 0x01, [0x00, 0x00]], [0, 0x59, 0x01, [0x00]], [0, 0x07, 0x01, [0x00]], [0, 0x48, 0x05, [0x00]],
  [220, 0x19, 0x29, [0x00, 0x7f]],
];
const LOGIN_PREAMBLE = [0x00, 0x02, 0x01, 0x15, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];

export function encodeFrame(body: Buffer): Buffer {
  const f = Buffer.alloc(HDR + body.length);
  f[0] = 0xf4 ^ 0x99;
  f[1] = 0x44 ^ 0x78;
  f.writeUInt16LE(f.length, 2);
  body.copy(f, HDR);
  for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
  return f;
}

const cmdBody = (cmd: number, sub: number, payload: number[] | Buffer = []) =>
  Buffer.concat([Buffer.from([0x00, 0x00, cmd, sub]), Buffer.from(payload)]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class TsOnlineSession implements CodecSession {
  private buf: Buffer = Buffer.alloc(0);
  private uid?: Buffer;
  private onLogin?: (uid: Buffer) => void;
  private roster: { idx: number; model: number; exp: number; level: number; hp: number; sp: number; maxHp?: number; maxSp?: number; stats?: import("@tsbot/protocol").PetStats; gear: import("@tsbot/protocol").PetBonus; equippedItems?: number[]; isAwakened?: boolean }[] = [];
  private activeModel: number | undefined;
  private battlePass?: { points: number; nextMilestone: number };
  private lapBaResolve?: (res: { ok: boolean; expGained?: number; error?: string }) => void;
  /** Điểm cộng từ trang bị của NHÂN VẬT: 08/01 (mã thuộc tính 0x1d2 atk, 0x1d3 def, 0x1d4 int, 0x1d6 agi). Của võ tướng: 08/02 `00 04 <idx> 00 <mã>`. */
  private gear: import("@tsbot/protocol").PetBonus = { int: 0, atk: 0, def: 0, agi: 0 };
  private pet = { name: "", level: 0, hp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, exp: 0 } as import("@tsbot/protocol").UnitState;
  private player: import("@tsbot/protocol").UnitState = { name: "", level: 0, hp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, exp: 0 };
  private location: import("@tsbot/protocol").LocationState = { map: 0, x: 0, y: 0, channel: 0 };
  private pendingChannel?: number;
  private mapChannelStatuses = new Map<number, import("@tsbot/protocol").ChannelStatus>();
  private knownChannels = new Set<number>([0]);
  private nonExistentChannels = new Set<number>();

  /**
   * Tạo danh sách kênh cho map hiện tại dựa trên dữ liệu máy chủ:
   * - Tuyệt đối không hardcode 1-10 kênh.
   * - Bắt đầu từ Kênh 1 và các kênh máy chủ đã chỉ định/đặt nhân vật vào.
   * - Logic máy chủ: khi 1 kênh có đủ số lượng tài khoản (đông / đầy, hoặc mapPlayerCount >= 10),
   *   máy chủ sẽ tự gen ra 1 kênh mới tiếp theo (id + 1).
   * - Nếu máy chủ báo mã 10135 ("Hiện tại không có kênh "): kênh đó chưa được máy chủ tạo ra và bị loại bỏ khỏi danh sách.
   */
  private buildMapChannels(mapId: number, currentChannel: number): import("@tsbot/protocol").MapChannelInfo[] {
    // Map phó bản đội/cá nhân (62xxx) chỉ có 1 kênh duy nhất
    if (mapId >= 62000 && mapId <= 62099) {
      return [{ id: 0, name: "Kênh 1", status: "free" }];
    }

    this.knownChannels.add(0);
    this.knownChannels.add(currentChannel);

    // Đếm số lượng tài khoản/người chơi hiện diện trong map hiện tại qua gói 03/00
    let mapPlayerCount = 0;
    const now = Date.now();
    for (const p of this.party.players.values()) {
      if (p.map === mapId && now - p.seen < 180_000) {
        mapPlayerCount++;
      }
    }

    // Khi 1 kênh có đủ số lượng tài khoản (status là full, busy hoặc đếm được >= 10 người chơi),
    // máy chủ sẽ tự động gen ra kênh mới tiếp theo.
    for (const chId of Array.from(this.knownChannels)) {
      const status = this.mapChannelStatuses.get(chId);
      const isCurrent = chId === currentChannel;
      const hasEnoughAccounts = status === "full" || status === "busy" || (isCurrent && mapPlayerCount >= 10);
      if (hasEnoughAccounts) {
        const nextCh = chId + 1;
        if (!this.nonExistentChannels.has(nextCh)) {
          this.knownChannels.add(nextCh);
        }
      }
    }

    const sortedIds = Array.from(this.knownChannels)
      .filter((id) => !this.nonExistentChannels.has(id))
      .sort((a, b) => a - b);

    const channels: import("@tsbot/protocol").MapChannelInfo[] = [];
    for (const id of sortedIds) {
      let status: import("@tsbot/protocol").ChannelStatus = "free";
      if (this.mapChannelStatuses.has(id)) {
        status = this.mapChannelStatuses.get(id)!;
      } else if (id === currentChannel) {
        status = mapPlayerCount >= 10 ? "busy" : "free";
      } else if (this.knownChannels.has(id + 1)) {
        status = "busy";
      }
      channels.push({
        id,
        name: `Kênh ${id + 1}`,
        status,
      });
    }
    return channels;
  }
  private onlineSecAtUpdate?: number;
  private onlineSecTime = 0;
  private claimedActivityFlags = new Set<number>();
  private onlineRewardRun?: { queue: number[]; total: number; ok: number; cur?: number; timer?: NodeJS.Timeout };
  private lastOnlineRewardSent?: number;
  private inBattle = false;
  private battleTurnIndex = 0;
  private battleConfig: BattleConfig = {
    playerAction: { type: "attack", skillId: 10000, target: "F1" },
    petAction: { type: "attack", skillId: 10000, target: "F1" },
    autoFight: true,
    strategyMode: "default",
    turns: [],
    currentTurn: 0,
  };
  private playerSkills: SkillInfo[] = [];
  private petSkills: SkillInfo[] = [];
  private battleUnits: BattleUnit[] = [];
  private chaseConfig: ChaseConfig = {
    enabled: false,
    mapId: 0,
    originX: 0,
    originY: 0,
    maxRadius: 150,
    autoReturn: true,
  };
  private autoMove: AutoMoveState = {
    enabled: false,
    mapId: 0,
    originX: 0,
    originY: 0,
    maxRadius: 150,
  };
  private mapNpcs = new Map<number, { index: number; npcId?: number; x: number; y: number; busy: boolean; lastSeen: number }>();
  private chaseRunning = false;
  private chaseCheckTimer?: NodeJS.Timeout;
  private chaseIdleCycles = 0;
  private autoMoveRunning = false;
  private autoMoveTimer?: NodeJS.Timeout;
  private innPets: InnPetInfo[] = [];
  private activeEscort?: EscortActiveInfo;
  private escortPhase: EscortPhase = "idle";
  private escortMessage = "";

  constructor(private io: CodecIO) {
    this.io.patchState({
      battleConfig: this.battleConfig,
      inBattle: false,
      battleUnits: [],
      playerSkills: [],
      petSkills: [],
      chaseConfig: this.chaseConfig,
      autoMove: this.autoMove,
      friends: [],
      innPets: [],
      escort: {
        phase: "idle",
        dailyCount: 0,
        maxDailyCount: 3,
      },
    });
  }

  onData(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= HDR) {
      const len = (this.buf[2]! ^ 0xad) | ((this.buf[3]! ^ 0xad) << 8);
      if (len < HDR) { this.io.log("warn", `length lỗi (${len}), bỏ buffer`); this.buf = Buffer.alloc(0); return; }
      if (this.buf.length < len) return;
      const f = Buffer.from(this.buf.subarray(0, len));
      this.buf = this.buf.subarray(len);
      for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
      this.handle(f);
    }
  }

  private handle(f: Buffer) {
    const cmd = f[6], sub = f[7];
    const op = `${cmd!.toString(16).padStart(2, "0")}/${sub!.toString(16).padStart(2, "0")}`;
    const mine = !!this.uid && f.length >= 17 && f.subarray(9, 17).equals(this.uid);
    // Dump frame ở mức debug để dò opcode mới (bỏ 01/02 vì chứa user/pass dạng rõ; bỏ gói lặp dày trừ 07/00 của chính mình).
    if (!(cmd === 0x01 && sub === 0x02) && (!NOISY.has(op) || (op === "07/00" && mine))) this.io.log("debug", `rx ${op} len=${f.length} ${f.toString("hex")}`);
    let known = true;
    if (cmd === 0x01 && sub === 0x02) this.onLogin?.(f.subarray(14, 22));
    else if (cmd === 0x05 && sub === 0x03 && f.length >= 52) this.playerStats(f);
    else if (cmd === 0x0f && sub === 0x08 && f.length >= 24) this.petStats(f);
    else if (cmd === 0x08 && sub === 0x0e && f.length >= 15) this.propUpdate("player", f.readUInt16LE(9), f.readUInt32LE(11));
    else if (cmd === 0x13 && (sub === 0x04 || sub === 0x01) && f.length >= 11) this.petActive(f.readUInt16LE(9), sub === 0x01);
    else if (cmd === 0x13 && sub === 0x02) this.petRest();
    else if (cmd === 0x02 && sub === 0x0a && f.length >= 16) this.sysMessage(f);
    else if (cmd === 0x54 && sub === 0x02 && f.length >= 12) this.shopReply(f);
    else if (cmd === 0x54 && sub === 0x01) this.io.log("info", `[Lạp Bá 54/01] Server phản hồi len=${f.length} hex=${f.toString("hex")}`);
    else if (cmd === 0x53 && sub === 0x01 && f.length >= 13) this.mailList(f);
    else if (cmd === 0x53 && sub === 0x02 && f.length >= 17) this.mailAck(f.readUInt32LE(13));
    else if (cmd === 0x0e && sub === 0x05 && f.length >= 11) this.parseFriendList(f);
    else if (cmd === 0x0e && sub === 0x0c && f.length >= 10) this.parseFriendGiftStatus(f);
    else if (cmd === 0x42 && sub === 0x03 && f.length >= 12) {
      const itemId = f.readUInt16LE(9);
      if (itemId === 45659) this.io.game("✨ [Rút bí cấp tướng] Nhận thành công bí cấp võ tướng!");
      else if (itemId === 45660) this.io.game("✨ [Rút thẻ tướng] Nhận thành công thẻ chiêu mộ võ tướng!");
    }
    else if (cmd === 0x4d && sub === 0x0b && f.length >= 13) {
      // 4d/0b: S->C 00 | totalPoints u16 | nextMilestone u16
      const points = f.readUInt16LE(9);
      const nextMilestone = f.readUInt16LE(11);
      this.battlePass = { points, nextMilestone };
      this.io.log("info", `[Thông Hành] Điểm tích luỹ: ${points}, mốc quà kế tiếp: ${nextMilestone}`);
    }
    else if (cmd === 0x5b && sub === 0x02 && f.length >= 12) {
      // 5b/02: S->C xác nhận cập nhật nhiệm vụ ngày
      this.io.log("info", "[Nhiệm vụ ngày] Máy chủ xác nhận tiến độ nhiệm vụ ngày");
    }
    else if (cmd === 0x5b && sub === 0x03 && f.length >= 12) {
      // 5b/03: S->C xác nhận nhận rương mốc tích luỹ
      const boxIdx = f[12] ?? f[10] ?? 0;
      this.io.game(`✨ [Nhiệm vụ ngày] Đã mở thành công rương mốc năng động ${boxIdx}!`);
    }
    else if (cmd === 0x08 && sub === 0x01 && f.length >= 15) {
      const prop = f.readUInt16LE(9);
      const val = f.readUInt32LE(11);
      if (prop === 0x0119) {
        this.player = { ...this.player, hp: { ...this.player.hp, cur: val } };
        this.io.patchState({ player: { ...this.player } });
      } else if (prop === 0x011a) {
        this.player = { ...this.player, sp: { ...this.player.sp, cur: val } };
        this.io.patchState({ player: { ...this.player } });
      } else {
        this.gearProp(this.gear, prop, val, () => this.io.patchState({ gear: { ...this.gear } }));
      }
    }
    else if (cmd === 0x17 && sub === 0x0b && f.length >= 10) this.equipList(f);
    else if (cmd === 0x08 && sub === 0x02 && f.length >= 18) {
      const prop = f.readUInt16LE(12);
      const val = f.readUInt32LE(14);
      const petIdx = f[9] === 0x04 ? f[10] : undefined;
      if (prop === 0x0119) {
        if (petIdx != null) {
          const rec = this.roster.find((r) => r.idx === petIdx);
          if (rec) {
            rec.hp = val;
            if (rec === this.activePet()) {
              this.pet = { ...this.pet, hp: { ...this.pet.hp, cur: val } };
              this.io.patchState({ pet: { ...this.pet } });
            }
          }
        } else {
          this.pet = { ...this.pet, hp: { ...this.pet.hp, cur: val } };
          this.io.patchState({ pet: { ...this.pet } });
        }
        this.publishPets();
      } else if (prop === 0x011a) {
        if (petIdx != null) {
          const rec = this.roster.find((r) => r.idx === petIdx);
          if (rec) {
            rec.sp = val;
            if (rec === this.activePet()) {
              this.pet = { ...this.pet, sp: { ...this.pet.sp, cur: val } };
              this.io.patchState({ pet: { ...this.pet } });
            }
          }
        } else {
          this.pet = { ...this.pet, sp: { ...this.pet.sp, cur: val } };
          this.io.patchState({ pet: { ...this.pet } });
        }
        this.publishPets();
      } else if (petIdx != null && TsOnlineSession.GEAR_PROPS[prop]) {
        this.petGear(petIdx, prop, val);
      } else {
        this.propUpdate("pet", prop, val, petIdx);
      }
    }
    else if (cmd === 0x07 && sub === 0x00 && f.length >= 23 && (!this.uid || f.subarray(9, 17).equals(this.uid))) this.moved(f);
    // 07/01 (S→C): server trả về danh sách kênh của map (pcap Chuyen Kenh.pcap 21.31s, 27.14s)
    else if (cmd === 0x07 && sub === 0x01) this.channelListReply(f);
    // 07/02 (S→C): server phản hồi đổi kênh (thành công hoặc báo lỗi kênh đầy)
    else if (cmd === 0x07 && sub === 0x02) this.channelChanged(f);
    else if (cmd === 0x06 && sub === 0x01 && f.length >= 22 && this.uid && f.subarray(9, 17).equals(this.uid)) this.stepMoved(f);
    // 0c/00 = trạng thái của mình sau khi đổi map (teleport): cùng bố cục với 07/00 (uid@9, map@17, x@19, y@21)
    else if (cmd === 0x0c && sub === 0x00 && f.length >= 23 && this.uid && f.subarray(9, 17).equals(this.uid)) this.arrived(f);
    else if (cmd === 0x1a && sub === 0x01 && f.length >= 13) {
      const added = f.readUInt32LE(9);
      if (this.onGoldEarned) this.onGoldEarned(added);
      this.gold += added;
      this.io.log("info", `🪙 [Tài chính] +${added.toLocaleString("vi-VN")} Vàng từ bán vật phẩm (Tổng: ${this.gold.toLocaleString("vi-VN")})`);
      this.io.patchState({ economy: { xu: this.xu, gold: this.gold } });
    }
    else if (cmd === 0x1a && sub === 0x02 && f.length >= 13) {
      const subbed = f.readUInt32LE(9);
      if (this.onGoldSpent) this.onGoldSpent(subbed);
      this.gold = Math.max(0, this.gold - subbed);
      this.io.log("info", `🪙 [Tài chính] -${subbed.toLocaleString("vi-VN")} Vàng để mua vật phẩm (Tổng: ${this.gold.toLocaleString("vi-VN")})`);
      this.io.patchState({ economy: { xu: this.xu, gold: this.gold } });
    }
    else if (cmd === 0x1a && sub === 0x04 && f.length >= 13) { this.setXu(f.readUInt32LE(9)); this.io.patchState({ economy: { xu: this.xu, gold: this.gold } }); }
    else if (cmd === 0x23 && sub === 0x05 && f.length >= 17) this.wallet(f);
    else if (cmd === 0x55 && sub === 0x01 && f.length >= 13) this.counters(f);
    else if (cmd === 0x18 && (sub === 0x02 || sub === 0x01) && f.length === 12 && f[9] === 0x51 && f[10] === 0x33) this.dijieTier(sub, f[11]!);
    else if (cmd === 0x18 && sub === 0x01 && Date.now() <= this.dialogAckUntil) {
      this.interactSeq++;
      this.ackDialog("trạng thái sự kiện (18/01)");
    }
    else if (cmd === 0x61 && sub === 0x01 && f.length >= 10) this.dijieOpenReply(f[9]!);
    else if (cmd === 0x51 && sub === 0x02 && f.length >= 12) this.activityFlagsInit(f);
    else if (cmd === 0x51 && sub === 0x01 && f.length >= 16) this.activityFlagUpdate(f);
    else if (cmd === 0x17 && sub === 0x05 && f.length >= 12) {
      // Mọi `17/05` là TÚI ĐỒ (đầy đủ). Server gửi lại `17/05` với f[9]=01 sau khi dùng/mở vật phẩm (log thật 16:46: nội dung = túi, ô 1 = 46285, ô 2 = 46921 giảm dần);
      // bản cũ coi f[9]≠0 là KHO TIỀN TRANG ⇒ chép nhầm túi vào kho ("🏦 Đã mở kho Tiền Trang: 20 ô", UI kho hiện 19/60 dù chưa gửi gì). Kho thật chỉ về qua `1d/09`+`1e/01` (pcap).
      this.bagList(f);
    }
    else if (cmd === 0x17 && sub === 0x08 && f.length >= 16) this.bagSlot(f);
    else if (cmd === 0x17 && sub === 0x09 && f.length >= 10) this.bagRemove(f);
    else if (cmd === 0x17 && sub === 0x0d && f.length >= 16) this.bagCombineResult(f);
    else if (cmd === 0x17 && sub === 0x66 && f.length >= 10) this.bankList(f);
    else if (cmd === 0x1d && sub === 0x09 && f.length >= 10) {
      this.setBankOpen(true);
      this.bankList1d(f);
    }
    else if (cmd === 0x1d && sub === 0x06) this.bankGold(f);
    else if (cmd === 0x1e && sub === 0x01 && f.length >= 9) this.bankList1e(f);
    else if (cmd === 0x1e && sub === 0x04 && f.length >= 13) this.bankItemAdd(f);
    else if (cmd === 0x1e && sub === 0x05 && f.length >= 11) this.bankItemRemove(f);
    else if (cmd === 0x1d || cmd === 0x1e) {
      this.io.log("debug", `[Tiền Trang ${op}] Gói ${op} (len=${f.length}) hex=${f.toString("hex")}`);
    }
    else if (cmd === 0x1f && sub === 0x06 && f.length >= 9) this.innPetsList(f);
    else if (cmd === 0x56 && sub === 0x03 && f.length >= 10) this.escortStatus(f);
    else if (cmd === 0x56 && sub === 0x02 && f.length >= 10) this.escortStartReply(f);
    else if (cmd === 0x56 && sub === 0x05) this.escortClaimReply(f);
    else if (cmd === 0x59 && sub === 0x03 && f.length >= 10) {
      this.io.log("info", "💥 [Phân giải] Máy chủ xác nhận phân giải thành công.");
      if (this.sweepTimer) {
        clearTimeout(this.sweepTimer);
        this.sweepTimer = undefined;
      }
      this.sweepingBag = false;
    }
    else if (cmd === 0x27 && (sub === 0x15 || sub === 0x16)) {
      if (sub === 0x16) this.io.log("info", "🏛️ [Đóng góp Bang] Máy chủ xác nhận cống hiến Quân đoàn thành công.");
      if (this.sweepTimer) {
        clearTimeout(this.sweepTimer);
        this.sweepTimer = undefined;
      }
      this.sweepingBag = false;
    }
    else if (cmd === 0x14 && sub === 0x01) {
      this.io.log("debug", `[NPC] Đang tương tác đối thoại với NPC (len=${f.length}) hex=${f.toString("hex")}`);
      if (Date.now() <= this.dialogAckUntil) {
        this.interactSeq++;
        this.lastDialogAt = Date.now();
        const dialogId = f.length >= 13 ? f[12] : (f.length >= 10 ? f[9] : 0);
        this.ackDialog(`câu thoại ${dialogId}`);
      }
    }
    else if (cmd === 0x14 && sub === 0x07 && f.length === 9 && Date.now() <= this.dialogAckUntil) {
      // Cổng DỊCH CHUYỂN trong Ngày Tàn Hoạn Quan (pcap phobandoi_02 56.5s/92.5s): `06/02`+`14/07`+`0c/00` rồi client đáp ĐÚNG 1 `14/06` ⇒ server `14/08 00 2a`. Thiếu ack này server
      // vẫn "chờ" và lờ NPC kế tiếp (log thật: bấm NPC 5 sau cổng 2 ⇒ im lặng 3 lần).
      this.lastTeleportAt = Date.now();
      this.ackDialog("cổng dịch chuyển (14/07)");
    }
    else if (cmd === 0x06 && sub === 0x02 && Date.now() <= this.dialogAckUntil) {
      this.interactSeq++;
      // 06/02 là cờ mở hộp thoại tương tác, trong phó bản đơn và pcap thật luôn đi liền trước 14/01 (nội dung thoại).
      // Client chỉ cần đáp 14/06 cho câu thoại 14/01; không gửi ack riêng cho 06/02 để tránh thừa gói gây kick mã 47.
    }
    else if (cmd === 0x14 && sub === 0x0d && Date.now() <= this.dialogAckUntil) {
      // Log thật 14:03: hết trận phó bản server đẩy `14/0d` (len 9) rồi CHỜ — không có câu thoại 14/01 như pcap chupt_pbteam ⇒ bot treo. Đáp 14/06 (client thật đáp 14/06 ~1.5s sau khi hết trận) và canh lại.
      this.ackDialog("hết trận (14/0d)");
      this.startResultWatch();
    }
    else if (cmd === 0x14 && sub === 0x10 && Date.now() <= this.dialogAckUntil) {
      // Phó bản đơn Săn Kho Báu (pcap Phobandon Sankhobau.pcap 1037.45s): server đẩy 14/10 sau 16/03 và client đáp 14/06
      this.ackDialog("kết quả tương tác (14/10)");
    }
    else if (cmd === 0x2f && sub === 0x0c) {
      // Phó bản đơn hoàn thành (pcap Phobandon Sankhobau.pcap 1154.51s): server gửi 2f/0c và client đáp 14/06
      this.io.log("info", "🎉 [Phó bản đơn] Máy chủ xác nhận hoàn thành phó bản (2f/0c)!");
      this.dungeonRoomPacket(sub, f);
      this.ackDialog("hoàn thành phó bản (2f/0c)");
    }
    else if (cmd === 0x16 && sub === 0x01 && f.length >= 11) {
      // Ẩn / xoá thực thể khỏi map (vd rương báu biến mất sau khi nhặt xong: pcap 1039.09s 16/01)
      const idx = f.readUInt16LE(9);
      this.mapNpcs.delete(idx);
    }
    else if (cmd === 0x16 && sub === 0x03 && f.length === 13) {
      this.interactSeq++;
      this.ackDialog(`kết quả ${f[9]}`);
    }
    else if (cmd === 0x14 && sub === 0x09) {
      if (isBankMap(this.location.map)) {
        this.setBankOpen(true);
        this.io.game("🏦 Đã mở kho Tiền Trang thành công.");
      } else {
        this.io.log("debug", `[Tương tác 14/09] Máy chủ phản hồi xác nhận trạng thái (map ${this.location.map}).`);
      }
    }
    else if (cmd === 0x57 && sub === 0x02 && f.length >= 11) {
      if (f[9] === 0x03) this.onlineRewardReply(f);
      else this.checkinReply(f);
    }
    else if (cmd === 0x57 && sub === 0x03 && f.length >= 28) this.offlineExpInfo(f);
    else if (cmd === 0x44 && sub === 0x01 && f.length >= 10) { if (f[9] !== 0) { this.pendingGate = undefined; this.io.game(MSG.teleportFailed(f[9]!)); } }
    else if (cmd === 0x03 && sub === 0x00 && this.uid && f.length >= 54 && f.subarray(9, 17).equals(this.uid)) this.selfSpawn(f);
    else if (cmd === 0x03 && sub === 0x00 && f.length >= 54) this.playerSpawn(f);
    else if (cmd === 0x0c && sub === 0x00 && f.length >= 23) this.party.onStatus(f); // người khác đổi map (xem PartyTracker.onStatus)
    else if (cmd === 0x0d) this.partyPacket(sub, f);
    else if (cmd === 0x2f) this.dungeonRoomPacket(sub, f);
    else if (cmd === 0x14 && sub === 0x0c) {
      this.battleStart();
    }
    else if (cmd === 0x0b && sub === 0x00) {
      this.io.log("info", "⚔️ [Chiến đấu] Máy chủ xác nhận kết thúc trận đấu (0b/00).");
      this.battleEnd();
    }
    else if (cmd === 0x0b && sub === 0x05 && f.length >= 26) this.battleSpawn(f);
    else if (cmd === 0x0b && sub === 0xfa && f.length >= 50) this.battleSpawnPlayer(f);
    else if (cmd === 0x33 && sub === 0x01 && f.length >= 10) this.battleStatus(f);
    else if (cmd === 0x34 && sub === 0x01) this.battleTurn();
    else if (cmd === 0x35 && sub === 0x05) { /* ack lượt đánh */ }
    else if (cmd === 0x32 && sub === 0x01 && f.length >= 20) this.battleEffect(f);
    else if (cmd === 0x00 && sub === 0x00) {
      const code = f.includes(0x2c) ? 0x2c : (f.length >= 10 ? f[9] : undefined);
      let desc = `mã ${code}`;
      if (code === 0x2c) desc = "Thao tác chuyển map quá nhanh / chống flood (mã 44)";
      else if (code === 0x13 || code === 19) desc = "Tài khoản được đăng nhập ở nơi khác / Trùng phiên (mã 19)";
      else if (code === 0x2a) desc = "Lệnh thao tác không hợp lệ / sai lượt (mã 42)";
      else if (code === 0x05) desc = "Thao tác ngoài cự ly cho phép (mã 5)";
      else if (code === 0x2f) desc = "Thao tác sai trạng thái / trùng lặp ack (mã 47)";
      this.io.game(`⚠️ Server ngắt kết nối: ${desc}`);
      this.io.log("warn", `[KICK 00/00] Server ngắt kết nối (${desc}) hex=${f.toString("hex")}`);
    }
    else if (cmd === 0x14 && sub === 0x08) {
      this.stopResultWatch();
      this.lastChainRx = Date.now();
      this.cancelPendingAcks(); // chuỗi đã kết thúc/được server chốt — bỏ các ack còn xếp hàng (tránh ack thừa)
      if (!this.inBattle && f.length >= 10 && ![0x00, 0x1e, 0x2a, 0x47].includes(f[9]!)) {
        this.doorRejected = f[9];
      }
      if (f.length >= 10 && f[9] === 0x2a) {
        this.interactSeq++;
        this.setBankOpen(false);
        this.io.log("info", "💾 [Tiền Trang] Máy chủ đã cam kết lưu dữ liệu kho thành công.");
      }
      // Không đóng cờ trận bằng 14/08 nếu trận vừa bắt đầu (turn = 0) và quái địch còn sống nguyên (đây là 14/08 đóng thoại mở màn).
      // Chỉ kết thúc trận nếu đã đánh (turn > 0) hoặc toàn bộ quái địch đã chết/thoát hoặc server gửi mã thoát 0x00.
      if (this.inBattle) {
        const enemiesAlive = this.battleUnits.some((u) => u.isEnemy && u.hp.cur > 0);
        const isPremature = enemiesAlive && this.battleTurnIndex === 0 && f[9] !== 0x00;
        if (!isPremature) {
          this.battleEnd();
        }
      }
    }
    else if (cmd === 0x14 && sub === 0x07) { /* ack qua cổng thành công */ }
    else if (cmd === 0x16 && sub === 0x04 && f.length >= 11) this.parseNpcList(f);
    else if (cmd === 0x16 && sub === 0x02 && f.length >= 15) this.parseNpcMove(f);
    else if (cmd === 0x16 && sub === 0x06 && f.length >= 12) this.parseNpcStatus(f);
    else known = false;
    if (known) this.logStat(op, f);
    else if (!NOISY.has(op)) this.scanExp(op, f);
  }

  /** Log hex các gói đổi chỉ số/EXP/ví (ngắn, hiếm) để đối chiếu chuỗi hex khi đứng Dị giới hoặc train quái. */
  private logStat(op: string, f: Buffer) {
    if (["08/0e", "08/02", "23/05", "1a/04"].includes(op)) this.io.log("info", `[PKT ${op}] len=${f.length} ${f.toString("hex")}`);
    else if (op === "02/0a") this.io.log("debug", `[SYS 02/0a] ${f.toString("hex")}`);
  }

  /**
   * Dò gói CHƯA GIẢI MÃ có chứa u32 nằm trong khoảng exp tích luỹ của level hiện tại (nhân vật/võ tướng) và khác giá trị đã biết
   * → rất có thể là gói thưởng exp sau trận / tick Dị giới. Chỉ log hex + offset, KHÔNG sửa state.
   */
  private scanExp(op: string, f: Buffer) {
    if (f.length > 300 || !this.scanArmed) return;
    for (const [who, curves] of [["player", PLAYER_CURVES], ["pet", PET_CURVES]] as const) {
      const last = this.lastRawExp[who], lvl = this[who].level;
      if (last == null || !lvl) continue;
      for (const w of expWindows(lvl, curves)) {
        for (let i = 9; i + 4 <= f.length; i++) {
          const v = f.readUInt32LE(i);
          // exp chỉ tăng; mức tăng hợp lý ≤ 60.000/lần; loại giá trị "tròn" (≥2 byte 0) hay trùng ngẫu nhiên như 0x02000000.
          if (v >= w.lo && v < w.hi && v > last && v - last <= 60_000 && zeroBytes(v) <= 1) {
            this.io.log("info", `[EXP?] ${who === "player" ? "Char" : "Pet"} ứng viên trong ${op} off=${i} raw=${v} (${v - last >= 0 ? "+" : ""}${v - last} so với lần cuối) hex=${f.toString("hex")}`);
            return;
          }
        }
      }
    }
  }

  /**
   * 05/03 — chỉ số nhân vật. Đối chiếu tool gốc: HP 200/400, SP 180/220 → khối đầu là HIỆN TẠI, khối sau là TỐI ĐA.
   * u32@10=HP hiện tại, u32@14=SP hiện tại; u32@46=HP tối đa, u16@50=SP tối đa.
   * f[28] = level (3 → 120 khớp). f[9] luôn =3, không phải level. Exp% chưa tính được: gói chỉ có exp thô, thiếu bảng exp theo level.
   */
  private playerStats(f: Buffer) {
    this.player = {
      ...this.player,
      level: f[28]!,
      hp: { cur: f.readUInt32LE(10), max: f.readUInt32LE(46) },
      sp: { cur: f.readUInt32LE(14), max: f.readUInt16LE(50) },
    };
    if (f.length >= 37) this.io.patchState({ point: f.readUInt16LE(35) }); // điểm tiềm năng chưa cộng (cap: 238 = "Point: 238" của tool gốc)
    let foundSkills: SkillInfo[] = [];
    for (let cOff = 80; cOff < f.length - 8; cOff++) {
      const count = f.readUInt16LE(cOff);
      if (count >= 1 && count <= 50 && cOff + 2 + count * 3 <= f.length) {
        let valid = true;
        const temp: SkillInfo[] = [];
        for (let i = 0; i < count; i++) {
          const sOff = cOff + 2 + i * 3;
          const sId = f.readUInt16LE(sOff);
          const lv = f[sOff + 2]!;
          if (sId >= 10001 && sId <= 25000 && lv >= 1 && lv <= 20) {
            const sDef = (skillDataRaw as Record<string, any>)[String(sId)];
            temp.push({
              id: sId,
              name: sDef?.name ?? `Kỹ năng ${sId}`,
              desc: sDef?.desc ?? "",
              level: lv,
              sp: sDef?.sp ?? 0,
            });
          } else {
            valid = false;
            break;
          }
        }
        if (valid && temp.length === count) {
          foundSkills = temp;
          break;
        }
      }
    }
    if (foundSkills.length > 0) {
      this.playerSkills = foundSkills;
      this.io.patchState({ playerSkills: foundSkills });
    }
    this.lastRawExp.player = f.readUInt32LE(29);
    this.player = this.applyExp(this.player, f.readUInt32LE(29), PLAYER_CURVES, "nhân vật");
    this.io.log("info", `chỉ số: Lv ${this.player.level}, HP ${this.player.hp.cur}/${this.player.hp.max}, SP ${this.player.sp.cur}/${this.player.sp.max}`);
    this.io.patchState({ player: this.player });
  }

  /** Mã thuộc tính trong họ gói 08/xx: 0x0124 = EXP tích luỹ (u32). Server đẩy mỗi ~60s (+6000 nhân vật, +2000 võ tướng). */
  private static readonly PROP_EXP = 0x0124;
  private lastRawExp: Record<"player" | "pet", number | undefined> = { player: undefined, pet: undefined };

  /**
   * 08/0e (nhân vật): u16@9 = mã thuộc tính, u32@11 = giá trị.  08/02 (võ tướng): u16@12 = mã, u32@14 = giá trị.
   * Đối chiếu live: raw EXP tăng đúng bằng số exp trong thông báo hệ thống (02/0a) "+6000"/"+2000".
   */
  private propUpdate(who: "player" | "pet", prop: number, value: number, petIdx?: number) {
    if (prop !== TsOnlineSession.PROP_EXP) return;
    if (who === "pet" && petIdx != null) {
      // 08/02 `00 04 <idx> 00 <mã u16> <giá trị u32>`: idx = số thứ tự võ tướng trong túi (1..n), KHÔNG chỉ riêng pet xuất chiến
      const rec = this.roster.find((r) => r.idx === petIdx);
      if (rec) {
        const prevExp = rec.exp;
        rec.exp = value;
        const gained = prevExp > 0 ? value - prevExp : 0;
        this.lapBaResolve?.({ ok: true, expGained: gained });
        if (rec !== this.activePet()) {
          this.publishPets();
          const pName = (npcNames as Record<string, string>)[String(rec.model)] ?? `#${rec.model}`;
          this.io.game(`✨ [Xu Lạp Bá] Võ tướng ${pName} (slot ${petIdx}) nhận được ${gained > 0 ? `+${gained.toLocaleString("vi-VN")} ` : ""}exp!`);
          this.io.log("info", `[Xu Lạp Bá] Võ tướng ${pName} (slot ${petIdx}) nhận exp: ${value.toLocaleString("vi-VN")}${gained > 0 ? ` (+${gained.toLocaleString("vi-VN")})` : ""}`);
          return;
        }
      }
    }
    const u = this[who];
    if (!u.name && !u.level) return; // chưa có snapshot
    const prev = this.lastRawExp[who];
    this.lastRawExp[who] = value;
    const next = this.applyExp(u, value, who === "player" ? PLAYER_CURVES : PET_CURVES, who === "player" ? "nhân vật" : "võ tướng");
    this[who] = next;
    this.io.patchState(who === "player" ? { player: next } : { pet: next });
    if (who === "pet") this.publishPets();
    this.io.game(MSG.exp(next.name || (who === "player" ? "Nhân vật" : "Võ tướng"), prev == null ? null : value - prev, next.exp, next.expCur, next.expMax));
    this.io.log("info", `[EXP Update] ${who === "player" ? "Char" : "Pet"}: ${prev == null ? "" : `+${(value - prev).toLocaleString("vi-VN")} exp `}(${next.exp.toFixed(2)}%)${next.expCur != null ? ` ${next.expCur.toLocaleString("vi-VN")}/${next.expMax!.toLocaleString("vi-VN")}` : ""}`);
  }

  /** 07/00 của chính nhân vật: u16@17 = map, u16@19 = x, u16@21 = y. */
  /** 0c/00 của mình = trạng thái sau khi đổi map. Nếu vừa gửi teleport tới cổng này thì báo thành công thay cho dòng "Đổi map" chung. */
  private arrived(f: Buffer) {
    const gate = this.pendingGate;
    this.pendingGate = undefined;
    if (gate && f.readUInt16LE(17) === gate.id) {
      this.io.game(MSG.teleported(gate.city, gate.id));
      this.moved(f, true);
    } else this.moved(f);
  }

  /**
   * CHUỖI ĐỐI THOẠI/TRẬN của phó bản đội (pcap chupt_pbteam, 66–78s): qua cổng 14/08 xong server đẩy 9 câu thoại S→C `14/01 00 00 00 00 <idx> …` (len 24);
   * client PHẢI đáp mỗi câu bằng C→S `14/06 00` thì câu kế mới tới — câu thứ 9 được đáp ⇒ vào trận (0b/fa, 35/01…). Sau trận server đẩy `16/03 00 <idx> 00 d0 07`
   * + `14/10` (kết quả từng người) và cũng chờ `14/06`; hết thì `14/08 00 2a`. Bot chỉ tự đáp trong CỬA SỔ sau khi script qua cổng/bấm NPC (dialogAckUntil).
   */
  /** NPC phó bản đang được `click_boss` theo dõi: log mọi lần server báo vị trí mới (16/02, 16/04) để chẩn đoán mã 0x27. */
  private watchNpc?: number;
  /** Danh sách NPC của map (16/04) + roster đội (0d/06) trong phó bản CHỈ được server gửi khi client gửi `0c/01 00` ("làm mới trạng thái") — client thật gửi ngay sau cổng 1
   *  (pcap completed_phoban_khanvang_chupt: `14/08 00 01 00` 30.736s → `0c/01` 31.091s → `16/04` 28 NPC + `0d/06` ×2 + `0d/0b` 31.188s). Thiếu bước này server không biết NPC 20 đã "hiển thị" với
   *  client ⇒ câu thoại hiện ra nhưng đáp thoại bị `14/08 00 27` (log thật 13:41–16:15: không bao giờ có 16/04 sau khi vào map 62002). */
  /**
   * Sau khi gửi cổng/bấm NPC trong phó bản: chờ server NHẬN (đặt lại vị trí 0c/00 HOẶC mở chuỗi thoại 06/02 + 14/01; từ chối = 14/08 mã ≠ 0/2a), rồi — vì mỗi checkpoint là
   * chuỗi thoại → TRẬN — chờ trận bắt đầu (≤40s, đủ để đáp ~9 câu thoại) và chờ hết trận + chuỗi kết quả trước khi bước kế. Trả "ok" | "rejected" | "silent".
   */
  private lastTeleportAt = 0;
  private lastDialogAt = 0;
  private async awaitEncounter(label: string, signal: AbortSignal, seq: number, iseq: number): Promise<"ok" | "rejected" | "silent"> {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const t0 = Date.now();
    while (this.locSeq === seq && this.interactSeq === iseq && this.doorRejected === undefined && Date.now() - t0 < 3000 && !signal.aborted) await sleep(100);
    if (this.doorRejected !== undefined) { this.io.log("warn", `[${label}] server TỪ CHỐI (mã ${this.doorRejected})`); return "rejected"; }
    if (this.lastTeleportAt >= t0 - 500 && this.lastDialogAt < t0 - 500) {
      this.io.log("info", `[${label}] dịch chuyển nội bộ (14/07) — vị trí mới (${this.location.x},${this.location.y}); đáp 14/06 rồi đi tiếp`);
      await sleep(1800);
      return "ok";
    }
    if (this.locSeq === seq && this.interactSeq === iseq) { this.io.log("warn", `[${label}] server không phản hồi trong 3s — lệnh lặp sẽ thử lại`); return "silent"; }
    // Cổng DỊCH CHUYỂN trong map (Ngày Tàn Hoạn Quan, cổng 2/4/6: server chỉ đặt lại vị trí 0c/00, KHÔNG có thoại/trận — pcap phobandoi_02): nghỉ chút rồi đi tiếp.
    if (this.interactSeq === iseq) { this.io.log("info", `[${label}] dịch chuyển nội bộ — vị trí mới (${this.location.x},${this.location.y})`); await sleep(1200); return "ok"; }
    // Bước vào map phó bản đơn không có trận ở cổng (Săn Kho Báu 62003..62006, Tìm Ba Đậu Yêu 62007..62010):
    if (label.startsWith("cổng") && this.location.map >= 62003 && this.location.map <= 62010) {
      // Chờ chuỗi đối thoại mở màn phó bản hoàn tất (kết thúc bằng 14/08 00 2a hoặc hết ack)
      const waitEnd = Date.now() + 5000;
      await sleep(200);
      while (Date.now() < Math.max(this.dialogAckNext + 300, this.lastChainRx + 400) && Date.now() < waitEnd && !signal.aborted) {
        await sleep(100);
      }
      this.io.log("info", `[${label}] đã vào map phó bản đơn ${this.location.map} và kích hoạt đối thoại mở màn`);
      await sleep(300);
      return "ok";
    }
    const startBy = Date.now() + 40_000;
    while (!this.inBattle && Date.now() < startBy && !signal.aborted && this.doorRejected === undefined) await sleep(250);
    const rej = this.doorRejected as number | undefined; // đổi bởi handle() trong lúc chờ
    if (!this.inBattle && rej !== undefined) { this.io.log("warn", `[${label}] đáp thoại bị từ chối (mã 0x${rej.toString(16)}) — không vào trận`); return "rejected"; }
    if (!this.inBattle) { this.io.log("info", `[${label}] không có trận trong 40s`); return "ok"; }
    this.io.log("info", `[${label}] vào trận — chờ hết trận`);
    const battleBy = Date.now() + 5 * 60_000;
    while (this.inBattle && Date.now() < battleBy && !signal.aborted) { this.openDialogWindow(30_000); await sleep(400); }
    // Sau trận server đẩy kết quả từng người, mỗi cái cần 14/06 (ackDialog tự đáp); chờ chúng xong.
    this.openDialogWindow(15_000);
    const endBy = Date.now() + 12_000;
    await sleep(1500);
    while (Date.now() < this.dialogAckNext + 1500 && Date.now() < endBy && !signal.aborted) await sleep(250);
    return "ok";
  }

  /** Bấm NPC như client thật: (phó bản đội / phó bản đơn) có danh sách NPC → gửi 14/01 00 <idx> → chờ thoại / sự kiện → kết quả. */
  private async npcInteract(npcId: number, write: (b: Buffer) => void, signal: AbortSignal): Promise<"ok" | "rejected" | "silent"> {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const isTeamDungeon = DUNGEON_ROOM_CATALOG.some((d) => d.map === this.location.map);
    const isSoloDungeon = this.location.map >= 62001 && this.location.map <= 62010;
    if (isTeamDungeon) {
      await this.requestNpcList(`trước khi tương tác NPC ${npcId}`, signal, npcId);
    }
    const seq = this.locSeq, iseq = this.interactSeq;
    this.openDialogWindow(15_000);
    this.doorRejected = undefined;
    if (isTeamDungeon) {
      this.npcAckDelayMs = 800; // client thật đáp câu thoại NPC sau ~0.6–1.2s
      this.io.log("info", `[NPC] Tương tác NPC ${npcId} (map ${this.location.map}) tại (${this.location.x},${this.location.y})`);
      write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08]))); // client thật luôn gửi trước 14/01 (thiếu ⇒ 14/08 00 27)
      write(encodeFrame(cmdBody(0x14, 0x01, [0x00, npcId & 0xff, (npcId >> 8) & 0xff])));
      try { return await this.awaitEncounter(`NPC ${npcId}`, signal, seq, iseq); } finally { this.npcAckDelayMs = 0; }
    }

    if (isSoloDungeon) {
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      const isChest = this.location.map >= 62003 && this.location.map <= 62006;
      const isDauDau = this.location.map >= 62007 && this.location.map <= 62010;

      if (isDauDau) {
        // Tìm Ba Đậu Yêu (Map 62007..62010): 3 con Ba Đậu Yêu, mỗi con click -> thoại -> VÀO TRẬN ĐẤU đánh thắng -> thoại sau trận
        this.io.game(`⚔️ [${this.player.name || "Nhân vật"}] Khiêu chiến Ba Đậu Yêu số ${npcId}...`);
        this.npcAckDelayMs = 250; // Chuẩn pcap thật & TSM BOT: cách nhau ~250-300ms
        this.openDialogWindow(60_000);
        this.doorRejected = undefined;
        // Gửi gói chọn mục tiêu tương tác 20/02 00 08 như client game thật (Phobandon Timbdy gói 471, 959, 1134)
        write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08])));
        await sleep(100);
        write(encodeFrame(cmdBody(0x14, 0x01, [0x00, npcId & 0xff, (npcId >> 8) & 0xff])));
        const res = await this.awaitEncounter(`Ba Đậu Yêu ${npcId}`, signal, seq, iseq);

        this.npcAckDelayMs = 0;
        return res;
      }

      // Săn Kho Báu (Map 62003..62006): Mở 3 bảo rương thuần thoại (06/02, 16/03, 18/01, 14/01)
      const label = "bảo rương";
      this.io.game(`🔍 [${this.player.name || "Nhân vật"}] Đang mở ${label} số ${npcId}...`);
      this.npcAckDelayMs = 60; // TSM BOT ack đối thoại tức thì (~60ms)
      let gotResponse = false;

      for (let attempt = 1; attempt <= 3 && !gotResponse && !signal.aborted; attempt++) {
        const curIseq = this.interactSeq;
        this.openDialogWindow(15_000);
        write(encodeFrame(cmdBody(0x14, 0x01, [0x00, npcId & 0xff, (npcId >> 8) & 0xff])));

        const t0 = Date.now();
        while (this.interactSeq === curIseq && Date.now() - t0 < 2500 && !signal.aborted) await sleep(50);

        if (this.interactSeq > curIseq) {
          gotResponse = true;
          const waitEnd = Date.now() + 6000;
          while (Date.now() < Math.max(this.dialogAckNext + 300, this.lastChainRx + 500) && Date.now() < waitEnd && !signal.aborted) {
            await sleep(100);
          }
          await sleep(200);
        } else if (attempt < 3 && !signal.aborted) {
          this.io.game(`🔄 [${this.player.name || "Nhân vật"}] Thử tương tác lại ${label} số ${npcId} (lần ${attempt + 1}/3)...`);
          await sleep(500);
        }
      }

      if (gotResponse) {
        this.io.game(`✨ [${this.player.name || "Nhân vật"}] Hoàn tất tương tác với ${label} số ${npcId}!`);
      } else {
        this.io.game(`⚠️ [${this.player.name || "Nhân vật"}] Không nhận được phản hồi đối thoại ${label} số ${npcId}.`);
      }
      this.npcAckDelayMs = 0;
      return gotResponse ? "ok" : "rejected";
    }

    this.io.game(`💬 [${this.player.name || "Nhân vật"}] Tương tác NPC số ${npcId}...`);
    this.npcAckDelayMs = 450;
    write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08])));
    await sleep(100);
    write(encodeFrame(cmdBody(0x14, 0x01, [0x00, npcId & 0xff, (npcId >> 8) & 0xff])));

    const t0 = Date.now();
    while (this.interactSeq === iseq && Date.now() - t0 < 3000 && !signal.aborted) await sleep(100);
    const waitEnd = Date.now() + 8000;
    while (Date.now() < Math.max(this.dialogAckNext + 400, this.lastChainRx + 800) && Date.now() < waitEnd && !signal.aborted) {
      await sleep(150);
    }
    await sleep(600);
    this.npcAckDelayMs = 0;
    return "ok";
  }

  private async requestNpcList(why: string, signal: AbortSignal, waitFor?: number): Promise<boolean> {
    const have = () => (waitFor !== undefined ? this.mapNpcs.has(waitFor) : this.mapNpcs.size > 0);
    if (have()) return true;
    this.io.log("info", `[Phó bản] tx 0c/01 00 (xin danh sách NPC/đội — ${why})`);
    this.io.send(encodeFrame(cmdBody(0x0c, 0x01, [0x00])));
    const until = Date.now() + 3000;
    while (!have() && Date.now() < until && !signal.aborted) await new Promise((r) => setTimeout(r, 100));
    return have();
  }
  /** Mỗi gói S→C của chuỗi thoại/kết quả chỉ được đáp ĐÚNG MỘT `14/06` (pcap chupt_phoban01: số ack = số gói, kết thúc `14/08 00 2a` không còn ack thừa). Ack thừa ⇒ server đáp `14/08 00 26`
   *  ("không có gì chờ") và (nghi) làm lệch trạng thái thoại ⇒ thoại NPC kế tiếp bị `14/08 00 27`. Ack xếp hàng được huỷ khi nhận `14/08`; canh lại chỉ khi server im lặng. */
  private ackTimers = new Set<ReturnType<typeof setTimeout>>();
  private lastChainRx = 0;
  /** Độ trễ ack tối thiểu (ms) cho câu thoại NPC vừa bấm: pcap — client thật đáp ~1.2s/1.0s sau câu 1/2 của Trương Giác (ngân hàng ~0.8s); chuỗi cổng/kết quả đáp nhanh ~0.1–0.45s. Đặt bởi click_boss. */
  private npcAckDelayMs = 0;
  private cancelPendingAcks() { for (const t of this.ackTimers) clearTimeout(t); this.ackTimers.clear(); this.dialogAckNext = 0; }
  private dialogAckUntil = 0;
  private dialogAckNext = 0;
  /** Tăng mỗi lần server báo cổng/NPC được nhận (06/02 hoặc câu thoại 14/01) — để `warp_id` biết cổng đã được chấp nhận. */
  private interactSeq = 0;
  /** Mã trả lời gần nhất của server cho gói cổng (14/08 khi KHÔNG ở trong trận; 00 = ok, 04 = từ chối…). */
  private doorRejected?: number;

  private resultWatch?: ReturnType<typeof setInterval>;
  /** Sau hết trận phó bản: server chỉ kết thúc (14/08) khi nhận đủ 14/06 — nếu chuỗi 16/03 không tự chạy thì gửi lại 14/06 mỗi 1.5s (tối đa 8 lần) cho tới khi 14/08. */
  private startResultWatch() {
    this.stopResultWatch();
    let tries = 0;
    this.resultWatch = setInterval(() => {
      if (!this.inBattle) { this.stopResultWatch(); return; }
      if (Date.now() - this.lastChainRx < 3000) return; // chuỗi đang chạy bình thường (server vẫn gửi thoại/kết quả) ⇒ KHÔNG gửi ack thừa
      if (++tries > 3) {
        // Server không đáp thêm: trận đã hết (đã thấy 08/02 + 14/0d) nhưng không có 14/08 ⇒ tự đóng cờ trận để script/chuỗi cổng đi tiếp, không treo.
        this.io.log("warn", "[Phó bản] hết trận nhưng server không gửi 14/08 sau 3 lần 14/06 — tự đóng cờ trận");
        this.stopResultWatch();
        this.battleEnd();
        return;
      }
      this.io.log("info", `[Phó bản] tx 14/06 00 (canh kết quả trận khi server im lặng ≥3s, lần ${tries}/3)`);
      this.io.send(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
    }, 1500);
  }
  private stopResultWatch() { if (this.resultWatch) { clearInterval(this.resultWatch); this.resultWatch = undefined; } }

  private openDialogWindow(ms = 45_000) { this.dialogAckUntil = Math.max(this.dialogAckUntil, Date.now() + ms); }

  /** Đáp `14/06 00` cho câu thoại/kết quả vừa nhận (cách nhau ≥450ms như client thật ~0.13–0.6s giữa các ack, hoặc ~60ms khi trong phó bản đơn). */
  private ackDialog(why: string) {
    if (Date.now() > this.dialogAckUntil) return;
    this.dialogAckUntil = Date.now() + 20_000;
    const delay = this.npcAckDelayMs > 0 ? this.npcAckDelayMs : 450;
    const at = Math.max(Date.now() + delay, this.dialogAckNext);
    this.dialogAckNext = at + delay;
    this.lastChainRx = Date.now();
    const t = setTimeout(() => {
      this.ackTimers.delete(t);
      this.io.log("info", `[Phó bản] tx 14/06 00 (đáp ${why})`);
      this.io.send(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
    }, at - Date.now());
    this.ackTimers.add(t);
  }

  /** Tăng mỗi lần server đặt lại vị trí (0c/00: đổi map, qua cổng, teleport) — để chờ "đã tới nơi" sau khi bước qua cổng. */
  private locSeq = 0;
  /** `warp_id` gần nhất đã bước qua cổng thành công (server đặt lại vị trí) — để lệnh lặp y hệt (TSM viết 2 dòng giống nhau để chống trận chen ngang) không đi ngược lại. */
  private lastDoor?: { door: number; map: number; at: number };

  private moved(f: Buffer, quiet = false) {
    const map = f.readUInt16LE(17);
    const mapChanged = !!(this.location.map && map !== this.location.map);
    if (!quiet && mapChanged) {
      this.io.game(MSG.mapChanged(this.location.map, map));
      this.mapChannelStatuses.clear();
      this.knownChannels.clear();
      this.knownChannels.add(0);
      this.nonExistentChannels.clear();
    }
    if (mapChanged) this.mapNpcs.clear();
    // Đọc kênh thực tế: gói 0c/00 (len >= 27) chứa uint16 LE @25 (1-based: 1, 2, ...; pcap Chuyen Kenh.pcap 23.36s, 28.48s)
    let channel = this.location.channel;
    const oldChannel = this.location.channel;
    if (f.length >= 27) {
      const chRaw = f.readUInt16LE(25);
      if (chRaw > 0) channel = chRaw - 1; // đổi 1-based thành 0-based cho UI
    } else if (f.length >= 24) {
      channel = f[23]!; // fallback gói mock cũ
    } else if (this.pendingChannel !== undefined) {
      channel = this.pendingChannel;
    }
    const channelChanged = channel !== oldChannel;
    this.pendingChannel = undefined;

    // Giữ lại channels hiện có từ 07/01 nếu có, hoặc build tạm nếu chưa nhận được
    const channels = this.location.channels && this.location.channels.length > 0
      ? this.location.channels
      : this.buildMapChannels(map, channel);
    this.location = { ...this.location, map, x: f.readUInt16LE(19), y: f.readUInt16LE(21), channel, channels };
    this.locSeq++;
    this.io.patchState({ location: this.location });

    if (channelChanged && !mapChanged) {
      this.io.game(`📡 [Kênh] Đã chuyển sang Kênh ${channel + 1} thành công.`);
    }

    for (const cb of this.mapWaiters) {
      try { cb(this.location.map); } catch {}
    }
    if (this.chaseConfig.enabled && this.location.map === this.chaseConfig.mapId) {
      this.scheduleChaseCheck(1200);
    }
    if (this.autoMove.enabled && this.location.map === this.autoMove.mapId) {
      this.scheduleAutoMove(1200);
    }

    // Xin danh sách kênh của map mới hoặc sau khi đổi kênh (như client thật)
    if (mapChanged || channelChanged) {
      setTimeout(() => this.requestChannelList(), 300);
    }
  }

  /** Yêu cầu danh sách kênh map hiện tại (C→S 07/01 00: pcap Chuyen Kenh.pcap 21.19s, 27.00s) */
  private requestChannelList() {
    if (this.location.map >= 62001 && this.location.map <= 62020) return; // phó bản không có kênh
    this.io.send(encodeFrame(cmdBody(0x07, 0x01, [0x00])));
  }

  /**
   * Phản hồi danh sách kênh từ máy chủ (S→C 07/01: pcap Chuyen Kenh.pcap 21.31s, 27.14s)
   * f[9] = count (u8)
   * mỗi bản ghi 6 bytes từ f[10]:
   * - channelId: u16 LE (1-based: 1, 2, ...)
   * - curPlayers: u16 LE (số người chơi hiện tại)
   * - maxPlayers: u16 LE (sức chứa tối đa, vd 20)
   */
  private channelListReply(f: Buffer) {
    if (f.length < 10) return;
    const count = f[9]!;
    const channels: import("@tsbot/protocol").MapChannelInfo[] = [];
    this.knownChannels.clear();
    this.mapChannelStatuses.clear();
    for (let i = 0; i < count; i++) {
      const off = 10 + i * 6;
      if (off + 6 > f.length) break;
      const chNum = f.readUInt16LE(off);
      const cur = f.readUInt16LE(off + 2);
      const max = f.readUInt16LE(off + 4);
      const id = chNum - 1; // 0-based cho UI
      let status: import("@tsbot/protocol").ChannelStatus = "free";
      if (max > 0) {
        if (cur >= max) status = "full";
        else if (cur >= Math.floor(max * 0.7)) status = "busy";
        else status = "free";
      }
      this.knownChannels.add(id);
      this.mapChannelStatuses.set(id, status);
      channels.push({
        id,
        name: `Kênh ${chNum}`,
        status,
        cur,
        max,
      });
    }
    // Đảm bảo kênh hiện tại luôn hiện diện trong danh sách
    if (channels.length === 0) {
      channels.push({
        id: this.location.channel,
        name: `Kênh ${this.location.channel + 1}`,
        status: "free",
      });
    } else if (!channels.some((c) => c.id === this.location.channel)) {
      channels.push({
        id: this.location.channel,
        name: `Kênh ${this.location.channel + 1}`,
        status: "free",
      });
    }
    channels.sort((a, b) => a.id - b.id);
    this.location = { ...this.location, channels };
    this.io.patchState({ location: this.location });
    this.io.log("info", `📡 [Kênh] Danh sách kênh map ${this.location.map}: ${channels.map((c) => `${c.name} (${c.cur ?? 0}/${c.max ?? 0} - ${c.status})`).join(", ")}`);
  }

  /**
   * `07/02` (S→C): server phản hồi đổi kênh:
   * - Chuẩn pcap thật: f.length = 10, f[9] = mã kết quả (00 = thành công, khác 00 = thất bại)
   * - Tương thích mock cũ: f.length >= 23 chứa trực tiếp vị trí mới
   */
  private channelChanged(f: Buffer) {
    if (f.length >= 23 && (!this.uid || f.subarray(9, 17).equals(this.uid))) {
      const oldCh = this.location.channel;
      const targetCh = f.length >= 27 ? Math.max(0, f.readUInt16LE(25) - 1) : (f.length >= 24 ? f[23]! : (this.pendingChannel ?? this.location.channel));
      this.pendingChannel = undefined;
      this.knownChannels.add(targetCh);
      this.nonExistentChannels.delete(targetCh);
      this.mapChannelStatuses.set(targetCh, "free");
      this.moved(f);
      const newCh = this.location.channel;
      if (newCh !== oldCh) {
        this.io.game(`📡 [Kênh] Đã chuyển sang Kênh ${newCh + 1} thành công.`);
      } else {
        this.io.game(`📡 [Kênh] Đang ở Kênh ${newCh + 1}.`);
      }
      return;
    }

    const code = f.length >= 10 ? f[9]! : 0;
    const targetCh = this.pendingChannel ?? this.location.channel;
    if (code === 0) {
      // Thành công chuẩn máy chủ thật: gói 0c/00 sẽ đến ngay sau đó
      this.io.log("info", `📡 [Kênh] Máy chủ chấp thuận chuyển sang Kênh ${targetCh + 1}.`);
      this.io.send(encodeFrame(cmdBody(0x0c, 0x01, [0x00]))); // C→S 0c/01 00 (sync state sau khi đổi kênh như pcap 24.42s)
    } else {
      this.pendingChannel = undefined;
      this.knownChannels.add(targetCh);
      this.mapChannelStatuses.set(targetCh, "full");
      this.location = {
        ...this.location,
        channels: this.buildMapChannels(this.location.map, this.location.channel),
      };
      this.io.patchState({ location: this.location });
      this.io.game(`⚠️ [Kênh] Chuyển sang Kênh ${targetCh + 1} thất bại: Kênh đã ĐẦY hoặc không khả dụng (mã ${code})!`);
      this.io.log("warn", `[Kênh] Server từ chối chuyển kênh (mã ${code}, payload=${f.toString("hex")})`);
      this.requestChannelList();
    }
  }

  private stepMoved(f: Buffer) {
    const x = f.readUInt16LE(18);
    const y = f.readUInt16LE(20);
    this.location = { ...this.location, x, y };
    this.io.patchState({ location: this.location });
  }

  /** Bộ dò exp chỉ bật sau chùm gói khởi tạo lúc đăng nhập (5s) để không báo nhầm. */
  private scanArmed = false;
  private warnedExp = new Set<string>();

  /**
   * Server chỉ gửi EXP TÍCH LŨY (u32); % tính theo bảng exp từng cấp (runtime/exp.ts, nguồn tsexp.pages.dev).
   * Turn (số lần chuyển sinh) không có trong packet → nhận diện theo đường cong khớp (raw, level).
   */
  private applyExp(u: import("@tsbot/protocol").UnitState, raw: number, curves: readonly string[], who: string): import("@tsbot/protocol").UnitState {
    let e = lookupExp(u.level, raw, curves);
    if (!e) {
      // Có thể vừa lên cấp: thử các level kế tiếp, chỉ nhận khi khớp bảng exp.
      for (let L = u.level + 1; L <= u.level + 3 && !e; L++) {
        const hit = lookupExp(L, raw, curves);
        if (hit) { e = hit; u = { ...u, level: L }; this.io.log("info", `[Level Up] ${who}: Lv ${L}`); this.io.game(MSG.levelUp(u.name || "Nhân vật", L)); }
      }
    }
    if (!e) {
      const key = `${who}${u.level}${raw}`;
      if (!this.warnedExp.has(key)) { this.warnedExp.add(key); this.io.log("warn", `không khớp bảng EXP: ${who} Lv ${u.level}, exp tích luỹ ${raw}`); }
      return u;
    }
    return withExp(u, e.cur, e.max);
  }

  /** Bộ đếm phía server (55/01): id → {val,max}. Vd 0x6b = ngày điểm danh (≤28), 0x6c = ngày liên tiếp (≤25), 0x1b = phút đã dùng ở Dị giới. */
  private counterMap = new Map<number, { val: number; max: number }>();
  private dijieOld?: number;
  /** Phản hồi của server cho `61/01` (mở Dị giới): 0 = vào được, 6 = đã ở trong, khác = từ chối (đã thấy mã 2). */
  private dijieReply?: number;
  private bagLoaded = false;
  private bag = new Map<number, { id: number; qty: number }>(); // ô túi → vật phẩm lần cuối thấy (tính số lượng nhận thêm)
  private bank = new Map<number, { id: number; qty: number }>(); // ô kho Tiền Trang
  private bankOpen = false; // Trạng thái phiên kho Tiền Trang đang mở với NPC
  /** Đội ngũ (opcode 0d/xx) — logic + ghi chú giao thức ở ./party.ts và docs/PARTY_KNOWLEDGE.md. */
  private party = new PartyTracker();
  /** Cấu hình tự chấp nhận do server đẩy xuống (set_party_config): lời mời từ `inviteFrom`, lời xin từ các tên trong `requestFrom`. */
  private partyAuto = { inviteFrom: "", requestFrom: [] as string[] };
  /** Cấu hình mục tiêu tổ đội và bỏ chạy khi chưa đủ đội ngũ (Bậc 2). */
  private partyTargetConfig = {
    role: "leader" as "leader" | "member",
    leaderName: "",
    members: [] as string[],
    escapeIfNotFullParty: false,
  };
  private partyStatus = "";
  private autoLists = {
    discard: new Set<number>(),
    autoOpen: new Set<number>(),
    resolve: new Set<number>(),
    contribute: new Set<number>(),
    combine: new Set<number>(),
    sell: new Set<number>(),
    toggles: {
      discard: true,
      autoOpen: true,
      combine: true,
      resolve: true,
      contribute: true,
      sell: false,
      exception: true,
    } as Record<string, boolean>,
  };
  private lastCombinedDate?: string;
  private sweepingBag = false;
  private sweepTimer?: ReturnType<typeof setTimeout>;
  private autoSweepTimer?: ReturnType<typeof setInterval>;
  private autoSweepEnabled = false;
  private sweepAttempts = new Map<string, number>();
  private mapWaiters = new Set<(map: number) => void>();
  private autoHeal: AutoHealConfig = {
    enabled: true,
    player: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
    pet: { autoHp: false, hpPct: 50, autoSp: false, spPct: 50 },
    slots: {},
  };
  private lastAutoHealAt = 0;
  private autoHealRunning = false;
  private pendingCheckinDay?: number;

  private startPeriodicAutoSweep() {
    this.stopPeriodicAutoSweep();
    this.autoSweepTimer = setInterval(() => {
      if (!this.autoSweepEnabled || this.inBattle) return;
      this.sweepAttempts.clear();
      this.io.log("info", "⏱️ [Auto Quét 1 Phút] Đang quét và kiểm tra thùng đồ cá nhân...");
      this.triggerAutoSweep(false);
      this.triggerAutoHeal(false);
    }, 60_000);
  }

  private stopPeriodicAutoSweep() {
    if (this.autoSweepTimer) {
      clearInterval(this.autoSweepTimer);
      this.autoSweepTimer = undefined;
    }
  }

  logout(): Buffer | null {
    this.stopPeriodicAutoSweep();
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    return encodeFrame(cmdBody(0x01, 0x01, [0x00]));
  }
  private pendingGate?: { id: number; city: string };
  private xu = 0;
  private gold = 0;
  private walletSeen = { xu: false, gold: false };
  private onGoldEarned?: (amount: number) => void;
  private onGoldSpent?: (amount: number) => void;

  private setXu(xu: number) {
    if (this.walletSeen.xu && xu !== this.xu) this.io.game((xu > this.xu ? MSG.xuUp : MSG.xuDown)(Math.abs(xu - this.xu), xu));
    this.walletSeen.xu = true;
    this.xu = xu;
  }

  /** 23/05 — u32@9 = Vàng (100→300 khớp tool gốc). Xu nằm ở gói riêng 1a/04 (u32@9: 101500 khớp). */
  private wallet(f: Buffer) {
    const gold = f.readUInt32LE(9);
    if (this.walletSeen.gold && gold !== this.gold) this.io.game((gold > this.gold ? MSG.goldUp : MSG.goldDown)(Math.abs(gold - this.gold), gold));
    this.walletSeen.gold = true;
    this.gold = gold;
    this.io.patchState({ economy: { gold: this.gold, xu: this.xu } });
  }

  /**
   * 0f/08 — danh sách võ tướng mang theo: `f[9]` = số lượng, rồi từng bản ghi (đối chiếu pcap 3 pet Lv86/151/71):
   * `idx u8 | model u16 | exp u32 | level u8 | HP u32 | SP u16 | 6×u16 chỉ số GỐC (int, atk, def, agi, hp, sp — đối chiếu Ma Quan Vũ 66/189/89/102/85/60) | … | byte 27 = fai (độ trung thành) | … | byte thứ 31 = độ dài tên Big5 | tên | …`,
   * độ dài bản ghi = 254 + độ dài tên. Pet nào đang XUẤT CHIẾN do gói `13/04` (u16 model) cho biết.
   */
  private petStats(f: Buffer) {
    const roster: typeof this.roster = [];
    let pos = 10;
    for (let i = 0; i < f[9]!; i++) {
      if (pos + 32 > f.length) break;
      const len = 254 + f[pos + 31]!;
      if (pos + len > f.length) break;
      const level = f[pos + 7]!;
      const curHp = f.readUInt32LE(pos + 8);
      const curSp = f.readUInt16LE(pos + 12);
      const stats = {
        int: f.readUInt16LE(pos + 14), atk: f.readUInt16LE(pos + 16), def: f.readUInt16LE(pos + 18),
        agi: f.readUInt16LE(pos + 20), hp: f.readUInt16LE(pos + 22), sp: f.readUInt16LE(pos + 24), fai: f[pos + 27]!,
      };
      const prevPet = this.roster.find((r) => r.idx === f[pos]);
      const maxHp = prevPet?.maxHp ?? (stats.hp > 0 ? level * 10 + stats.hp * 6 : curHp);
      const maxSp = prevPet?.maxSp ?? (stats.sp > 0 ? level * 3 + stats.sp * 5 : curSp);

      const nameLen = f[pos + 31]!;
      const eqStart = pos + 32 + nameLen;
      const equippedItems: number[] = prevPet?.equippedItems ? [...prevPet.equippedItems] : [];
      if (eqStart + 3 <= pos + len) {
        equippedItems.length = 0;
        for (let s = 0; s < 6; s++) {
          const off = eqStart + 3 + s * 35;
          if (off + 2 <= f.length) {
            const itId = f.readUInt16LE(off);
            if (itId > 0) equippedItems.push(itId);
          }
        }
      }
      const isAwakened = prevPet?.isAwakened ?? ((f[pos + 29] ?? 0) > 0);

      roster.push({
        idx: f[pos]!, model: f.readUInt16LE(pos + 1), exp: f.readUInt32LE(pos + 3), level,
        gear: prevPet?.gear ?? this.pendingGear.get(f[pos]!) ?? { int: 0, atk: 0, def: 0, agi: 0 },
        equippedItems,
        isAwakened,
        hp: curHp, sp: curSp,
        maxHp, maxSp,
        stats,
      });
      pos += len;
    }
    if (!roster.length && f.length >= 24) {
      roster.push({
        idx: f[10]!, model: f.readUInt16LE(11), exp: f.readUInt32LE(13), level: f[17]!,
        hp: f.readUInt32LE(18), sp: f.readUInt16LE(22),
        maxHp: f.readUInt32LE(18), maxSp: f.readUInt16LE(22),
        gear: { int: 0, atk: 0, def: 0, agi: 0 },
        equippedItems: [],
        isAwakened: false,
      });
    }
    this.roster = roster;
    this.applyActivePet();
  }

  /**
   * 13/04 (server đẩy lúc login) và 13/01 (server xác nhận sau khi client gửi `13/01 00 <model>`): model của võ tướng xuất chiến.
   * Chỉ 1 võ tướng xuất chiến: chọn pet khác ⇒ pet cũ tự về trạng thái nghỉ (đối chiếu cap "Change_pet_xuat_chien").
   */
  private petActive(model: number, confirm = false) {
    this.activeModel = model;
    if (this.roster.length) this.applyActivePet();
    if (confirm) this.io.game(MSG.petOut((npcNames as Record<string, string>)[String(model)] ?? `#${model}`));
  }

  /** 13/02: server xác nhận cho võ tướng nghỉ (ngưng xuất chiến) - theo capture Ngung xuat chien slot 1 & Quay lap ba slot 1.pcap */
  private petRest() {
    const oldPet = this.activePet();
    this.activeModel = 0;
    this.applyActivePet();
    if (oldPet) {
      const name = (npcNames as Record<string, string>)[String(oldPet.model)] ?? `#${oldPet.model}`;
      this.io.game(`Võ tướng ${name} đã ngưng xuất chiến (về trạng thái nghỉ)`);
    }
  }

  private activePet() {
    return this.roster.find((r) => r.model === this.activeModel) ?? (this.activeModel == null ? this.roster[0] : undefined);
  }

  private petUnit(rec: (typeof this.roster)[number]): import("@tsbot/protocol").UnitState {
    const name = (npcNames as Record<string, string>)[String(rec.model)] ?? `#${rec.model}`;
    const maxHp = rec.maxHp ?? (rec.stats?.hp ? rec.level * 10 + rec.stats.hp * 6 : rec.hp);
    const maxSp = rec.maxSp ?? (rec.stats?.sp ? rec.level * 3 + rec.stats.sp * 5 : rec.sp);
    const u: import("@tsbot/protocol").UnitState = {
      name,
      element: PET_ELEMENT_BY_CODE[(npcElements as Record<string, number>)[String(rec.model)] ?? 0],
      level: rec.level,
      hp: { cur: rec.hp, max: maxHp },
      sp: { cur: rec.sp, max: maxSp },
      exp: 0,
    };
    const e = lookupExp(rec.level, rec.exp, PET_CURVES);
    return e ? withExp(u, e.cur, e.max) : u;
  }

  /** Đẩy danh sách võ tướng (kèm cờ xuất chiến và danh sách kỹ năng đầy đủ: gốc, Mê, VKCD) lên UI. */
  private publishPets() {
    const act = this.activePet();
    let pSkills: SkillInfo[] = [];
    if (act && act.model) {
      const prof = (petSkillProfilesRaw as Record<string, { base: number[]; awakened?: number; hasDirectAwakened?: boolean; vkcd?: { itemId: number; itemName: string; skillId: number } }>)[String(act.model)];
      const baseIds = prof?.base ?? (npcSkillsRaw as Record<string, number[]>)[String(act.model)] ?? [];

      // 1. Kỹ năng gốc (3 skill cơ bản) — luôn khả dụng
      for (const sId of baseIds) {
        const sDef = (skillDataRaw as Record<string, any>)[String(sId)];
        pSkills.push({
          id: sId,
          name: sDef?.name ?? `Kỹ năng ${sId}`,
          desc: sDef?.desc ?? "",
          sp: sDef?.sp ?? 0,
          type: "base",
          enabled: true,
        });
      }

      // 2. Kỹ năng học thêm (Mê võ tướng / Reborn)
      if (prof?.awakened) {
        const sId = prof.awakened;
        const sDef = (skillDataRaw as Record<string, any>)[String(sId)];
        const isAwakened = Boolean(prof.hasDirectAwakened || act.isAwakened);
        pSkills.push({
          id: sId,
          name: sDef?.name ?? `Kỹ năng ${sId}`,
          desc: sDef?.desc ?? "",
          sp: sDef?.sp ?? 0,
          type: "awakened",
          enabled: isAwakened,
          disabledReason: isAwakened ? undefined : "Chưa học Mê",
        });
      }

      // 3. Kỹ năng từ Vũ Khí Chuyên Dụng (VKCD)
      if (prof?.vkcd) {
        const vkcd = prof.vkcd;
        const sId = vkcd.skillId;
        const sDef = (skillDataRaw as Record<string, any>)[String(sId)];
        const hasVkcd = act.equippedItems?.includes(vkcd.itemId) ?? false;
        pSkills.push({
          id: sId,
          name: sDef?.name ?? `Kỹ năng ${sId}`,
          desc: sDef?.desc ?? "",
          sp: sDef?.sp ?? 0,
          type: "exclusive_weapon",
          enabled: hasVkcd,
          disabledReason: hasVkcd ? undefined : `Chưa trang bị ${vkcd.itemName}`,
        });
      }
    }
    this.petSkills = pSkills;
    this.io.patchState({
      pets: this.roster.map((r) => ({ ...this.petUnit(r), idx: r.idx, model: r.model, active: r === act, stats: r.stats, gear: r.gear, equippedItems: r.equippedItems })),
      petSkills: this.petSkills,
    });
  }

  private applyActivePet() {
    const rec = this.activePet();
    if (!rec) { // không pet nào xuất chiến → thẻ pet ở Home về rỗng
      this.pet = { name: "", level: 0, hp: { cur: 0, max: 0 }, sp: { cur: 0, max: 0 }, exp: 0 };
      this.lastRawExp.pet = undefined;
      this.io.patchState({ pet: this.pet });
      this.publishPets();
      return;
    }
    const name = (npcNames as Record<string, string>)[String(rec.model)] ?? `#${rec.model}`;
    const maxHp = rec.maxHp ?? (rec.stats?.hp ? rec.level * 10 + rec.stats.hp * 6 : rec.hp);
    const maxSp = rec.maxSp ?? (rec.stats?.sp ? rec.level * 3 + rec.stats.sp * 5 : rec.sp);
    this.pet = {
      ...this.pet,
      name,
      element: PET_ELEMENT_BY_CODE[(npcElements as Record<string, number>)[String(rec.model)] ?? 0],
      level: rec.level,
      hp: { cur: rec.hp, max: maxHp },
      sp: { cur: rec.sp, max: maxSp },
    };
    this.lastRawExp.pet = rec.exp;
    this.pet = this.applyExp(this.pet, rec.exp, PET_CURVES, "võ tướng");
    this.io.log("info", `võ tướng xuất chiến: ${this.pet.name} Lv ${this.pet.level}, HP ${this.pet.hp.cur}/${this.pet.hp.max}, SP ${this.pet.sp.cur}/${this.pet.sp.max} (${this.roster.length} pet mang theo)`);
    this.io.patchState({ pet: this.pet });
    this.publishPets();
  }

  private static readonly GEAR_PROPS: Record<number, keyof import("@tsbot/protocol").PetBonus> = { 0x1d2: "atk", 0x1d3: "def", 0x1d4: "int", 0x1d6: "agi" };
  /** Điểm cộng từ đồ của võ tướng đến trước hoặc sau 0f/08 đều được (giữ tạm theo idx). */
  private pendingGear = new Map<number, import("@tsbot/protocol").PetBonus>();

  private gearProp(into: import("@tsbot/protocol").PetBonus, prop: number, value: number, done: () => void) {
    const k = TsOnlineSession.GEAR_PROPS[prop];
    if (k) { into[k] = value; done(); }
  }

  /** 08/02 `00 04 <idx> 00 <mã u16> <giá trị u32>` với mã 0x1d2..: điểm cộng từ trang bị của võ tướng thứ idx (cap: Ma Quan Vũ 50/29/46/27 khớp client). */
  private petGear(idx: number, prop: number, value: number) {
    const rec = this.roster.find((r) => r.idx === idx);
    const g = rec?.gear ?? this.pendingGear.get(idx) ?? { int: 0, atk: 0, def: 0, agi: 0 };
    this.gearProp(g, prop, value, () => {});
    if (rec) { rec.gear = g; this.publishPets(); } else this.pendingGear.set(idx, g);
  }

  /** 17/0b: trang bị đang mặc: `00 | count u8 | count × 35 byte [itemId u16, …]`. */
  private equipList(f: Buffer) {
    const equipment: import("@tsbot/protocol").EquipSlot[] = [];
    for (let i = 0; i < f[9]! && 10 + 35 * i + 2 <= f.length; i++) {
      const id = f.readUInt16LE(10 + 35 * i);
      if (id) equipment.push({ slot: i, id });
    }
    this.io.patchState({ equipment });
  }

  /** 55/01: `00 | count u32 | count × [id u16, val u32, max u32]`. Gói lớn lúc login (1500 bản ghi) và gói 1 bản ghi khi bộ đếm đổi. */
  private counters(f: Buffer) {
    const n = f.readUInt32LE(9);
    for (let i = 0, o = 13; i < n && o + 10 <= f.length; i++, o += 10) {
      const id = f.readUInt16LE(o), val = f.readUInt32LE(o + 2), max = f.readUInt32LE(o + 6);
      const prev = this.counterMap.get(id);
      this.counterMap.set(id, { val, max });
      if (id === CTR_ONLINE_SEC) {
        this.onlineSecAtUpdate = val;
        this.onlineSecTime = Date.now();
      }
      if (id === CTR_ESCORT) {
        if (prev && prev.val !== val) {
          this.io.game(`🐎 [Vận Tiêu] Tiến độ vận tiêu hôm nay: ${val}/${max} lượt.`);
        }
        this.io.patchState({ escort: this.getEscortState() });
      }
      if (prev && prev.val !== val && (id === CTR_CHECKIN_DAY || id === CTR_CHECKIN_STREAK)) {
        this.io.game((id === CTR_CHECKIN_DAY ? MSG.checkinDay : MSG.checkinStreak)(prev.val, val, max));
      }
    }
    if (n > 100) { // bảng đầy đủ lúc login
      const d = this.counterMap.get(CTR_CHECKIN_DAY), st = this.counterMap.get(CTR_CHECKIN_STREAK);
      if (d && st) this.io.game(MSG.checkinStatus(d.val, d.max, st.val, st.max));
      const esc = this.counterMap.get(CTR_ESCORT);
      if (esc) {
        this.io.patchState({ escort: this.getEscortState() });
      }
    }
  }

  /** Số phút online trong ngày (bộ đếm CTR_ONLINE_SEC + thời gian trôi qua từ lần cập nhật gần nhất). */
  private getOnlineMinutes(): number {
    if (this.onlineSecAtUpdate == null) return 0;
    const elapsed = this.onlineSecTime ? Math.floor((Date.now() - this.onlineSecTime) / 1000) : 0;
    return Math.floor((this.onlineSecAtUpdate + elapsed) / 60);
  }

  /** 51/02 lúc login: bitset hoạt động/quà 1000 byte. Bit k (1-based id) = 1 là đã nhận. */
  private activityFlagsInit(f: Buffer) {
    this.claimedActivityFlags.clear();
    const bytes = f.subarray(11);
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      if (!b) continue;
      for (let bit = 0; bit < 8; bit++) {
        if (b & (1 << bit)) {
          this.claimedActivityFlags.add(i * 8 + bit + 1);
        }
      }
    }
  }

  /** 51/01 cập nhật 1 cờ: `00 | 01 00 00 00 | id u16 LE | val u8`. */
  private activityFlagUpdate(f: Buffer) {
    const id = f.readUInt16LE(13), val = f[15]!;
    if (val) this.claimedActivityFlags.add(id);
    else this.claimedActivityFlags.delete(id);
  }

  private dijieOpenReply(code: number) {
    this.dijieReply = code;
    if (code === 0x06) this.io.game(MSG.dijieAlready);
    else if (code !== 0x00) this.io.game(MSG.dijieRefused(code));
  }

  /** 18/02 = mốc Dị giới cũ, 18/01 = mốc mới (server gửi theo cặp 02 rồi 01, payload `00 51 33 NN`). */
  private dijieTier(sub: number, code: number) {
    if (sub === 0x02) { this.dijieOld = code; return; }
    this.io.game(MSG.dijieIn(dijieLevelLabel(code), this.dijieOld != null ? dijieLevelLabel(this.dijieOld) : undefined));
    this.dijieOld = undefined;
  }

  /**
   * 17/05 — TÚI ĐỒ đầy đủ (gửi lúc login; docs cũ ghi nhầm là trang bị): `00 | 00 (loại túi) | count u16 | count × 36 byte`,
   * mỗi mục `[slot u8][itemId u16][qty u32][29 byte phụ — chưa rõ, các mẫu đều 0]`. Đối chiếu log tool: Hạo Giác ×3, Bí Cấp Trương Nhiệm ×1.
   */
  private bagList(f: Buffer) {
    const n = f.readUInt16LE(10);
    this.bag.clear();
    this.bagLoaded = true;
    for (let i = 0, o = 12; i < n && o + 36 <= f.length; i++, o += 36) this.bag.set(f[o]!, { id: f.readUInt16LE(o + 1), qty: f.readUInt32LE(o + 3) });
    this.emitBag();
  }

  private emitBag() {
    this.io.patchState({ bag: [...this.bag].sort((a, b) => a[0] - b[0]).map(([slot, v]) => ({ slot, ...v })) });
    this.triggerAutoSweep();
  }

  /** Tự động quét và xử lý các vật phẩm trong túi đồ theo danh sách cấu hình (tự vứt, tự mở, chế tạo). */
  private triggerAutoSweep(manual = false) {
    if (this.sweepingBag || this.inBattle) return;
    // Nhân vật đã gục ngã (HP = 0) không thể thao tác túi đồ (vứt/mở/hợp)
    if (this.player.hp.max > 0 && this.player.hp.cur === 0) return;
    let handledAny = false;

    // 1. TỰ VỨT (chỉ quét khi bật toggle discard, match ItemId thì vứt trực tiếp không ràng buộc)
    if (this.autoLists.toggles.discard !== false) {
      for (const [slot, item] of this.bag) {
        if (this.autoLists.discard.has(item.id)) {
          const key = `discard:${slot}:${item.id}`;
          const attempts = (this.sweepAttempts.get(key) ?? 0) + 1;
          this.sweepAttempts.set(key, attempts);
          if (attempts > 3) continue;

          this.sweepingBag = true;
          handledAny = true;
          const name = (itemNames as Record<string, string>)[item.id] ?? `#${item.id}`;
          if (attempts === 3) {
            this.io.game(`⚠️ [Tự động vứt] Đã thử 3 lần không thành công đối với ${name} (ô ${slot}), tạm dừng auto cho món này.`);
          } else {
            this.io.game(`🗑️ [Tự động vứt] Đã tự động vứt bỏ ${item.qty > 1 ? `${item.qty} cái ` : ""}${name}.`);
            this.io.log("info", `[Tự động vứt] Vứt bỏ ${name} (x${item.qty}) tại ô ${slot}`);
          }
          this.io.send(encodeFrame(cmdBody(0x17, 0x03, [
            0x00,
            slot & 0xff,
            item.qty & 0xff,
            (item.qty >> 8) & 0xff,
            (item.qty >> 16) & 0xff,
            (item.qty >>> 24) & 0xff,
          ])));
          if (this.sweepTimer) clearTimeout(this.sweepTimer);
          this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            this.sweepingBag = false;
            this.triggerAutoSweep(manual);
          }, 600);
          return;
        }
      }
    }

    // 2. TỰ MỞ (chỉ quét khi bật toggle autoOpen)
    if (this.autoLists.toggles.autoOpen !== false) {
      for (const [slot, item] of this.bag) {
        if (this.autoLists.autoOpen.has(item.id)) {
          const key = `open:${slot}:${item.id}`;
          const attempts = (this.sweepAttempts.get(key) ?? 0) + 1;
          this.sweepAttempts.set(key, attempts);
          if (attempts > 3) continue;

          this.sweepingBag = true;
          handledAny = true;
          const name = (itemNames as Record<string, string>)[item.id] ?? `#${item.id}`;
          if (attempts === 3) {
            this.io.game(`⚠️ [Tự động mở] Đã thử 3 lần không thành công đối với ${name} (ô ${slot}), tạm dừng auto cho món này.`);
          } else {
            this.io.game(`🎁 [Tự động mở] Đã tự động mở ${name}.`);
            this.io.log("info", `[Tự động mở] Mở gói ${name} tại ô ${slot}`);
          }
          // Gói DÙNG VẬT PHẨM đầy đủ (pcap use_hpsp_char_pet): `00 <ô> <số lượng u32 LE> <đích 0=nhân vật> 00` — 8 byte. Bản cũ chỉ gửi 4 byte (`00 ô 01 00`) ⇒ server bỏ qua im lặng,
          // túi không đổi ⇒ "thử 3 lần không thành công" với MỌI vật phẩm tự mở (vd Phó Bản Cấp 20 II, id 46921).
          this.io.send(encodeFrame(cmdBody(0x17, 0x0f, [0x00, slot & 0xff, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00])));
          if (this.sweepTimer) clearTimeout(this.sweepTimer);
          this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            this.sweepingBag = false;
            this.triggerAutoSweep(manual);
          }, 600);
          return;
        }
      }
    }

    // 3. TỰ HỢP / CHẾ TẠO
    // - Khi BẬT (combine !== false): Hợp tất cả các item trong danh sách đến khi hết nguyên liệu / full thùng đồ / lỗi 3 lần.
    // - Khi TẮT (combine === false):
    //    + Nếu không đủ item trong list để tạo thành cặp hợp: không xử lý gì cả.
    //    + Nếu vẫn còn item trong thùng đồ: mỗi ngày tự động hợp 1 lần duy nhất để hoàn tất nhiệm vụ hàng ngày (Checklist Daily).
    //    + Ghi nhớ cờ đã hợp trong ngày (lastCombinedDate) để relogin không bị làm mới/hợp tiếp.
    if (this.autoLists.combine.size > 0) {
      const isCombineToggleOn = this.autoLists.toggles.combine !== false;
      const today = getTaiwanDateKey();
      const hasCombinedToday = this.lastCombinedDate === today;

      // Nếu toggle tắt VÀ hôm nay đã hợp rồi -> bỏ qua không xử lý
      if (!isCombineToggleOn && hasCombinedToday) {
        // Đã hoàn tất 1 lượt hợp trong ngày, không làm gì thêm
      } else {
        const byId = new Map<number, { slot: number; qty: number }[]>();
        for (const [slot, item] of this.bag) {
          if (this.autoLists.combine.has(item.id)) {
            const list = byId.get(item.id) ?? [];
            list.push({ slot, qty: item.qty });
            byId.set(item.id, list);
          }
        }

        interface CombineCandidate {
          slotA: number;
          nameA: string;
          slotB: number;
          nameB: string;
        }
        const candidates: CombineCandidate[] = [];

        // Case A: Cùng itemId có tổng số lượng >= 2
        for (const [id, slots] of byId) {
          const totalQty = slots.reduce((sum, s) => sum + s.qty, 0);
          if (totalQty >= 2) {
            const name = (itemNames as Record<string, string>)[id] ?? `#${id}`;
            // A1: Các ô có số lượng xếp chồng >= 2 (vd Bánh bao x100 trong 1 ô) -> hợp 2 item cùng ô đó (1x1)
            for (const s of slots) {
              if (s.qty >= 2) {
                candidates.push({ slotA: s.slot, nameA: name, slotB: s.slot, nameB: name });
              }
            }
            // A2: Cùng item nhưng nằm ở các ô khác nhau (mỗi ô có >= 1 item) -> hợp ô này với ô kia
            for (let i = 0; i < slots.length; i++) {
              for (let j = i + 1; j < slots.length; j++) {
                candidates.push({ slotA: slots[i]!.slot, nameA: name, slotB: slots[j]!.slot, nameB: name });
              }
            }
          }
        }

        // Case B: 2 itemIds khác nhau trong danh sách hợp, mỗi loại còn item trong túi (tổng SL >= 1)
        const distinctItems: { slot: number; id: number; name: string }[] = [];
        for (const [id, slots] of byId) {
          const totalQty = slots.reduce((sum, s) => sum + s.qty, 0);
          if (totalQty >= 1) {
            const name = (itemNames as Record<string, string>)[id] ?? `#${id}`;
            const firstAvailable = slots.find((s) => s.qty >= 1);
            if (firstAvailable) {
              distinctItems.push({ slot: firstAvailable.slot, id, name });
            }
          }
        }
        for (let i = 0; i < distinctItems.length; i++) {
          for (let j = i + 1; j < distinctItems.length; j++) {
            const a = distinctItems[i]!;
            const b = distinctItems[j]!;
            candidates.push({ slotA: a.slot, nameA: a.name, slotB: b.slot, nameB: b.name });
          }
        }

        if (candidates.length > 0) {
          const match = candidates[Math.floor(Math.random() * candidates.length)]!;
          const key = `combine:${match.slotA}:${match.slotB}`;
          const attempts = (this.sweepAttempts.get(key) ?? 0) + 1;
          this.sweepAttempts.set(key, attempts);
          if (attempts <= 3) {
            this.sweepingBag = true;
            handledAny = true;
            this.lastCombinedDate = today;

            if (attempts === 3) {
              this.io.game(`⚠️ [Tự động hợp] Đã thử 3 lần với ô ${match.slotA} và ${match.slotB}, tạm dừng công thức này.`);
            } else if (!isCombineToggleOn) {
              // Khi toggle tắt: hợp 1 lần duy nhất trong ngày để hoàn tất nhiệm vụ hàng ngày
              if (match.slotA === match.slotB) {
                this.io.game(`🧪 [Hợp hàng ngày] Tính năng hợp đang tắt: Tự động hợp 1x1 ${match.nameA} (1 lần/ngày) để hoàn tất nhiệm vụ hàng ngày.`);
                this.io.log("info", `[Hợp hàng ngày] Hợp 1x1 ${match.nameA} tại ô ${match.slotA} hoàn tất daily`);
              } else {
                this.io.game(`🧪 [Hợp hàng ngày] Tính năng hợp đang tắt: Tự động hợp ${match.nameA} và ${match.nameB} (1 lần/ngày) để hoàn tất nhiệm vụ hàng ngày.`);
                this.io.log("info", `[Hợp hàng ngày] Hợp ${match.nameA} (ô ${match.slotA}) và ${match.nameB} (ô ${match.slotB}) hoàn tất daily`);
              }
            } else if (match.slotA === match.slotB) {
              this.io.game(`🧪 [Tự động hợp] Đã tự động chế tạo hợp thành 1x1 ${match.nameA}.`);
              this.io.log("info", `[Tự động hợp] Hợp thành 1x1 ${match.nameA} tại ô ${match.slotA}`);
            } else {
              this.io.game(`🧪 [Tự động hợp] Đã tự động hợp thành ${match.nameA} và ${match.nameB}.`);
              this.io.log("info", `[Tự động hợp] Hợp thành ${match.nameA} (ô ${match.slotA}) và ${match.nameB} (ô ${match.slotB})`);
            }
            // Gói 17/0e: 00 [slotA] [01 00 00 00] [slotB] [01 00 00 00] 00 00 00 00 00 01 (Chuẩn pcap hop vat pham.pcap - 25 bytes)
            this.io.send(encodeFrame(cmdBody(0x17, 0x0e, [
              0x00,
              match.slotA & 0xff,
              0x01, 0x00, 0x00, 0x00,
              match.slotB & 0xff,
              0x01, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
            ])));
            if (this.sweepTimer) clearTimeout(this.sweepTimer);
            this.sweepTimer = setTimeout(() => {
              this.sweepTimer = undefined;
              this.sweepingBag = false;
              this.triggerAutoSweep(manual);
            }, 600);
            return;
          }
        }
      }
    }

    // 4. PHÂN GIẢI (chỉ quét khi bật toggle resolve)
    if (this.autoLists.toggles.resolve !== false && this.autoLists.resolve.size > 0) {
      for (const [slot, item] of this.bag) {
        if (this.autoLists.resolve.has(item.id)) {
          const key = `resolve:${slot}:${item.id}`;
          const attempts = (this.sweepAttempts.get(key) ?? 0) + 1;
          this.sweepAttempts.set(key, attempts);
          if (attempts > 3) continue;

          this.sweepingBag = true;
          handledAny = true;
          const name = (itemNames as Record<string, string>)[item.id] ?? `#${item.id}`;
          if (attempts === 3) {
            this.io.game(`⚠️ [Tự động phân giải] Đã thử 3 lần không thành công đối với ${name} (ô ${slot}), tạm dừng auto cho món này.`);
          } else {
            this.io.game(`💥 [Tự động phân giải] Đã tự động phân giải ${item.qty > 1 ? `${item.qty} cái ` : ""}${name}.`);
            this.io.log("info", `[Tự động phân giải] Phân giải ${name} (x${item.qty}) tại ô ${slot}`);
          }
          // Gói 59/03 chuẩn TS Mobile: 00 01 [slot] [qty u32 LE]
          this.io.send(encodeFrame(cmdBody(0x59, 0x03, [
            0x00,
            0x01,
            slot & 0xff,
            item.qty & 0xff,
            (item.qty >> 8) & 0xff,
            (item.qty >> 16) & 0xff,
            (item.qty >> 24) & 0xff,
          ])));
          if (this.sweepTimer) clearTimeout(this.sweepTimer);
          this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            this.sweepingBag = false;
            this.triggerAutoSweep(manual);
          }, 600);
          return;
        }
      }
    }

    // 5. ĐÓNG GÓP BANG HỘI (chỉ quét khi bật toggle contribute)
    if (this.autoLists.toggles.contribute !== false && this.autoLists.contribute.size > 0) {
      for (const [slot, item] of this.bag) {
        if (this.autoLists.contribute.has(item.id)) {
          const key = `contribute:${slot}:${item.id}`;
          const attempts = (this.sweepAttempts.get(key) ?? 0) + 1;
          this.sweepAttempts.set(key, attempts);
          if (attempts > 3) continue;

          this.sweepingBag = true;
          handledAny = true;
          const name = (itemNames as Record<string, string>)[item.id] ?? `#${item.id}`;
          if (attempts === 3) {
            this.io.game(`⚠️ [Tự động đóng góp] Đã thử 3 lần không thành công đối với ${name} (ô ${slot}), tạm dừng auto cho món này.`);
          } else {
            this.io.game(`🏛️ [Tự động đóng góp] Đã tự động đóng góp ${item.qty > 1 ? `${item.qty} cái ` : ""}${name} cho Quân đoàn.`);
            this.io.log("info", `[Tự động đóng góp] Cống hiến ${name} tại ô ${slot} cho Quân đoàn`);
          }
          // Gói 27/0f chuẩn TS Mobile: 00 00 00 00 00 [slot]
          this.io.send(encodeFrame(cmdBody(0x27, 0x0f, [
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            slot & 0xff,
          ])));
          if (this.sweepTimer) clearTimeout(this.sweepTimer);
          this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            this.sweepingBag = false;
            this.triggerAutoSweep(manual);
          }, 600);
          return;
        }
      }
    }

    if (manual && !handledAny) {
      this.io.log("info", "✓ [Quét túi đồ] Đã quét xong: Thùng đồ cá nhân không có vật phẩm nào cần xử lý theo các mục đang BẬT.");
    }
  }

  /** Tự động sử dụng vật phẩm HP, SP trong thùng đồ cá nhân theo mốc cấu hình (ưu tiên item có chỉ số + thấp nhất). */
  private triggerAutoHeal(manual = false) {
    if (this.inBattle || this.autoHealRunning) return;
    // Nhân vật đã gục ngã (HP = 0) không thể sử dụng bình thuốc/thức ăn thông thường ngoài trận (gửi 17/0f sẽ bị server kick mã 42)
    if (this.player.hp.max > 0 && this.player.hp.cur === 0) return;
    if (!manual && !this.autoHeal.enabled) return;
    const now = Date.now();
    if (!manual && now - this.lastAutoHealAt < 3000) return;

    this.autoHealRunning = true;
    try {
      interface HealTask {
        targetName: string;
        targetId: number; // 0 = char, 1..n = pet idx
        type: "hp" | "sp";
        cur: number;
        max: number;
        thresholdPct: number;
      }

      const tasks: HealTask[] = [];

      // 1. Nhân vật (chỉ hồi phục khi còn sống)
      if (this.autoHeal.player.autoHp && this.player.hp.max > 0 && this.player.hp.cur > 0) {
        tasks.push({
          targetName: this.player.name || "Nhân vật",
          targetId: 0,
          type: "hp",
          cur: this.player.hp.cur,
          max: this.player.hp.max,
          thresholdPct: this.autoHeal.player.hpPct,
        });
      }
      if (this.autoHeal.player.autoSp && this.player.sp.max > 0 && this.player.hp.cur > 0) {
        tasks.push({
          targetName: this.player.name || "Nhân vật",
          targetId: 0,
          type: "sp",
          cur: this.player.sp.cur,
          max: this.player.sp.max,
          thresholdPct: this.autoHeal.player.spPct,
        });
      }

      // 2. Võ tướng xuất chiến (Pet) (chỉ hồi phục khi còn sống)
      const actPet = this.activePet();
      const petTargetId = actPet?.idx ?? 1;
      const petName = this.pet.name || (actPet ? ((itemNames as Record<string, string>)[actPet.model] ?? "Võ tướng") : "Võ tướng");

      if (this.autoHeal.pet.autoHp && this.pet.hp.max > 0 && this.pet.hp.cur > 0) {
        tasks.push({
          targetName: petName,
          targetId: petTargetId,
          type: "hp",
          cur: this.pet.hp.cur,
          max: this.pet.hp.max,
          thresholdPct: this.autoHeal.pet.hpPct,
        });
      }
      if (this.autoHeal.pet.autoSp && this.pet.sp.max > 0 && this.pet.hp.cur > 0) {
        tasks.push({
          targetName: petName,
          targetId: petTargetId,
          type: "sp",
          cur: this.pet.sp.cur,
          max: this.pet.sp.max,
          thresholdPct: this.autoHeal.pet.spPct,
        });
      }

      // 3. Từng slot võ tướng riêng nếu có trong autoHeal.slots (chỉ hồi phục khi còn sống)
      if (this.autoHeal.slots) {
        for (const [slotStr, cfg] of Object.entries(this.autoHeal.slots)) {
          const sIdx = Number(slotStr);
          if (sIdx === petTargetId) continue;
          const rPet = this.roster.find((r) => r.idx === sIdx);
          if (!rPet || !rPet.maxHp) continue;
          const rName = (itemNames as Record<string, string>)[rPet.model] ?? `Võ tướng slot ${sIdx}`;
          if (cfg.autoHp && rPet.maxHp > 0 && rPet.hp > 0) {
            tasks.push({
              targetName: rName,
              targetId: sIdx,
              type: "hp",
              cur: rPet.hp,
              max: rPet.maxHp,
              thresholdPct: cfg.hpPct,
            });
          }
          if (cfg.autoSp && (rPet.maxSp ?? 0) > 0 && rPet.hp > 0) {
            tasks.push({
              targetName: rName,
              targetId: sIdx,
              type: "sp",
              cur: rPet.sp,
              max: rPet.maxSp!,
              thresholdPct: cfg.spPct,
            });
          }
        }
      }

      let handledAny = false;

      for (const t of tasks) {
        const curPct = (t.cur / t.max) * 100;
        if (curPct >= t.thresholdPct) continue;

        const thresholdVal = Math.ceil((t.max * t.thresholdPct) / 100);
        let needed = thresholdVal - t.cur;
        if (needed <= 0) continue;

        const candidates: { slot: number; id: number; qty: number; eff: number }[] = [];
        for (const [slot, it] of this.bag) {
          if (it.qty <= 0) continue;
          const effObj = (itemHealEffects as Record<string, { hp?: number; sp?: number }>)[String(it.id)];
          if (!effObj) continue;
          const val = t.type === "hp" ? effObj.hp : effObj.sp;
          if (val && val > 0) {
            candidates.push({ slot, id: it.id, qty: it.qty, eff: val });
          }
        }

        // Ưu tiên item có chỉ số + thấp nhất trong thùng đồ
        candidates.sort((a, b) => a.eff - b.eff || a.slot - b.slot);

        for (const item of candidates) {
          if (needed <= 0) break;
          const needQty = Math.ceil(needed / item.eff);
          const useQty = Math.min(item.qty, needQty);
          if (useQty <= 0) continue;

          handledAny = true;
          const name = (itemNames as Record<string, string>)[item.id] ?? `#${item.id}`;
          const healedAmount = useQty * item.eff;
          t.cur += healedAmount;
          needed -= healedAmount;
          item.qty -= useQty;

          if (item.qty <= 0) {
            this.bag.delete(item.slot);
          } else {
            this.bag.set(item.slot, { id: item.id, qty: item.qty });
          }

          // Cập nhật trạng thái HP/SP ngay lập tức vào bộ nhớ bot & đồng bộ UI
          if (t.targetId === 0) {
            if (t.type === "hp") {
              this.player = { ...this.player, hp: { ...this.player.hp, cur: Math.min(this.player.hp.max, this.player.hp.cur + healedAmount) } };
            } else {
              this.player = { ...this.player, sp: { ...this.player.sp, cur: Math.min(this.player.sp.max, this.player.sp.cur + healedAmount) } };
            }
            this.io.patchState({ player: { ...this.player } });
          } else {
            if (petTargetId === t.targetId) {
              if (t.type === "hp") {
                this.pet = { ...this.pet, hp: { ...this.pet.hp, cur: Math.min(this.pet.hp.max, this.pet.hp.cur + healedAmount) } };
              } else {
                this.pet = { ...this.pet, sp: { ...this.pet.sp, cur: Math.min(this.pet.sp.max, this.pet.sp.cur + healedAmount) } };
              }
              this.io.patchState({ pet: { ...this.pet } });
            }
            const rec = this.roster.find((r) => r.idx === t.targetId);
            if (rec) {
              if (t.type === "hp") rec.hp = Math.min(rec.maxHp ?? rec.hp, rec.hp + healedAmount);
              else rec.sp = Math.min(rec.maxSp ?? rec.sp, rec.sp + healedAmount);
            }
            this.publishPets();
          }

          this.io.game(`💊 [${t.targetName}] Tự động sử dụng ${useQty > 1 ? `${useQty}x ` : ""}${name} (+${item.eff} ${t.type.toUpperCase()}) (Sau khi dùng: ~${Math.min(t.max, t.cur)}/${t.max} ${t.type.toUpperCase()}).`);
          this.io.log("info", `[Tự dùng ${t.type.toUpperCase()}] ${t.targetName}: Dùng ${useQty}x ${name} tại ô ${item.slot}`);

          // Gửi packet 17/0f chuẩn hóa 8 bytes
          this.io.send(encodeFrame(cmdBody(0x17, 0x0f, [
            0x00,
            item.slot & 0xff,
            useQty & 0xff,
            (useQty >> 8) & 0xff,
            (useQty >> 16) & 0xff,
            (useQty >>> 24) & 0xff,
            t.targetId & 0xff,
            0x00,
          ])));
        }
      }

      if (handledAny) {
        this.lastAutoHealAt = Date.now();
        this.io.patchState({ bag: [...this.bag].sort((a, b) => a[0] - b[0]).map(([slot, v]) => ({ slot, ...v })) });
      } else if (manual) {
        this.io.game("✓ [Tự dùng HP/SP] Chỉ số HP/SP của Nhân vật và Võ tướng đều đang trên mốc cấu hình, không cần sử dụng vật phẩm.");
        this.io.log("info", "✓ [Tự dùng HP/SP] Đã quét xong: Không có đơn vị nào cần dùng thuốc HP/SP.");
      }
    } finally {
      this.autoHealRunning = false;
    }
  }

  /** 17/05 (khi f[9] !== 0) hoặc 17/66: danh sách vật phẩm trong kho Tiền Trang. */
  private bankList(f: Buffer) {
    this.bank.clear();
    this.io.log("debug", `[Tiền Trang 17/05] Nhận gói dữ liệu kho (len=${f.length}) hex=${f.toString("hex")}`);
    let o = 12;
    if (f.length >= 12) {
      const n = f.readUInt16LE(10);
      for (let i = 0; i < n && o + 36 <= f.length; i++, o += 36) {
        const slot = f[o]!;
        const id = f.readUInt16LE(o + 1);
        const qty = f.readUInt32LE(o + 3);
        if (slot > 0 && id > 0) this.bank.set(slot, { id, qty: Math.max(1, qty) });
      }
    }
    this.emitBank();
    this.io.game(`🏦 Đã mở kho Tiền Trang: ${this.bank.size} ô vật phẩm.`);
  }

  /** 1d/09: Danh sách vật phẩm trong kho Tiền Trang (chuẩn pcap TS Mobile). */
  private bankList1d(f: Buffer) {
    this.io.log("debug", `[Tiền Trang 1d/09] Nhận gói dữ liệu kho (len=${f.length}) hex=${f.toString("hex")}`);
    // f layout: c0 91 len u16 00 00 1d 09 [payload...]
    // Khi kho trống hoặc gói báo mở kho: len=10
    if (f.length <= 10) {
      if (this.bank.size === 0) {
        this.emitBank();
        this.io.game("🏦 Đã mở kho Tiền Trang: 0 ô vật phẩm.");
      } else {
        this.emitBank();
        this.io.game(`🏦 Đã mở kho Tiền Trang: ${this.bank.size} ô vật phẩm.`);
      }
      return;
    }

    this.bank.clear();

    let o = 10;
    let stride = 36;
    let n = 0;

    if ((f.length - 10) % 36 === 0) {
      n = f.readUInt16LE(8);
      o = 10;
      stride = 36;
    } else if (f.length >= 12 && (f.length - 12) % 36 === 0) {
      n = f.readUInt16LE(10);
      o = 12;
      stride = 36;
    } else if ((f.length - 10) % 7 === 0) {
      n = f.readUInt16LE(8);
      o = 10;
      stride = 7;
    } else if (f.length >= 12 && (f.length - 12) % 7 === 0) {
      n = f.readUInt16LE(10);
      o = 12;
      stride = 7;
    }

    if (n > 0) {
      for (let i = 0; i < n && o + 3 <= f.length; i++, o += stride) {
        const slot = f[o]!;
        const id = f.readUInt16LE(o + 1);
        const qty = o + 7 <= f.length ? f.readUInt32LE(o + 3) : (o + 4 <= f.length ? f[o + 3]! : 1);
        if (slot > 0 && id > 0) this.bank.set(slot, { id, qty: Math.max(1, qty) });
      }
    } else {
      while (o + 3 <= f.length) {
        const slot = f[o]!;
        const id = f.readUInt16LE(o + 1);
        const qty = o + 7 <= f.length ? f.readUInt32LE(o + 3) : (o + 4 <= f.length ? f[o + 3]! : 1);
        if (slot > 0 && id > 0) this.bank.set(slot, { id, qty: Math.max(1, qty) });
        o += stride;
      }
    }
    this.emitBank();
    this.io.game(`🏦 Đã mở kho Tiền Trang: ${this.bank.size} ô vật phẩm.`);
  }

  /**
   * 1e/01 (S->C): Danh sách toàn bộ vật phẩm trong kho Tiền Trang TS Mobile.
   * Máy chủ gửi gói này ngay khi mở kho Tiền Trang với NPC (đối chiếu log thực tế len=153 với 4 slot).
   * Layout: c0 91 len u16 00 00 1e 01 00 [items...]
   * Mỗi item 36 byte: [slot u8][id u16][qty u32][29 byte extra/zeros]
   */
  private bankList1e(f: Buffer) {
    this.bank.clear();
    this.setBankOpen(true);
    for (let o = 9; o + 7 <= f.length; o += 36) {
      const slot = f[o]!;
      const id = f.readUInt16LE(o + 1);
      const qty = f.readUInt32LE(o + 3);
      if (slot > 0 && id > 0) {
        this.bank.set(slot, { id, qty: Math.max(1, qty) });
      }
    }
    this.emitBank();
    this.io.game(`🏦 Đã nạp danh sách kho Tiền Trang: ${this.bank.size} ô vật phẩm.`);
  }

  /** 1d/06: Thông tin tiền gửi trong Tiền Trang. */
  private bankGold(f: Buffer) {
    if (f.length >= 13) {
      const gold = f.readUInt32LE(9);
      this.io.game(`🏦 [Tiền Trang] Tiền gửi: ${gold.toLocaleString("vi-VN")} lượng.`);
    }
  }

  private setBankOpen(open: boolean) {
    if (this.bankOpen === open) return;
    this.bankOpen = open;
    this.io.patchState({ bankOpen: open });
  }

  private emitBank() {
    this.io.patchState({
      bank: [...this.bank].sort((a, b) => a[0] - b[0]).map(([slot, v]) => ({ slot, ...v })),
    });
  }

  /** 1e/04: Cập nhật / thêm 1 ô kho Tiền Trang (khớp pcap TSM: 1e/04 00 | slot u8 | itemId u16 | qty u8/u32). */
  private bankItemAdd(f: Buffer) {
    const slot = f[9]!;
    const id = f.readUInt16LE(10);
    const qty = f.length >= 16 ? f.readUInt32LE(12) : (f.length >= 13 ? f[12]! : 1);
    if (slot > 0 && id > 0) {
      this.bank.set(slot, { id, qty });
      this.emitBank();
      const name = (itemNames as Record<string, string>)[id] ?? `#${id}`;
      this.io.log("debug", `[Tiền Trang] Ô ${slot}: ${name} (x${qty})`);
    }
  }

  /** 1e/05: Rút / xoá vật phẩm khỏi ô kho Tiền Trang (khớp pcap TSM: 1e/05 00 | slot u8 | qty u8/u32). */
  private bankItemRemove(f: Buffer) {
    const slot = f[9]!;
    const qty = f.length >= 14 ? f.readUInt32LE(10) : (f.length >= 11 ? f[10]! : 1);
    const existing = this.bank.get(slot);
    if (existing) {
      if (existing.qty <= qty) {
        this.bank.delete(slot);
      } else {
        existing.qty -= qty;
      }
      this.emitBank();
    }
  }

  /** 17/08: cập nhật 1 ô túi — `00 | slot u8 | itemId u16 | qty u32` (qty là số lượng trong ô; 0 = ô trống). */
  private bagSlot(f: Buffer) {
    const slot = f[9]!, id = f.readUInt16LE(10), qty = f.readUInt32LE(12);
    const name = (itemNames as Record<string, string>)[id] ?? `#${id}`;
    const prev = this.bag.get(slot);
    if (qty === 0) this.bag.delete(slot); else this.bag.set(slot, { id, qty });
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.sweepingBag = false;
    for (const k of this.sweepAttempts.keys()) {
      if (k.includes(`:${slot}:`) || k.startsWith(`combine:${slot}:`) || k.endsWith(`:${slot}`)) {
        this.sweepAttempts.delete(k);
      }
    }
    this.emitBag();
    // ô trống trước đó (đã có danh sách túi) ⇒ số nhận được chính là qty
    this.io.game(MSG.gotItem(name, qty, prev ? (prev.id === id ? qty - prev.qty : null) : this.bagLoaded ? qty : null));
  }

  /** 17/09: trừ số lượng hoặc xóa 1 ô túi đồ khi bị vứt/gửi kho/tiêu hao. Layout: 17/09 00 | slot u8 | qty u32 */
  private bagRemove(f: Buffer) {
    let slot = f[9]!;
    let removeQty = 1;
    if (f[9] === 0x00 && f.length >= 11) {
      slot = f[10]!;
      removeQty = f.length >= 15 ? f.readUInt32LE(11) : (f.length >= 12 ? f[11]! : 1);
    } else {
      removeQty = f.length >= 14 ? f.readUInt32LE(10) : (f.length >= 11 ? f[10]! : 1);
    }
    const existing = this.bag.get(slot);
    if (existing) {
      if (existing.qty <= removeQty) {
        this.bag.delete(slot);
      } else {
        existing.qty -= removeQty;
      }
    } else {
      this.bag.delete(slot);
    }
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.sweepingBag = false;
    for (const k of this.sweepAttempts.keys()) {
      if (k.includes(`:${slot}:`) || k.startsWith(`combine:${slot}:`) || k.endsWith(`:${slot}`)) {
        this.sweepAttempts.delete(k);
      }
    }
    this.emitBag();
  }

  /** 17/0d: thông báo kết quả hợp vật phẩm — `00 | itemId u16 | qty u32 | slot u8` (khớp pcap hop vat pham.pcap). */
  private bagCombineResult(f: Buffer) {
    const itemId = f.readUInt16LE(9);
    const qty = f.readUInt32LE(11);
    const slot = f[15]!;
    const name = (itemNames as Record<string, string>)[itemId] ?? `#${itemId}`;
    this.lastCombinedDate = getTaiwanDateKey();
    this.io.game(`✨ [Hợp thành công] Nhận được ${qty > 1 ? `${qty}x ` : ""}${name} tại ô ${slot}.`);
    this.io.log("info", `[Tự động hợp] Hợp thành công: nhận ${qty}x ${name} (id ${itemId}) tại ô ${slot}`);
  }

  // ---------------------------------------------------------------- thông báo hệ thống 02/0a (dạng mẫu câu)
  /** Id câu trong TextData: 40476 "%s tăng %s điểm kinh nghiệm"; 71328/90166/90077 = túi đồ đầy. */
  private static readonly TXT_EXP_GAIN = 40476;
  private static readonly TXT_BAG_FULL = new Set([71328, 90166, 90077]);
  /** Số exp trong câu "X tăng N điểm kinh nghiệm" của lần nhận Exp Offline gần nhất (đợi gói xác nhận 54/02). */
  private offlineGain: number | null = null;

  /**
   * 02/0a dạng mẫu câu: `00 03 01 | textId u32 | số tham số u8 | tham số…`; tham số loại 00 = chuỗi `[len u8][byte]`, loại 02 = u32.
   * Đối chiếu cap Nhận Exp Offline (id 40476, tham số: tên nhân vật + 35715 = đúng mức tăng exp của 08/0e).
   */
  private sysMessage(f: Buffer) {
    if (f[9] !== 0x03 || f.length < 16) return; // dạng khác (thông báo sự kiện ở login) bỏ qua
    const id = f.readUInt32LE(11);
    if (id === 10135) {
      const targetCh = this.pendingChannel;
      this.pendingChannel = undefined;
      if (targetCh !== undefined) {
        this.nonExistentChannels.add(targetCh);
        this.knownChannels.delete(targetCh);
        this.mapChannelStatuses.delete(targetCh);
      }
      this.location = {
        ...this.location,
        channels: this.buildMapChannels(this.location.map, this.location.channel),
      };
      this.io.patchState({ location: this.location });
      this.io.game(`⚠️ [Kênh] Máy chủ thông báo: Hiện tại chưa có ${targetCh !== undefined ? `Kênh ${targetCh + 1}` : "kênh này"} (máy chủ chưa mở hoặc đã đầy)!`);
      return;
    }
    if (TsOnlineSession.TXT_BAG_FULL.has(id)) { this.mailBagFull(); return; }
    if (id !== TsOnlineSession.TXT_EXP_GAIN) return;
    let o = 16, targetName = "", last: number | null = null;
    const numArgs = f[15]!;
    for (let i = 0; i < numArgs && o < f.length; i++) {
      const t = f[o]!;
      if (t === 0x00 && o + 2 <= f.length) {
        const sLen = f[o + 1]!;
        if (o + 2 + sLen <= f.length) {
          targetName = f.toString("latin1", o + 2, o + 2 + sLen);
          o += 2 + sLen;
        } else break;
      } else if (t === 0x02 && o + 5 <= f.length) {
        last = f.readUInt32LE(o + 1);
        o += 5;
      } else break;
    }
    if (this.offlineWait) {
      this.offlineGain = last;
    } else if (last != null && last > 0) {
      this.io.game(`✨ [Kinh Nghiệm] ${targetName || (this.player.name || "Nhân vật")} tăng +${last.toLocaleString("vi-VN")} điểm kinh nghiệm.`);
    }
  }

  // ---------------------------------------------------------------- Nhận Exp Offline (Free): 54/01 hỏi → 54/02 nhận
  private static readonly OFFER_OFFLINE_EXP = 0x1e;
  private offlineWait?: NodeJS.Timeout;

  /**
   * 57/03 (server, lúc login và sau khi client gửi `57/03 00`): `00 | 03 | 3 × [% exp u16, chi phí u32]` = Free, lựa chọn 2, lựa chọn 3.
   * Cap 23/10: 50%/0, 70%/441, 100%/5 — khớp khả năng chi trả (tuancn11 có 83.500 Xu, 300 Vàng). Cap cũ: 59 và 1 ⇒ Xu = số phút offline
   * (1 Xu/phút), Vàng ≈ phút/88 làm tròn lên (suy ra, 🟡).
   */
  private offlineExpInfo(f: Buffer) {
    if (f[9] !== 0x03) return;
    const xuCost = f.readUInt32LE(18), goldCost = f.readUInt32LE(24);
    this.io.patchState({ offlineExp: { freePct: f.readUInt16LE(10), xuPct: f.readUInt16LE(16), xuCost, goldPct: f.readUInt16LE(22), goldCost, minutes: xuCost } });
  }

  private offlineExpFree(): Buffer {
    if (this.offlineWait) throw new Error("Đang nhận Exp Offline rồi, chờ server trả lời xíu nha");
    this.offlineGain = null;
    // cap: 54/01 `00 1e 00` rồi ~0.1s sau 54/02 `00 02 1e 00` (loại 02 = nhận miễn phí)
    setTimeout(() => { try { this.io.send(encodeFrame(cmdBody(0x54, 0x02, [0x00, 0x02, TsOnlineSession.OFFER_OFFLINE_EXP, 0x00]))); } catch { /* socket đã đóng */ } }, 300);
    this.offlineWait = setTimeout(() => { this.offlineWait = undefined; this.io.game(MSG.offlineExpNoReply); }, 5000);
    return encodeFrame(cmdBody(0x54, 0x01, [0x00, TsOnlineSession.OFFER_OFFLINE_EXP, 0x00]));
  }

  /** 54/02 phản hồi: `00 | offer u16 | kết quả u8` (01 = thành công, đã thấy ở mọi mẫu mua). */
  private shopReply(f: Buffer) {
    const offer = f.readUInt16LE(9);
    if (offer === TsOnlineSession.OFFER_OFFLINE_EXP) {
      if (this.offlineWait) { clearTimeout(this.offlineWait); this.offlineWait = undefined; }
      this.io.game(f[11] === 0x01 ? MSG.offlineExpOk(this.offlineGain) : MSG.offlineExpFailed(f[11]!));
      this.offlineGain = null;
    } else if (offer === 0x000d) {
      if (f[11] === 0x01) {
        this.io.game("🛒 [Phó bản đơn] Mua thêm lượt phó bản thành công (-10 Vàng)!");
      } else {
        this.io.game(`⚠️ [Phó bản đơn] Mua thêm lượt phó bản không thành công (kết quả ${f[11]})`);
      }
    } else if (offer === 0x0025) { // Offer 37: Xu Lạp Bá
      this.io.log("info", `[Lạp Bá 54/02] Server phản hồi kết quả: ${f[11]} (hex=${f.toString("hex")})`);
      if (f[11] === 0x01) {
        this.lapBaResolve?.({ ok: true });
      } else {
        const errMsg = f[11] === 0x00
          ? "Máy chủ từ chối: Võ tướng Tái sinh / Trùng sinh (Reborn 2) hoặc đã đạt giới hạn cấp độ không thể quay Xu Lạp Bá!"
          : `Máy chủ từ chối quay (mã lỗi ${f[11]})`;
        this.lapBaResolve?.({ ok: false, error: errMsg });
      }
    }
  }

  // ---------------------------------------------------------------- Thư (53/xx)
  private mails: { id: number; flag: number; title: string; items: { id: number; qty: number }[]; done?: boolean }[] = [];
  private mailRun?: { queue: TsOnlineSession["mails"]; total: number; ok: number; failed: number; misses: number; cur?: TsOnlineSession["mails"][number]; timer?: NodeJS.Timeout };

  /**
   * 53/01 (server → client, lúc login): `00 | count u32 | count × [id u32, thời gian f64, cờ u8, độ dài tiêu đề u16, tiêu đề Big5,
   * số quà u8, quà × 36 byte (loại u8, itemId u16, số lượng u32, …)]`. Cờ: 0 = chưa đọc, 2 = đã mở (đối chiếu cap: thư mới = 0, thư cũ = 2).
   */
  private mailList(f: Buffer) {
    const n = f.readUInt32LE(9);
    const mails: TsOnlineSession["mails"] = [];
    let o = 13;
    try {
      for (let i = 0; i < n; i++) {
        const id = f.readUInt32LE(o), flag = f[o + 12]!, tl = f.readUInt16LE(o + 13);
        const title = new TextDecoder("big5").decode(f.subarray(o + 15, o + 15 + tl)).replace(/<[^>]*>/g, "");
        o += 15 + tl;
        const cnt = f[o]!; o += 1;
        const items: { id: number; qty: number }[] = [];
        for (let k = 0; k < cnt; k++, o += 36) items.push({ id: f.readUInt16LE(o + 1), qty: f.readUInt32LE(o + 3) });
        mails.push({ id, flag, title, items });
      }
    } catch { this.io.log("warn", `không đọc hết danh sách thư (${mails.length}/${n})`); }
    this.mails = mails;
    this.io.log("info", `hòm thư: ${mails.length} thư, ${mails.filter((m) => m.items.length).length} thư có quà`);
  }

  private mailClaimAll(): Buffer {
    if (this.mailRun) throw new Error("Đang nhận quà thư rồi, chờ xíu nha");
    const todo = this.mails.filter((m) => m.items.length && !m.done);
    if (!todo.length) throw new Error("Hòm thư không có quà nào để nhận (hoặc chưa đọc được danh sách thư)");
    this.mailRun = { queue: [...todo], total: todo.length, ok: 0, failed: 0, misses: 0 };
    this.io.game(MSG.mailStart(todo.length));
    return this.mailNext()!;
  }

  /** Gửi thư kế tiếp: (thư chưa đọc) 53/03 mở thư → 53/01 nhận quà; chờ ack 53/02 tối đa 1.8s. Trả frame để gửi (hoặc undefined nếu đã xong). */
  private mailNext(): Buffer | undefined {
    const run = this.mailRun;
    if (!run) return;
    const m = run.queue.shift();
    if (!m) { this.mailFinish(); return; }
    run.cur = m;
    const idb = [0x00, 0x01, 0x00, 0x00, 0x00, m.id & 0xff, (m.id >> 8) & 0xff, (m.id >> 16) & 0xff, (m.id >>> 24) & 0xff];
    const frames = [...(m.flag === 0 ? [encodeFrame(cmdBody(0x53, 0x03, idb))] : []), encodeFrame(cmdBody(0x53, 0x01, idb))];
    run.timer = setTimeout(() => this.mailMiss(), 1800);
    return Buffer.concat(frames);
  }

  private mailSend(b: Buffer | undefined) { if (b) { try { this.io.send(b); } catch { /* socket đã đóng */ } } }

  private mailAck(id: number) {
    const run = this.mailRun;
    if (!run?.cur || run.cur.id !== id) return;
    clearTimeout(run.timer);
    run.cur.done = true; run.ok++; run.misses = 0; run.cur = undefined;
    setTimeout(() => this.mailSend(this.mailNext()), 300);
  }

  private mailMiss() {
    const run = this.mailRun;
    if (!run?.cur) return;
    this.io.game(MSG.mailNoReply(run.cur.title));
    run.failed++; run.misses++; run.cur = undefined;
    if (run.misses >= 3) { run.failed += run.queue.length; this.io.game(MSG.mailStopped("3 thư liên tiếp không nhận được, có thể túi đồ đã đầy")); this.mailFinish(); }
    else this.mailSend(this.mailNext());
  }

  private mailBagFull() {
    const run = this.mailRun;
    if (!run) { this.io.game(MSG.mailBagFull); return; }
    clearTimeout(run.timer);
    this.io.game(MSG.mailBagFull);
    run.failed += run.queue.length + (run.cur ? 1 : 0); run.queue = []; run.cur = undefined;
    this.mailFinish();
  }

  private mailFinish() {
    const run = this.mailRun;
    if (!run) return;
    clearTimeout(run.timer);
    this.mailRun = undefined;
    this.io.game(MSG.mailDone(run.ok, run.total, run.failed));
  }

  // ---------------------------------------------------------------- Bạn bè & Quà tặng (0e/xx, cap 26/10)
  private friends: { uid: Buffer; name: string; status: number }[] = [];

  /**
   * 0e/05 (server → client, lúc login): danh sách bạn bè.
   * f[8] = 0x00, f[9..10] = count (uint16 LE).
   * Mỗi bản ghi: [8 byte UID][1 byte nameLen][nameLen byte tên][35 byte metadata].
   * metadata[18]: cờ quà tặng ban đầu (2: có quà gửi đến chờ nhận).
   */
  private parseFriendList(f: Buffer) {
    if (f.length < 11) return;
    const count = f.readUInt16LE(9);
    const list: TsOnlineSession["friends"] = [];
    let o = 11;
    try {
      for (let i = 0; i < count; i++) {
        if (o + 9 > f.length) break;
        const uid = Buffer.from(f.subarray(o, o + 8));
        const nameLen = f[o + 8]!;
        o += 9;
        if (o + nameLen + 35 > f.length) break;
        let name = "";
        try {
          name = new TextDecoder("utf-8").decode(f.subarray(o, o + nameLen));
        } catch {
          name = f.subarray(o, o + nameLen).toString("ascii");
        }
        o += nameLen;
        const meta = f.subarray(o, o + 35);
        const status = meta[18] ?? 0;
        o += 35;
        list.push({ uid, name, status });
      }
    } catch {
      this.io.log("warn", `không đọc hết danh sách bạn bè (${list.length}/${count})`);
    }
    this.friends = list;
    this.io.patchState({
      friends: this.friends.map((fr) => ({
        uid: fr.uid.toString("hex"),
        name: fr.name,
        status: fr.status,
      })),
    });
    this.io.log("info", `[Bạn bè] Đã tải ${list.length} bạn bè từ server.`);
  }

  /**
   * 0e/0c (server → client, sau khi gửi 0e/12 hoặc 0e/13): trạng thái quà tặng của từng bạn bè.
   * f[8] = 0x00, f[9] = count (uint8).
   * Mỗi bản ghi: [8 byte UID][1 byte status].
   * status bitmask: bit 0 (0x01) = đã tặng quà hôm nay, bit 1 (0x02) = có quà chờ nhận, bit 2 (0x04) = đã nhận quà hôm nay.
   */
  private parseFriendGiftStatus(f: Buffer) {
    if (f.length < 10) return;
    const count = f[9]!;
    let o = 10;
    try {
      for (let i = 0; i < count; i++) {
        if (o + 9 > f.length) break;
        const uid = f.subarray(o, o + 8);
        const status = f[o + 8]!;
        o += 9;
        const friend = this.friends.find((fr) => fr.uid.equals(uid));
        if (friend) {
          friend.status = status;
        }
      }
    } catch {
      this.io.log("warn", "lỗi đọc cập nhật trạng thái quà bạn bè (0e/0c)");
    }
    this.io.patchState({
      friends: this.friends.map((fr) => ({
        uid: fr.uid.toString("hex"),
        name: fr.name,
        status: fr.status,
      })),
    });
  }

  private async friendGiftAction(
    name: string,
    _args: string[],
    _signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    if (this.friends.length === 0) {
      this.io.game("🎁 [Bạn bè] Danh sách bạn bè trống hoặc chưa nhận được từ server.");
      return { ok: false, message: "Danh sách bạn bè trống hoặc chưa nhận được từ server" };
    }

    if (name === "friend_send_gift") {
      const uids = this.friends.map((f) => f.uid);
      const payload = Buffer.concat([Buffer.from([0x00, uids.length]), ...uids]);
      this.io.send(encodeFrame(cmdBody(0x0e, 0x12, payload)));
      this.io.game(`🎁 [Bạn bè] Đã gửi tặng quà cho tất cả ${uids.length} bạn bè.`);
      await sleep(500);
      return { ok: true, message: `Đã gửi tặng quà cho ${uids.length} bạn bè` };
    }

    if (name === "friend_receive_gift") {
      const claimable = this.friends.filter((f) => (f.status & 0x02) !== 0 || f.status === 2 || f.status === 3);
      if (claimable.length === 0) {
        this.io.game("🎁 [Bạn bè] Không có quà bạn bè nào đang chờ nhận.");
        return { ok: true, message: "Không có quà bạn bè nào đang chờ nhận" };
      }
      const uids = claimable.map((f) => f.uid);
      const payload = Buffer.concat([Buffer.from([0x00, uids.length]), ...uids]);
      this.io.send(encodeFrame(cmdBody(0x0e, 0x13, payload)));
      this.io.game(`🎁 [Bạn bè] Đã nhận quà từ ${uids.length} bạn bè.`);
      await sleep(500);
      return { ok: true, message: `Đã nhận quà từ ${uids.length} bạn bè` };
    }

    if (name === "friend_gift_all") {
      // 1. Tặng quà tất cả danh sách bạn bè (0e/12)
      const uids = this.friends.map((f) => f.uid);
      const sendPayload = Buffer.concat([Buffer.from([0x00, uids.length]), ...uids]);
      this.io.send(encodeFrame(cmdBody(0x0e, 0x12, sendPayload)));
      this.io.game(`🎁 [Bạn bè] Đã gửi tặng quà cho tất cả ${uids.length} bạn bè.`);

      // Chờ server phản hồi 0e/0c để cập nhật trạng thái quà
      await sleep(600);

      // 2. Nhận quà từ tất cả bạn bè gửi quà (status có cờ 0x02)
      const claimable = this.friends.filter((f) => (f.status & 0x02) !== 0 || f.status === 2 || f.status === 3);
      if (claimable.length > 0) {
        const claimUids = claimable.map((f) => f.uid);
        const recvPayload = Buffer.concat([Buffer.from([0x00, claimUids.length]), ...claimUids]);
        this.io.send(encodeFrame(cmdBody(0x0e, 0x13, recvPayload)));
        this.io.game(`🎁 [Bạn bè] Đã nhận quà từ ${claimUids.length} bạn bè.`);
        await sleep(400);
      } else {
        this.io.game("🎁 [Bạn bè] Không có quà bạn bè nào đang chờ nhận.");
      }

      return {
        ok: true,
        message: `Đã tặng quà cho ${uids.length} bạn bè và nhận quà từ ${claimable.length} bạn bè`,
      };
    }

    return { ok: false, message: `Hành động ${name} không hợp lệ` };
  }

  // ---------------------------------------------------------------- Rút Bí Cấp Tướng & Rút Thẻ Tướng (42/01, cap 26/10)
  private async pullHeroAction(
    name: string,
    _args: string[],
    _signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    if (name === "pull_secret") {
      // 42/01: 00 05 01 01 01 5b b2 28 23 01 00 00 (item 45659 "Triệu Tướng 1", 9.000 Xu)
      this.io.send(encodeFrame(cmdBody(0x42, 0x01, [0x00, 0x05, 0x01, 0x01, 0x01, 0x5b, 0xb2, 0x28, 0x23, 0x01, 0x00, 0x00])));
      this.io.game("📜 [Rút bí cấp tướng] Đã gửi yêu cầu rút 1 bí cấp tướng (-9.000 Xu).");
      await sleep(500);
      return { ok: true, message: "Đã rút 1 bí cấp tướng (-9.000 Xu)" };
    }

    if (name === "pull_card") {
      // 42/01: 00 05 01 01 02 5c b2 28 23 01 00 00 (item 45660 "Rút Thẻ 1", 9.000 Xu)
      this.io.send(encodeFrame(cmdBody(0x42, 0x01, [0x00, 0x05, 0x01, 0x01, 0x02, 0x5c, 0xb2, 0x28, 0x23, 0x01, 0x00, 0x00])));
      this.io.game("🃏 [Rút thẻ tướng] Đã gửi yêu cầu rút 1 thẻ tướng (-9.000 Xu).");
      await sleep(500);
      return { ok: true, message: "Đã rút 1 thẻ tướng (-9.000 Xu)" };
    }

    if (name === "pull_all") {
      // 1. Rút 1 bí cấp tướng (45659, 9.000 Xu)
      this.io.send(encodeFrame(cmdBody(0x42, 0x01, [0x00, 0x05, 0x01, 0x01, 0x01, 0x5b, 0xb2, 0x28, 0x23, 0x01, 0x00, 0x00])));
      this.io.game("📜 [Rút bí cấp tướng] Đã gửi yêu cầu rút 1 bí cấp tướng (-9.000 Xu).");
      await sleep(600);

      // 2. Rút 1 thẻ tướng (45660, 9.000 Xu)
      this.io.send(encodeFrame(cmdBody(0x42, 0x01, [0x00, 0x05, 0x01, 0x01, 0x02, 0x5c, 0xb2, 0x28, 0x23, 0x01, 0x00, 0x00])));
      this.io.game("🃏 [Rút thẻ tướng] Đã gửi yêu cầu rút 1 thẻ tướng (-9.000 Xu).");
      await sleep(400);

      return { ok: true, message: "Đã rút 1 bí cấp tướng và 1 thẻ tướng (tổng 18.000 Xu)" };
    }

    return { ok: false, message: `Hành động ${name} không hợp lệ` };
  }

  /**
   * Quay Xu Lạp Bá (đối chiếu capture Ngung xuat chien slot 1 & Quay lap ba slot 1.pcap):
   * - Nếu pet ở slot chỉ định đang xuất chiến: cho nghỉ (13/02 00) -> mở (4c/05) -> hỏi offer/chọn tướng (54/01) -> quay (54/02) -> đóng (4c/05) -> xuất chiến lại (13/01)
   * - Nếu pet đang nghỉ: mở (4c/05) -> hỏi offer/chọn tướng (54/01) -> quay (54/02) -> đóng (4c/05) lấy exp
   */
  private async spinLapBaAction(
    args: string[],
    write: (b: Buffer) => void,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    const targetSlot = Number(args[0]) || 1;
    const petTarget = this.roster.find((r) => r.idx === targetSlot) ?? (targetSlot === 1 ? this.roster[0] : undefined);
    if (!petTarget) {
      return { ok: false, message: `Không tìm thấy võ tướng ở slot ${targetSlot}` };
    }
    const actualSlot = petTarget.idx;
    const petName = (npcNames as Record<string, string>)[String(petTarget.model)] ?? `#${petTarget.model}`;
    const currentActive = this.activePet();
    const isTargetActive = petTarget === currentActive || (this.activeModel != null && petTarget.model === this.activeModel);

    // Kiểm tra số lượng Xu Lạp Bá trong túi đồ (item 31207 hoặc 32939)
    const lapBaItems = [...this.bag.values()].filter((it) => it.id === 31207 || it.id === 32939);
    const totalLapBa = lapBaItems.reduce((acc, it) => acc + it.qty, 0);
    if (this.bagLoaded && totalLapBa <= 0) {
      this.io.game("⚠️ [Xu Lạp Bá] Trong túi đồ không có 'Xu Lạp Bá' (item 31207)! Vui lòng kiểm tra lại túi đồ.");
      return { ok: false, message: "Trong túi đồ không có Xu Lạp Bá (item 31207)" };
    }

    this.io.game(`🎰 [Xu Lạp Bá] Chọn võ tướng: ${petName} (slot ${actualSlot}, model ${petTarget.model}, Lv ${petTarget.level}) | Nhân vật Lv ${this.player.level || "?"}`);

    // Bước 1: nếu đang xuất chiến thì cho nghỉ trước (gói 13/02 00 chuẩn theo pcap)
    if (isTargetActive) {
      this.io.game(`🔄 [Xu Lạp Bá] Võ tướng ${petName} (slot ${actualSlot}) đang xuất chiến, cho về trạng thái nghỉ...`);
      write(encodeFrame(cmdBody(0x13, 0x02, [0x00])));
      await sleep(1000);
      if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };
    }

    // Bước 2: quay Xu Lạp Bá nhận EXP
    this.io.game(`🎰 [Xu Lạp Bá] Bắt đầu quay Xu Lạp Bá${totalLapBa > 0 ? ` (còn ${totalLapBa} Xu)` : ""} cho võ tướng ${petName} (slot ${actualSlot})...`);
    // 2.1: Mở giao diện lạp bá (4c/05 00)
    write(encodeFrame(cmdBody(0x4c, 0x05, [0x00])));
    await sleep(800);
    if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };

    const slotLow = actualSlot & 0xff;
    const slotHigh = (actualSlot >> 8) & 0xff;
    const modelLow = petTarget.model & 0xff;
    const modelHigh = (petTarget.model >> 8) & 0xff;

    // 2.2: Gửi gói 54/01 hỏi giá / chọn võ tướng đích cho offer lạp bá (0x0025 = offer 37 Lạp Bá)
    write(encodeFrame(cmdBody(0x54, 0x01, [0x00, 0x25, 0x00, slotLow, slotHigh, modelLow, modelHigh])));
    await sleep(800);
    if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };

    // Tạo promise đợi phản hồi từ server (54/02 hoặc 08/02)
    const waitPromise = new Promise<{ ok: boolean; expGained?: number; error?: string }>((resolve) => {
      this.lapBaResolve = resolve;
    });

    // 2.3: Gửi gói 54/02 thực hiện quay (count = 1, offer = 0x0025, targetType = 0x04 (võ tướng), slot, model)
    write(encodeFrame(cmdBody(0x54, 0x02, [0x00, 0x01, 0x25, 0x00, 0x04, slotLow, slotHigh, modelLow, modelHigh])));

    // Chờ tối đa 3500ms
    const timeoutPromise: Promise<{ ok: boolean; expGained?: number; error?: string }> = sleep(3500).then(() => ({ ok: false, error: "timeout" }));
    const spinRes = await Promise.race([waitPromise, timeoutPromise]);
    this.lapBaResolve = undefined;

    // 2.4: Đóng / cập nhật lại lạp bá (4c/05 00)
    write(encodeFrame(cmdBody(0x4c, 0x05, [0x00])));
    await sleep(500);
    if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };

    if (spinRes.ok) {
      this.io.game(`✨ [Xu Lạp Bá] Hoàn tất quay Xu Lạp Bá cho võ tướng ${petName}${spinRes.expGained ? ` (+${spinRes.expGained.toLocaleString("vi-VN")} exp)` : ""}!`);
      this.io.log("info", `[Xu Lạp Bá] Đã quay xong Xu Lạp Bá cho võ tướng ${petName} (slot ${actualSlot})${isTargetActive ? " và xuất chiến lại" : ""}`);
    } else if (spinRes.error === "timeout") {
      this.io.game(`⚠️ [Xu Lạp Bá] Đã gửi lệnh quay nhưng chưa nhận được phản hồi từ máy chủ`);
    } else {
      this.io.game(`⚠️ [Xu Lạp Bá] ${spinRes.error}`);
    }

    // Bước 3: nếu trước đó đang xuất chiến thì xuất chiến lại (gói 13/01 00 modelLow modelHigh)
    if (isTargetActive) {
      this.io.game(`⚔️ [Xu Lạp Bá] Xuất chiến lại võ tướng ${petName} (slot ${actualSlot})...`);
      write(encodeFrame(cmdBody(0x13, 0x01, [0x00, modelLow, modelHigh])));
      await sleep(600);
    }

    return spinRes.ok
      ? { ok: true, message: `Quay Xu Lạp Bá thành công cho võ tướng ${petName} (slot ${actualSlot})` }
      : { ok: false, message: spinRes.error === "timeout" ? "Máy chủ chưa phản hồi kết quả quay Xu Lạp Bá" : spinRes.error };
  }

  /**
   * Nhận quà nhiệm vụ hàng ngày (khớp capture nhan qua nv hang ngay.pcap):
   * Gói 5b/02 gửi danh sách 9 nhiệm vụ ngày -> Gói 5b/03 nhận 4 rương mốc tích luỹ năng động
   */
  private async dailyQuestClaimAction(
    write: (b: Buffer) => void,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    this.io.game("📜 [Nhiệm vụ ngày] Đang gửi yêu cầu nhận toàn bộ quà nhiệm vụ hàng ngày...");
    // 1. Gửi gói 5b/02 nhận 9 nhiệm vụ ngày (khớp pcap nhan qua nv hang ngay.pcap)
    const tasksPayload = [
      0x00, 0x09,
      0x01, 0x00, 0x01, 0x2f, 0x00,
      0x01, 0x00, 0x02, 0x30, 0x00,
      0x01, 0x00, 0x03, 0x31, 0x00,
      0x01, 0x00, 0x04, 0x32, 0x00,
      0x01, 0x00, 0x05, 0x33, 0x00,
      0x01, 0x00, 0x06, 0x34, 0x00,
      0x01, 0x00, 0x07, 0x35, 0x00,
      0x01, 0x00, 0x08, 0x36, 0x00,
      0x01, 0x00, 0x09, 0x37, 0x00,
    ];
    write(encodeFrame(cmdBody(0x5b, 0x02, tasksPayload)));
    await sleep(600);
    if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };

    // 2. Gửi các gói 5b/03 nhận rương mốc điểm năng động (mốc 2, 4, 6, 8)
    const boxMilestones = [
      { idx: 2, boxId: 0x0030 },
      { idx: 4, boxId: 0x0032 },
      { idx: 6, boxId: 0x0034 },
      { idx: 8, boxId: 0x0036 },
    ];
    for (const bm of boxMilestones) {
      write(encodeFrame(cmdBody(0x5b, 0x03, [0x00, 0x01, 0x00, bm.idx, bm.boxId & 0xff, (bm.boxId >> 8) & 0xff])));
      await sleep(400);
      if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };
    }

    this.io.game("✨ [Nhiệm vụ ngày] Hoàn tất nhận toàn bộ quà nhiệm vụ và rương điểm năng động!");
    this.io.log("info", "[Nhiệm vụ ngày] Đã gửi lệnh nhận quà 9 nhiệm vụ ngày và 4 rương mốc năng động");
    return { ok: true, message: "Đã nhận quà nhiệm vụ ngày và các rương năng động thành công" };
  }

  /**
   * Nhận quà Sổ Thông Hành (khớp capture nhan qua thong hanh.pcap):
   * Mở 4d/0b 00 80 00 -> Quét các mốc 4d/0b 00 81 <mốc LE> -> Mở 4d/0b 00 80 01 -> Thu thập thư quà 53/01
   */
  private async battlePassClaimAction(
    write: (b: Buffer) => void,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    this.io.game("🎫 [Thông Hành] Đang mở Sổ Thông Hành và kiểm tra mốc quà...");
    // 1. Mở thông hành tab 0
    write(encodeFrame(cmdBody(0x4d, 0x0b, [0x00, 0x80, 0x00])));
    await sleep(400);
    if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };

    // 2. Nhận các mốc quà thông hành khả dụng (4 mốc kế tiếp theo capture)
    const startMilestone = this.battlePass?.nextMilestone || 58;
    const maxScan = Math.min(startMilestone + 6, 100);
    let claimCount = 0;
    for (let m = startMilestone; m <= maxScan; m += 2) {
      write(encodeFrame(cmdBody(0x4d, 0x0b, [0x00, 0x81, m & 0xff, (m >> 8) & 0xff])));
      claimCount++;
      await sleep(200);
      if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };
    }

    // 3. Mở tab 1 (thông hành mở rộng)
    write(encodeFrame(cmdBody(0x4d, 0x0b, [0x00, 0x80, 0x01])));
    await sleep(300);
    if (signal.aborted) return { ok: false, message: "Bị huỷ thao tác" };

    // 4. Thu thập quà thư nếu quà được gửi vào hộp thư
    try {
      await this.mailClaimAll();
    } catch {}

    this.io.game(`✨ [Thông Hành] Hoàn tất nhận quà Sổ Thông Hành (đã quét ${claimCount} mốc quà và thu thập quà thư)!`);
    this.io.log("info", `[Thông Hành] Đã gửi lệnh nhận các mốc quà thông hành từ mốc ${startMilestone} đến ${maxScan}`);
    return { ok: true, message: "Đã nhận quà Sổ Thông Hành thành công" };
  }

  // ---------------------------------------------------------------- Nhà Trọ & Vận Tiêu (1f/06, 56/01, 56/02, 56/03)
  private getEscortState(): EscortState {
    const dailyCount = this.counterMap.get(CTR_ESCORT)?.val ?? 0;
    return {
      phase: this.escortPhase,
      dailyCount,
      maxDailyCount: 3,
      activeEscort: this.activeEscort,
      message: this.escortMessage,
      updatedAt: Date.now(),
    };
  }

  /** S→C 1f/06: Danh sách võ tướng trong Nhà Trọ. */
  private innPetsList(f: Buffer) {
    const list: InnPetInfo[] = [];
    let o = 9;
    try {
      while (o + 14 <= f.length) {
        const slot = f[o]!;
        const model = f.readUInt16LE(o + 1);
        const level = f[o + 3]!;
        const exp = f.readUInt32LE(o + 4);
        const hp = f.readUInt32LE(o + 8);
        const nameLen = f[o + 12]!;
        if (o + 13 + nameLen > f.length) break;
        const name = new TextDecoder("big5").decode(f.subarray(o + 13, o + 13 + nameLen)).replace(/<[^>]*>/g, "");
        const status = f[o + 13 + nameLen] ?? 0;
        list.push({ slot, model, name, level, exp, hp, status });
        o += 14 + nameLen;
      }
    } catch (e) {
      this.io.log("warn", `[Nhà Trọ] Lỗi parse 1f/06: ${e}`);
    }

    if (list.length > 0) {
      for (const pet of list) {
        const idx = this.innPets.findIndex((p) => p.slot === pet.slot);
        if (idx >= 0) this.innPets[idx] = pet;
        else this.innPets.push(pet);
      }
      this.innPets.sort((a, b) => a.slot - b.slot);
      this.io.game(`🏡 [Nhà Trọ] Đã nhận thông tin ${this.innPets.length} võ tướng gửi trong Nhà Trọ.`);
      this.io.patchState({ innPets: [...this.innPets], escort: this.getEscortState() });
    }
  }

  /** S→C 56/03: Trạng thái Vận Tiêu. */
  private escortStatus(f: Buffer) {
    const isActive = f[9] === 0x01;
    if (!isActive) {
      this.activeEscort = undefined;
      for (const p of this.innPets) {
        if (p.status === 1) p.status = 0;
      }
      this.escortPhase = (this.counterMap.get(CTR_ESCORT)?.val ?? 0) >= 3 ? "completed_daily" : "idle";
      this.escortMessage = "Hiện không có chuyến vận tiêu nào đang chạy.";
      this.io.patchState({ innPets: [...this.innPets], escort: this.getEscortState() });
      return;
    }

    const slot = f[10]!;
    if (f.length >= 27) {
      const startOle = f.readDoubleLE(11);
      const endOle = f.readDoubleLE(19);
      if (startOle === 0 || endOle === 0) {
        this.activeEscort = undefined;
        for (const p of this.innPets) {
          if (p.status === 1) p.status = 0;
        }
        this.escortPhase = (this.counterMap.get(CTR_ESCORT)?.val ?? 0) >= 3 ? "completed_daily" : "idle";
        this.escortMessage = "Hiện không có chuyến vận tiêu nào đang chạy.";
        this.io.patchState({ innPets: [...this.innPets], escort: this.getEscortState() });
        return;
      }

      const startTime = Math.round((startOle - 25569) * 86400 * 1000);
      const endTime = Math.round((endOle - 25569) * 86400 * 1000);
      const pet = this.innPets.find((p) => p.slot === slot);
      this.activeEscort = {
        slot,
        petName: pet?.name,
        startTime,
        endTime,
        durationHours: Math.round(((endTime - startTime) / 3600000) * 10) / 10,
      };
      if (pet) pet.status = 1;

      const now = Date.now();
      if (now >= endTime) {
        this.escortPhase = "reward_ready";
        this.escortMessage = `Võ tướng ô ${slot} (${pet?.name ?? "Pet"}) đã hoàn thành chuyến vận tiêu! Đang sẵn sàng nhận thưởng.`;
        this.io.game(`🎁 [Vận Tiêu] ${this.escortMessage}`);
      } else {
        this.escortPhase = "escorting";
        const timeStr = new Date(endTime).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
        this.escortMessage = `Võ tướng ô ${slot} (${pet?.name ?? "Pet"}) đang vận tiêu (dự kiến hoàn thành lúc ${timeStr}).`;
        this.io.game(`🐎 [Vận Tiêu] ${this.escortMessage}`);
      }
      this.io.patchState({ innPets: [...this.innPets], escort: this.getEscortState() });
    }
  }

  /** S→C 56/02: Phản hồi bắt đầu Vận Tiêu thành công. */
  private escortStartReply(f: Buffer) {
    const slot = f[9]!;
    const pet = this.innPets.find((p) => p.slot === slot);
    if (pet) pet.status = 1;
    this.escortPhase = "escorting";
    this.io.game(`🐎 [Vận Tiêu] Bắt đầu chuyến vận tiêu thành công với võ tướng ô ${slot} (${pet?.name ?? "Pet"})!`);
    this.io.patchState({ innPets: [...this.innPets], escort: this.getEscortState() });
  }

  /** S→C 56/05: Phản hồi nhận thưởng Vận Tiêu thành công. */
  private escortClaimReply(f: Buffer) {
    this.activeEscort = undefined;
    for (const p of this.innPets) {
      if (p.status === 1) p.status = 0;
    }
    const count = this.counterMap.get(CTR_ESCORT)?.val ?? 0;
    this.escortPhase = count >= 3 ? "completed_daily" : "idle";
    this.escortMessage = "Đã nhận thưởng hoàn tất chuyến vận tiêu! Võ tướng đã được giải phóng.";
    this.io.game("🎁 [Vận Tiêu] Đã nhận phần thưởng hoàn tất chuyến vận tiêu thành công! Võ tướng đã được giải phóng.");
    this.io.patchState({ innPets: [...this.innPets], escort: this.getEscortState() });
  }

  private async innEscortAction(
    name: string,
    args: string[],
    write: (b: Buffer) => void,
    _signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    if (name === "escort_query") {
      write(encodeFrame(cmdBody(0x56, 0x01, [0x00])));
      await sleep(300);
      return { ok: true, message: "Đã gửi yêu cầu kiểm tra trạng thái vận tiêu" };
    }

    if (name === "escort_claim") {
      this.io.game("🎁 [Vận Tiêu] Đang nhận phần thưởng hoàn thành Vận Tiêu (56/05)...");
      write(encodeFrame(cmdBody(0x56, 0x05, [0x00, 0x01])));
      await sleep(600);
      write(encodeFrame(cmdBody(0x56, 0x01, [0x00])));
      await sleep(300);
      return { ok: true, message: "Đã gửi yêu cầu nhận thưởng vận tiêu" };
    }

    if (name === "escort_start") {
      const slot = Number(args[0]) || 1;
      const pet = this.innPets.find((p) => p.slot === slot);
      if (pet && pet.status === 1) {
        return { ok: false, message: `Võ tướng ${pet.name} (ô ${slot}) đang trong chuyến vận tiêu khác!` };
      }
      this.io.game(`🐎 [Vận Tiêu] Đang cử võ tướng ô ${slot} (${pet?.name ?? "Pet"}) xuất phát vận tiêu...`);
      write(encodeFrame(cmdBody(0x56, 0x02, [0x00, slot & 0xff])));
      await sleep(500);
      return { ok: true, message: `Đã cử võ tướng ô ${slot} (${pet?.name ?? "Pet"}) xuất phát vận tiêu` };
    }

    return { ok: false, message: `Hành động ${name} không hợp lệ` };
  }

  /** 57/02 phản hồi: `00 | loại | mã kết quả`. Mã 0 = thành công; 2 = bị từ chối/đã điểm danh. */
  private checkinReply(f: Buffer) {
    const code = f[10]!;
    const day = this.pendingCheckinDay ?? this.counterMap.get(CTR_CHECKIN_DAY)?.val;
    this.pendingCheckinDay = undefined;
    if (code === 0) {
      let rewardText = "";
      if (day != null) {
        const rew = (dailyCheckinRewards.daily as Record<string, { day: number; itemId: number; qty: number; name: string }>)[String(day)];
        if (rew) {
          rewardText = `${rew.qty.toLocaleString("vi-VN")}x ${rew.name}`;
        }
      }
      this.io.game(MSG.checkinOk(day, rewardText));
    } else if (code === 2) {
      this.io.game(MSG.checkinAlready);
    } else {
      this.io.game(MSG.checkinFailed(code));
    }
  }

  /** 57/02 phản hồi quà Online (loại 03): `00 | 03 | mã kết quả`. Mã 0 = thành công; 2 = bị từ chối/đã nhận. */
  private onlineRewardReply(f: Buffer) {
    const code = f[10]!;
    const run = this.onlineRewardRun;
    const cur = run?.cur ?? this.lastOnlineRewardSent;
    if (code === 0) {
      if (cur) this.io.game(MSG.onlineRewardOk(cur));
      if (run) {
        clearTimeout(run.timer);
        run.ok++;
        run.cur = undefined;
        setTimeout(() => this.onlineRewardSendNext(), 800);
      }
    } else if (code === 2) {
      if (cur) this.io.game(MSG.onlineRewardAlready(cur));
      if (run) {
        clearTimeout(run.timer);
        run.cur = undefined;
        setTimeout(() => this.onlineRewardSendNext(), 800);
      }
    } else {
      if (cur) this.io.game(MSG.onlineRewardFailed(cur ?? 0, code));
      if (run) {
        clearTimeout(run.timer);
        run.cur = undefined;
        setTimeout(() => this.onlineRewardSendNext(), 800);
      }
    }
  }

  private onlineRewardSendNext() {
    const run = this.onlineRewardRun;
    if (!run) return;
    const min = run.queue.shift();
    if (!min) {
      clearTimeout(run.timer);
      this.onlineRewardRun = undefined;
      this.io.game(MSG.onlineRewardDone(run.ok, run.total));
      return;
    }
    run.cur = min;
    this.lastOnlineRewardSent = min;
    this.io.game(MSG.onlineRewardSending(min));
    try {
      this.io.send(this.encodeOnlineRewardFrame(min));
    } catch { /* socket đã đóng */ }
    run.timer = setTimeout(() => {
      if (this.onlineRewardRun?.cur === min) {
        this.onlineRewardRun.cur = undefined;
        this.onlineRewardSendNext();
      }
    }, 2000);
  }

  encodeOnlineRewardFrame(min: number): Buffer {
    return encodeFrame(cmdBody(0x57, 0x02, [0x00, 0x03, min & 0xff, (min >> 8) & 0xff, (min >> 16) & 0xff, (min >>> 24) & 0xff, 0x01]));
  }

  private startOnlineRewardAll(): Buffer {
    if (this.onlineRewardRun) throw new Error("Đang trong quá trình nhận quà Online rồi Ní ơi, chờ xíu nha");
    const curMin = this.getOnlineMinutes();
    const toClaim: number[] = [];
    for (const m of ONLINE_REWARD_MILESTONES) {
      if (this.claimedActivityFlags.has(m.flagId)) {
        this.io.game(MSG.onlineRewardAlready(m.minutes));
      } else if (curMin < m.minutes) {
        this.io.game(MSG.onlineRewardNotYet(m.minutes, curMin));
      } else {
        toClaim.push(m.minutes);
      }
    }
    if (toClaim.length === 0) {
      this.io.game(MSG.onlineRewardNone);
      return Buffer.alloc(0);
    }
    this.onlineRewardRun = {
      queue: [...toClaim],
      total: toClaim.length,
      ok: 0,
    };
    this.io.game(MSG.onlineRewardStart(toClaim.length));
    const first = this.onlineRewardRun.queue.shift()!;
    this.onlineRewardRun.cur = first;
    this.lastOnlineRewardSent = first;
    this.io.game(MSG.onlineRewardSending(first));
    this.onlineRewardRun.timer = setTimeout(() => {
      if (this.onlineRewardRun?.cur === first) {
        this.onlineRewardRun.cur = undefined;
        this.onlineRewardSendNext();
      }
    }, 2000);
    return this.encodeOnlineRewardFrame(first);
  }

  /* ---------------- Đội ngũ (0d/xx) ---------------- */

  private get selfHex() { return this.uid?.toString("hex") ?? ""; }

  /** 03/00 của người chơi khác (hoặc chính mình): ghi nhớ uid↔tên↔map để mời/xin theo tên và gắn tên cho roster. */
  private playerSpawn(f: Buffer) {
    const p = this.party.onSpawn(f);
    if (!p) return;
    // Người vừa spawn thuộc đội của mình ⇒ làm mới tên hiển thị.
    const leader = this.party.leaderOf(this.selfHex);
    if (leader && (p.uid === leader || this.party.parties.get(leader)?.includes(p.uid))) this.publishParty();

    // Nếu kênh hiện tại tích lũy đủ số lượng tài khoản (>= 10), máy chủ gen ra kênh mới tiếp theo
    if (!this.knownChannels.has(this.location.channel + 1)) {
      const prevCount = this.location.channels?.length ?? 1;
      const newChannels = this.buildMapChannels(this.location.map, this.location.channel);
      if (newChannels.length !== prevCount) {
        this.location = { ...this.location, channels: newChannels };
        this.io.patchState({ location: this.location });
      }
    }
  }

  private publishParty() {
    this.io.patchState({ party: this.party.snapshot(this.selfHex, this.partyStatus) });
  }

  private sendParty(sub: number, payload: number[], why: string) {
    const frame = encodeFrame(cmdBody(0x0d, sub, payload));
    this.io.log("info", `🤝 [Đội ngũ] tx 0d/${sub.toString(16).padStart(2, "0")} ${why} payload=${Buffer.from(payload).toString("hex")}`);
    this.io.send(frame);
  }

  /** Mọi gói 0d/xx từ server: LUÔN log hex mức info (gói hiếm) để đối chiếu giao thức khi gặp lỗi. */
  private partyPacket(sub: number, f: Buffer) {
    const op = `0d/${sub.toString(16).padStart(2, "0")}`;
    this.io.log("info", `🤝 [Đội ngũ] rx ${op} len=${f.length} ${f.toString("hex")}`);
    const self = this.selfHex;
    switch (sub) {
      case PARTY_SUB.ROSTER: {
        const n = this.party.parseRoster(f);
        this.io.log("debug", `[Đội ngũ] roster ${n} đội trong map; đội của mình: ${this.party.describe(self)}`);
        break;
      }
      case PARTY_SUB.ADVISORS:
        this.party.parseAdvisors(f);
        break;
      case PARTY_SUB.JOINED: {
        const j = this.party.parseJoined(f);
        if (j) {
          const who = this.party.nameOf(j.joiner) || `#${j.joiner.slice(0, 4)}`;
          const lead = this.party.nameOf(j.leader) || `#${j.leader.slice(0, 4)}`;
          this.partyStatus = "";
          this.io.game(`🤝 ${who} đã vào đội của ${lead}.`);
        }
        if (this.isMemberInParty()) {
          if (this.chaseCheckTimer) {
            clearTimeout(this.chaseCheckTimer);
            this.chaseCheckTimer = undefined;
          }
          if (this.autoMoveTimer) {
            clearTimeout(this.autoMoveTimer);
            this.autoMoveTimer = undefined;
          }
          this.chaseRunning = false;
        }
        break;
      }
      case PARTY_SUB.LEAVE: {
        const gone = this.party.parseLeft(f);
        this.io.game(`🤝 Rời đội: ${gone.map((u) => this.party.nameOf(u) || `#${u.slice(0, 4)}`).join(", ") || "(không rõ)"}`);
        break;
      }
      case PARTY_SUB.ADVISOR_SET:
        if (f.length >= 17) {
          const u = f.subarray(9, 17).toString("hex");
          this.party.setAdvisor(u);
          this.io.game(`🤝 ${this.party.nameOf(u) || `#${u.slice(0, 4)}`} đã được làm Quân sư.`);
        }
        break;
      case PARTY_SUB.ADVISOR_CLEAR:
      case PARTY_SUB.ADVISOR_CLEAR2:
        if (f.length >= 17) this.party.clearAdvisor(f.subarray(9, 17).toString("hex"));
        break;
      case PARTY_SUB.ACK:
        // `00 <code>`: server đã nhận lời mời/xin mình gửi. code ≠ 0 chưa biết nghĩa ⇒ báo ra để user gửi log.
        if (f.length >= 10 && f[9] !== 0) this.io.game(`🤝 Server trả mã ${f[9]} cho lời mời/xin đội vừa gửi (chưa rõ nghĩa).`);
        break;
      case PARTY_SUB.INVITED: // ✅ thực tế server gửi 0d/09 cho lời mời
      case PARTY_SUB.REQUEST: {
        if (f.length < 17) break;
        const kind = sub === PARTY_SUB.REQUEST ? "request" : "invite";
        const p = this.party.addPending(kind, f.subarray(9, 17).toString("hex"));
        const label = p.name || `#${p.uid.slice(0, 4)}`;
        this.partyStatus = kind === "invite" ? `${label} mời bạn vào đội` : `${label} xin vào đội`;
        this.io.game(`🤝 ${kind === "invite" ? `${label} mời bạn vào đội` : `${label} xin gia nhập đội của bạn`}.`);
        this.maybeAutoAccept(p.kind, p.uid, p.name);
        break;
      }
      default:
        this.io.log("debug", `[Đội ngũ] gói ${op} chưa giải mã`);
    }
    this.publishParty();
  }

  /** Tự trả lời đồng ý nếu người mời/xin nằm trong danh sách server cấu hình (set_party_config). */
  private maybeAutoAccept(kind: "invite" | "request", uid: string, name: string) {
    const key = normName(name);
    const ok = kind === "invite" ? !!key && key === normName(this.partyAuto.inviteFrom) : !!key && this.partyAuto.requestFrom.some((n) => normName(n) === key);
    if (!ok) {
      this.io.log("info", `[Đội ngũ] ${kind === "invite" ? "lời mời" : "lời xin"} từ "${name || uid}" không nằm trong danh sách tự chấp nhận — bỏ qua`);
      return;
    }
    this.replyParty(kind, uid, true);
  }

  /**
   * ĐỒNG Ý lời mời/xin: `0d/08` (mời) / `0d/03` (xin), payload `00 01 <uid>` (cờ 01 TRƯỚC uid).
   * ✅ 0d/08 khớp pcap thanhvien_accept_invite_; ❓ 0d/03 cùng layout nhưng chưa có pcap. Hai bản `00 <uid>` và `00 <uid> 01` đã thử thật: server im lặng.
   * Từ chối = không gửi gì (chưa có pcap thao tác từ chối).
   */
  private replyParty(kind: "invite" | "request", uid: string, accept: boolean) {
    this.party.takePending(kind, this.party.nameOf(uid) || undefined);
    const who = this.party.nameOf(uid) || uid;
    if (accept) this.sendParty(kind === "invite" ? PARTY_SUB.REPLY_INVITE : PARTY_SUB.REPLY_REQUEST, partyReplyPayload(uid, true), `ĐỒNG Ý ${kind === "invite" ? "lời mời" : "lời xin"} của ${who}${kind === "request" ? " (0d/03 chưa có pcap riêng)" : ""}`);
    else this.io.log("info", `🤝 [Đội ngũ] bỏ qua ${kind === "invite" ? "lời mời" : "lời xin"} của ${who} (từ chối = không gửi gói)`);
    this.partyStatus = "";
    this.publishParty();
  }

  /** Kiểm tra tài khoản hiện tại có đang là THÀNH VIÊN trong tổ đội (không phải chủ PT) hay không. */
  private isMemberInParty(): boolean {
    const uid = this.selfHex || (this.uid?.toString("hex") ?? "");
    const snap = this.party.snapshot(uid);
    if (snap.joined) {
      const me = snap.members.find((m) => m.isSelf);
      if (me && !me.isLeader) return true;
      if (snap.leaderName && this.player.name && normName(snap.leaderName) !== normName(this.player.name)) return true;
    }
    return false;
  }

  private roomTracker = new DungeonRoomTracker();
  private roomWaiters: (() => void)[] = [];

  /** Gói 0x2f từ server (xem codecs/dungeonRoom.ts): log hex mức info (gói hiếm, trừ danh sách) + cập nhật state phòng. */
  private dungeonRoomPacket(sub: number, f: Buffer) {
    const op = `2f/${sub.toString(16).padStart(2, "0")}`;
    if (sub !== DUNGEON_ROOM_SUB.LIST) this.io.log("info", `🏰 [Phó bản đội] rx ${op} ${f.subarray(8, 40).toString("hex")}`);
    if (this.roomTracker.onPacket(sub, f, this.selfHex)) {
      this.io.patchState({ dungeonRoom: { ...this.roomTracker.state } });
      for (const w of this.roomWaiters.splice(0)) w();
    }
  }

  private sendRoom(sub: number, payload: number[], why: string) {
    this.io.log("info", `🏰 [Phó bản đội] tx 2f/${sub.toString(16).padStart(2, "0")} ${why} payload=${Buffer.from(payload).toString("hex")}`);
    this.io.send(encodeFrame(cmdBody(0x2f, sub, payload)));
  }

  /** Chờ tracker thoả `pred` (kiểm tra ngay + mỗi lần state đổi) tối đa `ms`. */
  private waitRoom(pred: () => boolean, ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (pred()) return resolve(true);
      let done = false;
      const finish = (v: boolean) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => finish(false), ms);
      const w = () => { if (pred()) finish(true); else this.roomWaiters.push(w); };
      this.roomWaiters.push(w);
      signal.addEventListener("abort", () => finish(false), { once: true });
    });
  }

  /** Action phòng phó bản đội (gói ✅ pcap chupt_pbteam + member_join_pbteam). */
  private async dungeonRoomAction(name: string, args: string[], signal: AbortSignal): Promise<{ ok: boolean; message?: string }> {
    const T = this.roomTracker;
    const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
    switch (name) {
      case "dungeon_room_create": {
        const id = Number(args[0]);
        if (!Number.isInteger(id) || id < 1 || id > 255) return { ok: false, message: "Id phó bản không hợp lệ" };
        const pw = args[1] === "1";
        T.state = { status: "none" };
        this.sendRoom(DUNGEON_ROOM_SUB.CREATE, createRoomPayload(id, pw), `TẠO phòng id=${id} ${pw ? "có" : "không"} mật khẩu`);
        if (!(await this.waitRoom(() => T.state.status === "open" || T.state.status === "error", 6000, signal))) return { ok: false, message: "Server không trả lời gói tạo phòng (6s)" };
        if (T.state.status === "error") {
          // Mã 4 = đã hết lượt phó bản trong ngày (log thật 16:5x). Thông báo thân thiện, không phải lỗi để thử lại.
          if (T.state.code === 4) {
            const soloDef = DUNGEON_SOLO_CATALOG.find((d) => d.id === id);
            if (soloDef) {
              const msg = MSG.dungeonSoloDailyDone(soloDef.typeName);
              this.io.game(msg);
              return { ok: false, message: msg };
            }
            const def = DUNGEON_ROOM_CATALOG.find((d) => d.id === id);
            const msg = MSG.dungeonDailyDone((def as any)?.shortName ?? def?.name ?? `phó bản ${id}`);
            this.io.game(msg);
            return { ok: false, message: msg };
          }
          return { ok: false, message: `Server từ chối tạo phòng (mã ${T.state.code})` };
        }
        return { ok: true, message: T.state.password ? `Mật khẩu phòng: ${T.state.password}` : undefined };
      }
      case "dungeon_room_join": {
        // args: [tên chủ phòng, id phó bản, mật khẩu?]. Làm mới danh sách → tìm ĐÚNG phòng của chủ (tên + phó bản; nhiều phòng cũ cùng tên ⇒ lấy phòng MỚI NHẤT = roomId lớn nhất) → vào phòng.
        const leader = String(args[0] ?? "").trim();
        const dungeon = Number(args[1]);
        const pwd = String(args[2] ?? "");
        if (!leader) return { ok: false, message: "Thiếu tên chủ phòng" };
        for (let attempt = 0; attempt < 2; attempt++) {
          const seq = T.listSeq;
          this.sendRoom(DUNGEON_ROOM_SUB.LIST, [0x00], "danh sách phòng (tìm đội)");
          if (!(await this.waitRoom(() => T.listSeq > seq, 4000, signal))) return { ok: false, message: "Server không trả danh sách phòng (4s)" };
          const rooms = T.state.rooms ?? [];
          const room = rooms
            .filter((r) => normName(r.leaderName) === normName(leader) && (!Number.isInteger(dungeon) || r.dungeonId === dungeon))
            .sort((x, y) => y.roomId - x.roomId)[0];
          if (!room) return { ok: false, message: `Chưa thấy phòng của "${leader}"${Number.isInteger(dungeon) ? ` (phó bản ${dungeon})` : ""} — đang có ${rooms.length} phòng${rooms.length ? `: ${rooms.map((r) => `${r.leaderName}#${r.dungeonId}(${r.count} người)`).join(", ")}` : ""}` };
          T.state = { ...T.state, status: "none" };
          this.sendRoom(DUNGEON_ROOM_SUB.JOIN, joinRoomPayload(room.roomId, pwd), `VÀO phòng ${room.roomId} của ${room.leaderName} (${room.count} người)${pwd ? " (layout mật khẩu chưa kiểm chứng)" : ""}`);
          if (!(await this.waitRoom(() => T.state.status === "joined" || T.state.status === "error", 6000, signal))) return { ok: false, message: "Server không trả lời gói vào phòng (6s)" };
          if (T.state.status === "joined") return { ok: true };
          const code = T.state.code;
          // Mã 3 = vẫn còn ở phòng CŨ (log thật). Rời phòng cũ bằng 2f/0a (cùng gói chủ phòng dùng để huỷ/thoát phòng — SUY RA cho thành viên, chưa có pcap) rồi thử lại 1 lần.
          if (code === 3 && attempt === 0) {
            this.io.log("warn", "🏰 [Phó bản đội] Server từ chối vào phòng (mã 3) — thử rời phòng cũ bằng 2f/0a (suy ra, chưa có pcap thành viên rời phòng) rồi vào lại");
            this.sendRoom(DUNGEON_ROOM_SUB.CANCEL, [0x00], "RỜI phòng cũ (suy ra)");
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          return { ok: false, message: `Server từ chối vào phòng (mã ${code}${code === 3 ? " — nhiều khả năng đang ở phòng khác, hãy rời phòng cũ trong game" : ""})` };
        }
        return { ok: false, message: "Không vào được phòng" };
      }
      case "dungeon_room_ready": {
        if (T.state.status !== "joined") return { ok: false, message: "Chưa vào phòng nào" };
        if (T.state.ready) return { ok: true };
        this.sendRoom(DUNGEON_ROOM_SUB.READY, [0x00], "SẴN SÀNG");
        return (await this.waitRoom(() => T.state.ready === true, 4000, signal)) ? { ok: true } : { ok: false, message: "Server không xác nhận sẵn sàng (4s)" };
      }
      case "dungeon_exit": {
        // Thoát phó bản đội = RỜI ĐỘI `0d/04 00 <uid mình>` (pcap chupt_pbteam 81.9s: server đáp 0d/04 + 29/0c + 0c/00 về map cũ + 2f/0a st=03).
        // Khác `leave_party`: KHÔNG kiểm tra đang trong đội (chủ phòng chạy một mình vẫn thoát được).
        const self = this.selfHex;
        if (!self) return { ok: false, message: "Chưa biết UID của mình" };
        this.sendParty(PARTY_SUB.LEAVE, partyPayload(self), "THOÁT PHÓ BẢN (rời đội, uid chính mình)");
        this.party.remove(self);
        this.partyStatus = "";
        this.publishParty();
        return { ok: true };
      }
      case "dungeon_room_start": this.sendRoom(DUNGEON_ROOM_SUB.START, [0x00], "BẮT ĐẦU phó bản"); return { ok: true };
      case "dungeon_room_cancel": this.sendRoom(DUNGEON_ROOM_SUB.CANCEL, [0x00], "HUỶ phòng"); T.state = { status: "none" }; return { ok: true };
      case "dungeon_room_list": this.sendRoom(DUNGEON_ROOM_SUB.LIST, [0x00], "danh sách phòng"); return { ok: true };
      case "dungeon_buy": {
        const id = Number(args[0]) || 2;
        const idLow = id & 0xff;
        const idHigh = (id >> 8) & 0xff;
        // Gói chuẩn từ capture "mua luot 3 pb don.pcap":
        // 1. C→S 54/01 hỏi ưu đãi 0x000d: 00 0d 00 <id u16 LE>
        // 2. C→S 54/02 mua ưu đãi 0x000d: 00 02 0d 00 <id u16 LE> (10 Vàng)
        this.io.send(encodeFrame(cmdBody(0x54, 0x01, [0x00, 0x0d, 0x00, idLow, idHigh])));
        await sleep(150);
        this.io.send(encodeFrame(cmdBody(0x54, 0x02, [0x00, 0x02, 0x0d, 0x00, idLow, idHigh])));
        this.io.game(`🛒 [Phó bản đơn] Đã mua thêm lượt phó bản #${id} (Ưu đãi 0x000d, 10 Vàng).`);
        return { ok: true, message: `Đã mua thêm lượt phó bản #${id}` };
      }
      default: return { ok: false, message: `${name}: chưa hỗ trợ` };
    }
  }

  /** Action đội ngũ chạy trong executeAction (cần trả lỗi rõ ràng thay vì "chưa có gói tin"). Trả null nếu không phải action đội. */
  private partyAction(name: string, args: string[]): { ok: boolean; message?: string } | null {
    const self = this.selfHex;
    switch (name) {
      case "set_party_config": {
        let req: string[] = [];
        try { const v = JSON.parse(args[1] || "[]"); if (Array.isArray(v)) req = v.map(String); } catch { /* giữ rỗng */ }
        this.partyAuto = { inviteFrom: (args[0] ?? "").trim(), requestFrom: req.map((n) => n.trim()).filter(Boolean) };
        let members: string[] = [];
        try { const m = JSON.parse(args[4] || "[]"); if (Array.isArray(m)) members = m.map(String).map((n) => n.trim()).filter(Boolean); } catch {}
        this.partyTargetConfig = {
          role: args[2] === "member" ? "member" : "leader",
          leaderName: (args[3] ?? "").trim(),
          members: members.length > 0 ? members : this.partyAuto.requestFrom,
          escapeIfNotFullParty: args[5] === "1" || args[5] === "true",
        };
        const escapeDesc = this.partyTargetConfig.escapeIfNotFullParty ? " | 🏃 Tự chạy khi chưa đủ PT: BẬT" : "";
        this.io.log("info", `[Đội ngũ] tự chấp nhận: mời từ "${this.partyAuto.inviteFrom || "-"}", xin từ [${this.partyAuto.requestFrom.join(", ") || "-"}]${escapeDesc}`);
        return { ok: true };
      }
      case "party_invite":
      case "party_request": {
        const target = String(args[0] ?? "").trim();
        if (!target) return { ok: false, message: "Thiếu tên nhân vật" };
        const snap = this.party.snapshot(self);
        if (name === "party_invite") {
          if (snap.joined && !snap.members.find((m) => m.isSelf)?.isLeader) return { ok: false, message: "Chỉ chủ PT mới được mời thêm người" };
          if (snap.members.filter((m) => m.name).length >= 5) return { ok: false, message: "Đội đã đủ 5 người" };
        } else if (snap.joined) return { ok: false, message: "Đang ở trong đội, hãy rời đội trước khi xin vào đội khác" };
        // force="force": bên điều phối xác nhận 2 tài khoản cùng map ⇒ dùng uid đã biết dù chưa có spawn/0c/00 mới (server tự kiểm tra lại)
        const p = this.party.findInMap(target, this.location.map, self) ?? (args[1] === "force" ? this.party.findAny(target, self) : undefined);
        if (!p) return { ok: false, message: `Không thấy "${target}" trong map ${this.location.map} (chỉ mời/xin được người cùng map)` };
        if (p.map !== this.location.map) this.io.log("info", `[Đội ngũ] ${p.name}: chưa có gói báo map mới, dùng uid đã biết ${p.uid} (đã xác nhận cùng map ${this.location.map} ở phía điều phối)`);
        this.sendParty(name === "party_invite" ? PARTY_SUB.INVITE : PARTY_SUB.REQUEST, partyPayload(p.uid), `${name === "party_invite" ? "MỜI" : "XIN VÀO ĐỘI của"} ${p.name} (uid ${p.uid})`);
        this.partyStatus = name === "party_invite" ? `Đã mời ${p.name}, đang chờ…` : `Đã xin vào đội của ${p.name}, đang chờ…`;
        this.publishParty();
        return { ok: true };
      }
      case "party_reply": {
        const kind = args[0] === "request" ? "request" : "invite";
        const accept = args[2] !== "0";
        const pend = this.party.takePending(kind, args[1] || undefined);
        if (!pend) return { ok: false, message: `Không có ${kind === "invite" ? "lời mời" : "lời xin"} nào đang chờ${args[1] ? ` từ "${args[1]}"` : ""}` };
        this.replyParty(kind, pend.uid, accept);
        return { ok: true };
      }
      case "leave_party": {
        // ✅ pcap: `0d/04 00 <uid của chính mình>` (chủ PT gửi = giải tán đội, thành viên gửi = rời đội).
        if (!self) return { ok: false, message: "Chưa biết UID của mình" };
        this.sendParty(PARTY_SUB.LEAVE, partyPayload(self), "RỜI ĐỘI / GIẢI TÁN (uid chính mình)");
        this.party.remove(self);
        this.partyStatus = "";
        this.publishParty();
        return { ok: true };
      }
      case "party_set_leader": {
        const snap = this.party.snapshot(self);
        const key = String(args[0] ?? "").trim();
        const m = /^\d+$/.test(key) ? snap.members.find((x) => x.slot === Number(key)) : snap.members.find((x) => normName(x.name) === normName(key));
        if (!m?.uid) return { ok: false, message: "Không tìm thấy thành viên để chuyển chủ PT" };
        this.sendParty(PARTY_SUB.CHANGE_LEADER, partyPayload(m.uid), `ĐỔI CHỦ PT → ${m.name} (payload chưa xác nhận)`);
        return { ok: true };
      }
      case "party_set_advisor": {
        // ✅ pcap: C→S `0d/05 00 <uid thành viên>` → server đáp 0d/07 + 0d/0b. Chưa có pcap bỏ QSư.
        const snap = this.party.snapshot(self);
        if (!snap.joined) return { ok: false, message: "Chưa ở trong đội" };
        if (!snap.members.find((x) => x.isSelf)?.isLeader) return { ok: false, message: "Chỉ chủ PT mới gán được Quân sư" };
        const key = String(args[0] ?? "").trim();
        const m = /^\d+$/.test(key) ? snap.members.find((x) => x.slot === Number(key)) : snap.members.find((x) => normName(x.name) === normName(key));
        if (!m?.uid) return { ok: false, message: `Không thấy "${key}" trong đội` };
        if (m.isSelf) return { ok: false, message: "Không gán Quân sư cho chính chủ PT" };
        this.sendParty(PARTY_SUB.SET_ADVISOR, partyPayload(m.uid), `GÁN QUÂN SƯ → ${m.name}`);
        return { ok: true };
      }
      default:
        return null;
    }
  }

  private selfSpawn(f: Buffer) {
    // map u16@28, x u16@30, y u16@32 (khớp tool gốc: map 12002, x 1030, y 510)
    const map = f.readUInt16LE(28);
    const x = f.readUInt16LE(30);
    const y = f.readUInt16LE(32);
    const channels = this.buildMapChannels(map, this.location.channel);
    this.location = { ...this.location, map, x, y, channels };
    // f[18] = hệ (1 Địa, 2 Thủy, 3 Hỏa, 4 Phong), u32@20 = level
    this.player = { ...this.player, name: f.toString("latin1", 54, 54 + f[53]!), level: f.readUInt32LE(20), element: ELEMENTS[f[18]!] };
    this.io.log("info", `nhân vật: ${this.player.name}, map ${this.location.map}, Kênh ${this.location.channel + 1}`);
    this.io.patchState({ player: this.player, location: this.location });
    this.playerSpawn(f);
    for (const cb of this.mapWaiters) {
      try { cb(this.location.map); } catch {}
    }
  }

  login(creds: { username: string; password: string }, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("hết thời gian chờ phản hồi login")), { once: true });
      this.onLogin = (uid) => {
        if (uid.length < 8 || uid.every((b) => b === 0)) return reject(new LoginRejectedError("Server từ chối đăng nhập (UID rỗng): sai user/mật khẩu (phân biệt hoa/thường) hoặc phiên cũ chưa được giải phóng"));
        this.uid = Buffer.from(uid);
        setTimeout(() => { this.scanArmed = true; }, 5000);
        this.io.log("info", `login OK, UID ${uid.toString("hex")}`);
        let at = 0;
        for (const [wait, c, s, p] of INIT) {
          at += wait;
          setTimeout(() => { try { this.io.send(encodeFrame(cmdBody(c, s, p))); } catch { /* socket đã đóng */ } }, at);
        }
        resolve();
      };
      const user = Buffer.from(creds.username, "ascii"), pass = Buffer.from(creds.password, "ascii");
      this.io.send(encodeFrame(cmdBody(0x01, 0x00, Buffer.concat([Buffer.from(LOGIN_PREAMBLE), Buffer.from([user.length]), user, Buffer.from([pass.length]), pass]))));
    });
  }

  /** Như tool gốc: `07/01` + `0a/00` (mỗi 12s); không dùng 01/10. */
  heartbeat(): Buffer { return Buffer.concat([encodeFrame(cmdBody(0x07, 0x01, [0x00])), encodeFrame(cmdBody(0x0a, 0x00, [0x00]))]); }
  /**
   * Action đã bắt từ pcap tool gốc (payload `f[8..]` luôn bắt đầu bằng 00):
   * Dị giới: `61/01 00 01` mở, `0c/01 00` đồng bộ, `61/02 00 NN` chọn mốc (NN: 1=Lv10, 2=25, 3=40, 5=70).
   * Còn lại chưa có opcode xác nhận → dùng `packet <hex>`.
   */
  encodeAction(name: string, args: string[]): Buffer | null {
    switch (name) {
      case "dijie_open": {
        // Đang ở trong đội (chủ PT hay thành viên) ⇒ game từ chối ("Trong tổ đội, không thể vào!"). Chặn sớm, không gửi 61/01.
        if (this.party.snapshot(this.selfHex).joined) {
          this.io.game(`⚠️ ${MSG.dijieInParty}`);
          throw new Error(MSG.dijieInParty);
        }
        this.dijieReply = undefined;
        return encodeFrame(cmdBody(0x61, 0x01, [0x00, 0x01]));
      }
      case "sync_state": return encodeFrame(cmdBody(0x0c, 0x01, [0x00])); // client gửi sau khi đổi map/mốc để làm mới trạng thái
      case "ping_07": return encodeFrame(cmdBody(0x07, 0x01, [0x00]));
      case "ready_1406": return encodeFrame(cmdBody(0x14, 0x06, [0x00])); // client gửi báo sẵn sàng sau khi load map (pcap Treo Rung 30)
      case "teleport_gate":
      case "teleport": { // `teleport <mapId>` của script cũ cũng là truyền tống cổng thành
        // 44/01 `00 <mapId u16 LE> <chỉ số cổng>`: byte cuối = vị trí cổng trong menu Teleport (0-based; 12001 = 0, 11011 = 1…).
        // Đã kiểm chứng: 11011 với byte cuối 00 bị server bỏ qua im lặng, với 01 thì được. Chỉ nhận 41 cổng thành.
        const id = Number(args[0]);
        const gate = (warpGates as { index: number; id: number; city: string }[]).find((g) => g.id === id);
        if (!gate) throw new Error(`Teleport: map ${args[0]} không phải cổng thành trong danh sách truyền tống`);
        this.pendingGate = { id, city: gate.city }; // thông báo khi server báo đã tới nơi (0c/00)
        return encodeFrame(cmdBody(0x44, 0x01, [0x00, id & 0xff, id >> 8, gate.index]));
      }
      case "warp_door":
      case "warp_id": {
        // Gói tin qua cổng dịch chuyển 14/08: `00 <doorIndex u16 LE>`
        // Bắt từ pcap thật: 12061->12000 (cổng 1): 14/08 00 01 00; 12000->12831 (cổng 18): 14/08 00 12 00.
        const door = Number(args[0]);
        if (!Number.isInteger(door) || door < 1 || door > 65535) throw new Error(`Warp door: chỉ số cổng ${args[0]} không hợp lệ`);
        this.io.game(`🚪 [${this.player.name || "Nhân vật"}] bước qua cổng dịch chuyển số ${door}...`);
        return encodeFrame(cmdBody(0x14, 0x08, [0x00, door & 0xff, door >> 8]));
      }
      case "dijie_pick": {
        const n = Number(args[0]);
        if (!Number.isInteger(n) || n < 1 || n > 255) return null;
        // Server vừa từ chối mở Dị giới thì không gửi tiếp 61/02 (gói chọn mốc ngoài Dị giới vô tác dụng, còn log "đang xin vào" sẽ gây hiểu nhầm).
        if (this.dijieReply != null && this.dijieReply !== 0x00 && this.dijieReply !== 0x06) throw new Error(`Server từ chối vào Dị giới (mã ${this.dijieReply})`);
        this.io.game(MSG.dijieAsking(dijieLevelLabel(n)));
        return encodeFrame(cmdBody(0x61, 0x02, [0x00, n]));
      }
      case "daily_checkin": {
        // 57/02 `00 01 DD 00 00 00 01`: loại 01 = lịch 28 ngày, DD = ngày (mẫu đã thấy: DD=1 khi bộ đếm ngày = 0).
        const ctr = this.counterMap.get(CTR_CHECKIN_DAY);
        const day = args[0] ? Number(args[0]) : ctr ? ctr.val + 1 : NaN;
        const max = ctr?.max ?? 28;
        if (!Number.isInteger(day) || day < 1 || day > max) throw new Error(ctr ? `Điểm danh: ngày ${day} ngoài phạm vi 1..${max} (đã đủ?)` : "Điểm danh: chưa đọc được bộ đếm ngày từ server, hãy truyền ngày");
        this.pendingCheckinDay = day;
        this.io.game(MSG.checkinSending(day));
        return encodeFrame(cmdBody(0x57, 0x02, [0x00, 0x01, day, 0x00, 0x00, 0x00, 0x01]));
      }
      case "online_reward":
      case "online_reward_all": {
        const arg = args[0];
        const curMin = this.getOnlineMinutes();
        if (arg && arg !== "all") {
          const min = Number(arg);
          const m = ONLINE_REWARD_MILESTONES.find((x) => x.minutes === min);
          if (!m) throw new Error(`Mốc quà online ${arg} phút không hợp lệ (hỗ trợ: 10, 20, 30, 60, 90, 180)`);
          if (this.claimedActivityFlags.has(m.flagId)) {
            this.io.game(MSG.onlineRewardAlready(min));
            return Buffer.alloc(0);
          }
          if (curMin < min) {
            this.io.game(MSG.onlineRewardNotYet(min, curMin));
            return Buffer.alloc(0);
          }
          this.lastOnlineRewardSent = min;
          this.io.game(MSG.onlineRewardSending(min));
          return this.encodeOnlineRewardFrame(min);
        }
        return this.startOnlineRewardAll();
      }
      case "pet_out": {
        // 13/01 `00 <model u16>`: chọn võ tướng xuất chiến (pet đang xuất chiến tự về nghỉ). Server xác nhận bằng 13/01 cùng nội dung.
        const model = Number(args[0]);
        const rec = this.roster.find((r) => r.model === model);
        if (!rec) throw new Error(`Xuất chiến: không có võ tướng model ${args[0]} trong tổ đội`);
        if (rec === this.activePet()) throw new Error("Võ tướng này đang xuất chiến rồi");
        return encodeFrame(cmdBody(0x13, 0x01, [0x00, model & 0xff, model >> 8]));
      }
      case "pet_rest": {
        const act = this.activePet();
        if (!act) throw new Error("Hiện không có võ tướng nào đang xuất chiến");
        return encodeFrame(cmdBody(0x13, 0x02, [0x00]));
      }
      case "spin_lap_ba":
      case "xu_lap_ba":
      case "daily_quest_claim":
      case "claim_daily_quests":
      case "battle_pass_claim":
      case "claim_battle_pass":
        throw new Error(`${name}: cần chạy qua executeAction`);
      case "offline_exp_free": return this.offlineExpFree();
      case "offline_exp_info": return encodeFrame(cmdBody(0x57, 0x03, [0x00])); // làm mới bảng giá (client gửi khi mở popup)
      case "mail_claim_all": return this.mailClaimAll();
      case "friend_gift_all":
      case "friend_send_gift":
      case "friend_receive_gift":
      case "pull_secret":
      case "pull_card":
      case "pull_all":
        throw new Error(`${name}: cần chạy qua executeAction`);
      case "set_party_config": {
        this.partyAction(name, args);
        return Buffer.alloc(0);
      }
      case "set_battle_config": {
        const pId = Number(args[0]) || 10000;
        const petId = Number(args[1]) || 10000;
        const auto = args[2] === "1" || args[2] === "true" || args[2] === undefined;
        const pTarget = args[3] || "F1";
        const petTarget = args[4] || "F1";
        let turns: BattleTurnConfig[] | undefined = undefined;
        if (args[5]) {
          try {
            const parsed = typeof args[5] === "string" ? JSON.parse(args[5]) : args[5];
            if (Array.isArray(parsed)) {
              turns = parsed.map((t: any) => ({
                turn: Number(t.turn),
                playerAction: {
                  type: t.playerAction?.type || this.skillType(Number(t.playerAction?.skillId) || 10000),
                  skillId: Number(t.playerAction?.skillId) || 10000,
                  target: String(t.playerAction?.target || "F1"),
                  itemId: t.playerAction?.itemId != null ? Number(t.playerAction.itemId) : undefined,
                  itemSlot: t.playerAction?.itemSlot != null ? Number(t.playerAction.itemSlot) : undefined,
                  itemName: t.playerAction?.itemName ? String(t.playerAction.itemName) : undefined,
                  petModel: t.playerAction?.petModel != null ? Number(t.playerAction.petModel) : undefined,
                  petName: t.playerAction?.petName ? String(t.playerAction.petName) : undefined,
                },
                petAction: {
                  type: t.petAction?.type || this.skillType(Number(t.petAction?.skillId) || 10000),
                  skillId: Number(t.petAction?.skillId) || 10000,
                  target: String(t.petAction?.target || "F1"),
                  itemId: t.petAction?.itemId != null ? Number(t.petAction.itemId) : undefined,
                  itemSlot: t.petAction?.itemSlot != null ? Number(t.petAction.itemSlot) : undefined,
                  itemName: t.petAction?.itemName ? String(t.petAction.itemName) : undefined,
                  petModel: t.petAction?.petModel != null ? Number(t.petAction.petModel) : undefined,
                  petName: t.petAction?.petName ? String(t.petAction.petName) : undefined,
                },
              }));
            }
          } catch {
            // bỏ qua nếu parse lỗi
          }
        }
        const mode = (args[6] === "turns" || args[6] === "default")
          ? (args[6] as "default" | "turns")
          : (turns && turns.length > 0 ? "turns" : (this.battleConfig.strategyMode ?? "default"));
        const autoEscape = String(args[7]) === "1" || String(args[7]) === "true";
        this.battleConfig = {
          playerAction: { type: this.skillType(pId), skillId: pId, target: pTarget },
          petAction: { type: this.skillType(petId), skillId: petId, target: petTarget },
          autoFight: auto,
          autoEscape,
          strategyMode: mode,
          turns: turns ?? this.battleConfig.turns ?? [],
          currentTurn: this.battleTurnIndex,
        };
        this.io.patchState({ battleConfig: this.battleConfig });
        const pName = (skillDataRaw as Record<string, any>)[String(pId)]?.name ?? pId;
        const petName = (skillDataRaw as Record<string, any>)[String(petId)]?.name ?? petId;
        const turnsDesc = mode === "turns" && this.battleConfig.turns && this.battleConfig.turns.length > 0
          ? ` (${this.battleConfig.turns.length} turns cài đặt)`
          : "";
        const escapeDesc = autoEscape ? " | 🏃 Tự bỏ chạy: BẬT (Ưu tiên Bậc 1)" : "";
        this.io.game(`⚔️ Thiết lập trận [${mode === "turns" ? "Theo Turn" : "Mặc định"}]: ${this.player.name || "Nhân vật"} [${pName}] (Mục tiêu: ${pTarget}), ${this.pet.name || "Võ tướng"} [${petName}] (Mục tiêu: ${petTarget}), Tự động: ${auto ? "Bật" : "Tắt"}${turnsDesc}${escapeDesc}`);
        return Buffer.alloc(0);
      }
      case "battle_action": {
        const actor = args[0] || "player";
        const sId = Number(args[1]) || 10000;
        const tRow = Number(args[2]) || 0;
        const tCol = Number(args[3]) || 2;
        const self = this.selfHex;
        let charUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === false && !!self && u.owner === self)
          ?? this.battleUnits.find((u) => !u.isEnemy && u.isPet === false && !!this.player.name && u.name === this.player.name);
        if (!charUnit) {
          charUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === false)
            ?? this.battleUnits.find((u) => !u.isEnemy && u.row === 3);
        }
        const pCol = charUnit?.col ?? 2;
        const petUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === true && u.row === 2 && u.col === pCol && u.hp.cur > 0);
        const aRow = actor === "pet" ? 2 : (charUnit?.row ?? 3);
        const aCol = actor === "pet" ? pCol : pCol;
        return this.encodeBattleActionFrame(aRow, aCol, tRow, tCol, sId);
      }
      case "drop_item": {
        let slot = Number(args[0]) || 1;
        let qty = Number(args[1]) || 0;
        let item = this.bag.get(slot);
        if (!item || slot > 50) {
          const found = [...this.bag.entries()].find(([, it]) => it.id === Number(args[0]));
          if (found) {
            slot = found[0];
            item = found[1];
          }
        }
        if (!qty && item) qty = item.qty;
        if (!qty) qty = 1;
        const name = item ? ((itemNames as Record<string, string>)[item.id] ?? `#${item.id}`) : `ô ${slot}`;
        this.io.game(`🗑️ Đang vứt bỏ ${name} (x${qty}) tại ô ${slot}...`);
        return encodeFrame(cmdBody(0x17, 0x03, [
          0x00,
          slot & 0xff,
          qty & 0xff,
          (qty >> 8) & 0xff,
          (qty >> 16) & 0xff,
          (qty >>> 24) & 0xff,
        ]));
      }
      case "use_item": {
        let slot = Number(args[0]) || 1;
        const qty = Number(args[1]) || 1;
        const target = Number(args[2]) || 0; // 0=char, 1=pet
        let item = this.bag.get(slot);
        if (!item || slot > 50) {
          const found = [...this.bag.entries()].find(([, it]) => it.id === Number(args[0]));
          if (found) {
            slot = found[0];
            item = found[1];
          }
        }
        const name = item ? ((itemNames as Record<string, string>)[item.id] ?? `#${item.id}`) : `ô ${slot}`;
        const targetName = target > 0 ? (this.pet.name || "Võ tướng") : (this.player.name || "Nhân vật");
        this.io.game(`💊 [${targetName}] Sử dụng ${qty > 1 ? `${qty}x ` : ""}${name} tại ô ${slot}...`);
        return encodeFrame(cmdBody(0x17, 0x0f, [
          0x00,
          slot & 0xff,
          qty & 0xff,
          (qty >> 8) & 0xff,
          (qty >> 16) & 0xff,
          (qty >>> 24) & 0xff,
          target & 0xff,
          0x00,
        ]));
      }
      case "deposit_bank": {
        let slot = Number(args[0]) || 1;
        let item = this.bag.get(slot);
        if (!item || slot > 50) {
          const found = [...this.bag.entries()].find(([, it]) => it.id === Number(args[0]));
          if (found) {
            slot = found[0];
            item = found[1];
          }
        }
        const qty = args[1] != null && Number(args[1]) > 0 ? Number(args[1]) : (item?.qty ?? 1);
        if (!this.bankOpen) {
          // Gửi khi chưa mở kho ⇒ server kick mã 37, nên chặn ngay tại bot thay vì gửi gói.
          this.io.game("⚠️ [Tiền Trang] Kho chưa mở với NPC — bấm 'Mở kho' trước khi gửi (đã chặn để tránh bị server ngắt kết nối mã 37).");
          return Buffer.alloc(0);
        }
        const name = item ? ((itemNames as Record<string, string>)[item.id] ?? `#${item.id}`) : `ô ${slot}`;
        this.io.game(`🏦 [Tiền Trang] Đang gửi ${name} (x${qty}) vào kho lưu trữ...`);
        return encodeFrame(cmdBody(0x1e, 0x02, [
          0x00,
          slot & 0xff,
          qty & 0xff,
          (qty >> 8) & 0xff,
          (qty >> 16) & 0xff,
          (qty >> 24) & 0xff,
        ]));
      }
      case "withdraw_bank": {
        let slot = Number(args[0]) || 1;
        let item = this.bank.get(slot);
        if (!item || slot > 60) {
          const found = [...this.bank.entries()].find(([, it]) => it.id === Number(args[0]));
          if (found) {
            slot = found[0];
            item = found[1];
          }
        }
        const qty = args[1] != null && Number(args[1]) > 0 ? Number(args[1]) : (item?.qty ?? 1);
        if (!this.bankOpen) {
          this.io.game("⚠️ [Tiền Trang] Kho chưa mở với NPC — bấm 'Mở kho' trước khi rút.");
          return Buffer.alloc(0);
        }
        const name = item ? ((itemNames as Record<string, string>)[item.id] ?? `#${item.id}`) : `ô ${slot}`;
        this.io.game(`🏦 [Tiền Trang] Đang rút ${name} (x${qty}) từ kho về túi...`);
        return encodeFrame(cmdBody(0x1e, 0x01, [
          0x00,
          slot & 0xff,
          qty & 0xff,
          (qty >> 8) & 0xff,
          (qty >> 16) & 0xff,
          (qty >> 24) & 0xff,
        ]));
      }
      case "move": {
        const x = Number(args[0]) || 0;
        const y = Number(args[1]) || 0;
        const dir = Number(args[2]) || 0;
        return encodeFrame(cmdBody(0x06, 0x01, [0x00, dir & 0xff, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff]));
      }
      case "interact_prep": {
        const mode = Number(args[0]) || 8;
        return encodeFrame(cmdBody(0x20, 0x02, [0x00, mode & 0xff]));
      }
      case "close_bank": {
        this.setBankOpen(false);
        return encodeFrame(cmdBody(0x1e, 0x08, [0x00]));
      }
      case "open_inn_request": return encodeFrame(cmdBody(0x1f, 0x0a, [0x00]));
      case "inn_prep_7a": return encodeFrame(cmdBody(0x7a, 0x01, [0x00]));
      case "escort_query": return encodeFrame(cmdBody(0x56, 0x01, [0x00]));
      case "escort_start": {
        const slot = Number(args[0]) || 1;
        if (!Number.isInteger(slot) || slot < 1 || slot > 255) {
          throw new Error(`Slot pet vận tiêu ${args[0]} không hợp lệ`);
        }
        return encodeFrame(cmdBody(0x56, 0x02, [0x00, slot & 0xff]));
      }
      case "escort_claim": return encodeFrame(cmdBody(0x56, 0x05, [0x00, 0x01]));
      case "combine_item": {
        const slotA = Number(args[0]) || 1;
        const slotB = Number(args[1]) || slotA;
        return encodeFrame(cmdBody(0x17, 0x0e, [
          0x00,
          slotA & 0xff,
          0x01, 0x00, 0x00, 0x00,
          slotB & 0xff,
          0x01, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        ]));
      }
      case "click":
      case "talk_npc": {
        const npcId = Number(args[0]) || 1;
        return encodeFrame(cmdBody(0x14, 0x01, [0x00, npcId & 0xff, (npcId >> 8) & 0xff]));
      }
      case "send":
      case "send_menu": {
        const opt = Number(args[0]) || 1;
        return encodeFrame(cmdBody(0x14, 0x09, [0x00, opt & 0xff]));
      }
      case "resolve_item": {
        let slot = Number(args[1]) || Number(args[0]) || 1;
        let item = this.bag.get(slot);
        if (!item || slot > 50) {
          const found = [...this.bag.entries()].find(([, it]) => it.id === Number(args[0]));
          if (found) {
            slot = found[0];
            item = found[1];
          }
        }
        const qty = item?.qty ?? 1;
        const name = item ? ((itemNames as Record<string, string>)[item.id] ?? `#${item.id}`) : `ô ${slot}`;
        this.io.game(`💥 [Phân giải] Đang phân giải ${name} (x${qty}) tại ô ${slot}...`);
        return encodeFrame(cmdBody(0x59, 0x03, [
          0x00,
          0x01,
          slot & 0xff,
          qty & 0xff,
          (qty >> 8) & 0xff,
          (qty >> 16) & 0xff,
          (qty >> 24) & 0xff,
        ]));
      }
      case "contribute_item": {
        let slot = Number(args[1]) || Number(args[0]) || 1;
        let item = this.bag.get(slot);
        if (!item || slot > 50) {
          const found = [...this.bag.entries()].find(([, it]) => it.id === Number(args[0]));
          if (found) {
            slot = found[0];
            item = found[1];
          }
        }
        const name = item ? ((itemNames as Record<string, string>)[item.id] ?? `#${item.id}`) : `ô ${slot}`;
        this.io.game(`🏛️ [Đóng góp Bang] Đang cống hiến ${name} tại ô ${slot} cho Quân đoàn...`);
        return encodeFrame(cmdBody(0x27, 0x0f, [
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          slot & 0xff,
        ]));
      }
      case "auto_combine_dragon": {
        this.io.game(`⚠️ [Tự hợp Lông Vũ]: Cần cấu hình cặp công thức ghép đồ (ô nguyên liệu A + ô nguyên liệu B) để gửi gói 17/0e an toàn.`);
        return Buffer.alloc(0);
      }
      case "open_bag_slot": {
        const bagExpandItem = [...this.bag.entries()].find(([, it]) => it.id === 65401);
        if (!bagExpandItem) {
          this.io.game("⚠️ Trong túi đồ không có vật phẩm 'Tăng Ô Túi' (ID 65401).");
          return Buffer.alloc(0);
        }
        const [slot] = bagExpandItem;
        this.io.game(`🎒 Đang sử dụng 'Tăng Ô Túi' tại ô ${slot}...`);
        return encodeFrame(cmdBody(0x17, 0x0f, [0x00, slot & 0xff, 0x01, 0x00]));
      }
      case "sweep_inventory": {
        this.io.log("info", "🔍 [Quét túi đồ] Bắt đầu quét và xử lý thùng đồ cá nhân...");
        this.sweepAttempts.clear();
        this.sweepingBag = false;
        this.triggerAutoSweep(true);
        return Buffer.alloc(0);
      }
      case "set_item_lists": {
        const parseIds = (json?: string): Set<number> => {
          if (!json) return new Set();
          try {
            const arr = JSON.parse(json);
            return new Set(Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
          } catch {
            return new Set();
          }
        };
        this.autoLists.discard = parseIds(args[0]);
        this.autoLists.autoOpen = parseIds(args[1]);
        this.autoLists.resolve = parseIds(args[2]);
        this.autoLists.contribute = parseIds(args[3]);
        this.autoLists.combine = parseIds(args[4]);
        if (args[5]) {
          try {
            const parsed = JSON.parse(args[5]);
            if (Array.isArray(parsed)) {
              this.autoLists.sell = parseIds(args[5]);
            } else if (parsed && typeof parsed === "object") {
              this.autoLists.toggles = { ...this.autoLists.toggles, ...parsed };
              if (typeof (parsed as Record<string, unknown>).lastCombinedDate === "string") {
                this.lastCombinedDate = (parsed as Record<string, unknown>).lastCombinedDate as string;
              }
            }
          } catch {}
        }
        if (args[6]) {
          try {
            const parsed = JSON.parse(args[6]);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              this.autoLists.toggles = { ...this.autoLists.toggles, ...parsed };
              if (typeof (parsed as Record<string, unknown>).lastCombinedDate === "string") {
                this.lastCombinedDate = (parsed as Record<string, unknown>).lastCombinedDate as string;
              }
            }
          } catch {}
        }
        const autoSweepArg = args[7] !== undefined ? args[7] : args[6];
        if (autoSweepArg !== undefined) {
          const nextAuto = autoSweepArg === "true" || autoSweepArg === "1";
          if (nextAuto !== this.autoSweepEnabled) {
            this.autoSweepEnabled = nextAuto;
            if (this.autoSweepEnabled) {
              this.io.game("⏱️ [Auto Quét Túi] Đã BẬT tự động quét thùng đồ cá nhân định kỳ mỗi 1 phút.");
              this.startPeriodicAutoSweep();
            } else {
              this.io.game("⏱️ [Auto Quét Túi] Đã TẮT tự động quét thùng đồ cá nhân định kỳ.");
              this.stopPeriodicAutoSweep();
            }
          }
        }
        if (args[8]) {
          try {
            const parsed = JSON.parse(args[8]);
            if (parsed && typeof parsed === "object") {
              this.autoHeal = {
                ...this.autoHeal,
                ...parsed,
                player: { ...this.autoHeal.player, ...(parsed.player ?? {}) },
                pet: { ...this.autoHeal.pet, ...(parsed.pet ?? {}) },
              };
            }
          } catch {}
        }
        if (args[9] && typeof args[9] === "string" && args[9].trim()) {
          this.lastCombinedDate = args[9].trim();
        }
        this.sweepAttempts.clear();
        this.sweepingBag = false;
        if (this.sweepTimer) {
          clearTimeout(this.sweepTimer);
          this.sweepTimer = undefined;
        }
        this.triggerAutoSweep();
        this.triggerAutoHeal();
        return Buffer.alloc(0);
      }
      case "set_auto_heal": {
        try {
          const parsed = JSON.parse(args[0] ?? "{}");
          if (parsed && typeof parsed === "object") {
            this.autoHeal = {
              ...this.autoHeal,
              ...parsed,
              player: { ...this.autoHeal.player, ...(parsed.player ?? {}) },
              pet: { ...this.autoHeal.pet, ...(parsed.pet ?? {}) },
            };
            this.io.game("⚙️ [Cấu hình Chung] Đã cập nhật thiết lập tự động sử dụng HP/SP.");
            this.triggerAutoHeal();
          }
        } catch {}
        return Buffer.alloc(0);
      }
      case "sweep_auto_heal": {
        this.io.log("info", "🔍 [Tự dùng HP/SP] Bắt đầu quét và kiểm tra phục hồi HP/SP...");
        this.triggerAutoHeal(true);
        return Buffer.alloc(0);
      }
      case "channel": {
        // Change_Channel_07_02 (C→S): `00 <wireCh u16 LE>` (pcap Chuyen Kenh.pcap 23.20s: 07 02 00 02 00)
        // chId = 0-based index từ UI (game hiển thị "Kênh 1" = id 0, "Kênh 2" = id 1, …)
        const chId = Number(args[0]);
        if (!Number.isInteger(chId) || chId < 0 || chId > 255) throw new Error(`Kênh: giá trị ${args[0]} không hợp lệ (phải là số nguyên 0..255)`);
        if (chId === this.location.channel) {
          this.io.game(`📡 [Kênh] Nhân vật hiện đang ở Kênh ${chId + 1} rồi.`);
          return Buffer.alloc(0);
        }
        this.pendingChannel = chId;
        const wireCh = chId + 1; // 1-based gửi lên máy chủ
        this.io.game(`📡 [Kênh] Đang yêu cầu chuyển sang Kênh ${wireCh}...`);
        return encodeFrame(cmdBody(0x07, 0x02, [0x00, wireCh & 0xff, (wireCh >> 8) & 0xff]));
      }
      case "refresh_channels": {
        this.requestChannelList();
        return Buffer.alloc(0);
      }
      default: return null;
    }
  }

  /**
   * `await_battle` (TSM): chờ trận đấu bắt đầu (tối đa BATTLE_START_WAIT_MS — không có trận thì thôi) rồi chờ trận KẾT THÚC.
   * Các loại chờ khác (dialog/party/item/map) chưa hỗ trợ ở codec này.
   */
  async waitFor(kind: string, _args: string[], timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (kind !== "battle") throw new Error(`await_${kind}: codec ts-online chưa hỗ trợ`);
    const sleep = (ms: number) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true }); });
    // Đang trong cửa sổ đáp thoại (vừa qua cổng/bấm NPC phó bản) ⇒ trận tới sau ~7s thoại nên chờ lâu hơn.
    const startMs = Date.now() <= this.dialogAckUntil ? 40_000 : 8000;
    const startBy = Date.now() + startMs;
    while (!this.inBattle && Date.now() < startBy && !signal.aborted) await sleep(250);
    if (!this.inBattle) { this.io.log("info", `[await_battle] không thấy trận đấu bắt đầu (${startMs / 1000}s) — bỏ qua`); return; }
    const endBy = Date.now() + timeoutMs;
    while (this.inBattle && Date.now() < endBy && !signal.aborted) { if (Date.now() <= this.dialogAckUntil + 25_000) this.openDialogWindow(30_000); await sleep(300); }
    if (signal.aborted) throw new Error("Thao tác bị hủy");
    if (this.inBattle) throw new Error("await_battle: quá thời gian chờ hết trận");
  }

  async executeAction(
    name: string,
    args: string[],
    write: (b: Buffer) => void,
    signal: AbortSignal,
 ): Promise<{ ok: boolean; message?: string } | null> {
    if (name.startsWith("party_") || name === "leave_party" || name === "set_party_config") return this.partyAction(name, args);
    if (isDungeonRoomAction(name)) return this.dungeonRoomAction(name, args, signal);
    if (name === "friend_gift_all" || name === "friend_send_gift" || name === "friend_receive_gift") {
      return this.friendGiftAction(name, args, signal);
    }
    if (name === "pull_secret" || name === "pull_card" || name === "pull_all") {
      return this.pullHeroAction(name, args, signal);
    }
    if (name === "spin_lap_ba" || name === "xu_lap_ba") {
      return this.spinLapBaAction(args, write, signal);
    }
    if (name === "daily_quest_claim" || name === "claim_daily_quests") {
      return this.dailyQuestClaimAction(write, signal);
    }
    if (name === "battle_pass_claim" || name === "claim_battle_pass") {
      return this.battlePassClaimAction(write, signal);
    }
    if (name === "open_inn" || name === "escort_start" || name === "escort_query" || name === "escort_claim") {
      return this.innEscortAction(name, args, write, signal);
    }
    if (name === "auto") {
      // TSM `auto 1|0` = bật/tắt TỰ ĐỘNG ĐÁNH của bot (không có gói tin) ⇒ chỉ đổi cờ autoFight của cấu hình trận (battleTurn đọc cờ này).
      this.battleConfig = { ...this.battleConfig, autoFight: args[0] !== "0" };
      this.io.patchState({ battleConfig: this.battleConfig });
      this.io.log("info", `[auto] Tự động đánh: ${this.battleConfig.autoFight ? "BẬT" : "TẮT"} (theo script)`);
      return { ok: true };
    }
    if (name === "challenge_world_boss") {
      this.io.log("info", "⚔️ [Boss Thế Giới] Bắt đầu chuỗi tương tác khiêu chiến Boss Thế Giới (NPC 45)...");
      write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08])));
      await sleep(150);
      write(encodeFrame(cmdBody(0x14, 0x01, [0x00, 0x2d, 0x00])));
      await sleep(1200);
      write(encodeFrame(cmdBody(0x14, 0x09, [0x00, 0x1e])));
      await sleep(200);
      write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
      return { ok: true };
    }
    if (name === "execute_shop_transaction" || name === "shop_sell_and_buy") {
      return this.executeShopTransaction(args, write, signal);
    }
    if (name === "move" || name === "walk") {
      if (this.isMemberInParty()) {
        this.io.game("⚠️ Ní đang trong tổ đội, di chuyển theo chủ PT!");
        return { ok: false, message: "Đang trong tổ đội, chỉ chủ PT mới được di chuyển" };
      }
      const targetX = Number(args[0]);
      const targetY = Number(args[1]);
      if (Number.isFinite(targetX) && Number.isFinite(targetY) && targetX > 0 && targetY > 0) {
        const isSolo = this.location.map >= 62001 && this.location.map <= 62010;
        if (isSolo) {
          // Chuẩn TSM BOT pcap cap.pcapng: trong phó bản đơn gửi trực tiếp 06/01 tới toạ độ đích, không chia bước walkWaypoints (né kẹt vách núi & né quái chặn đường)
          const dir = this.getMoveDir(targetX - (this.location.x ?? targetX), targetY - (this.location.y ?? targetY));
          write(encodeFrame(cmdBody(0x06, 0x01, [0x00, dir & 0xff, targetX & 0xff, (targetX >> 8) & 0xff, targetY & 0xff, (targetY >> 8) & 0xff])));
          this.location = { ...this.location, x: targetX, y: targetY };
          this.io.patchState({ location: this.location });
          await new Promise((r) => setTimeout(r, 1500)); // Chờ 1.5s như pcap thật trước lệnh tiếp theo
          return { ok: true };
        }
        await this.walkWaypoints([{ x: targetX, y: targetY }], write, signal);
        for (let i = 0; i < 2; i++) {
          write(encodeFrame(cmdBody(0x06, 0x01, [0x00, 0x00, targetX & 0xff, (targetX >> 8) & 0xff, targetY & 0xff, (targetY >> 8) & 0xff])));
          await new Promise((r) => setTimeout(r, 150));
        }
        this.location = { ...this.location, x: targetX, y: targetY };
        return { ok: true };
      }
    }
    if (name === "move_to_safe_spot") {
      const snap = this.party.snapshot(this.selfHex);
      const selfMember = snap.members.find((m) => m.isSelf);
      const isLeader = Boolean(selfMember?.isLeader);

      if (snap.joined && !isLeader) {
        this.io.game("⚠️ Ní đang trong tổ đội, không được phép chạy lung tung!!!");
        return { ok: false, message: "Ní đang trong tổ đội, không được phép chạy lung tung!!!" };
      }

      const mapId = this.location.map;
      if (!mapId) {
        return { ok: false, message: "Chưa xác định được bản đồ hiện tại" };
      }

      const safeSpot = getSafeSpotForMap(mapId, this.location.x, this.location.y);
      if (!safeSpot) {
        this.io.game(`⚠️ Không tìm thấy vị trí an toàn cho map ${mapId}`);
        return { ok: false, message: `Không tìm thấy vị trí an toàn cho map ${mapId}` };
      }

      const curDist = Math.hypot((this.location.x ?? 0) - safeSpot.x, (this.location.y ?? 0) - safeSpot.y);
      if (curDist <= 25) {
        this.io.game(`🛡️ [${this.player.name || "Nhân vật"}] Đang ở vị trí an toàn (${safeSpot.x}, ${safeSpot.y}) rồi`);
        return { ok: true, message: `Đang ở vị trí an toàn (${safeSpot.x}, ${safeSpot.y}) rồi` };
      }

      this.io.game(`🛡️ [${this.player.name || "Nhân vật"}] Đang di chuyển đến chỗ an toàn (${safeSpot.x}, ${safeSpot.y})...`);

      await this.walkWaypoints([{ x: safeSpot.x, y: safeSpot.y }], write, signal);
      for (let i = 0; i < 2; i++) {
        write(encodeFrame(cmdBody(0x06, 0x01, [0x00, 0x00, safeSpot.x & 0xff, (safeSpot.x >> 8) & 0xff, safeSpot.y & 0xff, (safeSpot.y >> 8) & 0xff])));
        await new Promise((r) => setTimeout(r, 150));
      }
      this.location = { ...this.location, x: safeSpot.x, y: safeSpot.y };
      this.io.patchState({ location: this.location });
      this.io.game(`🛡️ [${this.player.name || "Nhân vật"}] Đã đến chỗ an toàn (${safeSpot.x}, ${safeSpot.y})!`);
      return { ok: true, message: `Đã đến chỗ an toàn (${safeSpot.x}, ${safeSpot.y})` };
    }
    if ((name === "warp_id" || name === "warp_door") && args.length >= 1) {
      // `warp_id N,map,x,y` = đi tới toạ độ cổng rồi bước qua cổng N; dạng rút gọn `warp_id N` (TSM, vd Ngày Tàn Hoạn Quan) = bước qua cổng N tại chỗ.
      const hasXY = args.length >= 4;
      const door = Number(args[0]);
      const targetX = Number(args[2]);
      const targetY = Number(args[3]);
      if (Number.isFinite(door) && (!hasXY || (Number.isFinite(targetX) && Number.isFinite(targetY) && targetX > 0 && targetY > 0))) {
        const map = (hasXY ? Number(args[1]) : 0) || this.location.map;
        const prev = this.lastDoor;
        // Script TSM lặp `warp_id` 2 lần liền (lần 2 chỉ để bù khi lần 1 bị trận đấu chen ngang). Lần 1 đã qua cổng rồi ⇒ bỏ qua,
        // nếu không bot sẽ đi bộ tới toạ độ cổng của vùng CŨ trong vùng mới rồi bước ngược lại.
        if (prev && prev.door === door && prev.map === map && Date.now() - prev.at < 8000) {
          this.io.log("info", `[warp_id] cổng ${door} vừa qua xong — bỏ qua lệnh lặp`);
          return { ok: true };
        }
        if (hasXY) await this.walkWaypoints([{ x: targetX, y: targetY }], write, signal);
        if (signal.aborted) throw new Error("Thao tác bị hủy");
        await new Promise((r) => setTimeout(r, 200));
        this.io.game(`🚪 [${this.player.name || "Nhân vật"}] bước qua cổng dịch chuyển số ${door}...`);
        const seq = this.locSeq;
        const iseq = this.interactSeq;
        this.doorRejected = undefined;
        this.openDialogWindow(); // chuỗi câu thoại sau cổng cần được đáp 14/06 (xem ackDialog)
        write(encodeFrame(cmdBody(0x14, 0x08, [0x00, door & 0xff, (door >> 8) & 0xff])));
        const isTeamDungeon = DUNGEON_ROOM_CATALOG.some((d) => d.map === this.location.map);
        const isSoloDungeon = !isTeamDungeon && this.location.map >= 62003 && this.location.map <= 62010;
        if (isSoloDungeon) {
          // Client game thật gửi 0c/01 00 sau cổng để nạp danh sách NPC map mới (Phobandon Timbdy gói 363)
          write(encodeFrame(cmdBody(0x0c, 0x01, [0x00])));
        }
        if (isTeamDungeon && this.mapNpcs.size === 0) { await new Promise((r) => setTimeout(r, 350)); await this.requestNpcList(`sau cổng ${door}`, signal); }
        const res = await this.awaitEncounter(`cổng ${door}`, signal, seq, iseq);
        if (res === "ok") this.lastDoor = { door, map, at: Date.now() }; // dòng `warp_id` lặp ngay sau cũng bị bỏ qua
        return { ok: true };
      }
    }
    if (name === "click_boss" && args.length >= 4) {
      // NPC/boss phó bản (vd Trương Giác = NPC 20 map 62002): đi tới → bấm 14/01 → thoại (tự đáp 14/06) → vào trận. Log thật: sau câu thoại đầu server có thể đáp
      // `14/08 00 27` và không vào trận ⇒ bấm lại (nhấp đúp như truy kích), mỗi lần chờ vào trận ≤12s, tối đa 3 lần rồi báo lỗi (UI có "Thoát phó bản").
      // KHÔNG gửi 14/09 đoán mò: log 14:37 cho thấy `14/09 00 01` khi không có menu ⇒ server đáp 14/08 00 01 rồi KICK mã 5.
      const npcId = Number(args[0]);
      const targetX = Number(args[2]);
      const targetY = Number(args[3]);
      if (!Number.isFinite(npcId) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) throw new Error("click_boss: tham số không hợp lệ");
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      this.watchNpc = npcId;
      if (!(await this.requestNpcList(`trước khi bấm NPC ${npcId}`, signal, npcId))) this.io.log("warn", `[click_boss] server chưa gửi NPC ${npcId} trong danh sách NPC của map`);
      this.io.log("info", `[click_boss] NPC quanh đích: ${[...this.mapNpcs.values()].filter((n) => Math.hypot(n.x - targetX, n.y - targetY) < 260).sort((x, y) => x.index - y.index).map((n) => `#${n.index}(${n.x},${n.y})${n.busy ? "*" : ""}`).join(" ") || "(không có)"}`);
      // Vị trí NPC THẬT: danh sách NPC (16/04) + báo di chuyển (16/02) — NPC phó bản có thể đã đổi chỗ so với toạ độ trong script TSM.
      const live = this.mapNpcs.get(npcId);
      const goX = targetX, goY = targetY; // điểm ĐỨNG theo script/pcap (cách NPC ~78–106px), KHÔNG đi tới sát NPC
      if (live) this.io.log("info", `[click_boss] NPC ${npcId} ở (${live.x},${live.y}); sẽ đứng ở (${goX},${goY}) cách ${Math.round(Math.hypot(live.x - goX, live.y - goY))}px (như client thật)`);
      await this.walkWaypoints([{ x: goX, y: goY }], write, signal);
      // Như client thật (pcap chupt_phoban01 102.8–103.7s): tới điểm đứng thì gửi lại đúng vị trí đó 3 lần (cách ~430ms, dir 0), chờ ~1.5s rồi mới bấm NPC. Client thật bấm Trương Giác
      // từ (670,410) — cách NPC (590,340) ~106px — nên KHÔNG cần sát NPC; đích trong script là điểm đứng này.
      for (let i = 0; i < 3; i++) {
        write(encodeFrame(cmdBody(0x06, 0x01, [0x00, 0x00, goX & 0xff, (goX >> 8) & 0xff, goY & 0xff, (goY >> 8) & 0xff])));
        await sleep(430);
      }
      this.location = { ...this.location, x: goX, y: goY };
      await sleep(1100);
      // NPC (Trương Giác) chỉ hiển thị/tương tác được SAU MỘT LÚC khi chuỗi hết trận cổng 3 kết thúc (pcap completed_phoban_khanvang_chupt: `14/08 00 2a` 85.46s → bấm NPC 97.54s,
      // ~12s sau; server im lặng suốt khoảng đó). Bấm sớm: server vẫn hiện câu thoại nhưng từ chối đáp (`14/08 00 27`). Chờ đủ 12s kể từ sự kiện chuỗi cuối.
      const ready = this.lastChainRx + 12_000;
      if (Date.now() < ready) {
        this.io.log("info", `[click_boss] chờ NPC ${npcId} hiển thị ${Math.ceil((ready - Date.now()) / 1000)}s (12s sau khi chuỗi thoại/kết quả cuối kết thúc)`);
        while (Date.now() < ready && !signal.aborted) await sleep(250);
      }
      // Client thật LUÔN gửi `20/02 00 08` (trạng thái "đang tương tác", ✅ pcap chupt_phoban01 105.215s + ban_item_mua_hpsp + dong_gop_hp) ngay trước `14/01` bấm NPC;
      // thiếu gói này server đáp câu thoại đầu nhưng từ chối đáp 14/06 bằng `14/08 00 27` (log thật 15:04) ⇒ không vào được trận Trương Giác.
      const click = () => {
        write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08])));
        write(encodeFrame(cmdBody(0x14, 0x01, [0x00, npcId & 0xff, (npcId >> 8) & 0xff])));
      };
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal.aborted) throw new Error("Thao tác bị hủy");
        this.openDialogWindow(60_000);
        this.doorRejected = undefined;
        this.io.log("info", `[click_boss] NPC ${npcId} lần ${attempt}/3 tại (${this.location.x},${this.location.y}) → (${goX},${goY})`);
        // Câu thoại NPC: client thật đáp sau ~1.2s (câu 1) / ~1.0s (câu 2).
        this.npcAckDelayMs = 1200;
        click();
        this.io.log("info", `[click_boss] tx 20/02 00 08 + 14/01 00 ${npcId.toString(16).padStart(2, "0")} 00 (đáp thoại sau ${this.npcAckDelayMs}ms)`);
        if (attempt > 1) { await sleep(130); if (!this.inBattle) click(); }
        const until = Date.now() + 12_000;
        while (!this.inBattle && Date.now() < until && !signal.aborted) await sleep(250);
        const rej = this.doorRejected as number | undefined; // đổi bởi handle() trong lúc chờ
        if (!this.inBattle && rej !== undefined) this.io.log("warn", `[click_boss] server từ chối đáp thoại (mã 0x${rej.toString(16)}) — KHÔNG gửi thêm gói đoán (14/09 từng bị kick mã 5)`);
        if (!this.inBattle && attempt < 3) { this.io.log("info", `[click_boss] NPC ${npcId} chưa vào trận — chờ thêm 8s cho NPC hiển thị rồi bấm lại`); await sleep(8000); }
        if (this.inBattle) { this.io.log("info", `[click_boss] NPC ${npcId}: đã vào trận (lần ${attempt})`); this.watchNpc = undefined; this.npcAckDelayMs = 0; return { ok: true }; }
      }
      this.watchNpc = undefined;
      this.npcAckDelayMs = 0;
      return { ok: false, message: `Không vào được trận với NPC ${npcId} sau 3 lần (xem log [click_boss]); hãy thao tác tay hoặc bấm "Thoát phó bản"` };
    }
    if ((name === "click" || name === "talk_npc") && args.length >= 3) {
      // `click N,map,x,y[,chờ tối thiểu giây]`: đi tới (x,y) rồi bấm NPC N. TRONG PHÓ BẢN làm như client thật (pcap phobandoi_02): đứng yên gửi lại vị trí 3 lần (~430ms),
      // chờ đủ `chờ tối thiểu` kể từ sự kiện chuỗi thoại/kết quả cuối (mặc định 3s), `20/02`+`14/01`, đáp thoại, trận, kết quả; bị từ chối/không phản hồi ⇒ chờ 8s bấm lại (≤3 lần).
      const npcId = Number(args[0]);
      const hasMap = args.length >= 4;
      const targetX = Number(hasMap ? args[2] : args[1]);
      const targetY = Number(hasMap ? args[3] : args[2]);
      if (Number.isFinite(npcId) && Number.isFinite(targetX) && Number.isFinite(targetY) && targetX > 0 && targetY > 0) {
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        await this.walkWaypoints([{ x: targetX, y: targetY }], write, signal);
        if (signal.aborted) throw new Error("Thao tác bị hủy");
        const isTeamDungeon = DUNGEON_ROOM_CATALOG.some((d) => d.map === this.location.map);
        if (!isTeamDungeon) {
          // Gửi xác nhận vị trí đứng trước khi bấm NPC (tránh server coi là đang di chuyển)
          for (let i = 0; i < 2; i++) {
            write(encodeFrame(cmdBody(0x06, 0x01, [0x00, 0x00, targetX & 0xff, (targetX >> 8) & 0xff, targetY & 0xff, (targetY >> 8) & 0xff])));
            await sleep(200);
          }
          this.location = { ...this.location, x: targetX, y: targetY };
          await sleep(300);
          this.io.log("info", `[click] NPC ${npcId}: đã đi tới (${this.location.x},${this.location.y}) — đích (${targetX},${targetY})`);
          await this.npcInteract(npcId, write, signal);
          return { ok: true };
        }
        const minWaitMs = args.length >= 5 && Number.isFinite(Number(args[4])) ? Number(args[4]) * 1000 : 3000;
        for (let attempt = 1; attempt <= 3; attempt++) {
          for (let i = 0; i < 3; i++) {
            write(encodeFrame(cmdBody(0x06, 0x01, [0x00, 0x00, targetX & 0xff, (targetX >> 8) & 0xff, targetY & 0xff, (targetY >> 8) & 0xff])));
            await sleep(430);
          }
          this.location = { ...this.location, x: targetX, y: targetY };
          await sleep(1100);
          const ready = this.lastChainRx + minWaitMs;
          while (Date.now() < ready && !signal.aborted) await sleep(250);
          if (signal.aborted) throw new Error("Thao tác bị hủy");
          this.io.log("info", `[click] NPC ${npcId} lần ${attempt}/3`);
          const r = await this.npcInteract(npcId, write, signal);
          if (r === "ok") return { ok: true };
          this.io.log("warn", `[click] NPC ${npcId}: ${r === "rejected" ? "server từ chối đáp thoại" : "server không phản hồi"} — chờ 8s rồi bấm lại`);
          await sleep(8000);
        }
        return { ok: false, message: `Không tương tác được NPC ${npcId} sau 3 lần (xem log [click]); hãy thao tác tay hoặc bấm "Thoát phó bản"` };
      }
    }
    if ((name === "click" || name === "talk_npc") && args.length >= 1 && args.length < 3 && Number.isFinite(Number(args[0]))) {
      // `click N` rút gọn (mở rương / bấm NPC tại chỗ):
      await this.npcInteract(Number(args[0]), write, signal);
      return { ok: true };
    }
    if (name === "warp_to_spot" && args.length >= 3) {
      if (this.isMemberInParty()) {
        return { ok: true };
      }
      const targetMap = Number(args[0]);
      const targetX = Number(args[1]);
      const targetY = Number(args[2]);
      const npcName = args[3] || "";
      if (Number.isFinite(targetX) && Number.isFinite(targetY) && targetX > 0 && targetY > 0) {
        if (this.location.map === targetMap) {
          this.io.game(`🚶 [${this.player.name || "Nhân vật"}] đang di chuyển tiếp cận bãi train ${npcName ? `(${npcName})` : ""} tại (${targetX}, ${targetY})...`);
          await this.walkWaypoints([{ x: targetX, y: targetY }], write, signal);
          return { ok: true };
        }
      }
    }
    if (name === "set_auto_move" && args.length >= 1) {
      try {
        let cfg: Partial<AutoMoveState>;
        const first = args[0] ?? "";
        if (first.startsWith("{")) {
          cfg = JSON.parse(first);
        } else {
          const isEn = first === "1" || first === "true";
          cfg = {
            enabled: isEn,
            mapId: Number(args[1]) || this.location.map || 0,
            originX: Number(args[2]) || this.location.x || 0,
            originY: Number(args[3]) || this.location.y || 0,
            maxRadius: Number(args[4]) || 150,
          };
        }
        this.updateAutoMove(cfg);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, message: err?.message || String(err) };
      }
    }
    if (name === "set_chase_config" && args.length >= 1) {
      try {
        let cfg: Partial<ChaseConfig>;
        const first = args[0] ?? "";
        if (first.startsWith("{")) {
          cfg = JSON.parse(first);
        } else {
          cfg = {
            enabled: first === "1" || first === "true",
            mapId: Number(args[1]) || 0,
            originX: Number(args[2]) || 0,
            originY: Number(args[3]) || 0,
            maxRadius: Number(args[4]) || 150,
            npcId: Number(args[5]) || 0,
            npcName: args[6] || "",
            autoReturn: args[7] === "1" || args[7] === "true",
          };
        }
        this.updateChaseConfig(cfg);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, message: err?.message || String(err) };
      }
    }
    return null;
  }

  private waitForMapId(targetMap: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (this.location.map === targetMap) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const check = (map: number) => {
        if (map === targetMap || this.location.map === targetMap) {
          cleanup();
          resolve(true);
        }
      };
      const onAbort = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        this.mapWaiters.delete(check);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      this.mapWaiters.add(check);
    });
  }

  public async walkWaypoints(
    waypoints: { x: number; y: number }[],
    write: (b: Buffer) => void,
    signal: AbortSignal,
    stepSize = 85,
    delayMs = 420,
  ): Promise<void> {
    let curX = this.location.x ?? waypoints[0]?.x ?? 0;
    let curY = this.location.y ?? waypoints[0]?.y ?? 0;

    for (const wp of waypoints) {
      while (true) {
        if (signal.aborted) throw new Error("Thao tác bị hủy");
        // Đang trong trận đấu thì gói di chuyển vô hiệu (và dễ bị server kick): đứng chờ hết trận, rồi lấy lại vị trí thật.
        if (this.inBattle) {
          while (this.inBattle && !signal.aborted) await new Promise((r) => setTimeout(r, 400));
          if (signal.aborted) throw new Error("Thao tác bị hủy");
          curX = this.location.x ?? curX;
          curY = this.location.y ?? curY;
        }
        const dx = wp.x - curX;
        const dy = wp.y - curY;
        const d = Math.hypot(dx, dy);
        if (d <= 40) break;

        const step = Math.min(stepSize, d);
        const nextX = Math.round(curX + (dx / d) * step);
        const nextY = Math.round(curY + (dy / d) * step);
        const dir = this.getMoveDir(nextX - curX, nextY - curY);

        write(encodeFrame(cmdBody(0x06, 0x01, [
          0x00,
          dir & 0xff,
          nextX & 0xff,
          (nextX >> 8) & 0xff,
          nextY & 0xff,
          (nextY >> 8) & 0xff,
        ])));

        curX = nextX;
        curY = nextY;
        this.location = { ...this.location, x: curX, y: curY };
        this.io.patchState({ location: this.location });
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, delayMs);
          const onAbort = () => {
            clearTimeout(t);
            reject(new Error("Thao tác bị hủy"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
  }

  private getMoveDir(dx: number, dy: number): number {
    if (dx === 0 && dy === 0) return 0;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle >= -112.5 && angle < -67.5) return 0;  // Up
    if (angle >= -157.5 && angle < -112.5) return 1; // Up-Left
    if (angle < -157.5 || angle >= 157.5) return 2;  // Left
    if (angle >= 112.5 && angle < 157.5) return 3;   // Down-Left
    if (angle >= 67.5 && angle < 112.5) return 4;    // Down
    if (angle >= 22.5 && angle < 67.5) return 5;     // Down-Right
    if (angle >= -22.5 && angle < 22.5) return 6;    // Right
    return 7;                                        // Up-Right
  }

  private async executeShopTransaction(
    args: string[],
    write: (b: Buffer) => void,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; message?: string }> {
    const buyHpEnabled = args[0] === "1" || args[0] === "true";
    const buyHpQty = Math.max(0, Math.min(9999, Number(args[1]) || 0));
    const buySpEnabled = args[2] === "1" || args[2] === "true";
    const buySpQty = Math.max(0, Math.min(9999, Number(args[3]) || 0));
    const sellIdsArg = args[4];

    if (sellIdsArg) {
      try {
        const parsed = JSON.parse(sellIdsArg);
        if (Array.isArray(parsed) && parsed.length > 0) {
          for (const id of parsed) {
            const num = Number(id);
            if (Number.isInteger(num) && num > 0) this.autoLists.sell.add(num);
          }
        }
      } catch {}
    }

    const sleepWithSignal = async (ms: number) => {
      if (signal.aborted) throw new Error("Thao tác bị hủy");
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(t);
          reject(new Error("Thao tác bị hủy"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      });
    };

    try {
      if (this.inBattle) {
        this.io.game("⚠️ [Mua/Bán] Nhân vật đang trong trận đấu, không thể thực hiện giao dịch.");
        return { ok: false, message: "Đang trong trận đấu" };
      }

      let curMap = this.location.map;
      const initialMapName = (mapNames as Record<string, string>)[curMap] ?? (curMap ? `Map #${curMap}` : "Chưa xác định");
      this.io.log("info", `🛒 [Mua/Bán] Bắt đầu tiến trình Bán & Mua HP/SP từ ${initialMapName} (${curMap || 0})...`);

      // BƯỚC A: ĐIỀU HƯỚNG TỚI QUẢNG TRƯỜNG HƯƠNG DŨNG (12701)
      if (curMap !== 12701) {
        // A.1 Nếu đang ở map khác ngoài cụm Trác Quận / U Châu (12001, 63000, 12992), Teleport về Cổng thành Trác Quận (12001)
        if (curMap !== 12001 && curMap !== 63000 && curMap !== 12992) {
          this.io.log("info", "🏯 [Mua/Bán] Đang truyền tống về Cổng thành Trác Quận (12001)...");

          // Gửi gói 44/01 00 e1 2e 00 (Trác Quận, gate index 0)
          write(encodeFrame(cmdBody(0x44, 0x01, [0x00, 0xe1, 0x2e, 0x00])));
          // Gửi ping 07/01 00 sau 200ms theo đúng pcap
          await sleepWithSignal(200);
          write(encodeFrame(cmdBody(0x07, 0x01, [0x00])));

          await this.waitForMapId(12001, 8000, signal);
          // Chờ 1.2s cho máy chủ nạp xong tài nguyên bản đồ mới
          await sleepWithSignal(1200);
          write(encodeFrame(cmdBody(0x0c, 0x01, [0x00]))); // sync state
          // Tuyệt đối không gửi 14/06 sau 44/01 (tránh kích hoạt anti-cheat mã 44 của server)
          // Giãn cách an toàn 1.8s để ổn định hoàn toàn trước khi bắt đầu chặng kế tiếp
          await sleepWithSignal(1800);
          curMap = this.location.map;
        }

        // A.2 Tại Cổng thành Trác Quận (12001) đi bộ ra Cổng 1 tới Đại Lục U Châu (63000)
        if (curMap === 12001) {
          this.io.log("info", "🚶 [Mua/Bán] Đang di chuyển tới Cổng ra U Châu (90, 1650)...");
          await this.walkWaypoints([{ x: 230, y: 1570 }, { x: 160, y: 1610 }, { x: 90, y: 1650 }], write, signal);
          await sleepWithSignal(800);

          this.io.log("info", "🚪 [Mua/Bán] Bước qua cổng ra Đại Lục U Châu (63000)...");
          // Gói 14/04 trigger cổng trước khi gửi 14/08 (khớp pcap ban_item_mua_hpsp)
          write(encodeFrame(cmdBody(0x14, 0x04, [0x00, 0x01, 0x00])));
          await sleepWithSignal(600);
          write(encodeFrame(cmdBody(0x14, 0x08, [0x00, 0x01, 0x00]))); // cổng 1
          await this.waitForMapId(63000, 8000, signal);
          await sleepWithSignal(1200);
          write(encodeFrame(cmdBody(0x0c, 0x01, [0x00])));
          await sleepWithSignal(1000);
          write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
          await sleepWithSignal(1500);
          curMap = this.location.map;
        }

        // A.3 Tại Đại Lục U Châu (63000) đi bộ tới Cổng 5 vào Doanh trại Hương Dũng (12992)
        if (curMap === 63000) {
          this.io.log("info", "🚶 [Mua/Bán] Đang di chuyển trên U Châu tới Cổng Doanh trại Hương Dũng (1310, 110)...");
          await this.walkWaypoints([
            { x: 1190, y: 550 },
            { x: 1210, y: 410 },
            { x: 1270, y: 290 },
            { x: 1300, y: 150 },
            { x: 1310, y: 110 },
          ], write, signal);
          await sleepWithSignal(800);

          this.io.log("info", "🚪 [Mua/Bán] Bước qua cổng vào Doanh trại Hương Dũng (12992)...");
          // Gói 14/04 trigger cổng trước khi gửi 14/08 (khớp pcap ban_item_mua_hpsp)
          write(encodeFrame(cmdBody(0x14, 0x04, [0x00, 0x05, 0x00])));
          await sleepWithSignal(600);
          write(encodeFrame(cmdBody(0x14, 0x08, [0x00, 0x05, 0x00]))); // cổng 5
          await this.waitForMapId(12992, 8000, signal);
          await sleepWithSignal(1200);
          write(encodeFrame(cmdBody(0x0c, 0x01, [0x00])));
          await sleepWithSignal(1000);
          write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
          await sleepWithSignal(1500);
          curMap = this.location.map;
        }

        // A.4 Tại Doanh trại Hương Dũng (12992) đi bộ tới Cổng 3 vào Quảng trường Hương Dũng (12701)
        if (curMap === 12992) {
          this.io.log("info", "🚶 [Mua/Bán] Đang di chuyển tới Cổng vào Quảng trường Hương Dũng (476, 1715)...");
          await this.walkWaypoints([
            { x: 325, y: 1777 },
            { x: 401, y: 1746 },
            { x: 476, y: 1715 },
          ], write, signal);
          await sleepWithSignal(800);

          this.io.log("info", "🚪 [Mua/Bán] Đi vào Quảng trường Hương Dũng (12701)...");
          write(encodeFrame(cmdBody(0x14, 0x08, [0x00, 0x03, 0x00]))); // cổng 3
          await sleepWithSignal(1200);
          write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
          await sleepWithSignal(1500);
          this.location = { ...this.location, map: 12701, x: 334, y: 1771 };
          this.io.patchState({ location: this.location });
          curMap = 12701;
        }
      }

      // BƯỚC B: TIẾP CẬN QUẦY NPC THƯƠNG NHÂN 12 TẠI (970, 490)
      const TARGET_NPC_X = 970;
      const TARGET_NPC_Y = 490;
      const startX = this.location.x ?? 334;
      const startY = this.location.y ?? 1771;
      const initialDist = Math.hypot(startX - TARGET_NPC_X, startY - TARGET_NPC_Y);

      if (initialDist > 120) {
        this.io.log("info", `🚶 [Mua/Bán] Đang đi đến quầy NPC Thương nhân 12 (${startX}, ${startY} ➜ ${TARGET_NPC_X}, ${TARGET_NPC_Y})...`);

        const waypoints: { x: number; y: number }[] = [];
        if (startY > 1000) {
          // Khu vực phía nam / cổng doanh trại dưới (334, 1771)
          waypoints.push(
            { x: 514, y: 1710 },
            { x: 850, y: 1590 },
            { x: 1030, y: 1310 },
            { x: 1070, y: 1010 },
            { x: 970, y: 890 },
            { x: 870, y: 750 },
            { x: 890, y: 630 },
            { x: TARGET_NPC_X, y: TARGET_NPC_Y }
          );
        } else if (startX < 700) {
          // Khu vực phía tây / cổng doanh trại ngang (170, 790)
          waypoints.push(
            { x: 550, y: 770 },
            { x: 870, y: 750 },
            { x: 890, y: 630 },
            { x: TARGET_NPC_X, y: TARGET_NPC_Y }
          );
        } else {
          waypoints.push(
            { x: 870, y: 750 },
            { x: 890, y: 630 },
            { x: TARGET_NPC_X, y: TARGET_NPC_Y }
          );
        }

        await this.walkWaypoints(waypoints, write, signal);
        await sleepWithSignal(1000);
        this.io.log("info", `✓ [Mua/Bán] Đã tiếp cận quầy NPC Thương nhân 12 (${this.location.x}, ${this.location.y}).`);
      }

      // Kiểm tra an toàn khoảng cách: Nếu khoảng cách > 160px thì không đối thoại để tránh bị server kick mã 5
      const finalDist = Math.hypot((this.location.x ?? 0) - TARGET_NPC_X, (this.location.y ?? 0) - TARGET_NPC_Y);
      if (finalDist > 160) {
        this.io.game(`⚠️ [Mua/Bán] Khoảng cách tới NPC Thương nhân quá xa (${Math.round(finalDist)}px). Hủy thao tác để tránh bị ngắt kết nối.`);
        return { ok: false, message: `Chưa tiếp cận được NPC Thương nhân (cách ${Math.round(finalDist)}px)` };
      }

      // --- BƯỚC 1: KIỂM TRA VÀ BÁN VẬT PHẨM TRONG DANH SÁCH BÁN ---
      const toSell: { slot: number; id: number; qty: number; name: string }[] = [];
      for (const [slot, it] of this.bag.entries()) {
        if (this.autoLists.sell.has(it.id)) {
          const name = (itemNames as Record<string, string>)[it.id] ?? `Vật phẩm #${it.id}`;
          toSell.push({ slot, id: it.id, qty: it.qty, name });
        }
      }

      if (toSell.length === 0) {
        const targetSellNames = this.autoLists.sell.size > 0
          ? Array.from(this.autoLists.sell).map((id) => (itemNames as Record<string, string>)[id] ?? `#${id}`).join(", ")
          : "Chưa chọn món nào";

        // Kiểm tra xem món trong danh sách Bán có đang nằm trong Tiền Trang (Kho) không
        const inBankItems: string[] = [];
        for (const [bankSlot, it] of this.bank.entries()) {
          if (this.autoLists.sell.has(it.id)) {
            const name = (itemNames as Record<string, string>)[it.id] ?? `Vật phẩm #${it.id}`;
            inBankItems.push(`${it.qty.toLocaleString("vi-VN")}x ${name} (ô ${bankSlot} Tiền Trang)`);
          }
        }

        if (inBankItems.length > 0) {
          this.io.game(`⚠️ [Bán vật phẩm] Phát hiện ${inBankItems.join(", ")} đang nằm trong TIỀN TRANG (Kho đồ), không phải trong Túi đồ cá nhân! NPC Thương nhân chỉ có thể mua đồ trong Túi đồ. Hãy rút đồ về Túi trước khi bán.`);
        } else {
          const bagSummary = this.bag.size > 0
            ? `Túi đồ hiện có ${this.bag.size} ô: ${Array.from(this.bag.values()).slice(0, 5).map((it) => `${it.qty}x ${(itemNames as Record<string, string>)[it.id] ?? `#${it.id}`}`).join(", ")}${this.bag.size > 5 ? "..." : ""}`
            : "Túi đồ hiện đang trống";
          this.io.game(`ℹ️ [Bán vật phẩm] Túi đồ không có vật phẩm nào khớp danh sách Bán (${targetSellNames}). (${bagSummary}). Bỏ qua bước bán.`);
        }
        this.io.log("info", "ℹ️ [Bán vật phẩm] Túi đồ không có vật phẩm nào trong danh sách Bán.");
      } else {
        const sellSummary = toSell.map((t) => `${t.qty}x ${t.name}`).join(", ");
        this.io.game(`🪙 [Bán vật phẩm] Tìm thấy ${toSell.length} ô vật phẩm cần bán (${sellSummary}). Bắt đầu giao dịch...`);
        this.io.log("info", "💬 [Mua/Bán] Bắt đầu tương tác với NPC Thương nhân Hương Dũng để Bán vật phẩm...");

        // 1.1 Chuẩn bị tương tác: 20/02 00 08
        write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08])));
        await sleepWithSignal(600);

        // 1.2 Gửi đối thoại NPC 12: 14/01 00 0c 00
        write(encodeFrame(cmdBody(0x14, 0x01, [0x00, 0x0c, 0x00])));
        await sleepWithSignal(1200);

        // 1.3 Chọn menu Bán (0x1f = 31): 14/09 00 1f
        write(encodeFrame(cmdBody(0x14, 0x09, [0x00, 0x1f])));
        await sleepWithSignal(600);

        // 1.4 Xác nhận mở giao diện bán (14/06 00):
        write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
        await sleepWithSignal(800);

        let earnedGold = 0;
        const prevEarnedListener = this.onGoldEarned;
        this.onGoldEarned = (amount) => { earnedGold += amount; };
        const goldBeforeSell = this.gold;

        try {
          for (const item of toSell) {
            this.io.log("info", `🪙 [Bán vật phẩm] Đang bán ${item.name} (x${item.qty}) tại ô ${item.slot}...`);
            // Gói tin 1b/02 00 01 [slot] [qty u32 LE]
            write(encodeFrame(cmdBody(0x1b, 0x02, [
              0x00,
              0x01,
              item.slot & 0xff,
              item.qty & 0xff,
              (item.qty >> 8) & 0xff,
              (item.qty >> 16) & 0xff,
              (item.qty >>> 24) & 0xff,
            ])));
            await sleepWithSignal(600);
          }
          this.io.log("info", "✓ [Bán vật phẩm] Đã bán xong toàn bộ vật phẩm trong danh sách.");

          // 1.6 Thoát phiên giao dịch bán: 14/06 00
          write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
          await sleepWithSignal(1200);
          this.io.log("info", "✓ [Bán vật phẩm] Đã thoát phiên giao dịch Bán.");
        } finally {
          this.onGoldEarned = prevEarnedListener;
        }

        const soldMap = new Map<string, number>();
        for (const it of toSell) {
          soldMap.set(it.name, (soldMap.get(it.name) ?? 0) + it.qty);
        }
        const soldSummaryStr = Array.from(soldMap.entries()).map(([name, qty]) => `${qty}x ${name}`).join(", ");
        const goldEarned = earnedGold > 0 ? earnedGold : Math.max(0, this.gold - goldBeforeSell);
        if (goldEarned > 0) {
          this.io.game(`🪙 [Bán vật phẩm] Đã bán thành công ${soldSummaryStr} thu được ${goldEarned.toLocaleString("vi-VN")} Vàng.`);
        } else {
          this.io.game(`🪙 [Bán vật phẩm] Đã bán thành công ${soldSummaryStr}.`);
        }
      }

      // --- BƯỚC 2: ĐỐI THOẠI NPC CHỌN MUA & MUA HP / SP ---
      const needBuyHp = buyHpEnabled && buyHpQty > 0;
      const needBuySp = buySpEnabled && buySpQty > 0;

      if (!needBuyHp && !needBuySp) {
        this.io.log("info", "ℹ️ [Mua HP/SP] Không có tùy chọn Mua HP hoặc Mua SP nào được bật, hoàn tất quy trình.");
        return { ok: true, message: "Bán hoàn tất (không mua HP/SP)" };
      }

      this.io.log("info", "🛒 [Mua HP/SP] Bắt đầu tương tác với NPC để Mua HP/SP...");
      // 2.1 Chuẩn bị tương tác: 20/02 00 08
      write(encodeFrame(cmdBody(0x20, 0x02, [0x00, 0x08])));
      await sleepWithSignal(600);

      // 2.2 Gửi đối thoại NPC 12: 14/01 00 0c 00
      write(encodeFrame(cmdBody(0x14, 0x01, [0x00, 0x0c, 0x00])));
      await sleepWithSignal(1200);

      // 2.3 Chọn menu Mua (0x1e = 30): 14/09 00 1e
      write(encodeFrame(cmdBody(0x14, 0x09, [0x00, 0x1e])));
      await sleepWithSignal(600);

      // 2.4 Xác nhận mở tiệm: 14/06 00
      write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
      await sleepWithSignal(800);

      // 2.5 Mua HP (Thuốc Vận Công - Slot 0)
      if (needBuyHp) {
        let spentHp = 0;
        const prevSpentListener = this.onGoldSpent;
        this.onGoldSpent = (amount) => { spentHp += amount; };
        const goldBeforeHp = this.gold;
        let remHp = buyHpQty;
        this.io.log("info", `💊 [Mua HP] Đang mua Thuốc Vận Công (tổng x${buyHpQty})...`);
        try {
          while (remHp > 0) {
            const batch = Math.min(remHp, 999);
            // Gói tin 1b/01 00 00 [batch u32 LE]
            write(encodeFrame(cmdBody(0x1b, 0x01, [
              0x00,
              0x00, // shop slot 0 = Thuốc Vận Công
              batch & 0xff,
              (batch >> 8) & 0xff,
              (batch >> 16) & 0xff,
              (batch >>> 24) & 0xff,
            ])));
            remHp -= batch;
            await sleepWithSignal(600);
          }
        } finally {
          this.onGoldSpent = prevSpentListener;
        }
        const goldSpentHp = spentHp > 0 ? spentHp : (Math.max(0, goldBeforeHp - this.gold) || (buyHpQty * 20));
        if (goldSpentHp > 0) {
          this.io.game(`💊 [Mua HP] Đã mua ${buyHpQty}x Thuốc Vận Công trừ ${goldSpentHp.toLocaleString("vi-VN")} Vàng.`);
        } else {
          this.io.game(`💊 [Mua HP] Đã mua ${buyHpQty}x Thuốc Vận Công.`);
        }
      }

      // 2.6 Mua SP (Thiên Kim Du - Slot 2)
      if (needBuySp) {
        let spentSp = 0;
        const prevSpentListener = this.onGoldSpent;
        this.onGoldSpent = (amount) => { spentSp += amount; };
        const goldBeforeSp = this.gold;
        let remSp = buySpQty;
        this.io.log("info", `💧 [Mua SP] Đang mua Thiên Kim Du (tổng x${buySpQty})...`);
        try {
          while (remSp > 0) {
            const batch = Math.min(remSp, 999);
            // Gói tin 1b/01 00 02 [batch u32 LE]
            write(encodeFrame(cmdBody(0x1b, 0x01, [
              0x00,
              0x02, // shop slot 2 = Thiên Kim Du
              batch & 0xff,
              (batch >> 8) & 0xff,
              (batch >> 16) & 0xff,
              (batch >>> 24) & 0xff,
            ])));
            remSp -= batch;
            await sleepWithSignal(600);
          }
        } finally {
          this.onGoldSpent = prevSpentListener;
        }
        const goldSpentSp = spentSp > 0 ? spentSp : (Math.max(0, goldBeforeSp - this.gold) || (buySpQty * 20));
        if (goldSpentSp > 0) {
          this.io.game(`💧 [Mua SP] Đã mua ${buySpQty}x Thiên Kim Du trừ ${goldSpentSp.toLocaleString("vi-VN")} Vàng.`);
        } else {
          this.io.game(`💧 [Mua SP] Đã mua ${buySpQty}x Thiên Kim Du.`);
        }
      }

      // 2.7 Thoát phiên giao dịch Mua:
      // Menu 40 (0x28): 14/09 00 28
      write(encodeFrame(cmdBody(0x14, 0x09, [0x00, 0x28])));
      await sleepWithSignal(600);
      // Ready 14/06 00
      write(encodeFrame(cmdBody(0x14, 0x06, [0x00])));
      await sleepWithSignal(1000);
      this.io.log("info", "✓ [Mua HP/SP] Đã hoàn tất mua vật phẩm và thoát phiên giao dịch.");

      return { ok: true, message: "Bán và mua HP/SP hoàn tất" };
    } catch (e) {
      const err = (e as Error).message || String(e);
      this.io.game(`⚠️ [Mua/Bán] Quá trình giao dịch dừng: ${err}`);
      return { ok: false, message: err };
    }
  }

  private skillType(id: number): BattleActionConfig["type"] {
    if (id === 10000) return "attack";
    if (id === 17001) return "defend";
    if (id === 18001) return "escape";
    if (id === 15001) return "catch";
    if (id === 19001) return "item";
    return "skill";
  }

  encodeBattleActionFrame(
    actorRow: number,
    actorCol: number,
    targetRow: number,
    targetCol: number,
    skillId: number,
    itemSlot = 0,
  ): Buffer {
    const payload = Buffer.alloc(9);
    payload[0] = 0x00;
    payload[1] = actorRow;
    payload[2] = actorCol;
    payload[3] = targetRow;
    payload[4] = targetCol;
    payload.writeUInt16LE(skillId, 5);
    payload[7] = itemSlot & 0xff;
    payload[8] = (itemSlot >> 8) & 0xff;
    return encodeFrame(cmdBody(0x32, 0x01, payload));
  }

  private battleStart() {
    this.inBattle = true;
    this.cancelPendingAcks();
    if (this.chaseCheckTimer) {
      clearTimeout(this.chaseCheckTimer);
      this.chaseCheckTimer = undefined;
    }
    if (this.autoMoveTimer) {
      clearTimeout(this.autoMoveTimer);
      this.autoMoveTimer = undefined;
    }
    this.battleUnits = [];
    this.battleTurnIndex = 0;
    this.battleConfig = { ...this.battleConfig, currentTurn: 0 };
    this.io.patchState({ inBattle: true, battleUnits: [], battleConfig: this.battleConfig });
    this.io.game("⚔️ Trận đấu bắt đầu!");
    this.io.log("info", "Vào trận đấu");
  }

  private battleSpawnPlayer(f: Buffer) {
    this.inBattle = true;
    this.cancelPendingAcks();
    const row = f.length >= 33 ? f[32]! : 3;
    const col = f.length >= 34 ? f[33]! : 2;
    const maxHp = f.length >= 38 ? f.readUInt32LE(34) : 0;
    const maxSp = f.length >= 42 ? f.readUInt32LE(38) : 0;
    const curHp = f.length >= 46 ? f.readUInt32LE(42) : 0;
    const curSp = f.length >= 50 ? f.readUInt32LE(46) : 0;
    const level = f.length >= 52 ? f.readUInt16LE(50) : this.player.level;
    const nameLen = f.length >= 55 ? f[54]! : 0;
    const name = nameLen > 0 && f.length >= 55 + nameLen
      ? f.toString("latin1", 55, 55 + nameLen)
      : (this.player.name || "Nhân vật");

    const existingIdx = this.battleUnits.findIndex((u) => u.row === row && u.col === col);
    const unit: BattleUnit = {
      row, col, name, level,
      hp: { cur: curHp, max: maxHp || this.player.hp.max || curHp },
      sp: { cur: curSp, max: maxSp || this.player.sp.max || curSp },
      isEnemy: false,
      isPet: false,
      owner: f.length >= 22 ? f.toString("hex", 14, 22) : this.selfHex,
    };
    if (existingIdx >= 0) {
      this.battleUnits[existingIdx] = unit;
    } else {
      this.battleUnits.push(unit);
    }
    if ((curHp > 0 || maxHp > 0) && (unit.owner === this.selfHex || !this.selfHex)) {
      this.player = {
        ...this.player,
        hp: { cur: curHp, max: maxHp || this.player.hp.max },
        sp: { cur: curSp, max: maxSp || this.player.sp.max },
      };
    }
    this.io.patchState({ inBattle: true, battleUnits: [...this.battleUnits], player: this.player });
    this.battleSpawnBulk(f);
  }

  /**
   * `0b/fa` của client đang ở trong ĐỘI gộp nhiều đơn vị trong MỘT frame (log thật: 4 người + võ tướng, 553 byte): mỗi bản ghi = `lead(1) kind(1) thân…` — cùng bố cục các gói `0b/05`
   * (kind 02 người: 41+1+len(tên)+44+2·số skill; kind 04 võ tướng: 48; kind 07 quái: 41 tính từ kind). Bản ghi đầu (f[12..]) đã xử lý ở `battleSpawnPlayer`; phần còn lại
   * được dựng thành frame ảo `0b/05` để dùng chung `battleSpawn` ⇒ đủ slot đồng đội + võ tướng của họ với đúng tên/HP/owner.
   */
  private battleSpawnBulk(f: Buffer) {
    let kindAt = 13;
    const recLen = (at: number): number => {
      const kind = f[at];
      if (kind === 0x02) {
        if (at + 42 > f.length) return 0;
        const nl = f[at + 41]!;
        const skillAt = at + 42 + nl + 13 + 8 + 6 + 11;
        if (skillAt >= f.length) return 0;
        return 42 + nl + 44 + 2 * f[skillAt]!; // kind..hết tên (42+nl) + 44 + 2·số skill
      }
      if (kind === 0x04) return 48;
      if (kind === 0x07) return 41;
      return 0;
    };
    const first = recLen(kindAt);
    if (!first) return;
    let lead = kindAt + first;
    while (lead + 2 <= f.length) {
      kindAt = lead + 1;
      const len = recLen(kindAt);
      if (!len || kindAt + len > f.length) break;
      const v = Buffer.alloc(10 + len);
      v[9] = f[lead]!;
      f.copy(v, 10, kindAt, kindAt + len);
      this.battleSpawn(v);
      lead = kindAt + len;
    }
  }

  private battleSpawn(f: Buffer) {
    this.inBattle = true;
    this.cancelPendingAcks();
    const model = f.length >= 13 ? f.readUInt16LE(11) : 0;
    const row = f.length >= 30 ? f[29]! : 0;
    const col = f.length >= 31 ? f[30]! : 2;
    const isEnemy = row <= 1;
    // Bản ghi 0b/05: f[10] = loại (02 nhân vật người chơi khác, 04 võ tướng, 07 quái). Nhân vật khác: uid @11; võ tướng: uid CHỦ @21 (log thật 14:45, đội 5 người).
    const kind = f.length >= 11 ? f[10]! : 0;
    if (!isEnemy && kind === 0x02 && f.length >= 52) {
      const nl = f[51]!;
      const cname = nl > 0 && f.length >= 52 + nl ? f.toString("latin1", 52, 52 + nl) : "Đồng đội";
      const other: BattleUnit = {
        row, col, name: cname, level: f[47]!,
        hp: { cur: f.readUInt32LE(39), max: f.readUInt32LE(31) },
        sp: { cur: f.readUInt32LE(43), max: f.readUInt32LE(35) },
        isEnemy: false, isPet: false, owner: f.toString("hex", 11, 19),
      };
      const oi = this.battleUnits.findIndex((u) => u.row === row && u.col === col);
      if (oi >= 0) this.battleUnits[oi] = other; else this.battleUnits.push(other);
      this.io.patchState({ inBattle: true, battleUnits: [...this.battleUnits] });
      return;
    }
    const petOwner = !isEnemy && kind === 0x04 && f.length >= 29 ? f.toString("hex", 21, 29) : undefined;
    const ownPet = petOwner === undefined || petOwner === this.selfHex;

    let curHp = 0, curSp = 0, maxHp = 0, maxSp = 0, level = 0, name = "";
    if (isEnemy) {
      if (f.length >= 48) {
        curHp = f.readUInt32LE(31);
        curSp = f.readUInt32LE(35);
        maxHp = f.readUInt32LE(39);
        maxSp = f.readUInt32LE(43);
        level = f[47]!;
      }
      const npcName = (npcNames as Record<string, string>)[String(model)];
      name = npcName ? npcName : `Quái ${model || col}`;
    } else {
      if (f.length >= 47) {
        maxHp = f.readUInt32LE(31);
        maxSp = f.readUInt32LE(35);
        curHp = f.readUInt32LE(39);
        curSp = f.readUInt32LE(43);
        level = f.length >= 48 ? f[47]! : (this.pet.level || this.player.level);
      }
      const petNpcName = (npcNames as Record<string, string>)[String(model)];
      name = ownPet ? (this.pet.name || petNpcName || "Võ tướng") : (petNpcName || "Võ tướng");
    }

    const existingIdx = this.battleUnits.findIndex((u) => u.row === row && u.col === col);
    const unit: BattleUnit = {
      row, col, name, level,
      hp: { cur: curHp, max: maxHp },
      sp: { cur: curSp, max: maxSp },
      isEnemy,
      isPet: !isEnemy,
      ...(petOwner ? { owner: petOwner } : {}),
    };
    if (existingIdx >= 0) {
      this.battleUnits[existingIdx] = unit;
    } else {
      this.battleUnits.push(unit);
    }
    if (!isEnemy && ownPet) {
      const act = this.activePet();
      if (act) {
        if (curHp > 0) act.hp = curHp;
        if (curSp > 0) act.sp = curSp;
        if (maxHp > 0) act.maxHp = maxHp;
        if (maxSp > 0) act.maxSp = maxSp;
      }
      this.pet = {
        ...this.pet,
        hp: { cur: curHp, max: maxHp || this.pet.hp.max },
        sp: { cur: curSp, max: maxSp || this.pet.sp.max },
      };
      this.io.patchState({
        inBattle: true,
        battleUnits: [...this.battleUnits],
        pet: this.pet,
        pets: this.roster.map((r) => ({ ...this.petUnit(r), idx: r.idx, model: r.model, active: r === act, stats: r.stats, gear: r.gear })),
      });
    } else {
      this.io.patchState({ inBattle: true, battleUnits: [...this.battleUnits] });
    }
  }

  private battleStatus(f: Buffer) {
    let playerChanged = false;
    let petChanged = false;
    for (let o = 10; o + 7 <= f.length; o += 7) {
      const row = f[o]!;
      const col = f[o + 1]!;
      const statType = f[o + 2]!;
      const val = f.readUInt32LE(o + 3);
      let u = this.battleUnits.find((x) => x.row === row && x.col === col);
      if (!u) {
        const isEnemy = row <= 1;
        const isPet = !isEnemy && row === 2;
        u = {
          row, col,
          name: isEnemy ? `Quái (${col})` : (isPet ? (this.pet.name || "Võ tướng") : (this.player.name || "Nhân vật")),
          level: isEnemy ? 30 : (isPet ? (this.pet.level || 96) : (this.player.level || 121)),
          hp: { cur: isPet ? (this.pet.hp.cur || 0) : (!isEnemy ? (this.player.hp.cur || 0) : 0), max: isPet ? (this.pet.hp.max || 0) : (!isEnemy ? (this.player.hp.max || 0) : 0) },
          sp: { cur: 0, max: isPet ? (this.pet.sp.max || 0) : (this.player.sp.max || 0) },
          isEnemy,
          isPet,
        };
        this.battleUnits.push(u);
      }
      // Đội nhiều người: chỉ đơn vị CỦA MÌNH (owner = uid mình / không rõ owner) mới đồng bộ tên/cấp/HP với this.player / this.pet; đồng đội & võ tướng của họ giữ dữ liệu từ 0b/05.
      const mine = !u.isEnemy && (!u.owner || /^0+$/.test(u.owner) || u.owner === this.selfHex);
      if (mine) {
        const isPetUnit = u.isPet === true || (u.isPet !== false && row === 2);
        if (isPetUnit) {
          if (this.pet.name) u.name = this.pet.name;
          if (this.pet.level > 0) u.level = this.pet.level;
          if (u.sp.max === 0 && this.pet.sp.max > 0) u.sp.max = this.pet.sp.max;
        } else {
          if (this.player.name) u.name = this.player.name;
          if (this.player.level > 0) u.level = this.player.level;
          if (u.sp.max === 0 && this.player.sp.max > 0) u.sp.max = this.player.sp.max;
        }
      }
      if (statType === 0x19) {
        u.hp.cur = val;
        if (mine) {
          const isPetUnit = u.isPet === true || (u.isPet !== false && row === 2);
          if (isPetUnit) {
            this.pet.hp.cur = val;
            const act = this.activePet();
            if (act) act.hp = val;
            petChanged = true;
          } else {
            this.player.hp.cur = val;
            playerChanged = true;
          }
        }
      } else if (statType === 0x1a) {
        u.sp.cur = val;
        if (mine) {
          const isPetUnit = u.isPet === true || (u.isPet !== false && row === 2);
          if (isPetUnit) {
            this.pet.sp.cur = val;
            const act = this.activePet();
            if (act) act.sp = val;
            petChanged = true;
          } else {
            this.player.sp.cur = val;
            playerChanged = true;
          }
        }
      } else if (statType === 0xcd) {
        u.hp.max = val;
        if (mine) {
          const isPetUnit = u.isPet === true || (u.isPet !== false && row === 2);
          if (isPetUnit) {
            this.pet.hp.max = val;
            const act = this.activePet();
            if (act) act.maxHp = val;
            petChanged = true;
          } else {
            this.player.hp.max = val;
            playerChanged = true;
          }
        }
      }
    }
    const patch: any = { battleUnits: [...this.battleUnits] };
    if (playerChanged) patch.player = { ...this.player };
    if (petChanged) {
      patch.pet = { ...this.pet };
      const act = this.activePet();
      patch.pets = this.roster.map((r) => ({ ...this.petUnit(r), idx: r.idx, model: r.model, active: r === act, stats: r.stats, gear: r.gear }));
    }
    this.io.patchState(patch);
  }

  private isSupportSkill(skillId: number, targetSetting?: string): boolean {
    if (skillId === 17001) return true; // Phòng ngự
    const slotNum = parseInt(targetSetting || "", 10);
    if (!isNaN(slotNum) && slotNum >= 11 && slotNum <= 20) return true; // Người dùng chủ động chọn slot phe ta
    const sDef = (skillDataRaw as Record<string, any>)[String(skillId)];
    const desc = (sDef?.desc ?? "").toLowerCase();
    const name = (sDef?.name ?? "").toLowerCase();
    return desc.includes("hồi phục") || desc.includes("hồi phục") ||
           desc.includes("gia tăng") || desc.includes("hóa giải") || desc.includes("hoá giải") ||
           name.includes("hồi huyết") || name.includes("thủy kính") || name.includes("thuỷ kính") ||
           name.includes("thanh long") || name.includes("gia huệ");
  }

  private resolveTarget(targetSetting: string | undefined, isSupportOrBuff: boolean): { row: number; col: number; label: string } {
    const rawTarget = (targetSetting || "F1").trim();

    // 1. Kiểm tra toạ độ cụ thể dạng (row, col) ví dụ "(3,2)", "(2,2)" hoặc "3,2"
    const coordMatch = rawTarget.match(/^\(?\s*([0-3])\s*,\s*([0-4])\s*\)?$/);
    if (coordMatch) {
      const r = Number(coordMatch[1]);
      const c = Number(coordMatch[2]);
      const unit = this.battleUnits.find((u) => u.row === r && u.col === c);
      return {
        row: r,
        col: c,
        label: unit ? `${unit.name} (${r},${c})` : `Vị trí (${r},${c})`,
      };
    }

    // 2. Kiểm tra chỉ số slotId 1..20
    const slotNum = parseInt(rawTarget, 10);
    if (!isNaN(slotNum) && slotNum >= 1 && slotNum <= 20) {
      let r = 0, c = 0;
      if (slotNum >= 1 && slotNum <= 5) { r = 1; c = slotNum - 1; }
      else if (slotNum >= 6 && slotNum <= 10) { r = 0; c = slotNum - 6; }
      else if (slotNum >= 11 && slotNum <= 15) { r = 2; c = slotNum - 11; }
      else { r = 3; c = slotNum - 16; }

      const unitAtSlot = this.battleUnits.find((u) => u.row === r && u.col === c);
      return {
        row: r,
        col: c,
        label: unitAtSlot ? `${unitAtSlot.name} (${r},${c})` : `Vị trí (${r},${c})`,
      };
    }

    // 3. F1 Hỗ trợ / Buff / Dùng vật phẩm: ưu tiên đồng đội thấp % HP nhất
    if (isSupportOrBuff) {
      const allies = this.battleUnits.filter((u) => !u.isEnemy && u.hp.cur > 0);
      if (allies.length > 0) {
        const lowest = [...allies].sort((a, b) => (a.hp.cur / (a.hp.max || 1)) - (b.hp.cur / (b.hp.max || 1)))[0]!;
        return { row: lowest.row, col: lowest.col, label: `${lowest.name} (F1 Buff)` };
      }
      const charUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === false);
      return { row: charUnit?.row ?? 3, col: charUnit?.col ?? 2, label: "Bản thân (F1)" };
    }

    // 4. F1 Tấn công: quái còn sống
    const livingEnemies = this.battleUnits.filter((u) => u.isEnemy && u.hp.cur > 0);
    if (livingEnemies.length > 0) {
      // Ưu tiên hàng trước (row 0), nếu hàng trước đã dọn sạch thì đánh hàng sau (row 1)
      const front = livingEnemies.filter((u) => u.row === 0);
      const pool = front.length > 0 ? front : livingEnemies;

      // Thuật toán chọn mục tiêu F1 thông minh (Smart AOE / Center Target):
      // Ưu tiên mục tiêu mà khi kỹ năng lan 3 mục tiêu (col-1, col, col+1) quét qua sẽ trúng nhiều quái nhất.
      // Tiếp theo ưu tiên quái nằm ở trung vị (vị trí ở giữa cụm quái), gần tâm bàn cờ (cột 2), và HP cao nhất.
      const cols = pool.map((u) => u.col).sort((a, b) => a - b);
      const medianCol = cols[Math.floor(cols.length / 2)] ?? 2;

      const scored = pool.map((u) => {
        const splashCount = pool.filter((e) => Math.abs(e.col - u.col) <= 1).length;
        const distToClusterCenter = Math.abs(u.col - medianCol);
        const distToBoardCenter = Math.abs(u.col - 2);
        const hp = u.hp.max || u.hp.cur || 0;
        return { unit: u, splashCount, distToClusterCenter, distToBoardCenter, hp };
      });

      scored.sort((a, b) => {
        // 1. Quét trúng nhiều quái nhất
        if (b.splashCount !== a.splashCount) return b.splashCount - a.splashCount;
        // 2. Gần trung vị cụm quái nhất (vị trí ở giữa nhóm quái)
        if (a.distToClusterCenter !== b.distToClusterCenter) return a.distToClusterCenter - b.distToClusterCenter;
        // 3. Gần tâm bàn cờ (cột 2)
        if (a.distToBoardCenter !== b.distToBoardCenter) return a.distToBoardCenter - b.distToBoardCenter;
        // 4. Máu cao nhất
        return b.hp - a.hp;
      });

      const chosen = scored[0]!.unit;
      return { row: chosen.row, col: chosen.col, label: `${chosen.name} (F1)` };
    }

    return { row: 0, col: 2, label: "Quái (0, 2)" };
  }

  private battleTurn() {
    this.battleTurnIndex++;
    this.battleConfig = { ...this.battleConfig, currentTurn: this.battleTurnIndex };
    this.io.patchState({ battleConfig: this.battleConfig });

    if (!this.battleConfig.autoFight) return;

    const maxTurns = 21;
    // Tính turn hiệu lực: loop 21 turn (sau turn 21 tự động lặp lại từ turn 1)
    const effectiveTurn = ((this.battleTurnIndex - 1) % maxTurns) + 1;
    const isTurnsMode = this.battleConfig.strategyMode === "turns"
      || (this.battleConfig.strategyMode === undefined && (this.battleConfig.turns?.length ?? 0) > 0);
    const turnCfg = isTurnsMode ? this.battleConfig.turns?.find((t) => Number(t.turn) === effectiveTurn) : undefined;

    // Tìm chính xác Nhân vật và Võ tướng trên lưới trận theo cờ isPet / toạ độ
    const self = this.selfHex;
    const snap = this.party.snapshot(self);
    const allyPlayers = this.battleUnits.filter((u) => !u.isEnemy && u.isPet === false);
    const inTeamBattle = snap.joined || allyPlayers.length > 1;

    // 1. Tìm chính xác Nhân vật CỦA MÌNH:
    // Ưu tiên 1: uid khớp với selfHex
    // Ưu tiên 2: tên khớp với this.player.name
    // Ưu tiên 3: nếu KHÔNG ở trong trận đội, fallback về nhân vật duy nhất hoặc hàng 3.
    // TUYỆT ĐỐI KHÔNG fallback lấy đơn vị người khác nếu đang ở trong trận đội!
    let charUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === false && !!self && u.owner === self)
      ?? this.battleUnits.find((u) => !u.isEnemy && u.isPet === false && !!this.player.name && u.name === this.player.name);

    if (!charUnit && !inTeamBattle) {
      charUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === false)
        ?? this.battleUnits.find((u) => !u.isEnemy && u.row === 3);
    }

    const pRow = charUnit?.row ?? 3;
    const pCol = charUnit?.col ?? 2;

    const isMemberInParty = (charUnit && charUnit.col !== 2)
      || (snap.joined && snap.leaderName && normName(snap.leaderName) !== normName(this.player.name))
      || (this.partyTargetConfig.role === "member" && inTeamBattle);

    // 2. Tìm chính xác Võ tướng (Pet) CỦA MÌNH:
    // Với thành viên trong đội (isMemberInParty): Võ tướng BẮT BUỘC nằm ở Hàng 2 và CÙNG CỘT với Master (col = pCol).
    // Nếu không có võ tướng tại ô (2, pCol) hoặc võ tướng đã gục ngã (hp <= 0) ⇒ TUYỆT ĐỐI KHÔNG gửi bất kỳ lệnh nào cho võ tướng
    // (trước đây gửi nhầm cho (2, 2) của chủ PT ⇒ server kick mã 42 ngay sau lượt đầu).
    // Với chủ PT hoặc chơi đơn: cho phép điều khiển võ tướng tại ô (2, 2) nếu có võ tướng xuất chiến (activePet).
    let petUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === true && u.row === 2 && u.col === pCol && !(u.hp.max > 0 && u.hp.cur === 0));
    if (!petUnit && !isMemberInParty && this.activePet()) {
      petUnit = this.battleUnits.find((u) => !u.isEnemy && u.isPet === true && u.row === 2 && u.col === 2)
        ?? this.battleUnits.find((u) => !u.isEnemy && u.isPet === true);
    }
    const hasPet = petUnit ? !(petUnit.hp.max > 0 && petUnit.hp.cur === 0) : (!isMemberInParty && !!this.activePet());
    const petRow = 2;
    const petCol = pCol;

    const isCharAlive = charUnit ? !(charUnit.hp.max > 0 && charUnit.hp.cur === 0) : !(this.player.hp.max > 0 && this.player.hp.cur === 0);

    // Nếu cả nhân vật và võ tướng đều đã gục ngã (HP = 0), tuyệt đối không gửi lệnh lên server tránh bị kick mã 42
    if (!isCharAlive && !hasPet) {
      this.io.log("info", `[Chiến đấu] Cả ${this.player.name || "Nhân vật"} và võ tướng đều đã gục ngã (HP = 0) — bỏ qua lượt đánh.`);
      return;
    }

    this.flushPendingStrikes();

    // ------------------------------------------------------------------------
    // THỨ TỰ ƯU TIÊN CHIẾN THUẬT (PRIORITY RULES):
    // Bậc 1 (Priority 1): Cấu hình Tự Động Bỏ Chạy (autoEscape) khi vào trận.
    // Bậc 2 (Priority 2): Tự động bỏ chạy khi chưa đủ đội ngũ (escapeIfNotFullParty).
    // ------------------------------------------------------------------------
    if (this.battleConfig.autoEscape) {
      this.io.game(`🏃 [${this.player.name || "Nhân vật"}] & [${petUnit?.name || this.pet?.name || "Võ tướng"}] tự động bỏ chạy khỏi trận (Ưu tiên Bậc 1)!`);
      if (isCharAlive) {
        const pEscapeBuf = this.encodeBattleActionFrame(pRow, pCol, pRow, pCol, 18001);
        this.io.send(pEscapeBuf);
      }
      if (hasPet) {
        const petEscapeBuf = this.encodeBattleActionFrame(petRow, petCol, petRow, petCol, 18001);
        this.io.send(petEscapeBuf);
      }
      return;
    }

    // Bậc 2 (Priority 2): Tự động bỏ chạy khi chưa đủ thành viên tổ đội.
    if (this.partyTargetConfig.escapeIfNotFullParty) {
      const snap = this.party.snapshot(this.selfHex);
      let incompleteReason: string | undefined;

      if (this.partyTargetConfig.role === "leader") {
        // Nếu là chủ pt: danh sách tổ đội còn thành viên chưa gia nhập mà team or cá nhân vào trận => chạy cả char và pet
        const expectedMembers = this.partyTargetConfig.members.filter(Boolean);
        if (expectedMembers.length > 0) {
          const joinedNames = new Set(snap.members.filter((m) => m.name).map((m) => normName(m.name)));
          const missing = expectedMembers.filter((name) => !joinedNames.has(normName(name)));
          if (missing.length > 0) {
            incompleteReason = `Tổ đội chưa đủ thành viên (thiếu: ${missing.join(", ")})`;
          }
        }
      } else {
        // Nếu là thành viên: chưa được join vào team mà vào trận => chạy cả char và pet
        const targetLeader = this.partyTargetConfig.leaderName;
        if (targetLeader) {
          const isJoinedLeaderTeam = snap.joined && snap.leaderName && normName(snap.leaderName) === normName(targetLeader);
          if (!isJoinedLeaderTeam) {
            incompleteReason = `Chưa gia nhập vào đội ngũ của [${targetLeader}]`;
          }
        }
      }

      if (incompleteReason) {
        this.io.game(`🏃 [${this.player.name || "Nhân vật"}] & [${petUnit?.name || this.pet?.name || "Võ tướng"}] tự động bỏ chạy khỏi trận (Ưu tiên Bậc 2: ${incompleteReason})!`);
        if (isCharAlive) {
          const pEscapeBuf = this.encodeBattleActionFrame(pRow, pCol, pRow, pCol, 18001);
          this.io.send(pEscapeBuf);
        }
        if (hasPet) {
          const petEscapeBuf = this.encodeBattleActionFrame(petRow, petCol, petRow, petCol, 18001);
          this.io.send(petEscapeBuf);
        }
        return;
      }
    }

    // 1. Lệnh của Nhân vật (chỉ gửi khi nhân vật còn sống)
    const pAct = turnCfg?.playerAction ?? this.battleConfig.playerAction;
    if (isCharAlive) {
      if (pAct.type === "summon" && pAct.petModel) {
        const petModel = Number(pAct.petModel);
        const rec = this.roster.find((r) => r.model === petModel);
        const petName = pAct.petName || (rec ? this.petUnit(rec).name : (npcNames as Record<string, string>)[String(petModel)] ?? `Model ${petModel}`);
        this.io.game(`🐕 [${this.player.name || "Nhân vật"}] xuất chiến võ tướng [${petName}] (Hiệp ${effectiveTurn})!`);
        // Gói tin xuất chiến võ tướng 13/01 `00 <model u16 LE>`
        this.io.send(encodeFrame(cmdBody(0x13, 0x01, [0x00, petModel & 0xff, petModel >> 8])));
      } else if (pAct.type === "item" || pAct.skillId === 19001) {
        let slot = pAct.itemSlot;
        if (!slot && pAct.itemId) {
          for (const [s, item] of this.bag.entries()) {
            if (item.id === Number(pAct.itemId)) {
              slot = s;
              break;
            }
          }
        }
        const itemSlot = slot ?? 1;
        const targetPref = pAct.target || "F1";
        const target = this.resolveTarget(targetPref, true);
        const itemName = pAct.itemName || (pAct.itemId ? `Item #${pAct.itemId}` : `Ô túi #${itemSlot}`);
        this.io.game(`🧪 [${this.player.name || "Nhân vật"}] dùng [${itemName}] lên [${target.label}] (Hiệp ${effectiveTurn})!`);
        const pBuf = this.encodeBattleActionFrame(pRow, pCol, target.row, target.col, 19001, itemSlot);
        this.io.send(pBuf);
      } else {
        let pSkillId = Number(pAct.skillId) || 10000;
        const pSkillDef = (skillDataRaw as Record<string, any>)[String(pSkillId)];
        const reqPSp = pSkillDef?.sp ?? 0;
        const curPSp = charUnit?.sp.cur ?? this.player.sp.cur;
        const maxPSp = charUnit?.sp.max || this.player.sp.max;
        if (maxPSp > 0 && pSkillId !== 10000 && pSkillId !== 17001 && pSkillId !== 18001 && reqPSp > 0 && curPSp < reqPSp) {
          this.io.game(`⚠️ [${this.player.name || "Nhân vật"}] không đủ SP (${curPSp}/${reqPSp}), chuyển sang [Đấu Vật]`);
          pSkillId = 10000;
        }

        const pTargetPref = pAct.target || "F1";
        const pIsSupp = this.isSupportSkill(pSkillId, pTargetPref);
        const pTarget = (pSkillId === 17001 || pSkillId === 18001)
          ? { row: pRow, col: pCol, label: pSkillId === 18001 ? "Bỏ chạy" : "Bản thân" }
          : this.resolveTarget(pTargetPref, pIsSupp);

        const pBuf = this.encodeBattleActionFrame(pRow, pCol, pTarget.row, pTarget.col, pSkillId);
        this.io.send(pBuf);
      }
    } else {
      this.io.log("info", `[Chiến đấu] ${this.player.name || "Nhân vật"} đã gục ngã (HP = 0) — bỏ qua lượt đánh của nhân vật.`);
    }

    // 2. Lệnh của Võ tướng (Pet)
    if (hasPet) {
      const petAct = turnCfg?.petAction ?? this.battleConfig.petAction;
      if (petAct.type === "item" || petAct.skillId === 19001) {
        let slot = petAct.itemSlot;
        if (!slot && petAct.itemId) {
          for (const [s, item] of this.bag.entries()) {
            if (item.id === Number(petAct.itemId)) {
              slot = s;
              break;
            }
          }
        }
        const itemSlot = slot ?? 1;
        const petTargetPref = petAct.target || "F1";
        const petTarget = this.resolveTarget(petTargetPref, true);
        const itemName = petAct.itemName || (petAct.itemId ? `Item #${petAct.itemId}` : `Ô túi #${itemSlot}`);
        this.io.game(`🧪 [${this.pet.name || "Võ tướng"}] dùng [${itemName}] lên [${petTarget.label}] (Hiệp ${effectiveTurn})!`);
        const petBuf = this.encodeBattleActionFrame(petRow, petCol, petTarget.row, petTarget.col, 19001, itemSlot);
        this.io.send(petBuf);
      } else {
        let petSkillId = Number(petAct.skillId) || 10000;
        if (petSkillId !== 10000 && petSkillId !== 17001 && petSkillId !== 18001) {
          const matchingPetSk = this.petSkills.find((s) => s.id === petSkillId);
          if (this.petSkills.length > 0 && !matchingPetSk) {
            const skName = (skillDataRaw as Record<string, any>)[String(petSkillId)]?.name ?? petSkillId;
            this.io.game(`⚠️ [${this.pet.name || "Võ tướng"}] không có kỹ năng [${skName}], chuyển sang [Đấu Vật]`);
            petSkillId = 10000;
          } else if (matchingPetSk && matchingPetSk.enabled === false) {
            this.io.game(`⚠️ [${this.pet.name || "Võ tướng"}] chưa thể dùng [${matchingPetSk.name}] (${matchingPetSk.disabledReason ?? "chưa mở"}), chuyển sang [Đấu Vật]`);
            petSkillId = 10000;
          }
        }

        const petSkillDef = (skillDataRaw as Record<string, any>)[String(petSkillId)];
        const reqSp = petSkillDef?.sp ?? 0;
        const curPetSp = petUnit?.sp.cur ?? this.pet.sp.cur;
        const maxPetSp = petUnit?.sp.max || this.pet.sp.max;
        if (maxPetSp > 0 && petSkillId !== 10000 && petSkillId !== 17001 && petSkillId !== 18001 && reqSp > 0 && curPetSp < reqSp) {
          this.io.game(`⚠️ [${this.pet.name || "Võ tướng"}] không đủ SP (${curPetSp}/${reqSp}), chuyển sang [Đấu Vật]`);
          petSkillId = 10000;
        }

        const petTargetPref = petAct.target || "F1";
        const petIsSupp = this.isSupportSkill(petSkillId, petTargetPref);
        const petTarget = (petSkillId === 17001 || petSkillId === 18001)
          ? { row: petRow, col: petCol, label: petSkillId === 18001 ? "Bỏ chạy" : "Bản thân" }
          : this.resolveTarget(petTargetPref, petIsSupp);

        const petBuf = this.encodeBattleActionFrame(petRow, petCol, petTarget.row, petTarget.col, petSkillId);
        this.io.send(petBuf);
      }
    }

    const pType = pAct.type;
    const pDesc = !isCharAlive
      ? "Gục ngã"
      : pType === "summon"
      ? `Xuất chiến [${pAct.petName || pAct.petModel}]`
      : pType === "item"
      ? `Dùng [${pAct.itemName || pAct.itemId}]`
      : (skillDataRaw as Record<string, any>)[String(pAct.skillId)]?.name ?? (pAct.skillId === 10000 ? "Đấu Vật" : (pAct.skillId === 17001 ? "Phòng Ngự" : pAct.skillId));

    const petAct = turnCfg?.petAction ?? this.battleConfig.petAction;
    const petDesc = petAct.type === "item"
      ? `Dùng [${petAct.itemName || petAct.itemId}]`
      : (skillDataRaw as Record<string, any>)[String(petAct.skillId)]?.name ?? (petAct.skillId === 10000 ? "Đấu Vật" : (petAct.skillId === 17001 ? "Phòng Ngự" : petAct.skillId));

    const turnTag = isTurnsMode ? `[Hiệp ${effectiveTurn}/21]` : "[Mặc định]";
    const petInfo = (petUnit && petUnit.hp.cur > 0) ? `, ${petUnit.name || this.pet.name || "Võ tướng"} [${petDesc}]` : "";
    this.io.log("debug", `⚔️ ${turnTag} Lệnh: ${this.player.name || "Nhân vật"} [${pDesc}]${petInfo}`);
  }

  private pendingStrikes: {
    actorName: string;
    actorRow: number;
    actorCol: number;
    skillName: string;
    targetName: string;
    targetRow: number;
    targetCol: number;
    damage: number;
    isMiss: boolean;
    curHp: number;
    maxHp: number;
    isAlly: boolean;
    isDead: boolean;
  }[] = [];
  private comboTimer?: NodeJS.Timeout;

  private queueAllyStrike(strike: (typeof this.pendingStrikes)[0]) {
    this.pendingStrikes.push(strike);
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => {
      this.flushPendingStrikes();
    }, 80);
  }

  private flushPendingStrikes() {
    if (this.comboTimer) {
      clearTimeout(this.comboTimer);
      this.comboTimer = undefined;
    }
    if (this.pendingStrikes.length === 0) return;
    const strikes = [...this.pendingStrikes];
    this.pendingStrikes = [];

    // Tìm mục tiêu chính (mục tiêu có nhiều đồng đội khác nhau cùng tấn công nhất)
    const targetActorMap = new Map<string, Set<string>>();
    for (const s of strikes) {
      const tKey = `${s.targetRow},${s.targetCol}`;
      if (!targetActorMap.has(tKey)) targetActorMap.set(tKey, new Set());
      targetActorMap.get(tKey)!.add(`${s.actorRow},${s.actorCol}`);
    }

    let mainTargetKey = "";
    let maxActors = 0;
    for (const [tKey, actors] of targetActorMap.entries()) {
      if (actors.size > maxActors) {
        maxActors = actors.size;
        mainTargetKey = tKey;
      }
    }

    if (maxActors >= 2 && mainTargetKey) {
      // Có từ 2 thành viên khác nhau trở lên cùng đánh vào mainTargetKey => Combo!
      const mainStrikes = strikes.filter((s) => `${s.targetRow},${s.targetCol}` === mainTargetKey);
      const splashStrikes = strikes.filter((s) => `${s.targetRow},${s.targetCol}` !== mainTargetKey);

      // Lọc các đòn đánh theo từng actor duy nhất (nếu 1 actor đánh nhiều hit vào cùng 1 target thì gộp dmg)
      const actorOrder: string[] = [];
      const actorStrikeMap = new Map<string, typeof strikes[0]>();
      for (const s of mainStrikes) {
        const aKey = `${s.actorRow},${s.actorCol}`;
        if (!actorStrikeMap.has(aKey)) {
          actorOrder.push(aKey);
          actorStrikeMap.set(aKey, { ...s });
        } else {
          const exist = actorStrikeMap.get(aKey)!;
          exist.damage += s.damage;
          exist.curHp = s.curHp;
          exist.isDead = s.isDead;
        }
      }

      const lines: string[] = [`⚡ Combo (${actorOrder.length}):`];
      for (let i = 0; i < actorOrder.length; i++) {
        const s = actorStrikeMap.get(actorOrder[i]!)!;
        if (s.isMiss) {
          lines.push(`---- ${s.actorName} (${s.actorRow},${s.actorCol}) dùng [${s.skillName}]: Miss`);
        } else if (i === actorOrder.length - 1) {
          lines.push(`---- ${s.actorName} (${s.actorRow},${s.actorCol}) dùng [${s.skillName}] - ${s.damage} HP, ${s.targetName} (${s.targetRow},${s.targetCol}) còn lại ${s.curHp}/${s.maxHp} HP${s.isDead ? " (Gục ngã)" : ""}.`);
        } else {
          lines.push(`---- ${s.actorName} (${s.actorRow},${s.actorCol}) dùng [${s.skillName}] - ${s.damage} HP`);
        }
      }
      this.io.game(lines.join("\n"));

      // In các đòn sát thương lan (splash) sang các mục tiêu khác nếu có
      for (const s of splashStrikes) {
        this.emitStrikeLog(s);
      }
    } else {
      // Đòn đơn lẻ hoặc kỹ năng AOE của 1 nhân vật
      for (const s of strikes) {
        this.emitStrikeLog(s);
      }
    }
  }

  private emitStrikeLog(s: (typeof this.pendingStrikes)[0]) {
    if (s.isMiss) {
      this.io.game(`---- ${s.actorName} (${s.actorRow},${s.actorCol}) dùng [${s.skillName}] → ${s.targetName} (${s.targetRow},${s.targetCol}): Miss`);
    } else {
      this.io.game(`---- ${s.actorName} (${s.actorRow},${s.actorCol}) dùng [${s.skillName}] - ${s.damage} HP, ${s.targetName} (${s.targetRow},${s.targetCol}) còn lại ${s.curHp}/${s.maxHp} HP${s.isDead ? " (Gục ngã)" : ""}.`);
    }
  }

  private battleEffect(f: Buffer) {
    if (f.length < 20) return;

    type StrikeBlock = {
      actorRow: number;
      actorCol: number;
      skillId: number;
      targetRow: number;
      targetCol: number;
      isHit: boolean;
      statType: number;
      damage: number;
    };

    const blocks: StrikeBlock[] = [];
    let off = 9;

    // Phân tích các sub-blocks trong gói 32/01.
    // Chuẩn TS Online: từ offset 9 là danh sách các action block.
    // Mỗi block bắt đầu bằng subLen (uint16LE).
    // - Đòn đơn / combo: subLen = 17 (header 6 bytes + 1 target 11 bytes).
    // - Đòn AOE quét nhiều mục tiêu (Loạn Kích, Cuồng Phong, Hỏa Lăng...): subLen = 6 + N * 11 (28 cho 2 target, 39 cho 3 target...).
    while (off + 2 <= f.length) {
      const subLen = f.readUInt16LE(off);
      if (subLen >= 16 && off + 2 + subLen <= f.length) {
        const bOff = off + 2;
        const actorRow = f[bOff]!;
        const actorCol = f[bOff + 1]!;
        const skillId = f.readUInt16LE(bOff + 2);

        // Số lượng mục tiêu trong sub-block (mỗi target chiếm 11 bytes tính từ bOff + 6)
        const targetCountFromLen = Math.max(1, Math.floor((subLen - 6) / 11));
        const declaredTargetCount = f[bOff + 4] ? Math.max(1, f[bOff + 4]!) : 1;
        const numTargets = Math.max(targetCountFromLen, declaredTargetCount);

        for (let t = 0; t < numTargets; t++) {
          const tOff = bOff + 6 + t * 11;
          if (tOff + 8 <= bOff + subLen && tOff + 8 <= f.length) {
            const targetRow = f[tOff]!;
            const targetCol = f[tOff + 1]!;
            const isHit = f[tOff + 2] !== 0;
            const statType = tOff + 5 < f.length ? f[tOff + 5]! : 0x19;
            const damage = tOff + 10 <= f.length ? f.readUInt32LE(tOff + 6) : 0;

            blocks.push({
              actorRow,
              actorCol,
              skillId,
              targetRow,
              targetCol,
              isHit,
              statType,
              damage,
            });
          }
        }
        off += 2 + subLen;
      } else {
        break;
      }
    }

    // Fallback: nếu gói tin không có subLen chuẩn ở offset 9 (ví dụ test payload cũ giả lập 20 byte)
    if (blocks.length === 0 && f.length >= 20) {
      blocks.push({
        actorRow: f[11]!,
        actorCol: f[12]!,
        skillId: f.readUInt16LE(13),
        targetRow: f[17]!,
        targetCol: f[18]!,
        isHit: f[19] !== 0,
        statType: f.length >= 23 ? f[22]! : 0x19,
        damage: f.length >= 27 ? f.readUInt32LE(23) : 0,
      });
    }

    let stateChanged = false;

    for (const b of blocks) {
      const { actorRow, actorCol, skillId, targetRow, targetCol, isHit, statType, damage } = b;
      const isMiss = !isHit || statType === 0 || damage === 0;

      const isAlly = actorRow >= 2;
      const actorUnit = this.battleUnits.find((u) => u.row === actorRow && u.col === actorCol);
      let actorName = actorUnit?.name;
      if (!actorName) {
        if (actorRow === 2 && actorCol === 2) actorName = this.pet.name || "Võ tướng";
        else if (actorRow === 3 && actorCol === 2) actorName = this.player.name || "Nhân vật";
        else actorName = isAlly ? (actorRow === 2 ? "Võ tướng" : "Đồng đội") : "Quái";
      }

      const targetUnit = this.battleUnits.find((u) => u.row === targetRow && u.col === targetCol);
      let targetName = targetUnit?.name;
      if (!targetName) {
        if (targetRow === 2 && targetCol === 2) targetName = this.pet.name || "Võ tướng";
        else if (targetRow === 3 && targetCol === 2) targetName = this.player.name || "Nhân vật";
        else targetName = targetRow >= 2 ? (targetRow === 2 ? "Võ tướng" : "Đồng đội") : "Mục tiêu";
      }

      const sDef = (skillDataRaw as Record<string, any>)[String(skillId)];
      const skillName = sDef?.name ?? (skillId === 10000 ? "Đấu Vật" : `Kỹ năng ${skillId}`);

      let curHp = targetUnit ? targetUnit.hp.cur : 0;
      let maxHp = targetUnit ? targetUnit.hp.max : 0;
      if (!isMiss && statType === 0x19 && damage > 0 && targetUnit) {
        targetUnit.hp.cur = Math.max(0, targetUnit.hp.cur - damage);
        curHp = targetUnit.hp.cur;
        const mine = !targetUnit.isEnemy && (!targetUnit.owner || /^0+$/.test(targetUnit.owner) || targetUnit.owner === this.selfHex); // đồng đội/võ tướng người khác KHÔNG đổi HP của mình
        if (mine && (targetUnit.isPet || (targetRow === 2 && targetCol === 2))) {
          this.pet.hp.cur = curHp;
          const act = this.activePet();
          if (act) act.hp = curHp;
        } else if (mine && (!targetUnit.isPet || (targetRow === 3 && targetCol === 2))) {
          this.player.hp.cur = curHp;
        }
        stateChanged = true;
      }

      const strike = {
        actorName,
        actorRow,
        actorCol,
        skillName,
        targetName,
        targetRow,
        targetCol,
        damage,
        isMiss,
        curHp,
        maxHp,
        isAlly,
        isDead: curHp === 0 && !isMiss && damage > 0,
      };

      if (isAlly) {
        this.queueAllyStrike(strike);
      } else {
        this.flushPendingStrikes();
        this.emitStrikeLog(strike);
      }
    }

    if (stateChanged) {
      this.io.patchState({
        battleUnits: [...this.battleUnits],
        player: this.player,
        pet: this.pet,
      });
    }
  }

  private battleEnd() {
    this.flushPendingStrikes();
    if (this.inBattle) {
      this.inBattle = false;
      this.battleUnits = [];
      this.battleTurnIndex = 0;
      this.battleConfig = { ...this.battleConfig, currentTurn: 0 };
      const act = this.activePet();
      this.io.patchState({
        inBattle: false,
        battleUnits: [],
        battleConfig: this.battleConfig,
        player: { ...this.player },
        pet: { ...this.pet },
        pets: this.roster.map((r) => ({ ...this.petUnit(r), idx: r.idx, model: r.model, active: r === act, stats: r.stats, gear: r.gear })),
      });
      this.io.game("🎉 Trận đấu kết thúc!");
      // Phó bản: hết trận còn thoại kết thúc/kết quả cần đáp 14/06 (vd sau trận Trương Giác) — giữ cửa sổ đáp thêm 60s nếu vừa ở trong cửa sổ.
      if (Date.now() <= this.dialogAckUntil + 60_000) this.openDialogWindow(60_000);
      setTimeout(() => {
        this.triggerAutoSweep();
        this.triggerAutoHeal();
        this.scheduleChaseCheck(700);
        if (this.autoMove.enabled && this.location.map === this.autoMove.mapId) {
          this.scheduleAutoMove(1000);
        }
      }, 500);
    }
  }

  public updateAutoMove(cfg: Partial<AutoMoveState>) {
    const prevEnabled = this.autoMove.enabled;
    this.autoMove = {
      ...this.autoMove,
      ...cfg,
    };
    this.io.patchState({ autoMove: { ...this.autoMove } });
    if (this.autoMove.enabled) {
      this.io.game(`🚶 [Tự Động Di Chuyển] Kích hoạt tự động di chuyển tại Map ${this.autoMove.mapId} (${this.autoMove.originX}, ${this.autoMove.originY}) • Bán kính ${this.autoMove.maxRadius || 150}px (bước 30px).`);
      this.scheduleAutoMove(200);
    } else if (prevEnabled && !this.autoMove.enabled) {
      this.io.game("🛑 [Tự Động Di Chuyển] Đã dừng tự động di chuyển.");
      if (this.autoMoveTimer) {
        clearTimeout(this.autoMoveTimer);
        this.autoMoveTimer = undefined;
      }
    }
  }

  private scheduleAutoMove(delayMs = 1500) {
    if (!this.autoMove.enabled || this.inBattle) return;
    if (this.isMemberInParty()) return;
    if (this.autoMoveTimer) clearTimeout(this.autoMoveTimer);
    this.autoMoveTimer = setTimeout(() => {
      this.autoMoveTimer = undefined;
      void this.checkAndAutoMove();
    }, delayMs);
  }

  private async checkAndAutoMove(): Promise<void> {
    if (!this.autoMove.enabled) return;
    if (this.inBattle) return;
    if (this.autoMoveRunning) return;
    if (this.location.map !== this.autoMove.mapId) return;
    if (this.isMemberInParty()) return;

    this.autoMoveRunning = true;
    try {
      const { originX, originY, maxRadius } = this.autoMove;
      const curX = this.location.x;
      const curY = this.location.y;
      const STEP_SIZE = 30; // 30px theo yêu cầu người dùng
      const MAX_DIST = maxRadius || 150; // không vượt quá 150px xung quanh điểm ban đầu

      const currentDistFromOrigin = Math.hypot(curX - originX, curY - originY);
      let nextX = curX;
      let nextY = curY;

      // 8 hướng di chuyển: 0, 45, 90, 135, 180, 225, 270, 315 độ
      const angles = [
        0,
        Math.PI / 4,
        Math.PI / 2,
        (3 * Math.PI) / 4,
        Math.PI,
        (5 * Math.PI) / 4,
        (3 * Math.PI) / 2,
        (7 * Math.PI) / 4,
      ];
      const candidates: { x: number; y: number }[] = [];

      for (const angle of angles) {
        const candX = Math.round(curX + Math.cos(angle) * STEP_SIZE);
        const candY = Math.round(curY + Math.sin(angle) * STEP_SIZE);
        const dist = Math.hypot(candX - originX, candY - originY);
        // Không vượt quá 150px xung quanh điểm ban đầu bật tự động di chuyển
        if (dist <= MAX_DIST) {
          candidates.push({ x: candX, y: candY });
        }
      }

      if (candidates.length > 0) {
        // Chọn ngẫu nhiên một hướng trong các hướng hợp lệ
        const chosen = candidates[Math.floor(Math.random() * candidates.length)]!;
        nextX = chosen.x;
        nextY = chosen.y;
      } else {
        // Nếu không có hướng nào (ở biên hoặc lệch ngoài bán kính), bước 30px quay về phía tâm ban đầu
        const dx = originX - curX;
        const dy = originY - curY;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          const step = Math.min(STEP_SIZE, d);
          nextX = Math.round(curX + (dx / d) * step);
          nextY = Math.round(curY + (dy / d) * step);
        }
      }

      if (nextX !== curX || nextY !== curY) {
        const dir = this.getMoveDir(nextX - curX, nextY - curY);
        this.io.send(encodeFrame(cmdBody(0x06, 0x01, [
          0x00,
          dir & 0xff,
          nextX & 0xff,
          (nextX >> 8) & 0xff,
          nextY & 0xff,
          (nextY >> 8) & 0xff,
        ])));
        this.location = { ...this.location, x: nextX, y: nextY };
        this.io.patchState({ location: this.location });
      }
    } catch (err: any) {
      if (err.message !== "Thao tác bị hủy") {
        this.io.log("warn", `[Tự Động Di Chuyển] Lỗi: ${err?.message || err}`);
      }
    } finally {
      this.autoMoveRunning = false;
      if (this.autoMove.enabled && !this.inBattle) {
        this.scheduleAutoMove(1800);
      }
    }
  }

  public updateChaseConfig(cfg: Partial<ChaseConfig>) {
    const prevEnabled = this.chaseConfig.enabled;
    this.chaseConfig = {
      ...this.chaseConfig,
      ...cfg,
    };
    this.io.patchState({ chaseConfig: { ...this.chaseConfig } });
    if (this.chaseConfig.enabled) {
      this.chaseIdleCycles = 0;
      this.io.game(`🎯 [Truy Kích] Kích hoạt truy kích quái${this.chaseConfig.npcName ? ` [${this.chaseConfig.npcName}]` : ""} tại Map ${this.chaseConfig.mapId} (${this.chaseConfig.originX}, ${this.chaseConfig.originY}), bán kính: ${this.chaseConfig.maxRadius}px${this.chaseConfig.autoReturn ? ", tự động quay về sau trận" : ""}.`);
      this.scheduleChaseCheck(100);
    } else if (prevEnabled && !this.chaseConfig.enabled) {
      this.io.game("🛑 [Truy Kích] Đã dừng chế độ truy kích quái.");
      if (this.chaseCheckTimer) {
        clearTimeout(this.chaseCheckTimer);
        this.chaseCheckTimer = undefined;
      }
    }
  }

  private parseNpcList(f: Buffer) {
    const count = f.readUInt16LE(9);
    let off = 11;
    const now = Date.now();
    for (let i = 0; i < count && off + 13 <= f.length; i++, off += 13) {
      const index = f.readUInt16LE(off);
      const npcId = f.readUInt16LE(off + 2);
      const x = f.readUInt16LE(off + 4);
      const y = f.readUInt16LE(off + 6);
      const statusByte = f[off + 8]!;
      const busy = statusByte === 0x02;
      this.mapNpcs.set(index, { index, npcId, x, y, busy, lastSeen: now });
    }
    if (this.chaseConfig.enabled && this.location.map === this.chaseConfig.mapId) {
      this.scheduleChaseCheck(300);
    }
  }

  private parseNpcMove(f: Buffer) {
    const index = f.readUInt16LE(9);
    const x = f.readUInt16LE(11);
    const y = f.readUInt16LE(13);
    if (this.watchNpc === index) this.io.log("info", `[click_boss] server báo NPC ${index} di chuyển tới (${x},${y})`);
    const existing = this.mapNpcs.get(index);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.lastSeen = Date.now();
    } else {
      this.mapNpcs.set(index, { index, x, y, busy: false, lastSeen: Date.now() });
    }
    if (this.chaseConfig.enabled && !this.inBattle && this.location.map === this.chaseConfig.mapId) {
      if (this.isMemberInParty()) return;
      const distFromOrigin = Math.hypot(x - this.chaseConfig.originX, y - this.chaseConfig.originY);
      if (distFromOrigin <= this.chaseConfig.maxRadius) {
        this.scheduleChaseCheck(150);
      }
    }
  }

  private parseNpcStatus(f: Buffer) {
    const index = f.readUInt16LE(9);
    const status = f[11]!;
    const busy = status === 0x02;
    const existing = this.mapNpcs.get(index);
    if (existing) {
      existing.busy = busy;
      existing.lastSeen = Date.now();
    }
    if (!busy && this.chaseConfig.enabled && !this.inBattle && this.location.map === this.chaseConfig.mapId) {
      if (this.isMemberInParty()) return;
      if (existing) {
        const distFromOrigin = Math.hypot(existing.x - this.chaseConfig.originX, existing.y - this.chaseConfig.originY);
        if (distFromOrigin <= this.chaseConfig.maxRadius) {
          this.scheduleChaseCheck(200);
        }
      } else {
        this.scheduleChaseCheck(300);
      }
    }
  }

  private scheduleChaseCheck(delayMs = 300) {
    if (!this.chaseConfig.enabled || this.inBattle) return;
    if (this.isMemberInParty()) return;
    if (this.chaseCheckTimer) clearTimeout(this.chaseCheckTimer);
    this.chaseCheckTimer = setTimeout(() => {
      this.chaseCheckTimer = undefined;
      void this.checkAndChase();
    }, delayMs);
  }

  private async checkAndChase(): Promise<void> {
    if (!this.chaseConfig.enabled) return;
    if (this.inBattle) return;
    if (this.chaseRunning) return;
    if (this.location.map !== this.chaseConfig.mapId) return;
    if (this.isMemberInParty()) return;

    this.chaseRunning = true;
    try {
      const { originX, originY, maxRadius, autoReturn, npcId } = this.chaseConfig;
      const curX = this.location.x;
      const curY = this.location.y;

      // 1. Quét danh sách NPC hiện có trong mapNpcs
      let bestNpc: { index: number; x: number; y: number } | null = null;
      let minOriginDist = Infinity;

      for (const npc of this.mapNpcs.values()) {
        if (npc.busy) continue; // đang trong trận
        if (npcId && npc.npcId && npc.npcId !== npcId) continue; // lọc đúng loại quái nếu có
        // BẮT BUỘC: Khoảng cách từ NPC đến TỌA ĐỘ GỐC (origin) phải <= maxRadius
        const distFromOrigin = Math.hypot(npc.x - originX, npc.y - originY);
        if (distFromOrigin <= maxRadius) {
          // Ưu tiên NPC gần tọa độ gốc (origin)
          if (distFromOrigin < minOriginDist) {
            minOriginDist = distFromOrigin;
            bestNpc = npc;
          }
        }
      }

      // 2. Nếu tìm thấy NPC thỏa mãn trong bán kính an toàn
      if (bestNpc) {
        this.chaseIdleCycles = 0;
        const distToNpc = Math.hypot(bestNpc.x - curX, bestNpc.y - curY);
        if (distToNpc > 30) {
          this.io.log("info", `🎯 [Truy Kích] Tiếp cận quái #${bestNpc.index} tại (${bestNpc.x}, ${bestNpc.y}) cách tâm ${Math.round(minOriginDist)}px (khoảng cách: ${Math.round(distToNpc)}px)...`);
          await this.walkTowards(bestNpc.x, bestNpc.y, 35);
        } else {
          // Đã đứng sát NPC (<=30px) nhưng chưa vào trận: nhích nhẹ 1 bước 15px để máy chủ kiểm tra va chạm (0b/fa)
          const nudgeX = curX + (bestNpc.x >= curX ? 15 : -15);
          const nudgeY = curY + (bestNpc.y >= curY ? 15 : -15);
          await this.walkTowards(nudgeX, nudgeY, 5, 20, 200);
        }

        // Tương tác Double-click (14/01) vào quái để kích hoạt trận đấu tức thì
        if (!this.inBattle && this.chaseConfig.enabled) {
          const currentDist = Math.hypot(bestNpc.x - this.location.x, bestNpc.y - this.location.y);
          if (currentDist <= 65) {
            this.io.log("info", `👆 [Truy Kích] Double-click tương tác quái #${bestNpc.index} (cự ly ${Math.round(currentDist)}px)...`);
            // Click 1: Gửi 14/01 đối thoại/khiêu chiến NPC
            this.io.send(encodeFrame(cmdBody(0x14, 0x01, [0x00, bestNpc.index & 0xff, (bestNpc.index >> 8) & 0xff])));
            // Click 2: Nhấp đúp nhịp 2 sau 130ms nếu máy chủ chưa spawn trận
            await new Promise((r) => setTimeout(r, 130));
            if (!this.inBattle && this.chaseConfig.enabled) {
              this.io.send(encodeFrame(cmdBody(0x14, 0x01, [0x00, bestNpc.index & 0xff, (bestNpc.index >> 8) & 0xff])));
            }
          }
        }
        return;
      }

      // 3. Nếu không có NPC nào trong bán kính maxRadius
      // Kiểm tra xem nhân vật có bị lệch xa tọa độ gốc (originX, originY) không
      const distToOrigin = Math.hypot(curX - originX, curY - originY);
      if (autoReturn && distToOrigin > 45) {
        this.chaseIdleCycles = 0;
        this.io.log("info", `↩️ [Truy Kích] Không có quái trong bán kính ${maxRadius}px. Tự động quay về tọa độ gốc (${originX}, ${originY}) [lệch ${Math.round(distToOrigin)}px]...`);
        await this.walkTowards(originX, originY, 30);
        return;
      }

      // 4. Cơ chế Tuần tra nhẹ (Patrol / Jiggle walk quanh tâm bãi train):
      // Khi nhân vật đã ở tại bãi train nhưng chưa có quái di chuyển hoặc quái đứng yên,
      // sau mỗi 2 chu kỳ (~3-4s), nhích 1 bước 35px quanh tâm để gửi 06/01 kích hoạt va chạm và gọi gói 16/02 từ server.
      this.chaseIdleCycles++;
      if (this.chaseIdleCycles >= 2) {
        this.chaseIdleCycles = 0;
        const patrolOffsets = [
          { dx: 35, dy: 0 },
          { dx: -35, dy: 0 },
          { dx: 0, dy: 35 },
          { dx: 0, dy: -35 },
        ];
        const pick = patrolOffsets[Math.floor(Math.random() * patrolOffsets.length)]!;
        const targetX = originX + pick.dx;
        const targetY = originY + pick.dy;
        this.io.log("debug", `🔍 [Truy Kích] Nhích bước tìm quái quanh tâm (${targetX}, ${targetY})...`);
        await this.walkTowards(targetX, targetY, 10, 40, 300);
      }
    } catch (err: any) {
      if (err.message !== "Thao tác bị hủy") {
        this.io.log("warn", `[Truy Kích] Lỗi: ${err?.message || err}`);
      }
    } finally {
      this.chaseRunning = false;
      // Nếu sau khi kiểm tra vẫn chưa vào trận và chế độ truy kích vẫn bật, đặt hẹn giờ chu kỳ tiếp theo
      if (this.chaseConfig.enabled && !this.inBattle) {
        this.scheduleChaseCheck(1800);
      }
    }
  }

  private async walkTowards(targetX: number, targetY: number, stopDist = 35, stepSize = 85, delayMs = 400): Promise<void> {
    if (this.isMemberInParty()) return;
    let curX = this.location.x;
    let curY = this.location.y;

    while (true) {
      if (!this.chaseConfig.enabled) break;
      if (this.inBattle) break;
      const dx = targetX - curX;
      const dy = targetY - curY;
      const d = Math.hypot(dx, dy);
      if (d <= stopDist) break;

      const step = Math.min(stepSize, d);
      const nextX = Math.round(curX + (dx / d) * step);
      const nextY = Math.round(curY + (dy / d) * step);
      const dir = this.getMoveDir(nextX - curX, nextY - curY);

      this.io.send(encodeFrame(cmdBody(0x06, 0x01, [
        0x00,
        dir & 0xff,
        nextX & 0xff,
        (nextX >> 8) & 0xff,
        nextY & 0xff,
        (nextY >> 8) & 0xff,
      ])));

      curX = nextX;
      curY = nextY;
      this.location = { ...this.location, x: curX, y: curY };
      this.io.patchState({ location: this.location });

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /** `packet <hex>`: hex là BODY đã giải mã (`00 00 cmd sub …`); codec tự đóng frame + mã hoá. */
  encodeRaw(bytes: Buffer): Buffer { return encodeFrame(bytes); }
}

export const tsOnlineCodec: ProtocolCodec = {
  name: "ts-online",
  description: "TS Online server mới: login user/pass trực tiếp, XOR 0xAD, đọc tên/map nhân vật",
  create: (io) => new TsOnlineSession(io),
};
