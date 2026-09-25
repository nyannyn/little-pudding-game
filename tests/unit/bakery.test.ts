import { describe, expect, it } from 'vitest';
import { puddingSaleBlock, sellPudding } from '../../src/game/actions';
import { ACHIEVEMENTS, achievementStatus, claimAchievement, claimableCount } from '../../src/game/achievements';
import {
  STATION_IDS,
  buyMachine,
  dayClock,
  fulfillOrder,
  shelfCount,
  startBatch,
  stationStatus,
  stockShelf,
  tickBakery,
} from '../../src/game/bakery';
import { BALANCE, RETIRED_EQUIPMENT_PRICE } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import {
  RECIPES,
  STATIONS,
  canStartRecipe,
  dessertPrice,
  lineFailRate,
  linePortions,
  machinePrice,
  materialHave,
  maxBatch,
  materialPrice,
  recipeBlockers,
  recipeMaterials,
  recipeSeconds,
  type StationId,
} from '../../src/game/recipes';
import { createRng } from '../../src/game/rng';
import { advance } from '../../src/game/sim';
import { SPECIES_IDS, puddingPrice, type SpeciesId } from '../../src/game/species';
import { createNewSave, migrate, SCHEMA_VERSION, type GameState } from '../../src/game/state';
import { START_ZONE, zoneKey } from '../../src/game/zones';
import { makeWorld } from './helpers';

const sink = (_e: SimEvent) => {};
const B = BALANCE.bakery;

/** 這道甜點的整條線買到 lv 級 */
function ownLine(s: GameState, species: SpeciesId, lv = 1) {
  for (const id of RECIPES[species].route) s.bakery.machines[id] = Math.max(s.bakery.machines[id], lv);
}

/** 材料剛好夠 n 份 */
function stockFor(s: GameState, species: SpeciesId, n: number) {
  for (const [k, per] of recipeMaterials(species)) {
    if (k === 'egg') s.eggs = per * n;
    else if (k === 'milk') s.stock.milk = per * n;
    else if (k === 'flour' || k === 'rice') s.pantry[k] = per * n;
    else s.ingredients[k] = [per * n, 0, 0, 0, 0];
  }
}

function ready(species: SpeciesId = 'caramel', lv = 1): GameState {
  const s = createNewSave({ seed: 3, now: 0 });
  ownLine(s, species, lv);
  stockFor(s, species, linePortions(s, species));
  return s;
}

/** 疊到最多份數再開工（D60 以前按一下就是這個份數；份數由玩家疊的規則另在 batchLevels.test.ts） */
function startMax(s: GameState, species: SpeciesId, emit: (e: SimEvent) => void = sink) {
  return startBatch(s, species, Math.max(1, maxBatch(s, species)), emit);
}

/** 把工坊時間推 sec 秒（每秒一 tick，跟 advance 同步長） */
function run(s: GameState, sec: number, seed = 1, events?: SimEvent[]) {
  const rng = createRng(seed);
  const emit = events ? (e: SimEvent) => events.push(e) : sink;
  for (let i = 0; i < sec; i++) {
    s.time += 1;
    tickBakery(s, rng, emit);
  }
}

describe('AC9-1 食譜照真實做法：每道是固定順序的子序列、用多種原料', () => {
  it('十道甜點的路線都照 STATION_IDS 的順序、不重複', () => {
    for (const id of SPECIES_IDS) {
      const idx = RECIPES[id].route.map((st) => STATION_IDS.indexOf(st));
      expect(idx.every((v) => v >= 0)).toBe(true);
      for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
    }
  });

  it('不是每道都五步：步數有 3 也有 7；每道至少兩種原料', () => {
    const lens = SPECIES_IDS.map((id) => RECIPES[id].route.length);
    expect(Math.min(...lens)).toBe(3);
    expect(Math.max(...lens)).toBe(7);
    for (const id of SPECIES_IDS) expect(recipeMaterials(id).length).toBeGreaterThanOrEqual(2);
  });

  it('該物種自己的原料一定在食譜裡；總時長＝路線各站相加', () => {
    for (const id of SPECIES_IDS) expect(RECIPES[id].materials[id]).toBeGreaterThan(0);
    expect(recipeSeconds(ready('hojicha'), 'hojicha')).toBe(STATIONS.crack.sec + STATIONS.mix.sec + STATIONS.mold.sec + STATIONS.bake.sec);
  });

  it('甜點一定比「直接賣／買材料」值錢（進工坊不虧）', () => {
    for (const id of SPECIES_IDS) {
      const materials = recipeMaterials(id).reduce((n, [k, q]) => n + materialPrice(k) * q, 0);
      expect(dessertPrice(id)).toBeGreaterThan(materials);
    }
  });
});

describe('AC9-2 開不了工要講得出原因，而且什麼都不扣', () => {
  it('沒機器：列出路線上還沒買的機器', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    stockFor(s, 'caramel', 4);
    const b = recipeBlockers(s, 'caramel');
    expect(b.machines).toEqual(RECIPES.caramel.route);
    const before = JSON.stringify(s);
    const r = startMax(s, 'caramel');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('缺機器');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('缺料：列出缺的那幾種與有／需', () => {
    const s = ready('caramel');
    s.pantry.flour = 0;
    const b = recipeBlockers(s, 'caramel');
    expect(b.machines).toEqual([]);
    expect(b.materials).toEqual([{ key: 'flour', need: 1, have: 0 }]);
    const before = JSON.stringify(s);
    expect(startMax(s, 'caramel').ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('起始站上還有一盤：講起始站在忙', () => {
    const s = ready('caramel');
    stockFor(s, 'caramel', 2);
    expect(startMax(s, 'caramel').ok).toBe(true);
    const b = recipeBlockers(s, 'caramel');
    expect(b.busy).toBe('stove');
    expect(canStartRecipe(s, 'caramel')).toBe(false);
  });

  it('開工時材料一次扣齊（不會做到一半缺料卡住）', () => {
    const s = ready('brulee');
    expect(startMax(s, 'brulee').ok).toBe(true);
    for (const [k] of recipeMaterials('brulee')) expect(materialHave(s, k)).toBe(0);
  });

  it('買機器：扣錢、升級、滿級不能再買', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    s.coins = 1e9;
    const c0 = s.coins;
    for (let i = 0; i < 3; i++) expect(buyMachine(s, 'bake', sink).ok).toBe(true);
    expect(s.bakery.machines.bake).toBe(3);
    expect(c0 - s.coins).toBe([0, 1, 2].reduce((n, lv) => n + machinePrice('bake', lv)!, 0));
    s.bakery.machines.bake = 20;
    const before = JSON.stringify(s);
    expect(buyMachine(s, 'bake', sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('錢不夠買不了、state 不變', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    s.coins = STATIONS.bake.price - 1;
    const before = JSON.stringify(s);
    expect(buyMachine(s, 'bake', sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('AC9-3 放上線就自動走完', () => {
  it('不經玩家操作，一盤走完整條路線、每一站都空出來', () => {
    const s = ready('panna');
    const events: SimEvent[] = [];
    expect(startMax(s, 'panna').ok).toBe(true);
    run(s, recipeSeconds(s, 'panna') + 3, 5, events);
    for (const id of STATION_IDS) expect(stationStatus(s, id)).toBe('idle');
    const done = events.filter((e) => e.type === 'bakeDone').length + events.filter((e) => e.type === 'bakeFailed').length;
    expect(done).toBe(1);
    expect(s.desserts.panna.reduce((a, b) => a + b, 0) + events.filter((e) => e.type === 'bakeFailed').length).toBe(1);
  });

  it('只走自己的站：鮮奶酪杯不經過烤箱', () => {
    const s = ready('panna');
    const events: SimEvent[] = [];
    startMax(s, 'panna', (e) => events.push(e));
    run(s, recipeSeconds(s, 'panna') + 3, 5, events);
    const visited = events.filter((e) => e.type === 'bakeStep').map((e) => (e as { station: StationId }).station);
    expect(visited).toEqual(RECIPES.panna.route);
  });

  it('下一站還有一盤就在原站等，兩盤不會疊在一起', () => {
    const s = ready('hojicha');
    stockFor(s, 'hojicha', 2);
    startMax(s, 'hojicha');
    run(s, STATIONS.crack.sec + STATIONS.mix.sec + STATIONS.mold.sec + 1); // 第一盤進烤箱
    expect(s.bakery.stations.bake.batch).not.toBeNull();
    startMax(s, 'hojicha');
    run(s, STATIONS.crack.sec + STATIONS.mix.sec + STATIONS.mold.sec + 3); // 第二盤走到裝模、做完，烤箱還在烤
    expect(s.bakery.stations.mold.batch).not.toBeNull();
    expect(stationStatus(s, 'mold')).toBe('ready');
    expect(stationStatus(s, 'bake')).toBe('working');
    run(s, STATIONS.bake.sec + 5);
    expect(s.bakery.stations.mold.batch).toBeNull();
  });

  it('模擬本身就會推（advance），不用任何自動化旗標', () => {
    const w = makeWorld({ puddings: 1 });
    ownLine(w.state, 'hojicha');
    stockFor(w.state, 'hojicha', 1);
    startMax(w.state, 'hojicha');
    advance(w, recipeSeconds(w.state, 'hojicha') + 5);
    for (const id of STATION_IDS) expect(w.state.bakery.stations[id].batch).toBeNull();
  });
});

describe('AC9-4 份數上限＝路線上最低那台', () => {
  it('每級 ＋1 份（D61）：Lv1 線 1 份、Lv2 2 份、Lv3 3 份、Lv20 20 份', () => {
    for (const lv of [1, 2, 3, 20]) expect(linePortions(ready('caramel', lv), 'caramel')).toBe(lv);
  });

  it('混級取低：只有烤箱升到 Lv3 還是 1 份；沒用到的機器不影響', () => {
    const s = ready('caramel', 1);
    s.bakery.machines.bake = 3;
    expect(linePortions(s, 'caramel')).toBe(1);
    const p = ready('panna', 2);
    p.bakery.machines.bake = 0; // 鮮奶酪杯不走烤箱
    expect(linePortions(p, 'panna')).toBe(2);
  });

  it('份數是上限不是門檻：全線 Lv3、材料只夠 1 份也開得了工，開 1 份', () => {
    const s = ready('matcha', 3);
    stockFor(s, 'matcha', 1);
    expect(canStartRecipe(s, 'matcha')).toBe(true);
    expect(startMax(s, 'matcha').ok).toBe(true);
    expect(s.bakery.stations.crack.batch).toEqual({ species: 'matcha', qty: 1, star: 1 });
  });

  it('材料夠 3 份、上限 5 份：最多開 3 份，材料剛好扣完', () => {
    const s = ready('hojicha', 5);
    stockFor(s, 'hojicha', 3);
    expect(maxBatch(s, 'hojicha')).toBe(3);
    startMax(s, 'hojicha');
    expect(s.bakery.stations.crack.batch?.qty).toBe(3);
    for (const [k] of recipeMaterials('hojicha')) expect(materialHave(s, k)).toBe(0);
  });

  it('開工扣的材料跟著份數走', () => {
    const s = ready('caramel', 2);
    stockFor(s, 'caramel', 5);
    startMax(s, 'caramel');
    expect(s.eggs).toBe(2 * 5 - 2 * 2);
    expect(s.bakery.stations.stove.batch).toEqual({ species: 'caramel', qty: 2, star: 1 });
  });
});

describe('AC9-5 失敗率照表、機器等級打折', () => {
  function measure(lv: number): number {
    let made = 0;
    let total = 0;
    for (let seed = 1; seed <= 250; seed++) {
      const s = ready('custard', lv);
      total += maxBatch(s, 'custard');
      startMax(s, 'custard');
      run(s, recipeSeconds(s, 'custard') + 8, seed);
      made += s.desserts.custard.reduce((a, b) => a + b, 0);
    }
    return 1 - made / total;
  }

  it('Lv1 的卡士達泡芙失敗率約 15%', () => {
    expect(lineFailRate(ready('custard', 1), 'custard')).toBeCloseTo(0.15);
    expect(Math.abs(measure(1) - 0.15)).toBeLessThan(0.05);
  });

  it('Lv3 打到 ×0.49（每級 ×0.7，D61）', () => {
    expect(lineFailRate(ready('custard', 3), 'custard')).toBeCloseTo(0.15 * 0.49);
    expect(Math.abs(measure(3) - 0.15 * 0.49)).toBeLessThan(0.03);
  });

  it('失敗的份數發 bakeFailed、不進成品櫃', () => {
    let found = false;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const t = ready('custard', 3);
      const ev: SimEvent[] = [];
      const qty = maxBatch(t, 'custard');
      startMax(t, 'custard');
      run(t, recipeSeconds(t, 'custard') + 8, seed, ev);
      const failed = ev.filter((e) => e.type === 'bakeFailed').reduce((n, e) => n + (e as { qty: number }).qty, 0);
      if (failed > 0) {
        found = true;
        expect(t.desserts.custard.reduce((a, b) => a + b, 0)).toBe(qty - failed);
      }
    }
    expect(found).toBe(true);
  });
});

describe('AC9-6 沒整條線不來客、不出預訂單', () => {
  it('開局 30 分鐘：沒有撲空的客人、沒有訂單', () => {
    const w = makeWorld({ puddings: 1 });
    advance(w, 1800);
    expect(w.state.stats.missed).toBe(0);
    expect(w.state.orders).toHaveLength(0);
  });

  it('沒機器但展示架上有貨（v8 老玩家升上來）：照樣營業，貨賣得掉；賣空了閘門自己關上', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.bakery.shelf.caramel = [3, 0, 0, 0, 0];
    advance(w, 600);
    expect(w.state.bakery.shelf.caramel.reduce((a, b) => a + b, 0)).toBe(0);
    expect(w.state.stats.served).toBeGreaterThan(0);
    const missed = w.state.stats.missed;
    advance(w, 600);
    expect(w.state.stats.missed).toBe(missed);
  });

  it('湊齊一道甜點的線就開張', () => {
    const w = makeWorld({ puddings: 1 });
    ownLine(w.state, 'panna');
    advance(w, 1800);
    expect(w.state.stats.missed).toBeGreaterThan(0);
    expect(w.state.orders.length).toBeGreaterThan(0);
  });
});

describe('AC9-7 v8 → v9：機器全無、線上那幾盤退回材料', () => {
  function v8(stations: Record<string, { batch: { species: string; qty: number } | null; doneAt: number }>): Record<string, unknown> {
    const raw = JSON.parse(JSON.stringify(createNewSave({ seed: 9, now: 0 }))) as Record<string, unknown>;
    raw.schemaVersion = 8;
    delete raw.pantry;
    const bk = raw.bakery as Record<string, unknown>;
    delete bk.machines;
    bk.auto = { crack: true, mix: true, mold: true, bake: true, decorate: true };
    bk.stations = {
      crack: { batch: null, doneAt: 0 },
      mix: { batch: null, doneAt: 0 },
      mold: { batch: null, doneAt: 0 },
      bake: { batch: null, doneAt: 0 },
      decorate: { batch: null, doneAt: 0 },
      ...stations,
    };
    bk.shelf = { matcha: 3 };
    raw.eggs = 1;
    raw.ingredients = { caramel: 0, matcha: 0 };
    raw.desserts = { caramel: 2 };
    return raw;
  }

  it('打蛋站那盤只退蛋；攪拌站以後蛋與原料都退', () => {
    const s = migrate(v8({
      crack: { batch: { species: 'caramel', qty: 2 }, doneAt: 5 },
      bake: { batch: { species: 'matcha', qty: 2 }, doneAt: 5 },
    }), { seed: 1, now: 0 });
    expect(s.eggs).toBe(1 + 2 * 2 + 2 * 2);
    expect(s.ingredients.caramel.reduce((a, b) => a + b, 0)).toBe(0);
    expect(s.ingredients.matcha.reduce((a, b) => a + b, 0)).toBe(2);
    for (const id of STATION_IDS) expect(s.bakery.stations[id].batch).toBeNull();
  });

  it('機器全部未購買（舊版五站免費不等於送機器）、自動化旗標消失', () => {
    const s = migrate(v8({}), { seed: 1, now: 0 });
    for (const id of STATION_IDS) expect(s.bakery.machines[id]).toBe(0);
    expect('auto' in s.bakery).toBe(false);
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('成品櫃、展示架原樣留；pantry 補開局那一份', () => {
    const s = migrate(v8({}), { seed: 1, now: 0 });
    expect(s.desserts.caramel.reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.bakery.shelf.matcha.reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.pantry.flour).toBe(BALANCE.startPantry.flour);
  });

  it('升上來之後再存再讀：不會再退一次（冪等）', () => {
    const once = migrate(v8({ mold: { batch: { species: 'caramel', qty: 2 }, doneAt: 5 } }), { seed: 1, now: 0 });
    const twice = migrate(JSON.parse(JSON.stringify(once)), { seed: 1, now: 0 });
    expect(twice.eggs).toBe(once.eggs);
    expect(twice.ingredients.caramel.reduce((a, b) => a + b, 0)).toBe(once.ingredients.caramel.reduce((a, b) => a + b, 0));
  });

  it('機器等級、線上的盤子、pantry 經存檔來回都還在', () => {
    const s = ready('caramel', 2);
    startMax(s, 'caramel');
    s.pantry.rice = 7;
    const back = migrate(JSON.parse(JSON.stringify(s)), { seed: 1, now: 0 });
    expect(back.bakery.machines.bake).toBe(2);
    expect(back.bakery.stations.stove.batch).toEqual({ species: 'caramel', qty: 2, star: 1 });
    expect(back.pantry.rice).toBe(7);
  });
});

describe('AC8-3 營業日從 epoch 起算', () => {
  it('新檔：第 1 天 07:00 開門', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const c = dayClock(s);
    expect(c.day).toBe(1);
    expect(c.hour).toBeCloseTo(B.openHour);
    expect(c.open).toBe(true);
  });

  it('time 很大的 v7 舊檔升上來：第 1 天、營業中（不是 Day 30）', () => {
    const old = createNewSave({ seed: 1, now: 0 }) as unknown as Record<string, unknown>;
    old.time = 36000;
    old.schemaVersion = 7;
    delete old.bakery;
    const s = migrate(JSON.parse(JSON.stringify(old)), { seed: 1, now: 0 });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    const c = dayClock(s);
    expect(c.day).toBe(1);
    expect(c.open).toBe(true);
  });

  it('營業 07:00–21:00，21:00 打烊', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const hourSec = B.dayLengthSec / 24;
    s.time = (B.closeHour - B.openHour) * hourSec - 1;
    expect(dayClock(s).open).toBe(true);
    s.time += 2;
    expect(dayClock(s).open).toBe(false);
    s.time = B.dayLengthSec; // 隔天 07:00
    expect(dayClock(s)).toMatchObject({ day: 2, open: true });
  });
});

describe('AC8-4 客人、打烊結算', () => {
  it('營業中客人從展示架買走、架空就記錯過；打烊不來客', () => {
    const w = makeWorld({ puddings: 1 });
    ownLine(w.state, 'panna');
    w.state.bakery.shelf.caramel = [3, 0, 0, 0, 0];
    const coins = w.state.coins;
    advance(w, B.customerIntervalMax * 6);
    expect(w.state.bakery.shelf.caramel.reduce((a, b) => a + b, 0)).toBe(0);
    expect(w.state.coins).toBeGreaterThanOrEqual(coins + 3 * dessertPrice('caramel'));
    expect(w.state.stats.served).toBeGreaterThan(0);
    expect(w.state.bakery.today.missed).toBeGreaterThan(0);
  });

  it('離線跑 3 天：結算 3 次、lastDay 是最後一天、事件裡每天一個 dayClosed', () => {
    const w = makeWorld({ puddings: 1 });
    ownLine(w.state, 'panna');
    const events: SimEvent[] = [];
    w.emit = (e) => events.push(e);
    w.state.bakery.shelf.caramel = [5, 0, 0, 0, 0];
    advance(w, B.dayLengthSec * 3);
    expect(w.state.stats.daysClosed).toBe(3);
    expect(w.state.bakery.lastDay?.day).toBe(3);
    expect(events.filter((e) => e.type === 'dayClosed')).toHaveLength(3);
    // 營收只算第一天賣掉的那 5 份，而且記在 bestDayRevenue（單調）
    expect(w.state.stats.bestDayRevenue).toBeGreaterThanOrEqual(5 * dessertPrice('caramel'));
  });

  it('上架不會把預訂單要的份數擺出去', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.desserts.matcha = [3, 0, 0, 0, 0];
    s.orders.push({ id: 'o1', species: 'matcha', qty: 2, price: 999, createdAt: 0, expiresAt: 9999 });
    expect(stockShelf(s, sink)).toBe(1);
    expect(s.desserts.matcha.reduce((a, b) => a + b, 0)).toBe(2);
    expect(fulfillOrder(s, 'o1', sink).ok).toBe(true);
    expect(s.stats.ordersDone).toBe(1);
  });

  it('上架不超過架子上限', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.desserts.caramel = [B.shelfCap + 5, 0, 0, 0, 0];
    stockShelf(s, sink);
    expect(shelfCount(s)).toBe(B.shelfCap);
    expect(s.desserts.caramel.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('預訂單成品櫃不夠時從展示架補', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.desserts.caramel = [1, 0, 0, 0, 0];
    s.bakery.shelf.caramel = [2, 0, 0, 0, 0];
    s.orders.push({ id: 'o1', species: 'caramel', qty: 3, price: 100, createdAt: 0, expiresAt: 9999 });
    expect(fulfillOrder(s, 'o1', sink).ok).toBe(true);
    expect(s.desserts.caramel.reduce((a, b) => a + b, 0) + s.bakery.shelf.caramel.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('AC8-5 v7 → v8：退役設備退款、成品保留', () => {
  function v7(): Record<string, unknown> {
    const s = createNewSave({ seed: 9, now: 0 });
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.schemaVersion = 7;
    delete raw.bakery;
    delete raw.claimedAchievements;
    delete raw.speciesSeen;
    const upper = zoneKey(0, 2);
    (raw.zones as { id: string; unlocked: boolean }[]).find((z) => z.id === upper)!.unlocked = true;
    raw.equipment = {
      [START_ZONE]: { autoFill: true, collector: true, crafter: true, seller: false, restock: false },
      [upper]: { autoFill: false, collector: false, crafter: true, seller: false, restock: false },
    };
    raw.storedEquipment = { autoFill: 0, collector: 0, crafter: 0, seller: 1, restock: 0 };
    raw.equipmentPos = { [START_ZONE]: { crafter: { x: 0, z: 0 }, collector: { x: 0.1, z: 0.1 } } };
    raw.coins = 10;
    raw.desserts = { caramel: 4 };
    return raw;
  }

  it('兩區的加工機＋倉庫一台販賣機全部照原價退款；設備與位置紀錄消失', () => {
    const s = migrate(v7(), { seed: 1, now: 0 });
    expect(s.coins).toBe(10 + 2 * RETIRED_EQUIPMENT_PRICE.crafter! + RETIRED_EQUIPMENT_PRICE.seller!);
    expect(Object.keys(s.equipment[START_ZONE]!)).toEqual(['autoFill', 'collector', 'restock']);
    expect(Object.keys(s.storedEquipment)).toEqual(['autoFill', 'collector', 'restock']);
    expect(s.equipmentPos[START_ZONE]).toEqual({ collector: { x: 0.1, z: 0.1 } });
    expect(s.equipment[START_ZONE]!.collector).toBe(true);
  });

  it('手上的甜點留著當成品櫃、工坊是空的、養過的物種從住客補', () => {
    const s = migrate(v7(), { seed: 1, now: 0 });
    expect(s.desserts.caramel.reduce((a, b) => a + b, 0)).toBe(4);
    expect(shelfCount(s)).toBe(0);
    expect(s.speciesSeen).toEqual(['caramel']);
    expect(s.claimedAchievements).toEqual([]);
  });

  it('v8 存檔再讀一次不會再退一次款（冪等）', () => {
    const once = migrate(v7(), { seed: 1, now: 0 });
    const twice = migrate(JSON.parse(JSON.stringify(once)), { seed: 1, now: 0 });
    expect(twice.coins).toBe(once.coins);
  });
});

describe('AC8-7 賣布丁', () => {
  function adults(n: number): GameState {
    const s = createNewSave({ seed: 1, now: 0, puddingCount: n, puddingPositions: Array.from({ length: n }, (_, i) => ({ x: -0.5 + i * 0.2, z: 0 })) });
    s.time = 1000;
    return s;
  }

  it('成年布丁可以賣，錢＝物種原料價 × puddingPriceMult', () => {
    const s = adults(2);
    const p = s.puddings[0]!;
    const coins = s.coins;
    expect(sellPudding(s, p.id, sink).ok).toBe(true);
    expect(s.puddings).toHaveLength(1);
    expect(s.coins).toBe(coins + puddingPrice('caramel'));
    expect(s.stats.puddingsSold).toBe(1);
  });

  it('最後一隻不能賣（牛奶澡要有布丁去泡才生得出來）', () => {
    const s = adults(1);
    const before = JSON.stringify(s);
    expect(sellPudding(s, s.puddings[0]!.id, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('幼布丁、泡澡中不能賣，state 不變', () => {
    const s = adults(3);
    s.puddings[0]!.bornAt = s.time - 1;
    s.puddings[1]!.mode = 'bathing';
    const before = JSON.stringify(s);
    expect(sellPudding(s, s.puddings[0]!.id, sink).ok).toBe(false);
    expect(sellPudding(s, s.puddings[1]!.id, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(puddingSaleBlock(s, s.puddings[2]!.id)).toBeNull();
  });

  it('正要跳進澡盆的那隻被賣掉，盆的佔位要放掉', () => {
    const s = adults(2);
    const p = s.puddings[0]!;
    p.basinIndex = 0;
    s.basins[0]!.occupantId = p.id;
    sellPudding(s, p.id, sink);
    expect(s.basins[0]!.occupantId).toBeNull();
  });

  it('定價：混種比純種貴、每一種都比牛奶澡的成本高', () => {
    for (const id of SPECIES_IDS) expect(puddingPrice(id)).toBeGreaterThan(BALANCE.startStock.milk ?? 2);
    expect(puddingPrice('sakura')).toBeGreaterThan(puddingPrice('matcha'));
    expect(puddingPrice('custard')).toBeGreaterThan(puddingPrice('caramel'));
  });
});

describe('AC8-8 成就', () => {
  it('達成後要領才入帳；領兩次第二次失敗', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.stats.picked = 1;
    const coins = s.coins;
    const r = claimAchievement(s, 'firstPick', sink);
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(coins + 30);
    const again = claimAchievement(s, 'firstPick', sink);
    expect(again.ok).toBe(false);
    expect(s.coins).toBe(coins + 30);
  });

  it('還沒達成領不到，state 不變', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const before = JSON.stringify(s);
    expect(claimAchievement(s, 'firstBake', sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('花光錢、賣掉布丁都不會讓已達成的成就退回去（只看單調欄位）', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.stats.births = 1;
    s.speciesSeen.push('panna', 'custard', 'matcha', 'hojicha', 'sakura');
    s.coins = 0;
    s.puddings = s.puddings.slice(0, 1);
    const a = (id: string) => achievementStatus(s, ACHIEVEMENTS.find((x) => x.id === id)!);
    expect(a('firstBirth')).toBe('claimable');
    expect(a('species5')).toBe('claimable');
    expect(a('hybrid3')).toBe('claimable');
  });

  it('前七條（開局資金）合計 640 元；id 不重複', () => {
    const early = ['firstPick', 'firstSale', 'firstBath', 'firstBirth', 'firstBake', 'firstCustomer', 'firstDay'];
    const sum = ACHIEVEMENTS.filter((a) => early.includes(a.id)).reduce((n, a) => n + a.reward, 0);
    expect(sum).toBe(640);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('老玩家的舊 stats 算數：撿過泡過的升上來就能領', () => {
    const old = createNewSave({ seed: 1, now: 0 }) as unknown as Record<string, unknown>;
    old.stats = { baths: 50, sold: 20, mutations: 0, picked: 120, crafted: 10, births: 3 };
    delete old.claimedAchievements;
    const s = migrate(JSON.parse(JSON.stringify(old)), { seed: 1, now: 0 });
    expect(claimableCount(s)).toBeGreaterThanOrEqual(4); // firstPick／firstBath／firstBirth／pick100
    const a = (id: string) => achievementStatus(s, ACHIEVEMENTS.find((x) => x.id === id)!);
    expect(a('firstBake')).toBe('locked');
  });

  it('養過的物種在模擬裡自動記下（出生／突變不用各記一次）', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.puddings[0]!.species = 'panna';
    advance(w, 0.5);
    expect(w.state.speciesSeen).toContain('panna');
  });
});
