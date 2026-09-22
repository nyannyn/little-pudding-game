import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * 繪圖環境被系統回收（2026-09-22，D44）。
 *
 * 起因：使用者回報「這個存檔的世界視圖壞掉了，布丁跟箱子不見」，還把存檔碼給了出來。
 * 那串碼匯進本機與線上都跑得好好的——壞的不是存檔，是 iPhone 切去別的 App 之後
 * 把 WebGL 的繪圖環境收走了：HUD 照常在動、訂單照常跳，3D 卻只剩背景色。
 *
 * 這裡守三件事：講出來、停迴圈、還原得回去。
 */

const PLAYER_KEY = 'lpg.save.v1';

async function ready(page: Page, query = '/') {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  for (const sel of ['[data-a="closeA2hs"]', '[data-a="closeWelcome"]']) {
    const btn = page.locator(sel);
    if (await btn.isVisible()) await btn.click();
  }
}

/** 抓住擴充功能再弄丟 context：弄丟之後 `getExtension` 就拿不到了 */
async function loseContext(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
    const ext = gl.getExtension('WEBGL_lose_context') as { loseContext(): void; restoreContext(): void };
    (window as unknown as { __glExt: typeof ext }).__glExt = ext;
    ext.loseContext();
  });
}

const restoreContext = (page: Page) =>
  page.evaluate(() => (window as unknown as { __glExt: { restoreContext(): void } }).__glExt.restoreContext());

const timeOf = (page: Page) => page.evaluate(() => (window.__lpg.state as GameState).time);
const envUuid = (page: Page) => page.evaluate(() => window.__lpg.three!.scene.environment?.uuid ?? null);

test('繪圖環境被收走：講出來、停住、還原得回去', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 31337; });
  const envBefore = await envUuid(page);
  expect(envBefore).not.toBeNull();

  await loseContext(page);

  // ① 講出來：不講的話玩家看到的就是「布丁跟箱子不見」，只能以為存檔壞了
  const card = page.locator('.welcome.glcard');
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toContainText('重新整理');

  // ② 先存檔：iOS 收掉繪圖環境之後常常連分頁一起丟掉
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), PLAYER_KEY)) ?? '{}').coins).toBe(31337);

  // ③ 停住：畫不出東西還繼續跑只是在耗電（世界時間不再前進）
  const frozen = await timeOf(page);
  await page.waitForTimeout(1200);
  expect(await timeOf(page)).toBe(frozen);

  // ④ 還原：環境貼圖要重做（PMREM 的內容在 GPU 上，跟著 context 一起沒了）
  await restoreContext(page);
  await expect(card).toBeHidden({ timeout: 10_000 });
  const envAfter = await envUuid(page);
  expect(envAfter).not.toBeNull();
  expect(envAfter).not.toBe(envBefore);

  // ⑤ 真的又在畫了
  await expect.poll(() => timeOf(page), { timeout: 10_000 }).toBeGreaterThan(frozen);
  await expect.poll(() => page.evaluate(() => window.__lpg.stats.drawCalls), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp5-context-restored.png' });
});
