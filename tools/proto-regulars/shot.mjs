// 常客方塊角色原型（D69）的截圖：先起 dev server，再 `node tools/proto-regulars/shot.mjs <輸出.png>`（LPG_BASE 指定網址）
import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ ...devices['iPhone 14'] })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto(`${process.env.LPG_BASE ?? 'http://127.0.0.1:5173'}/tools/proto-regulars/voxel.html`);
await page.waitForTimeout(2500);
console.log('drawcalls', await page.evaluate(() => window.__calls));
await page.screenshot({ path: process.argv[2] });
await browser.close();
