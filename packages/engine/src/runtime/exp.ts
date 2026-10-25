import type { UnitState } from "@tsbot/protocol";
import table from "../data/expTable.json";

/** % EXP = hiện tại / mốc lên cấp × 100 (số thực, không làm tròn; UI tự định dạng 2 chữ số thập phân). */
export const expPercent = (cur: number, max: number): number => (max > 0 ? (cur / max) * 100 : 0);

/** Gán EXP nguyên (cur/max) vào đơn vị và tính lại `exp` (%). */
export const withExp = (u: UnitState, cur: number, max: number): UnitState => ({ ...u, expCur: cur, expMax: max, exp: expPercent(cur, max) });

/** Hàng bảng exp: [EXP lên cấp, EXP tích lũy]; index = level − 1. Turn 0..3 = curve "0".."3" (xem tools/import-exp-table.ts). */
type Curve = [number, number][];
const CURVES = table.curves as unknown as Record<string, Curve>;

/** Nhân vật: chuyển sinh 0..2 (Lv ≤ 200). Võ tướng: curve 0 (chưa CS) hoặc curve 1 (turn 2, công thức ^3.1). */
export const PLAYER_CURVES = ["0", "1", "2"] as const;
export const PET_CURVES = ["0", "1"] as const;

export interface ExpInfo { cur: number; max: number; curve: string }

/**
 * Server chỉ gửi EXP TÍCH LŨY (`raw`), không gửi turn. Với level L, đường cong đúng là đường có
 * tích lũy(L) ≤ raw < tích lũy(L) + EXP lên cấp(L+1); exp trong cấp = raw − tích lũy(L), mốc = EXP lên cấp(L+1).
 * Trả null nếu không đường nào khớp (level cap hoặc dữ liệu lệch) — không đoán.
 */
export function lookupExp(level: number, raw: number, candidates: readonly string[]): ExpInfo | null {
  for (const c of candidates) {
    const rows = CURVES[c];
    const here = rows?.[level - 1], next = rows?.[level];
    if (!here || !next) continue;
    const cur = raw - here[1];
    if (cur >= 0 && cur < next[0]) return { cur, max: next[0], curve: c };
  }
  return null;
}

/** Khoảng exp tích luỹ [lo, hi) của một level theo từng đường cong — dùng để dò gói chứa exp mới. */
export function expWindows(level: number, candidates: readonly string[]): { lo: number; hi: number; curve: string }[] {
  const out: { lo: number; hi: number; curve: string }[] = [];
  for (const c of candidates) {
    const here = CURVES[c]?.[level - 1], next = CURVES[c]?.[level];
    if (here && next) out.push({ lo: here[1], hi: here[1] + next[0], curve: c });
  }
  return out;
}
