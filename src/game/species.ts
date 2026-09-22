/**
 * 四個物種與四種澡盆液體的資料表（計畫「遊戲設計」表）。
 *
 * D19（2026-09-21 新增）：**原料種類由布丁「物種」決定，不由澡盆液體決定**。
 * 計畫原文兩處互相矛盾——「泡澡結果」表寫液體決定原料，但訂單卡寫「指定物種的甜點、
 * 沒有該物種就只能過期」。若原料跟著液體走，一隻黃布丁換個液體就能做出全部四種甜點，
 * 「培育多物種」這條經營軸就不存在了。所以取物種決定原料；液體只決定對布丁的效果
 * （補焦糖／推進牛奶窗／累積風味）。
 */
/**
 * D28（2026-09-22）：物種分成「四種基礎風味」與「六種混種」。
 * 基礎風味同時是**等位基因**（`AlleleId`）——每隻布丁帶兩個，兩個相同就是純種，
 * 不同就表現成該組合專屬的混種。所以物種表 = 4 純種 + C(4,2)=6 混種 = 10 種。
 */
export type AlleleId = 'caramel' | 'panna' | 'matcha' | 'strawberry';
export type HybridId = 'custard' | 'hojicha' | 'brulee' | 'matchalatte' | 'berrymilk' | 'sakura';
export type SpeciesId = AlleleId | HybridId;
export type LiquidId = 'caramel' | 'milk' | 'matcha' | 'strawberry';

/** 等位基因的正規化順序：基因型一律照這個順序排，`[a,b]` 與 `[b,a]` 才會是同一個鍵 */
export const ALLELES: AlleleId[] = ['caramel', 'panna', 'matcha', 'strawberry'];

export interface SpeciesInfo {
  id: SpeciesId;
  name: string;
  /** 短名（狀態列一行塞得下；全名留給商店／toast） */
  shortName: string;
  /** 該物種產出的原料名 */
  ingredient: string;
  /** 該物種做成的甜點名 */
  dessert: string;
  /** 布丁本體色（scene 端 lerp 用） */
  bodyColor: number;
  /** 焦糖／頂料色 */
  toppingColor: number;
  /** 一份原料的售價；甜點售價＝此值 × DESSERT_PRICE_MULT */
  ingredientPrice: number;
  /**
   * 這個物種的基因型（兩個等位基因，照 `ALLELES` 的順序）。
   * 純種是同一個等位基因兩份；混種是它的兩個親代風味。
   * 基因型→物種的查表由這一欄反推（`GENOTYPE_TO_SPECIES`），不另外維護第二張表。
   */
  alleles: [AlleleId, AlleleId];
}

export const SPECIES: Record<SpeciesId, SpeciesInfo> = {
  caramel: {
    id: 'caramel', name: '焦糖布丁', shortName: '焦糖', ingredient: '焦糖塊', dessert: '焦糖布丁塔',
    bodyColor: 0xffc857, toppingColor: 0xb4651f, ingredientPrice: 6, alleles: ['caramel', 'caramel'],
  },
  panna: {
    id: 'panna', name: '特濃鮮奶酪布丁', shortName: '鮮奶酪', ingredient: '奶酪塊', dessert: '鮮奶酪杯',
    bodyColor: 0xfdf6ec, toppingColor: 0xe8d3b0, ingredientPrice: 10, alleles: ['panna', 'panna'],
  },
  matcha: {
    id: 'matcha', name: '宇治抹茶布丁', shortName: '抹茶', ingredient: '抹茶粉罐', dessert: '抹茶布丁捲',
    bodyColor: 0x9fc08a, toppingColor: 0x4f7a3a, ingredientPrice: 16, alleles: ['matcha', 'matcha'],
  },
  strawberry: {
    id: 'strawberry', name: '大湖草莓布丁', shortName: '草莓', ingredient: '草莓醬罐', dessert: '草莓布丁派',
    bodyColor: 0xf7a7bb, toppingColor: 0xd44f6e, ingredientPrice: 16, alleles: ['strawberry', 'strawberry'],
  },

  // ── 混種（D28）。售價＝雙親平均 × 1.6，刻意高於任何純種：
  //    配出混種要先養出兩邊的等位基因，回報要看得出來才值得繞這一圈。
  custard: {
    id: 'custard', name: '卡士達布丁', shortName: '卡士達', ingredient: '卡士達醬', dessert: '卡士達泡芙',
    bodyColor: 0xfde4b0, toppingColor: 0xd9a441, ingredientPrice: 13, alleles: ['caramel', 'panna'],
  },
  hojicha: {
    id: 'hojicha', name: '焙茶布丁', shortName: '焙茶', ingredient: '焙茶粉罐', dessert: '焙茶布丁燒',
    bodyColor: 0xc9a06a, toppingColor: 0x7a4f2a, ingredientPrice: 18, alleles: ['caramel', 'matcha'],
  },
  brulee: {
    id: 'brulee', name: '草莓烤布蕾', shortName: '布蕾', ingredient: '脆糖片', dessert: '草莓烤布蕾杯',
    bodyColor: 0xf7c9a0, toppingColor: 0xd4703f, ingredientPrice: 18, alleles: ['caramel', 'strawberry'],
  },
  matchalatte: {
    id: 'matchalatte', name: '抹茶生乳布丁', shortName: '抹茶乳', ingredient: '抹茶生乳醬', dessert: '抹茶生乳捲',
    bodyColor: 0xd8e6c4, toppingColor: 0x6f9a55, ingredientPrice: 21, alleles: ['panna', 'matcha'],
  },
  berrymilk: {
    id: 'berrymilk', name: '草莓鮮乳布丁', shortName: '莓乳', ingredient: '草莓鮮乳醬', dessert: '草莓鮮乳凍',
    bodyColor: 0xfbdfe4, toppingColor: 0xe0879f, ingredientPrice: 21, alleles: ['panna', 'strawberry'],
  },
  sakura: {
    id: 'sakura', name: '櫻花抹茶布丁', shortName: '櫻花', ingredient: '鹽漬櫻花', dessert: '櫻花抹茶大福',
    bodyColor: 0xe7c3ca, toppingColor: 0x8aa96b, ingredientPrice: 26, alleles: ['matcha', 'strawberry'],
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

/** 純種（＝等位基因本身）。訂單卡的「引子」只從這裡抽：混種要配好幾代才養得出來 */
export const BASE_SPECIES_IDS: AlleleId[] = [...ALLELES];

/** 基因型鍵：兩個等位基因照 `ALLELES` 的順序排再串起來 */
export function genotypeKey(a: AlleleId, b: AlleleId): string {
  return ALLELES.indexOf(a) <= ALLELES.indexOf(b) ? `${a}+${b}` : `${b}+${a}`;
}

/**
 * 基因型 → 物種。由 `SPECIES[*].alleles` 反推，所以配種表只有一份資料：
 * 新增一個混種只要在 `SPECIES` 加一條並寫上它的兩個等位基因。
 */
export const GENOTYPE_TO_SPECIES: Record<string, SpeciesId> = (() => {
  const out: Record<string, SpeciesId> = {};
  for (const id of SPECIES_IDS) {
    const [a, b] = SPECIES[id].alleles;
    out[genotypeKey(a, b)] = id;
  }
  return out;
})();

export interface LiquidInfo {
  id: LiquidId;
  name: string;
  /** 短名（商店卡片一行塞得下；全名留給 toast） */
  shortName: string;
  /** 液面顏色 */
  color: number;
  /** 泡完後 caramel 回到多少 */
  caramelAfterBath: number;
  /** 一份的補貨價 */
  unitPrice: number;
  /** 需要先買下澡盆才能倒（特殊風味澡盆） */
  needsBasin: boolean;
  /** 泡這種澡會累積哪個物種的風味曝露；null＝不累積 */
  flavorFor: SpeciesId | null;
}

export const LIQUIDS: Record<LiquidId, LiquidInfo> = {
  caramel: { id: 'caramel', name: '香醇濃郁的熱焦糖', shortName: '熱焦糖', color: 0xc07a2c, caramelAfterBath: 100, unitPrice: 2, needsBasin: false, flavorFor: null },
  milk: { id: 'milk', name: '冰鮮牛乳', shortName: '鮮牛乳', color: 0xfdfaf2, caramelAfterBath: 60, unitPrice: 2, needsBasin: false, flavorFor: null },
  matcha: { id: 'matcha', name: '宇治抹茶湯', shortName: '抹茶湯', color: 0x7fa762, caramelAfterBath: 80, unitPrice: 6, needsBasin: true, flavorFor: 'matcha' },
  strawberry: { id: 'strawberry', name: '大湖草莓醬', shortName: '草莓醬', color: 0xe2708c, caramelAfterBath: 80, unitPrice: 6, needsBasin: true, flavorFor: 'strawberry' },
};

export const LIQUID_IDS = Object.keys(LIQUIDS) as LiquidId[];

/** 特殊澡盆（一次性購買）＝ needsBasin 的那兩種液體 */
export const SPECIAL_LIQUIDS = LIQUID_IDS.filter((id) => LIQUIDS[id].needsBasin);

export function dessertPrice(species: SpeciesId, mult: number): number {
  return Math.round(SPECIES[species].ingredientPrice * mult);
}
