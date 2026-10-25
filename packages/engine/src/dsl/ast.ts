export interface CmdNode {
  kind: "cmd";
  name: string;
  args: string[];
  raw: string;
  line: number;
}
export interface BlockNode {
  kind: "block";
  name: "loop" | "if_map";
  args: string[];
  raw: string;
  line: number;
  body: Node[];
}
export type Node = CmdNode | BlockNode;
