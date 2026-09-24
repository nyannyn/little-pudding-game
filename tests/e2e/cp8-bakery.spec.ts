import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import { STATIONS, machinePrice } from '../../src/game/recipes';
import { exportCode } from '../../src/game/savecode';
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
  await page.addInitScript(() => {
    localStorage.setItem('lpg.hints.off', '1');
    // 非 ?fresh 的頁面第一次開會跳「加到主畫面」卡，蓋住設定鈕
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

test('AC9-8／9-9／9-3：商店買機器 → 菜單開工 → 線上自己走完 → 上架 → 客人買走', async ({ page }) => {
  test.setTimeout(120_000);
  // 鮮奶酪杯每份 3% 失敗（D56）：`?pause=1` 下模擬是確定性的，seed 8 在這串操作下剛好擲到失敗、每次都一樣。
  // 換一顆會成功的種子，讓後半段「上架→客人買走」測得到；失敗那條路在單元測試 AC9-5 驗
  await boot(page, '/?fresh=1&seed=11&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 1000;
    s.stock.milk = 2;
    s.ingredients.panna = [1, 0, 0, 0, 0];
  });
  await step(page, 0.3);

  // 沒機器時菜單卡不能按、下面寫缺哪幾台
  await page.getByRole('button', { name: /菜單/ }).click();
  const panna = page.locator('.menucard .rcard[data-id="panna"]');
  await expect(panna).toHaveAttribute('data-ok', 'false');
  await expect(panna.locator('[data-a="startBatch"]')).toHaveCount(0);
  await expect(panna.locator('.miss')).toContainText('缺機器：爐台、裝模機、冷藏櫃');
  await page.locator('[data-a="closeMenu"]').click();

  // 商店的「工坊」頁把鮮奶酪杯那條線買齊（真的點價格鈕）
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="bakery"]').click();
  for (const id of ['stove', 'mold', 'chill']) await page.locator(`[data-a="buyMachine"][data-arg="${id}"]`).click();
  let s = await S(page);
  expect(s.bakery.machines).toMatchObject({ stove: 1, mold: 1, chill: 1, bake: 0 });
  expect(s.coins).toBe(1000 - STATIONS.stove.price - STATIONS.mold.price - STATIONS.chill.price);
  await page.locator('[data-a="closeShop"]').click();

  // 菜單：鮮奶酪杯可按、焦糖布丁塔還缺
  await page.getByRole('button', { name: /菜單/ }).click();
  // D60：點卡片才疊份數，開工鈕在疊之前是灰的
  await expect(panna).toHaveAttribute('data-ok', 'true');
  await expect(panna.locator('[data-a="startBatch"]')).toBeDisabled();
  await expect(page.locator('.menucard .rcard[data-id="caramel"]')).toHaveAttribute('data-ok', 'false');
  await panna.locator('.rhead').click();
  await expect(panna.locator('[data-a="startBatch"]')).toHaveText('開始製作 ×1');
  await panna.locator('[data-a="startBatch"]').click();
  s = await S(page);
  expect(s.bakery.stations.stove.batch).toEqual({ species: 'panna', qty: 1, star: 1 });
  expect(s.stock.milk).toBe(0);
  expect(s.ingredients.panna.reduce((a, b) => a + b, 0)).toBe(0);

  // 不用再點任何東西：爐台 → 裝模 → 冷藏自己走完（10＋5＋40 秒）
  await step(page, 60);
  s = await S(page);
  for (const id of ['stove', 'mold', 'chill'] as const) expect(s.bakery.stations[id].batch).toBeNull();
  expect(s.desserts.panna.reduce((a, b) => a + b, 0) + s.bakery.shelf.panna.reduce((a, b) => a + b, 0)).toBe(1);

  // 上架 → 營業中客人買走
  await page.getByRole('button', { name: /上架/ }).click();
  s = await S(page);
  expect(s.bakery.shelf.panna.reduce((a, b) => a + b, 0)).toBe(1);
  const coins = s.coins;
  await step(page, BALANCE.bakery.customerIntervalMax * 3);
  s = await S(page);
  expect(s.stats.served).toBeGreaterThan(0);
  expect(s.coins).toBeGreaterThan(coins);
  await expect(page.locator('.daybar .today')).not.toHaveText('今日 +0');
});

test('菜單開著、收集手一直在撿：可以按的「開始製作」不會在手指底下被換掉（D55 同型坑）', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    Object.assign(s.bakery.machines, { stove: 1, crack: 1, mix: 1, mold: 1, bake: 1, decorate: 1 });
    s.stock.milk = 3; s.pantry.flour = 3; s.ingredients.caramel = [3, 0, 0, 0, 0]; s.eggs = 2;
  });
  await step(page, 0.3);
  await page.getByRole('button', { name: /菜單/ }).click();
  // 焦糖布丁塔可以做：點卡片疊一份，開工鈕變亮——抓住這顆按鈕
  await page.locator('.menucard .rcard[data-id="caramel"] .rhead').click();
  const btn = await page.locator('.menucard .rcard[data-id="caramel"] [data-a="startBatch"]:not([disabled])').elementHandle();
  const eggChip = page.locator('.menucard .rcard[data-id="caramel"] .mat[data-k="egg"] b');
  // 蛋一顆一顆撿進來（2→5）：沒有任何一道食譜因此從缺料變不缺料＝結構沒變，只有晶片上的數字該動。
  // 蛋數不能在 0／1 之間變：草莓布丁派一份只要 1 顆蛋，跨過去是真的結構變化（重建是對的）
  for (const n of [3, 4, 5]) {
    await page.evaluate((x) => { (window.__lpg.state as GameState).eggs = x; }, n);
    await step(page, 0.3);
  }
  await expect(eggChip).toHaveText('5');
  expect(await btn!.evaluate((b) => b.isConnected)).toBe(true);
});

test('錢夠買整條線、卻沒有任何機器：「甜點店」鈕掛「!」；買齊一條線就拿掉', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&pause=1');
  const go = page.locator('[data-a="goBakery"]');
  await expect(go).not.toHaveClass(/alert/);
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 999; });
  await step(page, 0.3);
  await expect(go).toHaveClass(/alert/);
  await expect(go.locator('.n')).toHaveText('!');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    Object.assign(s.bakery.machines, { stove: 1, mold: 1, chill: 1 });
  });
  await step(page, 0.3);
  await expect(go).not.toHaveClass(/alert/);
});

test('商店工坊頁：買了變升級、滿級顯示已滿級；320px 分頁列不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 99999; });
  await step(page, 0.3);
  await page.getByRole('button', { name: '商店' }).click();
  // 六個分頁都在畫面裡、沒有橫向捲動
  const tabs = await page.$$eval('[data-a="shopTab"]', (els) => els.map((e) => e.getBoundingClientRect().right));
  expect(tabs).toHaveLength(6);
  for (const r of tabs) expect(r).toBeLessThanOrEqual(320);
  await page.locator('[data-a="shopTab"][data-arg="bakery"]').click();
  const btn = page.locator('[data-a="buyMachine"][data-arg="bake"]');
  await expect(btn).toHaveText(String(machinePrice('bake', 0)));
  await btn.click();
  await expect(btn).toHaveText(String(machinePrice('bake', 1)));
  // D61：20 級。直接把它推到 Lv19，再按一次到頂
  await page.evaluate(() => { (window.__lpg.state as GameState).bakery.machines.bake = 19; });
  await step(page, 0.3);
  await expect(btn).toHaveText(String(machinePrice('bake', 19)));
  await btn.click();
  await expect(page.locator('.card[data-id="machine:bake"] .owned')).toHaveText('已滿級');
  expect((await S(page)).bakery.machines.bake).toBe(20);
});

test('點 3D 的機器：沒買開商店工坊頁、空著開菜單、有一盤講它在做什麼', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await step(page, 0.3);
  const tapAt = async (x: number, y: number, z: number) => {
    const at = await page.evaluate(([px, py, pz]) => {
      const cam = window.__lpg.bakery!.camera;
      const v = window.__lpg.three!.camera.position.clone().set(px!, py!, pz!).project(cam);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    }, [x, y, z]);
    await page.mouse.click(at.x, at.y);
  };
  // 隧道烤箱（右側那段帶子中段）
  const oven = [0.98, 0.8, -1.2] as const;
  await tapAt(...oven);
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('[data-a="shopTab"][data-arg="bakery"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-a="closeShop"]').click();

  await page.evaluate(() => { (window.__lpg.state as GameState).bakery.machines.bake = 1; });
  await step(page, 0.3);
  await tapAt(...oven);
  await expect(page.locator('.menucard')).toBeVisible();
  await page.locator('[data-a="closeMenu"]').click();

  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.stations.bake = { batch: { species: 'hojicha', qty: 1, star: 1 }, startedAt: s.time, doneAt: s.time + 30 };
  });
  await step(page, 0.3);
  await tapAt(...oven);
  await expect(page.locator('.toast').last()).toContainText('烤箱正在烘烤焙茶布丁燒');
});

test('AC9-7：v8 存檔（五站線上有一盤）還原後機器全無、材料退回', async ({ page }) => {
  await boot(page, '/?seed=8&pause=1');
  const raw = await page.evaluate(() => {
    const s = JSON.parse(JSON.stringify(window.__lpg.state)) as Record<string, unknown> & GameState;
    s.schemaVersion = 8;
    delete (s as Record<string, unknown>).pantry;
    const bk = s.bakery as unknown as Record<string, unknown>;
    delete bk.machines;
    bk.auto = { crack: false, mix: false, mold: false, bake: false, decorate: false };
    bk.stations = {
      crack: { batch: null, doneAt: 0 },
      mix: { batch: { species: 'caramel', qty: 2, star: 1 }, doneAt: 1 },
      mold: { batch: null, doneAt: 0 },
      bake: { batch: null, doneAt: 0 },
      decorate: { batch: null, doneAt: 0 },
    };
    s.eggs = 0;
    s.ingredients.caramel = [0, 0, 0, 0, 0];
    return s;
  });
  const code = exportCode(raw as GameState);
  // 走產品自己的「還原」流程（不是手刻 localStorage）
  await page.getByRole('button', { name: '設定' }).click();
  await page.locator('.savecard .code').fill(code);
  await Promise.all([page.waitForEvent('load'), page.locator('[data-a="restoreSave"]').click()]);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  const s = await S(page);
  expect(s.schemaVersion).toBeGreaterThanOrEqual(9);
  for (const v of Object.values(s.bakery.machines)) expect(v).toBe(0);
  expect(s.eggs).toBe(4);
  expect(s.ingredients.caramel.reduce((a, b) => a + b, 0)).toBe(2);
  expect(s.pantry.flour).toBe(BALANCE.startPantry.flour);
});

test('預訂單在工坊交：成品櫃不夠時從展示架補，交貨鈕按得下去', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    // 先把時間撥到打烊後（22:00），客人才不會先把架上那份買走；訂單要在撥完之後才開，不然一撥就過期
    s.time = s.bakery.epoch + (15 / 24) * 1200;
    s.desserts.caramel = [1, 0, 0, 0, 0];
    s.bakery.shelf.caramel = [1, 0, 0, 0, 0];
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
  expect(s.desserts.caramel.reduce((a, b) => a + b, 0) + s.bakery.shelf.caramel.reduce((a, b) => a + b, 0)).toBe(0);
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

test('D55：抽屜開著、進度一直在漲，「領取」鈕不會在手指底下被換掉；進度條照樣跟著動', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&pause=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    Object.assign(s.stats, { picked: 1, baths: 1 });
    s.claimedAchievements.push('firstBath'); // 泡澡系列停在「溫泉常客」（1／100），同一頁有可領的撿拾
  });
  await step(page, 0.3);
  await page.getByRole('button', { name: '成就' }).click();
  const btn = await page.locator('.arow[data-id="firstPick"] [data-a="claim"]').elementHandle();
  const cnt = page.locator('.arow[data-series="bath"] .cnt');
  await expect(cnt).toHaveText('1／100');
  // 同一頁另一列的進度在漲、沒跨門檻（實際遊戲裡泡澡每一兩秒就一次）
  for (const n of [2, 3, 37]) {
    await page.evaluate((x) => { (window.__lpg.state as GameState).stats.baths = x; }, n);
    await step(page, 0.3);
  }
  await expect(cnt).toHaveText('37／100');
  expect(await btn!.evaluate((b) => b.isConnected)).toBe(true);
});

test('AC9-10：七台全買、每一站都有一盤、客人在店裡，draw calls 仍在預算內', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1&debug=1');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    for (const [i, id] of ['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'].entries()) {
      s.bakery.machines[id as 'stove'] = 3;
      s.bakery.stations[id as 'stove'] = { batch: { species: 'brulee', qty: 4, star: 1 }, startedAt: s.time, doneAt: s.time + 5 + i };
    }
    s.bakery.shelf.caramel = [12, 0, 0, 0, 0];
    s.desserts.matcha = [9, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) (window.__lpg.bakery as unknown as { customerCame(x: string | null): void }).customerCame('caramel');
  });
  await step(page, 1.5);
  const st = await page.evaluate(() => ({ draw: window.__lpg.stats.drawCalls, customers: window.__lpg.bakery!.customerCount }));
  expect(st.customers).toBeGreaterThan(0);
  expect(st.draw).toBeGreaterThan(10);
  expect(st.draw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});
