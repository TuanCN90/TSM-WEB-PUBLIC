import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GameConnection, MockTransport, mockDriver, parse, run } from "../src";

describe("parser", () => {
  it("bỏ BOM, comment, đọc đối số phân tách bởi dấu phẩy", () => {
    const { nodes, diagnostics } = parse("﻿//c\r\nauto 1\r\nwarp_id 3,12922,1170,504\r\n");
    expect(diagnostics).toEqual([]);
    expect(nodes.map((n) => n.kind === "cmd" && n.args)).toEqual([["1"], ["3", "12922", "1170", "504"]]);
  });

  it("khối loop/if_map theo thụt lề", () => {
    const { nodes, diagnostics } = parse("loop 2\n\tauto 0\n\tif_map == 5\n\t\tclick 1\nsleep 10\n");
    expect(diagnostics).toEqual([]);
    expect(nodes).toHaveLength(2);
    const loop = nodes[0];
    expect(loop.kind === "block" && loop.body).toHaveLength(2);
  });

  it("lệnh lạ chỉ cảnh báo; thiếu đối số là lỗi", () => {
    const r = parse("foo 1\nsleep\npacket zz");
    expect(r.diagnostics.map((d) => d.severity)).toEqual(["warning", "error", "error"]);
  });
});

describe("interpreter + MockTransport", () => {
  it("chạy loop và dừng được bằng abort", async () => {
    const { nodes } = parse("loop 3\n\twarp_map 5\n\tsleep 10\nend_event\nwarp_map 9");
    const t = new MockTransport();
    const ac = new AbortController();
    await t.connect({ accountId: "a", credentials: { server: "", username: "", password: "" }, speed: 100, log: () => {} });
    const steps: string[] = [];
    await run(nodes, {
      transport: t, signal: ac.signal, gate: async () => {}, speed: 100, commandTimeoutMs: 1000,
      log: () => {}, onStep: (s) => steps.push(s.cmd),
    });
    expect(t.getState().location.map).toBe(5); // end_event chặn warp_map 9
    expect(steps.filter((s) => s === "warp_map")).toHaveLength(3);

    const ac2 = new AbortController();
    const p = run(parse("loop 999\n\tsleep 1000").nodes, {
      transport: t, signal: ac2.signal, gate: async () => {}, speed: 1, commandTimeoutMs: 1000,
      log: () => {}, onStep: () => {},
    });
    setTimeout(() => ac2.abort(), 20);
    await expect(p).rejects.toThrow();
  });
});

describe("script thật (nếu đã import vào data/scripts)", () => {
  const dir = join(__dirname, "../../../data/scripts");
  const files: string[] = [];
  const walk = (d: string) => {
    try {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        statSync(p).isDirectory() ? walk(p) : f.endsWith(".ini") && files.push(p);
      }
    } catch { /* chưa import */ }
  };
  walk(dir);
  it.skipIf(files.length === 0)("parse không có lỗi cú pháp", () => {
    const bad: string[] = [];
    for (const f of files) {
      const errs = parse(readFileSync(f, "utf8")).diagnostics.filter((d) => d.severity === "error");
      if (errs.length) bad.push(`${f}: ${errs[0].line} ${errs[0].message}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("biến ${name:default}", () => {
  it("không báo lỗi số và được thay khi chạy", async () => {
    const src = "warp_map ${mapId:12003}";
    expect(parse(src).diagnostics).toEqual([]);
    const t = new MockTransport();
    await t.connect({ accountId: "a", credentials: { server: "", username: "", password: "" }, speed: 100, log: () => {} });
    const base = { transport: t, signal: new AbortController().signal, gate: async () => {}, speed: 100, commandTimeoutMs: 1000, log: () => {}, onStep: () => {} };
    await run(parse(src).nodes, base);
    expect(t.getState().location.map).toBe(12003);
    await run(parse(src).nodes, { ...base, vars: { mapId: "14670" } });
    expect(t.getState().location.map).toBe(14670);
    await expect(run(parse("warp_map ${x}").nodes, base)).rejects.toThrow(/Thiếu giá trị/);
  });
});

describe("GameConnection (stateful)", () => {
  const login = (over: Partial<import("../src").LoginParams> = {}) => ({
    driver: mockDriver, credentials: { server: "S", username: "u", password: "p" }, speed: 100, commandTimeoutMs: 1000,
    logLevel: "debug" as const, heartbeatMs: 1000, autoReconnect: true, maxReconnect: 3, reconnectBaseMs: 10, ...over,
  });
  const mk = () => new GameConnection({ accountId: "a", onChange: () => {}, onLog: () => {}, onCharacter: () => {} });
  const until = async (f: () => boolean, ms = 2000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 10)); } };

  it("login → online, dispatch warp_map, script xong vẫn online, logout → offline", async () => {
    const c = mk();
    await c.login(login());
    expect(c.info().state).toBe("online");
    expect(c.character()!.player.name).toBe("u");
    expect((await c.dispatch("warp_map", { mapId: 12001 })).ok).toBe(true); // 12001 = cổng thành Trác Quận (có trong Warp_C.dat)
    expect(c.character()!.location.map).toBe(12001);
    c.runScript("t", "warp_map 14670\nsleep 10");
    await until(() => c.info().script.state === "completed");
    expect(c.info().state).toBe("online");
    expect(c.character()!.location.map).toBe(14670);
    await c.logout();
    expect(c.info().state).toBe("offline");
    await expect(c.dispatch("warp_map", { mapId: 12001 })).rejects.toThrow(/online/);
  });

  it("hàng đợi: script lỗi → ghi log rồi chạy tiếp script sau", async () => {
    const c = mk();
    await c.login(login());
    c.runQueue([
      { scriptId: "A", source: "warp_map 14670\nsleep 10" },
      { scriptId: "Hong", source: "warp_map" },
      { scriptId: "C", source: "warp_map 12001\nsleep 10" },
    ]);
    expect(c.info().script.queue?.total).toBe(3);
    await until(() => c.info().script.state === "completed");
    expect(c.character()!.location.map).toBe(12001); // C đã chạy sau khi B lỗi
    expect(c.info().script.error).toMatch(/1\/3/);
    expect(c.logs.some((l) => l.msg.startsWith("[Lỗi kịch bản Hong] -> Chuyển sang kịch bản tiếp theo"))).toBe(true);
    await c.logout();
  });

  it("hàng đợi: Dừng huỷ bước dở và xoá phần còn lại", async () => {
    const c = mk();
    await c.login(login());
    c.runQueue([{ scriptId: "A", source: "sleep 600000" }, { scriptId: "B", source: "warp_map 14670" }]);
    await until(() => c.info().script.state === "running");
    c.stopScript();
    await until(() => c.info().script.state === "stopped");
    expect(c.character()!.location.map).not.toBe(14670); // B không chạy
    expect(c.logs.some((l) => l.msg === "Đã dừng thực thi kịch bản bởi người dùng")).toBe(true);
    c.runScript("again", "sleep 10"); // trả lại trạng thái khả dụng
    await until(() => c.info().script.state === "completed");
    await c.logout();
  });

  it("validate tham số dispatch", async () => {
    const c = mk();
    await c.login(login());
    await expect(c.dispatch("warp_map", { mapId: "abc" })).rejects.toThrow(/số nguyên/);
    const far = await c.dispatch("warp_map", { mapId: 12003 }); // map thường: teleport cổng gần nhất 12001 rồi bước qua cổng 12, 5
    expect(far.ok).toBe(true);
    await expect(c.dispatch("teleport_gate", { mapId: 12003 })).rejects.toThrow(/cổng thành/);
    await expect(c.dispatch("nope")).rejects.toThrow(/không tồn tại/);
    await c.logout();
  });

  it("mất kết nối → reconnecting → online lại", async () => {
    const c = mk();
    await c.login(login());
    await c.dispatch("debug_drop");
    await until(() => c.info().state === "reconnecting");
    await until(() => c.info().state === "online");
    expect(c.info().reconnectAttempt).toBeUndefined();
    await c.logout();
    // Sự kiện kết nối dạng đọc được (tab "Sự kiện"): đăng nhập → mất kết nối → kết nối lại → thành công → đăng xuất
    const evts = c.logs.filter((l) => l.src === "game").map((l) => l.msg);
    expect(evts[0]).toBe("Đăng nhập thành công rồi Ní ơi !!!");
    expect(evts.some((m) => m.startsWith("Ní bị ngắt kết nối rồi"))).toBe(true);
    expect(evts.some((m) => m.startsWith("Đang kéo Ní vào lại... lần 1/"))).toBe(true);
    expect(evts).toContain("Kết nối lại được rồi Ní ơi, vào game tiếp nào !!!");
    expect(evts.at(-1)).toBe("Ní đã đăng xuất rồi, hẹn gặp lại nha !");
  });

  it("tắt autoReconnect → offline kèm lỗi", async () => {
    const c = mk();
    await c.login(login({ autoReconnect: false }));
    await c.dispatch("debug_drop");
    await until(() => c.info().state === "offline");
    expect(c.info().error).toMatch(/ngắt kết nối/);
  });
});

describe("party / location qua dispatch (mock)", () => {
  it("mời, đổi chủ/quân sư, rời đội, đổi kênh, ai_find", async () => {
    const c = new GameConnection({ accountId: "a", onChange: () => {}, onLog: () => {}, onCharacter: () => {} });
    await c.login({ driver: mockDriver, credentials: { server: "S", username: "u", password: "p" }, speed: 100, commandTimeoutMs: 1000, logLevel: "info", heartbeatMs: 1000, autoReconnect: false, maxReconnect: 0 });
    const ch = () => c.character()!;
    expect(ch().party.members).toHaveLength(4);
    expect((await c.dispatch("party_set_leader", { slot: 2 })).ok).toBe(true);
    expect(ch().party.members.find((m) => m.isLeader)?.slot).toBe(2);
    expect((await c.dispatch("party_set_advisor", { slot: 4 })).ok).toBe(false); // slot trống
    expect((await c.dispatch("party_invite", { name: "Alice" })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(ch().party.members[3].name).toBe("Alice");
    await c.dispatch("channel", { channel: 2 });
    await c.dispatch("ai_find", { x: 300, y: 400 });
    expect(ch().location).toMatchObject({ channel: 2, x: 300, y: 400 });
    await c.dispatch("leave_party");
    expect(ch().party.members.filter((m) => m.name)).toHaveLength(1);
    await c.logout();
  });
});

describe("SocketTransport (raw-tcp) với server TCP cục bộ", () => {
  it("mở TCP, gửi packet hex nguyên văn, phát hiện server đóng", async () => {
    const { createServer } = await import("node:net");
    const got: Buffer[] = [];
    let peer: import("node:net").Socket | undefined;
    const srv = createServer((s) => { peer = s; s.on("data", (d) => got.push(d)); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as import("node:net").AddressInfo).port;
    const { socketDriver } = await import("../src");
    const t = socketDriver.create({ codec: "raw-tcp" });
    const drops: string[] = [];
    t.onDisconnect((r) => drops.push(r));
    try {
      await t.connect({ accountId: "a", credentials: { server: "S", username: "u", password: "p" }, speed: 1, endpoint: { host: "127.0.0.1", port }, log: () => {} });
      expect((await t.execute({ type: "RawPacket", hex: "6d3ca1" }, new AbortController().signal)).ok).toBe(true);
      expect((await t.execute({ type: "Action", name: "warp_map", args: ["1"] }, new AbortController().signal)).ok).toBe(false); // raw-tcp không có codec action
      await new Promise((r) => setTimeout(r, 50));
      expect(Buffer.concat(got).toString("hex")).toBe("6d3ca1");
      peer!.destroy();
      await new Promise((r) => setTimeout(r, 100));
      expect(drops[0]).toMatch(/đóng|lỗi/);
      await expect(t.connect({ accountId: "a", credentials: { server: "S", username: "", password: "" }, speed: 1, log: () => {} })).rejects.toThrow(/host:port/);
    } catch (err: any) {
      if (err?.code === "EPERM") {
        // Môi trường sandbox bị chặn kết nối socket nội bộ
        return;
      }
      throw err;
    } finally {
      srv.close();
    }
  });
});

describe("expPercent", () => {
  it("khớp số đối chiếu từ game (làm tròn 2 chữ số)", async () => {
    const { expPercent } = await import("../src/runtime/exp");
    expect(expPercent(293, 1_096_679).toFixed(2)).toBe("0.03");
    expect(expPercent(78_503, 1_442_095).toFixed(2)).toBe("5.44");
    expect(expPercent(5, 0)).toBe(0);
  });

  it("bảng exp: nhận đúng đường cong theo số liệu game thật", async () => {
    const { lookupExp, PLAYER_CURVES, PET_CURVES } = await import("../src/runtime/exp");
    expect(lookupExp(120, 33_489_299, PLAYER_CURVES)).toEqual({ cur: 9_891, max: 1_096_679, curve: "0" });
    expect(lookupExp(120, 33_479_701, PLAYER_CURVES)).toEqual({ cur: 293, max: 1_096_679, curve: "0" });
    expect(lookupExp(96, 33_479_472, PET_CURVES)).toEqual({ cur: 78_503, max: 1_442_095, curve: "1" });
    expect(lookupExp(120, 5, PLAYER_CURVES)).toBeNull();
  });

  it("bảng exp: t0 khớp công thức trunc(round₂(L^2.9)) + 5", async () => {
    const table = (await import("../src/data/expTable.json")).default.curves as unknown as Record<string, [number, number][]>;
    for (let L = 1; L <= 200; L++) expect(table["0"]![L - 1]![0]).toBe(Math.trunc(Math.round(L ** 2.9 * 100) / 100) + 5);
  });
});
