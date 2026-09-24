// 新手流程：只按 HUD 按鈕、照引導做（不改 state），記錄引導句／toast／購買的時間線。
// 看什麼：引導有沒有卡在同一句、第一次出爐／第一位客人／第一台設備在第幾分鐘、成就領了多少、有沒有 console error。
// D50 起農場沒有加工／出貨；D57 起工坊的機器要買、放上線自己走完：存夠錢就去甜點店照引導買機器，從菜單開一盤、上架，沒事做了再回農場。
// 用法：node tools/playtest/opening.mjs   （FAST=倍速，預設 4；MIN=要玩幾分鐘遊戲時間，預設 8）
import { boot, launch, newPage, report, shopTab, shot, tap } from './lib.mjs';

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
    return { t: st.time, coins: st.coins, machines: Object.values(st.bakery.machines).filter((v) => v > 0).length, startable: Number(document.querySelector('[data-a="openMenu"] .n')?.textContent || 0), shelvable: Number(document.querySelector('[data-a="goBakery"] .n')?.textContent || 0), hint: hint && !hint.hidden ? hint.querySelector('.t').textContent : '', toasts: [...document.querySelectorAll('.toast')].map((x) => x.textContent), basinEmpty: st.basins.every((b) => b.units === 0), drops: st.drops.length };
  });
  if (s.hint !== lastHint) { log(s.t, `[hint] ${s.hint || '(隱藏)'}`); lastHint = s.hint; if (shotCount < 8) await shot(page, `opening-hint-${++shotCount}`); }
  for (const t of s.toasts) if (!seen.has(t)) { seen.add(t); log(s.t, `[toast] ${t}  (coins ${Math.floor(s.coins)})`); }
  if (s.basinEmpty) await tap(page, '倒焦糖');
  // 停擺警告叫你手動換口味（注液閥只補上次倒的那一種）：照做
  if (s.hint.includes('「倒牛乳」')) await tap(page, '倒牛乳');
  if (s.drops > 0) await tap(page, '撿原料');
  // 成就（D54／D55）：徽章亮了就全部領掉
  const claimed = await page.evaluate(() => {
    const badge = document.querySelector('.achbtn .badge');
    if (!badge || badge.hidden) return 0;
    document.querySelector('[data-a="achievements"]').click();
    return 1;
  });
  if (claimed) {
    await page.waitForTimeout(250);
    // D55：兩條以上可領時有「全部領取」；只有一條時抽屜會自己跳到那一頁，點那一列的「領取」
    const got = await page.evaluate(() => {
      const all = document.querySelector('.achsheet [data-a="claimAllAch"]');
      if (all && !all.hidden) { const t = all.textContent; all.click(); return [t]; }
      return [...document.querySelectorAll('.achsheet [data-a="claim"]')].slice(0, 1).map((b) => { const n = b.closest('.arow').querySelector('.ttl b').textContent; b.click(); return n; });
    });
    if (got.length) log(s.t, `[achievement] ${got.join('、')}`);
    await page.evaluate(() => document.querySelector('[data-a="closeAch"]').click());
  }
  // 甜點工坊（D51 → D57：機器要買、放上線自己走完，玩家只挑菜單與上架）
  if (s.hint.includes('工坊') || (s.coins >= 200 && s.machines < 6)) {
    // 引導叫去商店「工坊」頁買機器：照焦糖布丁塔那條線買（冷藏櫃它用不到）
    await tap(page, '商店');
    await page.waitForTimeout(150);
    await shopTab(page, 'bakery');
    const bought = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-a="buyMachine"]:not([disabled])')].find((x) => x.dataset.arg !== 'chill' && !/Lv\./.test(x.closest('.card').querySelector('.name').textContent));
      if (!b) return null;
      const name = b.closest('.card').querySelector('.name').textContent;
      b.click();
      return name;
    });
    if (bought) log(s.t, `[buy] ${bought}`);
    await page.evaluate(() => document.querySelector('[data-a="closeShop"]').click());
  }
  const view = await page.evaluate(() => document.querySelector('.hud').dataset.view);
  // D57：教學在買下第一台農場設備就結束，農場不會叫你去買機器——存到錢就自己去商店工坊頁買（上面那段）；
  // 菜單有做得起的（甜點店鈕旁的菜單徽章）或有東西可上架就過去
  if (view === 'farm' && (s.hint.includes('甜點店') || s.startable > 0 || s.shelvable > 0)) await tap(page, '甜點店');
  if (view === 'bakery') {
    const busy = await page.evaluate(() => (document.querySelector('.daybar .onl')?.textContent ?? '') !== '');
    await page.evaluate(() => document.querySelector('[data-a="openMenu"]').click());
    await page.waitForTimeout(200);
    const started = await page.evaluate(() => {
      // D60：點做得出來的那張卡片疊到最多，再按開工
      const card = document.querySelector('.menucard .rcard[data-ok="true"]');
      const max = card?.querySelector('[data-a="portionMax"]');
      if (card && max) {
        card.querySelector('.rhead').click();
        if (!max.disabled) max.click();
        const b = card.querySelector('[data-a="startBatch"]');
        const n = `${card.querySelector('.txt b').textContent} ${b.textContent}`;
        b.click();
        return n;
      }
      document.querySelector('[data-a="closeMenu"]').click();
      return null;
    });
    if (started) log(s.t, `[bake] ${started}`);
    await page.evaluate(() => { const b = document.querySelector('[data-a="stockShelf"]'); if (b && !b.disabled) b.click(); });
    // 工坊沒事做（線上沒東西、也開不了新的一盤）就回農場撿原料
    if (!busy && !started) await tap(page, '回農場');
  }
  if (!s.hint.includes('工坊') && (s.hint.includes('商店') || s.hint.includes('存到'))) {
    await tap(page, '商店');
    await page.waitForTimeout(150);
    // 引導叫你補貨就買液體，否則買第一台買得起的設備（querySelector 是文件順序，不能把兩個 selector 混在一起）
    const wantStock = s.hint.includes('補貨');
    // D25：商店有分頁；引導叫買設備時商店會自己開在設備頁，補貨則要切到補貨頁
    if (wantStock) await shopTab(page, 'stock');
    const bought = await page.evaluate((wantStock) => { const b = document.querySelector(wantStock ? '[data-a="buyStock"]:not([disabled])' : '[data-a="buyEquip"]:not([disabled])'); if (b) { const name = b.closest('.card').querySelector('.name').textContent; b.click(); return name; } return null; }, wantStock);
    if (bought) log(s.t, `[buy] ${bought}`);
    await tap(page, '關閉');
  }
  await page.waitForTimeout(500);
}
await shot(page, 'opening-end');
report(page);
await browser.close();
