import doors from "../data/doors.json";
import warpGates from "../data/warpGates.json";
import doorCoordinates from "../data/doorCoordinates.json";

export interface Gate { id: number; city: string; map: string; x: number; y: number }
export interface Hop {
  from: number;
  to: number;
  door: number;
  coords?: { x: number; y: number };
}

export const GATES = warpGates as Gate[];
const GATE_BY_ID = new Map(GATES.map((g) => [g.id, g]));
const GRAPH = doors as unknown as Record<string, [number, number][]>;
const DOOR_COORDS = doorCoordinates as Record<string, Record<string, { x: number; y: number }>>;

export const gateById = (id: number) => GATE_BY_ID.get(id);

/** BFS theo số cổng phải đi qua; trả đường ngắn nhất `from → to` hoặc null nếu không có đường. */
export function shortestPath(from: number, to: number): Hop[] | null {
  if (from === to) return [];
  const prev = new Map<number, Hop>();
  const seen = new Set([from]);
  for (let queue = [from]; queue.length; ) {
    const next: number[] = [];
    for (const u of queue) {
      for (const [v, door] of GRAPH[String(u)] ?? []) {
        if (seen.has(v)) continue;
        seen.add(v);
        const coords = DOOR_COORDS[String(u)]?.[String(door)];
        prev.set(v, { from: u, to: v, door, coords });
        if (v === to) {
          const path: Hop[] = [];
          for (let x = to; x !== from; x = prev.get(x)!.from) path.unshift(prev.get(x)!);
          return path;
        }
        next.push(v);
      }
    }
    queue = next;
  }
  return null;
}

/** Cổng thành "gần nhất" tới map đích = cổng có ít cổng-chuyển-map nhất; hoà thì lấy cổng đứng trước trong menu Teleport. */
export function nearestGate(target: number): { gate: Gate; hops: Hop[] } | null {
  let best: { gate: Gate; hops: Hop[] } | null = null;
  for (const gate of GATES) {
    const hops = shortestPath(gate.id, target);
    if (hops && (!best || hops.length < best.hops.length)) best = { gate, hops };
  }
  return best;
}

export interface RoutePlan {
  type: "stay" | "gate" | "direct" | "gate_then_hops";
  gate?: Gate;
  hops: Hop[];
  totalSteps: number;
}

/**
 * Lập kế hoạch đường đi tối ưu tới map đích:
 * 1. Nếu đang ở đúng map đích -> "stay"
 * 2. Nếu map đích là 1 trong 41 Cổng thành -> "gate" (teleport 44/01 trực tiếp)
 * 3. So sánh tuyến đi trực tiếp từ map hiện tại (nếu cùng khu vực) vs tuyến nhảy cổng thành gần nhất:
 *    - Tuyến nào ít bước nhảy hơn thì ưu tiên chọn.
 */
export function planRoute(fromMap: number | undefined, targetMap: number): RoutePlan | null {
  if (fromMap === targetMap) {
    return { type: "stay", hops: [], totalSteps: 0 };
  }
  const destGate = gateById(targetMap);
  if (destGate) {
    return { type: "gate", gate: destGate, hops: [], totalSteps: 1 };
  }

  const directHops = fromMap ? shortestPath(fromMap, targetMap) : null;
  const near = nearestGate(targetMap);

  if (!directHops && !near) return null;

  // Nếu có đường trực tiếp và số hop <= số hop qua cổng thành + 1 (tiết kiệm chi phí teleport)
  if (directHops && (!near || directHops.length <= near.hops.length + 1)) {
    return { type: "direct", hops: directHops, totalSteps: directHops.length };
  }

  if (near) {
    return {
      type: "gate_then_hops",
      gate: near.gate,
      hops: near.hops,
      totalSteps: 1 + near.hops.length,
    };
  }

  return null;
}

/** Kiểm tra map có phải là map Dị giới (không thể teleport trực tiếp, phải thoát ra 12003 trước). */
export function isDijieMap(mapId?: number): boolean {
  if (!mapId) return false;
  return (mapId >= 10851 && mapId <= 10870) || mapId === 49942 || mapId === 49950;
}


/** Cổng thành "tương đương" với vị trí hiện tại: chính map đó nếu là cổng thành, ngược lại cổng gần nhất theo đồ thị cổng map. Dùng để đứng ở nơi an toàn (không gặp quái) trước khi tạo phòng phó bản. */
export function gateForMap(map: number): Gate | null {
  return gateById(map) ?? nearestGate(map)?.gate ?? null;
}

/**
 * Tìm toạ độ vị trí an toàn trong map hiện tại:
 * - Cách cổng vào của map một khoảng an toàn (khoảng 45-60px, không dẫm trúng cổng để tránh bị nhảy sang map khác).
 * - Ưu tiên cổng số 1 (cổng vào/cổng chính), hoặc cổng gần nhất với toạ độ hiện tại.
 * - Nếu là cổng thành (trong 41 warpGates), dùng toạ độ điểm đáp an toàn của cổng thành.
 */
export function getSafeSpotForMap(
  mapId: number,
  curX?: number,
  curY?: number,
  safeOffset = 55,
): { x: number; y: number } | null {
  if (!mapId) return null;

  const mapDoors = DOOR_COORDS[String(mapId)];
  if (mapDoors && Object.keys(mapDoors).length > 0) {
    let bestDoor: { x: number; y: number } | null = null;
    // Ưu tiên cổng số 1 (cổng vào thông dụng)
    if (mapDoors["1"] && mapDoors["1"].x > 0 && mapDoors["1"].y > 0) {
      bestDoor = mapDoors["1"];
    } else {
      // Hoặc cổng gần nhất với toạ độ hiện tại
      let minDist = Infinity;
      for (const d of Object.values(mapDoors)) {
        if (!d || d.x <= 0 || d.y <= 0) continue;
        const dist = curX && curY ? Math.hypot(d.x - curX, d.y - curY) : 0;
        if (dist < minDist) {
          minDist = dist;
          bestDoor = d;
        }
      }
    }

    if (bestDoor) {
      const dx = (curX ?? 0) - bestDoor.x;
      const dy = (curY ?? 0) - bestDoor.y;
      const dist = Math.hypot(dx, dy);

      // Nếu người chơi đang ở xa cổng (> 25px) và có toạ độ hợp lệ: lùi theo vector từ cổng hướng về phía người chơi
      if (dist > 25 && curX && curY && curX > 0 && curY > 0) {
        return {
          x: Math.round(bestDoor.x + (dx / dist) * safeOffset),
          y: Math.round(bestDoor.y + (dy / dist) * safeOffset),
        };
      }

      // Nếu người chơi đang đứng sát cổng (<= 25px) hoặc chưa có toạ độ: lùi vào phía trong map
      const offsetX = bestDoor.x > 1000 ? -safeOffset : safeOffset;
      const offsetY = bestDoor.y > 1000 ? -safeOffset : safeOffset;
      return {
        x: Math.round(bestDoor.x + offsetX),
        y: Math.round(bestDoor.y + offsetY),
      };
    }
  }

  // Nếu là một trong 41 Cổng thành (warpGates)
  const gate = gateById(mapId);
  if (gate && gate.x > 0 && gate.y > 0) {
    return { x: gate.x, y: gate.y };
  }

  return null;
}
