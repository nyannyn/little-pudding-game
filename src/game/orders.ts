import { BALANCE } from './balance';
import type { EventSink } from './events';
import { intRange, pick, range, type Rng } from './rng';
import { SPECIES_IDS, dessertPrice } from './species';
import type { GameState, Order } from './state';

/** 訂單物種有多少比例從「目前住客的物種」抽；其餘從全部四種抽（D25） */
export const ORDER_OWNED_SPECIES_RATIO = 0.8;

/**
 * 訂單卡（經營軸的最小版）。
 * 物種 80% 從玩家養得出來的物種抽、20% 從全部四種抽（D25）：
 * 養不出來的那種只能眼睜睜看它過期，這就是「培育多物種」的動機，所以不可以完全不抽；
 * 但只養焦糖時若四種均抽，四分之三的訂單注定過期，玩家看到的只是一連串「過期了」。
 */
export function generateOrder(state: GameState, rng: Rng): Order {
  const owned = SPECIES_IDS.filter((id) => state.puddings.some((p) => p.species === id));
  const fromOwned = owned.length > 0 && rng.next() < ORDER_OWNED_SPECIES_RATIO;
  const species = pick(rng, fromOwned ? owned : SPECIES_IDS);
  const qty = intRange(rng, 1, 3);
  const mult = range(rng, BALANCE.orderPriceMultMin, BALANCE.orderPriceMultMax);
  const unit = dessertPrice(species, BALANCE.dessertPriceMult);
  return {
    id: `o${state.nextId++}`,
    species,
    qty,
    price: Math.round(unit * qty * mult),
    createdAt: state.time,
    expiresAt: state.time + BALANCE.orderTtlSec,
  };
}

export function tickOrders(state: GameState, rng: Rng, emit: EventSink): void {
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const o = state.orders[i];
    if (o && o.expiresAt <= state.time) {
      state.orders.splice(i, 1);
      emit({ type: 'orderExpired', orderId: o.id, species: o.species });
    }
  }

  if (state.time < state.nextOrderAt) return;
  if (state.orders.length >= BALANCE.orderMaxActive) {
    // 桌上已經排滿了就往後延，不要偷偷累積一堆待生成的訂單
    state.nextOrderAt = state.time + BALANCE.orderIntervalMin;
    return;
  }
  const o = generateOrder(state, rng);
  state.orders.push(o);
  state.nextOrderAt = state.time + range(rng, BALANCE.orderIntervalMin, BALANCE.orderIntervalMax);
  emit({ type: 'orderNew', orderId: o.id, species: o.species, qty: o.qty, price: o.price });
}
