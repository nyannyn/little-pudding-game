import { expect, test } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * 切到背景再回來，那段時間不能白白消失。
 *
 * 手機上這是常態不是例外：接個訊息回來就過了十分鐘。
 * 每幀的 dt 被夾在 0.1 秒（避免一幀跑掉整個世界），所以沒有「回前景補跑」
 * 這段時間就整段不見——而且畫面上看不出來，只有數字會少。
 *
 * 這裡不真的把分頁切到背景：無頭 chromium 的 `bringToFront()` 不會把
 * `document.visibilityState` 改成 hidden（實測過），而且背景時 rAF 照跑，
 * 測不出差別。改成直接驗處理器本身的行為——把 `lastSeenAt` 推到過去，
 * 送一個 visibilitychange，遊戲時間必須跟著補上去。
 */
test('回到前景會依 lastSeenAt 補跑背景那段時間', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?fresh=1&seed=7&fastTime=1');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });

  // 讓生產線自己跑得下去，補跑才有東西可跑
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.stock.caramel = 200;
    s.equipment.autoFill = true;
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.preferredLiquid = 'caramel';
    s.basins[0]!.units = 3;
  });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    return { time: s.time, baths: s.stats.baths };
  });

  const AWAY_SEC = 600;
  await page.evaluate((sec) => {
    const s = window.__lpg.state as GameState;
    s.lastSeenAt = Date.now() - sec * 1000; // 假裝離開了 10 分鐘
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, AWAY_SEC);
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    return { time: s.time, baths: s.stats.baths };
  });
  const gained = after.time - before.time;
  test.info().annotations.push({ type: 'gained', description: `${gained.toFixed(1)}s` });

  // 負向對照：把 visibilitychange 裡的 settleOffline 拿掉，gained 會掉到 1 秒以下。
  expect(gained).toBeGreaterThan(AWAY_SEC * 0.95);
  expect(gained).toBeLessThan(AWAY_SEC + 30);
  expect(after.baths).toBeGreaterThan(before.baths);
});
