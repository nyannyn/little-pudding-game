import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * CP11（D62–D70）星級與常客的介面：真的點（AC11-14 前半）、常客的 draw call（AC11-11）。
 * 名冊、特別訂單、名字泡泡在 `cp11-regulars.spec.ts`。
 */

async function boot(page: Page, query: string) {
  await page.addInitScript(() => {
    localStorage.setItem('lpg.hints.off', '1');
    localStorage.setItem('lpg.a2hs.off', '1');
  });
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}

const S = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state)) as GameState);

async function step(page: Page, sec: number) {
  await page.evaluate((t) => {
    for (let left = t; left > 0; left -= 0.25) window.__lpg.step!(Math.min(0.25, left));
  }, sec);
  await page.waitForTimeout(250);
}

/** 走商店真的解鎖上層（會送一隻布丁＋一個澡盆，鏡頭切過去） */
async function twoZones(page: Page) {
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999;
    s.xp = 99999;
  });
  await step(page, 0.3);
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="zone"]').click();
  await page.locator('[data-a="unlockZone"][data-arg="c0t2"]').click();
  await page.locator('[data-a="closeShop"]').first().click();
}

test('AC11-14：點布丁開布丁卡；櫥窗切成精養；布丁卡「搬到」精養區之後那隻開始長點數', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=5&pause=1');
  await twoZones(page);
  await step(page, 0.5);
  // 上層切成精養（解鎖完鏡頭就在上層）：名牌旁的切換鈕 → 確認卡 → 名牌變「精養」
  let s = await S(page);
  expect(s.activeZone).toBe('c0t2');
  await page.locator('.zones [data-a="zoneMode"]').click();
  await expect(page.locator('.confirmcard')).toBeVisible();
  await expect(page.locator('.confirmcard p')).toContainText('最多住 5 隻');
  await page.locator('[data-a="confirmYes"]').click();
  await expect(page.locator('.zones [data-a="zoneMode"]')).toHaveText('精養');
  s = await S(page);
  expect(s.zones.find((z) => z.id === 'c0t2')!.mode).toBe('elite');

  // 回中層，點一隻布丁
  await page.locator('[data-a="zoneStep"][data-arg="1"]').click();
  await step(page, 0.3);
  s = await S(page);
  expect(s.activeZone).toBe('c0t1');
  // 點之前讓那隻停在地上：跳到一半的布丁畫在半空，跟 state 的地面座標對不上（點不到是測試的問題不是產品）
  await page.evaluate(() => {
    const st = window.__lpg.state as GameState;
    for (const q of st.puddings) if (q.zone === 'c0t1') { q.mode = 'resting'; q.restT = 999; q.hopT = 1; q.to = { ...q.pos }; q.caramel = 90; }
  });
  await step(page, 1);
  s = await S(page);
  const p = s.puddings.find((x) => x.zone === 'c0t1')!;
  const pt = await page.evaluate(([x, z]) => window.__lpg.toScreen!(x!, 0.09, z!), [p.pos.x, p.pos.z]);
  await page.mouse.click(pt.x, pt.y);
  const card = page.locator('.pudcard');
  await expect(card).toBeVisible();
  await expect(card.locator('.why')).toContainText('量產區不會長星');
  // 搬到上層（精養）
  const move = card.locator('[data-a="movePud"][data-arg="c0t2"]');
  await expect(move).toContainText('精養');
  await move.click();
  s = await S(page);
  const moved = s.puddings.find((x) => x.id === p.id)!;
  expect(moved.zone).toBe('c0t2');
  // 讓牠泡一次本命液（熱焦糖）：照顧點數變成 3
  await page.evaluate((id) => {
    const st = window.__lpg.state as GameState;
    const q = st.puddings.find((x) => x.id === id)!;
    q.caramel = 5;
    const b = st.basins.find((x) => x.zone === 'c0t2')!;
    b.liquid = 'caramel'; b.preferredLiquid = 'caramel'; b.units = 3;
  }, p.id);
  for (let i = 0; i < 40; i++) {
    await step(page, 2);
    s = await S(page);
    if (s.puddings.find((x) => x.id === p.id)!.care > 0) break;
  }
  expect(s.puddings.find((x) => x.id === p.id)!.care).toBe(3);
  await expect(card.locator('.ctext')).toContainText(`照顧 3／${BALANCE.starCare[0]}`);
});

test('AC11-14：菜單選 ★3 分頁 → 開工只扣 ★3 原料，那一盤是 ★3', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const id of ['crack', 'mix', 'mold', 'bake'] as const) s.bakery.machines[id] = 5;
    s.eggs = 20; s.pantry.flour = 20;
    window.__lpg.stock!.set('ingredients', 'hojicha', [4, 0, 2, 0, 0]);
  });
  await step(page, 0.3);
  await page.locator('[data-a="openMenu"]').click();
  const card = page.locator('.rcard[data-id="hojicha"]');
  await expect(card.locator('[data-a="menuStar"][data-arg="hojicha:2"]')).toBeDisabled();
  await card.locator('[data-a="menuStar"][data-arg="hojicha:3"]').click();
  await expect(card.locator('[data-a="menuStar"][data-arg="hojicha:3"]')).toHaveAttribute('aria-selected', 'true');
  await card.locator('[data-a="portionMax"]').click();
  await expect(card.locator('.qty b')).toHaveText('2');
  await card.locator('[data-a="startBatch"]').click();
  const s = await S(page);
  expect(s.bakery.stations.crack.batch).toEqual({ species: 'hojicha', qty: 2, star: 3 });
  expect(s.ingredients.hojicha).toEqual([4, 0, 0, 0, 0]);
});

test('AC11-14：上架卡按星級分列；「上架 1」只擺那一星，「全部上架」先上低星', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.machines.stove = 1; s.bakery.machines.mold = 1; s.bakery.machines.chill = 1;
    window.__lpg.stock!.set('desserts', 'panna', [2, 0, 0, 1, 0]);
  });
  await step(page, 0.3);
  await page.locator('[data-a="stockShelf"]').click();
  const sc = page.locator('.shelfcard');
  await expect(sc).toBeVisible();
  await expect(sc.locator('.srow')).toHaveCount(2);
  await sc.locator('[data-a="shelfOne"][data-arg="panna:4"]').click();
  let s = await S(page);
  expect(s.bakery.shelf.panna).toEqual([0, 0, 0, 1, 0]);
  expect(s.desserts.panna).toEqual([2, 0, 0, 0, 0]);
  await expect(sc.locator('.srow[data-star="4"] .front')).toHaveText('1');
  await sc.locator('[data-a="shelfAll"]').click();
  s = await S(page);
  expect(s.bakery.shelf.panna).toEqual([2, 0, 0, 1, 0]);
});

test('AC11-11：七站滿載＋5 位散客＋2 位常客，draw calls ≤ 預算；一位常客只多 1 個 draw call', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1&debug=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const [i, id] of (['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'] as const).entries()) {
      s.bakery.machines[id] = 3;
      s.bakery.stations[id] = { batch: { species: 'brulee', qty: 4, star: 1 }, startedAt: s.time, doneAt: s.time + 500 + i };
    }
    window.__lpg.stock!.set('shelf', 'caramel', [12, 0, 0, 0, 0]);
    const bk = window.__lpg.bakery as unknown as { customerCame(x: string | null): void };
    for (let i = 0; i < 5; i++) bk.customerCame('caramel');
  });
  await step(page, 1);
  const base = await page.evaluate(() => window.__lpg.stats.drawCalls);
  await page.evaluate(() => window.__lpg.bakery!.regularCame('bear', true, 'caramel'));
  await step(page, 0.5);
  const one = await page.evaluate(() => ({ draw: window.__lpg.stats.drawCalls, n: window.__lpg.bakery!.regularCount }));
  await page.evaluate(() => {
    window.__lpg.bakery!.regularCame('rabbit', false, null);
    window.__lpg.bakery!.regularCame('sheep', true, 'panna'); // 第三位在門外排隊，不畫
  });
  await step(page, 1.5); // 第二位要等第一位走進來一段才進門（同時進門會疊在一起）
  const two = await page.evaluate(() => ({ draw: window.__lpg.stats.drawCalls, n: window.__lpg.bakery!.regularCount }));
  expect(one.n).toBe(1);
  expect(two.n).toBe(2);
  // 散客可能在這幾秒內走掉（少 1–2 個 instanced 的畫面變化不影響 draw call：散客整批是 2 個 draw call）
  expect(one.draw - base).toBe(1);
  expect(two.draw - base).toBe(2);
  expect(two.draw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});

test('頭頂星級徽章：★2 以上才畫，而且全部布丁共用一個 draw call', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&pause=1&debug=1&pop=6');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const p of s.puddings) p.caramel = 90; // 沒有人想泡澡：圖示只剩星星
  });
  await step(page, 0.5);
  const none = await page.evaluate(() => ({ draw: window.__lpg.stats.drawCalls, icons: window.__lpg.three!.scene.getObjectByName('Pudding_MoodIcons')!.visible }));
  expect(none.icons).toBe(false);
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.puddings.forEach((p, i) => { p.star = (1 + (i % 5)) as 1; p.potential = 5; });
  });
  await step(page, 0.5);
  const some = await page.evaluate(() => {
    const m = window.__lpg.three!.scene.getObjectByName('Pudding_MoodIcons') as unknown as { visible: boolean; count: number };
    return { draw: window.__lpg.stats.drawCalls, icons: m.visible, count: m.count };
  });
  expect(some.icons).toBe(true);
  expect(some.count).toBe(4); // 6 隻的星級是 1,2,3,4,5,1：★1 的兩隻不畫
  expect(some.draw - none.draw).toBe(1);
});
