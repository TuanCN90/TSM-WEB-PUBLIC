import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("BattleConfigStore", () => {
  let tempDir: string;
  let BattleConfigStoreClass: typeof import("../src/services/store").BattleConfigStore;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "battle-config-test-"));
    process.env.DATA_DIR = tempDir;
    const mod = await import("../src/services/store");
    BattleConfigStoreClass = mod.BattleConfigStore;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    delete process.env.DATA_DIR;
  });

  it("canonicalKey correctly isolates accounts by clean username", () => {
    const store = new BattleConfigStoreClass();
    expect(store.canonicalKey("tuancn11")).toBe("tuancn11");
    expect(store.canonicalKey("tuancn11@server1")).toBe("tuancn11");
    expect(store.canonicalKey("TuanCN11")).toBe("tuancn11");
    expect(store.canonicalKey("userB@server2")).toBe("userb");
    expect(store.canonicalKey("")).toBe("default");
  });

  it("saves and isolates battle configs per account including 21-turn strategy", () => {
    const store = new BattleConfigStoreClass();

    // Account 1 (tuancn11) configures: Turn 1: Char + Pet Def, Turn 2: Char Attack, Pet Def
    store.set("tuancn11", {
      playerAction: { type: "attack", skillId: 10000, target: "F1" },
      petAction: { type: "attack", skillId: 10000, target: "F1" },
      autoFight: true,
      turns: [
        {
          turn: 1,
          playerAction: { type: "defend", skillId: 17001, target: "F1" },
          petAction: { type: "defend", skillId: 17001, target: "F1" },
        },
        {
          turn: 2,
          playerAction: { type: "attack", skillId: 10000, target: "F1" },
          petAction: { type: "defend", skillId: 17001, target: "F1" },
        },
      ],
    });

    // Account 2 (userB) has different config
    store.set("userB@server1", {
      playerAction: { type: "skill", skillId: 12001, target: "F1" },
      petAction: { type: "skill", skillId: 17002, target: "F1" },
      autoFight: true,
      turns: [],
    });

    // Read back Account 1
    const cfgA = store.get("tuancn11@another_server");
    expect(cfgA).toBeDefined();
    expect(cfgA?.turns).toHaveLength(2);
    expect(cfgA?.turns?.[0]?.turn).toBe(1);
    expect(cfgA?.turns?.[0]?.playerAction.skillId).toBe(17001);
    expect(cfgA?.turns?.[0]?.petAction.skillId).toBe(17001);
    expect(cfgA?.turns?.[1]?.playerAction.skillId).toBe(10000);
    expect(cfgA?.turns?.[1]?.petAction.skillId).toBe(17001);

    // Read back Account 2
    const cfgB = store.get("userb");
    expect(cfgB).toBeDefined();
    expect(cfgB?.playerAction.skillId).toBe(12001);
    expect(cfgB?.turns).toHaveLength(0);

    // Reload store from file to ensure persistence
    const reloaded = new BattleConfigStoreClass();
    const persistedA = reloaded.get("tuancn11");
    expect(persistedA?.turns).toHaveLength(2);
    expect(persistedA?.turns?.[0]?.playerAction.skillId).toBe(17001);
  });
});
