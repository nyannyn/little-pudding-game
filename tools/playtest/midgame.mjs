// 中後期：用 state 作弊跳過累積，看每個階段的畫面與行為。
// A 全自動運作 5 遊戲分鐘（D50 起農場只剩收集手／注液閥／補貨合約三台） → B 解鎖上層／下層／二號櫥窗（鏡頭橫移）、拉遠上限 → C 牛奶突變 → D 晚期商店。
// 看什麼：draw calls ≤ 30、切區後住客／澡盆／設備有沒有跟著換、toast 有沒有蓋住布丁、突變動畫、無 console error。
import { boot, launch, newPage, report, shopTab, shot, summary, tap } from './lib.mjs';

const browser = await launch();
const page = await newPage(browser);

// A. 買齊 T1+T2，看 5 遊戲分鐘
await boot(page, '?fresh=1&seed=777&fastTime=10');
await page.evaluate(() => { const s = window.__lpg.state; s.coins = 600; s.stock.caramel = 30; s.xp = 99999; /* D25：作弊跳階段，等級給滿 */ });
await tap(page, '商店');
await shopTab(page, 'equipment');
for (const id of ['collector', 'autoFill']) { await page.locator(`[data-a="buyEquip"][data-arg="${id}"]`).click(); await page.waitForTimeout(150); }
await shot(page, 'mid-A1-shop');
await tap(page, '關閉');
await tap(page, '倒焦糖');
await page.waitForTimeout(30_000);
await summary(page, 'A 全自動 5 分鐘後');
await shot(page, 'mid-A2-automated');

// B. 三區全開，鏡頭跟著走；拉遠到上限
await page.evaluate(() => { const s = window.__lpg.state; s.coins = 5000; s.equipment[s.activeZone].restock = true; });
for (const [i, zone] of ['c0t2', 'c0t0', 'c1t1'].entries()) {
  await tap(page, '商店'); await shopTab(page, 'zone'); await page.locator(`[data-a="unlockZone"][data-arg="${zone}"]`).click(); await tap(page, '關閉');
  await page.waitForTimeout(1800);
  await summary(page, `B 解鎖 ${i + 1}`); await shot(page, `mid-B${i + 1}-unlock`);
}
await page.evaluate(() => { const { controls, camera } = window.__lpg.three; const dir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(controls.target).add(dir.multiplyScalar(controls.maxDistance)); controls.update(); });
await shot(page, 'mid-B4-zoomed-out');
for (let i = 0; i < 3; i++) { await tap(page, '上一個櫥窗'); await page.waitForTimeout(400); }
await page.waitForTimeout(1500);
await summary(page, 'B 切回'); await shot(page, 'mid-B5-back');

// C. 牛奶突變：注液閥設成牛奶，等變白→突變
await boot(page, '?fresh=1&seed=778&fastTime=30');
await page.evaluate(() => { const s = window.__lpg.state; s.coins = 500; s.stock.milk = 30; s.stock.caramel = 0; s.equipment[s.activeZone].autoFill = true; s.equipment[s.activeZone].collector = true; });
await tap(page, '倒牛乳');
await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.tint >= 0.5), null, { timeout: 120_000 });
await shot(page, 'mid-C1-tint');
await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.species === 'panna'), null, { timeout: 180_000 });
await page.waitForTimeout(800);
await summary(page, 'C 突變'); await shot(page, 'mid-C2-panna');

// D. 晚期商店：全買完後還剩什麼可買
await page.evaluate(() => { const s = window.__lpg.state; s.coins = 99999; const eq = s.equipment[s.activeZone]; for (const k of Object.keys(eq)) eq[k] = true; });
await tap(page, '商店'); await page.waitForTimeout(300);
await shot(page, 'mid-D1-shop-late');
console.log('## 晚期商店\n' + (await page.evaluate(() => document.querySelector('.sheet').innerText)));
report(page);
await browser.close();
