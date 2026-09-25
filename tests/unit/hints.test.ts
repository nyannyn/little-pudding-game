import { describe, expect, it } from 'vitest';
import { BALANCE, EQUIPMENT } from '../../src/game/balance';
import { fillBasin } from '../../src/game/actions';
import { advance, createWorld } from '../../src/game/sim';
import { createNewSave } from '../../src/game/state';
import { START_ZONE } from '../../src/game/zones';
import { RECIPES, STATIONS, lineCost } from '../../src/game/recipes';
import { bakeryHint, nextHint } from '../../src/ui/hints';

function fresh() {
  return createNewSave({ seed: 1, now: 0 });
}

describe('新手引導完全從 state 推導', () => {
  it('開局叫玩家倒焦糖', () => {
    expect(nextHint(fresh())?.id).toBe('pour');
  });

  it('沒庫存時改叫去補貨，而不是叫他倒一個倒不出來的東西', () => {
    const s = fresh();
    s.stock.caramel = 0;
    expect(nextHint(s)?.id).toBe('restock');
  });

  it('真實流程：手動倒一份、布丁跳進去把盆用空，仍要說「泡澡中」再說「去撿」（不能退回「倒焦糖」）', () => {
    const s = fresh();
    const w = createWorld(s, { minX: -0.9, maxX: 0.9, minZ: -0.55, maxZ: 0.55 });
    expect(fillBasin(s, 0, 'caramel', w.emit).ok).toBe(true);
    for (let i = 0; i < 120 && !s.puddings.some((p) => p.mode === 'bathing'); i++) advance(w, 0.5);
    expect(s.puddings.some((p) => p.mode === 'bathing')).toBe(true);
    expect(s.basins[0]!.units).toBe(0); // 手動只倒一份，進盆就被用掉
    expect(nextHint(s)?.id).toBe('bathing');

    for (let i = 0; i < 200 && s.drops.length === 0; i++) advance(w, 0.5);
    expect(s.drops.length).toBeGreaterThan(0);
    expect(nextHint(s)?.id).toBe('pick');
  });

  it('生產線停擺（液體全空、盆空、有布丁想泡澡）要警告，買了設備之後也要', () => {
    const s = fresh();
    s.equipment[s.activeZone]!.collector = true;
    s.equipment[s.activeZone]!.autoFill = true;
    s.stock.caramel = 0;
    s.stock.milk = 0;
    s.puddings[0]!.caramel = 5;
    s.basins[0]!.preferredLiquid = 'caramel'; // 裝了注液閥的玩家一定倒過
    const h = nextHint(s);
    expect(h?.id).toBe('stalled');
    expect(h?.warning).toBe(true);

    // 有注液閥時只看它會補的那一種：庫存有牛乳也沒用，閥不會自己換口味
    s.stock.milk = 1;
    expect(nextHint(s)?.id).toBe('stalled');
    expect(nextHint(s)?.text).toContain('熱焦糖');
    // 沒有注液閥＝玩家自己倒，還有牛乳可以倒就不算停擺
    s.equipment[s.activeZone]!.autoFill = false;
    expect(nextHint(s)?.id).not.toBe('stalled');
    s.stock.milk = 0;
    expect(nextHint(s)?.id).toBe('stalled');
    s.equipment[s.activeZone]!.restock = true; // 補貨合約會自己補，不用講
    expect(nextHint(s)).toBeNull();
  });

  it('倒了之後換成「泡澡中」／「去撿」', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.puddings[0]!.mode = 'bathing';
    expect(nextHint(s)?.id).toBe('bathing');

    s.puddings[0]!.mode = 'resting';
    s.drops.push({ id: 'd1', zone: START_ZONE, kind: 'ingredient' as const, species: 'caramel', pos: { x: 0, z: 0 }, bornAt: 0, star: 1 as const });
    expect(nextHint(s)?.id).toBe('pick');
  });

  it('機器與材料都齊了就帶去甜點店，做過一盤之後不再講（D50／D57）', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    for (const id of RECIPES.caramel.route) s.bakery.machines[id] = 1;
    s.eggs = 2;
    s.ingredients.caramel = [1, 0, 0, 0, 0];
    s.stock.milk = 1;
    s.pantry.flour = 1;
    expect(nextHint(s)?.id).toBe('bakery');

    s.stats.baked = 2;
    expect(nextHint(s)?.id).not.toBe('bakery');
  });

  it('材料齊了但沒機器：不叫他去甜點店開工（去了也開不了）', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.eggs = 2;
    s.ingredients.caramel = [1, 0, 0, 0, 0];
    s.stock.milk = 1;
    s.coins = 0;
    expect(nextHint(s)?.id).not.toBe('bakery');
  });

  it('工坊裡沒機器：第一句就是去商店工坊頁買，並列出焦糖布丁塔要的機器與總價', () => {
    const s = fresh();
    const h = bakeryHint(s);
    expect(h?.id).toBe('bk-buy');
    for (const id of RECIPES.caramel.route) expect(h?.text).toContain(STATIONS[id].name);
    expect(h?.text).toContain(String(lineCost(s, 'caramel')));
  });

  it('只有原料沒有蛋：不叫他去甜點店（去了也開不了工）', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.ingredients.caramel = [99, 0, 0, 0, 0];
    expect(nextHint(s)?.id).not.toBe('bakery');
  });

  it('成品櫃有甜點、還沒有客人買過：叫他上架', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.desserts.caramel = [1, 0, 0, 0, 0];
    expect(nextHint(s)?.id).toBe('shelf');
  });

  it('有成就可以領、一次都沒領過：先講成就（開局資金）', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.stats.baths = 1;
    expect(nextHint(s)?.id).toBe('achieve');
    s.claimedAchievements.push('firstBath');
    expect(nextHint(s)?.id).not.toBe('achieve');
  });

  it('錢夠了就指向第一台設備', () => {
    const s = fresh();
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 1;
    s.coins = EQUIPMENT.collector.price;
    expect(nextHint(s)?.id).toBe('buy');
  });

  it('買下任何一台設備之後就完全不再出現', () => {
    const s = fresh();
    s.equipment[s.activeZone]!.collector = true;
    expect(nextHint(s)).toBeNull();
    s.stock.caramel = 0;
    expect(nextHint(s)).toBeNull();
  });

  it('只看「玩家正在看的那一區」——別的區有液體不算', () => {
    const s = fresh();
    s.basins.push({ zone: 'c0t2', liquid: 'caramel', units: 3, preferredLiquid: 'caramel', pos: { x: 0, z: 0 }, occupantId: null });
    expect(nextHint(s)?.id).toBe('pour'); // 啟用區的盆還是空的
    s.activeZone = 'c0t2';
    expect(nextHint(s)?.id).not.toBe('pour');
  });
});

/**
 * 2026-09-22 使用者回報：「我的小布丁跑完牛奶沒有再增加」。
 * 存檔碼解開後的實況：3 隻布丁 caramel 全 0、drops 0、盆空、`preferredLiquid: 'milk'`、
 * 牛乳 0、焦糖還有 2 份、只解鎖一區、泡了 21 次澡只生 1 隻。
 * 兩個坑：提示說「布丁照樣會掉原料」（D35 之後是假的），以及全程沒人講「住滿了」。
 */
describe('2026-09-22 回報：注液閥卡在牛乳、農場整個停住', () => {
  /** 重建使用者那份存檔的關鍵欄位 */
  function stalledSave() {
    const s = fresh();
    s.equipment[s.activeZone]!.autoFill = true;
    s.equipment[s.activeZone]!.collector = true;
    s.stock.caramel = 2;
    s.stock.milk = 0;
    s.basins[0]!.liquid = null;
    s.basins[0]!.units = 0;
    s.basins[0]!.preferredLiquid = 'milk';
    for (const p of s.puddings) p.caramel = 0;
    return s;
  }

  it('注液閥的口味沒庫存、但焦糖還有：要指名叫玩家按「倒焦糖」', () => {
    const h = nextHint(stalledSave());
    expect(h?.id).toBe('stalled');
    expect(h?.warning).toBe(true);
    expect(h?.text).toContain('倒焦糖'); // 出路＝動作列上那顆按鈕的字
    expect(h?.text).toContain('不會自己換口味');
  });

  it('不可以再說「布丁照樣會掉原料」——D35 之後焦糖見底就完全停產', () => {
    // 負向對照：把這句話寫回去，這條就要紅
    expect(nextHint(stalledSave())?.text).not.toContain('照樣會掉原料');
    // 而且要把「連原料都不會掉」講出來，否則玩家只會以為少了泡澡這件事
    expect(nextHint(stalledSave())?.text).toContain('原料都不會掉');
  });

  it('真的什麼都沒得倒的時候，還是叫他去補貨', () => {
    const s = stalledSave();
    s.stock.caramel = 0;
    const h = nextHint(s);
    expect(h?.id).toBe('stalled');
    expect(h?.text).toContain('去商店補貨');
    expect(h?.text).not.toContain('照樣會掉原料');
  });
});

describe('2026-09-22 回報：住滿了還一直泡牛乳，21 次澡只生 1 隻', () => {
  /** 已解鎖的唯一一區住滿 zoneCapacity 隻，而且手上還有牛乳 */
  function fullSave() {
    const s = fresh();
    const proto = s.puddings[0]!;
    while (s.puddings.length < BALANCE.zoneCapacity) {
      s.puddings.push({ ...proto, id: `pX${s.puddings.length}`, pos: { ...proto.pos }, from: { ...proto.from }, to: { ...proto.to } });
    }
    s.stock.milk = 5;
    s.basins[0]!.liquid = 'caramel';
    s.basins[0]!.units = 2; // 盆裡有東西，才不會先被 stalled 攔走
    return s;
  }

  it('每一區都滿了又還在碰牛乳：要常駐警告，並指路去解鎖下一區', () => {
    const h = nextHint(fullSave());
    expect(h?.id).toMatch(/^zonefull:/);
    expect(h?.dismissable).toBe(true);
    expect(h?.warning).toBe(true);
    expect(h?.text).toContain('解鎖');
  });

  it('還有空位就不要唸——新生兒會自己溢出到隔壁', () => {
    const s = fullSave();
    s.zones.find((z) => z.id === 'c0t2')!.unlocked = true;
    expect(String(nextHint(s)?.id)).not.toMatch(/^zonefull/);
  });

  it('沒在碰牛乳的玩家不用被唸繁殖的事', () => {
    const s = fullSave();
    s.stock.milk = 0;
    s.basins[0]!.preferredLiquid = 'caramel';
    expect(String(nextHint(s)?.id)).not.toMatch(/^zonefull/);
  });

  it('警告排在教學前面：買了設備讓教學停掉，這條仍然要出現', () => {
    const s = fullSave();
    s.equipment[s.activeZone]!.collector = true;
    expect(nextHint(s)?.id).toMatch(/^zonefull:/);
  });
});
