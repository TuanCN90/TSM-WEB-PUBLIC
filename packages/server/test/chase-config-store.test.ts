import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("ChaseConfigStore", () => {
  let tempDir: string;
  let ChaseConfigStoreClass: typeof import("../src/services/store").ChaseConfigStore;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "chase-config-test-"));
    process.env.DATA_DIR = tempDir;
    const mod = await import("../src/services/store");
    ChaseConfigStoreClass = mod.ChaseConfigStore;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    delete process.env.DATA_DIR;
  });

  it("canonicalKey correctly isolates accounts by clean username", () => {
    const store = new ChaseConfigStoreClass();
    expect(store.canonicalKey("tuancn11")).toBe("tuancn11");
    expect(store.canonicalKey("tuancn11@server1")).toBe("tuancn11");
    expect(store.canonicalKey("TuanCN11")).toBe("tuancn11");
    expect(store.canonicalKey("userB@server2")).toBe("userb");
    expect(store.canonicalKey("")).toBe("default");
  });

  it("saves and isolates chase configs strictly per account", () => {
    const store = new ChaseConfigStoreClass();

    // Account 1: tuancn11 train tại Rừng 30 Đấu Vật (Map 12815, 230, 1570, maxRadius 120)
    store.set("tuancn11@server1", {
      enabled: true,
      mapId: 12815,
      originX: 230,
      originY: 1570,
      maxRadius: 120,
      npcId: 11047,
      npcName: "Đấu Vật",
      autoReturn: true,
    });

    // Account 2: userB train tại Map khác (11002, 450, 600, maxRadius 200)
    store.set("userB@server2", {
      enabled: true,
      mapId: 11002,
      originX: 450,
      originY: 600,
      maxRadius: 200,
      npcId: 12005,
      npcName: "Lưu Bị",
      autoReturn: false,
    });

    const cfg1 = store.get("tuancn11");
    expect(cfg1.enabled).toBe(true);
    expect(cfg1.mapId).toBe(12815);
    expect(cfg1.originX).toBe(230);
    expect(cfg1.originY).toBe(1570);
    expect(cfg1.maxRadius).toBe(120);
    expect(cfg1.npcName).toBe("Đấu Vật");
    expect(cfg1.autoReturn).toBe(true);

    const cfg2 = store.get("userB");
    expect(cfg2.enabled).toBe(true);
    expect(cfg2.mapId).toBe(11002);
    expect(cfg2.originX).toBe(450);
    expect(cfg2.originY).toBe(600);
    expect(cfg2.maxRadius).toBe(200);
    expect(cfg2.npcName).toBe("Lưu Bị");
    expect(cfg2.autoReturn).toBe(false);

    // Tài khoản khác chưa cấu hình trả về mặc định
    const cfg3 = store.get("userC");
    expect(cfg3.enabled).toBe(false);
    expect(cfg3.maxRadius).toBe(150);
    expect(cfg3.autoReturn).toBe(true);
  });
});
