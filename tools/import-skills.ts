import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const file = resolve("tool-reference/BOT TSM/Data/VN/Skill_C.dat");
const b = readFileSync(file);
const count = b.readUInt32LE(0);
const FIXED = 34;

let o = 4;
const skills: Record<number, { id: number; name: string; desc: string; sp: number }> = {};

for (let i = 0; i < count; i++) {
  const nLen = b.readUInt16LE(o);
  const name = b.toString("utf16le", o + 2, o + 2 + nLen).trim();
  const dataStart = o + 2 + nLen;
  const id = b.readUInt16LE(dataStart + 1);
  const sp = b.readUInt16LE(dataStart + 3);
  const dLen = b.readUInt16LE(dataStart + FIXED);
  const desc = b.toString("utf16le", dataStart + FIXED + 2, dataStart + FIXED + 2 + dLen).trim();
  skills[id] = { id, name, desc, sp };
  o = dataStart + FIXED + 2 + dLen;
}

for (const outPath of [
  resolve("packages/engine/src/data/skillData.json"),
  resolve("apps/web/src/data/skillData.json"),
]) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(skills), "utf8");
}

console.log(`Đã xuất ${Object.keys(skills).length} kỹ năng từ Skill_C.dat → engine + web`);
