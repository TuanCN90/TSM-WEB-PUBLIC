import { describe, expect, it } from "vitest";
import fx from "./fixtures/general-cap.json";
import { encodeFrame, tsOnlineCodec } from "../src/transport/socket/codecs/tsOnline";

/** 0f/08 thật (3 võ tướng: Lữ Bố Lv86, Nhạn Điêu Tuyết Lv151, Thái Văn Cơ Lv74) — payload f[8..] từ pcap; 13/04 = pet xuất chiến. */
const PETS_0F08 = "000301b936d75491005664030000f300100093004f0066003a000d000064011b0004a766a5ac0101010000010000000000000000000000000000000000000000000000000000000000000000fa4c010000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000094540100000000000000000000000000000000000000000000000000000000000000008657010000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000002a9a1beb8e104973604000086022a00b2003f00630054003b00006401000006b6adb649b3b70a0a0af551010000000000000000000000000000000000000000000000000000000000000000594d010000000000000000000000000000000000000000000000000000010000000000fa3a0100000000000000000000000000000000000000000000000000000100000000009454010000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000351a0853b50004a950200003c017a0010002b0042002b001c000064011b0006bdb2a4e5ae56010101314e0100000000000000000000000000000000000000000000000000000000000000005b4d010000000000000000000000000000000000000000000000000000000000000000fc3a0100000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000d7590100000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000";
const frame = (cmd: number, sub: number, payloadHex: string) => encodeFrame(Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(payloadHex, "hex")]));

function session() {
  const state: Record<string, any> = {};
  const gameLogs: string[] = [];
  const sent: Buffer[] = [];
  const s = tsOnlineCodec.create({
    log() {},
    game(m: string) { gameLogs.push(m); },
    send(buf: Buffer) { sent.push(buf); },
    patchState: (p: Record<string, any>) => { Object.assign(state, p); },
  } as never);
  return { s, state, gameLogs, sent };
}

describe("Võ tướng xuất chiến (0f/08 + 13/04)", () => {
  it("hiển thị pet theo 13/04, không phải bản ghi đầu tiên", () => {
    const { s, state } = session();
    s.onData(frame(0x0f, 0x08, PETS_0F08));
    s.onData(frame(0x13, 0x04, "00a9a1"));
    expect(state.pet).toMatchObject({ name: expect.stringContaining("Nhạn"), level: 151, element: "wind" });
  });

  it("13/04 đến trước 0f/08 vẫn chọn đúng", () => {
    const { s, state } = session();
    s.onData(frame(0x13, 0x04, "00a9a1"));
    s.onData(frame(0x0f, 0x08, PETS_0F08));
    expect(state.pet?.level).toBe(151);
  });

  it("exp của pet đang nghỉ (08/02 idx 1) không ghi đè thẻ pet xuất chiến", () => {
    const { s, state } = session();
    s.onData(frame(0x0f, 0x08, PETS_0F08));
    s.onData(frame(0x13, 0x04, "00a9a1"));
    const before = state.pet;
    s.onData(frame(0x08, 0x02, "0004010024010 7ca9100000000000".replace(/ /g, "")));
    expect(state.pet).toBe(before);
  });

  it("HP/SP của pet đang nghỉ (08/02 idx 1) không ghi đè pet xuất chiến (idx 2)", () => {
    const { s, state } = session();
    s.onData(frame(0x0f, 0x08, PETS_0F08));
    s.onData(frame(0x13, 0x04, "00a9a1")); // active pet là con thứ 2
    const petHpBefore = state.pet.hp.cur;
    const petSpBefore = state.pet.sp.cur;

    // Gửi cập nhật HP (prop 0x0119) = 50 cho pet idx 1 (pet đang nghỉ)
    s.onData(frame(0x08, 0x02, "0004010019013200000000000000"));
    expect(state.pet.hp.cur).toBe(petHpBefore);

    // Gửi cập nhật SP (prop 0x011a) = 30 cho pet idx 1 (pet đang nghỉ)
    s.onData(frame(0x08, 0x02, "000401001a011e00000000000000"));
    expect(state.pet.sp.cur).toBe(petSpBefore);
  });


  it("tính chính xác Max HP & Max SP cho Ma Quan Vũ (1470 HP / 588 SP)", () => {
    const { s, state } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    expect(state.pet).toBeDefined();
    expect(state.pet.name).toBe("Ma Quan Vũ");
    expect(state.pet.level).toBe(96);
    // Ma Quan Vũ: Level 96, HP stat 85 -> 96 * 10 + 85 * 6 = 1470
    expect(state.pet.hp).toEqual({ cur: 1456, max: 1470 });
    // SP stat 60 -> 96 * 3 + 60 * 5 = 588
    expect(state.pet.sp).toEqual({ cur: 510, max: 588 });
  });

  it("đồng bộ thời gian thực HP & SP giữa trận đấu và tab thông tin chung", () => {
    const { s, state } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));

    // Bắt đầu trận đấu
    s.onData(frame(0x14, 0x0c, ""));
    expect(state.inBattle).toBe(true);

    // Spawn Pet: row@f[29], col@f[30], maxHp@f[31], maxSp@f[35], curHp@f[39], curSp@f[43], level@f[47]
    // Vì frame(cmd, sub, payload) đặt payload tại f[8..], index trong payload = index_in_f - 8
    const petSpawnPayload = Buffer.alloc(45);
    petSpawnPayload.writeUInt16LE(45437, 11 - 8); // model MQV
    petSpawnPayload[29 - 8] = 2; // row 2
    petSpawnPayload[30 - 8] = 2; // col 2
    petSpawnPayload.writeUInt32LE(1470, 31 - 8); // maxHp
    petSpawnPayload.writeUInt32LE(588, 35 - 8); // maxSp
    petSpawnPayload.writeUInt32LE(1359, 39 - 8); // curHp
    petSpawnPayload.writeUInt32LE(510, 43 - 8); // curSp
    petSpawnPayload[47 - 8] = 96; // level
    s.onData(frame(0x0b, 0x05, petSpawnPayload.toString("hex")));

    expect(state.pet.hp).toEqual({ cur: 1359, max: 1470 });
    expect(state.pet.sp).toEqual({ cur: 510, max: 588 });

    // Pet mất máu trong hiệp (gói 33/01, o=10 trong f => payload index = 10-8 = 2)
    const statusPayload = Buffer.alloc(16);
    statusPayload[2] = 2; statusPayload[3] = 2; statusPayload[4] = 0x19; statusPayload.writeUInt32LE(1000, 5);
    statusPayload[9] = 2; statusPayload[10] = 2; statusPayload[11] = 0x1a; statusPayload.writeUInt32LE(450, 12);
    s.onData(frame(0x33, 0x01, statusPayload.toString("hex")));

    expect(state.pet.hp.cur).toBe(1000);
    expect(state.pet.hp.max).toBe(1470);
    expect(state.pet.sp.cur).toBe(450);
    expect(state.pet.sp.max).toBe(588);
  });

  it("gói 32/01 hiển thị sát thương chi tiết, trừ HP và nhận diện Miss", () => {
    const { s, state, gameLogs } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));

    // Bắt đầu trận đấu
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn quái tại (0, 4) HP: 181/181
    const enemyPayload = Buffer.alloc(45);
    enemyPayload.writeUInt16LE(10201, 11 - 8); // model quái Loạn Dân
    enemyPayload[29 - 8] = 0; // row 0
    enemyPayload[30 - 8] = 4; // col 4
    enemyPayload.writeUInt32LE(181, 31 - 8); // curHp
    enemyPayload.writeUInt32LE(134, 35 - 8); // curSp
    enemyPayload.writeUInt32LE(181, 39 - 8); // maxHp
    enemyPayload.writeUInt32LE(134, 43 - 8); // maxSp
    enemyPayload[47 - 8] = 30; // level
    s.onData(frame(0x0b, 0x05, enemyPayload.toString("hex")));

    // Giả lập gói 32/01: Ma Quan Vũ (2,2) dùng Đấu Vật (10000) gây 100 sát thương vào (0,4)
    // Frame 32/01: f[11]=actorRow, f[12]=actorCol, f[13..14]=skillId, f[17]=targetRow, f[18]=targetCol, f[19]=isHit, f[22]=statType, f[23..26]=damage
    const strikePayload = Buffer.alloc(20);
    // index in f = index in payload + 8
    strikePayload[11 - 8] = 2; // actorRow (Pet)
    strikePayload[12 - 8] = 2; // actorCol
    strikePayload.writeUInt16LE(10000, 13 - 8); // Đấu Vật
    strikePayload[17 - 8] = 0; // targetRow
    strikePayload[18 - 8] = 4; // targetCol
    strikePayload[19 - 8] = 1; // isHit = true
    strikePayload[22 - 8] = 0x19; // statType = HP
    strikePayload.writeUInt32LE(100, 23 - 8); // damage = 100
    s.onData(frame(0x32, 0x01, strikePayload.toString("hex")));

    // Đòn đánh đơn sẽ được flush sau combo timeout (80ms) hoặc khi gọi battleTurn/battleEnd
    s.onData(frame(0x34, 0x01, "")); // Turn mới flush pending

    const lastLog = gameLogs.at(-1);
    expect(lastLog).toContain("Ma Quan Vũ (2,2) dùng [Đấu Vật] - 100 HP");
    expect(lastLog).toContain("còn lại 81/181 HP");

    // Giả lập quái (0,4) đánh lại Miss
    const missPayload = Buffer.alloc(20);
    missPayload[11 - 8] = 0; // actorRow
    missPayload[12 - 8] = 4; // actorCol
    missPayload.writeUInt16LE(10000, 13 - 8);
    missPayload[17 - 8] = 2; // targetRow (Pet)
    missPayload[18 - 8] = 2; // targetCol
    missPayload[19 - 8] = 0; // isHit = false (Miss)
    missPayload[22 - 8] = 0; // statType = 0
    missPayload.writeUInt32LE(0, 23 - 8); // damage = 0
    s.onData(frame(0x32, 0x01, missPayload.toString("hex")));

    const missLog = gameLogs.at(-1);
    expect(missLog).toContain("Miss");
    expect(missLog).toContain("Ma Quan Vũ");
  });

  it("nhận diện Combo (2) khi cả Char và Pet cùng tấn công vào một mục tiêu", () => {
    const { s, gameLogs } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn quái tại (0, 2) HP: 300/300
    const enemyPayload = Buffer.alloc(45);
    enemyPayload.writeUInt16LE(10201, 11 - 8);
    enemyPayload[29 - 8] = 0; enemyPayload[30 - 8] = 2;
    enemyPayload.writeUInt32LE(300, 31 - 8);
    enemyPayload.writeUInt32LE(100, 35 - 8);
    enemyPayload.writeUInt32LE(300, 39 - 8);
    enemyPayload.writeUInt32LE(100, 43 - 8);
    enemyPayload[47 - 8] = 30;
    s.onData(frame(0x0b, 0x05, enemyPayload.toString("hex")));

    // Đòn 1: Char (3,2) đánh (0,2) gây 120 damage
    const charStrike = Buffer.alloc(20);
    charStrike[11 - 8] = 3; charStrike[12 - 8] = 2;
    charStrike.writeUInt16LE(10000, 13 - 8);
    charStrike[17 - 8] = 0; charStrike[18 - 8] = 2;
    charStrike[19 - 8] = 1; charStrike[22 - 8] = 0x19;
    charStrike.writeUInt32LE(120, 23 - 8);
    s.onData(frame(0x32, 0x01, charStrike.toString("hex")));

    // Đòn 2: Pet (2,2) đánh cùng (0,2) gây 180 damage (Lasthit quái chết)
    const petStrike = Buffer.alloc(20);
    petStrike[11 - 8] = 2; petStrike[12 - 8] = 2;
    petStrike.writeUInt16LE(10000, 13 - 8);
    petStrike[17 - 8] = 0; petStrike[18 - 8] = 2;
    petStrike[19 - 8] = 1; petStrike[22 - 8] = 0x19;
    petStrike.writeUInt32LE(180, 23 - 8);
    s.onData(frame(0x32, 0x01, petStrike.toString("hex")));

    // Flush combo
    s.onData(frame(0x34, 0x01, ""));

    const comboLog = gameLogs.find((l) => l.includes("⚡ Combo (2):"));
    expect(comboLog).toBeDefined();
    expect(comboLog).toContain("---- Nhân vật (3,2) dùng [Đấu Vật] - 120 HP");
    expect(comboLog).toContain("---- Ma Quan Vũ (2,2) dùng [Đấu Vật] - 180 HP");
    expect(comboLog).toContain("còn lại 0/300 HP (Gục ngã)");
  });

  it("nhận diện Combo (4) đầy đủ tất cả thành viên khi server đóng gói nhiều action block trong 1 frame 32/01", () => {
    const { s, gameLogs } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn quái Loạn Dân tại (0, 2) HP: 181/181 (model 10201)
    const enemyPayload = Buffer.alloc(45);
    enemyPayload.writeUInt16LE(10201, 11 - 8);
    enemyPayload[29 - 8] = 0; enemyPayload[30 - 8] = 2;
    enemyPayload.writeUInt32LE(181, 31 - 8);
    enemyPayload.writeUInt32LE(100, 35 - 8);
    enemyPayload.writeUInt32LE(181, 39 - 8);
    enemyPayload.writeUInt32LE(100, 43 - 8);
    enemyPayload[47 - 8] = 30;
    s.onData(frame(0x0b, 0x05, enemyPayload.toString("hex")));

    // Spawn 3 võ tướng Ma Quan Vũ (model 45437) của đồng đội tại (2,4), (2,1), (2,0)
    for (const [r, c] of [[2, 4], [2, 1], [2, 0]]) {
      const petPayload = Buffer.alloc(48);
      petPayload.writeUInt16LE(45437, 11 - 8); // model Ma Quan Vũ
      petPayload[10 - 8] = 0x04; // kind = pet
      petPayload[29 - 8] = r;
      petPayload[30 - 8] = c;
      petPayload.writeUInt32LE(1470, 31 - 8);
      petPayload.writeUInt32LE(588, 35 - 8);
      petPayload.writeUInt32LE(1470, 39 - 8);
      petPayload.writeUInt32LE(588, 43 - 8);
      petPayload[47 - 8] = 96;
      s.onData(frame(0x0b, 0x05, petPayload.toString("hex")));
    }

    // Giả lập frame 32/01 từ pcap phó bản: 4 pet combo vào vị trí (0, 2)
    // Block 1: pet (2,4) dùng Đấu Vật (10000) vào (0,2) gây 433 HP (0x01b1)
    // Block 2: pet (2,2) dùng Đấu Vật (10000) vào (0,2) gây 688 HP (0x02b0)
    // Block 3: pet (2,1) dùng Đấu Vật (10000) vào (0,2) gây 431 HP (0x01af)
    // Block 4: pet (2,0) dùng Đấu Vật (10000) vào (0,2) gây 446 HP (0x01be)
    const combo4Hex = "00" +
      "1100020410270101000201000119b101000001" +
      "1100020210270101000201000119b002000001" +
      "1100020110270101000201000119af01000001" +
      "1100020010270101000201000119be01000001";
    s.onData(frame(0x32, 0x01, combo4Hex));

    // Flush pending strikes
    s.onData(frame(0x34, 0x01, ""));

    const comboLog = gameLogs.find((l) => l.includes("⚡ Combo (4):"));
    expect(comboLog).toBeDefined();
    expect(comboLog).toContain("---- Ma Quan Vũ (2,4) dùng [Đấu Vật] - 433 HP");
    expect(comboLog).toContain("---- Ma Quan Vũ (2,2) dùng [Đấu Vật] - 688 HP");
    expect(comboLog).toContain("---- Ma Quan Vũ (2,1) dùng [Đấu Vật] - 431 HP");
    expect(comboLog).toContain("---- Ma Quan Vũ (2,0) dùng [Đấu Vật] - 446 HP");
    expect(comboLog).toContain("còn lại 0/181 HP (Gục ngã)");
  });

  it("cơ chế F1 thông minh: chọn mục tiêu (0, 3) khi quái đứng ở (0, 2), (0, 3), (0, 4) để kỹ năng lan quét trúng cả 3", () => {
    const { s, sent } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn 3 quái tại (0, 2), (0, 3), (0, 4)
    for (const c of [2, 3, 4]) {
      const p = Buffer.alloc(45);
      p.writeUInt16LE(10201, 11 - 8);
      p[29 - 8] = 0; p[30 - 8] = c;
      p.writeUInt32LE(181, 31 - 8);
      p.writeUInt32LE(100, 35 - 8);
      p.writeUInt32LE(181, 39 - 8);
      p.writeUInt32LE(100, 43 - 8);
      p[47 - 8] = 30;
      s.onData(frame(0x0b, 0x05, p.toString("hex")));
    }

    // Cài đặt F1 và đến lượt đánh 34/01
    s.encodeAction("set_battle_config", ["10000", "13013", "1", "F1", "F1"]);
    s.onData(frame(0x34, 0x01, "00"));

    expect(sent.length).toBe(2);
    // Gói của Char và Pet đều phải target vào (0, 3) là tâm cụm 3 quái (0, 2), (0, 3), (0, 4)
    // Frame của Char (sent[0]): target row=0, col=3 tại offset 11, 12 (đã XOR 0xad)
    const charTargetCol = sent[0]![12] ^ 0xad;
    expect(charTargetCol).toBe(3);
    // Frame của Pet (sent[1]): target row=0, col=3 tại offset 11, 12 (đã XOR 0xad)
    const petTargetCol = sent[1]![12] ^ 0xad;
    expect(petTargetCol).toBe(3);
  });

  it("gói 32/01 ghi nhận đầy đủ tất cả mục tiêu khi dùng kỹ năng AOE (Loạn Kích 13013)", () => {
    const { s, gameLogs } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn 3 quái tại (0, 2), (0, 3), (0, 4)
    for (const c of [2, 3, 4]) {
      const p = Buffer.alloc(45);
      p.writeUInt16LE(10201, 11 - 8);
      p[29 - 8] = 0; p[30 - 8] = c;
      p.writeUInt32LE(181, 31 - 8);
      p.writeUInt32LE(100, 35 - 8);
      p.writeUInt32LE(181, 39 - 8);
      p.writeUInt32LE(100, 43 - 8);
      p[47 - 8] = 30;
      s.onData(frame(0x0b, 0x05, p.toString("hex")));
    }

    // Giả lập gói 32/01: Nhạn Điêu Tuyết (2, 2) dùng Loạn Kích (13013 = 0x32d5 = d5 32)
    // Quét 3 mục tiêu: (0, 2) - 390 HP, (0, 3) - 390 HP, (0, 4) - 390 HP
    // subLen = 6 + 3 * 11 = 39 (0x0027 = 27 00)
    // Header 6 byte: actorRow=02, actorCol=02, skill=d532, targetCount=0301
    // Target 1: 00 02 01 00 01 19 86 01 00 00 01 (targetRow=0, col=2, isHit=1, dmg=390)
    // Target 2: 00 03 01 00 01 19 86 01 00 00 01 (targetRow=0, col=3, isHit=1, dmg=390)
    // Target 3: 00 04 01 00 01 19 86 01 00 00 01 (targetRow=0, col=4, isHit=1, dmg=390)
    const aoeHex = "00" +
      "2700" +
      "0202d5320301" +
      "0002010001198601000001" +
      "0003010001198601000001" +
      "0004010001198601000001";
    s.onData(frame(0x32, 0x01, aoeHex));

    // Flush
    s.onData(frame(0x34, 0x01, "00"));

    const target02Log = gameLogs.find((l) => l.includes("(0,2)") && l.includes("Loạn Kích") && l.includes("Gục ngã"));
    const target03Log = gameLogs.find((l) => l.includes("(0,3)") && l.includes("Loạn Kích") && l.includes("Gục ngã"));
    const target04Log = gameLogs.find((l) => l.includes("(0,4)") && l.includes("Loạn Kích") && l.includes("Gục ngã"));

    expect(target02Log).toBeDefined();
    expect(target03Log).toBeDefined();
    expect(target04Log).toBeDefined();
  });

  it("tự động chuyển sang Đấu Vật khi cấu hình skill pet không có trong danh sách kỹ năng", () => {
    const { s, sent, gameLogs } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn quái
    const p = Buffer.alloc(45);
    p.writeUInt16LE(10201, 11 - 8);
    p[29 - 8] = 0; p[30 - 8] = 3;
    p.writeUInt32LE(1000, 31 - 8);
    s.onData(frame(0x0b, 0x05, p.toString("hex")));

    // Giả lập danh sách petSkills của pet hiện tại chỉ có 10000, 11005 (không có 13013 Loạn Kích)
    const skillListHex = "0002" + "1027" + "6d2a"; // 10000, 10861
    s.onData(frame(0x35, 0x01, skillListHex));

    // Cài đặt pet dùng Loạn Kích (13013) mà pet không có
    s.encodeAction("set_battle_config", ["10000", "13013", "1", "F1", "F1"]);
    s.onData(frame(0x34, 0x01, "00"));

    expect(sent.length).toBe(2);
    // Pet frame (sent[1]): skillId tại offset 13, 14 (đã XOR 0xad)
    const petSkillId = (sent[1]![13] ^ 0xad) | ((sent[1]![14] ^ 0xad) << 8);
    expect(petSkillId).toBe(10000); // Đã fallback về Đấu Vật 10000

    const warnLog = gameLogs.find((l) => l.includes("không có kỹ năng") && l.includes("chuyển sang [Đấu Vật]"));
    expect(warnLog).toBeDefined();
  });

  it("gom Combo đầy đủ khi đòn hợp kích bao gồm cả kỹ năng đơn và kỹ năng AOE (không bị xé nhỏ log)", () => {
    const { s, gameLogs } = session();
    s.onData(frame(0x0f, 0x08, fx.mqv_0f08));
    s.onData(frame(0x13, 0x04, fx.mqv_1304));
    s.onData(frame(0x14, 0x0c, ""));

    // Spawn quái tại (0, 2), (0, 3), (0, 4)
    for (const c of [2, 3, 4]) {
      const p = Buffer.alloc(45);
      p.writeUInt16LE(10201, 11 - 8);
      p[29 - 8] = 0; p[30 - 8] = c;
      p.writeUInt32LE(1178, 31 - 8);
      p.writeUInt32LE(100, 35 - 8);
      p.writeUInt32LE(1178, 39 - 8);
      p.writeUInt32LE(100, 43 - 8);
      p[47 - 8] = 30;
      s.onData(frame(0x0b, 0x05, p.toString("hex")));
    }

    // Giả lập 2 unit combo vào (0, 3):
    // Unit 1: Lữ Bố (2,3) dùng Đấu Vật (10000) vào (0,3) gây 529 HP
    // Unit 2: _XuanWu_ (3,4) dùng Hỏa Tiễn (12003 = 0x2ee3 = e3 2e) 3 targets -> subLen = 6 + 33 = 39 = 0x2700
    const comboPayload = "00" +
      // Block 1: Lữ Bố (2,3) Đấu Vật 1 target (0,3) -> subLen = 17 = 0x1100
      "11000203102701010003010001191102000001" +
      // Block 2: _XuanWu_ (3,4) Hỏa Tiễn (12003 = 0x2ee3 = e3 2e) 3 targets -> subLen = 6 + 33 = 39 = 0x2700
      "2700" +
      "0304e32e0301" +
      "000301000119e500000001" +
      "000201000119e700000001" +
      "000401000119e600000001";

    s.onData(frame(0x32, 0x01, comboPayload));
    s.onData(frame(0x34, 0x01, "00"));

    // Kiểm tra combo log hiển thị Combo (2) cho 2 unique actors thay vì bị ngắt đôi
    const comboLog = gameLogs.find((l) => l.includes("⚡ Combo (2):"));
    expect(comboLog).toBeDefined();
    expect(comboLog).toContain("---- Võ tướng (2,3) dùng [Đấu Vật] - 529 HP");
    expect(comboLog).toContain("---- Đồng đội (3,4) dùng [Hỏa Tiễn] - 229 HP");

    // Và vẫn có log sát thương lan cho (0,2) và (0,4)
    const splash02 = gameLogs.find((l) => l.includes("(0,2)") && l.includes("Hỏa Tiễn"));
    const splash04 = gameLogs.find((l) => l.includes("(0,4)") && l.includes("Hỏa Tiễn"));
    expect(splash02).toBeDefined();
    expect(splash04).toBeDefined();
  });

  it("Triệu Vân (12027) hiển thị đủ 5 skill: 3 gốc, 1 Mê (Hồi Mã Thương), 1 VKCD (Long Đảm Thương -> S.ChấnĐiện)", () => {
    const { s, state } = session();
    const buf = Buffer.alloc(300);
    buf[1] = 1; // count = 1
    buf[2] = 1; // idx = 1
    buf.writeUInt16LE(12027, 3); // model = 12027
    buf.writeUInt32LE(1000, 5); // exp
    buf[9] = 100; // level = 100
    buf.writeUInt32LE(1000, 10); // hp
    buf.writeUInt16LE(500, 14); // sp
    buf[29] = 100; // fai
    buf[31] = 0; // isAwakened = false
    buf[33] = 8; // nameLen = 8
    buf.write("Triệu Vân", 34);

    const payload = buf.subarray(0, 2 + 254 + 8).toString("hex");
    s.onData(frame(0x0f, 0x08, payload));
    s.onData(frame(0x13, 0x04, "00fb2e")); // 12027

    expect(state.petSkills).toHaveLength(5);
    // 3 skill gốc: Bão Phong (13006), Phong Cuốn Tàn Vân (13009), Loạn Kích (13013)
    const baseSkills = state.petSkills.filter((sk: any) => sk.type === "base");
    expect(baseSkills).toHaveLength(3);
    expect(baseSkills.every((sk: any) => sk.enabled === true)).toBe(true);

    // 1 skill Mê: Hồi Mã Thương (21012), chưa học -> enabled = false
    const awakened = state.petSkills.find((sk: any) => sk.type === "awakened");
    expect(awakened).toBeDefined();
    expect(awakened.id).toBe(21012);
    expect(awakened.name).toBe("Hồi Mã Thương");
    expect(awakened.enabled).toBe(false);
    expect(awakened.disabledReason).toBe("Chưa học Mê");

    // 1 skill VKCD: S.ChấnĐiện (13043), chưa trang bị -> enabled = false
    const vkcd = state.petSkills.find((sk: any) => sk.type === "exclusive_weapon");
    expect(vkcd).toBeDefined();
    expect(vkcd.id).toBe(13043);
    expect(vkcd.name).toBe("S.ChấnĐiện");
    expect(vkcd.enabled).toBe(false);
    expect(vkcd.disabledReason).toContain("Long Đảm Thương");
  });

  it("Triệu Vân khi trang bị Long Đảm Thương (item 64515) thì skill VKCD (S.ChấnĐiện) chuyển sang enabled: true", () => {
    const { s, state } = session();
    const buf = Buffer.alloc(300);
    buf[1] = 1;
    buf[2] = 1;
    buf.writeUInt16LE(12027, 3);
    buf.writeUInt32LE(1000, 5);
    buf[9] = 100;
    buf.writeUInt32LE(1000, 10);
    buf.writeUInt16LE(500, 14);
    buf[33] = 8;
    buf.write("Triệu Vân", 34);

    // Trang bị VKCD Long Đảm Thương tại slot vũ khí (pos = 2, eqStart = 2 + 32 + 8 = 42, slot 2: 42 + 3 + 2 * 35 = 115)
    buf.writeUInt16LE(64515, 115);

    const payload = buf.subarray(0, 2 + 254 + 8).toString("hex");
    s.onData(frame(0x0f, 0x08, payload));
    s.onData(frame(0x13, 0x04, "00fb2e"));

    const vkcd = state.petSkills.find((sk: any) => sk.type === "exclusive_weapon");
    expect(vkcd).toBeDefined();
    expect(vkcd.enabled).toBe(true);
    expect(vkcd.disabledReason).toBeUndefined();
  });
});
