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

/**
 * 鏡頭有投影偏移之後，點畫布撿原料的射線也要跟著對：
 * 把掉落物的世界座標投影到畫面、在那一點點下去，原料要被撿走；
 * 往下點 offsetY 那麼多（＝沒有偏移時它會出現的位置）則不能撿到——這是「偏移沒套進射線」的負向對照。
 */
test('點畫布上的原料撿得到（投影偏移有套進射線）', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?fresh=1&seed=31&fastTime=8');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.getByRole('button', { name: /^倒焦糖/ }).click();
  await page.waitForFunction(() => window.__lpg.state!.drops.length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(700); // 剛掉出來會彈一下（0.45 遊戲秒），等它落定再量

  const target = await page.evaluate(() => {
    const { camera, scene } = window.__lpg.three!;
    // InstancedMesh 的實例矩陣：第 0 個實例的平移在 elements[12..14]（不用 getMatrixAt，那需要 three 的 Matrix4 物件）
    const drops = scene.getObjectByName('Drops') as unknown as { instanceMatrix: { array: ArrayLike<number> } };
    const e = drops.instanceMatrix.array;
    const x = e[12]!, y = e[13]!, z = e[14]!;
    const mv = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
    const cx = mv[0]! * x + mv[4]! * y + mv[8]! * z + mv[12]!;
    const cy = mv[1]! * x + mv[5]! * y + mv[9]! * z + mv[13]!;
    const cz = mv[2]! * x + mv[6]! * y + mv[10]! * z + mv[14]!;
    const px = p[0]! * cx + p[4]! * cy + p[8]! * cz + p[12]!;
    const py = p[1]! * cx + p[5]! * cy + p[9]! * cz + p[13]!;
    const pw = p[3]! * cx + p[7]! * cy + p[11]! * cz + p[15]!;
    return { sx: ((px / pw + 1) / 2) * innerWidth, sy: ((1 - py / pw) / 2) * innerHeight, offsetY: camera.view?.offsetY ?? 0, drops: window.__lpg.state!.drops.length };
  });
  expect(target.offsetY).toBeGreaterThan(20);

  // 負向對照：點在「沒有偏移時」的位置，不能撿到
  await page.mouse.click(target.sx, target.sy + target.offsetY);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__lpg.state!.drops.length)).toBe(target.drops);

  await page.mouse.click(target.sx, target.sy);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__lpg.state!.drops.length)).toBe(target.drops - 1);
});

/**
 * 訂單欄不得蓋住啟用層的地板（布丁與掉落物），最窄的手機（320×568）也一樣。
 * 由來：三張訂單卡在 iPhone SE 疊到 309px，地板從 257px 起，兩隻布丁整個在卡片後面且點不到。
 * 卡片矩形要跟欄的可見範圍取交集（欄會捲動，被剪掉的部分不算蓋住）。
 * 負向對照：拿掉 .orders 的 max-height → SE 上兩隻布丁被蓋而紅。
 */
test.describe('320px 寬', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('三張訂單卡加五份掉落物，沒有任何布丁或原料被卡片蓋住', async ({ page }) => {
    await page.goto('/?fresh=1&seed=5');
    await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
    await page.evaluate(() => {
      const s = window.__lpg.state!;
      for (let i = 0; i < 3; i++) s.orders.push({ id: `o${i}`, species: 'caramel', qty: 2, price: 100 + i, createdAt: s.time, expiresAt: s.time + 300 });
      const b = s.basins[0]!;
      for (let i = 0; i < 5; i++) {
        const a = i * 1.2566;
        s.drops.push({ id: `dd${i}`, zone: 'c0t1', kind: 'ingredient' as const, species: 'caramel', pos: { x: b.pos.x + 0.32 * Math.cos(a), z: b.pos.z + 0.224 * Math.sin(a) }, bornAt: s.time - 5 });
      }
    });
    await page.waitForTimeout(700);

    const r = await page.evaluate(() => {
      const { camera, scene } = window.__lpg.three!;
      const proj = (x: number, y: number, z: number) => {
        const mv = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
        const cx = mv[0]! * x + mv[4]! * y + mv[8]! * z + mv[12]!;
        const cy = mv[1]! * x + mv[5]! * y + mv[9]! * z + mv[13]!;
        const cz = mv[2]! * x + mv[6]! * y + mv[10]! * z + mv[14]!;
        const px = p[0]! * cx + p[4]! * cy + p[8]! * cz + p[12]!;
        const py = p[1]! * cx + p[5]! * cy + p[9]! * cz + p[13]!;
        const pw = p[3]! * cx + p[7]! * cy + p[11]! * cz + p[15]!;
        return { x: ((px / pw + 1) / 2) * innerWidth, y: ((1 - py / pw) / 2) * innerHeight };
      };
      const pts: { kind: string; x: number; y: number }[] = [];
      scene.traverse((o) => {
        if (o.parent === scene && o.getObjectByName('Pudding_Body')) pts.push({ kind: 'pudding', ...proj(o.position.x, o.position.y + 0.12, o.position.z) });
      });
      const drops = scene.getObjectByName('Drops') as unknown as { count: number; instanceMatrix: { array: ArrayLike<number> } };
      const e = drops.instanceMatrix.array;
      for (let i = 0; i < drops.count; i++) pts.push({ kind: 'drop', ...proj(e[i * 16 + 12]!, e[i * 16 + 13]!, e[i * 16 + 14]!) });
      const col = document.querySelector('.orders')!.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.order')]
        .map((el) => { const b = el.getBoundingClientRect(); return { l: Math.max(b.left, col.left), t: Math.max(b.top, col.top), r: Math.min(b.right, col.right), b: Math.min(b.bottom, col.bottom) }; })
        .filter((c) => c.b > c.t);
      const covered = pts.filter((q) => cards.some((c) => q.x >= c.l - 8 && q.x <= c.r + 8 && q.y >= c.t - 8 && q.y <= c.b + 8));
      return { cards: cards.length, pts: pts.length, covered };
    });
    expect(r.cards).toBeGreaterThan(0);
    expect(r.pts).toBe(7);
    expect(r.covered, '被訂單卡蓋住的布丁／原料').toEqual([]);
  });
});
