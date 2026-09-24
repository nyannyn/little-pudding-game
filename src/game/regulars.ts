import type { DessertId } from './recipes';
import { SPECIES, type AlleleId, type SpeciesId } from './species';
import type { GameState } from './state';
import { clampStar, isStar, type Star } from './stock';

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
