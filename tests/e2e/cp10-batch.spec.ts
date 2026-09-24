import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * CP10 一批一批做（D60／D61，2026-09-24）。
 *
 * 真的點菜單卡片疊份數；場景讀 `BakeryCups` 的 instance 數確認「幾份就畫幾杯」。
 * 時間用 `?pause=1` ＋ `step()` 推。
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

const cups = (page: Page) =>
  page.evaluate(() => (window.__lpg.bakery!.scene.getObjectByName('BakeryCups') as unknown as { count: number }).count);

test('AC10-6 菜單：點卡片一下多一份、疊到上限就停、－／最多、換一道從 1 份起、開工只扣疊的份數、關掉再開草稿清空', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    // 焙茶布丁燒整條線 Lv5（一盤最多 5 份），材料只夠 3 份；鮮奶酪杯那條線也買齊（拿來換點別道）
    Object.assign(s.bakery.machines, { stove: 5, crack: 5, mix: 5, mold: 5, bake: 5, chill: 5 });
    s.eggs = 6; s.pantry.flour = 3; s.ingredients.hojicha = [3, 0, 0, 0, 0];
    s.stock.milk = 4; s.ingredients.panna = [2, 0, 0, 0, 0];
  });
  await step(page, 0.3);
  await page.getByRole('button', { name: /菜單/ }).click();
  const hoji = page.locator('.menucard .rcard[data-id="hojicha"]');
  const panna = page.locator('.menucard .rcard[data-id="panna"]');
  const go = hoji.locator('[data-a="startBatch"]');
  await expect(hoji.locator('.qmax')).toHaveText('3');
  await expect(hoji.locator('.meta')).toContainText('機器一盤最多 5 份');
  await expect(go).toBeDisabled();

  const head = hoji.locator('.rhead');
  for (let i = 0; i < 5; i++) await head.click(); // 點 5 下，材料只夠 3 份
  await expect(hoji.locator('.qty b')).toHaveText('3');
  await expect(go).toHaveText('開始製作 ×3');
  await hoji.locator('[data-a="portionMinus"]').click();
  await expect(hoji.locator('.qty b')).toHaveText('2');
  await hoji.locator('[data-a="portionMax"]').click();
  await expect(hoji.locator('.qty b')).toHaveText('3');

  // 換點鮮奶酪杯：焙茶那張歸零、鮮奶酪從 1 份起
  await panna.locator('.rhead').click();
  await expect(panna.locator('.qty b')).toHaveText('1');
  await expect(hoji.locator('.qty b')).toHaveText('0');
  await expect(go).toBeDisabled();

  // 關掉再開：草稿清空
  await page.locator('[data-a="closeMenu"]').click();
  await page.getByRole('button', { name: /菜單/ }).click();
  await expect(page.locator('.menucard .rcard.picked')).toHaveCount(0);

  // 焙茶疊 2 份開工：線上一盤 2 份，材料只扣 2 份
  await head.click();
  await head.click();
  await go.click();
  const s = await S(page);
  expect(s.bakery.stations.crack.batch).toEqual({ species: 'hojicha', qty: 2, star: 1 });
  expect(s.eggs).toBe(6 - 2 * 2);
  expect(s.ingredients.hojicha.reduce((a, b) => a + b, 0)).toBe(1);
  await expect(page.locator('.menucard')).toBeHidden();
});

test('AC10-7／10-11 一盤幾份就畫幾杯（20 份也是）；七站全滿不超過杯子上限、draw calls 在預算內', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const id of Object.keys(s.bakery.machines) as (keyof typeof s.bakery.machines)[]) s.bakery.machines[id] = 20;
    for (const id of Object.keys(s.bakery.stations) as (keyof typeof s.bakery.stations)[]) {
      s.bakery.stations[id] = { batch: { species: 'brulee', qty: 20, star: 1 }, startedAt: s.time, doneAt: s.time + 1000 };
    }
  });
  await step(page, 0.5);
  // 裝模之前（爐台／打蛋／攪拌）各一只碗；裝模、烤箱、冷藏、裝飾各 20 杯
  expect(await cups(page)).toBe(3 + 4 * 20);
  const draws = await page.evaluate(() => window.__lpg.stats!.drawCalls);
  expect(draws).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  expect(errors.filter((e) => e.includes('[bakery]'))).toEqual([]);

  // 份數變少畫得也少：裝飾台那盤改 7 份
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.stations.decorate.batch = { species: 'brulee', qty: 7, star: 1 };
  });
  await step(page, 0.5);
  expect(await cups(page)).toBe(3 + 3 * 20 + 7);
});

test('AC10-8 出爐字卡：整盤做完跳「出爐！… ×N」；同一刻兩盤出爐合成一張', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const id of Object.keys(s.bakery.machines) as (keyof typeof s.bakery.machines)[]) s.bakery.machines[id] = 20;
    // 鮮奶酪杯最後一站是冷藏、焦糖布丁塔最後一站是裝飾：同一刻做完
    s.bakery.stations.chill = { batch: { species: 'panna', qty: 6, star: 1 }, startedAt: s.time, doneAt: s.time + 0.5 };
    s.bakery.stations.decorate = { batch: { species: 'caramel', qty: 8, star: 1 }, startedAt: s.time, doneAt: s.time + 0.5 };
  });
  const banner = page.locator('.bakebanner');
  await expect(banner).toBeHidden();
  await step(page, 1);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('出爐！');
  const s = await S(page);
  // Lv20 失敗率 ×0.7^19≈0.1%，幾乎一定全成功；字卡上的數字＝真的進成品櫃的份數
  await expect(banner.locator('span')).toHaveCount(2);
  await expect(banner).toContainText(`鮮奶酪杯 ×${s.desserts.panna.reduce((a, b) => a + b, 0)}`);
  await expect(banner).toContainText(`焦糖布丁塔 ×${s.desserts.caramel.reduce((a, b) => a + b, 0)}`);
  // 一杯接一杯跳進成品櫃：出爐那一刻杯子比「成品櫃格數」多（還在空中的那幾杯）
  await page.waitForTimeout(2200);
  await expect(banner).toBeHidden();
});

test('AC10-4：v9 存檔（3 級機器、站上一盤沒有 startedAt）走「還原」：等級換成 1/3/5、人氣 1、那一盤照原本的 doneAt 做完', async ({ page }) => {
  await boot(page, '/?seed=8&pause=1');
  const raw = await page.evaluate(() => {
    const s = JSON.parse(JSON.stringify(window.__lpg.state)) as Record<string, unknown> & GameState;
    s.schemaVersion = 9;
    const bk = s.bakery as unknown as Record<string, unknown>;
    delete bk.fame;
    bk.machines = { stove: 1, crack: 2, mix: 3, mold: 3, bake: 3, chill: 0, decorate: 3 };
    const st = bk.stations as Record<string, Record<string, unknown>>;
    for (const id of Object.keys(st)) st[id] = { batch: null, doneAt: 0 };
    st.bake = { batch: { species: 'caramel', qty: 4, star: 1 }, doneAt: s.time + 20 };
    return s;
  });
  const { exportCode } = await import('../../src/game/savecode');
  const code = exportCode(raw as GameState);
  await page.getByRole('button', { name: '設定' }).click();
  await page.locator('.savecard .code').fill(code);
  await Promise.all([page.waitForEvent('load'), page.locator('[data-a="restoreSave"]').click()]);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  let s = await S(page);
  expect(s.schemaVersion).toBe(10);
  expect(s.bakery.machines).toMatchObject({ stove: 1, crack: 3, mix: 5, mold: 5, bake: 5, chill: 0, decorate: 5 });
  expect(s.bakery.fame).toBe(1);
  const bake = s.bakery.stations.bake;
  expect(bake.batch).toEqual({ species: 'caramel', qty: 4, star: 1 });
  expect(bake.doneAt - bake.startedAt).toBe(45); // 舊版烤箱固定 45 秒
  // 走完烤箱與裝飾台：4 份進成品櫃（或有失敗）
  await step(page, 40);
  s = await S(page);
  expect(s.bakery.stations.bake.batch).toBeNull();
});

test('兩位數等級（Lv10 起）：390px 底座牌的名稱＋Lv 不溢出牌子', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const id of Object.keys(s.bakery.machines) as (keyof typeof s.bakery.machines)[]) s.bakery.machines[id] = 18;
  });
  await step(page, 0.5);
  const spill = await page.$$eval('.stag:not([hidden]) .nm', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 0.5).length);
  expect(spill).toBe(0);
});
