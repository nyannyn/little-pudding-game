import { migrate, type GameState, type NewSaveOptions } from './state';

export const SAVE_KEY = 'lpg.save.v1';

/** 沒有 localStorage（無痕、被擋、SSR）時退回一個記憶體實作，讓遊戲照樣能玩 */
function backend(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__lpg_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* 掉到下面的記憶體版 */
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

const store = backend();

export interface LoadResult {
  state: GameState;
  /** true＝真的讀到舊檔；false＝開了新檔 */
  restored: boolean;
}

/**
 * 讀檔。壞檔一律不拋例外——存檔壞掉還讓遊戲開不起來是最糟的結果。
 * 能救的欄位交給 `migrate()` 補，救不動就開新檔。
 */
export function parseSave(raw: string | null, opts: NewSaveOptions = {}): LoadResult {
  if (raw === null) return { state: migrate(null, opts), restored: false };

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: migrate(null, opts), restored: false };
  }
  const state = migrate(parsed, opts);
  const restored =
    typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { puddings?: unknown }).puddings);
  return { state, restored };
}

export function load(opts: NewSaveOptions = {}): LoadResult {
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    raw = null;
  }
  return parseSave(raw, opts);
}

export function save(state: GameState): boolean {
  try {
    store.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // 配額滿或無痕模式：不擋遊戲，只是這一次沒存成功
    return false;
  }
}

export function clear(): void {
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    /* 清不掉就算了 */
  }
}
