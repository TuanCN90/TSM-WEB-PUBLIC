/** Contract dùng chung giữa Engine, Server và Web UI. Chỉ chứa type, không có runtime. */

export type LogLevel = "debug" | "info" | "warn" | "error";
/** `game` = sự kiện game đã dịch sang dạng dễ đọc (tab "Sự kiện" trên UI). */
export type LogSource = "conn" | "script" | "action" | "game";

export interface Diagnostic {
  line: number;
  severity: "error" | "warning";
  message: string;
}

export interface ScriptMeta {
  /** Đường dẫn tương đối, bỏ đuôi .ini, dùng "/" (vd "Config/auto boss"). */
  id: string;
  name: string;
  group: string;
  size: number;
  mtime: number;
  /** Chỉ có ở danh sách kịch bản chạy được: id đã gồm tiền tố "custom:" nếu là script tự tạo đã duyệt. */
  source?: "base" | "custom";
}
export interface ScriptFile extends ScriptMeta {
  content: string;
}

export interface Account {
  /** Tự sinh từ server + user nếu không truyền. */
  id: string;
  server: string;
  username: string;
  /** Chỉ gửi lên khi tạo/sửa; server không bao giờ trả lại. */
  password?: string;
  hasPassword?: boolean;
  note?: string;
  defaultScript?: string;
}

export interface Settings {
  /** Giới hạn số kết nối (nhân vật online) song song. */
  maxSessions: number;
  defaultTransport: string;
  /** Hệ số tua nhanh thời gian chờ của script/mock (1 = thời gian thực). */
  speed: number;
  logLevel: LogLevel;
  commandTimeoutMs: number;
  heartbeatMs: number;
  autoReconnect: boolean;
  maxReconnect: number;
  /** Codec giao thức cho transport "socket". */
  socketCodec: string;
  /** Tự động điểm danh ngày ngay sau mỗi lần đăng nhập thành công (mặc định bật). */
  autoCheckin: boolean;
}

/* ---------- Kết nối (stateful) ---------- */
export type ConnectionState = "offline" | "connecting" | "online" | "reconnecting" | "disconnecting";
export type ScriptState = "idle" | "running" | "paused" | "stopping" | "completed" | "stopped" | "error";

/** Thanh chỉ số dạng hiện tại / tối đa. */
export interface Gauge {
  cur: number;
  max: number;
}

/** Nhân vật hoặc võ tướng (pet). `exp` là phần trăm 0..100. */
/** Hệ của nhân vật/võ tướng (thứ tự game: 1 Địa, 2 Thủy, 3 Hỏa, 4 Phong, 5 Tâm, 6 Quang, 7 Ám; 0 = Vô hệ → bỏ trống). */
export type Element = "earth" | "water" | "fire" | "wind" | "heart" | "light" | "dark";

export interface UnitState {
  name: string;
  /** Hệ (chưa giải mã từ packet thì để trống). */
  element?: Element;
  level: number;
  hp: Gauge;
  sp: Gauge;
  exp: number;
  /** EXP hiện tại / mốc lên cấp kế tiếp (số nguyên). Có đủ cả hai thì `exp` = cur/max×100. */
  expCur?: number;
  expMax?: number;
}

export interface PartyMember {
  /** 1..5 (slot 1 = chủ PT, 2..5 = thành viên theo thứ tự server gửi). `name` rỗng = slot trống. */
  slot: number;
  name: string;
  isLeader: boolean;
  isAdvisor: boolean;
  /** UID hex 16 ký tự (chỉ có khi slot có người). */
  uid?: string;
  isSelf?: boolean;
}

export interface PartyState {
  members: PartyMember[];
  /** Trạng thái lời mời đội gần nhất ("" = không có). */
  inviteStatus: string;
  /** Mình đang ở trong 1 đội thật (≥ 2 người) theo gói server 0d/05, 0d/06. */
  joined?: boolean;
  /** Tên chủ PT của đội đang ở (rỗng nếu chưa vào đội). */
  leaderName?: string;
}

/** Vai trò trong tính năng lập đội giữa các tài khoản của web. */
export type PartyRole = "leader" | "member";

/** Cấu hình lập đội của 1 tài khoản (lưu data/party-configs.json, khoá canonicalKey). */
export interface PartyConfig {
  /** Bật tự động lập đội (mời/xin/chấp nhận) + đồng bộ warp theo chủ PT. */
  enabled: boolean;
  role: PartyRole;
  /** Vai trò member: tên nhân vật chủ PT cần xin vào. */
  leaderName: string;
  /** Vai trò leader: tối đa 4 tên thành viên; `advisor` = được tick QSư. */
  members: { name: string; advisor: boolean }[];
  /** Tự động bỏ chạy khi vào trận mà chưa đủ thành viên đã cấu hình (Ưu tiên Bậc 2) */
  escapeIfNotFullParty?: boolean;
}

/**
 * Trạng thái xử lý của từng tên trong kế hoạch lập đội (server tính, hiển thị thành tag trên UI).
 *  idle: chưa bật · not_in_map: chưa thấy trong map của chủ PT · inviting/requesting: đã gửi mời/xin, chờ đối phương ·
 *  in_party: đã vào đội thành công · advisor: đã vào đội + là Quân sư · advisor_pending: cần gán QSư nhưng chưa gán được · offline: tài khoản đang offline/chưa đăng nhập web
 */
export type PartyEntryStatus = "idle" | "offline" | "not_in_map" | "inviting" | "requesting" | "in_party" | "advisor" | "advisor_pending" | "error";

export interface PartyPlanEntry {
  name: string;
  advisor: boolean;
  status: PartyEntryStatus;
  detail?: string;
}

/** Trạng thái kế hoạch lập đội gắn vào CharacterState (server điền, không phải engine). */
export interface PartyPlanState {
  enabled: boolean;
  role: PartyRole;
  /** Member: tên chủ PT. */
  leaderName: string;
  /** Member: đã vào đúng đội của chủ PT chưa. Leader: tất cả thành viên đã vào đội. */
  complete: boolean;
  /** Member: trạng thái so với chủ PT. */
  selfStatus?: PartyEntryStatus;
  /** Leader: trạng thái từng thành viên khai báo. */
  entries: PartyPlanEntry[];
  /** Dòng tóm tắt cho UI ("Đã đủ đội 5/5", "Chờ BaiFine vào map…"). */
  message: string;
  /** Leader: đang chờ gom đội trước khi đi bộ (đồng bộ warp). */
  gathering?: boolean;
}

/* ------------------------- Phó bản đội (xem docs/DUNGEON_TEAM_KNOWLEDGE.md) ------------------------- */

export type DungeonTeamRole = "leader" | "member";

/**
 * Danh mục phó bản đội gửi bằng `2f/02 00 <id> 00 <cờ mật khẩu>`.
 * `verified` = đã thấy trong pcap thật (chupt_pbteam.pcap); còn lại chỉ có trong script TSM (chưa kiểm chứng).
 */
export interface DungeonRoomDef {
  id: number;
  name: string;
  /** Tên gọi quen thuộc của người chơi dùng trong thông báo (vd "Thảo phạt khăn vàng"). */
  shortName?: string;
  /** Map phó bản sau khi bắt đầu (đổi map ⇒ bot biết đã vào phó bản). */
  map?: number;
  verified: boolean;
  /**
   * Các checkpoint trong map phó bản, CHỈ chủ phòng chạy lần lượt (mỗi checkpoint một script DSL). Giữa hai checkpoint server kiểm tra đội còn đủ
   * thành viên (đồng bộ với đội ngũ ở tab thông tin chung) — có người mất kết nối thì dừng, không xử lý checkpoint kế tiếp.
   */
  steps?: { name: string; script: string }[];
}
/** Lộ trình Thảo Phạt Thiên Sứ lấy từ script TSM `Script/Config/auto thao phat thien su.ini`, tách từng checkpoint (mỗi `warp_id` lặp 2 lần: lần đầu có thể bị trận chen ngang). */
const THIEN_SU_STEPS: { name: string; script: string }[] = [1, 2, 3].map((n) => {
  const [x, y] = ({ 1: [50, 780], 2: [470, 700], 3: [730, 560] } as Record<number, [number, number]>)[n]!;
  return { name: `Cổng ${n}`, script: ["auto 1", ...(n === 1 ? ["sleep 2000"] : []), `warp_id ${n},62002,${x},${y}`, `warp_id ${n},62002,${x},${y}`].join("\n") };
});
THIEN_SU_STEPS.push({
  name: "Trương Giác",
  // NPC 20 = Trương Giác (590,340). Client thật (pcap completed_phoban_khanvang_chupt) đi tới (650,390), CHỜ ~12s cho NPC hiển thị rồi `20/02 00 08` + `14/01 00 14 00`
  // → 2 câu thoại (ack ~1.2s) → trận cuối → thắng ⇒ 10 câu/kết quả cần ack → `2f/0c` (hoàn thành) → `14/08 00 2a`.
  script: ["auto 1", "click_boss 20,62002,650,390", "await_battle", "sleep 8000", "end_event"].join("\n"),
});
/**
 * Ngày Tàn Hoạn Quan (map 62011 "Ngày tàn của Thập Thường thị", id phòng 14) — ĐÃ GIẢI MÃ từ pcap chủ phòng hoàn thành `phobandoi_02_chupt_hoantat.pcap`:
 * 4 chặng, mỗi chặng đứng ở điểm cap → bấm NPC (thoại → trận → kết quả) → cổng. Cổng 2/4/6 là DỊCH CHUYỂN nội bộ (server đặt lại vị trí `0c/00`, không thoại/trận):
 * sau cổng 2 vị trí (1530,2070), sau cổng 4 (630,750), sau cổng 6 (2290,530); cổng 8 mở chuỗi thoại → trận (không đổi vị trí). Điểm đứng/nhấn cổng lấy từ cap:
 * NPC 1 (470,2930) · cổng 2 (550,2850) · NPC 5 (470,1970) · cổng 4 (110,1910) · NPC 20 (670,390) · cổng 8 (1070,670) · cổng 6 (1228,794) · NPC 31 (2610,290).
 * Chặng cuối kết thúc bằng `2f/0c` S→C (hoàn thành). Script TSM tương ứng: `Config/auto ngay tan hoan quan.ini` (move 426 2925 / click 1 / warp_id 2 / …).
 */
const NGAY_TAN_STEPS: { name: string; script: string }[] = [
  { name: "NPC 1 → cổng 2", script: ["auto 1", "click 1,62011,470,2930", "warp_id 2,62011,550,2850"].join("\n") },
  { name: "NPC 5 → cổng 4", script: ["auto 1", "click 5,62011,470,1970", "warp_id 4,62011,110,1910"].join("\n") },
  { name: "NPC 20 → cổng 8 → cổng 6", script: ["auto 1", "click 20,62011,670,390", "warp_id 8,62011,1070,670", "warp_id 6,62011,1228,794"].join("\n") },
  { name: "NPC 31 (chặng cuối)", script: ["auto 1", "click 31,62011,2610,290"].join("\n") },
];
export const DUNGEON_ROOM_CATALOG: DungeonRoomDef[] = [
  { id: 1, name: "Thảo Phạt Thiên Sứ", shortName: "Thảo phạt khăn vàng", map: 62002, verified: true, steps: THIEN_SU_STEPS },
  { id: 14, name: "Ngày Tàn Hoạn Quan", shortName: "Ngày tàn hoạn quan", map: 62011, verified: true, steps: NGAY_TAN_STEPS },
];

/* ---------------- PHÓ BẢN ĐƠN (Solo Dungeon: 3 loại theo TSM / Pim-Bot / game gốc) ---------------- */
export type DungeonSoloType = "khieu_chien" | "san_kho_bau" | "tim_dau_dau" | "all";

export interface DungeonSoloDef {
  id: number;
  type: "khieu_chien" | "san_kho_bau" | "tim_dau_dau";
  typeName: string;
  name: string;
  bracket: 1 | 2 | 3 | 4;
  bracketLabel: string;
  minLv: number;
  maxLv: number;
  map: number;
  door: number;
  script: string;
}

export const DUNGEON_SOLO_CATALOG: DungeonSoloDef[] = [
  // 1. Khiêu chiến Ba Đậu Yêu (id 2..5, map 62001, các cửa 1..4 tương ứng 4 mốc cấp)
  {
    id: 2,
    type: "khieu_chien",
    typeName: "Khiêu chiến Ba Đậu Yêu",
    name: "Khiêu chiến Ba Đậu Yêu (15-80)",
    bracket: 1,
    bracketLabel: "Cấp 15 – 80",
    minLv: 15,
    maxLv: 80,
    map: 62001,
    door: 1,
    script: ["auto 1", "warp_id 1", "await_battle", "end_event"].join("\n"),
  },
  {
    id: 3,
    type: "khieu_chien",
    typeName: "Khiêu chiến Ba Đậu Yêu",
    name: "Khiêu chiến Ba Đậu Yêu (81-150)",
    bracket: 2,
    bracketLabel: "Cấp 81 – 150",
    minLv: 81,
    maxLv: 150,
    map: 62001,
    door: 2,
    script: ["auto 1", "warp_id 2", "await_battle", "end_event"].join("\n"),
  },
  {
    id: 4,
    type: "khieu_chien",
    typeName: "Khiêu chiến Ba Đậu Yêu",
    name: "Khiêu chiến Ba Đậu Yêu (151-200)",
    bracket: 3,
    bracketLabel: "Cấp 151 – 200",
    minLv: 151,
    maxLv: 200,
    map: 62001,
    door: 3,
    script: ["auto 1", "warp_id 3", "await_battle", "end_event"].join("\n"),
  },
  {
    id: 5,
    type: "khieu_chien",
    typeName: "Khiêu chiến Ba Đậu Yêu",
    name: "Khiêu chiến Ba Đậu Yêu (201-400)",
    bracket: 4,
    bracketLabel: "Cấp 201 – 400",
    minLv: 201,
    maxLv: 450,
    map: 62001,
    door: 4,
    script: ["auto 1", "warp_id 4", "await_battle", "end_event"].join("\n"),
  },

  // 2. Tìm bảo rương (Săn Kho Báu, id 6..9, maps 62003..62006, door 1, click 3 rương theo TSM script)
  {
    id: 6,
    type: "san_kho_bau",
    typeName: "Tìm bảo rương",
    name: "Tìm bảo rương (15-80)",
    bracket: 1,
    bracketLabel: "Cấp 15 – 80",
    minLv: 15,
    maxLv: 80,
    map: 62003,
    door: 1,
    script: ["auto 1", "warp_id 1", "move 3030 1510", "click 5", "move 2810 190", "click 7", "move 250 2310", "click 3", "sleep 2000", "end_event"].join("\n"),
  },
  {
    id: 7,
    type: "san_kho_bau",
    typeName: "Tìm bảo rương",
    name: "Tìm bảo rương (81-150)",
    bracket: 2,
    bracketLabel: "Cấp 81 – 150",
    minLv: 81,
    maxLv: 150,
    map: 62004,
    door: 1,
    script: [
      "auto 1",
      "warp_id 1",
      "move 270 2310",
      "click 1",
      "move 2810 1670",
      "click 3",
      "move 3810 210",
      "click 5",
      "sleep 2000",
      "end_event",
    ].join("\n"),
  },
  {
    id: 8,
    type: "san_kho_bau",
    typeName: "Tìm bảo rương",
    name: "Tìm bảo rương (151-200)",
    bracket: 3,
    bracketLabel: "Cấp 151 – 200",
    minLv: 151,
    maxLv: 200,
    map: 62005,
    door: 1,
    script: ["auto 1", "warp_id 1", "move 2810 180", "click 1", "move 1950 1460", "click 3", "move 3930 2900", "click 5", "sleep 2000", "end_event"].join("\n"),
  },
  {
    id: 9,
    type: "san_kho_bau",
    typeName: "Tìm bảo rương",
    name: "Tìm bảo rương (201-400)",
    bracket: 4,
    bracketLabel: "Cấp 201 – 400",
    minLv: 201,
    maxLv: 450,
    map: 62006,
    door: 1,
    script: ["auto 1", "warp_id 1", "move 390 170", "click 1", "move 2210 2910", "click 3", "move 3730 2930", "click 5", "sleep 2000", "end_event"].join("\n"),
  },

  // 3. Tìm Ba Đậu Yêu (Tìm Đậu Đậu, id 10..13, maps 62007..62010, door 1, click 3 Đậu Đậu theo TSM script)
  {
    id: 10,
    type: "tim_dau_dau",
    typeName: "Tìm Ba Đậu Yêu",
    name: "Tìm Ba Đậu Yêu (15-80)",
    bracket: 1,
    bracketLabel: "Cấp 15 – 80",
    minLv: 15,
    maxLv: 80,
    map: 62007,
    door: 1,
    script: ["auto 1", "warp_id 1", "move 210 260", "click 2", "move 1310 420", "click 3", "move 810 1120", "click 4", "sleep 2000", "end_event"].join("\n"),
  },
  {
    id: 11,
    type: "tim_dau_dau",
    typeName: "Tìm Ba Đậu Yêu",
    name: "Tìm Ba Đậu Yêu (81-150)",
    bracket: 2,
    bracketLabel: "Cấp 81 – 150",
    minLv: 81,
    maxLv: 150,
    map: 62008,
    door: 1,
    script: [
      "auto 1",
      "warp_id 1",
      "move 210 260",
      "click 2",
      "move 1290 440",
      "click 3",
      "move 50 980",
      "click 4",
      "sleep 2000",
      "end_event",
    ].join("\n"),
  },
  {
    id: 12,
    type: "tim_dau_dau",
    typeName: "Tìm Ba Đậu Yêu",
    name: "Tìm Ba Đậu Yêu (151-200)",
    bracket: 3,
    bracketLabel: "Cấp 151 – 200",
    minLv: 151,
    maxLv: 200,
    map: 62009,
    door: 1,
    script: ["auto 1", "warp_id 1", "move 210 260", "click 2", "move 1290 440", "click 3", "move 50 980", "click 4", "sleep 2000", "end_event"].join("\n"),
  },
  {
    id: 13,
    type: "tim_dau_dau",
    typeName: "Tìm Ba Đậu Yêu",
    name: "Tìm Ba Đậu Yêu (201-400)",
    bracket: 4,
    bracketLabel: "Cấp 201 – 400",
    minLv: 201,
    maxLv: 450,
    map: 62010,
    door: 1,
    script: ["auto 1", "warp_id 1", "move 210 260", "click 2", "move 1290 440", "click 3", "move 50 980", "click 4", "sleep 2000", "end_event"].join("\n"),
  },
];

export function getSoloDungeonDef(type: "khieu_chien" | "san_kho_bau" | "tim_dau_dau", level: number, bracket = 0): DungeonSoloDef | undefined {
  if (bracket >= 1 && bracket <= 4) {
    return DUNGEON_SOLO_CATALOG.find((d) => d.type === type && d.bracket === bracket);
  }
  const lv = Math.max(1, level);
  return (
    DUNGEON_SOLO_CATALOG.find((d) => d.type === type && lv >= d.minLv && lv <= d.maxLv) ??
    DUNGEON_SOLO_CATALOG.find((d) => d.type === type && d.bracket === 1)
  );
}

export type DungeonSoloPhase =
  | "idle"
  | "leaving_party"
  | "warping"
  | "creating_room"
  | "entering"
  | "in_dungeon"
  | "done"
  | "error";

export interface DungeonSoloConfig {
  enabled: boolean;
  type: DungeonSoloType;
  bracket: number; // 0 = tự động theo cấp, 1 = 15-80, 2 = 81-150, 3 = 151-200, 4 = 201-400
  leaveParty: boolean;
}

export interface DungeonSoloResult {
  type: "khieu_chien" | "san_kho_bau" | "tim_dau_dau";
  name: string;
  durationSec: number;
  completedAt: number;
  playerExpGained: number;
  playerExpPercent: number;
  petExpGained: number;
  petExpPercent: number;
}

export interface DungeonSoloState {
  phase: DungeonSoloPhase;
  currentType?: "khieu_chien" | "san_kho_bau" | "tim_dau_dau";
  currentDungeonId?: number;
  completedTypes: ("khieu_chien" | "san_kho_bau" | "tim_dau_dau")[];
  results?: DungeonSoloResult[];
  message: string;
  phaseAt: number;
  canRun?: boolean;
}

/** Một phòng trong danh sách phòng phó bản đội đang chờ (S→C 2f/01). */
export interface DungeonRoomInfo {
  roomId: number;
  /** Tên chủ phòng (Big5 → chuỗi). */
  leaderName: string;
  /** Id phó bản (DUNGEON_ROOM_CATALOG) — byte thứ 2 của đuôi bản ghi. */
  dungeonId: number;
  /** Số người đang trong phòng (byte cuối đuôi bản ghi: 1 khi chỉ có chủ, 4 khi đã có 4 người) — suy từ pcap + log thật. */
  count: number;
}

/** Trạng thái phòng phó bản đội của chính nhân vật (từ gói S→C 2f/01, 2f/02, 2f/03, 2f/0a, 2f/0b). */
export type DungeonRoomStatus = "none" | "open" | "joined" | "cancelled" | "left" | "completed" | "error";
export interface DungeonRoomState {
  status: DungeonRoomStatus;
  /** Mật khẩu do server cấp khi tạo phòng có mật khẩu (vd "4010"). */
  password?: string;
  /** Mã lỗi server (byte kết quả ≠ 0) khi status = error. */
  code?: number;
  /** Phòng đã vào (thành viên). */
  roomId?: number;
  /** Đã bấm "Sẵn sàng" (2f/0b). */
  ready?: boolean;
  /** Danh sách phòng đang chờ lần làm mới gần nhất. */
  rooms?: DungeonRoomInfo[];
}

export interface DungeonTeamConfig {
  /** Bật điều phối phó bản đội cho tài khoản này (leader: tạo phòng → bắt đầu; member: tự vào phòng của leader). */
  enabled: boolean;
  role: DungeonTeamRole;
  /** Member: tên nhân vật chủ phòng. */
  leaderName: string;
  /** Leader: tối đa 4 tên thành viên cần có mặt (online, cùng map) trước khi tạo phòng. */
  members: string[];
  /** Member: mật khẩu phòng (chỉ khi chủ phòng là client thật/ngoài web; chủ phòng là bot thì lấy tự động). Layout gói có mật khẩu chưa kiểm chứng. */
  joinPassword: string;
  /** Leader: id phó bản; Member: loại phó bản cần tìm (DUNGEON_ROOM_CATALOG). */
  dungeonId: number;
  /** Tạo phòng CÓ mật khẩu (server tự cấp mã, gửi cờ 01). Không mật khẩu = cờ 00. */
  usePassword: boolean;
  /** Rời đội trước khi tạo/vào phòng (Pim-Bot: WaitPartyLeaveBeforeDungeonJoin). */
  leaveParty: boolean;
}

export type DungeonTeamPhase =
  | "idle"
  | "warping"
  | "searching"
  | "waiting_members"
  | "leaving_party"
  | "creating_room"
  | "room_open"
  | "starting"
  | "in_dungeon"
  | "done"
  | "blocked"
  | "error";

export interface DungeonTeamMemberState {
  name: string;
  status: "offline" | "not_in_map" | "ready" | "in_room";
  detail?: string;
}

/** Trạng thái điều phối phó bản đội gắn vào CharacterState (server điền). */
export interface DungeonTeamState {
  /** Leader: đang trong một phiên (từ bấm "Tạo" đến xong/huỷ). Member: đã bật sẵn sàng. */
  enabled: boolean;
  role: DungeonTeamRole;
  phase: DungeonTeamPhase;
  /** Gói THÀNH VIÊN VÀO phòng (2f/03) đã có pcap chưa. false ⇒ có thành viên thì bot dừng ở `blocked`. */
  protocolReady: boolean;
  /** Leader: cổng thành đã/đang warp tới để tạo phòng (tránh trận đấu quấy nhiễu). */
  gate?: { id: number; city: string };
  /** Leader: được phép bấm "Bắt đầu" (phòng đã mở và đủ thành viên). */
  canStart: boolean;
  /** Leader: trạng thái từng thành viên. */
  members: DungeonTeamMemberState[];
  /** Mật khẩu phòng hiện tại (nếu có) để chia sẻ cho thành viên. */
  password?: string;
  message: string;
}

export interface Economy {
  xu: number;
  gold: number;
}

export type ChannelStatus = "free" | "busy" | "full";

export interface MapChannelInfo {
  id: number;
  name: string;
  status: ChannelStatus;
  cur?: number;
  max?: number;
}

export interface LocationState {
  map: number;
  x: number;
  y: number;
  /** Chỉ số kênh (0-based; UI hiển thị "Kênh n+1"). */
  channel: number;
  /** Danh sách kênh và trạng thái trong map hiện tại (trống, đông, đầy). */
  channels?: MapChannelInfo[];
}

/** Toàn bộ trạng thái nhân vật do transport báo (mock hoặc đọc packet thật). */
/** Một ô trong túi đồ (gói 17/05, cập nhật 17/08). */
export interface BagItem { slot: number; id: number; qty: number }

/** Một võ tướng trong tổ đội (danh sách `0f/08`). `idx` = số thứ tự 1..n trong túi võ tướng, `model` = id gửi trong packet. */
/** Chỉ số võ tướng đọc từ `0f/08` (6 u16 sau SP theo thứ tự int, atk, def, hp, sp, agi + `fai` = byte độ trung thành). */
export interface PetStats { int: number; atk: number; def: number; hp: number; sp: number; agi: number; fai: number }

/** Điểm cộng từ trang bị (khối chỉ số trong `05/03` của nhân vật, dùng chung cho võ tướng). */
export interface PetBonus { int: number; atk: number; def: number; agi: number }

export interface PetInfo extends UnitState {
  stats?: PetStats;
  /** Điểm cộng từ đồ (int/atk/def/agi); hp/sp = 0. Điểm cộng từ thẻ bài chưa đọc được. */
  gear?: PetBonus;
  idx: number;
  model: number;
  /** true = đang xuất chiến (chỉ có tối đa 1 võ tướng). */
  active: boolean;
}

/** Bảng giá nhận Exp Offline (gói `57/03`): % exp và chi phí từng lựa chọn. `minutes` suy ra = Xu cần trả (1 Xu/phút). */
export interface OfflineExpInfo {
  freePct: number;
  xuPct: number; xuCost: number;
  goldPct: number; goldCost: number;
  minutes: number;
}

/** Một ô trang bị đang mặc (gói `17/0b`): thứ tự 0..4 = mũ/khăn, giáp, vũ khí, hộ uyển, ủng (theo mô tả vật phẩm). */
export interface EquipSlot { slot: number; id: number }

export interface SkillInfo {
  id: number;
  name: string;
  desc?: string;
  level?: number;
  sp?: number;
}

export interface BattleSlotDef {
  slotId: number;
  label: string;
  side: "enemy" | "pet" | "player";
  row: number;
  col: number;
}

export const BATTLE_TARGET_F1 = "F1";

export const BATTLE_SLOTS_DEF: BattleSlotDef[] = [
  // 10 Vị trí Phe Địch: Hàng sau (row 1, col 0..4), Hàng trước (row 0, col 0..4)
  { slotId: 1, label: "(1,0)", side: "enemy", row: 1, col: 0 },
  { slotId: 2, label: "(1,1)", side: "enemy", row: 1, col: 1 },
  { slotId: 3, label: "(1,2)", side: "enemy", row: 1, col: 2 },
  { slotId: 4, label: "(1,3)", side: "enemy", row: 1, col: 3 },
  { slotId: 5, label: "(1,4)", side: "enemy", row: 1, col: 4 },

  { slotId: 6, label: "(0,0)", side: "enemy", row: 0, col: 0 },
  { slotId: 7, label: "(0,1)", side: "enemy", row: 0, col: 1 },
  { slotId: 8, label: "(0,2)", side: "enemy", row: 0, col: 2 },
  { slotId: 9, label: "(0,3)", side: "enemy", row: 0, col: 3 },
  { slotId: 10, label: "(0,4)", side: "enemy", row: 0, col: 4 },

  // 10 Vị trí Phe Ta: Hàng trước (Võ tướng / Pet, row 2, col 0..4), Hàng sau (Nhân vật / Team, row 3, col 0..4)
  { slotId: 11, label: "(2,0)", side: "pet", row: 2, col: 0 },
  { slotId: 12, label: "(2,1)", side: "pet", row: 2, col: 1 },
  { slotId: 13, label: "(2,2)", side: "pet", row: 2, col: 2 },
  { slotId: 14, label: "(2,3)", side: "pet", row: 2, col: 3 },
  { slotId: 15, label: "(2,4)", side: "pet", row: 2, col: 4 },

  { slotId: 16, label: "(3,0)", side: "player", row: 3, col: 0 },
  { slotId: 17, label: "(3,1)", side: "player", row: 3, col: 1 },
  { slotId: 18, label: "(3,2)", side: "player", row: 3, col: 2 },
  { slotId: 19, label: "(3,3)", side: "player", row: 3, col: 3 },
  { slotId: 20, label: "(3,4)", side: "player", row: 3, col: 4 },
];

export interface BattleActionConfig {
  type: "attack" | "defend" | "escape" | "catch" | "skill" | "item" | "summon";
  skillId: number;
  /** Vị trí mục tiêu: "F1" (tự động - mặc định) hoặc slotId "1".."20" hoặc toạ độ "(row,col)" */
  target?: string;
  /** Dùng cho action "item": ID vật phẩm hoặc ô túi */
  itemId?: number;
  itemSlot?: number;
  itemName?: string;
  /** Dùng cho action "summon": Model của võ tướng cần xuất chiến */
  petModel?: number;
  petName?: string;
}

export interface BattleTurnConfig {
  turn: number; // 1 .. 21
  playerAction: BattleActionConfig;
  petAction: BattleActionConfig;
}

export interface BattleConfig {
  playerAction: BattleActionConfig;
  petAction: BattleActionConfig;
  autoFight: boolean;
  /** Tự động bỏ chạy khi vào trận (Ưu tiên Bậc 1) */
  autoEscape?: boolean;
  /** Chế độ chiến thuật: "default" (chỉ dùng mặc định) hoặc "turns" (đánh theo 21 turn) */
  strategyMode?: "default" | "turns";
  /** Danh sách cấu hình theo turn (1 .. 21). Vượt quá turn 21 sẽ tự động loop lại từ turn 1. */
  turns?: BattleTurnConfig[];
  /** Turn hiện tại trong trận đấu (1, 2, ...) */
  currentTurn?: number;
}

export interface BattleUnit {
  col: number;
  row: number;
  name: string;
  level: number;
  hp: { cur: number; max: number };
  sp: { cur: number; max: number };
  isEnemy: boolean;
  isPet?: boolean;
  /** UID (hex) của người chơi sở hữu đơn vị đồng minh (nhân vật = uid chính nó, võ tướng = uid chủ) — để mỗi client chỉ ra lệnh cho đơn vị CỦA MÌNH. */
  owner?: string;
}

export interface CharacterState {
  player: UnitState;
  /** Võ tướng đang xuất chiến; không có ai xuất chiến thì rỗng (name = ""). */
  pet: UnitState;
  /** Toàn bộ võ tướng mang theo (tổ đội cá nhân) kèm trạng thái xuất chiến/nghỉ. */
  pets?: PetInfo[];
  /** Bảng giá Exp Offline (cập nhật khi login và khi gửi `offline_exp_info`). */
  offlineExp?: OfflineExpInfo;
  /** Điểm tiềm năng chưa cộng (`05/03` u16@35). */
  point?: number;
  /** Điểm cộng từ trang bị của nhân vật (`08/01` mã 0x1d2 atk, 0x1d3 def, 0x1d4 int, 0x1d6 agi). */
  gear?: PetBonus;
  /** Trang bị đang mặc (`17/0b`). */
  equipment?: EquipSlot[];
  economy: Economy;
  party: PartyState;
  location: LocationState;
  inBattle: boolean;
  auto: boolean;
  /** Túi đồ cá nhân, sắp theo số ô. */
  bag: BagItem[];
  /** Thùng đồ Tiền Trang (gói 17/66). */
  bank?: BagItem[];
  /** Đang có phiên kho Tiền Trang mở với NPC (chỉ khi đó mới gửi/rút được). */
  bankOpen?: boolean;
  /** Cấu hình hành động trong trận đấu của nhân vật & pet. */
  battleConfig?: BattleConfig;
  /** Danh sách kỹ năng nhân vật đã học (`05/03`). */
  playerSkills?: SkillInfo[];
  /** Danh sách kỹ năng của võ tướng xuất chiến. */
  petSkills?: SkillInfo[];
  /** Các đơn vị trong trận đấu hiện tại. */
  battleUnits?: BattleUnit[];
  /** Cấu hình chế độ tự động truy kích quái/NPC tại tọa độ bãi train. */
  chaseConfig?: ChaseConfig;
  /** Kế hoạch lập đội giữa các tài khoản (server điền). */
  partyPlan?: PartyPlanState;
  /** Kế hoạch phó bản đội (server điền). */
  dungeonTeam?: DungeonTeamState;
  /** Trạng thái phó bản đơn (server điền). */
  dungeonSolo?: DungeonSoloState;
  /** Phòng phó bản đội của chính nhân vật (engine điền từ gói 2f/xx). */
  dungeonRoom?: DungeonRoomState;
}

export interface ChaseConfig {
  enabled: boolean;
  mapId: number;
  originX: number;
  originY: number;
  maxRadius: number; // Khoảng cách tối đa (px) từ NPC tới tọa độ gốc (mặc định 150px)
  npcId?: number;
  npcName?: string;
  autoReturn: boolean; // Tự động quay về tọa độ gốc sau trận đấu
}

export interface StepInfo {
  line: number;
  cmd: string;
  args: string[];
}

export interface ScriptRunInfo {
  state: ScriptState;
  scriptId?: string;
  step?: StepInfo;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  /** Có khi đang chạy hàng đợi nhiều script: vị trí hiện tại (1-based), tổng và tên theo thứ tự. */
  queue?: { index: number; total: number; names: string[] };
}

export interface ConnectionInfo {
  /** Mỗi tài khoản có tối đa 1 kết nối. */
  accountId: string;
  transport: string;
  speed: number;
  state: ConnectionState;
  error?: string;
  reconnectAttempt?: number;
  connectedAt?: number;
  lastHeartbeat?: number;
  script: ScriptRunInfo;
}

export interface LogEntry {
  seq: number;
  ts: number;
  level: LogLevel;
  src: LogSource;
  msg: string;
  line?: number;
}

export interface LoginBody {
  transport?: string;
  speed?: number;
}
/** Đăng nhập nhanh: server cố định ở backend, UI chỉ gửi tài khoản + mật khẩu. */
export interface SessionLoginBody {
  username: string;
  password: string;
}
export interface SessionLoginResult {
  accountId: string;
  connection: ConnectionInfo;
}
export interface RunQueueBody {
  scriptIds: string[];
  vars?: Record<string, string>;
}
export interface RunScriptBody {
  scriptId: string;
  vars?: Record<string, string>;
}
export type ScriptControl = "pause" | "resume" | "stop";

/* ---------- Live actions (lệnh trực tiếp cho kết nối đang online) ---------- */
export interface LiveParamDef {
  name: string;
  label: string;
  type: "number" | "string";
  required?: boolean;
  placeholder?: string;
}
export interface LiveActionDef {
  name: string;
  label: string;
  description: string;
  params: LiveParamDef[];
  /** Không hiện trong danh sách chung của UI (vd action debug). */
  hidden?: boolean;
}
export type ActionParams = Record<string, string | number>;
export interface DispatchBody {
  action: string;
  params?: ActionParams;
}
export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface TransportInfo {
  name: string;
  description: string;
}

export interface HealthInfo {
  version: string;
  transports: TransportInfo[];
  codecs: TransportInfo[];
  online: number;
  maxSessions: number;
}

/* ---------- WebSocket (v = 1) ---------- */
export type ClientMessage =
  | { v: 1; type: "ping" }
  | { v: 1; type: "subscribe"; accountId: string }
  | { v: 1; type: "unsubscribe"; accountId: string }
  | { v: 1; type: "login"; accountId: string; transport?: string; speed?: number; requestId?: string }
  | { v: 1; type: "logout"; accountId: string; requestId?: string }
  | { v: 1; type: "logoutAll"; requestId?: string }
  | { v: 1; type: "dispatch"; accountId: string; action: string; params?: ActionParams; requestId?: string }
  | { v: 1; type: "script.run"; accountId: string; scriptId: string; vars?: Record<string, string>; requestId?: string }
  | { v: 1; type: "script.control"; accountId: string; action: ScriptControl; requestId?: string };

export type ServerMessage =
  | { v: 1; type: "hello"; connections: ConnectionInfo[]; characters: Record<string, CharacterState> }
  | { v: 1; type: "connection.upsert"; connection: ConnectionInfo }
  | { v: 1; type: "connection.removed"; accountId: string }
  /** Đồng bộ liên tục trạng thái nhân vật (mỗi khi transport báo thay đổi). */
  | { v: 1; type: "character.state_update"; accountId: string; character: CharacterState }
  | { v: 1; type: "log"; accountId: string; entry: LogEntry }
  | { v: 1; type: "result"; requestId?: string; ok: boolean; message?: string }
  /** Kho script hoặc danh mục chính thức vừa đổi → UI nạp lại danh sách. */
  | { v: 1; type: "scripts.changed" }
  | { v: 1; type: "error"; message: string }
  | { v: 1; type: "pong" };

/** Các danh sách vật phẩm tự động của mỗi tài khoản (menu chuột phải ở Thùng đồ). */
export const ITEM_LIST_KEYS = ["autoOpen", "exception", "combine", "sell", "resolve", "contribute", "discard"] as const;
export type ItemListKey = (typeof ITEM_LIST_KEYS)[number];
export type ItemListToggles = Partial<Record<ItemListKey, boolean>>;
/** Cấu hình mua HP/SP tại NPC Hương Dũng (map 12701). */
export interface BuySettings {
  buyHpEnabled: boolean;
  buyHpQty: number;
  buySpEnabled: boolean;
  buySpQty: number;
}

/** Cấu hình tự động sử dụng HP/SP cho 1 đơn vị (nhân vật hoặc võ tướng). */
export interface AutoHealTargetConfig {
  autoHp: boolean;
  /** Ngưỡng HP % để tự động dùng thuốc (1 .. 99) */
  hpPct: number;
  autoSp: boolean;
  /** Ngưỡng SP % để tự động dùng thuốc (1 .. 99) */
  spPct: number;
}

/** Cấu hình tự động sử dụng HP/SP trong thùng đồ theo tài khoản. */
export interface AutoHealConfig {
  /** Bật/tắt tổng thể tính năng tự dùng HP/SP */
  enabled: boolean;
  /** Cấu hình cho Nhân vật */
  player: AutoHealTargetConfig;
  /** Cấu hình cho Võ tướng xuất chiến */
  pet: AutoHealTargetConfig;
  /** Cấu hình riêng cho từng slot võ tướng 1..4 (nếu có nhu cầu cấu hình riêng) */
  slots?: Record<number, AutoHealTargetConfig>;
}

export type ItemLists = Record<ItemListKey, number[]> & {
  toggles?: ItemListToggles;
  autoSweepEnabled?: boolean;
  buySettings?: BuySettings;
  autoHeal?: AutoHealConfig;
};

