import { expect, test } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * D48：左側每隻布丁的狀態卡拿掉，改成頭頂小圖示（想泡澡＝澡盆、幼布丁＝嫩芽）＋想泡澡時垂眼。
 * 圖示是一個共用 InstancedMesh，它的 count 就是「頭上有圖示的隻數」。
 */
type IconMesh = { count: number; visible: boolean };

async function boot(page: import('@playwright/test').Page, pop: number) {
  await page.goto(`/?debug=1&fresh=1&seed=7&pop=${pop}&pause=1`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}

test('狀態卡不見了；頭頂圖示＝想泡澡＋幼布丁的隻數，泡澡中的不算', async ({ page }) => {
  await boot(page, 6);
  await expect(page.locator('.living')).toHaveCount(0);

  const r = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    const old = s.time - 9999;
    const ps = s.puddings;
    ps.forEach((p) => { p.caramel = 90; p.bornAt = old; });
    const icons = () => window.__lpg.three!.scene.getObjectByName('Pudding_MoodIcons') as unknown as IconMesh;
    window.__lpg.step!(0.05);
    const none = { count: icons().count, visible: icons().visible };

    ps[0]!.caramel = 5; // 想泡澡
    ps[1]!.caramel = 5; // 想泡澡
    ps[2]!.bornAt = s.time; // 幼布丁
    ps[3]!.caramel = 5; // 焦糖低但正在泡澡：不該有圖示
    ps[3]!.mode = 'bathing';
    ps[3]!.bathT = 999; // 不設的話下一步就泡完、焦糖補滿，這條就測不到泡澡中
    window.__lpg.step!(0.05);
    const some = icons().count;

    // 眼睛：想泡澡的那隻比悠閒的那隻扁（除掉本體的比值，跳躍時整隻會被拉長）
    for (let k = 0; k < 20; k++) window.__lpg.step!(0.05);
    const eyes = window.__lpg.three!.scene.getObjectByName('Puddings_Eyes') as unknown as { instanceMatrix: { array: ArrayLike<number> }; count: number };
    const body = window.__lpg.three!.scene.getObjectByName('Puddings_Body') as unknown as { instanceMatrix: { array: ArrayLike<number> } };
    const sy = (m: ArrayLike<number>, i: number) => Math.hypot(m[i * 16 + 4]!, m[i * 16 + 5]!, m[i * 16 + 6]!);
    const ratio = (i: number) => sy(eyes.instanceMatrix.array, i) / sy(body.instanceMatrix.array, i);
    return { none, some, tired: ratio(0), idle: ratio(4) };
  });
  expect(r.none).toEqual({ count: 0, visible: false });
  expect(r.some).toBe(3);
  expect(r.tired / r.idle).toBeLessThan(0.75);
});

test('十五隻全想泡澡，draw calls 仍在預算內', async ({ page }) => {
  await boot(page, 15);
  const r = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const p of s.puddings) { p.caramel = 5; p.bornAt = s.time - 9999; }
    window.__lpg.step!(0.05);
    const icons = window.__lpg.three!.scene.getObjectByName('Pudding_MoodIcons') as unknown as IconMesh;
    return { count: icons.count };
  });
  expect(r.count).toBe(15);
  await page.waitForTimeout(600);
  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  expect(stats.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});
