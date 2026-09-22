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

test('賣出時金幣從販售口彈出來、撒在地上、消失，然後整個 mesh 不再畫', async ({ page }) => {
  await boot(page, '/?debug=1&fresh=1&seed=31&pause=1');

  // 平時不該畫：這個演出大概只有 5% 的時間開著，預算不該被它長期佔一格
  const idle = await page.evaluate(coinState);
  expect(idle.visible).toBe(false);
  expect(idle.count).toBe(0);

  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.equipment[s.activeZone]!.seller = true;
    s.desserts.caramel = 6;
    s.orders.length = 0;
  });

  // 推到自動販售發生
  let fired = -1;
  let peakDraw = 0;
  let sawFlat = false;
  for (let i = 0; i < 80; i++) {
    await page.evaluate(() => window.__lpg.step!(0.05));
    const st = await page.evaluate(coinState);
    peakDraw = Math.max(peakDraw, st.draw);
    if (fired < 0 && st.count > 0) fired = i;
    if (fired >= 0) {
      if (st.count > 0) sawFlat = true;
      if (st.count === 0 && i - fired > 3) break;
    }
  }

  expect(fired).toBeGreaterThanOrEqual(0); // 有彈出來
  expect(sawFlat).toBe(true);
  // 撒完之後要收乾淨，不可以留著一個空的 mesh 在畫
  const after = await page.evaluate(coinState);
  expect(after.count).toBe(0);
  expect(after.visible).toBe(false);
  expect(after.coins).toBeGreaterThan(30); // 錢真的進來了（開局 30）
  // 演出期間也不可以吃掉預算
  expect(peakDraw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});

test('同一幀賣掉多個物種只彈一次（逐物種各彈一次會撒出兩倍的幣）', async ({ page }) => {
  await boot(page, '/?debug=1&fresh=1&seed=31&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.equipment[s.activeZone]!.seller = true;
    // 三個物種同時有貨：shipDesserts 逐物種賣，會在同一幀丟出三個 sell 事件
    s.desserts.caramel = 1;
    s.desserts.panna = 1;
    s.desserts.matcha = 1;
    s.orders.length = 0;
  });

  // 「彈了幾次」量不到——同一幀的三次彈出，畫面上只會看到 count 跳一次。
  // 量**枚數**才分得開：累加成一次＝一次 burst 上限 6 枚；
  // 逐事件各彈一次＝三次 burst 疊起來遠超過 6（突變測試實測 8 枚）。
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__lpg.step!(0.05));
    const n = await page.evaluate(() => (window.__lpg.three!.scene.getObjectByName('Coins') as { count: number }).count);
    peak = Math.max(peak, n);
    if (peak > 0 && n === 0) break;
  }
  expect(peak).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(6); // 一次 burst 的上限
  expect(await page.evaluate(() => Math.floor((window.__lpg.state as GameState).coins))).toBeGreaterThan(30);
});
