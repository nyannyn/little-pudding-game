// AC3-4 的視覺簽核素材：拍五個關鍵時刻給使用者看。
// 用法：npm run dev（另一個終端機）→ node tools/shoot-gameplay.mjs
// 輸出：docs/previews/cp3-*.png
//
// 注意：這支跑的是 SwiftShader 軟體渲染，印出來的 fps 沒有意義（不可當 AC 的 fps 數字），
// 但 draw calls 與三角形數是真的。
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';
const OUT = 'docs/previews';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console error]', m.text()); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

async function shot(name) {
  await page.waitForTimeout(400);
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name.padEnd(22), `draw ${stats.drawCalls}  tris ${stats.triangles}`);
}

async function boot(query) {
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

// ① 開局：空澡盆、兩隻布丁在彈跳
await boot('?fresh=1&seed=20260921&fastTime=1');
await page.waitForTimeout(1500);
await shot('cp3-1-opening');

// ② 泡澡閉眼
await boot('?fresh=1&seed=20260921&fastTime=20');
await page.getByRole('button', { name: '倒焦糖' }).click();
await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.mode === 'bathing'), null, { timeout: 60_000 });
await shot('cp3-2-bathing');

// ③ 原料掉在地上等人撿
await page.waitForFunction(() => window.__lpg.state.drops.length > 0, null, { timeout: 60_000 });
await shot('cp3-3-drop');

// ④ 生產線全開（五台設備都裝上）
await page.evaluate(() => {
  const s = window.__lpg.state;
  s.coins = 99999;
  for (const k of Object.keys(s.equipment)) s.equipment[k] = true;
  s.stock.caramel = 40;
});
await page.waitForTimeout(1200);
await shot('cp3-4-automated');

// ⑤ 變白中 →⑥ 突變成鮮奶酪
await boot('?fresh=1&seed=20260921&fastTime=30');
await page.evaluate(() => {
  const s = window.__lpg.state;
  s.coins = 9999;
  s.stock.caramel = 0;
  s.stock.milk = 80;
  s.equipment.autoFill = true;
  s.basins[0].liquid = 'milk';
  s.basins[0].preferredLiquid = 'milk';
  s.basins[0].units = 3;
});
await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.tint >= 0.5), null, { timeout: 120_000 });
await shot('cp3-5-tint');
await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.species === 'panna'), null, { timeout: 180_000 });
await shot('cp3-6-mutated');

// ⑦ 商店
await page.getByRole('button', { name: '商店' }).click();
await shot('cp3-7-shop');

// ⑧ 解鎖上層（同一座櫃子的第二個櫥窗）
await boot('?fresh=1&seed=20260921&fastTime=1');
await page.evaluate(() => { window.__lpg.state.coins = 99999; window.__lpg.state.xp = 99999; });
await page.getByRole('button', { name: '商店' }).click();
await page.locator('[data-a="shopTab"][data-arg="zone"]').click();
await page.locator('[data-a="unlockZone"][data-arg="c0t2"]').click();
await page.getByRole('button', { name: '關閉' }).click();
await page.waitForTimeout(1600); // 等鏡頭滑上去
await shot('cp3-8-upper-tier');

// ⑨ 再解鎖下層與二號櫥窗，切到二號櫥窗
for (const zone of ['c0t0', 'c1t1']) {
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator(`[data-a="unlockZone"][data-arg="${zone}"]`).click();
  await page.getByRole('button', { name: '關閉' }).click();
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1800);
await shot('cp3-9-second-cabinet');

// ⑩ 拉遠看整排（縮放上限要回得到整座櫃子）
await page.evaluate(() => {
  const { camera, controls } = window.__lpg.three;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).add(dir.multiplyScalar(controls.maxDistance));
  controls.update();
});
await shot('cp3-10-zoom-out');

await browser.close();
