import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * AC11-15：CP11 新增的東西不壓版（寬度表沿用 `cp3-hud-band`：320／375／390／402／414／430）。
 * 常客鈕、名冊卡、名字泡泡、布丁卡、上架卡——不蓋住頂列、右欄、動作列、底座牌；字不溢出自己的框。
 */

type Box = { x: number; y: number; width: number; height: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;

async function boot(page: Page, query: string) {
  await page.addInitScript(() => {
    localStorage.setItem('lpg.hints.off', '1');
    localStorage.setItem('lpg.a2hs.off', '1');
  });
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}

async function step(page: Page, sec: number) {
  await page.evaluate((t) => {
    for (let left = t; left > 0; left -= 0.25) window.__lpg.step!(Math.min(0.25, left));
  }, sec);
  await page.waitForTimeout(250);
}

/** 容器裡每個元素的內容寬度都塞得進自己（Range 量排出來的字，不受 overflow 影響） */
async function overflowing(page: Page, sel: string): Promise<string[]> {
  return page.$$eval(sel, (els) => els.flatMap((e) => {
    const el = e as HTMLElement;
    return el.scrollWidth > el.clientWidth + 1 ? [`${el.className}:${el.textContent?.slice(0, 20)}`] : [];
  }));
}

async function inViewport(page: Page, sel: string, vw: number, vh: number) {
  const b = (await page.locator(sel).first().boundingBox())!;
  expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(-0.5);
  expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, `${sel} right`).toBeLessThanOrEqual(vw + 0.5);
  expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(vh + 0.5);
}

for (const [w, h] of [[320, 568], [375, 667], [390, 844], [402, 874], [414, 896], [430, 932]] as const) {
  test.describe(`${w}px 寬`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('工坊：常客鈕、名字泡泡、名冊卡、上架卡不壓版', async ({ page }) => {
      await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
      await page.evaluate(() => {
        const s = window.__lpg.state as GameState;
        s.coins = 99999;
        for (const [i, id] of (['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'] as const).entries()) {
          s.bakery.machines[id] = 12;
          s.bakery.stations[id] = { batch: { species: 'brulee', qty: 12, star: 1 }, startedAt: s.time, doneAt: s.time + 500 + i };
        }
        window.__lpg.stock!.set('shelf', 'caramel', [2, 0, 3, 0, 1]);
        window.__lpg.stock!.set('desserts', 'custard', [4, 2, 0, 5, 0]);
      });
      await step(page, 0.3);
      // 最長的名字與文案：解鎖全部常客、好感各不同、每位都有一張特別訂單與上次結果
      await page.evaluate(() => {
        const s = window.__lpg.state as GameState;
        const ids = ['bear', 'rabbit', 'sheep', 'frog', 'owl', 'fox', 'pig', 'penguin'] as const;
        ids.forEach((id, i) => {
          const r = s.regulars[id];
          r.unlocked = true; r.hearts = i + 3; r.storySeen = 0; r.nextVisitAt = s.time + 3000 * (i + 1);
          r.lastResult = { at: s.time - 10, day: 1, bought: i % 2 === 0, dessert: i % 2 === 0 ? 'sakura' : null, star: i % 2 === 0 ? 5 : null, coins: 12345, gift: i % 4 === 0 ? 'tonic' : null };
          s.orders.push({ id: `oz${i}`, species: 'matchalatte', qty: 20, price: 99999, createdAt: s.time, expiresAt: s.time + 3600, regularId: id, star: 5 });
        });
      });
      await page.evaluate(() => {
        window.__lpg.bakery!.regularCame('penguin', true, 'sakura');
        window.__lpg.bakery!.regularCame('sheep', false, null);
      });
      await step(page, 2.5);

      const fixed: [string, Box][] = [];
      for (const sel of ['.topbar', '.daybar', '.dock']) fixed.push([sel, (await page.locator(sel).boundingBox())!]);
      const reg = (await page.locator('.regbtn').boundingBox())!;
      for (const [sel, b] of fixed) expect(hit(reg, b), `常客鈕 vs ${sel}`).toBe(false);
      expect(reg.x + reg.width).toBeLessThanOrEqual(w);
      const stags = page.locator('.stag:not([hidden])');
      for (let i = 0; i < (await stags.count()); i++) expect(hit(reg, (await stags.nth(i).boundingBox())!), `常客鈕 vs 底座牌 ${i}`).toBe(false);

      // 名字泡泡：在畫面內、不壓頂列／右欄／動作列
      const rtags = page.locator('.rtag:not([hidden])');
      await expect(rtags).toHaveCount(2);
      const right = (await page.locator('.rightcol').boundingBox())!;
      for (let i = 0; i < 2; i++) {
        const b = (await rtags.nth(i).boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(w);
        for (const [sel, fb] of [...fixed, ['.rightcol', right] as [string, Box]]) expect(hit(b, fb), `名字泡泡 ${i} vs ${sel}`).toBe(false);
      }

      // 名冊卡
      await page.locator('[data-a="openRegulars"]').click();
      await inViewport(page, '.regcard .card', w, h);
      expect(await overflowing(page, '.regcard .reg .txt, .regcard .reg .nm, .regcard .chs')).toEqual([]);
      await page.locator('[data-a="readStory"][data-arg="penguin:3"]').click(); // ♥10：三章都有
      await inViewport(page, '.regcard .card', w, h);
      expect(await overflowing(page, '.regcard .story')).toEqual([]);
      await page.locator('[data-a="closeRegulars"]').click();

      // 上架卡
      await page.locator('[data-a="stockShelf"]').click();
      await inViewport(page, '.shelfcard .card', w, h);
      expect(await overflowing(page, '.shelfcard .srow, .shelfcard .srow .txt')).toEqual([]);
      await page.locator('[data-a="closeShelf"]').click();

      // 預訂單卡（常客的特別訂單多一行）
      await page.locator('[data-a="openOrders"]').click();
      await inViewport(page, '.ordercard .card', w, h);
      expect(await overflowing(page, '.ordercard .order .t, .ordercard .order .who')).toEqual([]);
    });

    test('農場：布丁卡與名牌旁的量產／精養鈕不壓版', async ({ page }) => {
      await boot(page, '/?fresh=1&seed=5&pause=1&pop=3');
      await page.evaluate(() => {
        const s = window.__lpg.state as GameState;
        s.coins = 99999; s.xp = 99999; s.items.starTonic = 3;
        for (const p of s.puddings) { p.mode = 'resting'; p.restT = 999; p.caramel = 90; }
      });
      await step(page, 0.3);
      await page.getByRole('button', { name: '商店' }).click();
      await page.locator('[data-a="shopTab"][data-arg="zone"]').click();
      for (const z of ['c0t2', 'c0t0', 'c1t1']) await page.locator(`[data-a="unlockZone"][data-arg="${z}"]`).click();
      await page.locator('[data-a="closeShop"]').first().click();
      // 二號櫥窗・中層（名字最長）切成精養：名牌那一列最寬的情況
      await page.evaluate(() => { (window.__lpg.state as GameState).zones.find((z) => z.id === 'c1t1')!.mode = 'elite'; });
      await step(page, 0.5);
      const zones = (await page.locator('.zones').boundingBox())!;
      expect(zones.x + zones.width).toBeLessThanOrEqual(w);
      for (const sel of ['.topbar', '.rightcol', '.dock']) expect(hit(zones, (await page.locator(sel).boundingBox())!), `名牌列 vs ${sel}`).toBe(false);
      expect(await overflowing(page, '.zones')).toEqual([]);

      // 回中層點一隻布丁，給牠最長的狀態：★4／潛力 5、住在精養區（有升星藥鈕）
      // 用名牌的 ‹ › 切回中層（直接改 activeZone 的話鏡頭不會跟過去）
      for (let i = 0; i < 4; i++) {
        const cur = await page.evaluate(() => (window.__lpg.state as GameState).activeZone);
        if (cur === 'c0t1') break;
        await page.locator('[data-a="zoneStep"][data-arg="1"]').click();
        await step(page, 0.6);
      }
      await page.evaluate(() => {
        const s = window.__lpg.state as GameState;
        s.zones.find((z) => z.id === 'c0t1')!.mode = 'elite';
        s.zones.find((z) => z.id === 'c1t1')!.mode = 'mass';
        const p = s.puddings.find((x) => x.zone === 'c0t1')!;
        p.star = 4; p.potential = 5; p.care = 1234;
        for (const q of s.puddings) { q.mode = 'resting'; q.restT = 999; q.hopT = 1; q.to = { ...q.pos }; }
      });
      await step(page, 1.2);
      const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state)) as GameState);
      const p = s.puddings.find((x) => x.zone === 'c0t1' && x.star === 4)!;
      const pt = await page.evaluate(([x, z]) => window.__lpg.toScreen!(x!, 0.09, z!), [p.pos.x, p.pos.z]);
      await page.mouse.click(pt.x, pt.y);
      await expect(page.locator('.pudcard')).toBeVisible();
      await inViewport(page, '.pudcard .card', w, h);
      expect(await overflowing(page, '.pudcard .phead .txt, .pudcard .care, .pudcard .prow, .pudcard .moves')).toEqual([]);
      await expect(page.locator('.pudcard [data-a="useTonic"]')).toBeVisible();
    });
  });
}
