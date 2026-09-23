import * as THREE from 'three';
import { Parts } from './build';
import { BELT, BELT_PATH, CAFE, DOOR, DOOR_Z0, DOOR_Z1, RACK, REGISTER, ROOM, SHOWCASE, WALL_LAMPS } from './layout';

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
 * 整間店所有**不會動、也不會因為購買而變**的東西：房間、家具、輸送帶骨架。全部併成一個 mesh（一個 draw call）。
 * 七台機器要買（D57），機身另外一個 mesh（`machines.ts`，買了才重建）；
 * 會動的部件（帶面、打蛋臂上的蛋、攪拌器、注模嘴、擠花袋、烤箱與冷藏櫃的光）在 `bakeryView.ts` 各自一個 mesh。
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

  // 壁燈的托架（燈罩在 view 裡另一個 mesh：天黑才亮）
  for (const l of WALL_LAMPS) {
    p.rbox(PAL.butterDark, 0.03, 0.14, 0.1, l.x + l.nx * 0.015, l.y + 0.02, l.z, 0.012);
    p.box(PAL.butterDark, 0.12, 0.02, 0.02, l.x + l.nx * 0.07, l.y + 0.07, l.z);
  }

  beltFrame(p);
  showcase(p);
  rack(p);
  register(p);
  entrance(p);
  cafe(p);

  return p.merge();
}

/**
 * 輸送帶骨架（D57）：每一段一條深色帶床＋兩側金屬護欄＋落地腳，轉角放圓盤，出口一段小斜坡。
 * 會捲動的帶面在 view 裡另一個 mesh（捲動的條紋讀起來才像「在動的流水線」）。
 */
function beltFrame(p: Parts) {
  const { y, w } = BELT;
  for (let i = 0; i < BELT_PATH.length - 1; i++) {
    const a = BELT_PATH[i]!;
    const b = BELT_PATH[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ang = -Math.atan2(b.z - a.z, b.x - a.x);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const rot = { x: 0, y: ang, z: 0 };
    // 帶床
    p.box(PAL.dark, len + w, 0.07, w, cx, y - 0.045, cz, rot);
    // 兩側護欄（沿行進方向的左右各一條）
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    for (const side of [-1, 1]) {
      p.box(PAL.metal, len + w, 0.05, 0.03, cx + nx * side * (w / 2 + 0.01), y + 0.005, cz + nz * side * (w / 2 + 0.01), rot);
    }
    // 落地腳：每 0.5 一對
    const n = Math.max(1, Math.round(len / 0.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const lx = a.x + (b.x - a.x) * t;
      const lz = a.z + (b.z - a.z) * t;
      for (const side of [-1, 1]) {
        p.cyl(PAL.metal, 0.018, 0.022, y - 0.08, lx + nx * side * (w / 2 - 0.03), (y - 0.08) / 2, lz + nz * side * (w / 2 - 0.03), 8);
      }
    }
  }
  // 轉角的圓盤（兩段帶子在這裡接起來）
  for (const c of BELT_PATH.slice(1, -1)) {
    p.cyl(PAL.dark, w / 2 + 0.02, w / 2 + 0.02, 0.07, c.x, y - 0.045, c.z, 24);
    p.torus(PAL.metal, w / 2 + 0.02, 0.018, c.x, y + 0.005, c.z, { x: Math.PI / 2, y: 0, z: 0 });
  }
  // 起點的端蓋、出口往成品櫃的小滑道
  const s0 = BELT_PATH[0]!;
  p.rbox(PAL.metal, 0.06, 0.1, w + 0.06, s0.x - w / 2, y - 0.02, s0.z, 0.02);
  const end = BELT_PATH[BELT_PATH.length - 1]!;
  p.box(PAL.metal, w, 0.03, 0.26, end.x, y - 0.1, end.z + 0.2 + w / 2, { x: 0.45, y: 0, z: 0 });
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
