// 用 iPhone 視口拍現在跑著的 dev server，出圖給使用者做視覺簽核。
// 用法：npm run dev -- --host  （另一個終端機）→ node tools/shoot-viewport.mjs
// 輸出：docs/previews/cp1-iphone-{viewport,clean}.png
import { chromium, devices } from '@playwright/test';

const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch({
  // 無頭環境沒有真 GPU，走 SwiftShader；跟 playwright.config.ts 同一組旗標
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
// shader patch 之類的失敗只會出現在 console，截圖看不出來
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

for (const [name, query] of [['cp1-iphone-viewport', '?debug=1'], ['cp1-iphone-clean', '']]) {
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(1200);  // 讓 fps 視窗刷新過、控制器阻尼停下來
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  await page.screenshot({ path: `docs/previews/${name}.png` });
  console.log(name, JSON.stringify(stats));
}

await browser.close();
