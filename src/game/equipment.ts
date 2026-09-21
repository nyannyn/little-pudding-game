import { craft, fulfillOrder, pickAllDrops, sellDessert } from './actions';
import { BALANCE } from './balance';
import { pourIntoBasin } from './basin';
import type { EventSink } from './events';
import { LIQUIDS, SPECIES_IDS, type LiquidId } from './species';
import type { GameState } from './state';

/**
 * 自動化：每 tick 依已裝設備替玩家做掉對應的手動動作。
 * 「手動 vs 自動」的差別必須整條走設備旗標（AC2-8 的負向對照就是把旗標拿掉，
 * 兩組結果會變一樣而紅），所以這裡不准有「反正也沒差」的捷徑。
 */
export function runAutomation(state: GameState, emit: EventSink): void {
  if (state.equipment.autoFill) autoFill(state, emit);
  if (state.equipment.collector && state.drops.length > 0) pickAllDrops(state, emit, true);
  if (state.equipment.crafter) autoCraft(state, emit);
  if (state.equipment.seller) autoSell(state, emit);
  if (state.equipment.restock) autoRestock(state, emit);
}

/** 澡盆低於一份就從庫存補滿（只補「玩家上次倒的那一種」，不會自己改口味） */
function autoFill(state: GameState, emit: EventSink): void {
  state.basins.forEach((b, i) => {
    if (b.units >= 1) return;
    const liquid = b.liquid ?? b.preferredLiquid;
    if (!liquid) return;
    if (state.stock[liquid] <= 0) return;
    const r = pourIntoBasin(state, i, liquid, BALANCE.basinCapacity);
    if (r.ok) emit({ type: 'pour', basinIndex: i, liquid, units: r.poured, auto: true });
  });
}

function autoCraft(state: GameState, emit: EventSink): void {
  for (const s of SPECIES_IDS) {
    while (state.ingredients[s] >= BALANCE.ingredientsPerDessert) {
      if (!craft(state, s, emit, true).ok) break;
    }
  }
}

/**
 * 自動販售口：先交付接得到的訂單卡（出價 2–3 倍），
 * 剩下的甜點才直接賣——不然自動化反而讓玩家錯過高價訂單。
 */
function autoSell(state: GameState, emit: EventSink): void {
  for (const o of [...state.orders]) {
    if (o.expiresAt <= state.time) continue;
    if (state.desserts[o.species] >= o.qty) fulfillOrder(state, o.id, emit, true);
  }
  for (const s of SPECIES_IDS) {
    const reserved = state.orders
      .filter((o) => o.species === s && o.expiresAt > state.time)
      .reduce((sum, o) => sum + o.qty, 0);
    const spare = state.desserts[s] - reserved;
    if (spare > 0) sellDessert(state, s, spare, emit, true);
  }
}

/** 補貨合約：焦糖與牛乳見底就自動補到 restockTarget（特殊液體不自動買，太貴） */
function autoRestock(state: GameState, emit: EventSink): void {
  const basics: LiquidId[] = ['caramel', 'milk'];
  for (const liquid of basics) {
    if (state.stock[liquid] >= BALANCE.restockFloor) continue;
    const want = BALANCE.restockTarget - state.stock[liquid];
    const unit = LIQUIDS[liquid].unitPrice;
    const affordable = Math.min(want, Math.floor(state.coins / unit));
    if (affordable <= 0) continue;
    state.coins -= unit * affordable;
    state.stock[liquid] += affordable;
    emit({ type: 'buy', what: LIQUIDS[liquid].name, cost: unit * affordable, auto: true });
  }
}
