import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { startBatch, stockShelf, tickBakery } from '../../src/game/bakery';
import type { SimEvent } from '../../src/game/events';
import {
  DESSERT_IDS,
  RECIPES,
  SIGNATURE_IDS,
  STATION_IDS,
  dessertName,
  dessertPrice,
  recipeMaterials,
  recipeUnlocked,
  starsAffordable,
  type DessertId,
} from '../../src/game/recipes';
import { REGULAR_BALANCE, regularWants, signatureOf, tickRegulars } from '../../src/game/regulars';
import { SPECIES_IDS } from '../../src/game/species';
import { REGULAR_STORIES } from '../../src/game/regularStories';
import { createRng } from '../../src/game/rng';
import { advanceUntil, makeWorld } from './helpers';
import { migrate } from '../../src/game/state';
import { addStock, stockOf, totalStock, type Star } from '../../src/game/stock';

const sink = () => {};

/** 能做熊先生招牌（蜂蜜焦糖千層）的工坊：整條線 Lv20（失敗率趨近 0）、材料給足 */
function kitchen(hearts: number, star: Star = 4) {
  const w = makeWorld({ seed: 3 });
  const s = w.state;
  for (const id of STATION_IDS) s.bakery.machines[id] = 20;
  s.eggs = 100; s.stock.milk = 100; s.pantry.flour = 100;
  addStock(s, 'ingredients', 'caramel', star, 10);
  addStock(s, 'ingredients', 'custard', star, 10);
  s.regulars.bear.unlocked = true;
  s.regulars.bear.hearts = hearts;
  return w;
}

describe('招牌甜點（D68，WP11-7）', () => {
  it('八位常客各一道，名字跟故事定稿一致；路線是 STATION_IDS 的子序列；材料是兩種物種原料', () => {
    expect(SIGNATURE_IDS).toHaveLength(8);
    const owners = new Set(SIGNATURE_IDS.map((id) => RECIPES[id].owner));
    expect(owners.size).toBe(8);
    for (const id of SIGNATURE_IDS) {
      const r = RECIPES[id];
      expect(dessertName(id)).toBe(REGULAR_STORIES[r.owner!].signature);
      const idx = r.route.map((st) => STATION_IDS.indexOf(st));
      expect(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]!))).toBe(true);
      const species = recipeMaterials(id).filter(([k]) => !['egg', 'milk', 'flour', 'rice'].includes(k));
      expect(species).toHaveLength(2);
    }
    // 物種甜點的鍵沒變（舊存檔的 desserts／shelf／站上的盤子不必轉換）
    expect(DESSERT_IDS.slice(0, SPECIES_IDS.length)).toEqual(SPECIES_IDS);
  });

  it('♥10 之前菜單看不到、也開不了工；♥10 解鎖', () => {
    const w = kitchen(9);
    expect(recipeUnlocked(w.state, 'sig_bear')).toBe(false);
    const before = JSON.stringify(w.state);
    expect(startBatch(w.state, 'sig_bear', 1, sink, 4).ok).toBe(false);
    expect(JSON.stringify(w.state)).toBe(before);
    w.state.regulars.bear.hearts = 10;
    expect(recipeUnlocked(w.state, 'sig_bear')).toBe(true);
    expect(recipeUnlocked(w.state, 'sig_rabbit')).toBe(false);
    expect(signatureOf(w.state, 'bear')).toBe('sig_bear');
  });

  it('要 ★4 以上的原料：★3 的材料開不了工、星級分頁只亮 ★4／★5', () => {
    const w3 = kitchen(10, 3);
    expect(starsAffordable(w3.state, 'sig_bear')).toEqual([]);
    expect(startBatch(w3.state, 'sig_bear', 1, sink, 3).ok).toBe(false);
    const w4 = kitchen(10, 4);
    expect(starsAffordable(w4.state, 'sig_bear')).toEqual([4]);
    expect(startBatch(w4.state, 'sig_bear', 2, sink, 4).ok).toBe(true);
    expect(stockOf(w4.state, 'ingredients', 'caramel', 4)).toBe(8);
    expect(stockOf(w4.state, 'ingredients', 'custard', 4)).toBe(8);
    advanceUntil(w4, (x) => stockOf(x.state, 'desserts', 'sig_bear') > 0, 3000, 1);
    expect(stockOf(w4.state, 'desserts', 'sig_bear', 4)).toBeGreaterThan(0);
  });

  it('售價是同材料一般甜點的 3 倍（再乘星級倍率）', () => {
    const materials = recipeMaterials('sig_bear').reduce((n, [k, q]) => {
      const p = k === 'egg' ? BALANCE.eggPrice : k === 'milk' ? 2 : k === 'caramel' ? 6 : k === 'custard' ? 13 : 0;
      return n + p * q;
    }, 0);
    expect(dessertPrice('sig_bear', 4)).toBe(Math.round(materials * BALANCE.dessertMarkup * BALANCE.starMult[3]! * 3));
  });

  it('散客不買招牌甜點：架上只剩招牌甜點＝散客撲空', () => {
    const w = kitchen(10);
    addStock(w.state, 'shelf', 'sig_bear', 4, 3);
    w.state.bakery.nextCustomerAt = w.state.time;
    const ev: SimEvent[] = [];
    tickBakery(w.state, createRng(1), (e) => ev.push(e));
    expect(ev.some((e) => e.type === 'customerMissed')).toBe(true);
    expect(stockOf(w.state, 'shelf', 'sig_bear', 4)).toBe(3);
  });

  it('上架「先上低星」的輪替不會把招牌甜點擺出去；今天要來的主人會被替他留一份', () => {
    const w = kitchen(10);
    const s = w.state;
    addStock(s, 'desserts', 'sig_bear', 4, 2);
    expect(stockShelf(s, sink)).toBe(0);
    s.regulars.bear.nextVisitAt = s.time + 60; // 今天稍後
    expect(stockShelf(s, sink, true, regularWants(s))).toBe(1);
    expect(stockOf(s, 'shelf', 'sig_bear', 4)).toBe(1);
  });

  it('主人來店：架上有自己的招牌就先買它（付招牌價 ×小費）', () => {
    const w = kitchen(10);
    const s = w.state;
    addStock(s, 'shelf', 'caramel', 4, 2);
    addStock(s, 'shelf', 'sig_bear', 4, 1);
    s.time = 100;
    s.regulars.bear.nextVisitAt = 50;
    const c0 = s.coins;
    tickRegulars(s, w.rng, sink);
    expect(s.regulars.bear.lastResult).toMatchObject({ bought: true, dessert: 'sig_bear', star: 4 });
    expect(s.coins - c0).toBe(Math.round(dessertPrice('sig_bear', 4) * REGULAR_BALANCE.tip));
    expect(stockOf(s, 'shelf', 'caramel', 4)).toBe(2);
  });

  it('存檔：招牌甜點的庫存存得回來；沒有這幾格的舊存檔補 0', () => {
    const w = kitchen(10);
    addStock(w.state, 'desserts', 'sig_bear', 5, 2);
    const back = migrate(JSON.parse(JSON.stringify(w.state)));
    expect(stockOf(back, 'desserts', 'sig_bear', 5)).toBe(2);
    const raw = JSON.parse(JSON.stringify(w.state));
    for (const id of SIGNATURE_IDS) delete raw.desserts[id];
    const old = migrate(raw);
    for (const id of SIGNATURE_IDS as DessertId[]) expect(stockOf(old, 'desserts', id)).toBe(0);
    expect(totalStock(old, 'desserts')).toBe(0);
  });
});
