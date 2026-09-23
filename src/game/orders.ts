import { BALANCE } from './balance';
import type { EventSink } from './events';
import { intRange, pick, range, type Rng } from './rng';
import { anyLineReady, dessertPrice } from './recipes';
import { BASE_SPECIES_IDS, SPECIES_IDS } from './species';
import type { GameState, Order } from './state';

/** 訂單物種有多少比例從「目前住客的物種」抽；其餘從四種純種抽（D25／D28） */
export const ORDER_OWNED_SPECIES_RATIO = 0.8;

/**
 * 訂單卡（經營軸的最小版）。
 * 物種 80% 從玩家養得出來的物種抽、20% 從四種**純種**抽（D25／D28）：
 * 養不出來的那種只能眼睜睜看它過期，這就是「培育多物種」的動機，所以不可以完全不抽；
 * 但只養焦糖時若均抽，大多數訂單注定過期，玩家看到的只是一連串「過期了」。
 *
 * 那 20% 刻意**不含混種**：混種要配好幾代才養得出來，拿它當「引子」等於出一張
 * 看得到吃不到的卡；純種才是「去買個抹茶澡盆」這種下一步做得到的提示。
 */
export function generateOrder(state: GameState, rng: Rng): Order {
  const owned = SPECIES_IDS.filter((id) => state.puddings.some((p) => p.species === id));
  const fromOwned = owned.length > 0 && rng.next() < ORDER_OWNED_SPECIES_RATIO;
  const species = pick(rng, fromOwned ? owned : BASE_SPECIES_IDS);
  const qty = intRange(rng, 1, 3);
  const mult = range(rng, BALANCE.orderPriceMultMin, BALANCE.orderPriceMultMax);
  const unit = dessertPrice(species);
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
  // 還沒湊齊任何一道甜點的整條線：接了單也做不出來，註定過期（D57）
  if (!anyLineReady(state)) {
    state.nextOrderAt = state.time + BALANCE.orderIntervalMin;
    return;
  }
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
