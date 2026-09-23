import type { EventSink } from './events';
import { BASE_SPECIES_IDS, type AlleleId } from './species';
import type { GameState } from './state';

/**
 * 成就（D54，2026-09-23 使用者：「增加成就系統，讓一開始遊玩獲得初始資金，因為甜點製作
 * 自動化系統、加速、店員僱員都應該很貴」；D55 同日改版：分類、系列星等、隱藏成就）。
 *
 * 條件**只讀單調遞增的欄位**（`stats` 的累計次數、`speciesSeen`、`bestDayRevenue`、已解鎖分區數）。
 * 用 `coins` 或「現在養幾隻」判定的話，花掉／賣掉就會「失去」成就，而且領過的獎金會跟條件對不上。
 * 達成不會自動入帳，要玩家按「領取」——領的那一下才是回饋，自動入帳玩家根本不會注意到錢從哪來。
 *
 * 前七條（撿、賣、泡澡、生寶寶、出爐、第一位客人、第一天打烊）約前 15 分鐘就拿得到，
 * 合計 640 元＝開局資金（`npm run pacing` 的 achievements 情境量這個數）。
 * 老玩家的舊 stats 算數：他們在舊規則下確實撿過、泡過、生過。
 *
 * **id 一個都不能刪或改名**：`migrate()` 拿 `ACHIEVEMENT_IDS` 過濾 `claimedAchievements`，
 * id 消失＝老玩家的領取紀錄被靜默丟掉，而且「沒領過」又能再領一次。名字、說明、分類都可以改。
 */

export type AchievementCategory = 'farm' | 'family' | 'bakery' | 'shop';

export const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; label: string }[] = [
  { id: 'farm', label: '牧場日常' },
  { id: 'family', label: '布丁家族' },
  { id: 'bakery', label: '甜點工坊' },
  { id: 'shop', label: '生意經' },
];

export interface AchievementInfo {
  id: string;
  name: string;
  desc: string;
  reward: number;
  /** 目前進度值（單調遞增的來源） */
  value: (s: GameState) => number;
  target: number;
  category: AchievementCategory;
  /**
   * 同一種條件的成就串成一個系列（撿 1 → 100 → 1000），畫面上一列只顯示目前那一階。
   * 系列內的階數＝在 `ACHIEVEMENTS` 裡出現的先後，target 必須遞增。
   */
  series: string;
  /** 隱藏成就：達成前名字顯示「？？？」、說明換成 `hint` */
  hidden?: boolean;
  hint?: string;
}

const zonesUnlocked = (s: GameState) => s.zones.filter((z) => z.unlocked).length;
const hybridsSeen = (s: GameState) => s.speciesSeen.filter((id) => !BASE_SPECIES_IDS.includes(id as AlleleId)).length;

// 早期拿得到的新成就（泡 100 次澡、第一張預訂單、第三區、第一次突變）獎勵刻意壓低：
// 開局資金由前七條決定，再多塞就是 D54 那次「上層 1.4 分鐘就解鎖」的翻版
export const ACHIEVEMENTS: AchievementInfo[] = [
  // ── 牧場日常 ──
  { id: 'firstPick', category: 'farm', series: 'pick', name: '撿到寶了', desc: '撿起布丁掉的第一份東西', reward: 30, value: (s) => s.stats.picked, target: 1 },
  { id: 'pick100', category: 'farm', series: 'pick', name: '彎腰運動', desc: '累計撿 100 份', reward: 100, value: (s) => s.stats.picked, target: 100 },
  { id: 'pick1000', category: 'farm', series: 'pick', name: '撿拾永動機', desc: '累計撿 1000 份，腰還好嗎', reward: 500, value: (s) => s.stats.picked, target: 1000 },
  { id: 'firstBath', category: 'farm', series: 'bath', name: '第一次泡湯', desc: '布丁泡完一次澡', reward: 30, value: (s) => s.stats.baths, target: 1 },
  { id: 'baths100', category: 'farm', series: 'bath', name: '溫泉常客', desc: '累計泡 100 次澡', reward: 60, value: (s) => s.stats.baths, target: 100 },
  { id: 'baths1000', category: 'farm', series: 'bath', name: '泡到皺皺', desc: '累計泡 1000 次澡', reward: 400, value: (s) => s.stats.baths, target: 1000 },
  { id: 'zone2', category: 'farm', series: 'zone', name: '換大房子', desc: '解鎖第二個櫥窗區', reward: 200, value: zonesUnlocked, target: 2 },
  { id: 'zone3', category: 'farm', series: 'zone', name: '樓上樓下', desc: '解鎖第三個櫥窗區', reward: 250, value: zonesUnlocked, target: 3 },
  { id: 'zone4', category: 'farm', series: 'zone', name: '布丁社區', desc: '解鎖四個櫥窗區', reward: 600, value: zonesUnlocked, target: 4 },

  // ── 布丁家族 ──
  { id: 'firstBirth', category: 'family', series: 'birth', name: '呱呱落地', desc: '泡牛乳澡生出第一隻小布丁', reward: 80, value: (s) => s.stats.births, target: 1 },
  { id: 'births10', category: 'family', series: 'birth', name: '一窩小布丁', desc: '累計生 10 隻小布丁', reward: 150, value: (s) => s.stats.births, target: 10 },
  { id: 'births100', category: 'family', series: 'birth', name: '布丁托兒所', desc: '累計生 100 隻小布丁', reward: 500, value: (s) => s.stats.births, target: 100 },
  // 牛奶澡開局幾分鐘就會生出鮮奶酪與卡士達（D34 的配子偏移），所以「三種口味」「第一隻混種」
  // 是白送的——2026-09-23 量表實測兩條在第 1 分鐘就領走 1300 元、上層 1.4 分鐘就解鎖。
  // 門檻改成要真的去買風味澡盆才拿得到的量
  { id: 'species5', category: 'family', series: 'species', name: '五味俱全', desc: '養過 5 種不同的布丁', reward: 500, value: (s) => s.speciesSeen.length, target: 5 },
  { id: 'species10', category: 'family', series: 'species', name: '布丁圖鑑全開', desc: '10 種布丁全都養過', reward: 2000, value: (s) => s.speciesSeen.length, target: 10 },
  { id: 'hybrid3', category: 'family', series: 'hybrid', name: '混血收藏家', desc: '養出 3 種不同的混種布丁', reward: 800, value: hybridsSeen, target: 3 },
  { id: 'firstMutation', category: 'family', series: 'mutation', name: '咦？變色了', desc: '布丁泡完澡突變成別的口味', reward: 50, value: (s) => s.stats.mutations, target: 1, hidden: true, hint: '泡著泡著，好像有哪裡不一樣……' },
  { id: 'firstPuddingSale', category: 'family', series: 'puddingSale', name: '嫁出去了', desc: '賣出第一隻布丁', reward: 50, value: (s) => s.stats.puddingsSold, target: 1 },
  { id: 'puddingsSold10', category: 'family', series: 'puddingSale', name: '金牌媒人', desc: '賣出 10 隻布丁', reward: 200, value: (s) => s.stats.puddingsSold, target: 10 },

  // ── 甜點工坊 ──
  { id: 'firstBake', category: 'bakery', series: 'bake', name: '第一盤出爐', desc: '在甜點工坊做完一盤甜點', reward: 150, value: (s) => s.stats.baked, target: 1 },
  { id: 'baked50', category: 'bakery', series: 'bake', name: '烘焙學徒', desc: '累計出爐 50 份甜點', reward: 400, value: (s) => s.stats.baked, target: 50 },
  { id: 'baked500', category: 'bakery', series: 'bake', name: '甜點大師', desc: '累計出爐 500 份甜點', reward: 3000, value: (s) => s.stats.baked, target: 500 },
  { id: 'firstCustomer', category: 'bakery', series: 'served', name: '開市大吉', desc: '展示架上的甜點被買走', reward: 100, value: (s) => s.stats.served, target: 1 },
  { id: 'served100', category: 'bakery', series: 'served', name: '熟客滿門', desc: '招待 100 位客人', reward: 500, value: (s) => s.stats.served, target: 100 },
  { id: 'served1000', category: 'bakery', series: 'served', name: '排隊名店', desc: '招待 1000 位客人', reward: 2000, value: (s) => s.stats.served, target: 1000 },
  { id: 'firstDay', category: 'bakery', series: 'day', name: '打烊囉', desc: '甜點店營業完第一天', reward: 200, value: (s) => s.stats.daysClosed, target: 1 },
  { id: 'week', category: 'bakery', series: 'day', name: '開店一週', desc: '甜點店營業滿 7 天', reward: 1500, value: (s) => s.stats.daysClosed, target: 7 },
  { id: 'day30', category: 'bakery', series: 'day', name: '開店滿月', desc: '甜點店營業滿 30 天', reward: 5000, value: (s) => s.stats.daysClosed, target: 30 },
  { id: 'missed50', category: 'bakery', series: 'missed', name: '門可羅雀', desc: '讓 50 位客人撲空（架上要記得補貨啊）', reward: 50, value: (s) => s.stats.missed, target: 50, hidden: true, hint: '架子空空的時候，客人會……' },

  // ── 生意經 ──
  { id: 'firstSale', category: 'shop', series: 'ingredient', name: '開張第一筆', desc: '把原料賣給商店', reward: 50, value: (s) => s.stats.ingredientsSold, target: 1 },
  { id: 'ingredients100', category: 'shop', series: 'ingredient', name: '原料批發商', desc: '累計賣 100 份原料', reward: 150, value: (s) => s.stats.ingredientsSold, target: 100 },
  { id: 'ingredients1000', category: 'shop', series: 'ingredient', name: '原料大亨', desc: '累計賣 1000 份原料', reward: 600, value: (s) => s.stats.ingredientsSold, target: 1000 },
  { id: 'firstOrder', category: 'shop', series: 'order', name: '使命必達', desc: '交出第一張預訂單', reward: 60, value: (s) => s.stats.ordersDone, target: 1 },
  { id: 'orders10', category: 'shop', series: 'order', name: '預訂達人', desc: '交 10 張預訂單', reward: 400, value: (s) => s.stats.ordersDone, target: 10 },
  { id: 'orders50', category: 'shop', series: 'order', name: '預訂之王', desc: '交 50 張預訂單', reward: 1500, value: (s) => s.stats.ordersDone, target: 50 },
  { id: 'day500', category: 'shop', series: 'bestDay', name: '日進斗金', desc: '單日營收達 500', reward: 500, value: (s) => s.stats.bestDayRevenue, target: 500 },
  { id: 'day2000', category: 'shop', series: 'bestDay', name: '財源滾滾', desc: '單日營收達 2000', reward: 1500, value: (s) => s.stats.bestDayRevenue, target: 2000 },
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

/** 一個系列在畫面上的樣子：只顯示「目前那一階」＝第一個還沒領的；全部領完就停在最後一階 */
export interface SeriesView {
  series: string;
  category: AchievementCategory;
  tiers: AchievementInfo[];
  /** 目前那一階在 `tiers` 裡的位置 */
  tier: number;
  current: AchievementInfo;
  /** 目前那一階的狀態；全系列領完＝'claimed' */
  status: AchievementStatus;
  /** 目前那一階的進度（封頂在 target） */
  value: number;
  /** 已領幾階（星星數） */
  claimed: number;
  /** 還藏著：隱藏成就且目前那一階還沒達成 */
  concealed: boolean;
}

export function seriesList(state: GameState, category?: AchievementCategory): SeriesView[] {
  const groups = new Map<string, AchievementInfo[]>();
  for (const a of ACHIEVEMENTS) {
    if (category && a.category !== category) continue;
    const g = groups.get(a.series);
    if (g) g.push(a);
    else groups.set(a.series, [a]);
  }
  return [...groups.entries()].map(([series, tiers]) => {
    const claimed = tiers.filter((a) => state.claimedAchievements.includes(a.id)).length;
    const idx = tiers.findIndex((a) => !state.claimedAchievements.includes(a.id));
    const tier = idx === -1 ? tiers.length - 1 : idx;
    const current = tiers[tier]!;
    const status = achievementStatus(state, current);
    return {
      series,
      category: current.category,
      tiers,
      tier,
      current,
      status,
      value: Math.min(current.target, current.value(state)),
      claimed,
      concealed: !!current.hidden && status === 'locked',
    };
  });
}

export function categoryClaimable(state: GameState, category: AchievementCategory): number {
  return ACHIEVEMENTS.filter((a) => a.category === category && achievementStatus(state, a) === 'claimable').length;
}

/** 已領過的成就合計領了多少焦糖幣（總覽列用） */
export function claimedRewardTotal(state: GameState): number {
  return ACHIEVEMENTS.filter((a) => state.claimedAchievements.includes(a.id)).reduce((n, a) => n + a.reward, 0);
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

/**
 * 全部領取：逐條走 `claimAchievement`（同一條守衛），但只發一個彙總事件——
 * 一次領七條就跳七則 toast，玩家看不完、也把別的通知擠掉
 */
export function claimAllAchievements(state: GameState, emit: EventSink): { count: number; reward: number } {
  let count = 0;
  let reward = 0;
  const quiet: EventSink = () => {};
  for (const a of ACHIEVEMENTS) {
    const r = claimAchievement(state, a.id, quiet);
    if (r.ok) {
      count++;
      reward += r.reward;
    }
  }
  if (count > 0) emit({ type: 'achievementsClaimed', count, reward });
  return { count, reward };
}
