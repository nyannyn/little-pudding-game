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
    file: 'src/game/equipment.ts',
    from: '    if (eq.collector && state.drops.some((d) => d.zone === z.id)) pickAllDrops(state, emit, true, z.id);',
    to: '    if (state.drops.some((d) => d.zone === z.id)) pickAllDrops(state, emit, true, z.id);',
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
  eq[id] = true;`,
    to: `  const gate = null as ActionResult | null;
  if (gate) return gate;
  if (state.coins < info.price) return fail('焦糖幣不夠');
  state.coins -= info.price;
  eq[id] = true;`,
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
  // ── CP8 甜點工坊（D50–D54，2026-09-23）──
  // AC8-1／AC8-2（手動推站、開工只驗蛋）在 D56／D57 食譜制全自動流水線後不存在了，換成下面 AC9-*
  {
    ac: 'AC8-3',
    why: '時鐘直接用 time 算、不扣 epoch，老玩家開店第一天就不是 Day 1',
    file: 'src/game/bakery.ts',
    from: 'const t = state.time - state.bakery.epoch +',
    to: 'const t = state.time +',
    test: 'time 很大的 v7 舊檔升上來',
  },
  {
    ac: 'AC8-4',
    why: '上架不扣預訂單要的份數，散客買走之後訂單交不出去',
    file: 'src/game/bakery.ts',
    from: 'const spare = state.desserts[id] - reservedForOrders(state, id);',
    to: 'const spare = state.desserts[id];',
    test: '上架不會把預訂單要的份數擺出去',
  },
  {
    ac: 'AC8-5',
    why: '退款只算已安裝的、漏掉倉庫裡那幾台',
    file: 'src/game/state.ts',
    from: '    n += Math.max(0, Math.floor(num(rawStoredAll[id], 0)));',
    to: '',
    test: '兩區的加工機＋倉庫一台販賣機',
  },
  {
    ac: 'AC8-7',
    why: '拿掉「最後一隻」的檢查，玩家可以把農場賣空、再也生不出布丁',
    file: 'src/game/actions.ts',
    from: "  if (state.puddings.length <= 1) return '這是最後一隻了';",
    to: '',
    test: '最後一隻不能賣',
  },
  {
    ac: 'AC8-8',
    why: '領取不記錄，同一個成就可以一直領',
    file: 'src/game/achievements.ts',
    from: '  state.claimedAchievements.push(a.id);',
    to: '',
    test: '達成後要領才入帳',
  },
  // ── CP9 食譜制流水線（D56–D58，2026-09-24）──
  {
    ac: 'AC9-2',
    why: '拿掉「路線上的機器買了沒」，沒機器也開得了工',
    file: 'src/game/recipes.ts',
    from: 'const machines = r.route.filter((id) => machineLevel(state, id) === 0);',
    to: 'const machines: StationId[] = [];',
    test: '沒機器：列出路線上還沒買的機器',
  },
  {
    ac: 'AC9-3',
    why: '下一站還有一盤也照推，兩盤疊在同一站、前一盤憑空消失',
    file: 'src/game/bakery.ts',
    from: '    if (st[next].batch) continue;',
    to: '',
    test: '下一站還有一盤就在原站等',
  },
  {
    ac: 'AC9-4',
    why: '份數改成取路線上最高那台，只升烤箱就整條線變 4 份',
    file: 'src/game/recipes.ts',
    from: 'return Math.min(...RECIPES[species].route.map((id) => machineLevel(state, id)));',
    to: 'return Math.max(...RECIPES[species].route.map((id) => machineLevel(state, id)));',
    test: '混級取低',
  },
  {
    ac: 'AC9-5',
    why: '升級不再降低失敗率',
    file: 'src/game/recipes.ts',
    from: 'return RECIPES[species].failRate * machineFailMult(lv);',
    to: 'return RECIPES[species].failRate * 1;',
    test: 'Lv3 打到',
  },
  {
    ac: 'AC9-6',
    why: '沒湊齊任何一條線也照樣來客，新玩家開局一直有撲空的客人',
    file: 'src/game/bakery.ts',
    from: 'if (!c.open || (!anyLineReady(state) && shelfCount(state) === 0)) {',
    to: 'if (!c.open) {',
    test: '開局 30 分鐘：沒有撲空的客人',
  },
  {
    ac: 'AC9-4b',
    why: '份數上限改回「材料要夠機器上限才開得了」，升級之後材料不夠一整盤就開不了工（花錢買降級）',
    file: 'src/game/recipes.ts',
    from: '  return Math.min(linePortions(state, species), affordablePortions(state, species));',
    to: '  return affordablePortions(state, species) >= linePortions(state, species) ? linePortions(state, species) : 0;',
    test: '份數是上限不是門檻',
  },
  // ── CP10（D60／D61）──
  {
    ac: 'AC10-1',
    why: '拿掉份數上限檢查，玩家（或算錯的 UI）要幾份就扣幾份，材料扣成負數',
    file: 'src/game/bakery.ts',
    from: "  if (qty > max) return fail(`這一盤最多 ${max} 份`);\n",
    to: '',
    test: '超過上限、0 份、小數都拒絕',
  },
  {
    ac: 'AC10-2a',
    why: '秒數不看機器等級（升級不會變快）',
    file: 'src/game/recipes.ts',
    from: '  return machineSeconds(id, state.bakery.machines[id]);',
    to: '  return machineSeconds(id, 1);',
    test: '只升烤箱',
  },
  {
    ac: 'AC10-2b',
    why: '進度條用當下等級的秒數算，做到一半升級進度條會往前跳',
    file: 'src/game/bakery.ts',
    from: '  const total = st.doneAt - st.startedAt;',
    to: '  const total = stationSeconds(state, id);',
    test: '做到一半升級',
  },
  {
    ac: 'AC10-3',
    why: 'Lv10 以後升級價不再漲（某一段曲線寫錯）',
    file: 'src/game/recipes.ts',
    from: '  return nicePrice(MACHINE_CURVE.upgradeBase * upgradeCurve(lv));',
    to: '  return nicePrice(MACHINE_CURVE.upgradeBase * upgradeCurve(Math.min(lv, 10)));',
    test: '每一級都比上一級貴',
  },
  {
    ac: 'AC10-3b',
    why: '秒數不再等比（某一級寫錯）',
    file: 'src/game/recipes.ts',
    from: '  return STATIONS[id].sec * MACHINE_CURVE.sec ** (Math.max(1, lv) - 1);',
    to: '  return STATIONS[id].sec * MACHINE_CURVE.sec ** Math.min(Math.max(1, lv) - 1, 9);',
    test: '相鄰兩級秒數比恆為',
  },
  {
    ac: 'AC10-4a',
    why: 'v9 的機器等級照原數字留（舊 Lv3＝4 份變新 Lv3＝3 份，上線當天被削弱）',
    file: 'src/game/bakery.ts',
    from: '      out.machines[id] = Math.min(MAX_MACHINE_LEVEL, v9 ? (V9_MACHINE_LEVEL[Math.min(3, lv)] ?? 0) : lv);',
    to: '      out.machines[id] = Math.min(MAX_MACHINE_LEVEL, lv);',
    test: '1→1、2→3、3→5',
  },
  {
    ac: 'AC10-4b',
    why: 'v9 站上那一盤沒補 startedAt，進度條從 100% 起跳',
    file: 'src/game/bakery.ts',
    from: '        const startedAt = Math.min(doneAt, num(src?.startedAt, doneAt - STATIONS[id].sec));',
    to: '        const startedAt = Math.min(doneAt, num(src?.startedAt, doneAt));',
    test: '站上那一盤照原本的 doneAt 做完',
  },
  {
    ac: 'AC10-5a',
    why: '店員不上架：離線時展示架賣空就停，人氣 Lv6 的里程碑是假的',
    file: 'src/game/bakery.ts',
    from: '  if (hasStaff(state)) stockShelf(state, emit, true);',
    to: '',
    test: '人氣 Lv6 起有店員',
  },
  {
    ac: 'AC10-5b',
    why: '客人間隔不吃人氣等級，升人氣買不到東西',
    file: 'src/game/bakery.ts',
    from: '  const k = fameIntervalMult(bk.fame);',
    to: '  const k = 1;',
    test: '上門的客人數比 Lv6 多一半以上',
  },
  {
    ac: 'AC9-6b',
    why: '閘門不看展示架，v8 老玩家架上的貨在買齊機器前永遠賣不掉',
    file: 'src/game/bakery.ts',
    from: 'if (!c.open || (!anyLineReady(state) && shelfCount(state) === 0)) {',
    to: 'if (!c.open || !anyLineReady(state)) {',
    test: '沒機器但展示架上有貨',
  },
  {
    ac: 'AC9-7',
    why: 'v8 線上做到一半的那一盤只退蛋、漏退原料',
    file: 'src/game/bakery.ts',
    from: "    if (id !== 'crack') state.ingredients[b.species as SpeciesId] += qty * LEGACY_ING_PER;",
    to: '',
    test: '打蛋站那盤只退蛋',
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
