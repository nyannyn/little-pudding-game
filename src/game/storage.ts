import { migrate, type GameState, type NewSaveOptions } from './state';

/** 玩家的存檔格 */
export const SAVE_KEY = 'lpg.save.v1';
/**
 * 測試模式的存檔格（`?fresh=1`）。
 * 分開不是為了乾淨，是因為共用同一格時「在自己手機上開一次測試網址」
 * 五秒後就會把玩家的進度覆蓋掉（2026-09-22 實測）。
 */
export const TEST_SAVE_KEY = 'lpg.save.test';

/** 沒有 localStorage（無痕、被擋、SSR）時退回一個記憶體實作，讓遊戲照樣能玩 */
function backend(): { store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; durable: boolean } {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__lpg_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return { store: ls, durable: true };
    }
  } catch {
    /* 掉到下面的記憶體版 */
  }
  const mem = new Map<string, string>();
  return {
    store: {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    },
    durable: false,
  };
}

const { store, durable } = backend();

let key: string = SAVE_KEY;

/**
 * 切到測試模式：之後的 `load`／`save`／`clear` 全部走測試那一格。
 * 開場設定一次（`main.ts` 看 `?fresh=1`），中途不要改。
 */
export function useTestSave(on: boolean): void {
  key = on ? TEST_SAVE_KEY : SAVE_KEY;
}

/** 目前在寫哪一格；測試與除錯用 */
export function activeSaveKey(): string {
  return key;
}

/** 這個瀏覽器的存檔撐不撐得過關掉分頁（無痕／被擋時是 false） */
export function isDurable(): boolean {
  return durable;
}

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
    raw = store.getItem(key);
  } catch {
    raw = null;
  }
  return parseSave(raw, opts);
}

/** 回傳 false＝這次的進度**不會**留到下次開遊戲（配額滿、無痕、storage 被擋） */
export function save(state: GameState): boolean {
  try {
    store.setItem(key, JSON.stringify(state));
  } catch {
    // 配額滿或無痕模式：不擋遊戲，只是這一次沒存成功
    return false;
  }
  return durable;
}

export function clear(): void {
  try {
    store.removeItem(key);
  } catch {
    /* 清不掉就算了 */
  }
}
