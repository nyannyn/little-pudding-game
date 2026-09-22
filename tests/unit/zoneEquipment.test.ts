import { describe, expect, it } from 'vitest';
import { buyEquipment, unlockZone } from '../../src/game/actions';
import { BALANCE, EQUIPMENT, EQUIPMENT_IDS } from '../../src/game/balance';
import type { SimEvent } from '../../src/game/events';
import { advance } from '../../src/game/sim';
import { SCHEMA_VERSION, createNewSave, equipmentIn, hasAnyEquipment, hasEquipmentAnywhere, migrate } from '../../src/game/state';
import { START_ZONE, basinsIn, dropsIn, findZone, puddingsIn, zoneKey } from '../../src/game/zones';
import { fillBasinDirect, makeWorld } from './helpers';

/**
 * D45：自動化設備每一區各買各的。
 * 新解鎖的區是空的、要再花一次原價；注液閥／收集手只作用在裝了它的那一區；
 * 加工／販售／補貨任一區裝了就全場生效；v5 以前的扁平旗標補給所有已解鎖的區。
 */
const sink = (_e: SimEvent) => {};
const SPAWN = { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { x: -0.52, z: 0.12 } };
const UPPER = zoneKey(0, 2);
const SECOND_CABINET = zoneKey(1, 1);

function twoZones(seed = 555) {
  const w = makeWorld({ seed });
  w.state.coins = 99999;
  w.state.xp = 99999;
  unlockZone(w.state, SECOND_CABINET, SPAWN, sink);
  w.state.activeZone = START_ZONE;
  return w;
}

describe('買設備是分區的', () => {
  it('新解鎖的區沒有任何設備，即使起始區五台全裝', () => {
    const w = makeWorld();
    w.state.coins = 99999;
    w.state.xp = 99999;
    for (const id of EQUIPMENT_IDS) expect(buyEquipment(w.state, id, sink).ok).toBe(true);
    expect(unlockZone(w.state, UPPER, SPAWN, sink).ok).toBe(true);
    for (const id of EQUIPMENT_IDS) {
      expect(equipmentIn(w.state, START_ZONE)[id]).toBe(true);
      expect(equipmentIn(w.state, UPPER)[id]).toBe(false);
    }
  });

  it('同一台在第二區要再付一次原價；同一區買第二次會被擋', () => {
    const w = twoZones();
    w.state.coins = EQUIPMENT.collector.price * 2;
    expect(buyEquipment(w.state, 'collector', sink, START_ZONE).ok).toBe(true);
    expect(w.state.coins).toBe(EQUIPMENT.collector.price);
    expect(buyEquipment(w.state, 'collector', sink, START_ZONE)).toEqual({ ok: false, error: '這一區已經裝了' });
    expect(buyEquipment(w.state, 'collector', sink, SECOND_CABINET).ok).toBe(true);
    expect(w.state.coins).toBe(0);
    expect(equipmentIn(w.state, SECOND_CABINET).collector).toBe(true);
  });

  it('沒帶 zone 就裝在玩家正在看的那一區；沒解鎖的區買不到', () => {
    const w = twoZones();
    w.state.activeZone = SECOND_CABINET;
    expect(buyEquipment(w.state, 'autoFill', sink).ok).toBe(true);
    expect(equipmentIn(w.state, SECOND_CABINET).autoFill).toBe(true);
    expect(equipmentIn(w.state, START_ZONE).autoFill).toBe(false);

    const before = w.state.coins;
    expect(buyEquipment(w.state, 'autoFill', sink, UPPER)).toEqual({ ok: false, error: '這一區還沒解鎖' });
    expect(w.state.coins).toBe(before);
  });
});

describe('分區設備只作用在自己那一區', () => {
  /** 兩區都有液體、住客都餓：只有一區裝收集手，跑一段時間看掉落物去了哪 */
  function bothProducing(equip: (w: ReturnType<typeof twoZones>) => void) {
    const w = twoZones();
    equip(w);
    w.state.coins = 0;
    for (const [i, b] of w.state.basins.entries()) fillBasinDirect(w.state, 'caramel', BALANCE.basinCapacity, i);
    for (const p of w.state.puddings) p.caramel = 5;
    advance(w, 200);
    return w;
  }

  it('收集手：裝在起始區時，二號櫥窗的掉落物留在地上', () => {
    const w = bothProducing((x) => { x.state.equipment[START_ZONE]!.collector = true; });
    expect(dropsIn(w.state, START_ZONE)).toHaveLength(0);
    expect(dropsIn(w.state, SECOND_CABINET).length).toBeGreaterThan(0);
    expect(w.state.ingredients.caramel).toBeGreaterThan(0);
  });

  it('收集手：反過來裝在二號櫥窗，起始區的掉落物留在地上', () => {
    const w = bothProducing((x) => { x.state.equipment[SECOND_CABINET]!.collector = true; });
    expect(dropsIn(w.state, SECOND_CABINET)).toHaveLength(0);
    expect(dropsIn(w.state, START_ZONE).length).toBeGreaterThan(0);
  });

  it('注液閥：只補裝了它的那一區的澡盆', () => {
    const w = twoZones();
    w.state.equipment[START_ZONE]!.autoFill = true;
    w.state.stock.caramel = 100;
    // 兩區的盆都設成「上次倒焦糖」但現在是空的
    for (const b of w.state.basins) {
      b.preferredLiquid = 'caramel';
      b.liquid = null;
      b.units = 0;
    }
    advance(w, 1);
    expect(basinsIn(w.state, START_ZONE)[0]!.units).toBeGreaterThan(0);
    expect(basinsIn(w.state, SECOND_CABINET)[0]!.units).toBe(0);
  });

  it('販售口裝在二號櫥窗也會賣掉全場的甜點（庫存是共用的）', () => {
    const w = twoZones();
    w.state.equipment[SECOND_CABINET]!.seller = true;
    w.state.desserts.caramel = 3;
    w.state.coins = 0;
    advance(w, 1);
    expect(w.state.desserts.caramel).toBe(0);
    expect(w.state.coins).toBeGreaterThan(0);
    expect(hasEquipmentAnywhere(w.state, 'seller')).toBe(true);
    expect(hasAnyEquipment(w.state)).toBe(true);
  });
});

describe('schema v5 → v6：舊存檔的扁平設備表', () => {
  function v5WithTwoZones() {
    const s = createNewSave({ seed: 9, now: 0 });
    findZone(s, UPPER)!.unlocked = true;
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.schemaVersion = 5;
    raw.equipment = { autoFill: true, collector: true, crafter: false, seller: true, restock: false };
    return raw;
  }

  it('旗標補給每一個已解鎖的區，沒解鎖的區維持空的', () => {
    const s = migrate(v5WithTwoZones(), { seed: 1, now: 0 });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    for (const zone of [START_ZONE, UPPER]) {
      expect(equipmentIn(s, zone)).toEqual({ autoFill: true, collector: true, crafter: false, seller: true, restock: false });
    }
    expect(Object.values(equipmentIn(s, SECOND_CABINET)).some(Boolean)).toBe(false);
    expect(Object.values(equipmentIn(s, zoneKey(0, 0))).some(Boolean)).toBe(false);
  });

  it('負向對照：只補起始區的話上層會少掉已付費的設備（這條測的是補值方向）', () => {
    const s = migrate(v5WithTwoZones(), { seed: 1, now: 0 });
    expect(equipmentIn(s, UPPER).seller).toBe(true);
  });

  it('v6 的分區設備表原樣讀回，未知的區與非布林值一律當成沒裝', () => {
    const s = createNewSave({ seed: 9, now: 0 });
    findZone(s, UPPER)!.unlocked = true;
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw.equipment = {
      [START_ZONE]: { collector: true, seller: 'yes' },
      [UPPER]: { autoFill: true },
      c9t9: { restock: true },
    };
    const back = migrate(raw, { seed: 1, now: 0 });
    expect(equipmentIn(back, START_ZONE)).toEqual({ autoFill: false, collector: true, crafter: false, seller: false, restock: false });
    expect(equipmentIn(back, UPPER).autoFill).toBe(true);
    expect('c9t9' in back.equipment).toBe(false);
    expect(hasEquipmentAnywhere(back, 'restock')).toBe(false);
  });

  it('完全沒有 equipment 欄位的存檔：每一區都是空的，不會炸', () => {
    const raw = JSON.parse(JSON.stringify(createNewSave({ seed: 9, now: 0 }))) as Record<string, unknown>;
    delete raw.equipment;
    const back = migrate(raw, { seed: 1, now: 0 });
    expect(hasAnyEquipment(back)).toBe(false);
    expect(Object.keys(back.equipment).sort()).toEqual(back.zones.map((z) => z.id).sort());
    expect(puddingsIn(back, START_ZONE)).toHaveLength(2);
  });
});
