import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { advance } from '../../src/game/sim';
import { LIQUIDS } from '../../src/game/species';
import { createNewSave } from '../../src/game/state';
import { fillBasinDirect, makeWorld, only } from './helpers';

describe('AC2-8 手動 vs 自動化', () => {
  /** 同一種子跑同樣長度，只有「有沒有裝收集手」不同 */
  function run(collector: boolean, sec: number) {
    const w = makeWorld({ seed: 99, puddings: 1 });
    w.state.equipment[w.state.activeZone]!.collector = collector;
    fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity);
    only(w.state).caramel = 5;
    advance(w, sec);
    return w.state;
  }

  it('沒有收集手：原料堆在地上、庫存不增加', () => {
    const s = run(false, 120);
    expect(s.drops.length).toBeGreaterThan(0);
    expect(s.ingredients.caramel).toBe(0);
  });

  it('裝了收集手：地上恆空、庫存增加', () => {
    const s = run(true, 120);
    expect(s.drops.length).toBe(0);
    expect(s.ingredients.caramel).toBeGreaterThan(0);
  });

  it('兩組的泡澡次數一樣——差別只在原料去了哪裡', () => {
    expect(run(false, 120).stats.baths).toBe(run(true, 120).stats.baths);
  });
});

describe('自動注液閥', () => {
  it('澡盆見底就從庫存補滿，而且只補上次倒的那一種', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.equipment[w.state.activeZone]!.autoFill = true;
    w.state.stock.caramel = 5;
    w.state.stock.milk = 5;
    fillBasinDirect(w.state, 'caramel', 1);
    only(w.state).caramel = 5;

    advance(w, 120);
    const b = w.state.basins[0]!;
    expect(b.units).toBeGreaterThan(0);
    expect(b.preferredLiquid).toBe('caramel');
    expect(w.state.stock.milk).toBe(5); // 沒有偷拿牛奶去補
    expect(w.state.stock.caramel).toBeLessThan(5);
  });

  it('沒裝閥門時澡盆會真的見底', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.stock.caramel = 5;
    fillBasinDirect(w.state, 'caramel', 1);
    only(w.state).caramel = 5;
    advance(w, 120);
    expect(w.state.basins[0]!.units).toBe(0);
    expect(w.state.stock.caramel).toBe(5);
  });
});

describe('加工機與販售口', () => {
  it('加工機把原料變甜點，販售口把甜點變錢', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.ingredients.caramel = 2 * BALANCE.ingredientsPerDessert;
    w.state.eggs = 2 * BALANCE.eggsPerDessert;
    w.state.equipment[w.state.activeZone]!.crafter = true;
    advance(w, 1);
    expect(w.state.ingredients.caramel).toBe(0);
    expect(w.state.eggs).toBe(0);
    expect(w.state.desserts.caramel).toBe(2);

    const coins = w.state.coins;
    w.state.equipment[w.state.activeZone]!.seller = true;
    advance(w, 1);
    expect(w.state.desserts.caramel).toBe(0);
    expect(w.state.coins).toBeGreaterThan(coins);
  });

  it('販售口會先留住訂單卡要的甜點，不會賤賣掉', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.equipment[w.state.activeZone]!.seller = true;
    w.state.orders.push({
      id: 'o-test', species: 'matcha', qty: 2, price: 500,
      createdAt: w.state.time, expiresAt: w.state.time + 999,
    });
    w.state.desserts.matcha = 1;
    advance(w, 1);
    expect(w.state.desserts.matcha).toBe(1); // 還湊不齊，先留著

    w.state.desserts.matcha = 2;
    const coins = w.state.coins;
    advance(w, 1);
    expect(w.state.coins).toBe(coins + 500);
    expect(w.state.orders.length).toBe(0);
  });
});

describe('補貨合約', () => {
  it('庫存見底就自動補到目標值，錢不夠就少買一點但不會透支', () => {
    const s = createNewSave({ seed: 5, now: 0 });
    const w = makeWorld({ puddings: 1 });
    w.state.equipment[w.state.activeZone]!.restock = true;
    w.state.stock.caramel = 0;
    w.state.stock.milk = 0;
    w.state.coins = LIQUIDS.caramel.unitPrice * 2; // 只買得起 2 份
    advance(w, 1);
    expect(w.state.coins).toBeGreaterThanOrEqual(0);
    expect(w.state.stock.caramel + w.state.stock.milk).toBe(2);
    expect(s.stock.caramel).toBe(BALANCE.startStock.caramel); // 開新檔沒被影響
  });

  it('錢夠就補到 restockTarget', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.equipment[w.state.activeZone]!.restock = true;
    w.state.stock.caramel = 0;
    w.state.coins = 1000;
    advance(w, 1);
    expect(w.state.stock.caramel).toBe(BALANCE.restockTarget);
  });
});

describe('全自動生產線：不碰一下也會賺錢', () => {
  it('五台設備全裝，跑 10 分鐘後金幣淨增加', () => {
    const w = makeWorld({ seed: 2026 });
    const eq = w.state.equipment[w.state.activeZone]!;
    for (const k of Object.keys(eq)) eq[k as keyof typeof eq] = true;
    w.state.coins = 200;
    w.state.stock.caramel = 10;
    fillBasinDirect(w.state, 'caramel');
    const before = w.state.coins;

    advance(w, 600);
    expect(w.state.coins).toBeGreaterThan(before);
    expect(w.state.drops.length).toBe(0);
    expect(w.state.stats.baths).toBeGreaterThan(0);
  });
});
