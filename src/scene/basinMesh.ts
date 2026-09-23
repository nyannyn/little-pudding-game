import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALANCE } from '../game/balance';
import { LIQUIDS, type LiquidId } from '../game/species';
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

/** 液面高度（相對層板地板）；0 份＝盆底，滿＝離盆緣一點點 */
export function liquidLevel(units: number): number {
  return (units / BALANCE.basinCapacity) * (BASIN.height - 0.014) + 0.008;
}

/** 倒液體時液面怎麼升：先等水流落到盆裡（hold），再花 rise 秒從 from 升到 to */
interface Rise { hold: number; rise: number; from: number; to: number }
/** 液面往下掉（布丁進盆扣一份）用的時間常數：約 0.2 秒淡到位，不要瞬間消失 */
const DRAIN_TAU = 0.06;

/**
 * 全部澡盆合併成兩個 mesh（盆身、液面）。
 * 液面顏色用 vertex color 帶，不然每種液體要一個材質＝一個 draw call，
 * 買了兩個特殊澡盆就多兩個，預算只有 35。
 *
 * 液面高度**不進**重建 signature：倒液體時液面要慢慢升，每幀重建＝每幀 mergeGeometries＋dispose
 * （手機上是 GC 抖動）。改成記下每盆液面在合併後 position 裡的頂點區間，動畫只改那段的 Y。
 */
export class BasinsView {
  readonly group = new THREE.Group();
  private tub: THREE.Mesh | null = null;
  private liquid: THREE.Mesh | null = null;
  private signature = '';
  private readonly tubMat = toonMaterial(0xffffff, { vertexColors: true });
  private readonly liquidMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
  /** 畫面上顯示的份數（往 state 的份數靠），key＝basin index */
  private readonly shown = new Map<number, number>();
  private readonly rising = new Map<number, Rise>();
  /** 每盆液面 disc 在合併 geometry 裡的頂點區間 */
  private ranges = new Map<number, { start: number; count: number }>();
  /** 最後一次畫過的液體：布丁進盆把 `liquid` 清成 null 時，淡出中的液面還要知道自己是什麼顏色 */
  private readonly lastLiquid = new Map<number, LiquidId>();
  private oy = 0;

  constructor() {
    this.group.name = 'Basins';
  }

  /**
   * 倒液體開始：顯示的份數先停在倒之前的值，`hold` 秒後花 `rise` 秒升到 state 的值。
   * 第一次倒進空盆時 `shown` 還沒有這盆的紀錄，要從「倒之前」起算，否則第一份會直接跳滿。
   */
  beginPour(basinIndex: number, units: number, poured: number, hold: number, rise: number) {
    const from = Math.max(0, this.shown.get(basinIndex) ?? units - poured);
    this.shown.set(basinIndex, from);
    this.rising.set(basinIndex, { hold, rise, from, to: units });
  }

  /** 顯示中的液面世界高度（水流的落點要接在這裡，不是 state 的高度） */
  shownSurfaceY(basinIndex: number, fallbackUnits: number): number {
    return this.oy + liquidLevel(this.shown.get(basinIndex) ?? fallbackUnits);
  }

  /**
   * 只畫「玩家正在看的那一區」的澡盆。其他區照樣在模擬，只是不畫——
   * 鏡頭一次只框一層，多畫的東西看不到卻照吃 draw call（預算只有 35）。
   */
  sync(state: GameState, zone: string, ox: number, oy: number, dt = 0, preview: { index: number; pos: { x: number; z: number } } | null = null) {
    this.oy = oy;
    const mine: Array<{ index: number; b: GameState['basins'][number] }> = [];
    state.basins.forEach((b, index) => {
      // 從倉庫拿出來、還在擺放模式的那一個盆（state 裡仍在倉庫）也要畫
      if (b.zone !== zone && !(preview && preview.index === index)) return;
      // 拖曳中（D49）：畫在手指底下的預覽位置，放手才由 `furniture.moveFurniture` 寫進 state
      mine.push({ index, b: preview && preview.index === index ? { ...b, pos: preview.pos } : b });
    });
    this.step(mine, dt);

    // 第三項是「畫不畫液面」：state 有液體，或畫面上還有淡出中的液面
    const sig = `${zone}|${ox.toFixed(2)}|` + mine.map(({ index, b }) => `${b.pos.x.toFixed(2)},${b.pos.z.toFixed(2)},${b.liquid ?? '-'},${b.units > 0 || (this.shown.get(index) ?? 0) > 0.02 ? 1 : 0}`).join('|');
    if (sig !== this.signature) {
      this.signature = sig;
      const tubs: THREE.BufferGeometry[] = [];
      const liquids: THREE.BufferGeometry[] = [];
      const ranges = new Map<number, { start: number; count: number }>();
      let start = 0;
      for (const { index, b } of mine) {
        tubs.push(...tubGeometries(ox + b.pos.x, oy, b.pos.z));
        const liquid = b.liquid ?? this.lastLiquid.get(index);
        if (liquid && (b.units > 0 || (this.shown.get(index) ?? 0) > 0.02)) {
          this.lastLiquid.set(index, liquid);
          const disc = new THREE.CircleGeometry(BASIN.radius * 0.93, 16);
          disc.rotateX(-Math.PI / 2);
          disc.translate(ox + b.pos.x, oy, b.pos.z);
          const count = disc.getAttribute('position').count;
          ranges.set(index, { start, count });
          start += count;
          liquids.push(paint(disc, LIQUIDS[liquid].color));
        }
      }
      this.ranges = ranges;
      this.rebuild('tub', tubs);
      this.rebuild('liquid', liquids);
    }
    this.writeLevels();
  }

  /**
   * 顯示的份數往 state 靠。倒液體照 `rising` 的時間表升到 `to`——中途布丁跳進盆把 units 扣掉
   * 也不打斷（水還在倒，液面卻先消失，玩家只會讀成 bug）；升完再往下淡到 state 的值。
   * 沒有時間表時：往上（作弊改值、載入）直接跳，往下（布丁進盆）約 0.2 秒淡到位。
   */
  private step(mine: Array<{ index: number; b: GameState['basins'][number] }>, dt: number) {
    for (const { index, b } of mine) {
      const target = b.units;
      const cur = this.shown.get(index);
      if (cur === undefined) {
        this.shown.set(index, target);
        continue;
      }
      const r = this.rising.get(index);
      if (r) {
        if (r.hold > 0) {
          r.hold -= dt;
          continue;
        }
        const rate = (r.to - r.from) / Math.max(0.05, r.rise);
        const next = Math.min(r.to, cur + rate * dt);
        this.shown.set(index, next);
        if (next >= r.to) this.rising.delete(index);
        continue;
      }
      if (cur > target) {
        const next = target + (cur - target) * Math.exp(-dt / DRAIN_TAU);
        this.shown.set(index, next - target < 0.02 ? target : next);
      } else if (cur < target) {
        this.shown.set(index, target);
      }
    }
  }

  private writeLevels() {
    if (!this.liquid) return;
    const attr = this.liquid.geometry.getAttribute('position') as THREE.BufferAttribute;
    let dirty = false;
    for (const [index, { start, count }] of this.ranges) {
      const units = this.shown.get(index) ?? 0;
      // 倒進空盆、水流還沒落到的那零點幾秒：液面藏到盆底板下面，不然會先冒出一層薄膜
      const y = units < 0.02 ? this.oy + 0.002 : this.oy + liquidLevel(units);
      if (Math.abs(attr.getY(start) - y) < 1e-5) continue;
      for (let i = start; i < start + count; i++) attr.setY(i, y);
      dirty = true;
    }
    if (dirty) {
      attr.needsUpdate = true;
      this.liquid.geometry.computeBoundingSphere();
    }
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
