#!/usr/bin/env node
/**
 * 負向對照檢查：把規則一條一條「改壞」，確認對應的測試真的會紅。
 *
 * 為什麼需要這支：全綠的測試不代表它在測東西。計畫的驗收條件明寫
 * 「每條負向對照都要真的紅過才算數」，這支就是把那件事變成可重跑的證據。
 *
 * 還原用的是「反向字串替換」，不是 `git checkout --`——後者會把該檔案
 * 全部未 commit 的工作一起洗掉。跑之前會先確認要動的檔案是乾淨的原文。
 *
 * 用法：node tools/check-negative-controls.mjs
 * 全部通過 exit 0；任何一條「改壞了測試還是綠的」就 exit 1。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CASES = [
  {
    ac: 'AC2-1',
    why: '把「澡盆要有液體才算可用」拿掉，空盆也會被選成跳躍目標',
    file: 'src/game/basin.ts',
    from: 'return b.units >= BALANCE.bathLiquidCost && b.occupantId === null;',
    to: 'return b.occupantId === null;',
    test: '負向對照：澡盆是空的',
  },
  {
    // D34（2026-09-22）：變白突變整套拿掉，牛奶澡改成「泡完就生一隻」
    ac: 'AC2-3',
    why: '拿掉液體判斷，泡焦糖澡也會生出小布丁',
    file: 'src/game/pudding.ts',
    from: "  if (liquid === 'milk') {",
    to: '  if (true) {',
    test: '負向對照：泡焦糖澡不會生',
  },
  {
    ac: 'AC2-4',
    why: '拿掉 48 小時門檻比較，47 小時就會提早突變',
    file: 'src/game/pudding.ts',
    from: 'if (next >= BALANCE.flavorThresholdSec && p.species !== key)',
    to: 'if (next >= 0 && p.species !== key)',
    test: '累積 47 小時不變',
  },
  {
    ac: 'AC2-5',
    why: '拿掉離線 8 小時上限，離開 24 小時會結算 24 小時',
    file: 'src/game/sim.ts',
    from: 'const capped = Math.min(elapsedSec, BALANCE.offlineCapSec);',
    to: 'const capped = elapsedSec;',
    test: '離開 24 小時',
  },
  {
    ac: 'AC2-8',
    why: '拿掉收集手的旗標判斷，有設備與沒設備的結果會一模一樣',
    file: 'src/game/pudding.ts',
    from: '  if (state.equipment.collector) {',
    to: '  if (true) {',
    test: '沒有收集手',
  },
  {
    ac: 'AC2-9',
    why: '拿掉掉落上限，地上會堆到第 6 份',
    file: 'src/game/pudding.ts',
    from: 'if (state.drops.filter((d) => d.zone === zone).length >= BALANCE.dropCap) return false;',
    to: 'if (state.drops.filter((d) => d.zone === zone).length >= 9999) return false;',
    test: '地上已經 5 份時',
  },
  {
    ac: 'AC3-1',
    why: '把賣原料的金幣加總改成 0，只有「賣後金幣增加」那一步會紅',
    file: 'src/game/actions.ts',
    from: '  const coins = SPECIES[species].ingredientPrice * n;',
    to: '  const coins = 0;',
    test: '撿起來就入庫，賣掉就加錢',
  },
  {
    ac: 'AC2-7',
    why: '買設備時先扣錢再檢查餘額，失敗後 state 就不再等於原樣',
    file: 'src/game/actions.ts',
    from: `  if (gate) return gate;
  if (state.coins < info.price) return fail('焦糖幣不夠');
  state.coins -= info.price;`,
    to: `  if (gate) return gate;
  state.coins -= info.price;
  if (state.coins < 0) return fail('焦糖幣不夠');`,
    test: '錢不夠買設備時',
  },
  {
    ac: 'D25',
    why: '拿掉設備的等級守衛，Lv 不夠的玩家直接呼叫 action 也買得到（UI 鎖著就沒意義）',
    file: 'src/game/actions.ts',
    from: `  const gate = levelGate(state, info.level);
  if (gate) return gate;
  if (state.coins < info.price) return fail('焦糖幣不夠');
  state.coins -= info.price;
  state.equipment[id] = true;`,
    to: `  const gate = null as ActionResult | null;
  if (gate) return gate;
  if (state.coins < info.price) return fail('焦糖幣不夠');
  state.coins -= info.price;
  state.equipment[id] = true;`,
    test: '等級不夠買不到設備',
  },
  {
    ac: 'D25',
    why: '目錄把分區的門檻寫成 Lv.1（跟 action 守衛不同一組數字），「目錄 locked ＝ action 買不到」就不再成立',
    file: 'src/game/shop.ts',
    from: `      status: z.unlocked ? 'owned' : gate(z.level),`,
    to: `      status: z.unlocked ? 'owned' : gate(1),`,
    test: '目錄狀態跟 action 守衛一致',
  },
];

function runTest(filter) {
  // filter 內有空白，shell: true 下必須自己補引號，否則 vitest 收到的是半截字串
  const r = spawnSync('npx', ['vitest', 'run', '-t', JSON.stringify(filter)], {
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status ?? 1;
}

let failures = 0;
for (const c of CASES) {
  const original = readFileSync(c.file, 'utf8');
  if (!original.includes(c.from)) {
    console.error(`[X] ${c.ac} 找不到要改壞的原文（程式改過了？）：${c.file}`);
    console.error(`    ${c.from.split('\n')[0]}`);
    failures++;
    continue;
  }

  // 先確認「沒改壞之前」那條測試是綠的，否則紅了也證明不了什麼
  const before = runTest(c.test);
  if (before !== 0) {
    console.error(`[X] ${c.ac} 基準線就不是綠的，先修測試：-t "${c.test}"`);
    failures++;
    continue;
  }

  writeFileSync(c.file, original.replace(c.from, c.to), 'utf8');
  const after = runTest(c.test);
  writeFileSync(c.file, original, 'utf8'); // 反向還原，不碰 git

  const restored = readFileSync(c.file, 'utf8');
  if (restored !== original) {
    console.error(`[X] ${c.ac} 還原失敗，請手動檢查 ${c.file}`);
    process.exit(1);
  }

  if (after === 0) {
    console.error(`[X] ${c.ac} 改壞了測試還是綠的 → 這條負向對照沒有真的在守 (${c.why})`);
    failures++;
  } else {
    console.log(`[v] ${c.ac} 改壞就紅：${c.why}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} 條負向對照沒有通過`);
  process.exit(1);
}
console.log(`\n${CASES.length} 條負向對照全部確認會紅`);
