import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  categoryClaimable,
  claimAllAchievements,
  claimedRewardTotal,
  seriesList,
} from '../../src/game/achievements';
import type { SimEvent } from '../../src/game/events';
import { createNewSave, migrate } from '../../src/game/state';

/** D55 成就改版：分類、系列星等、隱藏成就、全部領取 */

// D54 上線時的 20 個 id（2026-09-23 的線上版）。刪掉或改名任何一個，老玩家的領取紀錄就會被
// migrate() 靜默濾掉、而且能再領一次——所以這張表是寫死的，不從 ACHIEVEMENTS 推
const D54_IDS = [
  'firstPick', 'firstSale', 'firstBath', 'firstBirth', 'firstBake', 'firstCustomer', 'firstDay',
  'firstPuddingSale', 'pick100', 'births10', 'zone2', 'ingredients100', 'orders10', 'baked50',
  'served100', 'day500', 'species5', 'hybrid3', 'week', 'baked500',
];

describe('D55 成就資料表', () => {
  it('D54 的 20 個 id 全部還在，老玩家的領取紀錄 migrate 後原封不動', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    for (const id of D54_IDS) expect(ids).toContain(id);
    const old = createNewSave({ seed: 1, now: 0 });
    old.claimedAchievements = [...D54_IDS];
    const s = migrate(JSON.parse(JSON.stringify(old)), { seed: 1, now: 0 });
    expect(s.claimedAchievements).toEqual(D54_IDS);
  });

  it('id 不重複；每一條都屬於一個已知分類', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    const cats = ACHIEVEMENT_CATEGORIES.map((c) => c.id);
    for (const a of ACHIEVEMENTS) expect(cats).toContain(a.category);
    // 四類都有東西（空分頁＝玩家點進去什麼都沒有）
    for (const c of cats) expect(ACHIEVEMENTS.some((a) => a.category === c)).toBe(true);
  });

  it('同一系列在同一分類、target 嚴格遞增（畫面上的「下一階」才講得通）', () => {
    const bySeries = new Map<string, typeof ACHIEVEMENTS>();
    for (const a of ACHIEVEMENTS) bySeries.set(a.series, [...(bySeries.get(a.series) ?? []), a]);
    for (const [, tiers] of bySeries) {
      expect(new Set(tiers.map((a) => a.category)).size).toBe(1);
      for (let i = 1; i < tiers.length; i++) expect(tiers[i]!.target).toBeGreaterThan(tiers[i - 1]!.target);
    }
  });

  it('隱藏成就一定有提示句（不然整列只剩問號）', () => {
    for (const a of ACHIEVEMENTS.filter((x) => x.hidden)) expect(a.hint?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('D55 系列顯示', () => {
  it('一列只顯示第一個還沒領的那一階；領完全部停在最後一階、狀態 claimed', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const pick = () => seriesList(s, 'farm').find((v) => v.series === 'pick')!;
    expect(pick().current.id).toBe('firstPick');
    expect(pick().status).toBe('locked');

    s.stats.picked = 150;
    expect(pick().current.id).toBe('firstPick');
    expect(pick().status).toBe('claimable');

    s.claimedAchievements.push('firstPick');
    expect(pick().current.id).toBe('pick100');
    expect(pick().status).toBe('claimable');
    expect(pick().claimed).toBe(1);

    s.claimedAchievements.push('pick100');
    expect(pick().current.id).toBe('pick1000');
    expect(pick().status).toBe('locked');
    expect(pick().value).toBe(150);

    s.stats.picked = 5000;
    s.claimedAchievements.push('pick1000');
    expect(pick().current.id).toBe('pick1000');
    expect(pick().status).toBe('claimed');
    expect(pick().claimed).toBe(3);
    expect(pick().value).toBe(1000); // 進度封頂在 target，不會顯示 5000／1000
  });

  it('隱藏成就達成前 concealed、達成後就現形', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const mut = () => seriesList(s, 'family').find((v) => v.series === 'mutation')!;
    expect(mut().concealed).toBe(true);
    s.stats.mutations = 1;
    expect(mut().concealed).toBe(false);
    expect(mut().status).toBe('claimable');
  });

  it('分頁紅點只數自己那一類', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.stats.picked = 1;
    s.stats.baked = 1;
    expect(categoryClaimable(s, 'farm')).toBe(1);
    expect(categoryClaimable(s, 'bakery')).toBe(1);
    expect(categoryClaimable(s, 'family')).toBe(0);
    expect(categoryClaimable(s, 'shop')).toBe(0);
  });
});

describe('D55 全部領取', () => {
  it('跨分類一次領完、只發一個彙總事件，總額等於各條獎勵相加', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    Object.assign(s.stats, { picked: 120, baths: 1, baked: 1 });
    const coins = s.coins;
    const events: SimEvent[] = [];
    const r = claimAllAchievements(s, (e) => events.push(e));
    const expected = ['firstPick', 'pick100', 'firstBath', 'firstBake'];
    expect([...s.claimedAchievements].sort()).toEqual([...expected].sort());
    const sum = ACHIEVEMENTS.filter((a) => expected.includes(a.id)).reduce((n, a) => n + a.reward, 0);
    expect(r).toEqual({ count: 4, reward: sum });
    expect(s.coins).toBe(coins + sum);
    expect(events).toEqual([{ type: 'achievementsClaimed', count: 4, reward: sum }]);
    expect(claimedRewardTotal(s)).toBe(sum);
  });

  it('再按一次什麼都不領、不發事件、錢不變', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.stats.picked = 1;
    claimAllAchievements(s, () => {});
    const coins = s.coins;
    const events: SimEvent[] = [];
    expect(claimAllAchievements(s, (e) => events.push(e))).toEqual({ count: 0, reward: 0 });
    expect(events).toEqual([]);
    expect(s.coins).toBe(coins);
  });
});
