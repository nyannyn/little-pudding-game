import { test } from 'vitest';
import { BALANCE, EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../../src/game/balance';
import {
  buyEquipment,
  buyStock,
  fillBasin,
  pickAllDrops,
  sellEggs,
  sellIngredient,
  unlockZone,
} from '../../src/game/actions';
import { ACHIEVEMENTS, achievementStatus, claimAchievement } from '../../src/game/achievements';
import { STATION_IDS, advanceStation, canStartBatch, fulfillOrder, startBatch, stationStatus, stockShelf } from '../../src/game/bakery';
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
/** 工坊留著用的底量：一盤要蛋 4／原料 2，留兩盤份，多的才賣 */
const KEEP_EGGS = 2 * BALANCE.bakery.batchSize * BALANCE.eggsPerDessert;
const KEEP_ING = 2 * BALANCE.bakery.batchSize * BALANCE.ingredientsPerDessert;

function run(profile: 'equip-first' | 'zone-first' | 'hybrid' | 'raw-only', seed: number) {
  const state = createNewSave({ seed, now: 0 });
  if (profile === 'hybrid') applyGenes(state.puddings[0]!, 'caramel', 'panna');
  state.stock.milk = 6; // 牛乳是繁殖的入口，開局要有一點才玩得起來
  const w = createWorld(state, FLOOR);
  const noop = () => {};
  const milestones: Record<string, number> = {};
  const hybridOrders = { new: 0, done: 0, expired: 0 };
  const isHybrid = (id: SpeciesId) => SPECIES[id].alleles[0] !== SPECIES[id].alleles[1];
  const mark = (k: string) => {
    if (!(k in milestones)) milestones[k] = state.time;
  };

  let achievementCoins = 0;
  let achievementCoins20 = 0;
  const total = HOURS * 3600;
  for (let t = 0; t < total; t += REACT_SEC) {
    advance(w, REACT_SEC);
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
      // 下游先推，上游才推得過去
      for (const id of [...STATION_IDS].reverse()) {
        if (stationStatus(state, id) === 'ready') advanceStation(state, id, noop);
      }
      if (!state.bakery.stations.crack.batch) {
        const best = SPECIES_IDS.filter((id) => canStartBatch(state, id)).sort((a, b) => state.ingredients[b] - state.ingredients[a])[0];
        if (best) startBatch(state, best, noop);
      }
      if (state.stats.baked > 0) mark('first bake');
      for (const o of [...state.orders]) {
        if (state.desserts[o.species] + state.bakery.shelf[o.species] >= o.qty && fulfillOrder(state, o.id, noop).ok) mark('first order');
      }
      stockShelf(state, noop);
      if (state.stats.served > 0) mark('first customer');
      if (state.stats.daysClosed > 0) mark('first day closed');
    }
    // 原料兩條路：工坊留底量，多的直接賣
    const keepEggs = bakery ? KEEP_EGGS : 0;
    const keepIng = bakery ? KEEP_ING : 0;
    if (state.eggs > keepEggs) sellEggs(state, state.eggs - keepEggs, noop);
    for (const id of SPECIES_IDS) {
      if (state.ingredients[id] > keepIng && sellIngredient(state, id, state.ingredients[id] - keepIng, noop).ok) mark('first sale');
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
      if (state.stock[l] < 2) buyStock(state, l, 5, noop);
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
          if (state.coins >= EQUIPMENT[id].price && buyEquipment(state, id, noop, z.id).ok) {
            mark(z.id === START_ZONE ? `buy ${id}` : `buy ${id} (${z.shortName})`);
          }
        }
      }
    }
    // 留 20 幣做補貨
    if (nz && state.coins >= nz.price + 20 && unlockZone(state, nz.id, SPAWN, noop).ok) mark(`unlock ${nz.name}`);
    for (const c of [100, 500, 1000, 3000]) if (state.coins >= c) mark(`coins ${c}`);
    mark(`Lv.${levelFor(state.xp)}`);
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

test('pacing report', () => {
  run('equip-first', 7);
  run('zone-first', 7);
  run('equip-first', 99);
  run('hybrid', 7);
  run('raw-only', 7);
});
