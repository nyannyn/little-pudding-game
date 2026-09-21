import { BALANCE } from './balance';
import type { EventSink } from './events';
import type { GameState } from './state';

/**
 * 店長等級（D25）。`GameState.xp` 只增不減，等級純粹由 xp 查 `BALANCE.levelXp` 推導——
 * 不另存 `level` 欄位，兩個數字就不會有「對不上」的一天。
 *
 * 等級只做一件事：決定商店哪些商品已經上架（`shop.ts`）。
 * 它不改生產規則，所以一隻 Lv.1 與 Lv.9 的布丁泡出來的原料一樣多。
 */

export const MAX_LEVEL = BALANCE.levelXp.length;

/** xp 對應的等級（1 起跳、封頂 MAX_LEVEL） */
export function levelFor(xp: number): number {
  const table = BALANCE.levelXp;
  let level = 1;
  for (let i = 1; i < table.length; i++) {
    if (xp >= (table[i] as number)) level = i + 1;
    else break;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  /** 這一級已累積的 xp */
  into: number;
  /** 這一級總共要多少 xp 才升級；滿級為 0 */
  span: number;
  /** 0–1；滿級為 1 */
  ratio: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFor(xp);
  const table = BALANCE.levelXp;
  const floor = table[level - 1] as number;
  const next = table[level];
  if (next === undefined) return { level, into: xp - floor, span: 0, ratio: 1 };
  const span = next - floor;
  const into = Math.min(span, Math.max(0, xp - floor));
  return { level, into, span, ratio: span > 0 ? into / span : 1 };
}

/** 加 xp；跨級就丟一個 `levelUp` 事件（一次跨多級也只丟一個，帶最新等級） */
export function grantXp(state: GameState, amount: number, emit: EventSink): void {
  if (!(amount > 0)) return;
  const before = levelFor(state.xp);
  state.xp += amount;
  const after = levelFor(state.xp);
  if (after > before) emit({ type: 'levelUp', level: after, from: before });
}

/**
 * 舊存檔沒有 xp 欄位時，用累計統計回推一個合理的 xp。
 * 不回推的話，已經裝了 T3 設備的老玩家會被降回 Lv.1、商店整片鎖住。
 */
export function xpFromStats(stats: GameState['stats']): number {
  const x = BALANCE.xp;
  return (
    stats.baths * x.bath +
    stats.picked * x.pick +
    stats.crafted * x.craft +
    stats.sold * x.sellDessert +
    stats.mutations * x.mutate +
    stats.births * x.birth
  );
}
