import { describe, expect, it } from 'vitest';
import {
  FAME,
  STATION_IDS,
  V9_MACHINE_LEVEL,
  buyFame,
  buyMachine,
  famePrice,
  fameIntervalMult,
  startBatch,
  stationProgress,
  tickBakery,
} from '../../src/game/bakery';
import type { SimEvent } from '../../src/game/events';
import {
  MACHINE_CURVE,
  MAX_MACHINE_LEVEL,
  RECIPES,
  STATIONS,
  lineFailRate,
  machineFailMult,
  machinePortions,
  machinePrice,
  machineSeconds,
  materialHave,
  maxBatch,
  recipeMaterials,
  stationSeconds,
  upgradeCurve,
} from '../../src/game/recipes';
import { createRng } from '../../src/game/rng';
import { advance } from '../../src/game/sim';
import type { SpeciesId } from '../../src/game/species';
import { createNewSave, migrate, type GameState } from '../../src/game/state';
import { makeWorld } from './helpers';

const sink = (_e: SimEvent) => {};

function ownLine(s: GameState, species: SpeciesId, lv = 1) {
  for (const id of RECIPES[species].route) s.bakery.machines[id] = Math.max(s.bakery.machines[id], lv);
}

function stockFor(s: GameState, species: SpeciesId, n: number) {
  for (const [k, per] of recipeMaterials(species)) {
    if (k === 'egg') s.eggs = per * n;
    else if (k === 'milk') s.stock.milk = per * n;
    else if (k === 'flour' || k === 'rice') s.pantry[k] = per * n;
    else s.ingredients[k] = per * n;
  }
}

function tick(s: GameState, sec: number, seed = 1) {
  const rng = createRng(seed);
  for (let i = 0; i < sec; i++) {
    s.time += 1;
    tickBakery(s, rng, sink);
  }
}

describe('AC10-1 一盤份數由玩家疊，不可超過上限（D60）', () => {
  it('1..N 份都開得了，而且只扣那幾份的材料', () => {
    for (let qty = 1; qty <= 5; qty++) {
      const s = createNewSave({ seed: 3, now: 0 });
      ownLine(s, 'hojicha', 5);
      stockFor(s, 'hojicha', 8);
      expect(maxBatch(s, 'hojicha')).toBe(5);
      expect(startBatch(s, 'hojicha', qty, sink).ok).toBe(true);
      expect(s.bakery.stations.crack.batch).toEqual({ species: 'hojicha', qty });
      for (const [k, per] of recipeMaterials('hojicha')) expect(materialHave(s, k)).toBe(per * (8 - qty));
    }
  });

  it('超過上限、0 份、小數都拒絕，材料一個都沒扣（不夾到上限：夾了＝UI 算錯時靜默少做）', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    ownLine(s, 'hojicha', 5);
    stockFor(s, 'hojicha', 3); // 材料只夠 3：上限是 3 不是 5
    const before = JSON.stringify(s);
    for (const qty of [4, 6, 0, -1, 1.5, Number.NaN]) {
      const r = startBatch(s, 'hojicha', qty, sink);
      expect(r.ok, String(qty)).toBe(false);
      expect(JSON.stringify(s)).toBe(before);
    }
    const r = startBatch(s, 'hojicha', 4, sink);
    if (!r.ok) expect(r.error).toContain('最多 3 份');
  });
});

describe('AC10-2 每站秒數看自己的等級；做到一半升級不影響那一盤（D60）', () => {
  it('只升烤箱：烤箱那一站變快，其他站照 Lv1；份數仍看路線最低那台', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    ownLine(s, 'hojicha', 1);
    s.bakery.machines.bake = 5;
    expect(stationSeconds(s, 'bake')).toBeCloseTo(45 * 0.96 ** 4);
    expect(stationSeconds(s, 'crack')).toBe(STATIONS.crack.sec);
    stockFor(s, 'hojicha', 5);
    expect(maxBatch(s, 'hojicha')).toBe(1);
  });

  it('進站那一刻定下 doneAt；做到一半升級：doneAt 不變、進度條連續不跳，下一盤才照新等級', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    s.coins = 1e9;
    ownLine(s, 'panna', 1);
    stockFor(s, 'panna', 2);
    expect(startBatch(s, 'panna', 1, sink).ok).toBe(true);
    const st = s.bakery.stations.stove;
    const done0 = st.doneAt;
    tick(s, 4);
    const p0 = stationProgress(s, 'stove');
    expect(p0).toBeCloseTo(4 / STATIONS.stove.sec);
    for (let i = 0; i < 10; i++) expect(buyMachine(s, 'stove', sink).ok).toBe(true);
    expect(st.doneAt).toBe(done0);
    expect(stationProgress(s, 'stove')).toBeCloseTo(p0);
    tick(s, STATIONS.stove.sec); // 這一盤走掉
    expect(startBatch(s, 'panna', 1, sink).ok).toBe(true);
    expect(st.doneAt - st.startedAt).toBeCloseTo(machineSeconds('stove', 11));
  });
});

describe('AC10-3 等級曲線同級距（D61）', () => {
  it('機器：相鄰兩級秒數比恆為 0.96、上限差恆為 1、失敗率比恆為 0.7', () => {
    for (const id of STATION_IDS) {
      for (let lv = 1; lv < MAX_MACHINE_LEVEL; lv++) {
        expect(machineSeconds(id, lv + 1) / machineSeconds(id, lv)).toBeCloseTo(MACHINE_CURVE.sec);
        expect(machinePortions(lv + 1) - machinePortions(lv)).toBe(1);
        expect(machineFailMult(lv + 1) / machineFailMult(lv)).toBeCloseTo(MACHINE_CURVE.fail);
      }
    }
  });

  it('升級價：每一級都比上一級貴、七台同價、照同一條曲線（取整誤差 < 5%）、滿級沒有下一級；買 Lv1 是各台原價', () => {
    for (const id of STATION_IDS) {
      for (let lv = 1; lv < MAX_MACHINE_LEVEL; lv++) {
        expect(machinePrice(id, lv)!, `${id} Lv${lv}`).toBeGreaterThan(machinePrice(id, lv - 1)!);
        expect(Math.abs(machinePrice(id, lv)! / (MACHINE_CURVE.upgradeBase * upgradeCurve(lv)) - 1)).toBeLessThan(0.05);
        expect(machinePrice(id, lv)).toBe(machinePrice('stove', lv)); // 七台同一級同價
      }
      expect(machinePrice(id, MAX_MACHINE_LEVEL)).toBeNull();
      expect(machinePrice(id, 0)).toBe(STATIONS[id].price);
    }
  });

  it('滿級不能再升，state 不變', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    s.coins = 1e12;
    s.bakery.machines.bake = MAX_MACHINE_LEVEL;
    s.bakery.fame = FAME.max;
    const before = JSON.stringify(s);
    expect(buyMachine(s, 'bake', sink).ok).toBe(false);
    expect(buyFame(s, sink).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('人氣：相鄰兩級客人間隔比恆為 0.93；升級價跟機器同一條曲線、一級比一級貴', () => {
    for (let lv = 1; lv < FAME.max; lv++) {
      expect(fameIntervalMult(lv + 1) / fameIntervalMult(lv)).toBeCloseTo(FAME.interval);
      expect(famePrice(lv)).toBe(machinePrice('bake', lv)); // 人氣跟機器同價（D61：每次升級同等困難）
      expect(Math.abs(famePrice(lv)! / (MACHINE_CURVE.upgradeBase * upgradeCurve(lv)) - 1)).toBeLessThan(0.05);
      if (lv > 1) expect(famePrice(lv)!).toBeGreaterThan(famePrice(lv - 1)!);
    }
    expect(famePrice(FAME.max)).toBeNull();
  });

  it('跨階（Lv5→6）發 tierUp；階內不發', () => {
    const s = createNewSave({ seed: 3, now: 0 });
    s.coins = 1e9;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 6; i++) buyMachine(s, 'stove', (e) => ev.push(e));
    expect(ev.filter((e) => e.type === 'tierUp')).toEqual([{ type: 'tierUp', what: '爐台', tier: 2 }]);
  });
});

/** 一份 v9 存檔（D57 的 3 級機器、沒有 fame、站上沒有 startedAt） */
function v9(machines: Partial<Record<string, number>>, stations: Record<string, unknown> = {}): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(createNewSave({ seed: 9, now: 0 }))) as Record<string, unknown>;
  raw.schemaVersion = 9;
  const bk = raw.bakery as Record<string, unknown>;
  delete bk.fame;
  const st = bk.stations as Record<string, Record<string, unknown>>;
  for (const id of STATION_IDS) delete st[id]!.startedAt;
  Object.assign(st, stations);
  bk.machines = { ...(bk.machines as object), ...machines };
  raw.time = 100;
  return raw;
}

describe('AC10-4 舊存檔 v9 → v10：每一項都不比舊的差（D61）', () => {
  const OLD_PORTIONS = [0, 1, 2, 4];
  const OLD_FAIL = [1, 1, 0.6, 0.3];

  it('1→1、2→3、3→5；份數、失敗率、秒數都不比舊的差', () => {
    const s = migrate(v9({ stove: 1, crack: 2, mix: 3, mold: 0 }), { seed: 1, now: 0 });
    expect(s.bakery.machines.stove).toBe(1);
    expect(s.bakery.machines.crack).toBe(3);
    expect(s.bakery.machines.mix).toBe(5);
    expect(s.bakery.machines.mold).toBe(0);
    for (let old = 1; old <= 3; old++) {
      const lv = V9_MACHINE_LEVEL[old]!;
      expect(machinePortions(lv)).toBeGreaterThanOrEqual(OLD_PORTIONS[old]!);
      expect(machineFailMult(lv)).toBeLessThanOrEqual(OLD_FAIL[old]!);
      for (const id of STATION_IDS) expect(machineSeconds(id, lv)).toBeLessThanOrEqual(STATIONS[id].sec);
    }
    expect(s.bakery.fame).toBe(1);
  });

  it('站上那一盤照原本的 doneAt 做完；進度條用舊的固定秒數算', () => {
    const s = migrate(v9({ stove: 3, mold: 3, chill: 3 }, { mold: { batch: { species: 'panna', qty: 4 }, doneAt: 102 } }), { seed: 1, now: 0 });
    const st = s.bakery.stations.mold;
    expect(st.batch).toEqual({ species: 'panna', qty: 4 });
    expect(st.doneAt).toBe(102);
    expect(st.startedAt).toBe(102 - STATIONS.mold.sec);
    expect(stationProgress(s, 'mold')).toBeCloseTo((100 - (102 - STATIONS.mold.sec)) / STATIONS.mold.sec);
  });

  it('升上來之後再存再讀：不會再換算一次（冪等）', () => {
    const once = migrate(v9({ crack: 3 }), { seed: 1, now: 0 });
    const twice = migrate(JSON.parse(JSON.stringify(once)), { seed: 1, now: 0 });
    expect(twice.bakery.machines.crack).toBe(5);
  });

  it('失敗率的等級打折仍取路線最低那台', () => {
    const s = migrate(v9({ stove: 3, mold: 3, chill: 2 }), { seed: 1, now: 0 });
    expect(lineFailRate(s, 'panna')).toBeCloseTo(RECIPES.panna.failRate * machineFailMult(3));
  });
});

describe('AC10-5 店面人氣：客人更勤、多買、店員自動上架（D61）', () => {
  /** 整條焦糖線、成品櫃塞滿、展示架滿，推 hours 小時（跟離線結算同一條 advance） */
  function sellFor(fame: number, hours: number, seed = 5) {
    const w = makeWorld({ seed, puddings: 1 });
    const s = w.state;
    ownLine(s, 'caramel', 1);
    s.bakery.fame = fame;
    s.desserts.caramel = 5000;
    s.bakery.shelf.caramel = 12;
    const events: SimEvent[] = [];
    const emit = w.emit;
    w.emit = (e) => { events.push(e); emit(e); };
    const sold0 = 5012;
    advance(w, hours * 3600);
    const left = s.desserts.caramel + s.bakery.shelf.caramel;
    return { sold: sold0 - left, events };
  }

  it('人氣 Lv5（還沒有店員）：離線 8 小時最多賣掉一架', () => {
    expect(sellFor(FAME.staffLevel - 1, 8).sold).toBeLessThanOrEqual(12);
  });

  it('人氣 Lv6 起有店員：離線 8 小時賣掉的遠多於一架', () => {
    expect(sellFor(FAME.staffLevel, 8).sold).toBeGreaterThan(12 * 10);
  });

  it('人氣越高客人越勤：同樣 4 小時，Lv15 上門的客人數比 Lv6 多一半以上', () => {
    // 數客人不數份數：Lv11 起一位客人會多買，數份數的話「間隔不吃等級」也會被多買蓋過去（負向對照紅不了）
    const visits = (lv: number) => sellFor(lv, 4).events.filter((e) => e.type === 'customer').length;
    expect(visits(15)).toBeGreaterThan(visits(FAME.staffLevel) * 1.5);
  });

  it('Lv11 起有客人一次買 3 份；Lv10 最多 2 份', () => {
    const qty = (lv: number) => sellFor(lv, 2).events.filter((e) => e.type === 'customer').map((e) => (e as { qty: number }).qty);
    expect(Math.max(...qty(10))).toBe(2);
    expect(Math.max(...qty(FAME.buy3Level))).toBe(3);
    expect(Math.max(...qty(FAME.buy4Level))).toBe(4);
  });
});
