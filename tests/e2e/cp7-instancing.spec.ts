import { expect, test } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { readStats } from './helpers';

/**
 * AC7-4：布丁改 InstancedMesh（D41）之後，隻數不再換算成 draw calls。
 *
 * 改版前實測（2026-09-22，同一個視口）：無布丁 13、每多一隻 +5，`?pop=15` ＝ **88**；
 * 改版後不管幾隻都是本體 1＋眼睛 1＋本體陰影 1，`?pop=15` 實測 16。
 * 上限寫 30（計畫 D41 的目標），比實測寬——這條鎖的是「隻數不再是乘數」，不是精確值。
 */
test('AC7-4 十五隻布丁同框，draw calls 仍 ≤ 30', async ({ page }) => {
  const stats = await readStats(page, '&fresh=1&seed=7&pop=15');
  test.info().annotations.push({ type: 'stats', description: JSON.stringify(stats) });
  expect(await page.evaluate(() => (window.__lpg.state as GameState).puddings.length)).toBe(15);
  expect(stats.drawCalls).toBeLessThanOrEqual(30);
});

test('每隻布丁的物種顏色走 instance 屬性，不是共用材質色', async ({ page }) => {
  await page.goto('/?debug=1&fresh=1&seed=7&pop=2&pause=1');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  const colors = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.puddings[0]!.species = 'matcha';
    s.puddings[1]!.species = 'strawberry';
    window.__lpg.step!(0.05);
    const body = window.__lpg.three!.scene.getObjectByName('Puddings_Body') as unknown as {
      count: number;
      geometry: { getAttribute(n: string): { array: ArrayLike<number> } };
    };
    const a = body.geometry.getAttribute('aBody').array;
    const t = body.geometry.getAttribute('aTopping').array;
    return { count: body.count, body0: [a[0], a[1], a[2]], body1: [a[3], a[4], a[5]], top0: [t[0], t[1], t[2]], top1: [t[3], t[4], t[5]] };
  });
  expect(colors.count).toBe(2);
  // 抹茶是綠的（G 最大）、草莓是粉的（R 最大）；兩隻的體色與頂色都要各自不同
  expect(colors.body0[1]).toBeGreaterThan(colors.body0[0]!);
  expect(colors.body1[0]).toBeGreaterThan(colors.body1[1]!);
  expect(colors.body0).not.toEqual(colors.body1);
  expect(colors.top0).not.toEqual(colors.top1);
});
