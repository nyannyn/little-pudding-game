import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  STATIONS,
  STATION_IDS,
  dayClock,
  stationProgress,
  stationStatus,
  type Batch,
  type StationId,
} from '../../game/bakery';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../../game/species';
import type { GameState } from '../../game/state';
import { toonGradient } from '../toon';
import { Parts } from './build';
import {
  COUNTER,
  DECOR,
  DOOR,
  EGG_BASKET,
  OVEN,
  QUEUE_Z,
  RACK_SLOTS,
  ROOM,
  SHELF_SLOTS,
  SHOWCASE,
  STATION_ANCHOR,
  STATION_LABEL,
  VIEW,
} from './layout';
import { PAL, buildRoom } from './room';

const DEG = Math.PI / 180;
/** 甜點杯的尺寸：跟掉落原料同量級（0.05），iPhone 視口下才讀得出來（D42 的教訓） */
const CUP_R = 0.058;
const CUP_H = 0.06;
const MAX_ITEMS = 48;
const MAX_CUSTOMERS = 5;
/** 一盤從上一站飛到下一站要幾秒 */
const FLY_SEC = 0.55;

const CUP_COLORS = [0xffc4d2, 0xc9ecdf, 0xfff0b8, 0xe1d6fb];

type V3 = { x: number; y: number; z: number };

interface Flight {
  to: StationId | 'rack';
  from: V3;
  dest: V3;
  t: number;
  batch: Batch;
  /** 杯子裡有沒有東西（打蛋站飛過去的是蛋，不畫杯子） */
  stage: number;
}

interface Customer {
  x: number;
  z: number;
  tx: number;
  phase: 'in' | 'pick' | 'out';
  t: number;
  color: number;
  /** 買到的甜點（null＝架上空空，垂頭離開） */
  species: SpeciesId | null;
  hop: number;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * 甜點工坊的場景（D51）。一個獨立的 `THREE.Scene`＋自己的鏡頭；main.ts 只在玩家切到「甜點店」
 * 時畫它。只讀 state、播動畫，不改規則（分層鐵則）。
 *
 * draw call（2026-09-23 設計值，e2e `cp8-bakery` 量實際值）：房間＋機身 1、玻璃 2、烤箱光 1、窗景 1、
 * 名牌 1、營業牌 1、進度條 2、甜點杯三層 3、蛋殼 1、攪拌頭 1、麵糊 1、注模嘴 1、轉台 1、擠花袋 1、
 * 客人 2 ＝ 21。
 */
export class BakeryView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly windowMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly openSign: THREE.Mesh;
  private readonly closedSign: THREE.Mesh;

  private readonly cups: THREE.InstancedMesh;
  private readonly fills: THREE.InstancedMesh;
  private readonly tops: THREE.InstancedMesh;
  private readonly eggs: THREE.InstancedMesh;
  private readonly barBg: THREE.InstancedMesh;
  private readonly barFill: THREE.InstancedMesh;
  private readonly whisk: THREE.Mesh;
  private readonly batter: THREE.Mesh;
  private readonly nozzle: THREE.Mesh;
  private readonly turntable: THREE.Mesh;
  private readonly bag: THREE.Mesh;
  private readonly custBody: THREE.InstancedMesh;
  private readonly custEyes: THREE.InstancedMesh;

  /** 射線用的隱形點擊盒：各站＋展示櫃＋成品櫃 */
  readonly hitBoxes: THREE.Mesh[] = [];

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private nItems = 0;
  private time = 0;
  private flights: Flight[] = [];
  private customers: Customer[] = [];
  /** 上一幀每一站的那一盤（偵測「剛推過來」要播飛行動畫） */
  private prev: Record<StationId, string> = { crack: '', mix: '', mold: '', bake: '', decorate: '' };
  private prevDesserts = -1;
  private readonly ready: Record<StationId, number> = { crack: 0, mix: 0, mold: 0, bake: 0, decorate: 0 };

  constructor() {
    this.scene.name = 'Bakery';
    this.scene.background = new THREE.Color(0xfbe3e8);

    // 比農場暗一點：工坊整間是淺粉彩，ACES 在亮處會把顏色洗成一片白
    // 沒有色調映射時，亮度≈反照率 ×（半球＋平行光 × 階梯）/π：頂面約 1.0、牆面約 0.8
    this.hemi = new THREE.HemisphereLight(0xfffaf2, 0xfbe6ea, 1.9);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.3);
    this.sun.position.set(2.5, 6, 4);
    this.scene.add(this.hemi, this.sun);

    // 工坊不吃 ACES：整間是淺粉彩，ACES 會把亮處的顏色壓成一片灰白（2026-09-23 截圖實測，
    // 降燈光也救不回飽和度）。關掉色調映射、燈光壓在不會過曝的範圍，粉彩才是粉彩。
    const toon = (opts: THREE.MeshToonMaterialParameters = {}) =>
      new THREE.MeshToonMaterial({ gradientMap: toonGradient(), toneMapped: false, ...opts });

    const room = new THREE.Mesh(buildRoom(), toon({ vertexColors: true }));
    room.name = 'BakeryRoom';
    this.scene.add(room);

    // 窗景：一塊平面，白天天空藍、晚上深藍
    this.windowMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.62), this.windowMat);
    win.position.set(-ROOM.halfW + 0.005, 1.37, -0.4);
    win.rotation.y = Math.PI / 2;
    win.name = 'BakeryWindow';
    this.scene.add(win);

    // 烤箱窗洞裡的背板（發光）＋玻璃
    const front = OVEN.z + OVEN.d / 2;
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x6d5b86 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), this.glowMat);
    glow.position.set(OVEN.x, 0.52, OVEN.z + 0.15);
    glow.name = 'OvenGlow';
    this.scene.add(glow);

    const glassMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.22, depthWrite: false });
    const ovenGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), glassMat);
    ovenGlass.position.set(OVEN.x, 0.52, front + 0.002);
    ovenGlass.renderOrder = 2;
    ovenGlass.name = 'OvenGlass';
    this.scene.add(ovenGlass);

    // 展示櫃玻璃：一個盒子（前、左、右三面＋頂），半透明
    const cg = new THREE.BoxGeometry(SHOWCASE.w - 0.02, SHOWCASE.glassH, SHOWCASE.d - 0.02);
    const caseGlass = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xf3fbff, transparent: true, opacity: 0.16, depthWrite: false }));
    caseGlass.position.set(SHOWCASE.x, SHOWCASE.baseH + SHOWCASE.glassH / 2, SHOWCASE.z);
    caseGlass.renderOrder = 2;
    caseGlass.name = 'ShowcaseGlass';
    this.scene.add(caseGlass);

    // 名牌（五站＋店招）：一張 canvas 圖集、一個 mesh
    const { labels, open, closed } = buildLabels();
    this.scene.add(labels);
    this.openSign = open;
    this.closedSign = closed;
    this.scene.add(open, closed);

    // 甜點杯：杯身＋內容物＋頂飾，三層各一個 InstancedMesh
    const cupGeo = new THREE.CylinderGeometry(CUP_R, CUP_R * 0.78, CUP_H, 16);
    cupGeo.translate(0, CUP_H / 2, 0);
    const fillGeo = new THREE.CylinderGeometry(CUP_R * 0.92, CUP_R * 0.92, 1, 16);
    fillGeo.translate(0, 0.5, 0); // 底在 0：scale.y 就是高度
    const topGeo = swirlGeometry();
    this.cups = this.instanced(cupGeo, toon({ color: 0xffffff }), 'BakeryCups');
    this.fills = this.instanced(fillGeo, toon({ color: 0xffffff }), 'BakeryFills');
    this.tops = this.instanced(topGeo, toon({ color: 0xffffff }), 'BakeryTops');

    // 蛋殼：半球兩片一組（上半＋下半），打蛋時分開
    const shell = new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    shell.scale(1, 1.3, 1);
    this.eggs = new THREE.InstancedMesh(shell, toon({ color: PAL.egg, side: THREE.DoubleSide }), 4);
    this.eggs.name = 'BakeryEggs';
    this.eggs.frustumCulled = false;
    this.scene.add(this.eggs);

    // 進度條（每站一條：底＋填滿）
    const bar = new THREE.PlaneGeometry(1, 1);
    this.barBg = this.instanced(bar, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 'BakeryBarBg', 5);
    const fillBar = new THREE.PlaneGeometry(1, 1);
    fillBar.translate(0.5, 0, 0); // 左端對齊：scale.x 就是進度
    this.barFill = this.instanced(fillBar, new THREE.MeshBasicMaterial({ color: 0xffffff }), 'BakeryBarFill', 5);
    this.barBg.renderOrder = 3;
    this.barFill.renderOrder = 4;

    // 攪拌頭（三圈打蛋器）
    const w = new Parts();
    w.cyl(PAL.metal, 0.012, 0.012, 0.16, 0, 0.08, 0, 8);
    for (let i = 0; i < 3; i++) w.torus(PAL.metal, 0.045, 0.006, 0, -0.02, 0, { x: 0, y: (i * Math.PI) / 3, z: 0 });
    this.whisk = new THREE.Mesh(w.merge(), toon({ vertexColors: true }));
    this.whisk.position.set(STATION_ANCHOR.mix.x, COUNTER.top + 0.32, STATION_ANCHOR.mix.z);
    this.whisk.name = 'BakeryWhisk';
    this.scene.add(this.whisk);

    this.batter = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.08, 24), toon({ color: 0xffffff }));
    // 麵糊頂面要高過碗口一點點，從上往下看才看得到顏色（第一版埋在碗裡整個看不見）
    this.batter.position.set(STATION_ANCHOR.mix.x, COUNTER.top + 0.24, STATION_ANCHOR.mix.z);
    this.batter.name = 'BakeryBatter';
    this.scene.add(this.batter);

    const nz = new Parts();
    nz.rbox(PAL.butterDark, 0.1, 0.08, 0.1, 0, 0.06, 0, 0.02);
    nz.cone(PAL.metal, 0.03, 0.06, 0, -0.01, 0, 12, { x: Math.PI, y: 0, z: 0 });
    this.nozzle = new THREE.Mesh(nz.merge(), toon({ vertexColors: true }));
    this.nozzle.position.set(STATION_ANCHOR.mold.x, COUNTER.top + 0.24, STATION_ANCHOR.mold.z);
    this.nozzle.name = 'BakeryNozzle';
    this.scene.add(this.nozzle);

    const tt = new Parts();
    tt.cyl(PAL.cream, 0.17, 0.17, 0.03, 0, 0, 0, 28);
    tt.torus(PAL.pink, 0.17, 0.012, 0, 0.012, 0, { x: Math.PI / 2, y: 0, z: 0 });
    for (let i = 0; i < 6; i++) tt.sphere(PAL.pinkDark, 0.012, Math.cos((i * Math.PI) / 3) * 0.15, 0.02, Math.sin((i * Math.PI) / 3) * 0.15);
    this.turntable = new THREE.Mesh(tt.merge(), toon({ vertexColors: true }));
    this.turntable.position.set(STATION_ANCHOR.decorate.x, DECOR.top + 0.075, STATION_ANCHOR.decorate.z);
    this.turntable.name = 'BakeryTurntable';
    this.scene.add(this.turntable);

    const bg = new Parts();
    bg.cone(PAL.cream, 0.05, 0.16, 0, 0, 0, 16, { x: Math.PI, y: 0, z: 0 });
    bg.cone(PAL.metal, 0.014, 0.03, 0, -0.09, 0, 8, { x: Math.PI, y: 0, z: 0 });
    bg.sphere(PAL.pink, 0.02, 0, 0.09, 0);
    this.bag = new THREE.Mesh(bg.merge(), toon({ vertexColors: true }));
    this.bag.name = 'BakeryPipingBag';
    this.scene.add(this.bag);

    // 客人：圓滾滾的小兔（身體＋耳朵＋尾巴一顆幾何，眼睛另一顆），顏色走 instance
    const cb = new Parts();
    cb.sphere(0xffffff, 0.11, 0, 0.12, 0, { x: 1, y: 1.05, z: 1 });
    cb.add(new THREE.CapsuleGeometry(0.028, 0.1, 4, 10), 0xffffff, { x: -0.045, y: 0.27, z: -0.01 }, { x: 0, y: 0, z: 0.18 });
    cb.add(new THREE.CapsuleGeometry(0.028, 0.1, 4, 10), 0xffffff, { x: 0.045, y: 0.27, z: -0.01 }, { x: 0, y: 0, z: -0.18 });
    cb.sphere(0xffffff, 0.035, 0, 0.1, -0.11);
    cb.sphere(0xffb3c4, 0.022, -0.06, 0.1, 0.085, { x: 1, y: 0.6, z: 0.5 }); // 腮紅（頂點色，不吃 instance 色會被相乘，選淺粉）
    cb.sphere(0xffb3c4, 0.022, 0.06, 0.1, 0.085, { x: 1, y: 0.6, z: 0.5 });
    this.custBody = new THREE.InstancedMesh(cb.merge(), toon({ vertexColors: true }), MAX_CUSTOMERS);
    this.custBody.name = 'BakeryCustomers';
    this.custBody.frustumCulled = false;
    const eg = new Parts();
    eg.sphere(PAL.dark, 0.016, -0.035, 0.14, 0.098);
    eg.sphere(PAL.dark, 0.016, 0.035, 0.14, 0.098);
    this.custEyes = new THREE.InstancedMesh(eg.merge(), toon({ vertexColors: true }), MAX_CUSTOMERS);
    this.custEyes.name = 'BakeryCustomerEyes';
    this.custEyes.frustumCulled = false;
    this.scene.add(this.custBody, this.custEyes);

    this.buildHitBoxes();
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, max = MAX_ITEMS) {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.name = name;
    m.frustumCulled = false; // 實例散在整間店，用單一幾何的包圍球判斷會把整組裁掉
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    this.scene.add(m);
    return m;
  }

  private buildHitBoxes() {
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const add = (name: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.name = name;
      m.updateMatrixWorld();
      this.hitBoxes.push(m);
    };
    const t = COUNTER.top;
    add('crack', 0.62, 0.8, 0.62, STATION_ANCHOR.crack.x - 0.05, t + 0.35, COUNTER.z + 0.05);
    add('mix', 0.56, 0.9, 0.62, STATION_ANCHOR.mix.x, t + 0.4, COUNTER.z + 0.05);
    add('mold', 0.62, 0.95, 0.62, STATION_ANCHOR.mold.x, t + 0.4, COUNTER.z + 0.05);
    add('bake', OVEN.w, OVEN.h + 0.2, OVEN.d, OVEN.x, OVEN.h / 2, OVEN.z);
    add('decorate', DECOR.w, 1.2, DECOR.d, DECOR.x, 0.6, DECOR.z);
    add('shelf', SHOWCASE.w, SHOWCASE.baseH + SHOWCASE.glassH, SHOWCASE.d, SHOWCASE.x, (SHOWCASE.baseH + SHOWCASE.glassH) / 2, SHOWCASE.z);
    add('rack', 0.4, 1.1, 0.55, RACK_SLOTS[0]!.x, 0.55, RACK_SLOTS[4]!.z);
  }

  /** 射線打到哪一站（或展示櫃／成品櫃）；沒打到回 null */
  pick(raycaster: THREE.Raycaster): string | null {
    const hit = raycaster.intersectObjects(this.hitBoxes, false)[0];
    return hit ? hit.object.name : null;
  }

  /**
   * 把整間店塞進 HUD 沒蓋住的那一段畫面。
   *
   * 只用水平視角算距離（農場的 fitDistance）不夠：直向手機上下還被資源列與動作列各吃一截，
   * 第一版照寬度算，後排工作檯被頂到畫面外、展示櫃佔掉半個螢幕（2026-09-23 截圖）。
   * 做法是把房間的 8 個角投影到螢幕，逐步拉遠直到「寬在 ±1 內、高在可見段的比例內」。
   *
   * @param bandFrac HUD 沒遮住的高度占整個畫面的比例（main.ts 用 `measureVisibleBand` 量）
   */
  resize(aspect: number, bandFrac = 0.7) {
    const cam = this.camera;
    cam.aspect = aspect;
    const tilt = VIEW.tiltDeg * DEG;
    const t = VIEW.target;
    const corners: THREE.Vector3[] = [];
    for (const x of [-ROOM.halfW - 0.1, ROOM.halfW + 0.3]) {
      for (const y of [-0.15, ROOM.wallH]) {
        for (const z of [ROOM.backZ, ROOM.frontZ + 0.1]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const v = new THREE.Vector3();
    const place = (d: number) => {
      cam.position.set(t.x, t.y + Math.sin(tilt) * d, t.z + Math.cos(tilt) * d);
      cam.lookAt(t.x, t.y, t.z);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
    };
    // setViewOffset 會改投影；量的時候要用沒有偏移的投影，量完再還原
    const view = cam.view ? { ...cam.view } : null;
    cam.clearViewOffset();
    let d = 4;
    for (; d < 30; d += 0.1) {
      place(d);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        v.copy(c).project(cam);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      if (maxX - minX <= 1.96 && maxY - minY <= 2 * bandFrac * 0.98) break;
    }
    if (view) cam.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    place(d);
  }

  /** 營業事件（main.ts 只在玩家正在看工坊時轉進來；離線結算的那幾百個不演） */
  customerCame(species: SpeciesId | null) {
    if (this.customers.length >= MAX_CUSTOMERS) return;
    const slot = SHELF_SLOTS[Math.floor(Math.random() * 6)]!;
    const colors = [0xffffff, 0xfff1c9, 0xffd9e2, 0xe9dcc9, 0xdff1ff];
    this.customers.push({
      x: DOOR.x,
      z: DOOR.z,
      tx: slot.x + (Math.random() - 0.5) * 0.1,
      phase: 'in',
      t: 0,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      species,
      hop: Math.random() * 6,
    });
  }

  /** 客人目前在店裡幾位（測試用） */
  get customerCount(): number {
    return this.customers.length;
  }

  sync(state: GameState, dt: number) {
    this.time += dt;
    const t = this.time;
    this.nItems = 0;

    this.syncDaylight(state);
    this.detectFlights(state);

    // ── 各站 ──
    const st = state.bakery.stations;
    const flyingTo = new Set(this.flights.map((f) => f.to));

    // 打蛋：臂上一顆蛋落下、裂成兩半
    this.eggs.count = 0;
    const crackBusy = stationStatus(state, 'crack') === 'working' && !flyingTo.has('crack');
    if (st.crack.batch && !flyingTo.has('crack')) this.drawEgg(crackBusy ? (t * 0.9) % 1 : 0.2);

    // 攪拌：碗裡的麵糊由蛋黃色轉成物種色，打蛋器轉
    const mixB = flyingTo.has('mix') ? null : st.mix.batch;
    this.batter.visible = !!mixB;
    const mixWorking = stationStatus(state, 'mix') === 'working';
    if (mixB) {
      const k = stationProgress(state, 'mix');
      this.color.set(0xffe6a0).lerp(new THREE.Color(SPECIES[mixB.species].bodyColor), k);
      (this.batter.material as THREE.MeshToonMaterial).color.copy(this.color);
      this.batter.scale.set(1, 0.8 + Math.sin(t * 14) * 0.08 * (mixWorking ? 1 : 0), 1);
    }
    this.whisk.rotation.y = mixWorking ? t * 18 : this.whisk.rotation.y;
    this.whisk.position.y = COUNTER.top + (mixB ? 0.3 : 0.4);

    // 裝模：注模嘴在兩個杯之間來回，杯子慢慢填滿
    const moldB = flyingTo.has('mold') ? null : st.mold.batch;
    const moldWorking = stationStatus(state, 'mold') === 'working';
    const a = STATION_ANCHOR.mold;
    if (moldB) {
      const k = stationProgress(state, 'mold');
      const n = Math.min(moldB.qty, 2);
      for (let i = 0; i < n; i++) {
        const own = Math.min(1, Math.max(0, k * n - i));
        this.putItem(a.x + (i - (n - 1) / 2) * 0.2, a.y - 0.03, a.z, moldB.species, i, 0.15 + own * 0.85, 1, 0, 0);
      }
      const which = Math.min(n - 1, Math.floor(k * n));
      const nx = a.x + (which - (n - 1) / 2) * 0.2;
      this.nozzle.position.x = moldWorking ? nx + Math.sin(t * 12) * 0.01 : lerp(this.nozzle.position.x, a.x, 0.1);
    } else {
      this.nozzle.position.x = lerp(this.nozzle.position.x, a.x, 0.1);
    }
    this.nozzle.position.y = COUNTER.top + 0.26 + (moldWorking ? Math.abs(Math.sin(t * 6)) * 0.02 : 0);

    // 烘烤：窗洞發橘光（脈動），杯裡的布丁慢慢膨起來
    const bakeB = flyingTo.has('bake') ? null : st.bake.batch;
    const bakeWorking = stationStatus(state, 'bake') === 'working';
    if (bakeB) {
      const k = stationProgress(state, 'bake');
      const b = STATION_ANCHOR.bake;
      const n = Math.min(bakeB.qty, 2);
      for (let i = 0; i < n; i++) this.putItem(b.x + (i - (n - 1) / 2) * 0.22, b.y - 0.16, b.z, bakeB.species, i, 1, 1 + ease(k) * 0.35, 0, 0);
    }
    const pulse = bakeWorking ? 0.75 + Math.sin(t * 5) * 0.25 : bakeB ? 0.45 : 0;
    this.glowMat.color.set(0x6d5b86).lerp(new THREE.Color(0xffb04d), pulse);

    // 裝飾：轉台轉、擠花袋下壓，奶油頂飾長出來
    const decB = flyingTo.has('decorate') ? null : st.decorate.batch;
    const decWorking = stationStatus(state, 'decorate') === 'working';
    if (decWorking) this.turntable.rotation.y += dt * 3.2;
    const da = STATION_ANCHOR.decorate;
    if (decB) {
      const k = stationProgress(state, 'decorate');
      const n = Math.min(decB.qty, 2);
      for (let i = 0; i < n; i++) {
        const ang = this.turntable.rotation.y + (i * Math.PI * 2) / n;
        this.putItem(da.x + Math.cos(ang) * 0.075, DECOR.top + 0.09, da.z + Math.sin(ang) * 0.075, decB.species, i, 1, 1.35, Math.min(1, k * 1.15), ang);
      }
    }
    this.bag.position.set(da.x + 0.02, DECOR.top + 0.36 - (decWorking ? Math.abs(Math.sin(t * 5)) * 0.05 : 0), da.z - 0.02);

    // ── 飛行中的盤子 ──
    this.flights = this.flights.filter((f) => f.t < 1);
    for (const f of this.flights) {
      f.t = Math.min(1, f.t + dt / FLY_SEC);
      const k = ease(f.t);
      const x = lerp(f.from.x, f.dest.x, k);
      const z = lerp(f.from.z, f.dest.z, k);
      const y = lerp(f.from.y, f.dest.y, k) + Math.sin(Math.PI * f.t) * 0.35;
      if (f.stage === 0) {
        this.drawEggAt(x, y, z, 0);
        continue;
      }
      const n = Math.min(f.batch.qty, 2);
      for (let i = 0; i < n; i++) {
        this.putItem(x + (i - (n - 1) / 2) * 0.12, y, z, f.batch.species, i, f.stage >= 2 ? 1 : 0.15, f.stage >= 3 ? 1.35 : 1, f.stage >= 4 ? 1 : 0, 0);
      }
    }

    // ── 成品櫃與展示架 ──
    let k = 0;
    for (const id of SPECIES_IDS) {
      for (let i = 0; i < state.desserts[id] && k < RACK_SLOTS.length; i++, k++) {
        const s = RACK_SLOTS[k]!;
        this.putItem(s.x, s.y, s.z, id, k, 1, 1.35, 1, 0);
      }
    }
    k = 0;
    for (const id of SPECIES_IDS) {
      for (let i = 0; i < state.bakery.shelf[id] && k < SHELF_SLOTS.length; i++, k++) {
        const s = SHELF_SLOTS[k]!;
        this.putItem(s.x, s.y, s.z, id, k, 1, 1.35, 1, Math.sin(t * 1.3 + k) * 0.15);
      }
    }

    this.syncBars(state, dt);
    this.syncCustomers(dt);

    for (const m of [this.cups, this.fills, this.tops]) {
      m.count = this.nItems;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.eggs.instanceMatrix.needsUpdate = true;
  }

  /** 營業中亮、打烊暗；窗景白天藍、晚上深藍；門口牌子 OPEN／CLOSED */
  private syncDaylight(state: GameState) {
    const c = dayClock(state);
    const night = c.hour < 6 || c.hour >= 19 ? 1 : c.hour >= 17 ? (c.hour - 17) / 2 : c.hour < 7 ? 1 - (c.hour - 6) : 0;
    this.hemi.intensity = lerp(1.9, 1.05, night);
    this.sun.intensity = lerp(1.3, 0.35, night);
    this.windowMat.color.set(0xbfe6ff).lerp(new THREE.Color(0x2c3566), night);
    this.openSign.visible = c.open;
    this.closedSign.visible = !c.open;
  }

  /** 比對上一幀各站的那一盤：新出現的就從上一站（或蛋籃）飛過來 */
  private detectFlights(state: GameState) {
    const st = state.bakery.stations;
    const origin = (id: StationId): V3 => {
      const i = STATION_IDS.indexOf(id);
      if (i === 0) return { x: EGG_BASKET.x + 0.1, y: EGG_BASKET.y + 0.1, z: EGG_BASKET.z + 0.1 };
      return STATION_ANCHOR[STATION_IDS[i - 1]!];
    };
    for (const [i, id] of STATION_IDS.entries()) {
      const b = st[id].batch;
      const key = b ? `${b.species}:${b.qty}:${st[id].doneAt}` : '';
      if (key && key !== this.prev[id] && this.prevDesserts >= 0) {
        this.flights.push({ to: id, from: origin(id), dest: STATION_ANCHOR[id], t: 0, batch: b!, stage: i });
      }
      this.prev[id] = key;
    }
    // 裝飾站做完被收走：成品櫃多了東西，從轉台飛過去
    const total = SPECIES_IDS.reduce((n, id) => n + state.desserts[id], 0);
    if (this.prevDesserts >= 0 && total > this.prevDesserts && !st.decorate.batch) {
      const species = SPECIES_IDS.find((id) => state.desserts[id] > 0) ?? 'caramel';
      const slot = RACK_SLOTS[Math.min(total - 1, RACK_SLOTS.length - 1)]!;
      this.flights.push({ to: 'rack', from: STATION_ANCHOR.decorate, dest: slot, t: 0, batch: { species, qty: 1 }, stage: 5 });
    }
    this.prevDesserts = total;
  }

  /** 一杯甜點：杯（粉彩）＋內容物（物種色，高度＝fill×rise）＋奶油頂（頂料色，大小＝top） */
  private putItem(x: number, y: number, z: number, species: SpeciesId, idx: number, fill: number, rise: number, top: number, rotY: number) {
    if (this.nItems >= MAX_ITEMS) return;
    const i = this.nItems++;
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(0, rotY, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    this.cups.setMatrixAt(i, d.matrix);
    this.cups.setColorAt(i, this.color.set(CUP_COLORS[idx % CUP_COLORS.length]!));

    const info = SPECIES[species];
    const h = Math.max(0.004, CUP_H * 0.85 * fill * rise);
    d.position.set(x, y + 0.006, z);
    d.scale.set(1, h, 1);
    d.updateMatrix();
    this.fills.setMatrixAt(i, d.matrix);
    this.fills.setColorAt(i, this.color.set(info.bodyColor));

    const s = Math.max(0.001, top);
    d.position.set(x, y + 0.006 + h, z);
    d.scale.set(s, s, s);
    d.updateMatrix();
    this.tops.setMatrixAt(i, d.matrix);
    this.tops.setColorAt(i, this.color.set(info.toppingColor).lerp(new THREE.Color(0xffffff), 0.35));
  }

  /** 打蛋動畫的一格：phase 0–0.55 蛋從臂上落到碗口，0.55–1 裂成兩半往兩邊倒 */
  private drawEgg(phase: number) {
    const a = STATION_ANCHOR.crack;
    const fall = Math.min(1, phase / 0.55);
    const y = lerp(COUNTER.top + 0.52, a.y + 0.12, ease(fall));
    const open = phase < 0.55 ? 0 : (phase - 0.55) / 0.45;
    this.drawEggAt(a.x, y, a.z, open);
  }

  private drawEggAt(x: number, y: number, z: number, open: number) {
    const d = this.dummy;
    const spread = open * 0.07;
    const tilt = open * 1.2;
    // 上半：正放；下半：翻過來（rotation.x = π）
    d.position.set(x - spread, y, z);
    d.rotation.set(0, 0, tilt);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    this.eggs.setMatrixAt(this.eggs.count++, d.matrix);
    d.position.set(x + spread, y, z);
    d.rotation.set(Math.PI, 0, -tilt);
    d.updateMatrix();
    this.eggs.setMatrixAt(this.eggs.count++, d.matrix);
  }

  /** 每站上方一條進度條：工作中粉紅往右長、做完變綠並輕跳（提示「點我推到下一站」） */
  private syncBars(state: GameState, dt: number) {
    const d = this.dummy;
    let n = 0;
    for (const id of STATION_IDS) {
      const status = stationStatus(state, id);
      if (status === 'idle') {
        this.ready[id] = 0;
        continue;
      }
      const p = STATION_LABEL[id];
      const k = stationProgress(state, id);
      const isReady = status === 'ready';
      this.ready[id] = isReady ? this.ready[id] + dt : 0;
      const bob = isReady ? Math.abs(Math.sin(this.ready[id] * 5)) * 0.04 : 0;
      const W = 0.44, H = 0.055;
      const y = p.y - 0.13 + bob;
      d.position.set(p.x, y, p.z + 0.02);
      d.rotation.set(0, 0, 0);
      d.scale.set(W + 0.03, H + 0.03, 1);
      d.updateMatrix();
      this.barBg.setMatrixAt(n, d.matrix);
      d.position.set(p.x - W / 2, y, p.z + 0.025);
      d.scale.set(Math.max(0.001, W * k), H, 1);
      d.updateMatrix();
      this.barFill.setMatrixAt(n, d.matrix);
      this.barFill.setColorAt(n, this.color.set(isReady ? 0x6cc58a : 0xf08aa2));
      n++;
    }
    this.barBg.count = n;
    this.barFill.count = n;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFill.instanceMatrix.needsUpdate = true;
    if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true;
  }

  private syncCustomers(dt: number) {
    const d = this.dummy;
    const speed = 0.85;
    let n = 0;
    for (const c of this.customers) {
      c.t += dt;
      c.hop += dt * 9;
      let face = 0;
      if (c.phase === 'in') {
        // 先走到排隊線，再沿著排隊線走到要看的那一格前面
        const tz = QUEUE_Z;
        if (Math.abs(c.z - tz) > 0.01) c.z += Math.sign(tz - c.z) * Math.min(Math.abs(tz - c.z), speed * dt);
        else c.x += Math.sign(c.tx - c.x) * Math.min(Math.abs(c.tx - c.x), speed * dt);
        face = Math.atan2(c.tx - c.x, tz - c.z);
        if (Math.abs(c.x - c.tx) < 0.01 && Math.abs(c.z - tz) < 0.01) {
          c.phase = 'pick';
          c.t = 0;
        }
      } else if (c.phase === 'pick') {
        face = Math.PI; // 面向展示櫃（−z）
        if (c.t > 0.9) {
          c.phase = 'out';
          c.t = 0;
        }
      } else {
        c.x += Math.sign(DOOR.x + 0.4 - c.x) * Math.min(Math.abs(DOOR.x + 0.4 - c.x), speed * dt);
        c.z += Math.sign(DOOR.z - c.z) * Math.min(Math.abs(DOOR.z - c.z), speed * dt);
        face = Math.PI / 2;
      }
      const moving = c.phase !== 'pick';
      const sad = c.species === null && c.phase !== 'in';
      const y = moving ? Math.abs(Math.sin(c.hop)) * 0.05 : c.species ? Math.abs(Math.sin(c.t * 10)) * 0.06 : 0;
      d.position.set(c.x, y, c.z);
      d.rotation.set(sad ? 0.25 : 0, face + (sad && c.phase === 'pick' ? Math.sin(c.t * 16) * 0.35 : 0), 0);
      d.scale.set(1.45, 1.45, 1.45);
      d.updateMatrix();
      this.custBody.setMatrixAt(n, d.matrix);
      this.custBody.setColorAt(n, this.color.set(c.color));
      this.custEyes.setMatrixAt(n, d.matrix);
      n++;
      // 買到的甜點舉在頭上
      if (c.species && c.phase !== 'in') this.putItem(c.x, y + 0.5, c.z, c.species, n, 1, 1.35, 1, 0);
    }
    this.customers = this.customers.filter((c) => !(c.phase === 'out' && Math.abs(c.x - (DOOR.x + 0.4)) < 0.02 && Math.abs(c.z - DOOR.z) < 0.02));
    this.custBody.count = n;
    this.custEyes.count = n;
    this.custBody.instanceMatrix.needsUpdate = true;
    this.custEyes.instanceMatrix.needsUpdate = true;
    if (this.custBody.instanceColor) this.custBody.instanceColor.needsUpdate = true;
  }
}

/** 擠花奶油：三層由大到小的圓環疊成的螺旋頂＋一顆小點綴 */
function swirlGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry) => parts.push(g.index ? g.toNonIndexed() : g);
  for (let i = 0; i < 3; i++) {
    const r = 0.046 - i * 0.013;
    const g = new THREE.TorusGeometry(r, 0.016 - i * 0.002, 8, 20);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.012 + i * 0.02, 0);
    add(g);
  }
  const tip = new THREE.ConeGeometry(0.014, 0.03, 10);
  tip.translate(0, 0.07, 0);
  add(tip);
  for (const g of parts) g.deleteAttribute('uv');
  const out = mergeGeometries(parts, false);
  if (!out) throw new Error('[lpg] swirl merge failed');
  return out;
}

/**
 * 名牌：五站＋店招畫在同一張 canvas 上，一個 mesh（每塊平面的 UV 對到自己那一列）。
 * OPEN／CLOSED 牌也在同一張圖上，但各自一個小 mesh 才能切換顯示。
 */
function buildLabels() {
  const rows = [...STATION_IDS.map((id) => ({ text: STATIONS[id].name, bg: '#ffffff', fg: '#7a5a6e' })),
    { text: '小布丁甜點店', bg: '#f28aa3', fg: '#ffffff' },
    { text: 'OPEN 營業中', bg: '#6cc58a', fg: '#ffffff' },
    { text: 'CLOSED 打烊', bg: '#7d7394', fg: '#ffffff' }];
  const W = 512, RH = 96;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = RH * rows.length;
  const g = canvas.getContext('2d')!;
  rows.forEach((r, i) => {
    const y = i * RH;
    g.fillStyle = r.bg;
    const pad = 6, rad = 36;
    g.beginPath();
    g.roundRect(pad, y + pad, W - pad * 2, RH - pad * 2, rad);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#f5b8c6';
    g.stroke();
    g.fillStyle = r.fg;
    g.font = 'bold 54px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(r.text, W / 2, y + RH / 2 + 2);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });

  const plate = (row: number, w: number, h: number, x: number, y: number, z: number, rotY = 0) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const v0 = 1 - (row + 1) / rows.length;
    const v1 = 1 - row / rows.length;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
    geo.rotateY(rotY);
    geo.translate(x, y, z);
    return geo;
  };

  const parts = STATION_IDS.map((id, i) => {
    const p = STATION_LABEL[id];
    return plate(i, 0.62, 0.116, p.x, p.y, p.z);
  });
  parts.push(plate(5, 1.2, 0.225, 0, 1.92, ROOM.backZ + 0.02));
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('[lpg] label merge failed');
  const labels = new THREE.Mesh(merged, mat);
  labels.name = 'BakeryLabels';
  labels.renderOrder = 3;

  const signAt = { x: ROOM.halfW - 0.02, y: 1.2, z: ROOM.backZ + 2.9 + 0.25 };
  const open = new THREE.Mesh(plate(6, 0.34, 0.064, 0, 0, 0, -Math.PI / 2 + 0.6), mat);
  const closed = new THREE.Mesh(plate(7, 0.34, 0.064, 0, 0, 0, -Math.PI / 2 + 0.6), mat);
  for (const m of [open, closed]) {
    m.position.set(signAt.x, signAt.y, signAt.z);
    m.renderOrder = 3;
  }
  open.name = 'BakeryOpenSign';
  closed.name = 'BakeryClosedSign';
  return { labels, open, closed };
}
