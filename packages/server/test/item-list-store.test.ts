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
    expect(store.canonicalKey("user_test_01")).toBe("user_test_01");
    expect(store.canonicalKey("user_test_01@_3_jiangling_m_i_")).toBe("user_test_01");
    expect(store.canonicalKey("User_Test_01")).toBe("user_test_01");
    expect(store.canonicalKey("user_test_02@another_server")).toBe("user_test_02");
    expect(store.canonicalKey("")).toBe("default");
  });

  it("persists items and ensures strict multi-account isolation", () => {
    const store = new ItemListStoreClass();

    // user_test_01 adds item 123456 to autoOpen
    store.update("user_test_01", "autoOpen", 123456, true);
    // user_test_01 adds item 456 to contribute
    store.update("user_test_01@_3_jiangling_m_i_", "contribute", 456, true);

    // Verify user_test_01 has both items
    const user_test_01Lists = store.get("user_test_01");
    expect(user_test_01Lists.autoOpen).toContain(123456);
    expect(user_test_01Lists.contribute).toContain(456);

    // Verify user_test_02 does NOT have items from user_test_01
    const user_test_02Lists = store.get("user_test_02");
    expect(user_test_02Lists.autoOpen).not.toContain(123456);
    expect(user_test_02Lists.autoOpen).toEqual([]);
    expect(user_test_02Lists.contribute).toEqual([]);

    // user_test_02 adds different item
    store.update("user_test_02", "discard", 999999, true);
    expect(store.get("user_test_02").discard).toContain(999999);
    expect(store.get("user_test_01").discard).not.toContain(999999);

    // Reinstantiate store to simulate server restart / subsequent login
    const reloadedStore = new ItemListStoreClass();
    const reloadedTuancn11 = reloadedStore.get("user_test_01@different_server");
    expect(reloadedTuancn11.autoOpen).toEqual([123456]);
    expect(reloadedTuancn11.contribute).toEqual([456]);

    const reloadedTuancn12 = reloadedStore.get("user_test_02");
    expect(reloadedTuancn12.discard).toEqual([999999]);
    expect(reloadedTuancn12.autoOpen).toEqual([]);
  });

  it("supports removing items from list", () => {
    const store = new ItemListStoreClass();
    store.update("user_test_01", "autoOpen", 123456, true);
    expect(store.get("user_test_01").autoOpen).toContain(123456);

    store.update("user_test_01", "autoOpen", 123456, false);
    expect(store.get("user_test_01").autoOpen).not.toContain(123456);
  });

  it("supports setList for batch import, sorting and deduplication per account", () => {
    const store = new ItemListStoreClass();
    const updated = store.setList("user_test_01", "autoOpen", [46001, 12005, 46001, -5, 0, 30000]);
    expect(updated.autoOpen).toEqual([12005, 30000, 46001]);
    expect(store.get("user_test_01").autoOpen).toEqual([12005, 30000, 46001]);

    expect(store.get("user_test_02").autoOpen).toEqual([]);
  });

  it("supports setToggle to enable/disable specific actions per account", () => {
    const store = new ItemListStoreClass();
    expect(store.get("user_test_01").toggles?.discard).toBe(true);

    store.setToggle("user_test_01", "discard", false);
    expect(store.get("user_test_01").toggles?.discard).toBe(false);

    expect(store.get("user_test_02").toggles?.discard).toBe(true);
  });

  it("supports setAutoSweepEnabled to toggle 1-minute periodic sweep per account", () => {
    const store = new ItemListStoreClass();
    expect(store.get("user_test_01").autoSweepEnabled).toBe(false);

    store.setAutoSweepEnabled("user_test_01", true);
    expect(store.get("user_test_01").autoSweepEnabled).toBe(true);
    expect(store.get("user_test_02").autoSweepEnabled).toBe(false);

    // Persists across reloads
    const reloaded = new ItemListStoreClass();
    expect(reloaded.get("user_test_01@subserver").autoSweepEnabled).toBe(true);
    expect(reloaded.get("user_test_02").autoSweepEnabled).toBe(false);
  });

  it("supports setBuySettings with multi-account isolation and persistence", () => {
    const store = new ItemListStoreClass();
    // Default buySettings
    expect(store.get("user_test_01").buySettings).toEqual({
      buyHpEnabled: true,
      buyHpQty: 999,
      buySpEnabled: true,
      buySpQty: 999,
    });

    // Update account user_test_01
    store.setBuySettings("user_test_01@server1", {
      buyHpEnabled: false,
      buyHpQty: 2500,
      buySpEnabled: true,
      buySpQty: 5000,
    });

    const acc11 = store.get("user_test_01");
    expect(acc11.buySettings?.buyHpEnabled).toBe(false);
    expect(acc11.buySettings?.buyHpQty).toBe(2500);
    expect(acc11.buySettings?.buySpEnabled).toBe(true);
    expect(acc11.buySettings?.buySpQty).toBe(5000);

    // user_test_02 remains default (Rule 2: multi-account isolation)
    const acc12 = store.get("user_test_02");
    expect(acc12.buySettings?.buyHpEnabled).toBe(true);
    expect(acc12.buySettings?.buyHpQty).toBe(999);

    // Re-instantiate store and verify persistence on disk
    const reloaded = new ItemListStoreClass();
    expect(reloaded.get("user_test_01").buySettings?.buyHpQty).toBe(2500);
    expect(reloaded.get("user_test_02").buySettings?.buyHpQty).toBe(999);
  });

  it("supports sell list management with multi-account isolation", () => {
    const store = new ItemListStoreClass();
    expect(store.get("user_test_01").sell).toEqual([]);

    // Add Nồi Đất (32043) to user_test_01's sell list
    store.update("user_test_01@server1", "sell", 32043, true);
    expect(store.get("user_test_01").sell).toEqual([32043]);
    // Remove item
    store.update("user_test_01", "sell", 32043, false);
    expect(store.get("user_test_01").sell).toEqual([]);
  });

  it("supports autoHeal configuration with 100% multi-account isolation (Rule 2)", () => {
    const store = new ItemListStoreClass();

    // user_test_01 ban đầu có cấu hình mặc định
    const initial11 = store.get("user_test_01@server1");
    expect(initial11.autoHeal?.enabled).toBe(true);
    expect(initial11.autoHeal?.player.autoHp).toBe(false);
    expect(initial11.autoHeal?.player.hpPct).toBe(50);

    // Cập nhật cấu hình riêng cho tài khoản user_test_01
    store.setAutoHeal("user_test_01@server1", {
      enabled: true,
      player: { autoHp: true, hpPct: 80, autoSp: true, spPct: 65 },
      pet: { autoHp: true, hpPct: 70, autoSp: false, spPct: 40 },
    });

    // Tài khoản user_test_01 nhận đúng cấu hình đã lưu
    const updated11 = store.get("user_test_01");
    expect(updated11.autoHeal?.player.autoHp).toBe(true);
    expect(updated11.autoHeal?.player.hpPct).toBe(80);
    expect(updated11.autoHeal?.player.autoSp).toBe(true);
    expect(updated11.autoHeal?.player.spPct).toBe(65);
    expect(updated11.autoHeal?.pet.hpPct).toBe(70);

    // Tài khoản user_test_02 KHÔNG bị ảnh hưởng (phân lập tuyệt đối)
    const acc12 = store.get("user_test_02@server2");
    expect(acc12.autoHeal?.player.autoHp).toBe(false);
    expect(acc12.autoHeal?.player.hpPct).toBe(50);
    expect(acc12.autoHeal?.player.autoSp).toBe(false);
    expect(acc12.autoHeal?.pet.hpPct).toBe(50);

    // Kiểm tra lưu bền vững trên ổ đĩa khi reload store
    const reloaded = new ItemListStoreClass();
    expect(reloaded.get("user_test_01").autoHeal?.player.hpPct).toBe(80);
    expect(reloaded.get("user_test_02").autoHeal?.player.hpPct).toBe(50);
  });
});
