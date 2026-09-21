// 新手流程：只按 HUD 按鈕、照引導做（不改 state），記錄引導句／toast／購買的時間線。
// 看什麼：引導有沒有卡在同一句、第一次出貨／第一台設備／第一張訂單在第幾分鐘、有沒有 console error。
// 用法：node tools/playtest/opening.mjs   （FAST=倍速，預設 4；MIN=要玩幾分鐘遊戲時間，預設 8）
import { boot, launch, newPage, report, shot, tap } from './lib.mjs';

const FAST = Number(process.env.FAST ?? 4);
const MIN = Number(process.env.MIN ?? 8);
const browser = await launch();
const page = await newPage(browser);
await boot(page, `?fresh=1&seed=4242&fastTime=${FAST}`);
await shot(page, 'opening-0');

let lastHint = '';
const seen = new Set();
const log = (t, msg) => console.log(`${(t / 60).toFixed(1).padStart(5)} min  ${msg}`);
const endAt = Date.now() + (MIN * 60 * 1000) / FAST;
let shotCount = 0;
while (Date.now() < endAt) {
  const s = await page.evaluate(() => {
    const st = window.__lpg.state;
    const hint = document.querySelector('.hint');
    return { t: st.time, coins: st.coins, hint: hint && !hint.hidden ? hint.querySelector('.t').textContent : '', toasts: [...document.querySelectorAll('.toast')].map((x) => x.textContent), basinEmpty: st.basins.every((b) => b.units === 0), drops: st.drops.length };
  });
  if (s.hint !== lastHint) { log(s.t, `[hint] ${s.hint || '(隱藏)'}`); lastHint = s.hint; if (shotCount < 8) await shot(page, `opening-hint-${++shotCount}`); }
  for (const t of s.toasts) if (!seen.has(t)) { seen.add(t); log(s.t, `[toast] ${t}  (coins ${Math.floor(s.coins)})`); }
  if (s.basinEmpty) await tap(page, '倒焦糖');
  if (s.drops > 0) await tap(page, '撿原料');
  await tap(page, '加工');
  await tap(page, '出貨');
  if (s.hint.includes('商店') || s.hint.includes('存到')) {
    await tap(page, '商店');
    await page.waitForTimeout(150);
    // 引導叫你補貨就買液體，否則買第一台買得起的設備（querySelector 是文件順序，不能把兩個 selector 混在一起）
    const wantStock = s.hint.includes('補貨');
    const bought = await page.evaluate((wantStock) => { const b = document.querySelector(wantStock ? '[data-a="buyStock"]:not([disabled])' : '[data-a="buyEquip"]:not([disabled])'); if (b) { const name = b.closest('.item').querySelector('.name').textContent; b.click(); return name; } return null; }, wantStock);
    if (bought) log(s.t, `[buy] ${bought}`);
    await tap(page, '關閉');
  }
  await page.waitForTimeout(500);
}
await shot(page, 'opening-end');
report(page);
await browser.close();
