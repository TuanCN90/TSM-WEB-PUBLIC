/**
 * EscortService — Tự động VẬN TIÊU & NHÀ TRỌ (tối đa 3 lượt / ngày, cách nhau 4 giờ).
 * Phân lập độc lập 100% giữa các tài khoản theo Rule 2.
 * Tự động quét mỗi 30 phút. Chỉ cử DUY NHẤT pet được chỉ định trong dropdownlist đi vận tiêu.
 */
import type { GameConnection } from "@tsbot/engine";
import type { EscortConfig, EscortState } from "@tsbot/protocol";
import type { DailyChecklistStore, EscortConfigStore } from "./store";

const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 phút auto quét 1 lần theo yêu cầu
const TICK_CHECK_MS = 10_000; // Kiểm tra timer hoàn tất mỗi 10 giây

const canon = (accountId: string) => {
  const raw = (accountId ?? "").trim();
  if (!raw) return "default";
  const at = raw.indexOf("@");
  return (at > 0 ? raw.slice(0, at) : raw).toLowerCase();
};

export interface EscortHost {
  entries(): [string, GameConnection][];
  get(accountId: string): GameConnection | undefined;
  pushCharacter(accountId: string): void;
}

export class EscortService {
  private timer?: ReturnType<typeof setInterval>;
  private lastScan = new Map<string, number>();
  private running = new Set<string>();

  constructor(
    private host: EscortHost,
    private store: EscortConfigStore,
    private checklistStore?: DailyChecklistStore,
  ) {}

  start() {
    this.timer ??= setInterval(() => {
      void this.tick();
    }, TICK_CHECK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Chạy quét ngay lập tức cho 1 tài khoản (bấm nút 'Vận Tiêu Ngay'). */
  async triggerFor(accountId: string): Promise<{ ok: boolean; message: string }> {
    const conn = this.host.get(accountId);
    if (!conn) return { ok: false, message: "Tài khoản chưa kết nối" };
    return this.processAccount(accountId, conn, true);
  }

  /** Mở Nhà Trọ và tải danh sách võ tướng cho tài khoản. */
  async openInn(accountId: string): Promise<{ ok: boolean; message: string }> {
    const conn = this.host.get(accountId);
    if (!conn) return { ok: false, message: "Tài khoản chưa kết nối" };
    try {
      await conn.dispatch("open_inn");
      return { ok: true, message: "Đang di chuyển tới Khách Sạn Trác Quận và mở Nhà Trọ..." };
    } catch (e) {
      return { ok: false, message: `Lỗi mở Nhà Trọ: ${(e as Error).message}` };
    }
  }

  private async tick() {
    const now = Date.now();
    for (const [accountId, conn] of this.host.entries()) {
      const cKey = canon(accountId);
      const last = this.lastScan.get(cKey) ?? 0;
      const cfg = this.store.get(accountId);

      // Nếu cấu hình auto bật và đã đến hạn 30 phút quét
      if (cfg.enabled && now - last >= SCAN_INTERVAL_MS) {
        this.lastScan.set(cKey, now);
        void this.processAccount(accountId, conn, false);
      } else {
        // Kiểm tra xem có chuyến vận tiêu nào vừa hoàn thành không (đã qua endTime)
        const ch = conn.character();
        const active = ch?.escort?.activeEscort;
        if (active && now >= active.endTime && !this.running.has(cKey)) {
          // Gửi truy vấn trạng thái để nhận thưởng / giải phóng pet
          try {
            await conn.dispatch("escort_query");
          } catch {
            // bỏ qua lỗi
          }
        }
      }
    }
  }

  private async processAccount(
    accountId: string,
    conn: GameConnection,
    manual: boolean,
  ): Promise<{ ok: boolean; message: string }> {
    const cKey = canon(accountId);
    if (this.running.has(cKey)) {
      return { ok: false, message: "Đang có tiến trình vận tiêu xử lý cho tài khoản này" };
    }

    const cfg = this.store.get(accountId);
    if (!manual && !cfg.enabled) {
      return { ok: false, message: "Tính năng tự động vận tiêu đang tắt" };
    }

    this.running.add(cKey);
    try {
      const ch = conn.character();
      if (!ch) return { ok: false, message: "Chưa tải xong dữ liệu nhân vật" };

      // 1. Kiểm tra số lượt trong ngày
      const dailyCount = ch.escort?.dailyCount ?? 0;
      if (dailyCount >= 3) {
        if (this.checklistStore) {
          this.checklistStore.recordProgress(accountId, "escort", 3);
        }
        return { ok: true, message: "Đã hoàn thành tối đa 3/3 lượt vận tiêu hôm nay!" };
      }

      // 2. Kiểm tra xem có đang vận tiêu không
      const active = ch.escort?.activeEscort;
      if (active && Date.now() < active.endTime) {
        const remainingMin = Math.ceil((active.endTime - Date.now()) / 60000);
        return {
          ok: false,
          message: `Đang có chuyến vận tiêu diễn ra (còn khoảng ${remainingMin} phút)`,
        };
      }

      // 3. Kiểm tra danh sách pet trong Nhà Trọ
      let innPets = ch.innPets ?? [];
      if (innPets.length === 0) {
        // Chưa có thông tin pet nhà trọ -> di chuyển đến Nhà Trọ để mở
        conn.log("info", "🏡 [Vận Tiêu] Chưa có dữ liệu Nhà Trọ, đang đến Khách Sạn Trác Quận để tải danh sách...");
        await conn.dispatch("open_inn");
        await new Promise((r) => setTimeout(r, 4000));
        innPets = conn.character()?.innPets ?? [];
      }

      if (innPets.length === 0) {
        return {
          ok: false,
          message: "Nhà Trọ hiện chưa có võ tướng nào gửi hoặc chưa tải được danh sách",
        };
      }

      // 4. KIỂM THỬ RÀNG BUỘC CHẶT CHẼ: CHỈ CỬ DUY NHẤT PET ĐƯỢC CHỌN
      const targetSlot = cfg.selectedPetSlot ?? 1;
      const targetPet = innPets.find((p) => p.slot === targetSlot);

      if (!targetPet) {
        conn.log(
          "warn",
          `⚠️ [Vận Tiêu] Không tìm thấy võ tướng tại ô chỉ định ${targetSlot} trong Nhà Trọ! TUYỆT ĐỐI KHÔNG DÙNG PET KHÁC theo yêu cầu bảo mật.`,
        );
        return {
          ok: false,
          message: `Không tìm thấy võ tướng ô ${targetSlot} được chỉ định để vận tiêu! Hệ thống tuyệt đối không dùng pet khác.`,
        };
      }

      if (targetPet.status === 1) {
        return {
          ok: false,
          message: `Võ tướng ${targetPet.name} (ô ${targetSlot}) hiện đang trong chuyến vận tiêu khác!`,
        };
      }

      // 5. Cử pet đã chọn đi vận tiêu
      conn.log(
        "info",
        `🐎 [Vận Tiêu] Tiến hành cử võ tướng đã chọn: ${targetPet.name} (ô ${targetSlot}, Lv.${targetPet.level}) xuất phát vận tiêu...`,
      );

      // Nếu đang không ở map 12007 (Khách sạn Trác Quận), warp đến đó trước
      if (conn.character()?.location.map !== 12007) {
        await conn.dispatch("open_inn");
        await new Promise((r) => setTimeout(r, 3000));
      }

      // Gửi lệnh bắt đầu vận tiêu
      await conn.dispatch("escort_start", { slot: String(targetSlot) });
      await new Promise((r) => setTimeout(r, 1500));

      // Kiểm tra lại trạng thái
      await conn.dispatch("escort_query");

      // Cập nhật tiến độ vào Daily Checklist
      if (this.checklistStore) {
        this.checklistStore.recordProgress(accountId, "escort", dailyCount + 1);
      }

      this.host.pushCharacter(accountId);
      return {
        ok: true,
        message: `Đã cử thành công võ tướng ${targetPet.name} (ô ${targetSlot}) đi vận tiêu! (Lượt ${dailyCount + 1}/3)`,
      };
    } catch (e) {
      return { ok: false, message: `Lỗi khi thực hiện vận tiêu: ${(e as Error).message}` };
    } finally {
      this.running.delete(cKey);
    }
  }
}
