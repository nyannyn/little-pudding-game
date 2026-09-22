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

test('新手引導跟著玩家的進度走，買下第一台設備之後自己收掉', async ({ page }) => {
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

test('按「不再顯示提示」之後，重新整理也不會再出現', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=5');
  const hint = page.locator('.hint');
  await expect(hint).toBeVisible();

  await hint.locator('[data-a="hintOff"]').click();
  await expect(hint).toBeHidden();

  await boot(page, '/?fresh=1&seed=5');
  await expect(page.locator('.hint')).toBeHidden();
});

/**
 * D43（2026-09-22 使用者要求「要可以關閉，還要加一個按鈕可以不再出現提示」）。
 * 原本只有一顆 ×，語意是永久關閉——隨手按一下就把整條引導永遠關掉，而且沒有第二次機會。
 */
test('提示框兩顆鈕分工：× 只關這一則，換下一則照樣講', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=5&fastTime=20');
  const hint = page.locator('.hint');
  await expect(hint).toBeVisible();
  await expect(hint.locator('.who')).toHaveText('小提示');
  // aria-label 刻意不用「關閉」：getByRole 的 name 是子字串比對，會跟商店的「關閉」鈕撞
  await expect(hint.locator('[data-a="hintClose"]')).toHaveAttribute('aria-label', '收起這則提示');
  await expect(hint).toHaveAttribute('data-hint', 'pour');

  await hint.locator('[data-a="hintClose"]').click();
  await expect(hint).toBeHidden();

  // 換一則（倒下去 → 泡澡中）要重新出現：× 不是永久
  await page.getByRole('button', { name: '倒焦糖' }).click();
  await expect(hint).toBeVisible({ timeout: 40_000 });
  await expect(hint).not.toHaveAttribute('data-hint', 'pour');

  // 而且沒有寫進 localStorage：重新整理之後引導照常
  await boot(page, '/?fresh=1&seed=5&fastTime=20');
  await expect(page.locator('.hint')).toBeVisible();
});

test('警告類提示被 × 關掉只安靜一下就回來（農場停住不可以被永久靜音）', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=5');
  // 把存檔擺成「農場停住」：盆空、液體用完、布丁想泡澡
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.equipment[s.activeZone]!.autoFill = true;
    s.basins[0]!.units = 0;
    s.basins[0]!.liquid = null;
    s.basins[0]!.preferredLiquid = 'caramel';
    s.stock.caramel = 0;
    s.stock.milk = 0;
    for (const p of s.puddings) p.caramel = 0;
  });
  const hint = page.locator('.hint');
  await expect(hint).toHaveAttribute('data-hint', 'stalled', { timeout: 10_000 });

  await hint.locator('[data-a="hintClose"]').click();
  await expect(hint).toBeHidden();

  // 冷卻（`Hud.WARNING_SNOOZE_MS`＝45 秒真實時間）到了就再講一次。
  // 這一條刻意真的等——冷卻用 `performance.now()` 量，快轉遊戲時間騙不了它，
  // 而「農場停住不可以被永久靜音」正是 D39 修掉的那個洞，值得花這 45 秒。
  await expect(hint).toBeVisible({ timeout: 60_000 });
  await expect(hint).toHaveAttribute('data-hint', 'stalled');
});
