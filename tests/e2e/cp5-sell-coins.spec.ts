import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * D42（2026-09-22 使用者要求「可愛的販售動畫 後金幣彈出撒在地上消失」）。
 *
 * 用 `?pause=1` 一幀一幀推：金幣整段只有一秒多，靠 wall clock 在無頭 SwiftShader 下抓不到。
 */
async function boot(page: Page, query: string) {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

const coinState = () =>
  ({
    count: (window.__lpg.three!.scene.getObjectByName('Coins') as { count: number }).count,
    visible: (window.__lpg.three!.scene.getObjectByName('Coins') as { visible: boolean }).visible,
    draw: window.__lpg.stats.drawCalls,
    coins: Math.floor((window.__lpg.state as GameState).coins),
  });

/**
 * D50 起販售口退役：金幣改在「賣給商店」（原料、蛋、布丁）時從櫃子前緣撒出來。
 * 真的從商店的賣出頁按下去——金幣演出接在事件上，按鈕那條路才是玩家會走的。
 */
test('在商店賣原料：金幣撒在地上、消失，然後整個 mesh 不再畫', async ({ page }) => {
  await boot(page, '/?debug=1&fresh=1&seed=31&pause=1');

  // 平時不該畫：這個演出大概只有 5% 的時間開著，預算不該被它長期佔一格
  const idle = await page.evaluate(coinState);
  expect(idle.visible).toBe(false);
  expect(idle.count).toBe(0);

  await page.evaluate(() => { (window.__lpg.state as GameState).ingredients.caramel = [6, 0, 0, 0, 0]; });
  await page.evaluate(() => window.__lpg.step!(0.05));
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="sell"]').click();
  await page.locator('[data-a="sellIng"][data-arg="caramel:1"]').click();
  await page.getByRole('button', { name: '關閉' }).click();

  let fired = -1;
  let peakDraw = 0;
  let peak = 0;
  for (let i = 0; i < 80; i++) {
    await page.evaluate(() => window.__lpg.step!(0.05));
    const st = await page.evaluate(coinState);
    peakDraw = Math.max(peakDraw, st.draw);
    peak = Math.max(peak, st.count);
    if (fired < 0 && st.count > 0) fired = i;
    if (fired >= 0 && st.count === 0 && i - fired > 3) break;
  }

  expect(fired).toBeGreaterThanOrEqual(0); // 有彈出來
  expect(peak).toBeLessThanOrEqual(6); // 一次 burst 的上限
  // 撒完之後要收乾淨，不可以留著一個空的 mesh 在畫
  const after = await page.evaluate(coinState);
  expect(after.count).toBe(0);
  expect(after.visible).toBe(false);
  expect(after.coins).toBe(30 + 6 * 6); // 開局 30 ＋ 焦糖塊 6 份 × 6
  // 演出期間也不可以吃掉預算
  expect(peakDraw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});
