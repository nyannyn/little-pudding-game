import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * 存檔碼與備份格（2026-09-22，D37）。
 *
 * 起因：使用者在 iPhone Safari 上整份進度不見了，兩個分頁都只剩全新農場。
 * 事後查得出來的事實是「主格讀不到」，查不出誰清掉的——所以這裡守的不是某個成因，
 * 是三條退路：碼帶得走、備份撈得回來、過期的分頁不准再寫。
 */

const PLAYER_KEY = 'lpg.save.v1';
const BACKUP_KEY = 'lpg.save.v1.bak';

async function ready(page: Page, query = '/') {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  // 「加到主畫面」與「歡迎回來」是滿版卡片，不關掉會蓋住頂列的存檔鈕
  for (const sel of ['[data-a="closeA2hs"]', '[data-a="closeWelcome"]']) {
    const btn = page.locator(sel);
    if (await btn.isVisible()) await btn.click();
  }
}

const read = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const coinsOf = (page: Page) => page.evaluate(() => (window.__lpg.state as GameState).coins);

async function openSaveCard(page: Page) {
  await page.click('[data-a="settings"]');
  await expect(page.locator('.savecard')).toBeVisible();
}

/** 存一個認得出來的數字，並等它真的落到 localStorage（自動存檔是 5 秒真實時間） */
async function playAndSave(page: Page, coins: number) {
  await page.evaluate((c) => { (window.__lpg.state as GameState).coins = c; }, coins);
  await expect
    .poll(async () => JSON.parse((await read(page, PLAYER_KEY)) ?? '{}').coins, { timeout: 12_000 })
    .toBe(coins);
}

test('存檔碼把進度搬到另一個瀏覽器（＝換手機也帶得走）', async ({ browser }) => {
  const oldPhone = await browser.newContext();
  const a = await oldPhone.newPage();
  await ready(a);
  await playAndSave(a, 777777);

  await openSaveCard(a);
  await a.screenshot({ path: 'tests/e2e/__screenshots__/cp5-savecode-card.png' });
  const code = await a.locator('.savecard .code').inputValue();
  expect(code.startsWith('LPG1.')).toBe(true);
  console.log(`[savecode] 存檔碼長度 ${code.length} 字元`);
  await oldPhone.close();

  // 另一個 context＝乾淨的 localStorage，等同換一支手機
  const newPhone = await browser.newContext();
  const b = await newPhone.newPage();
  await ready(b);
  expect(await coinsOf(b)).not.toBe(777777);

  await openSaveCard(b);
  await b.fill('.savecard .code', code);
  await Promise.all([b.waitForEvent('load'), b.click('[data-a="restoreSave"]')]);
  await b.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });

  expect(await coinsOf(b)).toBe(777777);
  await newPhone.close();
});

test('壞掉的存檔碼會講出來，而且不動現有進度', async ({ page }) => {
  await ready(page);
  await playAndSave(page, 555);

  await openSaveCard(page);
  await page.fill('.savecard .code', 'LPG1.這串是亂打的.0000');
  await page.click('[data-a="restoreSave"]');

  await expect(page.locator('.toast.bad', { hasText: '不完整' })).toBeVisible();
  expect(await coinsOf(page)).toBe(555);
  expect(JSON.parse((await read(page, PLAYER_KEY)) ?? '{}').coins).toBe(555);
});

test('主存檔不見了，讀檔會從備份格撈回來', async ({ page }) => {
  await ready(page);
  await playAndSave(page, 424242);
  await expect.poll(() => read(page, BACKUP_KEY), { timeout: 12_000 }).not.toBeNull();

  // 這次事故的形狀：主格空了，備份還在。
  // 刪完還要把這一頁的 setItem 停掉——不然離開前的 pagehide 會照常存一次，
  // 主格馬上又長回來，這條測試就測不到備份那條路徑了（第一版就是這樣假綠）。
  await page.evaluate((k) => {
    localStorage.removeItem(k);
    Object.defineProperty(window.localStorage, 'setItem', { value: () => {}, configurable: true });
  }, PLAYER_KEY);

  // 這裡不能用 ready()：它會把卡片關掉，而要驗的就是那張卡片
  await page.goto('/');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  expect(await coinsOf(page)).toBe(424242);
  await expect(page.locator('.welcome:not(.a2hs)', { hasText: '已經從備份幫你還原進度' })).toBeVisible();
});

test('開著沒關的舊分頁不會把新分頁的進度洗掉', async ({ context }) => {
  const stale = await context.newPage();
  await ready(stale);
  await playAndSave(stale, 100);

  const fresh = await context.newPage();
  await ready(fresh);
  // 誰該贏是比進度分數，不是比誰先寫，所以這裡要讓新分頁真的走得比較遠
  await fresh.evaluate(() => window.__lpg.grantXp?.(500));
  await playAndSave(fresh, 900900);

  // 舊分頁被切回前景，照它手上那份過期狀態繼續玩
  await stale.bringToFront();
  await stale.evaluate(() => { (window.__lpg.state as GameState).coins = 1; });

  // 兩個自動存檔週期都過去了，主格還是新分頁那份
  // 先等提示出現再比存檔：toast 2.6 秒就消失，先睡 12 秒的話一定抓不到
  await expect(stale.locator('.toast.bad', { hasText: '已停止存檔' })).toBeVisible({ timeout: 20_000 });
  expect(JSON.parse((await read(stale, PLAYER_KEY)) ?? '{}').coins).toBeGreaterThanOrEqual(900900);
});
