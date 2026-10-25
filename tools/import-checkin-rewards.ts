import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const datPath = resolve("tool-reference/BOT TSM/Data/LoginAwardData_C.dat");
const itemNamesPath = resolve("packages/engine/src/data/itemNames.json");
const outPath = resolve("packages/engine/src/data/dailyCheckinRewards.json");

const b = readFileSync(datPath);
const itemNames: Record<string, string> = JSON.parse(readFileSync(itemNamesPath, "utf8"));

const count = b.readUInt32LE(0);
const recLen = (b.length - 4) / count;

export interface CheckinReward {
  day: number;
  itemId: number;
  qty: number;
  name: string;
}

const daily: Record<number, CheckinReward> = {};
const streak: Record<number, CheckinReward> = {};

for (let i = 0; i < count; i++) {
  const o = 4 + i * recLen;
  const type = b.readUInt16LE(o);
  const day = b.readUInt32LE(o + 2);
  const itemId = b.readUInt16LE(o + 6);
  const qty = b.readUInt32LE(o + 8);
  const name = itemNames[String(itemId)] ?? (itemId === 0 ? "Không có" : `Vật phẩm #${itemId}`);

  if (type === 1) {
    daily[day] = { day, itemId, qty, name };
  } else if (type === 2) {
    streak[day] = { day, itemId, qty, name };
  }
}

const result = { daily, streak };
writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(`Đã xuất ${Object.keys(daily).length} mốc ngày và ${Object.keys(streak).length} mốc chuỗi điểm danh vào ${outPath}`);
