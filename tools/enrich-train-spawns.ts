/**
 * Script làm giàu (enrich) cơ sở dữ liệu bãi train trainSpawns.json từ MPData4_C.Dat.
 * Bổ sung:
 * - AGI của quái (tốc độ chuẩn để người chơi canh agi combo / vượt agi)
 * - HP của quái
 * - Count (Số lượng quái thực tế trong trận từ mảng listBattle)
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { createGunzip } from "node:zlib";

export interface TrainSpawn {
  mapId: number;
  mapName: string;
  npcId: number;
  npcName: string;
  level: number;
  element: number;
  cs: number;
  count: number;
  x: number;
  y: number;
  agi?: number;
  hp?: number;
  locations?: string[]; // Vị trí đứng của quái trong trận từ listBattle (VD: ["3,2,4", "1,2,3,4"])
}

interface MPNpc {
  MapId: number;
  MapName: string;
  NpcNo: number;
  NpcId: number;
  NpcName: string;
  PosX: number;
  PosY: number;
  HP: number;
  AGI: number;
  Level: number;
  Element: number;
  Event: number;
  listBattle?: Array<{ Count: number; Location: string }>;
}

const mpDataPath = resolve("tool-reference/MPData4_C.Dat");
const outEngine = resolve("packages/engine/src/data/trainSpawns.json");
const outWeb = resolve("apps/web/src/data/trainSpawns.json");

async function loadMPDataNpcs(): Promise<MPNpc[]> {
  return new Promise((resolvePromise, reject) => {
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
        resolvePromise(data.listNpcInMap as MPNpc[]);
      } catch (e) {
        reject(e);
      }
    });
    gunzip.on("error", reject);
    readStream.on("error", reject);

    readStream.pipe(xorStream).pipe(gunzip);
  });
}

async function run() {
  console.log("Đang giải mã và đọc MPData4_C.Dat...");
  const mpNpcs = await loadMPDataNpcs();
  console.log(`Đã nạp ${mpNpcs.length.toLocaleString()} NPC từ MPData4_C.Dat.`);

  // Xây dựng tra cứu
  const exactMap = new Map<string, MPNpc>();
  const mapNpcList = new Map<string, MPNpc[]>();

  for (const n of mpNpcs) {
    exactMap.set(`${n.MapId}_${n.NpcId}_${n.PosX}_${n.PosY}`, n);
    const k = `${n.MapId}_${n.NpcId}`;
    if (!mapNpcList.has(k)) mapNpcList.set(k, []);
    mapNpcList.get(k)!.push(n);
  }

  const spawns: TrainSpawn[] = JSON.parse(readFileSync(outEngine, "utf8"));
  console.log(`Đang xử lý ${spawns.length.toLocaleString()} bãi train hiện có...`);

  let enrichedCount = 0;
  let enrichedAgi = 0;
  let fixedCoords = 0;

  for (const s of spawns) {
    let mpNpc = exactMap.get(`${s.mapId}_${s.npcId}_${s.x}_${s.y}`);
    if (!mpNpc && mapNpcList.has(`${s.mapId}_${s.npcId}`)) {
      const candidates = mapNpcList.get(`${s.mapId}_${s.npcId}`)!;
      let minDist = Infinity;
      let best: MPNpc | null = null;
      for (const c of candidates) {
        const d = Math.hypot(c.PosX - s.x, c.PosY - s.y);
        if (d < minDist) {
          minDist = d;
          best = c;
        }
      }
      mpNpc = best ?? undefined;
    }

    if (mpNpc) {
      if (mpNpc.AGI != null && mpNpc.AGI > 0) {
        s.agi = mpNpc.AGI;
        enrichedAgi++;
      }
      if (mpNpc.HP != null && mpNpc.HP > 0) {
        s.hp = mpNpc.HP;
      }
      if (mpNpc.listBattle && mpNpc.listBattle.length > 0) {
        const maxBattle = Math.max(...mpNpc.listBattle.map((b) => b.Count || 1));
        if (maxBattle > 1) {
          s.count = Math.min(10, maxBattle);
          enrichedCount++;
        }
        const locs = mpNpc.listBattle.map((b) => b.Location?.trim()).filter(Boolean);
        if (locs.length > 0) {
          s.locations = Array.from(new Set(locs));
        }
      }
      // Sửa tọa độ bất thường nếu có (> 5000px)
      if (s.x > 5000 || s.y > 5000) {
        s.x = mpNpc.PosX;
        s.y = mpNpc.PosY;
        fixedCoords++;
      }
    }

    // Đảm bảo count hợp lệ 1..10
    s.count = Math.min(10, Math.max(1, s.count || 1));
  }

  // Sắp xếp mặc định: MapId -> Level
  spawns.sort((a, b) => a.mapId - b.mapId || a.level - b.level);

  const jsonContent = JSON.stringify(spawns);
  mkdirSync(dirname(outEngine), { recursive: true });
  writeFileSync(outEngine, jsonContent, "utf8");

  mkdirSync(dirname(outWeb), { recursive: true });
  writeFileSync(outWeb, jsonContent, "utf8");

  console.log("=== HOÀN TẤT LÀM GIÀU DỮ LIỆU BÃI TRAIN ===");
  console.log(`- Tổng số bãi train: ${spawns.length.toLocaleString()}`);
  console.log(`- Số bãi bổ sung AGI: ${enrichedAgi.toLocaleString()} (${((enrichedAgi / spawns.length) * 100).toFixed(1)}%)`);
  console.log(`- Số bãi cập nhật số lượng quái trong trận (x2 - x10): ${enrichedCount.toLocaleString()}`);
  if (fixedCoords > 0) console.log(`- Số bãi sửa tọa độ chuẩn: ${fixedCoords}`);
  console.log(`- Ghi file engine: ${outEngine} (${(jsonContent.length / 1024).toFixed(1)} KB)`);
  console.log(`- Ghi file web:    ${outWeb}`);
}

run().catch((err) => {
  console.error("Lỗi khi chạy enrich-train-spawns:", err);
  process.exit(1);
});
