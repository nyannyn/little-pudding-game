import { describe, expect, it } from 'vitest';
import { STATION_IDS, startBatch } from '../../src/game/bakery';
import { BALANCE } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import { RECIPES } from '../../src/game/recipes';
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

describe('全自動生產線：不碰一下也會出貨到成品櫃', () => {
  it('農場三台設備全裝＋工坊放一盤上線（D57 起線上自己走），跑 10 分鐘後那一盤走完、地上沒有掉落物', () => {
    const w = makeWorld({ seed: 2026 });
    const eq = w.state.equipment[w.state.activeZone]!;
    for (const k of Object.keys(eq)) eq[k as keyof typeof eq] = true;
    for (const id of RECIPES.caramel.route) w.state.bakery.machines[id] = 1;
    w.state.coins = 200;
    w.state.stock.caramel = 10;
    Object.assign(w.state, { eggs: 2 });
    w.state.ingredients.caramel = 1;
    w.state.stock.milk = 1;
    fillBasinDirect(w.state, 'caramel');
    const events: SimEvent[] = [];
    expect(startBatch(w.state, 'caramel', 1, (e: SimEvent) => events.push(e)).ok).toBe(true);
    const emit = w.emit;
    w.emit = (e) => { events.push(e); emit(e); };

    advance(w, 600);
    for (const id of STATION_IDS) expect(w.state.bakery.stations[id].batch).toBeNull();
    expect(events.some((e) => e.type === 'bakeDone' || e.type === 'bakeFailed')).toBe(true);
    expect(w.state.drops.length).toBe(0);
    expect(w.state.stats.baths).toBeGreaterThan(0);
  });
});
