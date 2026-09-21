import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { advance } from '../../src/game/sim';
import { advanceUntil, fillBasinDirect, makeWorld, only, runOneBath } from './helpers';

describe('AC2-1 缺焦糖會去泡澡', () => {
  it('澡盆有焦糖時，下一次跳躍目標是澡盆並落盆進入 bathing', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    fillBasinDirect(w.state, 'caramel');
    p.caramel = 25;

    const t = advanceUntil(w, (x) => only(x.state).mode === 'bathing', 60);
    expect(t).toBeGreaterThanOrEqual(0);

    const basin = w.state.basins[0]!;
    expect(p.to.x).toBeCloseTo(basin.pos.x, 6);
    expect(p.to.z).toBeCloseTo(basin.pos.z, 6);
    expect(p.mode).toBe('bathing');
    expect(basin.occupantId).toBe(p.id);
  });

  it('負向對照：澡盆是空的，跳躍目標不可以是澡盆', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    p.caramel = 25;
    const basin = w.state.basins[0]!;

    for (let i = 0; i < 200; i++) {
      advance(w, 0.25);
      expect(p.mode).not.toBe('bathing');
      const onBasin = Math.abs(p.to.x - basin.pos.x) < 1e-6 && Math.abs(p.to.z - basin.pos.z) < 1e-6;
      expect(onBasin).toBe(false);
    }
  });

  it('澡盆一次只容一隻，第二隻不會同時跳進去', () => {
    const w = makeWorld();
    fillBasinDirect(w.state, 'caramel');
    for (const p of w.state.puddings) p.caramel = 10;
    for (let i = 0; i < 400; i++) {
      advance(w, 0.25);
      expect(w.state.puddings.filter((p) => p.mode === 'bathing').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('AC2-2 泡澡產原料並消耗液體', () => {
  it('焦糖澡：掉一份原料、澡盆少一份、caramel 回滿', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    fillBasinDirect(w.state, 'caramel', 3);

    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(w.state.basins[0]!.units).toBe(2);
    expect(p.caramel).toBe(100);
    expect(w.state.drops.length).toBe(1);
    expect(w.state.drops[0]!.species).toBe('caramel');
    expect(w.state.ingredients.caramel).toBe(0); // 沒有收集手就是掉在地上
  });

  it('牛奶澡：caramel 只回到 60', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    expect(runOneBath(w, 'milk')).toBe(true);
    expect(p.caramel).toBeLessThanOrEqual(60);
    expect(p.caramel).toBeGreaterThan(55);
  });

  it('泡澡時間就是 balance 設定的長度', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    fillBasinDirect(w.state, 'caramel');
    p.caramel = 5;
    expect(advanceUntil(w, (x) => only(x.state).mode === 'bathing', 60)).toBeGreaterThanOrEqual(0);

    advance(w, BALANCE.bathDurationSec - 1);
    expect(p.mode).toBe('bathing');
    advance(w, 1.2);
    expect(p.mode).not.toBe('bathing');
  });
});

describe('AC2-3 極端牛奶突變', () => {
  it('連續 5 次牛奶澡後 tint 達 1，下一次落地變成鮮奶酪', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    for (let i = 0; i < 5; i++) expect(runOneBath(w, 'milk')).toBe(true);

    expect(p.tint).toBe(1);
    expect(p.pendingMutation).toBe('panna');

    expect(advanceUntil(w, (x) => only(x.state).species === 'panna', 60)).toBeGreaterThanOrEqual(0);
    expect(p.species).toBe('panna');
    expect(p.tint).toBe(0);
    expect(p.bathHistory).toEqual([]);
    expect(w.state.stats.mutations).toBe(1);
  });

  it('負向對照：5 次中夾 1 次焦糖，牛奶占比不足，不得突變', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    const order = ['milk', 'milk', 'caramel', 'milk', 'milk'] as const;
    for (const l of order) expect(runOneBath(w, l)).toBe(true);

    expect(p.tint).toBeLessThan(1);
    expect(p.pendingMutation).toBeNull();
    advance(w, 60);
    expect(p.species).toBe('caramel');
    expect(w.state.stats.mutations).toBe(0);
  });

  it('突變後的鮮奶酪產出自己的原料（物種決定原料，D19）', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    for (let i = 0; i < 5; i++) runOneBath(w, 'milk');
    advanceUntil(w, (x) => only(x.state).species === 'panna', 60);
    w.state.drops = [];

    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(w.state.drops.some((d) => d.species === 'panna')).toBe(true);
    expect(p.species).toBe('panna');
  });
});

describe('AC2-4 風味突變（48 小時曝露）', () => {
  function matchaWorld() {
    const w = makeWorld({ puddings: 1 });
    w.state.ownedBasins.push('matcha');
    fillBasinDirect(w.state, 'matcha', 3);
    return w;
  }

  it('累積 47 小時不變', () => {
    const w = matchaWorld();
    const p = only(w.state);
    p.flavorExposure.matcha = BALANCE.flavorThresholdSec - BALANCE.flavorExposurePerBath - 3600;
    expect(runOneBath(w, 'matcha')).toBe(true);

    expect(p.flavorExposure.matcha).toBe(BALANCE.flavorThresholdSec - 3600);
    expect(p.pendingMutation).toBeNull();
    advance(w, 60);
    expect(p.species).toBe('caramel');
  });

  it('累積 48 小時就突變成抹茶布丁', () => {
    const w = matchaWorld();
    const p = only(w.state);
    p.flavorExposure.matcha = BALANCE.flavorThresholdSec - BALANCE.flavorExposurePerBath;
    expect(runOneBath(w, 'matcha')).toBe(true);

    expect(p.flavorExposure.matcha).toBe(BALANCE.flavorThresholdSec);
    expect(p.pendingMutation).toBe('matcha');
    expect(advanceUntil(w, (x) => only(x.state).species === 'matcha', 60)).toBeGreaterThanOrEqual(0);
  });
});

describe('AC2-9 掉落上限', () => {
  it('地上已經 5 份時再泡完一次也不會變 6 份', () => {
    const w = makeWorld({ puddings: 1 });
    for (let i = 0; i < BALANCE.dropCap; i++) {
      fillBasinDirect(w.state, 'caramel');
      expect(runOneBath(w, 'caramel')).toBe(true);
    }
    expect(w.state.drops.length).toBe(BALANCE.dropCap);

    fillBasinDirect(w.state, 'caramel');
    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(w.state.drops.length).toBe(BALANCE.dropCap);
  });
});
