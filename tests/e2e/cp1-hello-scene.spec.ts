import { test, expect } from '@playwright/test';
import { readStats } from './helpers';

// AC1-1：布丁 GLB 真的載入並被畫出來——用三角形差值判定，不用「畫面非空白」
// （櫥窗本來就在畫面裡，空白檢查會被遮蔽而永遠綠）。
test('AC1-1 pudding GLB adds 500–3000 triangles over cabinet-only scene', async ({ page }) => {
  const cabinetOnly = await readStats(page, '&noPudding=1');
  const withPudding = await readStats(page);
  const diff = withPudding.triangles - cabinetOnly.triangles;
  test.info().annotations.push({ type: 'stats', description: JSON.stringify({ cabinetOnly, withPudding, diff }) });
  expect(diff).toBeGreaterThanOrEqual(500);
  expect(diff).toBeLessThanOrEqual(3000);
});

test('scene renders with cabinet and stays within draw-call budget', async ({ page }) => {
  const stats = await readStats(page, '&noPudding=1');
  expect(stats.triangles).toBeGreaterThan(0);
  expect(stats.drawCalls).toBeLessThanOrEqual(30);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp1-cabinet.png' });
});
