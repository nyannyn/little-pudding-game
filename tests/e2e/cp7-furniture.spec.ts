import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * D49：家具長按拖曳＋倉庫。
 * 單元測試驗規則（`furniture.test.ts`）；這裡驗的是手勢真的走得通：
 * 長按 → 鏡頭不轉、家具跟著手指走 → 放手寫進 state；壓到別的家具就放回原位；
 * 倉庫卡收起有液體的澡盆要按兩次、收完再擺回來。
 */
async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

async function ready(page: Page, query: string) {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

function screen(page: Page, x: number, y: number, z: number) {
  return page.evaluate(([a, b, c]) => window.__lpg.toScreen!(a!, b!, c!), [x, y, z]);
}

/** 長按 `from`（區域座標＋高度）→ 拖到 `to`（地板上的區域座標）→ 放手；回傳拖曳途中量到的 draw calls */
async function longPressDrag(page: Page, from: [number, number, number], to: [number, number], planeY = 0) {
  const a = await screen(page, ...from);
  const b = await screen(page, to[0], planeY, to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(700); // LONG_PRESS_MS＝450
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await page.waitForTimeout(30);
  }
  const midDraw = await page.evaluate(() => window.__lpg.stats.drawCalls);
  const dragMesh = await page.evaluate(() => window.__lpg.three!.scene.getObjectByName('EquipmentDrag') !== undefined);
  await page.mouse.up();
  return { midDraw, dragMesh };
}

async function azimuth(page: Page) {
  return page.evaluate(() => {
    const { camera, controls } = window.__lpg.three!;
    return Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  });
}

test('長按販賣機拖到地板中間：鏡頭不轉、位置寫進 state、拖曳中 draw calls 在預算內', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4545');
  await page.evaluate(() => { const s = window.__lpg.state as GameState; s.coins = 99999; s.xp = 99999; });
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="seller"]').click();
  await page.getByRole('button', { name: '關閉' }).click();

  const before = await azimuth(page);
  // 販賣機預設在 (−0.14, 0.60)，按機身中段（高 0.3）
  const r = await longPressDrag(page, [-0.14, 0.3, 0.6], [0.35, -0.3]);
  expect(r.dragMesh).toBe(true); // 拖曳中是單獨一台 mesh
  expect(r.midDraw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

  const s = await state(page);
  const pos = s.equipmentPos[s.activeZone]?.seller;
  expect(pos).toBeDefined();
  expect(Math.abs(pos!.x - 0.35)).toBeLessThan(0.06);
  expect(Math.abs(pos!.z - -0.3)).toBeLessThan(0.06);
  // 拖曳中鏡頭不可以跟著轉（controls 有關掉）
  expect(Math.abs((await azimuth(page)) - before)).toBeLessThan(0.02);
  // 放手後併回單一設備 mesh
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('EquipmentDrag') === undefined)).toBe(true);
});

test('把澡盆拖到販賣機上：放不下，放回原位並說明原因', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4546');
  await page.evaluate(() => { const s = window.__lpg.state as GameState; s.coins = 99999; s.xp = 99999; });
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="seller"]').click();
  await page.getByRole('button', { name: '關閉' }).click();

  const s0 = await state(page);
  const b0 = s0.basins[0]!.pos;
  const stock0 = s0.stock.caramel;
  await longPressDrag(page, [b0.x, 0.05, b0.z], [-0.14, 0.55]);
  const s1 = await state(page);
  expect(s1.basins[0]!.pos).toEqual(b0);
  await expect(page.locator('.toast.bad').last()).toContainText('重疊');
  // 長按放手不能被當成點擊澡盆（那會倒掉一份焦糖）
  expect(s1.stock.caramel).toBe(stock0);
});

test('倉庫：有液體的澡盆要按兩次才收、液體倒掉；收完再擺回這一區', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4547');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.basins[0]!.liquid = 'milk';
    s.basins[0]!.units = 3;
  });
  const milk0 = (await state(page)).stock.milk;

  await page.getByRole('button', { name: '倉庫' }).click();
  const card = page.locator('.storecard');
  await expect(card).toBeVisible();
  const store = card.locator('[data-a="storeItem"][data-arg="basin:0"]');
  await store.click();
  await expect(store).toContainText('倒掉 3 份');
  expect((await state(page)).basins[0]!.zone).not.toBe('storage'); // 第一次只武裝
  await store.click();
  const s1 = await state(page);
  expect(s1.basins[0]!.zone).toBe('storage');
  expect(s1.basins[0]!.units).toBe(0);
  expect(s1.stock.milk).toBe(milk0); // 倒掉，不是退回庫存
  await expect(card.locator('.placed')).toContainText('這一區沒有家具');
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('BasinTubs') === undefined)).toBe(true);

  await card.locator('[data-a="placeItem"][data-arg="basin:0"]').click();
  const s2 = await state(page);
  expect(s2.basins[0]!.zone).toBe(s2.activeZone);
  await expect(card.locator('.stored')).toContainText('倉庫是空的');
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('BasinTubs') !== undefined)).toBe(true);
});

test('「櫥窗全住滿了」按 × 就永久關掉，重新整理也不再出現（2026-09-23 使用者回報關不掉）', async ({ page }) => {
  test.setTimeout(120_000);
  // `?pop=15`＝起始區住滿；開局就有牛乳庫存，所以住滿警告成立
  await ready(page, '/?debug=1&fresh=1&seed=4548&pop=15');
  const hint = page.locator('.hint');
  await expect(hint).toHaveAttribute('data-hint', /^zonefull:/);
  await expect(hint).toBeVisible();
  await hint.locator('[data-a="hintClose"]').click();
  await expect(hint).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(hint).toBeHidden();
});
