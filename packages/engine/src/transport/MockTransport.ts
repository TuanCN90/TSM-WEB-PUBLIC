import type { CharacterState, PartyMember, UnitState } from "@tsbot/protocol";
import { sleep } from "./abortable";
import type { CommandResult, GameCommand, Transport, TransportContext, TransportDriver, WaitKind } from "./Transport";
import { getSafeSpotForMap } from "../runtime/route";

const unit = (name: string, level: number, hp: number, sp: number, exp: number): UnitState => ({ name, level, hp: { cur: hp, max: hp }, sp: { cur: sp, max: sp }, exp });
const slots = (names: string[]): PartyMember[] =>
  [1, 2, 3, 4].map((slot) => ({ slot, name: names[slot - 1] ?? "", isLeader: slot === 1, isAdvisor: false }));

/**
 * Simulator: không chạm game thật. Mọi số liệu (tên, cấp, HP/SP, xu/vàng, đội) là DỮ LIỆU GIẢ để thử UI.
 * Action "debug_drop" giả lập server ngắt kết nối để thử luồng reconnect.
 */
export class MockTransport implements Transport {
  readonly name = "mock";
  private ctx!: TransportContext;
  private connected = false;
  private state: CharacterState = {
    player: unit("", 1, 1, 1, 0),
    pet: unit("Lữ Bố", 45, 3200, 900, 37.5),
    economy: { xu: 1_309_603, gold: 1650 },
    party: { members: slots([]), inviteStatus: "" },
    location: {
      map: 12001,
      x: 0,
      y: 0,
      channel: 0,
      channels: [
        { id: 0, name: "Kênh 1", status: "busy" },
        { id: 1, name: "Kênh 2", status: "free" },
      ],
    },
    inBattle: false,
    auto: false,
    chaseConfig: {
      enabled: false,
      mapId: 12001,
      originX: 0,
      originY: 0,
      maxRadius: 150,
      autoReturn: true,
    },
    bag: [
      { slot: 1, id: 46285, qty: 4 }, { slot: 2, id: 20001, qty: 1 }, { slot: 5, id: 46029, qty: 3 },
      { slot: 7, id: 51789, qty: 1 }, { slot: 13, id: 46038, qty: 40 }, { slot: 28, id: 65401, qty: 1 },
    ], // dữ liệu mẫu để thử giao diện Thùng đồ khi chạy mock
  };
  private listeners = new Set<(s: CharacterState) => void>();
  private dropListeners = new Set<(r: string) => void>();

  async connect(ctx: TransportContext): Promise<void> {
    this.ctx = ctx;
    ctx.log("info", `[mock] đăng nhập ${ctx.credentials.username} @ ${ctx.credentials.server}`);
    await sleep(400 / Math.max(ctx.speed, 0.01), new AbortController().signal);
    this.connected = true;
    const first = this.state.player.name === "";
    this.emit({
      player: first ? unit(ctx.credentials.username, 52, 2400, 1100, 61.2) : this.state.player,
      party: first ? { members: slots([ctx.credentials.username, "Quan Vũ (mock)", "Triệu Vân (mock)"]), inviteStatus: "" } : this.state.party,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.ctx?.log("info", "[mock] đăng xuất");
  }

  private emit(patch: Partial<CharacterState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }
  private loc(patch: Partial<CharacterState["location"]>) {
    this.emit({ location: { ...this.state.location, ...patch } });
  }
  private party(members: PartyMember[], inviteStatus = this.state.party.inviteStatus) {
    this.emit({ party: { members, inviteStatus } });
  }

  private delay(ms: number, signal: AbortSignal) {
    return sleep(ms / Math.max(this.ctx.speed, 0.01), signal);
  }
  private requireConnected() {
    if (!this.connected) throw new Error("Chưa kết nối tới game");
  }

  async execute(cmd: GameCommand, signal: AbortSignal): Promise<CommandResult> {
    this.requireConnected();
    if (cmd.type === "RawPacket") {
      await this.delay(30, signal);
      this.ctx.log("debug", `[mock] RawPacket ${cmd.hex.length / 2} byte`);
      return { ok: true };
    }
    if (cmd.name === "heartbeat") return { ok: true };
    if (cmd.name === "debug_drop") {
      this.connected = false;
      setTimeout(() => this.dropListeners.forEach((cb) => cb("[mock] server ngắt kết nối (giả lập)")), 50);
      return { ok: true, message: "Sẽ ngắt kết nối giả lập" };
    }
    await this.delay(40 + Math.random() * 80, signal);
    const n = cmd.args.map((a) => Number(a));
    const members = this.state.party.members;
    switch (cmd.name) {
      case "warp_map":
      case "teleport_gate":
      case "teleport":
        if (!Number.isFinite(n[0])) return { ok: false, message: "Map ID không hợp lệ" };
        this.emit({ location: { ...this.state.location, map: n[0], x: 0, y: 0 }, inBattle: false });
        break;
      case "warp_door":
        if (Number.isFinite(n[0])) this.ctx.log("info", `[mock] bước qua cổng số ${n[0]}`);
        break;
      case "warp_id":
        if (cmd.args.length >= 2 && Number.isFinite(n[1])) this.loc({ map: n[1] });
        break;
      case "move":
      case "walk":
      case "ai_find":
        this.loc({ x: n[0], y: n[1] });
        break;
      case "move_to_safe_spot": {
        const snap = this.state.party;
        const selfMember = snap.members.find((m) => m.isSelf);
        const isLeader = Boolean(selfMember?.isLeader);
        if (snap.joined && !isLeader) {
          return { ok: false, message: "Ní đang trong tổ đội, không được phép chạy lung tung!!!" };
        }
        const spot = getSafeSpotForMap(this.state.location.map, this.state.location.x, this.state.location.y);
        if (!spot) return { ok: false, message: `Không tìm thấy vị trí an toàn cho map ${this.state.location.map}` };
        this.loc({ x: spot.x, y: spot.y });
        return { ok: true, message: `Đã đến chỗ an toàn (${spot.x}, ${spot.y})` };
      }
      case "open_map":
        this.ctx.log("info", "[mock] mở bản đồ thế giới");
        break;
      case "auto":
        this.emit({ auto: n[0] === 1, inBattle: n[0] === 1 ? this.state.inBattle : false });
        break;
      case "channel":
        this.loc({ channel: n[0] });
        break;
      case "set_chase_config": {
        const first = cmd.args[0] ?? "";
        let enabled = false;
        let mapId = this.state.location.map;
        let originX = this.state.location.x;
        let originY = this.state.location.y;
        let maxRadius = 150;
        let autoReturn = true;
        let npcId: number | undefined;
        let npcName: string | undefined;

        if (first.startsWith("{")) {
          try {
            const parsed = JSON.parse(first);
            enabled = !!parsed.enabled;
            if (parsed.mapId) mapId = Number(parsed.mapId);
            if (parsed.originX) originX = Number(parsed.originX);
            if (parsed.originY) originY = Number(parsed.originY);
            if (parsed.maxRadius) maxRadius = Number(parsed.maxRadius);
            if (parsed.autoReturn !== undefined) autoReturn = !!parsed.autoReturn;
            npcId = parsed.npcId;
            npcName = parsed.npcName;
          } catch {}
        } else {
          enabled = first === "1" || first === "true";
          mapId = Number(cmd.args[1]) || mapId;
          originX = Number(cmd.args[2]) || originX;
          originY = Number(cmd.args[3]) || originY;
          maxRadius = Number(cmd.args[4]) || maxRadius;
          npcId = Number(cmd.args[5]) || undefined;
          npcName = cmd.args[6] || undefined;
          autoReturn = cmd.args[7] !== "0";
        }
        this.emit({
          chaseConfig: {
            enabled,
            mapId,
            originX,
            originY,
            maxRadius,
            npcId,
            npcName,
            autoReturn,
          },
        });
        break;
      }
      case "start_dungeon":
      case "pvp":
        this.emit({ inBattle: true });
        break;
      case "click":
        if (Math.random() < 0.3) this.emit({ inBattle: true });
        break;
      case "leave_party":
        this.party(slots([this.state.player.name]), "");
        break;
      case "party_invite": {
        const name = cmd.args[0];
        const free = members.find((m) => m.slot > 1 && !m.name);
        if (!free) return { ok: false, message: "Đội đã đầy" };
        this.party(members, `Đã mời ${name}, đang chờ…`);
        setTimeout(() => {
          if (!this.connected) return;
          this.party(this.state.party.members.map((m) => (m.slot === free.slot && !m.name ? { ...m, name } : m)), `${name} đã vào đội`);
        }, 1200 / Math.max(this.ctx.speed, 0.01));
        break;
      }
      case "party_set_leader":
      case "party_set_advisor": {
        const target = members.find((m) => m.slot === n[0]);
        if (!target?.name) return { ok: false, message: `Slot ${n[0]} đang trống` };
        const key = cmd.name === "party_set_leader" ? "isLeader" : "isAdvisor";
        this.party(members.map((m) => ({ ...m, [key]: m.slot === n[0] })));
        break;
      }
      case "drop_item": {
        const slot = n[0] || 1;
        this.emit({ bag: this.state.bag.filter((i) => i.slot !== slot) });
        break;
      }
      case "use_item": {
        const slot = n[0] || 1;
        const itm = this.state.bag.find((i) => i.slot === slot);
        if (itm) {
          if (itm.qty > 1) {
            this.emit({ bag: this.state.bag.map((i) => (i.slot === slot ? { ...i, qty: i.qty - 1 } : i)) });
          } else {
            this.emit({ bag: this.state.bag.filter((i) => i.slot !== slot) });
          }
        }
        break;
      }
      case "deposit_bank": {
        const slot = n[0] || 1;
        const itm = this.state.bag.find((i) => i.slot === slot);
        if (itm) {
          const bank = this.state.bank ?? [];
          const nextSlot = bank.length ? Math.max(...bank.map((b) => b.slot)) + 1 : 1;
          this.emit({
            bag: this.state.bag.filter((i) => i.slot !== slot),
            bank: [...bank, { slot: nextSlot, id: itm.id, qty: itm.qty }],
          });
        }
        break;
      }
      case "withdraw_bank": {
        const slot = n[0] || 1;
        const bank = this.state.bank ?? [];
        const itm = bank.find((i) => i.slot === slot);
        if (itm) {
          const nextSlot = this.state.bag.length ? Math.max(...this.state.bag.map((b) => b.slot)) + 1 : 1;
          this.emit({
            bank: bank.filter((i) => i.slot !== slot),
            bag: [...this.state.bag, { slot: nextSlot, id: itm.id, qty: itm.qty }],
          });
        }
        break;
      }
      case "open_bank":
      case "open_bank_tuongduong": {
        this.loc({ map: 21261, x: 450, y: 310 });
        const bank = this.state.bank && this.state.bank.length > 0 ? this.state.bank : [
          { slot: 1, id: 26002, qty: 50 },
          { slot: 2, id: 26377, qty: 20 },
        ];
        this.emit({ bank });
        break;
      }
      case "warp_to_spot": {
        const targetMap = cmd.name === "warp_to_spot" ? (n[0] || this.state.location.map) : this.state.location.map;
        const targetX = cmd.name === "warp_to_spot" ? (n[1] || 0) : (n[0] || 0);
        const targetY = cmd.name === "warp_to_spot" ? (n[2] || 0) : (n[1] || 0);
        this.loc({ map: targetMap, x: targetX, y: targetY });
        break;
      }
      case "interact_prep":
      case "talk_npc":
      case "close_bank":
        break;
      case "ready_1406": {
        if (this.state.location.map === 21261) {
          const bank = this.state.bank && this.state.bank.length > 0 ? this.state.bank : [
            { slot: 1, id: 26002, qty: 50 },
            { slot: 2, id: 26377, qty: 20 },
          ];
          this.emit({ bank });
        }
        break;
      }
      case "send_menu": {
        const bank = this.state.bank && this.state.bank.length > 0 ? this.state.bank : [
          { slot: 1, id: 26002, qty: 50 },
          { slot: 2, id: 26377, qty: 20 },
        ];
        this.emit({ bank });
        break;
      }
      case "set_item_lists":
      case "sweep_inventory":
      case "shop_sell_and_buy":
      case "execute_shop_transaction":
      case "dungeon":
        break;
      case "dungeon_room_create":
        this.emit({ dungeonRoom: { status: "open", roomId: 101, ready: true } });
        break;
      case "dungeon_room_cancel":
        this.emit({ dungeonRoom: { status: "none" } });
        break;
      case "dungeon_exit":
        this.emit({
          dungeonRoom: { status: "left" },
          location: { ...this.state.location, map: 12001 },
        });
        break;
    }
    return { ok: true };
  }

  async waitFor(kind: WaitKind, _args: string[], timeoutMs: number, signal: AbortSignal): Promise<void> {
    this.requireConnected();
    const needed = 300 + Math.random() * 900;
    if (needed / this.ctx.speed > timeoutMs) {
      await this.delay(timeoutMs * this.ctx.speed, signal);
      throw new Error(`[mock] timeout chờ ${kind}`);
    }
    await this.delay(needed, signal);
    if (kind === "battle") {
      const p = this.state.player;
      const hurt = (g: { cur: number; max: number }, f: number) => ({ cur: Math.max(Math.round(g.max * 0.15), Math.round(g.cur - g.max * f * Math.random())), max: g.max });
      let hp = hurt(p.hp, 0.3);
      let sp = hurt(p.sp, 0.2);
      if (hp.cur < hp.max * 0.4) { hp = { ...hp, cur: hp.max }; sp = { ...sp, cur: sp.max }; } // auto hồi
      this.emit({ inBattle: false, player: { ...p, hp, sp, exp: Math.min(99.9, p.exp + Math.random() * 1.5) } });
    }
    if (kind === "party") this.party(slots([this.state.player.name, "Quan Vũ (mock)", "Triệu Vân (mock)"]));
  }

  getState(): CharacterState {
    return this.state;
  }
  onState(cb: (s: CharacterState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  onDisconnect(cb: (reason: string) => void): () => void {
    this.dropListeners.add(cb);
    return () => this.dropListeners.delete(cb);
  }
}

export const mockDriver: TransportDriver = {
  name: "mock",
  description: "Giả lập an toàn, không kết nối game thật",
  create: () => new MockTransport(),
};
