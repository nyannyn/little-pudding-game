import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * CP8 甜點工坊（D50–D54，2026-09-23）。
 *
 * 全部**真的點 HUD 按鈕**：出貨吃掉訂單那個 bug（2026-09-22）就是規則層全綠、按鈕那條路壞掉。
 * 時間用 `?pause=1` ＋ `step()` 推，不靠 wall clock（無頭 SwiftShader 只有十幾 fps）。
 */
async function boot(page: Page, query: string) {
  // 新手提示泡泡會蓋住工坊中段（點 3D 機器會點到泡泡），這裡測的不是它；載入前就關，HUD 建構時才讀得到
  await page.addInitScript(() => localStorage.setItem('lpg.hints.off', '1'));
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
}

const S = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state)) as GameState);

async function step(page: Page, sec: number) {
  await page.evaluate((t) => {
    for (let left = t; left > 0; left -= 0.25) window.__lpg.step!(Math.min(0.25, left));
  }, sec);
  // HUD 每 160ms（真實時間）才重畫一次
  await page.waitForTimeout(250);
}

test('農場的動作列沒有加工／出貨，按「甜點店」切到工坊（D50／D51）', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8');
  await expect(page.getByRole('button', { name: '加工' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '出貨' })).toHaveCount(0);
  await page.getByRole('button', { name: /甜點店/ }).click();
  await expect(page.locator('.hud')).toHaveAttribute('data-view', 'bakery');
  await expect(page.locator('.daybar')).toBeVisible();
  await expect(page.locator('.daybar .day')).toHaveText('第 1 天');
  await page.getByRole('button', { name: /回農場/ }).click();
  await expect(page.locator('.hud')).toHaveAttribute('data-view', 'farm');
});

test('AC8-1：點按鈕走完五站，一盤甜點進成品櫃、上架、客人買走', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  const q = BALANCE.bakery.batchSize;
  await page.evaluate((n) => {
    const s = window.__lpg.state as GameState;
    s.eggs = n * 2;
    s.ingredients.caramel = n;
  }, q);
  await step(page, 0.3);

  // 空的打蛋機 → 開工選單 → 焦糖那一列「開工」
  await page.locator('[data-a="station"][data-arg="crack"]').click();
  await expect(page.locator('.batchcard')).toBeVisible();
  await page.locator('.batchcard .brow[data-id="caramel"] [data-a="startBatch"]').click();
  let s = await S(page);
  expect(s.bakery.stations.crack.batch).toEqual({ species: 'caramel', qty: q });
  expect(s.eggs).toBe(0);

  // 還沒做完點下去：不動，而且要講出原因（不可以按了沒反應）
  await page.locator('[data-a="station"][data-arg="crack"]').click();
  await expect(page.locator('.toast').last()).toContainText('還在打蛋');

  for (const id of ['crack', 'mix', 'mold', 'bake', 'decorate']) {
    const secs = (BALANCE.bakery.stepSec as Record<string, number>)[id]! + 0.3;
    await step(page, secs);
    const btn = page.locator(`[data-a="station"][data-arg="${id}"]`);
    await expect(btn).toHaveAttribute('data-status', 'ready');
    await btn.click();
  }
  s = await S(page);
  expect(s.desserts.caramel).toBe(q);
  expect(s.stats.baked).toBe(q);
  expect(s.ingredients.caramel).toBe(0);

  // 上架 → 展示架有貨 → 營業中客人買走
  await page.getByRole('button', { name: /上架/ }).click();
  s = await S(page);
  expect(s.bakery.shelf.caramel).toBe(q);
  const coins = s.coins;
  await step(page, BALANCE.bakery.customerIntervalMax * 3);
  s = await S(page);
  expect(s.stats.served).toBeGreaterThan(0);
  expect(s.coins).toBeGreaterThan(coins);
  await expect(page.locator('.daybar .today')).not.toHaveText('今日 +0');
});

test('點 3D 的機器等於點那一站（烤箱做完點機身就推到裝飾台）', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.stations.bake = { batch: { species: 'caramel', qty: 2 }, doneAt: s.time };
  });
  await step(page, 0.3);
  // 烤箱中心投到螢幕上點下去
  const at = await page.evaluate(() => {
    const cam = window.__lpg.bakery!.camera;
    const v = window.__lpg.three!.camera.position.clone().set(-0.62, 0.8, -0.4).project(cam);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  });
  await page.mouse.click(at.x, at.y);
  const s = await S(page);
  expect(s.bakery.stations.bake.batch).toBeNull();
  expect(s.bakery.stations.decorate.batch?.species).toBe('caramel');
});

test('預訂單在工坊交：成品櫃不夠時從展示架補，交貨鈕按得下去', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    // 先把時間撥到打烊後（22:00），客人才不會先把架上那份買走；訂單要在撥完之後才開，不然一撥就過期
    s.time = s.bakery.epoch + (15 / 24) * 1200;
    s.desserts.caramel = 1;
    s.bakery.shelf.caramel = 1;
    s.orders = [{ id: 'o-e2e', species: 'caramel', qty: 2, price: 150, createdAt: s.time, expiresAt: s.time + 600 }];
  });
  await step(page, 0.3);
  const coins = (await S(page)).coins;
  // 工坊右欄的預訂單鈕：徽章是綠的（有交得出來的單）→ 開卡片按交貨
  await expect(page.locator('.ordbtn .badge')).toHaveClass(/ok/);
  await page.getByRole('button', { name: '預訂單' }).click();
  // 撥時間的那一 tick 也可能剛好生出一張新訂單：只按這一張
  await page.locator('.ordercard .order[data-id="o-e2e"] [data-a="fulfill"]').click();
  const s = await S(page);
  expect(s.orders.find((o) => o.id === 'o-e2e')).toBeUndefined();
  expect(s.coins).toBe(coins + 150);
  expect(s.desserts.caramel + s.bakery.shelf.caramel).toBe(0);
});

test('AC8-6：商店賣一隻布丁，畫面上真的少一隻（不是只有 state 少）', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&pop=3');
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  const count = () =>
    page.evaluate(() => (window.__lpg.three!.scene.getObjectByName('Puddings_Body') as unknown as { count: number }).count);
  await expect.poll(count).toBe(3);
  const coins = (await S(page)).coins;
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="sell"]').click();
  await page.locator('[data-a="sellPud"][data-arg="caramel"]').click();
  const s = await S(page);
  expect(s.puddings).toHaveLength(2);
  expect(s.coins).toBe(coins + Math.round(6 * BALANCE.puddingPriceMult));
  await expect.poll(count).toBe(2);
  // 骨架（PuddingView.root）也要拿掉：instance 數是照 state 每幀重排的，就算 main.ts 沒釋放也會少一隻；
  // 掛在 scene 上的骨架才是「賣掉的那隻還留在場景裡」的證據（其他讀 scene graph 的量法會數到它）
  const skeletons = await page.evaluate(() =>
    window.__lpg.three!.scene.children.filter((o) => o.getObjectByName('Pudding_Body')).length);
  expect(skeletons).toBe(2);
});

test('AC8-8：成就達成要按「領取」才入帳，領過就變「已領取」', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&pause=1');
  await page.evaluate(() => { (window.__lpg.state as GameState).stats.picked = 1; });
  await step(page, 0.3);
  await expect(page.locator('.achbtn .badge')).toHaveText('1');
  const coins = (await S(page)).coins;
  await page.getByRole('button', { name: '成就' }).click();
  await page.locator('.arow[data-id="firstPick"] [data-a="claim"]').click();
  expect((await S(page)).coins).toBe(coins + 30);
  expect((await S(page)).claimedAchievements).toContain('firstPick');
  // D55：同一系列合成一列，領完第一階就換成下一階（撿 100 份）、亮一顆星
  const row = page.locator('.arow[data-series="pick"]');
  await expect(row).toHaveAttribute('data-id', 'pick100');
  await expect(row).toHaveAttribute('data-status', 'locked');
  await expect(row.locator('.stars i.on')).toHaveCount(1);
  await expect(page.locator('.achbtn .badge')).toBeHidden();
});

test('D55：成就分四類分頁；文字欄不被擠成直排；「全部領取」跨分類一次領完', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&pause=1');
  await page.evaluate(() => { Object.assign((window.__lpg.state as GameState).stats, { picked: 120, baths: 1, baked: 1 }); });
  await step(page, 0.3);
  await page.getByRole('button', { name: '成就' }).click();
  await expect(page.locator('[data-a="achTab"]')).toHaveCount(4);
  // 打開就跳到第一個有東西可領的分頁
  await expect(page.locator('[data-a="achTab"][data-arg="farm"]')).toHaveAttribute('aria-selected', 'true');
  // 2026-09-23 使用者截圖：商店卡的 `.card .foot { width:100% }` 漏進成就列，文字欄只剩一個字寬（~15px）
  const widths = await page.$$eval('.achsheet .arow', (rows) =>
    rows.map((r) => (r.querySelector('.txt') as HTMLElement).getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) expect(w).toBeGreaterThan(100);
  await page.locator('[data-a="achTab"][data-arg="bakery"]').click();
  await expect(page.locator('.achsheet .arow[data-series="bake"]')).toHaveAttribute('data-status', 'claimable');

  const coins = (await S(page)).coins;
  await page.locator('[data-a="claimAllAch"]').click();
  const s = await S(page);
  expect([...s.claimedAchievements].sort()).toEqual(['firstBake', 'firstBath', 'firstPick', 'pick100']);
  expect(s.coins).toBe(coins + 30 + 100 + 30 + 150);
  await expect(page.locator('.toast', { hasText: '領了 4 個成就' })).toBeVisible();
  await expect(page.locator('.achbtn .badge')).toBeHidden();
  await expect(page.locator('[data-a="claimAllAch"]')).toBeHidden();
});

test('AC8-9：工坊畫面五站全開、客人在店裡，draw calls 仍在預算內', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1&debug=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const [i, id] of ['crack', 'mix', 'mold', 'bake', 'decorate'].entries()) {
      s.bakery.stations[id as 'crack'] = { batch: { species: 'caramel', qty: 2 }, doneAt: s.time + 5 + i };
    }
    s.bakery.shelf.caramel = 12;
    s.desserts.matcha = 9;
    for (let i = 0; i < 5; i++) (window.__lpg.bakery as unknown as { customerCame(x: string | null): void }).customerCame('caramel');
  });
  await step(page, 1.5);
  const st = await page.evaluate(() => ({ draw: window.__lpg.stats.drawCalls, customers: window.__lpg.bakery!.customerCount }));
  expect(st.customers).toBeGreaterThan(0);
  expect(st.draw).toBeGreaterThan(10);
  expect(st.draw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});
