import type { DessertId } from './recipes';
import type { SpeciesId } from './species';
import type { GameState } from './state';

/**
 * 帶星級的庫存（D64，2026-09-25）：原料、成品櫃、展示架三個欄位的**唯一出入口**。
 *
 * 每一種東西存成長度 5 的陣列（`StarStock`），索引 0＝★1。這三個欄位改版前是
 * `Record<物種, 數字>`、散在十幾個檔案直接讀寫；改成陣列之後漏改一處就是靜默算錯
 * （`tools/` 不在 tsconfig 裡，`s.ingredients.caramel += 1` 會把數字接到陣列後面變字串）。
 * 所以一律經這裡，`tests/unit/stockAccess.test.ts` 掃 `src/` 與 `tools/` 守著。
 */

export const MAX_STAR = 5;
export type Star = 1 | 2 | 3 | 4 | 5;
export const STARS: readonly Star[] = [1, 2, 3, 4, 5];

/** 索引 0＝★1 … 索引 4＝★5 */
export type StarStock = number[];

export type StockKind = 'ingredients' | 'desserts' | 'shelf';
type KeyOf<K extends StockKind> = K extends 'ingredients' ? SpeciesId : DessertId;

export function isStar(v: unknown): v is Star {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_STAR;
}

/** 任意數字夾成合法星級（壞存檔、UI 傳錯都不該讓遊戲當掉） */
export function clampStar(v: unknown): Star {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1;
  return Math.min(MAX_STAR, Math.max(1, n)) as Star;
}

export function emptyStarStock(): StarStock {
  return [0, 0, 0, 0, 0];
}

export function zeroTable<K extends string>(ids: readonly K[]): Record<K, StarStock> {
  const out = {} as Record<K, StarStock>;
  for (const id of ids) out[id] = emptyStarStock();
  return out;
}

/**
 * 從存檔還原一張表（D71）。舊存檔（v10 以前）每一格是數字 → **全部放進 ★1**：
 * 那是最低估，玩家不會一上線就拿到高星貨，也不會少掉任何一份。
 * 新存檔每一格是陣列 → 逐星還原；壞值一律當 0。
 */
export function restoreTable<K extends string>(raw: unknown, ids: readonly K[]): Record<K, StarStock> {
  const out = zeroTable(ids);
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  for (const id of ids) {
    const v = src[id];
    const row = out[id];
    if (typeof v === 'number') row[0] = cleanCount(v);
    else if (Array.isArray(v)) for (let i = 0; i < MAX_STAR; i++) row[i] = cleanCount(v[i]);
  }
  return out;
}

function cleanCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function table(state: GameState, kind: StockKind): Record<string, StarStock> {
  return kind === 'shelf' ? state.bakery.shelf : state[kind];
}

function row(state: GameState, kind: StockKind, id: string): StarStock {
  const t = table(state, kind);
  return (t[id] ??= emptyStarStock());
}

/** 某一種有幾份：給星級就只算那一星，不給就全部星級加總 */
export function stockOf<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>, star?: Star): number {
  const r = row(state, kind, id);
  if (star !== undefined) return r[star - 1] ?? 0;
  return r.reduce((n, x) => n + x, 0);
}

/** 某一種、**不低於** `minStar` 的份數 */
export function stockAtLeast<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>, minStar: Star): number {
  const r = row(state, kind, id);
  let n = 0;
  for (let i = minStar - 1; i < MAX_STAR; i++) n += r[i] ?? 0;
  return n;
}

/** 某一種每一星各幾份的複本（UI 顯示用；改它不會動到 state） */
export function starCounts<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>): number[] {
  return [...row(state, kind, id)];
}

export function addStock<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>, star: Star, n: number): void {
  if (!(n > 0)) return;
  row(state, kind, id)[star - 1]! += n;
}

/** 從指定星級拿 `n` 份；不夠就**什麼都不拿**回 false（不從別的星級湊，AC11-5） */
export function takeStock<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>, star: Star, n: number): boolean {
  const r = row(state, kind, id);
  if (!(n >= 0) || (r[star - 1] ?? 0) < n) return false;
  r[star - 1]! -= n;
  return true;
}

/**
 * 從最低星（不低於 `minStar`）開始拿，一份一份拿到 `n` 份；不夠就什麼都不拿回 null。
 * 回傳拿到的每一份的星級（由低到高），呼叫端照星級各自算錢。
 */
export function takeLowest<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>, n: number, minStar: Star = 1): Star[] | null {
  if (stockAtLeast(state, kind, id, minStar) < n) return null;
  const r = row(state, kind, id);
  const out: Star[] = [];
  for (let i = minStar - 1; i < MAX_STAR && out.length < n; i++) {
    while (r[i]! > 0 && out.length < n) {
      r[i]!--;
      out.push((i + 1) as Star);
    }
  }
  return out;
}

/** 整張表加總（例如「成品櫃一共幾份」） */
export function totalStock(state: GameState, kind: StockKind): number {
  let n = 0;
  for (const r of Object.values(table(state, kind))) for (const x of r) n += x;
  return n;
}

/** 表裡有貨（任何星級 > 0）的鍵 */
export function stockedIds<K extends StockKind>(state: GameState, kind: K): KeyOf<K>[] {
  return Object.entries(table(state, kind))
    .filter(([, r]) => r.some((x) => x > 0))
    .map(([id]) => id as KeyOf<K>);
}

/** 這一種有貨的最低星級（不低於 `minStar`）；沒有就 null */
export function lowestStar<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>, minStar: Star = 1): Star | null {
  const r = row(state, kind, id);
  for (let i = minStar - 1; i < MAX_STAR; i++) if ((r[i] ?? 0) > 0) return (i + 1) as Star;
  return null;
}

/** 這一種有貨的最高星級；沒有就 null */
export function highestStar<K extends StockKind>(state: GameState, kind: K, id: KeyOf<K>): Star | null {
  const r = row(state, kind, id);
  for (let i = MAX_STAR - 1; i >= 0; i--) if ((r[i] ?? 0) > 0) return (i + 1) as Star;
  return null;
}

/** 從 `from` 表的某一星搬 `n` 份到 `to` 表的同一星（上架／收回）；不夠就不搬回 false */
export function moveStock(state: GameState, from: 'desserts' | 'shelf', to: 'desserts' | 'shelf', id: DessertId, star: Star, n: number): boolean {
  if (!takeStock(state, from, id, star, n)) return false;
  addStock(state, to, id, star, n);
  return true;
}
