import { describe, expect, it } from 'vitest';
import { BALANCE, EQUIPMENT } from '../../src/game/balance';
import { fillBasin } from '../../src/game/actions';
import { advance, createWorld } from '../../src/game/sim';
import { createNewSave } from '../../src/game/state';
import { START_ZONE } from '../../src/game/zones';
import { nextHint } from '../../src/ui/hints';

function fresh() {
  return createNewSave({ seed: 1, now: 0 });
}

describe('新手引導完全從 state 推導', () => {
  it('開局叫玩家倒焦糖', () => {
    expect(nextHint(fresh())?.id).toBe('pour');
  });

  it('沒庫存時改叫去補貨，而不是叫他倒一個倒不出來的東西', () => {
    const s = fresh();
    s.stock.caramel = 0;
    expect(nextHint(s)?.id).toBe('restock');
  });

  it('真實流程：手動倒一份、布丁跳進去把盆用空，仍要說「泡澡中」再說「去撿」（不能退回「倒焦糖」）', () => {
    const s = fresh();
    const w = createWorld(s, { minX: -0.9, maxX: 0.9, minZ: -0.55, maxZ: 0.55 });
    expect(fillBasin(s, 0, 'caramel', w.emit).ok).toBe(true);
    for (let i = 0; i < 120 && !s.puddings.some((p) => p.mode === 'bathing'); i++) advance(w, 0.5);
    expect(s.puddings.some((p) => p.mode === 'bathing')).toBe(true);
    expect(s.basins[0]!.units).toBe(0); // 手動只倒一份，進盆就被用掉
    expect(nextHint(s)?.id).toBe('bathing');

    for (let i = 0; i < 200 && s.drops.length === 0; i++) advance(w, 0.5);
    expect(s.drops.length).toBeGreaterThan(0);
    expect(nextHint(s)?.id).toBe('pick');
  });

  it('生產線停擺（液體全空、盆空、有布丁想泡澡）要警告，買了設備之後也要', () => {
    const s = fresh();
    s.equipment.collector = true;
    s.equipment.autoFill = true;
    s.stock.caramel = 0;
    s.stock.milk = 0;
    s.puddings[0]!.caramel = 5;
    s.basins[0]!.preferredLiquid = 'caramel'; // 裝了注液閥的玩家一定倒過
    const h = nextHint(s);
    expect(h?.id).toBe('stalled');
    expect(h?.warning).toBe(true);

    // 有注液閥時只看它會補的那一種：庫存有牛乳也沒用，閥不會自己換口味
    s.stock.milk = 1;
    expect(nextHint(s)?.id).toBe('stalled');
    expect(nextHint(s)?.text).toContain('熱焦糖');
    // 沒有注液閥＝玩家自己倒，還有牛乳可以倒就不算停擺
    s.equipment.autoFill = false;
    expect(nextHint(s)?.id).not.toBe('stalled');
    s.stock.milk = 0;
    expect(nextHint(s)?.id).toBe('stalled');
    s.equipment.restock = true; // 補貨合約會自己補，不用講
    expect(nextHint(s)).toBeNull();
  });

  it('倒了之後換成「泡澡中」／「去撿」', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.puddings[0]!.mode = 'bathing';
    expect(nextHint(s)?.id).toBe('bathing');

    s.puddings[0]!.mode = 'resting';
    s.drops.push({ id: 'd1', zone: START_ZONE, kind: 'ingredient' as const, species: 'caramel', pos: { x: 0, z: 0 }, bornAt: 0 });
    expect(nextHint(s)?.id).toBe('pick');
  });

  it('原料夠就叫他加工，做過一次之後不再重複講', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.ingredients.caramel = BALANCE.ingredientsPerDessert;
    expect(nextHint(s)?.id).toBe('craft');

    s.stats.crafted = 1;
    expect(nextHint(s)?.id).not.toBe('craft');
  });

  it('有甜點就叫他出貨', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.desserts.caramel = 1;
    expect(nextHint(s)?.id).toBe('ship');
  });

  it('錢夠了就指向第一台設備', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.coins = EQUIPMENT.collector.price;
    expect(nextHint(s)?.id).toBe('buy');
  });

  it('買下任何一台設備之後就完全不再出現', () => {
    const s = fresh();
    s.equipment.collector = true;
    expect(nextHint(s)).toBeNull();
    s.stock.caramel = 0;
    expect(nextHint(s)).toBeNull();
  });

  it('只看「玩家正在看的那一區」——別的區有液體不算', () => {
    const s = fresh();
    s.basins.push({ zone: 'c0t2', liquid: 'caramel', units: 3, preferredLiquid: 'caramel', pos: { x: 0, z: 0 }, occupantId: null });
    expect(nextHint(s)?.id).toBe('pour'); // 啟用區的盆還是空的
    s.activeZone = 'c0t2';
    expect(nextHint(s)?.id).not.toBe('pour');
  });
});
