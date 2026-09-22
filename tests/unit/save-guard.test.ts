import { beforeEach, describe, expect, it, vi } from 'vitest';

// storage.ts 在模組載入當下就決定要用 localStorage 還是記憶體版，
// 所以 stub 必須在 import 之前就位——vi.hoisted 會被提到所有 import 前面執行。
// 這裡要真的有一份共用的 localStorage，兩個「分頁」（兩份模組實例）才有東西可以搶。
const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    },
  });
  return m;
});

import { SAVE_KEY, BACKUP_SUFFIX } from '../../src/game/storage';
import { createNewSave, type GameState } from '../../src/game/state';

type Storage = typeof import('../../src/game/storage');

/** 開一個「新分頁」：獨立的模組實例（自己的 rev／備份分數），共用同一份 localStorage */
async function openTab(): Promise<Storage> {
  vi.resetModules();
  return import('../../src/game/storage');
}

function withProgress(score: number, coins = 100): GameState {
  const s = createNewSave({ seed: 7, now: 1_700_000_000_000 });
  s.coins = coins;
  s.stats = { ...s.stats, baths: score };
  return s;
}

beforeEach(() => mem.clear());

describe('D37 多分頁互蓋', () => {
  it('落後的分頁寫不進去，新分頁的進度留著', async () => {
    const stale = await openTab();
    stale.load(); // 舊分頁在早期就載入了（此時是空檔）

    const fresh = await openTab();
    fresh.load();
    expect(fresh.save(withProgress(40, 900))).toBe('saved');

    // 舊分頁被切回前景：settleOffline 把它那份過期狀態往前推，然後照常存檔
    expect(stale.save(withProgress(3, 10))).toBe('outdated');

    const onDisk = JSON.parse(localStorage.getItem(SAVE_KEY) as string) as GameState;
    expect(onDisk.coins).toBe(900);
    expect(onDisk.stats.baths).toBe(40);
  });

  it('過期的分頁之後每一次存檔都被擋（不是只擋第一次）', async () => {
    const stale = await openTab();
    stale.load();
    const fresh = await openTab();
    fresh.load();
    fresh.save(withProgress(40, 900));

    expect(stale.save(withProgress(3, 10))).toBe('outdated');
    expect(stale.save(withProgress(4, 11))).toBe('outdated');
    expect(stale.save(withProgress(5, 12))).toBe('outdated');
    expect((JSON.parse(localStorage.getItem(SAVE_KEY) as string) as GameState).coins).toBe(900);
  });

  it('同一個分頁連續存檔不會被自己的序號擋到', async () => {
    const tab = await openTab();
    tab.load();
    expect(tab.save(withProgress(1, 10))).toBe('saved');
    expect(tab.save(withProgress(2, 20))).toBe('saved');
    expect(tab.save(withProgress(3, 30))).toBe('saved');
    expect((JSON.parse(localStorage.getItem(SAVE_KEY) as string) as GameState).coins).toBe(30);
  });
});

describe('D37 備份格', () => {
  const backupKey = SAVE_KEY + BACKUP_SUFFIX;

  it('存了有進度的檔＝備份跟著有', async () => {
    const tab = await openTab();
    tab.load();
    tab.save(withProgress(12, 500));
    expect((JSON.parse(localStorage.getItem(backupKey) as string) as GameState).coins).toBe(500);
  });

  it('全新農場蓋不掉有進度的備份', async () => {
    const tab = await openTab();
    tab.load();
    tab.save(withProgress(12, 500));

    // 另一個分頁開了全新農場（進度分數 0），一路存下去
    const blank = await openTab();
    blank.load();
    blank.save(createNewSave({ seed: 7, now: 1 }));
    blank.save(createNewSave({ seed: 7, now: 2 }));

    expect((JSON.parse(localStorage.getItem(backupKey) as string) as GameState).coins).toBe(500);
  });

  it('主格被清空、備份還在＝讀檔自己還原回來', async () => {
    const tab = await openTab();
    tab.load();
    tab.save(withProgress(12, 500));

    localStorage.removeItem(SAVE_KEY); // 這次事故的形狀：主格不見了

    const next = await openTab();
    const r = next.load();
    expect(r.source).toBe('backup');
    expect(r.restored).toBe(true);
    expect(r.state.coins).toBe(500);
  });

  it('主格有進度時絕對不從備份還原（備份比較舊，還原＝把進度往回推）', async () => {
    const tab = await openTab();
    tab.load();
    tab.save(withProgress(12, 500)); // 備份停在這裡
    tab.save(withProgress(12, 800)); // 分數沒變＝備份不更新，主格繼續走

    const next = await openTab();
    const r = next.load();
    expect(r.source).toBe('main');
    expect(r.state.coins).toBe(800);
  });

  it('兩格都沒有＝全新農場', async () => {
    const tab = await openTab();
    const r = tab.load();
    expect(r.source).toBe('new');
    expect(r.restored).toBe(false);
  });
});

describe('D37 匯入覆蓋', () => {
  it('overwrite 是人的決定：就算這個分頁已經過期也寫得進去', async () => {
    const stale = await openTab();
    stale.load();
    const fresh = await openTab();
    fresh.load();
    fresh.save(withProgress(40, 900));
    expect(stale.save(withProgress(3, 10))).toBe('outdated');

    expect(stale.overwrite(withProgress(3, 77))).toBe('saved');
    expect((JSON.parse(localStorage.getItem(SAVE_KEY) as string) as GameState).coins).toBe(77);
  });

  it('匯入一份進度比較少的碼，不會順手毀掉現有的備份', async () => {
    const tab = await openTab();
    tab.load();
    tab.save(withProgress(40, 900));
    tab.overwrite(withProgress(1, 5));

    expect((JSON.parse(localStorage.getItem(SAVE_KEY + BACKUP_SUFFIX) as string) as GameState).coins).toBe(900);
  });
});

describe('D37 備份還原的下限', () => {
  it('備份的進度分數是 0（剛開始玩）也照樣還原——它仍然比一座全新農場好', async () => {
    const tab = await openTab();
    tab.load();
    const early = createNewSave({ seed: 7, now: 1_700_000_000_000 });
    early.coins = 250; // 有錢，但 stats 全 0 ⇒ progressScore 0
    expect(tab.progressScore(early)).toBe(0);
    tab.save(early);

    localStorage.removeItem(SAVE_KEY);

    const next = await openTab();
    const r = next.load();
    expect(r.source).toBe('backup');
    expect(r.state.coins).toBe(250);
  });
});

describe('D37 誰該贏', () => {
  it('不是先寫先贏：後開的分頁進度比較多時接手，不會被舊分頁鎖死', async () => {
    const stale = await openTab();
    stale.load();

    const active = await openTab();
    active.load();

    // 舊分頁搶先寫了一次（進度很少）
    expect(stale.save(withProgress(2, 10))).toBe('saved');
    // 正在玩的分頁進度多得多：要接手，不是被判出局
    expect(active.save(withProgress(50, 900))).toBe('saved');
    expect((JSON.parse(localStorage.getItem(SAVE_KEY) as string) as GameState).coins).toBe(900);

    // 反過來舊分頁才是被擋的那個
    expect(stale.save(withProgress(3, 11))).toBe('outdated');
    expect((JSON.parse(localStorage.getItem(SAVE_KEY) as string) as GameState).coins).toBe(900);
  });
});

describe('D37 進入存檔格要先接上它的序號', () => {
  it('?fresh=1 第二次開照樣存得進去（測試模式不呼叫 load，序號要由 useTestSave 接）', async () => {
    const first = await openTab();
    first.useTestSave(true);
    first.load();
    expect(first.save(withProgress(20, 300))).toBe('saved');

    // 下一場：一樣的網址再開一次。測試模式直接開新檔，不讀舊的，
    // 序號沒接上的話它會拿「全新農場」去跟自己上一場的存檔比進度，然後把自己判出局。
    const second = await openTab();
    second.useTestSave(true);
    expect(second.save(createNewSave({ seed: 7, now: 2 }))).toBe('saved');
    expect(second.save(createNewSave({ seed: 7, now: 3 }))).toBe('saved');
  });
});
