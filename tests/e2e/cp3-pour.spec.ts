import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../../src/game/state';
import { DRAW_CALL_BUDGET } from './helpers';

/**
 * 按「倒焦糖／倒牛奶」要有真的傾倒演出：壺進場、水流接到液面、液面慢慢升、有聲音。
 * 用 `?pause=1` 停住時間、`__lpg.step(dt)` 一幀一幀推——無頭 SwiftShader 十幾 fps，
 * 靠 wall clock 抓不到零點幾秒的畫面。聲音截圖證不了，靠 `__lpg.sfx.played` 計數。
 */

interface Box { min: [number, number, number]; max: [number, number, number] }
interface Probe {
  draw: number;
  stream: Box | null;
  jug: Box | null;
  /** 液面 disc 目前的世界高度（沒液面＝null） */
  liquidY: number | null;
  units: number;
  pour: number;
  unlocked: boolean;
}

async function open(page: Page, extra = '') {
  await page.goto(`/?debug=1&fresh=1&seed=31&pause=1${extra}`);
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__lpg.stats.triangles > 0, null, { timeout: 10_000 });
  // 開局的布丁焦糖很低，倒下去一秒內就會跳進盆裡扣掉那一份；這裡量的是倒的演出，先讓牠們吃飽
  await page.evaluate(() => {
    for (const p of (window.__lpg.state as GameState).puddings) p.caramel = 100;
  });
}

/** 推 `seconds` 秒的遊戲時間，每步最多 1/60 秒（跟真機的幀長一樣，動畫的 dt 夾限才不會被觸發） */
async function step(page: Page, seconds: number) {
  await page.evaluate((s) => {
    let t = 0;
    while (t < s - 1e-9) {
      const dt = Math.min(1 / 60, s - t);
      window.__lpg.step!(dt);
      t += dt;
    }
  }, seconds);
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const { scene } = window.__lpg.three!;
    type Mesh = { name: string; visible: boolean; matrixWorld: unknown; geometry: { computeBoundingBox(): void; boundingBox: { clone(): { applyMatrix4(m: unknown): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } } }; getAttribute(n: string): { getY(i: number): number } }; updateWorldMatrix(a: boolean, b: boolean): void };
    let stream: Mesh | null = null, jug: Mesh | null = null, liquid: Mesh | null = null;
    scene.traverse((o) => {
      const m = o as unknown as Mesh;
      if (m.name === 'PourStream') stream = m;
      if (m.name === 'PourJug') jug = m;
      if (m.name === 'BasinLiquid') liquid = m;
    });
    const box = (m: Mesh | null): Box | null => {
      if (!m || !m.visible) return null;
      m.updateWorldMatrix(true, false);
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    };
    const liq = liquid as Mesh | null;
    const st = window.__lpg.state as GameState;
    return {
      draw: window.__lpg.stats.drawCalls,
      stream: box(stream),
      jug: box(jug),
      liquidY: liq ? liq.geometry.getAttribute('position').getY(0) : null,
      units: st.basins[0]!.units,
      pour: window.__lpg.sfx!.played.pour,
      unlocked: window.__lpg.sfx!.isUnlocked,
    };
  });
}

test('倒焦糖：壺進場、水流接到液面、液面隨水流升、有播倒液體的聲音', async ({ page }) => {
  await open(page);
  const before = await probe(page);
  expect(before.units).toBe(0);
  expect(before.pour).toBe(0);
  const basin = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    return { x: s.basins[0]!.pos.x, z: s.basins[0]!.pos.z };
  });

  await page.locator('[data-a="pour"][data-arg="caramel"]').click();
  await step(page, 0.05);
  const t0 = await probe(page);
  // 聲音：按下去的那個手勢就要排進 AudioContext（第一次按「倒焦糖」是玩家的第一個動作）
  expect(t0.pour).toBe(1);
  expect(t0.unlocked).toBe(true);
  expect(t0.units).toBe(1); // 規則層一次加完；慢慢升的是畫面
  // 壺已經進場、水流還沒開、液面還沒冒出來（藏在盆底下）
  expect(t0.jug).not.toBeNull();
  expect(t0.stream).toBeNull();
  const floorY = t0.liquidY!;

  // 水流中段：頂在壺口、底接在液面、落點在盆內
  await step(page, 0.3);
  const mid = await probe(page);
  expect(mid.stream).not.toBeNull();
  expect(mid.jug).not.toBeNull();
  const s = mid.stream!;
  const cx = (s.min[0] + s.max[0]) / 2, cz = (s.min[2] + s.max[2]) / 2;
  expect(Math.hypot(cx - basin.x, cz - basin.z)).toBeLessThan(0.19); // BASIN.radius 0.21 之內（起始區原點 x=0）
  expect(s.max[1] - s.min[1]).toBeGreaterThan(0.08); // 有一段看得見的水柱
  expect(Math.abs(s.min[1] - mid.liquidY!)).toBeLessThan(0.012); // 底端接在顯示中的液面
  expect(s.max[1]).toBeLessThanOrEqual(mid.jug!.max[1] + 1e-6); // 頂端不高過壺
  expect(mid.liquidY!).toBeGreaterThan(floorY); // 液面已經開始升
  expect(mid.draw).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

  // 液面單調上升，最後停在 1 份的高度；壺與水流收掉
  let prev = mid.liquidY!;
  for (let i = 0; i < 6; i++) {
    await step(page, 0.12);
    const p = await probe(page);
    expect(p.liquidY!).toBeGreaterThanOrEqual(prev - 1e-6);
    prev = p.liquidY!;
  }
  await step(page, 0.4);
  const done = await probe(page);
  expect(done.stream).toBeNull();
  expect(done.jug).toBeNull();
  expect(done.units).toBe(1);
  // liquidLevel(1) − liquidLevel(0)：(1/3)·(0.105−0.014)
  expect(done.liquidY! - floorY).toBeGreaterThan(0.025);
  expect(done.pour).toBe(1);

  // 盆裡有焦糖時倒牛奶會被拒絕：沒有事件就沒有演出、沒有聲音
  await page.locator('[data-a="pour"][data-arg="milk"]').click();
  await step(page, 0.3);
  const refused = await probe(page);
  expect(refused.pour).toBe(1);
  expect(refused.stream).toBeNull();
  expect(refused.units).toBe(1);
});

test('倒牛奶也有演出（每種液體都走同一套）', async ({ page }) => {
  await open(page);
  await page.locator('[data-a="pour"][data-arg="milk"]').click();
  await step(page, 0.35);
  const mid = await probe(page);
  expect(mid.pour).toBe(1);
  expect(mid.stream).not.toBeNull();
  expect(mid.jug).not.toBeNull();
  expect(Math.abs(mid.stream!.min[1] - mid.liquidY!)).toBeLessThan(0.012);
  await page.screenshot({ path: 'tests/e2e/__screenshots__/cp3-pour-milk.png' });
});

test('最壞情況（全設備＋掉落物＋三隻）倒液體的那幾幀 draw calls 仍在預算內', async ({ page }) => {
  await open(page, '&pop=3');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999;
    for (const k of Object.keys(s.equipment)) s.equipment[k as keyof typeof s.equipment] = true;
    s.equipment.collector = false;
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.basins[0]!.preferredLiquid = 'caramel';
    s.drops = [0, 1, 2, 3, 4].map((i) => ({
      id: `d${i}`,
      zone: s.activeZone, kind: 'ingredient' as const,
      species: (['caramel', 'panna', 'matcha', 'strawberry'] as const)[i % 4]!,
      pos: { x: -0.3 + i * 0.15, z: 0.2 },
      bornAt: s.time,
    }));
  });
  await step(page, 0.5);
  await page.locator('[data-a="pour"][data-arg="caramel"]').click();
  let worst = 0;
  let sawStream = false;
  for (let i = 0; i < 12; i++) {
    await step(page, 0.08);
    const p = await probe(page);
    worst = Math.max(worst, p.draw);
    if (p.stream) sawStream = true;
  }
  test.info().annotations.push({ type: 'stats', description: `draw calls while pouring: ${worst}` });
  expect(sawStream).toBe(true);
  expect(worst).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
});

test('倒到一半切區：壺與水流不能跟到新的那一層', async ({ page }) => {
  await open(page);
  await page.locator('[data-a="pour"][data-arg="caramel"]').click();
  await step(page, 0.3);
  expect((await probe(page)).stream).not.toBeNull();
  const switched = await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    const other = s.zones.find((z) => z.id !== s.activeZone);
    if (!other) return null;
    other.unlocked = true;
    s.activeZone = other.id;
    return other.id;
  });
  expect(switched).not.toBeNull();
  await step(page, 1 / 60);
  const after = await probe(page);
  expect(after.stream).toBeNull();
  expect(after.jug).toBeNull();
});

test('自動注液閥補液也有水流與（小聲的）聲音', async ({ page }) => {
  await open(page);
  // 先按一次任何按鈕解鎖 AudioContext：自動事件不在手勢裡，不會自己建 context
  await page.locator('[data-a="settings"]').click();
  await page.locator('[data-a="closeSettings"]').click();
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.equipment.autoFill = true;
    s.basins[0]!.preferredLiquid = 'caramel';
    s.stock.caramel = 9;
  });
  await step(page, 0.3);
  const mid = await probe(page);
  expect(mid.units).toBe(3);
  expect(mid.pour).toBe(1);
  expect(mid.stream).not.toBeNull();
  expect(mid.jug).toBeNull(); // 閥門放的，沒有壺
  expect(Math.abs(mid.stream!.min[1] - mid.liquidY!)).toBeLessThan(0.012);
});

test('三個盆同時要倒（手動＋兩個注液閥）：同時只畫一組壺＋水流、只響一次、draw calls 在預算內', async ({ page }) => {
  await open(page, '&pop=3');
  await page.evaluate(() => {
    const s = window.__lpg.state as GameState;
    s.coins = 99999;
    for (const k of Object.keys(s.equipment)) s.equipment[k as keyof typeof s.equipment] = true;
    s.equipment.collector = false;
    s.equipment.autoFill = false; // 先關，三個盆就緒再開，讓兩個閥同一步觸發
    const b0 = s.basins[0]!;
    b0.liquid = 'caramel'; b0.units = 1; b0.preferredLiquid = 'caramel';
    s.basins.push({ ...b0, liquid: null, units: 0, preferredLiquid: 'matcha', pos: { x: 0.52, z: -0.24 }, occupantId: null });
    s.basins.push({ ...b0, liquid: null, units: 0, preferredLiquid: 'strawberry', pos: { x: -0.52, z: -0.24 }, occupantId: null });
    s.stock.matcha = 9; s.stock.strawberry = 9; s.stock.caramel = 9;
    s.ownedBasins.push('matcha', 'strawberry');
    s.drops = [0, 1, 2, 3, 4].map((i) => ({
      id: `d${i}`,
      zone: s.activeZone, kind: 'ingredient' as const,
      species: (['caramel', 'panna', 'matcha', 'strawberry'] as const)[i % 4]!,
      pos: { x: -0.3 + i * 0.15, z: 0.2 },
      bornAt: s.time,
    }));
  });
  await step(page, 0.5);
  await page.evaluate(() => { (window.__lpg.state as GameState).equipment.autoFill = true; });
  await page.locator('[data-a="pour"][data-arg="caramel"]').click();
  let worst = 0, maxStreams = 0, maxJugs = 0;
  for (let i = 0; i < 14; i++) {
    await step(page, 0.08);
    const s = await page.evaluate(() => {
      let streams = 0, jugs = 0;
      window.__lpg.three!.scene.traverse((o) => {
        if (o.name === 'PourStream' && o.visible) streams++;
        if (o.name === 'PourJug' && o.visible) jugs++;
      });
      return { draw: window.__lpg.stats.drawCalls, streams, jugs, pour: window.__lpg.sfx!.played.pour };
    });
    worst = Math.max(worst, s.draw);
    maxStreams = Math.max(maxStreams, s.streams);
    maxJugs = Math.max(maxJugs, s.jugs);
    expect(s.pour).toBeLessThanOrEqual(1);
  }
  test.info().annotations.push({ type: 'stats', description: `draw calls with 3 basins pouring: ${worst}` });
  expect(maxStreams).toBe(1);
  expect(maxJugs).toBe(1);
  expect(worst).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
  // 沒畫出來的兩盆液面照樣要升到位
  await step(page, 1.5);
  const levels = await page.evaluate(() => (window.__lpg.state as GameState).basins.map((b) => b.units));
  expect(levels).toEqual([2, 3, 3]);
});

test('倒到一半布丁跳進盆：液面升完才淡出，不會瞬間消失', async ({ page }) => {
  await open(page);
  await page.locator('[data-a="pour"][data-arg="caramel"]').click();
  await step(page, 0.45);
  const mid = await probe(page);
  expect(mid.stream).not.toBeNull();
  const yBefore = mid.liquidY!;
  // 等價於 consumeBathUnit：布丁進盆扣掉那一份、盆清空
  await page.evaluate(() => {
    const b = (window.__lpg.state as GameState).basins[0]!;
    b.units = 0;
    b.liquid = null;
  });
  await step(page, 1 / 60);
  const next = await probe(page);
  expect(next.liquidY).not.toBeNull(); // 現行 code 這一幀就 null（負向對照）
  expect(next.liquidY!).toBeGreaterThanOrEqual(yBefore - 1e-6);
  expect(Math.abs(next.stream!.min[1] - next.liquidY!)).toBeLessThan(0.012);
  // 繼續升（時間表 hold 0.3＋rise 0.5，0.77 秒時接近一份的高度），升完才開始退
  await step(page, 0.3);
  const top = await probe(page);
  expect(top.liquidY! - yBefore).toBeGreaterThan(0.01);
  await step(page, 0.7);
  const gone = await probe(page);
  expect(gone.liquidY).toBeNull();
  expect(gone.stream).toBeNull();
});
