import { BALANCE } from './balance';
import type { GameState } from './state';

/**
 * 工坊的營業日時鐘（D52）。從 `bakery.ts` 抽出來：常客的行程（D66）也要用，
 * 放在 bakery 裡會讓 regulars ↔ bakery 互相引用。
 */

export interface DayClock {
  /** 第幾天（1 起） */
  day: number;
  /** 0–24 的小時（含小數） */
  hour: number;
  open: boolean;
}

/** epoch 是第 1 天 07:00：時鐘往前平移營業開始的那幾個小時 */
export function dayClock(state: GameState): DayClock {
  return clockAt(state, state.time);
}

/** 任意遊戲時間 `t` 是第幾天幾點 */
export function clockAt(state: GameState, time: number): DayClock {
  const B = BALANCE.bakery;
  const t = time - state.bakery.epoch + (B.openHour / 24) * B.dayLengthSec;
  const day = Math.floor(t / B.dayLengthSec) + 1;
  const hour = ((t % B.dayLengthSec + B.dayLengthSec) % B.dayLengthSec) / B.dayLengthSec * 24;
  return { day, hour, open: hour >= B.openHour && hour < B.closeHour };
}

/** 第 `day` 天 `hour` 點是哪個遊戲時間（`clockAt` 的反函式） */
export function timeAt(state: GameState, day: number, hour: number): number {
  const B = BALANCE.bakery;
  return state.bakery.epoch + (day - 1) * B.dayLengthSec + ((hour - B.openHour) / 24) * B.dayLengthSec;
}

/** 「14:05」這種顯示字串 */
export function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
