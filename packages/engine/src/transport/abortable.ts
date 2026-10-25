/** Chờ ms, huỷ được bằng AbortSignal. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class AbortError extends Error {
  constructor() {
    super("Đã dừng");
    this.name = "AbortError";
  }
}

/** Server từ chối/không phản hồi login — thường do phiên cũ chưa được server giải phóng, nên đáng thử lại. */
export class LoginRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginRejectedError";
  }
}
