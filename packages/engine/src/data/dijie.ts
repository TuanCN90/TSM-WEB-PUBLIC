/**
 * Mốc level Dị giới (thứ tự menu tool gốc) → mã trong `61/02`/`18/01` = vị trí 1-based.
 * Đã kiểm chứng: Lv.10/25/40/55/70 → 1/2/3/4/5. Lv.85…180 → 6…15 là suy ra theo thứ tự menu, chưa thử.
 */
export const DIJIE_LEVEL_LIST = [10, 25, 40, 55, 70, 85, 100, 110, 120, 130, 140, 150, 160, 170, 180] as const;

/** Mã mốc → "Lv.X" (không có trong bảng thì "mã N" để không đoán). */
export const dijieLevelLabel = (code: number) => (DIJIE_LEVEL_LIST[code - 1] ? `Lv.${DIJIE_LEVEL_LIST[code - 1]}` : `mã ${code}`);
