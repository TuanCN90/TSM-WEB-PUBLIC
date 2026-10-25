/**
 * Sinh packages/engine/src/data/npcNames.json (modelId → tên NPC/võ tướng tiếng Việt) từ Data/VN/Npc_C.dat.
 * Bản ghi: `[u16 độ dài byte tên][tên UTF-16LE][81 byte]`; trong 81 byte: u8, rồi u16 modelId (id gửi trong packet).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const out = resolve("packages/engine/src/data/npcNames.json");
const TAIL = 81;

const b = readFileSync(join(dir, "VN/Npc_C.dat"));
const names: Record<number, string> = {};
let o = 4;
for (let n = b.readUInt32LE(0); n > 0 && o + 2 <= b.length; n--) {
  const len = b.readUInt16LE(o);
  const end = o + 2 + len;
  const id = b.readUInt16LE(end + 1);
  if (!(id in names)) names[id] = b.toString("utf16le", o + 2, end);
  o = end + TAIL;
}
if (o !== b.length) throw new Error(`Cấu trúc Npc_C.dat không khớp (dừng ở ${o}/${b.length})`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(names), "utf8");
console.log(`Đã ghi ${Object.keys(names).length} NPC → ${out}`);
