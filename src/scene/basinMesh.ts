import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALANCE } from '../game/balance';
import { LIQUIDS } from '../game/species';
import type { GameState } from '../game/state';
import { toonMaterial } from './toon';

export const BASIN = {
  radius: 0.21,
  height: 0.105,
  wall: 0.016,
} as const;

/**
 * 泡澡時布丁要沉多深（相對地板）。
 * 這個值只能很小：布丁縮到 0.2 寬之後高度大約 0.14，盆緣就有 0.105 高，
 * 沉 0.05 會整隻藏進盆裡看不見——泡澡是要「看得到牠閉著眼睛在泡」。
 */
export const BASIN_SINK = 0.012;

// 盆身刻意比層板地板（0xfff3df）深一階：淺色盆放在淺色地板上，
// 遠看只剩一圈邊，讀起來像地上畫了個圈而不是一個盆。
const TUB_COLOR = 0xe7cfa8;
const FOOT_COLOR = 0xb9793c;

/** 幫幾何加上 per-vertex 顏色，讓多個不同顏色的液面可以併成一個 mesh */
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function tubGeometries(x: number, y: number, z: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const wall = new THREE.CylinderGeometry(BASIN.radius, BASIN.radius * 0.86, BASIN.height, 16, 1, true);
  wall.translate(x, y + BASIN.height / 2, z);
  out.push(paint(wall, TUB_COLOR));

  const bottom = new THREE.CircleGeometry(BASIN.radius * 0.86, 16);
  bottom.rotateX(-Math.PI / 2);
  bottom.translate(x, y + 0.004, z);
  out.push(paint(bottom, TUB_COLOR));

  const rim = new THREE.TorusGeometry(BASIN.radius, BASIN.wall, 6, 18);
  rim.rotateX(Math.PI / 2);
  rim.translate(x, y + BASIN.height, z);
  out.push(paint(rim, FOOT_COLOR));

  // 三隻小腳，讀起來才像「精緻的澡盆」而不是一個桶
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const foot = new THREE.SphereGeometry(0.018, 6, 5);
    foot.translate(x + Math.cos(a) * BASIN.radius * 0.7, y + 0.008, z + Math.sin(a) * BASIN.radius * 0.7);
    out.push(paint(foot, FOOT_COLOR));
  }
  return out;
}

/**
 * 全部澡盆合併成兩個 mesh（盆身、液面）。
 * 液面顏色用 vertex color 帶，不然每種液體要一個材質＝一個 draw call，
 * 買了兩個特殊澡盆就多兩個，預算只有 30。
 */
export class BasinsView {
  readonly group = new THREE.Group();
  private tub: THREE.Mesh | null = null;
  private liquid: THREE.Mesh | null = null;
  private signature = '';
  private readonly tubMat = toonMaterial(0xffffff, { vertexColors: true });
  private readonly liquidMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });

  constructor(private readonly floorY: number) {
    this.group.name = 'Basins';
  }

  /** 澡盆的世界座標（UI 點擊與粒子要用） */
  worldPos(state: GameState, i: number): THREE.Vector3 {
    const b = state.basins[i];
    if (!b) return new THREE.Vector3();
    return new THREE.Vector3(b.pos.x, this.floorY + BASIN.height * 0.6, b.pos.z);
  }

  /** 只有在「盆數／液體／份數」真的變了才重建幾何 */
  sync(state: GameState) {
    const sig = state.basins.map((b) => `${b.pos.x.toFixed(2)},${b.liquid ?? '-'},${b.units}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;

    const tubs: THREE.BufferGeometry[] = [];
    const liquids: THREE.BufferGeometry[] = [];
    for (const b of state.basins) {
      tubs.push(...tubGeometries(b.pos.x, this.floorY, b.pos.z));
      if (b.liquid && b.units > 0) {
        const level = (b.units / BALANCE.basinCapacity) * (BASIN.height - 0.014) + 0.008;
        const disc = new THREE.CircleGeometry(BASIN.radius * 0.93, 16);
        disc.rotateX(-Math.PI / 2);
        disc.translate(b.pos.x, this.floorY + level, b.pos.z);
        liquids.push(paint(disc, LIQUIDS[b.liquid].color));
      }
    }

    this.rebuild('tub', tubs);
    this.rebuild('liquid', liquids);
  }

  private rebuild(kind: 'tub' | 'liquid', geos: THREE.BufferGeometry[]) {
    const old = kind === 'tub' ? this.tub : this.liquid;
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
    }
    if (geos.length === 0) {
      if (kind === 'tub') this.tub = null; else this.liquid = null;
      return;
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), kind === 'tub' ? this.tubMat : this.liquidMat);
    mesh.name = kind === 'tub' ? 'BasinTubs' : 'BasinLiquid';
    mesh.receiveShadow = kind === 'tub';
    mesh.castShadow = false; // 盆子的影子看不出來，省下陰影 pass 的 draw call
    if (kind === 'liquid') mesh.renderOrder = 2;
    this.group.add(mesh);
    if (kind === 'tub') this.tub = mesh; else this.liquid = mesh;
  }
}
