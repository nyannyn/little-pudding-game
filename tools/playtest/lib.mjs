// 試玩腳本共用：起無頭 iPhone Chromium、開遊戲、投影 3D 座標到螢幕、截圖、印狀態摘要。
// 遊戲端為除錯掛了 window.__lpg = { stats, state, three: { scene, camera, controls, raycaster } }。
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';
export const OUT = process.env.OUT ?? 'docs/previews/playtest';
mkdirSync(OUT, { recursive: true });

export async function launch() {
  // SwiftShader 軟體渲染：fps 沒意義，draw calls／三角形數是真的
  return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

/** 開一個 iPhone 視口的分頁；device 可用 'iPhone SE' 看最窄的手機 */
export async function newPage(browser, device = 'iPhone 14', initScript) {
  const ctx = await browser.newContext({ ...devices[device] });
  if (initScript) await ctx.addInitScript(initScript.fn, initScript.arg);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('[console] ' + m.text()); });
  return page;
}

/** 開遊戲並等資產載完。query 例：'?fresh=1&seed=31&fastTime=4'（fresh=新存檔、seed=固定亂數、fastTime=倍速） */
export async function boot(page, query = '?fresh=1&seed=31') {
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(500);
}

export async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const st = await page.evaluate(() => ({ ...window.__lpg.stats }));
  console.log(`  [shot] ${name.padEnd(22)} draw ${st.drawCalls}  tris ${st.triangles}`);
}

/** 一行狀態摘要（時間、金幣、庫存、布丁狀態、盆、引導句、toast） */
export async function summary(page, label) {
  const s = await page.evaluate(() => {
    const s = window.__lpg.state;
    const hint = document.querySelector('.hint');
    return {
      t: Math.round(s.time), coins: Math.floor(s.coins), stock: s.stock, ing: s.ingredients, des: s.desserts,
      drops: s.drops.length, orders: s.orders.map((o) => `${o.species}x${o.qty}@${o.price}`), zone: s.activeZone,
      pud: s.puddings.map((p) => `${p.zone}:${p.species}:${p.mode}:${Math.round(p.caramel)}`),
      basins: s.basins.map((b) => `${b.zone}:${b.liquid}:${b.units}`),
      hint: hint && !hint.hidden ? hint.querySelector('.t')?.textContent : '',
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
    };
  });
  console.log(`## ${label}`, JSON.stringify(s));
  return s;
}

/** 按 HUD 按鈕（名稱前綴比對：按鈕上還有數量徽章）；按不了就回 false */
/** 商店分頁（D25）：stock／equipment／basin／zone／sell */
export async function shopTab(page, tab) {
  await page.locator(`[data-a="shopTab"][data-arg="${tab}"]`).click();
  await page.waitForTimeout(120);
}

export async function tap(page, name) {
  const b = page.getByRole('button', { name: new RegExp('^' + name) }).first();
  if (!(await b.isEnabled().catch(() => false))) return false;
  // 軟體渲染下一幀可能 100–200ms，Playwright 的「元素穩定」檢查會比較久，逾時要印出來不能吞
  try { await b.click({ timeout: 10_000 }); return true; } catch (e) { console.log(`  [tap] 按「${name}」失敗：${String(e.message).split(String.fromCharCode(10))[0]}`); return false; }
}

/** 在頁面裡：把世界座標投影成 CSS px（跟 camera.setViewOffset 一致，因為直接用 projectionMatrix） */
export const projectFn = `(x, y, z) => {
  const { camera } = window.__lpg.three;
  const mv = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
  const cx = mv[0]*x + mv[4]*y + mv[8]*z + mv[12], cy = mv[1]*x + mv[5]*y + mv[9]*z + mv[13], cz = mv[2]*x + mv[6]*y + mv[10]*z + mv[14];
  const px = p[0]*cx + p[4]*cy + p[8]*cz + p[12], py = p[1]*cx + p[5]*cy + p[9]*cz + p[13], pw = p[3]*cx + p[7]*cy + p[11]*cz + p[15];
  return { x: (px / pw + 1) / 2 * innerWidth, y: (1 - py / pw) / 2 * innerHeight };
}`;

/** 布丁（腳底往上 0.12）、掉落物的螢幕座標 */
export async function projectedActors(page) {
  return page.evaluate((projectSrc) => {
    const project = eval(projectSrc);
    const { scene } = window.__lpg.three;
    const pts = [];
    scene.traverse((o) => { if (o.parent === scene && o.getObjectByName('Pudding_Body')) pts.push({ kind: 'pudding', ...project(o.position.x, o.position.y + 0.12, o.position.z) }); });
    const drops = scene.getObjectByName('Drops');
    if (drops) { const e = drops.instanceMatrix.array; for (let i = 0; i < drops.count; i++) pts.push({ kind: 'drop', ...project(e[i * 16 + 12], e[i * 16 + 13], e[i * 16 + 14]) }); }
    return pts;
  }, projectFn);
}

/** HUD 各區塊的 bounding box（隱藏的回 null） */
export async function hudBoxes(page) {
  return page.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el || el.hidden) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const col = box('.orders');
    const cards = col ? [...document.querySelectorAll('.order')].map((el) => { const b = el.getBoundingClientRect(); return { l: Math.max(b.left, col.l), t: Math.max(b.top, col.t), r: Math.min(b.right, col.r), b: Math.min(b.bottom, col.b) }; }).filter((c) => c.b > c.t) : [];
    return { vh: innerHeight, vw: innerWidth, topbar: box('.topbar'), zones: box('.zones'), dock: box('.dock'), hint: box('.hint'), orders: col, cards };
  });
}

export const overlap = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b);

export function report(page) {
  console.log('  errors:', page.errors.length ? '\n' + page.errors.join('\n') : 'none');
}
