import { describe, expect, it } from "vitest";
import fx from "./fixtures/party-cap.json";
import { encodeFrame, tsOnlineCodec } from "../src/transport/socket/codecs/tsOnline";
import { PartyTracker, partyPayload } from "../src/transport/socket/codecs/party";
import { buildSteps } from "../src/runtime/liveActions";
import type { PartyState } from "@tsbot/protocol";

/** Dựng frame S→C từ payload `f[8..]` lấy trực tiếp từ pcap (payload luôn bắt đầu 00). */
const frame = (cmd: number, sub: number, payloadHex: string) => encodeFrame(Buffer.concat([Buffer.from([0, 0, cmd, sub]), Buffer.from(payloadHex, "hex")]));

function mk(selfUid = fx.own_uid) {
  const sent: Buffer[] = [];
  const logs: string[] = [];
  let party: PartyState | undefined;
  const s = tsOnlineCodec.create({
    log: (_l: string, m: string) => logs.push(m), game: (m: string) => logs.push(m),
    send: (b: Buffer) => sent.push(b),
    patchState: (p: { party?: PartyState }) => { if (p.party) party = p.party; },
  } as never);
  const any = s as unknown as { uid: Buffer; location: { map: number; x: number; y: number; channel: number } };
  any.uid = Buffer.from(selfUid, "hex");
  any.location = { map: 12003, x: 502, y: 495, channel: 0 };
  return { s, sent, logs, party: () => party! };
}

describe("Đội ngũ — giải mã gói 0d/xx từ pcap thật", () => {
  it("0d/06 + 03/00 + 0d/0b (Check_status_team_pet): đội 5 người, chủ BaiFern10, tên lấy từ spawn", () => {
    const { s, party } = mk();
    for (const p of fx.own_party_spawns) s.onData(frame(0x03, 0x00, p));
    s.onData(frame(0x0d, 0x06, fx.own_party_roster));
    s.onData(frame(0x0d, 0x0b, fx.own_party_advisor));
    const st = party();
    expect(st.joined).toBe(true);
    expect(st.leaderName).toBe("BaiFern10");
    expect(st.members.map((m) => m.name)).toEqual(["BaiFern10", "jisu", "BaiFine", "BentleySE", "BaiFern12"]);
    expect(st.members[0]!.isLeader).toBe(true);
    expect(st.members.find((m) => m.isSelf)!.name).toBe("BentleySE");
    // 0d/0b = uid Quân sư (suy luận): ở capture này là chính BentleySE
    expect(st.members.find((m) => m.isAdvisor)!.name).toBe("BentleySE");
  });

  it("0d/06 nhiều đội trong 1 map (Online Reward): 3 đội × (chủ + 4)", () => {
    const t = new PartyTracker();
    const n = t.parseRoster(Buffer.concat([Buffer.alloc(8), Buffer.from(fx.maps_roster, "hex")]));
    expect(n).toBe(3);
    expect([...t.parties.values()].map((m) => m.length)).toEqual([4, 4, 4]);
    t.parseAdvisors(Buffer.concat([Buffer.alloc(8), Buffer.from(fx.maps_advisors, "hex")]));
    expect(t.advisors.size).toBe(3); // mỗi đội 1 QSư
  });

  it("0d/05 (Oct 23): 4 gói liền nhau gom thành đội chủ 9a1a + 4 thành viên", () => {
    const t = new PartyTracker();
    for (const p of fx.joined) t.parseJoined(Buffer.concat([Buffer.alloc(8), Buffer.from(p, "hex")]));
    const leader = "9a1a67d3aca80a00";
    expect(t.parties.get(leader)!.length).toBe(4);
    expect(t.leaderOf("fa1767d3aca80a00")).toBe(leader);
  });
});

describe("Đội ngũ — pcap thanhvien_accept_invite_", () => {
  it("nhận 0d/09 rồi tự đồng ý bằng đúng gói pcap `0d/08 00 01 <uid người mời>`; 0d/05 đáp lại đưa vào đội", async () => {
    const SELF = "b4de67d3aca80a00", LEADER = "8ede67d3aca80a00";
    const { s, sent, party } = mk(SELF);
    // dựng spawn 03/00 của chủ PT có tên "Chu" (uid@9, map@28, tên [len]@53)
    const sp = Buffer.alloc(54 + 3); sp.write("00" , 8, "hex"); Buffer.from(LEADER, "hex").copy(sp, 9); sp.writeUInt16LE(12003, 28); sp[53] = 3; sp.write("Chu", 54, "latin1");
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x03, 0x00]), sp.subarray(8)])));
    await s.executeAction!("set_party_config", ["Chu", "[]"], () => {}, new AbortController().signal);
    s.onData(frame(0x0d, 0x09, "00" + LEADER)); // pcap: 00 8e de 67 d3 ac a8 0a 00
    expect(sent).toHaveLength(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00000d08" + "00" + "01" + LEADER, "hex")).toString("hex")); // pcap: 00 01 8e de 67 d3 ac a8 0a 00
    s.onData(frame(0x0d, 0x05, "00" + LEADER + SELF)); // pcap: 0d/05 00 <leader> <self>
    expect(party().joined).toBe(true);
    expect(party().leaderName).toBe("Chu");
  });
});

/** Spawn 03/00 tối thiểu có tên: uid@9, map@28, [len]@53 tên. */
const spawn = (uid: string, name: string, map = 21261) => {
  const f = Buffer.alloc(54 + name.length);
  Buffer.from(uid, "hex").copy(f, 9); f.writeUInt16LE(map, 28); f[53] = name.length; f.write(name, 54, "latin1");
  return encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x03, 0x00]), f.subarray(8)]));
};

describe("Đội ngũ — pcap chupt_accept_request_assign_qsu_giai_tan_team (chủ PT)", () => {
  const L = "8ede67d3aca80a00", M2 = "b3de67d3aca80a00", M3 = "b4de67d3aca80a00";
  const hexFrame = (cmd: number, sub: number, payload: string) => encodeFrame(Buffer.from(`0000${cmd.toString(16).padStart(2, "0")}${sub.toString(16).padStart(2, "0")}${payload}`, "hex"));

  it("đồng ý lời xin → gán QSư → giải tán: đúng từng gói trong pcap", async () => {
    const { s, sent, party } = mk(L);
    (s as unknown as { location: { map: number } }).location = { map: 21261, x: 0, y: 0, channel: 0 } as never;
    s.onData(spawn(L, "Teemo_01")); s.onData(spawn(M2, "Teemo_02")); s.onData(spawn(M3, "Teemo_03"));
    await s.executeAction!("set_party_config", ["", JSON.stringify(["Teemo_02", "Teemo_03"])], () => {}, new AbortController().signal);

    // pcap t=22.1/25.1: S→C 0d/01 (xin) → t=30.75 C→S 0d/03 `00 01 <uid>` → S→C 0d/05
    s.onData(hexFrame(0x0d, 0x01, "00" + M3));
    expect(sent.at(-1)!.toString("hex")).toBe(hexFrame(0x0d, 0x03, "0001" + M3).toString("hex"));
    s.onData(hexFrame(0x0d, 0x05, "00" + L + M3));
    s.onData(hexFrame(0x0d, 0x01, "00" + M2));
    expect(sent.at(-1)!.toString("hex")).toBe(hexFrame(0x0d, 0x03, "0001" + M2).toString("hex"));
    s.onData(hexFrame(0x0d, 0x05, "00" + L + M2));
    expect(party().joined).toBe(true);
    expect(party().members.filter((m) => m.name).map((m) => m.name)).toEqual(["Teemo_01", "Teemo_03", "Teemo_02"]);

    // gán QSư: C→S 0d/05 `00 <uid>` (t=47.49) → S→C 0d/07 + 0d/0b
    const r = await s.executeAction!("party_set_advisor", ["Teemo_02"], () => {}, new AbortController().signal);
    expect(r).toEqual({ ok: true });
    expect(sent.at(-1)!.toString("hex")).toBe(hexFrame(0x0d, 0x05, "00" + M2).toString("hex"));
    s.onData(hexFrame(0x0d, 0x07, "00" + M2));
    s.onData(hexFrame(0x0d, 0x0b, "00" + M2));
    expect(party().members.find((m) => m.isAdvisor)!.name).toBe("Teemo_02");

    // giải tán: C→S 0d/04 `00 <uid mình>` (t=55.48) → S→C 0d/08, 0d/0c, 0d/04 ×3 (uid + x,y)
    const g = await s.executeAction!("leave_party", [], () => {}, new AbortController().signal);
    expect(g).toEqual({ ok: true });
    expect(sent.at(-1)!.toString("hex")).toBe(hexFrame(0x0d, 0x04, "00" + L).toString("hex"));
    s.onData(hexFrame(0x0d, 0x08, "00" + M2)); s.onData(hexFrame(0x0d, 0x0c, "00" + M2));
    for (const u of [M2, M3, L]) s.onData(hexFrame(0x0d, 0x04, "00" + u + "76023601"));
    expect(party().joined).toBe(false);
    expect(party().members.every((m) => !m.name)).toBe(true);
  });

  it("chỉ chủ PT mới gán được QSư; không gán cho chính mình", async () => {
    const { s } = mk(M2);
    s.onData(spawn(L, "Teemo_01")); s.onData(spawn(M2, "Teemo_02"));
    s.onData(hexFrame(0x0d, 0x05, "00" + L + M2));
    const r = await s.executeAction!("party_set_advisor", ["Teemo_02"], () => {}, new AbortController().signal);
    expect(r!.ok).toBe(false);
    expect(r!.message).toMatch(/chủ PT/);
  });
});

describe("Đội ngũ — sau teleport (log thật 10:49:32)", () => {
  it("người từng cùng đội không có 03/00 mới ⇒ cập nhật map từ 0c/00 để vẫn mời lại được", async () => {
    const L = "8ede67d3aca80a00", M2 = "b3de67d3aca80a00";
    const { s, sent } = mk(L);
    (s as unknown as { location: { map: number } }).location = { map: 12001, x: 0, y: 0, channel: 0 } as never;
    s.onData(spawn(M2, "Teemo_02", 12001));
    // cả hai teleport sang 12061: chủ PT đổi map, member chỉ báo qua 0c/00 `uid map x y` (pcap/log: e12e→0x2ee1 là 12001; 12061 = 0x2f1d)
    (s as unknown as { location: { map: number } }).location = { map: 12061, x: 0, y: 0, channel: 0 } as never;
    let r = await s.executeAction!("party_invite", ["Teemo_02"], () => {}, new AbortController().signal);
    expect(r!.ok).toBe(false); // chưa có tin gì về map mới của member
    s.onData(encodeFrame(Buffer.concat([Buffer.from([0, 0, 0x0c, 0x00]), Buffer.from("00" + M2 + "1d2f" + "3601" + "fa05" + "0000", "hex")])));
    r = await s.executeAction!("party_invite", ["Teemo_02"], () => {}, new AbortController().signal);
    expect(r).toEqual({ ok: true });
    expect(sent.at(-1)!.toString("hex")).toBe(encodeFrame(Buffer.from("00000d07" + "00" + M2, "hex")).toString("hex"));
  });
});

describe("Đội ngũ — force theo uid đã biết", () => {
  it("không có gói báo map mới: mặc định báo lỗi, force=\"force\" mời bằng uid đã biết", async () => {
    const M3 = "b4de67d3aca80a00";
    const { s, sent } = mk("8ede67d3aca80a00");
    (s as unknown as { location: { map: number } }).location = { map: 12001, x: 0, y: 0, channel: 0 } as never;
    s.onData(spawn(M3, "Teemo_03", 21261)); // spawn ở map cũ
    (s as unknown as { location: { map: number } }).location = { map: 12061, x: 0, y: 0, channel: 0 } as never;
    expect((await s.executeAction!("party_invite", ["Teemo_03"], () => {}, new AbortController().signal))!.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(await s.executeAction!("party_invite", ["Teemo_03", "force"], () => {}, new AbortController().signal)).toEqual({ ok: true });
    expect(sent.at(-1)!.toString("hex")).toBe(encodeFrame(Buffer.from("00000d07" + "00" + M3, "hex")).toString("hex"));
    expect((await s.executeAction!("party_invite", ["NguoiLa", "force"], () => {}, new AbortController().signal))!.ok).toBe(false); // chưa từng thấy ⇒ vẫn lỗi
  });
});

describe("Đội ngũ — vào Dị giới khi đang trong đội", () => {
  it("đang trong đội ⇒ dijie_open báo lỗi, KHÔNG gửi 61/01; rời đội xong thì vào được", () => {
    const L = "8ede67d3aca80a00", M = "b3de67d3aca80a00";
    const { s, logs } = mk(M); // thành viên (chủ PT cũng bị chặn như vậy)
    s.onData(encodeFrame(Buffer.from("00000d05" + "00" + L + M, "hex")));
    expect(() => s.encodeAction("dijie_open", [])).toThrow("Không thể kéo cả bầy zô Dị Giới được Ní ơi, giải tán đội đi !!!");
    expect(logs.some((m) => m.includes("giải tán đội đi"))).toBe(true);
    // giải tán: mọi người nhận 0d/04
    s.onData(encodeFrame(Buffer.from("00000d04" + "00" + M + "76023601", "hex")));
    expect(s.encodeAction("dijie_open", [])!.length).toBeGreaterThan(0);
  });

  it("chủ PT đang có đội cũng bị chặn; chưa có đội thì vào bình thường", () => {
    const L = "8ede67d3aca80a00", M = "b3de67d3aca80a00";
    const a = mk(L);
    expect(a.s.encodeAction("dijie_open", [])!.length).toBeGreaterThan(0);
    a.s.onData(encodeFrame(Buffer.from("00000d05" + "00" + L + M, "hex")));
    expect(() => a.s.encodeAction("dijie_open", [])).toThrow(/giải tán đội/);
  });
});

describe("Đội ngũ — gói gửi đi", () => {
  const SPAWN_BAIFERN12 = fx.own_party_spawns.find((p) => p.startsWith("0048c7"))!;
  const spawnOf = (s: ReturnType<typeof mk>["s"]) => s.onData(frame(0x03, 0x00, SPAWN_BAIFERN12));

  it("mời theo tên = 0d/07 `00 <uid>` khớp hex wire của Easytool (packetinvite 6d3cbcadadada0aaad)", async () => {
    const { s, sent: out } = mk("aaaa67d3aca80a00");
    spawnOf(s);
    const r = await s.executeAction!("party_invite", ["baifern12"], () => {}, new AbortController().signal);
    expect(r).toEqual({ ok: true });
    expect(out).toHaveLength(1);
    expect(out[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00000d07" + "00" + "48c767d3aca80a00", "hex")).toString("hex"));
    expect(out[0]!.toString("hex").startsWith("6d3cbcadadada0aaad")).toBe(true);
  });

  it("xin vào đội = 0d/01 (packetrequest 6d3cbcadadada0acad)", async () => {
    const { s, sent: out } = mk("aaaa67d3aca80a00");
    spawnOf(s);
    await s.executeAction!("party_request", ["BaiFern12"], () => {}, new AbortController().signal);
    expect(out[0]!.toString("hex").startsWith("6d3cbcadadada0acad")).toBe(true);
  });

  it("không gửi gói khi người đó không ở cùng map / chưa spawn", async () => {
    const { s, sent: out } = mk("aaaa67d3aca80a00");
    spawnOf(s);
    (s as unknown as { location: { map: number } }).location = { map: 12001, x: 0, y: 0, channel: 0 } as never;
    const r = await s.executeAction!("party_invite", ["BaiFern12"], () => {}, new AbortController().signal);
    expect(r!.ok).toBe(false);
    expect(r!.message).toMatch(/Không thấy/);
    expect(out).toHaveLength(0);
  });

  it("tự chấp nhận lời mời từ đúng tên đã cấu hình (0d/08 `00 <uid> 01`), bỏ qua người lạ", async () => {
    const { s, sent } = mk("aaaa67d3aca80a00");
    spawnOf(s); // BaiFern12
    await s.executeAction!("set_party_config", ["BaiFern12", "[]"], () => {}, new AbortController().signal);
    // Log thật 2026-10-21: người nhận lời mời thấy S→C 0d/09 `00 <uid người mời>` (không phải 0d/07)
    s.onData(frame(0x0d, 0x09, "00" + "48c767d3aca80a00")); // BaiFern12 mời
    expect(sent).toHaveLength(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00000d08" + "0001" + "48c767d3aca80a00", "hex")).toString("hex"));
    sent.length = 0;
    s.onData(frame(0x0d, 0x09, "00" + "ffff67d3aca80a00")); // người lạ
    expect(sent).toHaveLength(0);
  });

  it("0d/0d `00 00` (server đã nhận lời mời/xin) không gây lỗi và không gửi gói", () => {
    const { s, sent } = mk();
    s.onData(frame(0x0d, 0x0d, "0000"));
    expect(sent).toHaveLength(0);
  });

  it("chủ PT tự chấp nhận lời xin của tên khai báo (0d/03)", async () => {
    const { s, sent } = mk("aaaa67d3aca80a00");
    spawnOf(s);
    await s.executeAction!("set_party_config", ["", JSON.stringify(["BaiFern12"])], () => {}, new AbortController().signal);
    s.onData(frame(0x0d, 0x01, "00" + "48c767d3aca80a00"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.toString("hex")).toBe(encodeFrame(Buffer.from("00000d03" + "0001" + "48c767d3aca80a00", "hex")).toString("hex"));
  });

  it("gán Quân sư khi chưa ở trong đội ⇒ báo lỗi, KHÔNG gửi gói", async () => {
    const { s, sent: out } = mk();
    const r = await s.executeAction!("party_set_advisor", ["BaiFine"], () => {}, new AbortController().signal);
    expect(r!.ok).toBe(false);
    expect(out).toHaveLength(0);
  });

  it("partyPayload = 00 + uid", () => {
    expect(partyPayload("48c767d3aca80a00", [1])).toEqual([0, 0x48, 0xc7, 0x67, 0xd3, 0xac, 0xa8, 0x0a, 0x00, 1]);
  });
});

describe("Đội ngũ — chuỗi warp có chốt chặn gom đội", () => {
  it("warp_map qua cổng thành: có {gather} NGAY SAU teleport và TRƯỚC các bước đi bộ (cổng dịch chuyển)", () => {
    const steps = buildSteps("warp_map", { mapId: 21261 }, { map: 12003 });
    const idx = steps.findIndex((s) => "gather" in s);
    expect(idx).toBeGreaterThan(0);
    const before = steps.slice(0, idx).filter((s): s is { cmd: { name: string }; afterMs: number } => "cmd" in s).map((s) => s.cmd.name);
    expect(before).toContain("teleport_gate");
    expect(before).not.toContain("warp_door");
    expect(steps.slice(idx).some((s) => "cmd" in s && s.cmd.name === "warp_door")).toBe(true);
  });

  it("warp_to_spot: gather trước bước move tới bãi", () => {
    const steps = buildSteps("warp_to_spot", { mapId: 12003, x: 500, y: 400 }, { map: 12003 });
    const g = steps.findIndex((s) => "gather" in s);
    const mv = steps.findIndex((s) => "cmd" in s && s.cmd.name === "move");
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThan(mv);
  });
});
