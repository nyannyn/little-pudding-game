import { describe, expect, it } from 'vitest';
import { pickAllDrops, switchZone, unlockZone } from '../../src/game/actions';
import { BALANCE } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import { advance } from '../../src/game/sim';
import { START_ZONE, basinsIn, dropsIn, findZone, nextLockedZone, puddingsIn, zoneKey } from '../../src/game/zones';
import { fillBasinDirect, makeWorld } from './helpers';

const sink = (_e: SimEvent) => {};
const SPAWN = { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { x: -0.52, z: 0.12 } };
const UPPER = zoneKey(0, 2);
const SECOND_CABINET = zoneKey(1, 1);

describe('解鎖分區', () => {
  it('錢不夠時完全不動 state', () => {
    const w = makeWorld();
    w.state.coins = 10;
    const before = JSON.stringify(w.state);
    expect(unlockZone(w.state, UPPER, SPAWN, sink).ok).toBe(false);
    expect(JSON.stringify(w.state)).toBe(before);
  });

  it('解鎖後多一隻住客與一個空澡盆，而且鏡頭切過去', () => {
    const w = makeWorld();
    w.state.coins = 99999;
    w.state.xp = 99999; // 分區有上架等級（D25），這裡測的是解鎖本身
    expect(unlockZone(w.state, UPPER, SPAWN, sink).ok).toBe(true);

    expect(findZone(w.state, UPPER)!.unlocked).toBe(true);
    expect(puddingsIn(w.state, UPPER)).toHaveLength(1);
    expect(basinsIn(w.state, UPPER)).toHaveLength(1);
    expect(basinsIn(w.state, UPPER)[0]!.units).toBe(0);
    expect(w.state.activeZone).toBe(UPPER);
    // 起始區原本的兩隻不受影響
    expect(puddingsIn(w.state, START_ZONE)).toHaveLength(2);
  });

  it('新住客的 id 不會跟既有的撞號', () => {
    const w = makeWorld();
    w.state.coins = 99999;
    w.state.xp = 99999; // 分區有上架等級（D25），這裡測的是解鎖本身
    unlockZone(w.state, UPPER, SPAWN, sink);
    unlockZone(w.state, zoneKey(0, 0), SPAWN, sink);
    const ids = w.state.puddings.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('同一區不能解鎖兩次', () => {
    const w = makeWorld();
    w.state.coins = 99999;
    w.state.xp = 99999; // 分區有上架等級（D25），這裡測的是解鎖本身
    expect(unlockZone(w.state, UPPER, SPAWN, sink).ok).toBe(true);
    const coins = w.state.coins;
    expect(unlockZone(w.state, UPPER, SPAWN, sink).ok).toBe(false);
    expect(w.state.coins).toBe(coins);
  });

  it('商店一次只推最便宜的那一區', () => {
    const w = makeWorld();
    expect(nextLockedZone(w.state)!.id).toBe(UPPER);
    w.state.coins = 99999;
    w.state.xp = 99999; // 分區有上架等級（D25），這裡測的是解鎖本身
    unlockZone(w.state, UPPER, SPAWN, sink);
    expect(nextLockedZone(w.state)!.id).toBe(zoneKey(0, 0));
  });

  it('沒解鎖的區不能切過去', () => {
    const w = makeWorld();
    expect(switchZone(w.state, SECOND_CABINET).ok).toBe(false);
    expect(w.state.activeZone).toBe(START_ZONE);
  });
});

describe('分區之間互不干擾', () => {
  function twoZones() {
    const w = makeWorld({ seed: 555 });
    w.state.coins = 99999;
    w.state.xp = 99999;
    unlockZone(w.state, SECOND_CABINET, SPAWN, sink);
    w.state.coins = 0;
    return w;
  }

  it('布丁只會跳進自己那一區的澡盆', () => {
    const w = twoZones();
    // 只有起始區的盆有液體；二號櫥窗那隻再餓也不能跨區去泡
    fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity, 0);
    for (const p of w.state.puddings) p.caramel = 5;

    advance(w, 200);
    for (const p of puddingsIn(w.state, SECOND_CABINET)) {
      expect(p.mode).not.toBe('bathing');
      expect(p.basinIndex).toBeNull();
    }
    expect(w.state.stats.baths).toBeGreaterThan(0); // 起始區有在泡
  });

  it('掉落上限是每一區各自 5 份', () => {
    const w = twoZones();
    const bIdx = w.state.basins.findIndex((b) => b.zone === SECOND_CABINET);
    fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity, 0);
    fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity, bIdx);
    w.state.stock.caramel = 0;
    for (const p of w.state.puddings) p.caramel = 5;

    advance(w, 4000);
    expect(dropsIn(w.state, START_ZONE).length).toBeLessThanOrEqual(BALANCE.dropCap);
    expect(dropsIn(w.state, SECOND_CABINET).length).toBeLessThanOrEqual(BALANCE.dropCap);
    expect(w.state.drops.length).toBeGreaterThan(BALANCE.dropCap - 1);
  });

  it('玩家按「撿原料」只撿看得到的那一區，收集手則是全場', () => {
    const w = twoZones();
    w.state.drops = [
      { id: 'd1', zone: START_ZONE, kind: 'ingredient' as const, species: 'caramel', pos: { x: 0, z: 0 }, bornAt: 0 },
      { id: 'd2', zone: SECOND_CABINET, kind: 'ingredient' as const, species: 'caramel', pos: { x: 0, z: 0 }, bornAt: 0 },
    ];
    pickAllDrops(w.state, sink, false, START_ZONE);
    expect(w.state.ingredients.caramel).toBe(1);
    expect(dropsIn(w.state, SECOND_CABINET)).toHaveLength(1);

    pickAllDrops(w.state, sink, true);
    expect(w.state.drops).toHaveLength(0);
    expect(w.state.ingredients.caramel).toBe(2);
  });

  it('二號櫥窗的產出照樣進同一個庫存（經濟是全場共用的）', () => {
    const w = twoZones();
    const bIdx = w.state.basins.findIndex((b) => b.zone === SECOND_CABINET);
    fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity, bIdx);
    w.state.equipment[w.state.activeZone]!.collector = true;
    for (const p of puddingsIn(w.state, SECOND_CABINET)) p.caramel = 5;

    advance(w, 200);
    expect(w.state.ingredients.caramel).toBeGreaterThan(0);
  });
});
