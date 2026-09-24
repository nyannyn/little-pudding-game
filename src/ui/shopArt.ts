/**
 * 商店商品插圖。兩種來源：
 * - `*.svg`：自己畫的。**設備一定是畫的**（D50 起剩三件：加工機與販售口退役）——它們之後會真的出現在玻璃箱裡
 *   （`scene/equipmentMesh.ts`：金屬 #cfd6dd＋配色 #e58a7b），商店圖要跟箱裡那件長得一樣；
 *   蜂蜜罐／紙盒牛奶／草莓果醬是使用者指定的長相，素材包裡沒有。
 * - `*.webp`：Microsoft Fluent Emoji 3D（MIT），來源與縮圖流程見 tools/fetch-shop-art.mjs。
 * 都走 Vite import：檔名帶內容雜湊，跟 JS／CSS 一樣被 service worker 當不變資產快取。
 *
 * 這不是 24px 的線條圖示（`icons.ts` 那套用 currentColor 吃文字色），
 * 是 64–72px 的彩色「商品照」，讀起來要像一個可以買的東西。
 */
import bathtub from '../assets/shop/bathtub.webp';
import candy from '../assets/shop/candy.webp';
import custard from '../assets/shop/custard.webp';
import egg from '../assets/shop/egg.svg';
import eqAutoFill from '../assets/shop/eqAutoFill.svg';
import eqCollector from '../assets/shop/eqCollector.svg';
import eqRestock from '../assets/shop/eqRestock.svg';
import flour from '../assets/shop/flour.svg';
import hojicha from '../assets/shop/hojicha.webp';
import honeyJar from '../assets/shop/honeyJar.svg';
import ingCaramel from '../assets/shop/ingCaramel.webp';
import ingPanna from '../assets/shop/ingPanna.webp';
import jam from '../assets/shop/jam.svg';
import jar from '../assets/shop/jar.webp';
import lock from '../assets/shop/lock.webp';
import matcha from '../assets/shop/matcha.webp';
import mcChill from '../assets/shop/mcChill.svg';
import mcCrack from '../assets/shop/mcCrack.svg';
import mcDecorate from '../assets/shop/mcDecorate.svg';
import mcMix from '../assets/shop/mcMix.svg';
import mcMold from '../assets/shop/mcMold.svg';
import mcOven from '../assets/shop/mcOven.svg';
import mcStove from '../assets/shop/mcStove.svg';
import fame from '../assets/shop/fame.svg';
import milkCarton from '../assets/shop/milkCarton.svg';
import riceFlour from '../assets/shop/riceFlour.svg';
import sakura from '../assets/shop/sakura.webp';
import star from '../assets/shop/star.webp';
import store from '../assets/shop/store.webp';
import strawberry from '../assets/shop/strawberry.webp';
import window from '../assets/shop/window.webp';
import type { EquipmentId } from '../game/balance';
import type { PantryId, StationId } from '../game/recipes';
import type { ShopEntry } from '../game/shop';
import type { LiquidId, SpeciesId } from '../game/species';

export const ART = {
  honeyJar, milkCarton, matcha, jam, strawberry,
  eqAutoFill, eqCollector, eqRestock,
  bathtub, window, store,
  ingCaramel, ingPanna, jar, custard, hojicha, candy, sakura, lock, star, egg,
  mcStove, mcCrack, mcMix, mcMold, mcOven, mcChill, mcDecorate, flour, riceFlour, fame,
} as const;

export type ArtKey = keyof typeof ART;

/** 一張商品圖＝主圖＋（可選）角落小圖：澡盆用主圖「浴缸」＋角落「那種液體」，不必為每種盆各畫一張 */
export interface ArtSpec {
  main: ArtKey;
  corner?: ArtKey;
}

const LIQUID_ART: Record<LiquidId, ArtKey> = { caramel: 'honeyJar', milk: 'milkCarton', matcha: 'matcha', strawberry: 'jam' };
const EQUIPMENT_ART: Record<EquipmentId, ArtKey> = {
  autoFill: 'eqAutoFill', collector: 'eqCollector', restock: 'eqRestock',
};

/** 工坊七台機器（D57）：自己畫的，配色對齊 `scene/bakery/room.ts` 的 PAL */
export const MACHINE_ART: Record<StationId, ArtKey> = {
  stove: 'mcStove', crack: 'mcCrack', mix: 'mcMix', mold: 'mcMold', bake: 'mcOven', chill: 'mcChill', decorate: 'mcDecorate',
};

/** 基礎材料（D58） */
export const PANTRY_ART: Record<PantryId, ArtKey> = { flour: 'flour', rice: 'riceFlour' };

/** 蛋（D33 的通用原料，不屬於任何物種，所以不在 INGREDIENT_ART 裡） */
export const EGG_ART: ArtSpec = { main: 'egg' };

/** 賣原料用：物種 → 原料的圖。混種（D28）用「主圖＋角落」拼出雙親的味道，不必每種各一張 */
export const INGREDIENT_ART: Record<SpeciesId, ArtSpec> = {
  caramel: { main: 'ingCaramel' },
  panna: { main: 'ingPanna' },
  matcha: { main: 'jar', corner: 'matcha' },
  strawberry: { main: 'jar', corner: 'strawberry' },
  custard: { main: 'custard' },
  hojicha: { main: 'hojicha' },
  brulee: { main: 'candy', corner: 'strawberry' },
  matchalatte: { main: 'matcha', corner: 'milkCarton' },
  berrymilk: { main: 'milkCarton', corner: 'strawberry' },
  sakura: { main: 'sakura' },
};

export function artFor(e: ShopEntry): ArtSpec {
  switch (e.action) {
    case 'buyStock': return { main: LIQUID_ART[e.arg as LiquidId] };
    case 'buyPantry': return { main: PANTRY_ART[e.arg as PantryId] };
    case 'buyMachine': return { main: MACHINE_ART[e.arg as StationId] };
    case 'buyFame': return { main: 'fame' };
    case 'buyEquip': return { main: EQUIPMENT_ART[e.arg as EquipmentId] };
    case 'buyBasin': return { main: 'bathtub', corner: LIQUID_ART[e.arg as LiquidId] };
    case 'unlockZone': return { main: e.arg.startsWith('c0') ? 'window' : 'store' };
  }
}

/** 倉庫格子（D49）用的家具圖：設備＝商店那張、澡盆＝浴缸（特殊盆角落疊液體） */
export function furnitureArt(kind: 'basin' | 'equipment', id: EquipmentId | LiquidId | null): ArtSpec {
  if (kind === 'equipment') return { main: EQUIPMENT_ART[id as EquipmentId] };
  return id && id !== 'caramel' && id !== 'milk' ? { main: 'bathtub', corner: LIQUID_ART[id as LiquidId] } : { main: 'bathtub' };
}

/** 給 service worker 暖快取用：離線第一次開商店也要有圖 */
export const SHOP_ART_URLS: string[] = Object.values(ART);
