import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EquipmentId } from '../game/balance';
import { equipmentPos } from '../game/furniture';
import { equipmentIn, type GameState, type Vec2 } from '../game/state';
import { TANK } from './cabinet';
import { toonMaterial } from './toon';

const METAL = 0xcfd6dd;
const ACCENT = 0xe58a7b;

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
