/**
 * PHÒNG PHÓ BẢN ĐỘI của codec ts-online — opcode 0x2f (Pim-Bot ghi THẬP PHÂN: `_47_02` = 2f/02).
 * Nguồn: pcap `captures/chupt_pbteam.pcap` (chủ PT, Thảo Phạt Thiên Sứ) + script TSM (`packet …` XOR 0xAD). Tài liệu: docs/DUNGEON_TEAM_KNOWLEDGE.md.
 *
 *   C→S 2f/01 `00`                 mở/làm mới danh sách phòng                       ✅ pcap (S→C 2f/01: `00 00 00` = không có phòng; có phòng: bản ghi dài, chưa giải mã)
 *   C→S 2f/02 `00 <id> 00 <pw>`    TẠO phòng phó bản <id> (1 = Thảo Phạt Thiên Sứ); <pw> 01 = có mật khẩu, 00 = không   ✅ pcap + TSM
 *   S→C 2f/02 `00 <code> <len> <pw ascii>`  kết quả tạo: code 00 = ok; có mật khẩu ⇒ server CẤP mã (vd len 4 "4010"), không ⇒ len 00   ✅ pcap
 *   C→S 2f/0a `00`                 HUỶ phòng / thoát chờ (TSM dùng sau khi chạy xong để dọn)     ✅ pcap (S→C 2f/0a `00 <uid mình> 00`)
 *   S→C 2f/0a `00 <uid> <st>`      trạng thái phòng của <uid>: 00 = đã huỷ, 03 = đã rời/kết thúc (đẩy khi rời phó bản)  ✅ pcap
 *   C→S 2f/0c `00`                 BẮT ĐẦU phó bản (chủ phòng) ⇒ S→C 2f/0b `00 <uid> 01`, 29/0c + 0c/00 đổi sang map phó bản (62002)   ✅ pcap + TSM
 *   S→C 2f/0b `00 <uid> <st>`        trạng thái SẴN SÀNG của <uid> (01 sẵn sàng, 00 bỏ) — chủ phòng nhận 01 ngay sau khi bắt đầu   ✅ pcap
 *   Rời phó bản đội: dùng RỜI ĐỘI `0d/04 00 <uid mình>` (chủ PT) ⇒ về map cũ + S→C 2f/0a st=03   ✅ pcap
 *   S→C 2f/01 `00 <n> { 00 <roomId u32> <len> <tên Big5/ASCII> <uid chủ 8> 00 <dungeonId> 00 <x> }*n`   ✅ pcap member_join_pbteam (n=1: roomId 788, "JunShiXiong", dungeonId=01 = Thiên Sứ; byte `x` cuối = SỐ NGƯỜI trong phòng: 01 chỉ chủ, 04 khi đã có 4 — log thật)
 *   C→S 2f/03 `00 <roomId u32> 00`   THÀNH VIÊN VÀO phòng (không mật khẩu; byte cuối 00 = độ dài mật khẩu — layout CÓ mật khẩu `len + ascii` là SUY RA, chưa có pcap)   ✅ pcap member_join_pbteam
 *   S→C 2f/03 `00 <code>` (NGẮN, len 10)  TỪ CHỐI vào phòng: code 03 gặp khi thành viên vẫn còn trong phòng CŨ (đã vào lần trước, bot chưa rời)   ✅ log thật 2026-10-21
 *   S→C 2f/03 `00 <code> <roomId u32> 01 <uid chủ 8> <len><tên> …thông tin chủ phòng (ngoại hình/trang bị)`  code 00 = ok; server còn đẩy lại 2f/01 cùng lúc   ✅ pcap
 *   C→S 2f/0b `00`                   BẬT/TẮT "Sẵn sàng" của thành viên (bật lần 1, tắt lần 2) ⇒ S→C 2f/0b `00 <uid mình> <01 sẵn sàng | 00 bỏ>`   ✅ pcap
 *   (Chiều chủ phòng: S→C 2f/0b `… 01` đã thấy ngay sau khi gửi 2f/0c bắt đầu — chủ phòng cũng ở trạng thái sẵn sàng.)
 *   ❓ Phó bản khác (vd Ngày Tàn Hoàn Quân id 14) chỉ thấy trong TSM, chưa có pcap.
 */
import type { DungeonRoomInfo, DungeonRoomState } from "@tsbot/protocol";

export const DUNGEON_ROOM_OP = 0x2f;
export const DUNGEON_ROOM_SUB = {
  LIST: 0x01,
  CREATE: 0x02,
  JOIN: 0x03,
  CANCEL: 0x0a,
  READY: 0x0b,
  START: 0x0c,
} as const;

/** Gói thành viên vào phòng (2f/03) + sẵn sàng (2f/0b) đã có pcap xác nhận (phòng KHÔNG mật khẩu). */
export const DUNGEON_ROOM_JOIN_VERIFIED = true;
export const DUNGEON_ROOM_JOIN_PENDING_MESSAGE =
  "Gói thành viên VÀO phòng phó bản đội (2f/03) chưa có pcap nên bot không gửi — xem docs/DUNGEON_TEAM_KNOWLEDGE.md §4";

export const DUNGEON_ROOM_ACTIONS = ["dungeon_room_create", "dungeon_room_join", "dungeon_room_start", "dungeon_room_cancel", "dungeon_room_list", "dungeon_room_ready", "dungeon_exit"] as const;
export type DungeonRoomAction = (typeof DUNGEON_ROOM_ACTIONS)[number];
export const isDungeonRoomAction = (name: string): name is DungeonRoomAction => (DUNGEON_ROOM_ACTIONS as readonly string[]).includes(name);

/** Payload (sau cmd/sub) của gói tạo phòng: `00 <id> 00 <cờ mật khẩu>`. */
export const createRoomPayload = (dungeonId: number, password: boolean): number[] => [0x00, dungeonId & 0xff, 0x00, password ? 0x01 : 0x00];

/** Payload gói vào phòng: `00 <roomId u32 LE> <độ dài mật khẩu> <mật khẩu ascii>`. Không mật khẩu = `00` (✅ pcap); có mật khẩu là SUY RA. */
export const joinRoomPayload = (roomId: number, password = ""): number[] => {
  const pw = Buffer.from(password, "latin1");
  const id = Buffer.alloc(4); id.writeUInt32LE(roomId);
  return [0x00, ...id, pw.length, ...pw];
};

const decodeName = (b: Buffer): string => { try { return new TextDecoder("big5").decode(b); } catch { return b.toString("latin1"); } };

/** Parse S→C 2f/01 (f = frame đã giải XOR). Bản ghi sai độ dài ⇒ dừng, trả phần đã đọc được. */
export function parseRoomList(f: Buffer): DungeonRoomInfo[] {
  const out: DungeonRoomInfo[] = [];
  if (f.length < 10) return out;
  let o = 10;
  for (let n = f[9]!; n > 0; n--) {
    if (o + 6 > f.length) break;
    const roomId = f.readUInt32LE(o + 1);
    const len = f[o + 5]!;
    const end = o + 6 + len + 8 + 4;
    if (end > f.length) break;
    const leaderName = decodeName(f.subarray(o + 6, o + 6 + len));
    out.push({ roomId, leaderName, dungeonId: f[o + 6 + len + 8 + 1]!, count: f[o + 6 + len + 8 + 3]! });
    o = end;
  }
  return out;
}

/** Theo dõi phòng của chính mình từ S→C 2f/02, 2f/0a, 2f/0b (`f` = frame đã giải XOR, payload từ f[8]). */
export class DungeonRoomTracker {
  state: DungeonRoomState = { status: "none" };
  /** Tăng mỗi lần nhận S→C 2f/01 (để action chờ "danh sách mới" dù nội dung không đổi). */
  listSeq = 0;

  /** Trả true nếu state đổi. `selfHex` = uid mình (hex) để bỏ qua trạng thái của người khác. */
  onPacket(sub: number, f: Buffer, selfHex = ""): boolean {
    const before = JSON.stringify(this.state);
    const keep = { ...(this.state.password ? { password: this.state.password } : {}), ...(this.state.rooms ? { rooms: this.state.rooms } : {}) };
    if (sub === DUNGEON_ROOM_SUB.LIST) {
      this.state = { ...this.state, rooms: parseRoomList(f) };
      this.listSeq++;
      return true;
    } else if (sub === DUNGEON_ROOM_SUB.CREATE && f.length >= 10) {
      const code = f[9]!;
      if (code !== 0) this.state = { ...keep, status: "error", code };
      else {
        const len = f.length > 10 ? f[10]! : 0;
        const password = len > 0 ? f.toString("latin1", 11, 11 + len) : undefined;
        this.state = { ...(this.state.rooms ? { rooms: this.state.rooms } : {}), status: "open", ...(password ? { password } : {}) };
      }
    } else if (sub === DUNGEON_ROOM_SUB.JOIN && f.length >= 10) {
      // Từ chối là gói NGẮN `00 <code>` (log thật: `2f/03 00 03` len 10) — trước đây bỏ sót vì đòi len ≥14 nên báo "server không trả lời".
      const code = f[9]!;
      if (code !== 0) this.state = { ...keep, status: "error", code };
      else if (f.length >= 14) this.state = { ...keep, status: "joined", roomId: f.readUInt32LE(10), ready: false };
    } else if (sub === DUNGEON_ROOM_SUB.CANCEL && f.length >= 18) {
      if (selfHex && f.toString("hex", 9, 17) !== selfHex) return false;
      const st = f[17]!;
      if (st === 0) this.state = { ...(this.state.rooms ? { rooms: this.state.rooms } : {}), status: "cancelled" };
      else if (st === 3) this.state = { ...(this.state.rooms ? { rooms: this.state.rooms } : {}), status: "left" };
    } else if (sub === DUNGEON_ROOM_SUB.START && f.length >= 11) {
      // S→C `2f/0c 00 00 <id> 00 03 …` = phó bản HOÀN THÀNH (pcap Thiên Sứ id 01, Ngày Tàn Hoạn Quan id 0e). (Chiều C→S 2f/0c = bắt đầu.)
      this.state = { ...this.state, status: "completed" };
    } else if (sub === DUNGEON_ROOM_SUB.READY && f.length >= 18) {
      if (selfHex && f.toString("hex", 9, 17) !== selfHex) return false;
      this.state = { ...this.state, ready: f[17] === 1 };
    }
    return JSON.stringify(this.state) !== before;
  }
}
