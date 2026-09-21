/**
 * 四個物種與四種澡盆液體的資料表（計畫「遊戲設計」表）。
 *
 * D19（2026-09-21 新增）：**原料種類由布丁「物種」決定，不由澡盆液體決定**。
 * 計畫原文兩處互相矛盾——「泡澡結果」表寫液體決定原料，但訂單卡寫「指定物種的甜點、
 * 沒有該物種就只能過期」。若原料跟著液體走，一隻黃布丁換個液體就能做出全部四種甜點，
 * 「培育多物種」這條經營軸就不存在了。所以取物種決定原料；液體只決定對布丁的效果
 * （補焦糖／推進牛奶窗／累積風味）。
 */
export type SpeciesId = 'caramel' | 'panna' | 'matcha' | 'strawberry';
export type LiquidId = 'caramel' | 'milk' | 'matcha' | 'strawberry';

export interface SpeciesInfo {
  id: SpeciesId;
  name: string;
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
}

export const SPECIES: Record<SpeciesId, SpeciesInfo> = {
  caramel: {
    id: 'caramel', name: '焦糖布丁', ingredient: '焦糖塊', dessert: '焦糖布丁塔',
    bodyColor: 0xffc857, toppingColor: 0xb4651f, ingredientPrice: 6,
  },
  panna: {
    id: 'panna', name: '特濃鮮奶酪布丁', ingredient: '奶酪塊', dessert: '鮮奶酪杯',
    bodyColor: 0xfdf6ec, toppingColor: 0xe8d3b0, ingredientPrice: 10,
  },
  matcha: {
    id: 'matcha', name: '宇治抹茶布丁', ingredient: '抹茶粉罐', dessert: '抹茶布丁捲',
    bodyColor: 0x9fc08a, toppingColor: 0x4f7a3a, ingredientPrice: 16,
  },
  strawberry: {
    id: 'strawberry', name: '大湖草莓布丁', ingredient: '草莓醬罐', dessert: '草莓布丁派',
    bodyColor: 0xf7a7bb, toppingColor: 0xd44f6e, ingredientPrice: 16,
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

export interface LiquidInfo {
  id: LiquidId;
  name: string;
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
  caramel: { id: 'caramel', name: '香醇濃郁的熱焦糖', color: 0xc07a2c, caramelAfterBath: 100, unitPrice: 4, needsBasin: false, flavorFor: null },
  milk: { id: 'milk', name: '冰鮮牛乳', color: 0xfdfaf2, caramelAfterBath: 60, unitPrice: 4, needsBasin: false, flavorFor: null },
  matcha: { id: 'matcha', name: '宇治抹茶湯', color: 0x7fa762, caramelAfterBath: 80, unitPrice: 10, needsBasin: true, flavorFor: 'matcha' },
  strawberry: { id: 'strawberry', name: '大湖草莓醬', color: 0xe2708c, caramelAfterBath: 80, unitPrice: 10, needsBasin: true, flavorFor: 'strawberry' },
};

export const LIQUID_IDS = Object.keys(LIQUIDS) as LiquidId[];

/** 特殊澡盆（一次性購買）＝ needsBasin 的那兩種液體 */
export const SPECIAL_LIQUIDS = LIQUID_IDS.filter((id) => LIQUIDS[id].needsBasin);

export function dessertPrice(species: SpeciesId, mult: number): number {
  return Math.round(SPECIES[species].ingredientPrice * mult);
}
