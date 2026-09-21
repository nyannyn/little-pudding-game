// 離線結算：先玩一段存檔，再把 lastSeenAt 撥回 30 分鐘前、用預先塞好的 localStorage 重開。
// 看什麼：歡迎卡的數字合不合理、庫存用完時有沒有講、回來後引導句對不對。
// 注意：不能在同一個分頁改 localStorage 再 reload——pagehide 會用現在時間覆蓋存檔；要開新 context 用 addInitScript 塞。
import { boot, launch, newPage, report, shot, tap } from './lib.mjs';

const browser = await launch();
let page = await newPage(browser);
await boot(page, '?fresh=1&seed=9&fastTime=10');
await page.evaluate(() => { const s = window.__lpg.state; for (const k of ['autoFill', 'collector', 'crafter', 'seller']) s.equipment[k] = true; s.stock.caramel = 20; });
await tap(page, '倒焦糖');
await page.waitForTimeout(6500); // 每 5 秒存檔一次
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(300);
// ?fresh=1 是測試模式，寫的是另一格 lpg.save.test（玩家那格 lpg.save.v1 不會被碰）
const saved = await page.evaluate(() => localStorage.getItem('lpg.save.test'));
await page.context().close();

for (const [label, stock] of [['庫存充足', 40], ['庫存用完', 0]]) {
  const raw = JSON.parse(saved);
  raw.lastSeenAt = Date.now() - 30 * 60 * 1000;
  raw.stock.caramel = stock;
  raw.basins[0].units = stock ? 3 : 0; raw.basins[0].liquid = stock ? 'caramel' : null;
  // 這一輪要當「真的玩家回來了」，所以塞的是玩家那一格、開的網址也不帶 fresh
  page = await newPage(browser, 'iPhone 14', { fn: (v) => localStorage.setItem('lpg.save.v1', v), arg: JSON.stringify(raw) });
  await boot(page, '');
  const welcome = await page.evaluate(() => { const w = document.querySelector('.welcome'); return w && !w.hidden ? w.querySelector('p').textContent : '(沒有歡迎卡)'; });
  const hint = await page.evaluate(() => { const h = document.querySelector('.hint'); return h.hidden ? '' : h.querySelector('.t').textContent; });
  console.log(`${label} → ${welcome}\n   hint: ${hint || '(無)'}`);
  await shot(page, `offline-${stock}`);
  report(page);
  await page.context().close();
}
await browser.close();
