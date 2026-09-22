import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LIQUIDS, type LiquidId } from '../game/species';
import type { GameState } from '../game/state';
import { BASIN, type BasinsView } from './basinMesh';
import type { Particles } from './particles';
import { toonMaterial } from './toon';

/** 液體稠度 0（稀，牛奶）～1（稠，熱焦糖）：決定水流粗細與聲音 */
export const THICKNESS: Record<LiquidId, number> = { caramel: 1, milk: 0, matcha: 0.35, strawberry: 0.75 };

/** 時間表（秒）：壺進場→水流→壺退場；水流長度隨倒的份數，手動一份 0.5 秒，自動倒滿也不超過 1.1 秒 */
export const ENTER = 0.22;
const LEAVE = 0.28;
/** 水流從壺口落到盆裡要多久，液面從這之後才開始升 */
const FALL = 0.08;
export function flowSeconds(units: number): number {
  return Math.min(1.1, Math.max(0.5, 0.5 * units));
}

const TILT = 1.25; // 壺傾倒到底的角度（約 72°）
/** 壺的整體縮放：以盆半徑 0.21 為基準，1 倍在手機畫面上只有十幾 px，看不出是壺 */
const JUG_SCALE = 1.35;
const JUG_OFFSET_X = 0.11;
const JUG_ABOVE_RIM = 0.16;
const SPOUT_LOCAL = new THREE.Vector3(-0.05, 0.034, 0);
/** 自動注液閥的出口（相對層板地板）；要跟 `equipmentMesh` 的 autoFill 閥門盒底對齊 */
const VALVE_Y = 0.235;

const LIP_COLOR = 0xb9793c;

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

/** 小壺：壺身染成液體的淡色（讀得出「這壺是牛奶還是焦糖」），壺口與把手用盆腳那個褐色 */
function jugGeometry(liquid: LiquidId): THREE.BufferGeometry {
  // 淡到 0.55 會跟奶油色的背景牆融在一起（實測截圖裡壺幾乎看不見），0.3 才讀得出來
  const body = new THREE.Color(LIQUIDS[liquid].color).lerp(new THREE.Color(0xfff8ee), 0.3).getHex();
  const parts: THREE.BufferGeometry[] = [];
  const belly = new THREE.CylinderGeometry(0.042, 0.034, 0.08, 12);
  parts.push(paint(belly, body));
  const lip = new THREE.TorusGeometry(0.042, 0.006, 5, 12);
  lip.rotateX(Math.PI / 2);
  lip.translate(0, 0.04, 0);
  parts.push(paint(lip, LIP_COLOR));
  const spout = new THREE.BoxGeometry(0.03, 0.012, 0.02);
  spout.rotateZ(0.5);
  spout.translate(-0.048, 0.038, 0);
  parts.push(paint(spout, body));
  const handle = new THREE.TorusGeometry(0.026, 0.006, 5, 10, Math.PI);
  handle.rotateZ(-Math.PI / 2);
  handle.translate(0.044, 0.004, 0);
  parts.push(paint(handle, LIP_COLOR));
  return mergeGeometries(parts);
}

interface Pour {
  basinIndex: number;
  liquid: LiquidId;
  units: number;
  /** 手動＝小壺從旁邊倒進來；自動＝注液閥從上面放 */
  source: 'jug' | 'valve';
  t: number;
  flow: number;
  splashT: number;
  pivot: THREE.Group;
  jug: THREE.Mesh;
  stream: THREE.Mesh;
}

/**
 * 倒液體的演出：壺、水流、落點濺起的小水花，液面跟著水流慢慢升（那部分在 `BasinsView`）。
 * 沒在倒的時候整組 `visible=false`，不算 draw call；**全場同時最多畫一組**壺＋水流（+2）。
 * 三個盆各畫一組實測會到 37 draw calls（預算 35）——注液閥逐盆補、特殊液體各進自己的盆，
 * 疊起來很容易；而兩把壺同時倒也只是噪音不是資訊。畫不到的那些只讓液面升。
 * 純演出：只讀 state，份數早在 `pourIntoBasin` 裡一次加完了。
 */
export class PourView {
  readonly group = new THREE.Group();
  private readonly active: Pour[] = [];
  private readonly jugMat = toonMaterial(0xffffff, { vertexColors: true });
  private readonly jugGeos = new Map<LiquidId, THREE.BufferGeometry>();
  private readonly streamGeo: THREE.BufferGeometry;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly basins: BasinsView, private readonly particles: Particles) {
    this.group.name = 'Pours';
    // 上粗下細、頂點在 y=0、往下延伸 1 單位；長度用 scale.y 控
    this.streamGeo = new THREE.CylinderGeometry(0.011, 0.0075, 1, 8, 1, true);
    this.streamGeo.translate(0, -0.5, 0);
  }

  get pouring(): number {
    return this.active.length;
  }

  /**
   * 開始一次倒液體。回傳有沒有畫出（或延長）水流——聲音跟著畫面走，沒畫的也不出聲。
   * 同一盆還在倒就把時間表延長，不疊第二把壺；別的盆在倒時，手動可以搶掉注液閥的水流
   * （玩家的動作優先），其餘只讓液面升。
   */
  begin(state: GameState, basinIndex: number, liquid: LiquidId, units: number, auto: boolean, ox: number, oy: number): boolean {
    const b = state.basins[basinIndex];
    if (!b) return false;
    const flow = flowSeconds(units);
    const existing = this.active.find((p) => p.basinIndex === basinIndex);
    if (existing) {
      existing.units += units;
      existing.flow = Math.min(1.1, existing.flow + flow * 0.6);
      existing.t = Math.min(existing.t, ENTER); // 若正在退場就拉回水流段
      this.basins.beginPour(basinIndex, b.units, units, FALL, existing.flow * 0.6);
      return true;
    }
    const busy = this.active[0];
    if (busy) {
      if (auto || busy.source !== 'valve') {
        this.basins.beginPour(basinIndex, b.units, units, FALL, flow);
        return false;
      }
      this.end(busy, 0);
    }

    const pivot = new THREE.Group();
    const jug = new THREE.Mesh(this.jugGeo(liquid), this.jugMat);
    jug.name = 'PourJug';
    jug.castShadow = false;
    jug.receiveShadow = false;
    pivot.add(jug);
    const stream = new THREE.Mesh(
      this.streamGeo,
      new THREE.MeshBasicMaterial({ color: LIQUIDS[liquid].color, transparent: true, opacity: 0.95 }),
    );
    stream.name = 'PourStream';
    stream.renderOrder = 2; // 跟液面同一層，落點才不會跟液面 z-fighting
    stream.castShadow = false;
    stream.visible = false;

    // 壺從「靠層中央那一側」進來，才不會插進玻璃牆；正中央的盆從右邊
    const side = b.pos.x > 0.01 ? -1 : 1;
    pivot.position.set(ox + b.pos.x + side * JUG_OFFSET_X, oy + BASIN.height + JUG_ABOVE_RIM, b.pos.z + 0.03);
    pivot.rotation.y = side < 0 ? Math.PI : 0; // 壺嘴（local −x）永遠朝向盆
    const source: Pour['source'] = auto ? 'valve' : 'jug';
    jug.visible = source === 'jug';
    this.group.add(pivot, stream);
    this.active.push({ basinIndex, liquid, units, source, t: 0, flow, splashT: 0, pivot, jug, stream });

    const hold = source === 'jug' ? ENTER + FALL : FALL;
    this.basins.beginPour(basinIndex, b.units, units, hold, flow);
    return true;
  }

  update(state: GameState, dt: number, ox: number, oy: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      const b = state.basins[p.basinIndex];
      p.t += dt;
      const total = (p.source === 'jug' ? ENTER : 0) + p.flow + LEAVE;
      // 倒到一半切區：ox/oy 已經是新那層的，壺會懸在新層、水流錯位——直接收掉
      if (!b || b.zone !== state.activeZone || p.t >= total) {
        this.end(p, i);
        continue;
      }
      const surfaceY = this.basins.shownSurfaceY(p.basinIndex, b.units);
      const enter = p.source === 'jug' ? ENTER : 0;
      const flowEnd = enter + p.flow;

      // 壺：進場時從上方落下＋傾倒；退場時扶正、升起、縮小
      let tilt = TILT;
      let lift = 0;
      let scale = 1;
      if (p.t < enter) {
        const k = easeOut(p.t / enter);
        tilt = TILT * k;
        lift = (1 - k) * 0.12;
      } else if (p.t > flowEnd) {
        const k = Math.min(1, (p.t - flowEnd) / LEAVE);
        tilt = TILT * (1 - easeOut(k));
        lift = k * 0.1;
        scale = 1 - k * 0.6;
      }
      p.pivot.position.y = oy + BASIN.height + JUG_ABOVE_RIM + lift;
      p.jug.rotation.z = tilt;
      p.jug.scale.setScalar(scale * JUG_SCALE);
      p.pivot.updateMatrixWorld(true);

      // 水流：頂在壺口（或閥門口），底在顯示中的液面；退場時頂端跟著往下掉、收進盆裡
      let topX: number, topZ: number, topY: number;
      if (p.source === 'jug') {
        this.tmp.copy(SPOUT_LOCAL);
        p.jug.localToWorld(this.tmp);
        topX = this.tmp.x; topY = this.tmp.y; topZ = this.tmp.z;
      } else {
        topX = ox + b.pos.x; topZ = b.pos.z; topY = oy + VALVE_Y;
      }
      const streaming = p.t >= enter * 0.8;
      let top = topY;
      if (p.t > flowEnd) top = THREE.MathUtils.lerp(topY, surfaceY, Math.min(1, (p.t - flowEnd) / (LEAVE * 0.7)));
      const len = top - surfaceY;
      p.stream.visible = streaming && len > 0.005;
      if (p.stream.visible) {
        p.stream.position.set(topX, top, topZ);
        p.stream.scale.set(1 + THICKNESS[p.liquid] * 0.5, len, 1 + THICKNESS[p.liquid] * 0.5);
        // 落點濺一點水花；要節制，粒子池只有 48 顆、泡澡的泡泡也在用
        p.splashT += dt;
        if (p.splashT > 0.1 && p.t < flowEnd) {
          p.splashT = 0;
          this.particles.bubble(topX, surfaceY + 0.01, topZ, LIQUIDS[p.liquid].color);
        }
      }
    }
    this.group.visible = this.active.length > 0;
  }

  private end(p: Pour, index: number) {
    this.group.remove(p.pivot, p.stream);
    (p.stream.material as THREE.Material).dispose();
    this.active.splice(index, 1);
  }

  private jugGeo(liquid: LiquidId): THREE.BufferGeometry {
    let g = this.jugGeos.get(liquid);
    if (!g) {
      g = jugGeometry(liquid);
      this.jugGeos.set(liquid, g);
    }
    return g;
  }
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k);
}
