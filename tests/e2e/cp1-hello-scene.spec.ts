import { test, expect } from '@playwright/test';
import { readStats } from './helpers';

// AC1-1：布丁 GLB 真的載入並被畫出來——用三角形差值判定，不用「畫面非空白」
// （櫥窗本來就在畫面裡，空白檢查會被遮蔽而永遠綠）。
//
// 區間在 CP3 調過（原 500–3000）：住客從 1 隻變 2 隻，而且 castShadow 收斂成
// 只有 Pudding_Body（省 draw call），所以每隻的計數是 1228 + 468（陰影 pass）＝ 1696，
// 兩隻約 3392。負向對照仍然有效：GLB 載不到時差值會是 0。
test('AC1-1 兩隻布丁的 GLB 為場景加上 2000–5000 個三角形', async ({ page }) => {
  const cabinetOnly = await readStats(page, '&noPudding=1');
  const withPudding = await readStats(page);
  const diff = withPudding.triangles - cabinetOnly.triangles;
  test.info().annotations.push({ type: 'stats', description: JSON.stringify({ cabinetOnly, withPudding, diff }) });
  expect(diff).toBeGreaterThanOrEqual(2000);
  expect(diff).toBeLessThanOrEqual(5000);
});

test('scene renders with cabinet and stays within draw-call budget', async ({ page }) => {
  const stats = await readStats(page, '&noPudding=1');
  expect(stats.triangles).toBeGreaterThan(0);
  expect(stats.drawCalls).toBeLessThanOrEqual(30);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp1-cabinet.png' });
});
