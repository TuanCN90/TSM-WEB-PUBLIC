/** Sao chép Script/*.ini (+ Config/) từ tool cũ vào data/scripts, giữ nguyên nội dung. */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const src = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Script");
const dst = resolve("data/scripts");
if (!existsSync(src)) {
  console.error(`Không thấy thư mục nguồn: ${src}`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
let n = 0;
const walk = (rel: string) => {
  for (const e of readdirSync(join(src, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) { mkdirSync(join(dst, r), { recursive: true }); walk(r); }
    else if (e.name.toLowerCase().endsWith(".ini")) { cpSync(join(src, r), join(dst, r)); n++; }
  }
};
walk("");
console.log(`Đã import ${n} script vào ${dst}`);
