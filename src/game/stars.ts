import { BALANCE } from './balance';
import type { EventSink } from './events';
import type { AlleleId, LiquidId } from './species';
import type { GameState, Pudding } from './state';
import { MAX_STAR, clampStar, type Star } from './stock';
import { findZone } from './zones';

/**
 * 布丁星級（D62／D63，2026-09-25 使用者「我希望更有養成、策略跟商業經營」）。
 *
 * - 只有住在**精養區**的布丁會累積照顧點數：泡一次澡 +1，泡的是本命液 +3。
 * - 點數滿了升一星、點數歸零；已經到潛力上限就不再累積。
 * - 精養區住超過上限（切成精養時就已經超過）的時候**整區都不長**，直到降回上限以內——
 *   趕誰走交給玩家，規則不替玩家選。
 */

/** 等位基因 → 它的本命液（鮮奶酪的本命液是牛奶，所以精養區的鮮奶酪系會一直生寶寶，D62） */
export const NATIVE_LIQUID: Record<AlleleId, LiquidId> = {
  caramel: 'caramel',
  panna: 'milk',
  matcha: 'matcha',
  strawberry: 'strawberry',
};

/** 這隻布丁的本命液（混種兩種都算） */
export function nativeLiquids(p: Pudding): LiquidId[] {
  return [...new Set(p.genes.map((a) => NATIVE_LIQUID[a]))];
}

export function isNativeLiquid(p: Pudding, liquid: LiquidId): boolean {
  return p.genes.some((a) => NATIVE_LIQUID[a] === liquid);
}

export function isEliteZone(state: GameState, zone: string): boolean {
  return findZone(state, zone)?.mode === 'elite';
}

/** 這一區最多住幾隻：精養區 `eliteCapacity`、量產區 `zoneCapacity` */
export function zoneCap(state: GameState, zone: string): number {
  return isEliteZone(state, zone) ? BALANCE.eliteCapacity : BALANCE.zoneCapacity;
}

export function residents(state: GameState, zone: string): number {
  return state.puddings.filter((p) => p.zone === zone).length;
}

/** 這隻布丁現在會不會長照顧點數（住在精養區、那一區沒有超收、還沒到潛力上限） */
export function growsCare(state: GameState, p: Pudding): boolean {
  if (!isEliteZone(state, p.zone)) return false;
  if (residents(state, p.zone) > BALANCE.eliteCapacity) return false;
  return p.star < p.potential;
}

/** 升下一星要幾點；已經 ★5 回 null */
export function careNeeded(star: Star): number | null {
  return star >= MAX_STAR ? null : (BALANCE.starCare[star - 1] ?? null);
}

/**
 * 泡完一次澡（`pudding.finishBath` 呼叫）：精養區的住客長照顧點數，滿了升一星。
 * 回傳這次給了幾點（不長回 0），測試用。
 */
export function careAfterBath(state: GameState, p: Pudding, liquid: LiquidId, emit: EventSink): number {
  if (!growsCare(state, p)) return 0;
  const gain = isNativeLiquid(p, liquid) ? BALANCE.careNative : BALANCE.careBath;
  p.care += gain;
  const need = careNeeded(p.star);
  if (need !== null && p.care >= need) {
    p.star = clampStar(p.star + 1);
    p.care = 0;
    state.stats.starUps++;
    emit({ type: 'starUp', puddingId: p.id, star: p.star, byTonic: false });
  }
  // 到了潛力上限就停在 0：不留一截看得到卻永遠不會滿的進度條
  if (p.star >= p.potential) p.care = 0;
  return gain;
}

/** 子代的潛力＝母體出生當下的星級＋1（D63），上限 ★5 */
export function childPotential(mother: Pudding): Star {
  return clampStar(mother.star + 1);
}

export type TonicResult = { ok: true } | { ok: false; error: string };

/**
 * 升星藥（D67）：只能給精養區的布丁用，立刻 +1 星；已經在潛力上限就連潛力一起 +1——
 * 這是唯一突破世代上限的辦法。★5 用不了。
 */
export function useStarTonic(state: GameState, puddingId: string, emit: EventSink): TonicResult {
  const p = state.puddings.find((x) => x.id === puddingId);
  if (!p) return { ok: false, error: '沒有這隻布丁' };
  if (state.items.starTonic <= 0) return { ok: false, error: '沒有升星藥' };
  if (!isEliteZone(state, p.zone)) return { ok: false, error: '升星藥只能給精養區的布丁用' };
  if (p.star >= MAX_STAR) return { ok: false, error: '已經是 ★5 了' };
  state.items.starTonic--;
  if (p.star >= p.potential) p.potential = clampStar(p.potential + 1);
  p.star = clampStar(p.star + 1);
  p.care = 0;
  state.stats.starUps++;
  emit({ type: 'starUp', puddingId: p.id, star: p.star, byTonic: true });
  return { ok: true };
}

/** 星級價值倍率（D65） */
export function starMult(star: Star): number {
  return BALANCE.starMult[star - 1] ?? 1;
}

/** 散客付的倍率：最多到 ★2（D65） */
export function walkInMult(star: Star): number {
  return starMult(clampStar(Math.min(star, BALANCE.walkInStarCap)));
}

export function starText(star: Star): string {
  return `★${star}`;
}
