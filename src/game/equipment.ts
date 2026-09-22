import { craft, pickAllDrops, shipDesserts } from './actions';
import { BALANCE } from './balance';
import { pourIntoBasin } from './basin';
import type { EventSink } from './events';
import { LIQUIDS, SPECIES_IDS, type LiquidId } from './species';
import { equipmentIn, hasEquipmentAnywhere, type GameState } from './state';
import { unlockedZones } from './zones';

/**
 * 自動化：每 tick 依已裝設備替玩家做掉對應的手動動作。
 * 「手動 vs 自動」的差別必須整條走設備旗標（AC2-8 的負向對照就是把旗標拿掉，
 * 兩組結果會變一樣而紅），所以這裡不准有「反正也沒差」的捷徑。
 *
 * 設備是每一區各買各的（D45）：注液閥／收集手只碰裝了它的那一區的澡盆／掉落物；
 * 加工機／販售口／補貨合約操作的是全場共用的庫存，任一區裝了就跑一次（不是每區跑一次——
 * 跑兩次也只是把同一批原料做完，但 emit 會多出重複事件）。
 */
export function runAutomation(state: GameState, emit: EventSink): void {
  for (const z of unlockedZones(state)) {
    const eq = equipmentIn(state, z.id);
    if (eq.autoFill) autoFill(state, z.id, emit);
    if (eq.collector && state.drops.some((d) => d.zone === z.id)) pickAllDrops(state, emit, true, z.id);
  }
  if (hasEquipmentAnywhere(state, 'crafter')) autoCraft(state, emit);
  if (hasEquipmentAnywhere(state, 'seller')) autoSell(state, emit);
  if (hasEquipmentAnywhere(state, 'restock')) autoRestock(state, emit);
}

/** 澡盆低於一份就從庫存補滿（只補「玩家上次倒的那一種」，不會自己改口味），只補這一區的盆 */
function autoFill(state: GameState, zone: string, emit: EventSink): void {
  state.basins.forEach((b, i) => {
    if (b.zone !== zone) return;
    if (b.units >= 1) return;
    const liquid = b.liquid ?? b.preferredLiquid;
    if (!liquid) return;
    if (state.stock[liquid] <= 0) return;
    const r = pourIntoBasin(state, i, liquid, BALANCE.basinCapacity);
    if (r.ok) emit({ type: 'pour', basinIndex: i, liquid, units: r.poured, auto: true });
  });
}

/** 甜點加工機：蛋與該物種原料都夠才做得出來（D33） */
function autoCraft(state: GameState, emit: EventSink): void {
  for (const s of SPECIES_IDS) {
    while (state.eggs >= BALANCE.eggsPerDessert && state.ingredients[s] >= BALANCE.ingredientsPerDessert) {
      if (!craft(state, s, emit, true).ok) break;
    }
  }
}

/**
 * 自動販售口：先交付接得到的訂單卡（出價 2–3 倍），剩下的甜點才直接賣——
 * 不然自動化反而讓玩家錯過高價訂單。規則本體在 `actions.shipDesserts()`，
 * 手動的「出貨」按鈕走同一個函式（兩邊各寫一份正是 2026-09-22 那個 bug 的成因）。
 */
function autoSell(state: GameState, emit: EventSink): void {
  shipDesserts(state, emit, true);
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
