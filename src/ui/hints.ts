import { BALANCE, EQUIPMENT } from '../game/balance';
import { LIQUIDS, SPECIES_IDS, type LiquidId } from '../game/species';
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
  /** 警告類：不是教學，玩家按 × 關掉教學之後仍要顯示 */
  warning?: boolean;
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

/**
 * 生產線停擺的警告：庫存裡沒有任何倒得出來的液體、這一區的盆都空了、又有布丁想泡澡。
 * 買了自動化設備之後教學會停，但這個狀況會讓整個遊戲靜靜停住（實測：開局 6 份焦糖
 * 在裝好收集手＋注液閥後約 4 分鐘就用完，之後布丁只是在地板上跳、什麼都不產），
 * 玩家會以為壞掉。補貨合約裝了就不會發生，所以那時不用講。
 */
function stalledHint(state: GameState): Hint | null {
  if (state.equipment.restock) return null;
  const zone = state.activeZone;
  const basins = basinsIn(state, zone);
  if (basins.some((b) => b.units > 0)) return null;
  if (!puddingsIn(state, zone).some((p) => p.mode !== 'bathing' && p.caramel < BALANCE.batheThreshold)) return null;

  if (state.equipment.autoFill) {
    // 注液閥只會補「上次倒的那一種」：那一種沒了就停，庫存裡有別種也不會自己換
    const wanted = basins.map((b) => b.preferredLiquid).filter((l): l is LiquidId => l !== null);
    if (wanted.length === 0 || wanted.some((l) => state.stock[l] > 0)) return null;
    const names = [...new Set(wanted)].map((l) => LIQUIDS[l].name).join('、');
    return { id: 'stalled', text: `${names}用完了，注液閥沒東西可補。布丁照樣會掉原料，但泡不了澡也生不出小布丁。`, warning: true };
  }
  const pourable: LiquidId[] = ['caramel', 'milk', ...state.ownedBasins];
  if (pourable.some((l) => state.stock[l] > 0)) return null;
  return { id: 'stalled', text: '液體都用完了，布丁泡不了澡。倒牛乳才生得出小布丁。', warning: true };
}

export function nextHint(state: GameState): Hint | null {
  const stalled = stalledHint(state);
  if (stalled) return stalled;
  if (Object.values(state.equipment).some(Boolean)) return null;

  const zone = state.activeZone;

  // 「正在發生的事」排在「倒澡盆」前面：手動倒一次只有一份，布丁一跳進盆裡 units 就歸零，
  // 若先檢查盆空不空，泡澡中／撿原料這兩句永遠輪不到，玩家從頭到尾只會看到「倒焦糖」。
  if (puddingsIn(state, zone).some((p) => p.mode === 'bathing')) {
    return { id: 'bathing', text: '泡澡中。泡牛乳澡的話，泡完會多一隻小布丁。' };
  }

  if (dropsIn(state, zone).length > 0) {
    return { id: 'pick', text: '布丁掉東西了。蛋與原料點一下或按「撿原料」收進庫存。' };
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
    return { id: 'craft', text: `按「加工」，${BALANCE.eggsPerDessert} 顆蛋＋${BALANCE.ingredientsPerDessert} 份原料做成一份甜點。` };
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
