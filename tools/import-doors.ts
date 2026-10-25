/**
 * Sinh packages/engine/src/data/doors.json (đồ thị cổng giữa các map) từ Data/door.ini.
 * Mỗi dòng `fromMap ⇥ toMap ⇥ index` (index = số thứ tự cổng trong map nguồn). Kết quả: { "<from>": [[to, index], …] }.
 * Dùng để tìm đường từ cổng thành (Warp_C.dat) tới map đích khi warp. Chưa biết gói "đi qua cổng" nên chưa dùng để di chuyển thật.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const out = resolve("packages/engine/src/data/doors.json");
const g: Record<number, [number, number][]> = {};
let edges = 0;
for (const line of readFileSync(join(dir, "door.ini"), "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const [a, b, c] = line.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) continue;
  (g[a] ??= []).push([b, c]);
  edges++;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(g), "utf8");
console.log(`Đã ghi ${Object.keys(g).length} map, ${edges} cổng → ${out}`);
