import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * D49：家具擺放模式＋倉庫（照一般手機經營遊戲的做法）。
 * 單元測試驗規則（`furniture.test.ts`）；這裡驗的是手勢與按鈕真的走得通：
 * 長按 → 拿起來（鏡頭不轉、家具跟著手指走）→ 放手仍在擺放模式 → 按「確定」才寫進 state；
 * 壓到別的家具「確定」按不下去；「收進倉庫」有液體要先確認；倉庫格子有圖、點了直接進擺放模式。
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

/**
 * 長按 `from`（區域座標＋高度）→ 把抓的那一點拖到 `to` 正上方同一高度 → 放手；回傳拖曳途中量到的 draw calls。
 * 拖曳平面是抓取點的高度（不是地板），家具中心保持與抓取點的偏移，所以終點誤差≈打點與中心的水平距離。
 */
async function longPressDrag(page: Page, from: [number, number, number], to: [number, number]) {
  const a = await screen(page, ...from);
  const b = await screen(page, to[0], from[1], to[1]);
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

/** 擺放模式的按鈕列 */
function editBar(page: Page) {
  return page.locator('.editbar');
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

  // 放手之後還在擺放模式，state 還沒動；按「確定」才寫入
  await expect(editBar(page)).toBeVisible();
  const mid = await state(page);
  expect(mid.equipmentPos[mid.activeZone]?.seller).toBeUndefined();
  await editBar(page).locator('[data-a="editOk"]').click();
  await expect(editBar(page)).toBeHidden();
  const s = await state(page);
  const pos = s.equipmentPos[s.activeZone]?.seller;
  expect(pos).toBeDefined();
  // 打點在機身正面（z≈0.66），中心在 0.60：終點會差這 0.06 上下
  expect(Math.abs(pos!.x - 0.35)).toBeLessThan(0.1);
  expect(Math.abs(pos!.z - -0.3)).toBeLessThan(0.1);
  // 拖曳中鏡頭不可以跟著轉（controls 有關掉）
  expect(Math.abs((await azimuth(page)) - before)).toBeLessThan(0.02);
  // 放手後併回單一設備 mesh
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('EquipmentDrag') === undefined)).toBe(true);
});

test('把澡盆拖到販賣機上：「確定」按不下去，取消就回原位', async ({ page }) => {
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
  await expect(editBar(page).locator('[data-a="editOk"]')).toBeDisabled();
  await editBar(page).locator('[data-a="editCancel"]').click();
  await expect(editBar(page)).toBeHidden();
  const s1 = await state(page);
  expect(s1.basins[0]!.pos).toEqual(b0);
  // 長按放手不能被當成點擊澡盆（那會倒掉一份焦糖）
  expect(s1.stock.caramel).toBe(stock0);
});

test('倉庫：長按澡盆→收進倉庫要確認倒掉；倉庫格子有圖，點了直接可拖、按確定才擺好', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4547');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.basins[0]!.liquid = 'milk';
    s.basins[0]!.units = 3;
    // 餵飽：不然長按那 0.7 秒內布丁會跳進盆泡掉一份，份數就不是 3 了（全跑時實際發生過）
    for (const p of s.puddings) p.caramel = 100;
  });
  const s0 = await state(page);
  const b0 = s0.basins[0]!.pos;

  // 長按（不移動）→ 擺放模式 → 收進倉庫 → 確認卡
  const a = await screen(page, b0.x, 0.05, b0.z);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(editBar(page)).toBeVisible();
  await editBar(page).locator('[data-a="editStore"]').click();
  const confirm = page.locator('.confirmcard');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('3 份');
  expect((await state(page)).basins[0]!.zone).not.toBe('storage'); // 還沒確認
  await confirm.locator('[data-a="confirmYes"]').click();
  const s1 = await state(page);
  expect(s1.basins[0]!.zone).toBe('storage');
  expect(s1.basins[0]!.units).toBe(0);
  expect(s1.stock.milk).toBe(s0.stock.milk); // 倒掉，不是退回庫存
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('BasinTubs') === undefined)).toBe(true);

  // 倉庫卡：只有倉庫裡的東西，一格一張圖
  await page.getByRole('button', { name: '倉庫' }).click();
  const card = page.locator('.storecard');
  const tile = card.locator('.stile[data-arg="basin:0"]');
  await expect(tile).toBeVisible();
  await expect(tile.locator('img.main')).toHaveAttribute('src', /bathtub/);
  expect(await tile.locator('img.main').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // 點了：卡片收掉、直接進擺放模式（沒有「收進倉庫」鈕）、畫面上看得到那個盆，但 state 還在倉庫
  await tile.click();
  await expect(card).toBeHidden();
  await expect(editBar(page)).toBeVisible();
  await expect(editBar(page).locator('[data-a="editStore"]')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('BasinTubs') !== undefined)).toBe(true);
  expect((await state(page)).basins[0]!.zone).toBe('storage');

  // 不用長按就能拖：往右拖一段再確定
  const p0 = await screen(page, -0.52, 0.05, 0.12);
  const p1 = await screen(page, 0.1, 0.05, -0.3);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(p0.x + ((p1.x - p0.x) * i) / 10, p0.y + ((p1.y - p0.y) * i) / 10);
  await page.mouse.up();
  await editBar(page).locator('[data-a="editOk"]').click();
  await expect(editBar(page)).toBeHidden();
  const s2 = await state(page);
  expect(s2.basins[0]!.zone).toBe(s2.activeZone);
  expect(Math.abs(s2.basins[0]!.pos.x - 0.1)).toBeLessThan(0.1);
  expect(Math.abs(s2.basins[0]!.pos.z - -0.3)).toBeLessThan(0.1);

  // 倉庫空了：只顯示「倉庫是空的」
  await page.getByRole('button', { name: '倉庫' }).click();
  await expect(card.locator('.sgrid')).toHaveText('倉庫是空的');
});

test('從倉庫拿出來又按取消：東西還在倉庫', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4550');
  await page.evaluate(() => { const s = window.__lpg.state as GameState; s.storedEquipment.crafter = 1; });
  await page.getByRole('button', { name: '倉庫' }).click();
  const tile = page.locator('.storecard .stile[data-arg="eq:crafter"]');
  await expect(tile.locator('img.main')).toHaveAttribute('src', /eqCrafter/);
  await tile.click();
  await expect(page.locator('.editbar')).toBeVisible();
  await page.locator('.editbar [data-a="editCancel"]').click();
  const s = await state(page);
  expect(s.storedEquipment.crafter).toBe(1);
  expect(s.equipment[s.activeZone]!.crafter).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__lpg.three!.scene.getObjectByName('EquipmentDrag') === undefined)).toBe(true);
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

test('抓起來只動一點點，家具不可以跳位（手指按的是機身，不是地板）', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page, '/?debug=1&fresh=1&seed=4549');
  await page.evaluate(() => { const s = window.__lpg.state as GameState; s.coins = 99999; s.xp = 99999; });
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await page.locator('[data-a="buyEquip"][data-arg="seller"]').click();
  await page.getByRole('button', { name: '關閉' }).click();

  const a = await screen(page, -0.14, 0.3, 0.6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.move(a.x + 5, a.y);
  await page.waitForTimeout(100);
  // EquipmentDrag 建在區域原點、position＝世界座標；起始區在第 0 座，世界 x 原點＝0
  const at = await page.evaluate(() => {
    const m = window.__lpg.three!.scene.getObjectByName('EquipmentDrag')!;
    return { x: m.position.x, z: m.position.z };
  });
  await page.mouse.up();
  await editBar(page).locator('[data-a="editCancel"]').click();
  expect(Math.abs(at.x - -0.14)).toBeLessThan(0.05);
  expect(Math.abs(at.z - 0.6)).toBeLessThan(0.05);
});
