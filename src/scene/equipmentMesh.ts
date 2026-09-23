import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EquipmentId } from '../game/balance';
import { equipmentPos } from '../game/furniture';
import { equipmentIn, type GameState, type Vec2 } from '../game/state';
import { TANK } from './cabinet';
import { toonMaterial } from './toon';

const METAL = 0xcfd6dd;
const ACCENT = 0xe58a7b;
const DARK = 0x4d4653;
const CREAM = 0xfff6ea;
const GLASS = 0xdbeefb;
const PUDDING = 0xf7c948;
const CARAMEL = 0xc2703a;

/**
 * 所有設備併成**一個** mesh：顏色寫在頂點色裡，材質只有一個，所以整組設備永遠只佔一個 draw call。
 * 之前是「金屬／配色」兩個 bucket 各一個 mesh；販賣機一多顏色就撐不住那個做法。
 */
type Parts = THREE.BufferGeometry[];

function paint(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function box(parts: Parts, hex: number, sx: number, sy: number, sz: number, px: number, py: number, pz: number) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(px, py, pz);
  parts.push(paint(g, hex));
  return g;
}

function cyl(parts: Parts, hex: number, r: number, h: number, px: number, py: number, pz: number, seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(px, py, pz);
  parts.push(paint(g, hex));
  return g;
}

/** 站在展示架上的迷你布丁：本體＋頂料，`shelfY` 是架面高度 */
function miniPudding(parts: Parts, x: number, shelfY: number, z: number, body: number, top: number) {
  const r = 0.02, h = 0.032;
  cyl(parts, body, r, h, x, shelfY + h / 2, z);
  cyl(parts, top, r + 0.002, 0.009, x, shelfY + h + 0.0045, z);
}

/**
 * 自動販售口＝一台貼在前玻璃的迷你自動販賣機（2026-09-22 使用者要求「美化、添加更多細節」；
 * 原本只是三塊方塊拼的外帶窗）。
 *
 * 幾何上的兩條硬限制：
 * ① 前玻璃在 `z = d/2 = 0.70`，機身正面停在 0.66，雨遮、展示架、取物口這些會凸出來的
 *    最多到 0.695，再往前就穿玻璃。
 * ② 布丁的地板是 `z ≤ 0.4`（`floorRect`），機身背面 0.54 不能再往後退，否則布丁會跳進機器裡。
 * 金幣從機器**頂上**冒出來（`sellerSpout()`）：機身現在有半公尺高，還從原本窗口那個高度生
 * 會直接卡在機身裡。
 */
function vendingMachine(parts: Parts, floorY: number, at: Vec2) {
  // 預設位置（`furniture.EQUIPMENT_DEFAULT_POS.seller`）正面偏左一點點：右邊 x≥0.045 是該層名牌
  // （cabinet.createPlates）會蓋到的區域，左邊 x≤−0.22 是澡盆。D49 起玩家可以拖到別處，
  // `at` 是機身中心；佔地（含往前凸的雨遮）在 `furniture.ts`，那裡保證不穿玻璃。
  const x = at.x;
  const W = 0.32, H = 0.48, D = 0.12;
  const zc = at.z;
  const front = zc + D / 2;       // 機身正面
  const y0 = floorY;

  // 底座＋機身＋頂蓋
  box(parts, DARK, W + 0.02, 0.035, D + 0.02, x, y0 + 0.0175, zc);
  box(parts, ACCENT, W, H, D, x, y0 + 0.035 + H / 2, zc);
  box(parts, METAL, W + 0.02, 0.03, D + 0.02, x, y0 + 0.035 + H + 0.015, zc);
  const capTop = y0 + 0.035 + H + 0.03;

  // 頂上的招牌（珊瑚色框＋奶油面板）＋坐在旁邊的布丁吉祥物
  box(parts, ACCENT, 0.24, 0.1, 0.03, x - 0.03, capTop + 0.05, zc + 0.01);
  box(parts, CREAM, 0.2, 0.06, 0.012, x - 0.03, capTop + 0.05, zc + 0.03);
  cyl(parts, PUDDING, 0.038, 0.055, x + 0.115, capTop + 0.0275, zc + 0.005, 10);
  cyl(parts, CARAMEL, 0.04, 0.014, x + 0.115, capTop + 0.055 + 0.007, zc + 0.005, 10);

  // 展示窗：白框＋淡藍玻璃＋一道反光；窗子偏左，右邊留給操作面板
  const wx = x - 0.035, wy = y0 + 0.33;
  box(parts, CREAM, 0.23, 0.27, 0.008, wx, wy, front + 0.002);
  box(parts, GLASS, 0.21, 0.25, 0.008, wx, wy, front + 0.006);
  const glint = new THREE.BoxGeometry(0.012, 0.15, 0.004);
  glint.rotateZ(0.35);
  glint.translate(wx - 0.085, wy + 0.04, front + 0.012);
  parts.push(paint(glint, 0xffffff));

  // 窗裡兩層架子，每層三顆迷你布丁（下層焦糖、上層草莓／抹茶／鮮奶酪）
  const shelfZ = front + 0.02;
  for (const [i, sy] of [y0 + 0.23, y0 + 0.345].entries()) {
    box(parts, METAL, 0.2, 0.008, 0.03, wx, sy, shelfZ);
    const flavours: [number, number][] = i === 0
      ? [[PUDDING, CARAMEL], [PUDDING, CARAMEL], [PUDDING, CARAMEL]]
      : [[0xf4a7b0, 0xe0526b], [0xb9d68f, 0x6f9a55], [0xfff6ea, 0xf7c948]];
    flavours.forEach(([body, top], j) => miniPudding(parts, wx - 0.062 + j * 0.062, sy + 0.004, shelfZ + 0.002, body, top));
  }

  // 條紋雨遮：五片交錯的珊瑚／奶油色，往前下方斜出去（跟商店圖 eqSeller.svg 的雨遮同款）
  for (let i = 0; i < 5; i++) {
    const slat = new THREE.BoxGeometry(0.05, 0.012, 0.05);
    slat.rotateX(0.5);
    slat.translate(wx - 0.1 + i * 0.05, wy + 0.155, front + 0.014);
    parts.push(paint(slat, i % 2 === 0 ? ACCENT : CREAM));
  }

  // 右側操作面板：投幣口、小螢幕、三顆彩色按鈕
  const px = x + 0.125;
  box(parts, METAL, 0.06, 0.26, 0.006, px, y0 + 0.36, front + 0.002);
  box(parts, DARK, 0.03, 0.007, 0.006, px, y0 + 0.46, front + 0.006);
  box(parts, DARK, 0.04, 0.03, 0.006, px, y0 + 0.415, front + 0.006);
  for (const [k, hex] of [0xffd764, 0x8fd0c9, 0xf4a7b0].entries()) {
    const btn = new THREE.CylinderGeometry(0.011, 0.011, 0.01, 8);
    btn.rotateX(Math.PI / 2);
    btn.translate(px, y0 + 0.36 - k * 0.04, front + 0.006);
    parts.push(paint(btn, hex));
  }

  // 取物口：深色開口＋金屬托盤
  box(parts, DARK, 0.16, 0.06, 0.012, wx, y0 + 0.12, front + 0.002);
  box(parts, METAL, 0.18, 0.012, 0.03, wx, y0 + 0.085, front + 0.012);
}

/**
 * 金幣與「賣出」粒子的生成點（區域座標；`main.ts` 加上該區的世界偏移）。
 * 在招牌上方正中，往 −z 拋會越過機身落到地板上——跟 `coinsView.burst` 的拋向一致。
 */
export function sellerSpout(at: Vec2) {
  return { x: at.x - 0.03, y: 0.66, z: at.z + 0.01 };
}

/**
 * 自動化設備的外觀。買了就出現，看得到「生產線越來越完整」——
 * 這是自動化軸的主要回饋，不是裝飾。
 *
 * 位置貼在**啟用層的內壁與頂板**上，不是計畫原本寫的「櫥窗外」：
 * 鏡頭被 D17 收到讓櫃子填滿畫面，放在櫃外的東西玩家根本看不到。
 */
function build(id: EquipmentId, parts: Parts, floorY: number, ceilY: number, at: Vec2) {
  const d = TANK.depth;
  switch (id) {
    case 'autoFill': {
      const basin = at; // 注液閥掛在該區第一個澡盆上方（`furniture.equipmentPos`）
      // 從頂板垂下來的管線，末端一個閥門對著澡盆
      box(parts, METAL, 0.05, 0.05, d * 0.7, basin.x, ceilY - 0.03, 0);
      cyl(parts, METAL, 0.022, ceilY - floorY - 0.34, basin.x, floorY + 0.28 + (ceilY - floorY - 0.34) / 2, basin.z);
      box(parts, ACCENT, 0.09, 0.07, 0.09, basin.x, floorY + 0.27, basin.z);
      break;
    }
    case 'collector': {
      // 頂板的滑軌＋垂下來的夾爪；`at` 是夾爪的位置，滑軌橫跨整層、跟著夾爪的 z
      box(parts, METAL, TANK.width * 0.7, 0.035, 0.05, 0, ceilY - 0.05, at.z);
      cyl(parts, METAL, 0.014, 0.18, at.x, ceilY - 0.14, at.z);
      box(parts, ACCENT, 0.075, 0.05, 0.075, at.x, ceilY - 0.24, at.z);
      box(parts, ACCENT, 0.022, 0.06, 0.022, at.x - 0.03, ceilY - 0.29, at.z);
      box(parts, ACCENT, 0.022, 0.06, 0.022, at.x + 0.03, ceilY - 0.29, at.z);
      break;
    }
    case 'crafter': {
      // 加工機：箱體＋漏斗＋煙囪（預設在後方左角）
      const { x, z } = at;
      box(parts, METAL, 0.3, 0.24, 0.22, x, floorY + 0.12, z);
      box(parts, ACCENT, 0.2, 0.04, 0.16, x, floorY + 0.26, z);
      cyl(parts, METAL, 0.028, 0.14, x + 0.1, floorY + 0.33, z);
      break;
    }
    case 'seller':
      vendingMachine(parts, floorY, at);
      break;
    case 'restock': {
      // 補貨信箱（預設在左側牆邊）
      const { x, z } = at;
      cyl(parts, METAL, 0.02, 0.22, x, floorY + 0.11, z);
      box(parts, ACCENT, 0.16, 0.12, 0.12, x, floorY + 0.28, z);
      box(parts, METAL, 0.04, 0.03, 0.03, x + 0.09, floorY + 0.3, z);
      break;
    }
  }
}

/** 已買設備合併成一個 mesh（顏色在頂點色），買新設備時整個重建 */
export class EquipmentView {
  readonly group = new THREE.Group();
  private signature = '';
  private readonly material = toonMaterial(0xffffff, { vertexColors: true });

  constructor() {
    this.group.name = 'Equipment';
  }

  /**
   * 只畫玩家正在看的那一區、而且只畫這一區自己買的設備（D45：設備每一區各買各的）——
   * 每一區都畫一套的話，解鎖第二區就直接超出 draw call 預算。
   */
  sync(state: GameState, zone: string, ox: number, floorY: number, ceilY: number, dragging: EquipmentId | null = null) {
    const owned = (Object.entries(equipmentIn(state, zone)) as [EquipmentId, boolean][])
      .filter(([k, v]) => v && k !== dragging)
      .map(([k]) => k)
      .sort();
    // 位置也進簽章：家具搬過（D49）要重建
    const sig = `${zone}|${ox.toFixed(2)}|` + owned.map((id) => {
      const p = equipmentPos(state, zone, id);
      return `${id}@${p.x.toFixed(3)},${p.z.toFixed(3)}`;
    }).join(',');
    if (sig === this.signature) return;
    this.signature = sig;

    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    if (owned.length === 0) return;

    const parts: Parts = [];
    for (const id of owned) build(id, parts, floorY, ceilY, equipmentPos(state, zone, id));
    for (const g of parts) g.translate(ox, 0, 0);

    const mesh = new THREE.Mesh(mergeGeometries(parts), this.material);
    mesh.name = 'Equipment';
    mesh.castShadow = false; // 設備貼在內壁上，影子只會讓層板變髒
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /**
   * 拖曳中的那一台單獨做成一個 mesh（建在原點，拖的時候只改 `position`，不必每幀重新合併）。
   * 拖曳期間多一個 draw call，放手就併回去。
   */
  buildDragMesh(id: EquipmentId, floorY: number, ceilY: number): THREE.Mesh {
    const parts: Parts = [];
    build(id, parts, floorY, ceilY, { x: 0, z: 0 });
    const mesh = new THREE.Mesh(mergeGeometries(parts), this.material);
    mesh.name = 'EquipmentDrag';
    return mesh;
  }
}
