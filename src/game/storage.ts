import { migrate, type GameState, type NewSaveOptions } from './state';

/** 玩家的存檔格 */
export const SAVE_KEY = 'lpg.save.v1';
/**
 * 測試模式的存檔格（`?fresh=1`）。
 * 分開不是為了乾淨，是因為共用同一格時「在自己手機上開一次測試網址」
 * 五秒後就會把玩家的進度覆蓋掉（2026-09-22 實測）。
 */
export const TEST_SAVE_KEY = 'lpg.save.test';
/**
 * 備份格的後綴（`lpg.save.v1.bak`）。
 * 主格被寫空、被清掉、或存檔壞掉時的第二份；只在進度**變多**時才更新，
 * 所以一份全新農場永遠蓋不掉一份有進度的備份。
 */
export const BACKUP_SUFFIX = '.bak';

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

/** 存進 localStorage 的東西＝`GameState` 再加一個寫入序號。`migrate()` 只挑認得的欄位，`rev` 不會進到遊戲狀態裡 */
type Stored = GameState & { rev?: number };

let key: string = SAVE_KEY;
let backupKey: string = SAVE_KEY + BACKUP_SUFFIX;
/** 這個分頁最後一次寫進（或讀到）的主格序號 */
let rev = 0;
/** 別的分頁已經寫得比我新＝我手上這份過期了，從此不准再碰主格 */
let outdated = false;
/** 備份格目前的進度分數；-1＝還沒有備份 */
let backupScore = -1;

/**
 * 接上目前這一格的序號與備份分數。
 *
 * **進入一個存檔格就一定要跑這個**，否則第一次 `save()` 會看到「storage 的序號比我大」，
 * 跟自己上一場的存檔比進度，然後把自己判成過期。`?fresh=1` 就是這樣：它不呼叫 `load()`，
 * 所以第二次開測試模式整場都不會存檔（序號沒接上，不是資料有問題）。
 */
function adoptSlot(): void {
  rev = readRev(readRaw(key));
  outdated = false;
  const backupRaw = readRaw(backupKey);
  const backup = backupRaw === null ? null : parseSave(backupRaw);
  backupScore = backup?.restored ? progressScore(backup.state) : -1;
}

function resetSlotState(): void {
  rev = 0;
  outdated = false;
  backupScore = -1;
}

/**
 * 切到測試模式：之後的 `load`／`save`／`clear` 全部走測試那一格（含它自己的備份格）。
 * 開場設定一次（`main.ts` 看 `?fresh=1`），中途不要改。
 */
export function useTestSave(on: boolean): void {
  key = on ? TEST_SAVE_KEY : SAVE_KEY;
  backupKey = key + BACKUP_SUFFIX;
  adoptSlot();
}

/** 目前在寫哪一格；測試與除錯用 */
export function activeSaveKey(): string {
  return key;
}

/** 這個瀏覽器的存檔撐不撐得過關掉分頁（無痕／被擋時是 false） */
export function isDurable(): boolean {
  return durable;
}

/**
 * 「這份存檔走了多遠」，用來決定誰有資格覆蓋誰。
 *
 * 只能用**單調遞增**的欄位：`xp` 與 `stats` 的累計次數只增不減。
 * 不可以用 `coins`（花得掉）也不可以用 `time`——過期分頁切回前景時
 * `settleOffline` 會把它的 `time` 一口氣往前推，拿時間當判準的話舊分頁反而會贏。
 */
export function progressScore(s: GameState): number {
  const st = s.stats;
  return s.xp + st.baths + st.sold + st.mutations + st.picked + st.crafted + st.births;
}

function readRaw(k: string): string | null {
  try {
    return store.getItem(k);
  } catch {
    return null;
  }
}

function writeRaw(k: string, value: string): boolean {
  try {
    store.setItem(k, value);
    return true;
  } catch {
    // 配額滿或無痕模式：不擋遊戲，只是這一次沒存成功
    return false;
  }
}

/**
 * 讀出序號。`JSON.stringify({ ...state, rev })` 一定把 `rev` 放在最後，
 * 所以先用字串比對抓（每 5 秒一次，不想為了一個數字解析整份存檔）；抓不到才整份解析。
 */
function readRev(raw: string | null): number {
  if (raw === null) return 0;
  const tail = /"rev":(\d+)\}\s*$/.exec(raw);
  if (tail) return Number(tail[1]);
  try {
    const n = (JSON.parse(raw) as Stored).rev;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export interface LoadResult {
  state: GameState;
  /** true＝真的讀到舊檔；false＝開了新檔 */
  restored: boolean;
  /** 這份狀態是哪來的：主格／備份格／全新 */
  source: 'main' | 'backup' | 'new';
}

/**
 * 讀檔。壞檔一律不拋例外——存檔壞掉還讓遊戲開不起來是最糟的結果。
 * 能救的欄位交給 `migrate()` 補，救不動就開新檔。
 */
export function parseSave(raw: string | null, opts: NewSaveOptions = {}): { state: GameState; restored: boolean } {
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
  const mainRaw = readRaw(key);
  rev = readRev(mainRaw);
  outdated = false;

  const main = parseSave(mainRaw, opts);

  const backupRaw = readRaw(backupKey);
  const backup = backupRaw === null ? null : parseSave(backupRaw, opts);
  backupScore = backup?.restored ? progressScore(backup.state) : -1;

  // 主格讀不到東西、備份裡卻有一份真的存檔：這是唯一會自己動手還原的情況。
  // 不看備份的分數——分數 0（剛開始玩，只有錢還沒有任何累計次數）的備份
  // 照樣比一座全新農場好。
  // 反過來（主格有、備份比較舊）絕對不能還原，那會把玩家的進度往回推。
  if (!main.restored && backup?.restored) {
    return { state: backup.state, restored: true, source: 'backup' };
  }
  return { state: main.state, restored: main.restored, source: main.restored ? 'main' : 'new' };
}

export type SaveOutcome =
  /** 寫進去了，而且撐得過關分頁 */
  | 'saved'
  /** 寫進去了，但只在記憶體裡（無痕／storage 被擋）＝關掉分頁就沒了 */
  | 'volatile'
  /** 沒寫：別的分頁有更新的進度，這份是過期的 */
  | 'outdated'
  /** 沒寫：配額滿或 setItem 丟例外 */
  | 'failed';

function write(state: GameState, force: boolean): SaveOutcome {
  if (!force) {
    if (outdated) return 'outdated';
    const raw = readRaw(key);
    // 序號只用來偵測「有別的分頁寫過」，不用來判誰對：序號大只代表寫得晚。
    if (readRev(raw) > rev) {
      // 誰該贏是看誰走得比較遠。用「先寫先贏」的話，被遺忘的舊分頁只要搶先一步
      // 就能把正在玩的那個分頁鎖死——那這個守衛本身就變成兇手了。
      const stored = raw === null ? null : parseSave(raw);
      if (stored?.restored && progressScore(stored.state) > progressScore(state)) {
        outdated = true;
        return 'outdated';
      }
      // 對方沒走得比較遠：接手它的序號繼續寫
      rev = readRev(raw);
    }
  } else {
    outdated = false;
    rev = Math.max(rev, readRev(readRaw(key)));
  }

  const next = rev + 1;
  const payload = JSON.stringify({ ...state, rev: next } satisfies Stored);
  if (!writeRaw(key, payload)) return 'failed';
  rev = next;

  // 備份只在進度變多時更新。用同一條分數規則擋住「過期分頁把主格和備份一起寫空」——
  // 備份要是用同一個無條件寫入器去寫，它就跟主格一起陪葬，等於沒有備份。
  const score = progressScore(state);
  if (score > backupScore && writeRaw(backupKey, payload)) backupScore = score;

  return durable ? 'saved' : 'volatile';
}

/**
 * 一般存檔（每 5 秒／切背景／關分頁）。
 * 進度比 localStorage 裡那份少的分頁寫不進去，而且一旦被擋就永遠不再寫這一格——
 * 都已經告訴玩家「這個分頁停止存檔了」，就不可以過一陣子又自己偷偷寫回去。
 */
export function save(state: GameState): SaveOutcome {
  return write(state, false);
}

/**
 * 玩家明確指定的覆蓋（匯入存檔碼）：跳過新舊比對，因為這是人的決定不是分頁的競爭。
 * 備份格照樣走分數規則，所以匯入一份比較舊的碼不會順手毀掉現有的備份。
 */
export function overwrite(state: GameState): SaveOutcome {
  return write(state, true);
}

/** 清掉這一格（含它的備份格） */
export function clear(): void {
  for (const k of [key, backupKey]) {
    try {
      store.removeItem(k);
    } catch {
      /* 清不掉就算了 */
    }
  }
  resetSlotState();
}

export interface StorageReport {
  key: string;
  durable: boolean;
  rev: number;
  outdated: boolean;
  mainBytes: number;
  backupBytes: number;
  backupScore: number;
}

/** `?debug=1` 用：下次再遇到「進度不見了」，要看得到事實而不是用猜的 */
export function storageReport(): StorageReport {
  return {
    key,
    durable,
    rev,
    outdated,
    mainBytes: readRaw(key)?.length ?? 0,
    backupBytes: readRaw(backupKey)?.length ?? 0,
    backupScore,
  };
}
