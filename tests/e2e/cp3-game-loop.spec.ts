import { DRAW_CALL_BUDGET } from './helpers';
import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import type { GameState } from '../../src/game/state';

/**
 * AC3-1：整條遊戲迴圈在真的畫面上走得完。
 * 用 `?fastTime=` 把遊戲時間加速，`?fresh=1` 保證每次都從新檔開始，
 * `?seed=` 固定亂數。每一步都讀 `window.__lpg.state` 斷言具體值，不看畫面像不像。
 */
test.describe.configure({ mode: 'serial' });

const URL = '/?debug=1&fresh=1&seed=20260921&fastTime=20';

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

async function ready(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

/** 直接改 state 只用來「跳過前面的存錢階段」，不用來製造被斷言的結果 */
async function grantCoins(page: Page, n: number) {
  await page.evaluate((v) => { (window.__lpg.state as GameState).coins = v; }, n);
}

test('AC3-1 完整迴圈：倒澡盆→泡澡→掉原料→撿→賣→買設備→自動入庫', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);

  // ① 倒焦糖
  expect((await state(page)).basins[0]!.units).toBe(0);
  await page.getByRole('button', { name: '倒焦糖' }).click();
  const poured = await state(page);
  expect(poured.basins[0]!.units).toBe(1);
  expect(poured.basins[0]!.liquid).toBe('caramel');
  expect(poured.stock.caramel).toBe(BALANCE.startStock.caramel! - 1);

  // ② 布丁自己跳進去泡澡（沒有任何玩家操作）
  await page.waitForFunction(() => (window.__lpg.state as GameState).puddings.some((p) => p.mode === 'bathing'), null, { timeout: 60_000 });
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-bathing.png' });

  // ③ 泡完一次澡（泡澡本身不再產原料，D32）
  await page.waitForFunction(() => (window.__lpg.state as GameState).stats.baths >= 1, null, { timeout: 60_000 });

  // ④ 布丁自然掉東西（固定間隔，與泡澡無關）
  await page.waitForFunction(() => (window.__lpg.state as GameState).drops.length > 0, null, { timeout: 60_000 });
  const dropped = await state(page);
  expect(dropped.drops.length).toBeGreaterThan(0);
  expect(dropped.ingredients.caramel).toBe(0); // 還沒撿，庫存不該增加
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-drop.png' });

  // ⑤ 邊撿邊等，直到拿到一份「焦糖塊」。
  //    不能只等 kind==='ingredient' 出現在地上：掉落有 eggChance 的機率是蛋，
  //    地板上限只有 dropCap，連掉幾顆蛋就會把位置佔滿而**完全停止掉落**
  //    （真的會卡死，不是理論——這一關以前就是這樣逾時的）。
  //    玩家實際會做的事就是先撿一撿，所以測試也這樣做。
  for (let i = 0; i < 12; i++) {
    await page.getByRole('button', { name: '撿原料' }).click();
    const now = await state(page);
    if (now.ingredients.caramel >= 1) break;
    await page.waitForFunction(() => (window.__lpg.state as GameState).drops.length > 0, null, { timeout: 60_000 });
  }
  const picked = await state(page);
  expect(picked.drops.length).toBe(0);
  expect(picked.ingredients.caramel).toBeGreaterThanOrEqual(1);
  expect(picked.eggs).toBeGreaterThanOrEqual(0);

  // ⑥ 賣掉，金幣增加
  const beforeSell = picked.coins;
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="sell"]').click(); // D25：商店分頁，賣原料在「賣出」
  await page.getByRole('button', { name: /^\d+$/ }).first().waitFor();
  await page.locator('[data-a="sellIng"]').first().click();
  const sold = await state(page);
  expect(sold.coins).toBeGreaterThan(beforeSell);
  expect(sold.ingredients.caramel).toBe(0);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-shop.png' });

  // ⑦ 買「原料收集手」，之後原料直接入庫、地上恆空
  await grantCoins(page, 3000);
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="autoFill"]').click();
  await page.getByRole('button', { name: '關閉' }).click();
  const bought = await state(page);
  expect(bought.equipment.collector).toBe(true);

  const ingBefore = (await state(page)).ingredients.caramel;
  await page.waitForFunction(
    (n) => (window.__lpg.state as GameState).ingredients.caramel > n,
    ingBefore,
    { timeout: 90_000 },
  );
  expect((await state(page)).drops.length).toBe(0); // 收集手裝了就不會再堆在地上
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-automated.png' });
});

test('AC3-1b 牛乳澡就是繁殖：泡完多一隻，而且養得出鮮奶酪基因', async ({ page }) => {
  test.setTimeout(240_000);
  await ready(page);
  await grantCoins(page, 5000);

  // 只給牛乳：把焦糖庫存清掉，並讓自動注液閥一路補牛乳
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.stock.caramel = 0;
    s.stock.milk = 60;
  });
  await page.getByRole('button', { name: '倒牛乳' }).click();
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="autoFill"]').click();
  await page.getByRole('button', { name: '關閉' }).click();

  // D34：牛奶澡＝繁殖。泡完就要多一隻，而且子代有機率被牛奶推成鮮奶酪系
  await page.waitForFunction(
    () => (window.__lpg.state as GameState).stats.births > 0,
    null,
    { timeout: 120_000 },
  );
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-milk-birth.png' });

  await page.waitForFunction(
    () => (window.__lpg.state as GameState).puddings.some((p) => p.genes.includes('panna')),
    null,
    { timeout: 180_000 },
  );
  const s = await state(page);
  // D34：牛乳不再造成母體突變，而是生出帶鮮奶酪基因的下一代
  expect(s.stats.births).toBeGreaterThanOrEqual(1);
  expect(s.puddings.some((p) => p.genes.includes('panna'))).toBe(true);
  expect(s.stats.mutations).toBe(0);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-milk-panna.png' });
});

test('AC3-2 效能不退步：整場（含設備與掉落物）draw calls 仍在預算內', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  // 把所有設備都買下來、地板堆滿掉落物——這是 draw call 的最壞情況
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999;
    for (const k of Object.keys(s.equipment)) s.equipment[k as keyof typeof s.equipment] = true;
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 3;
    s.equipment.collector = false; // 收集手會把掉落物收走，這裡要留著它們
    s.drops = [0, 1, 2, 3, 4].map((i) => ({
      id: `d${i}`,
      zone: s.activeZone, kind: 'ingredient' as const,
      species: (['caramel', 'panna', 'matcha', 'strawberry'] as const)[i % 4]!,
      pos: { x: -0.3 + i * 0.15, z: 0.2 },
      bornAt: s.time,
    }));
  });
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  test.info().annotations.push({ type: 'stats', description: JSON.stringify(stats) });
  expect(stats.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-worst-case.png' });
});
