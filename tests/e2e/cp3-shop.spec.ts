import { expect, test, type Page } from '@playwright/test';
import { BALANCE } from '../../src/game/balance';
import type { GameState } from '../../src/game/state';

/**
 * D25 商店改版：分頁＋商品卡＋店長等級。
 * 單元測試守規則（誰幾級能買），這裡守「畫面上真的是那樣」：
 * 每張卡都有圖、鎖住的沒有購買鈕、升級會 toast、大桶裝買了庫存真的多 30。
 */

async function ready(page: Page, query: string) {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
}

async function state(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state))) as Promise<GameState>;
}

const TABS = ['stock', 'equipment', 'basin', 'zone', 'sell'] as const;

test('每一頁的商品卡都有載入成功的圖；鎖住的卡只有 Lv 牌沒有購買鈕', async ({ page }) => {
  await ready(page, '/?fresh=1&seed=31');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 500;
    s.ingredients.caramel = 2;
  });
  await page.getByRole('button', { name: '商店' }).click();
  await expect(page.locator('.sheet')).toBeVisible();

  let cards = 0;
  for (const tab of TABS) {
    await page.locator(`[data-a="shopTab"][data-arg="${tab}"]`).click();
    await expect(page.locator(`[data-a="shopTab"][data-arg="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
    // 圖片真的載進來（naturalWidth > 0），不是破圖
    const imgs = page.locator('.sheet .card img.main');
    const n = await imgs.count();
    expect(n, `${tab} 頁要有商品卡`).toBeGreaterThan(0);
    cards += n;
    for (let i = 0; i < n; i++) {
      await expect.poll(() => imgs.nth(i).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
  }
  expect(cards).toBeGreaterThanOrEqual(14);

  // Lv.1 開局：補貨頁的大桶裝鎖著（Lv.4）——沒有購買鈕、有 Lv 牌；小包裝有購買鈕
  await page.locator('[data-a="shopTab"][data-arg="stock"]').click();
  const bulk = page.locator(`.card[data-id="stock:caramel:${BALANCE.stockBulkQty}"]`);
  await expect(bulk).toHaveAttribute('data-status', 'locked');
  await expect(bulk.locator('button')).toHaveCount(0);
  await expect(bulk.locator('.lockedtag')).toContainText(`Lv.${BALANCE.stockBulkLevel}`);
  await expect(page.locator(`.card[data-id="stock:caramel:${BALANCE.stockBuyQty}"] button.buy`)).toBeEnabled();

  // 沒買澡盆前，抹茶湯是「先買澡盆」不是「要升級」
  const matcha = page.locator(`.card[data-id="stock:matcha:${BALANCE.stockBuyQty}"]`);
  await expect(matcha).toHaveAttribute('data-status', 'needs');
  await expect(matcha.locator('button')).toHaveCount(0);

  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-shop-locked.png' });
});

test('升級：xp 過門檻就跳 toast、商店鈕的 Lv 牌更新、大桶裝上架且買了庫存多 30', async ({ page }) => {
  await ready(page, '/?fresh=1&seed=32');
  const before = await state(page);
  expect(before.xp).toBe(0);
  await expect(page.locator('.shopbtn .lvl')).toHaveText('Lv.1');

  // 直接發 xp（走遊戲自己的 grantXp，不是改欄位）：跨到 stockBulkLevel
  await page.evaluate(
    (need) => {
      const s = window.__lpg.state as GameState;
      s.coins = 1000;
      window.__lpg.grantXp!(need);
    },
    BALANCE.levelXp[BALANCE.stockBulkLevel - 1] as number,
  );
  await expect(page.locator('.toast').filter({ hasText: `Lv.${BALANCE.stockBulkLevel}` })).toBeVisible();
  await expect(page.locator('.shopbtn .lvl')).toHaveText(`Lv.${BALANCE.stockBulkLevel}`);

  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="stock"]').click();
  const bulk = page.locator(`.card[data-id="stock:caramel:${BALANCE.stockBulkQty}"]`);
  await expect(bulk).toHaveAttribute('data-status', 'available');
  await expect(bulk.locator('.new')).toBeVisible(); // 這一級剛上架

  const stockBefore = (await state(page)).stock.caramel;
  const coinsBefore = (await state(page)).coins;
  await bulk.locator('button.buy').click();
  const after = await state(page);
  expect(after.stock.caramel).toBe(stockBefore + BALANCE.stockBulkQty);
  // 有打折：比 30 份原價便宜
  expect(coinsBefore - after.coins).toBeLessThan(BALANCE.stockBulkQty * 2);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-shop-lv4.png' });
});

test('分頁切換不會讓分頁列上下跳（抽屜固定高度）', async ({ page }) => {
  await ready(page, '/?fresh=1&seed=33');
  await page.getByRole('button', { name: '商店' }).click();
  const tabs = page.locator('.sheet .tabs');
  const y0 = (await tabs.boundingBox())!.y;
  for (const tab of TABS) {
    await page.locator(`[data-a="shopTab"][data-arg="${tab}"]`).click();
    expect(Math.abs((await tabs.boundingBox())!.y - y0), `${tab} 頁分頁列位置`).toBeLessThan(2);
  }
});

test('新手引導說「去買原料收集手」時，按商店直接開在設備頁，不必自己找分頁', async ({ page }) => {
  await ready(page, '/?fresh=1&seed=34');
  // 走到 buy 那一句引導：有賣過東西、錢夠買收集手、還沒買設備
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 500;
    s.stats.sold = 1;
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 3;
  });
  await expect(page.locator('.hint')).toHaveAttribute('data-hint', 'buy', { timeout: 10_000 });
  await page.getByRole('button', { name: '商店' }).click();
  await expect(page.locator('[data-a="shopTab"][data-arg="equipment"]')).toHaveAttribute('aria-selected', 'true');
  // 不切分頁就買得到
  await page.locator('[data-a="buyEquip"][data-arg="collector"]').click();
  const bought = await state(page);
  expect(bought.equipment[bought.activeZone]!.collector).toBe(true);
});

test('買了一件之後清單不會跳回最上面（捲動位置保留）', async ({ page }) => {
  // D50 起設備頁只剩三台，iPhone 14 的高度下整頁放得下、捲不動；用矮一點的畫面才量得到捲動
  await page.setViewportSize({ width: 390, height: 520 });
  await ready(page, '/?fresh=1&seed=35');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999;
    s.xp = 99999;
  });
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  // 分頁切換只是設旗標，DOM 要等下一次 render（160ms）才換。不等就捲的是**補貨頁**，
  // 換頁後內容高度不同，scrollTop 會被夾到別的值（實測差 57px，跟「跳回頂端」無關）
  await expect(page.locator('.card[data-id="equip:restock"]')).toBeVisible();
  const body = page.locator('.sheet .body');
  await body.evaluate((el) => { el.scrollTop = 10_000; });
  const before = await body.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(50);
  await page.locator('[data-a="buyEquip"][data-arg="restock"]').click();
  await expect(page.locator('.card[data-id="equip:restock"]')).toHaveAttribute('data-status', 'owned');
  const after = await body.evaluate((el) => el.scrollTop);
  // 購買鈕變成「已安裝」牌會矮幾 px，捲到底時 scrollTop 會跟著縮一點；跳回頂端是差幾百 px
  expect(Math.abs(after - before)).toBeLessThan(12);
});

test('320px 寬：分頁不折行、卡片不橫向溢出、購買鈕在卡片裡', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await ready(page, '/?fresh=1&seed=36');
  await page.getByRole('button', { name: '商店' }).click();
  const sheet = page.locator('.sheet');
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const tabH = await page.locator('[data-a="shopTab"] span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of tabH) expect(h, '分頁文字要單行').toBeLessThan(24);
  for (const tab of TABS) {
    await page.locator(`[data-a="shopTab"][data-arg="${tab}"]`).click();
    const boxes = await page.locator('.sheet .card').evaluateAll((cards) =>
      cards.map((c) => {
        const cb = c.getBoundingClientRect();
        const f = c.querySelector('.foot > *')?.getBoundingClientRect();
        return { cl: cb.left, cr: cb.right, fl: f?.left ?? cb.left, fr: f?.right ?? cb.right };
      }),
    );
    for (const b of boxes) {
      expect(b.fl, `${tab} 頁購買鈕左緣在卡片內`).toBeGreaterThanOrEqual(b.cl - 0.5);
      expect(b.fr, `${tab} 頁購買鈕右緣在卡片內`).toBeLessThanOrEqual(b.cr + 0.5);
    }
  }
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-shop-320.png' });
});

test('真的讀一份 v2 舊存檔：沒有 xp 也不會降回 Lv.1，已裝的高階設備顯示已安裝不是鎖', async ({ page }) => {
  // 先開一次拿到合法 state，改成 v2 的樣子。寫 localStorage 要在「不是遊戲」的同源頁面上做：
  // 遊戲頁離開時（pagehide）會把自己的 state 存回去，蓋掉我們剛寫的舊檔。
  await ready(page, '/?fresh=1&seed=37');
  const v2 = await page.evaluate(() => {
    const s = JSON.parse(JSON.stringify(window.__lpg.state)) as Record<string, unknown>;
    delete s.xp;
    s.schemaVersion = 2;
    s.stats = { baths: 300, sold: 200, mutations: 2, picked: 300, crafted: 100 };
    s.equipment = { restock: true }; // v5 以前是全場一份的扁平布林表（D45 之後才分區）
    return JSON.stringify(s);
  });
  await page.goto('/manifest.webmanifest');
  await page.evaluate((raw) => localStorage.setItem('lpg.save.v1', raw), v2);
  // 這一關刻意不帶 fresh=1（要走正常讀檔），於是「加到主畫面」提示會出現並蓋住商店鈕。
  // 那張卡是全螢幕遮罩、本來就該先關掉，所以這裡先標記成看過，測的才是商店本身
  await page.evaluate(() => localStorage.setItem('lpg.a2hs.off', '1'));
  await ready(page, '/?seed=37'); // 沒有 fresh=1：走正常讀檔
  const s = await state(page);
  expect(s.xp).toBeGreaterThan(0);
  expect(s.equipment[s.activeZone]!.restock).toBe(true);
  await expect(page.locator('.shopbtn .lvl')).not.toHaveText('Lv.1');
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="equipment"]').click();
  await expect(page.locator('.card[data-id="equip:restock"]')).toHaveAttribute('data-status', 'owned');
  await expect(page.locator('.card[data-id="equip:restock"] .owned')).toHaveText('已安裝');
});
