import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/game/balance';
import { movePudding } from '../../src/game/actions';
import { breed, placementZone, readyToBreed } from '../../src/game/breeding';
import {
  applyGenes,
  applySpeciesAsPure,
  cross,
  genesOf,
  normalizeGenes,
  phenotype,
} from '../../src/game/genetics';
import { generateOrder } from '../../src/game/orders';
import { createRng } from '../../src/game/rng';
import { advance, createWorld, type World } from '../../src/game/sim';
import {
  ALLELES,
  GENOTYPE_TO_SPECIES,
  SPECIES,
  SPECIES_IDS,
  genotypeKey,
  type AlleleId,
  type SpeciesId,
} from '../../src/game/species';
import { createNewSave, migrate, type GameState, type Pudding } from '../../src/game/state';
import { START_ZONE } from '../../src/game/zones';
import { FLOOR, advanceUntil, makeWorld } from './helpers';

/** 讓一隻布丁「馬上可以當親代」：成年、焦糖夠、沒在泡澡、冷卻結束 */
function makeBreedable(state: GameState, p: Pudding): Pudding {
  p.bornAt = state.time - BALANCE.matureAgeSec;
  p.breedReadyAt = state.time;
  p.caramel = 100;
  p.mode = 'resting';
  p.restT = 99; // 讓牠站著別亂跳，斷言才不會被隨機跳躍干擾
  return p;
}

function bothBreedable(w: World): [Pudding, Pudding] {
  const [a, b] = w.state.puddings as [Pudding, Pudding];
  return [makeBreedable(w.state, a), makeBreedable(w.state, b)];
}

/**
 * 不變式（D28）：`species` 只是 `phenotype(genes)` 的快取，任何時刻都必須一致。
 * 回傳不一致的那幾隻，空陣列＝通過。
 */
function geneDesyncs(state: GameState): string[] {
  return state.puddings.filter((p) => p.species !== phenotype(p.genes)).map((p) => p.id);
}

describe('D28 配種表', () => {
  it('四種等位基因的十種組合都對應到一個物種，且物種與基因型一一對應', () => {
    const seen = new Set<SpeciesId>();
    for (const a of ALLELES) {
      for (const b of ALLELES) {
        const id = GENOTYPE_TO_SPECIES[genotypeKey(a, b)];
        expect(id, `${a}+${b} 查不到物種`).toBeTruthy();
        seen.add(id as SpeciesId);
      }
    }
    // 4 純種 + C(4,2)=6 混種
    expect(seen.size).toBe(10);
    expect(SPECIES_IDS.length).toBe(10);
  });

  it('物種 → 基因型 → 物種 往返一致', () => {
    for (const id of SPECIES_IDS) {
      expect(phenotype(genesOf(id)), `${id} 往返不一致`).toBe(id);
    }
  });

  it('基因型與順序無關：[a,b] 與 [b,a] 是同一個物種', () => {
    for (const a of ALLELES) {
      for (const b of ALLELES) {
        expect(phenotype(normalizeGenes(a, b))).toBe(phenotype(normalizeGenes(b, a)));
      }
    }
  });

  it('混種比它的兩個親代都貴（不然沒有配種的動機）', () => {
    for (const id of SPECIES_IDS) {
      const [a, b] = SPECIES[id].alleles;
      if (a === b) continue;
      expect(SPECIES[id].ingredientPrice).toBeGreaterThan(SPECIES[a].ingredientPrice);
      expect(SPECIES[id].ingredientPrice).toBeGreaterThan(SPECIES[b].ingredientPrice);
    }
  });
});

describe('D28 孟德爾分離', () => {
  it('兩隻卡士達（焦糖＋鮮奶酪）的子代約 25% 焦糖／50% 卡士達／25% 鮮奶酪', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    applyGenes(a, 'caramel', 'panna');
    applyGenes(b, 'caramel', 'panna');
    expect(a.species).toBe('custard');

    const rng = createRng(4242);
    const count: Record<string, number> = {};
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const g = cross(a, b, rng);
      const id = phenotype(g);
      count[id] = (count[id] ?? 0) + 1;
    }
    // 沒有環境偏向時只可能出現這三種
    expect(Object.keys(count).sort()).toEqual(['caramel', 'custard', 'panna']);
    expect((count.caramel ?? 0) / n).toBeGreaterThan(0.2);
    expect((count.caramel ?? 0) / n).toBeLessThan(0.3);
    expect((count.custard ?? 0) / n).toBeGreaterThan(0.45);
    expect((count.custard ?? 0) / n).toBeLessThan(0.55);
    expect((count.panna ?? 0) / n).toBeGreaterThan(0.2);
    expect((count.panna ?? 0) / n).toBeLessThan(0.3);
  });

  it('兩隻純焦糖只會生出純焦糖', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) expect(phenotype(cross(a, b, rng))).toBe('caramel');
  });
});

describe('D30 澡盆（環境）影響配子', () => {
  it('親代抹茶曝露過半時，純焦糖的雙親也生得出帶抹茶的子代', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    a.flavorExposure.matcha = BALANCE.flavorThresholdSec * BALANCE.gameteShiftExposureRatio;

    const rng = createRng(99);
    let withMatcha = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) if (cross(a, b, rng).includes('matcha')) withMatcha++;
    // 只有 a 會位移，機率上限＝gameteShiftChance
    expect(withMatcha / n).toBeGreaterThan(0.2);
    expect(withMatcha / n).toBeLessThanOrEqual(BALANCE.gameteShiftChance + 0.05);
  });

  it('負向對照：曝露歸零就一次都不會出現抹茶等位基因', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    a.flavorExposure = {};
    const rng = createRng(99);
    for (let i = 0; i < 2000; i++) expect(cross(a, b, rng).includes('matcha')).toBe(false);
  });

  it('變白（牛奶過載）會把配子推向鮮奶酪', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    a.tint = BALANCE.gameteShiftTintRatio;
    const rng = createRng(5);
    let withPanna = 0;
    for (let i = 0; i < 2000; i++) if (cross(a, b, rng).includes('panna')) withPanna++;
    expect(withPanna).toBeGreaterThan(0);
  });
});

describe('D29 自動繁殖的觸發條件', () => {
  it('兩隻成年、焦糖足夠、該區有空位 → 自動生出第三隻', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    expect(w.state.puddings.length).toBe(2);

    advance(w, 1);

    expect(w.state.puddings.length).toBe(3);
    const child = w.state.puddings[2] as Pudding;
    expect(child.zone).toBe(START_ZONE);
    expect(child.species).toBe('caramel');
    expect(child.bornAt).toBeCloseTo(w.state.time, 6);
    expect(w.state.stats.births).toBe(1);
    // 親代付出代價並進入冷卻（100 − 成本，再扣這一秒的自然衰減）
    const expected = 100 - BALANCE.breedCaramelCost - BALANCE.caramelDecayPerSec;
    expect(a.caramel).toBeCloseTo(expected, 5);
    expect(b.caramel).toBeCloseTo(expected, 5);
    expect(a.breedReadyAt).toBeGreaterThan(w.state.time);
    expect(w.events.some((e) => e.type === 'birth')).toBe(true);
  });

  it('新生兒的 id 走 nextId，不與既有布丁撞號', () => {
    const w = makeWorld();
    bothBreedable(w);
    advance(w, 1);
    const ids = w.state.puddings.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('負向對照：焦糖不足就不生', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    a.caramel = BALANCE.breedCaramelMin - 1;
    b.caramel = 100;
    advance(w, 30);
    expect(w.state.puddings.length).toBe(2);
    expect(w.state.stats.births).toBe(0);
  });

  it('負向對照：還沒成年就不生', () => {
    const w = makeWorld();
    const [a] = bothBreedable(w);
    a.bornAt = w.state.time; // 剛出生
    expect(readyToBreed(w.state, a)).toBe(false);
    advance(w, 30);
    expect(w.state.puddings.length).toBe(2);
  });

  it('負向對照：同一區滿員（zoneCapacity）就停止繁殖', () => {
    const w = makeWorld();
    bothBreedable(w);
    // 先把這一區塞到上限
    while (w.state.puddings.length < BALANCE.zoneCapacity) {
      const [a, b] = w.state.puddings as [Pudding, Pudding];
      breed(w.state, makeBreedable(w.state, a), makeBreedable(w.state, b), {
        rng: w.rng,
        floor: FLOOR,
        emit: w.emit,
      });
    }
    expect(w.state.puddings.length).toBe(BALANCE.zoneCapacity);

    for (const p of w.state.puddings) makeBreedable(w.state, p);
    advance(w, 120);
    expect(w.state.puddings.length).toBe(BALANCE.zoneCapacity);
  });

  it('冷卻期間不會連生：一次冷卻內最多一隻', () => {
    const w = makeWorld();
    bothBreedable(w);
    advance(w, 1);
    expect(w.state.puddings.length).toBe(3);
    const t0 = w.state.time;
    // 冷卻還沒過就算焦糖被灌滿也不能再生（此時也已滿員，兩道閘都在）
    for (const p of w.state.puddings) p.caramel = 100;
    advance(w, BALANCE.breedCooldownSec - 2);
    expect(w.state.puddings.length).toBe(3);
    expect(w.state.time - t0).toBeLessThan(BALANCE.breedCooldownSec);
  });
});

describe('D29 溢出與搬家', () => {
  it('雙親那一區滿了，新生兒落到住客最少的已解鎖區', () => {
    const w = makeWorld();
    const other = w.state.zones.find((z) => z.id !== START_ZONE)!;
    other.unlocked = true;

    // 起始區塞到上限
    while (w.state.puddings.filter((p) => p.zone === START_ZONE).length < BALANCE.zoneCapacity) {
      const [a, b] = w.state.puddings as [Pudding, Pudding];
      breed(w.state, makeBreedable(w.state, a), makeBreedable(w.state, b), { rng: w.rng, floor: FLOOR, emit: w.emit }, START_ZONE);
    }
    expect(placementZone(w.state, START_ZONE)).toBe(other.id);

    for (const p of w.state.puddings) makeBreedable(w.state, p);
    advance(w, 1);
    const moved = w.state.puddings.filter((p) => p.zone === other.id);
    expect(moved.length).toBe(1);
  });

  it('全場都滿了就整個停止繁殖', () => {
    const w = makeWorld();
    while (w.state.puddings.length < BALANCE.zoneCapacity) {
      const [a, b] = w.state.puddings as [Pudding, Pudding];
      breed(w.state, makeBreedable(w.state, a), makeBreedable(w.state, b), { rng: w.rng, floor: FLOOR, emit: w.emit }, START_ZONE);
    }
    expect(placementZone(w.state, START_ZONE)).toBe(null);
    for (const p of w.state.puddings) makeBreedable(w.state, p);
    advance(w, 300);
    expect(w.state.puddings.length).toBe(BALANCE.zoneCapacity);
  });

  it('搬家：搬到已解鎖且有空位的區', () => {
    const w = makeWorld();
    const other = w.state.zones.find((z) => z.id !== START_ZONE)!;
    other.unlocked = true;
    const p = w.state.puddings[0] as Pudding;
    expect(movePudding(w.state, p.id, other.id, w.emit).ok).toBe(true);
    expect(p.zone).toBe(other.id);
  });

  it('負向對照：搬到沒解鎖的區要失敗，且 state 不變', () => {
    const w = makeWorld();
    const locked = w.state.zones.find((z) => !z.unlocked)!;
    const p = w.state.puddings[0] as Pudding;
    const before = JSON.stringify(w.state);
    const r = movePudding(w.state, p.id, locked.id, w.emit);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(w.state)).toBe(before);
  });

  it('負向對照：目標區住滿了不給搬', () => {
    const w = makeWorld();
    const other = w.state.zones.find((z) => z.id !== START_ZONE)!;
    other.unlocked = true;
    for (const p of w.state.puddings) p.zone = other.id;
    while (w.state.puddings.filter((x) => x.zone === other.id).length < BALANCE.zoneCapacity) {
      const [a, b] = w.state.puddings as [Pudding, Pudding];
      breed(w.state, makeBreedable(w.state, a), makeBreedable(w.state, b), { rng: w.rng, floor: FLOOR, emit: w.emit }, other.id);
    }
    // 另外生一隻放在起始區當「想搬過去的那一隻」（不可以從 other 裡挑，那會先騰出空位）
    const [a, b] = w.state.puddings as [Pudding, Pudding];
    const stray = breed(w.state, makeBreedable(w.state, a), makeBreedable(w.state, b), { rng: w.rng, floor: FLOOR, emit: w.emit }, START_ZONE) as Pudding;
    expect(w.state.puddings.filter((x) => x.zone === other.id).length).toBe(BALANCE.zoneCapacity);

    expect(movePudding(w.state, stray.id, other.id, w.emit).ok).toBe(false);
    expect(stray.zone).toBe(START_ZONE);
  });

  it('搬家會讓出佔住的澡盆，否則那個盆永遠沒人用得到', () => {
    const w = makeWorld();
    const other = w.state.zones.find((z) => z.id !== START_ZONE)!;
    other.unlocked = true;
    const p = w.state.puddings[0] as Pudding;
    const basin = w.state.basins[0]!;
    basin.occupantId = p.id;
    p.basinIndex = 0;
    expect(movePudding(w.state, p.id, other.id, w.emit).ok).toBe(true);
    expect(basin.occupantId).toBe(null);
    expect(p.basinIndex).toBe(null);
  });
});

describe('D28 不變式：species 永遠等於 phenotype(genes)', () => {
  it('跑完一段含泡澡、突變、繁殖的模擬後仍然一致', () => {
    const w = makeWorld();
    bothBreedable(w);
    for (const b of w.state.basins) {
      b.liquid = 'milk';
      b.preferredLiquid = 'milk';
      b.units = BALANCE.basinCapacity;
    }
    w.state.stock.milk = 999;
    w.state.equipment.autoFill = true;
    advance(w, 600);
    expect(w.state.stats.births).toBeGreaterThan(0);
    expect(geneDesyncs(w.state)).toEqual([]);
  });

  it('負向對照：只改 species 不改 genes，檢查函式要抓得到', () => {
    const w = makeWorld();
    const p = w.state.puddings[0] as Pudding;
    p.species = 'matcha'; // 故意繞過 applyGenes
    expect(geneDesyncs(w.state)).toEqual([p.id]);
  });

  it('突變走的是基因：泡成鮮奶酪之後，傳下去的等位基因也變了', () => {
    const w = makeWorld({ puddings: 1 });
    const p = w.state.puddings[0] as Pudding;
    applySpeciesAsPure(p, 'panna');
    expect(p.species).toBe('panna');
    expect(p.genes).toEqual(['panna', 'panna']);

    const mate = { ...p, id: 'mate', genes: ['caramel', 'caramel'] } as Pudding;
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      // 純焦糖 × 純鮮奶酪 只會生出卡士達
      expect(phenotype(cross(p, mate, rng))).toBe('custard');
    }
  });
});

describe('D29 離線結算不會失控', () => {
  it('離線八小時後，住客數不超過「已解鎖區數 × zoneCapacity」', () => {
    const state = createNewSave({ seed: 31, now: 0 });
    const w = createWorld(state, FLOOR);
    for (const b of state.basins) {
      b.liquid = 'caramel';
      b.preferredLiquid = 'caramel';
      b.units = BALANCE.basinCapacity;
    }
    state.stock.caramel = 100000;
    state.equipment.autoFill = true;
    state.equipment.collector = true;

    advance(w, BALANCE.offlineCapSec);

    const unlocked = state.zones.filter((z) => z.unlocked).length;
    expect(state.puddings.length).toBeLessThanOrEqual(unlocked * BALANCE.zoneCapacity);
    expect(geneDesyncs(state)).toEqual([]);
  });

  it('同一個 seed 跑兩次，生出來的物種序列一致', () => {
    const run = () => {
      const state = createNewSave({ seed: 777, now: 0 });
      const w = createWorld(state, FLOOR);
      for (const b of state.basins) {
        b.liquid = 'caramel';
        b.preferredLiquid = 'caramel';
        b.units = BALANCE.basinCapacity;
      }
      state.stock.caramel = 100000;
      state.equipment.autoFill = true;
      advance(w, 1800);
      return state.puddings.map((p) => `${p.id}:${p.genes.join('+')}`).join(',');
    };
    expect(run()).toBe(run());
  });
});

describe('存檔相容（schema 3）', () => {
  it('舊存檔沒有 genes：依 species 補成純合，物種不變', () => {
    const old = {
      ...createNewSave({ seed: 1, now: 0 }),
      puddings: [{ id: 'p1', zone: START_ZONE, species: 'matcha', caramel: 50 }],
    };
    delete (old.puddings[0] as Record<string, unknown>).genes;
    const s = migrate(JSON.parse(JSON.stringify(old)));
    expect(s.puddings[0]!.species).toBe('matcha');
    expect(s.puddings[0]!.genes).toEqual(['matcha', 'matcha']);
    expect(s.schemaVersion).toBe(3);
  });

  it('存檔的 species 與 genes 打架時以 genes 為準（species 只是快取）', () => {
    const raw = {
      ...createNewSave({ seed: 1, now: 0 }),
      puddings: [{ id: 'p1', zone: START_ZONE, species: 'caramel', genes: ['panna', 'matcha'], caramel: 50 }],
    };
    const s = migrate(JSON.parse(JSON.stringify(raw)));
    expect(s.puddings[0]!.genes).toEqual(['panna', 'matcha']);
    expect(s.puddings[0]!.species).toBe('matchalatte');
  });

  it('壞掉的 genes 退回 species 推出來的純合，不會讓遊戲開不起來', () => {
    const raw = {
      ...createNewSave({ seed: 1, now: 0 }),
      puddings: [{ id: 'p1', zone: START_ZONE, species: 'strawberry', genes: ['nope', 42], caramel: 50 }],
    };
    const s = migrate(JSON.parse(JSON.stringify(raw)));
    expect(s.puddings[0]!.genes).toEqual(['strawberry', 'strawberry']);
    expect(s.puddings[0]!.species).toBe('strawberry');
  });

  it('混種存檔重開後仍是同一個混種', () => {
    const w = makeWorld();
    const p = w.state.puddings[0] as Pudding;
    applyGenes(p, 'matcha', 'strawberry');
    expect(p.species).toBe('sakura');
    const s = migrate(JSON.parse(JSON.stringify(w.state)));
    expect(s.puddings[0]!.species).toBe('sakura');
    expect(s.puddings[0]!.genes).toEqual(['matcha', 'strawberry']);
  });
});

describe('D25／D28 訂單卡', () => {
  it('「引子」訂單只從四種純種抽，不會出養不出來的混種', () => {
    // 直接抽 generateOrder：跑模擬會被事件佇列上限（EVENT_CAP）截掉早期的訂單
    const state = createNewSave({ seed: 5, now: 0 }); // 住客全是焦糖 → 會走到 20% 那條路徑
    const rng = createRng(11);
    const seen = new Set<SpeciesId>();
    for (let i = 0; i < 500; i++) seen.add(generateOrder(state, rng).species);
    expect(seen.size).toBeGreaterThan(1);
    for (const id of seen) {
      const [a, b] = SPECIES[id].alleles;
      expect(a, `訂單抽到混種 ${id}`).toBe(b);
    }
  });

  it('住客養出混種之後，訂單抽得到那個混種（80% 那條路徑）', () => {
    const state = createNewSave({ seed: 5, now: 0 });
    applyGenes(state.puddings[0] as Pudding, 'matcha', 'strawberry');
    const rng = createRng(12);
    const seen = new Set<SpeciesId>();
    for (let i = 0; i < 500; i++) seen.add(generateOrder(state, rng).species);
    expect(seen.has('sakura')).toBe(true);
  });
});

describe('繁殖後的布丁仍照既有規則生活', () => {
  it('新生兒會自己去泡澡並產出自己物種的原料', () => {
    const w = makeWorld();
    const [a, b] = bothBreedable(w);
    applyGenes(a, 'matcha', 'matcha');
    applyGenes(b, 'matcha', 'matcha');
    advance(w, 1);
    const child = w.state.puddings[2] as Pudding;
    expect(child.species).toBe('matcha');

    // 只留新生兒，其他兩隻搬走，斷言才不會被牠們的原料干擾
    w.state.puddings = [child];
    child.bornAt = w.state.time;
    const basin = w.state.basins[0]!;
    basin.liquid = 'caramel';
    basin.preferredLiquid = 'caramel';
    basin.units = BALANCE.basinCapacity;
    child.caramel = 5;

    const t = advanceUntil(w, (x) => x.state.stats.baths > 0, 400);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(w.state.drops.some((d) => d.species === 'matcha')).toBe(true);
  });
});
