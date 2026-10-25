/**
 * Sinh bảng chi tiết thuộc tính vật phẩm (itemId → { name, desc, hp?, sp?, level?, slot?, val? }):
 * Data/VN/Item_C.dat (tiếng Việt) + Data/Item_C.dat (gốc tiếng Trung) làm dự phòng.
 *
 * Ghi:
 *   - packages/engine/src/data/itemDetails.json
 *   - apps/web/src/data/itemDetails.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const FIXED = 113;

const STAT_MAP: Record<number, string> = {
  207: "HP",
  208: "SP",
  210: "ATK",
  211: "DEF",
  212: "INT",
  214: "AGI",
  218: "Bạo kích",
  219: "Bội mẫn",
};

export interface ItemStat {
  type: string;
  value: number;
}

export interface ItemDetail {
  name: string;
  desc?: string;
  hp?: number;
  sp?: number;
  price?: number;
  level?: number;
  slot?: number; // 1: Mũ, 2: Áo giáp, 3: Vũ khí, 4: Cổ tay, 5: Giày, 6: Đặc thù
  stats?: ItemStat[];
  val?: number;  // Giá trị thuộc tính chính để tương thích ngược
}

function parseItemDetails(file: string): Record<number, ItemDetail> {
  const b = readFileSync(file);
  const items: Record<number, ItemDetail> = {};
  let o = 4;
  for (let n = b.readUInt32LE(0); n > 0; n--) {
    const len = b.readUInt16LE(o);
    const end = o + 2 + len;
    const name = b.toString("utf16le", o + 2, end).trim();
    const id = b.readUInt16LE(end + 1);

    const slotByte = b.readUInt8(end + 25);
    const slot = slotByte >= 1 && slotByte <= 6 ? slotByte : undefined;
    const level = b.readUInt8(end + 24);
    const val62 = b.readUInt32LE(end + 62);
    const price = val62 > 0 ? val62 : undefined;

    const stats: ItemStat[] = [];
    const t1 = b.readUInt8(end + 9);
    const raw1 = b.readUInt16LE(end + 12);
    if (t1 in STAT_MAP && raw1 !== 100) {
      stats.push({ type: STAT_MAP[t1]!, value: raw1 - 100 });
    }

    const t2 = b.readUInt8(end + 16);
    const raw2 = b.readUInt16LE(end + 19);
    if (t2 in STAT_MAP && raw2 !== 100) {
      stats.push({ type: STAT_MAP[t2]!, value: raw2 - 100 });
    }

    // Type 25 = Hồi phục HP tiêu hao (đồ ăn, thuốc HP)
    // Type 26 = Hồi phục SP tiêu hao (rượu, trà, thuốc SP)
    let hp: number | undefined;
    let sp: number | undefined;
    if (t1 === 25 && raw1 > 100) hp = raw1 - 100;
    if (t2 === 25 && raw2 > 100) hp = raw2 - 100;
    if (t1 === 26 && raw1 > 100) sp = raw1 - 100;
    if (t2 === 26 && raw2 > 100) sp = raw2 - 100;

    const descLen = b.readUInt16LE(end + FIXED);
    const desc = b.toString("utf16le", end + FIXED + 2, end + FIXED + 2 + descLen).trim();

    const entry: ItemDetail = {
      name,
      ...(desc ? { desc } : {}),
      ...(level > 0 ? { level } : {}),
      ...(hp ? { hp } : {}),
      ...(sp ? { sp } : {}),
      ...(price ? { price } : {}),
      ...(slot ? { slot } : {}),
      ...(stats.length > 0 ? { stats } : {}),
      ...(stats.length > 0 ? { val: stats[0]!.value } : {}),
    };

    items[id] = entry;
    o = end + FIXED + 2 + descLen;
  }
  if (o !== b.length) throw new Error(`Cấu trúc ${file} không khớp (dừng ở ${o}/${b.length})`);
  return items;
}

const zh = parseItemDetails(join(dir, "Item_C.dat"));
const vn = parseItemDetails(join(dir, "VN/Item_C.dat"));
const merged: Record<number, ItemDetail> = { ...zh, ...vn };

for (const out of [
  resolve("packages/engine/src/data/itemDetails.json"),
  resolve("apps/web/src/data/itemDetails.json"),
]) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(merged), "utf8");
}

console.log(
  `Đã ghi ${Object.keys(merged).length} chi tiết vật phẩm (${Object.keys(vn).length} tiếng Việt + ${
    Object.keys(merged).length - Object.keys(vn).length
  } tiếng Hán dự phòng) → engine + web`
);
