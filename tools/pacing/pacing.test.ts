import { test } from 'vitest';
import { BALANCE, EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../../src/game/balance';
import {
  buyEquipment,
  buyPantry,
  buyStock,
  fillBasin,
  pickAllDrops,
  sellEggs,
  sellIngredient,
  unlockZone,
} from '../../src/game/actions';
import { ACHIEVEMENTS, achievementStatus, claimAchievement } from '../../src/game/achievements';
import { FAME, buyFame, buyMachine, famePrice, fulfillOrder, machineNextPrice, orderHave, startBatch, stockShelf } from '../../src/game/bakery';
import { stockOf, totalStock } from '../../src/game/stock';
import { MACHINE_CURVE, MAX_MACHINE_LEVEL, RECIPES, stationSeconds, STATION_IDS, canStartRecipe, dessertPrice, linePortions, maxBatch, recipeMaterials, type StationId } from '../../src/game/recipes';
import { levelFor } from '../../src/game/level';
import { advance, createWorld } from '../../src/game/sim';
import { applyGenes } from '../../src/game/genetics';
import { SPECIES, SPECIES_IDS, type LiquidId, type SpeciesId } from '../../src/game/species';
import { createNewSave, equipmentIn, hasEquipmentAnywhere } from '../../src/game/state';
import { START_ZONE, nextLockedZone, unlockedZones } from '../../src/game/zones';

/**
 * 節奏量表（D24）：不是驗收測試，是「幾分鐘達到哪個里程碑」的儀表。
 * `npm run pacing` 跑；環境變數 REACT_SEC（玩家幾秒看一次畫面，預設 3）、SIM_HOURS（預設 3）。
 *
 * 兩種玩法各跑一次：
 * - equip-first：買得起就買設備（順序固定），剩下的錢才拿去解鎖分區
 * - zone-first：先存錢解鎖第一個分區，之後才買設備
 * 訂單卡：只賣「沒被進行中訂單預留」的甜點，訂單一接得到就交——跟自動販售口同一套規則。
 */
const FLOOR = { minX: -0.9, maxX: 0.9, minZ: -0.55, maxZ: 0.55 };
const REACT_SEC = Number(process.env.REACT_SEC ?? 3);
const HOURS = Number(process.env.SIM_HOURS ?? 3);
const SPAWN = { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { x: 0.62, z: 0.28 } };
const BUY_ORDER: EquipmentId[] = ['collector', 'autoFill', 'restock'];
/** 設備每一區各買各的（D45）；只有這兩台的效果是分區的，理性玩家會在每一區重買，補貨合約全場一台就夠 */
const ZONE_SCOPED = new Set<EquipmentId>(['collector', 'autoFill']);

/**
 * `hybrid` 情境（2026-09-22，D28）：開局其中一隻是卡士達（焦糖＋鮮奶酪的異合）。
 * 這不是造假狀態——正常玩法灌牛乳就會突變出鮮奶酪，混種因此是玩家真的會有的東西。
 * 要量的是「混種訂單接不接得到」：混種只有一隻在產，一份甜點要 2 份原料、
 * 一份原料要一次泡澡（約 65 秒），而訂單只活 `orderTtlSec` 秒。
 */
/**
 * D50–D54（2026-09-23）起甜點在工坊做：玩家每次看畫面就把做完的站往下推、打蛋站空了就開一盤、
 * 補展示架、交預訂單；工坊用不到的多餘蛋與原料直接賣給商店（原料兩條路）。
 * `raw-only` 情境＝完全不進工坊、原料全賣：拿來對照「工坊值不值得」。
 * 成就一達成就領（D54 開局資金），里程碑記「成就領到 N 元」。
 */
/**
 * D56／D57（2026-09-24）起工坊是食譜制全自動流水線：玩家（bot）要先在商店買機器，
 * 再從菜單挑一道做得起的甜點放上線，之後線上自己走完；bot 只負責上架、交預訂單。
 * 機器買法：先把焦糖布丁塔那條線買齊（開局只有焦糖原料），解鎖上層之後再補齊其他機器；
 * 升級只在「錢多到升級價的兩倍」時才升（不把擴建的錢吃光）。
 * 工坊留著用的底量：最大那一盤（Lv3 一盤 4 份）的蛋與原料，多的才賣。
 */
/**
 * D60 起一盤份數由玩家疊（bot 一律疊到最多），D61 起機器 20 級、一盤上限＝等級：
 * 留底量跟著「目前最大那一盤」走（最少 4 盤份），不然 bot 把蛋賣光、線升得再高也只做得出 1 份。
 */
const KEEP_MIN_PORTIONS = 4;
const FIRST_LINE: StationId[] = RECIPES.caramel.route;

type Profile = 'equip-first' | 'zone-first' | 'hybrid' | 'raw-only' | 'month';

/**
 * D61「同等困難」：機器與人氣的升級不再只在「錢多到升級價兩倍」時才升，
 * 改成每次挑**最便宜的那一個**升級買（真人玩家也是先買買得起的），擴建仍優先（留下一區的錢）。
 */
function cheapestUpgrade(state: ReturnType<typeof createNewSave>): { kind: 'machine'; id: StationId; price: number } | { kind: 'fame'; price: number } | null {
  let best: { kind: 'machine'; id: StationId; price: number } | { kind: 'fame'; price: number } | null = null;
  for (const id of STATION_IDS) {
    const price = machineNextPrice(state, id);
    if (price !== null && (!best || price < best.price)) best = { kind: 'machine', id, price };
  }
  const fp = famePrice(state.bakery.fame);
  if (fp !== null && (!best || fp < best.price)) best = { kind: 'fame', price: fp };
  return best;
}

function run(profile: Profile, seed: number) {
  const state = createNewSave({ seed, now: 0 });
  if (profile === 'hybrid') applyGenes(state.puddings[0]!, 'caramel', 'panna');
  state.stock.milk = 6; // 牛乳是繁殖的入口，開局要有一點才玩得起來
  const w = createWorld(state, FLOOR);
  const noop = () => {};
  const milestones: Record<string, number> = {};
  const hybridOrders = { new: 0, done: 0, expired: 0 };
  const isHybrid = (id: SpeciesId) => SPECIES[id].alleles[0] !== SPECIES[id].alleles[1];
  /** 「實玩」分鐘（month 情境：離線那幾小時不算，D61 同等困難量的是這個） */
  let activeSec = 0;
  const upgrades: { day: number; active: number; what: string }[] = [];
  const mark = (k: string) => {
    if (!(k in milestones)) milestones[k] = profile === 'month' ? activeSec : state.time;
  };
  const upgraded = (what: string) => {
    mark(what);
    upgrades.push({ day: Math.floor(state.time / 86400) + 1, active: activeSec, what });
  };

  let achievementCoins = 0;
  let achievementCoins20 = 0;
  /** 花掉的錢（量「一天賺多少」用：賺的＝手上的＋花掉的） */
  let spent = 0;
  const pay = <T,>(f: () => T): T => {
    const c = state.coins;
    const r = f();
    if (state.coins < c) spent += c - state.coins;
    return r;
  };
  const earnedByDay: number[] = [];
  const step = () => {
    // D34：牛奶澡＝繁殖。還有空位就優先倒牛乳（玩家想把櫥窗養滿），滿了才倒焦糖。
    // 不模擬這一步的話量表只會跑舊路徑，住客永遠是「解鎖送的那幾隻」
    const capacity = state.zones.filter((z) => z.unlocked).length * BALANCE.zoneCapacity;
    const wantMore = state.puddings.length < capacity;
    state.basins.forEach((b, i) => {
      if (b.units > 0) return;
      if (wantMore && state.stock.milk > 0) fillBasin(state, i, 'milk', noop);
      else if (state.stock.caramel > 0) fillBasin(state, i, 'caramel', noop);
    });
    if (state.drops.length) {
      pickAllDrops(state, noop, false);
      mark('first pick');
    }
    const bakery = profile !== 'raw-only';
    if (bakery) {
      // 機器：先湊齊焦糖布丁塔那條線，再補其他台（Lv1），最後有餘錢才升級
      for (const id of [...FIRST_LINE, ...STATION_IDS]) {
        if (state.bakery.machines[id] > 0) continue;
        // 焦糖布丁塔用不到的機器（冷藏櫃）等解鎖上層、開始養其他口味再買
        if (!FIRST_LINE.includes(id) && state.zones.filter((z) => z.unlocked).length < 2) continue;
        const price = machineNextPrice(state, id)!;
        if (state.coins >= price + 20 && pay(() => buyMachine(state, id, noop)).ok) mark(`buy machine ${id}`);
      }
      if (FIRST_LINE.every((f) => state.bakery.machines[f] > 0)) mark('bakery line ready');
      if (STATION_IDS.every((f) => state.bakery.machines[f] > 0)) {
        // 擴建優先：升級只花「留下下一區的錢之後」多出來的；每次挑最便宜的那一個升（機器或人氣）
        for (let guard = 0; guard < 50; guard++) {
          const up = cheapestUpgrade(state);
          if (!up) break;
          const reserve = (nextLockedZone(state)?.price ?? 0) + 20;
          if (state.coins < up.price + reserve) break;
          if (up.kind === 'machine' && pay(() => buyMachine(state, up.id, noop)).ok) upgraded(`upgrade ${up.id} Lv${state.bakery.machines[up.id]}`);
          else if (up.kind === 'fame' && pay(() => buyFame(state, noop)).ok) upgraded(`fame Lv${state.bakery.fame}`);
          else break;
        }
      }
      // 菜單：做得起的裡面挑最貴的放上線（起始站忙就等下一輪）；份數疊到最多（D60）
      const pickable = SPECIES_IDS.filter((id) => canStartRecipe(state, id)).sort((a, b) => dessertPrice(b) - dessertPrice(a));
      for (const id of pickable) if (canStartRecipe(state, id)) startBatch(state, id, maxBatch(state, id), noop);
      if (state.stats.baked > 0) mark('first bake');
      for (const o of [...state.orders]) {
        if (orderHave(state, o) >= o.qty && fulfillOrder(state, o.id, noop).ok) mark('first order');
      }
      stockShelf(state, noop);
      if (state.stats.served > 0) mark('first customer');
      if (state.stats.daysClosed > 0) mark('first day closed');
    }
    // 原料兩條路：工坊留底量，多的直接賣
    // 留底量＝這條線一場（15 分鐘）做得完的份數：最慢那一站決定一場能過幾盤、一盤最多幾份（D60／D61）。
    // 只留兩盤份的話，離線累積的材料一開場就被 bot 賣光，量到的是 bot 的賣法不是機器升級的價值
    const portions = Math.max(KEEP_MIN_PORTIONS, ...SPECIES_IDS.map((id) => linePortions(state, id)));
    // 只有月玩家這樣留：他一開場就有離線累積的一大堆；3 小時連續玩的沒有存貨，留太多只是把早期的錢卡住
    const trays = profile === 'month' ? Math.ceil(900 / Math.max(...FIRST_LINE.map((id) => stationSeconds(state, id)))) : 1;
    const keepEggs = bakery ? portions * 2 * trays : 0;
    const keepIng = bakery ? portions * trays : 0;
    if (state.eggs > keepEggs) sellEggs(state, state.eggs - keepEggs, noop);
    for (const id of SPECIES_IDS) {
      // 別的甜點要拿它當配料的（例如奶酪塊、抹茶粉、草莓醬）也留著
      const usedElsewhere = bakery && SPECIES_IDS.some((d) => d !== id && recipeMaterials(d).some(([k]) => k === id));
      const keep = keepIng * (usedElsewhere ? 2 : 1);
      const have = stockOf(state, 'ingredients', id, 1);
      if (have > keep && sellIngredient(state, id, have - keep, noop, 1).ok) mark('first sale');
    }
    // 麵粉與牛乳補到「最大那一盤」的兩倍（D60：一盤最多 20 份，一次只補 10 份的話 bot 自己卡自己，量到的是 bot 不是平衡）
    const bulk = levelFor(state.xp) >= BALANCE.stockBulkLevel ? BALANCE.stockBulkQty : BALANCE.stockBuyQty;
    // 只有月玩家這樣補（3 小時連續玩的補這麼多只會把早期的錢卡住、延後買線——seed 固定，這是確定的差不是抖動）
    const topUp = profile === 'month' ? portions * 2 : 0;
    for (let guard = 0; bakery && state.pantry.flour < Math.max(4, topUp) && guard < 10; guard++) {
      if (!pay(() => buyPantry(state, 'flour', bulk, noop)).ok) break;
    }
    for (const a of ACHIEVEMENTS) {
      if (achievementStatus(state, a) === 'claimable') {
        claimAchievement(state, a.id, noop);
        achievementCoins += a.reward;
        for (const c of [300, 640, 1500]) if (achievementCoins >= c) mark(`achievements ${c}`);
      }
    }
    if (state.time <= 20 * 60) achievementCoins20 = achievementCoins;
    for (const l of ['caramel', 'milk'] as LiquidId[]) {
      if (state.stock[l] < 2) pay(() => buyStock(state, l, 5, noop));
      // 牛乳也是甜點材料：一盤要疊到最多就得有那麼多
      for (let guard = 0; bakery && l === 'milk' && state.stock.milk < topUp && guard < 10; guard++) {
        if (!pay(() => buyStock(state, 'milk', bulk, noop)).ok) break;
      }
    }

    for (const e of w.events) {
      if (e.type === 'orderNew' && isHybrid(e.species)) hybridOrders.new++;
      if (e.type === 'orderDone' && isHybrid(e.species)) hybridOrders.done++;
      if (e.type === 'orderExpired' && isHybrid(e.species)) hybridOrders.expired++;
    }
    w.events.length = 0;

    const nz = nextLockedZone(state);
    const zoneFirst = profile === 'zone-first' && state.zones.filter((z) => z.unlocked).length < 2;
    if (!zoneFirst) {
      for (const z of unlockedZones(state)) {
        for (const id of BUY_ORDER) {
          if (equipmentIn(state, z.id)[id]) continue;
          if (!ZONE_SCOPED.has(id) && hasEquipmentAnywhere(state, id)) continue;
          if (state.coins >= EQUIPMENT[id].price && pay(() => buyEquipment(state, id, noop, z.id)).ok) {
            mark(z.id === START_ZONE ? `buy ${id}` : `buy ${id} (${z.shortName})`);
          }
        }
      }
    }
    // 留 20 幣做補貨
    if (nz && state.coins >= nz.price + 20 && pay(() => unlockZone(state, nz.id, SPAWN, noop)).ok) mark(`unlock ${nz.name}`);
    for (const c of [100, 500, 1000, 3000]) if (state.coins >= c) mark(`coins ${c}`);
    mark(`Lv.${levelFor(state.xp)}`);
  };

  if (profile === 'month') {
    // 月玩家（D61）：每天三次、每次實玩 15 分鐘（08:00／13:00／21:00），中間離線照 offlineCapSec 上限結算，跑 30 天
    const SESSIONS = [8, 13, 21];
    const PLAY = 15 * 60;
    for (let day = 0; day < 30; day++) {
      for (let i = 0; i < SESSIONS.length; i++) {
        for (let t = 0; t < PLAY; t += REACT_SEC) {
          advance(w, REACT_SEC);
          activeSec += REACT_SEC;
          step();
        }
        const nextStart = i + 1 < SESSIONS.length ? SESSIONS[i + 1]! : SESSIONS[0]! + 24;
        const gap = (nextStart - SESSIONS[i]!) * 3600 - PLAY;
        advance(w, Math.min(gap, BALANCE.offlineCapSec));
        // 離線上限之外的時間不算數，但時鐘要走到下一次開遊戲那一刻（天數才對得上）
        if (gap > BALANCE.offlineCapSec) state.time += gap - BALANCE.offlineCapSec;
      }
      earnedByDay.push(state.coins + spent);
    }
  } else {
    const total = HOURS * 3600;
    for (let t = 0; t < total; t += REACT_SEC) {
      advance(w, REACT_SEC);
      activeSec += REACT_SEC;
      step();
    }
  }

  if (profile === 'month') {
    // D61 同等困難：以 5 天為一段數升級次數；每一段的實玩分鐘數一樣（15 分 × 3 次 × 5 天）
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const u of upgrades) buckets[Math.min(5, Math.floor((u.day - 1) / 5))]!++;
    const gaps = upgrades.slice(1).map((u, i) => (u.active - upgrades[i]!.active) / 60);
    const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
    const lv = STATION_IDS.map((id) => `${id}:${state.bakery.machines[id]}`).join(' ');
    console.log(
      `\n=== month (seed ${seed}, 3×15 min/day, 30 days) ===\n` +
        `upgrades per 5 days: ${buckets.join(' / ')}  (total ${upgrades.length}, median gap ${med.toFixed(1)} active min)\n` +
        `day 30: ${lv} fame:${state.bakery.fame}  (max ${MAX_MACHINE_LEVEL}/${FAME.max})\n` +
        `end: coins=${Math.floor(state.coins)} baked=${state.stats.baked} served=${state.stats.served} missed=${state.stats.missed} puddings=${state.puddings.length} eggs=${state.eggs} desserts=${totalStock(state, 'desserts')}\n` +
        `per day: ${Array.from({ length: 30 }, (_, d) => upgrades.filter((u) => u.day === d + 1).length).join(' ')}\n` +
        `earned per day (k): ${earnedByDay.map((e, i) => Math.round((e - (earnedByDay[i - 1] ?? 0)) / 1000)).join(' ')}\n`,
    );
    return;
  }
  const lines = Object.entries(milestones)
    .sort((a, b) => a[1] - b[1])
    .map(([k, s]) => `${(s / 60).toFixed(1).padStart(7)} min  ${k}`);
  console.log(
    `\n=== ${profile} (seed ${seed}, react every ${REACT_SEC}s, ${HOURS}h) ===\n${lines.join('\n')}\n` +
      `end: coins=${Math.floor(state.coins)} xp=${state.xp} baths=${state.stats.baths} sold=${state.stats.sold} puddings=${state.puddings.length} ` +
      `baked=${state.stats.baked} served=${state.stats.served} missed=${state.stats.missed} days=${state.stats.daysClosed} bestDay=${state.stats.bestDayRevenue} ordersDone=${state.stats.ordersDone}
` +
      `achievements: ${achievementCoins} coins total, ${achievementCoins20} in first 20 min
` +
      `equip=${unlockedZones(state).map((z) => `${z.shortName}:${EQUIPMENT_IDS.filter((e) => equipmentIn(state, z.id)[e]).join('+')}`).join(' ')}\n` +
      `species=${SPECIES_IDS.filter((id) => state.puddings.some((p) => p.species === id)).join(',')}\n` +
      `hybrid orders: new=${hybridOrders.new} done=${hybridOrders.done} expired=${hybridOrders.expired}\n`,
  );
}

// 校準用（D61）：PACING_PMAX／PACING_PHALF／PACING_PPOW 暫時覆寫升級價曲線，不必改 src 就能試數字
for (const [env, key] of [['PACING_PMAX', 'priceMax'], ['PACING_PHALF', 'priceHalf'], ['PACING_PPOW', 'pricePow'], ['PACING_UBASE', 'upgradeBase']] as const) {
  if (process.env[env]) (MACHINE_CURVE as Record<string, number>)[key] = Number(process.env[env]);
}

test('pacing report', () => {
  if (process.env.PACING_ONLY !== 'month') {
    run('equip-first', 7);
    run('zone-first', 7);
    run('equip-first', 99);
    run('hybrid', 7);
    run('raw-only', 7);
  }
  // 月玩家很慢（約 600 小時遊戲時間）：PACING_MONTH=1 或 PACING_ONLY=month 才跑
  if (process.env.PACING_MONTH === '1' || process.env.PACING_ONLY === 'month') {
    run('month', 7);
    if (process.env.PACING_SEEDS !== '1') run('month', 99);
  }
}, 3_600_000);
