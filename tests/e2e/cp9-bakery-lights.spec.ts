import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { BALANCE } from '../../src/game/balance';
import { STATIONS, STATION_IDS, machinePrice } from '../../src/game/recipes';
import { BELT, STATION_ANCHOR, STATION_BAR } from '../../src/scene/bakery/layout';
import type { GameState } from '../../src/game/state';

/**
 * 甜點店開燈＋機器頭上的標籤（2026-09-24 使用者：「甜點店應該要開燈 而且正在製作的地方上面應該顯示可容納數量跟可以升級的圖標跟進度條」）。
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

async function step(page: Page, sec: number) {
  await page.evaluate((t) => {
    for (let left = t; left > 0; left -= 0.25) window.__lpg.step!(Math.min(0.25, left));
  }, sec);
  await page.waitForTimeout(250);
}

/** 把遊戲時鐘撥到第 4 天的某個鐘點（dayClock：一天 dayLengthSec 秒、epoch 當天 openHour 點） */
async function setHour(page: Page, hour: number) {
  await page.evaluate(([h, L, open]) => {
    const s = window.__lpg.state as GameState;
    s.time = s.bakery.epoch + L! * 3 + ((h! - open!) / 24) * L!;
  }, [hour, BALANCE.bakery.dayLengthSec, BALANCE.bakery.openHour]);
  await step(page, 0.3);
}

/** 畫面中段（輸送帶與展示櫃之間的地板與機器）平均亮度 0–255 */
async function midLuma(page: Page): Promise<number> {
  // 量的是 3D 場景的亮度：HUD 的底座牌是白色 HTML、不受燈光影響，先藏起來
  await page.evaluate(() => { (document.querySelector('.stags') as HTMLElement).style.visibility = 'hidden'; });
  const vp = page.viewportSize()!;
  const buf = await page.screenshot({
    clip: { x: vp.width * 0.25, y: vp.height * 0.3, width: vp.width * 0.5, height: vp.height * 0.25 },
  });
  await page.evaluate(() => { (document.querySelector('.stags') as HTMLElement).style.visibility = ''; });
  const { channels } = await sharp(buf).removeAlpha().stats();
  const [r, g, b] = channels.map((c) => c.mean);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test('天黑燈就開：20 點營業中跟中午一樣亮，壁燈亮著；中午燈是關的', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await setHour(page, 12);
  const noon = await midLuma(page);
  expect(await page.evaluate(() => window.__lpg.bakery!.lampLevel)).toBe(0);

  await setHour(page, 20.1);
  await expect(page.locator('.daybar .open')).toHaveText('營業中');
  const evening = await midLuma(page);
  expect(await page.evaluate(() => window.__lpg.bakery!.lampLevel)).toBe(1);
  // 改前 20 點只有中午的 6 成左右（使用者截圖那樣）；開燈後至少 9 成
  expect(evening, `noon ${noon.toFixed(1)} evening ${evening.toFixed(1)}`).toBeGreaterThan(noon * 0.9);

  // 打烊後（23 點）燈照樣亮：線上的機器還在做
  await setHour(page, 23);
  expect(await page.evaluate(() => window.__lpg.bakery!.lampLevel)).toBe(1);
  await expect(page.locator('.daybar .open')).toContainText('打烊');
});

/** 三台有一盤、三台空著、冷藏櫃沒買；等級 1／2／滿級（20）混著 */
async function seedLine(page: Page, coins: number) {
  await page.evaluate((c) => {
    const s = window.__lpg.state as GameState;
    s.coins = c;
    Object.assign(s.bakery.machines, { stove: 1, crack: 2, mix: 20, mold: 2, bake: 2, chill: 0, decorate: 1 });
    for (const id of Object.keys(s.bakery.stations) as (keyof typeof s.bakery.stations)[]) s.bakery.stations[id] = { batch: null, startedAt: 0, doneAt: 0 };
    s.bakery.stations.stove = { batch: { species: 'caramel', qty: 1 }, startedAt: s.time, doneAt: s.time + 1000 };
    s.bakery.stations.mix = { batch: { species: 'matcha', qty: 2 }, startedAt: s.time, doneAt: s.time + 1000 };
    s.bakery.stations.bake = { batch: { species: 'custard', qty: 2 }, startedAt: s.time, doneAt: s.time + 1000 };
  }, coins);
  await step(page, 0.3);
}

const tag = (page: Page, id: string) => page.locator(`.stag[data-arg="${id}"]`);

test('七台都有底座牌：名稱＋Lv、份數「這盤/上限」（空著 0）、沒買寫未購買；進度條會長、錢夠升級才冒綠色箭頭', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await seedLine(page, 0);

  await expect(page.locator('.stag:not([hidden])')).toHaveCount(7);
  await expect(tag(page, 'stove').locator('.nm')).toHaveText('爐台Lv1');
  await expect(tag(page, 'mix').locator('.nm')).toHaveText('攪拌機Lv20');
  await expect(tag(page, 'stove').locator('.q')).toHaveText('1/1');
  await expect(tag(page, 'mix').locator('.q')).toHaveText('2/20');
  await expect(tag(page, 'bake').locator('.q')).toHaveText('2/2');
  // 空著：這盤 0 份、這台上限照寫，進度條空
  await expect(tag(page, 'crack').locator('.q')).toHaveText('0/2');
  await expect(tag(page, 'crack').locator('.bar > i')).toHaveAttribute('style', /width: 0%/);
  // 沒買：寫未購買、整塊變淡、沒有 Lv
  await expect(tag(page, 'chill').locator('.q b')).toHaveText('未購買');
  await expect(tag(page, 'chill').locator('.q .of')).toBeHidden();
  await expect(tag(page, 'chill')).toHaveClass(/off/);
  await expect(tag(page, 'chill').locator('.nm')).toHaveText('冷藏櫃');

  // 機器底下的 3D 名牌拿掉了：名牌 mesh 只剩店招一塊（4 個頂點）
  expect(await page.evaluate(() => {
    const m = window.__lpg.bakery!.scene.getObjectByName('BakeryLabels') as unknown as { geometry: { attributes: { position: { count: number } } } };
    return m.geometry.attributes.position.count;
  })).toBe(4);

  // 沒錢：一個箭頭都沒有（主流料理遊戲的做法：買得起才冒出來，畫面不亂）
  for (const id of STATION_IDS) await expect(tag(page, id).locator('.up')).toBeHidden();

  // 錢剛好夠爐台升級：只有爐台冒箭頭；烤箱 Lv2→3 比較貴、攪拌機滿級，都沒有
  await page.evaluate((p) => { (window.__lpg.state as GameState).coins = p; }, machinePrice('stove', 1)!);
  await step(page, 0.3);
  await expect(tag(page, 'stove').locator('.up')).toBeVisible();
  await expect(tag(page, 'stove')).toHaveClass(/afford/);
  await expect(tag(page, 'bake').locator('.up')).toBeHidden();
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 1e6; });
  await step(page, 0.3);
  await expect(tag(page, 'mix').locator('.up')).toBeHidden();
  await expect(tag(page, 'chill').locator('.up')).toBeVisible(); // 沒買的：錢夠買也冒

  // 進度條跟著時間長
  const width = (l: Locator) => l.locator('.bar > i').evaluate((e) => parseFloat((e as HTMLElement).style.width));
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.stations.bake.doneAt = s.time + 40;
  });
  await step(page, 0.3);
  const w0 = await width(tag(page, 'bake'));
  await step(page, 10);
  const w1 = await width(tag(page, 'bake'));
  expect(w1).toBeGreaterThan(w0);
  expect(w1).toBeLessThan(100);
});

test('做完卡在等下一站：進度條滿、變綠', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await seedLine(page, 0);
  // 爐台那盤做完、下一站（打蛋機）被佔著 → 停在爐台等
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.stations.crack = { batch: { species: 'custard', qty: 1 }, startedAt: s.time, doneAt: s.time + 1000 };
    s.bakery.stations.stove = { batch: { species: 'caramel', qty: 1 }, startedAt: s.time, doneAt: s.time + 0.1 };
  });
  await step(page, 1);
  const s = await page.evaluate(() => (window.__lpg.state as GameState).bakery.stations.stove.batch);
  expect(s).not.toBeNull();
  await expect(tag(page, 'stove')).toHaveClass(/ready/);
  await expect(tag(page, 'stove').locator('.bar > i')).toHaveAttribute('style', /width: 100%/);
});

test('點標籤：還能升級＝開商店工坊頁、捲到那台並標亮，按得到升級；滿級＝講它在做什麼', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await seedLine(page, 5000);

  await tag(page, 'bake').click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('[data-a="shopTab"][data-arg="bakery"]')).toHaveAttribute('aria-selected', 'true');
  const card = page.locator('.sheet .card[data-id="machine:bake"]');
  await expect(card).toHaveClass(/focus/);
  await expect(card).toBeInViewport();
  // 只有那一張標亮
  await expect(page.locator('.sheet .card.focus')).toHaveCount(1);

  // 直接按那張卡的升級：等級＋1，標亮留著，頭上的上限跟著變
  await card.locator('[data-a="buyMachine"]').click();
  expect(await page.evaluate(() => (window.__lpg.state as GameState).bakery.machines.bake)).toBe(3);
  await step(page, 0.3);
  await expect(page.locator('.sheet .card[data-id="machine:bake"]')).toHaveClass(/focus/);
  await page.locator('[data-a="closeShop"]').click();
  await expect(tag(page, 'bake').locator('.q')).toHaveText('2/3');
  // D61 起 Lv3 不是頂：錢還夠升下一級就還冒箭頭，錢花光才收起來
  await page.evaluate(() => { (window.__lpg.state as GameState).coins = 0; });
  await step(page, 0.3);
  await expect(tag(page, 'bake').locator('.up')).toBeHidden();

  // 再從別的地方打開商店：沒有殘留的標亮
  await page.getByRole('button', { name: '商店' }).click();
  await page.locator('[data-a="shopTab"][data-arg="bakery"]').click();
  await expect(page.locator('.sheet .card.focus')).toHaveCount(0);
  await page.locator('[data-a="closeShop"]').click();

  // 滿級的那台：點了是講它在做什麼（跟點 3D 機器一樣），不開商店
  await tag(page, 'mix').click();
  await expect(page.locator('.sheet')).toBeHidden();
  await expect(page.locator('.toast').last()).toContainText('攪拌機正在');
});

test('線一直在跑：抓住的標籤不會在手指底下被換掉（D55／D56 同型坑）', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await seedLine(page, 0);
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.bakery.stations.bake.doneAt = s.time + 60;
  });
  await step(page, 0.3);
  const handle = await tag(page, 'bake').elementHandle();
  // 進度一直在長，錢也在抽屜外漲：中途跨過升級價（升級圖示由灰轉綠）也不能換掉節點
  for (let i = 0; i < 4; i++) {
    await page.evaluate((p) => { (window.__lpg.state as GameState).coins += p; }, machinePrice('bake', 2)! / 3);
    await step(page, 3);
  }
  await expect(tag(page, 'bake')).toHaveClass(/afford/);
  expect(await handle!.evaluate((e) => e.isConnected && !(e as HTMLElement).hidden)).toBe(true);
});

test('回農場標籤全藏；切回工坊又在', async ({ page }) => {
  await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
  await seedLine(page, 0);
  await expect(tag(page, 'stove')).toBeVisible();
  await page.getByRole('button', { name: /回農場/ }).click();
  await expect(page.locator('.stags')).toBeHidden();
  await expect(tag(page, 'stove')).toBeHidden();
  await page.getByRole('button', { name: /甜點店/ }).click();
  await expect(tag(page, 'stove')).toBeVisible();
});

type Box = { x: number; y: number; width: number; height: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test.describe(`${vp.width}px`, () => {
    test.use({ viewport: vp });
    test('七站都有一盤：標籤彼此不重疊、不壓到頂列／日曆卡／右側按鈕、都在畫面內、字不溢出、徽章不壓名稱', async ({ page }) => {
      await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
      await page.evaluate(() => {
        const s = window.__lpg.state as GameState;
        s.coins = 99999;
        for (const [i, id] of (['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'] as const).entries()) {
          s.bakery.machines[id] = 2;
          s.bakery.stations[id] = { batch: { species: 'brulee', qty: 2 }, startedAt: s.time, doneAt: s.time + 500 + i };
        }
      });
      await step(page, 0.3);
      const tags = page.locator('.stag:not([hidden])');
      await expect(tags).toHaveCount(7);
      const boxes: Box[] = [];
      for (let i = 0; i < 7; i++) {
        const t = tags.nth(i);
        const b = (await t.boundingBox())!;
        // 右上角的升級徽章算進去（它凸出標籤外）
        const up = (await t.locator('.up').boundingBox())!;
        const x0 = Math.min(b.x, up.x), y0 = Math.min(b.y, up.y);
        boxes.push({ x: x0, y: y0, width: Math.max(b.x + b.width, up.x + up.width) - x0, height: b.y + b.height - y0 });
        // 字的實際寬度（Range 量的是排出來的字，不受 overflow 設定影響）要塞得進標籤內緣
        const q = await t.locator('.q').evaluate((e) => {
          const r = document.createRange();
          r.selectNodeContents(e);
          return { text: r.getBoundingClientRect().width, room: (e.parentElement as HTMLElement).clientWidth - 4 };
        });
        expect(q.text, `tag ${i} text overflow`).toBeLessThanOrEqual(q.room);
        // 右上角的升級徽章不能壓到第一行的名稱＋Lv（2026-09-24 截圖：「打蛋機 Lv2」的 2 被蓋掉）
        const nm = await t.locator('.nm').evaluate((e) => {
          const r = document.createRange();
          r.selectNodeContents(e);
          const b = r.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        });
        expect(hit(nm, up), `tag ${i} badge covers name`).toBe(false);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          // 徽章可以碰到隔壁標籤的角，但兩塊標籤本體不能疊
          const a = (await tags.nth(i).boundingBox())!;
          const b = (await tags.nth(j).boundingBox())!;
          expect(hit(a, b), `tags ${i} & ${j}`).toBe(false);
        }
      }
      for (const sel of ['.topbar', '.daybar', '.rightcol', '.dock']) {
        const hb = (await page.locator(sel).boundingBox())!;
        for (const [i, b] of boxes.entries()) expect(hit(b, hb), `tag ${i} vs ${sel}`).toBe(false);
      }
    });
  });
}

for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test.describe(`${vp.width}px 機器看得到`, () => {
    test.use({ viewport: vp });
    test('七台都買、錢夠升級、每站都有一盤：每台機器的機頭與機身都沒被牌子或箭頭擋住（使用者：「請改成可以看到機器的長相」）', async ({ page }) => {
      await boot(page, '/?fresh=1&seed=8&view=bakery&pause=1');
      await page.evaluate(() => {
        const s = window.__lpg.state as GameState;
        s.coins = 99999;
        for (const [i, id] of (['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'] as const).entries()) {
          s.bakery.machines[id] = 2;
          s.bakery.stations[id] = { batch: { species: 'brulee', qty: 2 }, startedAt: s.time, doneAt: s.time + 500 + i };
        }
      });
      await step(page, 0.3);
      await expect(page.locator('.stag .up:visible')).toHaveCount(7);
      for (const id of STATION_IDS) {
        const head = STATION_BAR[id];
        const a = STATION_ANCHOR[id];
        // 機頭（機身最高處附近）與機身中段（帶面上方 0.25）
        for (const [label, p] of [['head', head], ['body', { x: a.x, y: BELT.y + 0.25, z: a.z - 0.05 }]] as const) {
          const hitTag = await page.evaluate(([x, y, z]) => {
            const cam = window.__lpg.bakery!.camera;
            const v = cam.position.clone().set(x!, y!, z!).project(cam);
            const rect = document.querySelector('canvas')!.getBoundingClientRect();
            const sx = rect.left + ((v.x + 1) / 2) * rect.width;
            const sy = rect.top + ((1 - v.y) / 2) * rect.height;
            const el = document.elementFromPoint(sx, sy);
            return el?.tagName === 'CANVAS' ? '' : `${el?.className ?? 'null'} @ ${Math.round(sx)},${Math.round(sy)}`;
          }, [p.x, p.y, p.z]);
          expect(hitTag, `${id} ${label} covered`).toBe('');
        }
      }
    });
  });
}
