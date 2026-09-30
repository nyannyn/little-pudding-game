import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETIRED_EQUIPMENT_PRICE } from '../../src/game/balance';
import { importCode } from '../../src/game/savecode';
import { SCHEMA_VERSION } from '../../src/game/state';
import { progressScore } from '../../src/game/storage';

/**
 * 使用者手機匯出的**真實**存檔碼（v5，2026-09-22 玩的；2026-09-30 使用者貼來）。
 * 真 v10 手機存檔已經拿不到（手機一開線上版就自動升 v11），這份是手上最舊的真實存檔：
 * 一路 v5 → 現行版本的 `migrate()` 都要走過，補值方向錯了這裡會紅。
 */
const code = readFileSync(join(__dirname, '..', 'fixtures', 'v5-phone-save.code.txt'), 'utf8').trim();
const raw = JSON.parse(Buffer.from(code.split('.')[1]!, 'base64url').toString('utf8'));

describe('手機真實存檔 v5 → 現行版本（importCode＝「還原」那條路）', () => {
  const s = importCode(code)!;

  it('夾具真的是 v5、檢查碼對得上', () => {
    expect(raw.schemaVersion).toBe(5);
    expect(s).not.toBeNull();
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('布丁、等級、累計統計一個不少；progressScore 等於 v5 當時的算法', () => {
    expect(s.puddings.map((p) => [p.id, p.species, p.zone])).toEqual(
      raw.puddings.map((p: { id: string; species: string; zone: string }) => [p.id, p.species, p.zone]),
    );
    expect(s.xp).toBe(raw.xp);
    for (const [k, v] of Object.entries(raw.stats as Record<string, number>)) {
      expect(s.stats[k as 'baths']).toBe(v);
    }
    // v5 沒有 baked／served，舊公式＝xp＋其餘累計
    const v5Score = raw.xp + Object.values(raw.stats as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(progressScore(s)).toBe(v5Score);
  });

  it('退役的甜點加工機＋自動販售口照原價退一台（v5 是扁平形狀＝全場一台）', () => {
    expect(raw.equipment.crafter).toBe(true);
    expect(raw.equipment.seller).toBe(true);
    expect(s.coins).toBe(raw.coins + RETIRED_EQUIPMENT_PRICE.crafter! + RETIRED_EQUIPMENT_PRICE.seller!);
  });

  it('設備只留在當時已解鎖的那一區，未解鎖的區不白送', () => {
    expect(s.equipment.c0t1).toEqual({ autoFill: true, collector: true, restock: false });
    for (const z of s.zones.filter((x) => !x.unlocked)) {
      expect(Object.values(s.equipment[z.id]!).some(Boolean)).toBe(false);
    }
  });

  it('舊原料放 ★1；布丁全 ★1／潛力 2／點數 0；區是量產', () => {
    for (const [id, n] of Object.entries(raw.ingredients as Record<string, number>)) {
      expect(s.ingredients[id as 'caramel']).toEqual([n, 0, 0, 0, 0]);
    }
    expect(s.ingredients.caramel[0]).toBe(7);
    for (const p of s.puddings) expect([p.star, p.potential, p.care]).toEqual([1, 2, 0]);
    for (const z of s.zones) expect(z.mode).toBe('mass');
  });

  it('甜點店沒開張過 → 常客全部未解鎖；散客訂單原樣', () => {
    expect(Object.values(s.regulars).every((r) => !r.unlocked && r.hearts === 0)).toBe(true);
    expect(s.orders.map((o) => o.id)).toEqual(['o58']);
  });
});
