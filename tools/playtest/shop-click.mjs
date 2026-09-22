// 商店按鈕點擊延遲：Playwright 的 click 若反覆「element was detached」＝頁面在定時重寫 innerHTML，
// 手機上手指按到一半按鈕被換掉就漏點。修前 3–4 秒（線上 3 次有 2 次 8 秒點不到）、修後 ~35ms。
import { boot, launch, newPage, shopTab, tap } from './lib.mjs';

const browser = await launch();
for (let i = 0; i < 3; i++) {
  const page = await newPage(browser);
  await boot(page, '?fresh=1&seed=31&fastTime=8');
  await page.evaluate(() => { window.__lpg.state.coins = 3000; });
  await tap(page, '商店'); await page.waitForTimeout(300);
  await shopTab(page, 'equipment');
  const t0 = Date.now();
  try {
    await page.locator('[data-a="buyEquip"][data-arg="collector"]').click({ timeout: 8000 });
    console.log(`第 ${i + 1} 次：${Date.now() - t0} ms（${(Date.now() - t0) > 1000 ? '✗ 太慢' : '✓'}）`);
  } catch (e) { console.log(`第 ${i + 1} 次：✗ 8 秒內點不到\n` + e.message.split('\n').slice(0, 6).join('\n')); }
  await page.context().close();
}
await browser.close();
