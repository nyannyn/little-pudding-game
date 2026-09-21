import { BALANCE, EQUIPMENT, EQUIPMENT_IDS } from './balance';
import { levelFor } from './level';
import { LIQUIDS, SPECIAL_LIQUIDS, SPECIES, type LiquidId, type SpeciesId } from './species';
import type { GameState } from './state';

/**
 * 商店目錄（D25）。UI 只負責把這份清單畫出來；「什麼時候上架、多少錢、買過沒」全在這裡決定，
 * 而且跟 `actions.ts` 的購買守衛用同一組數字——UI 上鎖著的東西，直接呼叫 action 也一樣買不到。
 */

export type ShopTab = 'stock' | 'equipment' | 'basin' | 'zone';

export type ShopStatus =
  /** 可以買（錢夠不夠是另一回事，由 `affordable` 說） */
  | 'available'
  /** 等級不夠，卡片顯示但不能買 */
  | 'locked'
  /** 一次性商品已經買過 */
  | 'owned'
  /** 還沒滿足前置（例如沒買澡盆就不能補抹茶湯），卡片顯示提示但不能買 */
  | 'needs';

export interface ShopEntry {
  /** 全店唯一，UI 拿它當 DOM key */
  id: string;
  tab: ShopTab;
  /** 對應 HUD 的 data-a */
  action: 'buyStock' | 'buyEquip' | 'buyBasin' | 'unlockZone';
  /** 對應 HUD 的 data-arg */
  arg: string;
  /** 補貨份數（只有 buyStock 有） */
  qty?: number;
  name: string;
  desc: string;
  price: number;
  level: number;
  status: ShopStatus;
  affordable: boolean;
  /** 沒滿足的前置說明（status === 'needs' 時） */
  needsText?: string;
  /** 補貨卡片的「目前庫存」 */
  stock?: number;
  /** 大桶裝（有折扣） */
  bulk?: boolean;
}

/** 補貨價：大桶裝打折、四捨五入到整數；小包裝原價 */
export function stockCost(liquid: LiquidId, qty: number): number {
  const raw = LIQUIDS[liquid].unitPrice * qty;
  if (qty >= BALANCE.stockBulkQty) return Math.round(raw * (1 - BALANCE.stockBulkDiscount));
  return raw;
}

/** 這個份數要幾級才買得到 */
export function stockLevel(qty: number): number {
  return qty >= BALANCE.stockBulkQty ? BALANCE.stockBulkLevel : 1;
}

export function basinLevel(liquid: LiquidId): number {
  return BALANCE.specialBasinLevel[liquid] ?? 1;
}

function flavorOf(liquid: LiquidId): SpeciesId {
  return LIQUIDS[liquid].flavorFor as SpeciesId;
}

export function shopCatalog(state: GameState): ShopEntry[] {
  const level = levelFor(state.xp);
  const out: ShopEntry[] = [];
  const gate = (need: number): ShopStatus => (level >= need ? 'available' : 'locked');

  // 補貨：焦糖／牛乳固定上架；風味液體要先有澡盆
  const liquids: LiquidId[] = ['caramel', 'milk', ...SPECIAL_LIQUIDS];
  for (const l of liquids) {
    const info = LIQUIDS[l];
    const packs = info.needsBasin ? [BALANCE.stockBuyQty] : [BALANCE.stockBuyQty, BALANCE.stockBulkQty];
    for (const qty of packs) {
      const price = stockCost(l, qty);
      const need = stockLevel(qty);
      const bulk = qty >= BALANCE.stockBulkQty;
      let status = gate(need);
      let needsText: string | undefined;
      if (status === 'available' && info.needsBasin && !state.ownedBasins.includes(l)) {
        status = 'needs';
        needsText = `先買${SPECIES[flavorOf(l)].shortName}澡盆`;
      }
      out.push({
        id: `stock:${l}:${qty}`,
        tab: 'stock',
        action: 'buyStock',
        arg: l,
        qty,
        name: bulk ? `${info.shortName}大桶裝` : info.shortName,
        desc: bulk
          ? `${qty} 份，比小包裝省 ${Math.round(BALANCE.stockBulkDiscount * 100)}%`
          : `${qty} 份。${l === 'milk' ? '連泡會慢慢變白' : info.flavorFor ? `泡久了會變成${SPECIES[flavorOf(l)].shortName}布丁` : '泡完補滿焦糖'}`,
        price,
        level: need,
        status,
        affordable: state.coins >= price,
        needsText,
        stock: state.stock[l],
        bulk,
      });
    }
  }

  for (const id of EQUIPMENT_IDS) {
    const info = EQUIPMENT[id];
    out.push({
      id: `equip:${id}`,
      tab: 'equipment',
      action: 'buyEquip',
      arg: id,
      name: info.name,
      desc: info.desc,
      price: info.price,
      level: info.level,
      status: state.equipment[id] ? 'owned' : gate(info.level),
      affordable: state.coins >= info.price,
    });
  }

  for (const l of SPECIAL_LIQUIDS) {
    const info = LIQUIDS[l];
    const need = basinLevel(l);
    const baths = Math.ceil(BALANCE.flavorThresholdSec / BALANCE.flavorExposurePerBath);
    out.push({
      id: `basin:${l}`,
      tab: 'basin',
      action: 'buyBasin',
      arg: l,
      name: `${SPECIES[flavorOf(l)].shortName}澡盆`,
      desc: `泡 ${baths} 次會變成${SPECIES[flavorOf(l)].name}`,
      price: BALANCE.specialBasinPrice,
      level: need,
      status: state.ownedBasins.includes(l) ? 'owned' : gate(need),
      affordable: state.coins >= BALANCE.specialBasinPrice,
    });
  }

  for (const z of state.zones) {
    if (z.price === 0) continue; // 起始區不是商品
    out.push({
      id: `zone:${z.id}`,
      tab: 'zone',
      action: 'unlockZone',
      arg: z.id,
      name: z.name,
      desc: '多一隻住客、一個澡盆',
      price: z.price,
      level: z.level,
      status: z.unlocked ? 'owned' : gate(z.level),
      affordable: state.coins >= z.price,
    });
  }

  return out;
}

/** 升到某一級時新上架的商品（升級 toast 用） */
export function unlockedAtLevel(state: GameState, level: number): ShopEntry[] {
  return shopCatalog(state).filter((e) => e.level === level && e.status !== 'owned');
}
