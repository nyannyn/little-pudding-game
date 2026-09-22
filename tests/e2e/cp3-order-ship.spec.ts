import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import type { GameState } from '../../src/game/state';

/**
 * 2026-09-22 使用者回報：「焦糖布丁塔任務出貨後沒有解開任務獲得獎勵」。
 *
 * 這條鎖的是**按鈕那條路**，不是規則。原本的 bug 就在 `main.ts` 的 ship handler
 * 自己抄了一份少了「訂單預留量」的販售邏輯——規則層的單元測試全綠，
 * 但玩家按下去就是湊不到第二份。所以這裡一定要真的去點那顆「出貨」。
 */
const URL = '/?debug=1&fresh=1&seed=20260922&fastTime=1';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

/** 直接塞一張訂單與甜點，跳過前面的生產階段（被斷言的結果仍由產品程式碼算） */
async function setup(page: Page, desserts: number, qty: number) {
  await page.evaluate(
    ({ desserts: d, qty: q, ttl }) => {
      const s = window.__lpg.state as GameState;
      s.desserts.caramel = d;
      s.orders = [
        { id: 'test-order', species: 'caramel', qty: q, price: 500, createdAt: s.time, expiresAt: s.time + ttl },
      ];
    },
    { desserts, qty, ttl: BALANCE.orderTtlSec },
  );
}

test('訂單要 ×2 時，按出貨不可以把湊到一半的甜點賣掉', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(URL);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });

  await setup(page, 1, 2);
  const before = await state(page);

  await page.getByRole('button', { name: '出貨' }).click();
  await page.waitForTimeout(400);

  const after = await state(page);
  expect(after.desserts.caramel).toBe(1); // 留著等第二份，不可以被賣掉
  expect(after.orders).toHaveLength(1);
  expect(after.coins).toBe(before.coins);

  // 湊到第二份再按一次 → 這次要交貨並拿到訂單價
  await page.evaluate(() => { (window.__lpg.state as GameState).desserts.caramel = 2; });
  await page.getByRole('button', { name: '出貨' }).click();
  await page.waitForTimeout(400);

  const done = await state(page);
  expect(done.orders).toHaveLength(0);
  expect(done.desserts.caramel).toBe(0);
  expect(done.coins).toBe(before.coins + 500);
});

test('沒有訂單時按出貨照樣把甜點全賣掉（別把甜點鎖在庫存裡）', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(URL);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });

  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.desserts.caramel = 3;
    s.orders = [];
  });
  const before = await state(page);

  await page.getByRole('button', { name: '出貨' }).click();
  await page.waitForTimeout(400);

  const after = await state(page);
  expect(after.desserts.caramel).toBe(0);
  expect(after.coins).toBeGreaterThan(before.coins);
});
