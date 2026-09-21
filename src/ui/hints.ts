import { BALANCE, EQUIPMENT } from '../game/balance';
import { SPECIES_IDS } from '../game/species';
import type { GameState } from '../game/state';
import { basinsIn, dropsIn, puddingsIn } from '../game/zones';

/**
 * 新手引導。刻意**完全從 state 推導**，沒有「教學進度」這個欄位——
 * 少一個欄位就少一條要 migrate、要存檔、會跟實際狀態不同步的路徑。
 * 玩家做到哪一步，提示就自己跳到下一句。
 *
 * 結束條件：買下第一台自動化設備。那是「我懂這個迴圈了」的里程碑，
 * 再繼續唸下去就變成嘮叨。
 */
export interface Hint {
  id: string;
  text: string;
}

const DISMISS_KEY = 'lpg.hints.off';

export function hintsDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // 無痕模式讀不到就當作沒關過，提示照顯示
  }
}

export function dismissHints(): void {
  try {
    globalThis.localStorage?.setItem(DISMISS_KEY, '1');
  } catch {
    /* 存不進去就這一輪不顯示，下次重開會再出現——比整個壞掉好 */
  }
}

export function nextHint(state: GameState): Hint | null {
  if (Object.values(state.equipment).some(Boolean)) return null;

  const zone = state.activeZone;

  // 「正在發生的事」排在「倒澡盆」前面：手動倒一次只有一份，布丁一跳進盆裡 units 就歸零，
  // 若先檢查盆空不空，泡澡中／撿原料這兩句永遠輪不到，玩家從頭到尾只會看到「倒焦糖」。
  if (puddingsIn(state, zone).some((p) => p.mode === 'bathing')) {
    return { id: 'bathing', text: '泡澡中。泡完會在盆邊掉一份原料。' };
  }

  if (dropsIn(state, zone).length > 0) {
    return { id: 'pick', text: '地上有原料了，點它或按「撿原料」收進庫存。' };
  }

  const basins = basinsIn(state, zone);
  const hasLiquid = basins.some((b) => b.units > 0);
  if (!hasLiquid) {
    return state.stock.caramel > 0
      ? { id: 'pour', text: '先按下面的「倒焦糖」。布丁缺焦糖的時候會自己跳進澡盆。' }
      : { id: 'restock', text: '焦糖用完了。開右上角的商店補貨，再倒進澡盆。' };
  }

  const craftable = SPECIES_IDS.reduce(
    (n, id) => n + Math.floor(state.ingredients[id] / BALANCE.ingredientsPerDessert),
    0,
  );
  if (craftable > 0 && state.stats.crafted === 0) {
    return { id: 'craft', text: `按「加工」，${BALANCE.ingredientsPerDessert} 份原料做成一份甜點。` };
  }

  if (SPECIES_IDS.some((id) => state.desserts[id] > 0)) {
    return { id: 'ship', text: '按「出貨」賣掉。有訂單卡的話會優先交貨，價格是 2–3 倍。' };
  }

  if (state.coins >= EQUIPMENT.collector.price) {
    return { id: 'buy', text: `存到 ${EQUIPMENT.collector.price} 了。去商店買「原料收集手」，以後原料自動入庫。` };
  }

  if (state.stats.sold > 0) {
    return { id: 'grind', text: '繼續倒澡盆、賣原料，存錢買第一台自動化設備。' };
  }

  return null;
}
