import type { TelegramConfig, TelegramTestResult } from "@tsbot/protocol";
import type { SettingsStore } from "./store";

function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatVnTime(date = new Date()): string {
  try {
    return date.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return date.toISOString().replace("T", " ").slice(0, 19);
  }
}

export interface DisconnectNoticeParams {
  accountId: string;
  username?: string;
  server?: string;
  characterName?: string;
  mapId?: number;
  reason: string;
  willReconnect?: boolean;
}

export interface ReconnectNoticeParams {
  accountId: string;
  username?: string;
  server?: string;
  characterName?: string;
  mapId?: number;
}

export class TelegramService {
  private lastDisconnectNotice = new Map<string, number>();
  private lastReconnectNotice = new Map<string, number>();

  constructor(private settings: SettingsStore) {}

  private getConfig(): TelegramConfig | undefined {
    return this.settings.get().telegram;
  }

  /** Gửi trực tiếp 1 tin nhắn định dạng HTML tới Telegram Bot API. */
  async send(text: string, override?: { botToken?: string; chatId?: string; apiRoot?: string }): Promise<TelegramTestResult> {
    const cfg = this.getConfig();
    const botToken = (override?.botToken ?? cfg?.botToken ?? "").trim();
    const chatId = (override?.chatId ?? cfg?.chatId ?? "").trim();
    const rawRoot = (override?.apiRoot ?? cfg?.apiRoot ?? "https://api.telegram.org").trim();
    const apiRoot = (rawRoot || "https://api.telegram.org").replace(/\/+$/, "");

    if (!botToken) {
      return { ok: false, message: "Chưa cấu hình Telegram Bot Token (lấy từ @BotFather)" };
    }
    if (!chatId) {
      return { ok: false, message: "Chưa cấu hình Telegram Chat ID hoặc Group ID" };
    }

    const url = `${apiRoot}/bot${botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });

      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (!res.ok || !data.ok) {
        return {
          ok: false,
          message: `Telegram phản hồi lỗi: ${data.description || `HTTP ${res.status} ${res.statusText}`}`,
        };
      }
      return { ok: true, message: "Gửi tin nhắn Telegram thành công" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Lỗi kết nối tới Telegram API: ${msg}` };
    }
  }

  /** Gửi tin nhắn thử nghiệm để kiểm tra Bot Token và Chat ID. */
  async test(override?: { botToken?: string; chatId?: string; apiRoot?: string }): Promise<TelegramTestResult> {
    const text = [
      "🤖 <b>[TS-BOT] KIỂM TRA KẾT NỐI THÀNH CÔNG</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `⏰ <b>Thời gian:</b> ${formatVnTime()}`,
      "✅ Tính năng giám sát Online Telegram đã sẵn sàng hoạt động!",
      "━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    return this.send(text, override);
  }

  /** Bắn thông báo khi có tài khoản bị ngắt kết nối (disconnect). */
  async notifyDisconnect(params: DisconnectNoticeParams): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg?.enabled || !cfg.notifyOnDisconnect) return;

    // Chống spam: không gửi thông báo ngắt kết nối của cùng 1 tài khoản quá 1 lần trong 10 giây
    const now = Date.now();
    const last = this.lastDisconnectNotice.get(params.accountId) ?? 0;
    if (now - last < 10_000) return;
    this.lastDisconnectNotice.set(params.accountId, now);

    const charStr = params.characterName ? escapeHtml(params.characterName) : "<i>(Chưa xác định)</i>";
    const mapStr = params.mapId !== undefined && params.mapId > 0 ? ` [Map: ${params.mapId}]` : "";
    const autoRelogStr = params.willReconnect
      ? "🔄 <i>Đang tự động kết nối lại...</i>"
      : "⏹️ <i>Đã ngắt hoàn toàn (không tự vào lại)</i>";

    const lines = [
      "🚨 <b>[TS-BOT] CẢNH BÁO MẤT KẾT NỐI</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `👤 <b>Tài khoản:</b> <code>${escapeHtml(params.username || params.accountId)}</code>`,
      `🌐 <b>Máy chủ:</b> ${escapeHtml(params.server || "Không rõ")}`,
      `🎮 <b>Nhân vật:</b> <b>${charStr}</b>${mapStr}`,
      `⏰ <b>Thời gian:</b> ${formatVnTime()}`,
      `⚠️ <b>Lý do:</b> <i>${escapeHtml(params.reason)}</i>`,
      `🔄 <b>Trạng thái:</b> ${autoRelogStr}`,
      "━━━━━━━━━━━━━━━━━━━━",
    ];

    try {
      const res = await this.send(lines.join("\n"));
      if (!res.ok) {
        console.warn(`[Telegram] Gửi cảnh báo mất kết nối (${params.accountId}) thất bại: ${res.message}`);
      }
    } catch (e) {
      console.warn(`[Telegram] Exception khi gửi cảnh báo mất kết nối:`, e);
    }
  }

  /** Bắn thông báo khi tài khoản kết nối lại thành công. */
  async notifyReconnect(params: ReconnectNoticeParams): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg?.enabled || !cfg.notifyOnReconnect) return;

    const now = Date.now();
    const last = this.lastReconnectNotice.get(params.accountId) ?? 0;
    if (now - last < 10_000) return;
    this.lastReconnectNotice.set(params.accountId, now);

    const charStr = params.characterName ? escapeHtml(params.characterName) : "<i>(Đã vào game)</i>";
    const mapStr = params.mapId !== undefined && params.mapId > 0 ? ` [Map: ${params.mapId}]` : "";

    const lines = [
      "✅ <b>[TS-BOT] KẾT NỐI LẠI THÀNH CÔNG</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `👤 <b>Tài khoản:</b> <code>${escapeHtml(params.username || params.accountId)}</code>`,
      `🌐 <b>Máy chủ:</b> ${escapeHtml(params.server || "Không rõ")}`,
      `🎮 <b>Nhân vật:</b> <b>${charStr}</b>${mapStr}`,
      `⏰ <b>Thời gian:</b> ${formatVnTime()}`,
      "━━━━━━━━━━━━━━━━━━━━",
    ];

    try {
      await this.send(lines.join("\n"));
    } catch (e) {
      console.warn(`[Telegram] Exception khi gửi thông báo kết nối lại:`, e);
    }
  }
}
