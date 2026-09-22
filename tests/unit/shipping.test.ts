import { describe, expect, it } from 'vitest';
import { craft, nearestPendingOrder, shipDesserts } from '../../src/game/actions';
import { BALANCE } from '../../src/game/balance';
import { runAutomation } from '../../src/game/equipment';
import { dessertPrice } from '../../src/game/species';
import type { GameState, Order } from '../../src/game/state';
import { makeWorld } from './helpers';

/**
 * 2026-09-22 使用者回報：「焦糖布丁塔任務出貨後沒有解開任務獲得獎勵」。
 *
 * 成因：手動「出貨」按鈕在 `main.ts` 自己抄了一份販售邏輯，少了「訂單預留量」那一段。
 * 訂單要 ×2 而手上只有 1 份時，那 1 份會被當成多餘的甜點賣掉，於是永遠湊不到第二份。
 * 被測試覆蓋的是 `equipment.autoSell` 那份正確的，所以一路綠燈。
 */

const noop = () => {};

function order(state: GameState, qty: number, over = false): Order {
  const o: Order = {
    id: `o${state.nextId++}`,
    species: 'caramel',
    qty,
    price: 999,
    createdAt: state.time,
    expiresAt: over ? state.time - 1 : state.time + BALANCE.orderTtlSec,
  };
  state.orders.push(o);
  return o;
}

describe('出貨：訂單預留量', () => {
  it('訂單要 ×2 而手上只有 1 份時，那份不可以被賣掉', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 2);
    s.desserts.caramel = 1;
    const coins = s.coins;

    const r = shipDesserts(s, noop);

    expect(r.fulfilled).toBe(0);
    expect(r.sold).toBe(0);
    expect(s.desserts.caramel).toBe(1); // 留著等第二份
    expect(s.orders).toHaveLength(1);
    expect(s.coins).toBe(coins);
  });

  it('湊到 2 份再按出貨就會交貨並拿到訂單價', () => {
    const w = makeWorld();
    const s = w.state;
    const o = order(s, 2);
    s.desserts.caramel = 1;
    shipDesserts(s, noop); // 第一次：什麼都不該發生
    s.desserts.caramel = 2;
    const coins = s.coins;

    const r = shipDesserts(s, noop);

    expect(r.fulfilled).toBe(1);
    expect(s.orders).toHaveLength(0);
    expect(s.coins).toBe(coins + o.price);
    expect(s.desserts.caramel).toBe(0);
  });

  it('多出來的才直接賣：訂單 ×2、手上 3 份 → 交 2 賣 1', () => {
    const w = makeWorld();
    const s = w.state;
    const o = order(s, 2);
    s.desserts.caramel = 3;
    const coins = s.coins;

    const r = shipDesserts(s, noop);

    expect(r.fulfilled).toBe(1);
    expect(r.sold).toBe(1);
    expect(s.coins).toBe(coins + o.price + dessertPrice('caramel', BALANCE.dessertPriceMult));
    expect(s.desserts.caramel).toBe(0);
  });

  it('過期的訂單不預留：那些甜點照樣賣得掉', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 2, true); // 已過期
    s.desserts.caramel = 1;

    const r = shipDesserts(s, noop);

    expect(r.fulfilled).toBe(0);
    expect(r.sold).toBe(1);
    expect(s.desserts.caramel).toBe(0);
  });

  it('沒有訂單時照舊全部賣掉（別把甜點鎖在庫存裡）', () => {
    const w = makeWorld();
    const s = w.state;
    s.desserts.caramel = 4;

    const r = shipDesserts(s, noop);

    expect(r.sold).toBe(4);
    expect(s.desserts.caramel).toBe(0);
  });

  it('負向對照：若不扣預留量（模擬舊的 main.ts 寫法），那 1 份就會被賣掉、訂單交不出去', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 2);
    s.desserts.caramel = 1;

    // 舊寫法：湊不夠就跳過交貨，然後把剩下的全賣掉
    for (const o of [...s.orders]) if (s.desserts[o.species] >= o.qty) void o;
    s.coins += dessertPrice('caramel', BALANCE.dessertPriceMult) * s.desserts.caramel;
    s.desserts.caramel = 0;

    expect(s.desserts.caramel).toBe(0); // 湊到一半的甜點沒了
    expect(s.orders).toHaveLength(1); // 訂單還掛著 → 使用者回報的症狀
  });

  it('手動出貨與自動販售口結果一致（同一個函式，不會再各寫一份）', () => {
    const manual = makeWorld();
    const auto = makeWorld();
    for (const w of [manual, auto]) {
      const s = w.state;
      order(s, 2);
      s.ingredients.caramel = BALANCE.ingredientsPerDessert * 3;
      for (let i = 0; i < 3; i++) craft(s, 'caramel', noop);
    }
    auto.state.equipment.seller = true;

    shipDesserts(manual.state, noop);
    runAutomation(auto.state, noop);

    expect(manual.state.coins).toBe(auto.state.coins);
    expect(manual.state.desserts.caramel).toBe(auto.state.desserts.caramel);
    expect(manual.state.orders.length).toBe(auto.state.orders.length);
  });
});

/**
 * 2026-09-22 使用者回報：「出貨按鍵有時按不了」。
 * 存檔碼實況：裝了加工機＋自動販售口、桌上一張「焦糖布丁塔 ×3」的單。
 * 甜點被那張單預留住的期間，按鈕是亮的（甜點數 > 0）、按下去卻一份都沒出去，
 * 而且完全沒有任何字——玩家看到的就是一顆壞掉的按鈕。
 * 預留規則本身是對的（上面那組測試在守），缺的是「講出來」的材料。
 */
describe('出貨什麼都沒出去時，要有材料講出原因', () => {
  it('甜點全被進行中的訂單扣住：fulfilled／sold 都是 0，但 reserved 要算得出來', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 3);
    s.desserts.caramel = 2;

    const r = shipDesserts(s, noop);

    expect(r.fulfilled).toBe(0);
    expect(r.sold).toBe(0);
    expect(r.reserved).toBe(2); // 手上這 2 份是被扣住的，不是「沒有甜點」
  });

  it('預留量比手上的多時，只算真的被扣住的那幾份', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 3);
    order(s, 3); // 兩張單共預留 6 份
    s.desserts.caramel = 1;

    expect(shipDesserts(s, noop).reserved).toBe(1);
  });

  it('真的沒甜點就是 0，不可以誤報成「被訂單扣住」', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 3);

    const r = shipDesserts(s, noop);

    expect(r.reserved).toBe(0);
  });

  it('全部出得掉的時候 reserved 是 0', () => {
    const w = makeWorld();
    const s = w.state;
    s.desserts.caramel = 4;

    expect(shipDesserts(s, noop).reserved).toBe(0);
  });

  it('要說得出是哪一張單在扣、還差幾份', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 3);
    s.desserts.caramel = 2;

    const pending = nearestPendingOrder(s);

    expect(pending?.order.qty).toBe(3);
    expect(pending?.short).toBe(1);
  });

  it('缺最少的那一張優先講（玩家最快湊得出來的那張）', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 5);
    order(s, 3);
    s.desserts.caramel = 2;

    expect(nearestPendingOrder(s)?.short).toBe(1);
  });

  it('過期的訂單不算——它不會扣住任何東西', () => {
    const w = makeWorld();
    const s = w.state;
    order(s, 3, true);
    s.desserts.caramel = 1;

    expect(nearestPendingOrder(s)).toBeNull();
    expect(shipDesserts(s, noop).reserved).toBe(0);
  });
});
