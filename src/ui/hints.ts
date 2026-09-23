import { BALANCE, EQUIPMENT } from '../game/balance';
import { puddingMood } from '../game/pudding';
import { claimableCount } from '../game/achievements';
import { batchesOnLine, dayClock } from '../game/bakery';
import { STATIONS, anyLineReady, canStartRecipe, lineCost, RECIPES } from '../game/recipes';
import { LIQUIDS, SPECIES_IDS, type LiquidId } from '../game/species';
import { STORAGE_ZONE, equipmentIn, hasAnyEquipment, hasEquipmentAnywhere, type GameState } from '../game/state';
import { basinsIn, dropsIn, puddingsIn, unlockedZones } from '../game/zones';

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
  /**
   * 告知類警告（目前只有「櫥窗住滿了」）：農場沒有停，只是再泡牛乳生不出來。
   * 跟「農場停住」不同，玩家知道之後就不需要一直被唸——按 × 就永久關掉（記在這台裝置上），
   * 「不再顯示提示」也關得掉。`id` 帶著已解鎖區數，解鎖新的一區又住滿時才會再講一次。
   */
  dismissable?: boolean;
}

/** 動作列上那顆按鈕印的字。提示要叫玩家「按『倒焦糖』」，就得跟按鈕用同一個名字
 *  （`LIQUIDS.shortName` 是「熱焦糖」「鮮牛乳」，跟按鈕上的字對不起來）。hud.ts 也用這一份。 */
export const LIQUID_SHORT: Record<LiquidId, string> = {
  caramel: '焦糖',
  milk: '牛乳',
  matcha: '抹茶',
  strawberry: '草莓',
};

const DISMISS_KEY = 'lpg.hints.off';

export function hintsDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // 無痕模式讀不到就當作沒關過，提示照顯示
  }
}

const CLOSED_KEY = 'lpg.hints.closed';

/** 按 × 永久關掉的告知類警告（`Hint.dismissable`），記的是當時的 `id` */
export function closedHint(): string {
  try {
    return globalThis.localStorage?.getItem(CLOSED_KEY) ?? '';
  } catch {
    return '';
  }
}

export function closeHintForGood(id: string): void {
  try {
    globalThis.localStorage?.setItem(CLOSED_KEY, id);
  } catch {
    /* 存不進去就只關這一輪 */
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
 * 生產線停擺的警告：這一區的盆都空了、又有布丁想泡澡。
 *
 * **停的不只是泡澡。** D35 之後焦糖見底的布丁連原料都不會掉（`BALANCE.dropCaramelMin`），
 * 所以這個狀態是整座農場歸零，不是「少一件事做」。這句話原本寫「布丁照樣會掉原料」，
 * 是 D32 時代的舊文案——玩家照著它等，等到的是什麼都不會發生
 * （2026-09-22 使用者存檔實證：三隻布丁 caramel 全 0、drops 0、停了十幾分鐘）。
 *
 * 買了自動化設備之後教學會停，但這個狀況會讓整個遊戲靜靜停住，所以它是 `warning`。
 * 補貨合約裝了就不會發生，那時不用講。
 */
function stalledHint(state: GameState): Hint | null {
  if (hasEquipmentAnywhere(state, 'restock')) return null;
  const zone = state.activeZone;
  const basins = basinsIn(state, zone);
  if (basins.some((b) => b.units > 0)) return null;
  if (!puddingsIn(state, zone).some((p) => puddingMood(p, state.time) === 'wantsBath')) return null;

  // 庫存裡現在還倒得出來的東西（＝動作列上還沒變灰的那幾顆）
  const pourable = (['caramel', 'milk', ...state.ownedBasins] as LiquidId[]).filter((l) => state.stock[l] > 0);
  const stalled = (text: string): Hint => ({ id: 'stalled', text, warning: true });

  if (equipmentIn(state, zone).autoFill) {
    // 注液閥只會補「上次倒的那一種」：那一種沒了就停，庫存裡有別種也不會自己換
    const wanted = [...new Set(basins.map((b) => b.preferredLiquid).filter((l): l is LiquidId => l !== null))];
    if (wanted.length === 0 || wanted.some((l) => state.stock[l] > 0)) return null;
    const names = wanted.map((l) => LIQUIDS[l].name).join('、');
    if (pourable.length > 0) {
      // 出路一定要講出來。庫存裡有焦糖、按鈕也亮著，玩家卻在等一個永遠不會自己好的農場
      const alt = pourable.map((l) => `「倒${LIQUID_SHORT[l]}」`).join('或');
      return stalled(`${names}用完了。注液閥只補上次倒的那一種，不會自己換口味——手動按一次${alt}就會換過去。布丁焦糖見底的時候連原料都不會掉。`);
    }
    return stalled(`${names}用完了，注液閥沒東西可補。焦糖見底的布丁泡不了澡，也不會再掉原料——去商店補貨。`);
  }
  if (pourable.length > 0) return null;
  return stalled('液體都用完了。焦糖見底的布丁泡不了澡，也不會再掉原料——去商店補貨。倒牛乳才生得出小布丁。');
}

/**
 * 住滿的警告（2026-09-23 使用者回報「這個提示沒辦法不再顯示」→ 改成可以永久關掉，見 `Hint.dismissable`）：已解鎖的每一區都住滿了，再泡牛乳也只是把牛乳用掉。
 *
 * 規則層在這個情況會 emit `{ type: 'error' }`（`pudding.finishBath`），但那個事件沒有人接——
 * 而且**也不該接成 toast**：離線結算八小時會把同一句話丟出上百次。
 * 從 state 推導成一條常駐警告才是對的形狀（2026-09-22 使用者泡了 21 次澡只生 1 隻，全程沒有任何訊息）。
 */
function zoneFullHint(state: GameState): Hint | null {
  // 還有任何一區有空位就不用講：新生兒會自己溢出過去（`breeding.placementZone`）
  if (unlockedZones(state).some((z) => puddingsIn(state, z.id).length < BALANCE.zoneCapacity)) return null;
  // 沒在碰牛乳的玩家不需要被唸繁殖的事
  const milkInPlay =
    state.stock.milk > 0 ||
    state.basins.some((b) => b.zone !== STORAGE_ZONE && (b.liquid === 'milk' || b.preferredLiquid === 'milk'));
  if (!milkInPlay) return null;
  return {
    id: `zonefull:${unlockedZones(state).length}`,
    dismissable: true,
    text: `櫥窗全住滿了（每一區 ${BALANCE.zoneCapacity} 隻）。再泡牛乳也生不出小布丁，只會把牛乳用掉——去商店解鎖下一區才有空位。`,
    warning: true,
  };
}

export function nextHint(state: GameState): Hint | null {
  // 警告先講：農場停住、住滿了這兩件事比任何教學都重要，而且關掉教學之後仍要顯示
  const stalled = stalledHint(state);
  if (stalled) return stalled;
  const full = zoneFullHint(state);
  if (full) return full;
  if (hasAnyEquipment(state)) return null;

  const zone = state.activeZone;

  // 「正在發生的事」排在「倒澡盆」前面：手動倒一次只有一份，布丁一跳進盆裡 units 就歸零，
  // 若先檢查盆空不空，泡澡中／撿原料這兩句永遠輪不到，玩家從頭到尾只會看到「倒焦糖」。
  if (puddingsIn(state, zone).some((p) => p.mode === 'bathing')) {
    // 「泡完會多一隻」在住滿時是假話，但住滿的情況已經被 zoneFullHint 先攔走了
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

  // 成就（D54）是開局資金的來源：有得領就先講，不然第一台設備要存很久
  if (claimableCount(state) > 0 && state.claimedAchievements.length === 0) {
    return { id: 'achieve', text: '右上角的獎盃有成就可以領，按「領取」就有焦糖幣。' };
  }

  // D50：農場不再加工，甜點改在工坊做。D57 起機器要買：機器與材料都齊了才帶去開工。
  // 「去買機器」不在農場講：教學在買下第一台農場設備（收集手 60）就結束，一定比整條線（430）先到，
  // 排在這裡只會搶走「去買收集手」那一句。買機器的引導在工坊裡（`bakeryHint` 的 bk-buy）。
  if (state.stats.baked === 0 && SPECIES_IDS.some((id) => canStartRecipe(state, id))) {
    return { id: 'bakery', text: '做甜點的材料湊齊了。按「甜點店」→「菜單」挑一道放上流水線，賣得比原料貴。' };
  }

  if (state.stats.served === 0 && SPECIES_IDS.some((id) => state.desserts[id] > 0)) {
    return { id: 'shelf', text: '甜點做好了。在甜點店按「上架」擺進展示櫃，營業時間客人會來買。' };
  }

  if (state.coins >= EQUIPMENT.collector.price) {
    return { id: 'buy', text: `存到 ${EQUIPMENT.collector.price} 了。去商店買「原料收集手」，以後原料自動入庫。` };
  }

  if (state.stats.sold > 0) {
    return { id: 'grind', text: '繼續倒澡盆、賣原料、做甜點，存錢買第一台自動化設備。' };
  }

  return null;
}

/**
 * 甜點工坊畫面用的提示（D51）。農場那套講的是倒澡盆、撿原料——在工坊裡看到「先按倒焦糖」
 * 只會讓人找不到按鈕（2026-09-23 第一張截圖就是這樣）。
 * 警告（農場停住）照舊優先；教學句只講到客人第一次買走東西為止。
 */
export function bakeryHint(state: GameState): Hint | null {
  const stalled = stalledHint(state);
  if (stalled) return stalled;
  if (claimableCount(state) > 0 && state.claimedAchievements.length === 0) {
    return { id: 'achieve', text: '右上角的獎盃有成就可以領，按「領取」就有焦糖幣。' };
  }
  if (state.stats.served > 0 && state.stats.baked >= 4) return null;

  if (!anyLineReady(state)) {
    const need = RECIPES.caramel.route.filter((id) => state.bakery.machines[id] === 0).map((id) => STATIONS[id].name);
    return { id: 'bk-buy', text: `工坊還沒有機器。開右上角商店的「工坊」頁購買；焦糖布丁塔要${need.join('、')}（共 ${lineCost(state, 'caramel')} 元）。` };
  }
  if (state.stats.baked === 0 && batchesOnLine(state) === 0) {
    return SPECIES_IDS.some((id) => canStartRecipe(state, id))
      ? { id: 'bk-start', text: '按「菜單」挑一道甜點放上流水線，機器會自己一站一站做完。' }
      : { id: 'bk-need', text: '菜單裡每道甜點下面會寫還缺什麼。回農場撿蛋與原料、在商店補麵粉與牛乳。' };
  }
  if (SPECIES_IDS.some((id) => state.desserts[id] > 0) && SPECIES_IDS.every((id) => state.bakery.shelf[id] === 0)) {
    return { id: 'shelf', text: '甜點做好了。按「上架」擺進展示櫃，營業時間客人會來買。' };
  }
  if (!dayClock(state).open) {
    return { id: 'bk-closed', text: `打烊了，客人明天 ${String(BALANCE.bakery.openHour).padStart(2, '0')}:00 再來。現在先把甜點烤好，開門就有得賣。` };
  }
  return null;
}
