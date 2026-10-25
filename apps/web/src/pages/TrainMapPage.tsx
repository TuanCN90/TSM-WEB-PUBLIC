import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { useLive } from "../live";
import { useSessions } from "../sessions";

export interface TrainSpawn {
  mapId: number;
  mapName: string;
  npcId: number;
  npcName: string;
  level: number;
  element: number; // 0: Vô, 1: Địa, 2: Thủy, 3: Hỏa, 4: Phong, 5: Tâm, 7: Quang, 8: Ám
  cs: number;      // 0: Chưa CS, 1: CS 1, 2: Tái sinh (CS 2)
  count: number;   // Số lượng quái xuất hiện
  x: number;
  y: number;
  agi?: number;    // Tốc độ AGI của quái (từ MPData4_C.Dat)
  hp?: number;     // HP gốc của quái (từ MPData4_C.Dat)
  locations?: string[]; // Vị trí đứng của quái trong trận từ listBattle (VD: ["3,2,4", "1,2,3,4"])
}

const ELEMENT_LABELS: Record<number, { name: string; color: string; bg: string; icon: string }> = {
  0: { name: "Vô hệ", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.15)", icon: "⚪" },
  1: { name: "Địa", color: "#eab308", bg: "rgba(234, 179, 8, 0.15)", icon: "⛰️" },
  2: { name: "Thủy", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)", icon: "💧" },
  3: { name: "Hỏa", color: "#f87171", bg: "rgba(248, 113, 113, 0.15)", icon: "🔥" },
  4: { name: "Phong", color: "#4ade80", bg: "rgba(74, 222, 128, 0.15)", icon: "🍃" },
  5: { name: "Tâm", color: "#c084fc", bg: "rgba(192, 132, 252, 0.15)", icon: "🔮" },
  7: { name: "Quang", color: "#fef08a", bg: "rgba(254, 240, 138, 0.15)", icon: "☀️" },
  8: { name: "Ám", color: "#a1a1aa", bg: "rgba(161, 161, 170, 0.15)", icon: "🌙" },
};

const CS_LABELS: Record<number, { name: string; color: string; bg: string }> = {
  0: { name: "Chưa CS", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)" },
  1: { name: "CS 1", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.18)" },
  2: { name: "Tái sinh", color: "#ec4899", bg: "rgba(236, 72, 153, 0.18)" },
};

const LEVEL_PRESETS = [
  { label: "Tất cả", min: 1, max: 200 },
  { label: "1 - 30 (Tân thủ)", min: 1, max: 30 },
  { label: "31 - 60 (Sơ cấp)", min: 31, max: 60 },
  { label: "61 - 90 (Trung cấp)", min: 61, max: 90 },
  { label: "91 - 120 (Cao cấp)", min: 91, max: 120 },
  { label: "121 - 150 (Chuyên gia)", min: 121, max: 150 },
  { label: "151 - 180 (Đại sư)", min: 151, max: 180 },
  { label: "181 - 200 (Đỉnh cao)", min: 181, max: 200 },
];

export function TrainMapPage() {
  const toast = useToast();
  const { sessions, active, activate } = useSessions();
  const { characters, connections } = useLive();

  // Dữ liệu bãi train (lazy loaded)
  const [spawns, setSpawns] = useState<TrainSpawn[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Bộ lọc
  const [search, setSearch] = useState("");
  const [minLv, setMinLv] = useState<number>(1);
  const [maxLv, setMaxLv] = useState<number>(200);
  const [element, setElement] = useState<string>("all");
  const [cs, setCs] = useState<string>("all");
  const [minCount, setMinCount] = useState<number>(0);
  const [sortKey, setSortKey] = useState<"level_asc" | "level_desc" | "map" | "name" | "count" | "agi_asc" | "agi_desc">("level_asc");

  // Phân trang
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  // Trạng thái hành động
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Hover Tooltip xem vị trí quái trên bàn cờ trận đấu
  const [hoveredBattleSpot, setHoveredBattleSpot] = useState<{ item: TrainSpawn; pos: { x: number; y: number } } | null>(null);

  // Popup Modal xem chi tiết các đội hình chiến đấu khi click
  const [popupSpawn, setPopupSpawn] = useState<TrainSpawn | null>(null);

  // Tài khoản được chọn để thực thi lệnh di chuyển
  const activeAccountId = active?.accountId ?? null;
  const currentChar = activeAccountId ? characters[activeAccountId] : null;
  const currentConn = activeAccountId ? connections.find((c) => c.accountId === activeAccountId) : null;
  const isOnline = currentConn?.state === "online";
  const inBattle = currentChar?.inBattle ?? false;

  useEffect(() => {
    let mounted = true;
    import("../data/trainSpawns.json")
      .then((m) => {
        if (mounted) {
          setSpawns(m.default as TrainSpawn[]);
          setLoadingData(false);
        }
      })
      .catch((err) => {
        console.error("Lỗi tải dữ liệu trainSpawns:", err);
        if (mounted) setLoadingData(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Lọc dữ liệu
  const filtered = useMemo(() => {
    if (!spawns.length) return [];
    const q = search.trim().toLowerCase();
    const elemFilter = element === "all" ? null : Number(element);
    const csFilter = cs === "all" ? null : Number(cs);

    return spawns.filter((s) => {
      // 1. Text Search: Map Name, Map ID, NPC Name, NPC ID
      if (q) {
        const matchMapName = s.mapName.toLowerCase().includes(q);
        const matchMapId = String(s.mapId).includes(q);
        const matchNpcName = s.npcName.toLowerCase().includes(q);
        const matchNpcId = String(s.npcId).includes(q);
        if (!matchMapName && !matchMapId && !matchNpcName && !matchNpcId) return false;
      }

      // 2. Level filter
      if (s.level < minLv || s.level > maxLv) return false;

      // 3. Element filter
      if (elemFilter !== null && s.element !== elemFilter) return false;

      // 4. CS filter
      if (csFilter !== null && s.cs !== csFilter) return false;

      // 5. Min count
      if (minCount > 0 && s.count < minCount) return false;

      return true;
    });
  }, [spawns, search, minLv, maxLv, element, cs, minCount]);

  // Sắp xếp
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortKey) {
      case "level_asc":
        return arr.sort((a, b) => a.level - b.level || a.mapId - b.mapId);
      case "level_desc":
        return arr.sort((a, b) => b.level - a.level || a.mapId - b.mapId);
      case "map":
        return arr.sort((a, b) => a.mapId - b.mapId || a.level - b.level);
      case "name":
        return arr.sort((a, b) => a.npcName.localeCompare(b.npcName, "vi") || a.level - b.level);
      case "count":
        return arr.sort((a, b) => b.count - a.count || a.level - b.level);
      case "agi_desc":
        return arr.sort((a, b) => (b.agi ?? 0) - (a.agi ?? 0) || a.level - b.level);
      case "agi_asc":
        return arr.sort((a, b) => (a.agi ?? 0) - (b.agi ?? 0) || a.level - b.level);
      default:
        return arr;
    }
  }, [filtered, sortKey]);

  // Reset về trang 1 khi filter thay đổi
  useEffect(() => {
    setPage(1);
  }, [search, minLv, maxLv, element, cs, minCount, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // Handler: Warp & Đi bộ đến bãi train
  const handleWarpToSpot = useCallback(
    async (item: TrainSpawn) => {
      if (!activeAccountId) {
        toast("error", "Vui lòng chọn tài khoản để di chuyển!");
        return;
      }
      if (!isOnline) {
        toast("error", "Tài khoản hiện đang Offline, không thể di chuyển!");
        return;
      }
      if (inBattle) {
        toast("error", "Nhân vật đang trong trận đấu, không thể di chuyển!");
        return;
      }

      setActionBusy(true);
      const targetDesc = `${item.npcName} (Lv.${item.level}) tại ${item.mapName} (${item.x}, ${item.y})`;
      setActionMsg(`Đang lập lộ trình & di chuyển đến ${targetDesc}...`);
      toast("info", `🚀 Đang bắt đầu di chuyển đến ${targetDesc}...`);

      try {
        const res = await api.dispatch(activeAccountId, "warp_to_spot", {
          mapId: String(item.mapId),
          x: String(item.x),
          y: String(item.y),
          npcName: item.npcName,
        });

        if (res.ok) {
          toast("ok", `✓ Đã tiếp cận thành công bãi train ${item.npcName} tại ${item.mapName}!`);
        } else {
          toast("error", `Di chuyển không thành công: ${res.message ?? "Lỗi không xác định"}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast("error", `Lỗi thực thi lệnh di chuyển: ${msg}`);
      } finally {
        setActionBusy(false);
        setActionMsg(null);
      }
    },
    [activeAccountId, isOnline, inBattle, toast],
  );

  // Handler: Chỉ Warp tới cổng map
  const handleWarpMapOnly = useCallback(
    async (mapId: number, mapName: string) => {
      if (!activeAccountId) {
        toast("error", "Vui lòng chọn tài khoản để di chuyển!");
        return;
      }
      if (!isOnline) {
        toast("error", "Tài khoản hiện đang Offline!");
        return;
      }
      if (inBattle) {
        toast("error", "Nhân vật đang trong trận đấu!");
        return;
      }

      setActionBusy(true);
      setActionMsg(`Đang warp đến ${mapName} (${mapId})...`);
      toast("info", `🚪 Đang warp tới ${mapName} (${mapId})...`);

      try {
        const res = await api.dispatch(activeAccountId, "warp_map", { mapId: String(mapId) });
        if (res.ok) {
          toast("ok", `✓ Đã warp đến ${mapName} (${mapId})!`);
        } else {
          toast("error", `Không thể warp: ${res.message ?? "Lỗi"}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast("error", `Lỗi warp: ${msg}`);
      } finally {
        setActionBusy(false);
        setActionMsg(null);
      }
    },
    [activeAccountId, isOnline, inBattle, toast],
  );

  const liveChaseConfig = currentChar?.chaseConfig;
  const isChasing = !!liveChaseConfig?.enabled;

  const handleToggleChase = useCallback(
    async (enabled: boolean, useCurrentPos = false) => {
      if (!activeAccountId) {
        toast("error", "Vui lòng chọn tài khoản!");
        return;
      }
      try {
        const curMap = currentChar?.location?.map || 0;
        const curX = currentChar?.location?.x || 0;
        const curY = currentChar?.location?.y || 0;
        await api.saveChaseConfig(activeAccountId, {
          enabled,
          mapId: useCurrentPos ? curMap : (liveChaseConfig?.mapId || curMap),
          originX: useCurrentPos ? curX : (liveChaseConfig?.originX || curX),
          originY: useCurrentPos ? curY : (liveChaseConfig?.originY || curY),
          maxRadius: liveChaseConfig?.maxRadius || 150,
          npcId: liveChaseConfig?.npcId,
          npcName: liveChaseConfig?.npcName,
          autoReturn: liveChaseConfig?.autoReturn ?? true,
        });
        toast("ok", enabled ? "🎯 Đã bật chế độ truy kích quái!" : "🛑 Đã tắt chế độ truy kích quái.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast("error", `Lỗi: ${msg}`);
      }
    },
    [activeAccountId, currentChar?.location, liveChaseConfig, toast],
  );

  const handleUpdateChaseRadius = useCallback(
    async (maxRadius: number) => {
      if (!activeAccountId) return;
      try {
        await api.saveChaseConfig(activeAccountId, {
          maxRadius,
        });
        toast("ok", `Đã chỉnh bán kính truy kích: ${maxRadius}px`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast("error", `Lỗi: ${msg}`);
      }
    },
    [activeAccountId, toast],
  );

  const handleUpdateAutoReturn = useCallback(
    async (autoReturn: boolean) => {
      if (!activeAccountId) return;
      try {
        await api.saveChaseConfig(activeAccountId, {
          autoReturn,
        });
        toast("ok", autoReturn ? "Đã bật tự động quay về sau trận" : "Đã tắt tự động quay về sau trận");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast("error", `Lỗi: ${msg}`);
      }
    },
    [activeAccountId, toast],
  );

  const handleStartChaseAtSpot = useCallback(
    async (item: TrainSpawn) => {
      if (!activeAccountId) {
        toast("error", "Vui lòng chọn tài khoản để di chuyển!");
        return;
      }
      if (!isOnline) {
        toast("error", "Tài khoản hiện đang Offline!");
        return;
      }
      if (inBattle) {
        toast("error", "Nhân vật đang trong trận đấu!");
        return;
      }

      try {
        await api.saveChaseConfig(activeAccountId, {
          enabled: true,
          mapId: item.mapId,
          originX: item.x,
          originY: item.y,
          maxRadius: liveChaseConfig?.maxRadius || 150,
          npcId: item.npcId,
          npcName: item.npcName,
          autoReturn: liveChaseConfig?.autoReturn ?? true,
        });
        toast("ok", `🎯 Kích hoạt truy kích ${item.npcName} tại (${item.x}, ${item.y})! Đang tiếp cận bãi train...`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast("error", `Lỗi kích hoạt truy kích: ${msg}`);
        return;
      }

      await handleWarpToSpot(item);
    },
    [activeAccountId, isOnline, inBattle, liveChaseConfig, toast, handleWarpToSpot],
  );

  const resetFilters = () => {
    setSearch("");
    setMinLv(1);
    setMaxLv(200);
    setElement("all");
    setCs("all");
    setMinCount(0);
    setSortKey("level_asc");
  };

  return (
    <div className="train-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 1. Header & Bộ Chọn Tài Khoản */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8, fontSize: 18 }}>
            <span>🗺️</span>
            <span>Bãi Luyện Cấp & Tìm Quái (Train Map Finder)</span>
          </h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Tìm kiếm theo NPC, cấp độ, hệ, số lượng và kích hoạt lộ trình di chuyển an toàn (chống kick mã 5 & mã 44).
          </div>
        </div>

        {/* Thanh trạng thái tài khoản đang được chọn */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Tài khoản:</label>
          <select
            value={active?.key ?? ""}
            onChange={(e) => {
              if (e.target.value) activate(e.target.value);
            }}
            style={{ minWidth: 200, padding: "6px 30px 6px 10px", fontSize: 13 }}
          >
            {sessions.map((s) => {
              const c = s.accountId ? connections.find((conn) => conn.accountId === s.accountId) : null;
              const online = c?.state === "online";
              return (
                <option key={s.key} value={s.key}>
                  {online ? "🟢" : "⚪"} {s.username || s.accountId || "Chưa đăng nhập"} {s.accountId ? `(${s.accountId})` : ""}
                </option>
              );
            })}
          </select>

          {activeAccountId && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 10px",
                background: "var(--panel-2)",
                borderRadius: "var(--r)",
                border: "1px solid var(--line)",
                fontSize: 12,
              }}
            >
              <span>Vị trí hiện tại:</span>
              <strong style={{ color: "var(--accent-ink)" }}>
                {currentChar?.location ? `${currentChar.location.map || "Chưa rõ"} (${currentChar.location.x ?? 0}, ${currentChar.location.y ?? 0})` : "---"}
              </strong>
              {inBattle && <span style={{ color: "var(--bad)", fontWeight: 600 }}>⚔️ Đang trong trận</span>}
            </div>
          )}
        </div>
      </div>

      {/* Card Chế độ Truy Kích Quái (Anchor-Point NPC Chase) */}
      <div
        className="card"
        style={{
          background: isChasing ? "linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(168, 85, 247, 0.04) 100%)" : "var(--panel)",
          border: isChasing ? "1px solid rgba(236, 72, 153, 0.4)" : "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>🎯</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: isChasing ? "var(--accent-ink)" : "var(--text)" }}>
                Chế Độ Tự Động Truy Kích Quái (Anchor-Point NPC Chase)
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Tự động tìm kiếm và tiếp cận NPC quanh tọa độ gốc bãi train. Khóa bán kính an toàn tuyệt đối — không đi lang thang khỏi bãi train.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isChasing ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  borderRadius: 12,
                  background: "rgba(34, 197, 94, 0.15)",
                  color: "#22c55e",
                  border: "1px solid #22c55e40",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span className="spin" style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                ĐANG TRUY KÍCH
              </span>
            ) : (
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 12,
                  background: "var(--panel-2)",
                  color: "var(--muted)",
                  border: "1px solid var(--line)",
                  fontSize: 12,
                }}
              >
                ⚪ Đang tắt
              </span>
            )}

            {isChasing ? (
              <button
                type="button"
                onClick={() => void handleToggleChase(false)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--bad)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--r)",
                  cursor: "pointer",
                }}
              >
                🛑 Dừng Truy Kích
              </button>
            ) : (
              <button
                type="button"
                disabled={!isOnline || inBattle}
                onClick={() => void handleToggleChase(true, true)}
                title="Bật truy kích tại tọa độ hiện tại của nhân vật"
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--accent)",
                  color: "var(--accent-on)",
                  border: "none",
                  borderRadius: "var(--r)",
                  cursor: !isOnline || inBattle ? "default" : "pointer",
                }}
              >
                🎯 Bật Tại Vị Trí Này
              </button>
            )}
          </div>
        </div>

        {/* Thông tin tọa độ gốc & Bán kính */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            paddingTop: 8,
            borderTop: "1px dashed var(--line)",
            fontSize: 13,
          }}
        >
          <div>
            <span style={{ color: "var(--muted)" }}>Tâm truy kích (Anchor Point): </span>
            <strong style={{ color: "var(--accent-ink)" }}>
              {liveChaseConfig?.originX && liveChaseConfig?.originY
                ? `Map ${liveChaseConfig.mapId} (${liveChaseConfig.originX}, ${liveChaseConfig.originY}) ${liveChaseConfig.npcName ? `[${liveChaseConfig.npcName}]` : ""}`
                : "Chưa cấu hình (Chọn bãi train bên dưới)"}
            </strong>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>Bán kính an toàn:</span>
            <input
              type="range"
              min={50}
              max={400}
              step={10}
              value={liveChaseConfig?.maxRadius ?? 150}
              onChange={(e) => void handleUpdateChaseRadius(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <strong style={{ minWidth: 45, color: "var(--text)" }}>{liveChaseConfig?.maxRadius ?? 150}px</strong>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={liveChaseConfig?.autoReturn ?? true}
                onChange={(e) => void handleUpdateAutoReturn(e.target.checked)}
              />
              <span>Tự động quay về tâm sau trận</span>
            </label>
          </div>
        </div>
      </div>

      {/* Thông báo tiến trình di chuyển nếu đang chạy */}
      {actionBusy && (
        <div
          style={{
            padding: "10px 16px",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--r)",
            color: "var(--accent-ink)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <span className="spin" style={{ width: 14, height: 14, border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
          <span>{actionMsg ?? "Đang thực thi chuỗi hành động di chuyển an toàn..."}</span>
        </div>
      )}

      {/* 2. Bộ Lọc Tìm Kiếm Đa Tiêu Chí */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Hàng 1: Ô tìm kiếm Text + Sắp xếp */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--text)" }}>
              🔍 Tìm kiếm nhanh (Quái, NPC ID, Map, Map ID):
            </label>
            <input
              type="text"
              placeholder="VD: Đấu Vật, Lưu Bị, 11047, Rừng 30, 12815..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", fontSize: 13 }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--text)" }}>
              Hệ quái (Element):
            </label>
            <select
              value={element}
              onChange={(e) => setElement(e.target.value)}
              style={{ width: "100%", padding: "7px 30px 7px 10px", fontSize: 13 }}
            >
              <option value="all">Tất cả các hệ</option>
              <option value="1">⛰️ Địa (Hệ 1)</option>
              <option value="2">💧 Thủy (Hệ 2)</option>
              <option value="3">🔥 Hỏa (Hệ 3)</option>
              <option value="4">🍃 Phong (Hệ 4)</option>
              <option value="5">🔮 Tâm (Hệ 5)</option>
              <option value="7">☀️ Quang (Hệ 7)</option>
              <option value="8">🌙 Ám (Hệ 8)</option>
              <option value="0">⚪ Vô hệ (Hệ 0)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--text)" }}>
              Trạng thái Chuyển Sinh (CS):
            </label>
            <select
              value={cs}
              onChange={(e) => setCs(e.target.value)}
              style={{ width: "100%", padding: "7px 30px 7px 10px", fontSize: 13 }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="0">Chưa Chuyển Sinh (CS 0)</option>
              <option value="1">Chuyển Sinh Lần 1 (CS 1)</option>
              <option value="2">Tái Sinh (CS 2)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--text)" }}>
              Số lượng quái / nhóm:
            </label>
            <select
              value={minCount}
              onChange={(e) => setMinCount(Number(e.target.value))}
              style={{ width: "100%", padding: "7px 30px 7px 10px", fontSize: 13 }}
            >
              <option value="0">Tất cả số lượng</option>
              <option value="1">Ít nhất 1 quái</option>
              <option value="2">Từ 2 quái trở lên</option>
              <option value="3">Từ 3 quái trở lên</option>
              <option value="4">Từ 4 quái trở lên</option>
              <option value="5">Từ 5 quái trở lên</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 5, color: "var(--text)" }}>
              Sắp xếp theo:
            </label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              style={{ width: "100%", padding: "7px 30px 7px 10px", fontSize: 13 }}
            >
              <option value="level_asc">Cấp độ: Thấp đến Cao</option>
              <option value="level_desc">Cấp độ: Cao đến Thấp</option>
              <option value="agi_desc">⚡ Tốc độ (AGI): Nhanh nhất</option>
              <option value="agi_asc">⚡ Tốc độ (AGI): Chậm nhất</option>
              <option value="count">Số lượng quái (Nhiều nhất)</option>
              <option value="map">Map ID (Tăng dần)</option>
              <option value="name">Tên NPC (A - Z)</option>
            </select>
          </div>
        </div>

        {/* Hàng 2: Lọc khoảng Level & Các nút Preset */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, paddingTop: 4, borderTop: "1px dashed var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Cấp độ (Level):</span>
            <input
              type="number"
              min={1}
              max={200}
              value={minLv}
              onChange={(e) => setMinLv(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 64, padding: "4px 6px", fontSize: 12, textAlign: "center" }}
            />
            <span style={{ color: "var(--muted)" }}>đến</span>
            <input
              type="number"
              min={1}
              max={200}
              value={maxLv}
              onChange={(e) => setMaxLv(Math.min(200, Number(e.target.value) || 200))}
              style={{ width: 64, padding: "4px 6px", fontSize: 12, textAlign: "center" }}
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1 }}>
            {LEVEL_PRESETS.map((p) => {
              const activePreset = minLv === p.min && maxLv === p.max;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setMinLv(p.min);
                    setMaxLv(p.max);
                  }}
                  style={{
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 500,
                    borderRadius: 4,
                    background: activePreset ? "var(--accent-soft)" : "var(--panel-2)",
                    color: activePreset ? "var(--accent-ink)" : "var(--muted)",
                    border: activePreset ? "1px solid var(--accent)" : "1px solid var(--line)",
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={resetFilters}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              background: "transparent",
              border: "1px solid var(--line)",
              color: "var(--muted)",
              cursor: "pointer",
              borderRadius: "var(--r)",
            }}
          >
            🔄 Xóa bộ lọc
          </button>
        </div>
      </div>

      {/* 3. Danh Sách Kết Quả & Phân Trang */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Thanh Header của Danh sách */}
        <div
          style={{
            padding: "12px 16px",
            background: "var(--panel-2)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {loadingData ? (
              <span>⏳ Đang tải dữ liệu bãi train Tam Quốc...</span>
            ) : (
              <span>
                Tìm thấy <strong style={{ color: "var(--accent-ink)" }}>{sorted.length.toLocaleString()}</strong> bãi train phù hợp
                {spawns.length > 0 && <span style={{ color: "var(--muted)", fontWeight: 400 }}> (trong tổng số {spawns.length.toLocaleString()})</span>}
              </span>
            )}
          </div>

          {/* Phân trang */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>Hiển thị:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{ padding: "3px 24px 3px 6px", fontSize: 12 }}
            >
              <option value="20">20 / trang</option>
              <option value="30">30 / trang</option>
              <option value="50">50 / trang</option>
              <option value="100">100 / trang</option>
            </select>

            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{ padding: "3px 8px", fontSize: 12 }}
            >
              ◀ Trước
            </button>
            <span style={{ fontWeight: 600 }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{ padding: "3px 8px", fontSize: 12 }}
            >
              Sau ▶
            </button>
          </div>
        </div>

        {/* Bảng Dữ Liệu Bãi Train */}
        {loadingData ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            <div className="spin" style={{ width: 24, height: 24, margin: "0 auto 12px", border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
            <div>Đang nạp 7.500+ bãi quái từ Eve.emg & Npc_C.dat...</div>
          </div>
        ) : currentPageItems.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Không tìm thấy bãi train nào phù hợp</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Hãy thử thay đổi từ khóa tìm kiếm hoặc mở rộng khoảng Level / Hệ quái.</div>
            <button
              type="button"
              onClick={resetFilters}
              style={{ marginTop: 14, padding: "6px 14px", fontSize: 12, background: "var(--accent-soft)", color: "var(--accent-ink)", border: "1px solid var(--accent)" }}
            >
              Đặt lại bộ lọc
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ background: "var(--head)", borderBottom: "1px solid var(--line)", color: "var(--muted)", fontSize: 12 }}>
                  <th style={{ padding: "10px 14px", width: 50 }}>#</th>
                  <th style={{ padding: "10px 14px" }}>Quái Vật / NPC</th>
                  <th style={{ padding: "10px 14px", width: 95 }}>Cấp Độ</th>
                  <th style={{ padding: "10px 14px", width: 85 }}>AGI</th>
                  <th style={{ padding: "10px 14px", width: 95 }}>Hệ</th>
                  <th style={{ padding: "10px 14px", width: 125 }}>Vị Trí Đội Hình</th>
                  <th style={{ padding: "10px 14px" }}>Bản Đồ & Tọa Độ</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", minWidth: 220 }}>Hành Động</th>
                </tr>
              </thead>
              <tbody>
                {currentPageItems.map((item, idx) => {
                  const elem = ELEMENT_LABELS[item.element] ?? ELEMENT_LABELS[0]!;
                  const csInfo = CS_LABELS[item.cs] ?? CS_LABELS[0]!;
                  const isSameMap = currentChar?.location?.map === item.mapId;
                  const isCurrentlyChasingThis = isChasing && liveChaseConfig?.mapId === item.mapId && liveChaseConfig?.npcId === item.npcId;
                  const itemIndex = (page - 1) * pageSize + idx + 1;

                  return (
                    <tr
                      key={`${item.mapId}-${item.npcId}-${item.x}-${item.y}-${idx}`}
                      style={{
                        borderBottom: "1px solid var(--line-soft)",
                        background: isCurrentlyChasingThis
                          ? "rgba(236, 72, 153, 0.08)"
                          : isSameMap
                          ? "rgba(76, 195, 209, 0.04)"
                          : "transparent",
                        borderLeft: isCurrentlyChasingThis ? "4px solid #ec4899" : "4px solid transparent",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = isCurrentlyChasingThis ? "rgba(236, 72, 153, 0.12)" : "var(--panel-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = isCurrentlyChasingThis ? "rgba(236, 72, 153, 0.08)" : isSameMap ? "rgba(76, 195, 209, 0.04)" : "transparent")}
                    >
                      {/* Cột 1: Thứ tự */}
                      <td style={{ padding: "10px 14px", color: "var(--faint)", fontSize: 12 }}>
                        {itemIndex}
                      </td>

                      {/* Cột 2: Tên quái + NPC ID + HP */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600, color: "var(--text)" }}>{item.npcName}</span>
                          {isCurrentlyChasingThis && (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: "rgba(236, 72, 153, 0.2)",
                                color: "#f472b6",
                                border: "1px solid #ec4899",
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ec4899" }} />
                              <span>ĐANG TRUY KÍCH</span>
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
                          ID: #{item.npcId}
                          {item.hp ? ` • ${item.hp.toLocaleString()} HP` : ""}
                        </div>
                      </td>

                      {/* Cột 3: Cấp độ + CS Badge */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 700, color: item.level >= 150 ? "var(--bad)" : item.level >= 100 ? "var(--warn)" : "var(--ok)" }}>
                            Lv.{item.level}
                          </span>
                          {item.cs > 0 && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: csInfo.bg,
                                color: csInfo.color,
                                border: `1px solid ${csInfo.color}40`,
                              }}
                            >
                              {csInfo.name}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cột 4: Tốc độ AGI */}
                      <td style={{ padding: "10px 14px" }}>
                        {item.agi != null && item.agi > 0 ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              fontSize: 12,
                              fontWeight: 700,
                              color: item.agi >= 100 ? "#f43f5e" : item.agi >= 50 ? "#f59e0b" : "#38bdf8",
                            }}
                            title={`Tốc độ AGI: ${item.agi}`}
                          >
                            <span>⚡</span>
                            <span>{item.agi}</span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--faint)", fontSize: 11 }}>--</span>
                        )}
                      </td>

                      {/* Cột 5: Hệ NPC */}
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: elem.bg,
                            color: elem.color,
                            border: `1px solid ${elem.color}40`,
                          }}
                        >
                          <span>{elem.icon}</span>
                          <span>{elem.name}</span>
                        </span>
                      </td>

                      {/* Cột 6: Vị trí đội hình trong trận (Location) */}
                      <td
                        style={{ padding: "10px 14px" }}
                        onMouseEnter={(e) => {
                          if (item.locations && item.locations.length > 0) {
                            setHoveredBattleSpot({ item, pos: { x: e.clientX, y: e.clientY } });
                          }
                        }}
                        onMouseMove={(e) => {
                          if (item.locations && item.locations.length > 0) {
                            setHoveredBattleSpot({ item, pos: { x: e.clientX, y: e.clientY } });
                          }
                        }}
                        onMouseLeave={() => setHoveredBattleSpot(null)}
                      >
                        {item.locations && item.locations.length > 0 ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setHoveredBattleSpot(null);
                              setPopupSpawn(item);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              cursor: "pointer",
                              padding: "3px 8px",
                              borderRadius: 5,
                              background: "rgba(56, 189, 248, 0.12)",
                              border: "1px solid rgba(56, 189, 248, 0.35)",
                              transition: "all 0.15s ease",
                            }}
                            title="Nhấp để mở bảng chi tiết các đội hình • Rà chuột để xem nhanh"
                          >
                            <span style={{ fontSize: 11, color: "#38bdf8" }}>📍</span>
                            <span style={{ fontWeight: 600, fontSize: 12, color: "var(--accent-ink)" }}>
                              {item.locations[0]}
                            </span>
                            {item.locations.length > 1 && (
                              <span
                                style={{
                                  fontSize: 10,
                                  padding: "0 4px",
                                  borderRadius: 3,
                                  background: "rgba(255, 255, 255, 0.12)",
                                  color: "var(--muted)",
                                }}
                                title={`Có ${item.locations.length} kiểu đội hình khác nhau (Nhấp để xem)`}
                              >
                                +{item.locations.length - 1}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "var(--faint)", fontSize: 11 }}>--</span>
                        )}
                      </td>

                      {/* Cột 7: Bản đồ & Tọa độ */}
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600 }}>{item.mapName}</span>
                          <span style={{ fontSize: 11, color: "var(--faint)" }}>({item.mapId})</span>
                          {isSameMap && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: 10,
                                background: "var(--ok-soft)",
                                color: "var(--ok)",
                                border: "1px solid var(--ok)",
                              }}
                            >
                              📍 Đang ở map này
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                          Tọa độ: <code style={{ color: "var(--accent-ink)" }}>({item.x}, {item.y})</code>
                        </div>
                      </td>

                      {/* Cột 8: Hành động Warp & Di chuyển */}
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {isCurrentlyChasingThis ? (
                            <button
                              type="button"
                              disabled={actionBusy}
                              title="Nhấp để dừng chế độ truy kích bãi này"
                              onClick={() => void handleToggleChase(false)}
                              style={{
                                padding: "5px 11px",
                                fontSize: 12,
                                fontWeight: 600,
                                borderRadius: "var(--r)",
                                background: "rgba(239, 68, 68, 0.2)",
                                color: "#f87171",
                                border: "1px solid #ef4444",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <span>🛑</span>
                              <span>Dừng Truy Kích</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={!isOnline || inBattle || actionBusy}
                              title={`Warp đến ${item.mapName} và tự động kích hoạt truy kích quái ${item.npcName} quanh tọa độ (${item.x}, ${item.y})`}
                              onClick={() => void handleStartChaseAtSpot(item)}
                              style={{
                                padding: "5px 11px",
                                fontSize: 12,
                                fontWeight: 600,
                                borderRadius: "var(--r)",
                                background: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
                                color: "#fff",
                                border: "none",
                                cursor: !isOnline || inBattle || actionBusy ? "default" : "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                              }}
                            >
                              <span>🎯</span>
                              <span>Truy Kích</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={!isOnline || inBattle || actionBusy}
                            title={
                              !isOnline
                                ? "Tài khoản đang offline"
                                : inBattle
                                ? "Đang trong trận đấu"
                                : `Warp tới ${item.mapName} và đi bộ tới tọa độ quái (${item.x}, ${item.y})`
                            }
                            onClick={() => void handleWarpToSpot(item)}
                            style={{
                              padding: "5px 11px",
                              fontSize: 12,
                              fontWeight: 600,
                              borderRadius: "var(--r)",
                              background: "var(--accent)",
                              color: "var(--accent-on)",
                              border: "none",
                              cursor: !isOnline || inBattle || actionBusy ? "default" : "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                            }}
                          >
                            <span>🚀</span>
                            <span>Warp & Đến Train</span>
                          </button>

                          <button
                            type="button"
                            disabled={!isOnline || inBattle || actionBusy || isSameMap}
                            title={isSameMap ? "Đã ở map này rồi" : `Chỉ warp tới cổng bản đồ ${item.mapName}`}
                            onClick={() => void handleWarpMapOnly(item.mapId, item.mapName)}
                            style={{
                              padding: "5px 9px",
                              fontSize: 12,
                              fontWeight: 500,
                              borderRadius: "var(--r)",
                              background: "transparent",
                              color: "var(--muted)",
                              border: "1px solid var(--line)",
                              cursor: !isOnline || inBattle || actionBusy || isSameMap ? "default" : "pointer",
                            }}
                          >
                            🗺️ Cổng Map
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Thanh Footer phân trang dưới đáy bảng */}
        {currentPageItems.length > 0 && (
          <div
            style={{
              padding: "10px 16px",
              background: "var(--panel-2)",
              borderTop: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--muted)" }}>
              Trang {page} / {totalPages} (hiển thị {(page - 1) * pageSize + 1} - {Math.min(sorted.length, page * pageSize)} trong {sorted.length.toLocaleString()} bãi train)
            </span>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                Đầu
              </button>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                ◀ Trước
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                Sau ▶
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                Cuối
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Hướng dẫn & Cơ Chế Hoạt Động (Knowledge Note) */}
      <div
        className="card"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--line-soft)",
          fontSize: 12,
          color: "var(--muted)",
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <span>💡</span>
          <span>Cơ Chế Di Chuyển An Toàn & Chống Kích Máy Chủ (Anti-Cheat Bypassed)</span>
        </div>
        <div>
          • <strong>Tầng 1 - Cổng thành:</strong> Dùng gói <code>44/01</code> dịch chuyển tức thời tới cổng thành gần nhất trong danh sách 41 thành trì của Tam Quốc.
        </div>
        <div>
          • <strong>Tầng 2 - Duyệt đồ thị BFS:</strong> Tự động tìm chuỗi cổng chuyển map (door index) tối ưu nhất qua CSDL 8.360 liên kết map của game.
        </div>
        <div>
          • <strong>Tầng 3 - Đi bộ nội suy Isometric:</strong> Nhân vật di chuyển từng bước nhảy ≤ 85px với nhịp delay 420ms chuẩn game, đảm bảo cự ly tiếp cận cổng ≤ 40px trước khi gửi <code>14/08</code> và tiếp cận NPC trước khi train (triệt tiêu 100% lỗi Kick mã 5 và mã 44).
        </div>
      </div>

      {/* Tooltip vị trí quái trên bàn cờ trận đấu khi hover (chỉ hiện khi chưa mở modal) */}
      {hoveredBattleSpot && !popupSpawn && (
        <BattleGridTooltip item={hoveredBattleSpot.item} pos={hoveredBattleSpot.pos} />
      )}

      {/* Popup Modal chi tiết các đội hình chiến đấu khi click */}
      {popupSpawn && (
        <BattleFormationModal
          item={popupSpawn}
          onClose={() => setPopupSpawn(null)}
          onWarp={(it) => void handleWarpToSpot(it)}
          onStartChase={(it) => void handleStartChaseAtSpot(it)}
          onStopChase={() => void handleToggleChase(false)}
          isChasingThis={
            Boolean(isChasing && liveChaseConfig?.mapId === popupSpawn.mapId && liveChaseConfig?.npcId === popupSpawn.npcId)
          }
          isOnline={Boolean(isOnline)}
          inBattle={Boolean(inBattle)}
          actionBusy={Boolean(actionBusy)}
        />
      )}
    </div>
  );
}

/** Popup Modal hiển thị chi tiết các cấu hình đội hình chiến đấu (Battle Formation) khi click */
function BattleFormationModal({
  item,
  onClose,
  onWarp,
  onStartChase,
  onStopChase,
  isChasingThis,
  isOnline,
  inBattle,
  actionBusy,
}: {
  item: TrainSpawn;
  onClose: () => void;
  onWarp: (item: TrainSpawn) => void;
  onStartChase: (item: TrainSpawn) => void;
  onStopChase: () => void;
  isChasingThis: boolean;
  isOnline: boolean;
  inBattle: boolean;
  actionBusy: boolean;
}) {
  const locations = item.locations || [];
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Đóng modal khi nhấn phím Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const currentLocStr = locations[selectedIdx] || locations[0] || "";

  const activeSlots = useMemo(() => {
    const nums = currentLocStr
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    return new Set(nums);
  }, [currentLocStr]);

  const frontCount = [1, 2, 3, 4, 5].filter((s) => activeSlots.has(s)).length;
  const backCount = [6, 7, 8, 9, 10].filter((s) => activeSlots.has(s)).length;

  let tacticAdvice = "🥊 Đấu Vật (đánh thường) hoặc Kỹ năng đơn thể.";
  if (frontCount >= 3 && backCount === 0) {
    tacticAdvice = "🌪️ Quái xếp hàng ngang! Ưu tiên Skill Đánh Hàng Ngang (Hoành Tảo, Cuồng Phong...).";
  } else if (frontCount + backCount >= 5) {
    tacticAdvice = "💥 Quái đông (≥5)! Ưu tiên Skill Đánh Toàn Thể / Loạn Kích / Băng Phong / Nham Quái.";
  } else if (frontCount > 0 && backCount > 0) {
    const hasSameCol = [0, 1, 2, 3, 4].some((c) => activeSlots.has(c + 1) && activeSlots.has(c + 6));
    if (hasSameCol) {
      tacticAdvice = "⚡ Quái đứng thẳng hàng dọc! Thích hợp Skill Đánh Cột Dọc (Địa Liệt, Hỏa Long...).";
    }
  }

  const backSlots = [
    { id: 6, col: 0, label: "(1,0)" },
    { id: 7, col: 1, label: "(1,1)" },
    { id: 8, col: 2, label: "(1,2)" },
    { id: 9, col: 3, label: "(1,3)" },
    { id: 10, col: 4, label: "(1,4)" },
  ];

  const frontSlots = [
    { id: 1, col: 0, label: "(0,0)" },
    { id: 2, col: 1, label: "(0,1)" },
    { id: 3, col: 2, label: "(0,2)" },
    { id: 4, col: 3, label: "(0,3)" },
    { id: 5, col: 4, label: "(0,4)" },
  ];

  const elem = ELEMENT_LABELS[item.element] ?? ELEMENT_LABELS[0]!;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--panel)",
          border: "1px solid var(--accent-subtle)",
          borderRadius: 14,
          boxShadow: "0 20px 50px -10px rgba(0, 0, 0, 0.8), 0 0 20px rgba(56, 189, 248, 0.2)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line-soft)",
            background: "rgba(255, 255, 255, 0.02)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 16,
                padding: "4px 8px",
                borderRadius: 6,
                background: elem.bg,
                border: `1px solid ${elem.color}`,
              }}
            >
              {elem.icon}
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: "var(--accent-ink)" }}>
                  {item.npcName}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>#{item.npcId}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Bản đồ: <strong style={{ color: "var(--text)" }}>{item.mapName}</strong> ({item.mapId}) • Tọa độ:{" "}
                <code style={{ color: "var(--accent-ink)" }}>({item.x}, {item.y})</code>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "none",
              borderRadius: 6,
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        {/* Thân Modal */}
        <div style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
          {/* Thông số chiến đấu: Level, Hệ, AGI, HP */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
              background: "rgba(0, 0, 0, 0.25)",
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--line-soft)",
              textAlign: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Cấp Độ</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: item.level >= 100 ? "var(--warn)" : "var(--ok)" }}>
                Lv.{item.level}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Hệ Phái</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: elem.color }}>
                {elem.name}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Tốc Độ AGI</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#38bdf8" }}>
                {item.agi ?? "--"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>Máu HP</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#f87171" }}>
                {item.hp ? item.hp.toLocaleString() : "--"}
              </div>
            </div>
          </div>

          {/* Chọn Đội hình nếu có nhiều hơn 1 đội hình */}
          {locations.length > 1 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                <span>CÁC KIỂU ĐỘI HÌNH TRONG TRẬN ({locations.length} ĐỘI HÌNH)</span>
                <span style={{ color: "var(--accent-ink)" }}>Nhấp tab để xem sơ đồ</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {locations.map((loc, idx) => {
                  const qCount = loc.split(",").filter((s) => s.trim().length > 0).length;
                  const isSelected = selectedIdx === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedIdx(idx)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: isSelected ? "1px solid var(--accent)" : "1px solid var(--line-soft)",
                        background: isSelected ? "var(--accent)" : "rgba(255, 255, 255, 0.04)",
                        color: isSelected ? "var(--accent-on)" : "var(--text)",
                        fontWeight: isSelected ? 700 : 500,
                        fontSize: 12,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span>🛡️ Đội hình {idx + 1}</span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 5px",
                          borderRadius: 10,
                          background: isSelected ? "rgba(0, 0, 0, 0.25)" : "rgba(255, 255, 255, 0.1)",
                        }}
                      >
                        {qCount} quái
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Chi tiết đội hình đang chọn */}
          <div
            style={{
              background: "rgba(0, 0, 0, 0.35)",
              border: "1px solid var(--line-soft)",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Mã vị trí (Protocol): <code style={{ color: "var(--accent-ink)", fontWeight: 700 }}>{currentLocStr}</code>
              </div>
              <div style={{ fontSize: 12 }}>
                Tổng số lượng: <strong style={{ color: "#4ade80" }}>{activeSlots.size} quái vật</strong>
              </div>
            </div>

            {/* Bàn cờ trận đấu 2x5 */}
            {/* Hàng sau */}
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>HÀNG SAU (Quái vật)</span>
              <span style={{ color: backCount > 0 ? "#f97316" : "inherit", fontWeight: backCount > 0 ? 600 : 400 }}>
                {backCount} quái
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 10 }}>
              {backSlots.map((s) => {
                const hasUnit = activeSlots.has(s.id);
                return (
                  <div
                    key={s.id}
                    style={{
                      height: 52,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: hasUnit
                        ? "linear-gradient(135deg, rgba(239, 68, 68, 0.5), rgba(249, 115, 22, 0.65))"
                        : "rgba(255, 255, 255, 0.02)",
                      border: hasUnit ? "1.5px solid #f97316" : "1px dashed rgba(255, 255, 255, 0.12)",
                      boxShadow: hasUnit ? "0 0 12px rgba(249, 115, 22, 0.5)" : "none",
                      color: hasUnit ? "#fff" : "rgba(255, 255, 255, 0.25)",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{hasUnit ? "👾" : "·"}</span>
                    <span style={{ fontSize: 9, opacity: 0.8 }}>{s.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Hàng trước */}
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>HÀNG TRƯỚC (Quái vật)</span>
              <span style={{ color: frontCount > 0 ? "#f97316" : "inherit", fontWeight: frontCount > 0 ? 600 : 400 }}>
                {frontCount} quái
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {frontSlots.map((s) => {
                const hasUnit = activeSlots.has(s.id);
                return (
                  <div
                    key={s.id}
                    style={{
                      height: 52,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: hasUnit
                        ? "linear-gradient(135deg, rgba(239, 68, 68, 0.5), rgba(249, 115, 22, 0.65))"
                        : "rgba(255, 255, 255, 0.02)",
                      border: hasUnit ? "1.5px solid #f97316" : "1px dashed rgba(255, 255, 255, 0.12)",
                      boxShadow: hasUnit ? "0 0 12px rgba(249, 115, 22, 0.5)" : "none",
                      color: hasUnit ? "#fff" : "rgba(255, 255, 255, 0.25)",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{hasUnit ? "👾" : "·"}</span>
                    <span style={{ fontSize: 9, opacity: 0.8 }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gợi ý chiến thuật combo kỹ năng */}
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(56, 189, 248, 0.1)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              borderRadius: 8,
              fontSize: 12,
              color: "#38bdf8",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>🎯</span>
            <div>{tacticAdvice}</div>
          </div>
        </div>

        {/* Footer nút hành động */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--line-soft)",
            background: "rgba(255, 255, 255, 0.02)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 14px",
              borderRadius: "var(--r)",
              border: "1px solid var(--line-soft)",
              background: "transparent",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Đóng
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {isChasingThis ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  onStopChase();
                  onClose();
                }}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "var(--r)",
                  background: "rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                  border: "1px solid #ef4444",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>🛑</span>
                <span>Dừng Truy Kích</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!isOnline || inBattle || actionBusy}
                onClick={() => {
                  onStartChase(item);
                  onClose();
                }}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "var(--r)",
                  background: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
                  color: "#fff",
                  border: "none",
                  cursor: !isOnline || inBattle || actionBusy ? "default" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>🎯</span>
                <span>Kích Hoạt Truy Kích</span>
              </button>
            )}

            <button
              type="button"
              disabled={!isOnline || inBattle || actionBusy}
              onClick={() => {
                onWarp(item);
                onClose();
              }}
              style={{
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: "var(--r)",
                background: "var(--accent)",
                color: "var(--accent-on)",
                border: "none",
                cursor: !isOnline || inBattle || actionBusy ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>🚀</span>
              <span>Warp & Đến Train</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Component hiển thị sơ đồ bàn cờ trận đấu (Mini Battle Grid 2x5) của quái khi hover */
function BattleGridTooltip({
  item,
  pos,
}: {
  item: TrainSpawn;
  pos: { x: number; y: number };
}) {
  const locations = item.locations || [];
  const [activeIdx, setActiveIdx] = useState(0);
  const currentLocStr = locations[activeIdx] || locations[0] || "";

  // Slot 1..5: Hàng trước (Front row: col 0..4, row 0 trong game protocol)
  // Slot 6..10: Hàng sau (Back row: col 0..4, row 1 trong game protocol)
  const activeSlots = useMemo(() => {
    const nums = currentLocStr
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    return new Set(nums);
  }, [currentLocStr]);

  const frontCount = [1, 2, 3, 4, 5].filter((s) => activeSlots.has(s)).length;
  const backCount = [6, 7, 8, 9, 10].filter((s) => activeSlots.has(s)).length;

  let tacticAdvice = "🥊 Đấu Vật (đánh thường) hoặc Kỹ năng đơn thể.";
  if (frontCount >= 3 && backCount === 0) {
    tacticAdvice = "🌪️ Ưu tiên Skill Đánh Hàng Ngang (Hoành Tảo, Cuồng Phong...).";
  } else if (frontCount + backCount >= 5) {
    tacticAdvice = "💥 Ưu tiên Skill Đánh Toàn Thể / Loạn Kích / Băng Phong.";
  } else if (frontCount > 0 && backCount > 0) {
    const hasSameCol = [0, 1, 2, 3, 4].some((c) => activeSlots.has(c + 1) && activeSlots.has(c + 6));
    if (hasSameCol) {
      tacticAdvice = "⚡ Quái đứng thẳng hàng dọc! Thích hợp Skill Đánh Cột Dọc (Địa Liệt, Hỏa Long...).";
    }
  }

  const isRight = typeof window !== "undefined" && pos.x > window.innerWidth - 360;
  const isBottom = typeof window !== "undefined" && pos.y > window.innerHeight - 330;

  const backSlots = [
    { id: 6, col: 0, label: "(1,0)" },
    { id: 7, col: 1, label: "(1,1)" },
    { id: 8, col: 2, label: "(1,2)" },
    { id: 9, col: 3, label: "(1,3)" },
    { id: 10, col: 4, label: "(1,4)" },
  ];

  const frontSlots = [
    { id: 1, col: 0, label: "(0,0)" },
    { id: 2, col: 1, label: "(0,1)" },
    { id: 3, col: 2, label: "(0,2)" },
    { id: 4, col: 3, label: "(0,3)" },
    { id: 5, col: 4, label: "(0,4)" },
  ];

  const elem = ELEMENT_LABELS[item.element] ?? ELEMENT_LABELS[0]!;

  return (
    <div
      style={{
        position: "fixed",
        left: isRight ? Math.max(10, pos.x - 350) : pos.x + 16,
        top: isBottom ? Math.max(10, pos.y - 310) : pos.y + 16,
        zIndex: 99999,
        width: 330,
        background: "rgba(15, 23, 42, 0.96)",
        border: "1px solid rgba(56, 189, 248, 0.45)",
        boxShadow: "0 12px 30px -4px rgba(0, 0, 0, 0.8), 0 0 15px rgba(56, 189, 248, 0.25)",
        borderRadius: 10,
        padding: "12px 14px",
        pointerEvents: "none",
        backdropFilter: "blur(12px)",
        color: "#f8fafc",
        fontSize: 12,
      }}
    >
      {/* Header Tooltip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          paddingBottom: 6,
        }}
      >
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--accent-ink)" }}>{item.npcName}</span>
          <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }}>#{item.npcId}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: elem.color, fontWeight: 600 }}>
            {elem.icon} {elem.name}
          </span>
          <span style={{ color: item.level >= 100 ? "var(--warn)" : "var(--ok)", fontWeight: 700 }}>
            Lv.{item.level}
          </span>
        </div>
      </div>

      {/* Thông số chiến đấu: AGI, HP, Số quái */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          margin: "8px 0",
          fontSize: 11,
          background: "rgba(255,255,255,0.04)",
          padding: "5px 8px",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span>
          ⚡ AGI: <strong style={{ color: "#38bdf8" }}>{item.agi ?? "--"}</strong>
        </span>
        <span>
          ❤️ HP: <strong style={{ color: "#f87171" }}>{item.hp ? item.hp.toLocaleString() : "--"}</strong>
        </span>
        <span>
          👥 Quái: <strong style={{ color: "#4ade80" }}>x{activeSlots.size}</strong>
        </span>
      </div>

      {/* Selector nếu có nhiều cấu hình trận đấu */}
      {locations.length > 1 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, overflowX: "auto", paddingBottom: 2 }}>
          {locations.map((loc, idx) => (
            <span
              key={idx}
              style={{
                padding: "2px 6px",
                fontSize: 10,
                borderRadius: 3,
                background: activeIdx === idx ? "var(--accent)" : "rgba(255,255,255,0.08)",
                color: activeIdx === idx ? "#0f172a" : "var(--muted)",
                fontWeight: activeIdx === idx ? 700 : 500,
              }}
            >
              Đội hình {idx + 1} ({loc.split(",").length}q)
            </span>
          ))}
        </div>
      )}

      {/* Sơ đồ bàn cờ trận đấu mini 2x5 */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.45)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          padding: "8px 10px",
        }}
      >
        {/* Hàng sau */}
        <div
          style={{
            fontSize: 10,
            color: "var(--muted)",
            marginBottom: 4,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>HÀNG SAU (Quái vật)</span>
          <span style={{ color: backCount > 0 ? "#f97316" : "inherit", fontWeight: backCount > 0 ? 600 : 400 }}>
            {backCount} quái
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 6 }}>
          {backSlots.map((s) => {
            const hasUnit = activeSlots.has(s.id);
            return (
              <div
                key={s.id}
                style={{
                  height: 32,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: hasUnit
                    ? "linear-gradient(135deg, rgba(239, 68, 68, 0.4), rgba(249, 115, 22, 0.55))"
                    : "rgba(255,255,255,0.02)",
                  border: hasUnit ? "1px solid #f97316" : "1px dashed rgba(255,255,255,0.12)",
                  boxShadow: hasUnit ? "0 0 8px rgba(249, 115, 22, 0.45)" : "none",
                  color: hasUnit ? "#fff" : "rgba(255,255,255,0.25)",
                }}
              >
                <span>{hasUnit ? "👾" : "·"}</span>
                <span style={{ fontSize: 8, opacity: 0.75 }}>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Hàng trước */}
        <div
          style={{
            fontSize: 10,
            color: "var(--muted)",
            marginBottom: 4,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>HÀNG TRƯỚC (Quái vật)</span>
          <span style={{ color: frontCount > 0 ? "#f97316" : "inherit", fontWeight: frontCount > 0 ? 600 : 400 }}>
            {frontCount} quái
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
          {frontSlots.map((s) => {
            const hasUnit = activeSlots.has(s.id);
            return (
              <div
                key={s.id}
                style={{
                  height: 32,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: hasUnit
                    ? "linear-gradient(135deg, rgba(239, 68, 68, 0.4), rgba(249, 115, 22, 0.55))"
                    : "rgba(255,255,255,0.02)",
                  border: hasUnit ? "1px solid #f97316" : "1px dashed rgba(255,255,255,0.12)",
                  boxShadow: hasUnit ? "0 0 8px rgba(249, 115, 22, 0.45)" : "none",
                  color: hasUnit ? "#fff" : "rgba(255,255,255,0.25)",
                }}
              >
                <span>{hasUnit ? "👾" : "·"}</span>
                <span style={{ fontSize: 8, opacity: 0.75 }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Gợi ý chiến thuật kỹ năng */}
      <div
        style={{
          marginTop: 8,
          padding: "5px 8px",
          background: "rgba(56, 189, 248, 0.1)",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          borderRadius: 4,
          fontSize: 11,
          color: "#38bdf8",
        }}
      >
        {tacticAdvice}
      </div>
    </div>
  );
}
