import { expect, test } from '@playwright/test';

/**
 * 點櫃子本身也是操作：鎖著的那一層 → 開商店；已解鎖的另一層 → 直接切過去。
 * 由來：畫面上的鎖牌寫著價格，新玩家第一反應就是去點它，點了沒反應會以為壞掉；
 * 切區只能靠上方 ‹ › 也太隱蔽。
 */
async function project(page: import('@playwright/test').Page, x: number, y: number, z: number) {
  return page.evaluate(([x, y, z]) => {
    const { camera } = window.__lpg.three!;
    const mv = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
    const cx = mv[0]! * x + mv[4]! * y + mv[8]! * z + mv[12]!;
    const cy = mv[1]! * x + mv[5]! * y + mv[9]! * z + mv[13]!;
    const cz = mv[2]! * x + mv[6]! * y + mv[10]! * z + mv[14]!;
    const px = p[0]! * cx + p[4]! * cy + p[8]! * cz + p[12]!;
    const py = p[1]! * cx + p[5]! * cy + p[9]! * cz + p[13]!;
    const pw = p[3]! * cx + p[7]! * cy + p[11]! * cz + p[15]!;
    return { x: ((px / pw + 1) / 2) * innerWidth, y: ((1 - py / pw) / 2) * innerHeight };
  }, [x, y, z] as const);
}

/** 三層地板的世界高度（從 TankFloors 幾何讀，不複製 cabinet.ts 的常數） */
async function floorYs(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => {
    const floors = window.__lpg.three!.scene.getObjectByName('TankFloors') as unknown as { geometry: { attributes: { position: { count: number; getY(i: number): number } } } };
    const pos = floors.geometry.attributes.position;
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) ys.add(Math.round(pos.getY(i) * 1000) / 1000);
    // 每層地板是一塊薄板，取每塊的上緣：把高度排序後每兩個取大的那個
    const sorted = [...ys].sort((a, b) => a - b);
    return sorted.filter((_, i) => i % 2 === 1);
  });
}

test('點鎖牌開商店；解鎖後點另一層就切區', async ({ page }) => {
  await page.goto('/?fresh=1&seed=31');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const ys = await floorYs(page);
  expect(ys.length).toBe(3);

  // ① 上層名牌（右前方那塊寫著價格的牌子；鎖本體在畫面正中央上方，會被資源列擋住）
  const plateX = await page.evaluate(() => {
    const plates = window.__lpg.three!.scene.getObjectByName('TankPlates') as unknown as { geometry: { computeBoundingBox(): void; boundingBox: { min: { x: number }; max: { x: number } } } };
    plates.geometry.computeBoundingBox();
    return (plates.geometry.boundingBox.min.x + plates.geometry.boundingBox.max.x) / 2;
  });
  const plate = await project(page, plateX, ys[2]! + 0.28, 0.72);
  const topbarBottom = await page.evaluate(() => document.querySelector('.hud .topbar')!.getBoundingClientRect().bottom);
  expect(plate.y, '名牌要露在資源列下方').toBeGreaterThan(topbarBottom);
  await page.mouse.click(plate.x, plate.y);
  await page.waitForTimeout(300);
  await expect(page.locator('.sheet')).toBeVisible();
  // 點鎖牌進來的要直接落在「擴建」頁，玩家不必再自己找
  await expect(page.locator('[data-a="shopTab"][data-arg="zone"]')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '關閉' }).click();

  // ② 解鎖上層（鏡頭移上去），再點中層地板前緣 → 切回中層
  // D25：分區有上架等級，這裡測的是點櫃子切區，等級直接給滿
  await page.evaluate(() => { window.__lpg.state!.coins = 999; window.__lpg.state!.xp = 99999; });
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="zone"]').click();
  await page.locator('[data-a="unlockZone"][data-arg="c0t2"]').click();
  await page.getByRole('button', { name: '關閉' }).click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__lpg.state!.activeZone)).toBe('c0t2');

  // 從上層往下看，中層只露出上半截（其餘在動作列後面）：由高往低找第一個露出來的點
  const dockTop = await page.evaluate(() => document.querySelector('.hud .dock')!.getBoundingClientRect().top);
  let mid: { x: number; y: number } | null = null;
  for (let h = 1.35; h > 0.2 && !mid; h -= 0.15) {
    const q = await project(page, 0, ys[1]! + h, 0.7);
    if (q.y < dockTop - 12) mid = q;
  }
  expect(mid, '中層要有一部分露在動作列上方才點得到').not.toBeNull();
  await page.mouse.click(mid!.x, mid!.y);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__lpg.state!.activeZone)).toBe('c0t1');
});
