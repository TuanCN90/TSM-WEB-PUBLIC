import type { BattleActionConfig, BattleConfig, BattleTurnConfig, BattleUnit, CharacterState } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { api } from "../api";
import { LogPanel } from "./LogPanel";
import { useToast } from "./Toast";

type Act = (action: string, params?: Record<string, string | number>) => Promise<void>;

const CORE_PLAYER_ACTIONS = [
  { id: 10000, name: "🥊 Đấu Vật (Đánh thường)" },
  { id: 17001, name: "🛡️ Phòng Ngự" },
  { id: 18001, name: "🏃 Bỏ Chạy" },
  { id: 15001, name: "🕸️ Bắt Cóc (Bắt NPC)" },
];

const CORE_PET_ACTIONS = [
  { id: 10000, name: "🥊 Đấu Vật (Đánh thường)" },
  { id: 17001, name: "🛡️ Phòng Ngự" },
  { id: 18001, name: "🏃 Bỏ Chạy" },
];

interface SlotDef {
  slotId: number;
  label: string;
  side: "enemy" | "pet" | "player";
  row: number; // game row (0 = front enemy, 1 = back enemy, 2 = pet, 3 = player)
  col: number; // game col (0..4)
}

// 10 Vị trí Phe Địch: Hàng sau (row 1), Hàng trước (row 0)
const ENEMY_BACK_SLOTS: SlotDef[] = [
  { slotId: 1, label: "(1,0)", side: "enemy", row: 1, col: 0 },
  { slotId: 2, label: "(1,1)", side: "enemy", row: 1, col: 1 },
  { slotId: 3, label: "(1,2)", side: "enemy", row: 1, col: 2 },
  { slotId: 4, label: "(1,3)", side: "enemy", row: 1, col: 3 },
  { slotId: 5, label: "(1,4)", side: "enemy", row: 1, col: 4 },
];

const ENEMY_FRONT_SLOTS: SlotDef[] = [
  { slotId: 6, label: "(0,0)", side: "enemy", row: 0, col: 0 },
  { slotId: 7, label: "(0,1)", side: "enemy", row: 0, col: 1 },
  { slotId: 8, label: "(0,2)", side: "enemy", row: 0, col: 2 },
  { slotId: 9, label: "(0,3)", side: "enemy", row: 0, col: 3 },
  { slotId: 10, label: "(0,4)", side: "enemy", row: 0, col: 4 },
];

// 10 Vị trí Phe Ta: Hàng trước (Võ tướng / Pet, row 2), Hàng sau (Nhân vật / Party, row 3)
const ALLY_FRONT_SLOTS: SlotDef[] = [
  { slotId: 11, label: "(2,0)", side: "pet", row: 2, col: 0 },
  { slotId: 12, label: "(2,1)", side: "pet", row: 2, col: 1 },
  { slotId: 13, label: "(2,2)", side: "pet", row: 2, col: 2 },
  { slotId: 14, label: "(2,3)", side: "pet", row: 2, col: 3 },
  { slotId: 15, label: "(2,4)", side: "pet", row: 2, col: 4 },
];

const ALLY_BACK_SLOTS: SlotDef[] = [
  { slotId: 16, label: "(3,0)", side: "player", row: 3, col: 0 },
  { slotId: 17, label: "(3,1)", side: "player", row: 3, col: 1 },
  { slotId: 18, label: "(3,2)", side: "player", row: 3, col: 2 },
  { slotId: 19, label: "(3,3)", side: "player", row: 3, col: 3 },
  { slotId: 20, label: "(3,4)", side: "player", row: 3, col: 4 },
];

function MiniBar({ kind, cur, max }: { kind: "hp" | "sp"; cur: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (cur / max) * 100)) : 0;
  const isHp = kind === "hp";
  const barBg = isHp
    ? "linear-gradient(90deg, #ff4d4f, #ff7875)"
    : "linear-gradient(90deg, #1890ff, #40a9ff)";
  return (
    <div
      style={{
        position: "relative",
        height: 12,
        background: "rgba(0, 0, 0, 0.45)",
        borderRadius: 2,
        overflow: "hidden",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        marginTop: 1,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: barBg,
          transition: "width 0.25s ease",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 3px",
          height: "100%",
          fontSize: 9,
          fontWeight: 600,
          fontFamily: "var(--mono)",
          color: "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
          lineHeight: 1,
        }}
      >
        <span>{kind.toUpperCase()}</span>
        <span>
          {cur}/{max}
        </span>
      </div>
    </div>
  );
}

function BattleSlotCard({
  slot,
  unit,
  isSelected,
  onSelect,
}: {
  slot: SlotDef;
  unit?: BattleUnit;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const hasUnit = unit != null;
  const isDead = hasUnit && unit.hp.cur === 0;
  const isEnemy = slot.side === "enemy";

  let bg = "rgba(255, 255, 255, 0.03)";
  let border = "1px solid rgba(255, 255, 255, 0.07)";

  if (isSelected) {
    border = "2px solid #faad14";
    bg = "rgba(250, 173, 20, 0.15)";
  } else if (hasUnit) {
    if (isDead) {
      bg = "rgba(0, 0, 0, 0.4)";
      border = "1px dashed rgba(255, 77, 79, 0.3)";
    } else if (isEnemy) {
      bg = "rgba(255, 77, 79, 0.08)";
      border = "1px solid rgba(255, 77, 79, 0.25)";
    } else {
      bg = "rgba(82, 196, 26, 0.08)";
      border = "1px solid rgba(82, 196, 26, 0.25)";
    }
  }

  return (
    <div
      onClick={isEnemy && hasUnit && !isDead ? onSelect : undefined}
      style={{
        background: bg,
        border,
        borderRadius: 4,
        padding: "4px 5px",
        minHeight: 56,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: isEnemy && hasUnit && !isDead ? "pointer" : "default",
        transition: "all 0.15s ease",
        opacity: isDead ? 0.45 : 1,
        position: "relative",
      }}
      title={
        hasUnit
          ? `${unit.name} (Tọa độ: ${slot.label}) - HP: ${unit.hp.cur}/${unit.hp.max}`
          : `Ô trống (Tọa độ: ${slot.label})`
      }
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          color: "var(--muted)",
          lineHeight: 1,
        }}
      >
        <span style={{ fontWeight: 700, color: isEnemy ? "#ff7875" : "#95de64" }}>
          {slot.label}
        </span>
        {hasUnit && (
          <span
            style={{
              fontSize: 10,
              color: isDead ? "#ff4d4f" : "#fff",
              fontWeight: 600,
            }}
          >
            {isDead ? "Gục" : `Lv.${unit.level}`}
          </span>
        )}
      </div>

      <div style={{ margin: "3px 0 2px 0" }}>
        {hasUnit ? (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: isDead ? "#8c8c8c" : isEnemy ? "#ffccc7" : "#d9f7be",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
            }}
          >
            {unit.name}
          </div>
        ) : (
          <div
            style={{
              fontSize: 10,
              color: "rgba(255, 255, 255, 0.2)",
              textAlign: "center",
              fontStyle: "italic",
              padding: "4px 0",
            }}
          >
            Trống
          </div>
        )}
      </div>

      {hasUnit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <MiniBar kind="hp" cur={unit.hp.cur} max={unit.hp.max} />
          {unit.sp.max > 0 && <MiniBar kind="sp" cur={unit.sp.cur} max={unit.sp.max} />}
        </div>
      )}
    </div>
  );
}

const DEFAULT_CONFIG: BattleConfig = {
  playerAction: { type: "attack", skillId: 10000, target: "F1" },
  petAction: { type: "attack", skillId: 10000, target: "F1" },
  autoFight: true,
  autoEscape: false,
  strategyMode: "default",
  turns: [],
};

export function BattlePanel({
  accountId,
  can,
  ch,
  act,
}: {
  accountId: string;
  can: boolean;
  ch: CharacterState;
  act: Act;
}) {
  const toast = useToast();
  const [subTab, setSubTab] = useState<"log" | "arena" | "settings">(() => {
    try {
      const saved = localStorage.getItem("ts_battle_subtab");
      return saved === "arena" || saved === "settings" || saved === "log" ? saved : "log";
    } catch {
      return "log";
    }
  });

  const handleSubTabChange = (t: "log" | "arena" | "settings") => {
    setSubTab(t);
    try {
      localStorage.setItem("ts_battle_subtab", t);
    } catch {}
  };

  // State cấu hình trận đấu độc lập theo accountId
  const [battleConfig, setBattleConfig] = useState<BattleConfig>(DEFAULT_CONFIG);
  const [settingTab, setSettingTab] = useState<"default" | "turns">("default");
  const [showHelpTooltip, setShowHelpTooltip] = useState(false);
  const [itemNames, setItemNames] = useState<Record<string, string>>({});
  const [selectedTurn, setSelectedTurn] = useState<number>(1);
  const [copyTargetTurn, setCopyTargetTurn] = useState<number>(2);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);

  // Nạp danh mục tên vật phẩm
  useEffect(() => {
    import("../data/itemNames.json").then((m) => setItemNames(m.default as Record<string, string>));
  }, []);

  const itemNameOf = (id: number) => itemNames[String(id)] ?? `Vật phẩm #${id}`;

  // Tải cấu hình trận đấu theo accountId
  useEffect(() => {
    let active = true;
    if (!accountId) return;
    api
      .battleConfig(accountId)
      .then((cfg) => {
        if (!active) return;
        const mode = cfg.strategyMode ?? (cfg.turns && cfg.turns.length > 0 ? "turns" : "default");
        setSettingTab(mode);
        setBattleConfig({
          ...DEFAULT_CONFIG,
          ...cfg,
          autoEscape: cfg.autoEscape ?? false,
          strategyMode: mode,
          playerAction: cfg.playerAction ?? DEFAULT_CONFIG.playerAction,
          petAction: cfg.petAction ?? DEFAULT_CONFIG.petAction,
          turns: Array.isArray(cfg.turns) ? cfg.turns : [],
        });
      })
      .catch(() => {
        if (!active) return;
        setBattleConfig(DEFAULT_CONFIG);
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  // Cập nhật lượt hiện tại nếu đang trong trận
  const currentLiveTurn = ch.battleConfig?.currentTurn ?? 0;
  const effectiveLiveTurn = currentLiveTurn > 0 ? ((currentLiveTurn - 1) % 21) + 1 : 0;

  const units = ch.battleUnits ?? [];
  const inBattle = ch.inBattle && units.length > 0;
  const livingEnemies = units.filter((u) => u.isEnemy && u.hp.cur > 0);

  const getUnitForSlot = (slot: SlotDef): BattleUnit | undefined => {
    if (!inBattle) return undefined;
    return units.find((u) => u.row === slot.row && u.col === slot.col);
  };

  const selectedEnemy =
    selectedSlotId != null
      ? [...ENEMY_FRONT_SLOTS, ...ENEMY_BACK_SLOTS].find((s) => s.slotId === selectedSlotId)
      : null;
  const selectedUnit = selectedEnemy ? getUnitForSlot(selectedEnemy) : undefined;

  useEffect(() => {
    if (inBattle && livingEnemies.length > 0) {
      if (!selectedUnit || selectedUnit.hp.cur === 0) {
        const first = livingEnemies[0];
        const matchingSlot = [...ENEMY_FRONT_SLOTS, ...ENEMY_BACK_SLOTS].find(
          (s) => s.row === first.row && s.col === first.col
        );
        if (matchingSlot) setSelectedSlotId(matchingSlot.slotId);
      }
    } else {
      setSelectedSlotId(null);
    }
  }, [inBattle, livingEnemies, selectedUnit]);

  // Hành động thủ công
  const handleManualStrike = async (actor: "player" | "pet") => {
    if (!selectedEnemy) return;
    const skillId =
      actor === "player"
        ? (battleConfig.playerAction.skillId ?? 10000)
        : (battleConfig.petAction.skillId ?? 10000);
    await act("battle_action", {
      actor,
      skillId,
      targetRow: selectedEnemy.row,
      targetCol: selectedEnemy.col,
    });
  };

  // Tra cứu tên skill hiển thị ngắn gọn
  const getSkillLabel = (sid?: number): string => {
    if (!sid || sid === 10000) return "Đấu Vật";
    if (sid === 17001) return "Phòng Ngự";
    if (sid === 18001) return "Bỏ Chạy";
    if (sid === 15001) return "Bắt Cóc";
    const pSk = ch.playerSkills?.find((s) => s.id === sid);
    if (pSk) return pSk.name;
    const petSk = ch.petSkills?.find((s) => s.id === sid);
    if (petSk) return petSk.name;
    return `Skill ${sid}`;
  };

  // Cấu hình turn đang được chọn
  const currentTurnCfg = battleConfig.turns?.find((t) => t.turn === selectedTurn);
  const isTurnCustomized = currentTurnCfg != null;

  // Bật/tắt tùy biến turn
  const handleToggleTurnCustom = (turn: number) => {
    const existing = battleConfig.turns ?? [];
    if (existing.some((t) => t.turn === turn)) {
      setBattleConfig((prev) => ({
        ...prev,
        turns: (prev.turns ?? []).filter((t) => t.turn !== turn),
      }));
    } else {
      const newTurn: BattleTurnConfig = {
        turn,
        playerAction: { ...battleConfig.playerAction },
        petAction: { ...battleConfig.petAction },
      };
      setBattleConfig((prev) => ({
        ...prev,
        turns: [...(prev.turns ?? []), newTurn].sort((a, b) => a.turn - b.turn),
      }));
    }
  };

  // Cập nhật cấu hình của turn
  const handleUpdateTurnAction = (
    turn: number,
    actor: "player" | "pet",
    patch: Partial<BattleActionConfig>
  ) => {
    const existingTurns = [...(battleConfig.turns ?? [])];
    const idx = existingTurns.findIndex((t) => t.turn === turn);
    const turnObj: BattleTurnConfig =
      idx >= 0
        ? { ...existingTurns[idx]! }
        : {
            turn,
            playerAction: { ...battleConfig.playerAction },
            petAction: { ...battleConfig.petAction },
          };

    if (actor === "player") {
      turnObj.playerAction = {
        ...turnObj.playerAction,
        ...patch,
      };
    } else {
      turnObj.petAction = {
        ...turnObj.petAction,
        ...patch,
      };
    }

    if (idx >= 0) existingTurns[idx] = turnObj;
    else existingTurns.push(turnObj);

    setBattleConfig((prev) => ({
      ...prev,
      turns: existingTurns.sort((a, b) => a.turn - b.turn),
    }));
  };

  // Sao chép từ turn hiện tại sang turn khác
  const handleCopyCurrentTurnTo = (targetTurn: number) => {
    if (targetTurn < 1 || targetTurn > 21 || targetTurn === selectedTurn) return;
    const sourceAction = currentTurnCfg ?? {
      turn: selectedTurn,
      playerAction: battleConfig.playerAction,
      petAction: battleConfig.petAction,
    };
    const existingTurns = [...(battleConfig.turns ?? [])].filter((t) => t.turn !== targetTurn);
    existingTurns.push({
      turn: targetTurn,
      playerAction: { ...sourceAction.playerAction },
      petAction: { ...sourceAction.petAction },
    });
    setBattleConfig((prev) => ({
      ...prev,
      turns: existingTurns.sort((a, b) => a.turn - b.turn),
    }));
    toast("info", `Đã sao chép cấu hình từ Hiệp ${selectedTurn} sang Hiệp ${targetTurn}`);
  };

  // Áp dụng turn hiện tại cho toàn bộ 21 turns
  const handleApplyCurrentTurnToAll = () => {
    const pAct = currentTurnCfg?.playerAction ?? battleConfig.playerAction;
    const petAct = currentTurnCfg?.petAction ?? battleConfig.petAction;

    const all21: BattleTurnConfig[] = Array.from({ length: 21 }, (_, i) => ({
      turn: i + 1,
      playerAction: { ...pAct },
      petAction: { ...petAct },
    }));
    setBattleConfig((prev) => ({
      ...prev,
      strategyMode: "turns",
      turns: all21,
    }));
    toast("info", `Đã áp dụng cấu hình Hiệp ${selectedTurn} cho cả 21 turns`);
  };

  // Xoá toàn bộ cấu hình 21 turns (quay về mặc định)
  const handleResetAllTurns = () => {
    setBattleConfig((prev) => ({ ...prev, turns: [] }));
    toast("info", "Đã xoá toàn bộ cấu hình 21 turns (tất cả hiệp dùng thiết lập mặc định)");
  };

  // Lưu toàn bộ cấu hình
  const handleSaveConfig = async () => {
    if (!accountId) return;
    setIsSaving(true);
    try {
      const mode = battleConfig.strategyMode ?? (battleConfig.turns && battleConfig.turns.length > 0 ? "turns" : "default");
      const normalizedConfig: BattleConfig = {
        ...battleConfig,
        strategyMode: mode,
        autoFight: battleConfig.autoFight ?? true,
        autoEscape: battleConfig.autoEscape ?? false,
        playerAction: {
          type: battleConfig.playerAction?.type || "skill",
          skillId: Number(battleConfig.playerAction?.skillId) || 10000,
          target: battleConfig.playerAction?.target || "F1",
        },
        petAction: {
          type: battleConfig.petAction?.type || "skill",
          skillId: Number(battleConfig.petAction?.skillId) || 10000,
          target: battleConfig.petAction?.target || "F1",
        },
        turns: (battleConfig.turns ?? []).map((t) => ({
          turn: Number(t.turn),
          playerAction: {
            type: t.playerAction?.type || "skill",
            skillId: Number(t.playerAction?.skillId) || 10000,
            target: t.playerAction?.target || "F1",
            itemId: t.playerAction?.itemId != null ? Number(t.playerAction.itemId) : undefined,
            itemSlot: t.playerAction?.itemSlot != null ? Number(t.playerAction.itemSlot) : undefined,
            itemName: t.playerAction?.itemName ? String(t.playerAction.itemName) : undefined,
            petModel: t.playerAction?.petModel != null ? Number(t.playerAction.petModel) : undefined,
            petName: t.playerAction?.petName ? String(t.playerAction.petName) : undefined,
          },
          petAction: {
            type: t.petAction?.type || "skill",
            skillId: Number(t.petAction?.skillId) || 10000,
            target: t.petAction?.target || "F1",
            itemId: t.petAction?.itemId != null ? Number(t.petAction.itemId) : undefined,
            itemSlot: t.petAction?.itemSlot != null ? Number(t.petAction.itemSlot) : undefined,
            itemName: t.petAction?.itemName ? String(t.petAction.itemName) : undefined,
            petModel: t.petAction?.petModel != null ? Number(t.petAction.petModel) : undefined,
            petName: t.petAction?.petName ? String(t.petAction.petName) : undefined,
          },
        })),
      };
      await api.saveBattleConfig(accountId, normalizedConfig);
      await act("set_battle_config", {
        playerSkillId: normalizedConfig.playerAction.skillId ?? 10000,
        petSkillId: normalizedConfig.petAction.skillId ?? 10000,
        autoFight: normalizedConfig.autoFight ? 1 : 0,
        playerTarget: normalizedConfig.playerAction.target ?? "F1",
        petTarget: normalizedConfig.petAction.target ?? "F1",
        turnsJson: JSON.stringify(normalizedConfig.turns ?? []),
        strategyMode: mode,
        autoEscape: normalizedConfig.autoEscape ? "1" : "0",
      });
      setBattleConfig(normalizedConfig);
      toast("info", `Đã lưu cấu hình trận đấu cho tài khoản [${accountId}] (${mode === "turns" ? "Chế độ theo Turn" : "Chế độ Mặc định"}${normalizedConfig.autoEscape ? " | Bỏ chạy: BẬT" : ""})`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Lỗi lưu cấu hình trận đấu");
    } finally {
      setIsSaving(false);
    }
  };

  // Bật/tắt nhanh tự động bỏ chạy (lưu đĩa & dispatch trực tiếp tới engine)
  const handleToggleAutoEscape = async (enabled: boolean) => {
    if (!accountId) return;
    const mode = battleConfig.strategyMode ?? (battleConfig.turns && battleConfig.turns.length > 0 ? "turns" : "default");
    const updated: BattleConfig = {
      ...battleConfig,
      strategyMode: mode,
      autoEscape: enabled,
    };
    setBattleConfig(updated);
    try {
      await api.saveBattleConfig(accountId, updated);
      await act("set_battle_config", {
        playerSkillId: String(updated.playerAction?.skillId ?? 10000),
        petSkillId: String(updated.petAction?.skillId ?? 10000),
        autoFight: updated.autoFight ? "1" : "0",
        playerTarget: updated.playerAction?.target ?? "F1",
        petTarget: updated.petAction?.target ?? "F1",
        turnsJson: JSON.stringify(updated.turns ?? []),
        strategyMode: mode,
        autoEscape: enabled ? "1" : "0",
      });
      toast("info", enabled ? `🏃 Đã BẬT tự động bỏ chạy cho [${accountId}] (Ưu tiên Bậc 1)` : `Đã TẮT tự động bỏ chạy cho [${accountId}]`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Lỗi lưu cấu hình tự bỏ chạy");
    }
  };

  // Helper render Skill select với kích thước to, dễ thao tác
  const renderSkillSelect = (
    actor: "player" | "pet",
    value: number,
    onChange: (val: number) => void,
    disabled = false
  ) => {
    const isPlayer = actor === "player";
    const coreActions = isPlayer ? CORE_PLAYER_ACTIONS : CORE_PET_ACTIONS;
    const skills = isPlayer ? (ch.playerSkills ?? []) : (ch.petSkills ?? []);
    const isDisabled = disabled;

    return (
      <select
        style={{
          padding: "6px 30px 6px 12px",
          fontSize: 13,
          height: 38,
          minWidth: 180,
          borderRadius: 6,
          fontWeight: 500,
        }}
        value={value}
        disabled={isDisabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <optgroup label="Hành động cơ bản">
          {coreActions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
        {skills.length > 0 && (
          <optgroup label={isPlayer ? "Kỹ năng nhân vật" : "Kỹ năng võ tướng"}>
            {skills.map((sk) => (
              <option key={sk.id} value={sk.id}>
                {isPlayer ? "⚡" : "✨"} {sk.name} {sk.level ? `(Lv ${sk.level})` : ""}{" "}
                {sk.sp ? `[${sk.sp} SP]` : ""}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
  };

  // Helper render Target select với kích thước to
  const renderTargetSelect = (
    value: string,
    onChange: (val: string) => void,
    disabled = false
  ) => {
    return (
      <select
        style={{
          padding: "6px 30px 6px 12px",
          fontSize: 13,
          height: 38,
          minWidth: 160,
          borderRadius: 6,
          fontWeight: 500,
        }}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="F1">🎯 F1 (Tự động)</option>
        <optgroup label="🎯 Đối thủ — Hàng trước (0,0 → 0,4)">
          {ENEMY_FRONT_SLOTS.map((s) => {
            const u = getUnitForSlot(s);
            return (
              <option key={s.slotId} value={String(s.slotId)}>
                ({s.row},{s.col}){u ? `: ${u.name} (Lv.${u.level})` : " (Trống)"}
              </option>
            );
          })}
        </optgroup>
        <optgroup label="🎯 Đối thủ — Hàng sau (1,0 → 1,4)">
          {ENEMY_BACK_SLOTS.map((s) => {
            const u = getUnitForSlot(s);
            return (
              <option key={s.slotId} value={String(s.slotId)}>
                ({s.row},{s.col}){u ? `: ${u.name} (Lv.${u.level})` : " (Trống)"}
              </option>
            );
          })}
        </optgroup>
        <optgroup label="🛡️ Phe Ta — Hàng trước / Võ tướng (2,0 → 2,4)">
          {ALLY_FRONT_SLOTS.map((s) => {
            const u = getUnitForSlot(s);
            return (
              <option key={s.slotId} value={String(s.slotId)}>
                ({s.row},{s.col}){u ? `: ${u.name}` : " (Trống)"}
              </option>
            );
          })}
        </optgroup>
        <optgroup label="🛡️ Phe Ta — Hàng sau / Nhân vật & Đội ngũ (3,0 → 3,4)">
          {ALLY_BACK_SLOTS.map((s) => {
            const u = getUnitForSlot(s);
            return (
              <option key={s.slotId} value={String(s.slotId)}>
                ({s.row},{s.col}){u ? `: ${u.name}` : " (Trống)"}
              </option>
            );
          })}
        </optgroup>
      </select>
    );
  };

  const isDefaultMode = battleConfig.strategyMode === "default";
  const isTurnsMode = battleConfig.strategyMode === "turns";

  return (
    <div
      id="battle-panel-container"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        height: "100%",
        minHeight: 0,
        flex: 1,
      }}
    >
      {/* 3 SUB-TABS HEADER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          background: "var(--panel-2)",
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className={`home-tab ${subTab === "log" ? "on" : ""}`}
            onClick={() => handleSubTabChange("log")}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: subTab === "log" ? 700 : 500,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 6,
            }}
          >
            <span>📜</span> Nhật ký trận đấu
          </button>
          <button
            type="button"
            className={`home-tab ${subTab === "arena" ? "on" : ""}`}
            onClick={() => handleSubTabChange("arena")}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: subTab === "arena" ? 700 : 500,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 6,
            }}
          >
            <span>⚔️</span> Sàn đấu (20 vị trí)
            {inBattle && (
              <span className="chip warn glow" style={{ fontSize: 10, padding: "2px 6px", marginLeft: 4 }}>
                {livingEnemies.length} Quái
              </span>
            )}
          </button>
          <button
            type="button"
            className={`home-tab ${subTab === "settings" ? "on" : ""}`}
            onClick={() => handleSubTabChange("settings")}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: subTab === "settings" ? 700 : 500,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 6,
            }}
          >
            <span>⚙️</span> Thiết lập trận
            <span
              className={isTurnsMode ? "chip primary" : "chip muted"}
              style={{ fontSize: 10, padding: "2px 6px", marginLeft: 4 }}
            >
              {isTurnsMode ? "Theo Turn" : "Mặc định"}
            </span>
          </button>
        </div>

        {/* Trạng thái tóm tắt bên phải header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          {inBattle ? (
            <span className="chip warn glow" style={{ fontWeight: 700, padding: "4px 10px", fontSize: 12 }}>
              ⚔️ ĐANG CHIẾN ĐẤU {effectiveLiveTurn > 0 ? `(Hiệp ${currentLiveTurn} → Turn ${effectiveLiveTurn})` : ""}
            </span>
          ) : (
            <span className="chip muted" style={{ padding: "4px 10px", fontSize: 12 }}>
              Chờ trận đấu
            </span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Tài khoản: <b style={{ color: "var(--text)" }}>{accountId}</b>
          </span>
        </div>
      </div>

      {/* ======================================================================= */}
      {/* SUB-TAB 1: NHẬT KÝ TRẬN ĐẤU (LOG PANEL TOÀN MÀN HÌNH) */}
      {/* ======================================================================= */}
      {subTab === "log" && (
        <div
          className="card homelog"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
            padding: 10,
          }}
        >
          <LogPanel accountId={accountId} empty="Chưa có dữ liệu nhật ký trận đấu." />
        </div>
      )}

      {/* ======================================================================= */}
      {/* SUB-TAB 2: SÀN ĐẤU (ARENA 20 VỊ TRÍ) */}
      {/* ======================================================================= */}
      {subTab === "arena" && (
        <div
          className="card"
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <span>⚔️</span> Sàn Đấu Turn-Based (10 Quái Địch / 10 Đồng Minh)
            </h3>
            {inBattle && (
              <span className="chip warn" style={{ fontSize: 11, padding: "3px 8px" }}>
                Hiệp hiện tại: Hiệp {currentLiveTurn || 1}{" "}
                {currentLiveTurn > 21 ? `(Áp dụng Turn ${effectiveLiveTurn})` : ""}
              </span>
            )}
          </div>

          <div
            className="battle-arena"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: "rgba(0, 0, 0, 0.22)",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--line-soft)",
            }}
          >
            {/* PHE ĐỊCH: Hàng sau (1,0 -> 1,4) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <span>🎯 Phe Địch — Hàng sau (1,0 → 1,4)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {ENEMY_BACK_SLOTS.map((slot) => {
                  const u = getUnitForSlot(slot);
                  return (
                    <BattleSlotCard
                      key={slot.slotId}
                      slot={slot}
                      unit={u}
                      isSelected={selectedSlotId === slot.slotId}
                      onSelect={() => setSelectedSlotId(slot.slotId)}
                    />
                  );
                })}
              </div>

              {/* PHE ĐỊCH: Hàng trước (0,0 -> 0,4) */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 4 }}>
                <span>🎯 Phe Địch — Hàng trước (0,0 → 0,4)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {ENEMY_FRONT_SLOTS.map((slot) => {
                  const u = getUnitForSlot(slot);
                  return (
                    <BattleSlotCard
                      key={slot.slotId}
                      slot={slot}
                      unit={u}
                      isSelected={selectedSlotId === slot.slotId}
                      onSelect={() => setSelectedSlotId(slot.slotId)}
                    />
                  );
                })}
              </div>
            </div>

            {/* VẠCH TIỀN TUYẾN GIAO TRANH & ĐÁNH THỦ CÔNG */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                borderTop: "1px dashed rgba(255, 255, 255, 0.12)",
                borderBottom: "1px dashed rgba(255, 255, 255, 0.12)",
                margin: "4px 0",
              }}
            >
              <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "1px", fontWeight: 700 }}>
                ⚔️ TIỀN TUYẾN GIAO TRANH
              </span>
              {inBattle && selectedEnemy ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--accent-ink)", fontWeight: 600 }}>
                    Mục tiêu: {selectedEnemy.label}
                  </span>
                  <button
                    className="danger"
                    disabled={!can || !selectedEnemy}
                    onClick={() => handleManualStrike("player")}
                    style={{ padding: "4px 10px", fontSize: 12, height: 28 }}
                    title={`Đánh vào ${selectedEnemy.label}`}
                  >
                    ⚔️ Đánh ({ch.player?.name || "Nhân vật"})
                  </button>
                  <button
                    disabled={!can || !selectedEnemy || !ch.pet?.name}
                    onClick={() => handleManualStrike("pet")}
                    style={{ padding: "4px 10px", fontSize: 12, height: 28 }}
                    title={`${ch.pet?.name || "Võ tướng"} đánh vào ${selectedEnemy.label}`}
                  >
                    🐾 Đánh ({ch.pet?.name || "Võ tướng"})
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Click chọn quái để chỉ định đánh thủ công</span>
              )}
            </div>

            {/* PHE TA: Hàng trước (Võ tướng / Pet, row 2) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <span>🛡️ Phe Ta — Hàng trước / Võ tướng (2,0 → 2,4)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {ALLY_FRONT_SLOTS.map((slot) => {
                  const u = getUnitForSlot(slot);
                  return (
                    <BattleSlotCard
                      key={slot.slotId}
                      slot={slot}
                      unit={u}
                      isSelected={false}
                      onSelect={() => {}}
                    />
                  );
                })}
              </div>

              {/* PHE TA: Hàng sau (Nhân vật / Party, row 3) */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 4 }}>
                <span>🛡️ Phe Ta — Hàng sau / Nhân vật & Đội ngũ (3,0 → 3,4)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {ALLY_BACK_SLOTS.map((slot) => {
                  const u = getUnitForSlot(slot);
                  return (
                    <BattleSlotCard
                      key={slot.slotId}
                      slot={slot}
                      unit={u}
                      isSelected={false}
                      onSelect={() => {}}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================================= */}
      {/* SUB-TAB 3: THIẾT LẬP TRẬN ĐẤU (PHÂN CHIA RÕ RÀNG 2 LOẠI SETTING) */}
      {/* ======================================================================= */}
      {subTab === "settings" && (
        <div
          className="card"
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: 16,
          }}
        >
          {/* Header & Nút Lưu lớn */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
              paddingBottom: 12,
              borderBottom: "1px solid var(--line)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⚙️</span> Cài Đặt Chiến Thuật Trận Đấu
                </h3>

                {/* Hover Icon (?) Giải thích ghi chú & quy tắc chiến thuật */}
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onMouseEnter={() => setShowHelpTooltip(true)}
                    onMouseLeave={() => setShowHelpTooltip(false)}
                    onClick={() => setShowHelpTooltip((v) => !v)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--accent-ink)",
                      background: "var(--accent-soft)",
                      border: "1px solid var(--accent)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                    title="Xem hướng dẫn quy tắc chiến thuật"
                  >
                    ?
                  </button>

                  {/* Floating Tooltip / Popover khi hover hoặc click */}
                  {showHelpTooltip && (
                    <div
                      onMouseEnter={() => setShowHelpTooltip(true)}
                      onMouseLeave={() => setShowHelpTooltip(false)}
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        marginTop: 8,
                        width: 360,
                        zIndex: 999,
                        background: "#1c1d22",
                        border: "1px solid var(--accent)",
                        borderRadius: 8,
                        padding: "14px 16px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: "var(--text)",
                      }}
                    >
                      <b style={{ color: "var(--accent-ink)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>💡</span> Hướng Dẫn Quy Tắc Chiến Thuật
                      </b>
                      <ul style={{ margin: "8px 0 0 16px", padding: 0 }}>
                        <li><b>⚙️ Mặc Định:</b> Áp dụng kỹ năng & mục tiêu cố định cho Char & Pet trong mọi hiệp đấu.</li>
                        <li><b>🏃 Ưu Tiên Bậc 1:</b> Tự động bỏ chạy ngay khi vào trận, có độ ưu tiên cao nhất ghi đè mọi thiết lập khác.</li>
                        <li><b>🔄 Đánh Theo Turn:</b> Tùy biến chi tiết từng hiệp từ Hiệp 1 đến 21. Sau Hiệp 21 tự động quay vòng loop lại từ Hiệp 1.</li>
                        <li><b>🐕 Xuất Chiến Pet:</b> Cho phép Nhân vật gọi hoặc đổi Pet ra trận ở hiệp được chỉ định.</li>
                        <li><b>🧪 Dùng Vật Phẩm:</b> Cho phép Nhân vật hoặc Pet dùng item (bơm HP, SP...) cho bất kỳ mục tiêu nào trên sân đấu.</li>
                        <li><b>🛡️ Phân Lập Độc Lập:</b> Cài đặt được lưu riêng 100% cho từng tài khoản <b>{accountId}</b>.</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                Thiết lập riêng biệt cho tài khoản <b style={{ color: "var(--accent-ink)" }}>{accountId}</b>.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  style={{ width: 18, height: 18, cursor: "pointer" }}
                  checked={battleConfig.autoFight ?? true}
                  onChange={(e) =>
                    setBattleConfig((prev) => ({ ...prev, autoFight: e.target.checked }))
                  }
                />
                <span>Tự động xuất chiêu</span>
              </label>

              <button
                type="button"
                className="primary"
                disabled={!can || isSaving}
                onClick={handleSaveConfig}
                style={{
                  padding: "8px 20px",
                  fontSize: 14,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 6,
                }}
              >
                <span>💾</span> {isSaving ? "Đang lưu..." : "Lưu thiết lập trận"}
              </button>
            </div>
          </div>

          {/* THANH ĐIỀU HƯỚNG 2 SUB-TAB CON CỦA THIẾT LẬP TRẬN: MẶC ĐỊNH & THEO TURN */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderBottom: "1px solid var(--line)",
              paddingBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className={`home-tab ${settingTab === "default" ? "on" : ""}`}
              onClick={() => {
                setSettingTab("default");
                setBattleConfig((prev) => ({ ...prev, strategyMode: "default" }));
              }}
              style={{
                padding: "8px 18px",
                fontSize: 14,
                fontWeight: settingTab === "default" ? 700 : 500,
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 6,
              }}
            >
              <span>⚙️</span> Mặc Định (Mọi hiệp)
            </button>

            <button
              type="button"
              className={`home-tab ${settingTab === "turns" ? "on" : ""}`}
              onClick={() => {
                setSettingTab("turns");
                setBattleConfig((prev) => ({ ...prev, strategyMode: "turns" }));
              }}
              style={{
                padding: "8px 18px",
                fontSize: 14,
                fontWeight: settingTab === "turns" ? 700 : 500,
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 6,
              }}
            >
              <span>🔄</span> Theo Turn (21 Hiệp & Loop)
              {battleConfig.turns && battleConfig.turns.length > 0 && (
                <span className="chip primary" style={{ fontSize: 11, padding: "1px 6px" }}>
                  {battleConfig.turns.length} hiệp
                </span>
              )}
            </button>
          </div>

          {/* ======================================================================= */}
          {/* TAB CON 1: THIẾT LẬP MẶC ĐỊNH */}
          {/* ======================================================================= */}
          {settingTab === "default" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* TÍNH NĂNG ƯU TIÊN BẬC 1: TỰ ĐỘNG BỎ CHẠY */}
              <div
                style={{
                  background: battleConfig.autoEscape ? "rgba(255, 77, 79, 0.12)" : "rgba(255, 255, 255, 0.02)",
                  border: battleConfig.autoEscape ? "1px solid rgba(255, 77, 79, 0.4)" : "1px solid var(--line-soft)",
                  borderRadius: 8,
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 15, color: battleConfig.autoEscape ? "#ff7875" : "var(--text)" }}>
                      🏃 Vào Trận Tự Động Bỏ Chạy (Cả Char & Pet)
                    </b>
                    <span
                      className={battleConfig.autoEscape ? "chip danger glow" : "chip muted"}
                      style={{ fontSize: 11, padding: "2px 8px", fontWeight: 700 }}
                    >
                      ƯU TIÊN BẬC 1
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>
                    Khi trận đấu bắt đầu, bot sẽ lập tức gửi lệnh bỏ chạy (Skill 18001 - Chạy trốn) cho cả Nhân vật và Võ tướng. Thiết lập này có độ ưu tiên cao nhất (Bậc 1).
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => handleToggleAutoEscape(!battleConfig.autoEscape)}
                    style={{
                      padding: "6px 14px",
                      fontSize: 13,
                      borderRadius: 6,
                      border: battleConfig.autoEscape ? "1px solid #ff4d4f" : "1px solid var(--line-soft)",
                      background: battleConfig.autoEscape ? "rgba(255, 77, 79, 0.2)" : "rgba(255, 255, 255, 0.05)",
                      color: battleConfig.autoEscape ? "#ff7875" : "var(--muted)",
                      cursor: "pointer",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      transition: "all 0.15s ease",
                    }}
                    title={battleConfig.autoEscape ? "Bấm để TẮT tự bỏ chạy" : "Bấm để BẬT tự bỏ chạy"}
                  >
                    <span>{battleConfig.autoEscape ? "🔴 BẬT (Đang chạy trốn)" : "⚪ TẮT"}</span>
                  </button>

                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      style={{ width: 20, height: 20, cursor: "pointer" }}
                      checked={battleConfig.autoEscape ?? false}
                      onChange={(e) => handleToggleAutoEscape(e.target.checked)}
                    />
                    <span style={{ color: battleConfig.autoEscape ? "#ff7875" : "var(--text)" }}>
                      {battleConfig.autoEscape ? "Đang BẬT tự bỏ chạy" : "Tắt tự bỏ chạy"}
                    </span>
                  </label>
                </div>
              </div>

              {/* HÀNH ĐỘNG MẶC ĐỊNH CHO CHAR VÀ PET */}
              <div
                style={{
                  background: "var(--panel-2)",
                  padding: "16px 18px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  🛡️ Hành Động & Kỹ Năng Mặc Định
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
                  {/* Char Default */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-ink)" }}>
                      {ch.player?.name || "Nhân vật"}:
                    </span>
                    {renderSkillSelect(
                      "player",
                      battleConfig.playerAction?.skillId ?? 10000,
                      (sid) =>
                        setBattleConfig((prev) => ({
                          ...prev,
                          playerAction: { ...prev.playerAction, skillId: sid },
                        }))
                    )}
                    {renderTargetSelect(
                      battleConfig.playerAction?.target ?? "F1",
                      (target) =>
                        setBattleConfig((prev) => ({
                          ...prev,
                          playerAction: { ...prev.playerAction, target },
                        }))
                    )}
                  </div>

                  {/* Pet Default */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-ink)" }}>
                      {ch.pet?.name || "Võ tướng"}:
                    </span>
                    {renderSkillSelect(
                      "pet",
                      battleConfig.petAction?.skillId ?? 10000,
                      (sid) =>
                        setBattleConfig((prev) => ({
                          ...prev,
                          petAction: { ...prev.petAction, skillId: sid },
                        }))
                    )}
                    {renderTargetSelect(
                      battleConfig.petAction?.target ?? "F1",
                      (target) =>
                        setBattleConfig((prev) => ({
                          ...prev,
                          petAction: { ...prev.petAction, target },
                        }))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================================= */}
          {/* TAB CON 2: THIẾT LẬP THEO TURN (21 HIỆP) */}
          {/* ======================================================================= */}
          {settingTab === "turns" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* THANH ĐIỀU KHIỂN & BỘ CHỌN HIỆP BẰNG DROPDOWN */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  background: "rgba(0, 0, 0, 0.25)",
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--line-soft)",
                }}
              >
                <label style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🎯</span> Chọn Hiệp Cần Thiết Lập:
                </label>

                <select
                  style={{
                    height: 40,
                    fontSize: 14,
                    padding: "6px 36px 6px 12px",
                    borderRadius: 6,
                    minWidth: 320,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  value={selectedTurn}
                  onChange={(e) => setSelectedTurn(Number(e.target.value))}
                >
                  {Array.from({ length: 21 }, (_, i) => i + 1).map((turnNum) => {
                    const tCfg = battleConfig.turns?.find((t) => t.turn === turnNum);
                    let desc = "— [Dùng mặc định]";
                    if (tCfg) {
                      const pA = tCfg.playerAction;
                      const petA = tCfg.petAction;
                      const pTxt = pA.type === "summon"
                        ? `Xuất chiến ${pA.petName || pA.petModel}`
                        : pA.type === "item" || pA.skillId === 19001
                        ? `Dùng ${pA.itemName || (pA.itemId ? itemNameOf(pA.itemId) : `Ô #${pA.itemSlot}`)}`
                        : getSkillLabel(pA.skillId);
                      const petTxt = petA.type === "item" || petA.skillId === 19001
                        ? `Dùng ${petA.itemName || (petA.itemId ? itemNameOf(petA.itemId) : `Ô #${petA.itemSlot}`)}`
                        : getSkillLabel(petA.skillId);
                      desc = `— [✓ Char: ${pTxt} | Pet: ${petTxt}]`;
                    }
                    return (
                      <option key={turnNum} value={turnNum}>
                        Hiệp {turnNum} {desc}
                      </option>
                    );
                  })}
                </select>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleCopyCurrentTurnTo(copyTargetTurn)}
                      style={{ padding: "6px 12px", fontSize: 13, height: 38 }}
                      title={`Sao chép cấu hình Hiệp ${selectedTurn} sang Hiệp ${copyTargetTurn}`}
                    >
                      📋 Copy sang Hiệp:
                    </button>
                    <select
                      style={{ padding: "6px 24px 6px 8px", fontSize: 13, height: 38, borderRadius: 6 }}
                      value={copyTargetTurn}
                      onChange={(e) => setCopyTargetTurn(Number(e.target.value))}
                    >
                      {Array.from({ length: 21 }, (_, i) => i + 1)
                        .filter((t) => t !== selectedTurn)
                        .map((t) => (
                          <option key={t} value={t}>
                            Hiệp {t}
                          </option>
                        ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleApplyCurrentTurnToAll}
                    style={{ padding: "6px 14px", fontSize: 13, height: 38 }}
                    title={`Áp dụng cấu hình Hiệp ${selectedTurn} cho toàn bộ 21 hiệp`}
                  >
                    🚀 Áp dụng cho cả 21 hiệp
                  </button>

                  <button
                    type="button"
                    onClick={handleResetAllTurns}
                    style={{ padding: "6px 12px", fontSize: 13, height: 38, color: "var(--danger)" }}
                    title="Xoá tất cả tuỳ biến và quay lại dùng thiết lập mặc định cho 21 hiệp"
                  >
                    🔄 Đặt lại tất cả
                  </button>
                </div>
              </div>

              {/* BẢNG CẤU HÌNH CHI TIẾT CHO HIỆP ĐANG CHỌN */}
              <div
                style={{
                  background: "var(--panel-2)",
                  padding: "16px 18px",
                  borderRadius: 8,
                  border: isTurnCustomized ? "1px solid rgba(0, 200, 83, 0.4)" : "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {/* Header của Hiệp */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="chip primary" style={{ fontSize: 14, fontWeight: 700, padding: "5px 14px", borderRadius: 6 }}>
                      HIỆP {selectedTurn}
                    </span>
                    {isTurnCustomized ? (
                      <span className="chip success" style={{ fontSize: 13, padding: "4px 10px", fontWeight: 600 }}>
                        ✓ Đang dùng thiết lập riêng cho Hiệp {selectedTurn}
                      </span>
                    ) : (
                      <span className="chip warn" style={{ fontSize: 13, padding: "4px 10px" }}>
                        ℹ️ Đang lấy từ thiết lập mặc định (thay đổi bên dưới để lưu riêng cho hiệp này)
                      </span>
                    )}
                  </div>

                  {isTurnCustomized && (
                    <button
                      type="button"
                      onClick={() => handleToggleTurnCustom(selectedTurn)}
                      style={{ padding: "4px 12px", fontSize: 12, color: "var(--danger)" }}
                      title={`Bỏ thiết lập riêng của Hiệp ${selectedTurn} và quay lại dùng mặc định`}
                    >
                      ✕ Đặt lại Hiệp {selectedTurn} về mặc định
                    </button>
                  )}
                </div>

                {/* 1. HÀNH ĐỘNG CỦA NHÂN VẬT TRONG HIỆP */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    padding: "14px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--line-soft)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <b style={{ fontSize: 14, color: "var(--accent-ink)" }}>
                      👤 Nhân vật ({ch.player?.name || "Nhân vật"}):
                    </b>

                    {/* Mode Selector cho Nhân vật: Kỹ năng | Dùng vật phẩm | Xuất chiến Pet */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "skill",
                            skillId: currentTurnCfg?.playerAction?.skillId ?? battleConfig.playerAction.skillId ?? 10000,
                          })
                        }
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: (currentTurnCfg?.playerAction?.type ?? "skill") === "skill" ? 700 : 400,
                          background: (currentTurnCfg?.playerAction?.type ?? "skill") === "skill" ? "var(--accent)" : undefined,
                          color: (currentTurnCfg?.playerAction?.type ?? "skill") === "skill" ? "#fff" : undefined,
                        }}
                      >
                        ⚡ Kỹ năng / Đánh / Thủ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const firstBagItem = ch.bag && ch.bag.length > 0 ? ch.bag[0] : undefined;
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "item",
                            skillId: 19001,
                            itemId: firstBagItem?.id ?? 10000,
                            itemSlot: firstBagItem?.slot ?? 1,
                            itemName: firstBagItem ? itemNameOf(firstBagItem.id) : "Vật phẩm",
                            target: currentTurnCfg?.playerAction?.target || "F1",
                          });
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: currentTurnCfg?.playerAction?.type === "item" ? 700 : 400,
                          background: currentTurnCfg?.playerAction?.type === "item" ? "var(--accent)" : undefined,
                          color: currentTurnCfg?.playerAction?.type === "item" ? "#fff" : undefined,
                        }}
                      >
                        🧪 Dùng vật phẩm
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const firstPet = ch.pets && ch.pets.length > 0 ? ch.pets[0] : undefined;
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "summon",
                            petModel: firstPet?.model ?? (ch.pet ? 1 : 1),
                            petName: firstPet?.name ?? (ch.pet?.name || "Võ tướng"),
                          });
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: currentTurnCfg?.playerAction?.type === "summon" ? 700 : 400,
                          background: currentTurnCfg?.playerAction?.type === "summon" ? "var(--accent)" : undefined,
                          color: currentTurnCfg?.playerAction?.type === "summon" ? "#fff" : undefined,
                        }}
                      >
                        🐕 Xuất chiến Pet
                      </button>
                    </div>
                  </div>

                  {/* Chi tiết chọn theo loại hành động của Char */}
                  {currentTurnCfg?.playerAction?.type === "summon" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Chọn võ tướng xuất chiến:</span>
                      <select
                        style={{ height: 38, fontSize: 13, padding: "6px 30px 6px 12px", borderRadius: 6, minWidth: 260, fontWeight: 600 }}
                        value={currentTurnCfg.playerAction.petModel ?? ""}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          const p = ch.pets?.find((x) => x.model === m);
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "summon",
                            petModel: m,
                            petName: p?.name || `Model ${m}`,
                          });
                        }}
                      >
                        {ch.pets && ch.pets.length > 0 ? (
                          ch.pets.map((p) => (
                            <option key={p.model} value={p.model}>
                              {p.name} (Lv.{p.level}) {p.active ? "— [Đang ra trận]" : ""}
                            </option>
                          ))
                        ) : (
                          <option value={currentTurnCfg.playerAction.petModel || 1}>
                            {currentTurnCfg.playerAction.petName || `Model ${currentTurnCfg.playerAction.petModel || 1}`}
                          </option>
                        )}
                      </select>
                      <input
                        type="number"
                        placeholder="Nhập Model pet..."
                        value={currentTurnCfg.playerAction.petModel ?? ""}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          const p = ch.pets?.find((x) => x.model === m);
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "summon",
                            petModel: m,
                            petName: p?.name || `Model ${m}`,
                          });
                        }}
                        style={{ width: 140, height: 38, fontSize: 13, padding: "6px 10px", borderRadius: 6 }}
                        title="Hoặc nhập trực tiếp ID Model của pet cần xuất chiến"
                      />
                    </div>
                  ) : currentTurnCfg?.playerAction?.type === "item" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Vật phẩm:</span>
                      <select
                        style={{ height: 38, fontSize: 13, padding: "6px 30px 6px 12px", borderRadius: 6, minWidth: 260, fontWeight: 600 }}
                        value={`${currentTurnCfg.playerAction.itemId ?? ""}-${currentTurnCfg.playerAction.itemSlot ?? ""}`}
                        onChange={(e) => {
                          const [idStr, slotStr] = e.target.value.split("-");
                          const itemId = Number(idStr);
                          const itemSlot = Number(slotStr);
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "item",
                            skillId: 19001,
                            itemId,
                            itemSlot,
                            itemName: itemNameOf(itemId),
                          });
                        }}
                      >
                        {ch.bag && ch.bag.length > 0 ? (
                          ch.bag.map((b) => (
                            <option key={`${b.id}-${b.slot}`} value={`${b.id}-${b.slot}`}>
                              [Ô {b.slot}] {itemNameOf(b.id)} (x{b.qty})
                            </option>
                          ))
                        ) : (
                          <option value="10000-1">Túi trống (nhập ID bên cạnh)</option>
                        )}
                      </select>

                      <input
                        type="number"
                        placeholder="Mã Item ID..."
                        value={currentTurnCfg.playerAction.itemId ?? ""}
                        onChange={(e) => {
                          const itemId = Number(e.target.value);
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "item",
                            skillId: 19001,
                            itemId,
                            itemName: itemNameOf(itemId),
                          });
                        }}
                        style={{ width: 120, height: 38, fontSize: 13, padding: "6px 10px", borderRadius: 6 }}
                        title="Hoặc nhập trực tiếp ID vật phẩm cần sử dụng"
                      />

                      <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 6 }}>Mục tiêu nhận item:</span>
                      {renderTargetSelect(
                        currentTurnCfg.playerAction.target ?? "F1",
                        (tar) => handleUpdateTurnAction(selectedTurn, "player", { target: tar })
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Kỹ năng:</span>
                      {renderSkillSelect(
                        "player",
                        Number(currentTurnCfg?.playerAction?.skillId ?? battleConfig.playerAction.skillId) || 10000,
                        (sid) =>
                          handleUpdateTurnAction(selectedTurn, "player", {
                            type: "skill",
                            skillId: sid,
                          })
                      )}
                      <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 6 }}>Mục tiêu:</span>
                      {renderTargetSelect(
                        currentTurnCfg?.playerAction?.target ?? battleConfig.playerAction.target ?? "F1",
                        (tar) => handleUpdateTurnAction(selectedTurn, "player", { target: tar })
                      )}
                    </div>
                  )}
                </div>

                {/* 2. HÀNH ĐỘNG CỦA VÕ TƯỚNG TRONG HIỆP */}
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    padding: "14px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--line-soft)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <b style={{ fontSize: 14, color: "var(--accent-ink)" }}>
                      🐾 Võ tướng ({ch.pet?.name || "Võ tướng"}):
                    </b>

                    {/* Mode Selector cho Võ tướng: Kỹ năng | Dùng vật phẩm */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateTurnAction(selectedTurn, "pet", {
                            type: "skill",
                            skillId: currentTurnCfg?.petAction?.skillId ?? battleConfig.petAction.skillId ?? 10000,
                          })
                        }
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: (currentTurnCfg?.petAction?.type ?? "skill") === "skill" ? 700 : 400,
                          background: (currentTurnCfg?.petAction?.type ?? "skill") === "skill" ? "var(--accent)" : undefined,
                          color: (currentTurnCfg?.petAction?.type ?? "skill") === "skill" ? "#fff" : undefined,
                        }}
                      >
                        ✨ Kỹ năng / Đánh / Thủ
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const firstBagItem = ch.bag && ch.bag.length > 0 ? ch.bag[0] : undefined;
                          handleUpdateTurnAction(selectedTurn, "pet", {
                            type: "item",
                            skillId: 19001,
                            itemId: firstBagItem?.id ?? 10000,
                            itemSlot: firstBagItem?.slot ?? 1,
                            itemName: firstBagItem ? itemNameOf(firstBagItem.id) : "Vật phẩm",
                            target: currentTurnCfg?.petAction?.target || "F1",
                          });
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: currentTurnCfg?.petAction?.type === "item" ? 700 : 400,
                          background: currentTurnCfg?.petAction?.type === "item" ? "var(--accent)" : undefined,
                          color: currentTurnCfg?.petAction?.type === "item" ? "#fff" : undefined,
                        }}
                      >
                        🧪 Dùng vật phẩm
                      </button>
                    </div>
                  </div>

                  {/* Chi tiết chọn theo loại hành động của Pet */}
                  {currentTurnCfg?.petAction?.type === "item" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Vật phẩm:</span>
                      <select
                        style={{ height: 38, fontSize: 13, padding: "6px 30px 6px 12px", borderRadius: 6, minWidth: 260, fontWeight: 600 }}
                        value={`${currentTurnCfg.petAction.itemId ?? ""}-${currentTurnCfg.petAction.itemSlot ?? ""}`}
                        onChange={(e) => {
                          const [idStr, slotStr] = e.target.value.split("-");
                          const itemId = Number(idStr);
                          const itemSlot = Number(slotStr);
                          handleUpdateTurnAction(selectedTurn, "pet", {
                            type: "item",
                            skillId: 19001,
                            itemId,
                            itemSlot,
                            itemName: itemNameOf(itemId),
                          });
                        }}
                      >
                        {ch.bag && ch.bag.length > 0 ? (
                          ch.bag.map((b) => (
                            <option key={`${b.id}-${b.slot}`} value={`${b.id}-${b.slot}`}>
                              [Ô {b.slot}] {itemNameOf(b.id)} (x{b.qty})
                            </option>
                          ))
                        ) : (
                          <option value="10000-1">Túi trống (nhập ID bên cạnh)</option>
                        )}
                      </select>

                      <input
                        type="number"
                        placeholder="Mã Item ID..."
                        value={currentTurnCfg.petAction.itemId ?? ""}
                        onChange={(e) => {
                          const itemId = Number(e.target.value);
                          handleUpdateTurnAction(selectedTurn, "pet", {
                            type: "item",
                            skillId: 19001,
                            itemId,
                            itemName: itemNameOf(itemId),
                          });
                        }}
                        style={{ width: 120, height: 38, fontSize: 13, padding: "6px 10px", borderRadius: 6 }}
                        title="Hoặc nhập trực tiếp ID vật phẩm cần sử dụng"
                      />

                      <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 6 }}>Mục tiêu nhận item:</span>
                      {renderTargetSelect(
                        currentTurnCfg.petAction.target ?? "F1",
                        (tar) => handleUpdateTurnAction(selectedTurn, "pet", { target: tar })
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Kỹ năng:</span>
                      {renderSkillSelect(
                        "pet",
                        Number(currentTurnCfg?.petAction?.skillId ?? battleConfig.petAction.skillId) || 10000,
                        (sid) =>
                          handleUpdateTurnAction(selectedTurn, "pet", {
                            type: "skill",
                            skillId: sid,
                          })
                      )}
                      <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 6 }}>Mục tiêu:</span>
                      {renderTargetSelect(
                        currentTurnCfg?.petAction?.target ?? battleConfig.petAction.target ?? "F1",
                        (tar) => handleUpdateTurnAction(selectedTurn, "pet", { target: tar })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
