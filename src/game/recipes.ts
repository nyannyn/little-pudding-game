import { BALANCE } from './balance';
import { LIQUIDS, SPECIES, SPECIES_IDS, type SpeciesId } from './species';
import type { GameState } from './state';

/**
 * 食譜制流水線（D56／D57／D58，2026-09-24 使用者要求「不是每個甜點都需要五個步驟，參考真實甜點食譜，
 * 一份甜點會需要多個原料」「機器也都要購買」「前期機器可以製作的甜點份數比較少」）。
 *
 * 一條 7 站的線，順序固定；每道甜點只走自己要的站，所以**每條路線都是 `STATION_IDS` 的子序列**
 * （單元測試守這條，路線順序錯了輸送帶就得倒著走）。
 */

export type StationId = 'stove' | 'crack' | 'mix' | 'mold' | 'bake' | 'chill' | 'decorate';
export const STATION_IDS: StationId[] = ['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'];

export interface StationInfo {
  id: StationId;
  /** 機器名（場景名牌、商店、菜單的「缺機器」） */
  name: string;
  /** 動作名（「烤箱正在烘烤」） */
  verb: string;
  /** 這一站做一盤要幾秒（遊戲秒） */
  sec: number;
  /** [買 Lv1, 升 Lv2, 升 Lv3] 的價錢 */
  prices: [number, number, number];
}

export const STATIONS: Record<StationId, StationInfo> = {
  stove: { id: 'stove', name: '爐台', verb: '加熱', sec: 10, prices: [40, 320, 1200] },
  crack: { id: 'crack', name: '打蛋機', verb: '打蛋', sec: 4, prices: [30, 240, 900] },
  mix: { id: 'mix', name: '攪拌機', verb: '攪拌', sec: 6, prices: [50, 400, 1500] },
  mold: { id: 'mold', name: '裝模機', verb: '裝模', sec: 5, prices: [60, 480, 1800] },
  bake: { id: 'bake', name: '烤箱', verb: '烘烤', sec: 45, prices: [150, 1200, 4500] },
  chill: { id: 'chill', name: '冷藏櫃', verb: '冷藏', sec: 40, prices: [180, 1440, 5400] },
  decorate: { id: 'decorate', name: '裝飾台', verb: '裝飾', sec: 6, prices: [100, 800, 3000] },
};

export const MAX_MACHINE_LEVEL = 3;
/** 機器等級 → 一盤幾份（索引＝等級；0＝沒買） */
export const MACHINE_PORTIONS = [0, 1, 2, 4] as const;
/** 機器等級 → 失敗率乘數 */
export const MACHINE_FAIL_MULT = [1, 1, 0.6, 0.3] as const;

// ── 基礎材料（D58）───────────────────────────────

export type PantryId = 'flour' | 'rice';
export const PANTRY_IDS: PantryId[] = ['flour', 'rice'];
export const PANTRY: Record<PantryId, { id: PantryId; name: string; unitPrice: number; autoRestock: boolean }> = {
  flour: { id: 'flour', name: '麵粉', unitPrice: 1, autoRestock: true },
  rice: { id: 'rice', name: '糯米粉', unitPrice: 2, autoRestock: false },
};

// ── 材料 ─────────────────────────────────────────

/** 一份甜點會用到的材料：蛋、牛乳（補貨的鮮牛乳）、基礎材料、物種原料 */
export type MaterialKey = 'egg' | 'milk' | PantryId | SpeciesId;

export function materialName(key: MaterialKey): string {
  if (key === 'egg') return '蛋';
  if (key === 'milk') return '牛乳';
  if (key === 'flour' || key === 'rice') return PANTRY[key].name;
  return SPECIES[key].ingredient;
}

/** 這份材料值多少（直接賣或直接買的價錢）：甜點售價從它推 */
export function materialPrice(key: MaterialKey): number {
  if (key === 'egg') return BALANCE.eggPrice;
  if (key === 'milk') return LIQUIDS.milk.unitPrice;
  if (key === 'flour' || key === 'rice') return PANTRY[key].unitPrice;
  return SPECIES[key].ingredientPrice;
}

export function materialHave(state: GameState, key: MaterialKey): number {
  if (key === 'egg') return state.eggs;
  if (key === 'milk') return state.stock.milk;
  if (key === 'flour' || key === 'rice') return state.pantry[key];
  return state.ingredients[key];
}

function materialTake(state: GameState, key: MaterialKey, n: number): void {
  if (key === 'egg') state.eggs -= n;
  else if (key === 'milk') state.stock.milk -= n;
  else if (key === 'flour' || key === 'rice') state.pantry[key] -= n;
  else state.ingredients[key] -= n;
}

// ── 食譜（D56）──────────────────────────────────

export interface Recipe {
  /** 甜點以物種為鍵（每個物種一道招牌甜點，名字在 `SPECIES[*].dessert`） */
  species: SpeciesId;
  route: StationId[];
  /** 每份用量 */
  materials: Partial<Record<MaterialKey, number>>;
  /** 每份失敗的機率（Lv1 機器） */
  failRate: number;
}

export const RECIPES: Record<SpeciesId, Recipe> = {
  caramel: { species: 'caramel', route: ['stove', 'crack', 'mix', 'mold', 'bake', 'decorate'], materials: { egg: 2, milk: 1, flour: 1, caramel: 1 }, failRate: 0.08 },
  panna: { species: 'panna', route: ['stove', 'mold', 'chill'], materials: { milk: 2, panna: 1 }, failRate: 0.03 },
  custard: { species: 'custard', route: ['stove', 'crack', 'mix', 'mold', 'bake', 'decorate'], materials: { egg: 2, flour: 1, custard: 1 }, failRate: 0.15 },
  matcha: { species: 'matcha', route: ['crack', 'mix', 'mold', 'bake', 'decorate'], materials: { egg: 2, flour: 1, milk: 1, matcha: 1 }, failRate: 0.1 },
  strawberry: { species: 'strawberry', route: ['crack', 'mix', 'mold', 'bake', 'chill', 'decorate'], materials: { egg: 1, flour: 1, milk: 1, strawberry: 1 }, failRate: 0.08 },
  hojicha: { species: 'hojicha', route: ['crack', 'mix', 'mold', 'bake'], materials: { egg: 2, flour: 1, hojicha: 1 }, failRate: 0.05 },
  brulee: { species: 'brulee', route: ['stove', 'crack', 'mix', 'mold', 'bake', 'chill', 'decorate'], materials: { egg: 2, milk: 1, brulee: 1, strawberry: 1 }, failRate: 0.12 },
  matchalatte: { species: 'matchalatte', route: ['crack', 'mix', 'mold', 'bake', 'decorate'], materials: { egg: 2, flour: 1, matchalatte: 1, panna: 1 }, failRate: 0.1 },
  berrymilk: { species: 'berrymilk', route: ['stove', 'mold', 'chill', 'decorate'], materials: { milk: 1, berrymilk: 1, panna: 1 }, failRate: 0.04 },
  sakura: { species: 'sakura', route: ['stove', 'mold', 'decorate'], materials: { rice: 1, sakura: 1, matcha: 1 }, failRate: 0.06 },
};

export function recipeMaterials(species: SpeciesId): [MaterialKey, number][] {
  return Object.entries(RECIPES[species].materials) as [MaterialKey, number][];
}

/** 這道甜點走完整條路線要幾秒（遊戲秒） */
export function recipeSeconds(species: SpeciesId): number {
  return RECIPES[species].route.reduce((n, id) => n + STATIONS[id].sec, 0);
}

/**
 * 甜點售價（D53 → D56）：這一份的材料直接賣／買的價錢 × `dessertMarkup`。
 * 從材料推，不另開價目表：調材料價時甜點跟著走，永遠不會「做成甜點反而虧」。
 */
export function dessertPrice(species: SpeciesId): number {
  const materials = recipeMaterials(species).reduce((n, [k, q]) => n + materialPrice(k) * q, 0);
  return Math.round(materials * BALANCE.dessertMarkup);
}

// ── 機器 ─────────────────────────────────────────

export function machineLevel(state: GameState, id: StationId): number {
  return state.bakery.machines[id];
}

/** 這道甜點路線上等級最低的那台（0＝有沒買的） */
export function lineLevel(state: GameState, species: SpeciesId): number {
  return Math.min(...RECIPES[species].route.map((id) => machineLevel(state, id)));
}

/** 這條線一盤**最多**做幾份＝路線上最低那台的份數（D57「前期機器可以製作的甜點份數比較少」） */
export function linePortions(state: GameState, species: SpeciesId): number {
  return MACHINE_PORTIONS[lineLevel(state, species)] ?? 0;
}

/** 手上的材料夠做幾份（最缺的那一種決定） */
export function affordablePortions(state: GameState, species: SpeciesId): number {
  return Math.min(...recipeMaterials(species).map(([k, per]) => Math.floor(materialHave(state, k) / per)));
}

/**
 * 這一盤實際做幾份＝min(機器上限, 材料夠做的份數)。**份數是上限不是門檻**：
 * 整條線升到 Lv3（一盤 4 份）之後，材料只夠 1 份也要開得了工——不然升級等於花錢買降級（混種原料本來就少）。
 */
export function batchQty(state: GameState, species: SpeciesId): number {
  return Math.min(linePortions(state, species), affordablePortions(state, species));
}

/** 目前機器下每份的失敗率 */
export function lineFailRate(state: GameState, species: SpeciesId): number {
  const lv = Math.max(1, lineLevel(state, species));
  return RECIPES[species].failRate * (MACHINE_FAIL_MULT[lv] ?? 1);
}

/** 把這道甜點還沒買的機器都買到 Lv1 要多少錢 */
export function lineCost(state: GameState, species: SpeciesId): number {
  return RECIPES[species].route.filter((id) => machineLevel(state, id) === 0).reduce((n, id) => n + STATIONS[id].prices[0], 0);
}

/** 有沒有湊齊至少一道甜點的整條線（D57：沒有就不來客、不出預訂單） */
export function anyLineReady(state: GameState): boolean {
  return SPECIES_IDS.some((id) => lineLevel(state, id) > 0);
}

// ── 開工檢查 ─────────────────────────────────────

export interface RecipeBlockers {
  /** 還沒買的機器（照路線順序） */
  machines: StationId[];
  /** 連 1 份都不夠的材料（份數是上限，只要夠 1 份就開得了工） */
  materials: { key: MaterialKey; need: number; have: number }[];
  /** 起始站上還有一盤 */
  busy: StationId | null;
}

export function recipeBlockers(state: GameState, species: SpeciesId): RecipeBlockers {
  const r = RECIPES[species];
  const machines = r.route.filter((id) => machineLevel(state, id) === 0);
  const materials = recipeMaterials(species)
    .map(([key, per]) => ({ key, need: per, have: materialHave(state, key) }))
    .filter((m) => m.have < m.need);
  const first = r.route[0]!;
  const busy = state.bakery.stations[first].batch ? first : null;
  return { machines, materials, busy };
}

export function canStartRecipe(state: GameState, species: SpeciesId): boolean {
  const b = recipeBlockers(state, species);
  return b.machines.length === 0 && b.materials.length === 0 && b.busy === null;
}

/**
 * 開工檢查的人話（菜單卡下方、按了沒動靜時的 toast 都用這份）。
 * `withCounts: false`：菜單卡用——持有數會一直變（收集手在撿），放進文字就得一直重建卡片，
 * 手指底下的按鈕會被換掉（D55 的教訓）；數字交給卡片上就地更新的材料晶片。
 */
export function blockerLines(b: RecipeBlockers, withCounts = true): string[] {
  const out: string[] = [];
  if (b.machines.length) out.push(`缺機器：${b.machines.map((id) => STATIONS[id].name).join('、')}`);
  if (b.materials.length) out.push(`缺原料：${b.materials.map((m) => (withCounts ? `${materialName(m.key)} ${m.have}/${m.need}` : materialName(m.key))).join('、')}`);
  if (b.busy) out.push(`${STATIONS[b.busy].name}上還有一盤，等它往下走`);
  return out;
}

/** 開工時一次扣齊整盤的材料（D56：不會做到一半缺料卡住） */
export function takeRecipeMaterials(state: GameState, species: SpeciesId, qty: number): void {
  for (const [key, per] of recipeMaterials(species)) materialTake(state, key, per * qty);
}
