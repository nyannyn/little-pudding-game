import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { movePudding, pickDrop, sellIngredient, unlockZone, ingredientSellPrice } from '../../src/game/actions';
import { BALANCE } from '../../src/game/balance';
import { startBatch, tickBakery, walkInPrice } from '../../src/game/bakery';
import { dessertPrice } from '../../src/game/recipes';
import { breedFromBath } from '../../src/game/breeding';
import type { SimEvent } from '../../src/game/events';
import { applySpeciesAsPure } from '../../src/game/genetics';
import { importCode } from '../../src/game/savecode';
import { advance } from '../../src/game/sim';
import { careAfterBath, useStarTonic } from '../../src/game/stars';
import { SCHEMA_VERSION, migrate, type GameState, type Pudding } from '../../src/game/state';
import { progressScore } from '../../src/game/storage';
import { addStock, stockOf, totalStock, type Star } from '../../src/game/stock';
import { START_ZONE, zoneKey } from '../../src/game/zones';
import { FLOOR, advanceUntil, fillBasinDirect, keepFed, makeWorld, only, runOneBath } from './helpers';
import { createRng } from '../../src/game/rng';

const sink = () => {};
const UPPER = zoneKey(0, 2);
const SPAWN = { puddingPos: { x: 0.2, z: 0.1 }, basinPos: { x: -0.5, z: 0.2 } };

function setMode(s: GameState, zone: string, mode: 'mass' | 'elite'): void {
  s.zones.find((z) => z.id === zone)!.mode = mode;
}

function clonePudding(s: GameState, zone: string, over: Partial<Pudding> = {}): Pudding {
  const src = s.puddings[0]!;
  const p: Pudding = { ...JSON.parse(JSON.stringify(src)), id: `p${s.nextId++}`, zone, basinIndex: null, mode: 'resting', ...over };
  s.puddings.push(p);
  return p;
}

describe('AC11-1 只有精養區長星（D62）', () => {
  it('量產區泡幾次本命液照顧點數都是 0', () => {
    const w = makeWorld({ puddings: 1 });
    for (let i = 0; i < 4; i++) expect(runOneBath(w, 'caramel')).toBe(true);
    expect(only(w.state).care).toBe(0);
    expect(only(w.state).star).toBe(1);
  });

  it('精養區：本命液每次 +3、非本命液 +1', () => {
    const w = makeWorld({ puddings: 1 });
    setMode(w.state, START_ZONE, 'elite');
    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(only(w.state).care).toBe(BALANCE.careNative);
    expect(runOneBath(w, 'matcha')).toBe(true);
    expect(only(w.state).care).toBe(BALANCE.careNative + BALANCE.careBath);
  });

  it('混種兩個等位基因的液體都算本命液（卡士達泡牛奶也 +3）', () => {
    const w = makeWorld({ puddings: 1 });
    setMode(w.state, START_ZONE, 'elite');
    applySpeciesAsPure(only(w.state), 'custard');
    expect(only(w.state).genes).toEqual(['caramel', 'panna']);
    const p = only(w.state);
    expect(careAfterBath(w.state, p, 'milk', sink)).toBe(BALANCE.careNative);
    expect(careAfterBath(w.state, p, 'caramel', sink)).toBe(BALANCE.careNative);
    expect(careAfterBath(w.state, p, 'strawberry', sink)).toBe(BALANCE.careBath);
  });

  it('點數滿了升一星、點數歸零；到潛力上限就不再累積', () => {
    const w = makeWorld({ puddings: 1 });
    setMode(w.state, START_ZONE, 'elite');
    const p = only(w.state);
    expect(p.potential).toBe(2);
    p.care = BALANCE.starCare[0]! - 1;
    const events: SimEvent[] = [];
    careAfterBath(w.state, p, 'caramel', (e) => events.push(e));
    expect(p.star).toBe(2);
    expect(p.care).toBe(0);
    expect(events.some((e) => e.type === 'starUp' && e.star === 2)).toBe(true);
    expect(w.state.stats.starUps).toBe(1);
    // 已經 ★2＝潛力上限：再泡也不長
    expect(careAfterBath(w.state, p, 'caramel', sink)).toBe(0);
    expect(p.care).toBe(0);
    expect(p.star).toBe(2);
  });

  it('精養區超收（切成精養時已經 6 隻）整區不長，降到 5 隻就恢復', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    for (let i = 0; i < 5; i++) clonePudding(s, START_ZONE);
    setMode(s, START_ZONE, 'elite');
    const p = s.puddings[0]!;
    expect(careAfterBath(s, p, 'caramel', sink)).toBe(0);
    s.puddings.pop();
    expect(careAfterBath(s, p, 'caramel', sink)).toBe(BALANCE.careNative);
  });
});

describe('AC11-2 精養區上限與寶寶送走（D62）', () => {
  function twoZones() {
    const w = makeWorld({ puddings: 1 });
    w.state.coins = 99999;
    w.state.xp = 99999;
    expect(unlockZone(w.state, UPPER, SPAWN, sink).ok).toBe(true);
    w.state.activeZone = START_ZONE;
    return w;
  }

  it('精養區 5 隻泡牛奶澡：寶寶生在別區，精養區仍 5 隻', () => {
    const w = twoZones();
    const s = w.state;
    for (let i = 0; i < 4; i++) clonePudding(s, START_ZONE);
    setMode(s, START_ZONE, 'elite');
    const mother = s.puddings[0]!;
    const child = breedFromBath(s, mother, { rng: w.rng, floor: FLOOR, emit: sink });
    expect(child).not.toBeNull();
    expect(child!.zone).toBe(UPPER);
    expect(s.puddings.filter((p) => p.zone === START_ZONE)).toHaveLength(5);
  });

  it('精養區沒住滿，母體自己那一區也不收寶寶', () => {
    const w = twoZones();
    const s = w.state;
    clonePudding(s, START_ZONE);
    setMode(s, START_ZONE, 'elite');
    const child = breedFromBath(s, s.puddings[0]!, { rng: w.rng, floor: FLOOR, emit: sink });
    expect(child!.zone).toBe(UPPER);
  });

  it('精養區有空位也不當落點（母體住量產區、量產區滿了）', () => {
    const w = twoZones();
    const s = w.state;
    setMode(s, UPPER, 'elite');
    for (let i = 0; i < BALANCE.zoneCapacity - 1; i++) clonePudding(s, START_ZONE);
    expect(s.puddings.filter((p) => p.zone === START_ZONE)).toHaveLength(BALANCE.zoneCapacity);
    const events: SimEvent[] = [];
    const mother = s.puddings.find((p) => p.zone === START_ZONE)!;
    fillBasinDirect(s, 'milk');
    mother.caramel = 5;
    const before = s.puddings.length;
    advanceUntil(w, (x) => x.state.stats.baths > 0, 400);
    for (const e of w.events) events.push(e);
    expect(s.puddings.length).toBe(before);
    const err = events.find((e) => e.type === 'error');
    expect(err && err.type === 'error' && err.message).toContain('精養區');
  });

  it('搬第 6 隻進精養區被拒，講得出原因', () => {
    const w = twoZones();
    const s = w.state;
    for (let i = 0; i < 4; i++) clonePudding(s, START_ZONE);
    setMode(s, START_ZONE, 'elite');
    const up = s.puddings.find((p) => p.zone === UPPER)!;
    const r = movePudding(s, up.id, START_ZONE, sink);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(`${BALANCE.eliteCapacity}`);
    // 降到 4 隻就搬得進去
    s.puddings.splice(s.puddings.findIndex((p) => p.zone === START_ZONE), 1);
    expect(movePudding(s, up.id, START_ZONE, sink).ok).toBe(true);
  });
});

describe('AC11-3 世代上限（D63）', () => {
  function motherWithStar(star: Star) {
    const w = makeWorld({ puddings: 1 });
    w.state.coins = 99999; w.state.xp = 99999;
    unlockZone(w.state, UPPER, SPAWN, sink);
    const m = w.state.puddings[0]!;
    m.star = star;
    m.potential = star;
    m.care = 7;
    return { w, m };
  }

  it('★3 母體 → 子代潛力 4、★1、點數 0', () => {
    const { w, m } = motherWithStar(3);
    const c = breedFromBath(w.state, m, { rng: w.rng, floor: FLOOR, emit: sink })!;
    expect([c.potential, c.star, c.care]).toEqual([4, 1, 0]);
  });

  it('★5 母體 → 子代潛力 5（上限）', () => {
    const { w, m } = motherWithStar(5);
    const c = breedFromBath(w.state, m, { rng: w.rng, floor: FLOOR, emit: sink })!;
    expect(c.potential).toBe(5);
  });

  it('開局的布丁潛力 2', () => {
    const w = makeWorld();
    for (const p of w.state.puddings) expect([p.star, p.care, p.potential]).toEqual([1, 0, 2]);
  });

  it('風味突變換物種但保留星級與潛力', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    p.star = 3; p.potential = 4; p.care = 12;
    p.pendingMutation = 'matcha';
    p.mode = 'hopping';
    p.hopT = 0.99;
    p.to = { ...p.pos };
    advance(w, 0.2);
    expect(p.species).toBe('matcha');
    expect([p.star, p.potential, p.care]).toEqual([3, 4, 12]);
  });
});

describe('AC11-4 原料帶星（D64）', () => {
  it('★3 布丁掉的原料帶 ★3，撿起來進 ★3 那一格', () => {
    const w = makeWorld({ puddings: 1, seed: 5 });
    keepFed(w);
    const p = only(w.state);
    p.star = 3; p.potential = 3;
    advanceUntil(w, (x) => x.state.drops.some((d) => d.kind === 'ingredient'), 2000);
    const d = w.state.drops.find((x) => x.kind === 'ingredient')!;
    expect(d.star).toBe(3);
    expect(pickDrop(w.state, d.id, sink).ok).toBe(true);
    expect(stockOf(w.state, 'ingredients', 'caramel', 3)).toBe(1);
    expect(stockOf(w.state, 'ingredients', 'caramel', 1)).toBe(0);
  });

  it('蛋沒有星級（一律 ★1），入庫記到 eggs', () => {
    const w = makeWorld({ puddings: 1, seed: 5 });
    keepFed(w);
    const p = only(w.state);
    p.star = 4; p.potential = 4;
    advanceUntil(w, (x) => x.state.drops.some((d) => d.kind === 'egg'), 3000);
    expect(w.state.drops.find((x) => x.kind === 'egg')!.star).toBe(1);
  });

  it('直接賣原料照星級倍率，只賣指定的那一星', () => {
    const w = makeWorld();
    addStock(w.state, 'ingredients', 'matcha', 1, 4);
    addStock(w.state, 'ingredients', 'matcha', 4, 2);
    const c0 = w.state.coins;
    expect(sellIngredient(w.state, 'matcha', 2, sink, 4).ok).toBe(true);
    expect(w.state.coins - c0).toBe(ingredientSellPrice('matcha', 4) * 2);
    expect(ingredientSellPrice('matcha', 4)).toBe(Math.round(16 * BALANCE.starMult[3]!));
    expect(stockOf(w.state, 'ingredients', 'matcha', 1)).toBe(4);
    expect(sellIngredient(w.state, 'matcha', 1, sink, 4).ok).toBe(false);
  });
});

describe('AC11-5 一盤一個星級（D64）', () => {
  function kitchen() {
    const w = makeWorld();
    const s = w.state;
    for (const id of ['crack', 'mix', 'mold', 'bake'] as const) s.bakery.machines[id] = 5;
    s.eggs = 50; s.pantry.flour = 50;
    addStock(s, 'ingredients', 'hojicha', 1, 5);
    addStock(s, 'ingredients', 'hojicha', 3, 2);
    return w;
  }

  it('只扣該星級的原料，出爐的甜點在同星級', () => {
    const w = kitchen();
    const s = w.state;
    expect(startBatch(s, 'hojicha', 2, sink, 3).ok).toBe(true);
    expect(stockOf(s, 'ingredients', 'hojicha', 3)).toBe(0);
    expect(stockOf(s, 'ingredients', 'hojicha', 1)).toBe(5);
    expect(s.bakery.stations.crack.batch?.star).toBe(3);
    s.bakery.machines.bake = 20; // 失敗率壓低，這裡測的是星級不是失敗
    advanceUntil(w, (x) => totalStock(x.state, 'desserts') + totalStock(x.state, 'shelf') > 0, 2000, 1);
    expect(stockOf(s, 'desserts', 'hojicha', 3) + stockOf(s, 'shelf', 'hojicha', 3)).toBeGreaterThan(0);
    expect(stockOf(s, 'desserts', 'hojicha', 1) + stockOf(s, 'shelf', 'hojicha', 1)).toBe(0);
  });

  it('那一星不夠就拒絕，state 完全不變（不從別的星級湊）', () => {
    const w = kitchen();
    const before = JSON.stringify(w.state);
    const r = startBatch(w.state, 'hojicha', 3, sink, 3);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(w.state)).toBe(before);
    expect(startBatch(w.state, 'hojicha', 1, sink, 2).ok).toBe(false);
    expect(JSON.stringify(w.state)).toBe(before);
  });
});

describe('AC11-6 星級價與散客上限（D65）', () => {
  it('★1–★5 售價比例＝starMult', () => {
    const base = dessertPrice('caramel', 1);
    for (const star of [2, 3, 4, 5] as Star[]) {
      expect(dessertPrice('caramel', star)).toBe(Math.round(base * BALANCE.starMult[star - 1]!));
    }
  });

  function shop(): GameState {
    const w = makeWorld({ seed: 3 });
    const s = w.state;
    s.bakery.nextCustomerAt = s.time;
    return s;
  }

  it('散客先拿最低星', () => {
    const s = shop();
    addStock(s, 'shelf', 'caramel', 4, 1);
    addStock(s, 'shelf', 'caramel', 1, 1);
    const ev: SimEvent[] = [];
    tickBakery(s, createRng(1), (e) => ev.push(e));
    const c = ev.find((e) => e.type === 'customer');
    expect(c && c.type === 'customer' && c.star).toBe(1);
    expect(stockOf(s, 'shelf', 'caramel', 1)).toBe(0);
  });

  it('散客買 ★4 只付 ★2 的價', () => {
    const s = shop();
    addStock(s, 'shelf', 'caramel', 4, 1);
    const c0 = s.coins;
    tickBakery(s, createRng(1), sink);
    expect(stockOf(s, 'shelf', 'caramel', 4)).toBe(0);
    expect(s.coins - c0).toBe(walkInPrice('caramel', 4));
    expect(walkInPrice('caramel', 4)).toBe(dessertPrice('caramel', 2));
    expect(walkInPrice('caramel', 4)).toBeLessThan(dessertPrice('caramel', 4));
  });
});

describe('升星藥（D67）', () => {
  it('只能給精養區的布丁用；已在潛力上限就連潛力 +1', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    const p = only(s);
    s.items.starTonic = 2;
    expect(useStarTonic(s, p.id, sink).ok).toBe(false);
    expect(s.items.starTonic).toBe(2);
    setMode(s, START_ZONE, 'elite');
    p.star = 2; p.potential = 2;
    expect(useStarTonic(s, p.id, sink).ok).toBe(true);
    expect([p.star, p.potential, s.items.starTonic]).toEqual([3, 3, 1]);
    p.potential = 5;
    expect(useStarTonic(s, p.id, sink).ok).toBe(true);
    expect([p.star, p.potential]).toEqual([4, 5]);
    expect(useStarTonic(s, p.id, sink).ok).toBe(false);
  });
});

describe('AC11-10 舊存檔 v10 → v11（D71，夾具是 v10 程式自己玩出來的）', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'v10-save.json'), 'utf8'));
  const code = readFileSync(join(__dirname, '..', 'fixtures', 'v10-save.code.txt'), 'utf8').trim();

  it('夾具真的是 v10', () => {
    expect(raw.schemaVersion).toBe(10);
    expect(typeof raw.ingredients.caramel).toBe('number');
  });

  for (const [label, load] of [
    ['migrate(JSON)', () => migrate(JSON.parse(JSON.stringify(raw)))],
    ['存檔碼 importCode', () => importCode(code)!],
  ] as const) {
    describe(label, () => {
      const s = load();
      it('版本升到 11；布丁數、金幣、等級、機器、人氣、設備不變', () => {
        expect(s.schemaVersion).toBe(SCHEMA_VERSION);
        expect(SCHEMA_VERSION).toBe(11);
        expect(s.puddings).toHaveLength(raw.puddings.length);
        expect(s.coins).toBe(raw.coins);
        expect(s.xp).toBe(raw.xp);
        expect(s.bakery.machines).toEqual(raw.bakery.machines);
        expect(s.bakery.fame).toBe(raw.bakery.fame);
        expect(s.equipment).toEqual(raw.equipment);
      });
      it('所有舊庫存在 ★1，一份不少', () => {
        for (const [id, n] of Object.entries(raw.ingredients as Record<string, number>)) {
          expect(s.ingredients[id as 'caramel']).toEqual([n, 0, 0, 0, 0]);
        }
        for (const [id, n] of Object.entries(raw.desserts as Record<string, number>)) {
          expect(s.desserts[id as 'caramel']).toEqual([n, 0, 0, 0, 0]);
        }
        for (const [id, n] of Object.entries(raw.bakery.shelf as Record<string, number>)) {
          expect(s.bakery.shelf[id as 'caramel']).toEqual([n, 0, 0, 0, 0]);
        }
        expect(totalStock(s, 'shelf')).toBeGreaterThan(0);
      });
      it('布丁全 ★1／潛力 ★2／點數 0；區全是量產；掉落物 ★1', () => {
        for (const p of s.puddings) expect([p.star, p.potential, p.care]).toEqual([1, 2, 0]);
        for (const z of s.zones) expect(z.mode).toBe('mass');
        expect(s.drops.length).toBe(raw.drops.length);
        expect(s.drops.length).toBeGreaterThan(0);
        for (const d of s.drops) expect(d.star).toBe(1);
      });
      it('在做的那一盤照原 doneAt、星級 1', () => {
        const [id, st] = Object.entries(raw.bakery.stations as Record<string, { batch: unknown; doneAt: number }>).find(([, v]) => v.batch)!;
        const now = s.bakery.stations[id as 'stove'];
        expect(now.batch?.star).toBe(1);
        expect(now.doneAt).toBe(st.doneAt);
      });
      it('progressScore 不變；名冊全部未解鎖、升星藥 0、訂單原樣', () => {
        expect(progressScore(s)).toBe(progressScore(raw as GameState));
        expect(Object.values(s.regulars).every((r) => !r.unlocked && r.hearts === 0)).toBe(true);
        expect(s.items.starTonic).toBe(0);
        expect(s.orders).toHaveLength(raw.orders.length);
        expect(s.orders.every((o) => o.regularId === undefined)).toBe(true);
      });
      it('撿起舊掉落物進 ★1', () => {
        const d = s.drops.find((x) => x.kind === 'ingredient')!;
        const before = stockOf(s, 'ingredients', d.species, 1);
        pickDrop(s, d.id, sink);
        expect(stockOf(s, 'ingredients', d.species, 1)).toBe(before + 1);
      });
    });
  }
});
