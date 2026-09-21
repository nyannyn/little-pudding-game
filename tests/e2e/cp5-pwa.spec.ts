import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * CP5：「加入主畫面」要拿得到的東西，與第一次進遊戲的引導。
 *
 * service worker 不在這裡測：它只在正式版註冊（dev 快取住 public/ 會讓 HMR 很難查），
 * 所以那一段由 `tools/smoke-live.mjs` 對真正的 Pages 網址驗。
 */
async function boot(page: Page, query = '/?fresh=1&seed=5') {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}

test('manifest 與 iOS 圖示齊全，且都用相對路徑（Pages 有 /repo/ 前綴）', async ({ page }) => {
  await boot(page);

  // 注意：dev server 會把相對 href 改寫成 /manifest.webmanifest，正式建置才保持相對。
  // 「Pages 子路徑下不會 404」這件事由 tools/smoke-live.mjs 對真網址驗，這裡只驗內容。
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
    const res = await fetch(link.href);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  });
  expect(manifest.status).toBe(200);
  expect(manifest.body.display).toBe('standalone');
  expect(manifest.body.orientation).toBe('portrait');
  expect(manifest.body.start_url).toBe('.');
  expect(manifest.body.scope).toBe('.');
  expect(Array.isArray(manifest.body.icons)).toBe(true);
  expect((manifest.body.icons as unknown[]).length).toBeGreaterThanOrEqual(2);

  // iOS 不讀 manifest 的 icons，只認 apple-touch-icon
  const iconStatus = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
    return (await fetch(link.href)).status;
  });
  expect(iconStatus).toBe(200);

  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6e7d2');
});

test('新手引導跟著玩家的進度走，按 × 之後不再出現', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=5&fastTime=20');

  const hint = page.locator('.hint');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-hint', 'pour');
  await expect(hint.locator('.t')).toContainText('倒焦糖');

  // 倒下去之後就不該還停在 pour 那一步
  // （斷言用 data-hint 不用文字：元素隱藏時 textContent 還在，用文字會以為沒變）
  await page.getByRole('button', { name: '倒焦糖' }).click();
  await expect(hint).not.toHaveAttribute('data-hint', 'pour', { timeout: 30_000 });

  // 買下第一台設備＝玩家懂了，提示自己收掉
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 9999; });
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(hint).toBeHidden();
});

test('按 × 關掉引導之後，重新整理也不會再出現', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=5');
  const hint = page.locator('.hint');
  await expect(hint).toBeVisible();

  await hint.locator('[data-a="hintOff"]').click();
  await expect(hint).toBeHidden();

  await boot(page, '/?fresh=1&seed=5');
  await expect(page.locator('.hint')).toBeHidden();
});
