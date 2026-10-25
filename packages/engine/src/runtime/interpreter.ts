import type { LogLevel, StepInfo } from "@tsbot/protocol";
import type { BlockNode, Node } from "../dsl/ast";
import { substitute } from "../dsl/vars";
import { sleep } from "../transport/abortable";
import type { Transport, WaitKind } from "../transport/Transport";

export interface RunOptions {
  transport: Transport;
  signal: AbortSignal;
  /** Chờ nếu đang pause; resolve khi được tiếp tục. */
  gate: () => Promise<void>;
  speed: number;
  vars?: Record<string, string>;
  commandTimeoutMs: number;
  log: (level: LogLevel, msg: string, line?: number) => void;
  onStep: (s: StepInfo) => void;
}

class EndEvent extends Error {}
class ContinueLoop extends Error {}

const AWAITS: Record<string, WaitKind> = {
  await_battle: "battle",
  await_dialog: "dialog",
  await_party: "party",
  await_item: "item",
  await_map: "map",
};

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
    default: return false;
  }
}

/** Chạy AST. Resolve khi script xong / gặp end_event; reject khi lỗi hoặc bị abort. */
export async function run(nodes: Node[], o: RunOptions): Promise<void> {
  try {
    await execList(nodes, o);
  } catch (e) {
    if (e instanceof EndEvent) {
      o.log("info", "end_event: kết thúc script");
      return;
    }
    throw e;
  }
}

async function execList(nodes: Node[], o: RunOptions): Promise<void> {
  for (const n of nodes) {
    await o.gate();
    if (o.signal.aborted) throw o.signal.reason ?? new Error("aborted");
    if (n.kind === "block") await execBlock(n, o);
    else await execCmd(n, o);
  }
}

async function execBlock(b: BlockNode, o: RunOptions): Promise<void> {
  const bargs = b.args.map((a) => substitute(a, o.vars ?? {}));
  o.onStep({ line: b.line, cmd: b.name, args: bargs });
  if (b.name === "loop") {
    const times = Number(bargs[0]) || 0;
    o.log("info", `loop ${times}`, b.line);
    for (let i = 1; i <= times; i++) {
      o.log("debug", `loop ${i}/${times}`, b.line);
      try {
        await execList(b.body, o);
      } catch (e) {
        if (e instanceof ContinueLoop) continue;
        throw e;
      }
    }
  } else {
    const [op, val] = bargs;
    const map = o.transport.getState().location.map;
    const ok = compare(map, op, Number(val));
    o.log("debug", `if_map ${map} ${op} ${val} → ${ok}`, b.line);
    if (ok) await execList(b.body, o);
  }
}

async function execCmd(n: { name: string; args: string[]; line: number }, o: RunOptions): Promise<void> {
  const { name, line } = n;
  const args = n.args.map((a) => substitute(a, o.vars ?? {}));
  o.onStep({ line, cmd: name, args });

  if (name === "end_event") throw new EndEvent();
  if (name === "continue") throw new ContinueLoop();
  if (name === "sleep") {
    const ms = Number(args[0]) || 0;
    o.log("info", `sleep ${ms}ms`, line);
    await sleep(ms / Math.max(o.speed, 0.01), o.signal);
    return;
  }
  const waitKind = AWAITS[name];
  if (waitKind) {
    o.log("info", name, line);
    await o.transport.waitFor(waitKind, args, o.commandTimeoutMs, o.signal);
    return;
  }
  if (name === "packet") {
    o.log("info", `packet ${args[0].slice(0, 24)}${args[0].length > 24 ? "…" : ""}`, line);
    const r = await o.transport.execute({ type: "RawPacket", hex: args[0] }, o.signal);
    if (!r.ok) throw new Error(r.message ?? "RawPacket thất bại");
    return;
  }
  const r = await o.transport.execute({ type: "Action", name, args }, o.signal);
  o.log(r.ok ? "info" : "warn", `${name} ${args.join(",")}`.trim() + (r.message ? ` – ${r.message}` : ""), line);
  if (!r.ok) throw new Error(r.message ?? `${name} thất bại`);
}
