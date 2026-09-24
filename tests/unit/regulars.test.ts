import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { clockAt, dayClock } from '../../src/game/clock';
import type { SimEvent } from '../../src/game/events';
import { levelFor } from '../../src/game/level';
import { dessertPrice } from '../../src/game/recipes';
import { REGULAR_STORIES } from '../../src/game/regularStories';
import {
  MAX_HEARTS,
  REGULARS,
  REGULAR_BALANCE,
  REGULAR_IDS,
  addHearts,
  awaySummary,
  checkUnlocks,
  deliverOrder,
  minStarFor,
  regularWants,
  scheduleFirstVisit,
  storyChapters,
  tasteDesserts,
  tasteMatches,
  tickRegulars,
} from '../../src/game/regulars';
import { advance } from '../../src/game/sim';
import { useStarTonic } from '../../src/game/stars';
import { addStock, stockOf } from '../../src/game/stock';
import { makeWorld, only } from './helpers';

const sink = () => {};

/** 收這次呼叫期間 regulars 自己發出的事件（跟 world 的 w.emit 分開，AC11-9 要驗證型別只有這四種） */
function collectRegularEvents(fn: (emit: (e: SimEvent) => void) => void): SimEvent[] {
  const out: SimEvent[] = [];
  fn((e) => out.push(e));
  return out;
}

describe('AC11-7 常客到店', () => {
  it('架上有符合口味且 ≥ 最低星級的：買 1 份、付星級價 ×1.2、hearts+1、排定下一次', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.nextVisitAt = 50;
    addStock(s, 'shelf', 'caramel', 1, 1);
    const coinsBefore = s.coins;
    const soldBefore = s.stats.sold;
    const events = collectRegularEvents((emit) => tickRegulars(s, w.rng, emit));

    expect(stockOf(s, 'shelf', 'caramel', 1)).toBe(0);
    expect(s.coins - coinsBefore).toBe(Math.round(dessertPrice('caramel', 1) * REGULAR_BALANCE.tip));
    expect(s.regulars.bear.hearts).toBe(1);
    expect(s.stats.sold).toBe(soldBefore + 1);
    expect(s.stats.regularsServed).toBe(1);
    expect(s.regulars.bear.lastResult).toEqual({ at: 100, day: dayClock(s).day, bought: true, dessert: 'caramel', star: 1, coins: s.coins - coinsBefore, gift: null });
    expect(s.regulars.bear.nextVisitAt).toBeGreaterThan(100);
    const v = events.find((e) => e.type === 'regularVisit');
    expect(v && v.type === 'regularVisit' && v.bought).toBe(true);
  });

  it('架上沒有符合口味＋星級的：好感不變、lastResult 記沒買到', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.nextVisitAt = 50;
    // 抹茶不含 caramel 等位基因，熊先生（焦糖系）不該買
    addStock(s, 'shelf', 'matcha', 5, 3);
    const events = collectRegularEvents((emit) => tickRegulars(s, w.rng, emit));

    expect(s.regulars.bear.hearts).toBe(0);
    expect(stockOf(s, 'shelf', 'matcha', 5)).toBe(3);
    expect(s.regulars.bear.lastResult).toMatchObject({ bought: false, dessert: null, star: null, coins: 0, gift: null });
    const v = events.find((e) => e.type === 'regularVisit');
    expect(v && v.type === 'regularVisit' && v.bought).toBe(false);
  });

  it('口味不符的高星甜點不買（焦糖系不收草莓系，即使 ★5 也不買）', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true; // 焦糖系（allele: caramel）
    s.regulars.bear.nextVisitAt = 50;
    addStock(s, 'shelf', 'strawberry', 5, 1); // 草莓系跟焦糖無關，即使高星也不該買
    tickRegulars(s, w.rng, sink);
    expect(s.regulars.bear.hearts).toBe(0);
    expect(stockOf(s, 'shelf', 'strawberry', 5)).toBe(1);
  });

  it('焦糖系（等位基因口味）收混種：架上只有卡士達（含 caramel 等位基因）也會買', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.nextVisitAt = 50;
    addStock(s, 'shelf', 'custard', 1, 1);
    tickRegulars(s, w.rng, sink);
    expect(s.regulars.bear.lastResult).toMatchObject({ bought: true, dessert: 'custard', star: 1 });
  });

  it('最低星級隨好感上升：★1 開局收 ★1；好感 4 之後只收 ★2 以上', () => {
    expect(minStarFor('bear', 0)).toBe(1);
    expect(minStarFor('bear', 3)).toBe(1);
    expect(minStarFor('bear', 4)).toBe(2);
    expect(minStarFor('bear', 7)).toBe(2);
    expect(minStarFor('bear', 8)).toBe(3);

    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.hearts = 4;
    s.regulars.bear.nextVisitAt = 50;
    addStock(s, 'shelf', 'caramel', 1, 1); // 只有 ★1，這時最低星級已經是 ★2
    tickRegulars(s, w.rng, sink);
    expect(s.regulars.bear.lastResult?.bought).toBe(false);
    expect(stockOf(s, 'shelf', 'caramel', 1)).toBe(1);
  });
});

describe('AC11-8 好感獎勵', () => {
  it('♥2／8／10 解鎖對應章節（storyChapters）', () => {
    expect(storyChapters(0)).toBe(0);
    expect(storyChapters(1)).toBe(0);
    expect(storyChapters(2)).toBe(1);
    expect(storyChapters(7)).toBe(1);
    expect(storyChapters(8)).toBe(2);
    expect(storyChapters(9)).toBe(2);
    expect(storyChapters(10)).toBe(3);
  });

  it('♥4 起來店開特別訂單；同時最多一張', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.hearts = 3; // 買到之後跨到 4
    s.regulars.bear.nextVisitAt = 50;
    addStock(s, 'shelf', 'caramel', 1, 1);
    const events = collectRegularEvents((emit) => tickRegulars(s, w.rng, emit));

    expect(s.regulars.bear.hearts).toBe(4);
    expect(s.orders).toHaveLength(1);
    const o = s.orders[0]!;
    expect(o.regularId).toBe('bear');
    expect(o.star).toBe(minStarFor('bear', 4));
    expect(o.qty).toBeGreaterThanOrEqual(REGULAR_BALANCE.orderQtyMin);
    expect(o.qty).toBeLessThanOrEqual(REGULAR_BALANCE.orderQtyMax);
    expect(o.price).toBe(Math.round(dessertPrice(o.species, o.star as 1 | 2 | 3 | 4 | 5) * o.qty * REGULAR_BALANCE.orderRewardMult));
    expect(o.expiresAt - o.createdAt).toBe(REGULAR_BALANCE.orderDays * BALANCE.bakery.dayLengthSec);
    expect(events.some((e) => e.type === 'regularOrder')).toBe(true);

    // 再來一次：訂單還在，不會開第二張
    s.regulars.bear.nextVisitAt = s.time;
    addStock(s, 'shelf', 'caramel', 1, 1);
    tickRegulars(s, w.rng, sink);
    expect(s.orders).toHaveLength(1);
  });

  it('♥6 起送禮機率 30%（固定亂數，次數落在期望 ±3σ）', () => {
    const w = makeWorld({ seed: 42, puddings: 1 });
    const s = w.state;
    s.time = 1000;
    s.regulars.bear.unlocked = true;
    const N = 2000;
    let gifts = 0;
    for (let i = 0; i < N; i++) {
      s.regulars.bear.hearts = 6;
      s.regulars.bear.nextVisitAt = s.time;
      addStock(s, 'shelf', 'caramel', minStarFor('bear', 6), 1);
      const events = collectRegularEvents((emit) => tickRegulars(s, w.rng, emit));
      const v = events.find((e) => e.type === 'regularVisit');
      if (v && v.type === 'regularVisit' && v.gift) gifts++;
      s.time += 1;
    }
    const p = REGULAR_BALANCE.giftChance;
    const mean = N * p;
    const sigma = Math.sqrt(N * p * (1 - p));
    expect(gifts).toBeGreaterThan(mean - 3 * sigma);
    expect(gifts).toBeLessThan(mean + 3 * sigma);
  });

  it('♥8 解鎖下一位（第一代介紹朋友）', () => {
    const w = makeWorld();
    const s = w.state;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.hearts = 7;
    const events = collectRegularEvents((emit) => addHearts(s, 'bear', 1, emit));
    expect(s.regulars.owl.unlocked).toBe(true);
    expect(s.regulars.owl.nextVisitAt).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'regularUnlocked' && e.id === 'owl')).toBe(true);
  });

  it('第二代 ♥8 沒有朋友可介紹，改送禮（貓頭鷹教授＝升星藥）', () => {
    const w = makeWorld();
    const s = w.state;
    s.regulars.owl.unlocked = true;
    s.regulars.owl.hearts = 7;
    const before = s.items.starTonic;
    addHearts(s, 'owl', 1, sink);
    expect(REGULARS.owl.friend).toBeNull();
    expect(s.items.starTonic).toBe(before + 1);
  });

  it('第二代 ♥8 沒有朋友可介紹，改送禮（狐狸小姐只吃草莓烤布蕾＝送布蕾原料）', () => {
    const w = makeWorld();
    const s = w.state;
    expect(REGULARS.fox.taste).toEqual({ kind: 'species', species: 'brulee' });
    s.regulars.fox.unlocked = true;
    s.regulars.fox.hearts = 7;
    const before = stockOf(s, 'ingredients', 'brulee');
    addHearts(s, 'fox', 1, sink);
    expect(stockOf(s, 'ingredients', 'brulee')).toBe(before + REGULAR_BALANCE.giftIngredients);
  });

  it('好感夾在 0–10，reached 只在真的跨過門檻那一刻回傳', () => {
    const w = makeWorld();
    const s = w.state;
    s.regulars.bear.unlocked = true;
    const e1 = collectRegularEvents((emit) => addHearts(s, 'bear', 1, emit));
    expect((e1.find((e) => e.type === 'hearts') as Extract<SimEvent, { type: 'hearts' }>).reached).toBe(null);
    const e2 = collectRegularEvents((emit) => addHearts(s, 'bear', 1, emit));
    expect((e2.find((e) => e.type === 'hearts') as Extract<SimEvent, { type: 'hearts' }>).reached).toBe(2);
    addHearts(s, 'bear', 100, sink);
    expect(s.regulars.bear.hearts).toBe(MAX_HEARTS);
  });

  it('升星藥突破潛力上限只在已達上限時連潛力 +1', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    const p = only(s);
    s.zones.find((z) => z.id === s.activeZone)!.mode = 'elite';
    s.items.starTonic = 2;

    // 還沒到潛力上限：只升星，潛力不動
    p.star = 1;
    p.potential = 3;
    expect(useStarTonic(s, p.id, sink).ok).toBe(true);
    expect([p.star, p.potential]).toEqual([2, 3]);

    // 已經在潛力上限：星與潛力一起 +1（唯一突破世代上限的辦法，D67）
    p.star = 3;
    p.potential = 3;
    expect(useStarTonic(s, p.id, sink).ok).toBe(true);
    expect([p.star, p.potential]).toEqual([4, 4]);
    expect(s.items.starTonic).toBe(0);
  });
});

describe('AC11-9 離線結算', () => {
  it('離線 8 小時：常客照樣到店結算，好感增加量＝實際買到的次數；每次到店一個 regularVisit、沒有 toast 型事件', () => {
    const w = makeWorld({ seed: 7, puddings: 1 });
    const s = w.state;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.nextVisitAt = 100;
    const startedAt = s.time;

    // 走真正的離線路徑（sim 的 `advance` 每一步都會跑 tickRegulars），攔下整個 world 的事件流
    const all: SimEvent[] = [];
    w.emit = (e) => all.push(e);
    const totalSec = 8 * 3600; // AC11-9：8 小時＝24 個營業日（dayLengthSec=1200）
    const step = 20;
    for (let left = totalSec; left > 0; left -= step) {
      addStock(s, 'shelf', 'caramel', 1, 5); // 保持有貨，避免因為好感升高、缺高星貨而斷買
      advance(w, step);
    }

    const visits = all.filter((e) => e.type === 'regularVisit');
    expect(visits.length).toBeGreaterThan(0);
    // 每次到店恰好一個 regularVisit（UI 不拿它做 toast，只在看著工坊時演出）
    expect(visits.length).toBe(s.regulars.bear.visits);
    const boughtCount = visits.filter((e) => e.type === 'regularVisit' && e.bought).length;
    expect(boughtCount).toBeGreaterThan(0);
    expect(s.regulars.bear.hearts).toBe(boughtCount);
    // 常客的特別訂單不走散客的 orderNew（那個會被 UI 做成 toast）
    const regularOrderIds = new Set(all.flatMap((e) => (e.type === 'regularOrder' ? [e.orderId] : [])));
    expect(all.some((e) => e.type === 'orderNew' && regularOrderIds.has(e.orderId))).toBe(false);

    const summary = awaySummary(s, startedAt);
    const bearSummary = summary.find((x) => x.id === 'bear');
    expect(bearSummary).toBeDefined();
    expect(bearSummary!.result.at).toBeGreaterThan(startedAt);
  });

  it('實測：買到那一份的 grantXp 跨等級門檻時，regulars 自己的事件流會夾帶 levelUp（規格內部的已知衝突，見回報）', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.time = 100;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.nextVisitAt = 50;
    s.xp = BALANCE.levelXp[1]! - BALANCE.xp.sellDessert; // 差一次賣出的 xp 就跨級
    addStock(s, 'shelf', 'caramel', 1, 1);
    const events = collectRegularEvents((emit) => tickRegulars(s, w.rng, emit));
    expect(levelFor(s.xp)).toBe(2);
    // D51 的 dayClosed 教訓是「不要逐條 toast」；levelUp 本身一次只發一次不是逐條，
    // 但它確實不在 D67 列的四種型別裡——這裡先如實記錄行為，不自行擴大 allowed 名單。
    expect(events.some((e) => e.type === 'levelUp')).toBe(true);
  });
});

describe('checkUnlocks（D66）', () => {
  it('open 規則：湊齊一條線就解鎖熊先生', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    expect(s.regulars.bear.unlocked).toBe(false);
    s.bakery.machines.stove = 1;
    s.bakery.machines.crack = 1;
    s.bakery.machines.mix = 1;
    s.bakery.machines.mold = 1;
    s.bakery.machines.bake = 1;
    s.bakery.machines.decorate = 1; // caramel 這條線的六站
    const unlocked = checkUnlocks(s, sink);
    expect(unlocked).toContain('bear');
    expect(s.regulars.bear.unlocked).toBe(true);
    expect(s.regulars.bear.nextVisitAt).toBeGreaterThan(0);
    // 已解鎖的再判一次不會重排
    const before = s.regulars.bear.nextVisitAt;
    checkUnlocks(s, sink);
    expect(s.regulars.bear.nextVisitAt).toBe(before);
  });

  it('allele 規則：要同時有等位基因跟人氣門檻', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    only(s).genes = ['strawberry', 'strawberry'];
    only(s).species = 'strawberry';
    s.bakery.fame = 2;
    checkUnlocks(s, sink);
    expect(s.regulars.rabbit.unlocked).toBe(false); // 人氣不夠
    s.bakery.fame = 3;
    checkUnlocks(s, sink);
    expect(s.regulars.rabbit.unlocked).toBe(true);
  });

  it('friend 規則不在 checkUnlocks 判（貓頭鷹教授只能靠熊先生 ♥8）', () => {
    const w = makeWorld({ puddings: 1 });
    checkUnlocks(w.state, sink);
    expect(w.state.regulars.owl.unlocked).toBe(false);
  });
});

describe('scheduleFirstVisit（確定性）', () => {
  it('明天、四位一組錯開 2.5 小時，不吃亂數', () => {
    const w = makeWorld();
    const s = w.state;
    const today = dayClock(s).day;
    scheduleFirstVisit(s, 'bear'); // REGULAR_IDS 索引 0
    scheduleFirstVisit(s, 'owl'); // 索引 4，(4 % 4) === 0，跟熊先生同一格
    scheduleFirstVisit(s, 'rabbit'); // 索引 1，晚熊先生 2.5 小時
    expect(s.regulars.bear.nextVisitAt).toBe(s.regulars.owl.nextVisitAt);
    expect(s.regulars.rabbit.nextVisitAt - s.regulars.bear.nextVisitAt).toBeCloseTo((2.5 / 24) * BALANCE.bakery.dayLengthSec, 6);
    expect(clockAt(s, s.regulars.bear.nextVisitAt).day).toBe(today + 1);
    // 兩次呼叫結果一樣：不吃亂數
    const before = s.regulars.bear.nextVisitAt;
    scheduleFirstVisit(s, 'bear');
    expect(s.regulars.bear.nextVisitAt).toBe(before);
  });
});

describe('deliverOrder（D67）', () => {
  it('成功交單再補好感（heartsPerOrder），失敗不補', () => {
    const w = makeWorld({ puddings: 1 });
    const s = w.state;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.hearts = 5;
    const orderId = `o${s.nextId++}`;
    s.orders.push({ id: orderId, species: 'caramel', qty: 2, price: 100, createdAt: s.time, expiresAt: s.time + 10000, regularId: 'bear', star: 1 });
    // 成品櫃與展示架都還沒有貨：交單失敗
    expect(deliverOrder(s, orderId, sink).ok).toBe(false);
    expect(s.regulars.bear.hearts).toBe(5);

    addStock(s, 'desserts', 'caramel', 1, 2);
    expect(deliverOrder(s, orderId, sink).ok).toBe(true);
    expect(s.regulars.bear.hearts).toBe(5 + REGULAR_BALANCE.heartsPerOrder);
  });
});

describe('regularWants（D70）', () => {
  it('只列今天還沒來、已解鎖的常客', () => {
    const w = makeWorld();
    const s = w.state;
    s.regulars.bear.unlocked = true;
    s.regulars.bear.hearts = 4;
    s.regulars.bear.nextVisitAt = s.time + 1; // 今天稍後
    const wants = regularWants(s);
    expect(wants).toHaveLength(1);
    expect(wants[0]!.accepts).toEqual(tasteDesserts(REGULARS.bear.taste));
    expect(wants[0]!.minStar).toBe(minStarFor('bear', 4));

    s.regulars.bear.nextVisitAt = s.time - 1; // 已經過了（今天已經來過或錯過）
    expect(regularWants(s)).toHaveLength(0);
  });
});

describe('regularStories（D67）文案完整性', () => {
  it('八位都有招牌與三章，不留 Markdown 粗體或「→ 解鎖」尾巴', () => {
    for (const id of REGULAR_IDS) {
      const story = REGULAR_STORIES[id];
      expect(story.signature.length).toBeGreaterThan(0);
      expect(story.chapters).toHaveLength(3);
      for (const ch of story.chapters) {
        expect(ch.title.length).toBeGreaterThan(0);
        expect(ch.body.length).toBeGreaterThan(0);
        expect(ch.title).not.toMatch(/\*\*/);
        expect(ch.body).not.toMatch(/\*\*/);
        expect(ch.body).not.toMatch(/→\s*解鎖/);
      }
    }
  });
});

describe('tasteMatches／tasteDesserts', () => {
  it('species 口味只認那一種', () => {
    expect(tasteMatches(REGULARS.owl.taste, 'hojicha')).toBe(true);
    expect(tasteMatches(REGULARS.owl.taste, 'caramel')).toBe(false);
    expect(tasteDesserts(REGULARS.owl.taste)).toEqual(['hojicha']);
  });

  it('allele 口味認純種與含那個等位基因的混種', () => {
    const list = tasteDesserts(REGULARS.bear.taste);
    expect(list).toContain('caramel');
    expect(list).toContain('custard');
    expect(list).toContain('hojicha');
    expect(list).toContain('brulee');
    expect(list).not.toContain('matcha');
  });
});

