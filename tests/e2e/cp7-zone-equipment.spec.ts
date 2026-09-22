import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * D45：自動化設備每一區各買各的。
 * 起始區買了收集手 → 解鎖上層：設備頁那張卡要回到「可買」、畫面上這一層沒有設備 mesh、
 * 商店要講清楚現在買的裝在哪一區；切回起始區，那張卡又是「已安裝」、設備 mesh 又回來。
 * 單元測試只驗規則，這裡驗的是「看得到、買得到、不會被舊區的東西誤導」。
 */
async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

async function ready(page: Page, query: string) {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

async function openShop(page: Page, tab: 'equipment' | 'zone') {
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('.sheet .body').waitFor();
  await page.locator(`[data-a="shopTab"][data-arg="${tab}"]`).click();
}

async function closeShop(page: Page) {
  await page.getByRole('button', { name: '關閉' }).click();
}

/** 畫面上這一區有幾件設備 mesh（`EquipmentView.sync` 只畫玩家正在看的那一區自己的設備） */
async function equipmentMeshCount(page: Page): Promise<number> {
  // 等一幀讓 sync 跑過
  await page.waitForTimeout(200);
  return page.evaluate(() => window.__lpg.three!.scene.getObjectByName('Equipment')!.children.length);
}

test('解鎖上層之後設備要重買：卡片回到可買、這一層沒有設備 mesh、切回起始區又是已安裝', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4444');
  await page.evaluate(() => { const s = window.__lpg.state as GameState; s.coins = 99999; s.xp = 99999; });

  // ① 起始區買收集手＋注液閥
  await openShop(page, 'equipment');
  await expect(page.locator('.sheet .note')).toContainText('中層');
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="autoFill"]').click();
  await expect(page.locator('.card[data-id="equip:collector"]')).toHaveAttribute('data-status', 'owned');
  await closeShop(page);
  const s1 = await state(page);
  expect(s1.equipment[s1.activeZone]!.collector).toBe(true);
  expect(await equipmentMeshCount(page)).toBeGreaterThan(0);

  // ② 解鎖上層：鏡頭切過去，設備頁那兩張卡回到「可買」，這一層畫面上沒有設備
  await openShop(page, 'zone');
  await page.locator('[data-a="unlockZone"][data-arg="c0t2"]').click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await expect(page.locator('.sheet .note')).toContainText('上層');
  await expect(page.locator('.card[data-id="equip:collector"]')).toHaveAttribute('data-status', 'available');
  await expect(page.locator('.card[data-id="equip:autoFill"]')).toHaveAttribute('data-status', 'available');
  await closeShop(page);
  const s2 = await state(page);
  expect(s2.activeZone).toBe('c0t2');
  expect(s2.equipment.c0t2!.collector).toBe(false);
  expect(s2.equipment.c0t1!.collector).toBe(true);
  expect(await equipmentMeshCount(page)).toBe(0);

  // ③ 在上層再買一台收集手：再扣一次原價，只有上層多了它
  await openShop(page, 'equipment');
  const price = await page.locator('.card[data-id="equip:collector"] button.buy').textContent();
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  await expect(page.locator('.card[data-id="equip:collector"]')).toHaveAttribute('data-status', 'owned');
  await closeShop(page);
  const s3 = await state(page);
  expect(s3.equipment.c0t2!.collector).toBe(true);
  expect(s3.equipment.c0t2!.autoFill).toBe(false);
  expect(s2.coins - s3.coins).toBe(Number(price)); // 再買一次是原價
  expect(await equipmentMeshCount(page)).toBeGreaterThan(0);

  // ④ 切回起始區：那邊的兩台還在
  await page.locator('[data-a="zoneStep"][data-arg="1"]').click();
  await page.waitForFunction(() => (window.__lpg.state as GameState).activeZone === 'c0t1');
  await openShop(page, 'equipment');
  await expect(page.locator('.sheet .note')).toContainText('中層');
  await expect(page.locator('.card[data-id="equip:collector"]')).toHaveAttribute('data-status', 'owned');
  await expect(page.locator('.card[data-id="equip:autoFill"]')).toHaveAttribute('data-status', 'owned');
  await closeShop(page);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp7-zone-equipment.png' });
});
