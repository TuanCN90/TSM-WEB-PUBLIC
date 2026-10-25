/** Biến trong script: ${name} hoặc ${name:mặc định}. Giá trị nhập ở Bảng điều khiển khi tạo phiên. */
const VAR_RE = /\$\{(\w+)(?::([^}]*))?\}/g;

export interface VarSpec {
  name: string;
  default?: string;
}

export function extractVars(source: string): VarSpec[] {
  const seen = new Map<string, VarSpec>();
  for (const m of source.matchAll(VAR_RE)) {
    const cur = seen.get(m[1]);
    if (!cur) seen.set(m[1], { name: m[1], default: m[2] });
    else if (cur.default === undefined && m[2] !== undefined) cur.default = m[2];
  }
  return [...seen.values()];
}

export const hasVar = (s: string) => s.includes("${");

/** Thay biến; thiếu giá trị và không có mặc định thì ném lỗi. */
export function substitute(s: string, vars: Record<string, string>): string {
  return s.replace(VAR_RE, (_, name: string, def?: string) => {
    const v = vars[name]?.trim() ? vars[name].trim() : def;
    if (v === undefined || v === "") throw new Error(`Thiếu giá trị cho biến \${${name}}`);
    return v;
  });
}
