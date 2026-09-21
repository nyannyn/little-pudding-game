import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * 布丁外觀的幾何回歸鎖。
 *
 * 由來：使用者回報「小布丁的眼睛被拉長，澡盆裡才是正常狀態」。
 * 成因是閉眼動畫把 `eyes.scale.y` 設成**絕對值** 1，但那個節點在 GLB 裡的原始縮放是
 * 等比 0.1387 —— 等於把眼睛拉高 7.2 倍；泡澡時設的 0.12 剛好接近原始值，
 * 所以只有泡澡看起來是對的。
 *
 * 斷言用的是 `scale.y / scale.x` 這個比值，不是絕對數字：
 * 眼睛節點原本就是等比縮放，比值＝1 就代表沒有被單軸拉扯，
 * 之後換模型、改大小都不必改這條測試。
 */
async function eyeRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    let ratio = Number.NaN;
    window.__lpg.three!.scene.traverse((o) => {
      if (o.name === 'Pudding_Eyes' && Number.isNaN(ratio)) ratio = o.scale.y / o.scale.x;
    });
    return ratio;
  });
}

test('眼睛不會被單軸拉長；泡澡時才瞇起來', async ({ page }) => {
  test.setTimeout(120_000);
  // 8 倍速：泡澡 12 秒＝現實 1.5 秒，等 lerp 的 900ms 內布丁還在盆裡；20 倍會在量之前就泡完
  await page.goto('/?debug=1&fresh=1&seed=31&fastTime=8');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  // 讓 lerp 跑到穩定值
  await page.waitForTimeout(800);

  const resting = await eyeRatio(page);
  expect(resting).toBeGreaterThan(0.9);
  expect(resting).toBeLessThan(1.1);

  // 泡澡時要明顯瞇起來，否則「閉眼」這個演出等於沒做
  await page.getByRole('button', { name: '倒焦糖' }).click();
  await page.waitForFunction(
    () => (window.__lpg.state as GameState).puddings.some((p) => p.mode === 'bathing'),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(900);

  const bathing = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    const id = s.puddings.find((p) => p.mode === 'bathing')?.id;
    let ratio = Number.NaN;
    window.__lpg.three!.scene.traverse((o) => {
      // 泡澡那一隻的 view 是可見的那幾個裡面位置最低的；直接找全部取最小比值就夠
      if (o.name === 'Pudding_Eyes') {
        const r = o.scale.y / o.scale.x;
        if (Number.isNaN(ratio) || r < ratio) ratio = r;
      }
    });
    return { ratio, id };
  });
  expect(bathing.id).toBeTruthy();
  expect(bathing.ratio).toBeLessThan(0.5);
});
