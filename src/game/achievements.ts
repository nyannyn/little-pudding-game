import type { EventSink } from './events';
import { BASE_SPECIES_IDS, type AlleleId } from './species';
import type { GameState } from './state';

/**
 * 成就（D54，2026-09-23 使用者：「增加成就系統，讓一開始遊玩獲得初始資金，因為甜點製作
 * 自動化系統、加速、店員僱員都應該很貴」）。
 *
 * 條件**只讀單調遞增的欄位**（`stats` 的累計次數、`speciesSeen`、`bestDayRevenue`、已解鎖分區數）。
 * 用 `coins` 或「現在養幾隻」判定的話，花掉／賣掉就會「失去」成就，而且領過的獎金會跟條件對不上。
 * 達成不會自動入帳，要玩家按「領取」——領的那一下才是回饋，自動入帳玩家根本不會注意到錢從哪來。
 *
 * 前七條（撿、賣、泡澡、生寶寶、出爐、第一位客人、第一天打烊）約前 15 分鐘就拿得到，
 * 合計 640 元＝開局資金（`npm run pacing` 的 achievements 情境量這個數）。
 * 老玩家的舊 stats 算數：他們在舊規則下確實撿過、泡過、生過。
 */

export interface AchievementInfo {
  id: string;
  name: string;
  desc: string;
  reward: number;
  /** 目前進度值（單調遞增的來源） */
  value: (s: GameState) => number;
  target: number;
}

const zonesUnlocked = (s: GameState) => s.zones.filter((z) => z.unlocked).length;

export const ACHIEVEMENTS: AchievementInfo[] = [
  { id: 'firstPick', name: '第一份原料', desc: '撿起布丁掉的東西', reward: 30, value: (s) => s.stats.picked, target: 1 },
  { id: 'firstSale', name: '開張第一筆', desc: '把原料賣給商店', reward: 50, value: (s) => s.stats.ingredientsSold, target: 1 },
  { id: 'firstBath', name: '泡澡初體驗', desc: '布丁泡完一次澡', reward: 30, value: (s) => s.stats.baths, target: 1 },
  { id: 'firstBirth', name: '新生命', desc: '泡牛乳澡生出一隻小布丁', reward: 80, value: (s) => s.stats.births, target: 1 },
  { id: 'firstBake', name: '第一盤出爐', desc: '在甜點工坊做完一盤甜點', reward: 150, value: (s) => s.stats.baked, target: 1 },
  { id: 'firstCustomer', name: '第一位客人', desc: '展示架上的甜點被買走', reward: 100, value: (s) => s.stats.served, target: 1 },
  { id: 'firstDay', name: '打烊囉', desc: '甜點店營業完第一天', reward: 200, value: (s) => s.stats.daysClosed, target: 1 },
  { id: 'firstPuddingSale', name: '布丁出嫁', desc: '賣出一隻布丁', reward: 50, value: (s) => s.stats.puddingsSold, target: 1 },
  { id: 'pick100', name: '撿拾達人', desc: '累計撿 100 份', reward: 100, value: (s) => s.stats.picked, target: 100 },
  { id: 'births10', name: '大家庭', desc: '累計生 10 隻小布丁', reward: 150, value: (s) => s.stats.births, target: 10 },
  { id: 'zone2', name: '擴建', desc: '解鎖第二個櫥窗區', reward: 200, value: zonesUnlocked, target: 2 },
  { id: 'ingredients100', name: '原料批發商', desc: '累計賣 100 份原料', reward: 150, value: (s) => s.stats.ingredientsSold, target: 100 },
  { id: 'orders10', name: '預訂達人', desc: '交 10 張預訂單', reward: 400, value: (s) => s.stats.ordersDone, target: 10 },
  { id: 'baked50', name: '烘焙學徒', desc: '累計出爐 50 份甜點', reward: 400, value: (s) => s.stats.baked, target: 50 },
  { id: 'served100', name: '熟客滿門', desc: '招待 100 位客人', reward: 500, value: (s) => s.stats.served, target: 100 },
  { id: 'day500', name: '日進斗金', desc: '單日營收達 500', reward: 500, value: (s) => s.stats.bestDayRevenue, target: 500 },
  // 牛奶澡開局幾分鐘就會生出鮮奶酪與卡士達（D34 的配子偏移），所以「三種口味」「第一隻混種」
  // 是白送的——2026-09-23 量表實測兩條在第 1 分鐘就領走 1300 元、上層 1.4 分鐘就解鎖。
  // 門檻改成要真的去買風味澡盆才拿得到的量
  { id: 'species5', name: '五種口味', desc: '養過五種不同的布丁', reward: 500, value: (s) => s.speciesSeen.length, target: 5 },
  { id: 'hybrid3', name: '混種收藏家', desc: '養出三種不同的混種布丁', reward: 800, value: (s) => s.speciesSeen.filter((id) => !BASE_SPECIES_IDS.includes(id as AlleleId)).length, target: 3 },
  { id: 'week', name: '開店一週', desc: '甜點店營業滿 7 天', reward: 1500, value: (s) => s.stats.daysClosed, target: 7 },
  { id: 'baked500', name: '甜點大師', desc: '累計出爐 500 份甜點', reward: 3000, value: (s) => s.stats.baked, target: 500 },
];

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

export type AchievementStatus = 'locked' | 'claimable' | 'claimed';

export interface AchievementView {
  info: AchievementInfo;
  status: AchievementStatus;
  value: number;
}

export function findAchievement(id: string): AchievementInfo | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function achievementStatus(state: GameState, a: AchievementInfo): AchievementStatus {
  if (state.claimedAchievements.includes(a.id)) return 'claimed';
  return a.value(state) >= a.target ? 'claimable' : 'locked';
}

export function achievementList(state: GameState): AchievementView[] {
  return ACHIEVEMENTS.map((info) => ({ info, status: achievementStatus(state, info), value: Math.min(info.target, info.value(state)) }));
}

export function claimableCount(state: GameState): number {
  return ACHIEVEMENTS.filter((a) => achievementStatus(state, a) === 'claimable').length;
}

export type ClaimResult = { ok: true; reward: number } | { ok: false; error: string };

/** 領取：條件達成且沒領過才入帳。失敗時 state 不變 */
export function claimAchievement(state: GameState, id: string, emit: EventSink): ClaimResult {
  const a = findAchievement(id);
  if (!a) return { ok: false, error: '沒有這個成就' };
  const st = achievementStatus(state, a);
  if (st === 'claimed') return { ok: false, error: '已經領過了' };
  if (st === 'locked') return { ok: false, error: '還沒達成' };
  state.claimedAchievements.push(a.id);
  state.coins += a.reward;
  emit({ type: 'achievement', id: a.id, name: a.name, reward: a.reward });
  return { ok: true, reward: a.reward };
}
