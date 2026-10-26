/**
 * EscortService — Tự động VẬN TIÊU & NHÀ TRỌ (tối đa 3 lượt / ngày, cách nhau 4 giờ).
 * Phân lập độc lập 100% giữa các tài khoản theo Rule 2.
 * Tự động quét mỗi 30 phút. Chỉ cử DUY NHẤT pet được chỉ định trong dropdownlist đi vận tiêu.
 * Tự động nhận quà hoàn tất chuyến vận tiêu và tiếp tục loop cho đến hết 3 lượt/ngày.
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

  /** Nhận thưởng vận tiêu thủ công hoặc qua API. */
  async claimFor(accountId: string): Promise<{ ok: boolean; message: string }> {
    const conn = this.host.get(accountId);
    if (!conn) return { ok: false, message: "Tài khoản chưa kết nối" };
    try {
      await conn.dispatch("escort_claim");
      const ch = conn.character();
      const dailyCount = ch?.escort?.dailyCount ?? 0;
      if (this.checklistStore) {
        this.checklistStore.setProgress(accountId, "escort", dailyCount);
      }
      this.host.pushCharacter(accountId);
      return { ok: true, message: "Đã nhận phần thưởng hoàn tất Vận Tiêu thành công!" };
    } catch (e) {
      return { ok: false, message: `Lỗi nhận thưởng: ${(e as Error).message}` };
    }
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

      // 1. Kiểm tra xem chuyến vận tiêu hiện tại đã hoàn tất (quá endTime) chưa
      const ch = conn.character();
      const active = ch?.escort?.activeEscort;
      if (active && now >= active.endTime && !this.running.has(cKey)) {
        conn.log(
          "info",
          `🎁 [Vận Tiêu] Chuyến vận tiêu của võ tướng ô ${active.slot} (${active.petName ?? "Pet"}) đã hoàn tất! Tự động nhận thưởng và xử lý lượt tiếp theo...`,
        );
        void this.processAccount(accountId, conn, false);
        continue;
      }

      // 2. Nếu cấu hình auto bật và đã đến hạn 30 phút quét
      if (cfg.enabled && now - last >= SCAN_INTERVAL_MS) {
        this.lastScan.set(cKey, now);
        void this.processAccount(accountId, conn, false);
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
      let ch = conn.character();
      if (!ch) return { ok: false, message: "Chưa tải xong dữ liệu nhân vật" };

      // Gửi truy vấn trạng thái mới nhất từ server
      try {
        await conn.dispatch("escort_query");
        await new Promise((r) => setTimeout(r, 400));
        ch = conn.character() ?? ch;
      } catch {}

      let dailyCount = ch.escort?.dailyCount ?? 0;
      const active = ch.escort?.activeEscort;
      const now = Date.now();

      // TRƯỜNG HỢP 1: Có chuyến vận tiêu ĐÃ HOÀN TẤT (now >= active.endTime) -> TỰ ĐỘNG NHẬN QUÀ
      if (active && now >= active.endTime) {
        conn.log(
          "info",
          `🎁 [Vận Tiêu] Chuyến vận tiêu ô ${active.slot} (${active.petName ?? "Pet"}) đã hoàn thành! Đang gửi gói 56/05 nhận thưởng và giải phóng pet...`,
        );
        try {
          await conn.dispatch("escort_claim");
          await new Promise((r) => setTimeout(r, 1200));
          await conn.dispatch("escort_query");
          await new Promise((r) => setTimeout(r, 400));
        } catch (err: any) {
          conn.log("warn", `[Vận Tiêu] Lỗi khi nhận thưởng: ${err?.message || err}`);
        }

        // Cập nhật lại character state và dailyCount sau khi nhận quà
        ch = conn.character() ?? ch;
        dailyCount = ch.escort?.dailyCount ?? dailyCount;

        if (this.checklistStore) {
          this.checklistStore.setProgress(accountId, "escort", dailyCount);
        }

        // Nếu đã hết 3 lượt trong ngày
        if (dailyCount >= 3) {
          conn.log("info", "🎉 [Vận Tiêu] Đã hoàn thành toàn bộ 3/3 lượt vận tiêu trong ngày hôm nay!");
          if (this.checklistStore) {
            this.checklistStore.setProgress(accountId, "escort", 3);
          }
          this.host.pushCharacter(accountId);
          return {
            ok: true,
            message: "Đã nhận thưởng hoàn tất chuyến vận tiêu! Đã hoàn thành tối đa 3/3 lượt hôm nay.",
          };
        }

        // Nếu vẫn còn lượt (dailyCount < 3), tiếp tục cử pet đi tiếp lượt tiếp theo!
        conn.log("info", `🐎 [Vận Tiêu] Đã nhận thưởng xong. Tiếp tục cử võ tướng đi lượt tiếp theo (${dailyCount + 1}/3)...`);
        await new Promise((r) => setTimeout(r, 1000));
      } else if (active && now < active.endTime) {
        // TRƯỜNG HỢP 2: Chuyến vận tiêu đang diễn ra
        const remainingMin = Math.ceil((active.endTime - now) / 60000);
        return {
          ok: false,
          message: `Đang có chuyến vận tiêu diễn ra (còn khoảng ${remainingMin} phút)`,
        };
      }

      // TRƯỜNG HỢP 3: Kiểm tra số lượt còn lại trong ngày trước khi bắt đầu lượt mới
      ch = conn.character() ?? ch;
      dailyCount = ch.escort?.dailyCount ?? 0;
      if (dailyCount >= 3) {
        if (this.checklistStore) {
          this.checklistStore.setProgress(accountId, "escort", 3);
        }
        return {
          ok: false,
          message: "Đã hết lượt vận tiêu hôm nay (tối đa 3/3 lượt)!",
        };
      }

      // 4. Kiểm tra danh sách pet trong Nhà Trọ
      let innPets = ch.innPets ?? [];
      if (innPets.length === 0) {
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

      // 5. KIỂM THỬ RÀNG BUỘC CHẶT CHẼ: CHỈ CỬ DUY NHẤT PET ĐƯỢC CHỌN
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

      // 6. Cử pet đã chọn đi vận tiêu
      conn.log(
        "info",
        `🐎 [Vận Tiêu] Tiến hành cử võ tướng đã chọn: ${targetPet.name} (ô ${targetSlot}, Lv.${targetPet.level}) xuất phát vận tiêu...`,
      );

      // Gửi lệnh bắt đầu vận tiêu
      await conn.dispatch("escort_start", { slot: String(targetSlot) });
      await new Promise((r) => setTimeout(r, 1500));

      // Kiểm tra lại trạng thái
      await conn.dispatch("escort_query");

      // Cập nhật tiến độ vào Daily Checklist
      const updatedCount = dailyCount + 1;
      if (this.checklistStore) {
        this.checklistStore.setProgress(accountId, "escort", updatedCount);
      }

      this.host.pushCharacter(accountId);
      return {
        ok: true,
        message: `Đã cử thành công võ tướng ${targetPet.name} (ô ${targetSlot}) đi vận tiêu! (Lượt ${updatedCount}/3)`,
      };
    } catch (e) {
      return { ok: false, message: `Lỗi khi thực hiện vận tiêu: ${(e as Error).message}` };
    } finally {
      this.running.delete(cKey);
    }
  }
}
