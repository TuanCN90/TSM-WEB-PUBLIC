/**
 * Giải mã file pcap/pcapng của game TS Online (TCP :6614) thành dòng thời gian dễ đọc.
 *
 *   npx tsx tools/pcap-decode.ts <file.pcap|.pcapng> [tuỳ chọn]      (hoặc: npm run pcap -- <file> …)
 *
 * Tuỳ chọn:
 *   --port N          cổng game (mặc định 6614)
 *   --flow N          chọn luồng TCP thứ N khi có nhiều (mặc định: luồng tới cổng game có nhiều dữ liệu nhất)
 *   --dir c|s         chỉ client→server (c) hoặc server→client (s)
 *   --from S --to S   chỉ lấy khoảng thời gian (giây tính từ gói đầu của luồng)
 *   --only a/b,c/d    chỉ hiện các opcode này (cmd/sub dạng hex, vd 57/02,17/08)
 *   --hide a/b,…      ẩn thêm opcode
 *   --all             không ẩn gói lặp dày (di chuyển, heartbeat, spawn…)
 *   --full            in nguyên payload (mặc định cắt ở 48 byte)
 *   --text            giải mã thông báo hệ thống 02/0a (Big5) thành chữ
 *   --find KIỂU:GIÁ_TRỊ  tìm giá trị trong mọi gói: u16:46029 · u32:1000 · hex:cdb3 · text:chuỗi (ASCII)
 *   --stats           chỉ in bảng đếm opcode theo hướng
 *   --candidates      liệt kê các gói CLIENT gửi mà không thuộc khởi tạo/heartbeat (= ứng viên "hành động"), kèm phản hồi server trong --window giây (mặc định 1.5)
 *   --diff FILE2      so sánh tập opcode với một capture khác (gói client gửi / server trả)
 *   --json            xuất JSON mỗi dòng một gói
 *
 * Quy ước: payload = f[8..] (f = frame đã giải mã: 6d 3c | len u16 | 00 00 | cmd | sub | payload). Offset trong --find tính từ f[0].
 * AN TOÀN: frame đăng nhập `01/00` (user/mật khẩu) và phản hồi `01/02` luôn bị che, ở mọi chế độ.
 */
import { readFileSync } from "node:fs";

/* ------------------------------ đọc pcap / pcapng ------------------------------ */
interface RawPacket { ts: number; link: number; data: Buffer } // ts: giây (số thực)

function readPcap(buf: Buffer): RawPacket[] {
  const magic = buf.readUInt32LE(0);
  const le = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  const be = magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1;
  if (!le && !be) throw new Error("Không phải file pcap/pcapng");
  const nano = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const link = u32(20);
  const out: RawPacket[] = [];
  for (let o = 24; o + 16 <= buf.length; ) {
    const sec = u32(o), frac = u32(o + 4), cap = u32(o + 8);
    out.push({ ts: sec + frac / (nano ? 1e9 : 1e6), link, data: buf.subarray(o + 16, o + 16 + cap) });
    o += 16 + cap;
  }
  return out;
}

function readPcapng(buf: Buffer): RawPacket[] {
  const ifs: { link: number; resol: number }[] = [];
  const out: RawPacket[] = [];
  for (let o = 0; o + 12 <= buf.length; ) {
    const type = buf.readUInt32LE(o), len = buf.readUInt32LE(o + 4);
    if (len < 12 || o + len > buf.length) break;
    const body = buf.subarray(o + 8, o + len - 4);
    if (type === 1) { // Interface Description Block
      let resol = 1e6;
      for (let p = 8; p + 4 <= body.length; ) { // options
        const code = body.readUInt16LE(p), l = body.readUInt16LE(p + 2);
        if (code === 0) break;
        if (code === 9) { const v = body[p + 4]!; resol = v & 0x80 ? 2 ** (v & 0x7f) : 10 ** v; }
        p += 4 + Math.ceil(l / 4) * 4;
      }
      ifs.push({ link: body.readUInt16LE(0), resol });
    } else if (type === 6) { // Enhanced Packet Block
      const itf = ifs[body.readUInt32LE(0)] ?? { link: 1, resol: 1e6 };
      const t = body.readUInt32LE(4) * 2 ** 32 + body.readUInt32LE(8);
      const cap = body.readUInt32LE(12);
      out.push({ ts: t / itf.resol, link: itf.link, data: body.subarray(20, 20 + cap) });
    }
    o += Math.ceil(len / 4) * 4;
  }
  return out;
}

const readCapture = (file: string) => {
  const buf = readFileSync(file);
  return buf.readUInt32LE(0) === 0x0a0d0d0a ? readPcapng(buf) : readPcap(buf);
};

/* ------------------------------ tách TCP ------------------------------ */
interface Seg { seq: number; ts: number; data: Buffer }
interface Flow { key: string; client: string; server: string; c2s: Seg[]; s2c: Seg[]; first: number; bytes: number }

/** Trả về { ipv, payload IP } cho các kiểu link layer phổ biến. */
function ipPacket(p: RawPacket): Buffer | null {
  const d = p.data;
  switch (p.link) {
    case 1: { // Ethernet (+VLAN)
      let o = 12, et = d.readUInt16BE(o);
      while (et === 0x8100 || et === 0x88a8) { o += 4; et = d.readUInt16BE(o); }
      return et === 0x0800 || et === 0x86dd ? d.subarray(o + 2) : null;
    }
    case 101: case 12: case 228: case 229: return d; // raw IP (PCAPdroid)
    case 113: return d.subarray(16); // Linux cooked
    case 276: return d.subarray(20);
    default: return null;
  }
}

function tcpOf(ip: Buffer): { src: string; dst: string; sport: number; dport: number; seq: number; payload: Buffer } | null {
  let src: string, dst: string, tcp: Buffer;
  if (ip[0]! >> 4 === 4) {
    if (ip[9] !== 6) return null;
    const ihl = (ip[0]! & 15) * 4;
    src = [...ip.subarray(12, 16)].join("."); dst = [...ip.subarray(16, 20)].join(".");
    tcp = ip.subarray(ihl);
  } else if (ip[0]! >> 4 === 6) {
    if (ip[6] !== 6) return null;
    src = ip.subarray(8, 24).toString("hex"); dst = ip.subarray(24, 40).toString("hex");
    tcp = ip.subarray(40);
  } else return null;
  const off = (tcp[12]! >> 4) * 4;
  return { src, dst, sport: tcp.readUInt16BE(0), dport: tcp.readUInt16BE(2), seq: tcp.readUInt32BE(4), payload: tcp.subarray(off) };
}

function flowsOf(pkts: RawPacket[], port: number): Flow[] {
  const flows = new Map<string, Flow>();
  for (const p of pkts) {
    const ip = ipPacket(p);
    const t = ip && tcpOf(ip);
    if (!t || !t.payload.length || (t.sport !== port && t.dport !== port)) continue;
    const toServer = t.dport === port;
    const client = toServer ? `${t.src}:${t.sport}` : `${t.dst}:${t.dport}`;
    const server = toServer ? `${t.dst}:${t.dport}` : `${t.src}:${t.sport}`;
    const key = `${client}>${server}`;
    const f = flows.get(key) ?? { key, client, server, c2s: [], s2c: [], first: p.ts, bytes: 0 };
    (toServer ? f.c2s : f.s2c).push({ seq: t.seq, ts: p.ts, data: t.payload });
    f.first = Math.min(f.first, p.ts); f.bytes += t.payload.length;
    flows.set(key, f);
  }
  return [...flows.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Ghép các segment thành luồng byte liên tục (xử lý gửi lại/gối nhau); trả kèm mốc thời gian theo offset. */
function reassemble(segs: Seg[]): { bytes: Buffer; marks: { off: number; ts: number }[]; gaps: number } {
  if (!segs.length) return { bytes: Buffer.alloc(0), marks: [], gaps: 0 };
  const base = Math.min(...segs.map((s) => s.seq));
  const parts: Buffer[] = [], marks: { off: number; ts: number }[] = [];
  let len = 0, gaps = 0;
  for (const s of [...segs].sort((a, b) => a.seq - b.seq || a.ts - b.ts)) {
    const pos = s.seq - base;
    if (pos + s.data.length <= len) continue; // gửi lại hoàn toàn
    if (pos > len) { parts.push(Buffer.alloc(pos - len)); len = pos; gaps++; } // mất gói: chèn 0
    const cut = len - pos;
    marks.push({ off: len, ts: s.ts });
    parts.push(s.data.subarray(cut)); len += s.data.length - cut;
  }
  return { bytes: Buffer.concat(parts), marks, gaps };
}

/* ------------------------------ tách frame game ------------------------------ */
interface Frame { ts: number; dir: "C" | "S"; cmd: number; sub: number; f: Buffer; odd?: boolean }

/**
 * Frame: `6d 3c | len u16 (XOR AD) | …`, từ byte 2 trở đi XOR 0xAD. Một số frame trong pcap bị mất 6 byte header (`00 00 xx xx xx xx`);
 * khi gặp, lấy độ dài đến header hợp lệ kế tiếp và đánh dấu `odd` (cmd/sub lấy ở offset 6 như thường).
 */
function frames(bytes: Buffer, marks: { off: number; ts: number }[], dir: "C" | "S"): Frame[] {
  const out: Frame[] = [];
  const tsAt = (off: number) => { let t = marks[0]?.ts ?? 0; for (const m of marks) { if (m.off <= off) t = m.ts; else break; } return t; };
  const valid = (i: number) => bytes[i] === 0x6d && bytes[i + 1] === 0x3c && i + 6 <= bytes.length && (bytes[i + 2]! ^ 0xad | ((bytes[i + 3]! ^ 0xad) << 8)) >= 8;
  for (let i = 0; i + 8 <= bytes.length; ) {
    let len = 0, odd = false;
    if (valid(i)) {
      len = (bytes[i + 2]! ^ 0xad) | ((bytes[i + 3]! ^ 0xad) << 8);
      if (i + len > bytes.length) break;
    } else {
      let j = i + 1;
      while (j < bytes.length && !valid(j)) j++;
      len = j - i; odd = true;
      if (len < 8) { i = j; continue; }
    }
    const f = Buffer.from(bytes.subarray(i, i + len));
    for (let k = 2; k < f.length; k++) f[k] = f[k]! ^ 0xad;
    out.push({ ts: tsAt(i), dir, cmd: f[6]!, sub: f[7]!, f, odd });
    i += len;
  }
  return out;
}

/* ------------------------------ hiển thị ------------------------------ */
const OPS: Record<string, string> = {
  "01/00": "ĐĂNG NHẬP", "01/02": "PHẢN HỒI ĐĂNG NHẬP", "01/10": "ping", "07/01": "heartbeat", "0a/00": "heartbeat", "0c/01": "làm mới trạng thái",
  "0c/00": "trạng thái của mình (map,x,y)", "03/00": "spawn đơn vị", "07/00": "vị trí đơn vị", "06/01": "di chuyển", "02/0a": "thông báo hệ thống",
  "05/03": "chỉ số nhân vật", "0f/08": "võ tướng", "08/0e": "exp nhân vật", "08/02": "exp võ tướng", "23/05": "Vàng", "1a/04": "Xu",
  "17/05": "TÚI ĐỒ (danh sách)", "17/08": "cập nhật 1 ô túi", "55/01": "bộ đếm server", "44/01": "teleport cổng thành", "57/02": "điểm danh/quà ngày",
  "61/01": "Dị giới: mở/trả", "61/02": "Dị giới: chọn mốc", "18/01": "Dị giới: mốc mới", "18/02": "Dị giới: mốc cũ", "29/0c": "đổi map", "14/08": "từ chối login",
  "19/29": "khởi tạo", "62/02": "khởi tạo", "21/01": "khởi tạo/PK", "59/01": "khởi tạo", "48/05": "khởi tạo", "4d/0b": "nhận thưởng", "4d/03": "hoạt động",
  "2f/01": "phòng phó bản: danh sách", "2f/02": "phòng phó bản: tạo / kết quả (+mật khẩu)", "2f/0a": "phòng phó bản: huỷ / trạng thái", "2f/0b": "phòng phó bản: sẵn sàng (bật/tắt)", "2f/03": "phòng phó bản: vào phòng / kết quả", "2f/0c": "phòng phó bản: bắt đầu", "27/69": "điểm danh đoàn", "63/04": "đấu trường: nhận", "63/01": "đấu trường", "54/02": "mua ưu đãi", "54/01": "hỏi ưu đãi", "13/01": "chọn võ tướng xuất chiến", "13/04": "võ tướng xuất chiến (login)", "53/01": "thư: danh sách / nhận quà", "53/02": "thư: ack nhận / (client) 26 id", "53/03": "thư: mở thư", "53/04": "thư: ack mở", "42/01": "dùng vật phẩm?",
};
/** Gói lặp dày — ẩn mặc định (xem --all). */
const NOISY = new Set(["06/01", "0b/00", "0b/04", "18/08", "01/01", "4d/01", "4d/02", "7c/00", "6e/09", "07/00", "23/32", "18/05", "4f/07", "03/00", "07/01", "0a/00", "08/01", "5b/02"]);
const MASKED = new Set(["01/00", "01/02"]);
const hex = (b: Buffer) => b.toString("hex").replace(/(..)/g, "$1 ").trim();
const opOf = (x: { cmd: number; sub: number }) => `${x.cmd.toString(16).padStart(2, "0")}/${x.sub.toString(16).padStart(2, "0")}`;

function parseArgs(argv: string[]) {
  const o: Record<string, string | true> = {};
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) { const nx = argv[i + 1]; if (nx !== undefined && !nx.startsWith("--") && !["all", "full", "text", "stats", "json", "candidates"].includes(a.slice(2))) { o[a.slice(2)] = nx; i++; } else o[a.slice(2)] = true; }
    else files.push(a);
  }
  return { o, files };
}

function loadFrames(file: string, port: number, flowIdx?: number) {
  const pk = readCapture(file);
  const flows = flowsOf(pk, port);
  if (!flows.length) throw new Error(`Không thấy luồng TCP tới cổng ${port} trong ${file}`);
  const fl = flows[flowIdx ?? 0];
  if (!fl) throw new Error(`Không có luồng #${flowIdx}`);
  const c = reassemble(fl.c2s), s = reassemble(fl.s2c);
  const all = [...frames(c.bytes, c.marks, "C"), ...frames(s.bytes, s.marks, "S")].sort((a, b) => a.ts - b.ts);
  return { flows, fl, all, gaps: c.gaps + s.gaps, t0: fl.first };
}

process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; }); // `| head` không báo lỗi

function main() {
  const { o, files } = parseArgs(process.argv.slice(2));
  if (!files[0] || o.help) { console.log(readFileSync(process.argv[1]!, "utf8").match(/\/\*\*([\s\S]*?)\*\//)?.[1]?.replace(/^ \* ?/gm, "") ?? "Thiếu file"); process.exit(files[0] ? 0 : 1); }
  const port = Number(o.port ?? 6614);
  const { flows, fl, all, gaps, t0 } = loadFrames(files[0], port, o.flow ? Number(o.flow) : 0);

  if (o.diff) {
    const b = loadFrames(String(o.diff), port);
    const count = (fs: Frame[]) => { const m = new Map<string, number>(); for (const f of fs) { const k = `${f.dir}${opOf(f)}`; m.set(k, (m.get(k) ?? 0) + 1); } return m; };
    const A = count(all), B = count(b.all);
    const keys = [...new Set([...A.keys(), ...B.keys()])].sort();
    console.log(`So sánh: A=${files[0]}  B=${o.diff}\nHướng  Opcode  A    B   (C=client→server, S=server→client)`);
    for (const k of keys) {
      const a = A.get(k) ?? 0, bb = B.get(k) ?? 0;
      if (a === bb && NOISY.has(k.slice(1)) && !o.all) continue;
      const tag = !a ? "chỉ có ở B" : !bb ? "chỉ có ở A" : a !== bb ? "khác số lượng" : "";
      if (tag || o.all) console.log(`${k[0]}      ${k.slice(1)}  ${String(a).padStart(4)} ${String(bb).padStart(4)}  ${tag}  ${OPS[k.slice(1)] ?? ""}`);
    }
    return;
  }

  if (o.candidates) {
    // Gói client gửi thường lệ: heartbeat luôn bỏ; khởi tạo + việc tool/client làm lúc login chỉ bỏ trong ROUTINE_S giây đầu.
    // Gói làm mới/khởi tạo lặp lại lúc đổi màn hình hay map (client chuẩn gửi lại 57/03, 01/10, 62/02, 41/02, 0c/01) cũng coi là nền.
    const ALWAYS = new Set(["07/01", "0a/00", "01/00", "01/10", "57/03", "62/02", "41/02", "0c/01"]);
    const ROUTINE = new Set(["19/29", "2b/04", "01/10", "4d/0b", "7c/04", "41/02", "0c/01", "57/03", "62/02", "21/01", "59/01", "48/05", "4d/03", "63/04", "5b/02", "56/01", "27/13", "54/01", "54/02", "21/03", "41/02"]);
    const ROUTINE_S = 15, win = Number(o.window ?? 1.5);
    const cands = all.filter((f) => f.dir === "C" && !ALWAYS.has(opOf(f)) && !(ROUTINE.has(opOf(f)) && f.ts - t0 < ROUTINE_S));
    console.log(`# ${files[0]} — ${cands.length} gói client có thể là hành động (bỏ heartbeat và khởi tạo trong ${ROUTINE_S}s đầu); phản hồi server trong ${win}s`);
    cands.forEach((c, i) => {
      console.log(`[${i + 1}] ${(c.ts - t0).toFixed(3)}s  C→S  ${opOf(c)}  len=${c.f.length}  ${hex(c.f.subarray(8))}${OPS[opOf(c)] ? `   # ${OPS[opOf(c)]}` : ""}`);
      for (const r of all.filter((x) => x.dir === "S" && x.ts >= c.ts && x.ts - c.ts <= win && !NOISY.has(opOf(x)) && !MASKED.has(opOf(x))).slice(0, 12))
        console.log(`      ↳ +${(r.ts - c.ts).toFixed(3)}s  S→C  ${opOf(r)}  len=${r.f.length}  ${hex(r.f.subarray(8, 8 + 40))}${r.f.length > 48 ? " …" : ""}${OPS[opOf(r)] ? `   # ${OPS[opOf(r)]}` : ""}`);
    });
    return;
  }

  if (o.stats) {
    const m = new Map<string, number>();
    for (const f of all) m.set(`${f.dir} ${opOf(f)}`, (m.get(`${f.dir} ${opOf(f)}`) ?? 0) + 1);
    console.log(`Luồng ${fl.key}  (${all.length} frame, ${gaps ? `${gaps} chỗ mất gói` : "không mất gói"}${all.some((f) => f.odd) ? `, ${all.filter((f) => f.odd).length} frame lỗi header` : ""})`);
    for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(6)}  ${k}  ${OPS[k.slice(2)] ?? ""}`);
    return;
  }

  const only = o.only ? new Set(String(o.only).split(",")) : null;
  const hide = new Set(o.hide ? String(o.hide).split(",") : []);
  const from = o.from ? Number(o.from) : -Infinity, to = o.to ? Number(o.to) : Infinity;
  const find = (() => {
    if (!o.find) return null;
    const [kind, v] = String(o.find).split(/:(.*)/s);
    if (kind === "u16") { const b = Buffer.alloc(2); b.writeUInt16LE(Number(v)); return b; }
    if (kind === "u32") { const b = Buffer.alloc(4); b.writeUInt32LE(Number(v)); return b; }
    if (kind === "hex") return Buffer.from(String(v).replace(/\s/g, ""), "hex");
    if (kind === "text") return Buffer.from(String(v), "latin1");
    throw new Error("--find: dùng u16:N · u32:N · hex:… · text:…");
  })();
  const big5 = new TextDecoder("big5");

  if (!o.json) {
    const others = flows.length > 1 ? `  (còn ${flows.length - 1} luồng khác, chọn bằng --flow)` : "";
    console.log(`# ${files[0]} — luồng ${fl.key}: ${all.length} frame${gaps ? `, ⚠ ${gaps} chỗ mất gói` : ""}${others}`);
    console.log("# thời gian(s)  hướng  cmd/sub  len  payload (f[8..])  — frame đăng nhập 01/00, 01/02 luôn được che");
  }
  let hidden = 0;
  const hiddenOps = new Set<string>();
  for (const f of all) {
    const op = opOf(f), t = f.ts - t0;
    if (t < from || t > to) continue;
    if (o.dir && (o.dir === "c") !== (f.dir === "C")) continue;
    if (only ? !only.has(op) : (!o.all && NOISY.has(op)) || hide.has(op)) { if (!only) { hidden++; hiddenOps.add(op); } continue; }
    const masked = MASKED.has(op);
    if (find && (masked || f.f.indexOf(find) < 0)) continue;
    const payload = f.f.subarray(8);
    const shown = masked ? "<đã che: chứa tài khoản>" : hex(o.full ? payload : payload.subarray(0, 48)) + (!o.full && payload.length > 48 ? ` … (+${payload.length - 48})` : "");
    if (o.json) { console.log(JSON.stringify({ t: +t.toFixed(3), dir: f.dir, op, len: f.f.length, payload: masked ? null : payload.toString("hex") })); continue; }
    const at = find ? `  [offset ${f.f.indexOf(find)}]` : "";
    console.log(`${t.toFixed(3).padStart(9)}  ${f.dir === "C" ? "C→S" : "S→C"}  ${op}  ${String(f.f.length).padStart(4)}  ${shown}${at}${OPS[op] ? `   # ${OPS[op]}` : ""}${f.odd ? "  ⚠ header lỗi" : ""}`);
    if (o.text && op === "02/0a" && !masked) console.log(`           ↳ ${big5.decode(f.f.subarray(12)).replace(/[\u0000-\u001f]/g, " ").trim()}`);
  }
  if (!o.json && hidden) console.log(`# đã ẩn ${hidden} gói lặp (${[...hiddenOps].sort().join(", ")}) — dùng --all để xem`);
}

main();
