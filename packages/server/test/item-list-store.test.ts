import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ItemListStore", () => {
  let tempDir: string;
  let ItemListStoreClass: typeof import("../src/services/store").ItemListStore;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "item-list-test-"));
    process.env.DATA_DIR = tempDir;
    const mod = await import("../src/services/store");
    ItemListStoreClass = mod.ItemListStore;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    delete process.env.DATA_DIR;
  });

  it("canonicalKey correctly isolates accounts by clean username", () => {
    const store = new ItemListStoreClass();
    expect(store.canonicalKey("tuancn11")).toBe("tuancn11");
    expect(store.canonicalKey("tuancn11@_3_jiangling_m_i_")).toBe("tuancn11");
    expect(store.canonicalKey("TuanCN11")).toBe("tuancn11");
    expect(store.canonicalKey("tuancn12@another_server")).toBe("tuancn12");
    expect(store.canonicalKey("")).toBe("default");
  });

  it("persists items and ensures strict multi-account isolation", () => {
    const store = new ItemListStoreClass();

    // tuancn11 adds item 123456 to autoOpen
    store.update("tuancn11", "autoOpen", 123456, true);
    // tuancn11 adds item 456 to contribute
    store.update("tuancn11@_3_jiangling_m_i_", "contribute", 456, true);

    // Verify tuancn11 has both items
    const tuancn11Lists = store.get("tuancn11");
    expect(tuancn11Lists.autoOpen).toContain(123456);
    expect(tuancn11Lists.contribute).toContain(456);

    // Verify tuancn12 does NOT have items from tuancn11
    const tuancn12Lists = store.get("tuancn12");
    expect(tuancn12Lists.autoOpen).not.toContain(123456);
    expect(tuancn12Lists.autoOpen).toEqual([]);
    expect(tuancn12Lists.contribute).toEqual([]);

    // tuancn12 adds different item
    store.update("tuancn12", "discard", 999999, true);
    expect(store.get("tuancn12").discard).toContain(999999);
    expect(store.get("tuancn11").discard).not.toContain(999999);

    // Reinstantiate store to simulate server restart / subsequent login
    const reloadedStore = new ItemListStoreClass();
    const reloadedTuancn11 = reloadedStore.get("tuancn11@different_server");
    expect(reloadedTuancn11.autoOpen).toEqual([123456]);
    expect(reloadedTuancn11.contribute).toEqual([456]);

    const reloadedTuancn12 = reloadedStore.get("tuancn12");
    expect(reloadedTuancn12.discard).toEqual([999999]);
    expect(reloadedTuancn12.autoOpen).toEqual([]);
  });

  it("supports removing items from list", () => {
    const store = new ItemListStoreClass();
    store.update("tuancn11", "autoOpen", 123456, true);
    expect(store.get("tuancn11").autoOpen).toContain(123456);

    store.update("tuancn11", "autoOpen", 123456, false);
    expect(store.get("tuancn11").autoOpen).not.toContain(123456);
  });

  it("supports setList for batch import, sorting and deduplication per account", () => {
    const store = new ItemListStoreClass();
    const updated = store.setList("tuancn11", "autoOpen", [46001, 12005, 46001, -5, 0, 30000]);
    expect(updated.autoOpen).toEqual([12005, 30000, 46001]);
    expect(store.get("tuancn11").autoOpen).toEqual([12005, 30000, 46001]);

    expect(store.get("tuancn12").autoOpen).toEqual([]);
  });

  it("supports setToggle to enable/disable specific actions per account", () => {
    const store = new ItemListStoreClass();
    expect(store.get("tuancn11").toggles?.discard).toBe(true);

    store.setToggle("tuancn11", "discard", false);
    expect(store.get("tuancn11").toggles?.discard).toBe(false);

    expect(store.get("tuancn12").toggles?.discard).toBe(true);
  });

  it("supports setAutoSweepEnabled to toggle 1-minute periodic sweep per account", () => {
    const store = new ItemListStoreClass();
    expect(store.get("tuancn11").autoSweepEnabled).toBe(false);

    store.setAutoSweepEnabled("tuancn11", true);
    expect(store.get("tuancn11").autoSweepEnabled).toBe(true);
    expect(store.get("tuancn12").autoSweepEnabled).toBe(false);

    // Persists across reloads
    const reloaded = new ItemListStoreClass();
    expect(reloaded.get("tuancn11@subserver").autoSweepEnabled).toBe(true);
    expect(reloaded.get("tuancn12").autoSweepEnabled).toBe(false);
  });

  it("supports setBuySettings with multi-account isolation and persistence", () => {
    const store = new ItemListStoreClass();
    // Default buySettings
    expect(store.get("tuancn11").buySettings).toEqual({
      buyHpEnabled: true,
      buyHpQty: 999,
      buySpEnabled: true,
      buySpQty: 999,
    });

    // Update account tuancn11
    store.setBuySettings("tuancn11@server1", {
      buyHpEnabled: false,
      buyHpQty: 2500,
      buySpEnabled: true,
      buySpQty: 5000,
    });

    const acc11 = store.get("tuancn11");
    expect(acc11.buySettings?.buyHpEnabled).toBe(false);
    expect(acc11.buySettings?.buyHpQty).toBe(2500);
    expect(acc11.buySettings?.buySpEnabled).toBe(true);
    expect(acc11.buySettings?.buySpQty).toBe(5000);

    // tuancn12 remains default (Rule 2: multi-account isolation)
    const acc12 = store.get("tuancn12");
    expect(acc12.buySettings?.buyHpEnabled).toBe(true);
    expect(acc12.buySettings?.buyHpQty).toBe(999);

    // Re-instantiate store and verify persistence on disk
    const reloaded = new ItemListStoreClass();
    expect(reloaded.get("tuancn11").buySettings?.buyHpQty).toBe(2500);
    expect(reloaded.get("tuancn12").buySettings?.buyHpQty).toBe(999);
  });

  it("supports sell list management with multi-account isolation", () => {
    const store = new ItemListStoreClass();
    expect(store.get("tuancn11").sell).toEqual([]);

    // Add Nồi Đất (32043) to tuancn11's sell list
    store.update("tuancn11@server1", "sell", 32043, true);
    expect(store.get("tuancn11").sell).toEqual([32043]);
    // Remove item
    store.update("tuancn11", "sell", 32043, false);
    expect(store.get("tuancn11").sell).toEqual([]);
  });

  it("supports autoHeal configuration with 100% multi-account isolation (Rule 2)", () => {
    const store = new ItemListStoreClass();

    // tuancn11 ban đầu có cấu hình mặc định
    const initial11 = store.get("tuancn11@server1");
    expect(initial11.autoHeal?.enabled).toBe(true);
    expect(initial11.autoHeal?.player.autoHp).toBe(false);
    expect(initial11.autoHeal?.player.hpPct).toBe(50);

    // Cập nhật cấu hình riêng cho tài khoản tuancn11
    store.setAutoHeal("tuancn11@server1", {
      enabled: true,
      player: { autoHp: true, hpPct: 80, autoSp: true, spPct: 65 },
      pet: { autoHp: true, hpPct: 70, autoSp: false, spPct: 40 },
    });

    // Tài khoản tuancn11 nhận đúng cấu hình đã lưu
    const updated11 = store.get("tuancn11");
    expect(updated11.autoHeal?.player.autoHp).toBe(true);
    expect(updated11.autoHeal?.player.hpPct).toBe(80);
    expect(updated11.autoHeal?.player.autoSp).toBe(true);
    expect(updated11.autoHeal?.player.spPct).toBe(65);
    expect(updated11.autoHeal?.pet.hpPct).toBe(70);

    // Tài khoản tuancn12 KHÔNG bị ảnh hưởng (phân lập tuyệt đối)
    const acc12 = store.get("tuancn12@server2");
    expect(acc12.autoHeal?.player.autoHp).toBe(false);
    expect(acc12.autoHeal?.player.hpPct).toBe(50);
    expect(acc12.autoHeal?.player.autoSp).toBe(false);
    expect(acc12.autoHeal?.pet.hpPct).toBe(50);

    // Kiểm tra lưu bền vững trên ổ đĩa khi reload store
    const reloaded = new ItemListStoreClass();
    expect(reloaded.get("tuancn11").autoHeal?.player.hpPct).toBe(80);
    expect(reloaded.get("tuancn12").autoHeal?.player.hpPct).toBe(50);
  });

  it("supports recordCombineToday and hasCombinedToday with multi-account isolation and disk persistence", () => {
    const store = new ItemListStoreClass();

    expect(store.hasCombinedToday("tuancn11", "2026-10-27")).toBe(false);
    expect(store.hasCombinedToday("tuancn12", "2026-10-27")).toBe(false);

    // Ghi nhận cờ cho tuancn11
    store.recordCombineToday("tuancn11@server1", "2026-10-27");
    expect(store.hasCombinedToday("tuancn11", "2026-10-27")).toBe(true);
    expect(store.hasCombinedToday("tuancn11@different_server", "2026-10-27")).toBe(true);
    expect(store.get("tuancn11").lastCombinedDate).toBe("2026-10-27");

    // tuancn12 không bị ảnh hưởng (Rule 2)
    expect(store.hasCombinedToday("tuancn12", "2026-10-27")).toBe(false);
    expect(store.get("tuancn12").lastCombinedDate).toBeUndefined();

    // Sang ngày mới 2026-10-28 cờ ngày cũ tự hết hiệu lực
    expect(store.hasCombinedToday("tuancn11", "2026-10-28")).toBe(false);

    // Reload store (mô phỏng relogin / restart bot)
    const reloaded = new ItemListStoreClass();
    expect(reloaded.hasCombinedToday("tuancn11", "2026-10-27")).toBe(true);
    expect(reloaded.hasCombinedToday("tuancn12", "2026-10-27")).toBe(false);
  });
});
