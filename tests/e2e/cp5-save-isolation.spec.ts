import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * 存檔的三條底線（2026-09-22）：
 *  1. 測試模式（`?fresh=1`）不可以碰玩家那一格——共用同一格時，在自己手機上開一次
 *     測試網址，五秒後真的進度就沒了（修之前實測過）。
 *  2. 自動存檔的間隔算**真實時間**：跟著被夾在 0.1 秒的 dt 累加的話，低 fps 的裝置
 *     （這裡的 SwiftShader 就是）會愈存愈稀，這條測試在此環境下本身就是那個回歸鎖。
 *  3. 存不進去（無痕／被擋）要講出來，不可以靜默失敗。
 */

const PLAYER_KEY = 'lpg.save.v1';
const TEST_KEY = 'lpg.save.test';

async function ready(page: Page, query: string) {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}

const read = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

test('測試模式不會覆蓋玩家的存檔，而且玩家那格 5 秒內就會寫進去', async ({ page }) => {
  // ① 玩家正常開一場，留一個認得出來的數字
  await ready(page, '/');
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 123456; });
  // 8 秒內一定要出現：間隔是 5 秒真實時間（吃 dt 的舊寫法在 SwiftShader 下要三倍久）
  await expect.poll(() => read(page, PLAYER_KEY), { timeout: 8_000 }).not.toBeNull();

  // ② 同一個瀏覽器用測試網址開一場。基準線要在**離開之後**才取：
  //    pagehide 會再存一次，取太早的話那次合法的存檔會被誤判成「被測試模式改掉」。
  await ready(page, '/?fresh=1&seed=31');
  const before = await read(page, PLAYER_KEY);
  expect(JSON.parse(before!).coins).toBe(123456);

  // 讓測試模式跑過一次自動存檔（5 秒）。它要是會寫到玩家那格，這段時間就寫進去了。
  await page.waitForTimeout(8_000);

  // ③ 玩家那一格必須逐字元一樣（比整份字串，不是只比 coins）
  expect(await read(page, PLAYER_KEY)).toBe(before);
  // 而且測試模式確實有存檔，只是存在自己那一格
  expect(await read(page, TEST_KEY)).not.toBeNull();

  // ④ 玩家再開一次，進度還在
  await ready(page, '/');
  expect(await page.evaluate(() => (window.__lpg.state as GameState).coins)).toBe(123456);
});

test('存不進去的瀏覽器會講出來，不是靜默歸零', async ({ browser }) => {
  const ctx = await browser.newContext();
  // 無痕／關掉網站資料的行為：寫入直接丟例外
  await ctx.addInitScript(() => {
    const boom = () => { throw new DOMException('denied', 'SecurityError'); };
    Object.defineProperty(window.localStorage, 'setItem', { value: boom, configurable: true });
  });
  const page = await ctx.newPage();
  await ready(page, '/');

  // 遊戲照樣要能玩（不是白畫面）
  expect(await page.evaluate(() => window.__lpg.stats.triangles)).toBeGreaterThan(0);
  await expect(page.locator('.toast.bad', { hasText: '存不了進度' })).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});
