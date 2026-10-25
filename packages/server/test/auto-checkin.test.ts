import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** autoCheckin là private — gọi qua prototype với kết nối giả (chỉ cần isOffline/dispatch/log). */
async function run(dispatch: (a: string) => Promise<{ ok: boolean; message?: string }>, offlineAfter = Infinity) {
  const { ConnectionManager } = await import("../src/services/connections");
  const logs: string[] = [];
  const calls: string[] = [];
  let n = 0;
  const conn = { get isOffline() { return n >= offlineAfter; }, log: (_l: string, m: string) => logs.push(m), dispatch: async (a: string) => { calls.push(a); n++; return dispatch(a); } };
  const p = (ConnectionManager.prototype as unknown as { autoCheckin(id: string, c: unknown): Promise<void> }).autoCheckin.call({}, "acc", conn);
  await vi.advanceTimersByTimeAsync(40_000);
  await p;
  return { calls, logs };
}

describe("tự động điểm danh ngày sau khi login", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("chờ ~4s cho bộ đếm rồi gửi daily_checkin một lần khi thành công", async () => {
    const { calls } = await run(async () => ({ ok: true }));
    expect(calls).toEqual(["daily_checkin"]);
  });
  it("chưa có bộ đếm ngày ⇒ thử lại (≤4 lần) rồi dặn bấm tay", async () => {
    const { calls, logs } = await run(async () => ({ ok: false, message: "Điểm danh: chưa đọc được bộ đếm ngày từ server, hãy truyền ngày" }));
    expect(calls).toHaveLength(4);
    expect(logs.some((l) => l.includes("bấm nút 📅"))).toBe(true);
  });
  it("chưa có bộ đếm lần đầu, lần sau có ⇒ dừng ngay khi thành công", async () => {
    let i = 0;
    const { calls } = await run(async () => (++i < 3 ? { ok: false, message: "chưa đọc được bộ đếm" } : { ok: true }));
    expect(calls).toHaveLength(3);
  });
  it("lỗi khác (đủ 28 ngày / ngoài phạm vi) ⇒ không thử lại, ghi 1 dòng", async () => {
    const { calls, logs } = await run(async () => { throw new Error("Điểm danh: ngày 29 ngoài phạm vi 1..28 (đã đủ?)"); });
    expect(calls).toHaveLength(1);
    expect(logs[0]).toContain("ngoài phạm vi");
  });
  it("tài khoản đã offline ⇒ không gửi gì", async () => {
    const { calls } = await run(async () => ({ ok: true }), 0);
    expect(calls).toHaveLength(0);
  });
});
