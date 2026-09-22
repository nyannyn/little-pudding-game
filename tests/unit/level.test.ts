import { describe, expect, it } from 'vitest';
import { buyEquipment, buySpecialBasin, buyStock, craft, pickAllDrops, sellDessert, unlockZone } from '../../src/game/actions';
import { BALANCE, EQUIPMENT } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import { MAX_LEVEL, grantXp, levelFor, levelProgress, xpFromStats } from '../../src/game/level';
import { shopCatalog, stockCost, unlockedAtLevel } from '../../src/game/shop';
import { createNewSave, migrate } from '../../src/game/state';
import { START_ZONE, zoneKey } from '../../src/game/zones';
import { makeWorld, runOneBath, keepFed, advanceUntil } from './helpers';

const sink = (_e: SimEvent) => {};
const SPAWN = { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { x: -0.52, z: 0.12 } };

/** 把 xp 設成剛好某一級的門檻 */
function atLevel(level: number): number {
  return BALANCE.levelXp[level - 1] as number;
}

describe('D25 店長等級：xp → 等級', () => {
  it('門檻表單調遞增、Lv.1 從 0 起', () => {
    expect(BALANCE.levelXp[0]).toBe(0);
    for (let i = 1; i < BALANCE.levelXp.length; i++) {
      expect(BALANCE.levelXp[i]).toBeGreaterThan(BALANCE.levelXp[i - 1] as number);
    }
  });

  it('剛好到門檻就升級，差 1 點不升；超過表尾封頂', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(atLevel(2) - 1)).toBe(1);
    expect(levelFor(atLevel(2))).toBe(2);
    expect(levelFor(atLevel(MAX_LEVEL))).toBe(MAX_LEVEL);
    expect(levelFor(1e9)).toBe(MAX_LEVEL);
  });

  it('進度條：這一級已累積／總共要多少；滿級 ratio 為 1', () => {
    const p = levelProgress(atLevel(2) + 5);
    expect(p.level).toBe(2);
    expect(p.into).toBe(5);
    expect(p.span).toBe(atLevel(3) - atLevel(2));
    expect(levelProgress(1e9).ratio).toBe(1);
  });

  it('grantXp 跨級時丟一個 levelUp 事件（一次跨兩級也只丟一個，帶最新等級）', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const events: SimEvent[] = [];
    grantXp(s, atLevel(2) - 1, (e) => events.push(e));
    expect(events).toHaveLength(0);
    grantXp(s, 1, (e) => events.push(e));
    expect(events).toEqual([{ type: 'levelUp', level: 2, from: 1 }]);
    grantXp(s, atLevel(4) - s.xp, (e) => events.push(e));
    expect(events[1]).toEqual({ type: 'levelUp', level: 4, from: 2 });
  });
});

describe('D25 xp 來源', () => {
  it('泡完一次澡給 xp.bath', () => {
    const w = makeWorld({ puddings: 1 });
    expect(w.state.xp).toBe(0);
    expect(runOneBath(w, 'caramel')).toBe(true);
    expect(w.state.xp).toBe(BALANCE.xp.bath);
  });

  it('撿、加工、賣各給對應的 xp', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.drops.push({ id: 'd1', zone: START_ZONE, kind: 'ingredient' as const, species: 'caramel', pos: { x: 0, z: 0 }, bornAt: 0 });
    s.drops.push({ id: 'd2', zone: START_ZONE, kind: 'ingredient' as const, species: 'caramel', pos: { x: 0, z: 0 }, bornAt: 0 });
    pickAllDrops(s, sink);
    expect(s.xp).toBe(BALANCE.xp.pick * 2);
    s.eggs = BALANCE.eggsPerDessert; // D33：一份甜點還要蛋，不給蛋 craft 會失敗
    craft(s, 'caramel', sink);
    expect(s.xp).toBe(BALANCE.xp.pick * 2 + BALANCE.xp.craft);
    sellDessert(s, 'caramel', 1, sink);
    expect(s.xp).toBe(BALANCE.xp.pick * 2 + BALANCE.xp.craft + BALANCE.xp.sellDessert);
  });

  it('自動化做的也算 xp（裝了設備等級不會停）', () => {
    const w = makeWorld({ puddings: 1 });
    w.state.equipment.collector = true;
    keepFed(w);

    // 泡澡給 bath xp
    expect(runOneBath(w, 'caramel')).toBe(true);
    const afterBath = w.state.xp;
    expect(afterBath).toBeGreaterThanOrEqual(BALANCE.xp.bath);

    // D32：原料不是泡澡產的，是固定間隔自然掉的；收集手會自動撿走並給 pick xp
    const picked = w.state.stats.picked;
    expect(
      advanceUntil(w, (x) => x.state.stats.picked > picked, BALANCE.dropIntervalSec * 4),
    ).toBeGreaterThanOrEqual(0);
    expect(w.state.xp).toBeGreaterThanOrEqual(afterBath + BALANCE.xp.pick);
  });
});

describe('D25 商店等級門檻（規則在 game 層，不只是 UI 鎖著）', () => {
  it('等級不夠買不到設備，state 完全不動；等級到了就買得到', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.coins = 99999;
    s.xp = atLevel(EQUIPMENT.restock.level) - 1;
    const before = JSON.stringify(s);
    const r = buyEquipment(s, 'restock', sink);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`Lv.${EQUIPMENT.restock.level}`);
    expect(JSON.stringify(s)).toBe(before);

    s.xp = atLevel(EQUIPMENT.restock.level);
    expect(buyEquipment(s, 'restock', sink).ok).toBe(true);
  });

  it('Lv.1 買得到 T1 設備（新手引導指向的收集手不能被鎖住）', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.coins = 99999;
    expect(buyEquipment(s, 'collector', sink).ok).toBe(true);
    expect(buyEquipment(s, 'autoFill', sink).ok).toBe(true);
  });

  it('等級不夠買不到特殊澡盆與分區', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.coins = 99999;
    const before = JSON.stringify(s);
    expect(buySpecialBasin(s, 'matcha', { x: 0, z: 0 }, START_ZONE, sink).ok).toBe(false);
    expect(unlockZone(s, zoneKey(0, 2), SPAWN, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('大桶裝：Lv 不夠買不到，到了有折扣；小包裝永遠原價', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.coins = 99999;
    const bulk = BALANCE.stockBulkQty;
    expect(stockCost('caramel', BALANCE.stockBuyQty)).toBe(BALANCE.stockBuyQty * 2);
    expect(stockCost('caramel', bulk)).toBeLessThan(bulk * 2);
    expect(buyStock(s, 'caramel', bulk, sink).ok).toBe(false);
    expect(buyStock(s, 'caramel', BALANCE.stockBuyQty, sink).ok).toBe(true);

    s.xp = atLevel(BALANCE.stockBulkLevel);
    const coins = s.coins;
    expect(buyStock(s, 'caramel', bulk, sink).ok).toBe(true);
    expect(coins - s.coins).toBe(stockCost('caramel', bulk));
  });

  it('目錄狀態跟 action 守衛一致：locked 的買不到、available 的買得到', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    s.coins = 99999;
    s.xp = atLevel(3);
    const act = (st: typeof s, e: { action: string; arg: string; qty?: number }) =>
      e.action === 'buyStock' ? buyStock(st, e.arg as 'caramel', e.qty as number, sink)
      : e.action === 'buyEquip' ? buyEquipment(st, e.arg as 'restock', sink)
      : e.action === 'buyBasin' ? buySpecialBasin(st, e.arg as 'matcha', { x: 0, z: 0 }, START_ZONE, sink)
      : unlockZone(st, e.arg, SPAWN, sink);

    const catalog = shopCatalog(s);
    const locked = catalog.filter((e) => e.status === 'locked');
    const available = catalog.filter((e) => e.status === 'available');
    expect(locked.length).toBeGreaterThan(0);
    expect(available.length).toBeGreaterThan(0);
    for (const e of locked) {
      const before = JSON.stringify(s);
      expect(act(s, e).ok, e.id).toBe(false);
      expect(JSON.stringify(s)).toBe(before);
    }
    for (const e of available) {
      // 每件都在乾淨的複本上買，才不會互相影響（例如先買了澡盆）
      const clone = JSON.parse(JSON.stringify(s)) as typeof s;
      expect(act(clone, e).ok, e.id).toBe(true);
    }
  });

  it('目錄：每件商品 id 唯一、每一級都查得到「新上架」', () => {
    const s = createNewSave({ seed: 1, now: 0 });
    const ids = shopCatalog(s).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(unlockedAtLevel(s, 4).map((e) => e.id)).toContain(`zone:${zoneKey(0, 2)}`);
    // 風味液體沒買澡盆前是 needs，不是 locked（避免玩家以為要升級才能補貨）
    const matcha = shopCatalog(s).find((e) => e.id === `stock:matcha:${BALANCE.stockBuyQty}`);
    expect(matcha?.status).toBe('needs');
  });
});

describe('D25 舊存檔', () => {
  it('v2 存檔沒有 xp：用累計統計回推，不會降回 Lv.1', () => {
    const old = createNewSave({ seed: 1, now: 0 }) as unknown as Record<string, unknown>;
    delete old.xp;
    old.schemaVersion = 2;
    old.stats = { baths: 100, sold: 80, mutations: 1, picked: 100, crafted: 40 };
    const s = migrate(old);
    expect(s.xp).toBe(xpFromStats(s.stats));
    expect(levelFor(s.xp)).toBeGreaterThan(1);
  });

  it('有 xp 的存檔照原值', () => {
    const raw = createNewSave({ seed: 1, now: 0 });
    raw.xp = 123;
    expect(migrate(JSON.parse(JSON.stringify(raw))).xp).toBe(123);
  });
});
