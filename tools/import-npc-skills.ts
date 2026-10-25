import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const file = resolve("tool-reference/BOT TSM/Data/VN/Npc_C.dat");
const b = readFileSync(file);
let o = 4;
const npcSkills: Record<number, number[]> = {};

for (let n = b.readUInt32LE(0); n > 0 && o + 2 <= b.length; n--) {
  const len = b.readUInt16LE(o);
  const end = o + 2 + len;
  const id = b.readUInt16LE(end + 1);
  const tail = b.subarray(end, end + 81);
  const list: number[] = [];
  for (const off of [51, 53, 55]) {
    const sId = tail.readUInt16LE(off);
    if (sId >= 10000 && sId <= 35000) list.push(sId);
  }
  if (list.length) npcSkills[id] = list;
  o = end + 81;
}

for (const outPath of [
  resolve("packages/engine/src/data/npcSkills.json"),
  resolve("apps/web/src/data/npcSkills.json"),
]) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(npcSkills), "utf8");
}

console.log(`Đã xuất kỹ năng cho ${Object.keys(npcSkills).length} NPC → engine + web`);
