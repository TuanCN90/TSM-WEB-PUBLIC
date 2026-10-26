import type { ActionParams, LiveActionDef } from "@tsbot/protocol";
import { DIJIE_LEVEL_LIST } from "../data/dijie";
import type { GameCommand } from "../transport/Transport";
import { gateById, isDijieMap, nearestGate, planRoute, shortestPath } from "./route";

export class EngineError extends Error {
  constructor(public status: 400 | 404 | 409 | 429, message: string) {
    super(message);
  }
}

interface LiveAction extends LiveActionDef {
  toCommand(p: Record<string, string>): GameCommand;
  /** Action nhiều bước: gửi lần lượt từng lệnh, chờ `afterMs` sau mỗi lệnh. Có thì ưu tiên hơn `toCommand`. */
  toSteps?(p: Record<string, string>, ctx: StepContext): ActionStep[];
}

/** Trạng thái hiện tại để lập kế hoạch nhiều bước (vd map đang đứng). */
export interface StepContext { map: number }
/** Một bước: gửi `cmd` rồi chờ `afterMs`; expectMap: chờ server xác nhận tới map này; hoặc `end` = kết thúc ngay với kết quả này (không gửi gì nữa). */
export type ActionStep =
  | { cmd: GameCommand; afterMs: number; expectMap?: number }
  /**
   * Chốt chặn ĐỘI NGŨ: chủ PT chờ đủ thành viên đã tới map hiện tại rồi mới đi tiếp (bước đi bộ). Không có đội/không có hook thì bỏ qua ngay.
   * Lý do: nhiều map bắt buộc đánh NPC để qua cổng — đi bộ khi thiếu đội sẽ thua và không tới đích (xem docs/PARTY_KNOWLEDGE.md §7).
   */
  | { gather: true; reason: string }
  | { end: { ok: boolean; message: string } };

/** Chuỗi bước đưa nhân vật từ map Dị giới đi bộ ra cổng để quay về Quảng trường Trác Quận (12003). */
function dijieExitSteps(fromMap: number): ActionStep[] {
  const exitHop = shortestPath(fromMap, 12003)?.[0];
  const door = exitHop?.door ?? (fromMap === 10851 ? 1 : 2);
  const coords = exitHop?.coords ?? (fromMap === 10851 ? { x: 1436, y: 110 } : { x: 688, y: 375 });
  return doorSteps(door, 12003, coords);
}

/** Mốc level Dị giới → mã chọn mốc trong `61/02` (nguồn và độ tin cậy: `data/dijie.ts`). */
export const DIJIE_LEVELS: Record<string, number> = Object.fromEntries(DIJIE_LEVEL_LIST.map((lv, i) => [String(lv), i + 1]));

const int = (name: string, label: string, placeholder?: string) => ({ name, label, type: "number" as const, required: true, placeholder });

export const BANK_MAP_IDS = new Set<number>([
  11261, 11262, 11263, 12261, 12262, 12263, 12264, 12265, 13261, 13262, 13263,
  14261, 15261, 15262, 18261, 18262, 19261, 19262, 20261, 21261, 21262, 23261,
  23262, 24261, 24262, 25261, 25262, 25263, 25264, 25265, 25266, 26261, 26262,
  28261, 29261, 30261, 30262, 32261,
]);
export const isBankMap = (id: number) => BANK_MAP_IDS.has(id);

/**
 * Registry action realtime. Muốn thêm action mới: thêm 1 entry ở đây (name, params, toCommand);
 * UI tự hiện form cho action không `hidden`, API /dispatch tự nhận. Driver nhận GameCommand tương ứng.
 */
export const LIVE_ACTIONS: LiveAction[] = [
  // Truyền tống tới cổng thành (menu "Teleport" của tool gốc): gói 44/01, chỉ 41 cổng trong Warp_C.dat.
  { name: "teleport_gate", label: "Dịch chuyển tới cổng thành", description: "Teleport tới một trong 41 cổng thành", params: [int("mapId", "Cổng thành", "12001")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "teleport_gate", args: [p.mapId] }),
    toSteps: (p, ctx) => {
      const steps: ActionStep[] = [];
      if (isDijieMap(ctx.map)) {
        steps.push(...dijieExitSteps(ctx.map));
      }
      steps.push(...teleportSteps(Number(p.mapId)));
      steps.push({ gather: true, reason: "đã teleport tới cổng thành, chờ đủ đội trước khi đi bộ" });
      return steps;
    } },
  // Warp tới map bất kỳ: kết hợp teleport cổng thành gần nhất (44/01) và chuyển qua chuỗi cổng (14/08) theo BFS
  { name: "warp_map", label: "Warp Map", description: "Dịch chuyển tới map đích (tự động lập lộ trình cổng thành + cổng dịch chuyển)", params: [int("mapId", "Map ID", "12003")],
    toCommand: (p) => ({ type: "Action", name: "warp_map", args: [p.mapId] }),
    toSteps: (p, ctx) => {
      const id = Number(p.mapId);
      if (!Number.isInteger(id) || id < 1 || id > 65535) throw new EngineError(400, "Map ID phải là số nguyên 1..65535");
      if (id === ctx.map) return [{ end: { ok: true, message: `Đang ở map ${id} rồi` } }];

      const steps: ActionStep[] = [];
      let currentMap = ctx.map;

      // Nếu đang trong map Dị giới, trước tiên đi bộ ra cổng để về map chính 12003 (Quảng trường Trác Quận)
      if (isDijieMap(currentMap)) {
        steps.push(...dijieExitSteps(currentMap));
        currentMap = 12003;
        if (id === 12003) {
          return steps;
        }
      }

      const plan = planRoute(currentMap, id);
      if (!plan) return [{ end: { ok: false, message: `Không tìm thấy đường tới map ${id} (map phó bản/sự kiện đặc biệt?)` } }];

      if (plan.type === "gate" && plan.gate) {
        steps.push(...teleportSteps(plan.gate.id));
          steps.push({ gather: true, reason: "đã teleport tới cổng thành, chờ đủ đội trước khi đi bộ" });
      } else if (plan.type === "direct") {
        for (const hop of plan.hops) {
          steps.push(...doorSteps(hop.door, hop.to, hop.coords));
        }
      } else if (plan.type === "gate_then_hops" && plan.gate) {
        if (currentMap !== plan.gate.id) {
          steps.push(...teleportSteps(plan.gate.id));
          steps.push({ gather: true, reason: "đã teleport tới cổng thành, chờ đủ đội trước khi đi bộ" });
        }
        for (const hop of plan.hops) {
          steps.push(...doorSteps(hop.door, hop.to, hop.coords));
        }
      }
      steps.push({ gather: true, reason: "đã tới map đích, chờ đủ đội" });
      return steps;
    } },
  // Warp & Đi bộ đến bãi train / NPC: tự động định tuyến tới map đích rồi đi bộ nội suy đến đúng tọa độ quái
  { name: "warp_to_spot", label: "Warp & Đến bãi train", description: "Dịch chuyển tới map đích và tự động đi bộ tiếp cận tọa độ quái/NPC",
    params: [
      int("mapId", "Map ID"),
      int("x", "Tọa độ X"),
      int("y", "Tọa độ Y"),
      { name: "npcName", label: "Tên NPC", type: "string", required: false },
    ],
    toCommand: (p) => ({ type: "Action", name: "warp_to_spot", args: [p.mapId, p.x, p.y, p.npcName ?? ""] }),
    toSteps: (p, ctx) => {
      const id = Number(p.mapId);
      const targetX = Number(p.x);
      const targetY = Number(p.y);
      if (!Number.isInteger(id) || id < 1 || id > 65535) throw new EngineError(400, "Map ID phải là số nguyên 1..65535");
      const steps: ActionStep[] = [];
      let currentMap = ctx.map;

      // Nếu đang trong map Dị giới, trước tiên đi bộ ra cổng để về map chính 12003 (Quảng trường Trác Quận)
      if (isDijieMap(currentMap)) {
        steps.push(...dijieExitSteps(currentMap));
        currentMap = 12003;
      }

      if (id !== currentMap) {
        const plan = planRoute(currentMap, id);
        if (!plan) return [{ end: { ok: false, message: `Không tìm thấy đường tới map ${id} (map phó bản/sự kiện đặc biệt?)` } }];
        if (plan.type === "gate" && plan.gate) {
          steps.push(...teleportSteps(plan.gate.id));
          steps.push({ gather: true, reason: "đã teleport tới cổng thành, chờ đủ đội trước khi đi bộ" });
        } else if (plan.type === "direct") {
          for (const hop of plan.hops) {
            steps.push(...doorSteps(hop.door, hop.to, hop.coords));
          }
        } else if (plan.type === "gate_then_hops" && plan.gate) {
          if (currentMap !== plan.gate.id) {
            steps.push(...teleportSteps(plan.gate.id));
          steps.push({ gather: true, reason: "đã teleport tới cổng thành, chờ đủ đội trước khi đi bộ" });
          }
          for (const hop of plan.hops) {
            steps.push(...doorSteps(hop.door, hop.to, hop.coords));
          }
        }
      }
      if (Number.isFinite(targetX) && Number.isFinite(targetY) && targetX > 0 && targetY > 0) {
        steps.push({ gather: true, reason: "đã tới map đích, chờ đủ đội trước khi đi bộ vào bãi" });
        steps.push({ cmd: { type: "Action", name: "move", args: [String(targetX), String(targetY)] }, afterMs: 500 });
      }
      return steps;
    } },
  { name: "warp_raw", label: "Qua cổng trực tiếp (14/08)", description: "Chỉ gửi 14/08 qua cổng, không gửi kèm sync/ready", hidden: true, params: [int("door", "Chỉ số cổng", "1")],
    toCommand: (p) => ({ type: "Action", name: "warp_door", args: [p.door] }),
    toSteps: (p) => [{ cmd: { type: "Action", name: "warp_door", args: [String(p.door)] }, afterMs: 0 }] },
  { name: "warp_door", label: "Qua cổng", description: "Bước qua cổng dịch chuyển trong map", params: [int("door", "Chỉ số cổng", "1")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "warp_door", args: [p.door] }),
    toSteps: (p) => doorSteps(Number(p.door)) },
  { name: "warp_id", label: "Qua cổng (warp_id)", description: "Bước qua cổng dịch chuyển trong map (alias của warp_door)", params: [int("door", "Chỉ số cổng", "1")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "warp_id", args: [p.door] }),
    toSteps: (p) => doorSteps(Number(p.door)) },
  { name: "ready_1406", label: "Báo sẵn sàng (14/06)", description: "Gói tin hoàn tất đổi map (14/06)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "ready_1406", args: [] }) },
  { name: "sync_state", label: "Đồng bộ trạng thái (0c/01)", description: "Gói tin đồng bộ trạng thái (0c/01)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "sync_state", args: [] }) },
  { name: "challenge_world_boss", label: "Khiêu chiến Boss Thế Giới", description: "Tương tác NPC 45 khiêu chiến Boss Thế Giới (20/02 + 14/01 + 14/09 + 14/06)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "challenge_world_boss", args: [] }) },
  { name: "ping_07", label: "Ping (07/01)", description: "Gói tin ping sau teleport (07/01)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "ping_07", args: [] }) },
  { name: "move", label: "Di chuyển", description: "Di chuyển tới toạ độ", params: [int("x", "X"), int("y", "Y")],
    toCommand: (p) => ({ type: "Action", name: "move", args: [p.x, p.y] }) },
  { name: "move_to_safe_spot", label: "Đến Chỗ An Toàn", description: "Di chuyển đến vị trí an toàn cách cổng vào một ít px (không qua cổng)", params: [],
    toCommand: () => ({ type: "Action", name: "move_to_safe_spot", args: [] }) },
  { name: "chat_local", label: "Chat local", description: "Gửi chat kênh local",
    params: [{ name: "text", label: "Nội dung", type: "string", required: true }],
    toCommand: (p) => ({ type: "Action", name: "chat_local", args: [p.text] }) },
  { name: "use_item", label: "Dùng vật phẩm", description: "Dùng vật phẩm theo ô túi hoặc ID",
    params: [{ ...int("slot", "Ô túi"), required: false }, { ...int("itemId", "Item ID"), required: false }, { ...int("count", "Số lượng"), required: false, placeholder: "1" }, { ...int("target", "Mục tiêu (0=Char, 1=Pet)"), required: false, placeholder: "0" }],
    toCommand: (p) => ({ type: "Action", name: "use_item", args: [p.slot ?? p.itemId ?? "1", p.qty ?? p.count ?? "1", p.target ?? "0"] }) },
  { name: "combine_item", label: "Hợp vật phẩm", description: "Hợp vật phẩm giữa ô A và ô B (hoặc 1x1 cùng ô A) (17/0e)", params: [int("slotA", "Ô A"), { ...int("slotB", "Ô B (để trống nếu hợp cùng ô A)"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "combine_item", args: [p.slotA, p.slotB ?? p.slotA] }) },
  { name: "packet", label: "Gói tin thô", description: "Gửi nguyên văn hex", params: [{ name: "hex", label: "Hex", type: "string", required: true }],
    toCommand: (p) => ({ type: "RawPacket", hex: p.hex }) },
  // --- dành cho Character Dashboard (ẩn khỏi danh sách chung vì đã có UI riêng) ---
  { name: "channel", label: "Đổi kênh", description: "Chọn kênh (0-based)", params: [int("channel", "Kênh")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "channel", args: [p.channel] }) },
  { name: "refresh_channels", label: "Làm mới kênh", description: "Gửi 07/01 lấy danh sách kênh map", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "refresh_channels", args: [] }) },
  { name: "leave_party", label: "Rời đội", description: "Giải tán / rời đội", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "leave_party", args: [] }) },
  { name: "party_invite", label: "Mời đội", description: "Mời người chơi (cùng map) vào đội mình theo tên nhân vật",
    params: [{ name: "name", label: "Tên người chơi", type: "string", required: true }, { name: "force", label: "Bỏ qua kiểm tra map (điều phối đã xác nhận cùng map)", type: "string", required: false }], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "party_invite", args: p.force ? [p.name, "force"] : [p.name] }) },
  { name: "party_request", label: "Xin vào đội", description: "Xin gia nhập đội của người chơi (cùng map) theo tên nhân vật",
    params: [{ name: "name", label: "Tên chủ PT", type: "string", required: true }, { name: "force", label: "Bỏ qua kiểm tra map (điều phối đã xác nhận cùng map)", type: "string", required: false }], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "party_request", args: p.force ? [p.name, "force"] : [p.name] }) },
  { name: "dungeon_room_create", label: "Tạo phòng phó bản đội", description: "Chủ phòng tạo phòng phó bản đội (2f/02 `00 <id> 00 <cờ mật khẩu>`); có mật khẩu ⇒ server cấp mã", hidden: true,
    params: [int("dungeon", "Id phó bản (1 = Thảo Phạt Thiên Sứ)"), { ...int("password", "Có mật khẩu (1|0)"), required: false, placeholder: "0" }],
    toCommand: (p) => ({ type: "Action", name: "dungeon_room_create", args: [p.dungeon, p.password ?? "0"] }) },
  { name: "dungeon_room_join", label: "Tìm đội & vào phòng phó bản đội", description: "Làm mới danh sách phòng (2f/01), tìm ĐÚNG phòng theo tên chủ + phó bản rồi vào (2f/03)", hidden: true,
    params: [{ name: "leader", label: "Tên chủ phòng", type: "string", required: true }, { ...int("dungeon", "Id phó bản (1 = Thảo Phạt Thiên Sứ)"), required: false, placeholder: "1" }, { name: "password", label: "Mật khẩu phòng", type: "string", required: false }],
    toCommand: (p) => ({ type: "Action", name: "dungeon_room_join", args: [p.leader, p.dungeon ?? "", p.password ?? ""] }) },
  { name: "dungeon_room_ready", label: "Sẵn sàng phó bản đội", description: "Thành viên bấm Sẵn sàng sau khi vào phòng (2f/0b)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "dungeon_room_ready", args: [] }) },
  { name: "dungeon_exit", label: "Thoát phó bản đội", description: "Rời đội để ra khỏi phó bản (0d/04 uid mình) — dùng khi lộ trình bị kẹt", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "dungeon_exit", args: [] }) },
  { name: "dungeon_room_start", label: "Bắt đầu phó bản đội", description: "Chủ phòng bắt đầu phó bản (2f/0c)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "dungeon_room_start", args: [] }) },
  { name: "dungeon_room_cancel", label: "Huỷ phòng phó bản đội", description: "Huỷ phòng đang mở (2f/0a)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "dungeon_room_cancel", args: [] }) },
  { name: "dungeon_room_list", label: "Danh sách phòng phó bản đội", description: "Làm mới danh sách phòng (2f/01)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "dungeon_room_list", args: [] }) },
  { name: "dungeon_buy", label: "Mua lượt phó bản", description: "Mua thêm lượt phó bản bằng Vàng/Xu (54/02)", hidden: true,
    params: [{ ...int("dungeon", "Id phó bản"), required: false, placeholder: "2" }],
    toCommand: (p) => ({ type: "Action", name: "dungeon_buy", args: [p.dungeon ?? "2"] }) },
  { name: "party_reply", label: "Trả lời lời mời/xin đội", description: "Đồng ý/từ chối lời mời (invite) hoặc lời xin vào đội (request) đang chờ",
    params: [
      { name: "kind", label: "Loại (invite|request)", type: "string", required: true },
      { name: "name", label: "Tên người gửi", type: "string", required: false },
      { name: "accept", label: "Đồng ý (1|0)", type: "string", required: false },
    ], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "party_reply", args: [p.kind ?? "invite", p.name ?? "", p.accept ?? "1"] }) },
  { name: "set_party_config", label: "Cài đặt tự chấp nhận đội", description: "Server đẩy xuống: tên được tự chấp nhận lời mời / lời xin vào đội và quy tắc tổ đội", hidden: true,
    params: [
      { name: "inviteFrom", label: "Tự nhận lời mời từ", type: "string", required: false },
      { name: "requestFromJson", label: "Tự nhận lời xin từ (JSON mảng tên)", type: "string", required: false },
      { name: "role", label: "Vai trò (leader|member)", type: "string", required: false },
      { name: "leaderName", label: "Tên chủ PT", type: "string", required: false },
      { name: "membersJson", label: "Danh sách thành viên (JSON mảng tên)", type: "string", required: false },
      { name: "escapeIfNotFullParty", label: "Tự chạy khi chưa đủ đội ngũ (1|0)", type: "string", required: false },
    ],
    toCommand: (p) => ({
      type: "Action",
      name: "set_party_config",
      args: [
        p.inviteFrom ?? "",
        p.requestFromJson ?? "[]",
        p.role ?? "leader",
        p.leaderName ?? "",
        p.membersJson ?? "[]",
        p.escapeIfNotFullParty ?? "0",
      ],
    }) },
  { name: "party_set_leader", label: "Làm chủ PT", description: "Chuyển chủ đội cho slot hoặc tên", params: [{ name: "slot", label: "Slot hoặc tên", type: "string", required: true }], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "party_set_leader", args: [p.slot] }) },
  { name: "party_set_advisor", label: "Chọn Quân sư", description: "Chọn quân sư (QSư) theo slot hoặc tên", params: [{ name: "slot", label: "Slot hoặc tên", type: "string", required: true }], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "party_set_advisor", args: [p.slot] }) },
  { name: "ai_find", label: "AI tìm", description: "Tự tìm đường tới toạ độ", params: [int("x", "X"), int("y", "Y")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "ai_find", args: [p.x, p.y] }) },
  { name: "open_map", label: "Bản đồ", description: "Mở bản đồ thế giới", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "open_map", args: [] }) },
  { name: "dijie_enter", label: "Vào Dị giới", description: "Vào map Dị giới theo mốc level (10…180)", params: [int("level", "Mốc level", "25")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "dijie_pick", args: [String(DIJIE_LEVELS[p.level] ?? 0)] }),
    toSteps: (p) => {
      if (!(p.level in DIJIE_LEVELS)) throw new EngineError(400, `Mốc level phải là ${Object.keys(DIJIE_LEVELS).join(" / ")}`);
      // Khớp pcap: 61/01 (mở) → 0c/01 (đồng bộ) → ~2.5s → 61/02 (chọn mốc)
      return [
        { cmd: { type: "Action", name: "dijie_open", args: [] }, afterMs: 100 },
        { cmd: { type: "Action", name: "sync_state", args: [] }, afterMs: 2500 },
        { cmd: { type: "Action", name: "dijie_pick", args: [String(DIJIE_LEVELS[p.level])] }, afterMs: 0 },
      ];
    } },
  { name: "daily_checkin", label: "Điểm danh ngày", description: "Điểm danh hằng ngày (ngày = bộ đếm server + 1 nếu không truyền)", hidden: true,
    params: [{ ...int("day", "Ngày"), required: false, placeholder: "tự động" }],
    toCommand: (p) => ({ type: "Action", name: "daily_checkin", args: p.day ? [p.day] : [] }) },
  { name: "online_reward", label: "Nhận quà Online", description: "Nhận quà online theo mốc phút hoặc tự động nhận hết các mốc đã đủ điều kiện", params: [{ ...int("minutes", "Mốc phút"), required: false, placeholder: "tự động" }], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "online_reward", args: p.minutes ? [p.minutes] : [] }) },
  { name: "online_reward_all", label: "Nhận quà Online (tất cả)", description: "Tự động nhận tất cả quà online đã đủ điều kiện", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "online_reward_all", args: [] }) },
  // --- General: Exp Offline, Thư, Võ tướng xuất chiến (cap 22/10) ---
  { name: "offline_exp_free", label: "Nhận Exp Offline (Free)", description: "Nhận exp offline miễn phí (54/01 + 54/02, ưu đãi 0x1e)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "offline_exp_free", args: [] }) },
  { name: "offline_exp_info", label: "Xem giá Exp Offline", description: "Làm mới bảng giá nhận Exp Offline (57/03)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "offline_exp_info", args: [] }) },
  { name: "mail_claim_all", label: "Nhận quà thư", description: "Nhận quà đính kèm của mọi thư (53/03 + 53/01 từng thư)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "mail_claim_all", args: [] }) },
  // --- Bạn bè: Tặng quà & Nhận quà (0e/12 + 0e/13, cap 26/10) ---
  { name: "friend_gift_all", label: "Tặng & Nhận quà bạn bè", description: "Tặng quà thể lực cho tất cả bạn bè và nhận tất cả quà gửi lại", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "friend_gift_all", args: [] }) },
  { name: "friend_send_gift", label: "Tặng quà bạn bè", description: "Gửi tặng quà thể lực cho toàn bộ danh sách bạn bè", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "friend_send_gift", args: [] }) },
  { name: "friend_receive_gift", label: "Nhận quà bạn bè", description: "Nhận tất cả quà bạn bè đã gửi", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "friend_receive_gift", args: [] }) },
  // --- Chiêu mộ: Rút bí cấp tướng & Rút thẻ tướng (42/01, cap 26/10) ---
  { name: "pull_secret", label: "Rút 1 bí cấp tướng", description: "Rút 1 bí cấp võ tướng (tiêu 9.000 Xu)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "pull_secret", args: [] }) },
  { name: "pull_card", label: "Rút 1 thẻ tướng", description: "Rút 1 thẻ chiêu mộ võ tướng (tiêu 9.000 Xu)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "pull_card", args: [] }) },
  { name: "pull_all", label: "Rút Bí cấp & Thẻ tướng", description: "Rút 1 bí cấp tướng và 1 thẻ tướng (tiêu 18.000 Xu)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "pull_all", args: [] }) },
  { name: "pet_out", label: "Võ tướng xuất chiến", description: "Chọn võ tướng xuất chiến (13/01); võ tướng đang xuất chiến tự về nghỉ", params: [int("model", "Model võ tướng")], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "pet_out", args: [p.model] }) },
  { name: "pet_rest", label: "Võ tướng nghỉ", description: "Cho võ tướng đang xuất chiến nghỉ (21/03 00 01, cap 26/10)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "pet_rest", args: [] }) },
  { name: "spin_lap_ba", label: "Quay Xu Lạp Bá", description: "Quay Xu Lạp Bá nhận EXP cho võ tướng (mặc định slot 1)", params: [{ ...int("slot", "Slot võ tướng (1..n)"), required: false }], hidden: true,
    toCommand: (p) => ({ type: "Action", name: "spin_lap_ba", args: p.slot != null ? [p.slot] : ["1"] }) },
  { name: "daily_quest_claim", label: "Nhận quà nhiệm vụ ngày", description: "Nhận full quà nhiệm vụ và rương điểm tích luỹ hàng ngày (5b/02 + 5b/03)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "daily_quest_claim", args: [] }) },
  { name: "battle_pass_claim", label: "Nhận quà Thông Hành", description: "Nhận tất cả mốc quà Thông Hành (Battle Pass) đã đạt điểm (4d/0b + mail_claim_all)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "battle_pass_claim", args: [] }) },
  { name: "set_battle_config", label: "Cài đặt trận đấu", description: "Cài đặt hành động nhân vật, pet và tự động đánh", hidden: true,
    params: [
      { ...int("playerSkillId", "Skill Char"), required: false },
      { ...int("petSkillId", "Skill Pet"), required: false },
      { ...int("autoFight", "Auto"), required: false },
      { name: "playerTarget", label: "Vị trí mục tiêu Char", type: "string", required: false },
      { name: "petTarget", label: "Vị trí mục tiêu Pet", type: "string", required: false },
      { name: "turnsJson", label: "Cấu hình 21 turn (JSON)", type: "string", required: false },
      { name: "strategyMode", label: "Chế độ (default|turns)", type: "string", required: false },
      { ...int("autoEscape", "Tự bỏ chạy"), required: false },
    ],
    toCommand: (p) => ({
      type: "Action",
      name: "set_battle_config",
      args: [
        p.playerSkillId ?? "10000",
        p.petSkillId ?? "10000",
        p.autoFight ?? "1",
        p.playerTarget ?? "F1",
        p.petTarget ?? "F1",
        p.turnsJson ?? "",
        p.strategyMode ?? "",
        p.autoEscape != null ? String(p.autoEscape) : "0",
      ],
    }) },
  { name: "battle_action", label: "Thao tác trong trận", description: "Thực hiện hành động trong trận đấu", hidden: true,
    params: [{ name: "actor", label: "Đối tượng", type: "string", required: false }, { ...int("skillId", "Skill ID"), required: false }, { ...int("targetRow", "Hàng mục tiêu"), required: false }, { ...int("targetCol", "Cột mục tiêu"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "battle_action", args: [p.actor ?? "player", p.skillId ?? "10000", p.targetRow ?? "0", p.targetCol ?? "2"] }) },
  // --- Thùng đồ & Tiền Trang ---
  { name: "use_item_pet", label: "Võ tướng dùng vật phẩm", description: "Cho võ tướng dùng vật phẩm ở ô túi", hidden: true, params: [int("slot", "Ô túi"), { ...int("qty", "Số lượng"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "use_item", args: [p.slot ?? "1", p.qty ?? "1", "1"] }) },
  { name: "drop_item", label: "Vứt bỏ vật phẩm", description: "Vứt vật phẩm ở ô túi", hidden: true, params: [int("slot", "Ô túi"), { ...int("qty", "Số lượng"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "drop_item", args: [p.slot ?? "1", p.qty ?? "1"] }) },
  { name: "deposit_bank", label: "Gửi vào Tiền Trang", description: "Gửi vật phẩm từ túi vào Tiền Trang", hidden: true, params: [int("slot", "Ô túi"), { ...int("qty", "Số lượng"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "deposit_bank", args: p.qty ? [p.slot ?? "1", p.qty] : [p.slot ?? "1"] }) },
  { name: "withdraw_bank", label: "Rút khỏi Tiền Trang", description: "Rút vật phẩm từ Tiền Trang về túi", hidden: true, params: [int("slot", "Ô kho"), { ...int("qty", "Số lượng"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "withdraw_bank", args: p.qty ? [p.slot ?? "1", p.qty] : [p.slot ?? "1"] }) },
  { name: "open_bank_tuongduong", label: "Đến Tiền Trang Tương Dương", description: "Warp đến Tiền Trang Tương Dương và mở rương", params: [],
    toCommand: () => ({ type: "Action", name: "open_bank_tuongduong", args: [] }),
    toSteps: (_p, ctx) => {
      const steps: ActionStep[] = [];
      if (ctx.map !== 21261) {
        const warpDef = LIVE_ACTIONS.find((a) => a.name === "warp_map");
        const rawSteps = warpDef?.toSteps ? warpDef.toSteps({ mapId: "21261" }, ctx) : [];
        for (const s of rawSteps) {
          if (!("end" in s)) steps.push(s);
        }
      }
      // Khớp 100% PCAP thực tế khi thao tác tại Tiền Trang Tương Dương:
      // Di chuyển tới trước quầy NPC (450, 310) -> interact_prep 8 -> talk_npc 1 (14/01) -> xác nhận mở kho (14/06)
      steps.push(
        { cmd: { type: "Action", name: "move", args: ["450", "310"] }, afterMs: 2200 },
        { cmd: { type: "Action", name: "interact_prep", args: ["8"] }, afterMs: 300 },
        { cmd: { type: "Action", name: "talk_npc", args: ["1"] }, afterMs: 1500 },
        { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 500 },
      );
      return steps;
    } },
  { name: "open_inn", label: "Đến Nhà Trọ Trác Quận", description: "Warp đến Nhà Trọ Trác Quận (12007) và tải danh sách võ tướng", params: [],
    toCommand: () => ({ type: "Action", name: "open_inn", args: [] }),
    toSteps: (_p, ctx) => {
      const steps: ActionStep[] = [];
      if (ctx.map !== 12007) {
        const warpDef = LIVE_ACTIONS.find((a) => a.name === "warp_map");
        const rawSteps = warpDef?.toSteps ? warpDef.toSteps({ mapId: "12007" }, ctx) : [];
        for (const s of rawSteps) {
          if (!("end" in s)) steps.push(s);
        }
      }
      steps.push(
        { cmd: { type: "Action", name: "move", args: ["350", "450"] }, afterMs: 2200 },
        { cmd: { type: "Action", name: "interact_prep", args: ["8"] }, afterMs: 300 },
        { cmd: { type: "Action", name: "talk_npc", args: ["1"] }, afterMs: 1500 },
        { cmd: { type: "Action", name: "send_menu", args: ["32"] }, afterMs: 600 },
        { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 300 },
        { cmd: { type: "Action", name: "inn_prep_7a", args: [] }, afterMs: 300 },
        { cmd: { type: "Action", name: "open_inn_request", args: [] }, afterMs: 300 },
        { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 300 },
        { cmd: { type: "Action", name: "escort_query", args: [] }, afterMs: 500 },
      );
      return steps;
    } },
  { name: "open_inn_request", label: "Mở Nhà Trọ (1f/0a)", description: "Gửi gói mở Nhà Trọ (1f/0a)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "open_inn_request", args: [] }) },
  { name: "inn_prep_7a", label: "Khởi tạo Nhà Trọ (7a/01)", description: "Gửi gói khởi tạo Nhà Trọ (7a/01)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "inn_prep_7a", args: [] }) },
  { name: "escort_query", label: "Kiểm tra Vận Tiêu (56/01)", description: "Gửi gói kiểm tra trạng thái Vận Tiêu (56/01)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "escort_query", args: [] }) },
  { name: "escort_start", label: "Bắt đầu Vận Tiêu", description: "Cử võ tướng trong Nhà Trọ đi Vận Tiêu", params: [int("slot", "Ô Pet trong Nhà Trọ", "1")],
    toCommand: (p) => ({ type: "Action", name: "escort_start", args: [p.slot ?? "1"] }) },
  { name: "escort_claim", label: "Nhận quà Vận Tiêu", description: "Nhận phần thưởng hoàn thành Vận Tiêu (56/05)", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "escort_claim", args: [] }) },
  { name: "open_bank", label: "Mở kho Tiền Trang", description: "Mở kho Tiền Trang tại vị trí hiện tại (hoặc warp về Tiền Trang nếu đang ở xa)", params: [],
    toCommand: () => ({ type: "Action", name: "open_bank", args: [] }),
    toSteps: (_p, ctx) => {
      const steps: ActionStep[] = [];
      if (ctx.map === 12263) {
        // Tiền Trang Trác Quận (NPC 1 tại 425, 236)
        steps.push(
          { cmd: { type: "Action", name: "move", args: ["425", "236"] }, afterMs: 2200 },
          { cmd: { type: "Action", name: "interact_prep", args: ["8"] }, afterMs: 300 },
          { cmd: { type: "Action", name: "talk_npc", args: ["1"] }, afterMs: 1500 },
          { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 500 },
        );
        return steps;
      }
      if (!BANK_MAP_IDS.has(ctx.map)) {
        const warpDef = LIVE_ACTIONS.find((a) => a.name === "warp_map");
        const rawSteps = warpDef?.toSteps ? warpDef.toSteps({ mapId: "21261" }, ctx) : [];
        for (const s of rawSteps) {
          if (!("end" in s)) steps.push(s);
        }
      }
      // Tiền Trang Tương Dương (21261 - NPC 1 tại 450, 310)
      steps.push(
        { cmd: { type: "Action", name: "move", args: ["450", "310"] }, afterMs: 2200 },
        { cmd: { type: "Action", name: "interact_prep", args: ["8"] }, afterMs: 300 },
        { cmd: { type: "Action", name: "talk_npc", args: ["1"] }, afterMs: 1500 },
        { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 500 },
      );
      return steps;
    } },
  { name: "interact_prep", label: "Chuẩn bị tương tác (20/02)", description: "Gói tin chuẩn bị tương tác NPC/đối tượng (20/02)", hidden: true,
    params: [{ ...int("mode", "Chế độ"), required: false, placeholder: "8" }],
    toCommand: (p) => ({ type: "Action", name: "interact_prep", args: [p.mode ?? "8"] }) },
  { name: "close_bank", label: "Đóng Tiền Trang & Lưu DB", description: "Gói tin đóng giao diện Tiền Trang và xác nhận hoàn tất thoại (1e/08 + 14/06) để máy chủ cam kết lưu DB", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "close_bank", args: [] }),
    toSteps: () => [
      { cmd: { type: "Action", name: "close_bank", args: [] }, afterMs: 150 },
      { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 250 },
    ] },
  { name: "talk_npc", label: "Nói chuyện NPC", description: "Gửi gói thoại NPC (14/01)", hidden: true,
    params: [{ ...int("npcId", "NPC ID"), required: false }, { ...int("npc", "NPC ID"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "talk_npc", args: [p.npcId ?? p.npc ?? "1"] }) },
  { name: "click", label: "Click NPC", description: "Gửi gói thoại NPC (14/01)", hidden: true,
    params: [{ ...int("npc", "NPC ID"), required: false }, { ...int("npcId", "NPC ID"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "click", args: [p.npc ?? p.npcId ?? "1"] }) },
  { name: "send_menu", label: "Chọn menu đối thoại", description: "Gửi gói chọn menu NPC (14/09)", hidden: true, params: [int("option", "Lựa chọn")],
    toCommand: (p) => ({ type: "Action", name: "send_menu", args: [p.option ?? "1"] }) },
  { name: "set_item_lists", label: "Cài đặt danh sách vật phẩm tự động", description: "Cập nhật danh sách vật phẩm auto (tự vứt, tự mở...)", hidden: true,
    params: [
      { name: "autoDropJson", label: "Tự vứt", type: "string", required: false },
      { name: "autoOpenJson", label: "Tự mở", type: "string", required: false },
      { name: "autoDissolveJson", label: "Phân giải", type: "string", required: false },
      { name: "autoContributeJson", label: "Đóng góp", type: "string", required: false },
      { name: "autoCombineJson", label: "Tự hợp", type: "string", required: false },
      { name: "sellJson", label: "Bán vật phẩm", type: "string", required: false },
      { name: "togglesJson", label: "Trạng thái bật tắt", type: "string", required: false },
      { name: "autoSweepEnabled", label: "Bật auto quét 1 phút", type: "string", required: false },
      { name: "autoHealJson", label: "Cấu hình tự dùng HP/SP", type: "string", required: false },
      { name: "lastCombinedDate", label: "Ngày đã hợp gần nhất", type: "string", required: false },
    ],
    toCommand: (p) => ({
      type: "Action",
      name: "set_item_lists",
      args: [
        p.autoDropJson ?? "[]",
        p.autoOpenJson ?? "[]",
        p.autoDissolveJson ?? "[]",
        p.autoContributeJson ?? "[]",
        p.autoCombineJson ?? "[]",
        p.sellJson ?? "[]",
        p.togglesJson ?? "{}",
        p.autoSweepEnabled ?? "false",
        p.autoHealJson ?? "{}",
        p.lastCombinedDate ?? "",
      ],
    }) },
  { name: "set_auto_heal", label: "Cấu hình tự dùng HP/SP", description: "Lưu cấu hình tự dùng HP/SP cho nhân vật và võ tướng", hidden: true,
    params: [{ name: "autoHealJson", label: "JSON AutoHeal", type: "string" }],
    toCommand: (p) => ({ type: "Action", name: "set_auto_heal", args: [String(p.autoHealJson ?? "{}")] }) },
  { name: "set_auto_move", label: "Tự động di chuyển", description: "Bật/tắt tự động di chuyển 30px quanh điểm ban đầu (tối đa 150px)", hidden: true,
    params: [
      { name: "enabled", label: "Bật/Tắt", type: "string" },
      { name: "mapId", label: "Map ID", type: "string", required: false },
      { name: "originX", label: "Tọa độ X gốc", type: "string", required: false },
      { name: "originY", label: "Tọa độ Y gốc", type: "string", required: false },
      { name: "maxRadius", label: "Bán kính tối đa", type: "string", required: false },
    ],
    toCommand: (p) => ({
      type: "Action",
      name: "set_auto_move",
      args: [
        p.enabled === "1" || p.enabled === "true" ? "1" : "0",
        String(p.mapId ?? ""),
        String(p.originX ?? ""),
        String(p.originY ?? ""),
        String(p.maxRadius ?? "150"),
      ],
    }) },
  { name: "set_chase_config", label: "Cấu hình truy kích quái", description: "Lưu cấu hình chế độ tự động truy kích quái", hidden: true,
    params: [
      { name: "enabled", label: "Bật/Tắt", type: "string" },
      { name: "mapId", label: "Map ID", type: "string", required: false },
      { name: "originX", label: "Tọa độ X gốc", type: "string", required: false },
      { name: "originY", label: "Tọa độ Y gốc", type: "string", required: false },
      { name: "maxRadius", label: "Bán kính tối đa", type: "string", required: false },
      { name: "npcId", label: "NPC ID", type: "string", required: false },
      { name: "npcName", label: "Tên NPC", type: "string", required: false },
      { name: "autoReturn", label: "Tự quay về gốc", type: "string", required: false },
    ],
    toCommand: (p) => {
      const isEn = p.enabled === "1" || p.enabled === "true";
      const cfg = {
        enabled: isEn,
        mapId: Number(p.mapId) || 0,
        originX: Number(p.originX) || 0,
        originY: Number(p.originY) || 0,
        maxRadius: Number(p.maxRadius) || 150,
        npcId: Number(p.npcId) || 0,
        npcName: p.npcName || "",
        autoReturn: p.autoReturn !== "0" && p.autoReturn !== "false",
      };
      return {
        type: "Action",
        name: "set_chase_config",
        args: [
          JSON.stringify(cfg),
          isEn ? "1" : "0",
          String(cfg.mapId),
          String(cfg.originX),
          String(cfg.originY),
          String(cfg.maxRadius),
          String(cfg.npcId),
          cfg.npcName,
          cfg.autoReturn ? "1" : "0",
        ],
      };
    } },
  { name: "sweep_auto_heal", label: "Quét tự dùng HP/SP", description: "Quét thùng đồ và tự dùng HP/SP theo cấu hình", hidden: true,
    params: [],
    toCommand: () => ({ type: "Action", name: "sweep_auto_heal", args: [] }) },
  { name: "sweep_inventory", label: "Quét thùng đồ ngay", description: "Quét và xử lý thùng đồ cá nhân theo các quy tắc đang bật 1 lần", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "sweep_inventory", args: [] }) },
  { name: "shop_sell_and_buy", label: "Bán và Mua HP/SP Hương Dũng", description: "Tự động dịch chuyển đến Hương Dũng (12701), bán vật phẩm trong danh sách và mua HP/SP theo số lượng", hidden: true,
    params: [
      { name: "buyHpEnabled", label: "Mua HP", type: "string", required: false },
      { name: "buyHpQty", label: "Số lượng HP", type: "string", required: false },
      { name: "buySpEnabled", label: "Mua SP", type: "string", required: false },
      { name: "buySpQty", label: "Số lượng SP", type: "string", required: false },
      { name: "sellIdsJson", label: "Danh sách ID bán", type: "string", required: false },
    ],
    toCommand: (p) => ({
      type: "Action",
      name: "shop_sell_and_buy",
      args: [
        p.buyHpEnabled ?? "1",
        p.buyHpQty ?? "999",
        p.buySpEnabled ?? "1",
        p.buySpQty ?? "999",
        p.sellIdsJson ?? "[]",
      ],
    }),
  },
  { name: "execute_shop_transaction", label: "Giao dịch Bán & Mua Shop", description: "Thực hiện chu trình bán và mua với NPC Thương nhân", hidden: true,
    params: [
      { name: "buyHpEnabled", label: "Mua HP", type: "string", required: false },
      { name: "buyHpQty", label: "Số lượng HP", type: "string", required: false },
      { name: "buySpEnabled", label: "Mua SP", type: "string", required: false },
      { name: "buySpQty", label: "Số lượng SP", type: "string", required: false },
      { name: "sellIdsJson", label: "Danh sách ID bán", type: "string", required: false },
    ],
    toCommand: (p) => ({
      type: "Action",
      name: "execute_shop_transaction",
      args: [
        p.buyHpEnabled ?? "1",
        p.buyHpQty ?? "999",
        p.buySpEnabled ?? "1",
        p.buySpQty ?? "999",
        p.sellIdsJson ?? "[]",
      ],
    }) },
  { name: "resolve_item", label: "Phân giải vật phẩm", description: "Phân giải vật phẩm ở ô túi", hidden: true, params: [int("itemId", "Item ID"), { ...int("slot", "Ô túi"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "resolve_item", args: [p.itemId, p.slot ?? ""] }) },
  { name: "contribute_item", label: "Đóng góp vật phẩm", description: "Đóng góp vật phẩm cho bang hội", hidden: true, params: [int("itemId", "Item ID"), { ...int("slot", "Ô túi"), required: false }],
    toCommand: (p) => ({ type: "Action", name: "contribute_item", args: [p.itemId, p.slot ?? ""] }) },
  { name: "open_bag_slot", label: "Mở thêm ô túi đồ", description: "Dùng vật phẩm mở rộng ô túi", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "open_bag_slot", args: [] }) },
  { name: "auto_combine_dragon", label: "Tự hợp Lông Vũ", description: "Tự hợp vật phẩm Lông Vũ", hidden: true, params: [],
    toCommand: () => ({ type: "Action", name: "auto_combine_dragon", args: [] }) },
  { name: "debug_drop", label: "Giả lập mất kết nối", description: "Chỉ để thử reconnect (driver có thể không hỗ trợ)", params: [], hidden: true,
    toCommand: () => ({ type: "Action", name: "debug_drop", args: [] }) },
];

export function buildCommand(action: string, params: ActionParams = {}): GameCommand {
  const def = LIVE_ACTIONS.find((a) => a.name === action);
  if (!def) throw new EngineError(400, `Action '${action}' không tồn tại`);
  const p: Record<string, string> = {};
  for (const d of def.params) {
    const raw = params[d.name];
    const v = raw === undefined || raw === null ? "" : String(raw).trim();
    if (!v) {
      if (d.required) throw new EngineError(400, `Thiếu tham số '${d.label}'`);
      continue;
    }
    if (d.type === "number" && !/^-?\d+$/.test(v)) throw new EngineError(400, `'${d.label}' phải là số nguyên`);
    if (def.name === "packet" && !/^([0-9a-fA-F]{2})+$/.test(v)) throw new EngineError(400, "Hex phải có độ dài chẵn");
    p[d.name] = v;
  }
  return def.toCommand(p);
}

/** 44/01 → (~0.2s) 07/01 + 0c/01, khớp pcap tool gốc. Tuyệt đối không gửi 14/06 sau 44/01. Chỉ nhận mapId là cổng thành trong Warp_C.dat. */
function teleportSteps(id: number): ActionStep[] {
  if (!Number.isInteger(id) || id < 1 || id > 65535) throw new EngineError(400, "Map ID phải là số nguyên 1..65535");
  // Server bỏ qua im lặng map ngoài danh sách (đã gặp với 12003) nên chặn trước với lỗi rõ.
  if (!gateById(id)) throw new EngineError(400, `Map ${id} không phải cổng thành trong danh sách truyền tống (41 cổng)`);
  return [
    { cmd: { type: "Action", name: "teleport_gate", args: [String(id)] }, afterMs: 250 },
    { cmd: { type: "Action", name: "ping_07", args: [] }, afterMs: 150 },
    { cmd: { type: "Action", name: "sync_state", args: [] }, afterMs: 1800, expectMap: id },
  ];
}

/** 14/08: bước qua cổng dịch chuyển (doorIndex u16 LE). Tự động chèn move tới tọa độ cổng nếu có để tránh Kick mã 5. */
function doorSteps(door: number, targetMap?: number, coords?: { x: number; y: number }): ActionStep[] {
  const steps: ActionStep[] = [];
  if (coords && coords.x > 0 && coords.y > 0) {
    steps.push({ cmd: { type: "Action", name: "move", args: [String(coords.x), String(coords.y)] }, afterMs: 300 });
  }
  steps.push(
    { cmd: { type: "Action", name: "warp_door", args: [String(door)] }, afterMs: 600 },
    { cmd: { type: "Action", name: "sync_state", args: [] }, afterMs: 800, expectMap: targetMap },
    { cmd: { type: "Action", name: "ready_1406", args: [] }, afterMs: 1200 },
  );
  return steps;
}

export function buildSteps(action: string, params: ActionParams = {}, ctx: StepContext = { map: 0 }): ActionStep[] {
  const def = LIVE_ACTIONS.find((a) => a.name === action);
  const cmd = buildCommand(action, params); // validate tham số + 404/400
  if (!def?.toSteps) return [{ cmd, afterMs: 0 }];
  const p: Record<string, string> = {};
  for (const d of def.params) { const v = params[d.name]; if (v !== undefined && v !== null && String(v).trim()) p[d.name] = String(v).trim(); }
  return def.toSteps(p, ctx);
}

export const listLiveActions = (): LiveActionDef[] => LIVE_ACTIONS.map(({ toCommand: _t, ...d }) => d);
