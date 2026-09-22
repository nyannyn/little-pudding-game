// HUD 幾何檢查（兩種手機寬度、最壞情況：切換列出現、兩隻長名布丁、三張訂單卡、五份掉落物、警告泡泡）。
// 眼睛看截圖抓不到 1px 的疊；這裡用 bounding box 與 3D 投影座標判定。
// 看什麼：HUD 元素彼此不疊、「下一個櫥窗」按鈕點得到、沒有布丁／原料被訂單卡蓋住、布丁投影落在 topbar 底～dock 頂之間。
import { boot, hudBoxes, launch, newPage, overlap, projectedActors, report, shot } from './lib.mjs';

const browser = await launch();
let bad = 0;
for (const device of ['iPhone 14', 'iPhone SE']) {
  const page = await newPage(browser, device);
  await boot(page, '?fresh=1&seed=5');
  await page.evaluate(() => {
    const s = window.__lpg.state;
    s.zones[1].unlocked = true;
    for (const p of s.puddings) p.species = 'panna';
    s.equipment[s.activeZone].collector = true; s.basins[0].preferredLiquid = 'caramel';
    s.stock.caramel = 0; s.stock.milk = 0;
    for (let i = 0; i < 3; i++) s.orders.push({ id: 'o' + i, species: 'caramel', qty: 2, price: 100 + i, createdAt: s.time, expiresAt: s.time + 300 });
    const b = s.basins[0];
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; s.drops.push({ id: 'dd' + i, zone: 'c0t1', species: 'caramel', pos: { x: b.pos.x + 0.32 * Math.cos(a), z: b.pos.z + 0.224 * Math.sin(a) }, bornAt: s.time - 5 }); }
  });
  await page.waitForTimeout(700);
  const h = await hudBoxes(page);
  const pts = await projectedActors(page);
  const nextHit = await page.evaluate(() => { const b = document.querySelector('[data-a="zoneStep"][data-arg="1"]').getBoundingClientRect(); return document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)?.closest('[data-a]')?.dataset.a; });
  const covered = pts.filter((q) => h.cards.some((c) => q.x >= c.l - 8 && q.x <= c.r + 8 && q.y >= c.t - 8 && q.y <= c.b + 8));
  const outOfBand = pts.filter((q) => q.kind === 'pudding' && (q.y < h.topbar.b + 40 || q.y > h.dock.t - 60));
  const problems = [];
  if (overlap(h.zones, h.orders)) problems.push('切換列與訂單欄重疊');
  if (h.rows.some((r) => overlap(r, h.orders))) problems.push('住客列伸進訂單欄');
  if (h.rows.some((r) => r.b - r.t > 36)) problems.push('住客列折成兩行');
  if (nextHit !== 'zoneStep') problems.push(`「下一個櫥窗」被 ${nextHit} 蓋住`);
  if (covered.length) problems.push(`訂單卡蓋住 ${covered.map((c) => c.kind).join(',')}`);
  if (outOfBand.length) problems.push('布丁投影落在 HUD 帶外');
  if (h.hint && h.rows.some((r) => overlap(r, h.hint))) problems.push('提示泡泡蓋住住客列');
  console.log(`${device} (${h.vw}x${h.vh}) → ${problems.length ? '✗ ' + problems.join('；') : '✓ 無疊'}`);
  bad += problems.length;
  await shot(page, `layout-${device.replace(' ', '')}`);
  report(page);
  await page.context().close();
}
await browser.close();
process.exit(bad ? 1 : 0);
