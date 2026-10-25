import type { Diagnostic } from "@tsbot/protocol";
import type { BlockNode, CmdNode, Node } from "./ast";
import { BLOCK_COMMANDS, COMMANDS, COMPARE_OPS } from "./commands";
import { hasVar } from "./vars";

interface Item {
  line: number;
  indent: number;
  name: string;
  rest: string;
}

export interface ParseResult {
  nodes: Node[];
  diagnostics: Diagnostic[];
}

function indentOf(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === "\t") n += 4;
    else if (ch === " ") n += 1;
    else break;
  }
  return n;
}

function splitArgs(name: string, rest: string): string[] {
  if (!rest) return [];
  if (COMMANDS[name]?.text) return [rest];
  return rest.split(/[\s,]+/).filter(Boolean);
}

/** Parse nội dung .ini (BOM/CRLF được chuẩn hoá) thành AST + diagnostics. */
export function parse(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);
  const items: Item[] = [];

  lines.forEach((text, i) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith(";") || trimmed.startsWith("#")) return;
    const m = /^(\S+)\s*(.*)$/.exec(trimmed)!;
    items.push({ line: i + 1, indent: indentOf(text), name: m[1].toLowerCase(), rest: m[2].trim() });
  });

  function build(pos: number, indent: number): [Node[], number] {
    const nodes: Node[] = [];
    while (pos < items.length) {
      const it = items[pos];
      if (it.indent < indent) break;
      pos++;
      const args = splitArgs(it.name, it.rest);
      validate(it, args, diagnostics);
      const next = items[pos];
      if (BLOCK_COMMANDS.has(it.name)) {
        let body: Node[] = [];
        if (next && next.indent > it.indent) {
          [body, pos] = build(pos, next.indent);
        } else {
          diagnostics.push({ line: it.line, severity: "warning", message: `Khối '${it.name}' không có thân (cần thụt lề các dòng bên dưới)` });
        }
        nodes.push({ kind: "block", name: it.name as BlockNode["name"], args, raw: it.rest, line: it.line, body });
      } else {
        if (next && next.indent > it.indent) {
          diagnostics.push({ line: next.line, severity: "warning", message: `Thụt lề bất thường sau '${it.name}' (không phải lệnh dạng khối)` });
        }
        nodes.push({ kind: "cmd", name: it.name, args, raw: it.rest, line: it.line } satisfies CmdNode);
      }
    }
    return [nodes, pos];
  }

  const nodes: Node[] = [];
  let pos = 0;
  while (pos < items.length) {
    const [chunk, next] = build(pos, items[pos].indent);
    nodes.push(...chunk);
    if (next === pos) pos++; // phòng vòng lặp vô hạn
    else pos = next;
  }
  return { nodes, diagnostics };
}

function validate(it: Item, args: string[], out: Diagnostic[]): void {
  const spec = COMMANDS[it.name];
  if (!spec) {
    out.push({ line: it.line, severity: "warning", message: `Lệnh không biết: '${it.name}' (sẽ bị bỏ qua khi chạy)` });
    return;
  }
  if (args.length < spec.min) out.push({ line: it.line, severity: "error", message: `'${it.name}' cần ít nhất ${spec.min} đối số` });
  else if (args.length > spec.max) out.push({ line: it.line, severity: "warning", message: `'${it.name}' nhận tối đa ${spec.max} đối số` });
  if (spec.numeric) {
    for (const a of args) {
      if (!hasVar(a) && !/^-?\d+$/.test(a)) {
        out.push({ line: it.line, severity: "error", message: `Đối số '${a}' của '${it.name}' phải là số nguyên` });
        break;
      }
    }
  }
  if (it.name === "if_map") {
    if (!COMPARE_OPS.has(args[0] ?? "")) out.push({ line: it.line, severity: "error", message: "if_map cần toán tử so sánh: == != < > <= >=" });
    if (args[1] !== undefined && !hasVar(args[1]) && !/^-?\d+$/.test(args[1])) out.push({ line: it.line, severity: "error", message: "if_map cần số map hợp lệ" });
  }
  if (it.name === "packet" && args[0] && !hasVar(args[0]) && !/^([0-9a-fA-F]{2})+$/.test(args[0])) {
    out.push({ line: it.line, severity: "error", message: "packet cần chuỗi hex độ dài chẵn" });
  }
}
