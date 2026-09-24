import { BALANCE } from './balance';
import { fulfillOrder, type BakeryResult, type ShelfWant } from './bakery';
import { clockAt, dayClock, timeAt } from './clock';
import type { EventSink } from './events';
import { grantXp } from './level';
import { anyLineReady, dessertPrice, type DessertId } from './recipes';
import { intRange, range, type Rng } from './rng';
import { SPECIES, SPECIES_IDS, type AlleleId, type SpeciesId } from './species';
import type { GameState } from './state';
import { addStock, clampStar, isStar, lowestStar, takeStock, type Star } from './stock';

/**
 * 常客（D66／D67，2026-09-25 使用者選「會走進店裡的客人：常客、喜好、小故事」）。
 *
 * 這一檔放名冊（誰、吃什麼、起始最低星級、怎麼解鎖、介紹誰）與存檔形狀；
 * 到店結算、好感、特別訂單、禮物、升星藥等行為規則在下半部。故事文案在 `regularStories.ts`。
 */

export type RegularId = 'bear' | 'rabbit' | 'sheep' | 'frog' | 'owl' | 'fox' | 'pig' | 'penguin';
export const REGULAR_IDS: RegularId[] = ['bear', 'rabbit', 'sheep', 'frog', 'owl', 'fox', 'pig', 'penguin'];

/** 口味：「焦糖系」＝物種的兩個等位基因含 caramel（D66）；第二代常客只吃一種 */
export type Taste = { kind: 'allele'; allele: AlleleId } | { kind: 'species'; species: SpeciesId };

/** 怎麼解鎖：開張就在／擁有某系布丁＋店面人氣／某位常客 ♥8 介紹 */
export type UnlockRule =
  | { kind: 'open' }
  | { kind: 'allele'; allele: AlleleId; fame: number }
  | { kind: 'friend'; of: RegularId };

export interface RegularDef {
  id: RegularId;
  name: string;
  taste: Taste;
  /** 好感 0 時的最低星級；之後每 4 顆心 +1（`minStarFor`） */
  startStar: Star;
  unlock: UnlockRule;
  /** ♥8 介紹的朋友；第二代沒有（改送禮） */
  friend: RegularId | null;
  /** ♥8 沒有朋友可介紹時送什麼（第二代，故事草稿寫定的） */
  friendGift: 'tonic' | 'ingredients' | null;
}

export const REGULARS: Record<RegularId, RegularDef> = {
  bear: { id: 'bear', name: '熊先生', taste: { kind: 'allele', allele: 'caramel' }, startStar: 1, unlock: { kind: 'open' }, friend: 'owl', friendGift: null },
  rabbit: { id: 'rabbit', name: '兔子太太', taste: { kind: 'allele', allele: 'strawberry' }, startStar: 1, unlock: { kind: 'allele', allele: 'strawberry', fame: 3 }, friend: 'fox', friendGift: null },
  sheep: { id: 'sheep', name: '綿羊奶奶', taste: { kind: 'allele', allele: 'panna' }, startStar: 2, unlock: { kind: 'allele', allele: 'panna', fame: 5 }, friend: 'pig', friendGift: null },
  frog: { id: 'frog', name: '青蛙小弟', taste: { kind: 'allele', allele: 'matcha' }, startStar: 1, unlock: { kind: 'allele', allele: 'matcha', fame: 7 }, friend: 'penguin', friendGift: null },
  owl: { id: 'owl', name: '貓頭鷹教授', taste: { kind: 'species', species: 'hojicha' }, startStar: 3, unlock: { kind: 'friend', of: 'bear' }, friend: null, friendGift: 'tonic' },
  fox: { id: 'fox', name: '狐狸小姐', taste: { kind: 'species', species: 'brulee' }, startStar: 3, unlock: { kind: 'friend', of: 'rabbit' }, friend: null, friendGift: 'ingredients' },
  pig: { id: 'pig', name: '小豬廚師', taste: { kind: 'species', species: 'custard' }, startStar: 3, unlock: { kind: 'friend', of: 'sheep' }, friend: null, friendGift: 'tonic' },
  penguin: { id: 'penguin', name: '企鵝郵差', taste: { kind: 'species', species: 'sakura' }, startStar: 3, unlock: { kind: 'friend', of: 'frog' }, friend: null, friendGift: 'ingredients' },
};

export const MAX_HEARTS = 10;

/** 上一次來店的結果（名冊與「你不在的時候」卡都從這裡推導，不發逐條 toast——D39） */
export interface VisitResult {
  /** 來店的遊戲時間 */
  at: number;
  /** 工坊第幾天 */
  day: number;
  bought: boolean;
  dessert: DessertId | null;
  star: Star | null;
  coins: number;
  /** 這次送了什麼禮（沒有就 null） */
  gift: 'tonic' | 'ingredients' | null;
}

export interface RegularState {
  unlocked: boolean;
  /** 0–10 */
  hearts: number;
  /** 下一次來店的遊戲時間；0＝還沒排（沒解鎖） */
  nextVisitAt: number;
  lastResult: VisitResult | null;
  /** 已經看過幾章故事（0–3） */
  storySeen: number;
  /** 來過幾次（買到沒買到都算） */
  visits: number;
}

export function emptyRegular(): RegularState {
  return { unlocked: false, hearts: 0, nextVisitAt: 0, lastResult: null, storySeen: 0, visits: 0 };
}

export function createRegulars(): Record<RegularId, RegularState> {
  const out = {} as Record<RegularId, RegularState>;
  for (const id of REGULAR_IDS) out[id] = emptyRegular();
  return out;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function restoreResult(v: unknown): VisitResult | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<VisitResult>;
  return {
    at: num(r.at, 0),
    day: Math.max(1, Math.floor(num(r.day, 1))),
    bought: r.bought === true,
    dessert: typeof r.dessert === 'string' && r.dessert in SPECIES ? (r.dessert as DessertId) : null,
    star: isStar(r.star) ? r.star : null,
    coins: Math.max(0, num(r.coins, 0)),
    gift: r.gift === 'tonic' || r.gift === 'ingredients' ? r.gift : null,
  };
}

/** 從存檔還原名冊（v10 以前沒有這欄 → 全部未解鎖，解鎖條件由 `checkUnlocks` 當場判一次） */
export function restoreRegulars(raw: unknown): Record<RegularId, RegularState> {
  const out = createRegulars();
  if (typeof raw !== 'object' || raw === null) return out;
  const src = raw as Record<string, Partial<RegularState> | undefined>;
  for (const id of REGULAR_IDS) {
    const r = src[id];
    if (!r || typeof r !== 'object') continue;
    out[id] = {
      unlocked: r.unlocked === true,
      hearts: Math.min(MAX_HEARTS, Math.max(0, Math.floor(num(r.hearts, 0)))),
      nextVisitAt: Math.max(0, num(r.nextVisitAt, 0)),
      lastResult: restoreResult(r.lastResult),
      storySeen: Math.min(3, Math.max(0, Math.floor(num(r.storySeen, 0)))),
      visits: Math.max(0, Math.floor(num(r.visits, 0))),
    };
  }
  return out;
}

/** 最低星級＝起始星級＋floor(好感 ÷ 4)，上限 ★5（D66：越熟越挑） */
export function minStarFor(id: RegularId, hearts: number): Star {
  return clampStar(REGULARS[id].startStar + Math.floor(Math.max(0, hearts) / 4));
}

/** 這隻（這個物種）合不合這位常客的口味 */
export function tasteMatches(taste: Taste, species: SpeciesId): boolean {
  if (taste.kind === 'species') return taste.species === species;
  return SPECIES[species].alleles.includes(taste.allele);
}

export function tasteText(taste: Taste): string {
  if (taste.kind === 'species') return `只吃${SPECIES[taste.species].dessert}`;
  return `${SPECIES[taste.allele].shortName}系`;
}

/** 某個狀態下 `GameState` 裡有沒有帶這個等位基因的布丁 */
export function ownsAllele(state: GameState, allele: AlleleId): boolean {
  return state.puddings.some((p) => p.genes.includes(allele));
}

// ─────────────────────────────────────────────────────────────
// 行為規則（D67，2026-09-25）：解鎖、行程、到店結算、好感、特別訂單、禮物。
// ─────────────────────────────────────────────────────────────

export const REGULAR_BALANCE = {
  /** 來店間隔（營業日）；`visitJitterDays` 是 ± 範圍 */
  visitEveryDays: 8,
  visitJitterDays: 1,
  /** 常客買東西付星級價的幾倍（比散客大方） */
  tip: 1.2,
  heartsPerBuy: 1,
  heartsPerOrder: 2,
  /** ♥6 起每次買到送禮的機率 */
  giftChance: 0.3,
  orderQtyMin: 5,
  orderQtyMax: 20,
  orderDays: 3,
  orderRewardMult: 2,
  giftIngredients: 3,
} as const;

/** 這位常客的口味對應的原料物種（送禮／特別訂單找不到養的物種時用）：
 *  allele 口味＝那個等位基因的純種；species 口味＝它自己 */
function tasteIngredientSpecies(taste: Taste): SpeciesId {
  return taste.kind === 'species' ? taste.species : taste.allele;
}

/** 口味符合的甜點 id 清單（菜單、名冊卡都要用） */
export function tasteDesserts(taste: Taste): DessertId[] {
  return SPECIES_IDS.filter((id) => tasteMatches(taste, id));
}

/**
 * 解鎖檢查（D66）：`open`／`allele` 兩種規則在這裡判；`friend`（♥8 介紹）
 * 由 `addHearts` 在跨過門檻那一刻處理，不在這裡判（不然每個 tick 都會白跑一次比對）。
 * 已經解鎖的不重排，回傳這次新解鎖的 id（給 UI 決定要不要特別演出）。
 */
export function checkUnlocks(state: GameState, emit: EventSink): RegularId[] {
  const unlocked: RegularId[] = [];
  for (const id of REGULAR_IDS) {
    const reg = state.regulars[id];
    if (reg.unlocked) continue;
    const rule = REGULARS[id].unlock;
    let pass = false;
    if (rule.kind === 'open') pass = anyLineReady(state);
    else if (rule.kind === 'allele') pass = ownsAllele(state, rule.allele) && state.bakery.fame >= rule.fame;
    if (!pass) continue;
    reg.unlocked = true;
    scheduleFirstVisit(state, id);
    emit({ type: 'regularUnlocked', id });
    unlocked.push(id);
  }
  return unlocked;
}

/**
 * 第一次來店：**確定性**、不吃亂數——解鎖那一刻馬上就能在名冊上看到「明天幾點來」，
 * 不必等一次 tick 才知道（也讓「開局就在」的熊先生一定排在同一個時間，方便測試）。
 * 四位一組錯開 2.5 小時，避免全部常客擠在開店那一刻。
 */
export function scheduleFirstVisit(state: GameState, id: RegularId): void {
  const day = dayClock(state).day + 1;
  const hour = BALANCE.bakery.openHour + 2 + (REGULAR_IDS.indexOf(id) % 4) * 2.5;
  state.regulars[id].nextVisitAt = timeAt(state, day, hour);
}

/** 排下一次來店：從「今天」起 `visitEveryDays ± visitJitterDays` 天，時間在營業時段內均勻 */
export function scheduleNextVisit(state: GameState, id: RegularId, rng: Rng): void {
  const today = dayClock(state).day;
  const days = REGULAR_BALANCE.visitEveryDays + intRange(rng, -REGULAR_BALANCE.visitJitterDays, REGULAR_BALANCE.visitJitterDays);
  const hour = range(rng, BALANCE.bakery.openHour + 0.5, BALANCE.bakery.closeHour - 0.5);
  state.regulars[id].nextVisitAt = timeAt(state, today + days, hour);
}

/** 展示架上符合這位常客口味、星級夠格的甜點裡挑最低星那份（同星按 `SPECIES_IDS` 順序） */
function bestShelfPick(state: GameState, id: RegularId): { species: DessertId; star: Star } | null {
  const minStar = minStarFor(id, state.regulars[id].hearts);
  let best: { species: DessertId; star: Star } | null = null;
  for (const species of SPECIES_IDS) {
    if (!tasteMatches(REGULARS[id].taste, species)) continue;
    const star = lowestStar(state, 'shelf', species, minStar);
    if (star === null) continue;
    if (best === null || star < best.star) best = { species, star };
  }
  return best;
}

/** 送 3 份口味內、當下最低星級的原料（♥6 買到禮物與 ♥8 無朋友時的第二代禮物共用） */
function giveGiftIngredients(state: GameState, id: RegularId): void {
  const star = minStarFor(id, state.regulars[id].hearts);
  addStock(state, 'ingredients', tasteIngredientSpecies(REGULARS[id].taste), star, REGULAR_BALANCE.giftIngredients);
}

/** 特別訂單挑的物種：口味符合裡玩家目前有養的優先（`SPECIES_IDS` 順序第一個），都沒有就口味的純種 */
function orderSpeciesFor(state: GameState, taste: Taste): SpeciesId {
  const candidates = SPECIES_IDS.filter((id) => tasteMatches(taste, id));
  const owned = candidates.find((id) => state.puddings.some((p) => p.species === id));
  return owned ?? tasteIngredientSpecies(taste);
}

/**
 * 一位常客到店（D66／D67）：架上有符合口味＋星級夠的就買 1 份、付星級價 × tip、好感 +1；
 * 沒有就好感不變、失望離開。買到之後好感 ≥6 有機會送禮；不管買沒買，好感 ≥4 且沒有進行中的
 * 特別訂單就開一張。**只發一個 `regularVisit` 事件**（D39 的教訓：離線一次會跑出幾十筆逐條 toast）。
 */
function visit(state: GameState, id: RegularId, rng: Rng, emit: EventSink): void {
  const reg = state.regulars[id];
  reg.visits++;
  const pick = bestShelfPick(state, id);

  let bought = false;
  let dessert: DessertId | null = null;
  let star: Star | null = null;
  let coins = 0;
  let gift: 'tonic' | 'ingredients' | null = null;

  if (pick) {
    takeStock(state, 'shelf', pick.species, pick.star, 1);
    coins = Math.round(dessertPrice(pick.species, pick.star) * REGULAR_BALANCE.tip);
    state.coins += coins;
    state.stats.sold++;
    state.stats.regularsServed++;
    state.bakery.today.revenue += coins;
    grantXp(state, BALANCE.xp.sellDessert, emit);
    addHearts(state, id, REGULAR_BALANCE.heartsPerBuy, emit);
    bought = true;
    dessert = pick.species;
    star = pick.star;

    if (reg.hearts >= 6 && rng.next() < REGULAR_BALANCE.giftChance) {
      if (rng.next() < 0.5) {
        state.items.starTonic++;
        gift = 'tonic';
      } else {
        giveGiftIngredients(state, id);
        gift = 'ingredients';
      }
    }
  }

  reg.lastResult = { at: state.time, day: dayClock(state).day, bought, dessert, star, coins, gift };
  emit({ type: 'regularVisit', id, bought, dessert, star, coins, hearts: reg.hearts, gift });

  const hasActiveOrder = state.orders.some((o) => o.regularId === id && o.expiresAt > state.time);
  if (reg.hearts >= 4 && !hasActiveOrder) {
    const species = orderSpeciesFor(state, REGULARS[id].taste);
    const qty = intRange(rng, REGULAR_BALANCE.orderQtyMin, REGULAR_BALANCE.orderQtyMax);
    const orderStar = minStarFor(id, reg.hearts);
    const price = Math.round(dessertPrice(species, orderStar) * qty * REGULAR_BALANCE.orderRewardMult);
    const orderId = `o${state.nextId++}`;
    state.orders.push({
      id: orderId,
      species,
      qty,
      price,
      createdAt: state.time,
      expiresAt: state.time + REGULAR_BALANCE.orderDays * BALANCE.bakery.dayLengthSec,
      regularId: id,
      star: orderStar,
    });
    emit({ type: 'regularOrder', id, orderId });
  }
}

/**
 * 每個 tick：先判有沒有新解鎖，再讓到點的常客逐一到店、排下一次。
 * `sim.ts` 之後會在自己的 tick 裡呼叫這個函式（合流時接，不在這個 worktree 做）。
 */
export function tickRegulars(state: GameState, rng: Rng, emit: EventSink): void {
  checkUnlocks(state, emit);
  for (const id of REGULAR_IDS) {
    const reg = state.regulars[id];
    if (!reg.unlocked || reg.nextVisitAt <= 0 || state.time < reg.nextVisitAt) continue;
    visit(state, id, rng, emit);
    scheduleNextVisit(state, id, rng);
  }
}

/**
 * 好感夾在 0–10；跨過門檻時 `reached` 帶這次跨過的最高一格（2/4/6/8/10），沒跨過就 null。
 * ♥8 的介紹／送禮只在**跨過那一刻**觸發一次，不是「≥8 就一直觸發」。
 */
export function addHearts(state: GameState, id: RegularId, n: number, emit: EventSink): void {
  const reg = state.regulars[id];
  const before = reg.hearts;
  reg.hearts = Math.min(MAX_HEARTS, Math.max(0, before + n));
  const after = reg.hearts;

  const THRESHOLDS = [2, 4, 6, 8, 10];
  let reached: number | null = null;
  for (const t of THRESHOLDS) if (before < t && after >= t) reached = t;

  if (before < 8 && after >= 8) {
    const def = REGULARS[id];
    if (def.friend) {
      const friendState = state.regulars[def.friend];
      if (!friendState.unlocked) {
        friendState.unlocked = true;
        scheduleFirstVisit(state, def.friend);
        emit({ type: 'regularUnlocked', id: def.friend });
      }
    } else if (def.friendGift === 'tonic') {
      state.items.starTonic++;
    } else if (def.friendGift === 'ingredients') {
      giveGiftIngredients(state, id);
    }
  }

  emit({ type: 'hearts', id, hearts: after, reached });
}

/** 交一張常客的特別訂單：跟一般訂單走同一條路（`bakery.fulfillOrder`），成功再補 ♥ */
export function deliverOrder(state: GameState, orderId: string, emit: EventSink): BakeryResult {
  const order = state.orders.find((o) => o.id === orderId);
  const regularId = order?.regularId;
  const result = fulfillOrder(state, orderId, emit);
  if (result.ok && regularId) addHearts(state, regularId, REGULAR_BALANCE.heartsPerOrder, emit);
  return result;
}

/**
 * 今天還沒來、已解鎖的常客要店員替他保留一份（D70：先擺一份符合條件的，別讓散客搶先買走）。
 * 只看「今天」：明天才來的不急著現在保留架位。
 */
export function regularWants(state: GameState): ShelfWant[] {
  const today = dayClock(state).day;
  const out: ShelfWant[] = [];
  for (const id of REGULAR_IDS) {
    const reg = state.regulars[id];
    if (!reg.unlocked || reg.nextVisitAt < state.time) continue;
    if (clockAt(state, reg.nextVisitAt).day !== today) continue;
    out.push({ accepts: tasteDesserts(REGULARS[id].taste), minStar: minStarFor(id, reg.hearts) });
  }
  return out;
}

/** 已看過幾章故事：♥2／8／10 各解鎖一章 */
export function storyChapters(hearts: number): number {
  if (hearts >= 10) return 3;
  if (hearts >= 8) return 2;
  if (hearts >= 2) return 1;
  return 0;
}

/** 「你不在的時候」卡：純從 state 推導，不發逐條 toast（D39） */
export function awaySummary(state: GameState, since: number): { id: RegularId; result: VisitResult }[] {
  const out: { id: RegularId; result: VisitResult }[] = [];
  for (const id of REGULAR_IDS) {
    const r = state.regulars[id].lastResult;
    if (r && r.at > since) out.push({ id, result: r });
  }
  return out;
}
