// 量 ?pop=N 的 draw calls／triangles，順便截圖
import { chromium, devices } from '@playwright/test';
const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '.';
const pops = (process.env.POPS ?? '2,5,15').split(',').map(Number);
const tag = process.env.TAG ?? 'x';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
for (const pop of pops) {
  await page.goto(`${BASE}/?debug=1&fresh=1&seed=7&pop=${pop}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats, n: window.__lpg.state.puddings.length }));
  await page.screenshot({ path: `${OUT}/${tag}-pop${pop}.png` });
  console.log(`pop=${pop}`, JSON.stringify(stats));
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
