import type { Page } from '@playwright/test';

export interface LpgStats { fps: number; drawCalls: number; triangles: number; ready: boolean }

/**
 * 每幀 draw call 預算（repo CLAUDE.md／計畫 D11）。
 * 2026-09-22 由 30 上調到 35（D31）：繁殖讓一層住到 3 隻，當時實測每隻剛好 +5。
 * WP7-1 之後布丁改 InstancedMesh，隻數不再是乘數（15 隻實測 16，`cp7-instancing.spec.ts`），
 * 但**這個數字維持 35 不收到 16**：D46 的物種外觀最壞會用到 23，收緊只會讓美術擴充因為錯誤的理由變紅。
 * 寫在這裡是為了只有一個地方要改——三個 spec 各寫一份數字會漂。
 */
export const DRAW_CALL_BUDGET = 35;

// 等到資產載完且至少畫過一幀，回傳穩定的 stats
export async function readStats(page: Page, query = ''): Promise<LpgStats> {
  await page.goto(`/?debug=1${query}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(600); // 讓 fps 視窗至少刷新一次
  return page.evaluate(() => ({ ...window.__lpg.stats }));
}
