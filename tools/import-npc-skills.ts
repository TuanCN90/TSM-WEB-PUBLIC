import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Công cụ trích xuất toàn diện bộ kỹ năng võ tướng (Pet):
 * 1. 3 Kỹ năng gốc (Base Skills): Nằm tại offset 51, 53, 55 của NPC trong Npc_C.dat.
 * 2. 1 Kỹ năng học thêm / Mê (Awakened Skill): Nằm tại offset 57 trong Npc_C.dat (trực tiếp hoặc kế thừa từ bản RB/tinh thông của nhân vật).
 * 3. 1 Kỹ năng từ Vũ Khí Chuyên Dụng (VKCD): Nằm trong Item_C.dat (offset 87 gắn với NPC) và ExclusiveWeapon_C.dat.
 *
 * Xuất ra:
 * - petSkillProfiles.json: Bảng thông tin đầy đủ kỹ năng (gốc, mê, vkcd) cho từng NPC model.
 * - npcSkills.json: Danh sách kỹ năng tổng hợp để tương thích ngược.
 */

export interface PetVkcdInfo {
  itemId: number;
  itemName: string;
  skillId: number;
}

export interface PetSkillProfile {
  base: number[];
  awakened?: number;
  hasDirectAwakened?: boolean;
  vkcd?: PetVkcdInfo;
}

const npcFile = resolve("tool-reference/BOT TSM/Data/VN/Npc_C.dat");
const itemFile = resolve("tool-reference/BOT TSM/Data/VN/Item_C.dat");
const ewFile = existsSync(resolve("tool-reference/Pim-Bot/DataVTC/ExclusiveWeapon_C.dat"))
  ? resolve("tool-reference/Pim-Bot/DataVTC/ExclusiveWeapon_C.dat")
  : resolve("tool-reference/BOT TSM/Data/ExclusiveWeapon_C.dat");
const skillDataPath = resolve("packages/engine/src/data/skillData.json");

const skillData = JSON.parse(readFileSync(skillDataPath, "utf8")) as Record<string, any>;

// 1. Trích xuất kỹ năng VKCD từ ExclusiveWeapon_C.dat
const ewSkills: Record<number, { star: number; skId: number }> = {};
if (existsSync(ewFile)) {
  const ewBuf = readFileSync(ewFile);
  const ewCount = ewBuf.readUInt32LE(0);
  for (let i = 0; i < ewCount; i++) {
    const o = 4 + i * 29;
    if (o + 29 > ewBuf.length) break;
    const itemId = ewBuf.readUInt16LE(o);
    const star = ewBuf[o + 2] ?? 0;
    const skId = ewBuf.readUInt16LE(o + 3);
    if (skId > 0 && (!ewSkills[itemId] || star > ewSkills[itemId].star)) {
      ewSkills[itemId] = { star, skId };
    }
  }
}

// 2. Trích xuất quan hệ VKCD -> Pet từ Item_C.dat
const vkcdByPetId: Record<number, PetVkcdInfo> = {};
const vkcdByPetName: Record<string, PetVkcdInfo> = {};

if (existsSync(itemFile)) {
  const itemBuf = readFileSync(itemFile);
  let o = 4;
  for (let n = itemBuf.readUInt32LE(0); n > 0 && o + 2 <= itemBuf.length; n--) {
    const len = itemBuf.readUInt16LE(o);
    const end = o + 2 + len;
    const name = itemBuf.toString("utf16le", o + 2, end).trim();
    const id = itemBuf.readUInt16LE(end + 1);
    const descLen = itemBuf.readUInt16LE(end + 113);
    const desc = itemBuf.toString("utf16le", end + 113 + 2, end + 113 + 2 + descLen).trim();

    if (id >= 64500 && id < 65000 && ewSkills[id]) {
      const petId = itemBuf.readUInt16LE(end + 87);
      const info: PetVkcdInfo = { itemId: id, itemName: name, skillId: ewSkills[id]!.skId };
      if (petId > 0) vkcdByPetId[petId] = info;

      // Nhận diện theo mô tả "X Thần Khí" hoặc "Thần Khí của X"
      const m1 = desc.match(/^(.+?)\s+Thần\s+Khí/i);
      const m2 = desc.match(/Thần\s+Khí\s+(?:của\s+)?(.+?)(?:,|$)/i);
      const targetName = (m1 ? m1[1] : (m2 ? m2[1] : "")).trim().toLowerCase();
      if (targetName) {
        vkcdByPetName[targetName] = info;
      }
    }
    o = end + 113 + 2 + descLen;
  }
}

// 3. Trích xuất NPC từ Npc_C.dat
const npcBuf = readFileSync(npcFile);
const npcList: { id: number; name: string; baseSkills: number[]; awakenedSkill?: number }[] = [];
let o = 4;
for (let n = npcBuf.readUInt32LE(0); n > 0 && o + 2 <= npcBuf.length; n--) {
  const len = npcBuf.readUInt16LE(o);
  const name = npcBuf.toString("utf16le", o + 2, o + 2 + len).trim();
  const end = o + 2 + len;
  const id = npcBuf.readUInt16LE(end + 1);
  const tail = npcBuf.subarray(end, end + 81);

  const baseSkills: number[] = [];
  for (const off of [51, 53, 55]) {
    const sId = tail.readUInt16LE(off);
    if (sId >= 10000 && sId <= 35000 && skillData[String(sId)]) baseSkills.push(sId);
  }

  const s4 = tail.readUInt16LE(57);
  const awakenedSkill = (s4 >= 10000 && s4 <= 35000 && skillData[String(s4)]) ? s4 : undefined;

  npcList.push({ id, name, baseSkills, awakenedSkill });
  o = end + 81;
}

// Gom skill Mê (học thêm) theo tên nhân vật để các model cấp thấp/chưa RB cũng tra được
const awakenedByName: Record<string, number> = {};
for (const npc of npcList) {
  if (npc.awakenedSkill && npc.name) {
    const clean = npc.name.toLowerCase().trim();
    if (!awakenedByName[clean]) awakenedByName[clean] = npc.awakenedSkill;
  }
}

// 4. Xây dựng petSkillProfiles và npcSkills
const profiles: Record<string, PetSkillProfile> = {};
const npcSkills: Record<string, number[]> = {};

for (const npc of npcList) {
  if (!npc.baseSkills.length && !npc.awakenedSkill) continue;
  const clean = npc.name.toLowerCase().trim();
  const awakened = npc.awakenedSkill || awakenedByName[clean];
  const vkcd = vkcdByPetId[npc.id] || vkcdByPetName[clean];

  const profile: PetSkillProfile = {
    base: npc.baseSkills,
    ...(awakened ? { awakened, hasDirectAwakened: Boolean(npc.awakenedSkill) } : {}),
    ...(vkcd ? { vkcd } : {}),
  };

  profiles[String(npc.id)] = profile;

  // Danh sách phẳng gồm tất cả các skill để tương thích ngược
  const allIds = [...npc.baseSkills];
  if (awakened && !allIds.includes(awakened)) allIds.push(awakened);
  if (vkcd && !allIds.includes(vkcd.skillId)) allIds.push(vkcd.skillId);
  npcSkills[String(npc.id)] = allIds;
}

// Ghi file ra packages/engine và apps/web
for (const baseDir of ["packages/engine/src/data", "apps/web/src/data"]) {
  const pPath = resolve(`${baseDir}/petSkillProfiles.json`);
  const sPath = resolve(`${baseDir}/npcSkills.json`);
  mkdirSync(dirname(pPath), { recursive: true });
  writeFileSync(pPath, JSON.stringify(profiles), "utf8");
  writeFileSync(sPath, JSON.stringify(npcSkills), "utf8");
}

console.log(`Đã xuất hồ sơ kỹ năng cho ${Object.keys(profiles).length} NPC:`);
console.log(`- Có kỹ năng học thêm (Mê): ${Object.values(profiles).filter((p) => p.awakened).length}`);
console.log(`- Có kỹ năng từ VKCD: ${Object.values(profiles).filter((p) => p.vkcd).length}`);
