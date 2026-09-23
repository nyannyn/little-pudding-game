// 甜點工坊的簽核截圖（D51）：iPhone 視口開 `?view=bakery`，塞一盤到每一站＋展示架＋客人，
// 各拍一張「工作中」與「營業中」的畫面。
// 用法：先在這棵樹起 dev server（port 由 LPG_BASE 指定），再 `node tools/shoot-bakery.mjs [輸出資料夾]`
import { chromium, devices } from '@playwright/test';

const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';
const OUT = process.argv[2] ?? 'docs/previews';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices[process.env.LPG_DEVICE ?? 'iPhone 14'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE}/?fresh=1&seed=7&view=bakery&pause=1`);
await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
await page.evaluate(() => localStorage.setItem('lpg.hints.off', '1'));
await page.reload();
await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });

// 每一站各放一盤、做到一半；展示架與成品櫃擺幾份
await page.evaluate(() => {
  const s = window.__lpg.state;
  const kinds = ['caramel', 'matcha', 'strawberry', 'custard', 'sakura'];
  ['crack', 'mix', 'mold', 'bake', 'decorate'].forEach((id, i) => {
    s.bakery.stations[id] = { batch: { species: kinds[i], qty: 2 }, doneAt: s.time + 3 + i };
  });
  s.bakery.stations.decorate.doneAt = s.time + 2.5;
  Object.assign(s.bakery.shelf, { caramel: 3, matcha: 2, strawberry: 2, custard: 1, sakura: 2 });
  Object.assign(s.desserts, { caramel: 2, panna: 2, hojicha: 1 });
  s.orders = [
    { id: 'o1', species: 'caramel', qty: 2, price: 120, createdAt: s.time, expiresAt: s.time + 300 },
    { id: 'o2', species: 'matcha', qty: 1, price: 110, createdAt: s.time, expiresAt: s.time + 200 },
  ];
});
for (let i = 0; i < 12; i++) await page.evaluate(() => window.__lpg.step(0.05));
await page.evaluate(() => {
  for (const sp of ['caramel', 'matcha', null]) window.__lpg.bakery.customerCame?.(sp);
});
for (let i = 0; i < 30; i++) await page.evaluate(() => window.__lpg.step(0.05));
// HUD 每 160ms（真實時間）才重畫一次，step 推得比這快：截圖前讓它跑幾幀再拍，不然拍到的是舊數字
const settle = () => page.waitForTimeout(450);
await settle();
const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
await page.screenshot({ path: `${OUT}/bakery-working.png` });
console.log('bakery-working', JSON.stringify({ drawCalls: stats.drawCalls, triangles: stats.triangles }));

// 推到客人走進店裡、站在展示櫃前
for (let i = 0; i < 40; i++) await page.evaluate(() => window.__lpg.step(0.05));
await settle();
await page.screenshot({ path: `${OUT}/bakery-customers.png` });

// 農場畫面（確認切回來、動作列換成「撿原料／甜點店」）
await page.evaluate(() => window.__lpg.setView('farm'));
for (let i = 0; i < 10; i++) await page.evaluate(() => window.__lpg.step(0.05));
await settle();
await page.screenshot({ path: `${OUT}/farm-after.png` });

console.log('errors', errors.length ? errors : 'none');
await browser.close();
