#!/usr/bin/env node
/**
 * AC11-12 節奏判定（CP11，2026-09-25）：讀月玩家量表的輸出，逐條對計畫的上下界。
 *
 * 用法：
 *   PACING_ONLY=month PACING_JSON=/tmp/month.json npm run pacing
 *   node tools/pacing/ac11-12.mjs /tmp/month.json
 * 全過 exit 0，任何一條不過 exit 1（每條印出實際值與界線）。
 *
 * 下界防太快（計畫：這是最可能的失敗）、上界防太慢；另外守 D61 的升級節奏（第 2–6 段任兩段比 ≤ 2）。
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('用法：node tools/pacing/ac11-12.mjs <PACING_JSON 的路徑>');
  process.exit(2);
}
const runs = JSON.parse(readFileSync(file, 'utf8'));
let bad = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '[v]' : '[X]'} ${label}：${detail}`);
  if (!ok) bad++;
};
const dayOr = (v) => (typeof v === 'number' ? v : Infinity);

for (const [name, r] of Object.entries(runs)) {
  console.log(`\n== ${name} ==`);
  const s3 = dayOr(r.starDay['3']);
  const s4 = dayOr(r.starDay['4']);
  const s5 = dayOr(r.starDay['5']);
  const max = Object.values(r.regMaxDay);
  const unlocked = Object.keys(r.regUnlockDay).length;
  // 下界
  check('第一顆 ★4 不早於第 3 天', s4 >= 3, `第 ${r.starDay['4'] ?? '—'} 天`);
  check('第一顆 ★5 不早於第 10 天', s5 >= 10, `第 ${r.starDay['5'] ?? '—'} 天`);
  check('第 5 天前沒有任何常客 ♥10', max.every((d) => d >= 5), `最早 ♥10：第 ${max.length ? Math.min(...max) : '—'} 天`);
  check('第 20 天前不會 8 位全 ♥10', !(max.length >= 8 && Math.max(...max) < 20), `♥10 的有 ${max.length} 位，最晚第 ${max.length ? Math.max(...max) : '—'} 天`);
  // 上界
  check('第一顆 ★3 在第 2 天內', s3 <= 2, `第 ${r.starDay['3'] ?? '—'} 天`);
  check('第一顆 ★4 在第 8 天內', s4 <= 8, `第 ${r.starDay['4'] ?? '—'} 天`);
  check('第一顆 ★5 在第 18 天內', s5 <= 18, `第 ${r.starDay['5'] ?? '—'} 天`);
  check('8 位常客第 30 天前全部解鎖', unlocked >= 8, `解鎖 ${unlocked} 位`);
  check('第 30 天前至少 4 位 ♥10', max.length >= 4, `${max.length} 位`);
  // D61 升級節奏
  const seg = r.buckets.slice(1);
  const ratio = Math.max(...seg) / Math.max(1, Math.min(...seg));
  check('D61 升級節奏：第 2–6 段任兩段比 ≤ 2', ratio <= 2, `${seg.join(' / ')}（比 ${ratio.toFixed(2)}）`);
}
console.log(bad ? `\n${bad} 條不過` : '\n全部通過');
process.exit(bad ? 1 : 0);
