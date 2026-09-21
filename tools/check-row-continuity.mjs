// 驗「一整排櫃子左右連續、相鄰之間沒有空隙」。
// 沿著畫面上的水平線往場景射線，每一點都必須打到櫃體；打空＝該處透出背景＝有縫。
// 用法：npm run dev -- --host（另一個終端機）→ node tools/check-row-continuity.mjs
import { chromium, devices } from '@playwright/test';

const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';
const SAMPLES = 240;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
await page.waitForTimeout(600);

const result = await page.evaluate((samples) => {
  const { scene, camera, controls, raycaster } = window.__lpg.three;
  // 先拉到縮放上限：整排都進畫面，接縫才掃得到
  const t = controls.target;
  const d = camera.position.distanceTo(t);
  const dir = camera.position.clone().sub(t).normalize();
  camera.position.copy(t).add(dir.multiplyScalar(d * 2.4));
  camera.lookAt(t);
  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);

  const scan = (ndcY) => {
    const misses = [];
    for (let i = 0; i <= samples; i++) {
      const ndcX = -1 + (2 * i) / samples;
      raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      if (hits.length === 0) misses.push(+ndcX.toFixed(3));
    }
    return misses;
  };

  // 挑三條穿過櫃體的水平線：頂蓋、中層層板、底座
  const probes = {};
  for (const [name, ndcY] of [['頂蓋', 0.30], ['中層層板', -0.02], ['底座', -0.30]]) {
    const misses = scan(ndcY);
    probes[name] = { ndcY, misses: misses.length, sample: misses.slice(0, 8) };
  }
  return probes;
}, SAMPLES);

console.log(JSON.stringify(result, null, 2));
const bad = Object.entries(result).filter(([, v]) => v.misses > 0);
console.log(bad.length ? `有縫：${bad.map(([k, v]) => `${k} ${v.misses}/${SAMPLES + 1} 點打空`).join('、')}` : `連續：三條掃描線 ${SAMPLES + 1} 點全部打到櫃體`);
await browser.close();
process.exit(bad.length ? 1 : 0);
