/**
 * Sinh packages/engine/src/data/expTable.json từ trang https://tsexp.pages.dev/ (hoặc file HTML đã lưu).
 *   npm run import-exp [url|đường-dẫn-html]
 * Trang nhúng `const DATA = {t0,t1,t2,t3}`; mỗi hàng `[level, EXP lên cấp, EXP tích lũy]` (t3: sublevel, 200 + level hiển thị).
 *  - Server chỉ gửi EXP TÍCH LŨY ⇒ exp trong cấp = raw − tích lũy(L), mốc lên cấp = EXP lên cấp của (L+1).
 *  - curves 0,1,2,3 = Turn 0..3 của nhân vật; võ tướng dùng curve 0 (chưa CS) hoặc curve 1 (turn 2, công thức ^3.1).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const src = process.argv[2] ?? "https://tsexp.pages.dev/";
const out = resolve("packages/engine/src/data/expTable.json");

async function main() {
  const html = /^https?:/.test(src) ? await (await fetch(src)).text() : readFileSync(resolve(src), "utf8");
  const m = /const DATA = (\{.*?\});\s*\n/s.exec(html);
  if (!m) throw new Error("Không tìm thấy `const DATA = {...}` trong trang");
  const DATA = JSON.parse(m[1]) as Record<"t0" | "t1" | "t2" | "t3", [number, number, number][]>;

  const curves: Record<string, [number, number][]> = {};
  for (const [i, key] of (["t0", "t1", "t2", "t3"] as const).entries()) {
    const rows = DATA[key];
    let cum = 0;
    rows.forEach(([lv, up, total], k) => {
      cum += up;
      if (lv !== k + 1 || total !== cum) throw new Error(`${key} Lv ${lv}: tích lũy không khớp (${total} ≠ ${cum})`);
    });
    curves[String(i)] = rows.map(([, up, total]) => [up, total]);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ source: src, curves }), "utf8");
  console.log(`Đã ghi ${Object.values(curves).map((c) => c.length).join("/")} level (turn 0..3) → ${out}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
