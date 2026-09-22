import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EquipmentId } from '../game/balance';
import { equipmentIn, type GameState } from '../game/state';
import { TANK } from './cabinet';
import { toonMaterial } from './toon';

const METAL = 0xcfd6dd;
const ACCENT = 0xe58a7b;

type Bucket = { metal: THREE.BufferGeometry[]; accent: THREE.BufferGeometry[] };

function box(sx: number, sy: number, sz: number, px: number, py: number, pz: number) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(px, py, pz);
  return g;
}

function cyl(r: number, h: number, px: number, py: number, pz: number, seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(px, py, pz);
  return g;
}

/**
 * 自動化設備的外觀。買了就出現，看得到「生產線越來越完整」——
 * 這是自動化軸的主要回饋，不是裝飾。
 *
 * 位置貼在**啟用層的內壁與頂板**上，不是計畫原本寫的「櫥窗外」：
 * 鏡頭被 D17 收到讓櫃子填滿畫面，放在櫃外的東西玩家根本看不到。
 */
function build(id: EquipmentId, b: Bucket, floorY: number, ceilY: number, basin: { x: number; z: number }) {
  const w = TANK.width, d = TANK.depth;
  switch (id) {
    case 'autoFill': {
      // 從頂板垂下來的管線，末端一個閥門對著澡盆
      b.metal.push(box(0.05, 0.05, d * 0.7, basin.x, ceilY - 0.03, 0));
      b.metal.push(cyl(0.022, ceilY - floorY - 0.34, basin.x, floorY + 0.28 + (ceilY - floorY - 0.34) / 2, basin.z));
      b.accent.push(box(0.09, 0.07, 0.09, basin.x, floorY + 0.27, basin.z));
      break;
    }
    case 'collector': {
      // 頂板的滑軌＋垂下來的夾爪
      b.metal.push(box(w * 0.7, 0.035, 0.05, 0, ceilY - 0.05, -d * 0.12));
      b.metal.push(cyl(0.014, 0.18, -w * 0.12, ceilY - 0.14, -d * 0.12));
      b.accent.push(box(0.075, 0.05, 0.075, -w * 0.12, ceilY - 0.24, -d * 0.12));
      b.accent.push(box(0.022, 0.06, 0.022, -w * 0.12 - 0.03, ceilY - 0.29, -d * 0.12));
      b.accent.push(box(0.022, 0.06, 0.022, -w * 0.12 + 0.03, ceilY - 0.29, -d * 0.12));
      break;
    }
    case 'crafter': {
      // 後方左角的加工機：箱體＋漏斗＋煙囪
      const x = -w / 2 + 0.24, z = -d / 2 + 0.2;
      b.metal.push(box(0.3, 0.24, 0.22, x, floorY + 0.12, z));
      b.accent.push(box(0.2, 0.04, 0.16, x, floorY + 0.26, z));
      b.metal.push(cyl(0.028, 0.14, x + 0.1, floorY + 0.33, z));
      break;
    }
    case 'seller': {
      // 正面偏左的外帶窗：開口＋雨遮。
      // 不能放右下角——那裡是該層名牌的位置（cabinet.createPlates），會整個被蓋住。
      const x = -0.3, z = d / 2 - 0.02;
      b.accent.push(box(0.3, 0.2, 0.03, x, floorY + 0.14, z));
      b.metal.push(box(0.34, 0.03, 0.1, x, floorY + 0.25, z + 0.03));
      b.metal.push(box(0.22, 0.12, 0.02, x, floorY + 0.12, z + 0.012));
      break;
    }
    case 'restock': {
      // 左側牆邊的補貨信箱
      const x = -w / 2 + 0.16, z = d / 2 - 0.18;
      b.metal.push(cyl(0.02, 0.22, x, floorY + 0.11, z));
      b.accent.push(box(0.16, 0.12, 0.12, x, floorY + 0.28, z));
      b.metal.push(box(0.04, 0.03, 0.03, x + 0.09, floorY + 0.3, z));
      break;
    }
  }
}

/** 已買設備合併成兩個 mesh（金屬、配色），買新設備時整個重建 */
export class EquipmentView {
  readonly group = new THREE.Group();
  private signature = '';
  private readonly mats = { metal: toonMaterial(METAL), accent: toonMaterial(ACCENT) };

  constructor() {
    this.group.name = 'Equipment';
  }

  /**
   * 只畫玩家正在看的那一區、而且只畫這一區自己買的設備（D45：設備每一區各買各的）——
   * 每一區都畫一套的話，解鎖第二區就直接超出 draw call 預算。
   */
  sync(state: GameState, zone: string, ox: number, floorY: number, ceilY: number) {
    const owned = Object.entries(equipmentIn(state, zone))
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
      .join(',');
    const sig = `${zone}|${owned}`;
    if (sig === this.signature) return;
    this.signature = sig;

    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    if (owned === '') return;

    const basin = state.basins.find((x) => x.zone === zone)?.pos ?? { x: 0, z: 0 };
    const b: Bucket = { metal: [], accent: [] };
    for (const id of owned.split(',') as EquipmentId[]) build(id, b, floorY, ceilY, basin);
    for (const arr of Object.values(b)) for (const g of arr) g.translate(ox, 0, 0);

    for (const key of ['metal', 'accent'] as const) {
      if (b[key].length === 0) continue;
      const mesh = new THREE.Mesh(mergeGeometries(b[key]), this.mats[key]);
      mesh.name = `Equipment_${key}`;
      mesh.castShadow = false; // 設備貼在內壁上，影子只會讓層板變髒
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
}
