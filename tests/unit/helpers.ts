import { BALANCE } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import type { FloorRect } from '../../src/game/pudding';
import { advance, createWorld, type World } from '../../src/game/sim';
import type { LiquidId } from '../../src/game/species';
import { createNewSave, type GameState, type Pudding } from '../../src/game/state';

/** 測試用地板：跟 cabinet.floorBounds() 目前的值同量級，但這一層不 import three.js */
export const FLOOR: FloorRect = { minX: -0.875, maxX: 0.875, minZ: -0.4, maxZ: 0.4 };

export interface TestWorldOptions {
  seed?: number;
  /** 只要一隻布丁時傳 1，行為斷言才不會被第二隻的隨機跳躍干擾 */
  puddings?: number;
}

export function makeWorld(opts: TestWorldOptions = {}): World {
  const state = createNewSave({ seed: opts.seed ?? 1234, now: 0 });
  if (opts.puddings !== undefined) state.puddings = state.puddings.slice(0, opts.puddings);
  return createWorld(state, FLOOR);
}

export function only(state: GameState): Pudding {
  const p = state.puddings[0];
  if (!p) throw new Error('沒有布丁');
  return p;
}

/** 直接把澡盆裝滿某種液體（跳過商店與庫存，測的是模擬不是購買流程） */
export function fillBasinDirect(state: GameState, liquid: LiquidId, units: number = BALANCE.basinCapacity, index = 0): void {
  const b = state.basins[index];
  if (!b) throw new Error('沒有這個澡盆');
  b.liquid = liquid;
  b.preferredLiquid = liquid;
  b.units = units;
}

/**
 * 讓布丁一直有焦糖可泡（自動注液閥＋滿庫存＋滿盆）。
 * D35 之後焦糖見底就停止掉落，所以「要量掉落」的測試一定要先餵飽，
 * 否則量到的是「停產」而不是掉落節奏。
 */
export function keepFed(w: World): void {
  w.state.equipment[w.state.activeZone]!.autoFill = true;
  w.state.stock.caramel = 100000;
  for (const b of w.state.basins) {
    b.liquid = 'caramel';
    b.preferredLiquid = 'caramel';
    b.units = BALANCE.basinCapacity;
  }
}

/** 一直推進直到條件成立或超過 maxSec，回傳實際跑了幾秒（沒成立就回 -1） */
export function advanceUntil(w: World, predicate: (w: World) => boolean, maxSec = 600, dt = 0.25): number {
  let t = 0;
  if (predicate(w)) return 0;
  while (t < maxSec) {
    advance(w, dt);
    t += dt;
    if (predicate(w)) return t;
  }
  return -1;
}

/** 收集某段期間內出現的事件型別 */
export function collect(w: World, types: SimEvent['type'][]): SimEvent[] {
  return w.events.filter((e) => types.includes(e.type));
}

/** 跑完一次完整泡澡（缺焦糖 → 跳進盆 → 泡完），回傳是否成功 */
export function runOneBath(w: World, liquid: LiquidId): boolean {
  const p = only(w.state);
  fillBasinDirect(w.state, liquid);
  p.caramel = 5;
  const before = w.state.stats.baths;
  return advanceUntil(w, (x) => x.state.stats.baths > before, 400) >= 0;
}
