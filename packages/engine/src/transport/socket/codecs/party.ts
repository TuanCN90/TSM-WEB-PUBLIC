/**
 * Theo dõi ĐỘI NGŨ (party) của codec ts-online — opcode 0x0d (tên gói trong Pim-Bot ghi THẬP PHÂN: `_13_xx` = 0d/xx).
 * Tài liệu đầy đủ + mức tin cậy từng gói: docs/PARTY_KNOWLEDGE.md. Đọc file đó trước khi sửa logic ở đây.
 *
 * Tóm tắt giao thức (payload = f[8..], f[8] luôn 00; UID = 8 byte; byte cuối 6 byte luôn `67 d3 ac a8 0a 00` nên chỉ 2 byte đầu đổi):
 *   C→S 0d/07 `00 <uid>`           MỜI người chơi <uid> vào đội mình           ✅ (hex wire trong Easytool.dll: packetinvite)
 *   C→S 0d/01 `00 <uid>`           XIN vào đội của người chơi <uid>             ✅ (packetrequest)
 *   S→C 0d/01 `00 <uid>`           có người XIN vào đội của mình (uid = người xin) ⚠ suy luận (Pim `RequestParty`)
 *   S→C 0d/09 `00 <uid>`           có người MỜI mình (uid = người mời)          ✅ log thật (thay cho giả định 0d/07 ở trên)
 *   S→C 0d/0d `00 00`              server đã nhận lời mời/xin mình vừa gửi       ✅ log thật
 *   C→S 0d/08 `00 01 <uid>`        ĐỒNG Ý lời mời của <uid> (cờ 01 TRƯỚC uid)    ✅ pcap thanhvien_accept_invite_ → server đáp 0d/05
 *   C→S 0d/03 `00 01 <uid>`        ĐỒNG Ý lời xin của <uid> (chủ PT)             ❓ cùng layout, chưa có pcap riêng (các bản `00 uid`, `00 uid 01` đã thử thật: server im lặng)
 *   C→S 0d/04 `00 <uid mình>`      RỜI ĐỘI / chủ PT GIẢI TÁN (uid = chính mình)  ✅ pcap chupt_accept_request_assign_qsu_giai_tan_team
 *   C→S 0d/05 `00 <uid>`           GÁN QUÂN SƯ cho <uid> (chủ PT)                ✅ pcap cùng file → server đáp S→C 0d/07 + 0d/0b
 *   S→C 0d/04 `00 <uid> <x u16> <y u16>`  <uid> đã rời đội (mỗi người một gói)     ✅ pcap
 *   C→S 0d/09 `00 <uid>`           đổi chủ PT                                   ❓ (Pim `ChangeLeader_Party_13_09`)
 *   S→C 0d/06 `00 { <leader 8> <n u8> <n × uid 8> }*`  DANH SÁCH các đội trong map (mỗi đội: chủ + n thành viên, n=4 thấy trong pcap) ✅ pcap
 *   S→C 0d/05 `00 <leader 8> <joiner 8>`  một người vào đội của <leader>      ✅ pcap (Oct 23: 4 gói liền nhau khi lập đội)
 *   S→C 0d/0b `00 { <uid 8> }*`    uid Quân sư của từng đội (1 uid/đội)          ⚠ suy luận từ pcap (xem PARTY_KNOWLEDGE §3.3)
 *   S→C 0d/04 `…`                  có người rời đội                              ❓ định dạng chưa thấy; parse khoan dung
 */
import type { PartyMember, PartyState } from "@tsbot/protocol";

export const PARTY_SUB = {
  REQUEST: 0x01,
  REPLY_REQUEST: 0x03,
  LEAVE: 0x04,
  JOINED: 0x05,
  ROSTER: 0x06,
  /** C→S 0d/07 MỜI (chiều S→C 0d/07 = ADVISOR_SET, KHÔNG phải lời mời). */
  INVITE: 0x07,
  REPLY_INVITE: 0x08,
  /** C→S `00 <uid>` GÁN QUÂN SƯ cho thành viên (✅ pcap chupt_accept_request_assign_qsu_giai_tan_team). Tên Pim: `Sena_13_05`. */
  SET_ADVISOR: 0x05,
  /** S→C `00 <uid>` đã gán QSư cho <uid> (đi kèm 0d/0b). ✅ pcap. */
  ADVISOR_SET: 0x07,
  /** S→C `00 <uid>` (khi giải tán đội, uid = QSư cũ) QSư bị gỡ. ✅ xuất hiện cùng 0d/0c; ý nghĩa chính xác ⚠. */
  ADVISOR_CLEAR: 0x08,
  ADVISOR_CLEAR2: 0x0c,
  CHANGE_LEADER: 0x09,
  /** S→C: có người MỜI mình (uid người mời). ✅ log thật 2026-10-21: chủ PT gửi C→S 0d/07, người nhận thấy S→C 0d/09 (KHÔNG phải 0d/07). */
  INVITED: 0x09,
  ADVISORS: 0x0b,
  /** S→C `00 <code>`: server xác nhận ĐÃ NHẬN lời mời/xin của mình (code 00 = ok). ✅ log thật. */
  ACK: 0x0d,
} as const;

/** Chủ + 4 thành viên. */
export const MAX_PARTY = 5;
/** Lời mời/xin chưa trả lời quá ngần này ms thì bỏ (client thật cũng tự huỷ hộp thoại). */
const PENDING_TTL_MS = 90_000;
const MAX_PLAYERS = 600;

/** So tên không phân biệt hoa/thường, bỏ khoảng trắng đầu cuối. */
export const normName = (s: string) => s.replace(/§[0-9a-fk-or]/gi, "").normalize("NFKC").trim().toLowerCase();

export interface SeenPlayer {
  uid: string; // hex 16 ký tự
  name: string;
  map: number;
  x: number;
  y: number;
  seen: number;
}
export interface PendingParty {
  kind: "invite" | "request";
  uid: string;
  name: string;
  at: number;
}

const uidAt = (f: Buffer, o: number) => f.subarray(o, o + 8).toString("hex");

export class PartyTracker {
  /** Mọi người chơi từng thấy qua 03/00 (key = uid hex). Tên không đổi theo map nên giữ lại để gắn tên cho roster. */
  readonly players = new Map<string, SeenPlayer>();
  /** Các đội trong map hiện tại: leader uid → uid các thành viên (không gồm chủ). */
  parties = new Map<string, string[]>();
  advisors = new Set<string>();
  pending: PendingParty[] = [];

  /** 03/00: layout như self-spawn — uid@9, map u16@28, x@30, y@32, tên [len u8]@53 (Big5/ASCII). */
  onSpawn(f: Buffer, now = Date.now()): SeenPlayer | undefined {
    if (f.length < 54) return undefined;
    const len = f[53]!;
    if (54 + len > f.length) return undefined;
    const uid = uidAt(f, 9);
    let name: string;
    try { name = new TextDecoder("big5").decode(f.subarray(54, 54 + len)); } catch { name = f.toString("latin1", 54, 54 + len); }
    const p: SeenPlayer = { uid, name, map: f.readUInt16LE(28), x: f.readUInt16LE(30), y: f.readUInt16LE(32), seen: now };
    this.players.set(uid, p);
    if (this.players.size > MAX_PLAYERS) {
      const oldest = [...this.players.values()].sort((a, b) => a.seen - b.seen).slice(0, this.players.size - MAX_PLAYERS);
      for (const o of oldest) this.players.delete(o.uid);
    }
    return p;
  }

  /**
   * 0c/00 của NGƯỜI KHÁC: `uid@9, map u16@17, x u16@19, y u16@21` (cùng layout 0c/00 của chính mình).
   * Cần vì: người từng cùng đội KHÔNG được server gửi lại 03/00 (spawn) ở map mới sau khi teleport — chỉ có 0c/00 (log thật 2026-10-21:
   * hai tài khoản cùng ở map 12061 nhưng chủ PT báo "Không thấy" mãi vì bảng người chơi còn ghi map cũ). Chỉ cập nhật người ĐÃ biết tên (từ 03/00 trước đó).
   */
  onStatus(f: Buffer, now = Date.now()): SeenPlayer | undefined {
    if (f.length < 23) return undefined;
    const p = this.players.get(uidAt(f, 9));
    if (!p) return undefined;
    p.map = f.readUInt16LE(17); p.x = f.readUInt16LE(19); p.y = f.readUInt16LE(21); p.seen = now;
    return p;
  }

  /** Tìm người chơi theo tên TRONG map `map` (bản spawn mới nhất, loại trừ chính mình). */
  findInMap(name: string, map: number, selfUid: string): SeenPlayer | undefined {
    const key = normName(name);
    if (!key) return undefined;
    let best: SeenPlayer | undefined;
    for (const p of this.players.values()) {
      if (p.uid === selfUid || p.map !== map || normName(p.name) !== key) continue;
      if (!best || p.seen > best.seen) best = p;
    }
    return best;
  }

  /**
   * Tìm theo tên BẤT KỂ map (bản spawn/uid đã biết mới nhất). Dùng khi server không báo lại vị trí người từng cùng đội sau teleport
   * (log thật: Teemo_03 cùng map + cùng toạ độ nhưng không có 03/00 lẫn 0c/00 tới chủ PT) mà bên điều phối ĐÃ BIẾT hai tài khoản cùng map.
   */
  findAny(name: string, selfUid: string): SeenPlayer | undefined {
    const key = normName(name);
    if (!key) return undefined;
    let best: SeenPlayer | undefined;
    for (const p of this.players.values()) {
      if (p.uid === selfUid || normName(p.name) !== key) continue;
      if (!best || p.seen > best.seen) best = p;
    }
    return best;
  }

  nameOf(uid: string): string {
    return this.players.get(uid)?.name ?? "";
  }

  /** 0d/06: thay toàn bộ danh sách đội trong map. Trả về số đội đọc được. */
  parseRoster(f: Buffer): number {
    const next = new Map<string, string[]>();
    let o = 9;
    while (o + 9 <= f.length) {
      const leader = uidAt(f, o);
      const n = f[o + 8]!;
      o += 9;
      const members: string[] = [];
      for (let i = 0; i < n && o + 8 <= f.length; i++, o += 8) members.push(uidAt(f, o));
      next.set(leader, members);
    }
    this.parties = next;
    return next.size;
  }

  /** 0d/0b: các uid Quân sư (mỗi đội 1 uid). */
  parseAdvisors(f: Buffer) {
    const s = new Set<string>();
    for (let o = 9; o + 8 <= f.length; o += 8) s.add(uidAt(f, o));
    this.advisors = s;
  }

  /** S→C 0d/07: gán QSư cho `uid` — mỗi đội 1 QSư nên gỡ QSư cũ của cùng đội. */
  setAdvisor(uid: string) {
    const leader = this.leaderOf(uid);
    if (leader) for (const u of [leader, ...(this.parties.get(leader) ?? [])]) this.advisors.delete(u);
    this.advisors.add(uid);
  }
  clearAdvisor(uid: string) { this.advisors.delete(uid); }

  /** 0d/05: `<leader> <joiner>` — thêm joiner vào đội của leader (tạo đội nếu chưa có). */
  parseJoined(f: Buffer): { leader: string; joiner: string } | undefined {
    if (f.length < 25) return undefined;
    const leader = uidAt(f, 9), joiner = uidAt(f, 17);
    const m = this.parties.get(leader) ?? [];
    if (joiner !== leader && !m.includes(joiner)) m.push(joiner);
    this.parties.set(leader, m);
    return { leader, joiner };
  }

  /**
   * 0d/04 từ server (định dạng chưa biết): mọi uid 8 byte trong payload coi là người rời. Rời = bỏ khỏi đội; chủ rời = đội giải tán
   * (hoặc server sẽ gửi roster mới ngay sau đó). Trả về các uid đã xử lý.
   */
  parseLeft(f: Buffer): string[] {
    const out: string[] = [];
    for (let o = 9; o + 8 <= f.length; o += 8) out.push(uidAt(f, o));
    for (const uid of out) this.remove(uid);
    return out;
  }

  remove(uid: string) {
    if (this.parties.has(uid)) this.parties.delete(uid);
    for (const [l, m] of this.parties) {
      const i = m.indexOf(uid);
      if (i >= 0) m.splice(i, 1);
      if (m.length === 0 && !this.parties.has(l)) this.parties.delete(l);
    }
    this.advisors.delete(uid);
  }

  /** Lời mời/xin mới (S→C 0d/07 hoặc 0d/01). Cùng loại + cùng uid thì làm mới thời điểm. */
  addPending(kind: PendingParty["kind"], uid: string, now = Date.now()): PendingParty {
    this.prune(now);
    this.pending = this.pending.filter((p) => !(p.kind === kind && p.uid === uid));
    const p: PendingParty = { kind, uid, name: this.nameOf(uid), at: now };
    this.pending.push(p);
    return p;
  }

  takePending(kind: PendingParty["kind"], name?: string, now = Date.now()): PendingParty | undefined {
    this.prune(now);
    const key = name ? normName(name) : "";
    const i = this.pending.findIndex((p) => p.kind === kind && (!key || normName(p.name) === key));
    return i >= 0 ? this.pending.splice(i, 1)[0] : undefined;
  }

  private prune(now: number) {
    this.pending = this.pending.filter((p) => now - p.at < PENDING_TTL_MS);
  }

  /** uid chủ PT của đội chứa `selfUid` (kể cả mình là chủ), hoặc undefined nếu chưa trong đội. */
  leaderOf(selfUid: string): string | undefined {
    if (this.parties.has(selfUid)) return selfUid;
    for (const [l, m] of this.parties) if (m.includes(selfUid)) return l;
    return undefined;
  }

  /** Trạng thái đội của chính mình cho UI. Slot 1 = chủ PT, 2..5 = thành viên theo thứ tự server gửi. */
  snapshot(selfUid: string, inviteStatus = ""): PartyState {
    const leader = selfUid ? this.leaderOf(selfUid) : undefined;
    const uids = leader ? [leader, ...(this.parties.get(leader) ?? [])].slice(0, MAX_PARTY) : [];
    const members: PartyMember[] = Array.from({ length: MAX_PARTY }, (_, i) => {
      const uid = uids[i];
      return {
        slot: i + 1,
        name: uid ? (this.nameOf(uid) || `#${uid.slice(0, 4)}`) : "",
        isLeader: !!uid && uid === leader,
        isAdvisor: !!uid && this.advisors.has(uid),
        ...(uid ? { uid, isSelf: uid === selfUid } : {}),
      };
    });
    return { members, inviteStatus, joined: uids.length > 1, leaderName: leader ? this.nameOf(leader) : "" };
  }

  /** Số bước mô tả cho log: "BaiFern10 (chủ) + 4 thành viên". */
  describe(selfUid: string): string {
    const s = this.snapshot(selfUid);
    if (!s.joined) return "chưa vào đội";
    return s.members.filter((m) => m.name).map((m) => `${m.name}${m.isLeader ? "(chủ)" : ""}${m.isAdvisor ? "(QSư)" : ""}`).join(", ");
  }
}

/** Payload C→S dạng `00 <uid 8>` (+ byte phụ). */
export function partyPayload(uidHex: string, extra: number[] = []): number[] {
  return [0x00, ...Buffer.from(uidHex, "hex"), ...extra];
}

/**
 * Payload trả lời lời mời/xin: `00 <01 đồng ý> <uid người mời/xin>` — cờ đứng TRƯỚC uid.
 * ✅ 0d/08 (đồng ý lời mời) khớp pcap `thanhvien_accept_invite_.pcap`: `00 01 8e de 67 d3 ac a8 0a 00` → server đáp 0d/05.
 * ✅ 0d/03 (chủ PT đồng ý lời xin) cùng layout, khớp pcap chupt_accept_request_assign_qsu_giai_tan_team.
 */
export function partyReplyPayload(uidHex: string, accept = true): number[] {
  return [0x00, accept ? 0x01 : 0x00, ...Buffer.from(uidHex, "hex")];
}
