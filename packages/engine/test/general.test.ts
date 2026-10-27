import { describe, expect, it, vi } from "vitest";
import fx from "./fixtures/general-cap.json";
import { encodeFrame, tsOnlineCodec } from "../src/transport/socket/codecs/tsOnline";
import { buildCommand, buildSteps } from "../src/runtime/liveActions";

/** Payload f[8..] lấy từ pcap 22/10 (Check_status_team_pet, Change_pet_xuat_chien, Nhan_exp_offline_Free, Nhan_all_email_gifts). */
const frame = (cmd: number, sub: number, hex: string) => encodeFrame(Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(hex, "hex")]));
const body = (cmd: number, sub: number, hex: string) => frame(cmd, sub, hex).toString("hex");

function setup() {
  const sent: string[] = [], games: string[] = [];
  let state: Record<string, any> = {};
  const s = tsOnlineCodec.create({
    log() {}, game: (m: string) => games.push(m), send: (b: Buffer) => sent.push(b.toString("hex")),
    patchState: (p: Record<string, any>) => { state = { ...state, ...p }; },
  } as never);
  return { s, sent, games, st: () => state };
}

describe("Võ tướng xuất chiến: danh sách + 13/01", () => {
  it("pets[] có trạng thái xuất chiến/nghỉ; pet_out dựng đúng 13/01 như cap", () => {
    const { s, st, games } = setup();
    s.onData(frame(0x0f, 0x08, fx.pets));
    s.onData(frame(0x13, 0x04, "00a9a1"));
    expect(st().pets.map((p: any) => [p.name, p.level, p.active])).toEqual([["Lữ Bố", 86, false], ["Nhạn Điêu Tuyết", 151, true], ["Thái Văn Cơ", 74, false]]);
    expect(st().pets[1].element).toBe("wind");
    expect(st().pets[0].stats).toEqual({ int: 16, atk: 147, def: 79, agi: 102, hp: 58, sp: 13, fai: 100 });
    expect(st().pets[1].stats).toMatchObject({ int: 42, atk: 178, def: 63 });
    expect(st().pets[2].stats).toMatchObject({ int: 122, atk: 16, def: 43 });
    // cap: client gửi 13/01 `00 b9 36` (Lữ Bố)
    expect(s.encodeAction("pet_out", ["14009"])!.toString("hex")).toBe(body(0x13, 0x01, "00b936"));
    expect(() => s.encodeAction("pet_out", ["41385"])).toThrow(/đang xuất chiến/);
    expect(() => s.encodeAction("pet_out", ["1"])).toThrow(/không có võ tướng/);
    // server xác nhận 13/01 → Lữ Bố xuất chiến, Nhạn về nghỉ, thẻ Home đổi theo
    s.onData(frame(0x13, 0x01, "00b936"));
    expect(st().pet.name).toBe("Lữ Bố");
    expect(st().pets.map((p: any) => p.active)).toEqual([true, false, false]);
    expect(games.at(-1)).toContain("Lữ Bố đã xuất chiến");
    // pet_rest chuẩn 13/02 00 (theo pcap Ngung xuat chien slot 1 & Quay lap ba slot 1.pcap)
    expect(s.encodeAction("pet_rest", [])!.toString("hex")).toBe(body(0x13, 0x02, "00"));
  });
});

describe("Nhận Exp Offline (Free)", () => {
  it("54/01 + 54/02 đúng cap; 02/0a + 54/02 → thông báo +35.715 exp", () => {
    vi.useFakeTimers();
    const { s, sent, games } = setup();
    expect(s.encodeAction("offline_exp_free", [])!.toString("hex")).toBe(body(0x54, 0x01, "001e00"));
    vi.advanceTimersByTime(400);
    expect(sent).toEqual([body(0x54, 0x02, "00021e00")]);
    s.onData(frame(0x02, 0x0a, fx.sys));
    s.onData(frame(0x54, 0x02, "001e0001"));
    expect(games.at(-1)).toContain("Exp Offline miễn phí +35.715 exp");
    vi.useRealTimers();
  });

  it("02/0a dạng thông báo exp trận đấu (40476) hiển thị đầy đủ tên và lượng exp tăng", () => {
    const { s, games } = setup();
    // Giả lập 02/0a sau trận: Lữ Bố tăng 650 exp
    // textId 40476 = 1c 9e 00 00, numArgs = 2, arg1 = string "Lu Bo" (5 bytes), arg2 = u32 650 (0x028a = 8a 02 00 00)
    const luBoExpHex = "0003011c9e000002" + "00054c7520426f" + "028a020000";
    s.onData(frame(0x02, 0x0a, luBoExpHex));
    const expMsg = games.find((g) => g.includes("[Kinh Nghiệm]") && g.includes("650"));
    expect(expMsg).toBeDefined();
  });
});

describe("Nhận quà thư (53/xx)", () => {
  it("đọc 26 thư; thư cũ chỉ 53/01, thư chưa đọc 53/03+53/01 đúng cap, ack 53/02 → sang thư kế", () => {
    vi.useFakeTimers();
    const { s, sent, games } = setup();
    s.onData(frame(0x53, 0x01, fx.mail));
    const id = (n: number) => `0001000000${n.toString(16).padStart(2, "0")}000000`;
    // thư đầu tiên có quà là 0xc7 (đã mở, cờ 2) → chỉ 53/01
    expect(s.encodeAction("mail_claim_all", [])!.toString("hex")).toBe(body(0x53, 0x01, id(0xc7)));
    expect(games[0]).toContain("26 thư");
    // ack từng thư; thư cuối 0xe8 (chưa đọc, cờ 0) phải đi kèm 53/03 mở thư trước — đúng chuỗi cap
    for (let i = 0; i < 40 && !games.at(-1)?.includes("xong"); i++) {
      const cur = sent.length ? sent[sent.length - 1]! : body(0x53, 0x01, id(0xc7));
      // lấy id đang chờ từ frame gần nhất (byte cuối của payload id u32 đầu tiên sau XOR 0xad)
      const raw = Buffer.from(cur, "hex"); const mailId = raw[raw.length - 4]! ^ 0xad;
      s.onData(frame(0x53, 0x02, id(mailId)));
      vi.advanceTimersByTime(400);
    }
    expect(games.at(-1)).toContain("xong");
    expect(sent.some((h) => h === body(0x53, 0x03, id(0xe8)) + body(0x53, 0x01, id(0xe8)))).toBe(true);
    vi.useRealTimers();
  });

  it("túi đầy / không phản hồi: dừng sau 3 thư liên tiếp không ack", () => {
    vi.useFakeTimers();
    const { s, sent, games } = setup();
    s.onData(frame(0x53, 0x01, fx.mail));
    s.encodeAction("mail_claim_all", []);
    vi.advanceTimersByTime(1800 * 3 + 100);
    expect(games.some((g) => g.includes("Dừng nhận quà thư"))).toBe(true);
    expect(games.at(-1)).toContain("Nhận quà thư xong");
    expect(sent.length).toBe(2);
    expect(() => s.encodeAction("mail_claim_all", [])).not.toThrow(); // chạy lại được sau khi dừng
    vi.useRealTimers();
  });

  it("thông báo túi đầy 71328 → báo & dừng", () => {
    vi.useFakeTimers();
    const { s, games } = setup();
    s.onData(frame(0x53, 0x01, fx.mail));
    s.encodeAction("mail_claim_all", []);
    s.onData(frame(0x02, 0x0a, "000301a0160100" + "00"));
    expect(games.some((g) => g.includes("Túi đồ đầy"))).toBe(true);
    expect(games.at(-1)).toContain("Nhận quà thư xong");
    vi.useRealTimers();
  });
});

describe("Chỉ số võ tướng như client (cap tuancn11, Ma Quan Vũ)", () => {
  it("gốc 66/189/89/102/85/60 + đồ (08/02) 46/50/29/27", () => {
    const { s, st } = setup();
    s.onData(frame(0x08, 0x02, "00040100d2013200000000000000")); // atk 50 (đến trước 0f/08 cũng được)
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x08, 0x02, "00040100d3011d00000000000000"));
    s.onData(frame(0x08, 0x02, "00040100d4012e00000000000000"));
    s.onData(frame(0x08, 0x02, "00040100d6011b00000000000000"));
    const mqv = st().pets[0];
    expect(mqv.name).toBe("Ma Quan Vũ");
    expect(mqv.stats).toMatchObject({ int: 66, atk: 189, def: 89, agi: 102, hp: 85, sp: 60, fai: 100 });
    expect(mqv.gear).toEqual({ int: 46, atk: 50, def: 29, agi: 27 });
    expect(st().pets[1].gear).toEqual({ int: 0, atk: 0, def: 0, agi: 0 });
  });
});

describe("Nhân vật (cap tuancn11): Point, đồ, trang bị", () => {
  it("05/03 Point 238; 08/01 đồ 50/29/46/27; 17/0b 5 món Sơ Tâm", () => {
    const { s, st } = setup();
    s.onData(frame(0x05, 0x03, (fx as any).player_0503));
    expect(st().point).toBe(238);
    for (const h of ["00d201320000000000000000", "00d3011d0000000000000000", "00d4012e0000000000000000", "00d6011b0000000000000000"]) s.onData(frame(0x08, 0x01, h + "000000"));
    expect(st().gear).toEqual({ int: 46, atk: 50, def: 29, agi: 27 });
    s.onData(frame(0x17, 0x0b, "0005f55101" + "00".repeat(32) + "5b4d01" + "00".repeat(32) + "fc3a01" + "00".repeat(32) + "945401" + "00".repeat(32) + "d75901" + "00".repeat(32)));
    expect(st().equipment.map((e: any) => e.id)).toEqual([20981, 19803, 15100, 21652, 22999]);
  });
});

describe("Bảng giá Exp Offline (57/03, cap 23/10)", () => {
  it("50%/0, 70%/441 Xu, 100%/5 Vàng; offline_exp_info gửi 57/03 00", () => {
    const { s, st } = setup();
    s.onData(frame(0x57, 0x03, "00033200000000004600b9010000640005000000"));
    expect(st().offlineExp).toEqual({ freePct: 50, xuPct: 70, xuCost: 441, goldPct: 100, goldCost: 5, minutes: 441 });
    expect(s.encodeAction("offline_exp_info", [])!.toString("hex")).toBe(body(0x57, 0x03, "00"));
  });
});

describe("Quà Online (57/02, cap Online Reward Capture.pcap)", () => {
  it("dựng đúng 6 mốc gói tin 57/02 khớp pcap", () => {
    const { s } = setup();
    // Khớp tuyệt đối 6 gói client gửi trong pcap:
    expect(s.encodeOnlineRewardFrame(10).toString("hex")).toBe(body(0x57, 0x02, "00030a00000001"));
    expect(s.encodeOnlineRewardFrame(20).toString("hex")).toBe(body(0x57, 0x02, "00031400000001"));
    expect(s.encodeOnlineRewardFrame(30).toString("hex")).toBe(body(0x57, 0x02, "00031e00000001"));
    expect(s.encodeOnlineRewardFrame(60).toString("hex")).toBe(body(0x57, 0x02, "00033c00000001"));
    expect(s.encodeOnlineRewardFrame(90).toString("hex")).toBe(body(0x57, 0x02, "00035a00000001"));
    expect(s.encodeOnlineRewardFrame(180).toString("hex")).toBe(body(0x57, 0x02, "0003b400000001"));
  });

  it("kiểm tra điều kiện online time (55/01) và cờ đã nhận (51/02, 51/01)", () => {
    const { s, games } = setup();
    // Chưa online đủ thời gian
    s.encodeAction("online_reward", ["10"]);
    expect(games.at(-1)).toContain("Chưa đủ thời gian online");

    // Server cập nhật online 187 phút (counter 10 = 11267s như pcap)
    s.onData(frame(0x55, 0x01, "00010000000a00032c000000510100")); // 11267 = 0x2c03 (03 2c LE)

    // Lúc này mốc 10 phút đủ điều kiện gửi
    const buf = s.encodeAction("online_reward", ["10"]);
    expect(buf!.toString("hex")).toBe(body(0x57, 0x02, "00030a00000001"));

    // Server trả lời thành công 57/02 00 03 00
    s.onData(frame(0x57, 0x02, "000300"));
    expect(games.at(-1)).toContain("nhận thành công quà Online mốc 10 phút");

    // Server cập nhật cờ 51/01 flag 2 = 1 (đã nhận mốc 10)
    s.onData(frame(0x51, 0x01, "0001000000020001"));

    // Thử nhận lại mốc 10 -> báo đã nhận
    s.encodeAction("online_reward", ["10"]);
    expect(games.at(-1)).toContain("Mốc 10 phút: Ní đã nhận rồi");
  });

  it("online_reward_all tự động duyệt và chỉ nhận các mốc đủ điều kiện", () => {
    const { s, games, sent } = setup();
    // Giả sử đã online 45 phút (45 * 60 = 2700s = 0x0a8c)
    s.onData(frame(0x55, 0x01, "00010000000a008c0a000000510100"));
    // Mốc 10 phút (flag 2) đã nhận từ trước qua 51/01
    s.onData(frame(0x51, 0x01, "0001000000020001"));

    // Bấm nhận toàn bộ:
    // Mốc 10m: báo đã nhận rồi
    // Mốc 20m, 30m: đủ điều kiện -> đưa vào hàng đợi
    // Mốc 60m, 90m, 180m: báo chưa đủ thời gian online
    const firstBuf = s.encodeAction("online_reward_all", []);
    expect(firstBuf!.toString("hex")).toBe(body(0x57, 0x02, "00031400000001"));

    expect(games).toContain("Mốc 10 phút: Ní đã nhận rồi nha !");
    expect(games).toContain("Mốc 60 phút: Chưa đủ thời gian online (hiện có 45/60 phút) nha Ní !");
    expect(games).toContain("Ní đang nhận 2 mốc quà Online đủ điều kiện... 🎁");
    expect(games).toContain("Ní đang nhận quà Online mốc 20 phút... 🎁");

    vi.useFakeTimers();
    try {
      // Server trả lời thành công cho mốc 20
      s.onData(frame(0x57, 0x02, "000300"));
      expect(games.at(-1)).toContain("nhận thành công quà Online mốc 20 phút");

      // Sau 800ms, runner tự động gửi mốc kế tiếp (30 phút) qua this.io.send()
      vi.advanceTimersByTime(800);
      expect(sent.at(-1)).toBe(body(0x57, 0x02, "00031e00000001"));
      expect(games.at(-1)).toContain("Ní đang nhận quà Online mốc 30 phút... 🎁");

      // Server trả lời mốc 30
      s.onData(frame(0x57, 0x02, "000300"));
      expect(games.at(-1)).toContain("nhận thành công quà Online mốc 30 phút");

      // Hoàn tất toàn bộ chuỗi
      vi.advanceTimersByTime(800);
      expect(games.at(-1)).toContain("Nhận quà Online xong rồi Ní: 2/2 mốc 🎁");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Hệ thống Trận đấu & Kỹ năng (Treo Rung 30 Dau Vat.pcap)", () => {
  it("05/03 đọc danh sách kỹ năng nhân vật (Phóng Hỏa 12001, Trinh Thám 14001, Cưỡi Ngựa 14023, Kỵ Binh 14034)", () => {
    const { s, st } = setup();
    s.onData(frame(0x05, 0x03, (fx as any).player_0503));
    expect(st().playerSkills.length).toBe(4);
    expect(st().playerSkills.map((sk: any) => [sk.id, sk.name, sk.level])).toEqual([
      [12001, "Phóng Hỏa", 1],
      [14001, "Trinh Thám", 1],
      [14023, "Cưỡi Ngựa", 1],
      [14034, "Kỵ Binh", 1],
    ]);
  });

  it("Võ tướng xuất chiến tự nạp kỹ năng từ Npc_C.dat (Ma Quan Vũ)", () => {
    const { s, st } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    expect(st().pet.name).toBe("Ma Quan Vũ");
    // Bộ kỹ năng đầy đủ gồm 5 skill (3 gốc, 1 Mê, 1 VKCD)
    expect(st().petSkills.length).toBe(5);
    const skillIds = st().petSkills.map((sk: any) => sk.id);
    expect(skillIds.slice(0, 3)).toEqual([23003, 23015, 23016]);
    // Chứa skill Mê 21038 (Yển Nguyệt) và skill VKCD 23027 (Hắc Quang)
    expect(skillIds).toContain(21038);
    expect(skillIds).toContain(23027);
    // Có chi phí SP chuẩn
    const htc = st().petSkills.find((sk: any) => sk.id === 23003);
    expect(htc?.sp).toBe(72);
  });

  it("Vào trận (14/0c), spawn quái & quân mình (0b/05), cập nhật HP/SP (33/01), vào lượt (34/01) tự đánh đúng hex pcap", () => {
    const { s, sent, games, st } = setup();
    // Khởi tạo pet xuất chiến
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));

    // 14/0c: Trận đấu bắt đầu
    s.onData(frame(0x14, 0x0c, "00"));
    expect(st().inBattle).toBe(true);
    expect(games.at(-1)).toContain("Trận đấu bắt đầu");

    // 0b/05: Spawn quái và nhân vật
    s.onData(frame(0x0b, 0x05, "0001047db10000000000000000acd867d3aca80a000202be0500004c020000aa050000fe0100006000000806c55dc3f6a6d0"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000004b500000086000000b5000000860000001e000002"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000003b500000086000000b5000000860000001e000002"));

    expect(st().battleUnits.length).toBe(4);
    // Quái đầu tiên ở hàng 0 cột 2, Lv 30, HP 181
    const enemy1 = st().battleUnits.find((u: any) => u.row === 0 && u.col === 2);
    expect(enemy1).toMatchObject({ row: 0, col: 2, level: 30, hp: { cur: 181, max: 181 }, isEnemy: true });

    // 33/01: Cập nhật chỉ số HP/SP lưới chiến
    s.onData(frame(0x33, 0x01, "0000030219d400000003021ab40000000302cd9d0100000302cd9d010000020219aa05000002021afe0100000202cdbe0500000202cdbe050000000219b500000000021a860000000002cdb50000000002cdb5000000000419b500000000041a860000000004cdb50000000004cdb5000000000319b500000000031a860000000003cdb50000000003cdb5000000"));
    const petUnit = st().battleUnits.find((u: any) => u.row === 3 && u.col === 2);
    expect(petUnit?.hp.cur).toBe(212);
    expect(petUnit?.sp.cur).toBe(180);

    // 34/01: Bắt đầu lượt đánh (Turn timer) -> Auto bật: gửi lệnh đánh cho Char (3,2) rồi Pet (2,2)
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Gói của Char & Pet: F1 thông minh tự động target vào tâm cụm quái (0, 3) giữa (0,2), (0,3), (0,4)
    expect(sent[0]).toBe(body(0x32, 0x01, "000302000310270000"));
    expect(sent[1]).toBe(body(0x32, 0x01, "000202000310270000"));

    // 14/08: Trận đấu kết thúc
    s.onData(frame(0x14, 0x08, "002a"));
    expect(st().inBattle).toBe(false);
    expect(st().battleUnits.length).toBe(0);
    expect(games.at(-1)).toContain("Trận đấu kết thúc");
  });

  it("Tùy biến hành động trận đấu (set_battle_config): đổi skill Char và Pet", () => {
    const { s, sent, st } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // Cài đặt: Char dùng Cuồng Phong (12001 = 0x2ee1 = e1 2e), Pet phòng ngự (17001 = 0x4269 = 69 42), mục tiêu mặc định F1
    s.encodeAction("set_battle_config", ["12001", "17001", "1"]);
    expect(st().battleConfig).toEqual({
      playerAction: { type: "skill", skillId: 12001, target: "F1" },
      petAction: { type: "defend", skillId: 17001, target: "F1" },
      autoFight: true,
      strategyMode: "default",
      turns: [],
      currentTurn: 0,
      autoEscape: false,
    });

    // Đến lượt đánh 34/01
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Char dùng 12001 (Phóng Hỏa = e1 2e, target vào quái tại 0, 2 theo F1)
    expect(sent[0]).toBe(body(0x32, 0x01, "0003020002e12e0000"));
    // Pet dùng 17001 (Phòng ngự = 69 42, target vào chính mình tại 2, 2)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000"));

    // Thử cài đặt target cụ thể: Char đánh Slot 10 (row 0, col 4), Pet buff Slot 18 (row 3, col 2)
    s.encodeAction("set_battle_config", ["10000", "11005", "1", "10", "18"]);
    expect(st().battleConfig.playerAction.target).toBe("10");
    expect(st().battleConfig.petAction.target).toBe("18");

    // Chỉ cập nhật autoEscape (ví dụ boss thế giới hoặc phó bản đơn bật/tắt bỏ chạy): không làm mất skill Char và Pet!
    s.encodeAction("set_battle_config", ["", "", "", "", "", "", "", "1"]);
    expect(st().battleConfig.playerAction.skillId).toBe(10000);
    expect(st().battleConfig.petAction.skillId).toBe(11005);
    expect(st().battleConfig.autoEscape).toBe(true);

    const cmd = buildCommand("set_battle_config", { autoEscape: "0" });
    expect(cmd.args[0]).toBe("");
    expect(cmd.args[1]).toBe("");
    expect(cmd.args[7]).toBe("0");
  });

  it("Chiến thuật theo từng Turn (Turn 1..21) và tự động lặp lại từ Turn 1 khi trận kéo dài hơn 21 turn", () => {
    const { s, sent } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00")); // bắt đầu trận: turn = 0
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // Cấu hình:
    // Mặc định: Char Đấu Vật (10000), Pet Đấu Vật (10000)
    // Turn 1: Char Def (17001), Pet Def (17001)
    // Turn 2: Char Đánh thường (10000), Pet Def (17001)
    const turns = [
      {
        turn: 1,
        playerAction: { type: "defend", skillId: 17001, target: "F1" },
        petAction: { type: "defend", skillId: 17001, target: "F1" },
      },
      {
        turn: 2,
        playerAction: { type: "attack", skillId: 10000, target: "F1" },
        petAction: { type: "defend", skillId: 17001, target: "F1" },
      },
    ];

    s.encodeAction("set_battle_config", ["10000", "10000", "1", "F1", "F1", JSON.stringify(turns)]);

    // --- HIỆP 1: 34/01 -> Cả Char và Pet đều Def (17001 = 69 42)
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(body(0x32, 0x01, "000302030269420000")); // Char Def target bản thân (3,2)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def target bản thân (2,2)

    // --- HIỆP 2: 34/01 -> Char Đánh thường (10000 = 10 27), Pet Def (17001)
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(body(0x32, 0x01, "000302000210270000")); // Char Attack target quái (0,2)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def

    // Giả lập tiếp tới Hiệp 21 (các turn 3..21 không cấu hình turn riêng -> fallback về mặc định: cả 2 đánh thường 10000)
    for (let t = 3; t <= 21; t++) {
      sent.length = 0;
      s.onData(frame(0x34, 0x01, "00"));
      expect(sent[0]).toBe(body(0x32, 0x01, "000302000210270000")); // Char fallback Đấu vật
      expect(sent[1]).toBe(body(0x32, 0x01, "000202000210270000")); // Pet fallback Đấu vật
    }

    // --- HIỆP 22 (Vượt quá 21 turn): Tự động LOOP lại Turn 1!
    // ((22 - 1) % 21) + 1 = 1 -> Áp dụng lại Turn 1: Cả Char và Pet đều Def (17001)
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(body(0x32, 0x01, "000302030269420000")); // Char Def
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def

    // --- HIỆP 23: Tự động loop lại Turn 2!
    // ((23 - 1) % 21) + 1 = 2 -> Áp dụng Turn 2: Char Đánh thường (10000), Pet Def (17001)
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(body(0x32, 0x01, "000302000210270000")); // Char Attack
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def
  });

  it("Cấu hình theo turn: Turn 1..20 Char và Pet phòng ngự (17001) phải xuất chiêu Phòng ngự, không được dùng mặc định Đấu vật (10000)", () => {
    const { s, sent, games } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // 20 turns Char & Pet phòng ngự 17001, turn 21 đánh thường 10000
    const turns = Array.from({ length: 21 }, (_, i) => {
      const turn = i + 1;
      const isDef = turn <= 20;
      return {
        turn,
        playerAction: { type: isDef ? "defend" : "attack", skillId: isDef ? 17001 : 10000, target: "F1" },
        petAction: { type: isDef ? "defend" : "attack", skillId: isDef ? 17001 : 10000, target: "F1" },
      };
    });

    // Mặc định là 10000, chế độ là "turns"
    s.encodeAction("set_battle_config", ["10000", "10000", "1", "F1", "F1", JSON.stringify(turns), "turns"]);

    // Kiểm tra Turn 1..20: Cả Char và Pet PHẢI gửi lệnh Phòng Ngự (17001 = 69 42)
    for (let t = 1; t <= 20; t++) {
      sent.length = 0;
      s.onData(frame(0x34, 0x01, "00"));
      expect(sent.length).toBe(2);
      expect(sent[0]).toBe(body(0x32, 0x01, "000302030269420000")); // Char Def 17001
      expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def 17001
    }

    // Turn 21: Đánh thường 10000
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent[0]).toBe(body(0x32, 0x01, "000302000210270000")); // Char Đấu vật 10000
    expect(sent[1]).toBe(body(0x32, 0x01, "000202000210270000")); // Pet Đấu vật 10000

    // Turn 22: Loop lại Turn 1 -> Lại Phòng Ngự 17001
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent[0]).toBe(body(0x32, 0x01, "000302030269420000")); // Char Def 17001
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def 17001
  });

  it("Pet dùng skill Ma Quan Vũ (23003 tốn 72 SP) nhưng SP không đủ sẽ tự chuyển sang Đấu Vật để tránh kick disconnect", () => {
    const { s, sent, games, st } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // Cập nhật SP lưới chiến: Pet ở 2,2 có SP = 30 (nhỏ hơn 72 SP yêu cầu của Hắc Toàn Trảm 23003), Max SP = 100
    // 00 00 02 02 [1a] [30 00 00 00] 02 02 [cd] [64 00 00 00]
    s.onData(frame(0x33, 0x01, "000002021a1e0000000202cd64000000"));
    expect(st().battleUnits.find((u: any) => u.row === 2 && u.col === 2)?.sp.cur).toBe(30);

    // Cài đặt Pet dùng Hắc Toàn Trảm (23003)
    s.encodeAction("set_battle_config", ["10000", "23003", "1"]);

    // Đến lượt đánh 34/01: Pet không đủ 72 SP nên tự chuyển Đấu Vật (10000 = 10 27) thay vì gửi 23003
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Char gửi 10000 (Đấu Vật)
    expect(sent[0]).toBe(body(0x32, 0x01, "000302000210270000"));
    // Pet gửi 10000 (Đấu Vật)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202000210270000"));
    expect(games.some((g) => g.includes("không đủ SP"))).toBe(true);
  });

  it("Bậc 1 ưu tiên: Vào trận tự động bỏ chạy (autoEscape = true) thì cả Char và Pet đều gửi lệnh bỏ chạy (18001)", () => {
    const { s, sent, games, st } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // Bật autoEscape = true (args[7] = "1" hoặc number 1)
    s.encodeAction("set_battle_config", ["10000", "10000", "1", "F1", "F1", "[]", "default", "1"]);
    expect(st().battleConfig.autoEscape).toBe(true);

    // Đến lượt đánh 34/01: Cả Char và Pet đều phải gửi mã chạy trốn 18001 (59 46)
    sent.length = 0;
    games.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Char (3,2) escape 18001 (51 46)
    expect(sent[0]).toBe(body(0x32, 0x01, "000302030251460000"));
    // Pet (2,2) escape 18001 (51 46)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020251460000"));
    expect(games.some((g) => g.includes("bỏ chạy khỏi trận"))).toBe(true);
    expect(games.some((g) => g.includes("Đấu Vật"))).toBe(false);

    // Kiểm tra trường hợp args[7] truyền vào dạng number 1 (từ dispatch liveActions)
    (s.encodeAction as any)("set_battle_config", ["10000", "10000", "1", "F1", "F1", "[]", "default", 1]);
    expect(st().battleConfig.autoEscape).toBe(true);
  });

  it("Bậc 2 ưu tiên: Tự động bỏ chạy khi chưa đủ đội ngũ (escapeIfNotFullParty = true)", () => {
    const { s, sent, games } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // 1. Chủ PT cấu hình 2 thành viên ["Tuan02", "Tuan03"] nhưng team chưa ai vào -> Chạy cả Char và Pet
    s.encodeAction("set_party_config", ["", '["Tuan02", "Tuan03"]', "leader", "", '["Tuan02", "Tuan03"]', "1"]);

    sent.length = 0;
    games.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Char (3,2) escape 18001 (51 46)
    expect(sent[0]).toBe(body(0x32, 0x01, "000302030251460000"));
    // Pet (2,2) escape 18001 (51 46)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020251460000"));
    expect(games.some((g) => g.includes("Ưu tiên Bậc 2") && g.includes("Tổ đội chưa đủ thành viên"))).toBe(true);

    // 2. Thành viên chưa join vào team của chủ PT -> Chạy cả Char và Pet
    s.encodeAction("set_party_config", ["ChuTeam01", "[]", "member", "ChuTeam01", "[]", "1"]);
    sent.length = 0;
    games.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(body(0x32, 0x01, "000302030251460000"));
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020251460000"));
    expect(games.some((g) => g.includes("Ưu tiên Bậc 2") && g.includes("Chưa gia nhập vào đội ngũ của [ChuTeam01]"))).toBe(true);

    // 3. Tắt tính năng (escapeIfNotFullParty = 0) -> Đánh bình thường (Đấu vật 10000: 10 27)
    s.encodeAction("set_party_config", ["ChuTeam01", "[]", "member", "ChuTeam01", "[]", "0"]);
    sent.length = 0;
    games.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Char đánh skill 10000 (10 27) lên F1 (0,2)
    expect(sent[0]).toBe(body(0x32, 0x01, "000302000210270000"));
    expect(games.some((g) => g.includes("bỏ chạy"))).toBe(false);
  });

  it("Theo turn: Char xuất chiến pet (13/01) ở Turn 1, dùng item (19001) hồi HP cho Pet ở Turn 2", () => {
    const { s, sent, games } = setup();
    s.onData(frame(0x0f, 0x08, (fx as any).mqv_0f08));
    s.onData(frame(0x13, 0x04, (fx as any).mqv_1304));
    s.onData(frame(0x14, 0x0c, "00"));
    s.onData(frame(0x0b, 0x05, "000107d927000000000000000000000000000000000002b500000086000000b5000000860000001e000002"));

    // Thêm item vào túi (slot 3, ID 46001 = Trà Phổ Nhĩ)
    s.onData(frame(0x17, 0x01, "03b9b30100000000"));

    const turns = [
      {
        turn: 1,
        // Turn 1: Char summon Ba Đậu Yêu (model 41001 = 0xa029 = 29 a0), Pet def
        playerAction: { type: "summon", petModel: 41001, petName: "Ba Đậu Yêu" },
        petAction: { type: "defend", skillId: 17001, target: "F1" },
      },
      {
        turn: 2,
        // Turn 2: Char dùng item ô 3 (Trà Phổ Nhĩ 46001) cho Pet tại tọa độ (2,2), Pet tấn công
        playerAction: { type: "item", skillId: 19001, itemSlot: 3, itemId: 46001, itemName: "Trà Phổ Nhĩ", target: "(2,2)" },
        petAction: { type: "attack", skillId: 10000, target: "F1" },
      },
    ];

    s.encodeAction("set_battle_config", ["10000", "10000", "1", "F1", "F1", JSON.stringify(turns), "turns"]);

    // Turn 1: Char xuất chiến pet 13/01 (00 29 a0), Pet Def (17001)
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(body(0x13, 0x01, "0029a0")); // Packet 13/01 summon pet model 41001
    expect(sent[1]).toBe(body(0x32, 0x01, "000202020269420000")); // Pet Def

    // Turn 2: Char dùng Item 19001 (39 4a) ô slot 3 (03 00 ở bytes 7-8) cho Pet tại (2,2), Pet tấn công 10000
    sent.length = 0;
    s.onData(frame(0x34, 0x01, "00"));
    expect(sent.length).toBe(2);
    // Char dùng item: src=(3,2), tar=(2,2), skill=19001 (39 4a), itemSlot=3 (03 00)
    expect(sent[0]).toBe(body(0x32, 0x01, "0003020202394a0300"));
    // Pet dùng 10000 (Đấu vật) vào quái (0,2)
    expect(sent[1]).toBe(body(0x32, 0x01, "000202000210270000"));
  });
});

describe("Hệ thống Warp & Di chuyển qua Cổng (14/08, 44/01, BFS)", () => {
  it("warp_door gửi đúng gói 14/08 00 <doorIndex LE> như pcap Treo Rung 30", () => {
    const { s } = setup();
    // Cổng số 1 (ra U Châu 12000): 14/08 `00 01 00`
    expect(s.encodeAction("warp_door", ["1"])!.toString("hex")).toBe(body(0x14, 0x08, "000100"));
    // Cổng số 18 (0x12, vào Rừng 30 12831): 14/08 `00 12 00`
    expect(s.encodeAction("warp_door", ["18"])!.toString("hex")).toBe(body(0x14, 0x08, "001200"));
    // alias warp_id:
    expect(s.encodeAction("warp_id", ["12"])!.toString("hex")).toBe(body(0x14, 0x08, "000c00"));
  });

  it("teleport_gate gửi đúng 44/01 với cổng thành", () => {
    const { s } = setup();
    // 12061 (Điệp Thành, index 2) -> 44/01 `00 1d 2f 02`
    expect(s.encodeAction("teleport_gate", ["12061"])!.toString("hex")).toBe(body(0x44, 0x01, "001d2f02"));
    // 12001 (Trác Quận, index 0) -> 44/01 `00 e1 2e 00`
    expect(s.encodeAction("teleport_gate", ["12001"])!.toString("hex")).toBe(body(0x44, 0x01, "00e12e00"));
  });

  it("ready_1406 gửi đúng gói 14/06 00 báo sẵn sàng sau khi load map", () => {
    const { s } = setup();
    expect(s.encodeAction("ready_1406", [])!.toString("hex")).toBe(body(0x14, 0x06, "00"));
  });

  it("xử lý gói kick 00/00 từ server (mã 44 / 0x2c flood/speed map)", () => {
    const { s, games } = setup();
    s.onData(frame(0x00, 0x00, "00000000002c00000000"));
    expect(games.some((g) => g.includes("Server ngắt kết nối") && g.includes("mã 44"))).toBe(true);
  });

  it("điểm danh thành công hiển thị chính xác tên & số lượng quà thưởng theo bảng dữ liệu (vd Ngày 6: 2.000x Võ Tướng Phiến)", () => {
    const { s, games } = setup();
    // Gửi lệnh điểm danh ngày 6
    s.encodeAction("daily_checkin", ["6"]);
    // Server phản hồi 57/02 thành công (code 0)
    // 57/02: 00 [loại=01] [code=00]
    s.onData(frame(0x57, 0x02, "000100"));
    const lastGame = games.at(-1);
    expect(lastGame).toBeDefined();
    expect(lastGame).toContain("Ní vừa điểm danh ngày 6 thành công");
    expect(lastGame).toContain("2.000x Võ Tướng Phiến");
  });

  it("nhân vật đang trong map Dị giới (10853) tự động đi bộ ra cổng 2 (688, 375) về 12003 trước khi teleport/warp", () => {
    // 1. Warp tới cổng thành 12001 từ map Dị giới 10853
    const stepsToGate = buildSteps("warp_map", { mapId: 12001 }, { map: 10853 });
    // Bước đầu tiên: đi bộ tới cổng thoát Dị giới (688, 375)
    expect((stepsToGate[0] as any).cmd).toEqual({ type: "Action", name: "move", args: ["688", "375"] });
    // Bước thứ 2: qua cổng 2 về 12003
    expect((stepsToGate[1] as any).cmd).toEqual({ type: "Action", name: "warp_door", args: ["2"] });
    expect((stepsToGate[2] as any).expectMap).toBe(12003);
    // Sau khi đã ra 12003: mới gửi lệnh teleport tới cổng thành 12001
    const teleStep = stepsToGate.find((st: any) => st.cmd?.name === "teleport_gate");
    expect(teleStep).toBeDefined();
    expect((teleStep as any).cmd.args).toEqual(["12001"]);

    // 2. Warp về chính map Quảng trường Trác Quận 12003 từ Dị giới 10853
    const stepsTo12003 = buildSteps("warp_map", { mapId: 12003 }, { map: 10853 });
    expect((stepsTo12003[0] as any).cmd).toEqual({ type: "Action", name: "move", args: ["688", "375"] });
    expect((stepsTo12003[1] as any).cmd).toEqual({ type: "Action", name: "warp_door", args: ["2"] });
    // Không có bước teleport thừa thãi nào
    expect(stepsTo12003.some((st: any) => st.cmd?.name === "teleport_gate")).toBe(false);

    // 3. Teleport_gate trực tiếp khi đang ở Dị giới
    const teleGateSteps = buildSteps("teleport_gate", { mapId: 12001 }, { map: 10853 });
    expect((teleGateSteps[0] as any).cmd).toEqual({ type: "Action", name: "move", args: ["688", "375"] });
    expect((teleGateSteps[1] as any).cmd).toEqual({ type: "Action", name: "warp_door", args: ["2"] });
    // at(-1) là bước {gather} chờ đủ đội (chỉ có tác dụng khi là chủ PT đang bật lập đội); teleport nằm ngay trước chuỗi ping_07 + sync_state
    expect(teleGateSteps.at(-1)).toEqual({ gather: true, reason: expect.any(String) });
    expect(teleGateSteps.at(-4) as any).toEqual({ cmd: { type: "Action", name: "teleport_gate", args: ["12001"] }, afterMs: 250 });
  });
});

describe("Hệ thống Kênh (Channel): hiển thị, chuyển kênh và xử lý kênh đầy", () => {
  it("khởi tạo danh sách kênh và kênh hiện tại từ moved (07/00)", () => {
    const { s, st } = setup();
    // Giả lập gói moved 24 byte: header 8 byte + uid 8 byte + map@17 + x@19 + y@21 + ch@23
    const movePayload = Buffer.alloc(16);
    movePayload.writeUInt16LE(12001, 17 - 8); // offset 17
    movePayload.writeUInt16LE(100, 19 - 8);   // offset 19
    movePayload.writeUInt16LE(200, 21 - 8);   // offset 21
    movePayload[23 - 8] = 0;                  // channel 0
    s.onData(frame(0x07, 0x00, movePayload.toString("hex")));

    const loc = st().location;
    expect(loc).toBeDefined();
    expect(loc.channel).toBe(0);
    expect(loc.channels).toHaveLength(1);
    expect(loc.channels[0].name).toBe("Kênh 1");
    expect(loc.channels[0].status).toBe("free");
  });

  it("gửi lệnh channel tạo gói 07/02; nếu trùng kênh hiện tại thì bỏ qua", () => {
    const { s, games } = setup();
    // 1. Chuyển sang kênh 2 (id: 1) -> wire gửi 1-based: 02 00
    const ch2Pkt = s.encodeAction("channel", ["1"]);
    expect(ch2Pkt).not.toBeNull();
    expect(ch2Pkt!.toString("hex")).toBe(body(0x07, 0x02, "000200"));
    expect(games.at(-1)).toContain("Đang yêu cầu chuyển sang Kênh 2");

    // 2. Chuyển sang chính kênh 0 (mặc định ban đầu channel = 0) -> không gửi gì
    const samePkt = s.encodeAction("channel", ["0"]);
    expect(samePkt!.length).toBe(0);
    expect(games.at(-1)).toContain("Nhân vật hiện đang ở Kênh 1 rồi");
  });

  it("nhận danh sách kênh từ máy chủ (07/01)", () => {
    const { s, st } = setup();
    // Giả lập gói 07/01 S->C: count = 2 kênh (Kênh 1: 5/20 người, Kênh 2: 18/20 người)
    // 00 00 07 01 00 02 [01 00 05 00 14 00] [02 00 12 00 14 00]
    const p = Buffer.alloc(1 + 12);
    p[0] = 2; // count = 2
    // Kênh 1: id 1, cur 5, max 20 -> free
    p.writeUInt16LE(1, 1);
    p.writeUInt16LE(5, 3);
    p.writeUInt16LE(20, 5);
    // Kênh 2: id 2, cur 18, max 20 -> busy
    p.writeUInt16LE(2, 7);
    p.writeUInt16LE(18, 9);
    p.writeUInt16LE(20, 11);
    s.onData(frame(0x07, 0x01, "00" + p.toString("hex")));

    const chs = st().location.channels;
    expect(chs).toHaveLength(2);
    expect(chs[0].name).toBe("Kênh 1");
    expect(chs[0].status).toBe("free");
    expect(chs[0].cur).toBe(5);
    expect(chs[1].name).toBe("Kênh 2");
    expect(chs[1].status).toBe("busy");
    expect(chs[1].cur).toBe(18);
  });

  it("server xác nhận đổi kênh thành công (07/02 f.length >= 23)", () => {
    const { s, st, games } = setup();
    s.encodeAction("channel", ["2"]); // Kênh 3 (id: 2)

    // Server trả gói 07/02 thành công: map 12001 @17, x 500 @19, y 600 @21, channel 2 @23
    const okPayload = Buffer.alloc(16);
    okPayload.writeUInt16LE(12001, 17 - 8);
    okPayload.writeUInt16LE(500, 19 - 8);
    okPayload.writeUInt16LE(600, 21 - 8);
    okPayload[23 - 8] = 2;
    s.onData(frame(0x07, 0x02, okPayload.toString("hex")));

    expect(st().location.channel).toBe(2);
    expect(games.at(-1)).toContain("Đã chuyển sang Kênh 3 thành công");
  });

  it("xử lý khi server báo kênh đầy (07/02 f.length < 23 hoặc sysMessage 10135)", () => {
    const { s, st, games } = setup();

    // 1. Chuyển kênh 2 nhưng server phản hồi từ chối 07/02 ngắn (< 23 bytes)
    s.encodeAction("channel", ["1"]);
    const rejectPayload = Buffer.alloc(4); // length = 12 < 23
    rejectPayload[1] = 0x01;
    s.onData(frame(0x07, 0x02, rejectPayload.toString("hex")));

    expect(games.at(-1)).toContain("Kênh đã ĐẦY");
    const ch2 = st().location.channels.find((c: any) => c.id === 1);
    expect(ch2.status).toBe("full");

    // 2. Chuyển kênh 3 nhưng nhận sysMessage 10135 (máy chủ báo chưa có kênh)
    s.encodeAction("channel", ["2"]);
    const sysMsgPayload = Buffer.alloc(10);
    sysMsgPayload[9 - 8] = 0x03;
    sysMsgPayload[10 - 8] = 0x01;
    sysMsgPayload.writeUInt32LE(10135, 11 - 8);
    s.onData(frame(0x02, 0x0a, sysMsgPayload.toString("hex")));

    expect(games.at(-1)).toContain("chưa có Kênh 3");
    // Kênh chưa được tạo ra trên máy chủ nên bị loại khỏi danh sách
    const ch3 = st().location.channels.find((c: any) => c.id === 2);
    expect(ch3).toBeUndefined();
  });
});

describe("Hệ thống Tự động di chuyển & Truy kích quái (set_chase_config)", () => {
  it("bật tự động di chuyển cập nhật state chaseConfig và phát sinh thông báo game", async () => {
    const { s, st, games } = setup();
    // Vị trí ban đầu map 12001 (100, 200)
    const movePayload = Buffer.alloc(16);
    movePayload.writeUInt16LE(12001, 17 - 8);
    movePayload.writeUInt16LE(100, 19 - 8);
    movePayload.writeUInt16LE(200, 21 - 8);
    movePayload[23 - 8] = 0;
    s.onData(frame(0x07, 0x00, movePayload.toString("hex")));

    // Bật tự động di chuyển với tham số dạng vị trí [enabled, mapId, originX, originY, maxRadius, npcId, npcName, autoReturn]
    const res = await s.executeAction(
      "set_chase_config",
      ["1", "12001", "100", "200", "150", "0", "", "1"],
      () => {},
      new AbortController().signal
    );
    expect(res).toEqual({ ok: true });

    const chaseCfg = st().chaseConfig;
    expect(chaseCfg).toBeDefined();
    expect(chaseCfg.enabled).toBe(true);
    expect(chaseCfg.mapId).toBe(12001);
    expect(chaseCfg.originX).toBe(100);
    expect(chaseCfg.originY).toBe(200);
    expect(chaseCfg.maxRadius).toBe(150);
    expect(chaseCfg.autoReturn).toBe(true);
    expect(games.at(-1)).toContain("Kích hoạt truy kích quái");
  });

  it("tắt tự động di chuyển cập nhật chaseConfig.enabled = false", async () => {
    const { s, st, games } = setup();
    await s.executeAction(
      "set_chase_config",
      ["1", "12001", "100", "200", "150", "0", "", "1"],
      () => {},
      new AbortController().signal
    );
    expect(st().chaseConfig.enabled).toBe(true);

    // Tắt tự động di chuyển
    await s.executeAction(
      "set_chase_config",
      ["0"],
      () => {},
      new AbortController().signal
    );
    expect(st().chaseConfig.enabled).toBe(false);
    expect(games.at(-1)).toContain("Đã dừng chế độ truy kích quái");
  });

  it("MockTransport hỗ trợ set_chase_config và phản ánh state chính xác", async () => {
    const { MockTransport } = await import("../src/transport/MockTransport");
    const mock = new MockTransport();
    await mock.connect({
      credentials: { username: "test", password: "p", server: "s" },
      log: () => {},
      speed: 1,
    });
    let latestState = mock.getState();
    mock.onState((st) => { latestState = st; });

    await mock.execute(
      { type: "Action", name: "set_chase_config", args: ["1", "12001", "300", "400", "120", "0", "", "1"] },
      new AbortController().signal
    );

    expect(latestState.chaseConfig).toBeDefined();
    expect(latestState.chaseConfig!.enabled).toBe(true);
    expect(latestState.chaseConfig!.mapId).toBe(12001);
    expect(latestState.chaseConfig!.originX).toBe(300);
    expect(latestState.chaseConfig!.originY).toBe(400);

    // Tắt
    await mock.execute(
      { type: "Action", name: "set_chase_config", args: ["0"] },
      new AbortController().signal
    );
    expect(latestState.chaseConfig!.enabled).toBe(false);
  });
});

describe("Hệ thống Tự động di chuyển độc lập (set_auto_move)", () => {
  it("bật tự động di chuyển cập nhật state autoMove và phát sinh thông báo game", async () => {
    const { s, st, games } = setup();
    // Vị trí ban đầu map 12001 (100, 200)
    const movePayload = Buffer.alloc(16);
    movePayload.writeUInt16LE(12001, 17 - 8);
    movePayload.writeUInt16LE(100, 19 - 8);
    movePayload.writeUInt16LE(200, 21 - 8);
    movePayload[23 - 8] = 0;
    s.onData(frame(0x07, 0x00, movePayload.toString("hex")));

    const res = await s.executeAction(
      "set_auto_move",
      ["1", "12001", "100", "200", "150"],
      () => {},
      new AbortController().signal
    );
    expect(res).toEqual({ ok: true });

    const autoMove = st().autoMove;
    expect(autoMove).toBeDefined();
    expect(autoMove!.enabled).toBe(true);
    expect(autoMove!.mapId).toBe(12001);
    expect(autoMove!.originX).toBe(100);
    expect(autoMove!.originY).toBe(200);
    expect(autoMove!.maxRadius).toBe(150);
    expect(games.at(-1)).toContain("Kích hoạt tự động di chuyển");
  });

  it("tắt tự động di chuyển cập nhật autoMove.enabled = false", async () => {
    const { s, st, games } = setup();
    await s.executeAction(
      "set_auto_move",
      ["1", "12001", "100", "200", "150"],
      () => {},
      new AbortController().signal
    );
    expect(st().autoMove?.enabled).toBe(true);

    // Tắt
    await s.executeAction(
      "set_auto_move",
      ["0"],
      () => {},
      new AbortController().signal
    );
    expect(st().autoMove?.enabled).toBe(false);
    expect(games.at(-1)).toContain("Đã dừng tự động di chuyển");
  });

  it("MockTransport hỗ trợ set_auto_move và phản ánh state chính xác", async () => {
    const { MockTransport } = await import("../src/transport/MockTransport");
    const mock = new MockTransport();
    await mock.connect({
      credentials: { username: "test", password: "p", server: "s" },
      log: () => {},
      speed: 1,
    });
    let latestState = mock.getState();
    mock.onState((st) => { latestState = st; });

    await mock.execute(
      { type: "Action", name: "set_auto_move", args: ["1", "12001", "300", "400", "150"] },
      new AbortController().signal
    );

    expect(latestState.autoMove).toBeDefined();
    expect(latestState.autoMove!.enabled).toBe(true);
    expect(latestState.autoMove!.mapId).toBe(12001);
    expect(latestState.autoMove!.originX).toBe(300);
    expect(latestState.autoMove!.originY).toBe(400);

    // Tắt
    await mock.execute(
      { type: "Action", name: "set_auto_move", args: ["0"] },
      new AbortController().signal
    );
    expect(latestState.autoMove!.enabled).toBe(false);
  });
});

describe("Tính năng 'Đến Chỗ An Toàn' (move_to_safe_spot)", () => {
  it("getSafeSpotForMap: tính đúng toạ độ lùi 55px từ cổng vào map", async () => {
    const { getSafeSpotForMap } = await import("../src/runtime/route");
    // Map 12001 (door 1 at 90, 1650): người chơi ở (500, 1500)
    const spot12001 = getSafeSpotForMap(12001, 500, 1500);
    expect(spot12001).toBeDefined();
    expect(spot12001!.x).toBeGreaterThan(90);
    const d1 = Math.hypot(spot12001!.x - 90, spot12001!.y - 1650);
    expect(Math.round(d1)).toBe(55);

    // Map 12815 (door 1 at 51, 1867): người chơi ở (600, 800)
    const spot12815 = getSafeSpotForMap(12815, 600, 800);
    expect(spot12815).toBeDefined();
    const d2 = Math.hypot(spot12815!.x - 51, spot12815!.y - 1867);
    expect(Math.round(d2)).toBe(55);

    // Map 11011 (door 1 at 36, 729) -> offset 55px sang (91, 729)
    const gateSpot = getSafeSpotForMap(11011);
    expect(gateSpot).toEqual({ x: 91, y: 729 });

    // Map không tồn tại -> null
    expect(getSafeSpotForMap(999999)).toBeNull();
  });

  it("MockTransport: thành viên trong đội bị chặn với thông báo chính xác", async () => {
    const { MockTransport } = await import("../src/transport/MockTransport");
    const mock = new MockTransport();
    await mock.connect({
      credentials: { username: "member", password: "p", server: "s" },
      log: () => {},
      speed: 1,
    });
    // Giả lập trạng thái đã vào đội với tư cách thành viên (slot 2)
    (mock as any).state.party = {
      joined: true,
      leaderName: "ChuPT",
      members: [
        { slot: 1, name: "ChuPT", isLeader: true, isAdvisor: false },
        { slot: 2, name: "member", isLeader: false, isAdvisor: false, isSelf: true },
      ],
      inviteStatus: "",
    };

    const res = await mock.execute(
      { type: "Action", name: "move_to_safe_spot", args: [] },
      new AbortController().signal
    );
    expect(res.ok).toBe(false);
    expect(res.message).toBe("Ní đang trong tổ đội, không được phép chạy lung tung!!!");
  });

  it("MockTransport: chủ PT hoặc solo được phép di chuyển đến chỗ an toàn", async () => {
    const { MockTransport } = await import("../src/transport/MockTransport");
    const mock = new MockTransport();
    await mock.connect({
      credentials: { username: "leader", password: "p", server: "s" },
      log: () => {},
      speed: 1,
    });
    // Chủ PT đang ở map 12001 tại toạ độ (500, 1500)
    (mock as any).state.location = { map: 12001, x: 500, y: 1500, channel: 0 };
    (mock as any).state.party = {
      joined: true,
      leaderName: "leader",
      members: [
        { slot: 1, name: "leader", isLeader: true, isAdvisor: false, isSelf: true },
        { slot: 2, name: "member1", isLeader: false, isAdvisor: false },
      ],
      inviteStatus: "",
    };

    const res = await mock.execute(
      { type: "Action", name: "move_to_safe_spot", args: [] },
      new AbortController().signal
    );
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Đã đến chỗ an toàn");
    // Toạ độ được cập nhật đúng vị trí an toàn cách cổng 55px
    const st = mock.getState();
    expect(st.location.x).toBe(142);
    expect(st.location.y).toBe(1631);
    // Thành viên vẫn ở trong đội, không bị rời đội
    expect(st.party.joined).toBe(true);
    expect(st.party.members.length).toBe(2);
  });

  it("tsOnlineCodec: executeAction move_to_safe_spot kiểm tra đúng quyền hạn tổ đội", async () => {
    const { tsOnlineCodec } = await import("../src/transport/socket/codecs/tsOnline");
    let state: any = {};
    const games: string[] = [];
    const codec = tsOnlineCodec.create({
      log: () => {},
      game: (m: string) => games.push(m),
      send: () => {},
      patchState: (p: any) => { state = { ...state, ...p }; },
    } as any);

    // 1. Nếu là thành viên trong đội
    (codec as any).party = {
      snapshot: () => ({
        joined: true,
        leaderName: "ChuPT",
        members: [
          { slot: 1, name: "ChuPT", isLeader: true, isAdvisor: false },
          { slot: 2, name: "self", isLeader: false, isAdvisor: false, isSelf: true },
        ],
      }),
    };
    (codec as any).location = { map: 12001, x: 500, y: 1500 };

    const memberRes = await codec.executeAction!(
      "move_to_safe_spot",
      [],
      () => {},
      new AbortController().signal
    );
    expect(memberRes?.ok).toBe(false);
    expect(memberRes?.message).toBe("Ní đang trong tổ đội, không được phép chạy lung tung!!!");
    expect(games.at(-1)).toBe("⚠️ Ní đang trong tổ đội, không được phép chạy lung tung!!!");

    // 2. Nếu là chủ PT
    (codec as any).party = {
      snapshot: () => ({
        joined: true,
        leaderName: "self",
        members: [
          { slot: 1, name: "self", isLeader: true, isAdvisor: false, isSelf: true },
          { slot: 2, name: "member1", isLeader: false, isAdvisor: false },
        ],
      }),
    };
    const sentFrames: Buffer[] = [];
    const leaderRes = await codec.executeAction!(
      "move_to_safe_spot",
      [],
      (b: Buffer) => sentFrames.push(b),
      new AbortController().signal
    );
    expect(leaderRes?.ok).toBe(true);
    expect(leaderRes?.message).toContain("Đã đến chỗ an toàn (142, 1631)");
    expect(state.location.x).toBe(142);
    expect(state.location.y).toBe(1631);
  });

  it("battleSpawnPlayer (0b/fa) không gửi gói 41/01 lên server (tránh kick mã 42)", () => {
    const sent: Buffer[] = [];
    const io: any = {
      send: (b: Buffer) => sent.push(b),
      patchState: () => {},
      game: () => {},
      log: () => {},
    };
    const s = tsOnlineCodec.create(io);
    const frame = (cmd: number, sub: number, hex: string) => {
      const b = Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(hex, "hex")]);
      const f = Buffer.alloc(4 + b.length);
      f[0] = 0xf4 ^ 0x99;
      f[1] = 0x44 ^ 0x78;
      f.writeUInt16LE(f.length, 2);
      b.copy(f, 4);
      for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
      return f;
    };
    // Gửi gói 0b/fa spawn player
    const spawnPayload = "006905000102acd867d3aca80a000000000000000000000003029f010000e50000009f010000e50000007a0000030b4a756e53686958696f6e6701037a00";
    s.onData(frame(0x0b, 0xfa, spawnPayload));
    // Kiểm tra tuyệt đối không có frame nào chứa cmd 0x41, sub 0x01 được gửi
    const has4101 = sent.some((b) => {
      const dec = Buffer.from(b);
      for (let i = 2; i < dec.length; i++) dec[i] ^= 0xad;
      return dec.length >= 8 && dec[4] === 0x00 && dec[5] === 0x00 && dec[6] === 0x41 && dec[7] === 0x01;
    });
    expect(has4101).toBe(false);
  });

  it("thành viên trong đội bị chặn tự di chuyển (move, walk, warp_to_spot) và tự động truy kích", async () => {
    const sent: Buffer[] = [];
    const games: string[] = [];
    let state: any = { location: { map: 12001, x: 300, y: 400 } };
    const io: any = {
      send: (b: Buffer) => sent.push(b),
      patchState: (p: any) => { state = { ...state, ...p }; },
      game: (msg: string) => games.push(msg),
      log: () => {},
    };
    const s = tsOnlineCodec.create(io);
    (s as any).party = {
      snapshot: () => ({
        joined: true,
        leaderName: "LeaderAccount",
        members: [
          { slot: 1, name: "LeaderAccount", isLeader: true, isAdvisor: false, isSelf: false },
          { slot: 2, name: "Me", isLeader: false, isAdvisor: false, isSelf: true },
        ],
      }),
      leaderOf: () => "leader_uid",
    };

    // Thử move / walk
    const moveRes = await s.executeAction!("move", ["500", "600"], (b) => sent.push(b), new AbortController().signal);
    expect(moveRes?.ok).toBe(false);
    expect(moveRes?.message).toContain("Đang trong tổ đội");

    // Thử warp_to_spot
    const warpRes = await s.executeAction!("warp_to_spot", ["12001", "500", "600"], (b) => sent.push(b), new AbortController().signal);
    expect(warpRes?.ok).toBe(true); // âm thầm bỏ qua, không tự chạy làm desync
    expect(sent.length).toBe(0); // không gửi gói di chuyển 06/01 nào
  });

  it("gói 14/08 không được đóng cờ trận đấu ở hiệp 0 khi quái địch còn sống (đóng thoại mở màn)", () => {
    let inBattle = false;
    const io: any = {
      send: () => {},
      patchState: (p: any) => { if (p.inBattle !== undefined) inBattle = p.inBattle; },
      game: () => {},
      log: () => {},
    };
    const s = tsOnlineCodec.create(io);
    const frame = (cmd: number, sub: number, hex: string) => {
      const b = Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(hex, "hex")]);
      const f = Buffer.alloc(4 + b.length);
      f[0] = 0xf4 ^ 0x99;
      f[1] = 0x44 ^ 0x78;
      f.writeUInt16LE(f.length, 2);
      b.copy(f, 4);
      for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
      return f;
    };

    // Vào trận
    s.onData(frame(0x14, 0x0c, "00"));
    expect(inBattle).toBe(true);

    // Giả lập có quái địch còn sống và turn = 0 (vừa vào trận)
    (s as any).battleUnits = [
      { row: 0, col: 1, name: "Loan Kích Vệ Đội", hp: { cur: 1109, max: 1225 }, isEnemy: true },
      { row: 3, col: 2, name: "JunDaGe", hp: { cur: 899, max: 1258 }, isEnemy: false, isPet: false },
    ];
    (s as any).battleTurnIndex = 0;

    // Server gửi 14/08 00 2a đóng thoại mở màn trong khi quái còn 1109 HP
    s.onData(frame(0x14, 0x08, "002a"));

    // Trận đấu PHẢI tiếp tục, KHÔNG được đóng cờ trận
    expect((s as any).inBattle).toBe(true);
  });

  it("khi nhân vật đã gục ngã (HP = 0), battleTurn không gửi lệnh đánh và triggerAutoHeal không dùng thuốc", () => {
    const sent: Buffer[] = [];
    const io: any = {
      send: (b: Buffer) => sent.push(b),
      patchState: () => {},
      game: () => {},
      log: () => {},
    };
    const s = tsOnlineCodec.create(io);
    const frame = (cmd: number, sub: number, hex: string) => {
      const b = Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(hex, "hex")]);
      const f = Buffer.alloc(4 + b.length);
      f[0] = 0xf4 ^ 0x99;
      f[1] = 0x44 ^ 0x78;
      f.writeUInt16LE(f.length, 2);
      b.copy(f, 4);
      for (let i = 2; i < f.length; i++) f[i] ^= 0xad;
      return f;
    };

    // Vào trận
    s.onData(frame(0x14, 0x0c, "00"));

    // Cài đặt nhân vật QingLong gục ngã (HP = 0) và võ tướng Lữ Bố còn sống
    (s as any).player = { name: "QingLong", hp: { cur: 0, max: 1000 }, sp: { cur: 100, max: 100 } };
    (s as any).pet = { name: "Lữ Bố", hp: { cur: 1200, max: 1500 }, sp: { cur: 100, max: 100 } };
    (s as any).battleUnits = [
      { row: 3, col: 3, name: "QingLong", hp: { cur: 0, max: 1000 }, sp: { cur: 100, max: 100 }, isEnemy: false, isPet: false },
      { row: 2, col: 3, name: "Lữ Bố", hp: { cur: 1200, max: 1500 }, sp: { cur: 100, max: 100 }, isEnemy: false, isPet: true },
      { row: 0, col: 1, name: "Quái", hp: { cur: 500, max: 1000 }, isEnemy: true },
    ];

    // Turn bắt đầu (34/01)
    s.onData(frame(0x34, 0x01, "00"));

    // Giải mã các frame gửi đi
    const decodedFrames = sent.map((b) => {
      const dec = Buffer.from(b);
      for (let i = 2; i < dec.length; i++) dec[i] ^= 0xad;
      return dec;
    });

    // Tuyệt đối KHÔNG có frame lệnh nào cho hàng 3 cột 3 (nhân vật gục ngã)
    const charAttack = decodedFrames.some((dec) => dec[4] === 0x00 && dec[5] === 0x00 && dec[6] === 0x32 && dec[7] === 0x01 && dec[9] === 3 && dec[10] === 3);
    expect(charAttack).toBe(false);

    // Nhưng võ tướng Lữ Bố (hàng 2 cột 3) còn sống vẫn được ra lệnh
    const petAttack = decodedFrames.some((dec) => dec[4] === 0x00 && dec[5] === 0x00 && dec[6] === 0x32 && dec[7] === 0x01 && dec[9] === 2 && dec[10] === 3);
    expect(petAttack).toBe(true);

    // Kiểm tra triggerAutoHeal khi HP = 0: tuyệt đối không gửi gói 17/0f hồi máu cho nhân vật đã chết
    sent.length = 0;
    (s as any).inBattle = false;
    (s as any).autoHeal = { enabled: true, player: { autoHp: true, hpPct: 80 }, pet: { autoHp: false, hpPct: 80 } };
    (s as any).bag = new Map([[1, { id: 32043, qty: 10 }]]); // có thuốc hồi HP trong túi
    (s as any).triggerAutoHeal(true);
    expect(sent.length).toBe(0); // không gửi 17/0f khi HP = 0
  });

  it("0e/05 nạp danh sách bạn bè, 0e/0c cập nhật cờ quà tặng, friend_gift_all gửi 0e/12 và nhận 0e/13", async () => {
    const { s, sent, st } = setup();

    // 1. Giả lập server gửi 0e/05 với 2 bạn bè: friend 1 (chưa có quà), friend 2 (có quà chờ nhận status 0x02)
    const f1Meta = Buffer.alloc(35, 0); f1Meta[18] = 0;
    const f2Meta = Buffer.alloc(35, 0); f2Meta[18] = 2;
    const body0e05 = Buffer.concat([
      Buffer.from([0x00, 0x02, 0x00]),
      Buffer.from("0100000000000000", "hex"), Buffer.from([4]), Buffer.from("Alex"), f1Meta,
      Buffer.from("0200000000000000", "hex"), Buffer.from([3]), Buffer.from("Bob"), f2Meta,
    ]);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x0e, 0x05]), body0e05])));

    expect(st().friends).toHaveLength(2);
    expect(st().friends[0]).toEqual({ uid: "0100000000000000", name: "Alex", status: 0 });
    expect(st().friends[1]).toEqual({ uid: "0200000000000000", name: "Bob", status: 2 });

    // 2. Chạy executeAction friend_gift_all
    sent.length = 0;
    const promise = s.executeAction!("friend_gift_all", [], () => {}, new AbortController().signal);

    // Kiểm tra gói đầu tiên gửi đi là 0e/12 (tặng quà tất cả 2 bạn bè)
    await new Promise((r) => setTimeout(r, 100));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const unxor1 = Buffer.from(sent[0]!, "hex");
    for (let i = 2; i < unxor1.length; i++) unxor1[i] ^= 0xad;
    expect(unxor1[6]).toBe(0x0e);
    expect(unxor1[7]).toBe(0x12);
    expect(unxor1[8]).toBe(0x00);
    expect(unxor1[9]).toBe(2);

    // Giả lập server gửi 0e/0c cập nhật cờ sau khi tặng: friend 1 -> 1, friend 2 -> 3
    const body0e0c = Buffer.concat([
      Buffer.from([0x00, 0x02]),
      Buffer.from("0100000000000000", "hex"), Buffer.from([0x01]),
      Buffer.from("0200000000000000", "hex"), Buffer.from([0x03]),
    ]);
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x0e, 0x0c]), body0e0c])));

    // Chờ friend_gift_all hoàn tất
    const res = await promise;
    expect(res).toEqual({ ok: true, message: expect.stringContaining("Đã tặng quà cho 2 bạn bè và nhận quà từ 1 bạn bè") });

    // Kiểm tra gói thứ hai gửi đi là 0e/13 (nhận quà từ Bob)
    expect(sent.length).toBe(2);
    const unxor2 = Buffer.from(sent[1]!, "hex");
    for (let i = 2; i < unxor2.length; i++) unxor2[i] ^= 0xad;
    expect(unxor2[6]).toBe(0x0e);
    expect(unxor2[7]).toBe(0x13);
    expect(unxor2[8]).toBe(0x00);
    expect(unxor2[9]).toBe(1);
    expect(unxor2.subarray(10, 18).toString("hex")).toBe("0200000000000000");
  });

  it("pull_secret gửi đúng gói 42/01 cho bí cấp 45659 và tiêu 9000 xu", async () => {
    const { s, sent, games } = setup();
    sent.length = 0;
    const res = await s.executeAction!("pull_secret", [], () => {}, new AbortController().signal);
    expect(res).toEqual({ ok: true, message: expect.stringContaining("9.000 Xu") });
    expect(sent.length).toBe(1);
    const unxor = Buffer.from(sent[0]!, "hex");
    for (let i = 2; i < unxor.length; i++) unxor[i] ^= 0xad;
    expect(unxor[6]).toBe(0x42);
    expect(unxor[7]).toBe(0x01);
    expect(unxor.subarray(8).toString("hex")).toBe("00050101015bb22823010000");

    // Server phản hồi 42/03 thành công
    s.onData(frame(0x42, 0x03, "005bb201"));
    expect(games.some((g) => g.includes("bí cấp võ tướng"))).toBe(true);
  });

  it("pull_card gửi đúng gói 42/01 cho thẻ tướng 45660 và tiêu 9000 xu", async () => {
    const { s, sent, games } = setup();
    sent.length = 0;
    const res = await s.executeAction!("pull_card", [], () => {}, new AbortController().signal);
    expect(res).toEqual({ ok: true, message: expect.stringContaining("9.000 Xu") });
    expect(sent.length).toBe(1);
    const unxor = Buffer.from(sent[0]!, "hex");
    for (let i = 2; i < unxor.length; i++) unxor[i] ^= 0xad;
    expect(unxor[6]).toBe(0x42);
    expect(unxor[7]).toBe(0x01);
    expect(unxor.subarray(8).toString("hex")).toBe("00050101025cb22823010000");

    // Server phản hồi 42/03 thành công
    s.onData(frame(0x42, 0x03, "005cb201"));
    expect(games.some((g) => g.includes("chiêu mộ võ tướng"))).toBe(true);
  });

  it("pull_all gửi lần lượt rút bí cấp rồi rút thẻ (tổng 18.000 xu)", async () => {
    const { s, sent } = setup();
    sent.length = 0;
    const res = await s.executeAction!("pull_all", [], () => {}, new AbortController().signal);
    expect(res).toEqual({ ok: true, message: expect.stringContaining("18.000 Xu") });
    expect(sent.length).toBe(2);
    const unxor1 = Buffer.from(sent[0]!, "hex");
    for (let i = 2; i < unxor1.length; i++) unxor1[i] ^= 0xad;
    expect(unxor1.subarray(8).toString("hex")).toBe("00050101015bb22823010000");
    const unxor2 = Buffer.from(sent[1]!, "hex");
    for (let i = 2; i < unxor2.length; i++) unxor2[i] ^= 0xad;
    expect(unxor2.subarray(8).toString("hex")).toBe("00050101025cb22823010000");
  });

  it("parse gói 1f/06 danh sách võ tướng trong Nhà Trọ và cập nhật innPets", () => {
    const { s, st } = setup();
    // Gói 1f/06 từ pcap:
    // 00 (delimiter)
    // 01 (slot 1)
    // 15 37 (model 14101)
    // 01 (level 1)
    // 06 00 00 00 (exp 6)
    // cd 00 00 00 (hp 205)
    // 06 (nameLen 6)
    // bd b2 a4 e5 ae 56 (Thái Văn Cơ in Big5)
    // 00 (status 0: trong nhà trọ)
    s.onData(frame(0x1f, 0x06, "000115370106000000cd00000006bdb2a4e5ae5600"));
    expect(st().innPets).toBeDefined();
    expect(st().innPets![0]).toMatchObject({
      slot: 1,
      model: 14101,
      level: 1,
      exp: 6,
      hp: 205,
      status: 0,
    });
  });

  it("parse gói 56/03 trạng thái vận tiêu và tính đúng 4 giờ", () => {
    const { s, st } = setup();
    // Nạp pet vào nhà trọ trước
    s.onData(frame(0x1f, 0x06, "000115370106000000cd00000006bdb2a4e5ae5600"));

    // Gói 56/03 từ pcap khi đang vận tiêu:
    // 00 01 (active = 1) 01 (slot = 1)
    // 51 df 0b 31 38 9e e6 40 (start OLE)
    // a6 34 61 86 3d 9e e6 40 (end OLE = start + 4h)
    // 01 01 28 15
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1729900000000);
    try {
      s.onData(frame(0x56, 0x03, "00010151df0b31389ee640a63461863d9ee64001012815"));
      expect(st().escort).toBeDefined();
      expect(st().escort!.phase).toBe("escorting");
      expect(st().escort!.activeEscort).toBeDefined();
      expect(st().escort!.activeEscort!.slot).toBe(1);
      expect(st().escort!.activeEscort!.durationHours).toBe(4);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("escort_start gửi đúng gói 56/02 và chặn nếu pet đang vận tiêu", async () => {
    const { s, sent } = setup();
    sent.length = 0;

    // 1. Pet rảnh -> xuất phát thành công
    const res = await s.executeAction!("escort_start", ["1"], (b) => sent.push(b.toString("hex")), new AbortController().signal);
    expect(res).toEqual({ ok: true, message: expect.stringContaining("ô 1") });
    expect(sent.length).toBe(1);
    const unxor = Buffer.from(sent[0]!, "hex");
    for (let i = 2; i < unxor.length; i++) unxor[i] ^= 0xad;
    expect(unxor[6]).toBe(0x56);
    expect(unxor[7]).toBe(0x02);
    expect(unxor[9]).toBe(1);

    // 2. Pet được đánh dấu đang vận tiêu (status = 1) -> chặn
    s.onData(frame(0x1f, 0x06, "000115370106000000cd00000006bdb2a4e5ae5601"));
    const res2 = await s.executeAction!("escort_start", ["1"], (b) => sent.push(b.toString("hex")), new AbortController().signal);
    expect(res2?.ok).toBe(false);
  });

  it("buildSteps('open_inn') tạo chuỗi bước di chuyển tới map 12007 và mở Nhà Trọ chuẩn PCAP", () => {
    const steps = buildSteps("open_inn", {}, { map: 12001 });
    expect(steps.some((st) => "cmd" in st && st.cmd.name === "move" && st.cmd.args[0] === "350" && st.cmd.args[1] === "450")).toBe(true);
    expect(steps.some((st) => "cmd" in st && st.cmd.name === "interact_prep" && st.cmd.args[0] === "8")).toBe(true);
    expect(steps.some((st) => "cmd" in st && st.cmd.name === "talk_npc" && st.cmd.args[0] === "1")).toBe(true);
    expect(steps.some((st) => "cmd" in st && st.cmd.name === "send_menu" && st.cmd.args[0] === "32")).toBe(true);
    expect(steps.some((st) => "cmd" in st && st.cmd.name === "open_inn_request")).toBe(true);
    expect(steps.some((st) => "cmd" in st && st.cmd.name === "escort_query")).toBe(true);
  });

  it("escort_claim gửi đúng gói 56/05 00 01 và nhận phản hồi giải phóng pet", async () => {
    const { s, sent, st } = setup();
    sent.length = 0;

    // Giả lập pet ô 1 đang vận tiêu
    s.onData(frame(0x1f, 0x06, "000115370106000000cd00000006bdb2a4e5ae5601"));
    expect(st().innPets?.[0]?.status).toBe(1);

    const res = await s.executeAction!("escort_claim", [], (b) => sent.push(b.toString("hex")), new AbortController().signal);
    expect(res).toEqual({ ok: true, message: expect.stringContaining("nhận thưởng") });

    // Server phản hồi 56/05 thành công
    s.onData(frame(0x56, 0x05, "0001"));
    // Pet phải được giải phóng (status = 0)
    expect(st().innPets?.[0]?.status).toBe(0);
    expect(st().escort?.activeEscort).toBeUndefined();
  });

  describe("Nhiệm vụ hàng ngày & Sổ Thông Hành (5b/02, 5b/03, 4d/0b)", () => {
    it("daily_quest_claim gửi đúng gói 5b/02 (9 nhiệm vụ) và 4 gói 5b/03 (4 rương mốc)", async () => {
      const { s } = setup();
      const sentPkt: Buffer[] = [];
      const res = await s.executeAction!("daily_quest_claim", [], (b) => sentPkt.push(b), new AbortController().signal);
      expect(res).toEqual({ ok: true, message: expect.stringContaining("nhiệm vụ ngày") });

      const dec = sentPkt.map((b) => {
        const u = Buffer.from(b);
        for (let i = 2; i < u.length; i++) u[i] ^= 0xad;
        return u.subarray(6);
      });

      // 1. Gói 5b/02 (9 nhiệm vụ ngày)
      expect(dec[0]![0]).toBe(0x5b);
      expect(dec[0]![1]).toBe(0x02);
      expect(dec[0]![2]).toBe(0x00);
      expect(dec[0]![3]).toBe(0x09); // 9 nhiệm vụ

      // 2..5. Các gói 5b/03 cho 4 rương mốc (2, 4, 6, 8)
      expect(dec).toHaveLength(5);
      expect(dec[1]).toEqual(Buffer.from([0x5b, 0x03, 0x00, 0x01, 0x00, 0x02, 0x30, 0x00]));
      expect(dec[2]).toEqual(Buffer.from([0x5b, 0x03, 0x00, 0x01, 0x00, 0x04, 0x32, 0x00]));
      expect(dec[3]).toEqual(Buffer.from([0x5b, 0x03, 0x00, 0x01, 0x00, 0x06, 0x34, 0x00]));
      expect(dec[4]).toEqual(Buffer.from([0x5b, 0x03, 0x00, 0x01, 0x00, 0x08, 0x36, 0x00]));
    });

    it("battle_pass_claim gửi 4d/0b mở thông hành và nhận các mốc quà", async () => {
      const { s } = setup();
      // Server nạp thông tin thông hành: 378 điểm, mốc kế tiếp là 58 (0x003a)
      s.onData(frame(0x4d, 0x0b, "007a013a00"));

      const sentPkt: Buffer[] = [];
      const res = await s.executeAction!("battle_pass_claim", [], (b) => sentPkt.push(b), new AbortController().signal);
      expect(res).toEqual({ ok: true, message: expect.stringContaining("Sổ Thông Hành") });

      const dec = sentPkt.map((b) => {
        const u = Buffer.from(b);
        for (let i = 2; i < u.length; i++) u[i] ^= 0xad;
        return u.subarray(6);
      });

      // Gói đầu tiên: 4d 0b 00 80 00 (mở thông hành tab 0)
      expect(dec[0]).toEqual(Buffer.from([0x4d, 0x0b, 0x00, 0x80, 0x00]));
      // Các gói tiếp theo gửi mốc quà 4d 0b 00 81 ...
      expect(dec[1]).toEqual(Buffer.from([0x4d, 0x0b, 0x00, 0x81, 0x3a, 0x00])); // mốc 58
      expect(dec[2]).toEqual(Buffer.from([0x4d, 0x0b, 0x00, 0x81, 0x3c, 0x00])); // mốc 60
      expect(dec[3]).toEqual(Buffer.from([0x4d, 0x0b, 0x00, 0x81, 0x3e, 0x00])); // mốc 62
    });

    it("safeSpotOnFaint (Chủ PT / Solo): khi có slot gục ngã (HP = 0), hết trận tự động teleport về Cửa thành Tương Dương", async () => {
      const { s, sent, games, st } = setup();
      // Bật tính năng trong autoHeal
      s.encodeAction("set_auto_heal", [JSON.stringify({ safeSpotOnFaint: true })]);

      // Nạp vào map bãi quái
      const movePayload = Buffer.alloc(16);
      movePayload.writeUInt16LE(12815, 17 - 8);
      movePayload.writeUInt16LE(500, 19 - 8);
      movePayload.writeUInt16LE(1500, 21 - 8);
      movePayload[23 - 8] = 0;
      s.onData(frame(0x07, 0x00, movePayload.toString("hex")));

      // Vào trận đấu 14/0c
      s.onData(frame(0x14, 0x0c, "00"));
      expect(st().inBattle).toBe(true);

      // Cập nhật HP của một slot đồng minh về 0 (33/01 row=3, col=2, stat=0x19, val=0)
      s.onData(frame(0x33, 0x01, "000003021900000000"));

      sent.length = 0;
      // Kết thúc trận đấu 0b/00
      s.onData(frame(0x0b, 0x00, "00"));
      expect(st().inBattle).toBe(false);

      // Chờ hàm teleport kích hoạt
      await new Promise((r) => setTimeout(r, 900));

      // Kiểm tra có thông báo bảo vệ phát ra
      expect(games.some((g) => g.includes("[Bảo Vệ Tổ Đội]") && g.includes("Tương Dương"))).toBe(true);

      // Giải mã các gói tin gửi lên server
      const dec = sent.map((hex) => {
        const u = Buffer.from(hex, "hex");
        for (let i = 2; i < u.length; i++) u[i] ^= 0xad;
        return u.subarray(6);
      });

      // Kiểm tra có gói 44/01 teleport tới Tương Dương (id 21001 = 0x5209, gateIndex = 13 = 0x0d)
      const hasTeleportTuongDuong = dec.some(
        (b) => b[0] === 0x44 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x09 && b[4] === 0x52 && b[5] === 0x0d
      );
      expect(hasTeleportTuongDuong).toBe(true);
    });

    it("safeSpotOnFaint (Thành viên): khi có slot gục ngã, thành viên tự động rời đội rồi teleport về Tương Dương", async () => {
      const { s, sent, games, st } = setup();
      s.encodeAction("set_auto_heal", [JSON.stringify({ safeSpotOnFaint: true })]);

      // Nạp danh tính UID của bản thân
      (s as unknown as { uid: Buffer }).uid = Buffer.from("1122334455667788", "hex");

      // Giả lập đang là thành viên trong tổ đội (chủ PT a1b2c3d4e5f60708, joiner 1122334455667788)
      s.onData(frame(0x0d, 0x05, "00a1b2c3d4e5f607081122334455667788"));

      // Vào trận đấu 14/0c
      s.onData(frame(0x14, 0x0c, "00"));
      expect(st().inBattle).toBe(true);

      // Cập nhật một slot đồng minh bị gục ngã
      s.onData(frame(0x33, 0x01, "000002021900000000"));

      sent.length = 0;
      // Kết thúc trận đấu 0b/00
      s.onData(frame(0x0b, 0x00, "00"));
      expect(st().inBattle).toBe(false);

      // Chờ kích hoạt rời đội (ngay lập tức) và teleport (sau 400ms)
      await new Promise((r) => setTimeout(r, 900));

      // Kiểm tra thông báo bảo vệ thành viên
      expect(games.some((g) => g.includes("[Bảo Vệ Thành Viên]"))).toBe(true);

      const dec = sent.map((hex) => {
        const u = Buffer.from(hex, "hex");
        for (let i = 2; i < u.length; i++) u[i] ^= 0xad;
        return u.subarray(6);
      });

      // 1. Có gói rời đội 0d/04
      const hasLeaveParty = dec.some((b) => b[0] === 0x0d && b[1] === 0x04);
      expect(hasLeaveParty).toBe(true);

      // 2. Có gói teleport 44/01 về Tương Dương (21001 = 0x5209, gateIndex = 13 = 0x0d)
      const hasTeleport = dec.some(
        (b) => b[0] === 0x44 && b[1] === 0x01 && b[3] === 0x09 && b[4] === 0x52 && b[5] === 0x0d
      );
      expect(hasTeleport).toBe(true);
    });

    it("autoReviveAlly: khi có đồng đội gục ngã và nhân vật có skill 11013, ưu tiên dùng Hồi Sinh vào ô đồng đội", async () => {
      const { s, sent, games, st } = setup();
      // Nạp skill Hồi Sinh 11013 cho nhân vật
      (s as any).playerSkills = [
        { id: 11013, name: "Hồi Sinh", desc: "Giúp người chết sống lại", level: 10, sp: 40 },
      ];
      (s as any).player.sp = { cur: 100, max: 100 };

      // Bật tính năng autoReviveAlly trong autoHeal
      s.encodeAction("set_auto_heal", [JSON.stringify({ autoReviveAlly: true })]);

      // Cài đặt chiến thuật turn là Đấu Vật (10000)
      s.encodeAction("set_battle_config", [JSON.stringify({
        autoFight: true,
        playerAction: { type: "attack", skillId: 10000, target: "F1" },
        petAction: { type: "attack", skillId: 10000, target: "F1" },
      })]);

      // Vào trận đấu 14/0c
      s.onData(frame(0x14, 0x0c, "00"));
      expect(st().inBattle).toBe(true);

      // Thêm 1 đồng đội nhân vật (hàng 3, cột 3) và 1 quái (hàng 0, cột 2)
      (s as any).battleUnits = [
        { row: 3, col: 2, name: "Nhân vật", level: 100, hp: { cur: 1000, max: 1000 }, sp: { cur: 100, max: 100 }, isEnemy: false, isPet: false },
        { row: 3, col: 3, name: "Đồng đội A", level: 100, hp: { cur: 0, max: 1000 }, sp: { cur: 50, max: 100 }, isEnemy: false, isPet: false },
        { row: 0, col: 2, name: "Quái Bãi", level: 90, hp: { cur: 2000, max: 2000 }, sp: { cur: 50, max: 50 }, isEnemy: true },
      ];

      sent.length = 0;
      // Đến lượt đánh 34/01
      s.onData(frame(0x34, 0x01, "00"));

      // Kiểm tra có thông báo ưu tiên Hồi Sinh phát ra
      expect(games.some((g) => g.includes("ưu tiên dùng [Hồi Sinh] lên đồng đội [Đồng đội A] (3, 3)"))).toBe(true);

      const dec = sent.map((hex) => {
        const u = Buffer.from(hex, "hex");
        for (let i = 2; i < u.length; i++) u[i] ^= 0xad;
        return u.subarray(6);
      });

      // Kiểm tra gói 32/01 battle action được gửi:
      // actorRow=3, actorCol=2, targetRow=3, targetCol=3, skillId=11013 (11013 = 0x2b05 -> 0x05, 0x2b)
      const hasReviveAction = dec.some((b) =>
        b[0] === 0x32 && b[1] === 0x01 && b[2] === 0x00 &&
        b[3] === 3 && b[4] === 2 && b[5] === 3 && b[6] === 3 &&
        b[7] === (11013 & 0xff) && b[8] === (11013 >> 8)
      );
      expect(hasReviveAction).toBe(true);
    });

    it("autoReviveAlly: nếu nhân vật chưa học skill 11013, tự động vô hiệu hóa và báo lỗi", () => {
      const { s, games } = setup();
      (s as any).playerSkills = [
        { id: 10001, name: "Mưa Đá", desc: "", level: 1, sp: 9 },
      ];

      // Cố gắng bật autoReviveAlly
      s.encodeAction("set_auto_heal", [JSON.stringify({ autoReviveAlly: true })]);

      // Phải báo lỗi ra game log
      expect(games.some((g) => g.includes("Ní chưa lĩnh hội thần thông hồi sinh rồi"))).toBe(true);
      // Cờ autoReviveAlly phải bị disable
      expect((s as any).autoHeal.autoReviveAlly).toBe(false);
    });
  });
});







