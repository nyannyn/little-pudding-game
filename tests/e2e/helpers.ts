import type { Page } from '@playwright/test';

export interface LpgStats { fps: number; drawCalls: number; triangles: number; ready: boolean }

// 等到資產載完且至少畫過一幀，回傳穩定的 stats
export async function readStats(page: Page, query = ''): Promise<LpgStats> {
  await page.goto(`/?debug=1${query}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(600); // 讓 fps 視窗至少刷新一次
  return page.evaluate(() => ({ ...window.__lpg.stats }));
}
