import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { advance } from '../../src/game/sim';
import { advanceUntil, fillBasinDirect, keepFed, makeWorld, only, runOneBath } from './helpers';

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

describe('AC2-2 泡澡消耗液體、補焦糖（D32 之後不再產原料）', () => {
  it('焦糖澡：澡盆少一份、caramel 回滿；原料不是泡澡產的', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    fillBasinDirect(w.state, 'caramel', 3);
    // 把掉落計時器推遠，確保這段時間內掉的東西不會混進斷言
    p.nextDropAt = 99999;

    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(w.state.basins[0]!.units).toBe(2);
    expect(p.caramel).toBe(100);
    expect(w.state.drops.length).toBe(0); // D32：泡澡不產原料了
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

describe('AC2-3 牛奶澡就是繁殖（D34）', () => {
  it('泡完一次牛奶澡就多一隻布丁', () => {
    const w = makeWorld({ puddings: 1 });
    expect(w.state.puddings).toHaveLength(1);

    expect(runOneBath(w, 'milk')).toBe(true);

    expect(w.state.puddings).toHaveLength(2);
    expect(w.state.stats.births).toBe(1);
    expect(w.events.some((e) => e.type === 'birth')).toBe(true);
  });

  it('沒有成年或冷卻限制：剛出生的小布丁泡完牛奶澡照樣生', () => {
    const w = makeWorld({ puddings: 1 });
    runOneBath(w, 'milk');
    const child = w.state.puddings[1]!;
    expect(child.bornAt).toBeGreaterThan(0);

    // 只留新生兒，讓牠自己去泡
    w.state.puddings = [child];
    expect(runOneBath(w, 'milk')).toBe(true);
    expect(w.state.puddings.length).toBe(2);
  });

  it('負向對照：泡焦糖澡不會生', () => {
    const w = makeWorld({ puddings: 1 });
    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(w.state.puddings).toHaveLength(1);
    expect(w.state.stats.births).toBe(0);
  });

  it('全場住滿時泡牛奶澡不生，並且會講出來（不能靜靜沒反應）', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    // 把起始區塞到上限
    while (w.state.puddings.filter((x) => x.zone === p.zone).length < BALANCE.zoneCapacity) {
      w.state.puddings.push({ ...p, id: `filler${w.state.puddings.length}` });
    }
    const n = w.state.puddings.length;

    expect(runOneBath(w, 'milk')).toBe(true);

    expect(w.state.puddings).toHaveLength(n);
    expect(w.events.some((e) => e.type === 'error' && e.message.includes('住滿'))).toBe(true);
  });
});

describe('D35 焦糖見底就停止生產（「保持愉快才生產」的最小判定）', () => {
  it('焦糖歸零就不再掉東西', () => {
    const w = makeWorld({ puddings: 1 });
    keepFed(w);
    // 先確認餵飽的時候真的會掉（否則下面的「不掉」證明不了什麼）
    expect(advanceUntil(w, (x) => x.state.drops.length > 0, BALANCE.dropIntervalSec * 4)).toBeGreaterThanOrEqual(0);

    // 斷糧：庫存與盆子都清空，讓焦糖自然耗盡
    w.state.equipment[w.state.activeZone]!.autoFill = false;
    w.state.stock.caramel = 0;
    for (const b of w.state.basins) { b.units = 0; b.liquid = null; }
    advanceUntil(w, (x) => only(x.state).caramel <= 0, 200);
    expect(only(w.state).caramel).toBeLessThan(BALANCE.dropCaramelMin);

    w.state.drops = [];
    advance(w, BALANCE.dropIntervalSec * 6);
    expect(w.state.drops).toHaveLength(0);
  });

  it('補回焦糖就恢復生產（而且不會一次倒出積欠的份數）', () => {
    const w = makeWorld({ puddings: 1 });
    const p = only(w.state);
    p.caramel = 0;
    advance(w, BALANCE.dropIntervalSec * 6);
    expect(w.state.drops).toHaveLength(0);

    keepFed(w);
    p.caramel = 100;
    advance(w, BALANCE.dropIntervalSec * 0.5);
    expect(w.state.drops.length).toBeLessThanOrEqual(1); // 沒有補償性爆量
    expect(advanceUntil(w, (x) => x.state.drops.length > 0, BALANCE.dropIntervalSec * 4)).toBeGreaterThanOrEqual(0);
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
    // 倒空盆子再往前跑：要驗的是「這次落地不突變」，不能讓它在這 60 秒內又泡一次
    w.state.basins[0]!.units = 0;
    w.state.basins[0]!.liquid = null;
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
  it('地上堆到上限就不再掉（D32：掉落改成固定間隔）', () => {
    const w = makeWorld({ puddings: 1 });
    keepFed(w);
    // 跑到堆滿為止：一隻布丁每 dropIntervalSec 掉一份
    const t = advanceUntil(w, (x) => x.state.drops.length >= BALANCE.dropCap, BALANCE.dropIntervalSec * 12);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(w.state.drops.length).toBe(BALANCE.dropCap);

    // 再跑好幾個間隔也不會超過上限
    advance(w, BALANCE.dropIntervalSec * 4);
    expect(w.state.drops.length).toBe(BALANCE.dropCap);
  });

  it('掉落是固定間隔，而且蛋與物種原料都掉得到', () => {
    const w = makeWorld({ puddings: 1 });
    keepFed(w);
    const kinds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      advance(w, BALANCE.dropIntervalSec);
      for (const d of w.state.drops) kinds.add(d.kind);
      w.state.drops = []; // 清掉免得撞上限
    }
    expect(kinds.has('egg')).toBe(true);
    expect(kinds.has('ingredient')).toBe(true);
  });
});
