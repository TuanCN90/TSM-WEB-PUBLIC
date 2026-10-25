import { describe, expect, it, vi } from "vitest";
import { encodeFrame, tsOnlineCodec } from "../src/transport/socket/codecs/tsOnline";
import { DUNGEON_ROOM_JOIN_VERIFIED, DungeonRoomTracker, createRoomPayload, isDungeonRoomAction, joinRoomPayload, parseRoomList } from "../src/transport/socket/codecs/dungeonRoom";
import { buildCommand, parse } from "../src";
import { DUNGEON_ROOM_CATALOG } from "@tsbot/protocol";
import battleFx from "./fixtures/battle-team-member.json";
import type { DungeonRoomState } from "@tsbot/protocol";

/** Wire lấy NGUYÊN VĂN từ captures/chupt_pbteam.pcap (cũng trùng hex `packet …` trong script TSM). */
const WIRE = {
  createPw: "6d3ca1adadad82afadacadac", // 2f/02 00 01 00 01
  createNoPw: "6d3ca1adadad82afadacadad", // 2f/02 00 01 00 00
  cancel: "6d3ca4adadad82a7ad", // 2f/0a 00
  start: "6d3ca4adadad82a1ad", // 2f/0c 00
  list: "6d3ca4adadad82acad", // 2f/01 00
  join: "6d3ca3adadad82aeadb9aeadadad", // 2f/03 00 14 03 00 00 00  (member_join_pbteam.pcap)
  ready: "6d3ca4adadad82a6ad", // 2f/0b 00
};
/** S→C 2f/01 thật (member_join_pbteam): 1 phòng id 788, chủ "JunShiXiong", phó bản 01. */
const LIST_PAYLOAD = "000100140300000b4a756e536869 5869 6f6e67acd867d3aca80a000001 0001".replace(/ /g, "");
const JOIN_REPLY = "0000140300000 1acd867d3aca80a000b4a756e5368695869 6f6e67".replace(/ /g, "");
const SELF = "8ede67d3aca80a00";
const frame = (cmd: number, sub: number, payloadHex: string) => encodeFrame(Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(payloadHex, "hex")]));

function mk() {
  const sent: Buffer[] = [];
  let room: DungeonRoomState | undefined;
  const s = tsOnlineCodec.create({
    log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b),
    patchState: (p: { dungeonRoom?: DungeonRoomState }) => { if (p.dungeonRoom) room = p.dungeonRoom; },
  } as never);
  (s as unknown as { uid: Buffer }).uid = Buffer.from(SELF, "hex");
  return { s, sent, room: () => room };
}
const run = (s: ReturnType<typeof mk>["s"], name: string, args: string[]) => s.executeAction!(name, args, () => {}, new AbortController().signal);

describe("phòng phó bản đội — gói gửi byte-exact với pcap", () => {
  it("builder payload khớp wire pcap/TSM", () => {
    expect(encodeFrame(Buffer.from([0, 0, 0x2f, 0x02, ...createRoomPayload(1, true)])).toString("hex")).toBe(WIRE.createPw);
    expect(encodeFrame(Buffer.from([0, 0, 0x2f, 0x02, ...createRoomPayload(1, false)])).toString("hex")).toBe(WIRE.createNoPw);
  });

  it("tạo phòng có mật khẩu: gửi 2f/02 `00 01 00 01`, chờ S→C `00 00 04 \"4010\"` ⇒ ok + mật khẩu", async () => {
    const { s, sent, room } = mk();
    const p = run(s, "dungeon_room_create", ["1", "1"]);
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.createPw]);
    s.onData(frame(0x2f, 0x02, "0000043430" + "3130"));
    await expect(p).resolves.toEqual({ ok: true, message: "Mật khẩu phòng: 4010" });
    expect(room()).toEqual({ status: "open", password: "4010" });
  });

  it("tạo phòng không mật khẩu: S→C `00 00 00` ⇒ ok, không có mật khẩu", async () => {
    const { s, sent, room } = mk();
    const p = run(s, "dungeon_room_create", ["1", "0"]);
    expect(sent[0]!.toString("hex")).toBe(WIRE.createNoPw);
    s.onData(frame(0x2f, 0x02, "000000"));
    await expect(p).resolves.toEqual({ ok: true, message: undefined });
    expect(room()).toEqual({ status: "open" });
  });

  it("tạo phòng bị từ chối mã 4 (hết lượt trong ngày, log thật `2f/02 00 04`) ⇒ thông báo thân thiện đúng câu", async () => {
    const { s, sent } = mk();
    const p = run(s, "dungeon_room_create", ["1", "0"]);
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.createNoPw]);
    s.onData(frame(0x2f, 0x02, "0004"));
    const r = await p;
    expect(r).toEqual({ ok: false, message: "Phó bản đội [Thảo phạt khăn vàng] Ní đã hoàn tất hôm nay rồi, mai quay lại nha Ní ơi." });
  });

  it("tạo phòng phó bản đơn bị từ chối mã 4 ⇒ thông báo đúng câu dành cho phó bản đơn", async () => {
    const { s } = mk();
    // id 2 = Khiêu chiến Ba Đậu Yêu
    const p = run(s, "dungeon_room_create", ["2", "0"]);
    s.onData(frame(0x2f, 0x02, "0004"));
    const r = await p;
    expect(r).toEqual({ ok: false, message: "Ní đã hoàn thành phó bản [Khiêu chiến Ba Đậu Yêu] này rồi, mua thêm lượt hoặc chờ ngày mai nha ní ơi!!!" });
  });

  it("bắt đầu / huỷ / danh sách gửi đúng wire", async () => {
    const { s, sent } = mk();
    await run(s, "dungeon_room_start", []);
    await run(s, "dungeon_room_cancel", []);
    await run(s, "dungeon_room_list", []);
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.start, WIRE.cancel, WIRE.list]);
  });

  it("builder join/ready khớp wire pcap", () => {
    expect(encodeFrame(Buffer.from([0, 0, 0x2f, 0x03, ...joinRoomPayload(788)])).toString("hex")).toBe(WIRE.join);
    expect(encodeFrame(Buffer.from([0, 0, 0x2f, 0x0b, 0])).toString("hex")).toBe(WIRE.ready);
  });

  it("Tìm đội: làm mới danh sách → chọn ĐÚNG phòng theo tên chủ + phó bản (bỏ qua phòng khác) → gửi 2f/03 → chờ S→C ok → Sẵn sàng", async () => {
    const { s, sent, room } = mk();
    // hai phòng: "JunShiXiong" (phó bản 1) và "Khac" (phó bản 1, roomId 5) — chỉ vào đúng phòng của JunShiXiong
    const two = "0002" + "00" + "05000000" + "04" + Buffer.from("Khac").toString("hex") + "1122334455667788" + "00010001" + "00" + "14030000" + "0b" + Buffer.from("JunShiXiong").toString("hex") + "acd867d3aca80a00" + "00010001";
    const p = run(s, "dungeon_room_join", ["junshixiong", "1", ""]);
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.list]);
    s.onData(frame(0x2f, 0x01, two));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.list, WIRE.join]);
    s.onData(frame(0x2f, 0x03, JOIN_REPLY));
    await expect(p).resolves.toEqual({ ok: true });
    expect(room()).toMatchObject({ status: "joined", roomId: 788, ready: false });
    const q = run(s, "dungeon_room_ready", []);
    expect(sent[sent.length - 1]!.toString("hex")).toBe(WIRE.ready);
    s.onData(frame(0x2f, 0x0b, `00${SELF}01`));
    await expect(q).resolves.toEqual({ ok: true });
    expect(room()?.ready).toBe(true);
  });

  it("Tìm đội: không có phòng của chủ ⇒ báo lỗi rõ, KHÔNG gửi 2f/03", async () => {
    const { s, sent } = mk();
    const p = run(s, "dungeon_room_join", ["NguoiKhac", "1", ""]);
    s.onData(frame(0x2f, 0x01, LIST_PAYLOAD));
    const r = await p;
    expect(r?.ok).toBe(false);
    expect(r?.message).toContain("JunShiXiong#1");
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.list]);
  });

  it("Tìm đội: đúng chủ nhưng khác loại phó bản ⇒ không vào", async () => {
    const { s, sent } = mk();
    const p = run(s, "dungeon_room_join", ["JunShiXiong", "14", ""]);
    s.onData(frame(0x2f, 0x01, LIST_PAYLOAD));
    expect((await p)?.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });
});

describe("vào phòng bị từ chối (log thật 2026-10-21: `2f/03 00 03`)", () => {
  const rec = (id: number, name: string, uid: string, n: number) => "00" + Buffer.from([id & 255, id >> 8, 0, 0]).toString("hex") + Buffer.from([name.length]).toString("hex") + Buffer.from(name).toString("hex") + uid + "00" + "01" + "00" + n.toString(16).padStart(2, "0");
  const list = (...r: string[]) => "00" + r.length.toString(16).padStart(2, "0") + r.join("");
  const CANCEL = "6d3ca4adadad82a7ad";
  const joinWire = (id: number) => encodeFrame(Buffer.from([0, 0, 0x2f, 0x03, ...joinRoomPayload(id)])).toString("hex");

  it("gói từ chối NGẮN `00 03` được nhận ra (trước đây báo 'server không trả lời'); chọn phòng MỚI NHẤT của chủ khi còn phòng cũ cùng tên; mã 3 ⇒ rời phòng cũ (2f/0a) rồi thử lại 1 lần", async () => {
    const { s, sent } = mk();
    const L = list(rec(973, "JunShiXiong", "b3de67d3aca80a00", 4), rec(975, "JunShiXiong", "acd867d3aca80a00", 1));
    const p = run(s, "dungeon_room_join", ["JunShiXiong", "1", ""]);
    s.onData(frame(0x2f, 0x01, L));
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((b) => b.toString("hex"))).toEqual([WIRE.list, joinWire(975)]); // phòng 975 (mới hơn), không phải 973
    s.onData(frame(0x2f, 0x03, "0003")); // bị từ chối
    await new Promise((r) => setTimeout(r, 1500));
    expect(sent.map((b) => b.toString("hex")).slice(2, 4)).toEqual([CANCEL, WIRE.list]);
    s.onData(frame(0x2f, 0x01, L));
    await new Promise((r) => setTimeout(r, 0));
    s.onData(frame(0x2f, 0x03, "0003")); // vẫn từ chối ⇒ báo lỗi rõ, không lặp vô hạn
    const r = await p;
    expect(r?.ok).toBe(false);
    expect(r?.message).toContain("mã 3");
    expect(sent.filter((b) => b.toString("hex") === CANCEL)).toHaveLength(1);
  }, 10000);
});

describe("parseRoomList — S→C 2f/01 từ pcap", () => {
  const dec = (hex: string) => Buffer.concat([Buffer.alloc(6), Buffer.from([0x2f, 0x01]), Buffer.from(hex, "hex")]);
  it("1 phòng: id 788, chủ JunShiXiong, phó bản 1", () => {
    expect(parseRoomList(dec(LIST_PAYLOAD))).toEqual([{ roomId: 788, leaderName: "JunShiXiong", dungeonId: 1, count: 1 }]);
  });
  it("danh sách rỗng `00 00 00` và bản ghi cụt ⇒ không ném lỗi", () => {
    expect(parseRoomList(dec("000000"))).toEqual([]);
    expect(parseRoomList(dec(LIST_PAYLOAD.slice(0, 30)))).toEqual([]);
  });
});

describe("thoát phó bản = rời đội 0d/04 (pcap chupt_pbteam 81.9s)", () => {
  it("dungeon_exit gửi đúng wire `0d/04 00 <uid mình>` kể cả khi không ở trong đội nào", async () => {
    const { s, sent } = mk();
    expect(await run(s, "dungeon_exit", [])).toEqual({ ok: true });
    expect(sent.map((b) => b.toString("hex"))).toEqual(["6d3cbcadadada0a9ad2373ca7e0105a7ad"]); // wire thật trong pcap (1 lần)
  });
});

describe("DungeonRoomTracker — gói S→C từ pcap", () => {
  /** Frame ĐÃ giải XOR như `handle()` truyền vào tracker: 6 byte header + cmd + sub + payload. */
  const f = (sub: number, hex: string) => Buffer.concat([Buffer.alloc(6), Buffer.from([0x2f, sub]), Buffer.from(hex, "hex")]);
  it("2f/0b st=01 ⇒ ready (giữ trạng thái/mật khẩu); 2f/0a st=03 ⇒ left; st=00 ⇒ cancelled; uid người khác bị bỏ qua", () => {
    const t = new DungeonRoomTracker();
    t.onPacket(0x02, f(0x02, "0000043430" + "3130"), SELF);
    expect(t.onPacket(0x0b, f(0x0b, `00${SELF}01`), SELF)).toBe(true);
    expect(t.state).toEqual({ status: "open", password: "4010", ready: true });
    expect(t.onPacket(0x0a, f(0x0a, "00" + "1122334455667788" + "03"), SELF)).toBe(false); // uid khác
    expect(t.onPacket(0x0a, f(0x0a, `00${SELF}03`), SELF)).toBe(true);
    expect(t.state.status).toBe("left");
    t.onPacket(0x0a, f(0x0a, `00${SELF}00`), SELF);
    expect(t.state.status).toBe("cancelled");
  });
  it("mã lỗi ≠ 0 ⇒ error", () => {
    const t = new DungeonRoomTracker();
    t.onPacket(0x02, f(0x02, "0003"), SELF);
    expect(t.state).toEqual({ status: "error", code: 3 });
  });
  it("actions đăng ký", () => {
    expect(isDungeonRoomAction("dungeon_room_cancel")).toBe(true);
    expect(buildCommand("dungeon_room_create", { dungeon: 1, password: 1 })).toEqual({ type: "Action", name: "dungeon_room_create", args: ["1", "1"] });
  });
});

describe("lệnh script dùng trong lộ trình phó bản (TSM)", () => {
  it("`auto 1|0` không cần gói tin: chỉ đổi cờ autoFight (trước đây báo 'chưa có gói tin' làm script chết ngay)", async () => {
    const patches: { battleConfig?: { autoFight: boolean } }[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: () => {}, patchState: (p: object) => patches.push(p) } as never);
    expect(await s.executeAction!("auto", ["0"], () => {}, new AbortController().signal)).toEqual({ ok: true });
    expect(patches.at(-1)?.battleConfig?.autoFight).toBe(false);
    expect(await s.executeAction!("auto", ["1"], () => {}, new AbortController().signal)).toEqual({ ok: true });
    expect(patches.at(-1)?.battleConfig?.autoFight).toBe(true);
  });
  it("`await_battle`: không có trận ⇒ trả về sau ≤8s; có trận ⇒ chờ hết trận", async () => {
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: () => {}, patchState: () => {} } as never);
    const any = s as unknown as { inBattle: boolean };
    any.inBattle = true;
    const p = s.waitFor!("battle", [], 5000, new AbortController().signal);
    setTimeout(() => { any.inBattle = false; }, 400);
    await expect(p).resolves.toBeUndefined();
    await expect(s.waitFor!("dialog", [], 100, new AbortController().signal)).rejects.toThrow(/chưa hỗ trợ/);
  });
});

/** S→C 16/04: 1 NPC (idx 20, x590,y340) — danh sách NPC chỉ về sau khi client gửi `0c/01` (pcap completed_phoban_khanvang_chupt 31.1s). */
const NPC20_LIST = frame(0x16, 0x04, "00" + "0100" + "1400" + "0000" + "4e02" + "5401" + "00" + "00000000");

describe("warp_id trong map phó bản (cửa 1/2/3 của map 62002)", () => {
  /** 0c/00 server đặt lại vị trí: payload `00 uid8 map u16 x u16 y u16 …`. */
  const at = (map: number, x: number, y: number) => frame(0x0c, 0x00, "00" + SELF + Buffer.from([map & 255, map >> 8, x & 255, x >> 8, y & 255, y >> 8]).toString("hex") + "0000000000000000");
  const setup = (inBattle = false) => {
    const w: Buffer[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: () => {}, patchState: () => {} } as never);
    const any = s as unknown as { uid: Buffer; location: object; inBattle: boolean };
    any.uid = Buffer.from(SELF, "hex");
    any.location = { map: 62002, x: 100, y: 780, channel: 0 };
    any.inBattle = inBattle;
    s.onData(NPC20_LIST); // đã có danh sách NPC (đã xin 0c/01 sau cổng 1)
    return { s, w, any, write: (b: Buffer) => w.push(b) };
  };
  const hex = (b: Buffer) => b.toString("hex");
  const door = (n: number) => hex(encodeFrame(Buffer.from([0, 0, 0x14, 0x08, 0, n, 0])));

  it("đi tới toạ độ cửa rồi gửi 14/08; chờ server báo vị trí mới; lệnh lặp y hệt ngay sau đó bị BỎ QUA (không đi ngược lại)", async () => {
    const { s, w, any, write } = setup();
    const p1 = s.executeAction!("warp_id", ["1", "62002", "50", "780"], write, new AbortController().signal);
    // pcap chupt_pbteam: cổng 1 KHÔNG đổi map — server đáp 06/02 + câu thoại 14/01 rồi vào trận
    setTimeout(() => s.onData(frame(0x06, 0x02, "00")), 1000);
    setTimeout(() => { any.inBattle = true; }, 1500);
    setTimeout(() => { any.inBattle = false; }, 2000);
    await expect(p1).resolves.toEqual({ ok: true });
    expect(w.map(hex)).toContain(door(1));
    expect(w.filter((b) => hex(b) === door(1))).toHaveLength(1);
    const n = w.length;
    await expect(s.executeAction!("warp_id", ["1", "62002", "50", "780"], write, new AbortController().signal)).resolves.toEqual({ ok: true });
    expect(w).toHaveLength(n); // không gửi thêm gói nào
  }, 15000);

  it("cổng dịch chuyển (pcap phobandoi_02 56.5s): 06/02 + 14/07 + 0c/00 ⇒ đáp ĐÚNG 1 gói 14/06, KHÔNG chờ trận 40s", async () => {
    const sent: Buffer[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
    const any = s as unknown as { uid: Buffer; location: object };
    any.uid = Buffer.from(SELF, "hex");
    any.location = { map: 62011, x: 550, y: 2850, channel: 0 };
    s.onData(NPC20_LIST);
    const t0 = Date.now();
    const p = s.executeAction!("warp_id", ["2", "62011", "550", "2850"], () => {}, new AbortController().signal);
    setTimeout(() => { s.onData(frame(0x06, 0x02, "00")); s.onData(frame(0x14, 0x07, "00")); s.onData(at(62011, 1530, 2070)); }, 300);
    await expect(p).resolves.toEqual({ ok: true });
    expect(Date.now() - t0).toBeLessThan(8000);
    const acks = sent.filter((b) => hex(b) === "6d3ca4adadadb9abad");
    expect(acks).toHaveLength(1);
  }, 15000);

  it("đang trong trận đấu ⇒ KHÔNG gửi gói di chuyển, chờ hết trận mới đi", async () => {
    const { s, w, any, write } = setup(true);
    const p = s.executeAction!("warp_id", ["2", "62002", "470", "700"], write, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 900));
    expect(w).toHaveLength(0);
    any.inBattle = false;
    setTimeout(() => s.onData(frame(0x14, 0x08, "0004")), 3500); // server từ chối cổng (mã 04) ⇒ không treo chờ trận
    await expect(p).resolves.toEqual({ ok: true });
    expect(w.length).toBeGreaterThan(1);
    expect(w.map(hex)).toContain(door(2));
  }, 15000);
});

describe("chuỗi thoại phó bản — đáp 14/06 (pcap chupt_pbteam)", () => {
  const ACK = "6d3ca4adadadb9abad"; // C→S 14/06 00 (17 lần trong pcap)
  const DIALOG1 = "00000000" + "01000301" + "0004d007" + "00000000"; // S→C 14/01 câu thoại idx 1 (len 24)
  it("sau `click` NPC phó bản: mỗi câu thoại 14/01 nhận được ⇒ đáp đúng 1 gói 14/06; kết quả 16/03 cũng đáp", async () => {
    const sent: Buffer[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
    const any = s as unknown as { uid: Buffer; location: object };
    any.uid = Buffer.from(SELF, "hex");
    any.location = { map: 62002, x: 590, y: 340, channel: 0 };
    (s as unknown as { openDialogWindow(ms: number): void }).openDialogWindow(45_000); // như sau click/cổng phó bản
    sent.length = 0;
    s.onData(frame(0x14, 0x01, DIALOG1));
    s.onData(frame(0x14, 0x01, "00000000" + "02000302" + "0004d007" + "00000000"));
    expect(sent).toHaveLength(0); // đáp có độ trễ như client thật (≥450ms/ack)
    await new Promise((r) => setTimeout(r, 1500));
    expect(sent.map((b) => b.toString("hex"))).toEqual([ACK, ACK]);
    s.onData(frame(0x16, 0x03, "000100d007"));
    await new Promise((r) => setTimeout(r, 700));
    expect(sent).toHaveLength(3);
  }, 10000);
  it("hết trận: server chỉ gửi `14/0d` (log thật 14:03) ⇒ đáp 14/06, canh lại mỗi 1.5s; server im lặng ≥3s ⇒ canh tối đa 3 lần rồi tự đóng cờ trận (không treo, không ack thừa)", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { inBattle: boolean; openDialogWindow(ms: number): void };
      any.inBattle = true;
      any.openDialogWindow(45_000);
      s.onData(frame(0x14, 0x0d, "00"));
      await vi.advanceTimersByTimeAsync(600);
      expect(sent.map((b) => b.toString("hex"))).toEqual([ACK]); // 1 ack ngay (độ trễ 450ms)
      await vi.advanceTimersByTimeAsync(9000);
      expect(sent.length).toBe(1 + 3); // 1 ack + 3 lần canh (chỉ khi server im lặng)
      expect(any.inBattle).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("KHÔNG ack thừa: nhiều câu thoại dồn về rồi `14/08 00 2a` chốt chuỗi ⇒ các ack còn xếp hàng bị huỷ (pcap: số ack = số gói, hết chuỗi không còn ack)", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { openDialogWindow(ms: number): void };
      any.openDialogWindow(45_000);
      for (const n of [1, 2, 3]) s.onData(frame(0x14, 0x01, "00000000" + `0${n}000301` + "0004d007" + "00000000"));
      await vi.advanceTimersByTimeAsync(100); // chưa tới giờ ack (450ms)
      s.onData(frame(0x14, 0x08, "002a")); // server chốt chuỗi
      await vi.advanceTimersByTimeAsync(5000);
      expect(sent).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("chuỗi đang chạy bình thường (server vẫn gửi) ⇒ watchdog KHÔNG gửi ack chen vào", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { inBattle: boolean; openDialogWindow(ms: number): void };
      any.inBattle = true; any.openDialogWindow(60_000);
      s.onData(frame(0x14, 0x0d, "00")); // ack #1 sau 450ms
      for (let i = 1; i <= 6; i++) { await vi.advanceTimersByTimeAsync(1000); s.onData(frame(0x16, 0x03, `00${i.toString(16).padStart(2, "0")}00d007`)); }
      // 6 gói 16/03 + 1 14/0d = 7 gói ⇒ đúng 7 ack (tối đa), không có ack canh chen vào
      await vi.advanceTimersByTimeAsync(1000); // < 3s im lặng ⇒ chưa canh
      expect(sent.length).toBe(7);
    } finally { vi.useRealTimers(); }
  });
  it("14/08 đến trong lúc canh ⇒ dừng canh", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { inBattle: boolean; openDialogWindow(ms: number): void };
      any.inBattle = true; any.openDialogWindow(45_000);
      s.onData(frame(0x14, 0x0d, "00"));
      await vi.advanceTimersByTimeAsync(1700);
      s.onData(frame(0x14, 0x08, "002a"));
      const n = sent.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(sent.length).toBe(n);
      expect(any.inBattle).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("KHÔNG có cửa sổ (không vừa qua cổng/bấm NPC bằng script) ⇒ không tự đáp", async () => {
    const sent: Buffer[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
    s.onData(frame(0x14, 0x01, DIALOG1));
    await new Promise((r) => setTimeout(r, 700));
    expect(sent).toHaveLength(0);
  });
});

describe("trận đội 5 người — mỗi client chỉ ra lệnh cho đơn vị CỦA MÌNH (log thật 14:45: MiaoYin01 không có võ tướng ⇒ lệnh võ tướng nhầm ⇒ kick mã 42)", () => {
  const bf = battleFx as { self_uid: string; spawn_frames_decoded: string[] };
  /** frame đã giải XOR trong log → wire */
  const wire = (hex: string) => encodeFrame(Buffer.from(hex, "hex").subarray(4));
  it("thành viên không có võ tướng trong trận: chỉ gửi lệnh nhân vật, KHÔNG gửi lệnh võ tướng", () => {
    const sent: Buffer[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
    (s as unknown as { uid: Buffer }).uid = Buffer.from(bf.self_uid, "hex");
    for (const h of bf.spawn_frames_decoded) s.onData(wire(h));
    const units = (s as unknown as { battleUnits: { isPet?: boolean; owner?: string; isEnemy: boolean; name: string }[] }).battleUnits;
    expect(units.filter((u) => !u.isEnemy && !u.isPet).map((u) => u.name).sort()).toEqual(["JunShiXiong", "MiaoYin01", "Teemo_01", "Teemo_02", "Teemo_03"]); // `0b/fa` gộp cả đội (553 byte) ⇒ đủ 5 slot người
    expect(units.filter((u) => u.isPet).every((u) => u.owner !== bf.self_uid)).toBe(true); // võ tướng đồng đội không bị coi là của mình
    s.onData(encodeFrame(Buffer.from([0, 0, 0x34, 0x01, 0])));
    const actions = sent.filter((b) => (b[6]! ^ 0xad) === 0x32 && (b[7]! ^ 0xad) === 0x01);
    expect(actions).toHaveLength(1); // chỉ nhân vật
  });
});

describe("trận đội — hiển thị đúng từng slot (tên/cấp/HP không bị ghi đè bằng của tài khoản mình)", () => {
  const bf = battleFx as { self_uid: string; spawn_frames_decoded: string[] };
  const wire = (hex: string) => encodeFrame(Buffer.from(hex, "hex").subarray(4));
  it("33/01 cập nhật HP đồng đội (3,1): giữ tên/cấp của họ, KHÔNG đổi HP/tên của nhân vật mình", () => {
    let st: { player?: { hp: { cur: number } }; battleUnits?: { row: number; col: number; name: string; level: number; hp: { cur: number } }[] } = {};
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: () => {}, patchState: (p: object) => { st = { ...st, ...p }; } } as never);
    const any = s as unknown as { uid: Buffer; player: { name: string; level: number; hp: { cur: number; max: number } } };
    any.uid = Buffer.from(bf.self_uid, "hex");
    any.player = { ...any.player, name: "MiaoYin01", level: 121, hp: { cur: 109, max: 401 } };
    for (const h of bf.spawn_frames_decoded) s.onData(wire(h));
    const slot = st.battleUnits!.find((u) => u.name === "Teemo_02")!;
    const myHp = any.player.hp.cur;
    const rec = Buffer.alloc(7); rec[0] = slot.row; rec[1] = slot.col; rec[2] = 0x19; rec.writeUInt32LE(77, 3);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x33, 0x01, 0, 1]), rec])));
    const t2 = st.battleUnits!.find((u) => u.row === slot.row && u.col === slot.col)!;
    expect(t2.name).toBe("Teemo_02");
    expect(t2.level).toBe(120);
    expect(t2.hp.cur).toBe(77);
    expect(any.player.hp.cur).toBe(myHp);
    expect(st.battleUnits!.filter((u) => u.row === 3).map((u) => u.name).sort()).toEqual(["JunShiXiong", "MiaoYin01", "Teemo_01", "Teemo_02", "Teemo_03"].sort());
  });
});

describe("0c/01 xin danh sách NPC/đội trong phó bản (nguyên nhân thật của 14/08 00 27)", () => {
  const SYNC = "6d3ca4adadada1acad"; // C→S 0c/01 00 — 3 lần trong pcap, kể cả 0.35s sau cổng 1
  it("cổng 1 khi chưa có danh sách NPC ⇒ ~350ms sau gói cổng gửi `0c/01 00`; có 16/04 rồi thì cổng sau KHÔNG gửi nữa", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { uid: Buffer; location: object };
      any.uid = Buffer.from(SELF, "hex");
      any.location = { map: 62002, x: 50, y: 800, channel: 0 };
      const hx2 = (b: Buffer) => b.toString("hex");
      const p = s.executeAction!("warp_id", ["1", "62002", "50", "780"], (b) => sent.push(b), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(1000);
      const wh = sent.map(hx2);
      const di = wh.indexOf(hx2(encodeFrame(Buffer.from([0, 0, 0x14, 0x08, 0, 1, 0]))));
      expect(di).toBeGreaterThanOrEqual(0);
      expect(wh.indexOf(SYNC)).toBe(di + 1); // 0c/01 ngay sau gói cổng
      s.onData(NPC20_LIST); // server trả danh sách NPC
      s.onData(frame(0x06, 0x02, "00")); // cổng được nhận
      await vi.advanceTimersByTimeAsync(2000);
      (s as unknown as { inBattle: boolean }).inBattle = true; await vi.advanceTimersByTimeAsync(500);
      (s as unknown as { inBattle: boolean }).inBattle = false; s.onData(frame(0x14, 0x08, "002a"));
      await vi.advanceTimersByTimeAsync(20_000);
      await p;
      const n = sent.map(hx2).filter((h) => h === SYNC).length;
      expect(n).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("click_boss: NPC 20 chưa có trong danh sách NPC ⇒ gửi `0c/01` xin trước khi bấm", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { uid: Buffer; location: object; inBattle: boolean };
      any.uid = Buffer.from(SELF, "hex");
      any.location = { map: 62002, x: 650, y: 390, channel: 0 };
      const p = s.executeAction!("click_boss", ["20", "62002", "650", "390"], (b) => sent.push(b), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(500);
      expect(sent.map((b) => b.toString("hex"))).toContain(SYNC);
      s.onData(NPC20_LIST);
      await vi.advanceTimersByTimeAsync(4000);
      any.inBattle = true;
      await vi.advanceTimersByTimeAsync(1000);
      await expect(p).resolves.toEqual({ ok: true });
    } finally { vi.useRealTimers(); }
  });
});

describe("click_boss — chặng Trương Giác (NPC 20)", () => {
  const ACK = "6d3ca4adadadb9abad"; // 14/06 00
  const mk2 = () => {
    const sent: Buffer[] = [];
    const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
    const any = s as unknown as { uid: Buffer; location: object; inBattle: boolean };
    any.uid = Buffer.from(SELF, "hex");
    any.location = { map: 62002, x: 590, y: 340, channel: 0 };
    s.onData(NPC20_LIST);
    return { s, sent, any, write: (b: Buffer) => sent.push(b) };
  };
  const hx = (b: Buffer) => b.toString("hex");
  const CLICK20 = hx(encodeFrame(Buffer.from([0, 0, 0x14, 0x01, 0, 20, 0])));
  const MENU1 = hx(encodeFrame(Buffer.from([0, 0, 0x14, 0x09, 0, 1])));

  it("bấm NPC 20 → server từ chối đáp thoại (14/08 00 27, log thật) ⇒ KHÔNG gửi 14/09 đoán mò (log 14:37 bị kick mã 5), chờ NPC hiển thị rồi bấm lại; vào trận ⇒ ok", async () => {
    vi.useFakeTimers();
    try {
      const { s, sent, any, write } = mk2();
      const p = s.executeAction!("click_boss", ["20", "62002", "590", "340"], write, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sent.map(hx)).toContain(CLICK20);
      s.onData(frame(0x14, 0x08, "0027"));
      await vi.advanceTimersByTimeAsync(25_000); // hết lượt chờ vào trận 12s + chờ thêm 8s ⇒ bấm lại lần 2
      expect(sent.map(hx)).not.toContain(MENU1);
      expect(sent.filter((b) => hx(b) === CLICK20).length).toBeGreaterThanOrEqual(2);
      any.inBattle = true;
      await vi.advanceTimersByTimeAsync(1000);
      await expect(p).resolves.toEqual({ ok: true });
    } finally { vi.useRealTimers(); }
  });

  it("NPC chỉ hiển thị SAU ~12s kể từ chuỗi cuối (pcap completed_phoban_khanvang_chupt: 14/08 2a 85.46s → bấm 97.54s) ⇒ bot chờ đủ 12s mới bấm", async () => {
    vi.useFakeTimers();
    try {
      const { s, sent, write } = mk2();
      s.onData(frame(0x14, 0x08, "002a")); // chuỗi hết trận cổng 3 vừa kết thúc
      const p = s.executeAction!("click_boss", ["20", "62002", "590", "340"], write, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(7000);
      expect(sent.map(hx)).not.toContain(CLICK20); // chưa đủ 12s
      await vi.advanceTimersByTimeAsync(6000);
      expect(sent.map(hx)).toContain(CLICK20);
      // dọn: vào trận để action kết thúc
      (s as unknown as { inBattle: boolean }).inBattle = true;
      await vi.advanceTimersByTimeAsync(1000);
      await expect(p).resolves.toEqual({ ok: true });
    } finally { vi.useRealTimers(); }
  });

  it("replay pcap chupt_phoban01: gửi `20/02 00 08` NGAY TRƯỚC `14/01 00 14 00`; 2 câu thoại loại 01 (mỗi câu ack 14/06) rồi vào trận", async () => {
    const { s, sent, any, write } = mk2();
    const p = s.executeAction!("click_boss", ["20", "62002", "590", "340"], write, new AbortController().signal);
    await new Promise((r) => setTimeout(r, 2800)); // 3 lần gửi lại vị trí (~1.3s) + chờ 1.1s như client thật
    const wireHex = sent.map(hx);
    const i = wireHex.indexOf(CLICK20);
    expect(i).toBeGreaterThan(0);
    expect(wireHex[i - 1]).toBe("6d3ca7adadad8dafada5"); // 20/02 00 08 — wire có trong pcap thật
    s.onData(frame(0x06, 0x02, "00"));
    s.onData(frame(0x14, 0x01, "00000000" + "0101031400000000" + "0000625d")); // câu 1 (pcap 105.303s)
    await new Promise((r) => setTimeout(r, 1500)); // ack NPC trễ ~1.2s như client thật
    s.onData(frame(0x14, 0x01, "00000000" + "0201070000000000" + "0000635d")); // câu 2 (pcap 106.583s)
    await new Promise((r) => setTimeout(r, 1500)); // ack NPC trễ ~1.2s như client thật
    expect(sent.filter((b) => hx(b) === ACK).length).toBe(2);
    any.inBattle = true; // 0b/fa — trận cuối
    await expect(p).resolves.toEqual({ ok: true });
  }, 40000);

  it("không vào được trận sau 3 lần ⇒ báo lỗi rõ (để bấm Thoát phó bản), không treo", async () => {
    vi.useFakeTimers();
    try {
      const { s, sent, write } = mk2();
      const p = s.executeAction!("click_boss", ["20", "62002", "590", "340"], write, new AbortController().signal);
      const done = p.then((r) => r);
      await vi.advanceTimersByTimeAsync(3 * 30_000);
      const r = await done;
      expect(r?.ok).toBe(false);
      expect(r?.message).toContain("3 lần");
      expect(sent.filter((b) => hx(b) === CLICK20).length).toBeGreaterThanOrEqual(3);
    } finally { vi.useRealTimers(); }
  });
});

describe("lộ trình trong map phó bản", () => {
  it("mọi checkpoint Thiên Sứ (TSM) parse hợp lệ bằng DSL của web bot", () => {
    const def = DUNGEON_ROOM_CATALOG.find((d) => d.id === 1)!;
    expect(def.steps!.map((x) => x.name)).toEqual(["Cổng 1", "Cổng 2", "Cổng 3", "Trương Giác"]);
    for (const st of def.steps!) expect(parse(st.script).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(def.steps![0]!.script).toContain("warp_id 1,62002,50,780");
    expect(def.steps![1]!.script).toContain("warp_id 2,62002,470,700");
    expect(def.steps![2]!.script).toContain("warp_id 3,62002,730,560");
    expect(def.steps![3]!.script).toContain("click_boss 20,62002,650,390");
  });
});

describe("Ngày Tàn Hoạn Quan (pcap phobandoi_02_chupt_hoantat)", () => {
  it("catalog: id 14, map 62011, đã kiểm chứng; 4 chặng parse hợp lệ bằng DSL, đúng điểm đứng/cổng từ pcap", () => {
    const def = DUNGEON_ROOM_CATALOG.find((d) => d.id === 14)!;
    expect(def.map).toBe(62011);
    expect(def.verified).toBe(true);
    expect(def.steps!).toHaveLength(4);
    for (const st of def.steps!) expect(parse(st.script).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const all = def.steps!.map((x) => x.script).join("\n");
    for (const line of ["click 1,62011,470,2930", "warp_id 2,62011,550,2850", "click 5,62011,470,1970", "warp_id 4,62011,110,1910", "click 20,62011,670,390", "warp_id 8,62011,1070,670", "warp_id 6,62011,1228,794", "click 31,62011,2610,290"]) expect(all).toContain(line);
  });
  it("tạo phòng id 14 = `2f/02 00 0e 00 00` (đúng gói trong pcap, không mật khẩu)", () => {
    expect(encodeFrame(Buffer.from([0, 0, 0x2f, 0x02, ...createRoomPayload(14, false)])).toString("hex")).toBe("6d3ca1adadad82afada3adad");
  });
  it("cổng DỊCH CHUYỂN (2/4/6: chỉ 0c/00 đổi vị trí, không thoại/trận) ⇒ xong sau ~1s, KHÔNG chờ 40s trận; vị trí mới lấy từ 0c/00", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { uid: Buffer; location: { x: number; y: number; map: number } };
      any.uid = Buffer.from(SELF, "hex");
      any.location = { map: 62011, x: 550, y: 2850, channel: 0 } as never;
      s.onData(frame(0x16, 0x04, "00" + "0100" + "0100" + "0000" + "d601" + "620b" + "00" + "00000000")); // đã có danh sách NPC
      const done = { v: false };
      const p = s.executeAction!("warp_id", ["2", "62011", "550", "2850"], (b) => sent.push(b), new AbortController().signal).then((r) => { done.v = true; return r; });
      await vi.advanceTimersByTimeAsync(400);
      expect(sent.map((b) => b.toString("hex"))).toContain(encodeFrame(Buffer.from([0, 0, 0x14, 0x08, 0, 2, 0])).toString("hex"));
      // server: 0c/00 vị trí mới (1530,2070) trên cùng map 62011
      s.onData(frame(0x0c, 0x00, "00" + SELF + "3bf2" + "fa05" + "1608" + "0000" + "0200" + "00".repeat(16)));
      await vi.advanceTimersByTimeAsync(2500);
      expect(done.v).toBe(true); // không chờ 40s
      await expect(p).resolves.toEqual({ ok: true });
      expect(any.location.x).toBe(1530);
      expect(any.location.y).toBe(2070);
    } finally { vi.useRealTimers(); }
  });
  it("`click N,map,x,y` trong phó bản: đứng yên gửi lại vị trí 3 lần rồi `20/02` + `14/01 <idx>` (đúng thứ tự pcap); đáp thoại bị từ chối thì chờ 8s bấm lại", async () => {
    vi.useFakeTimers();
    try {
      const sent: Buffer[] = [];
      const s = tsOnlineCodec.create({ log: () => {}, game: () => {}, send: (b: Buffer) => sent.push(b), patchState: () => {} } as never);
      const any = s as unknown as { uid: Buffer; location: object; inBattle: boolean };
      any.uid = Buffer.from(SELF, "hex");
      any.location = { map: 62011, x: 470, y: 2930, channel: 0 };
      s.onData(frame(0x16, 0x04, "00" + "0100" + "0100" + "0000" + "d601" + "720b" + "00" + "00000000")); // NPC idx 1
      const hx4 = (b: Buffer) => b.toString("hex");
      const p = s.executeAction!("click", ["1", "62011", "470", "2930"], (b) => sent.push(b), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(3000);
      const w = sent.map(hx4);
      const move = hx4(encodeFrame(Buffer.from([0, 0, 0x06, 0x01, 0, 0, 470 & 255, 470 >> 8, 2930 & 255, 2930 >> 8])));
      expect(w.filter((h) => h === move)).toHaveLength(3); // 3 lần gửi lại vị trí
      const click = hx4(encodeFrame(Buffer.from([0, 0, 0x14, 0x01, 0, 1, 0])));
      const ci = w.indexOf(click);
      expect(ci).toBeGreaterThan(3);
      expect(w[ci - 1]).toBe("6d3ca7adadad8dafada5"); // 20/02 00 08 ngay trước
      s.onData(frame(0x06, 0x02, "00"));
      s.onData(frame(0x14, 0x01, "00000000" + "0101030100000000" + "0000765d")); // câu 1
      await vi.advanceTimersByTimeAsync(1500);
      s.onData(frame(0x14, 0x08, "0027")); // từ chối đáp thoại
      for (let i = 0; i < 60 && sent.map(hx4).filter((h) => h === click).length < 2; i++) await vi.advanceTimersByTimeAsync(500); // chờ 8s rồi bấm lại (lần 2)
      expect(sent.map(hx4).filter((h) => h === click).length).toBe(2);
      s.onData(frame(0x06, 0x02, "00")); // lần 2 server nhận
      any.inBattle = true; // vào trận
      await vi.advanceTimersByTimeAsync(500);
      any.inBattle = false; s.onData(frame(0x14, 0x08, "002a")); // hết trận, chuỗi chốt
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(p).resolves.toEqual({ ok: true });
    } finally { vi.useRealTimers(); }
  });
  it("S→C `2f/0c` (hoàn thành, id 0e) ⇒ DungeonRoomTracker.status = completed", () => {
    const t = new DungeonRoomTracker();
    const f = Buffer.concat([Buffer.alloc(6), Buffer.from([0x2f, 0x0c]), Buffer.from("00000e0003 4ab70a00".replace(/ /g, ""), "hex")]);
    expect(t.onPacket(0x0c, f)).toBe(true);
    expect(t.state.status).toBe("completed");
  });
});
