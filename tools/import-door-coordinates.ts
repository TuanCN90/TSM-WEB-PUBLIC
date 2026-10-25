/**
 * Sinh packages/engine/src/data/doorCoordinates.json (bảng tra cứu tọa độ cổng của từng map)
 * trích xuất từ:
 * 1. MPData4_C.Dat (listMap: 8.975 cổng và tọa độ đi bộ chuẩn của 2.611 maps)
 * 2. Các câu lệnh `warp_id <door>,<mapId>,<x>,<y>` trong toàn bộ kịch bản tool-reference/BOT TSM/Script/
 * 3. Các điểm cửa khẩu chuẩn đã xác minh qua pcap và thực tế.
 * 
 * Cấu trúc: { "<mapId>": { "<doorIndex>": { "x": number, "y": number } } }
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";

function walkDir(dir: string): string[] {
  let results: string[] = [];
  if (!existsSync(dir)) return results;
  const list = readdirSync(dir);
  for (const file of list) {
    const full = join(dir, file);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(walkDir(full));
    } else if (file.endsWith(".ini")) {
      results.push(full);
    }
  }
  return results;
}

const mpDataPath = resolve("tool-reference/MPData4_C.Dat");
const scriptDir = resolve("tool-reference/BOT TSM/Script");

async function loadMPDataDoors(): Promise<Record<number, Record<number, { x: number; y: number }>>> {
  const result: Record<number, Record<number, { x: number; y: number }>> = {};
  if (!existsSync(mpDataPath)) return result;

  return new Promise((res, rej) => {
    const xorStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        for (let i = 0; i < chunk.length; i++) {
          chunk[i] ^= 0xdf;
        }
        callback(null, chunk);
      },
    });

    const readStream = createReadStream(mpDataPath);
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];

    gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gunzip.on("end", () => {
      try {
        const fullBuf = Buffer.concat(chunks);
        const data = JSON.parse(fullBuf.toString("utf8"));
        for (const m of (data.listMap || [])) {
          if (m.srcId && m.WarpId && m.actionKindPosX > 0 && m.actionKindPosY > 0) {
            (result[m.srcId] ??= {})[m.WarpId] = { x: m.actionKindPosX, y: m.actionKindPosY };
          }
        }
        res(result);
      } catch (e) {
        rej(e);
      }
    });
    gunzip.on("error", rej);
    readStream.on("error", rej);

    readStream.pipe(xorStream).pipe(gunzip);
  });
}

async function main() {
  const coords: Record<number, Record<number, { x: number; y: number }>> = {};

  // 1. Nạp từ MPData4_C.Dat (nếu có)
  const mpDoors = await loadMPDataDoors();
  for (const [mapId, doors] of Object.entries(mpDoors)) {
    coords[Number(mapId)] = { ...doors };
  }
  console.log(`Đã nạp ${Object.keys(mpDoors).length} maps từ MPData4_C.Dat`);

  // 2. Nạp đè từ các file .ini kịch bản
  let parsedCount = 0;
  for (const file of walkDir(scriptDir)) {
    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/warp_id\s+([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i);
      if (m) {
        const door = Number(m[1]);
        const mapId = Number(m[2]);
        const x = Number(m[3]);
        const y = Number(m[4]);
        if (door > 0 && mapId > 0 && x > 0 && y > 0) {
          (coords[mapId] ??= {})[door] = { x, y };
          parsedCount++;
        }
      }
    }
  }

  // 3. Bổ sung các cửa khẩu trọng yếu đã xác minh thực tế qua pcap & game live
  const verifiedPorts: [number, number, number, number][] = [
    // [mapId, door, x, y]
    [12001, 1, 90, 1650],   // Trác Quận -> Cổng 1 ra U Châu (63000)
    [63000, 5, 2670, 830],  // U Châu -> Cổng 5 vào Lôi đài Hương Dũng (12992)
    [12992, 3, 886, 279],   // Doanh trại Hương Dũng -> Cổng 3 vào Quảng trường Hương Dũng (12701)
    [12001, 12, 160, 1610], // Trác Quận -> Cổng 12 vào Đường phố Trác Quận (12002)
    [21001, 1, 450, 310],   // Tương Dương -> Cổng vào Quảng trường
    // Cổng thoát các map Dị giới về Quảng trường Trác Quận (12003) trích xuất chính xác từ Eve.emg
    [10851, 1, 1436, 110],  // Dị giới Tân Thủ Thôn -> Cổng 1 về 12003
    ...Array.from({ length: 19 }, (_, i) => [10852 + i, 2, 688, 375] as [number, number, number, number]), // Dị giới Lv 10..180 (10852..10870) -> Cổng 2 về 12003
    [49942, 1, 688, 375],   // Dị giới TS lông vũ -> Cổng 1 về 12003
    [49950, 1, 688, 375],   // Dị giới TS linh thạch -> Cổng 1 về 12003
  ];

  for (const [mapId, door, x, y] of verifiedPorts) {
    (coords[mapId] ??= {})[door] = { x, y };
  }

  for (const out of [
    resolve("packages/engine/src/data/doorCoordinates.json"),
    resolve("apps/web/src/data/doorCoordinates.json"),
  ]) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(coords, null, 2), "utf8");
  }
  console.log(`Đã ghi ${Object.keys(coords).length} maps với tọa độ cổng → engine & web`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
