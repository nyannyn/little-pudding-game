// 暫時的截圖腳本（不進版控）：CP11 畫面自己先看一遍
import { test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

const OUT = process.env.SHOT_DIR!;
test.use({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 });

async function boot(page: Page, query: string) {
  await page.addInitScript(() => { localStorage.setItem('lpg.hints.off', '1'); localStorage.setItem('lpg.a2hs.off', '1'); });
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}
async function step(page: Page, sec: number) {
  await page.evaluate((t) => { for (let left = t; left > 0; left -= 0.25) window.__lpg.step!(Math.min(0.25, left)); }, sec);
  await page.waitForTimeout(300);
}

test('shots', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999;
    for (const [i, id] of (['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'] as const).entries()) {
      s.bakery.machines[id] = 3;
      if (i % 2 === 0) s.bakery.stations[id] = { batch: { species: 'caramel', qty: 3, star: 1 }, startedAt: s.time, doneAt: s.time + 500 + i };
    }
    window.__lpg.stock!.set('shelf', 'caramel', [3, 0, 2, 0, 0]);
    window.__lpg.stock!.set('shelf', 'matcha', [2, 0, 0, 0, 0]);
    const ids = ['bear', 'rabbit', 'sheep', 'frog', 'owl', 'fox', 'pig', 'penguin'] as const;
    ids.forEach((id, i) => {
      if (i > 5) return;
      const r = s.regulars[id];
      r.unlocked = true; r.hearts = [4, 2, 9, 0, 10, 6][i]!; r.nextVisitAt = s.time + 600 * (i + 1);
    });
    s.regulars.bear.lastResult = { at: s.time - 10, day: 1, bought: true, dessert: 'caramel', star: 3, coins: 123, gift: null };
    s.orders.push({ id: 'oz1', species: 'caramel', qty: 12, price: 2400, createdAt: s.time, expiresAt: s.time + 3600, regularId: 'bear', star: 2 });
  });
  await step(page, 0.3);
  await page.evaluate(() => {
    window.__lpg.bakery!.regularCame('bear', true, 'caramel');
    window.__lpg.bakery!.regularCame('rabbit', false, null);
  });
  await step(page, 1.2);
  await page.screenshot({ path: `${OUT}/01-bakery-regulars-walk.png` });
  await page.screenshot({ path: `${OUT}/01z-zoom.png`, clip: { x: 60, y: 480, width: 300, height: 180 } });
  await step(page, 2.2);
  await page.screenshot({ path: `${OUT}/02-bakery-regulars-pick.png` });
  await page.screenshot({ path: `${OUT}/02z-zoom.png`, clip: { x: 60, y: 500, width: 300, height: 160 } });
  await page.locator('[data-a="openRegulars"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03-roster.png` });
  await page.locator('[data-a="readStory"][data-arg="owl:3"]').click();
  await page.screenshot({ path: `${OUT}/04-story.png` });
  await page.locator('[data-a="closeRegulars"]').click();
  await page.evaluate(() => window.__lpg.stock!.set('desserts', 'caramel', [2, 0, 1, 0, 1]));
  await step(page, 0.3);
  await page.locator('[data-a="stockShelf"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-shelfcard.png` });
  await page.locator('[data-a="closeShelf"]').click();
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const id of Object.keys(s.bakery.stations) as (keyof typeof s.bakery.stations)[]) s.bakery.stations[id] = { batch: null, startedAt: 0, doneAt: 0 };
    s.eggs = 40; s.pantry.flour = 40; s.stock.milk = 40;
    window.__lpg.stock!.set('ingredients', 'caramel', [6, 0, 4, 0, 0]);
  });
  await step(page, 0.3);
  await page.locator('[data-a="openMenu"]').click();
  await page.locator('[data-a="menuStar"][data-arg="caramel:3"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/06-menu-stars.png` });
  await page.locator('[data-a="closeMenu"]').click();
  await page.locator('[data-a="openOrders"]').click();
  await page.screenshot({ path: `${OUT}/07-orders.png` });

  // 農場：布丁頭頂星級、布丁卡、名牌
  await boot(page, '/?fresh=1&seed=5&pause=1&pop=6');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999; s.xp = 99999; s.items.starTonic = 2;
    s.puddings.forEach((p, i) => { p.star = (1 + (i % 5)) as 1; p.potential = 5; p.caramel = i === 2 ? 10 : 90; p.care = 700; });
  });
  await step(page, 0.3);
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="zone"]').click();
  await page.locator('[data-a="unlockZone"][data-arg="c0t2"]').click();
  await page.locator('[data-a="closeShop"]').first().click();
  await page.locator('[data-a="zoneStep"][data-arg="1"]').click();
  await step(page, 1.5);
  await page.evaluate(() => { (window.__lpg.state as GameState).zones.find((z) => z.id === 'c0t1')!.mode = 'elite'; });
  await step(page, 0.5);
  await page.screenshot({ path: `${OUT}/08-farm-stars.png` });
  const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state)) as GameState);
  await page.evaluate(() => { for (const q of (window.__lpg.state as GameState).puddings) { q.mode = 'resting'; q.restT = 999; q.hopT = 1; q.to = { ...q.pos }; } });
  await step(page, 1);
  const p = s.puddings.find((x) => x.zone === 'c0t1' && x.star === 3) ?? s.puddings[0]!;
  const s2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state)) as GameState);
  const p2 = s2.puddings.find((x) => x.id === p.id)!;
  const pt = await page.evaluate(([x, z]) => window.__lpg.toScreen!(x!, 0.09, z!), [p2.pos.x, p2.pos.z]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/09-pudding-card.png` });
});
