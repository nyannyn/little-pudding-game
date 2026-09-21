import { BALANCE, EQUIPMENT, type EquipmentId } from './balance';
import { pourIntoBasin } from './basin';
import type { EventSink } from './events';
import { grantXp, levelFor } from './level';
import { basinLevel, stockCost, stockLevel } from './shop';
import { LIQUIDS, SPECIES, dessertPrice, type LiquidId, type SpeciesId } from './species';
import type { GameState, Vec2 } from './state';
import { findZone } from './zones';

export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };
function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** 店長等級不到就擋下（商店目錄 `shop.ts` 用同一組門檻，UI 鎖著的東西這裡也一樣買不到） */
function levelGate(state: GameState, need: number): ActionResult | null {
  return levelFor(state.xp) >= need ? null : fail(`店長 Lv.${need} 才能買`);
}

/**
 * 玩家動作。每一個都先驗完條件才動 state：
 * 失敗時 state 必須跟呼叫前**完全一樣**（AC2-7），所以不准「先扣再檢查」。
 */

/** 倒一份液體進澡盆 */
export function fillBasin(state: GameState, basinIndex: number, liquid: LiquidId, emit: EventSink): ActionResult {
  const r = pourIntoBasin(state, basinIndex, liquid, 1);
  if (!r.ok) return fail(r.error ?? '倒不進去');
  emit({ type: 'pour', basinIndex, liquid, units: r.poured, auto: false });
  return OK;
}

/** 撿起一份掉落原料 */
export function pickDrop(state: GameState, dropId: string, emit: EventSink): ActionResult {
  const i = state.drops.findIndex((d) => d.id === dropId);
  const d = state.drops[i];
  if (!d) return fail('這份原料已經不在了');
  state.drops.splice(i, 1);
  state.ingredients[d.species]++;
  state.stats.picked++;
  emit({ type: 'pick', species: d.species, x: d.pos.x, z: d.pos.z, auto: false });
  grantXp(state, BALANCE.xp.pick, emit);
  return OK;
}

/**
 * 一次撿完。`zone` 給值就只撿那一區（玩家按的「撿原料」只作用在看得到的那一區），
 * 不給就全部撿走（原料收集手是全場生效的設備）。
 */
export function pickAllDrops(state: GameState, emit: EventSink, auto = false, zone?: string): number {
  const take = zone === undefined ? state.drops : state.drops.filter((d) => d.zone === zone);
  for (const d of take) {
    state.ingredients[d.species]++;
    state.stats.picked++;
    emit({ type: 'pick', species: d.species, x: d.pos.x, z: d.pos.z, auto });
  }
  state.drops = zone === undefined ? [] : state.drops.filter((d) => d.zone !== zone);
  grantXp(state, BALANCE.xp.pick * take.length, emit);
  return take.length;
}

export function sellIngredient(state: GameState, species: SpeciesId, qty: number, emit: EventSink): ActionResult {
  const n = Math.floor(qty);
  if (n <= 0) return fail('數量要大於 0');
  if (state.ingredients[species] < n) return fail('原料不足');
  const coins = SPECIES[species].ingredientPrice * n;
  state.ingredients[species] -= n;
  state.coins += coins;
  state.stats.sold += n;
  emit({ type: 'sell', species, coins, auto: false });
  grantXp(state, BALANCE.xp.sellIngredient * n, emit);
  return OK;
}

/** 加工：ingredientsPerDessert 份同類原料 → 1 份甜點 */
export function craft(state: GameState, species: SpeciesId, emit: EventSink, auto = false): ActionResult {
  const need = BALANCE.ingredientsPerDessert;
  if (state.ingredients[species] < need) return fail(`要 ${need} 份${SPECIES[species].ingredient}才做得出來`);
  state.ingredients[species] -= need;
  state.desserts[species]++;
  state.stats.crafted++;
  emit({ type: 'craft', species, auto });
  grantXp(state, BALANCE.xp.craft, emit);
  return OK;
}

export function sellDessert(state: GameState, species: SpeciesId, qty: number, emit: EventSink, auto = false): ActionResult {
  const n = Math.floor(qty);
  if (n <= 0) return fail('數量要大於 0');
  if (state.desserts[species] < n) return fail('甜點不足');
  const coins = dessertPrice(species, BALANCE.dessertPriceMult) * n;
  state.desserts[species] -= n;
  state.coins += coins;
  state.stats.sold += n;
  emit({ type: 'sell', species, coins, auto });
  grantXp(state, BALANCE.xp.sellDessert * n, emit);
  return OK;
}

/** 交付訂單卡：出價比直接賣高，但要有對應物種的甜點 */
export function fulfillOrder(state: GameState, orderId: string, emit: EventSink, auto = false): ActionResult {
  const i = state.orders.findIndex((o) => o.id === orderId);
  const o = state.orders[i];
  if (!o) return fail('訂單已經不在了');
  if (o.expiresAt <= state.time) return fail('訂單已經過期');
  if (state.desserts[o.species] < o.qty) return fail(`${SPECIES[o.species].dessert}不夠`);
  state.desserts[o.species] -= o.qty;
  state.coins += o.price;
  state.stats.sold += o.qty;
  state.orders.splice(i, 1);
  emit({ type: 'orderDone', orderId: o.id, species: o.species, coins: o.price, auto });
  grantXp(state, BALANCE.xp.order + BALANCE.xp.sellDessert * o.qty, emit);
  return OK;
}

export function buyStock(state: GameState, liquid: LiquidId, qty: number, emit: EventSink, auto = false): ActionResult {
  const n = Math.floor(qty);
  if (n <= 0) return fail('數量要大於 0');
  const info = LIQUIDS[liquid];
  if (info.needsBasin && !state.ownedBasins.includes(liquid)) return fail(`還沒買下${info.name}澡盆`);
  const gate = levelGate(state, stockLevel(n));
  if (gate) return gate;
  const cost = stockCost(liquid, n);
  if (state.coins < cost) return fail('焦糖幣不夠');
  state.coins -= cost;
  state.stock[liquid] += n;
  emit({ type: 'buy', what: info.name, cost, auto });
  return OK;
}

/** 買特殊澡盆：一次性，買了才會多一個盆出現在櫥窗裡 */
export function buySpecialBasin(
  state: GameState,
  liquid: LiquidId,
  pos: Vec2,
  zone: string,
  emit: EventSink,
): ActionResult {
  const info = LIQUIDS[liquid];
  if (!info.needsBasin) return fail('這不是特殊澡盆');
  if (state.ownedBasins.includes(liquid)) return fail('已經有這個澡盆了');
  const gate = levelGate(state, basinLevel(liquid));
  if (gate) return gate;
  if (state.coins < BALANCE.specialBasinPrice) return fail('焦糖幣不夠');
  state.coins -= BALANCE.specialBasinPrice;
  state.ownedBasins.push(liquid);
  state.basins.push({ zone, liquid: null, units: 0, preferredLiquid: liquid, pos: { ...pos }, occupantId: null });
  emit({ type: 'buy', what: `${info.name}澡盆`, cost: BALANCE.specialBasinPrice, auto: false });
  return OK;
}

export function buyEquipment(state: GameState, id: EquipmentId, emit: EventSink): ActionResult {
  const info = EQUIPMENT[id];
  if (state.equipment[id]) return fail('已經買過了');
  const gate = levelGate(state, info.level);
  if (gate) return gate;
  if (state.coins < info.price) return fail('焦糖幣不夠');
  state.coins -= info.price;
  state.equipment[id] = true;
  emit({ type: 'buy', what: info.name, cost: info.price, auto: false });
  return OK;
}

export interface ZoneSpawn {
  /** 新住客的落點（該區地板的區域座標） */
  puddingPos: Vec2;
  /** 新澡盆的位置 */
  basinPos: Vec2;
}

/**
 * 解鎖一個分區（第二層、或第二座櫥窗）。
 * 解鎖後這一區有自己的一隻布丁與一個空澡盆——沒有住客的空櫥窗不算擴張。
 */
export function unlockZone(state: GameState, zoneId: string, spawn: ZoneSpawn, emit: EventSink): ActionResult {
  const z = findZone(state, zoneId);
  if (!z) return fail('沒有這個櫥窗');
  if (z.unlocked) return fail('這一區已經解鎖了');
  const gate = levelGate(state, z.level);
  if (gate) return gate;
  if (state.coins < z.price) return fail('焦糖幣不夠');

  state.coins -= z.price;
  z.unlocked = true;
  state.puddings.push({
    id: `p${state.nextId++}`, // 不可以用長度推算 id：撞號會讓 scene 端的 view 綁錯隻
    zone: zoneId,
    // 送的住客是純焦糖成年布丁：新的一區要能當「配種用的乾淨底盤」（D28）
    genes: ['caramel', 'caramel'],
    species: 'caramel',
    bornAt: state.time - BALANCE.matureAgeSec,
    breedReadyAt: state.time,
    caramel: 45,
    bathHistory: [],
    tint: 0,
    flavorExposure: {},
    mode: 'resting',
    pos: { ...spawn.puddingPos },
    from: { ...spawn.puddingPos },
    to: { ...spawn.puddingPos },
    hopT: 1,
    restT: 0.8,
    bathT: 0,
    basinIndex: null,
    bathLiquid: null,
    pendingMutation: null,
  });
  state.basins.push({
    zone: zoneId,
    liquid: null,
    units: 0,
    preferredLiquid: null,
    pos: { ...spawn.basinPos },
    occupantId: null,
  });
  state.activeZone = zoneId;
  emit({ type: 'buy', what: z.name, cost: z.price, auto: false });
  return OK;
}

/**
 * 把一隻布丁搬到另一個已解鎖的分區（D29）。
 *
 * 這是玩家對「配種」唯一的直接操作：誰跟誰住同一區，決定了下一代的基因來源。
 * 沒有它的話，玩家只能靠澡盆（D30）間接影響基因，養出來的混種也拆不開重配。
 * **UI 尚未接線**（2026-09-22），規則層先備好。
 */
export function movePudding(state: GameState, puddingId: string, zoneId: string, emit: EventSink): ActionResult {
  const p = state.puddings.find((x) => x.id === puddingId);
  if (!p) return fail('沒有這隻布丁');
  const z = findZone(state, zoneId);
  if (!z) return fail('沒有這個櫥窗');
  if (!z.unlocked) return fail('這一區還沒解鎖');
  if (p.zone === zoneId) return fail('牠已經住在這一區了');
  if (p.mode === 'bathing') return fail('泡澡中，泡完再搬');
  if (state.puddings.filter((x) => x.zone === zoneId).length >= BALANCE.zoneCapacity) {
    return fail('那一區住滿了');
  }

  // 正要跳進某個盆的話要先讓出佔位，否則那個盆會被一隻已經不在這一區的布丁永久佔住
  const bi = p.basinIndex;
  const basin = bi === null ? undefined : state.basins[bi];
  if (basin && basin.occupantId === p.id) basin.occupantId = null;
  p.basinIndex = null;
  p.zone = zoneId;
  p.mode = 'resting';
  p.restT = 0.5;
  p.from = { ...p.pos };
  p.to = { ...p.pos };
  p.hopT = 1;
  emit({ type: 'move', puddingId: p.id, zone: zoneId });
  return OK;
}

/** 切到另一個已解鎖的分區（鏡頭與 HUD 都跟著走） */
export function switchZone(state: GameState, zoneId: string): ActionResult {
  const z = findZone(state, zoneId);
  if (!z) return fail('沒有這個櫥窗');
  if (!z.unlocked) return fail('這一區還沒解鎖');
  state.activeZone = zoneId;
  return OK;
}
