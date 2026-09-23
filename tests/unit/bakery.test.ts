import { describe, expect, it } from 'vitest';
import { puddingSaleBlock, sellIngredient, sellPudding } from '../../src/game/actions';
import { ACHIEVEMENTS, achievementStatus, claimAchievement, claimableCount } from '../../src/game/achievements';
import {
  STATION_IDS,
  advanceStation,
  dayClock,
  fulfillOrder,
  shelfCount,
  startBatch,
  stationStatus,
  stockShelf,
} from '../../src/game/bakery';
import { BALANCE, RETIRED_EQUIPMENT_PRICE } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import { advance } from '../../src/game/sim';
import { SPECIES, SPECIES_IDS, dessertPrice, puddingPrice } from '../../src/game/species';
import { createNewSave, migrate, SCHEMA_VERSION, type GameState } from '../../src/game/state';
import { START_ZONE, zoneKey } from '../../src/game/zones';
import { makeWorld } from './helpers';

const sink = (_e: SimEvent) => {};
const B = BALANCE.bakery;
const Q = B.batchSize;

function stocked(): GameState {
  const s = createNewSave({ seed: 3, now: 0 });
  s.eggs = Q * BALANCE.eggsPerDessert;
  s.ingredients.caramel = Q * BALANCE.ingredientsPerDessert;
  return s;
}

/** 讓某一站做完（直接把時間推到它的 doneAt） */
function finish(s: GameState, id: (typeof STATION_IDS)[number]) {
  s.time = Math.max(s.time, s.bakery.stations[id].doneAt);
}

describe('AC8-1 五站流水線走得完', () => {
  it('一盤從打蛋推到裝飾，成品 +batchSize、蛋與原料剛好扣完', () => {
    const s = stocked();
    expect(startBatch(s, 'caramel', sink).ok).toBe(true);
    expect(s.eggs).toBe(0); // 打蛋扣蛋
    expect(s.ingredients.caramel).toBe(Q); // 原料到攪拌才扣
    for (const id of STATION_IDS) {
      expect(stationStatus(s, id)).toBe('working');
      finish(s, id);
      expect(stationStatus(s, id)).toBe('ready');
      expect(advanceStation(s, id, sink).ok).toBe(true);
      if (id === 'crack') expect(s.ingredients.caramel).toBe(0);
    }
    expect(s.desserts.caramel).toBe(Q);
    expect(s.stats.baked).toBe(Q);
    for (const id of STATION_IDS) expect(stationStatus(s, id)).toBe('idle');
  });

  it('還沒做完推不動，state 不變', () => {
    const s = stocked();
    startBatch(s, 'caramel', sink);
    const before = JSON.stringify(s);
    expect(advanceStation(s, 'crack', sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('下一站還有一盤就留在原站（流水線節流），不會把兩盤疊在一起', () => {
    const s = stocked();
    s.eggs *= 2;
    s.ingredients.caramel *= 2;
    startBatch(s, 'caramel', sink);
    finish(s, 'crack');
    advanceStation(s, 'crack', sink); // 第一盤到攪拌
    startBatch(s, 'caramel', sink); // 第二盤在打蛋
    finish(s, 'crack');
    expect(stationStatus(s, 'mix')).toBe('working');
    expect(advanceStation(s, 'crack', sink).ok).toBe(false);
    expect(s.bakery.stations.crack.batch).not.toBeNull();
  });

  it('烘烤是最久的一步（「烘焙甜點需要時間」）', () => {
    for (const id of STATION_IDS) if (id !== 'bake') expect(B.stepSec.bake!).toBeGreaterThan(B.stepSec[id]!);
  });

  it('模擬自己不會推站：沒裝自動化時，做完的那盤停在原站等玩家', () => {
    const w = makeWorld({ puddings: 1 });
    Object.assign(w.state, { eggs: 99 });
    w.state.ingredients.caramel = 99;
    startBatch(w.state, 'caramel', sink);
    advance(w, 30);
    expect(stationStatus(w.state, 'crack')).toBe('ready');
    expect(stationStatus(w.state, 'mix')).toBe('idle');
  });

  it('自動化旗標打開的站會自己推（規則層先做好，商店之後才上架）', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.eggs = 99;
    w.state.ingredients.caramel = 99;
    for (const id of STATION_IDS) w.state.bakery.auto[id] = true;
    advance(w, 200);
    expect(w.state.stats.baked).toBeGreaterThan(0);
  });
});

describe('AC8-2 開工前驗齊整盤材料', () => {
  it('蛋夠、原料不夠：打蛋站開不了工，state 不變', () => {
    const s = stocked();
    s.ingredients.caramel = Q * BALANCE.ingredientsPerDessert - 1;
    const before = JSON.stringify(s);
    const r = startBatch(s, 'caramel', sink);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('蛋不夠也開不了', () => {
    const s = stocked();
    s.eggs -= 1;
    expect(startBatch(s, 'caramel', sink).ok).toBe(false);
  });

  it('打蛋之後把原料賣掉：攪拌站推不過去、那盤留在打蛋站（不會憑空做出甜點）', () => {
    const s = stocked();
    startBatch(s, 'caramel', sink);
    sellIngredient(s, 'caramel', s.ingredients.caramel, sink);
    finish(s, 'crack');
    expect(advanceStation(s, 'crack', sink).ok).toBe(false);
    expect(s.bakery.stations.crack.batch).not.toBeNull();
  });
});

describe('AC8-3 營業日從 epoch 起算', () => {
  it('新檔：第 1 天 07:00 開門', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const c = dayClock(s);
    expect(c.day).toBe(1);
    expect(c.hour).toBeCloseTo(B.openHour);
    expect(c.open).toBe(true);
  });

  it('time 很大的 v7 舊檔升上來：第 1 天、營業中（不是 Day 30）', () => {
    const old = createNewSave({ seed: 1, now: 0 }) as unknown as Record<string, unknown>;
    old.time = 36000;
    old.schemaVersion = 7;
    delete old.bakery;
    const s = migrate(JSON.parse(JSON.stringify(old)), { seed: 1, now: 0 });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    const c = dayClock(s);
    expect(c.day).toBe(1);
    expect(c.open).toBe(true);
  });

  it('營業 07:00–21:00，21:00 打烊', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const hourSec = B.dayLengthSec / 24;
    s.time = (B.closeHour - B.openHour) * hourSec - 1;
    expect(dayClock(s).open).toBe(true);
    s.time += 2;
    expect(dayClock(s).open).toBe(false);
    s.time = B.dayLengthSec; // 隔天 07:00
    expect(dayClock(s)).toMatchObject({ day: 2, open: true });
  });
});

describe('AC8-4 客人、打烊結算', () => {
  it('營業中客人從展示架買走、架空就記錯過；打烊不來客', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.bakery.shelf.caramel = 3;
    const coins = w.state.coins;
    advance(w, B.customerIntervalMax * 6);
    expect(w.state.bakery.shelf.caramel).toBe(0);
    expect(w.state.coins).toBeGreaterThanOrEqual(coins + 3 * dessertPrice('caramel'));
    expect(w.state.stats.served).toBeGreaterThan(0);
    expect(w.state.bakery.today.missed).toBeGreaterThan(0);
  });

  it('離線跑 3 天：結算 3 次、lastDay 是最後一天、事件裡每天一個 dayClosed', () => {
    const w = makeWorld({ puddings: 1 });
    const events: SimEvent[] = [];
    w.emit = (e) => events.push(e);
    w.state.bakery.shelf.caramel = 5;
    advance(w, B.dayLengthSec * 3);
    expect(w.state.stats.daysClosed).toBe(3);
    expect(w.state.bakery.lastDay?.day).toBe(3);
    expect(events.filter((e) => e.type === 'dayClosed')).toHaveLength(3);
    // 營收只算第一天賣掉的那 5 份，而且記在 bestDayRevenue（單調）
    expect(w.state.stats.bestDayRevenue).toBeGreaterThanOrEqual(5 * dessertPrice('caramel'));
  });

  it('上架不會把預訂單要的份數擺出去', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.desserts.matcha = 3;
    s.orders.push({ id: 'o1', species: 'matcha', qty: 2, price: 999, createdAt: 0, expiresAt: 9999 });
    expect(stockShelf(s, sink)).toBe(1);
    expect(s.desserts.matcha).toBe(2);
    expect(fulfillOrder(s, 'o1', sink).ok).toBe(true);
    expect(s.stats.ordersDone).toBe(1);
  });

  it('上架不超過架子上限', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.desserts.caramel = B.shelfCap + 5;
    stockShelf(s, sink);
    expect(shelfCount(s)).toBe(B.shelfCap);
    expect(s.desserts.caramel).toBe(5);
  });

  it('預訂單成品櫃不夠時從展示架補', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.desserts.caramel = 1;
    s.bakery.shelf.caramel = 2;
    s.orders.push({ id: 'o1', species: 'caramel', qty: 3, price: 100, createdAt: 0, expiresAt: 9999 });
    expect(fulfillOrder(s, 'o1', sink).ok).toBe(true);
    expect(s.desserts.caramel + s.bakery.shelf.caramel).toBe(0);
  });
});

describe('AC8-5 v7 → v8：退役設備退款、成品保留', () => {
  function v7(): Record<string, unknown> {
    const s = createNewSave({ seed: 9, now: 0 });
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.schemaVersion = 7;
    delete raw.bakery;
    delete raw.claimedAchievements;
    delete raw.speciesSeen;
    const upper = zoneKey(0, 2);
    (raw.zones as { id: string; unlocked: boolean }[]).find((z) => z.id === upper)!.unlocked = true;
    raw.equipment = {
      [START_ZONE]: { autoFill: true, collector: true, crafter: true, seller: false, restock: false },
      [upper]: { autoFill: false, collector: false, crafter: true, seller: false, restock: false },
    };
    raw.storedEquipment = { autoFill: 0, collector: 0, crafter: 0, seller: 1, restock: 0 };
    raw.equipmentPos = { [START_ZONE]: { crafter: { x: 0, z: 0 }, collector: { x: 0.1, z: 0.1 } } };
    raw.coins = 10;
    raw.desserts = { caramel: 4 };
    return raw;
  }

  it('兩區的加工機＋倉庫一台販賣機全部照原價退款；設備與位置紀錄消失', () => {
    const s = migrate(v7(), { seed: 1, now: 0 });
    expect(s.coins).toBe(10 + 2 * RETIRED_EQUIPMENT_PRICE.crafter! + RETIRED_EQUIPMENT_PRICE.seller!);
    expect(Object.keys(s.equipment[START_ZONE]!)).toEqual(['autoFill', 'collector', 'restock']);
    expect(Object.keys(s.storedEquipment)).toEqual(['autoFill', 'collector', 'restock']);
    expect(s.equipmentPos[START_ZONE]).toEqual({ collector: { x: 0.1, z: 0.1 } });
    expect(s.equipment[START_ZONE]!.collector).toBe(true);
  });

  it('手上的甜點留著當成品櫃、工坊是空的、養過的物種從住客補', () => {
    const s = migrate(v7(), { seed: 1, now: 0 });
    expect(s.desserts.caramel).toBe(4);
    expect(shelfCount(s)).toBe(0);
    expect(s.speciesSeen).toEqual(['caramel']);
    expect(s.claimedAchievements).toEqual([]);
  });

  it('v8 存檔再讀一次不會再退一次款（冪等）', () => {
    const once = migrate(v7(), { seed: 1, now: 0 });
    const twice = migrate(JSON.parse(JSON.stringify(once)), { seed: 1, now: 0 });
    expect(twice.coins).toBe(once.coins);
  });

  it('工坊進行中的那一盤與展示架經存檔來回都還在', () => {
    const s = stocked();
    startBatch(s, 'caramel', sink);
    s.bakery.shelf.matcha = 2;
    const back = migrate(JSON.parse(JSON.stringify(s)), { seed: 1, now: 0 });
    expect(back.bakery.stations.crack.batch).toEqual({ species: 'caramel', qty: Q });
    expect(back.bakery.shelf.matcha).toBe(2);
  });
});

describe('AC8-7 賣布丁', () => {
  function adults(n: number): GameState {
    const s = createNewSave({ seed: 1, now: 0, puddingCount: n, puddingPositions: Array.from({ length: n }, (_, i) => ({ x: -0.5 + i * 0.2, z: 0 })) });
    s.time = 1000;
    return s;
  }

  it('成年布丁可以賣，錢＝物種原料價 × puddingPriceMult', () => {
    const s = adults(2);
    const p = s.puddings[0]!;
    const coins = s.coins;
    expect(sellPudding(s, p.id, sink).ok).toBe(true);
    expect(s.puddings).toHaveLength(1);
    expect(s.coins).toBe(coins + puddingPrice('caramel'));
    expect(s.stats.puddingsSold).toBe(1);
  });

  it('最後一隻不能賣（牛奶澡要有布丁去泡才生得出來）', () => {
    const s = adults(1);
    const before = JSON.stringify(s);
    expect(sellPudding(s, s.puddings[0]!.id, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('幼布丁、泡澡中不能賣，state 不變', () => {
    const s = adults(3);
    s.puddings[0]!.bornAt = s.time - 1;
    s.puddings[1]!.mode = 'bathing';
    const before = JSON.stringify(s);
    expect(sellPudding(s, s.puddings[0]!.id, sink).ok).toBe(false);
    expect(sellPudding(s, s.puddings[1]!.id, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
    expect(puddingSaleBlock(s, s.puddings[2]!.id)).toBeNull();
  });

  it('正要跳進澡盆的那隻被賣掉，盆的佔位要放掉', () => {
    const s = adults(2);
    const p = s.puddings[0]!;
    p.basinIndex = 0;
    s.basins[0]!.occupantId = p.id;
    sellPudding(s, p.id, sink);
    expect(s.basins[0]!.occupantId).toBeNull();
  });

  it('定價：混種比純種貴、每一種都比牛奶澡的成本高', () => {
    for (const id of SPECIES_IDS) expect(puddingPrice(id)).toBeGreaterThan(BALANCE.startStock.milk ?? 2);
    expect(puddingPrice('sakura')).toBeGreaterThan(puddingPrice('matcha'));
    expect(puddingPrice('custard')).toBeGreaterThan(puddingPrice('caramel'));
  });

  it('甜點一定比「直接賣材料」值錢（進工坊不虧）', () => {
    for (const id of SPECIES_IDS) {
      const materials = BALANCE.eggsPerDessert * BALANCE.eggPrice + SPECIES[id].ingredientPrice;
      expect(dessertPrice(id)).toBeGreaterThan(materials);
    }
  });
});

describe('AC8-8 成就', () => {
  it('達成後要領才入帳；領兩次第二次失敗', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.stats.picked = 1;
    const coins = s.coins;
    const r = claimAchievement(s, 'firstPick', sink);
    expect(r.ok).toBe(true);
    expect(s.coins).toBe(coins + 30);
    const again = claimAchievement(s, 'firstPick', sink);
    expect(again.ok).toBe(false);
    expect(s.coins).toBe(coins + 30);
  });

  it('還沒達成領不到，state 不變', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const before = JSON.stringify(s);
    expect(claimAchievement(s, 'firstBake', sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('花光錢、賣掉布丁都不會讓已達成的成就退回去（只看單調欄位）', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.stats.births = 1;
    s.speciesSeen.push('panna', 'custard', 'matcha', 'hojicha', 'sakura');
    s.coins = 0;
    s.puddings = s.puddings.slice(0, 1);
    const a = (id: string) => achievementStatus(s, ACHIEVEMENTS.find((x) => x.id === id)!);
    expect(a('firstBirth')).toBe('claimable');
    expect(a('species5')).toBe('claimable');
    expect(a('hybrid3')).toBe('claimable');
  });

  it('前七條（開局資金）合計 640 元；id 不重複', () => {
    const early = ['firstPick', 'firstSale', 'firstBath', 'firstBirth', 'firstBake', 'firstCustomer', 'firstDay'];
    const sum = ACHIEVEMENTS.filter((a) => early.includes(a.id)).reduce((n, a) => n + a.reward, 0);
    expect(sum).toBe(640);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('老玩家的舊 stats 算數：撿過泡過的升上來就能領', () => {
    const old = createNewSave({ seed: 1, now: 0 }) as unknown as Record<string, unknown>;
    old.stats = { baths: 50, sold: 20, mutations: 0, picked: 120, crafted: 10, births: 3 };
    delete old.claimedAchievements;
    const s = migrate(JSON.parse(JSON.stringify(old)), { seed: 1, now: 0 });
    expect(claimableCount(s)).toBeGreaterThanOrEqual(4); // firstPick／firstBath／firstBirth／pick100
    const a = (id: string) => achievementStatus(s, ACHIEVEMENTS.find((x) => x.id === id)!);
    expect(a('firstBake')).toBe('locked');
  });

  it('養過的物種在模擬裡自動記下（出生／突變不用各記一次）', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.puddings[0]!.species = 'panna';
    advance(w, 0.5);
    expect(w.state.speciesSeen).toContain('panna');
  });
});
