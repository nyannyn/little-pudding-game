import { DRAW_CALL_BUDGET } from './helpers';
import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import type { GameState } from '../../src/game/state';

/**
 * 兩條「還沒在畫面上跑過」的進程：
 * ① 風味澡盆 → 抹茶布丁 → 抹茶原料（經營軸：養新物種才接得到新訂單）
 * ② 解鎖第二個櫥窗（同櫃上層與二號櫃）→ 鏡頭切過去、新住客自己生產
 *
 * 單元測試只驗規則，這裡驗的是「按得到、看得到、切得過去」。
 */
test.describe.configure({ mode: 'serial' });

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

async function ready(page: Page, query: string) {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

async function openShop(page: Page) {
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('.sheet .body').waitFor();
}
async function closeShop(page: Page) {
  await page.getByRole('button', { name: '關閉' }).click();
}

test('抹茶澡盆：第二個盆出現在櫥窗裡，泡到突變成抹茶布丁並產出抹茶原料', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?debug=1&fresh=1&seed=606&fastTime=40');
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 5000; });

  // ① 買澡盆 → 櫥窗裡真的多一個盆
  await openShop(page);
  await page.locator('[data-a="buyBasin"][data-arg="matcha"]').click();
  const bought = await state(page);
  expect(bought.ownedBasins).toContain('matcha');
  expect(bought.basins.filter((b) => b.zone === bought.activeZone)).toHaveLength(2);

  // ② 買抹茶湯（沒有澡盆時商店根本不會列這一項）
  await page.locator('[data-a="buyStock"][data-arg="matcha"]').click();
  await closeShop(page);
  expect((await state(page)).stock.matcha).toBe(BALANCE.stockBuyQty);

  // ③ 倒進抹茶盆——按鈕是買了澡盆之後才長出來的
  await page.getByRole('button', { name: '倒抹茶' }).click();
  const poured = await state(page);
  const matchaBasin = poured.basins.find((b) => b.preferredLiquid === 'matcha');
  expect(matchaBasin?.units).toBe(1);
  expect(matchaBasin?.liquid).toBe('matcha');

  // ④ 讓它一直有抹茶可泡（自動注液閥），泡滿 48 小時曝露就突變
  await openShop(page);
  await page.locator('[data-a="buyEquip"][data-arg="autoFill"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  await closeShop(page);
  await page.evaluate(() => { (window.__lpg.state as GameState).stock.matcha = 60; });

  await page.waitForFunction(
    () => (window.__lpg.state as GameState).puddings.some((p) => p.species === 'matcha'),
    null,
    { timeout: 180_000 },
  );
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-matcha.png' });

  // ⑤ 抹茶布丁產的是抹茶原料（D19：原料由物種決定）
  await page.waitForFunction(() => (window.__lpg.state as GameState).ingredients.matcha > 0, null, { timeout: 120_000 });
  const s = await state(page);
  expect(s.ingredients.matcha).toBeGreaterThan(0);
});

test('解鎖上層與二號櫥窗：鏡頭切過去，新住客自己開始生產', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page, '/?debug=1&fresh=1&seed=909&fastTime=30');
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 99999; });

  const start = await state(page);
  expect(start.zones.filter((z) => z.unlocked)).toHaveLength(1);
  // 只有一區時不顯示切換列
  await expect(page.locator('.zones')).toBeHidden();

  const camBefore = await page.evaluate(() => window.__lpg.three!.controls.target.y);

  // ① 解鎖上層
  await openShop(page);
  await page.locator('[data-a="unlockZone"]').click();
  await closeShop(page);

  const afterUnlock = await state(page);
  expect(afterUnlock.zones.filter((z) => z.unlocked)).toHaveLength(2);
  expect(afterUnlock.activeZone).toBe('c0t2');
  expect(afterUnlock.puddings.filter((p) => p.zone === 'c0t2')).toHaveLength(1);
  expect(afterUnlock.basins.filter((b) => b.zone === 'c0t2')).toHaveLength(1);

  // 鏡頭真的往上移了（不是只有資料變）
  await page.waitForFunction(
    (y) => window.__lpg.three!.controls.target.y > y + 1,
    camBefore,
    { timeout: 10_000 },
  );
  await expect(page.locator('.zones')).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-upper.png' });

  // ② 新住客在自己那一區生產（倒澡盆→泡澡→入庫）
  await openShop(page);
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="autoFill"]').click();
  await closeShop(page);
  await page.evaluate(() => { (window.__lpg.state as GameState).stock.caramel = 60; });
  await page.getByRole('button', { name: '倒焦糖' }).click();

  const bathsBefore = (await state(page)).stats.baths;
  await page.waitForFunction(
    (n) => (window.__lpg.state as GameState).puddings.some((p) => p.zone === 'c0t2' && p.bathHistory.length > 0)
      && (window.__lpg.state as GameState).stats.baths > n,
    bathsBefore,
    { timeout: 120_000 },
  );

  // ③ 解鎖到二號櫥窗，鏡頭橫向移過去
  await openShop(page);
  await page.locator('[data-a="unlockZone"]').click(); // 下層
  await closeShop(page);
  await openShop(page);
  await page.locator('[data-a="unlockZone"]').click(); // 二號櫥窗
  await closeShop(page);

  const four = await state(page);
  expect(four.zones.filter((z) => z.unlocked)).toHaveLength(4);
  expect(four.activeZone).toBe('c1t1');
  await page.waitForFunction(() => window.__lpg.three!.controls.target.x > 2, null, { timeout: 10_000 });
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-second-cabinet.png' });

  // ④ 切換列可以走回一號櫥窗
  await page.locator('[data-a="zoneStep"][data-arg="-1"]').click();
  expect((await state(page)).activeZone).not.toBe('c1t1');

  // ⑤ 全部解鎖後 draw calls 仍在預算內
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  test.info().annotations.push({ type: 'stats', description: JSON.stringify(stats) });
  expect(stats.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});
