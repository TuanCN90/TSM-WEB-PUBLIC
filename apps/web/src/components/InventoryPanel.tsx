import { ITEM_LIST_KEYS, type BagItem, type ItemListKey, type ItemLists } from "@tsbot/protocol";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fold } from "./MapSelect";
import { useToast } from "./Toast";

const LIST_LABEL: Record<ItemListKey, { title: string; icon: string }> = {
  autoOpen: { title: "Tự mở", icon: "🎁" },
  sell: { title: "Bán vật phẩm", icon: "🪙" },
  combine: { title: "Hợp vật phẩm", icon: "🔄" },
  resolve: { title: "Phân giải", icon: "💥" },
  contribute: { title: "Đóng góp bang", icon: "🏛️" },
  discard: { title: "Tự động vứt", icon: "🗑️" },
  exception: { title: "Ngoại lệ", icon: "🛡️" },
};

const SLOT_NAMES: Record<number, string> = {
  1: "Mũ",
  2: "Áo giáp",
  3: "Vũ khí",
  4: "Cổ tay",
  5: "Giày",
  6: "Đặc thù",
};

const STAT_META: Record<string, { icon: string; color: string }> = {
  ATK: { icon: "⚔️", color: "#f87171" },
  DEF: { icon: "🛡️", color: "#60a5fa" },
  INT: { icon: "🧠", color: "#a78bfa" },
  AGI: { icon: "⚡", color: "#34d399" },
  HP: { icon: "❤️", color: "#f43f5e" },
  SP: { icon: "💧", color: "#38bdf8" },
  "Bạo kích": { icon: "💥", color: "#fbbf24" },
  "Bội mẫn": { icon: "🌪️", color: "#fb923c" },
};

export interface ItemStat {
  type: string;
  value: number;
}

export interface ItemDetail {
  name?: string;
  desc?: string;
  level?: number;
  slot?: number;
  val?: number;
  hp?: number;
  sp?: number;
  price?: number;
  stats?: ItemStat[];
}

const nf = (n: number) => n.toLocaleString("vi-VN");
const BAG_CAPACITY = 50;
const BANK_CAPACITY = 60;

type SortKey = "slot" | "name" | "qty";
type SortDir = "asc" | "desc";
type Act = (action: string, params?: Record<string, string | number>) => Promise<void>;

export function InventoryPanel({
  accountId,
  bag,
  bank = [],
  bankOpen = false,
  canAct,
  act: actRaw,
  onBankPendingChange,
  guardLeave,
}: {
  accountId: string;
  bag: BagItem[];
  bank?: BagItem[];
  bankOpen?: boolean;
  /** Báo cho trang cha biết đang có thao tác gửi/rút chưa Lưu & Đóng kho. */
  onBankPendingChange?: (pending: boolean) => void;
  /** Chạy `go` ngay, hoặc hỏi Lưu & Đóng kho trước nếu còn thao tác chưa lưu. */
  guardLeave?: (go: () => void) => void;
  canAct: boolean;
  act: Act;
}) {
  const toast = useToast();
  const [viewMode, setViewModeRaw] = useState<"bag_and_rules" | "bank" | "shop">("bag_and_rules");
  const [bankDirty, setBankDirty] = useState(false);
  const act: Act = (action, params) => {
    if (action === "deposit_bank" || action === "withdraw_bank") setBankDirty(true);
    else if (action === "close_bank") setBankDirty(false);
    return actRaw(action, params);
  };
  const setViewMode = (m: "bag_and_rules" | "bank" | "shop") => {
    if (m === viewMode) return;
    if (guardLeave) guardLeave(() => setViewModeRaw(m));
    else setViewModeRaw(m);
  };
  useEffect(() => {
    if (!bankOpen) setBankDirty(false);
  }, [bankOpen]);
  useEffect(() => {
    onBankPendingChange?.(bankOpen && bankDirty);
  }, [bankOpen, bankDirty, onBankPendingChange]);
  useEffect(() => () => onBankPendingChange?.(false), [onBankPendingChange]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, ItemDetail>>({});
  const [lists, setLists] = useState<ItemLists | null>(null);
  const [q, setQ] = useState("");
  const [bankQ, setBankQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "slot", dir: "asc" });
  const [bankSort, setBankSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "slot", dir: "asc" });
  const [menu, setMenu] = useState<{ x: number; y: number; item: BagItem; isBank?: boolean } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<BagItem | null>(null);
  const [qtyModal, setQtyModal] = useState<{ type: "deposit" | "withdraw"; item: BagItem } | null>(null);
  const [inputQty, setInputQty] = useState(1);
  const [activeListTab, setActiveListTab] = useState<ItemListKey>("autoOpen");
  const [inputItemId, setInputItemId] = useState("");
  const [shopInputItemId, setShopInputItemId] = useState("");
  const [buyHpEnabled, setBuyHpEnabled] = useState(true);
  const [buyHpQty, setBuyHpQty] = useState(999);
  const [buySpEnabled, setBuySpEnabled] = useState(true);
  const [buySpQty, setBuySpQty] = useState(999);
  const [isTrading, setIsTrading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [batchInputText, setBatchInputText] = useState("");
  const [isSweeping, setIsSweeping] = useState(false);
  const [hovered, setHovered] = useState<{
    item: { id: number; qty?: number; slot?: number };
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    import("../data/itemNames.json").then((m) => setNames(m.default as Record<string, string>));
    import("../data/itemDetails.json").then((m) => setDetails(m.default as Record<string, ItemDetail>));
  }, []);

  useEffect(() => {
    if (!accountId) return;
    api.itemLists(accountId).then((res) => {
      setLists(res);
      if (res.buySettings) {
        setBuyHpEnabled(res.buySettings.buyHpEnabled ?? true);
        setBuyHpQty(res.buySettings.buyHpQty ?? 999);
        setBuySpEnabled(res.buySettings.buySpEnabled ?? true);
        setBuySpQty(res.buySettings.buySpQty ?? 999);
      }
    }).catch((e) => toast("error", e instanceof Error ? e.message : String(e)));
  }, [accountId, toast]);

  const handleUpdateBuySettings = (patch: Partial<import("@tsbot/protocol").BuySettings>) => {
    if (patch.buyHpEnabled !== undefined) setBuyHpEnabled(patch.buyHpEnabled);
    if (patch.buyHpQty !== undefined) setBuyHpQty(patch.buyHpQty);
    if (patch.buySpEnabled !== undefined) setBuySpEnabled(patch.buySpEnabled);
    if (patch.buySpQty !== undefined) setBuySpQty(patch.buySpQty);
    if (!accountId) return;
    api.setBuySettings(accountId, patch)
      .then((updated) => setLists(updated))
      .catch((e) => toast("error", `Không thể lưu cấu hình mua: ${e.message}`));
  };

  const handleAddSellItem = (e?: React.FormEvent | number, itemIdToAdd?: number) => {
    if (e && typeof e === "object" && "preventDefault" in e) {
      e.preventDefault();
    }
    const explicitId = typeof e === "number" ? e : itemIdToAdd;
    const rawId = explicitId ?? Number(shopInputItemId.trim());
    if (!Number.isInteger(rawId) || rawId <= 0) {
      toast("error", "ID vật phẩm phải là số nguyên dương hợp lệ");
      return;
    }
    if (!accountId) return;
    api.setItemList(accountId, "sell", rawId, true)
      .then((updated) => {
        setLists(updated);
        setShopInputItemId("");
        toast("ok", `Đã thêm ${nameOf(rawId)} (#${rawId}) vào danh sách Bán.`);
      })
      .catch((err) => toast("error", err instanceof Error ? err.message : String(err)));
  };

  const handleRemoveSellItem = (idToRemove: number) => {
    if (!accountId) return;
    api.setItemList(accountId, "sell", idToRemove, false)
      .then((updated) => {
        setLists(updated);
        toast("info", `Đã xoá ${nameOf(idToRemove)} (#${idToRemove}) khỏi danh sách Bán.`);
      })
      .catch((e) => toast("error", e.message));
  };

  const handleExecuteTrade = async () => {
    if (!canAct || isTrading) return;
    setIsTrading(true);
    try {
      await api.setBuySettings(accountId, {
        buyHpEnabled,
        buyHpQty,
        buySpEnabled,
        buySpQty,
      });
      await act("shop_sell_and_buy", {
        buyHpEnabled: buyHpEnabled ? "1" : "0",
        buyHpQty: String(buyHpQty),
        buySpEnabled: buySpEnabled ? "1" : "0",
        buySpQty: String(buySpQty),
      });
      toast("info", "Đang tự động di chuyển đến Hương Dũng để Bán & Mua HP/SP. Theo dõi tiến trình tại tab Sự kiện!");
    } catch (e) {
      toast("error", `Lỗi thực hiện Mua/Bán: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsTrading(false);
    }
  };

  const nameOf = (id: number) => names[String(id)] ?? details[String(id)]?.name ?? `Vật phẩm #${id}`;

  const rows = useMemo(() => {
    const k = fold(q.trim());
    const list = k ? bag.filter((b) => fold(`${b.id} ${nameOf(b.id)}`).includes(k)) : [...bag];
    const sign = sort.dir === "asc" ? 1 : -1;
    return list.sort((x, y) =>
      sign *
      (sort.key === "name"
        ? nameOf(x.id).localeCompare(nameOf(y.id), "vi") || x.slot - y.slot
        : sort.key === "qty"
        ? x.qty - y.qty || x.slot - y.slot
        : x.slot - y.slot)
    );
  }, [bag, names, details, q, sort]);

  const bankRows = useMemo(() => {
    const k = fold(bankQ.trim());
    const list = k ? bank.filter((b) => fold(`${b.id} ${nameOf(b.id)}`).includes(k)) : [...bank];
    const sign = bankSort.dir === "asc" ? 1 : -1;
    return list.sort((x, y) =>
      sign *
      (bankSort.key === "name"
        ? nameOf(x.id).localeCompare(nameOf(y.id), "vi") || x.slot - y.slot
        : bankSort.key === "qty"
        ? x.qty - y.qty || x.slot - y.slot
        : x.slot - y.slot)
    );
  }, [bank, names, details, bankQ, bankSort]);

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

  const sortBankBy = (key: SortKey) => setBankSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  const bankArrow = (key: SortKey) => (bankSort.key === key ? (bankSort.dir === "asc" ? " ▲" : " ▼") : "");

  const toggleList = async (item: { id: number }, key: ItemListKey, forceOn?: boolean) => {
    const has = lists?.[key].includes(item.id) ?? false;
    const nextOn = forceOn !== undefined ? forceOn : !has;
    if (!nextOn && !has) return;
    if (nextOn && has) {
      toast("info", `ID ${item.id} (${nameOf(item.id)}) đã có sẵn trong danh sách ${LIST_LABEL[key].title}`);
      return;
    }
    try {
      const next = await api.setItemList(accountId, key, item.id, nextOn);
      setLists(next);
      toast(
        "ok",
        nextOn
          ? `Đã lưu ID ${item.id} (${nameOf(item.id)}) vào danh sách ${LIST_LABEL[key].title}`
          : `Đã xoá ID ${item.id} (${nameOf(item.id)}) khỏi danh sách ${LIST_LABEL[key].title}`
      );
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(inputItemId.trim(), 10);
    if (isNaN(parsed) || parsed <= 0) {
      toast("error", "Vui lòng nhập ID vật phẩm hợp lệ (số nguyên dương)");
      return;
    }
    void toggleList({ id: parsed }, activeListTab, true);
    setInputItemId("");
  };

  const handleCopyList = async () => {
    const currentList = lists?.[activeListTab] ?? [];
    if (!currentList.length) {
      toast("info", `Danh sách ${LIST_LABEL[activeListTab].title} đang trống.`);
      return;
    }
    const text = currentList.join(", ");
    try {
      await navigator.clipboard.writeText(text);
      toast("ok", `Đã sao chép ${currentList.length} ID từ danh sách ${LIST_LABEL[activeListTab].title} vào bộ nhớ tạm!`);
    } catch {
      toast("info", `Danh sách ID: ${text}`);
    }
  };

  const handleBatchImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = batchInputText.trim();
    if (!raw) {
      toast("error", "Vui lòng dán danh sách ID vật phẩm");
      return;
    }
    const matches = raw.match(/\d+/g);
    if (!matches || !matches.length) {
      toast("error", "Không tìm thấy ID số nguyên hợp lệ nào trong văn bản");
      return;
    }
    const ids = Array.from(new Set(matches.map((m) => parseInt(m, 10)).filter((n) => n > 0)));
    try {
      const next = await api.batchSetItemList(accountId, activeListTab, ids);
      setLists(next);
      setIsImporting(false);
      setBatchInputText("");
      toast("ok", `Đã nhập thành công ${ids.length} ID vào danh sách ${LIST_LABEL[activeListTab].title}`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    }
  };

  const addAll = async (item: BagItem) => {
    try {
      let cur = lists;
      for (const key of ITEM_LIST_KEYS) {
        if (!cur?.[key].includes(item.id)) cur = await api.setItemList(accountId, key, item.id, true);
      }
      if (cur) setLists(cur);
      toast("ok", `Đã thêm ${nameOf(item.id)} vào tất cả danh sách`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const copyId = async (id: number) => {
    try {
      await navigator.clipboard.writeText(String(id));
      toast("ok", `Đã chép ID ${id}`);
    } catch {
      toast("info", `ID: ${id}`);
    }
  };

  /** Chỉ chạy khi user chủ động bấm: warp (nếu chưa ở map) → đi tới NPC → mở kho. */
  const handleEnterBank = async () => {
    try {
      toast("info", "🏦 Đang di chuyển đến NPC Tiền Trang Tương Dương và mở kho...");
      await act("open_bank_tuongduong");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const handleCloseBank = async () => {
    try {
      toast("info", "💾 Đang gửi lệnh đóng kho và xác nhận lưu dữ liệu (1e/08 + 14/06)...");
      await act("close_bank");
      toast("ok", "✓ Đã đóng kho và xác nhận lưu dữ liệu máy chủ thành công.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const handleSweepNow = async () => {
    if (!canAct) {
      toast("info", "Vui lòng kết nối vào game để quét thùng đồ.");
      return;
    }
    setIsSweeping(true);
    try {
      toast("info", "🔍 Đang quét và xử lý thùng đồ cá nhân...");
      await act("sweep_inventory");
      toast("ok", "✓ Đã kích hoạt quét thùng đồ cá nhân.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setIsSweeping(false);
    }
  };

  const handleToggleAutoSweep = async () => {
    const nextState = !lists?.autoSweepEnabled;
    try {
      const updated = await api.setAutoSweep(accountId, nextState);
      setLists(updated);
      toast("ok", nextState ? "Đã BẬT tự động quét thùng đồ mỗi 1 phút" : "Đã TẮT tự động quét thùng đồ định kỳ");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const listItem = (item: BagItem, key: ItemListKey, prefix = "Thêm"): MenuItem => {
    const has = lists?.[key].includes(item.id) ?? false;
    return {
      label: has ? `✓ Đã thêm ${LIST_LABEL[key].title} (bấm để bỏ)` : `${prefix} ${LIST_LABEL[key].title}`,
      onClick: () => void toggleList(item, key),
    };
  };

  const handleConfirmQty = () => {
    if (!qtyModal) return;
    const { type, item } = qtyModal;
    const q = Math.max(1, Math.min(item.qty, Math.floor(inputQty) || 1));
    setQtyModal(null);
    if (type === "deposit") {
      void act("deposit_bank", { slot: item.slot, qty: q });
    } else {
      void act("withdraw_bank", { slot: item.slot, qty: q });
    }
  };

  const buildBankMenu = (item: BagItem): MenuItem[] => [
    {
      label: "Rút khỏi Tiền Trang",
      disabled: !canAct || !bankOpen,
      children: [
        {
          label: `Rút tất cả (x${nf(item.qty)})`,
          onClick: () => void act("withdraw_bank", { slot: item.slot, qty: item.qty }),
        },
        {
          label: "Rút theo số lượng...",
          onClick: () => {
            setQtyModal({ type: "withdraw", item });
            setInputQty(item.qty);
          },
        },
      ],
    },
    { label: `Id: ${item.id}  (bấm để chép)`, separator: true, onClick: () => void copyId(item.id) },
  ];

  const buildMenu = (item: BagItem): MenuItem[] => [
    { label: "Nhân vật sử dụng", disabled: !canAct, onClick: () => void act("use_item", { slot: item.slot, count: 1, target: 0 }) },
    { label: "Võ tướng sử dụng", disabled: !canAct, onClick: () => void act("use_item_pet", { slot: item.slot, qty: 1 }) },
    {
      label: "Gửi vào Tiền Trang",
      disabled: !canAct || !bankOpen,
      children: [
        {
          label: `Gửi tất cả (x${nf(item.qty)})`,
          onClick: () => void act("deposit_bank", { slot: item.slot, qty: item.qty }),
        },
        {
          label: "Gửi theo số lượng...",
          onClick: () => {
            setQtyModal({ type: "deposit", item });
            setInputQty(item.qty);
          },
        },
      ],
    },
    listItem(item, "autoOpen"),
    listItem(item, "exception"),
    { ...listItem(item, "combine"), label: lists?.combine.includes(item.id) ? "✓ Đã thêm hợp vật phẩm (bấm để bỏ)" : "Thêm hợp vật phẩm" },
    { ...listItem(item, "sell"), label: lists?.sell.includes(item.id) ? "✓ Đã thêm bán vật phẩm (bấm để bỏ)" : "Thêm bán vật phẩm" },
    { label: "Tự hợp lông vũ (Tạm đóng)", disabled: true, onClick: () => {} },
    { label: "Mở thêm ô túi đồ", disabled: !canAct, onClick: () => void act("open_bag_slot") },
    {
      label: "Phân giải",
      separator: true,
      children: [
        { label: "Phân giải vật phẩm", disabled: !canAct, onClick: () => void act("resolve_item", { itemId: item.id, slot: item.slot }) },
        listItem(item, "resolve", "Thêm tự động"),
      ].map((m, i) => (i === 1 ? { ...m, label: lists?.resolve.includes(item.id) ? "✓ Đã thêm tự động phân giải (bấm để bỏ)" : "Thêm tự động phân giải" } : m)),
    },
    {
      label: "Đóng góp",
      children: [
        { label: "Đóng góp vật phẩm", disabled: !canAct, onClick: () => void act("contribute_item", { itemId: item.id, slot: item.slot }) },
        { ...listItem(item, "contribute"), label: lists?.contribute.includes(item.id) ? "✓ Đã thêm tự động đóng góp (bấm để bỏ)" : "Thêm tự động đóng góp" },
      ],
    },
    {
      label: "Vứt bỏ",
      children: [
        { label: "Vứt bỏ vật phẩm", danger: true, disabled: !canAct, onClick: () => setConfirmDrop(item) },
        { ...listItem(item, "discard"), label: lists?.discard.includes(item.id) ? "✓ Đã thêm tự động vứt bỏ (bấm để bỏ)" : "Thêm tự động vứt bỏ" },
      ],
    },
    {
      label: "Thêm tất cả",
      children: [
        listItem(item, "autoOpen"),
        listItem(item, "sell"),
        listItem(item, "combine"),
        listItem(item, "resolve"),
        listItem(item, "contribute"),
        listItem(item, "discard"),
        listItem(item, "exception"),
        { label: "Thêm vào tất cả danh sách", separator: true, onClick: () => void addAll(item) },
      ],
    },
    { label: `Id: ${item.id}  (bấm để chép)`, separator: true, onClick: () => void copyId(item.id) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 10 }}>
      {/* THANH ĐIỀU HƯỚNG TAB CHÍNH CỦA THÙNG ĐỒ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          background: "var(--panel-2)",
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className={viewMode === "bag_and_rules" ? "primary" : ""}
            onClick={() => setViewMode("bag_and_rules")}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            🎒 Túi Đồ & Quy Tắc
          </button>
          <button
            type="button"
            className={viewMode === "bank" ? "primary" : ""}
            onClick={() => setViewMode("bank")}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            🏦 Kho Tiền Trang ({bank.length}/{BANK_CAPACITY})
          </button>
          <button
            type="button"
            className={viewMode === "shop" ? "primary" : ""}
            onClick={() => setViewMode("shop")}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            🛒 Mua / Bán HP-SP
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* NÚT BẬT / TẮT AUTO QUÉT 1 PHÚT */}
          <button
            type="button"
            title="Tự động quét thùng đồ cá nhân và xử lý theo các quy tắc đang BẬT mỗi 1 phút một lần"
            onClick={handleToggleAutoSweep}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
              border: lists?.autoSweepEnabled ? "1px solid #22c55e" : "1px solid var(--line)",
              background: lists?.autoSweepEnabled ? "rgba(34, 197, 94, 0.15)" : "var(--panel-2)",
              color: lists?.autoSweepEnabled ? "#22c55e" : "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>⏱️</span>
            <span>Auto Quét (1p):</span>
            <b>{lists?.autoSweepEnabled ? "🟢 BẬT" : "⚪ TẮT"}</b>
          </button>

          {/* NÚT QUÉT NGAY */}
          <button
            type="button"
            className="primary"
            title="Quét ngay thùng đồ cá nhân và xử lý các danh sách đã bật hợp lệ 1 lần"
            disabled={!canAct || isSweeping}
            onClick={handleSweepNow}
            style={{
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              cursor: canAct ? "pointer" : "not-allowed",
              background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
              color: "#fff",
              border: "none",
              boxShadow: "0 2px 4px rgba(2, 132, 199, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: canAct ? 1 : 0.6,
            }}
          >
            <span>{isSweeping ? "⏳" : "⚡"}</span>
            <span>{isSweeping ? "Đang quét…" : "Quét ngay"}</span>
          </button>

        </div>
      </div>

      {/* NỘI DUNG VIEW 1: TÚI ĐỒ & QUY TẮC TỰ ĐỘNG */}
      {viewMode === "bag_and_rules" && (
        <div className="home" style={{ gridTemplateColumns: "minmax(380px, 1.7fr) minmax(320px, 1.2fr)", flex: 1, minHeight: 0 }}>
          {/* CỘT 1: BẢNG TÚI ĐỒ */}
          <div className="home-col">
            <section className="card compact" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 10 }}>
              {/* Header */}
              <div className="row" style={{ alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🎒</span> Thùng Đồ Cá Nhân ({bag.length}/{BAG_CAPACITY} ô)
                </h2>
                <span className="sp" />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={!canAct || isSweeping}
                    onClick={handleSweepNow}
                    title="Quét ngay thùng đồ cá nhân và xử lý các danh sách đã bật hợp lệ 1 lần"
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 4,
                      cursor: canAct ? "pointer" : "not-allowed",
                      background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                      color: "#fff",
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      opacity: canAct ? 1 : 0.6,
                    }}
                  >
                    <span>{isSweeping ? "⏳" : "⚡"}</span>
                    <span>{isSweeping ? "Đang quét…" : "Quét ngay"}</span>
                  </button>
                  <span
                    className="help"
                    tabIndex={0}
                    aria-label="Hướng dẫn"
                    title="Di chuột vào vật phẩm để xem chi tiết thuộc tính (+HP, +SP, Công/Thủ). Chuột phải hoặc bấm ⋯ để mở menu thao tác."
                  >
                    ?
                  </span>
                </div>
              </div>

              {/* Ô tìm kiếm */}
              <input
                className="inv-q"
                placeholder="Tìm theo tên hoặc ID vật phẩm…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              {/* Table */}
              <div className="inv-body" style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th aria-sort={ariaSort("slot")}>
                        <button className="sortbtn" onClick={() => sortBy("slot")}>
                          Ô{arrow("slot")}
                        </button>
                      </th>
                      <th aria-sort={ariaSort("name")}>
                        <button className="sortbtn" onClick={() => sortBy("name")}>
                          Vật phẩm{arrow("name")}
                        </button>
                      </th>
                      <th>ID</th>
                      <th className="r" aria-sort={ariaSort("qty")}>
                        <button className="sortbtn" onClick={() => sortBy("qty")}>
                          SL{arrow("qty")}
                        </button>
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                          {bag.length ? "Không có vật phẩm khớp với tìm kiếm." : "Túi đồ trống (hoặc chưa nhận dữ liệu từ server)."}
                        </td>
                      </tr>
                    )}
                    {rows.map((it) => {
                      const d = details[String(it.id)];
                      return (
                        <tr
                          key={it.slot}
                          onMouseEnter={(e) => setHovered({ item: it, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHovered(null)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, item: it });
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="n">{it.slot}</td>
                          <td className="nm">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <b style={{ color: "var(--text)" }}>{nameOf(it.id)}</b>
                              {d?.hp != null && d.hp > 0 && (
                                <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700 }}>
                                  +{d.hp}HP
                                </span>
                              )}
                              {d?.sp != null && d.sp > 0 && (
                                <span style={{ color: "#38bdf8", fontSize: 11, fontWeight: 700 }}>
                                  +{d.sp}SP
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="id">{it.id}</td>
                          <td className="r">
                            <b style={{ color: "var(--accent-ink)" }}>{nf(it.qty)}</b>
                          </td>
                          <td className="dots">
                            <button
                              aria-label={`Tuỳ chọn cho ${nameOf(it.id)}`}
                              onClick={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setMenu({ x: r.left, y: r.bottom + 2, item: it });
                              }}
                            >
                              ⋯
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* CỘT 2: QUẢN LÝ QUY TẮC TỰ ĐỘNG VẬT PHẨM */}
          <div className="home-col">
            <section className="card compact" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 10 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>⚙️</span> Quy Tắc Tự Động Vật Phẩm
                </h2>
                <span className="sp" />
                <span
                  className="tag"
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  TK: <b style={{ color: "var(--accent-ink)" }}>{accountId ? accountId.split("@")[0] : "Chưa chọn"}</b>
                </span>
              </div>

              {/* Sub-tabs cho từng danh sách quy tắc */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {ITEM_LIST_KEYS.map((k) => {
                  const count = lists?.[k]?.length ?? 0;
                  const isSelected = activeListTab === k;
                  const isTabOn = lists?.toggles?.[k] ?? (k === "sell" ? false : true);
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setActiveListTab(k);
                        setIsImporting(false);
                      }}
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        borderRadius: 6,
                        border: isSelected ? "1px solid var(--accent)" : "1px solid var(--line)",
                        background: isSelected ? "var(--accent-soft)" : "var(--panel-2)",
                        color: isSelected ? "var(--accent-ink)" : "var(--muted)",
                        fontWeight: isSelected ? 600 : 400,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span>{LIST_LABEL[k].icon}</span>
                      <span>{LIST_LABEL[k].title} ({count})</span>
                      <span style={{ fontSize: 8, opacity: isTabOn ? 1 : 0.4 }} title={isTabOn ? "Đang BẬT quét" : "Đang TẮT quét"}>
                        {isTabOn ? "🟢" : "⚪"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Form thêm ID vật phẩm đơn lẻ */}
              <form onSubmit={handleManualAdd} style={{ display: "flex", gap: 6 }}>
                <input
                  type="number"
                  placeholder={`Nhập ID vật phẩm (VD: 12345) vào ${LIST_LABEL[activeListTab].title}…`}
                  value={inputItemId}
                  onChange={(e) => setInputItemId(e.target.value)}
                  style={{ flex: 1, padding: "5px 8px", fontSize: 12, borderRadius: 4, border: "1px solid var(--line)" }}
                />
                <button
                  type="submit"
                  className="primary"
                  style={{ padding: "5px 12px", fontSize: 12, whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  + Thêm ID
                </button>
              </form>

              {/* KHU VỰC QUẢN LÝ / SAO CHÉP / IMPORT DANH SÁCH */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Header danh sách hiện tại + Công tắc BẬT/TẮT Action + Nút Copy / Paste */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, paddingBottom: 6, borderBottom: "1px dashed var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 13, color: "var(--accent-ink)" }}>
                      {LIST_LABEL[activeListTab].icon} {LIST_LABEL[activeListTab].title}
                    </b>
                    <span className="muted small">({lists?.[activeListTab]?.length ?? 0})</span>

                    {/* NÚT BẬT / TẮT QUÉT CHO ACTION NÀY */}
                    {(() => {
                      const isActionEnabled = lists?.toggles?.[activeListTab] ?? (activeListTab === "sell" ? false : true);
                      return (
                        <button
                          type="button"
                          onClick={async () => {
                            const nextState = !isActionEnabled;
                            try {
                              const updated = await api.setItemListToggle(accountId, activeListTab, nextState);
                              setLists(updated);
                              toast("ok", `${nextState ? "Đã BẬT" : "Đã TẮT"} quét tự động cho ${LIST_LABEL[activeListTab].title}`);
                            } catch (err) {
                              toast("error", err instanceof Error ? err.message : String(err));
                            }
                          }}
                          style={{
                            padding: "2px 8px",
                            fontSize: 11,
                            borderRadius: 4,
                            border: isActionEnabled ? "1px solid #22c55e" : "1px solid #ef4444",
                            background: isActionEnabled ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: isActionEnabled ? "#22c55e" : "#ef4444",
                            cursor: "pointer",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                          title={isActionEnabled ? "Bấm để TẮT quét tự động action này" : "Bấm để BẬT quét tự động action này"}
                        >
                          <span>{isActionEnabled ? "🟢 BẬT" : "🔴 TẮT"}</span>
                        </button>
                      );
                    })()}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* NÚT COPY DANH SÁCH */}
                    <button
                      type="button"
                      title="Sao chép toàn bộ ID vật phẩm trong danh sách này để dán cho tài khoản khác"
                      onClick={handleCopyList}
                      style={{
                        padding: "3px 8px",
                        fontSize: 11,
                        borderRadius: 4,
                        border: "1px solid var(--line)",
                        background: "var(--panel-2)",
                        color: "var(--text)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span>📋</span> Sao chép
                    </button>

                    {/* NÚT DÁN / NHẬP DANH SÁCH */}
                    <button
                      type="button"
                      title="Nhập danh sách ID từ tài khoản khác vào danh sách này"
                      onClick={() => setIsImporting(!isImporting)}
                      style={{
                        padding: "3px 8px",
                        fontSize: 11,
                        borderRadius: 4,
                        border: isImporting ? "1px solid var(--accent)" : "1px solid var(--line)",
                        background: isImporting ? "var(--accent-soft)" : "var(--panel-2)",
                        color: isImporting ? "var(--accent-ink)" : "var(--text)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span>📥</span> {isImporting ? "Đóng nhập" : "Nhập list"}
                    </button>

                    {/* NÚT XOÁ HẾT */}
                    {Boolean(lists?.[activeListTab]?.length) && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(`Xoá tất cả vật phẩm khỏi danh sách ${LIST_LABEL[activeListTab].title}?`)) return;
                          const ids = [...(lists?.[activeListTab] ?? [])];
                          for (const id of ids) {
                            await api.setItemList(accountId, activeListTab, id, false);
                          }
                          const refreshed = await api.itemLists(accountId);
                          setLists(refreshed);
                          toast("ok", `Đã làm trống danh sách ${LIST_LABEL[activeListTab].title}`);
                        }}
                        style={{ fontSize: 11, padding: "2px 6px", background: "none", border: "none", color: "var(--bad)", cursor: "pointer" }}
                      >
                        Xoá hết
                      </button>
                    )}
                  </div>
                </div>

                {/* THÔNG BÁO TÌNH TRẠNG PHÂN GIẢI */}
                {activeListTab === "resolve" && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(16, 185, 129, 0.08)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#10b981",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                      <span>✓</span>
                      <span>Chức năng Phân giải vật phẩm (59/03) đã sẵn sàng</span>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.4, color: "var(--text)" }}>
                      Opcode phân giải vật phẩm (gói <code>59/03</code>) đã được giải mã chính xác 100% từ capture mạng thực tế. Khi bật công tắc hoặc bấm <b>⚡ Quét ngay</b>, bot sẽ tự động phân giải các vật phẩm/bí kíp trong danh sách và nhận tinh thể/nguyên liệu từ máy chủ.
                    </div>
                  </div>
                )}

                {/* THÔNG BÁO TÌNH TRẠNG ĐÓNG GÓP BANG */}
                {activeListTab === "contribute" && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(59, 130, 246, 0.08)",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#3b82f6",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                      <span>✓</span>
                      <span>Chức năng Đóng góp Quân đoàn (27/0f) đã sẵn sàng</span>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.4, color: "var(--text)" }}>
                      Opcode cống hiến vật phẩm cho Quân đoàn (gói <code>27/0f</code>) đã được giải mã chính xác 100% từ capture mạng thực tế. Khi bật công tắc hoặc bấm <b>⚡ Quét ngay</b>, bot sẽ tự động cống hiến các vật phẩm chỉ định cho bang hội.
                    </div>
                  </div>
                )}

                {/* THÔNG BÁO QUY TẮC VỨT BỎ VẬT PHẨM */}
                {activeListTab === "discard" && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(16, 185, 129, 0.08)",
                      border: "1px solid rgba(16, 185, 129, 0.25)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "#10b981",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                      <span>🗑️</span>
                      <span>Quy tắc Tự động Vứt bỏ (Drop 17/03):</span>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.4, color: "var(--text)" }}>
                      Không ràng buộc loại vật phẩm — bất kỳ món nào có <b>ItemId</b> khớp với danh sách sẽ được tự động gửi lệnh vứt bỏ (<code>17/03</code>) sạch khỏi thùng đồ cá nhân.
                    </div>
                  </div>
                )}

                {/* KHUNG NHẬP / DÁN HÀNG LOẠT (CLONE) */}
                {isImporting && (
                  <form onSubmit={handleBatchImport} style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--panel-2)", padding: 8, borderRadius: 6, border: "1px solid var(--accent)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-soft)" }}>
                      Dán danh sách ID (phân cách bằng dấu phẩy, khoảng trắng hoặc xuống dòng) để sao chép từ tài khoản khác:
                    </div>
                    <textarea
                      rows={3}
                      placeholder="VD: 12001, 12002, 26001, 26002..."
                      value={batchInputText}
                      onChange={(e) => setBatchInputText(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 4,
                        border: "1px solid var(--line)",
                        background: "var(--panel)",
                        color: "var(--text)",
                        fontFamily: "var(--mono)",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <button type="button" onClick={() => setIsImporting(false)} style={{ padding: "4px 8px", fontSize: 11 }}>
                        Huỷ
                      </button>
                      <button type="submit" className="primary" style={{ padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>
                        ✓ Lưu danh sách
                      </button>
                    </div>
                  </form>
                )}

                {/* Danh sách các item chips */}
                {(!lists?.[activeListTab] || lists[activeListTab].length === 0) ? (
                  <div className="muted small" style={{ textAlign: "center", padding: "30px 10px" }}>
                    Chưa có vật phẩm nào trong danh sách này.
                    <br />
                    <small>Nhập ID vật phẩm phía trên, bấm "Nhập list" để clone hoặc chuột phải vào vật phẩm ở bảng bên trái để thêm.</small>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {lists[activeListTab].map((id) => {
                      const d = details[String(id)];
                      return (
                        <div
                          key={id}
                          onMouseEnter={(e) => setHovered({ item: { id }, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "4px 8px",
                            borderRadius: 4,
                            background: "var(--panel-2)",
                            border: "1px solid var(--line-soft)",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>#{id}</span>
                            <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(id)}</b>
                            {d?.hp != null && d.hp > 0 && <span style={{ color: "#ef4444", fontSize: 10, fontWeight: 700 }}>+{d.hp}HP</span>}
                            {d?.sp != null && d.sp > 0 && <span style={{ color: "#38bdf8", fontSize: 10, fontWeight: 700 }}>+{d.sp}SP</span>}
                          </div>
                          <button
                            type="button"
                            title="Xoá khỏi danh sách"
                            onClick={() => toggleList({ id }, activeListTab, false)}
                            style={{ padding: "1px 6px", fontSize: 11, color: "var(--bad)", border: "none", background: "none", cursor: "pointer" }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* NỘI DUNG VIEW 2: TIỀN TRANG TƯƠNG DƯƠNG (GIAO DỊCH KHO & TÚI ĐỒ) */}
      {viewMode === "bank" && (
        <div className="home" style={{ gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0 }}>
          {/* CỘT TRÁI: TÚI ĐỒ CÁ NHÂN (VỚI NÚT GỬI VÀO KHO) */}
          <div className="home-col">
            <section className="card compact" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 10 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🎒</span> Túi Đồ Cá Nhân ({bag.length}/{BAG_CAPACITY} ô)
                </h2>
                <span className="sp" />
                <span className="muted small">Bấm "Gửi ➡️" để cất vào Tiền Trang</span>
              </div>

              <input
                className="inv-q"
                placeholder="Tìm vật phẩm trong túi để gửi kho…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              <div className="inv-body" style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th aria-sort={ariaSort("slot")}>
                        <button className="sortbtn" onClick={() => sortBy("slot")}>
                          Ô{arrow("slot")}
                        </button>
                      </th>
                      <th aria-sort={ariaSort("name")}>
                        <button className="sortbtn" onClick={() => sortBy("name")}>
                          Vật phẩm{arrow("name")}
                        </button>
                      </th>
                      <th>ID</th>
                      <th className="r" aria-sort={ariaSort("qty")}>
                        <button className="sortbtn" onClick={() => sortBy("qty")}>
                          SL{arrow("qty")}
                        </button>
                      </th>
                      <th style={{ textAlign: "center" }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                          {bag.length ? "Không có vật phẩm khớp với tìm kiếm." : "Túi đồ cá nhân đang trống."}
                        </td>
                      </tr>
                    )}
                    {rows.map((it) => {
                      const d = details[String(it.id)];
                      return (
                        <tr
                          key={it.slot}
                          onMouseEnter={(e) => setHovered({ item: it, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHovered(null)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, item: it });
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="n">{it.slot}</td>
                          <td className="nm">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <b style={{ color: "var(--text)" }}>{nameOf(it.id)}</b>
                              {d?.hp != null && d.hp > 0 && <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700 }}>+{d.hp}HP</span>}
                              {d?.sp != null && d.sp > 0 && <span style={{ color: "#38bdf8", fontSize: 11, fontWeight: 700 }}>+{d.sp}SP</span>}
                            </div>
                          </td>
                          <td className="id">{it.id}</td>
                          <td className="r">
                            <b style={{ color: "var(--accent-ink)" }}>{nf(it.qty)}</b>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <div style={{ display: "inline-flex", alignItems: "center" }}>
                              <button
                                type="button"
                                className="primary"
                                disabled={!canAct || !bankOpen}
                                title={`Gửi tất cả ${nf(it.qty)} vật phẩm vào Tiền Trang`}
                                onClick={() => void act("deposit_bank", { slot: it.slot, qty: it.qty })}
                                style={{
                                  padding: "2px 7px",
                                  fontSize: 11,
                                  borderRadius: "4px 0 0 4px",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Gửi tất cả ➡️
                              </button>
                              <button
                                type="button"
                                disabled={!canAct || !bankOpen}
                                title="Nhập số lượng gửi..."
                                onClick={() => {
                                  setQtyModal({ type: "deposit", item: it });
                                  setInputQty(it.qty);
                                }}
                                style={{
                                  padding: "2px 6px",
                                  fontSize: 11,
                                  borderRadius: "0 4px 4px 0",
                                  cursor: "pointer",
                                  borderLeft: "none",
                                  border: "1px solid var(--border)",
                                  background: "var(--card-bg, #1e293b)",
                                  color: "var(--text)",
                                }}
                              >
                                ✏️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* CỘT PHẢI: KHO LƯU TRỮ TIỀN TRANG (VỚI NÚT RÚT RA TÚI) */}
          <div className="home-col">
            {!bankOpen && (
              <section className="card compact" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 0, gap: 12, textAlign: "center" }}>
                <span style={{ fontSize: 36 }}>🏦</span>
                <h2 style={{ margin: 0, fontSize: 15 }}>Kho Tiền Trang Tương Dương</h2>
                <span className="muted small" style={{ maxWidth: 320 }}>
                  Chưa mở kho. Bấm nút bên dưới để bot đi tới NPC Tiền Trang Tương Dương (tự warp nếu đang ở map khác) và tải danh sách vật phẩm.
                </span>
                <button
                  type="button"
                  className="primary"
                  disabled={!canAct}
                  onClick={handleEnterBank}
                  style={{ padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}
                >
                  🏦 Vào Tiền Trang Vật Phẩm
                </button>
              </section>
            )}
            {bankOpen && (
            <section className="card compact" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 10 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>🏦</span> Kho Tiền Trang Tương Dương ({bank.length}/{BANK_CAPACITY} ô)
                </h2>
                <span className="sp" />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    title="Đóng giao diện kho và cam kết lưu dữ liệu vào máy chủ (tránh bị rollback khi logout)"
                    disabled={!canAct}
                    onClick={handleCloseBank}
                    style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, cursor: "pointer", background: "var(--color-primary, #3b82f6)", color: "#fff", border: "none", fontWeight: 600 }}
                  >
                    💾 Lưu - Đóng Tiền Trang
                  </button>
                </div>
              </div>

              <div style={{ fontSize: 11, color: "var(--color-muted, #94a3b8)", padding: "2px 4px", display: "flex", alignItems: "center", gap: 4 }}>
                <span>💡</span> TS Online yêu cầu đóng kho để commit DB. Hãy bấm "Lưu & Đóng kho" sau khi gửi/rút (đổi tab sẽ được hỏi xác nhận; đăng xuất bot tự lưu).
              </div>

              <input
                className="inv-q"
                placeholder="Tìm vật phẩm trong kho Tiền Trang…"
                value={bankQ}
                onChange={(e) => setBankQ(e.target.value)}
              />

              <div className="inv-body" style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>
                        <button className="sortbtn" onClick={() => sortBankBy("slot")}>
                          Ô{bankArrow("slot")}
                        </button>
                      </th>
                      <th>
                        <button className="sortbtn" onClick={() => sortBankBy("name")}>
                          Vật phẩm{bankArrow("name")}
                        </button>
                      </th>
                      <th>ID</th>
                      <th className="r">
                        <button className="sortbtn" onClick={() => sortBankBy("qty")}>
                          SL{bankArrow("qty")}
                        </button>
                      </th>
                      <th style={{ textAlign: "center" }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                          {bank.length ? (
                            "Không có vật phẩm khớp với tìm kiếm."
                          ) : (
                            "Kho Tiền Trang đang trống."
                          )}
                        </td>
                      </tr>
                    )}
                    {bankRows.map((it) => {
                      const d = details[String(it.id)];
                      return (
                        <tr
                          key={it.slot}
                          onMouseEnter={(e) => setHovered({ item: it, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHovered(null)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, item: it, isBank: true });
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="n">{it.slot}</td>
                          <td className="nm">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <b style={{ color: "var(--text)" }}>{nameOf(it.id)}</b>
                              {d?.hp != null && d.hp > 0 && <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700 }}>+{d.hp}HP</span>}
                              {d?.sp != null && d.sp > 0 && <span style={{ color: "#38bdf8", fontSize: 11, fontWeight: 700 }}>+{d.sp}SP</span>}
                            </div>
                          </td>
                          <td className="id">{it.id}</td>
                          <td className="r">
                            <b style={{ color: "var(--accent-ink)" }}>{nf(it.qty)}</b>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <div style={{ display: "inline-flex", alignItems: "center" }}>
                              <button
                                type="button"
                                className="primary"
                                disabled={!canAct || !bankOpen}
                                title={`Rút tất cả ${nf(it.qty)} vật phẩm về túi`}
                                onClick={() => void act("withdraw_bank", { slot: it.slot, qty: it.qty })}
                                style={{
                                  padding: "2px 7px",
                                  fontSize: 11,
                                  borderRadius: "4px 0 0 4px",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                  background: "var(--accent-soft)",
                                  color: "var(--accent-ink)",
                                  border: "1px solid var(--accent)",
                                }}
                              >
                                ⬅️ Rút tất cả
                              </button>
                              <button
                                type="button"
                                disabled={!canAct || !bankOpen}
                                title="Nhập số lượng rút..."
                                onClick={() => {
                                  setQtyModal({ type: "withdraw", item: it });
                                  setInputQty(it.qty);
                                }}
                                style={{
                                  padding: "2px 6px",
                                  fontSize: 11,
                                  borderRadius: "0 4px 4px 0",
                                  cursor: "pointer",
                                  borderLeft: "none",
                                  border: "1px solid var(--border)",
                                  background: "var(--card-bg, #1e293b)",
                                  color: "var(--text)",
                                }}
                              >
                                ✏️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            )}
          </div>
        </div>
      )}

      {/* CHẾ ĐỘ MUA / BÁN (SHOP NPC HƯƠNG DŨNG) */}
      {viewMode === "shop" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* BANNER THÔNG TIN QUY TRÌNH & NÚT THỰC HIỆN CHÍNH */}
          <div
            style={{
              padding: "16px 20px",
              background: "linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              borderRadius: 10,
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 20 }}>🏪</span>
                <span style={{ fontWeight: 800, fontSize: 16, color: "var(--accent, #38bdf8)" }}>
                  Quy trình Bán vật phẩm & Mua HP / SP tự động
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    color: "#38bdf8",
                  }}
                >
                  NPC 12 • Map Hương Dũng (12701)
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim, #94a3b8)", maxWidth: 680, lineHeight: 1.5 }}>
                Tự động di chuyển đến <b>Quảng trường Hương Dũng quân (12701)</b> gặp NPC Thương nhân (990, 470) ➜ Bán toàn bộ
                vật phẩm trong danh sách Bán ➜ Thoát giao dịch ➜ Mua bổ sung Thuốc Vận Công (HP) và Thiên Kim Du (SP) ➜ Thoát giao dịch an toàn.
              </p>
            </div>

            <button
              type="button"
              disabled={!canAct || isTrading}
              onClick={() => void handleExecuteTrade()}
              style={{
                padding: "12px 24px",
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 8,
                border: "none",
                background: !canAct || isTrading
                  ? "var(--muted, #475569)"
                  : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#fff",
                cursor: !canAct || isTrading ? "not-allowed" : "pointer",
                boxShadow: !canAct || isTrading ? "none" : "0 4px 14px rgba(16, 185, 129, 0.4)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "all 0.2s ease",
              }}
            >
              {isTrading ? (
                <>
                  <span className="spin">⏳</span> Đang thực hiện quy trình...
                </>
              ) : (
                <>
                  <span>⚡</span> Bán xong rồi mua
                </>
              )}
            </button>
          </div>

          {/* NỘI DUNG 2 CỘT: DANH SÁCH BÁN VÀ CẤU HÌNH MUA */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* CỘT TRÁI: DANH SÁCH BÁN */}
            <div
              style={{
                background: "var(--panel, #1e293b)",
                border: "1px solid var(--border, #334155)",
                borderRadius: 10,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                    📦 Danh sách vật phẩm cần Bán
                  </h3>
                  <div style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", marginTop: 2 }}>
                    Tự động bán khi mở phiên giao dịch với NPC Thương nhân
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#f87171",
                  }}
                >
                  {lists?.sell?.length ?? 0} vật phẩm
                </span>
              </div>

              {/* FORM THÊM ID */}
              <form
                onSubmit={handleAddSellItem}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  background: "var(--panel-2, #0f172a)",
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border, #334155)",
                }}
              >
                <input
                  type="text"
                  placeholder="Nhập ID vật phẩm (VD: 32043)..."
                  value={shopInputItemId}
                  onChange={(e) => setShopInputItemId(e.target.value)}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--text, #f8fafc)",
                    fontSize: 13,
                    padding: "4px 8px",
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 4,
                    border: "none",
                    background: "var(--accent, #38bdf8)",
                    color: "#0f172a",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  + Thêm ID
                </button>
              </form>

              {/* CHIP THÊM NHANH */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)" }}>Gợi ý nhanh:</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!accountId) return;
                    api.setItemList(accountId, "sell", 32043, true)
                      .then((u) => {
                        setLists(u);
                        toast("ok", "Đã thêm Nồi Đất (#32043) vào danh sách Bán!");
                      })
                      .catch((e) => toast("error", e.message));
                  }}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 12,
                    background: "rgba(56, 189, 248, 0.1)",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    color: "#38bdf8",
                    cursor: "pointer",
                  }}
                >
                  + Nồi Đất (ID 32043)
                </button>
              </div>

              {/* BẢNG CÁC MỤC BÁN HIỆN TẠI */}
              <div
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  border: "1px solid var(--border, #334155)",
                  borderRadius: 6,
                  background: "var(--panel-2, #0f172a)",
                }}
              >
                {!lists?.sell || lists.sell.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim, #94a3b8)", fontSize: 13 }}>
                    Chưa có vật phẩm nào trong danh sách Bán.
                    <br />
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      Nhập ID hoặc bấm vào nút <b>Nồi Đất (ID 32043)</b> ở trên để thêm.
                    </span>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "rgba(255, 255, 255, 0.03)", borderBottom: "1px solid var(--border, #334155)" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--text-dim, #94a3b8)", fontWeight: 600 }}>Tên vật phẩm</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", color: "var(--text-dim, #94a3b8)", fontWeight: 600, width: 80 }}>ID</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--text-dim, #94a3b8)", fontWeight: 600, width: 60 }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lists.sell.map((id) => (
                        <tr
                          key={id}
                          style={{
                            borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                            transition: "background 0.15s ease",
                          }}
                        >
                          <td style={{ padding: "8px 12px", color: "var(--text, #f8fafc)", fontWeight: 500 }}>
                            {nameOf(id)}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-dim, #94a3b8)", fontFamily: "monospace" }}>
                            {id}
                          </td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveSellItem(id)}
                              title="Xoá khỏi danh sách bán"
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#ef4444",
                                cursor: "pointer",
                                fontSize: 14,
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* CỘT PHẢI: CẤU HÌNH MUA HP VÀ SP */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* CARD MUA HP */}
              <div
                style={{
                  background: "var(--panel, #1e293b)",
                  border: buyHpEnabled ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid var(--border, #334155)",
                  borderRadius: 10,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  boxShadow: buyHpEnabled ? "0 0 15px rgba(239, 68, 68, 0.08)" : "none",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>🍷</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#f87171" }}>
                        Mua HP (Thuốc Vận Công)
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)" }}>
                        ID: 27136 • Hồi phục +{details["27136"]?.hp ?? 62} HP • Giá: {details["27136"]?.price ?? 20} vàng / bình
                      </div>
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={buyHpEnabled}
                      onChange={(e) => handleUpdateBuySettings({ buyHpEnabled: e.target.checked })}
                      style={{ cursor: "pointer", width: 16, height: 16 }}
                    />
                    <span>{buyHpEnabled ? "Đang BẬT" : "TẮT"}</span>
                  </label>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", minWidth: 60 }}>Số lượng:</span>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={buyHpQty}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(9999, parseInt(e.target.value, 10) || 1));
                      setBuyHpQty(v);
                      void handleUpdateBuySettings({ buyHpQty: v });
                    }}
                    style={{
                      flex: 1,
                      background: "var(--panel-2, #0f172a)",
                      border: "1px solid var(--border, #334155)",
                      borderRadius: 6,
                      color: "var(--text, #f8fafc)",
                      padding: "6px 10px",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBuyHpQty(9999);
                      void handleUpdateBuySettings({ buyHpQty: 9999 });
                    }}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 6,
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      background: "rgba(239, 68, 68, 0.15)",
                      color: "#f87171",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Max (9999)
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)" }}>Nhanh:</span>
                  {[200, 500, 1000, 5000].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setBuyHpQty(n);
                        void handleUpdateBuySettings({ buyHpQty: n });
                      }}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid var(--border, #334155)",
                        background: "var(--panel-2, #0f172a)",
                        color: "var(--text-dim, #94a3b8)",
                        cursor: "pointer",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* CARD MUA SP */}
              <div
                style={{
                  background: "var(--panel, #1e293b)",
                  border: buySpEnabled ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid var(--border, #334155)",
                  borderRadius: 10,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  boxShadow: buySpEnabled ? "0 0 15px rgba(56, 189, 248, 0.08)" : "none",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>🧪</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#38bdf8" }}>
                        Mua SP (Thiên Kim Du)
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)" }}>
                        ID: 27138 • Hồi phục +{details["27138"]?.sp ?? 62} SP • Giá: {details["27138"]?.price ?? 20} vàng / bình
                      </div>
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={buySpEnabled}
                      onChange={(e) => handleUpdateBuySettings({ buySpEnabled: e.target.checked })}
                      style={{ cursor: "pointer", width: 16, height: 16 }}
                    />
                    <span>{buySpEnabled ? "Đang BẬT" : "TẮT"}</span>
                  </label>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", minWidth: 60 }}>Số lượng:</span>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={buySpQty}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(9999, parseInt(e.target.value, 10) || 1));
                      setBuySpQty(v);
                      void handleUpdateBuySettings({ buySpQty: v });
                    }}
                    style={{
                      flex: 1,
                      background: "var(--panel-2, #0f172a)",
                      border: "1px solid var(--border, #334155)",
                      borderRadius: 6,
                      color: "var(--text, #f8fafc)",
                      padding: "6px 10px",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBuySpQty(9999);
                      void handleUpdateBuySettings({ buySpQty: 9999 });
                    }}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 6,
                      border: "1px solid rgba(56, 189, 248, 0.4)",
                      background: "rgba(56, 189, 248, 0.15)",
                      color: "#38bdf8",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Max (9999)
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)" }}>Nhanh:</span>
                  {[200, 500, 1000, 5000].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setBuySpQty(n);
                        void handleUpdateBuySettings({ buySpQty: n });
                      }}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid var(--border, #334155)",
                        background: "var(--panel-2, #0f172a)",
                        color: "var(--text-dim, #94a3b8)",
                        cursor: "pointer",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* CARD CHI TIẾT 5 BƯỚC THỰC HIỆN */}
              <div
                style={{
                  background: "var(--panel-2, #0f172a)",
                  border: "1px dashed var(--border, #334155)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontSize: 12,
                  color: "var(--text-dim, #94a3b8)",
                }}
              >
                <b style={{ color: "var(--text, #f8fafc)" }}>📋 Thứ tự thực hiện tự động:</b>
                <ol style={{ margin: "6px 0 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Di chuyển tự động đến map Hương Dũng (12701) và tìm NPC 12 (990, 470).</li>
                  <li>Nói chuyện NPC, chọn menu Bán vật phẩm (31).</li>
                  <li>Bán toàn bộ vật phẩm trong danh sách Bán ➜ Thoát giao dịch.</li>
                  <li>Nói chuyện NPC, chọn menu Mua vật phẩm (30).</li>
                  <li>Mua HP & SP theo số lượng cài đặt ➜ Thoát giao dịch.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOOLTIP HIỂN THỊ THUỘC TÍNH VẬT PHẨM KHI HOVER */}
      {hovered && (
        <ItemTooltip
          item={hovered.item}
          detail={details[String(hovered.item.id)]}
          name={nameOf(hovered.item.id)}
          pos={{ x: hovered.x, y: hovered.y }}
        />
      )}

      {/* CONTEXT MENU THAO TÁC */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={`${nameOf(menu.item.id)} (${menu.item.id}) × ${nf(menu.item.qty)}`}
          items={menu.isBank ? buildBankMenu(menu.item) : buildMenu(menu.item)}
          onClose={() => setMenu(null)}
        />
      )}

      {/* DIALOG XÁC NHẬN VỨT BỎ */}
      {confirmDrop && (
        <div className="modal-back top" onClick={() => setConfirmDrop(null)}>
          <div className="modal card" role="alertdialog" aria-label="Xác nhận vứt bỏ" onClick={(e) => e.stopPropagation()}>
            <h2>Vứt bỏ vật phẩm?</h2>
            <p>
              Bạn chắc chắn muốn vứt <b>{nameOf(confirmDrop.id)}</b> ({confirmDrop.id}) × {nf(confirmDrop.qty)} ở ô{" "}
              {confirmDrop.slot}? Vứt rồi là mất vĩnh viễn.
            </p>
            <div className="row">
              <span className="sp" />
              <button autoFocus onClick={() => setConfirmDrop(null)}>
                Huỷ
              </button>
              <button
                className="danger"
                onClick={() => {
                  const it = confirmDrop;
                  setConfirmDrop(null);
                  void act("drop_item", { itemId: it.id, slot: it.slot, qty: it.qty });
                }}
              >
                Vứt bỏ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG CHỌN SỐ LƯỢNG GỬI / RÚT TIỀN TRANG */}
      {qtyModal && (
        <div className="modal-back top" onClick={() => setQtyModal(null)}>
          <div
            className="modal card"
            role="dialog"
            aria-label={qtyModal.type === "deposit" ? "Gửi vào Tiền Trang" : "Rút khỏi Tiền Trang"}
            onClick={(e) => e.stopPropagation()}
            style={{ minWidth: 320, maxWidth: 380 }}
          >
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 12px" }}>
              <span>{qtyModal.type === "deposit" ? "🏦 Gửi vào Tiền Trang" : "🎒 Rút khỏi Tiền Trang"}</span>
            </h2>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "var(--bg-subtle, rgba(255,255,255,0.04))",
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{nameOf(qtyModal.item.id)}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  Ô số <b>{qtyModal.item.slot}</b> • Hiện có: <b style={{ color: "var(--accent-ink)" }}>{nf(qtyModal.item.qty)}</b>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
                Nhập số lượng cần {qtyModal.type === "deposit" ? "gửi" : "rút"}:
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  autoFocus
                  min={1}
                  max={qtyModal.item.qty}
                  value={inputQty}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(qtyModal.item.qty, Number(e.target.value) || 1));
                    setInputQty(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleConfirmQty();
                    } else if (e.key === "Escape") {
                      setQtyModal(null);
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    fontSize: 14,
                    fontWeight: 600,
                    borderRadius: 6,
                    textAlign: "center",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setInputQty(qtyModal.item.qty)}
                  style={{ padding: "6px 10px", fontSize: 11, borderRadius: 6, whiteSpace: "nowrap" }}
                >
                  Tối đa ({nf(qtyModal.item.qty)})
                </button>
              </div>

              {/* Nút chọn nhanh tỉ lệ / số lượng */}
              {qtyModal.item.qty > 2 && (
                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                  {[1, Math.floor(qtyModal.item.qty / 4), Math.floor(qtyModal.item.qty / 2), qtyModal.item.qty]
                    .filter((v, i, a) => v >= 1 && a.indexOf(v) === i)
                    .map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setInputQty(q)}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          fontSize: 11,
                          borderRadius: 4,
                          background: inputQty === q ? "var(--accent)" : "transparent",
                          color: inputQty === q ? "#fff" : "var(--muted)",
                          border: "1px solid var(--border)",
                          cursor: "pointer",
                        }}
                      >
                        {q === qtyModal.item.qty ? "Tất cả" : q}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="row" style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setQtyModal(null)}>
                Huỷ
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmQty}
              >
                Xác nhận {qtyModal.type === "deposit" ? "gửi" : "rút"} (x{nf(inputQty)})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Component hiển thị Tooltip thuộc tính chi tiết của vật phẩm khi hover */
function ItemTooltip({
  item,
  detail,
  name,
  pos,
}: {
  item: { id: number; qty?: number; slot?: number };
  detail?: ItemDetail;
  name: string;
  pos: { x: number; y: number };
}) {
  const isRight = typeof window !== "undefined" && pos.x > window.innerWidth - 320;
  const isBottom = typeof window !== "undefined" && pos.y > window.innerHeight - 200;

  return (
    <div
      style={{
        position: "fixed",
        left: isRight ? Math.max(10, pos.x - 300) : pos.x + 14,
        top: isBottom ? Math.max(10, pos.y - 150) : pos.y + 14,
        zIndex: 9999,
        minWidth: 220,
        maxWidth: 320,
        background: "rgba(23, 23, 33, 0.95)",
        border: "1px solid var(--accent, #6366f1)",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.4)",
        borderRadius: 8,
        padding: "10px 14px",
        pointerEvents: "none",
        backdropFilter: "blur(10px)",
        color: "var(--text, #f8fafc)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, borderBottom: "1px solid var(--line, rgba(255,255,255,0.1))", paddingBottom: 6 }}>
        <b style={{ color: "var(--accent-ink, #a5b4fc)", fontSize: 13 }}>{name}</b>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted, #94a3b8)" }}>#{item.id}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
        {detail?.slot && (
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 10,
              background: "var(--panel-2, #262638)",
              border: "1px solid var(--line, rgba(255,255,255,0.1))",
              color: "var(--text-soft, #cbd5e1)",
            }}
          >
            {SLOT_NAMES[detail.slot] ?? `Trang bị ô ${detail.slot}`}
          </span>
        )}
        {detail?.level != null && (
          <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)" }}>
            Cấp: <b style={{ color: "var(--text, #f8fafc)" }}>{detail.level}</b>
          </span>
        )}
        {detail?.price != null && detail.price > 0 && (
          <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)" }}>
            Giá: <b style={{ color: "#eab308" }}>{nf(detail.price)} vàng</b>
          </span>
        )}
        {item.qty != null && (
          <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)" }}>
            Số lượng: <b style={{ color: "var(--text, #f8fafc)" }}>{nf(item.qty)}</b>
          </span>
        )}
      </div>

      {/* Hiển thị chỉ số option trang bị (ATK, DEF, INT, AGI, HP, SP...) */}
      {detail?.stats && detail.stats.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {detail.stats.map((s, idx) => {
            const meta = STAT_META[s.type] ?? { icon: "✨", color: "#f59e0b" };
            const isPos = s.value > 0;
            const sign = isPos ? "+" : "";
            return (
              <div
                key={idx}
                style={{
                  color: isPos ? meta.color : "#ef4444",
                  fontWeight: 600,
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span>{meta.icon}</span>
                <span>
                  {s.type}: {sign}{s.value}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Hiển thị hồi phục tiêu hao: HP (Đỏ), SP (Xanh) */}
      {((detail?.hp != null && detail.hp > 0) || (detail?.sp != null && detail.sp > 0)) && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {detail?.hp != null && detail.hp > 0 && (
            <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <span>❤️</span> Hồi phục +{detail.hp} HP
            </div>
          )}
          {detail?.sp != null && detail.sp > 0 && (
            <div style={{ color: "#38bdf8", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <span>💧</span> Hồi phục +{detail.sp} SP
            </div>
          )}
        </div>
      )}

      {detail?.desc && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px dashed var(--line, rgba(255,255,255,0.15))",
            color: "var(--muted, #94a3b8)",
            fontSize: 11,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {detail.desc}
        </div>
      )}
    </div>
  );
}
