// 量「櫥窗在手機直向畫面上占多少」——改構圖前後都跑，用數字比，不用眼睛猜。
// 用法：npm run dev -- --host（另一個終端機）→ node tools/measure-framing.mjs
//
// 頁面裡不能 import 'three'（裸模組名解析不到），所以矩陣運算自己做：
// three 的 Matrix4.elements 是 column-major。
import { chromium, devices } from '@playwright/test';

const BASE = process.env.LPG_BASE ?? 'http://127.0.0.1:5173';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
await page.waitForTimeout(1000);

const out = await page.evaluate(() => {
  const { scene, camera } = window.__lpg.three;

  const apply = (e, v) => [
    e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12] * v[3],
    e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13] * v[3],
    e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14] * v[3],
    e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15] * v[3],
  ];

  const measure = (name) => {
    const root = scene.getObjectByName(name);
    if (!root) return null;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const ndc = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const m = o.matrixWorld.elements;
      for (const x of [bb.min.x, bb.max.x])
        for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            const w = apply(m, [x, y, z, 1]);
            const v = apply(camera.matrixWorldInverse.elements, w);
            const c = apply(camera.projectionMatrix.elements, v);
            if (c[3] !== 0) ndc.push([c[0] / c[3], c[1] / c[3]]);
          }
    });
    if (!ndc.length) return null;

    const xs = ndc.map((p) => p[0]);
    const ys = ndc.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return {
      widthPct: +(((maxX - minX) / 2) * 100).toFixed(1),      // NDC 跨度 2 ＝ 滿版
      heightPct: +(((maxY - minY) / 2) * 100).toFixed(1),
      centerYPct: +(((maxY + minY) / 2 / 2) * 100).toFixed(1), // 0 ＝ 畫面正中，正值偏上
      clipped: minX < -1 || maxX > 1 || minY < -1 || maxY > 1,
    };
  };

  // OrbitControls 允許左右各 30°，轉過去投影寬度會變大——邊距夠不夠要量極限位置，不是量正面
  const { controls } = window.__lpg.three;
  const t = controls.target;
  const p0 = camera.position.clone();
  const atAzimuth = (deg) => {
    const a = (deg * Math.PI) / 180;
    const dx = p0.x - t.x, dz = p0.z - t.z;
    camera.position.set(t.x + dx * Math.cos(a) - dz * Math.sin(a), p0.y, t.z + dx * Math.sin(a) + dz * Math.cos(a));
    camera.lookAt(t);
    camera.updateMatrixWorld(true);
    return measure('Cabinet');
  };
  const azimuth = { '-30': atAzimuth(-30), '0': atAzimuth(0), '+30': atAzimuth(30) };
  camera.position.copy(p0);
  camera.lookAt(t);
  camera.updateMatrixWorld(true);

  return {
    cabinet: measure('Cabinet'),
    pudding: measure('Pudding_Root'),
    cabinetAtAzimuth: azimuth,
    camera: { fov: camera.fov, pos: camera.position.toArray().map((v) => +v.toFixed(2)) },
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
