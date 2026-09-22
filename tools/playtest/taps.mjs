// 點畫布的三種操作：點原料撿起、點澡盆倒液、點鎖著的層開商店／點另一層切區。
// 做法：把 3D 物件的世界座標投影到螢幕，在那一點 mouse.click，看 state 有沒有變。
// 曾抓到：InstancedMesh 包圍球在 count=0 時算成空球 → 點原料永遠沒反應（線上 hits=0）。
import { boot, launch, newPage, projectFn, report, shopTab, tap } from './lib.mjs';

const browser = await launch();
const page = await newPage(browser);
await boot(page, '?fresh=1&seed=31&fastTime=8');
const proj = (x, y, z) => page.evaluate(([src, x, y, z]) => eval(src)(x, y, z), [projectFn, x, y, z]);
let ok = true;
const check = (label, pass) => { console.log(`${pass ? '✓' : '✗'} ${label}`); if (!pass) ok = false; };

// ① 澡盆
const basin = await page.evaluate((src) => { const tub = window.__lpg.three.scene.getObjectByName('BasinTubs'); tub.geometry.computeBoundingBox(); const c = tub.geometry.boundingBox.getCenter(tub.position.clone()); return eval(src)(c.x, c.y, c.z); }, projectFn);
await page.mouse.click(basin.x, basin.y); await page.waitForTimeout(300);
check('點澡盆 → 倒了一份', (await page.evaluate(() => window.__lpg.state.basins[0].units)) === 1);

// ② 原料
await page.waitForFunction(() => window.__lpg.state.drops.length > 0, null, { timeout: 60_000 });
await page.waitForTimeout(700);
const drop = await page.evaluate((src) => { const d = window.__lpg.three.scene.getObjectByName('Drops'); const e = d.instanceMatrix.array; return eval(src)(e[12], e[13], e[14]); }, projectFn);
const before = await page.evaluate(() => window.__lpg.state.drops.length);
await page.mouse.click(drop.x, drop.y); await page.waitForTimeout(300);
check('點原料 → 撿起', (await page.evaluate(() => window.__lpg.state.drops.length)) === before - 1);

// ③ 鎖著的上層名牌 → 商店
const floorYs = await page.evaluate(() => { const f = window.__lpg.three.scene.getObjectByName('TankFloors'); const pos = f.geometry.attributes.position; const ys = new Set(); for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1000) / 1000); return [...ys].sort((a, b) => a - b).filter((_, i) => i % 2 === 1); });
const plateX = await page.evaluate(() => { const p = window.__lpg.three.scene.getObjectByName('TankPlates'); p.geometry.computeBoundingBox(); return (p.geometry.boundingBox.min.x + p.geometry.boundingBox.max.x) / 2; });
const plate = await proj(plateX, floorYs[2] + 0.28, 0.72);
await page.mouse.click(plate.x, plate.y); await page.waitForTimeout(300);
check('點鎖著的層 → 商店打開', await page.evaluate(() => !document.querySelector('.sheet').hidden));
await tap(page, '關閉');

// ④ 解鎖上層後點中層 → 切回
await page.evaluate(() => { window.__lpg.state.coins = 999; window.__lpg.state.xp = 99999; /* D25：上層要 Lv.4 */ });
await tap(page, '商店'); await shopTab(page, 'zone'); await page.locator('[data-a="unlockZone"][data-arg="c0t2"]').click(); await tap(page, '關閉');
await page.waitForTimeout(1500);
const dockTop = await page.evaluate(() => document.querySelector('.hud .dock').getBoundingClientRect().top);
let mid = null;
for (let h = 1.35; h > 0.2 && !mid; h -= 0.15) { const q = await proj(0, floorYs[1] + h, 0.7); if (q.y < dockTop - 12) mid = q; }
await page.mouse.click(mid.x, mid.y); await page.waitForTimeout(600);
check('點另一層 → 切區', (await page.evaluate(() => window.__lpg.state.activeZone)) === 'c0t1');

report(page);
await browser.close();
process.exit(ok ? 0 : 1);
