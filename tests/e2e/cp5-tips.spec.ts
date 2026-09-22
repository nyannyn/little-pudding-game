import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';

/**
 * 點數字跳氣泡 ＋ 效能面板搬進設定卡（2026-09-22，使用者要求）。
 *
 * 效能面板原本是畫面左下的常駐浮層，玩家什麼都沒做也看得到一堆 fps／draw calls；
 * 現在收進齒輪，而且維持「只有 `?debug=1` 才存在」的開關語意。
 */

async function ready(page: Page, query = '/') {
  await page.goto(query);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  for (const sel of ['[data-a="closeA2hs"]', '[data-a="closeWelcome"]']) {
    const btn = page.locator(sel);
    if (await btn.isVisible()) await btn.click();
  }
}

test('點頂列的四個數字，各跳一則小布丁的說明', async ({ page }) => {
  await ready(page);

  const bubble = page.locator('.tipbubble');
  await expect(bubble).toBeHidden();

  const seen = new Set<string>();
  for (const k of ['coins', 'egg', 'ing', 'des']) {
    await page.locator(`.chip[data-k="${k}"]`).click();
    await expect(bubble).toBeVisible();
    const text = (await bubble.locator('.t').textContent()) ?? '';
    expect(text.length).toBeGreaterThan(8);
    seen.add(text); // 四顆不可以講同一句話
    if (k === 'coins') await page.screenshot({ path: 'tests/e2e/__screenshots__/cp5-tip-bubble.png' });
    // 氣泡不能擋住底下的東西：它是 pointer-events: none
    expect(await bubble.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  }
  expect(seen.size).toBe(4);

  // 不用玩家去關，自己會消失
  await expect(bubble).toBeHidden({ timeout: 8_000 });
});

test('點訂單卡上的數字，說明要幾份、給多少、什麼時候過期', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.orders.push({ id: 'o-tip', species: 'caramel', qty: 3, price: 42, createdAt: s.time, expiresAt: s.time + 600 });
  });
  await page.waitForSelector('.order[data-id="o-tip"]');

  await page.locator('.order[data-id="o-tip"] .t').click();
  const text = (await page.locator('.tipbubble .t').textContent()) ?? '';
  expect(text).toContain('3 份');
  expect(text).toContain('42');
});

test('效能面板不在畫面上，收在設定卡裡（而且只有 ?debug=1 才有）', async ({ page }) => {
  await ready(page, '/?debug=1');

  // 關著設定卡的時候，玩家的畫面上看不到任何 fps 數字
  await expect(page.locator('#debug')).toBeHidden();
  // 而且它真的住在設定卡裡，不是另外一個浮層
  expect(await page.locator('.savecard #debug').count()).toBe(1);

  await page.click('[data-a="settings"]');
  await expect(page.locator('.savecard .debugbox')).toBeVisible();
  await expect.poll(async () => (await page.locator('#debug').textContent()) ?? '').toContain('lpg.save.');
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp5-settings-debug.png' });
  await expect.poll(async () => (await page.locator('#debug').textContent()) ?? '').toContain('fps');
  // 存檔狀態也要看得到（下次「進度不見了」才有事實可以看）
  await expect.poll(async () => (await page.locator('#debug').textContent()) ?? '').toContain('lpg.save.');

  // 沒帶 ?debug=1 就連設定卡裡也不該出現
  await ready(page, '/');
  await page.click('[data-a="settings"]');
  await expect(page.locator('.savecard .debugbox')).toBeHidden();
});
