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
 * 頂列的數字膠囊不可以被右邊的鈕蓋住，也不可以超出螢幕。
 *
 * 原本這裡測的是「訂單卡不蓋住布丁」——D50 起訂單搬進工坊、收進右欄的一顆鈕，農場畫面不再有訂單卡，
 * 那條風險整個消失了。換成這一條：2026-09-23 iPhone SE 截圖上齒輪鈕蓋掉了第四個數字（甜點數）；
 * 2026-09-25 iPhone 14（390px）工坊畫面，蛋 13722 顆時甜點膠囊整顆跑到齒輪與商店鈕底下——
 * （使用者的手機是 402px 寬）原本只測 320px＋小數字，量不到這個。所以六種寬度×中後期的數字×極端數字都跑。
 * 負向對照：膠囊收窄的 `@media (max-width: 439px)` 改回 359px → 375px 以上紅；工坊的原料膠囊不藏 → 工坊紅；
 * 頂列改回 `String(n)` → 極端數字紅。
 */
for (const [w, h] of [[320, 568], [375, 667], [390, 844], [402, 874], [414, 896], [430, 932]] as const) {
  test.describe(`${w}px 寬`, () => {
    test.use({ viewport: { width: w, height: h } });

    for (const view of ['farm', 'bakery'] as const) {
      test(`頂列的數字都沒有被按鈕蓋住（${view}）`, async ({ page }) => {
        await page.goto(`/?fresh=1&seed=5${view === 'bakery' ? '&view=bakery' : ''}`);
        await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
        // 中後期實際存檔的量級（使用者截圖）與極端值各量一次
        for (const [coins, eggs, ing, des] of [[7334, 13722, 7414, 4321], [987654321, 99999, 99999, 99999]] as const) {
          await page.evaluate(({ c, e, i, d }) => {
            const s = window.__lpg.state!;
            s.coins = c; s.eggs = e;
            for (const k of Object.keys(s.ingredients) as (keyof typeof s.ingredients)[]) s.ingredients[k] = 0;
            for (const k of Object.keys(s.desserts) as (keyof typeof s.desserts)[]) s.desserts[k] = 0;
            s.ingredients.caramel = i; s.desserts.caramel = d;
          }, { c: coins as number, e: eggs as number, i: ing as number, d: des as number });
          await page.waitForTimeout(400);
          const r = await page.evaluate(() => {
            const box = (el: Element) => el.getBoundingClientRect();
            // 只算看得到的膠囊（各畫面會藏掉用不到的那一個，見 hud.css）
            const chips = [...document.querySelectorAll('.topbar .chip')].map(box).filter((b) => b.width > 0);
            const btns = [...document.querySelectorAll('.topbar .iconbtn')].map(box);
            const hit = chips.some((c) => btns.some((b) => c.right > b.left + 1 && c.left < b.right - 1 && c.bottom > b.top && c.top < b.bottom));
            const text = [...document.querySelectorAll('.topbar .chip b')].map((b) => b.textContent);
            return { hit, chips: chips.length, lastRight: Math.round(chips[chips.length - 1]!.right), firstBtn: Math.round(btns[0]!.left), vw: innerWidth, text };
          });
          expect(r.chips).toBe(3);
          expect(r.hit, JSON.stringify(r)).toBe(false);
          expect(r.lastRight, JSON.stringify(r)).toBeLessThanOrEqual(r.vw);
        }
      });
    }
  });
}

/** 菜單卡片的甜點圖要待在自己的圓框裡（2026-09-25：商店卡片的 `inset: 10px` 漏進菜單，圖整張往右下偏 10px） */
test('菜單卡片的圖示沒有偏出圓框', async ({ page }) => {
  await page.goto('/?fresh=1&seed=5&view=bakery');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.click('[data-a="openMenu"]');
  await page.locator('.rcard .art').first().waitFor();
  const off = await page.evaluate(() => [...document.querySelectorAll('.rcard .art')].map((a) => {
    const b = a.getBoundingClientRect(), i = a.querySelector('.main')!.getBoundingClientRect();
    return Math.max(Math.abs(i.left - b.left), Math.abs(i.top - b.top), Math.abs(i.right - b.right), Math.abs(i.bottom - b.bottom));
  }));
  expect(off.length).toBeGreaterThan(0);
  expect(Math.max(...off)).toBeLessThanOrEqual(1);
});
