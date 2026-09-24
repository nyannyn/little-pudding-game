import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { SCHEMA_VERSION, type GameState } from '../../src/game/state';

/**
 * AC11-10：v10 存檔走「設定 → 存檔碼 → 還原」真流程升到 v11（不是手刻 state）。
 *
 * 存檔碼是 v10 的程式自己玩出來、用產品的 `exportCode()` 產的（`tests/fixtures/v10-save.*`，**暫代**：
 * 使用者手機那一份拿到之後換成它再跑一次）。瀏覽器時鐘固定在存檔的 `lastSeenAt`（`clock.setFixedTime`：
 * 只動 Date.now、計時器照跑），還原之後不會先跑 8 小時離線結算——這裡量的是 migrate，不是離線。
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const raw = JSON.parse(readFileSync(join(DIR, 'v10-save.json'), 'utf8'));
const code = readFileSync(join(DIR, 'v10-save.code.txt'), 'utf8').trim();

const S = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__lpg.state)) as GameState);

test('AC11-10：v10 存檔碼還原 → v11：數值不變、舊庫存全在 ★1、布丁 ★1／潛力 2、熊先生解鎖、在做的那盤照原 doneAt 做完', async ({ page }) => {
  await page.clock.setFixedTime(raw.lastSeenAt + 2000);
  await page.addInitScript(() => {
    localStorage.setItem('lpg.hints.off', '1');
    localStorage.setItem('lpg.a2hs.off', '1');
  });
  await page.goto('/?pause=1');
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.getByRole('button', { name: '設定' }).click();
  await page.fill('.savecard .code', code);
  await Promise.all([page.waitForEvent('load'), page.click('[data-a="restoreSave"]')]);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });

  const s = await S(page);
  expect(raw.schemaVersion).toBe(10);
  expect(s.schemaVersion).toBe(SCHEMA_VERSION);
  // 布丁數、金幣、等級、機器、人氣、設備不變（離線只補了 2 秒）
  expect(s.puddings).toHaveLength(raw.puddings.length);
  expect(Math.abs(s.coins - raw.coins)).toBeLessThan(200);
  expect(s.xp).toBeGreaterThanOrEqual(raw.xp);
  expect(s.bakery.machines).toEqual(raw.bakery.machines);
  expect(s.bakery.fame).toBe(raw.bakery.fame);
  expect(s.equipment).toEqual(raw.equipment);
  // 舊庫存全部在 ★1
  for (const [id, n] of Object.entries(raw.bakery.shelf as Record<string, number>)) {
    const row = s.bakery.shelf[id as 'caramel'];
    expect(row.slice(1)).toEqual([0, 0, 0, 0]);
    expect(row[0]).toBeLessThanOrEqual(n); // 2 秒裡可能有散客買走一份
  }
  for (const [id, n] of Object.entries(raw.ingredients as Record<string, number>)) {
    const row = s.ingredients[id as 'caramel'];
    expect(row.slice(1)).toEqual([0, 0, 0, 0]);
    expect(row[0]).toBeGreaterThanOrEqual(n); // 收集手 2 秒可能多撿一兩份，一份都不會少
  }
  for (const p of s.puddings) expect([p.star, p.potential, p.care]).toEqual([1, 2, 0]);
  for (const d of s.drops) expect(d.star).toBe(1);
  for (const z of s.zones) expect(z.mode).toBe('mass');
  // 甜點店已開張 → 熊先生解鎖（第一個 tick 判）
  expect(s.regulars.bear.unlocked).toBe(true);
  // 在做的那一盤：★1、照原本的 doneAt
  const [id, st] = Object.entries(raw.bakery.stations as Record<string, { batch: { species: string } | null; doneAt: number }>).find(([, v]) => v.batch)!;
  const now = s.bakery.stations[id as 'stove'];
  expect(now.batch?.star).toBe(1);
  expect(now.doneAt).toBe(st.doneAt);

  // 介面讀得出來：上架卡按星級列出 ★1、名冊看得到熊先生
  await page.evaluate(() => window.__lpg.setView!('bakery'));
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__lpg.step!(0.1); });
  await page.locator('[data-a="openRegulars"]').click();
  await expect(page.locator('.regcard .reg[data-id="bear"]')).toContainText('熊先生');
  await page.locator('[data-a="closeRegulars"]').click();
});
