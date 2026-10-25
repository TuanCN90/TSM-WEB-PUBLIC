/**
 * Sinh packages/engine/src/data/npcElements.json (modelId → mã hệ) từ Data/VN/Npc_C.dat.
 * Cùng cấu trúc bản ghi với import-npc-names.ts; trong 81 byte đuôi: u16@1 = modelId, u8@50 = mã hệ
 * (1 Địa, 2 Thủy, 3 Hỏa, 4 Phong khớp bảng text 30003..30007; Hỏa/Phong/Ám đã đối chiếu với võ tướng thật; 0 = Vô, không ghi).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const out = resolve("packages/engine/src/data/npcElements.json");
const TAIL = 81;

const b = readFileSync(join(dir, "VN/Npc_C.dat"));
const el: Record<number, number> = {};
const seen = new Set<number>();
let o = 4;
for (let n = b.readUInt32LE(0); n > 0 && o + 2 <= b.length; n--) {
  const end = o + 2 + b.readUInt16LE(o);
  const id = b.readUInt16LE(end + 1);
  if (!seen.has(id)) { seen.add(id); const e = b[end + 50]!; if (e) el[id] = e; }
  o = end + TAIL;
}
if (o !== b.length) throw new Error(`Cấu trúc Npc_C.dat không khớp (dừng ở ${o}/${b.length})`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(el), "utf8");
console.log(`Đã ghi hệ của ${Object.keys(el).length} NPC → ${out}`);
