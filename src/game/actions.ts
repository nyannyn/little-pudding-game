import { BALANCE, EQUIPMENT, type EquipmentId } from './balance';
import { pourIntoBasin } from './basin';
import type { EventSink } from './events';
import { LIQUIDS, SPECIES, dessertPrice, type LiquidId, type SpeciesId } from './species';
import type { GameState, Vec2 } from './state';

export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };
function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * 玩家動作。每一個都先驗完條件才動 state：
 * 失敗時 state 必須跟呼叫前**完全一樣**（AC2-7），所以不准「先扣再檢查」。
 */

/** 倒一份液體進澡盆 */
export function fillBasin(state: GameState, basinIndex: number, liquid: LiquidId, emit: EventSink): ActionResult {
  const r = pourIntoBasin(state, basinIndex, liquid, 1);
  if (!r.ok) return fail(r.error ?? '倒不進去');
  emit({ type: 'pour', basinIndex, liquid, auto: false });
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
  return OK;
}

/** 一次撿完（UI 的「全部收起」與收集手共用） */
export function pickAllDrops(state: GameState, emit: EventSink, auto = false): number {
  const n = state.drops.length;
  for (const d of state.drops) {
    state.ingredients[d.species]++;
    state.stats.picked++;
    emit({ type: 'pick', species: d.species, x: d.pos.x, z: d.pos.z, auto });
  }
  state.drops = [];
  return n;
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
  return OK;
}

export function buyStock(state: GameState, liquid: LiquidId, qty: number, emit: EventSink, auto = false): ActionResult {
  const n = Math.floor(qty);
  if (n <= 0) return fail('數量要大於 0');
  const info = LIQUIDS[liquid];
  if (info.needsBasin && !state.ownedBasins.includes(liquid)) return fail(`還沒買下${info.name}澡盆`);
  const cost = info.unitPrice * n;
  if (state.coins < cost) return fail('焦糖幣不夠');
  state.coins -= cost;
  state.stock[liquid] += n;
  emit({ type: 'buy', what: info.name, cost, auto });
  return OK;
}

/** 買特殊澡盆：一次性，買了才會多一個盆出現在櫥窗裡 */
export function buySpecialBasin(state: GameState, liquid: LiquidId, pos: Vec2, emit: EventSink): ActionResult {
  const info = LIQUIDS[liquid];
  if (!info.needsBasin) return fail('這不是特殊澡盆');
  if (state.ownedBasins.includes(liquid)) return fail('已經有這個澡盆了');
  if (state.coins < BALANCE.specialBasinPrice) return fail('焦糖幣不夠');
  state.coins -= BALANCE.specialBasinPrice;
  state.ownedBasins.push(liquid);
  state.basins.push({ liquid: null, units: 0, preferredLiquid: liquid, pos: { ...pos }, occupantId: null });
  emit({ type: 'buy', what: `${info.name}澡盆`, cost: BALANCE.specialBasinPrice, auto: false });
  return OK;
}

export function buyEquipment(state: GameState, id: EquipmentId, emit: EventSink): ActionResult {
  const info = EQUIPMENT[id];
  if (state.equipment[id]) return fail('已經買過了');
  if (state.coins < info.price) return fail('焦糖幣不夠');
  state.coins -= info.price;
  state.equipment[id] = true;
  emit({ type: 'buy', what: info.name, cost: info.price, auto: false });
  return OK;
}
