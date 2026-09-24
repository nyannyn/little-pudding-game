import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AC11-4：原料／甜點／展示架帶星級之後（D64），**所有讀寫一律經 `src/game/stock.ts`**。
 *
 * 為什麼要掃：這三個欄位改版前散在十幾個檔案，型別從數字變成「每個星級一格」的陣列。
 * `src/` 在 tsconfig 裡、tsc 會擋；但 `tools/`（量表、試玩腳本、截圖腳本、負向對照）不在，
 * 在那裡寫 `s.ingredients.caramel += 1` 不會有任何錯，只會把數字加到陣列上變成字串——
 * 量表照跑、數字全錯。所以掃 `src/` 與 `tools/` 兩棵樹。
 * （e2e 的 `page.evaluate` 在 tsconfig 裡，改型別後會直接編譯失敗，不必掃。）
 */

const ROOT = join(__dirname, '..', '..');
// 負向對照工具裡的是「要注入的壞程式碼」字串（故意違規來證明這條測試會紅），不是真的存取
const ALLOWED = new Set(['src/game/stock.ts', 'tools/check-negative-controls.mjs']);
// 最後一條：`Object.assign(s.bakery.shelf, { caramel: 3 })` 也是直接寫進去（截圖腳本就這樣寫過）
const FORBIDDEN = /\bingredients\[|\.ingredients\.|\bdesserts\[|\.desserts\.|\bshelf\[|\.shelf\.|Object\.assign\([^,]*\.(?:ingredients|desserts|shelf)\b/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
}

export function stockViolations(roots: string[]): string[] {
  const files: string[] = [];
  for (const r of roots) walk(join(ROOT, r), files);
  const hits: string[] = [];
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // 註解裡提到欄位名不算存取
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      if (FORBIDDEN.test(code)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('庫存單一出入口（AC11-4）', () => {
  it('src/ 與 tools/ 裡 stock.ts 以外沒有直接索引 ingredients／desserts／shelf', () => {
    expect(stockViolations(['src', 'tools'])).toEqual([]);
  });
});
