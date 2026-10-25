/**
 * Sinh warpGates.json (danh sách 41 điểm truyền tống = menu "Teleport" của tool gốc) từ Data/Warp_C.dat + TextData_C.dat.
 * `Warp_C.dat`: u32 count, rồi bản ghi 16 byte `[textId u32][mapA u16][mapB u16][x u32][y u32]`.
 *  - mapA = map đích (cổng thành) — client gửi trong gói `44/01` kèm `index` = vị trí bản ghi trong file (0-based) ở byte cuối; x,y = toạ độ đến (12001 → 310,1530 khớp pcap).
 * Ghi ra cả engine (kiểm tra hợp lệ) lẫn web (danh sách chọn).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const text = new Map<number, string>();
{
  const b = readFileSync(join(dir, "TextData_C.dat"));
  let o = 4;
  for (let n = b.readUInt32LE(0); n > 0 && o + 6 <= b.length; n--) {
    const id = b.readUInt32LE(o), len = b.readUInt16LE(o + 4);
    text.set(id, b.toString("utf16le", o + 6, o + 6 + len));
    o += 6 + len;
  }
}
const mapNames = JSON.parse(readFileSync(resolve("apps/web/src/data/mapNames.json"), "utf8")) as Record<string, string>;

const b = readFileSync(join(dir, "Warp_C.dat"));
const gates: { index: number; id: number; city: string; map: string; x: number; y: number }[] = [];
for (let i = 0, o = 4; i < b.readUInt32LE(0) && o + 16 <= b.length; i++, o += 16) {
  const id = b.readUInt16LE(o + 4);
  const label = (text.get(b.readUInt32LE(o)) ?? "").replace(/^\s*\d+\.\s*/, "").trim(); // bỏ số thứ tự "1. "
  gates.push({ index: i, id, city: label, map: mapNames[String(id)] ?? "", x: b.readUInt32LE(o + 8), y: b.readUInt32LE(o + 12) });
}
for (const out of [resolve("packages/engine/src/data/warpGates.json"), resolve("apps/web/src/data/warpGates.json")]) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(gates), "utf8");
}
console.log(`Đã ghi ${gates.length} điểm truyền tống (engine + web)`);
