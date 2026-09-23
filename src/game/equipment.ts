import { pickAllDrops } from './actions';
import { BALANCE } from './balance';
import { pourIntoBasin } from './basin';
import type { EventSink } from './events';
import { LIQUIDS, type LiquidId } from './species';
import { equipmentIn, hasEquipmentAnywhere, type GameState } from './state';
import { unlockedZones } from './zones';

/**
 * 自動化：每 tick 依已裝設備替玩家做掉對應的手動動作。
 * 「手動 vs 自動」的差別必須整條走設備旗標（AC2-8 的負向對照就是把旗標拿掉，
 * 兩組結果會變一樣而紅），所以這裡不准有「反正也沒差」的捷徑。
 *
 * 設備是每一區各買各的（D45）：注液閥／收集手只碰裝了它的那一區的澡盆／掉落物；
 * 補貨合約操作的是全場共用的庫存，任一區裝了就跑一次（不是每區跑一次，否則 emit 會重複）。
 * 加工機與販售口在 D50 退役（甜點改在工坊做，工坊的自動化在 `bakery.ts`）。
 */
export function runAutomation(state: GameState, emit: EventSink): void {
  for (const z of unlockedZones(state)) {
    const eq = equipmentIn(state, z.id);
    if (eq.autoFill) autoFill(state, z.id, emit);
    if (eq.collector && state.drops.some((d) => d.zone === z.id)) pickAllDrops(state, emit, true, z.id);
  }
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
