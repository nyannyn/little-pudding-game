import { describe, expect, it } from 'vitest';
import {
  buyEquipment,
  buySpecialBasin,
  buyStock,
  fillBasin,
  pickDrop,
  sellIngredient,
} from '../../src/game/actions';
import { fulfillOrder } from '../../src/game/bakery';
import { BALANCE, EQUIPMENT } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import { generateOrder } from '../../src/game/orders';
import { createRng } from '../../src/game/rng';
import { advance } from '../../src/game/sim';
import { SPECIES, dessertPrice } from '../../src/game/species';
import { createNewSave } from '../../src/game/state';
import { START_ZONE } from '../../src/game/zones';
import { advanceUntil, fillBasinDirect, makeWorld, only, runOneBath, keepFed } from './helpers';

const sink = (_e: SimEvent) => {};

describe('AC2-7 金幣與庫存不會變成負的', () => {
  it('錢不夠買設備時 state 完全不動', () => {
    const s = createNewSave({ seed: 7, now: 0 });
    s.coins = 10;
    s.xp = 99999; // 等級夠、只差錢（等級不夠的情況在 level.test.ts）
    const before = JSON.stringify(s);
    const r = buyEquipment(s, 'restock', sink);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('焦糖幣');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('錢不夠買補貨時 state 完全不動', () => {
    const s = createNewSave({ seed: 7, now: 0 });
    s.coins = 1;
    const before = JSON.stringify(s);
    expect(buyStock(s, 'caramel', 5, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('庫存不夠時倒不進澡盆，且庫存不會變負', () => {
    const s = createNewSave({ seed: 7, now: 0 });
    s.stock.caramel = 0;
    const r = fillBasin(s, 0, 'caramel', sink);
    expect(r.ok).toBe(false);
    expect(s.stock.caramel).toBe(0);
    expect(s.basins[0]!.units).toBe(0);
  });

  it('沒買澡盆就不能倒特殊液體、也不能買特殊液體', () => {
    const s = createNewSave({ seed: 7, now: 0 });
    s.coins = 9999;
    s.stock.matcha = 3;
    expect(fillBasin(s, 0, 'matcha', sink).ok).toBe(false);
    expect(buyStock(s, 'matcha', 1, sink).ok).toBe(false);
    expect(s.stock.matcha).toBe(3);
  });
});

describe('經濟：撿、賣', () => {
  it('撿起來就入庫，賣掉就加錢', () => {
    const w = makeWorld({ puddings: 1 });
    keepFed(w);
    // D32：原料是固定間隔自然掉的，不是泡澡產的
    expect(advanceUntil(w, (x) => x.state.drops.length > 0, BALANCE.dropIntervalSec * 3)).toBeGreaterThanOrEqual(0);
    const drop = w.state.drops.find((d) => d.kind === 'ingredient')
      ?? (advanceUntil(w, (x) => x.state.drops.some((d) => d.kind === 'ingredient'), BALANCE.dropIntervalSec * 12) >= 0
        ? w.state.drops.find((d) => d.kind === 'ingredient')!
        : undefined);
    expect(drop).toBeDefined();

    expect(pickDrop(w.state, drop!.id, sink).ok).toBe(true);
    expect(w.state.ingredients.caramel).toBe(1);

    const coins = w.state.coins;
    expect(sellIngredient(w.state, 'caramel', 1, sink).ok).toBe(true);
    expect(w.state.coins).toBe(coins + SPECIES.caramel.ingredientPrice);
  });

  it('同一份掉落物不能撿兩次', () => {
    const w = makeWorld({ puddings: 1 });
    keepFed(w);
    expect(advanceUntil(w, (x) => x.state.drops.length > 0, BALANCE.dropIntervalSec * 3)).toBeGreaterThanOrEqual(0);
    const d = w.state.drops[0]!;
    const before = d.kind === 'egg' ? w.state.eggs : w.state.ingredients[d.species];

    expect(pickDrop(w.state, d.id, sink).ok).toBe(true);
    expect(pickDrop(w.state, d.id, sink).ok).toBe(false);

    const after = d.kind === 'egg' ? w.state.eggs : w.state.ingredients[d.species];
    expect(after).toBe(before + 1);
  });

  it('蛋撿起來記到 eggs，物種原料記到 ingredients（D33）', () => {
    const w = makeWorld({ puddings: 1 });
    keepFed(w);
    advanceUntil(w, (x) => x.state.drops.some((d) => d.kind === 'egg'), BALANCE.dropIntervalSec * 15);
    const egg = w.state.drops.find((d) => d.kind === 'egg');
    expect(egg).toBeDefined();
    const eggsBefore = w.state.eggs;
    expect(pickDrop(w.state, egg!.id, sink).ok).toBe(true);
    expect(w.state.eggs).toBe(eggsBefore + 1);
  });

  it('買特殊澡盆後盆子數量增加、可以倒抹茶', () => {
    const s = createNewSave({ seed: 7, now: 0 });
    s.coins = BALANCE.specialBasinPrice + 100;
    s.xp = 99999;
    expect(buySpecialBasin(s, 'matcha', { x: -0.6, z: 0.2 }, START_ZONE, sink).ok).toBe(true);
    expect(s.basins.length).toBe(2);
    expect(buySpecialBasin(s, 'matcha', { x: -0.6, z: 0.2 }, START_ZONE, sink).ok).toBe(false);

    expect(buyStock(s, 'matcha', 2, sink).ok).toBe(true);
    expect(fillBasin(s, 1, 'matcha', sink).ok).toBe(true);
    expect(s.basins[1]!.units).toBe(1);
  });

  it('澡盆裡有焦糖時不能改倒牛奶', () => {
    const s = createNewSave({ seed: 7, now: 0 });
    expect(fillBasin(s, 0, 'caramel', sink).ok).toBe(true);
    const r = fillBasin(s, 0, 'milk', sink);
    expect(r.ok).toBe(false);
    expect(s.basins[0]!.liquid).toBe('caramel');
  });
});

describe('AC2-10 訂單卡', () => {
  it('時間到會生成訂單卡，有貨就能成交', () => {
    const w = makeWorld({ puddings: 1 });
    expect(advanceUntil(w, (x) => x.state.orders.length > 0, BALANCE.orderIntervalMax + 60, 1)).toBeGreaterThanOrEqual(0);
    const o = w.state.orders[0]!;
    expect(o.qty).toBeGreaterThanOrEqual(1);
    expect(o.qty).toBeLessThanOrEqual(3);

    const unit = dessertPrice(o.species);
    expect(o.price).toBeGreaterThanOrEqual(Math.round(unit * o.qty * BALANCE.orderPriceMultMin) - 1);
    expect(o.price).toBeLessThanOrEqual(Math.round(unit * o.qty * BALANCE.orderPriceMultMax) + 1);

    w.state.desserts[o.species] = o.qty;
    const coins = w.state.coins;
    expect(fulfillOrder(w.state, o.id, sink).ok).toBe(true);
    expect(w.state.coins).toBe(coins + o.price);
    expect(w.state.orders.find((x) => x.id === o.id)).toBeUndefined();
  });

  it('沒有對應物種的甜點就只能看它過期', () => {
    const w = makeWorld({ puddings: 1 });
    advanceUntil(w, (x) => x.state.orders.length > 0, BALANCE.orderIntervalMax + 60, 1);
    const o = w.state.orders[0]!;
    expect(fulfillOrder(w.state, o.id, sink).ok).toBe(false);

    advance(w, BALANCE.orderTtlSec + 2);
    expect(w.state.orders.find((x) => x.id === o.id)).toBeUndefined();
  });

  it('過期的訂單不能事後補交', () => {
    const w = makeWorld({ puddings: 1 });
    advanceUntil(w, (x) => x.state.orders.length > 0, BALANCE.orderIntervalMax + 60, 1);
    const o = w.state.orders[0]!;
    w.state.desserts[o.species] = o.qty;
    o.expiresAt = w.state.time - 1;
    expect(fulfillOrder(w.state, o.id, sink).ok).toBe(false);
  });

  it('D25：只養焦糖時，訂單絕大多數是焦糖，但仍偶爾出別種當引子', () => {
    const w = makeWorld({ puddings: 1 });
    const rng = createRng(3);
    const counts: Record<string, number> = {};
    const N = 400;
    for (let i = 0; i < N; i++) {
      const o = generateOrder(w.state, rng);
      counts[o.species] = (counts[o.species] ?? 0) + 1;
    }
    // 期望值 0.8 + 0.2/4 = 0.85；四種均抽會是 0.25（負向對照：把 ORDER_OWNED_SPECIES_RATIO 改 0 就紅）
    expect((counts.caramel ?? 0) / N).toBeGreaterThan(0.75);
    expect(Object.keys(counts).length).toBeGreaterThan(1);
  });

  it('桌上訂單不會超過上限', () => {
    const w = makeWorld({ puddings: 1 });
    advance(w, BALANCE.orderIntervalMax * 10);
    expect(w.state.orders.length).toBeLessThanOrEqual(BALANCE.orderMaxActive);
  });
});

describe('設備定價維持「幾次泡澡的收入」的級距', () => {
  it('T1 < T2 < T3', () => {
    expect(EQUIPMENT.collector.price).toBeLessThan(EQUIPMENT.restock.price);
    expect(EQUIPMENT.autoFill.price).toBeLessThan(EQUIPMENT.restock.price);
  });
});
