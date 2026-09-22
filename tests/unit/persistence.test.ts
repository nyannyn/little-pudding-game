import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { advance, createWorld, settleOffline, syncForSave } from '../../src/game/sim';
import { SAVE_KEY, TEST_SAVE_KEY, activeSaveKey, clear, load, parseSave, save, useTestSave } from '../../src/game/storage';
import { SCHEMA_VERSION, createNewSave, migrate } from '../../src/game/state';
import { START_ZONE, zoneKey } from '../../src/game/zones';
import { FLOOR, fillBasinDirect, makeWorld } from './helpers';

/** 讓兩個世界從完全一樣的起點出發（同種子、同澡盆狀態） */
function primed(seed = 424242) {
  const w = makeWorld({ seed });
  w.state.equipment.autoFill = true;
  w.state.equipment.collector = true;
  w.state.stock.caramel = 5000;
  fillBasinDirect(w.state, 'caramel');
  return w;
}

/** 比較兩份存檔裡「玩家看得到」的部分 */
function visible(s: ReturnType<typeof createNewSave>) {
  return {
    coins: s.coins,
    ingredients: { ...s.ingredients },
    desserts: { ...s.desserts },
    stock: { ...s.stock },
    baths: s.stats.baths,
    drops: s.drops.length,
  };
}

describe('AC2-5 離線結算上限 8 小時', () => {
  it('離開 24 小時＝只補跑 8 小時', () => {
    const a = primed();
    const settled = settleOffline(a, a.state.lastSeenAt + 24 * 3600 * 1000);
    expect(settled).toBe(BALANCE.offlineCapSec);

    const b = primed();
    advance(b, BALANCE.offlineCapSec);

    expect(visible(a.state)).toEqual(visible(b.state));
  });

  it('離開 1 小時就只跑 1 小時，結果比 8 小時少', () => {
    const a = primed();
    expect(settleOffline(a, a.state.lastSeenAt + 3600 * 1000)).toBe(3600);
    const b = primed();
    advance(b, BALANCE.offlineCapSec);
    expect(a.state.stats.baths).toBeLessThan(b.state.stats.baths);
  });

  it('沒有自動注液閥時，澡盆用完就停產', () => {
    const w = makeWorld({ seed: 7 });
    fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity);
    settleOffline(w, w.state.lastSeenAt + 8 * 3600 * 1000);
    expect(w.state.stats.baths).toBe(BALANCE.basinCapacity);
    expect(w.state.basins[0]!.units).toBe(0);
  });

  it('時間倒退（使用者改系統時間）不會倒扣', () => {
    const w = primed();
    const t0 = w.state.time;
    expect(settleOffline(w, w.state.lastSeenAt - 5000)).toBe(0);
    expect(w.state.time).toBe(t0);
  });
});

describe('AC2-6 存檔損壞不崩', () => {
  beforeEach(() => clear());

  it('壞 JSON、null、空物件都回一個能玩的新檔', () => {
    for (const bad of ['{garbage', 'null', '[]', '{}', '"nope"'] as const) {
      const r = parseSave(bad, { seed: 1, now: 0 });
      expect(r.state.puddings.length).toBeGreaterThan(0);
      expect(r.state.schemaVersion).toBe(SCHEMA_VERSION);
      expect(r.restored).toBe(false);
    }
  });

  it('沒有存檔時開新檔', () => {
    expect(load({ seed: 1, now: 0 }).restored).toBe(false);
  });

  it('欄位缺一半的舊檔會被補齊而不是丟掉', () => {
    const partial = { schemaVersion: 0, coins: 77, puddings: [{ id: 'p1', species: 'matcha' }] };
    const r = parseSave(JSON.stringify(partial), { seed: 1, now: 0 });
    expect(r.restored).toBe(true);
    expect(r.state.coins).toBe(77);
    expect(r.state.puddings[0]!.species).toBe('matcha');
    expect(r.state.puddings[0]!.caramel).toBeGreaterThan(0);
    expect(r.state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('負數與 NaN 會被夾回合法範圍', () => {
    const evil = {
      coins: -500, time: -10,
      stock: { caramel: -3, milk: Number.NaN },
      eggs: -8,
      puddings: [{ id: 'p1', caramel: 9999, species: 'nope' }],
      drops: new Array(50).fill({ id: 'd', kind: 'ingredient', species: 'caramel', pos: { x: 0, z: 0 } }),
    };
    const s = migrate(evil, { seed: 1, now: 0 });
    expect(s.coins).toBe(0);
    expect(s.time).toBe(0);
    expect(s.stock.caramel).toBe(0);
    expect(s.stock.milk).toBe(0);
    expect(s.puddings[0]!.caramel).toBe(100);
    expect(s.puddings[0]!.species).toBe('caramel');
    expect(s.eggs).toBe(0); // 負數的蛋要夾回 0
    expect(s.drops.length).toBe(BALANCE.dropCap);
  });

  it('存檔→讀回→接著跑，亂數序列接得上（同一份存檔重開兩次結果一樣）', () => {
    const w = primed(31337);
    advance(w, 90);
    save(syncForSave(w, 1_000_000));

    const a = load({ seed: 1, now: 0 }).state;
    const b = load({ seed: 1, now: 0 }).state;
    expect(a.rngState).toBe(b.rngState);

    const wa = createWorld(a, FLOOR);
    const wb = createWorld(b, FLOOR);
    advance(wa, 120);
    advance(wb, 120);
    expect(visible(wa.state)).toEqual(visible(wb.state));
  });
});

describe('schema v1 → v2：舊存檔沒有分區欄位', () => {
  /** v1 的存檔長這樣：布丁／澡盆／掉落物都沒有 `zone`，整份也沒有 `zones` */
  const v1 = {
    schemaVersion: 1,
    coins: 321,
    stock: { caramel: 2, milk: 1 },
    puddings: [{ id: 'p1', species: 'caramel', caramel: 70, pos: { x: 0.1, z: 0 } }],
    basins: [{ liquid: 'caramel', units: 2, pos: { x: -0.52, z: 0.12 } }],
    drops: [{ id: 'd1', species: 'caramel', pos: { x: 0.2, z: 0 } }],
  };

  it('全部補進起始區，沒有任何東西消失', () => {
    const s = migrate(v1, { seed: 1, now: 0 });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.coins).toBe(321);
    expect(s.puddings).toHaveLength(1);
    expect(s.puddings[0]!.zone).toBe(START_ZONE);
    expect(s.basins[0]!.zone).toBe(START_ZONE);
    expect(s.drops[0]!.zone).toBe(START_ZONE);
    expect(s.activeZone).toBe(START_ZONE);
    expect(s.zones.find((z) => z.id === START_ZONE)!.unlocked).toBe(true);
    expect(s.zones.filter((z) => z.unlocked)).toHaveLength(1);
  });

  it('不認得的 zone 字串會被拉回起始區，而不是變成孤兒', () => {
    const s = migrate({ ...v1, puddings: [{ id: 'p1', zone: 'c9t9' }] }, { seed: 1, now: 0 });
    expect(s.puddings[0]!.zone).toBe(START_ZONE);
  });

  it('已解鎖的分區會被保留，activeZone 指向沒解鎖的區會被拉回起始區', () => {
    const upper = zoneKey(0, 2);
    const raw = { ...v1, zones: [{ id: upper, unlocked: true }], activeZone: zoneKey(1, 1) };
    const s = migrate(raw, { seed: 1, now: 0 });
    expect(s.zones.find((z) => z.id === upper)!.unlocked).toBe(true);
    expect(s.activeZone).toBe(START_ZONE);
  });
});

describe('測試模式寫另一個存檔格', () => {
  afterEach(() => {
    useTestSave(false);
    clear();
  });

  it('預設寫玩家那格，切過去寫測試那格', () => {
    expect(activeSaveKey()).toBe(SAVE_KEY);
    useTestSave(true);
    expect(activeSaveKey()).toBe(TEST_SAVE_KEY);
    useTestSave(false);
    expect(activeSaveKey()).toBe(SAVE_KEY);
  });

  it('測試模式存過之後，玩家的存檔原封不動', () => {
    useTestSave(false);
    clear();
    const player = primed(11);
    player.state.coins = 123456;
    save(syncForSave(player, 1_000_000));

    useTestSave(true);
    const tester = primed(22);
    tester.state.coins = 7;
    save(syncForSave(tester, 2_000_000));

    useTestSave(false);
    const back = load({ seed: 1, now: 0 });
    expect(back.restored).toBe(true);
    expect(back.state.coins).toBe(123456);
  });

  it('清檔只清當下那一格', () => {
    useTestSave(false);
    const player = primed(33);
    player.state.coins = 999;
    save(syncForSave(player, 1_000_000));

    useTestSave(true);
    save(syncForSave(primed(44), 1_000_000));
    clear();

    useTestSave(false);
    expect(load({ seed: 1, now: 0 }).state.coins).toBe(999);
  });
});
