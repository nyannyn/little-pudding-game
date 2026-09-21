// 部署後的線上煙霧測試：真的去 Pages 網址開一次，確認遊戲跑得起來。
//
// 為什麼要有這支：CI 只驗「dist 裡有沒有檔案、index.html 有沒有 base 前綴」，
// 那是檔案層級的檢查。資產 404、GLB 載入失敗、shader patch 在正式建置下失效，
// 都只有真的開一次才看得到。
//
// 用法：node tools/smoke-live.mjs [網址]
// 預設 https://nyannyn.github.io/little-pudding-game/
// 全部通過 exit 0，任何一項失敗 exit 1。
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = (process.argv[2] ?? process.env.LPG_LIVE ?? 'https://nyannyn.github.io/little-pudding-game/').replace(/\/$/, '');
const OUT = 'docs/previews';
mkdirSync(OUT, { recursive: true });

const problems = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '[v]' : '[X]'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) problems.push(label);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

try {
  await page.goto(`${BASE}/?debug=1&fresh=1&seed=1&fastTime=20`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 40_000 });

  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  check(stats.triangles > 4000, '場景畫出來了（含兩隻布丁的 GLB）', `tris ${stats.triangles}`);
  check(stats.drawCalls > 0 && stats.drawCalls <= 30, 'draw calls 在預算內', `${stats.drawCalls} / 30`);

  // 邏輯層真的在跑：遊戲時間會往前走
  const t0 = await page.evaluate(() => window.__lpg.state.time);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => window.__lpg.state.time);
  check(t1 > t0, '模擬有在推進', `${t0.toFixed(1)} → ${t1.toFixed(1)}`);

  // 一個真的玩家動作：倒焦糖
  await page.getByRole('button', { name: '倒焦糖' }).click();
  const basin = await page.evaluate(() => window.__lpg.state.basins[0]);
  check(basin.units === 1 && basin.liquid === 'caramel', '倒焦糖進得了澡盆', `units ${basin.units}`);

  // 布丁會自己跳進去泡
  await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.mode === 'bathing'), null, { timeout: 60_000 })
    .then(() => check(true, '布丁自己跳進澡盆泡澡'))
    .catch(() => check(false, '布丁自己跳進澡盆泡澡', '逾時'));

  await page.screenshot({ path: `${OUT}/live-smoke.png` });
  console.log(`   截圖：${OUT}/live-smoke.png`);
} catch (e) {
  check(false, '頁面載入／操作', String(e).split('\n')[0]);
}

check(consoleErrors.length === 0, 'console 沒有錯誤', consoleErrors.slice(0, 3).join(' | '));
check(failedRequests.length === 0, '沒有 404／載入失敗的資產', failedRequests.slice(0, 3).join(' | '));

await browser.close();

if (problems.length > 0) {
  console.error(`\n線上煙霧測試有 ${problems.length} 項沒過：${problems.join('、')}`);
  process.exit(1);
}
console.log('\n線上煙霧測試全部通過');
