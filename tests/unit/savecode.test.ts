import { describe, expect, it } from 'vitest';
import { exportCode, importCode } from '../../src/game/savecode';
import { SCHEMA_VERSION, createNewSave, zeroStats, type GameState } from '../../src/game/state';

/** 一份「玩過一陣子」的存檔：匯出入要一個欄位都不掉 */
function played(): GameState {
  const s = createNewSave({ seed: 4242, now: 1_700_000_000_000 });
  s.coins = 1234;
  s.xp = 560;
  s.eggs = 7;
  s.stock.caramel = 42;
  s.ingredients.matcha = 3;
  s.desserts.strawberry = 2;
  s.stats = { ...zeroStats(), baths: 11, sold: 9, mutations: 1, picked: 30, crafted: 6, births: 2, baked: 4, served: 3 };
  s.time = 3600;
  return s;
}

describe('D37 存檔碼', () => {
  it('匯出再匯入＝同一份存檔', () => {
    const before = played();
    const after = importCode(exportCode(before));

    expect(after).not.toBeNull();
    expect(after!.coins).toBe(1234);
    expect(after!.xp).toBe(560);
    expect(after!.eggs).toBe(7);
    expect(after!.stock.caramel).toBe(42);
    expect(after!.ingredients.matcha).toBe(3);
    expect(after!.desserts.strawberry).toBe(2);
    expect(after!.stats).toEqual(before.stats);
    expect(after!.puddings.length).toBe(before.puddings.length);
    expect(after!.puddings.map((p) => p.species)).toEqual(before.puddings.map((p) => p.species));
  });

  it('前後的空白與換行不影響（從備忘錄貼過來常夾帶）', () => {
    const code = exportCode(played());
    expect(importCode(`\n  ${code.slice(0, 20)}\n${code.slice(20)}  \n`)?.coins).toBe(1234);
  });

  it('被截斷的碼＝null，不會吃下半份資料', () => {
    const code = exportCode(played());
    expect(importCode(code.slice(0, code.length - 30))).toBeNull();
  });

  it('改掉一個字元＝null（檢查碼擋下來）', () => {
    const code = exportCode(played());
    const i = Math.floor(code.length / 2);
    const swapped = code[i] === 'A' ? 'B' : 'A';
    expect(importCode(code.slice(0, i) + swapped + code.slice(i + 1))).toBeNull();
  });

  it('不是存檔碼的東西＝null', () => {
    for (const junk of ['', 'hello', 'LPG1', 'LPG1.zzz', 'LPG2.abc.def', '{"coins":999}']) {
      expect(importCode(junk)).toBeNull();
    }
  });

  it('沒有布丁的碼＝null（還原它等於把現有進度換成空農場）', () => {
    const empty = { ...played(), puddings: [] };
    expect(importCode(exportCode(empty as GameState))).toBeNull();
  });

  it('舊版本的碼照樣吃得下：走 migrate 補值，不是原樣塞回去', () => {
    // v1 的存檔：沒有 zone／genes／xp／eggs
    const old = {
      schemaVersion: 1,
      coins: 300,
      time: 120,
      stats: { baths: 4, sold: 2, mutations: 0, picked: 5, crafted: 1, births: 0 },
      puddings: [{ id: 'p1', species: 'caramel', pos: { x: 0, z: 0 }, caramel: 80 }],
    };
    const json = JSON.stringify(old);
    // 直接照 exportCode 的格式手工組一份舊碼
    const code = exportCode(old as unknown as GameState);
    expect(json.length).toBeGreaterThan(0);

    const back = importCode(code);
    expect(back).not.toBeNull();
    expect(back!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(back!.coins).toBe(300);
    expect(back!.puddings[0]?.zone).toBeTruthy();
    expect(back!.puddings[0]?.genes).toBeTruthy();
    expect(back!.eggs).toBe(0);
    // xp 從 stats 回推，不會把老玩家降回 Lv.1
    expect(back!.xp).toBeGreaterThan(0);
  });
});
