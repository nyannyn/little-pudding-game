import * as THREE from 'three';
import { MACHINE_TIER_SIZE, STATION_IDS, machineTier, type StationId } from '../../game/recipes';
import { Parts } from './build';
import { BELT, CHILL, EGG_BASKET, OVEN, STATION_ANCHOR } from './layout';
import { PAL } from './room';

/**
 * 七台機器的機身（D57：機器要買、有等級）。沒買的站畫一塊空底座；買了畫機器，
 * 機身側邊一排小星星＝等級（一階 5 顆、顏色＝階級，D61）。全部併成一個 mesh，只在「機器等級」變了才重建（買東西才會變，不是每幀）。
 * 會動的部件（蛋、打蛋器、注模嘴、擠花袋、鍋蓋、兩個隧道的光）在 `bakeryView.ts`。
 */
export function machinesSignature(levels: Record<StationId, number>): string {
  return STATION_IDS.map((id) => levels[id]).join('');
}

export function buildMachines(levels: Record<StationId, number>): THREE.BufferGeometry {
  const p = new Parts();
  for (const id of STATION_IDS) {
    const lv = levels[id];
    if (lv <= 0) emptyPad(p, id);
    else {
      BUILD[id](p);
      stars(p, id, lv);
    }
  }
  // 蛋籃是打蛋機的一部分：沒買打蛋機時不放
  if (levels.crack > 0) eggBasket(p);
  return p.merge();
}

/** 沒買的站：帶子旁邊一塊淺色底座＋四角小釘（「這裡會放一台機器」） */
function emptyPad(p: Parts, id: StationId) {
  const { x, z } = padPos(id);
  p.rbox(0xe9e2ea, 0.36, 0.03, 0.26, x, 0.015, z, 0.012);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    p.cyl(0xc9bfcc, 0.018, 0.018, 0.02, x + dx * 0.15, 0.035, z + dz * 0.1, 8);
  }
}

/** 機器本體站的位置（底座／星星用）：後排在帶子後面、右側與前排在帶子內側 */
function padPos(id: StationId): { x: number; z: number } {
  const a = STATION_ANCHOR[id];
  if (id === 'bake') return { x: a.x - 0.36, z: a.z };
  if (id === 'chill' || id === 'decorate') return { x: a.x, z: a.z - 0.4 };
  return { x: a.x, z: a.z - 0.36 };
}

/** 階級配色（D61）：鐵／銅／銀／金，跟底座牌左邊那條色帶同色 */
const TIER_COLORS = [0xb9b3c2, 0xc98a55, 0xdfe6ee, 0xf1c24b] as const;

/**
 * 等級星星：機器前面一排小球。20 級不能排 20 顆（擠滿帶子側邊），
 * 所以一階 5 顆、顏色＝階級：Lv7＝兩顆銅色。跨階那一刻星星變回 1 顆、換顏色，看得出「突破」了。
 */
function stars(p: Parts, id: StationId, lv: number) {
  const a = STATION_ANCHOR[id];
  const y = BELT.y - 0.08;
  const tier = machineTier(lv);
  const n = lv - (tier - 1) * MACHINE_TIER_SIZE;
  const color = TIER_COLORS[tier - 1] ?? PAL.butter;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 0.05;
    if (id === 'bake') p.sphere(color, 0.018, a.x - BELT.w / 2 - 0.04, y, a.z + off, undefined, 10);
    else if (id === 'chill' || id === 'decorate') p.sphere(color, 0.018, a.x + off, y, a.z + BELT.w / 2 + 0.04, undefined, 10);
    else p.sphere(color, 0.018, a.x + off, y, a.z + BELT.w / 2 + 0.04, undefined, 10);
  }
}

const BUILD: Record<StationId, (p: Parts) => void> = { stove, crack, mix, mold, bake, chill, decorate };

/** 爐台：帶子後面的奶油色爐身＋兩個爐口，上面一只薄荷小鍋；一支加熱燈臂伸到帶子上方 */
function stove(p: Parts) {
  const a = STATION_ANCHOR.stove;
  const bz = a.z - 0.36;
  p.rbox(0xfff4e0, 0.42, 0.72, 0.3, a.x, 0.36, bz, 0.04);
  p.rbox(PAL.pink, 0.36, 0.18, 0.02, a.x, 0.36, bz + 0.155, 0.02);
  for (const dx of [-0.08, 0.08]) p.cyl(PAL.cream, 0.025, 0.025, 0.02, a.x + dx, 0.36, bz + 0.165, 12, { x: Math.PI / 2, y: 0, z: 0 });
  p.torus(PAL.dark, 0.07, 0.012, a.x - 0.09, 0.73, bz, { x: Math.PI / 2, y: 0, z: 0 });
  p.torus(PAL.dark, 0.06, 0.012, a.x + 0.1, 0.73, bz, { x: Math.PI / 2, y: 0, z: 0 });
  // 鍋身（鍋蓋在 view 裡會跳）
  p.cyl(PAL.mint, 0.08, 0.07, 0.1, a.x - 0.09, 0.79, bz, 18);
  p.box(PAL.mintDark, 0.08, 0.02, 0.02, a.x - 0.2, 0.82, bz);
  // 加熱燈臂：柱＋往前伸到帶子上方的燈罩
  p.rbox(PAL.metal, 0.04, 0.34, 0.04, a.x + 0.16, 0.9, bz + 0.05, 0.015);
  p.rbox(PAL.metal, 0.04, 0.04, 0.36, a.x + 0.16, 1.06, a.z - 0.16, 0.015);
  p.cone(PAL.butter, 0.08, 0.08, a.x + 0.16, 1.0, a.z, 16);
}

/** 打蛋機：帶子後面的薄荷色柱子＋橫臂伸到帶子上方（臂上的蛋在 view 裡落下裂開） */
function crack(p: Parts) {
  const a = STATION_ANCHOR.crack;
  const bz = a.z - 0.34;
  p.rbox(PAL.mint, 0.34, 0.1, 0.26, a.x, 0.05, bz, 0.03);
  p.rbox(PAL.mintDark, 0.12, 1.0, 0.12, a.x, 0.55, bz, 0.04);
  p.rbox(PAL.mint, 0.12, 0.09, 0.44, a.x, 1.08, a.z - 0.14, 0.04);
  p.cyl(PAL.mintDark, 0.06, 0.04, 0.06, a.x, 1.01, a.z, 14);
  p.sphere(PAL.pink, 0.035, a.x, 1.15, bz);
}

/** 蛋籃：打蛋機旁 */
function eggBasket(p: Parts) {
  const b = EGG_BASKET;
  p.cyl(PAL.wood, 0.03, 0.03, b.y - 0.1, b.x, (b.y - 0.1) / 2, b.z, 8);
  p.cyl(PAL.basket, 0.12, 0.09, 0.1, b.x, b.y - 0.05, b.z, 16);
  p.torus(PAL.woodDark, 0.12, 0.012, b.x, b.y, b.z, { x: Math.PI / 2, y: 0, z: 0 });
  for (const [dx, dz] of [[-0.04, -0.03], [0.05, 0], [-0.01, 0.05]] as const) {
    p.sphere(PAL.egg, 0.042, b.x + dx, b.y + 0.03, b.z + dz, { x: 1, y: 1.25, z: 1 });
  }
}

/** 桌上型攪拌機（粉紅）：帶子後面的底座＋柱，機頭往前伸到帶子上方（打蛋器在 view 裡轉） */
function mix(p: Parts) {
  const a = STATION_ANCHOR.mix;
  const bz = a.z - 0.34;
  p.rbox(PAL.pink, 0.34, 0.1, 0.26, a.x, 0.05, bz, 0.04);
  p.rbox(PAL.pink, 0.16, 0.9, 0.16, a.x, 0.5, bz, 0.06);
  p.rbox(PAL.pink, 0.2, 0.18, 0.5, a.x, 0.98, a.z - 0.1, 0.08);
  p.sphere(PAL.pinkDark, 0.06, a.x, 0.98, a.z + 0.16);
  p.cyl(PAL.cream, 0.035, 0.035, 0.03, a.x + 0.11, 0.98, a.z - 0.2, 10, { x: 0, y: 0, z: Math.PI / 2 });
  p.cyl(PAL.metal, 0.02, 0.02, 0.06, a.x, 0.87, a.z, 10);
}

/** 裝模機（奶油黃）：跨在帶子上的門架＋頂上漏斗（注模嘴在 view 裡沿橫樑來回） */
function mold(p: Parts) {
  const a = STATION_ANCHOR.mold;
  const half = BELT.w / 2 + 0.06;
  for (const dz of [-half, half]) {
    p.rbox(PAL.butterDark, 0.06, 1.0, 0.06, a.x - 0.22, 0.5, a.z + dz, 0.02);
    p.rbox(PAL.butterDark, 0.06, 1.0, 0.06, a.x + 0.22, 0.5, a.z + dz, 0.02);
  }
  p.rbox(PAL.butter, 0.5, 0.08, half * 2 + 0.08, a.x, 1.0, a.z, 0.03);
  p.cone(PAL.cream, 0.13, 0.2, a.x, 1.18, a.z - 0.08, 20, { x: Math.PI, y: 0, z: 0 });
  p.cyl(PAL.butterDark, 0.14, 0.14, 0.04, a.x, 1.29, a.z - 0.08, 20);
}

/** 隧道烤箱（薰衣草紫）：跨在右側那段帶子上，正對鏡頭的側面開一扇窗（窗裡的光在 view 裡） */
function bake(p: Parts) {
  const { x, z, len, w, h } = OVEN;
  const y0 = BELT.y - 0.02;
  // 頂＋兩側牆（帶子從中間穿過）
  p.rbox(PAL.lavender, w, 0.1, len, x, y0 + h, z, 0.05);
  p.rbox(PAL.lavender, 0.08, h, len, x - w / 2 + 0.04, y0 + h / 2, z, 0.03);
  p.rbox(PAL.lavender, 0.08, h, len, x + w / 2 - 0.04, y0 + h / 2, z, 0.03);
  // 隧道口的深色門簾框
  for (const dz of [-len / 2, len / 2]) p.box(PAL.lavenderDark, w, 0.06, 0.03, x, y0 + h - 0.06, z + dz);
  // 旋鈕貼在隧道左側牆外（內側不放機身：會擋住後排裝模機的名牌，2026-09-24 截圖）
  for (const dz of [-0.16, 0, 0.16]) p.cyl(PAL.lavenderDark, 0.03, 0.03, 0.03, x - w / 2 - 0.005, y0 + h * 0.6, z + dz, 14, { x: 0, y: 0, z: Math.PI / 2 });
  // 兩側牆往下延伸到地板的腳
  for (const dx of [-w / 2 + 0.04, w / 2 - 0.04]) for (const dz of [-len / 2 + 0.05, len / 2 - 0.05]) p.cyl(PAL.lavenderDark, 0.025, 0.025, y0, x + dx, y0 / 2, z + dz, 8);
  // 頂上的煙囪＋蝴蝶結
  p.cyl(PAL.metal, 0.05, 0.05, 0.22, x + 0.1, y0 + h + 0.15, z - 0.16, 14);
  p.sphere(PAL.pink, 0.045, x - 0.12, y0 + h + 0.08, z + len / 2 - 0.05);
  p.cone(PAL.pink, 0.045, 0.09, x - 0.18, y0 + h + 0.08, z + len / 2 - 0.05, 10, { x: 0, y: 0, z: Math.PI / 2 });
  p.cone(PAL.pink, 0.045, 0.09, x - 0.06, y0 + h + 0.08, z + len / 2 - 0.05, 10, { x: 0, y: 0, z: -Math.PI / 2 });
}

/** 冷藏櫃：跨在前排帶子上的淺藍隧道，頂上一片雪花（玻璃與冷光在 view 裡） */
function chill(p: Parts) {
  const { x, z, len, w, h } = CHILL;
  const y0 = BELT.y - 0.02;
  // 帶子沿 x 走：兩側牆在 ±z
  p.rbox(0xbfe6ff, len, 0.08, w, x, y0 + h, z, 0.04);
  p.rbox(0xbfe6ff, len, h, 0.06, x, y0 + h / 2, z - w / 2 + 0.03, 0.02);
  p.box(0x8cc9ee, len + 0.02, 0.04, 0.04, x, y0 + h - 0.02, z + w / 2 - 0.02);
  for (const dx of [-len / 2 + 0.03, len / 2 - 0.03]) p.box(0x8cc9ee, 0.04, h, 0.04, x + dx, y0 + h / 2, z + w / 2 - 0.02);
  // 內側的壓縮機箱
  p.rbox(0xbfe6ff, len, BELT.y + h - 0.1, 0.24, x, (BELT.y + h - 0.1) / 2, z - w / 2 - 0.12, 0.04);
  for (let i = 0; i < 4; i++) p.box(0x8cc9ee, len - 0.12, 0.015, 0.01, x, 0.2 + i * 0.07, z - w / 2 - 0.0);
  // 雪花
  const sy = y0 + h + 0.07;
  for (let i = 0; i < 3; i++) p.box(PAL.trim, 0.14, 0.02, 0.02, x, sy, z, { x: 0, y: (i * Math.PI) / 3, z: 0 });
}

/** 裝飾台：跨在前排帶子上的薄荷門架，橫樑下吊著擠花袋（擠花袋在 view 裡下壓）；內側一桌糖珠罐 */
function decorate(p: Parts) {
  const a = STATION_ANCHOR.decorate;
  const half = BELT.w / 2 + 0.06;
  for (const dz of [-half, half]) {
    p.rbox(PAL.mintDark, 0.05, 0.62, 0.05, a.x - 0.15, BELT.y + 0.3, a.z + dz, 0.02);
    p.rbox(PAL.mintDark, 0.05, 0.62, 0.05, a.x + 0.15, BELT.y + 0.3, a.z + dz, 0.02);
  }
  p.rbox(PAL.mint, 0.36, 0.06, half * 2 + 0.06, a.x, BELT.y + 0.62, a.z, 0.03);
  // 內側小桌＋糖珠罐
  const tz = a.z - 0.42;
  p.rbox(PAL.wood, 0.4, 0.05, 0.2, a.x, BELT.y - 0.05, tz, 0.02);
  p.cyl(PAL.woodDark, 0.02, 0.02, BELT.y - 0.08, a.x, (BELT.y - 0.08) / 2, tz, 8);
  [PAL.pink, PAL.butter, PAL.lavender].forEach((c, i) => {
    p.cyl(0xe9f2f6, 0.035, 0.035, 0.08, a.x - 0.11 + i * 0.11, BELT.y + 0.02, tz, 12);
    p.cyl(c, 0.03, 0.03, 0.05, a.x - 0.11 + i * 0.11, BELT.y + 0.005, tz, 12);
  });
}
