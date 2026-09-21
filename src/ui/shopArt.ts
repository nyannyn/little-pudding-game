/**
 * 商店商品插圖（Microsoft Fluent Emoji 3D，MIT；來源與縮圖流程見 tools/fetch-shop-art.mjs）。
 * 走 Vite import：檔名帶內容雜湊，跟 JS／CSS 一樣被 service worker 當不變資產快取。
 *
 * 這不是 24px 的線條圖示（`icons.ts` 那套用 currentColor 吃文字色），
 * 是 64–72px 的彩色「商品照」，讀起來要像一個可以買的東西。
 */
import autoFill from '../assets/shop/autoFill.webp';
import bathtub from '../assets/shop/bathtub.webp';
import candy from '../assets/shop/candy.webp';
import caramel from '../assets/shop/caramel.webp';
import collector from '../assets/shop/collector.webp';
import crafter from '../assets/shop/crafter.webp';
import custard from '../assets/shop/custard.webp';
import hojicha from '../assets/shop/hojicha.webp';
import ingCaramel from '../assets/shop/ingCaramel.webp';
import ingPanna from '../assets/shop/ingPanna.webp';
import jar from '../assets/shop/jar.webp';
import lock from '../assets/shop/lock.webp';
import matcha from '../assets/shop/matcha.webp';
import milk from '../assets/shop/milk.webp';
import restock from '../assets/shop/restock.webp';
import sakura from '../assets/shop/sakura.webp';
import seller from '../assets/shop/seller.webp';
import star from '../assets/shop/star.webp';
import store from '../assets/shop/store.webp';
import strawberry from '../assets/shop/strawberry.webp';
import window from '../assets/shop/window.webp';
import type { ShopEntry } from '../game/shop';
import type { LiquidId, SpeciesId } from '../game/species';

export const ART = {
  caramel, milk, matcha, strawberry,
  autoFill, collector, crafter, seller, restock,
  bathtub, window, store,
  ingCaramel, ingPanna, jar, custard, hojicha, candy, sakura, lock, star,
} as const;

export type ArtKey = keyof typeof ART;

/** 一張商品圖＝主圖＋（可選）角落小圖：澡盆用主圖「浴缸」＋角落「那種液體」，不必為每種盆各畫一張 */
export interface ArtSpec {
  main: ArtKey;
  corner?: ArtKey;
}

const LIQUID_ART: Record<LiquidId, ArtKey> = { caramel: 'caramel', milk: 'milk', matcha: 'matcha', strawberry: 'strawberry' };

/** 賣原料用：物種 → 原料的圖。混種（D28）用「主圖＋角落」拼出雙親的味道，不必每種各一張 */
export const INGREDIENT_ART: Record<SpeciesId, ArtSpec> = {
  caramel: { main: 'ingCaramel' },
  panna: { main: 'ingPanna' },
  matcha: { main: 'jar', corner: 'matcha' },
  strawberry: { main: 'jar', corner: 'strawberry' },
  custard: { main: 'custard' },
  hojicha: { main: 'hojicha' },
  brulee: { main: 'candy', corner: 'strawberry' },
  matchalatte: { main: 'matcha', corner: 'milk' },
  berrymilk: { main: 'milk', corner: 'strawberry' },
  sakura: { main: 'sakura' },
};

export function artFor(e: ShopEntry): ArtSpec {
  switch (e.action) {
    case 'buyStock': return { main: LIQUID_ART[e.arg as LiquidId] };
    case 'buyEquip': return { main: e.arg as ArtKey };
    case 'buyBasin': return { main: 'bathtub', corner: LIQUID_ART[e.arg as LiquidId] };
    case 'unlockZone': return { main: e.arg.startsWith('c0') ? 'window' : 'store' };
  }
}

/** 給 service worker 暖快取用：離線第一次開商店也要有圖 */
export const SHOP_ART_URLS: string[] = Object.values(ART);
