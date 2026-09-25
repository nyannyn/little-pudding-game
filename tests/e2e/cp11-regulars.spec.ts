import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * CP11 常客（D66／D67／D70）：名冊、特別訂單、故事、名字泡泡——真的點（AC11-14 後半）。
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

/** 甜點店開張（焦糖布丁塔整條線 Lv1）→ 熊先生解鎖；架上擺 ★ 幾份焦糖布丁塔；熊先生幾秒後上門 */
async function openShop(page: Page, opts: { shelf: number[]; hearts?: number; inSec?: number }) {
  await page.evaluate(({ shelf, hearts, inSec }) => {
    const s = window.__lpg.state as GameState;
    for (const id of ['stove', 'crack', 'mix', 'mold', 'bake', 'decorate'] as const) s.bakery.machines[id] = 1;
    window.__lpg.stock!.set('shelf', 'caramel', shelf);
    s.bakery.nextCustomerAt = s.time + 9999; // 散客先別來搶
  }, opts);
  await step(page, 0.3); // 第一個 tick 判解鎖
  await page.evaluate(({ hearts, inSec }) => {
    const s = window.__lpg.state as GameState;
    s.regulars.bear.hearts = hearts ?? 0;
    s.regulars.bear.nextVisitAt = s.time + (inSec ?? 2);
  }, opts);
}

test('AC11-14：名冊顯示下一次來店；熊先生買到之後名冊的心 +1、上次結果寫買了什麼', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await openShop(page, { shelf: [2, 0, 0, 0, 0], inSec: 3 });
  let s = await S(page);
  expect(s.regulars.bear.unlocked).toBe(true);
  await page.locator('[data-a="openRegulars"]').click();
  const bear = page.locator('.regcard .reg[data-id="bear"]');
  await expect(bear).toContainText('熊先生');
  await expect(bear.locator('.next')).toContainText('今天');
  await expect(bear.locator('.hearts svg path[fill="#ec5a63"]')).toHaveCount(0);
  await expect(bear.locator('.last')).toHaveText('還沒來過');
  // 沒解鎖的：剪影＋怎麼解鎖
  await expect(page.locator('.regcard .reg[data-id="rabbit"]')).toContainText('店面人氣 Lv3');
  await page.locator('[data-a="closeRegulars"]').click();

  const coins = s.coins;
  await step(page, 5);
  s = await S(page);
  expect(s.regulars.bear.hearts).toBe(1);
  expect(s.coins).toBeGreaterThan(coins);
  // 名字泡泡：店裡那位常客頭上
  await expect(page.locator('.rtag:not([hidden]) b')).toHaveText('熊先生');
  await page.locator('[data-a="openRegulars"]').click();
  await expect(bear.locator('.hearts svg path[fill="#ec5a63"]')).toHaveCount(1);
  await expect(bear.locator('.last')).toContainText('買了 ★1 焦糖布丁塔');
  await expect(bear.locator('.next')).toContainText('天會來');
});

test('AC11-14：♥4 起來店開特別訂單，名冊與預訂單都看得到；交貨後 +2 心', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  // ♥4 → 最低 ★2；架上只有 ★1 → 買不到，但照樣開特別訂單
  await openShop(page, { shelf: [3, 0, 0, 0, 0], hearts: 4 });
  await step(page, 5);
  let s = await S(page);
  const o = s.orders.find((x) => x.regularId === 'bear')!;
  expect(o).toBeTruthy();
  expect(o.star).toBe(2);
  expect(s.regulars.bear.hearts).toBe(4);
  await page.locator('[data-a="openRegulars"]').click();
  await expect(page.locator('.regcard .reg[data-id="bear"] .ord')).toContainText(`×${o.qty}（★2 以上）`);
  await expect(page.locator('.regcard .reg[data-id="bear"] .last')).toContainText('撲空');
  await page.locator('[data-a="closeRegulars"]').click();

  // 湊齊 ★2 的份數 → 預訂單卡上那張寫著熊先生 → 交貨
  await page.evaluate(({ id, qty }) => {
    window.__lpg.stock!.set('desserts', id, [0, qty, 0, 0, 0]);
  }, { id: o.species, qty: o.qty });
  await step(page, 0.3);
  await page.locator('[data-a="openOrders"]').click();
  const card = page.locator(`.ordercard .order[data-id="${o.id}"]`);
  await expect(card.locator('.who')).toContainText('熊先生・★2 以上');
  await card.locator('[data-a="fulfill"]').click();
  s = await S(page);
  expect(s.orders.find((x) => x.id === o.id)).toBeUndefined();
  expect(s.regulars.bear.hearts).toBe(6);
});

test('故事：♥2 解鎖第 1 章，名冊鈕掛徽章；讀過就消失', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await openShop(page, { shelf: [2, 0, 0, 0, 0], hearts: 1 });
  await step(page, 5);
  const s = await S(page);
  expect(s.regulars.bear.hearts).toBe(2);
  const badge = page.locator('.regbtn .badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('1');
  await page.locator('[data-a="openRegulars"]').click();
  await page.locator('[data-a="readStory"][data-arg="bear:1"]').click();
  await expect(page.locator('.regcard .story h3')).toContainText('森林郵局的午休');
  await expect(page.locator('.regcard .story .body')).toContainText('分信員');
  await expect(badge).toBeHidden();
  await page.locator('[data-a="storyBack"]').click();
  await expect(page.locator('[data-a="readStory"][data-arg="bear:1"]')).not.toHaveClass(/new/);
});
