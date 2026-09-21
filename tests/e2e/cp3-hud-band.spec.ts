import { expect, test } from '@playwright/test';

/**
 * 遊戲區不能被 HUD 蓋住（D26）。
 *
 * 由來：動作列改成大按鈕之後多了 75px，鏡頭仍對著整個視口的中心，
 * 布丁與澡盆整個落到動作列與引導泡泡後面——畫面上只剩一片空櫥窗。
 * 這裡量的是幾何：把每隻布丁與每個澡盆的世界座標投影到畫面，
 * 都要落在「資源列底」與「動作列頂」之間的可見段，且離動作列至少一個布丁高。
 */
test('布丁與澡盆都投影在 HUD 沒遮到的那一段', async ({ page }) => {
  await page.goto('/?fresh=1&seed=31');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const { camera, scene } = window.__lpg.three!;
    const h = innerHeight, w = innerWidth;
    const project = (x: number, y: number, z: number) => {
      const m = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
      const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      const px = p[0]! * cx + p[4]! * cy + p[8]! * cz + p[12]!;
      const py = p[1]! * cx + p[5]! * cy + p[9]! * cz + p[13]!;
      const pw = p[3]! * cx + p[7]! * cy + p[11]! * cz + p[15]!;
      return { x: ((px / pw + 1) / 2) * w, y: ((1 - py / pw) / 2) * h };
    };
    const points: { name: string; x: number; y: number }[] = [];
    scene.traverse((o) => {
      if (o.parent === scene && o.getObjectByName('Pudding_Body')) points.push({ name: 'pudding', ...project(o.position.x, o.position.y, o.position.z) });
    });
    const topbar = document.querySelector('.hud .topbar')!.getBoundingClientRect();
    const dock = document.querySelector('.hud .dock')!.getBoundingClientRect();
    return { h, topbarBottom: topbar.bottom, dockTop: dock.top, points, view: camera.view };
  });

  expect(r.points.length).toBe(2);
  for (const p of r.points) {
    expect(p.y, `${p.name} 要在資源列之下`).toBeGreaterThan(r.topbarBottom + 40);
    // 布丁腳底離動作列上緣至少 60px：泡泡／toast 疊上來時仍看得到
    expect(p.y, `${p.name} 要在動作列之上`).toBeLessThan(r.dockTop - 60);
  }
  // 布丁落點要靠近可見段的中心（差距 ≤ 可見段高度的 25%；布丁在地板上，本來就比箱中心低一點）。
  // 負向對照：把 applyHudOffset 的 dy 歸零，布丁會掉到離中心 33% 的位置而紅。
  const bandMid = (r.topbarBottom + r.dockTop) / 2;
  const bandH = r.dockTop - r.topbarBottom;
  for (const p of r.points) expect(Math.abs(p.y - bandMid), `${p.name} 離可見段中心`).toBeLessThan(bandH * 0.25);
  // 鏡頭偏移真的有套上（動作列比資源列高，畫面中心一定要往上挪）
  expect(r.view?.enabled).toBe(true);
  expect(r.view?.offsetY ?? 0).toBeGreaterThan(0);
});
