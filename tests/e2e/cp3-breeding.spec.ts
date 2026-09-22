import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * D29：繁殖出來的布丁要真的被畫出來。
 *
 * 單元測試只證明「state 裡多了一隻」；新生兒有沒有拿到自己的 view 是 `main.ts` 的事
 * （`ensureViews()` 只在開場與解鎖時跑過，漏接 birth 事件的話畫面上什麼都不會多）。
 * 所以這裡的判定用**幾何**：三角形數要多出一隻布丁的量（1228 本體＋468 陰影＝1696），
 * 光看 `puddings.length` 會漏掉「state 對、畫面空」這個最可能的錯法。
 */
const URL = '/?debug=1&fresh=1&seed=20260922&fastTime=5';

/** 一隻布丁的三角形量（本體 1228 ＋ 只有本體投影的 468），2026-09-21 實測 */
const TRIS_PER_PUDDING = 1696;

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

async function stats(page: Page) {
  return page.evaluate(() => ({ ...window.__lpg.stats }));
}

test('繁殖出來的第三隻布丁真的出現在畫面上（三角形數與 draw calls 都跟著增加）', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(URL);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(500);

  const before = await stats(page);
  const start = await state(page);
  expect(start.puddings).toHaveLength(2);
  expect(start.stats.births).toBe(0);
  // 開局的兩隻都是純焦糖：基因型是唯一真相，species 只是它的快取
  for (const p of start.puddings) expect(p.genes).toEqual(['caramel', 'caramel']);

  // D34：牛奶澡就是繁殖。只設定「前置條件」（有牛乳、布丁想泡澡），
  // 生不生、生出什麼由模擬自己決定
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.stock.milk = 30;
    s.equipment[s.activeZone]!.autoFill = true;
    for (const b of s.basins) {
      b.liquid = 'milk';
      b.preferredLiquid = 'milk';
      b.units = 3;
    }
    for (const p of s.puddings) p.caramel = 5; // 馬上想泡澡
  });

  await page.waitForFunction(() => (window.__lpg.state as GameState).stats.births > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(1200); // 等 GLB clone 完成並加進場景

  const after = await stats(page);
  const s = await state(page);
  expect(s.puddings).toHaveLength(3);

  const child = s.puddings[2]!;
  expect(child.bornAt).toBeGreaterThan(0);
  // 單親複製：等位基因只會是母體的焦糖、或被牛奶推成的鮮奶酪
  for (const allele of child.genes) expect(['caramel', 'panna']).toContain(allele);

  // 畫面上真的多了一隻：三角形數多出一隻的量（留 10% 容忍給掉落物等雜項）
  expect(after.triangles - before.triangles).toBeGreaterThan(TRIS_PER_PUDDING * 0.9);
  expect(after.drawCalls).toBeGreaterThan(before.drawCalls);
  // 而且沒有超出預算（D31：上限 35）
  expect(after.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});

test('負向對照：只泡焦糖澡不會生，畫面也不會多東西', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(URL);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(500);

  const before = await stats(page);
  // 只給焦糖澡：泡再多次也不會生（牛奶才是繁殖的入口）
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.stock.caramel = 30;
    s.equipment[s.activeZone]!.autoFill = true;
    for (const b of s.basins) {
      b.liquid = 'caramel';
      b.preferredLiquid = 'caramel';
      b.units = 3;
    }
    for (const p of s.puddings) p.caramel = 5;
  });
  await page.waitForFunction(() => (window.__lpg.state as GameState).stats.baths >= 2, null, { timeout: 60_000 });

  const s = await state(page);
  expect(s.stats.births).toBe(0);
  expect(s.puddings).toHaveLength(2);
  const after = await stats(page);
  expect(Math.abs(after.triangles - before.triangles)).toBeLessThan(TRIS_PER_PUDDING * 0.5);
});
