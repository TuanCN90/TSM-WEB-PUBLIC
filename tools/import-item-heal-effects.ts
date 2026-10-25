/**
 * Trích xuất chỉ số phục hồi HP/SP của vật phẩm từ Data/VN/Item_C.dat và Data/Item_C.dat.
 * Ghi ra: packages/engine/src/data/itemHealEffects.json và apps/web/src/data/itemHealEffects.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const FIXED = 113;

export interface ItemHealEffect {
  hp?: number;
  sp?: number;
}

function parseHealItems(file: string): Record<number, ItemHealEffect> {
  const b = readFileSync(file);
  const effects: Record<number, ItemHealEffect> = {};
  let o = 4;

  for (let n = b.readUInt32LE(0); n > 0; n--) {
    const len = b.readUInt16LE(o);
    const end = o + 2 + len;
    const id = b.readUInt16LE(end + 1);
    const descLen = b.readUInt16LE(end + FIXED);
    const fixedBuf = b.subarray(end, end + FIXED);
    const type = fixedBuf[0];

    // Food (17), Drink/Medicine (18), Revive/Elixir (50), Powder/Pill (52)
    if (type === 17 || type === 18 || type === 50 || type === 52) {
      const eff1 = fixedBuf[9];
      const raw1 = fixedBuf.readUInt16LE(12);
      const eff2 = fixedBuf[16];
      const raw2 = fixedBuf.readUInt16LE(19);

      // Trong Item_C.dat, chỉ số cộng thêm được lưu trữ với mốc cơ sở 100 (raw - 100)
      let hp = 0;
      let sp = 0;
      if (eff1 === 0x19 && raw1 > 100) hp = raw1 - 100;
      if (eff1 === 0x1a && raw1 > 100) sp = raw1 - 100;
      if (eff2 === 0x19 && raw2 > 100) hp = raw2 - 100;
      if (eff2 === 0x1a && raw2 > 100) sp = raw2 - 100;

      if (hp > 0 || sp > 0) {
        effects[id] = {
          ...(hp > 0 ? { hp } : {}),
          ...(sp > 0 ? { sp } : {}),
        };
      }
    }
    o = end + FIXED + 2 + descLen;
  }
  return effects;
}

const zh = parseHealItems(join(dir, "Item_C.dat"));
const vn = parseHealItems(join(dir, "VN/Item_C.dat"));
const effects: Record<number, ItemHealEffect> = { ...zh, ...vn };

for (const out of [resolve("packages/engine/src/data/itemHealEffects.json"), resolve("apps/web/src/data/itemHealEffects.json")]) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(effects), "utf8");
}
console.log(`Đã xuất ${Object.keys(effects).length} vật phẩm hồi phục HP/SP → engine + web`);
