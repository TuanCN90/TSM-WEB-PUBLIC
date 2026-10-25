/**
 * Sinh apps/web/src/data/mapNames.json (mapId → tên map tiếng Việt) từ dữ liệu tool cũ.
 *  - Data/SceneSet_C.dat : u32 count, rồi từng bản ghi 17 byte `[textId u32][mapId u16][11 byte khác]`
 *  - Data/TextData_C.dat : u32 count, rồi từng bản ghi `[id u32][độ dài byte u16][chuỗi UTF-16LE]`
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const out = resolve("apps/web/src/data/mapNames.json");

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

const names: Record<number, string> = {};
{
  const b = readFileSync(join(dir, "SceneSet_C.dat"));
  const STRIDE = 17;
  for (let i = 0, o = 4; i < b.readUInt32LE(0) && o + STRIDE <= b.length; i++, o += STRIDE) {
    const name = text.get(b.readUInt32LE(o))?.trim();
    const mapId = b.readUInt16LE(o + 4);
    if (name && !(mapId in names)) names[mapId] = name;
  }
}

for (const target of [
  resolve("apps/web/src/data/mapNames.json"),
  resolve("packages/engine/src/data/mapNames.json"),
]) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(names), "utf8");
}
console.log(`Đã ghi ${Object.keys(names).length} map → web + engine`);
