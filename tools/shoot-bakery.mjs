// 甜點工坊的簽核截圖（D51 → D57 食譜制流水線）：iPhone 視口開 `?view=bakery`，拍
// ① 空工坊（機器都還沒買）② 買了一部分 ③ 七台全買、每一站一盤在做 ④ 客人 ⑤ 菜單卡 ⑥ 商店工坊頁。
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

// HUD 每 160ms（真實時間）才重畫一次，step 推得比這快：截圖前讓它跑幾幀再拍，不然拍到的是舊數字
const settle = () => page.waitForTimeout(450);
const step = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await page.evaluate((d) => window.__lpg.step(d), dt); };
const shot = async (name) => {
  await settle();
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, JSON.stringify({ drawCalls: stats.drawCalls, triangles: stats.triangles }));
};

// ① 空工坊
await step(4);
await shot('bakery-empty');

// ② 只買了焦糖布丁塔那條線的前三台
await page.evaluate(() => {
  const m = window.__lpg.state.bakery.machines;
  Object.assign(m, { stove: 1, crack: 1, mix: 1 });
});
await step(4);
await shot('bakery-partial');

// ③ 七台全買（不同等級）、每一站一盤做到一半；展示架與成品櫃擺幾份
await page.evaluate(() => {
  const s = window.__lpg.state;
  Object.assign(s.bakery.machines, { stove: 2, crack: 1, mix: 3, mold: 2, bake: 2, chill: 1, decorate: 1 });
  const plan = [['stove', 'caramel'], ['crack', 'custard'], ['mix', 'matcha'], ['mold', 'strawberry'], ['bake', 'hojicha'], ['chill', 'panna'], ['decorate', 'brulee']];
  plan.forEach(([id, sp], i) => {
    s.bakery.stations[id] = { batch: { species: sp, qty: i % 2 ? 2 : 4 }, doneAt: s.time + 20 + i };
  });
  Object.assign(s.bakery.shelf, { caramel: 3, matcha: 2, strawberry: 2, custard: 1, sakura: 2 });
  Object.assign(s.desserts, { caramel: 2, panna: 2, hojicha: 1 });
});
await step(30);
await shot('bakery-working');

// ④ 客人走進店裡、站在展示櫃前
await page.evaluate(() => {
  for (const sp of ['caramel', 'matcha', null]) window.__lpg.bakery.customerCame?.(sp);
});
await step(60);
await shot('bakery-customers');

// ⑤ 菜單卡：材料給一部分，讓卡片有可按的也有缺料的
await page.evaluate(() => {
  const s = window.__lpg.state;
  for (const id of Object.keys(s.bakery.stations)) s.bakery.stations[id] = { batch: null, doneAt: 0 };
  s.eggs = 6; s.stock.milk = 3; s.pantry.flour = 2; s.ingredients.caramel = 2; s.ingredients.panna = 1;
});
await step(2);
await page.locator('[data-a="openMenu"]').click();
await shot('bakery-menu');
await page.locator('.menucard .rlist').evaluate((el) => { el.scrollTop = 600; });
await shot('bakery-menu-scrolled');
await page.locator('[data-a="closeMenu"]').click();

// ⑥ 商店的工坊頁
await page.evaluate(() => {
  const s = window.__lpg.state;
  s.coins = 2000;
  Object.assign(s.bakery.machines, { stove: 0, crack: 1, mix: 2, mold: 3, bake: 0, chill: 0, decorate: 0 });
});
await step(2);
await page.locator('[data-a="shop"]').click();
await page.locator('[data-a="shopTab"][data-arg="bakery"]').click();
await shot('shop-bakery');

// ⑦ 農場：錢夠買整條線、還沒有任何機器 → 甜點店鈕掛「!」
await page.locator('[data-a="closeShop"]').click();
await page.evaluate(() => {
  const s = window.__lpg.state;
  for (const id of Object.keys(s.bakery.machines)) s.bakery.machines[id] = 0;
  s.coins = 300;
  window.__lpg.setView('farm');
});
await step(4);
await shot('farm-alert');

console.log('errors', errors.length ? errors : 'none');
await browser.close();
