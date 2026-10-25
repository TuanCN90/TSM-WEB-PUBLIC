import names from "./data/mapNames.json";

const MAP_NAMES = names as Record<string, string>;

/** Tên bản đồ theo mapId (sinh bằng `npm run import-maps`). Không có → chuỗi rỗng. */
export const getMapNameById = (mapId: number): string => MAP_NAMES[String(mapId)] ?? "";
