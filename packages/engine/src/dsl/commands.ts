/**
 * Registry lệnh DSL. Ngữ nghĩa được SUY RA từ các script mẫu (chưa có tài liệu chính thức),
 * nên lệnh lạ không làm vỡ parser mà chỉ sinh cảnh báo.
 */
export interface CommandSpec {
  min: number;
  max: number;
  desc: string;
  /** Giữ nguyên phần còn lại của dòng làm 1 đối số (chat...). */
  text?: boolean;
  /** Các đối số phải là số nguyên. */
  numeric?: boolean;
}

const s = (min: number, max: number, desc: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({ min, max, desc, ...extra });

export const COMMANDS: Record<string, CommandSpec> = {
  // luồng / thời gian
  sleep: s(1, 1, "Chờ N ms", { numeric: true }),
  loop: s(1, 1, "Lặp khối thụt lề N lần", { numeric: true }),
  if_map: s(2, 2, "Chạy khối nếu map thoả điều kiện (== != < > <= >=)"),
  end_event: s(0, 0, "Kết thúc script"),
  continue: s(0, 0, "Sang lần lặp kế tiếp của loop"),
  // bật/tắt trạng thái
  auto: s(1, 1, "Bật/tắt auto đánh (0/1)", { numeric: true }),
  setting: s(1, 1, "Bật/tắt chế độ setting (0/1)", { numeric: true }),
  auto_hpsp: s(1, 1, "Bật/tắt tự hồi HP/SP (0/1)", { numeric: true }),
  save_map: s(1, 1, "Bật/tắt lưu map (0/1)", { numeric: true }),
  channel: s(1, 1, "Chọn kênh", { numeric: true }),
  // di chuyển
  warp_door: s(1, 1, "Bước qua cổng dịch chuyển", { numeric: true }),
  warp_id: s(1, 4, "Dịch chuyển theo cổng", { numeric: true }),
  click_boss: s(1, 4, "Đi tới NPC/boss phó bản và bấm tới khi vào trận (click N,map,x,y + tự đáp thoại, thử lại)", { numeric: true }),
  warp_map: s(1, 1, "Dịch chuyển tới map", { numeric: true }),
  teleport: s(1, 1, "Teleport tới map", { numeric: true }),
  teleport_warp: s(1, 1, "Teleport tới cổng của map", { numeric: true }),
  move: s(2, 2, "Di chuyển tới x y", { numeric: true }),
  walk: s(2, 2, "Đi bộ tới x,y", { numeric: true }),
  // tương tác
  click: s(1, 5, "Click NPC/đối tượng (click N,map,x,y[,chờ tối thiểu giây]: trong phó bản tự đứng như client thật, thoại → trận → kết quả, thử lại)", { numeric: true }),
  menu: s(1, 1, "Chọn mục menu", { numeric: true }),
  send: s(1, 1, "Gửi lựa chọn hội thoại", { numeric: true }),
  chat_local: s(1, 1, "Chat kênh local", { text: true }),
  chat_team: s(1, 1, "Chat kênh team", { text: true }),
  use_item: s(1, 4, "Dùng vật phẩm", { numeric: true }),
  use_item_pet: s(1, 4, "Dùng vật phẩm cho pet: <id> sl <số lượng>"),
  // chờ sự kiện
  await_battle: s(0, 0, "Chờ kết thúc trận đấu"),
  await_dialog: s(0, 0, "Chờ hộp thoại"),
  await_party: s(0, 0, "Chờ đủ party"),
  await_item: s(0, 2, "Chờ vật phẩm"),
  await_map: s(0, 1, "Chờ vào map"),
  // phó bản / party / pvp
  dungeon: s(1, 2, "Chọn phó bản [cấp]", { numeric: true }),
  start_dungeon: s(0, 0, "Bắt đầu phó bản"),
  leave_party: s(0, 0, "Rời party"),
  pvp: s(1, 1, "Khiêu chiến PvP", { numeric: true }),
  // pet
  save_pet_main: s(0, 0, "Ghi nhớ võ tướng xuất chiến"),
  select_pet: s(0, 4, "Chọn pet"),
  select_pet_main: s(0, 0, "Chọn võ tướng đã lưu"),
  select_pet_element: s(1, 1, "Chọn hệ (1 địa,2 thuỷ,3 hoả,4 phong)", { numeric: true }),
  select_pet_moral: s(1, 1, "Chọn đạo đức (1-5)", { numeric: true }),
  select_pet_turn: s(1, 1, "Chọn lượt chuyển sinh (0-2)", { numeric: true }),
  select_pet_skill: s(1, 1, "Chọn kỹ năng", { numeric: true }),
  // thô
  packet: s(1, 1, "Gửi nguyên văn gói hex qua Transport"),
};

export const BLOCK_COMMANDS = new Set(["loop", "if_map"]);
export const COMPARE_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);
