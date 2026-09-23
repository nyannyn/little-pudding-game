import * as THREE from 'three';
import { Parts } from './build';
import { CAFE, COUNTER, DECOR, DOOR, DOOR_Z0, DOOR_Z1, EGG_BASKET, OVEN, RACK, REGISTER, ROOM, SHOWCASE, STATION_ANCHOR } from './layout';

/** 甜點店配色：粉彩、奶油、薄荷（主流甜點經營遊戲的那種糖果感） */
export const PAL = {
  floorA: 0xffeed6,
  floorB: 0xf5c2cd,
  wall: 0xfbdbe3,
  wainscot: 0xf0aebe,
  trim: 0xffffff,
  wood: 0xdca77c,
  woodDark: 0xb98059,
  mint: 0x86d0b6,
  mintDark: 0x6fbfa5,
  pink: 0xf28ea6,
  pinkDark: 0xe07d95,
  butter: 0xffd66e,
  butterDark: 0xf2c25c,
  lavender: 0xb9a3ec,
  lavenderDark: 0xa28ad9,
  cream: 0xfff8ee,
  metal: 0xd6dee6,
  dark: 0x5a4a5f,
  leaf: 0x86c08a,
  egg: 0xfff4dc,
  basket: 0xc98f55,
} as const;

/**
 * 整間店所有**不會動**的東西：房間、家具、五台機器的機身。全部併成一個 mesh（一個 draw call）。
 * 會動的部件（打蛋臂上的蛋、攪拌器、注模嘴、轉台、烤箱的光）在 `bakeryView.ts` 各自一個 mesh。
 */
export function buildRoom(): THREE.BufferGeometry {
  const p = new Parts();
  const { halfW, backZ, frontZ, wallH } = ROOM;

  // ── 地板：棋盤格磁磚 ──
  const tile = 0.3125;
  for (let x = -halfW; x < halfW - 1e-6; x += tile) {
    for (let z = backZ; z < frontZ - 1e-6; z += tile) {
      const i = Math.round((x + halfW) / tile) + Math.round((z - backZ) / tile);
      p.box(i % 2 ? PAL.floorA : PAL.floorB, tile, 0.04, tile, x + tile / 2, -0.02, z + tile / 2);
    }
  }
  // 地板外緣的厚底座（從前方看得到一條木色邊，像一個立體模型）
  p.box(PAL.woodDark, halfW * 2 + 0.08, 0.16, 0.08, 0, -0.1, frontZ + 0.04);
  p.box(PAL.woodDark, 0.08, 0.16, frontZ - backZ, halfW + 0.04, -0.1, 0);

  // ── 牆：後牆＋左牆（右牆只做後半段，前半段是店門）──
  p.box(PAL.wall, halfW * 2, wallH, 0.08, 0, wallH / 2, backZ - 0.04);
  p.box(PAL.wall, 0.08, wallH, frontZ - backZ, -halfW - 0.04, wallH / 2, 0);
  // 右牆整面，前段開一個店門（DOOR_Z0–DOOR_Z1）
  const rightLen = DOOR_Z0 - backZ;
  p.box(PAL.wall, 0.08, wallH, rightLen, halfW + 0.04, wallH / 2, backZ + rightLen / 2);
  p.box(PAL.wall, 0.08, wallH, frontZ - DOOR_Z1, halfW + 0.04, wallH / 2, (DOOR_Z1 + frontZ) / 2);
  p.box(PAL.wall, 0.08, wallH - 1.3, DOOR_Z1 - DOOR_Z0, halfW + 0.04, 1.3 + (wallH - 1.3) / 2, (DOOR_Z0 + DOOR_Z1) / 2);
  // 腰板＋頂線
  p.box(PAL.wainscot, halfW * 2, 0.62, 0.02, 0, 0.31, backZ + 0.005);
  p.box(PAL.wainscot, 0.02, 0.62, frontZ - backZ, -halfW + 0.005, 0.31, 0);
  p.box(PAL.wainscot, 0.02, 0.62, rightLen, halfW - 0.005, 0.31, backZ + rightLen / 2);
  p.box(PAL.wainscot, 0.02, 0.62, frontZ - DOOR_Z1, halfW - 0.005, 0.31, (DOOR_Z1 + frontZ) / 2);
  p.box(PAL.trim, halfW * 2, 0.04, 0.04, 0, 0.64, backZ + 0.02);
  p.box(PAL.trim, 0.04, 0.04, frontZ - backZ, -halfW + 0.02, 0.64, 0);
  p.box(PAL.trim, 0.04, 0.04, rightLen, halfW - 0.02, 0.64, backZ + rightLen / 2);
  // 後牆上的直條紋壁紙（淡）
  for (let x = -halfW + 0.16; x < halfW; x += 0.32) p.box(0xfbdde4, 0.08, wallH - 0.7, 0.01, x, 0.66 + (wallH - 0.7) / 2, backZ + 0.005);

  // ── 左牆的窗（窗景在 view 裡另一個 mesh：白天藍、晚上深藍）──
  const winZ = -0.4;
  p.box(PAL.trim, 0.05, 0.08, 0.86, -halfW + 0.03, 1.02, winZ);
  p.box(PAL.trim, 0.05, 0.08, 0.86, -halfW + 0.03, 1.72, winZ);
  p.box(PAL.trim, 0.05, 0.7, 0.06, -halfW + 0.03, 1.37, winZ - 0.4);
  p.box(PAL.trim, 0.05, 0.7, 0.06, -halfW + 0.03, 1.37, winZ + 0.4);
  p.box(PAL.trim, 0.04, 0.7, 0.03, -halfW + 0.03, 1.37, winZ);
  // 窗簾（兩片粉紅＋花邊）
  p.rbox(PAL.pink, 0.05, 0.78, 0.18, -halfW + 0.07, 1.36, winZ - 0.5, 0.02);
  p.rbox(PAL.pink, 0.05, 0.78, 0.18, -halfW + 0.07, 1.36, winZ + 0.5, 0.02);
  p.cyl(PAL.woodDark, 0.015, 0.015, 1.2, -halfW + 0.08, 1.78, winZ, 8, { x: Math.PI / 2, y: 0, z: 0 });
  // 窗台上的小盆栽
  p.cyl(PAL.pinkDark, 0.05, 0.04, 0.08, -halfW + 0.1, 1.1, winZ - 0.2, 12);
  p.sphere(PAL.leaf, 0.07, -halfW + 0.1, 1.19, winZ - 0.2);

  // ── 後牆：層架＋罐子＋招牌 ──
  p.box(PAL.wood, halfW * 2 - 0.2, 0.04, 0.2, 0, 1.28, backZ + 0.12);
  const jars = [PAL.pink, PAL.butter, PAL.mint, PAL.lavender, PAL.pink, PAL.butter, PAL.mint];
  jars.forEach((c, i) => {
    const x = -halfW + 0.3 + i * 0.32;
    p.cyl(0xe9f2f6, 0.06, 0.06, 0.13, x, 1.365, backZ + 0.12, 12);
    p.cyl(c, 0.055, 0.055, 0.08, x, 1.345, backZ + 0.12, 12);
    p.cyl(c, 0.065, 0.065, 0.025, x, 1.44, backZ + 0.12, 12);
  });
  // 牆上的時鐘（圓）
  p.cyl(PAL.trim, 0.16, 0.16, 0.03, 0.95, 1.8, backZ + 0.03, 24, { x: Math.PI / 2, y: 0, z: 0 });
  p.torus(PAL.pinkDark, 0.16, 0.018, 0.95, 1.8, backZ + 0.05);

  // ── 後排工作檯 ──
  p.rbox(PAL.cream, halfW * 2 - 0.06, COUNTER.top - 0.06, COUNTER.depth, 0, (COUNTER.top - 0.06) / 2, COUNTER.z, 0.03);
  p.rbox(PAL.wood, halfW * 2, 0.06, COUNTER.depth + 0.04, 0, COUNTER.top - 0.03, COUNTER.z, 0.02);
  // 櫃門與把手
  for (const x of [-0.8, 0, 0.8]) {
    p.rbox(PAL.floorB, 0.56, 0.5, 0.02, x, 0.36, COUNTER.z + COUNTER.depth / 2 + 0.005, 0.01);
    p.sphere(PAL.woodDark, 0.018, x + 0.2, 0.42, COUNTER.z + COUNTER.depth / 2 + 0.02);
  }

  crackMachine(p);
  mixer(p);
  moldMachine(p);
  oven(p);
  decorTable(p);
  showcase(p);
  rack(p);
  register(p);
  entrance(p);
  cafe(p);

  return p.merge();
}

/** 打蛋機：薄荷色底座＋白碗＋上方的打蛋臂（臂上的蛋在 view 裡動）＋左邊一籃蛋 */
function crackMachine(p: Parts) {
  const a = STATION_ANCHOR.crack;
  const y0 = COUNTER.top;
  p.rbox(PAL.mint, 0.5, 0.1, 0.44, a.x + 0.04, y0 + 0.05, a.z - 0.08, 0.04);
  p.cyl(PAL.cream, 0.13, 0.09, 0.09, a.x, y0 + 0.14, a.z, 20); // 碗
  p.cyl(0xf4ecdc, 0.115, 0.115, 0.012, a.x, y0 + 0.18, a.z, 20); // 碗裡的蛋液底
  // 背後的柱子＋頂上的臂
  p.rbox(PAL.mintDark, 0.1, 0.52, 0.1, a.x + 0.18, y0 + 0.36, a.z - 0.22, 0.03);
  p.rbox(PAL.mint, 0.1, 0.08, 0.34, a.x + 0.18, y0 + 0.62, a.z - 0.08, 0.03);
  p.rbox(PAL.mint, 0.22, 0.07, 0.08, a.x + 0.08, y0 + 0.62, a.z + 0.06, 0.03);
  p.sphere(PAL.pink, 0.035, a.x + 0.18, y0 + 0.68, a.z - 0.22); // 頂上的小按鈕
  // 蛋籃
  const b = EGG_BASKET;
  p.cyl(PAL.basket, 0.13, 0.1, 0.1, b.x + 0.1, b.y, b.z + 0.1, 16);
  p.torus(PAL.woodDark, 0.13, 0.012, b.x + 0.1, b.y + 0.05, b.z + 0.1, { x: Math.PI / 2, y: 0, z: 0 });
  for (const [dx, dz] of [[-0.04, -0.03], [0.05, 0], [-0.01, 0.05]] as const) {
    p.sphere(PAL.egg, 0.045, b.x + 0.1 + dx, b.y + 0.08, b.z + 0.1 + dz, { x: 1, y: 1.25, z: 1 });
  }
}

/** 桌上型攪拌機（粉紅）：底座＋後柱＋往前伸的機頭；攪拌頭與碗裡的麵糊在 view 裡 */
function mixer(p: Parts) {
  const a = STATION_ANCHOR.mix;
  const y0 = COUNTER.top;
  p.rbox(PAL.pink, 0.46, 0.08, 0.46, a.x, y0 + 0.04, a.z - 0.06, 0.04);
  p.rbox(PAL.pink, 0.16, 0.52, 0.16, a.x, y0 + 0.32, a.z - 0.24, 0.06);
  p.rbox(PAL.pink, 0.2, 0.18, 0.44, a.x, y0 + 0.62, a.z - 0.1, 0.08);
  p.sphere(PAL.pinkDark, 0.05, a.x, y0 + 0.62, a.z + 0.13); // 機頭前端的圓
  p.cyl(PAL.metal, 0.018, 0.018, 0.06, a.x, y0 + 0.51, a.z, 10); // 攪拌軸座
  // 不鏽鋼碗
  p.cyl(PAL.metal, 0.17, 0.11, 0.2, a.x, y0 + 0.18, a.z, 24);
  p.torus(0xe8eef3, 0.17, 0.012, a.x, y0 + 0.28, a.z, { x: Math.PI / 2, y: 0, z: 0 });
  p.cyl(PAL.cream, 0.035, 0.035, 0.03, a.x + 0.19, y0 + 0.62, a.z - 0.16, 10, { x: 0, y: 0, z: Math.PI / 2 }); // 旋鈕
}

/** 裝模機（奶油黃）：底板上兩個杯位、上方漏斗；注模嘴在 view 裡左右移動 */
function moldMachine(p: Parts) {
  const a = STATION_ANCHOR.mold;
  const y0 = COUNTER.top;
  p.rbox(PAL.butter, 0.52, 0.06, 0.4, a.x, y0 + 0.03, a.z - 0.02, 0.03);
  // 兩根柱＋橫樑
  p.rbox(PAL.butterDark, 0.06, 0.6, 0.06, a.x - 0.23, y0 + 0.33, a.z - 0.18, 0.02);
  p.rbox(PAL.butterDark, 0.06, 0.6, 0.06, a.x + 0.23, y0 + 0.33, a.z - 0.18, 0.02);
  p.rbox(PAL.butter, 0.54, 0.08, 0.1, a.x, y0 + 0.6, a.z - 0.16, 0.03);
  // 漏斗
  p.cone(PAL.cream, 0.13, 0.2, a.x, y0 + 0.78, a.z - 0.16, 20, { x: Math.PI, y: 0, z: 0 });
  p.cyl(PAL.butterDark, 0.14, 0.14, 0.04, a.x, y0 + 0.89, a.z - 0.16, 20);
  // 杯位（兩個凹槽的圈）
  for (const dx of [-0.1, 0.1]) p.torus(PAL.butterDark, 0.065, 0.01, a.x + dx, y0 + 0.065, a.z, { x: Math.PI / 2, y: 0, z: 0 });
}

/** 烤箱（薰衣草紫）：中間挖一個窗洞，洞裡的背板與玻璃在 view 裡（會發光） */
function oven(p: Parts) {
  const { x, z, w, h, d } = OVEN;
  const front = z + d / 2;
  const winW = 0.62, winH = 0.42, winY = 0.52;
  // 窗洞四周的框（左右＋上下），後面整塊背殼
  p.rbox(PAL.lavender, w, h, d - 0.2, x, h / 2 + 0.06, z - 0.1, 0.06);
  p.rbox(PAL.lavender, (w - winW) / 2, h, 0.22, x - (w + winW) / 4, h / 2 + 0.06, front - 0.11, 0.04);
  p.rbox(PAL.lavender, (w - winW) / 2, h, 0.22, x + (w + winW) / 4, h / 2 + 0.06, front - 0.11, 0.04);
  p.rbox(PAL.lavender, winW + 0.02, winY - winH / 2 + 0.06, 0.22, x, (winY - winH / 2 + 0.06) / 2, front - 0.11, 0.03);
  const topH = h + 0.06 - (winY + winH / 2);
  p.rbox(PAL.lavender, winW + 0.02, topH, 0.22, x, winY + winH / 2 + topH / 2, front - 0.11, 0.03);
  // 窗框（白）＋把手＋旋鈕＋腳
  p.box(PAL.trim, winW + 0.04, 0.03, 0.03, x, winY + winH / 2, front + 0.005);
  p.box(PAL.trim, winW + 0.04, 0.03, 0.03, x, winY - winH / 2, front + 0.005);
  p.box(PAL.trim, 0.03, winH, 0.03, x - winW / 2, winY, front + 0.005);
  p.box(PAL.trim, 0.03, winH, 0.03, x + winW / 2, winY, front + 0.005);
  p.cyl(PAL.metal, 0.02, 0.02, winW - 0.1, x, winY + winH / 2 + 0.08, front + 0.05, 10, { x: 0, y: 0, z: Math.PI / 2 });
  for (const dx of [-0.26, -0.12, 0.12, 0.26]) p.cyl(PAL.lavenderDark, 0.035, 0.035, 0.03, x + dx, h - 0.06, front + 0.005, 14, { x: Math.PI / 2, y: 0, z: 0 });
  for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) p.cyl(PAL.dark, 0.035, 0.03, 0.06, x + dx, 0.03, front - 0.1, 10);
  // 頂上的煙囪＋可愛的蝴蝶結
  p.cyl(PAL.metal, 0.06, 0.06, 0.3, x + 0.28, h + 0.2, z - 0.15, 14);
  p.sphere(PAL.pink, 0.05, x - 0.3, h + 0.1, front - 0.12);
  p.cone(PAL.pink, 0.05, 0.1, x - 0.37, h + 0.1, front - 0.12, 10, { x: 0, y: 0, z: Math.PI / 2 });
  p.cone(PAL.pink, 0.05, 0.1, x - 0.23, h + 0.1, front - 0.12, 10, { x: 0, y: 0, z: -Math.PI / 2 });
}

/** 裝飾台：木桌＋粉彩桌巾；轉台與擠花袋的動作在 view 裡 */
function decorTable(p: Parts) {
  const { x, z, top, w, d } = DECOR;
  p.rbox(PAL.wood, w, 0.06, d, x, top - 0.03, z, 0.02);
  p.rbox(PAL.mint, w + 0.02, 0.1, d + 0.02, x, top - 0.08, z, 0.02); // 桌巾垂邊
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    p.cyl(PAL.woodDark, 0.03, 0.025, top - 0.1, x + dx * (w / 2 - 0.06), (top - 0.1) / 2, z + dz * (d / 2 - 0.06), 10);
  }
  // 轉台底座
  const a = STATION_ANCHOR.decorate;
  p.cyl(PAL.metal, 0.05, 0.07, 0.06, a.x, top + 0.03, a.z, 16);
  // 擠花袋的支架（袋子本體在 view 裡下壓）
  p.rbox(PAL.pinkDark, 0.05, 0.5, 0.05, a.x + 0.3, top + 0.25, a.z - 0.18, 0.02);
  p.rbox(PAL.pinkDark, 0.3, 0.05, 0.05, a.x + 0.16, top + 0.48, a.z - 0.18, 0.02);
  // 糖珠罐＋小碗
  const jar = [PAL.pink, PAL.butter, PAL.lavender];
  jar.forEach((c, i) => {
    p.cyl(0xe9f2f6, 0.04, 0.04, 0.1, x - 0.28 + i * 0.1, top + 0.05, z + 0.2, 12);
    p.cyl(c, 0.035, 0.035, 0.06, x - 0.28 + i * 0.1, top + 0.035, z + 0.2, 12);
  });
}

/** 展示櫃：木底座＋玻璃（玻璃在 view 裡半透明）＋階梯層板 */
function showcase(p: Parts) {
  const { x, z, w, d, baseH, glassH } = SHOWCASE;
  p.rbox(PAL.pink, w, baseH, d, x, baseH / 2, z, 0.04);
  p.box(PAL.trim, w + 0.02, 0.03, d + 0.02, x, baseH, z);
  // 後排墊高的階梯
  p.box(PAL.cream, w - 0.08, 0.16, 0.2, x, baseH + 0.08, z - 0.1);
  // 玻璃框的柱子＋頂板
  for (const dx of [-w / 2 + 0.02, w / 2 - 0.02]) {
    for (const dz of [-d / 2 + 0.02, d / 2 - 0.02]) p.box(PAL.trim, 0.03, glassH, 0.03, x + dx, baseH + glassH / 2, z + dz);
  }
  // 頂只做四條邊框：鏡頭從上往下看，實心頂板會把裡面的甜點整片蓋掉（2026-09-23 截圖）
  const topY = baseH + glassH + 0.015;
  p.box(PAL.pinkDark, w + 0.04, 0.03, 0.04, x, topY, z - d / 2);
  p.box(PAL.pinkDark, w + 0.04, 0.03, 0.04, x, topY, z + d / 2);
  p.box(PAL.pinkDark, 0.04, 0.03, d + 0.04, x - w / 2, topY, z);
  p.box(PAL.pinkDark, 0.04, 0.03, d + 0.04, x + w / 2, topY, z);
  // 正面的小花邊（圓點）
  for (let i = 0; i < 9; i++) p.sphere(PAL.trim, 0.022, x - w / 2 + 0.12 + i * ((w - 0.24) / 8), baseH * 0.55, z + d / 2 + 0.005);
}

/** 成品櫃：靠左牆的三層架 */
function rack(p: Parts) {
  const { x, z, w, d } = RACK;
  for (let tier = 0; tier < 3; tier++) p.rbox(PAL.wood, w, 0.04, d, x, 0.34 + tier * 0.34, z, 0.01);
  for (const dz of [-d / 2 + 0.02, d / 2 - 0.02]) p.box(PAL.woodDark, 0.04, 1.08, 0.04, x - w / 2 + 0.02, 0.54, z + dz);
  for (const dz of [-d / 2 + 0.02, d / 2 - 0.02]) p.box(PAL.woodDark, 0.04, 1.08, 0.04, x + w / 2 - 0.02, 0.54, z + dz);
}

/** 收銀台 */
function register(p: Parts) {
  const { x, z } = REGISTER;
  p.rbox(PAL.mint, 0.52, 0.72, 0.52, x, 0.36, z, 0.04);
  p.box(PAL.trim, 0.54, 0.03, 0.54, x, 0.72, z);
  p.rbox(PAL.cream, 0.26, 0.14, 0.2, x, 0.81, z - 0.04, 0.03);
  p.rbox(PAL.pink, 0.22, 0.08, 0.06, x, 0.9, z - 0.12, 0.02, { x: -0.5, y: 0, z: 0 });
  p.cyl(PAL.butter, 0.04, 0.04, 0.02, x + 0.14, 0.74, z + 0.14, 14); // 小碟子
}

/** 店門：右牆前段的開口＋粉紅門框＋往內開的門（門上小窗）＋門口地墊與盆栽 */
function entrance(p: Parts) {
  const x = ROOM.halfW;
  const zc = (DOOR_Z0 + DOOR_Z1) / 2;
  p.box(PAL.pinkDark, 0.12, 1.34, 0.07, x, 0.67, DOOR_Z0);
  p.box(PAL.pinkDark, 0.12, 1.34, 0.07, x, 0.67, DOOR_Z1);
  p.box(PAL.pinkDark, 0.12, 0.08, DOOR_Z1 - DOOR_Z0 + 0.07, x, 1.34, zc);
  // 門板：鉸鏈在後側門框，往**店外**開（往店裡開會擋在客人進出的路上，2026-09-23 截圖）
  const leafW = DOOR_Z1 - DOOR_Z0 - 0.06;
  const ang = 1.3;
  const hx = x + 0.04, hz = DOOR_Z0 + 0.03;
  const cx = hx + Math.sin(ang) * leafW / 2, cz = hz + Math.cos(ang) * leafW / 2;
  p.rbox(PAL.mint, 0.05, 1.24, leafW, cx, 0.63, cz, 0.02, { x: 0, y: ang, z: 0 });
  p.rbox(0xdff4ff, 0.06, 0.34, leafW * 0.6, cx, 0.95, cz, 0.02, { x: 0, y: ang, z: 0 });
  p.rbox(0xf4d9a4, 0.62, 0.02, DOOR_Z1 - DOOR_Z0 - 0.05, x - 0.36, 0.01, zc, 0.01); // 地墊
  // 門口盆栽
  p.cyl(PAL.butterDark, 0.1, 0.08, 0.18, x - 0.16, 0.09, DOOR_Z1 + 0.16, 14);
  p.sphere(PAL.leaf, 0.14, x - 0.16, 0.28, DOOR_Z1 + 0.16);
  p.sphere(PAL.pink, 0.04, x - 0.12, 0.4, DOOR_Z1 + 0.2);
  void DOOR;
}

/** 前排左邊的小咖啡座：圓桌＋兩張凳子（客人買完不坐，只是讓店有「店」的樣子） */
function cafe(p: Parts) {
  const { x, z } = CAFE;
  p.cyl(PAL.cream, 0.26, 0.26, 0.04, x, 0.56, z, 28);
  p.torus(PAL.pink, 0.26, 0.015, x, 0.56, z, { x: Math.PI / 2, y: 0, z: 0 });
  p.cyl(PAL.woodDark, 0.035, 0.035, 0.54, x, 0.27, z, 10);
  p.cyl(PAL.woodDark, 0.16, 0.18, 0.03, x, 0.015, z, 18);
  for (const dx of [-0.42, 0.42]) {
    p.cyl(PAL.mint, 0.13, 0.13, 0.06, x + dx, 0.36, z, 20);
    p.cyl(PAL.woodDark, 0.025, 0.025, 0.34, x + dx, 0.17, z, 8);
  }
  // 桌上一杯飲料＋小花瓶
  p.cyl(PAL.trim, 0.04, 0.035, 0.08, x - 0.08, 0.62, z + 0.05, 12);
  p.cyl(PAL.pinkDark, 0.03, 0.03, 0.1, x + 0.1, 0.63, z - 0.04, 10);
  p.sphere(PAL.butter, 0.035, x + 0.1, 0.72, z - 0.04);
}
