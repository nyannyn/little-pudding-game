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
  /** Lv1 這一站做一盤要幾秒（遊戲秒）；每升一級 ×`MACHINE_CURVE.sec`（`machineSeconds`） */
  sec: number;
  /** 買 Lv1 的價錢；升級價從它照公比推（`machinePrice`） */
  price: number;
}

export const STATIONS: Record<StationId, StationInfo> = {
  stove: { id: 'stove', name: '爐台', verb: '加熱', sec: 10, price: 20 },
  crack: { id: 'crack', name: '打蛋機', verb: '打蛋', sec: 4, price: 20 },
  mix: { id: 'mix', name: '攪拌機', verb: '攪拌', sec: 6, price: 30 },
  mold: { id: 'mold', name: '裝模機', verb: '裝模', sec: 5, price: 40 },
  bake: { id: 'bake', name: '烤箱', verb: '烘烤', sec: 45, price: 80 },
  chill: { id: 'chill', name: '冷藏櫃', verb: '冷藏', sec: 40, price: 150 },
  decorate: { id: 'decorate', name: '裝飾台', verb: '裝飾', sec: 6, price: 60 },
};

/**
 * 機器等級曲線（D61，2026-09-24 使用者「每次升級應該都要同級距且同等困難」「規劃一個可以玩一個月的遊戲」）。
 * **每一級同級距**：秒數、失敗率是等比、一盤上限每級 ＋1，所以相鄰兩級的差別永遠一樣大——
 * 不寫成逐級查表，查表的每一格都是一個可以單獨寫錯的地方（D57 的 1/2/4 就是查表）。
 * **每次升級同等困難**：升級價＝`upgradeBase` × `upgradeCurve(等級)`，七台與人氣同價。收入不是固定的，價錢要跟著收入曲線走，
 * 每次升級才會隔差不多的遊玩時間；純等比（每級 ×1.38）實測第一天就升掉 75 次、第 8 天起一次都沒有
 * （`npm run pacing` 月玩家，2026-09-24）。
 * 每 `MACHINE_TIER_SIZE` 級一階（鐵→銅→銀→金），跨階換配色。
 */
export const MAX_MACHINE_LEVEL = 20;
export const MACHINE_TIER_SIZE = 5;
export const MACHINE_TIER_NAMES = ['鐵', '銅', '銀', '金'] as const;
export const MACHINE_CURVE = {
  /** 每升一級這一站的秒數乘上它（Lv20＝0.96^19≈46%） */
  sec: 0.96,
  /** 每升一級失敗率乘上它 */
  fail: 0.7,
  /**
   * 升級價＝`upgradeBase` × `upgradeCurve(等級)`，**七台機器與店面人氣共用同一組價錢**：
   * 「每次升級同等困難」——烤箱 Lv7→8 跟爐台 Lv7→8 一樣貴。各台只有「買 Lv1」的價錢不同（`STATIONS[*].price`）。
   * 各台各自一組價錢時，最貴那台（冷藏櫃 150）會一路被留到最後、月底一天只升得到一兩次（月玩家量表實測）。
   */
  upgradeBase: 60,
  /**
   * 升級價曲線（見 `upgradeCurve`）：最高倍數、半高在第幾級、陡度。
   * 月玩家量表校準（2026-09-24，每天 3×15 分鐘、30 天，seed 7）：每 5 天升級次數 40／22／19／19／19／20，
   * 第 30 天機器 Lv16–19、人氣 Lv16（都還沒滿、都 ≥ Lv15）；第 6 天起每天穩定 3–5 次、約 15 分鐘實玩一次。
   */
  priceMax: 1300,
  priceHalf: 5,
  pricePow: 3,
} as const;

/** 等級 → 一盤最多幾份（0＝沒買）：每級 ＋1 */
export function machinePortions(lv: number): number {
  return Math.max(0, Math.min(MAX_MACHINE_LEVEL, Math.floor(lv)));
}

/** 這台機器在這個等級做一盤要幾秒（沒買的當 Lv1 算：菜單要能先講「買了之後要多久」） */
export function machineSeconds(id: StationId, lv: number): number {
  return STATIONS[id].sec * MACHINE_CURVE.sec ** (Math.max(1, lv) - 1);
}

/** 等級 → 失敗率乘數 */
export function machineFailMult(lv: number): number {
  return MACHINE_CURVE.fail ** (Math.max(1, lv) - 1);
}

/** 從 `lv` 升到 `lv + 1` 要多少錢（`lv`＝0 就是買 Lv1）；滿級回 null */
export function machinePrice(id: StationId, lv: number): number | null {
  if (lv >= MAX_MACHINE_LEVEL) return null;
  return lv <= 0 ? STATIONS[id].price : upgradePrice(lv);
}

/** 從 `lv` 升到 `lv + 1` 的價錢（lv ≥ 1；機器與店面人氣共用，D61） */
export function upgradePrice(lv: number): number {
  return nicePrice(MACHINE_CURVE.upgradeBase * upgradeCurve(lv));
}

/**
 * 升級價相對於 Lv1 價的倍數（`lv`＝0 是 1：買 Lv1 就是原價）。S 形：前幾級漲得快、之後趨近 `priceMax`。
 * 形狀照收入走（月玩家量表，2026-09-24）：頭三四天農場還在長、收入一路往上，之後農場養滿、收入持平——
 * 價錢跟著「先陡後平」，每次升級才會隔差不多的遊玩時間。純等比或 lv²×1.1^lv 在收入持平之後越升越久。
 */
export function upgradeCurve(lv: number): number {
  if (lv <= 0) return 1;
  const { priceMax, priceHalf, pricePow } = MACHINE_CURVE;
  const x = lv ** pricePow;
  return (priceMax * x) / (x + priceHalf ** pricePow);
}

/** 第幾階（1＝鐵…4＝金；沒買 0） */
export function machineTier(lv: number): number {
  return lv <= 0 ? 0 : Math.ceil(Math.min(lv, MAX_MACHINE_LEVEL) / MACHINE_TIER_SIZE);
}

/**
 * 價錢取三位有效數字（12,345 → 12,300）：玩家看的是「大概多少」，逐級冒出 12,345／17,071 這種數字很難比。
 * 不取兩位：後段曲線趨平（Lv15 以後每級只差幾百），兩位有效數字會讓相鄰兩級變同價（單元測試守「一級比一級貴」）。
 */
export function nicePrice(x: number): number {
  if (x < 100) return Math.round(x);
  const mag = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Math.round(x / mag) * mag;
}

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

/** 這一站以目前機器等級做一盤要幾秒（D60：看這台自己的等級，不是路線最低級） */
export function stationSeconds(state: GameState, id: StationId): number {
  return machineSeconds(id, state.bakery.machines[id]);
}

/** 這道甜點以目前機器等級走完整條路線要幾秒（遊戲秒） */
export function recipeSeconds(state: GameState, species: SpeciesId): number {
  return RECIPES[species].route.reduce((n, id) => n + stationSeconds(state, id), 0);
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
  return machinePortions(lineLevel(state, species));
}

/** 手上的材料夠做幾份（最缺的那一種決定） */
export function affordablePortions(state: GameState, species: SpeciesId): number {
  return Math.min(...recipeMaterials(species).map(([k, per]) => Math.floor(materialHave(state, k) / per)));
}

/**
 * 這一盤**最多**能做幾份＝min(機器上限, 材料夠做的份數)；實際做幾份由玩家在菜單上疊（D60）。
 * **份數是上限不是門檻**：線升得再高，材料只夠 1 份也開得了工——不然升級等於花錢買降級。
 */
export function maxBatch(state: GameState, species: SpeciesId): number {
  return Math.min(linePortions(state, species), affordablePortions(state, species));
}

/** 目前機器下每份的失敗率 */
export function lineFailRate(state: GameState, species: SpeciesId): number {
  const lv = Math.max(1, lineLevel(state, species));
  return RECIPES[species].failRate * machineFailMult(lv);
}

/** 把這道甜點還沒買的機器都買到 Lv1 要多少錢 */
export function lineCost(state: GameState, species: SpeciesId): number {
  return RECIPES[species].route.filter((id) => machineLevel(state, id) === 0).reduce((n, id) => n + STATIONS[id].price, 0);
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
