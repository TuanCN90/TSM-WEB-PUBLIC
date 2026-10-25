/**
 * Sinh packages/engine/src/data/trainSpawns.json và apps/web/src/data/trainSpawns.json
 * từ Eve.emg (bản đồ & tọa độ bãi quái) và Npc_C.dat (tên, cấp độ, hệ, chuyển sinh NPC).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface TrainSpawn {
  mapId: number;
  mapName: string;
  npcId: number;
  npcName: string;
  level: number;
  element: number; // 0: Vô, 1: Địa, 2: Thủy, 3: Hỏa, 4: Phong, 5: Tâm, 7: Quang, 8: Ám
  cs: number;      // 0: Chưa CS, 1: CS 1, 2: Tái sinh (CS 2)
  count: number;   // Số lượng quái xuất hiện
  x: number;
  y: number;
}

const dir = resolve(process.argv[2] ?? "tool-reference/BOT TSM/Data");
const outEngine = resolve("packages/engine/src/data/trainSpawns.json");
const outWeb = resolve("apps/web/src/data/trainSpawns.json");

// 1. Đọc NPC stats từ Npc_C.dat
const npcCBuf = readFileSync(join(dir, "VN/Npc_C.dat"));
const mapNames: Record<string, string> = JSON.parse(readFileSync("packages/engine/src/data/mapNames.json", "utf8"));

const npcMap: Record<number, { name: string; level: number; cs: number; element: number }> = {};
const TAIL = 81;
let o = 4;
for (let n = npcCBuf.readUInt32LE(0); n > 0 && o + 2 <= npcCBuf.length; n--) {
  const len = npcCBuf.readUInt16LE(o);
  const end = o + 2 + len;
  const name = npcCBuf.toString("utf16le", o + 2, end);
  const typeByte = npcCBuf[end]!;
  const id = npcCBuf.readUInt16LE(end + 1);
  const level = npcCBuf[end + 26]!;
  const element = npcCBuf[end + 50]!;
  let cs = 0;
  if (typeByte === 33 || typeByte === 37) cs = 1;
  else if (typeByte === 36 || typeByte === 38) cs = 2;

  if (!npcMap[id]) {
    npcMap[id] = { name, level, cs, element };
  }
  o = end + TAIL;
}

// 2. Quét Eve.emg để trích xuất danh sách bãi spawn theo từng map
const eveBuf = readFileSync(join(dir, "Eve.emg"));
const fileCount = eveBuf.readUInt16LE(0);
const spawns: TrainSpawn[] = [];
const seenKey = new Set<string>();

for (let i = 0; i < fileCount; i++) {
  const entryOffset = 2 + i * 32;
  const nameLen = eveBuf.readUInt8(entryOffset);
  const fileName = eveBuf.subarray(entryOffset + 1, entryOffset + 1 + nameLen).toString("ascii");
  const fileOffset = eveBuf.readUInt32LE(entryOffset + 24);
  const fileLen = eveBuf.readUInt32LE(entryOffset + 28);

  const m = fileName.match(/^(\d+)\.eve$/);
  if (!m) continue;
  const mapId = parseInt(m[1]!, 10);
  const fileBuf = eveBuf.subarray(fileOffset, fileOffset + fileLen);

  // 1. Quét tìm các nhóm encounter battle ở cuối file để biết số quái theo nhóm (1..10)
  const npcMaxCount = new Map<number, number>();
  for (let p = 0; p + 10 <= fileBuf.length; p++) {
    if (fileBuf[p] === 0x01 && fileBuf[p + 1] === 0x01 && fileBuf[p + 2] === 0x01) {
      const teamCount = fileBuf.readUInt16LE(p + 3);
      if (teamCount >= 1 && teamCount <= 10) {
        let slotOff = p + 5;
        for (let s = 0; s < teamCount && slotOff + 6 <= fileBuf.length; s++, slotOff += 6) {
          const slotNpc = fileBuf.readUInt16LE(slotOff + 2);
          if (npcMap[slotNpc]) {
            const cur = npcMaxCount.get(slotNpc) || 1;
            if (teamCount > cur) npcMaxCount.set(slotNpc, teamCount);
          }
        }
      }
    }
  }

  // 2. Quét Method A: Theo marker Npc0002 (cho các map có marker chuỗi)
  const idx = fileBuf.indexOf(Buffer.from("Npc0002"));
  if (idx !== -1 && idx + 29 <= fileBuf.length) {
    const recCount = fileBuf.readUInt32LE(idx + 25);
    if (recCount > 0 && recCount <= 100) {
      for (let r = 0; r < recCount; r++) {
        const recOffset = idx + 29 + r * 106;
        if (recOffset + 106 > fileBuf.length) break;

        const npcId = fileBuf.readUInt16LE(recOffset + 2);
        const count = fileBuf.readUInt8(recOffset + 4);
        const x = fileBuf.readUInt32LE(recOffset + 56);
        const y = fileBuf.readUInt32LE(recOffset + 60);

        if (!npcId || x <= 0 || y <= 0 || !npcMap[npcId]) continue;

        const key = `${mapId}:${npcId}:${x}:${y}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);

        const info = npcMap[npcId]!;
        const finalCount = Math.max(count || 1, npcMaxCount.get(npcId) || 1);
        spawns.push({
          mapId,
          mapName: mapNames[mapId] ?? `Bản đồ ${mapId}`,
          npcId,
          npcName: info.name,
          level: info.level,
          element: info.element,
          cs: info.cs,
          count: finalCount,
          x,
          y,
        });
      }
    }
  }

  // 3. Quét Method B: Nhận diện trực tiếp record 106-byte (cho tất cả các map không có chuỗi Npc0002)
  for (let pos = 0; pos + 106 <= fileBuf.length; pos++) {
    const npcId = fileBuf.readUInt16LE(pos + 2);
    if (!npcMap[npcId]) continue;
    const count = fileBuf.readUInt8(pos + 4);
    if (count < 1 || count > 10) continue;
    const x = fileBuf.readUInt32LE(pos + 56);
    const y = fileBuf.readUInt32LE(pos + 60);
    if (x < 50 || x > 4500 || y < 50 || y > 4500) continue;

    // Kiểm tra signature boundary tại pos+70 hoặc pos+74 (-20 = 0xecff)
    const mark1 = fileBuf.readInt16LE(pos + 70);
    const mark2 = fileBuf.readInt16LE(pos + 74);
    if (mark1 !== -20 && mark2 !== -20) continue;

    const key = `${mapId}:${npcId}:${x}:${y}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);

    const info = npcMap[npcId]!;
    const finalCount = Math.max(count || 1, npcMaxCount.get(npcId) || 1);
    spawns.push({
      mapId,
      mapName: mapNames[mapId] ?? `Bản đồ ${mapId}`,
      npcId,
      npcName: info.name,
      level: info.level,
      element: info.element,
      cs: info.cs,
      count: finalCount,
      x,
      y,
    });
  }
}

// Sắp xếp mặc định theo Map ID tăng dần, sau đó theo Level quái
spawns.sort((a, b) => a.mapId - b.mapId || a.level - b.level);

const jsonContent = JSON.stringify(spawns);
mkdirSync(dirname(outEngine), { recursive: true });
writeFileSync(outEngine, jsonContent, "utf8");

mkdirSync(dirname(outWeb), { recursive: true });
writeFileSync(outWeb, jsonContent, "utf8");

console.log(`Đã xuất ${spawns.length} bãi train:`);
console.log(`- Engine: ${outEngine} (${(jsonContent.length / 1024).toFixed(1)} KB)`);
console.log(`- Web:    ${outWeb}`);
