/**
 * 可注入種子的亂數（mulberry32）。
 * 種子狀態要能存進存檔：離線結算與重新載入後必須接續同一條序列，
 * 否則「同一個存檔重開兩次會長出不同結果」。
 */
export interface Rng {
  /** 目前的內部狀態，存檔時寫回 `save.rngState` */
  s: number;
  /** [0, 1) */
  next(): number;
}

export function createRng(seed: number): Rng {
  const rng: Rng = {
    s: seed >>> 0,
    next() {
      rng.s = (rng.s + 0x6d2b79f5) >>> 0;
      let t = rng.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
  return rng;
}

/** [min, max) 實數 */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

/** [min, max] 整數 */
export function intRange(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick() 不能吃空陣列');
  return arr[Math.floor(rng.next() * arr.length)] as T;
}
