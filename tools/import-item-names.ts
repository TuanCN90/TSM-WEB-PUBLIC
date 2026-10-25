/**
 * Sinh bảng tên vật phẩm (itemId → tên): Data/VN/Item_C.dat (tên tiếng Việt, 18.922 vật phẩm) + Data/Item_C.dat (gốc tiếng Trung, 26.287) làm dự phòng.
 * Ghi: packages/engine/src/data/itemNames.json (log "Túi đồ", điểm danh) và apps/web/src/data/itemNames.json (danh sách Thùng đồ).
 *
 * Cấu trúc bản ghi (đã kiểm chứng: parse đúng 18.922 bản ghi, kết thúc chính xác tại cuối file):
 *   [u16 độ dài byte tên][tên UTF-16LE][113 byte cố định, trong đó byte đầu là u8 rồi u16 itemId][u16 độ dài mô tả][mô tả UTF-16LE]
 * Kiểm chứng id: 46029 = "Hạo Giác" (thưởng điểm danh ngày 1), 20001 = "Thiết Đầu Khôi" (script cũ `use_item 20001`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const FIXED = 113;

/** Đọc một file Item_C.dat (cùng cấu trúc); kiểm tra kết thúc đúng cuối file. */
function parseItems(file: string): Record<number, string> {
  const b = readFileSync(file);
  const names: Record<number, string> = {};
  let o = 4;
  for (let n = b.readUInt32LE(0); n > 0; n--) {
    const len = b.readUInt16LE(o);
    const end = o + 2 + len;
    const id = b.readUInt16LE(end + 1);
    if (!(id in names)) names[id] = b.toString("utf16le", o + 2, end).trim();
    o = end + FIXED + 2 + b.readUInt16LE(end + FIXED);
  }
  if (o !== b.length) throw new Error(`Cấu trúc ${file} không khớp (dừng ở ${o}/${b.length})`);
  return names;
}

// Bản Việt hoá trước (18.922 vật phẩm); id chỉ có ở bản gốc tiếng Trung (~7.4 nghìn, vd 44308 = 魔關羽選擇卷) thì lấy tên Hán.
const vn = parseItems(join(dir, "VN/Item_C.dat"));
const zh = parseItems(join(dir, "Item_C.dat"));
const names: Record<number, string> = { ...zh, ...vn };

for (const out of [resolve("packages/engine/src/data/itemNames.json"), resolve("apps/web/src/data/itemNames.json")]) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(names), "utf8");
}
console.log(`Đã ghi ${Object.keys(names).length} vật phẩm (${Object.keys(vn).length} tên Việt + ${Object.keys(names).length - Object.keys(vn).length} tên Hán dự phòng) → engine + web`);
