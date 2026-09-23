import { describe, expect, it } from 'vitest';
import { buyEquipment, unlockZone } from '../../src/game/actions';
import { EQUIPMENT_IDS } from '../../src/game/balance';
import { findBasinFor } from '../../src/game/basin';
import type { SimEvent } from '../../src/game/events';
import {
  BASIN_RADIUS,
  EQUIPMENT_DEFAULT_POS,
  TANK_INNER,
  equipmentPos,
  moveFurniture,
  placeFromStorage,
  storeFurniture,
  storedBasins,
} from '../../src/game/furniture';
import { exportCode, importCode } from '../../src/game/savecode';
import { advance } from '../../src/game/sim';
import { STORAGE_ZONE, SCHEMA_VERSION, equipmentIn, hasAnyEquipment, migrate } from '../../src/game/state';
import { START_ZONE, basinsIn, zoneKey } from '../../src/game/zones';
import { TANK } from '../../src/scene/cabinet';
import { BASIN } from '../../src/scene/basinMesh';
import { fillBasinDirect, makeWorld } from './helpers';

/**
 * D49：家具擺放＋倉庫。所有規則都在 `game/furniture.ts`，UI 只做預覽與手勢。
 */
const sink = (_e: SimEvent) => {};
const SPAWN = { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { x: -0.52, z: 0.12 } };
const UPPER = zoneKey(0, 2);
const BASIN0 = { kind: 'basin', index: 0 } as const;

function rich() {
  const w = makeWorld({ seed: 77 });
  w.state.coins = 99999;
  w.state.xp = 99999;
  return w;
}

/** 讓第一隻布丁泡進第 i 個盆 */
function bathIn(w: ReturnType<typeof makeWorld>, i: number) {
  const p = w.state.puddings[0]!;
  const b = w.state.basins[i]!;
  p.mode = 'bathing';
  p.basinIndex = i;
  p.bathLiquid = 'caramel';
  p.bathT = 5;
  p.pos = { ...b.pos };
  b.occupantId = p.id;
  return p;
}

describe('game 抄的尺寸跟 scene 一致', () => {
  it('櫃子內部與澡盆半徑', () => {
    expect(TANK_INNER.halfW).toBeCloseTo(TANK.width / 2);
    expect(TANK_INNER.halfD).toBeCloseTo(TANK.depth / 2);
    expect(BASIN_RADIUS).toBeCloseTo(BASIN.radius);
  });
});

describe('搬家具', () => {
  it('澡盆搬到空地：位置更新，泡著的那隻跟著走、繼續泡', () => {
    const w = rich();
    fillBasinDirect(w.state, 'caramel', 3);
    const p = bathIn(w, 0);
    const r = moveFurniture(w.state, START_ZONE, BASIN0, { x: 0.3, z: -0.3 });
    expect(r.ok).toBe(true);
    expect(w.state.basins[0]!.pos).toEqual({ x: 0.3, z: -0.3 });
    expect(p.mode).toBe('bathing');
    expect(p.pos).toEqual({ x: 0.3, z: -0.3 });
    expect(w.state.basins[0]!.occupantId).toBe(p.id);
  });

  it('正在跳向澡盆的那隻取消，盆的佔位也放掉', () => {
    const w = rich();
    const p = w.state.puddings[0]!;
    p.mode = 'hopping';
    p.basinIndex = 0;
    w.state.basins[0]!.occupantId = p.id;
    expect(moveFurniture(w.state, START_ZONE, BASIN0, { x: 0.3, z: -0.3 }).ok).toBe(true);
    expect(p.basinIndex).toBeNull();
    expect(w.state.basins[0]!.occupantId).toBeNull();
  });

  it('壓到別的家具、或出了櫃子：擋下而且 state 一個欄位都不變', () => {
    const w = rich();
    buyEquipment(w.state, 'crafter', sink);
    const before = JSON.stringify(w.state);
    const crafter = EQUIPMENT_DEFAULT_POS.crafter;
    expect(moveFurniture(w.state, START_ZONE, BASIN0, { x: crafter.x + 0.1, z: crafter.z }).ok).toBe(false);
    expect(moveFurniture(w.state, START_ZONE, BASIN0, { x: 1.1, z: 0 }).ok).toBe(false);
    expect(moveFurniture(w.state, START_ZONE, BASIN0, { x: 0, z: 0.65 }).ok).toBe(false);
    expect(JSON.stringify(w.state)).toBe(before);
  });

  it('設備可以搬，位置記在 equipmentPos；注液閥不能單獨搬、跟著第一個澡盆', () => {
    const w = rich();
    buyEquipment(w.state, 'seller', sink);
    buyEquipment(w.state, 'autoFill', sink);
    expect(moveFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'seller' }, { x: 0.1, z: -0.35 }).ok).toBe(true);
    expect(equipmentPos(w.state, START_ZONE, 'seller')).toEqual({ x: 0.1, z: -0.35 });
    expect(moveFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'autoFill' }, { x: 0, z: 0 }).ok).toBe(false);
    moveFurniture(w.state, START_ZONE, BASIN0, { x: -0.5, z: -0.3 });
    expect(equipmentPos(w.state, START_ZONE, 'autoFill')).toEqual({ x: -0.5, z: -0.3 });
  });

  it('布丁的落點會避開被拖到地板中央的機器', () => {
    const w = rich();
    buyEquipment(w.state, 'crafter', sink);
    expect(moveFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'crafter' }, { x: 0, z: 0 }).ok).toBe(true);
    let landedInside = 0;
    for (let i = 0; i < 3000; i++) {
      advance(w, 0.1);
      for (const p of w.state.puddings) {
        // 落點在加工機佔地內（加工機在正中央 ±0.15／±0.12）
        if (p.mode === 'hopping' && Math.abs(p.to.x) < 0.15 && Math.abs(p.to.z) < 0.12) landedInside++;
      }
    }
    expect(landedInside).toBe(0);
  });
});

describe('收進倉庫', () => {
  it('澡盆裡的液體直接倒掉，正在泡的布丁被請出來', () => {
    const w = rich();
    fillBasinDirect(w.state, 'milk', 4);
    const stockBefore = w.state.stock.milk;
    const p = bathIn(w, 0);
    const r = storeFurniture(w.state, START_ZONE, BASIN0);
    expect(r.ok && r.message).toContain('倒掉 4 份');
    const b = w.state.basins[0]!;
    expect(b.zone).toBe(STORAGE_ZONE);
    expect(b.units).toBe(0);
    expect(b.liquid).toBeNull();
    expect(b.occupantId).toBeNull();
    expect(w.state.stock.milk).toBe(stockBefore); // 倒掉，不是退回庫存
    expect(p.mode).toBe('resting');
    expect(p.basinIndex).toBeNull();
    expect(basinsIn(w.state, START_ZONE)).toHaveLength(0);
  });

  it('收中間那個盆，泡在第三個盆的布丁還是泡在對的盆（索引不位移）', () => {
    const w = rich();
    w.state.basins.push(
      { zone: START_ZONE, liquid: null, units: 0, preferredLiquid: null, pos: { x: 0.5, z: -0.25 }, occupantId: null },
      { zone: START_ZONE, liquid: 'caramel', units: 3, preferredLiquid: 'caramel', pos: { x: -0.1, z: -0.3 }, occupantId: null },
    );
    const p = bathIn(w, 2);
    expect(storeFurniture(w.state, START_ZONE, { kind: 'basin', index: 1 }).ok).toBe(true);
    expect(p.basinIndex).toBe(2);
    expect(w.state.basins[2]!.occupantId).toBe(p.id);
    expect(p.mode).toBe('bathing');
  });

  it('倉庫裡的澡盆布丁找不到、注液閥也不會補', () => {
    const w = rich();
    buyEquipment(w.state, 'autoFill', sink);
    fillBasinDirect(w.state, 'caramel', 1);
    storeFurniture(w.state, START_ZONE, BASIN0);
    w.state.basins[0]!.preferredLiquid = 'caramel';
    expect(findBasinFor(w.state, START_ZONE, 0, 0)).toBeNull();
    const stock = w.state.stock.caramel;
    for (let i = 0; i < 200; i++) advance(w, 0.1);
    expect(w.state.basins[0]!.units).toBe(0);
    expect(w.state.stock.caramel).toBe(stock);
  });

  it('一區沒有澡盆照樣能跑，布丁不會卡住', () => {
    const w = rich();
    storeFurniture(w.state, START_ZONE, BASIN0);
    for (const p of w.state.puddings) p.caramel = 5; // 想泡澡但沒盆
    for (let i = 0; i < 600; i++) advance(w, 0.1);
    expect(w.state.puddings.some((p) => p.mode === 'hopping' || p.mode === 'resting')).toBe(true);
    expect(w.state.puddings.every((p) => p.basinIndex === null)).toBe(true);
  });

  it('設備收起來還算「買過」（教學不會重新跳出來），可以擺到別區', () => {
    const w = rich();
    buyEquipment(w.state, 'crafter', sink);
    unlockZone(w.state, UPPER, SPAWN, sink);
    w.state.activeZone = START_ZONE;
    expect(storeFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'crafter' }).ok).toBe(true);
    expect(equipmentIn(w.state, START_ZONE).crafter).toBe(false);
    expect(w.state.storedEquipment.crafter).toBe(1);
    expect(hasAnyEquipment(w.state)).toBe(true);
    expect(placeFromStorage(w.state, UPPER, { kind: 'equipment', id: 'crafter' }).ok).toBe(true);
    expect(equipmentIn(w.state, UPPER).crafter).toBe(true);
    expect(w.state.storedEquipment.crafter).toBe(0);
    // 倉庫空了就擺不出第二台
    expect(placeFromStorage(w.state, START_ZONE, { kind: 'equipment', id: 'crafter' }).ok).toBe(false);
  });

  it('同一區已經裝了同一台，倉庫那台擺不進來', () => {
    const w = rich();
    buyEquipment(w.state, 'seller', sink);
    w.state.storedEquipment.seller = 1;
    expect(placeFromStorage(w.state, START_ZONE, { kind: 'equipment', id: 'seller' }).ok).toBe(false);
    expect(w.state.storedEquipment.seller).toBe(1);
  });

  it('澡盆擺出來會自己找空位，不壓到別的家具', () => {
    const w = rich();
    for (const id of EQUIPMENT_IDS) buyEquipment(w.state, id, sink);
    storeFurniture(w.state, START_ZONE, BASIN0);
    // 把販賣機搬到澡盆的老位置上，逼它另外找位置
    expect(moveFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'seller' }, { x: -0.52, z: 0.12 }).ok).toBe(true);
    expect(placeFromStorage(w.state, START_ZONE, BASIN0).ok).toBe(true);
    const b = w.state.basins[0]!;
    expect(b.zone).toBe(START_ZONE);
    const s = equipmentPos(w.state, START_ZONE, 'seller');
    const overlap = Math.abs(b.pos.x - s.x) < BASIN_RADIUS + 0.17 && Math.abs(b.pos.z - s.z) < BASIN_RADIUS + 0.1;
    expect(overlap).toBe(false);
    expect(storedBasins(w.state)).toHaveLength(0);
  });
});

describe('存檔', () => {
  it('v6 舊檔：倉庫空、設備在原本的位置', () => {
    const w = rich();
    buyEquipment(w.state, 'seller', sink);
    const old = JSON.parse(JSON.stringify(w.state)) as Record<string, unknown>;
    delete old.storedEquipment;
    delete old.equipmentPos;
    old.schemaVersion = 6;
    const s = migrate(old);
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    for (const id of EQUIPMENT_IDS) expect(s.storedEquipment[id]).toBe(0);
    expect(equipmentPos(s, START_ZONE, 'seller')).toEqual(EQUIPMENT_DEFAULT_POS.seller);
    expect(storedBasins(s)).toHaveLength(0);
  });

  it('倉庫內容與擺過的位置經過存檔碼來回都還在（倉庫的盆不會被補回起始區）', () => {
    const w = rich();
    buyEquipment(w.state, 'seller', sink);
    buyEquipment(w.state, 'crafter', sink);
    moveFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'seller' }, { x: 0.1, z: -0.35 });
    storeFurniture(w.state, START_ZONE, { kind: 'equipment', id: 'crafter' });
    storeFurniture(w.state, START_ZONE, BASIN0);
    const back = importCode(exportCode(w.state));
    expect(back).not.toBeNull();
    expect(back!.basins[0]!.zone).toBe(STORAGE_ZONE);
    expect(back!.storedEquipment.crafter).toBe(1);
    expect(equipmentPos(back!, START_ZONE, 'seller')).toEqual({ x: 0.1, z: -0.35 });
  });
});
