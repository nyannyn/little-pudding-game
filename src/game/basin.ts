import { BALANCE } from './balance';
import { LIQUIDS, type LiquidId } from './species';
import type { Basin, GameState } from './state';

/** 澡盆可不可以讓「還沒進來的布丁」進場：有液體、沒人佔用 */
export function basinAvailable(b: Basin): boolean {
  return b.units >= BALANCE.bathLiquidCost && b.occupantId === null;
}

/**
 * 找一個可以泡的澡盆索引。
 * 偏好「特殊風味澡盆」：玩家會特地倒抹茶／草莓進去，就是要布丁去泡；
 * 若讓布丁只挑最近的普通盆，風味突變這條線玩家操作不到。
 */
export function findBasinFor(state: GameState, x: number, z: number): number | null {
  let best: number | null = null;
  let bestKey = Number.POSITIVE_INFINITY;
  state.basins.forEach((b, i) => {
    if (!basinAvailable(b)) return;
    const special = b.liquid !== null && LIQUIDS[b.liquid].needsBasin;
    const dx = b.pos.x - x, dz = b.pos.z - z;
    // 特殊盆一律排在普通盆前面（減 1000），同類再比距離
    const key = (special ? -1000 : 0) + Math.hypot(dx, dz);
    if (key < bestKey) { bestKey = key; best = i; }
  });
  return best;
}

export interface PourResult { ok: boolean; error?: string; poured: number }

/**
 * 從庫存往澡盆倒液體。空盆才能換口味——盆裡還有別的液體時不允許混。
 * `max` 是這次最多倒幾份（手動＝1，自動注液閥＝倒滿）。
 */
export function pourIntoBasin(state: GameState, basinIndex: number, liquid: LiquidId, max: number): PourResult {
  const b = state.basins[basinIndex];
  if (!b) return { ok: false, error: '沒有這個澡盆', poured: 0 };
  if (LIQUIDS[liquid].needsBasin && !state.ownedBasins.includes(liquid)) {
    return { ok: false, error: `還沒買下${LIQUIDS[liquid].name}澡盆`, poured: 0 };
  }
  if (b.liquid !== null && b.liquid !== liquid) {
    return { ok: false, error: '盆裡還有別的液體，等泡完再換', poured: 0 };
  }
  const space = BALANCE.basinCapacity - b.units;
  if (space <= 0) return { ok: false, error: '澡盆已經滿了', poured: 0 };
  const have = state.stock[liquid];
  if (have <= 0) return { ok: false, error: `${LIQUIDS[liquid].name}庫存不足`, poured: 0 };

  const n = Math.min(space, have, Math.max(1, Math.floor(max)));
  state.stock[liquid] -= n;
  b.units += n;
  b.liquid = liquid;
  b.preferredLiquid = liquid;
  return { ok: true, poured: n };
}

/** 布丁進盆時扣一份；扣到 0 就清空 `liquid` 讓玩家換口味（`preferredLiquid` 留著給自動注液閥） */
export function consumeBathUnit(b: Basin): void {
  b.units = Math.max(0, b.units - BALANCE.bathLiquidCost);
  if (b.units === 0) b.liquid = null;
}
