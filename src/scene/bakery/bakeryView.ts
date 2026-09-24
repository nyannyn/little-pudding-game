import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchesOnLine, dayClock, stationProgress, stationStatus, type Batch } from '../../game/bakery';
import { stockOf, totalStock } from '../../game/stock';
import { MAX_MACHINE_LEVEL, RECIPES, STATIONS, STATION_IDS, type StationId } from '../../game/recipes';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../../game/species';
import type { RegularId } from '../../game/regulars';
import type { GameState } from '../../game/state';
import { toonGradient } from '../toon';
import { regularGeometry } from '../voxelAnimal';
import { Parts } from './build';
import {
  BELT,
  BELT_LENGTH,
  BELT_PATH,
  CHILL,
  DOOR,
  EGG_BASKET,
  OVEN,
  QUEUE_Z,
  RACK_SLOTS,
  ROOM,
  SHELF_SLOTS,
  SHOWCASE,
  STATION_ANCHOR,
  STATION_AT,
  STATION_PLATE,
  VIEW,
  WALL_LAMPS,
  FLOOR_POOLS,
  pathPoint,
} from './layout';
import { buildMachines, machinesSignature } from './machines';
import { PAL, buildRoom } from './room';

const DEG = Math.PI / 180;
/** 甜點杯的尺寸：跟掉落原料同量級（0.05），iPhone 視口下才讀得出來（D42 的教訓） */
const CUP_R = 0.05;
const CUP_H = 0.055;
/**
 * 杯子 InstancedMesh 的容量（D60：一盤最多 20 份）。七站各 20 杯＋滑動中的盤子＋成品櫃＋展示架，
 * 256 還有餘裕；真的滿了 `putItem` 會 console.error 一次，不可以靜默少畫（玩家會以為份數被吃掉）。
 */
const MAX_ITEMS = 256;
const MAX_CUSTOMERS = 5;
/**
 * 同時在店裡的常客最多 2 位（D69），多的在門外排隊（不畫）。一位常客＝一顆併好的方塊 mesh＝1 個 draw call，
 * 所以常客最多 +2 draw calls（AC11-11）。
 */
const MAX_REGULARS_IN = 2;
/**
 * 方塊動物身高約 2.2（`regularLooks.ts` 的座標）→ 約 0.57，比散客（約 0.43）高一截：一眼分得出是常客。
 * 0.2（跟散客一樣高）的截圖（2026-09-25）裡常客縮在咖啡座後面只剩一根棍子。
 */
const REGULAR_SCALE = 0.26;
/**
 * 常客站哪幾格展示櫃（`SHELF_SLOTS` 的索引）：只用右邊三格——左邊三格正前方是咖啡座（`CAFE`），
 * 從鏡頭看會被桌子整個擋住（2026-09-25 截圖）。兩位同時在店裡就各站一格。
 */
const REGULAR_SLOTS = [4, 5, 3];
/** 帶子的速度（世界單位／秒）：盤子從一站滑到下一站 */
const BELT_SPEED = 1.5;
/** 帶面條紋間距 */
const STRIPE = 0.12;
/** 裝模之前的盤子畫成一只攪拌碗；裝模之後才是一杯一杯 */
const MOLD_IDX = STATION_IDS.indexOf('mold');
const BAKE_IDX = STATION_IDS.indexOf('bake');

/** 燈罩關燈時乘的灰（看得出是燈、但沒亮）與開燈的原色 */
const LAMP_OFF = new THREE.Color(0xd8cdc4);
const LAMP_ON = new THREE.Color(0xffffff);
/** 夜間室內燈的暖色（半球光的天空色、主光） */
const WARM_SKY = new THREE.Color(0xffe8cc);
const WARM_SUN = new THREE.Color(0xffdcae);

const CUP_COLORS = [0xffc4d2, 0xc9ecdf, 0xfff0b8, 0xe1d6fb];

type V3 = { x: number; y: number; z: number };

/** 盤子在帶子上滑動：from／to 是沿線距離；`rack` 滑到出口後再跳進成品櫃 */
interface Ride {
  batch: Batch;
  /** 目的地那一站（null＝出口） */
  to: StationId | null;
  from: number;
  dest: number;
  t: number;
  dur: number;
  /** 滑的時候長什麼樣（剛離開的那一站） */
  after: StationId;
}

interface Hop {
  from: V3;
  dest: V3;
  /** < 0＝還在排隊（一杯接一杯跳，D60） */
  t: number;
  species: SpeciesId;
}

/** 一整盤出爐最多跳幾杯進成品櫃（再多只是排隊更久，畫面讀不出差別） */
const MAX_HOPS = 8;
/** 相鄰兩杯起跳的間隔（秒） */
const HOP_GAP = 0.09;

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

/** 走進店裡的常客（D69／D70）：跟散客同一條路線，買到頭上冒愛心、沒買到冒失望（HTML 疊層畫） */
interface RegularVisitor {
  id: RegularId;
  bought: boolean;
  dessert: SpeciesId | null;
  x: number;
  z: number;
  tx: number;
  phase: 'queue' | 'in' | 'pick' | 'out';
  t: number;
  hop: number;
}

/** 名字泡泡要的東西（畫面座標由 UI 投影；mood：走進來＝walk、買到＝happy、沒買到＝sad） */
export interface RegularAnchor {
  id: RegularId;
  ndc: { x: number; y: number };
  mood: 'walk' | 'happy' | 'sad';
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * 甜點工坊的場景（D51 → D57 U 型流水線）。一個獨立的 `THREE.Scene`＋自己的鏡頭；main.ts 只在玩家切到「甜點店」
 * 時畫它。只讀 state、播動畫，不改規則（分層鐵則）。
 *
 * draw call（2026-09-24 設計值，e2e `cp8-bakery` 量實際值）：房間 1、機身 1、帶面 1、窗景 1、烤箱光 1、
 * 冷藏光＋玻璃 2、展示櫃玻璃 1、店招 1、營業牌 1、燈罩 1、光暈 1、甜點杯三層 3、蛋殼 1、打蛋器 1、注模嘴 1、
 * 擠花袋 1、鍋蓋 1、客人 2 ＝ 23。進度條、份數與升級鈕是 HTML 疊層（`ui/stationTags.ts`），不吃 draw call。
 */
export class BakeryView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly windowMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly chillMat: THREE.MeshBasicMaterial;
  /** 壁燈燈罩＋展示櫃燈條（關燈＝乘上灰、開燈＝原色）與光暈（開燈才看得到） */
  private readonly lampMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  /** 燈開了多少（0 白天關、1 天黑全亮）；e2e 讀 */
  lampLevel = 0;
  /** 烤箱與冷藏櫃的光／玻璃：機器沒買時整組藏起來 */
  private readonly ovenParts: THREE.Object3D[] = [];
  private readonly chillParts: THREE.Object3D[] = [];
  private readonly openSign: THREE.Mesh;
  private readonly closedSign: THREE.Mesh;
  private readonly labels: LabelAtlas;

  private readonly machines: THREE.Mesh;
  private machineSig = '';
  private readonly beltTex: THREE.CanvasTexture;
  private readonly cups: THREE.InstancedMesh;
  private readonly fills: THREE.InstancedMesh;
  private readonly tops: THREE.InstancedMesh;
  private readonly eggs: THREE.InstancedMesh;
  private readonly whisk: THREE.Mesh;
  private readonly nozzle: THREE.Mesh;
  private readonly bag: THREE.Mesh;
  private readonly potLid: THREE.Mesh;
  private readonly custBody: THREE.InstancedMesh;
  private readonly custEyes: THREE.InstancedMesh;
  /** 常客（D69）：兩顆 mesh 輪流換 geometry（每位的 geometry 建一次就快取） */
  private readonly regularMeshes: THREE.Mesh[] = [];
  private regulars: RegularVisitor[] = [];

  /** 射線用的隱形點擊盒：各站＋展示櫃＋成品櫃 */
  readonly hitBoxes: THREE.Mesh[] = [];

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private nItems = 0;
  /** 奶油頂另外數：還沒裝飾的杯子不畫頂（D60：一盤 20 份時，全部畫一個縮成 0 的頂＝每杯白吃約 500 面） */
  private nTops = 0;
  private time = 0;
  private rides: Ride[] = [];
  private hops: Hop[] = [];
  private warnedFull = false;
  private customers: Customer[] = [];
  /** 上一幀每一站的那一盤（偵測「剛送過來」要播滑動） */
  private prev: Record<StationId, string> = emptyKeys();
  private prevBatch: Record<StationId, Batch | null> = emptyBatches();
  private prevDesserts = -1;

  constructor() {
    this.scene.name = 'Bakery';
    this.scene.background = new THREE.Color(0xfbe3e8);

    // 沒有色調映射時，亮度≈反照率 ×（半球＋平行光 × 階梯）/π：頂面約 1.0、牆面約 0.8
    this.hemi = new THREE.HemisphereLight(0xfffaf2, 0xfbe6ea, 1.9);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.3);
    this.sun.position.set(2.5, 6, 4);
    this.scene.add(this.hemi, this.sun);

    // 工坊不吃 ACES：整間是淺粉彩，ACES 會把亮處的顏色壓成一片灰白（2026-09-23 截圖實測）
    const toon = (opts: THREE.MeshToonMaterialParameters = {}) =>
      new THREE.MeshToonMaterial({ gradientMap: toonGradient(), toneMapped: false, ...opts });

    const room = new THREE.Mesh(buildRoom(), toon({ vertexColors: true }));
    room.name = 'BakeryRoom';
    this.scene.add(room);

    // 機身：買了才畫（D57），等級變了才重建
    this.machines = new THREE.Mesh(new THREE.BufferGeometry(), toon({ vertexColors: true }));
    this.machines.name = 'BakeryMachines';
    this.scene.add(this.machines);

    // 帶面：一張條紋貼圖沿整條 U 型鋪開，offset 捲動就是「帶子在走」
    this.beltTex = beltTexture();
    const belt = new THREE.Mesh(beltSurface(), new THREE.MeshBasicMaterial({ map: this.beltTex, toneMapped: false }));
    belt.name = 'BakeryBelt';
    this.scene.add(belt);

    // 窗景：一塊平面，白天天空藍、晚上深藍
    this.windowMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.62), this.windowMat);
    win.position.set(-ROOM.halfW + 0.005, 1.37, -0.4);
    win.rotation.y = Math.PI / 2;
    win.name = 'BakeryWindow';
    this.scene.add(win);

    // 隧道烤箱裡的光：貼在隧道內側牆（帶子左邊）上，烤的時候發橘光
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x6d5b86 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(OVEN.len - 0.06, OVEN.h - 0.08), this.glowMat);
    glow.position.set(OVEN.x - OVEN.w / 2 + 0.085, BELT.y + OVEN.h / 2 - 0.02, OVEN.z);
    glow.rotation.y = Math.PI / 2;
    glow.name = 'OvenGlow';
    this.scene.add(glow);
    this.ovenParts.push(glow);

    // 冷藏櫃：內側牆一片冷光＋朝鏡頭那面的玻璃
    this.chillMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff });
    const cg = new THREE.Mesh(new THREE.PlaneGeometry(CHILL.len - 0.06, CHILL.h - 0.08), this.chillMat);
    cg.position.set(CHILL.x, BELT.y + CHILL.h / 2 - 0.02, CHILL.z - CHILL.w / 2 + 0.065);
    cg.name = 'ChillGlow';
    this.scene.add(cg);
    const chillGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(CHILL.len - 0.04, CHILL.h - 0.06),
      new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    chillGlass.position.set(CHILL.x, BELT.y + CHILL.h / 2 - 0.02, CHILL.z + CHILL.w / 2 - 0.02);
    chillGlass.renderOrder = 2;
    chillGlass.name = 'ChillGlass';
    this.scene.add(chillGlass);
    this.chillParts.push(cg, chillGlass);

    // 展示櫃玻璃：一個盒子（前、左、右三面＋頂），半透明
    const sg = new THREE.BoxGeometry(SHOWCASE.w - 0.02, SHOWCASE.glassH, SHOWCASE.d - 0.02);
    const caseGlass = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xf3fbff, transparent: true, opacity: 0.16, depthWrite: false }));
    caseGlass.position.set(SHOWCASE.x, SHOWCASE.baseH + SHOWCASE.glassH / 2, SHOWCASE.z);
    caseGlass.renderOrder = 2;
    caseGlass.name = 'ShowcaseGlass';
    this.scene.add(caseGlass);

    // 燈（天黑自動開）：燈罩＋燈條一個 mesh、光暈一個 mesh
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const lamps = new THREE.Mesh(lampGeometry(), this.lampMat);
    lamps.name = 'BakeryLamps';
    this.scene.add(lamps);
    this.haloMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: 0xffc98a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.Mesh(haloGeometry(), this.haloMat);
    halo.name = 'BakeryLampGlow';
    halo.renderOrder = 1;
    this.scene.add(halo);

    // 店招＋營業牌：一張 canvas 圖集（機器名牌 2026-09-24 移到 HUD 標籤）
    this.labels = new LabelAtlas();
    this.scene.add(this.labels.mesh);
    this.openSign = this.labels.open;
    this.closedSign = this.labels.closed;
    this.scene.add(this.openSign, this.closedSign);

    // 甜點杯：杯身＋內容物＋頂飾，三層各一個 InstancedMesh
    const cupGeo = new THREE.CylinderGeometry(CUP_R, CUP_R * 0.78, CUP_H, 16);
    cupGeo.translate(0, CUP_H / 2, 0);
    const fillGeo = new THREE.CylinderGeometry(CUP_R * 0.92, CUP_R * 0.92, 1, 16);
    fillGeo.translate(0, 0.5, 0); // 底在 0：scale.y 就是高度
    this.cups = this.instanced(cupGeo, toon({ color: 0xffffff }), 'BakeryCups');
    this.fills = this.instanced(fillGeo, toon({ color: 0xffffff }), 'BakeryFills');
    this.tops = this.instanced(swirlGeometry(), toon({ color: 0xffffff }), 'BakeryTops');

    // 蛋殼：半球兩片一組（上半＋下半），打蛋時分開
    const shell = new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    shell.scale(1, 1.3, 1);
    this.eggs = new THREE.InstancedMesh(shell, toon({ color: PAL.egg, side: THREE.DoubleSide }), 4);
    this.eggs.name = 'BakeryEggs';
    this.eggs.frustumCulled = false;
    this.scene.add(this.eggs);

    // 攪拌頭（三圈打蛋器）：吊在攪拌機的機頭下面
    const w = new Parts();
    w.cyl(PAL.metal, 0.012, 0.012, 0.18, 0, 0.09, 0, 8);
    for (let i = 0; i < 3; i++) w.torus(PAL.metal, 0.042, 0.006, 0, -0.02, 0, { x: 0, y: (i * Math.PI) / 3, z: 0 });
    this.whisk = this.part(w, 'BakeryWhisk');

    const nz = new Parts();
    nz.rbox(PAL.butterDark, 0.09, 0.08, 0.09, 0, 0.06, 0, 0.02);
    nz.cone(PAL.metal, 0.028, 0.06, 0, -0.01, 0, 12, { x: Math.PI, y: 0, z: 0 });
    this.nozzle = this.part(nz, 'BakeryNozzle');

    const bg = new Parts();
    bg.cone(PAL.cream, 0.05, 0.16, 0, 0, 0, 16, { x: Math.PI, y: 0, z: 0 });
    bg.cone(PAL.metal, 0.014, 0.03, 0, -0.09, 0, 8, { x: Math.PI, y: 0, z: 0 });
    bg.sphere(PAL.pink, 0.02, 0, 0.09, 0);
    this.bag = this.part(bg, 'BakeryPipingBag');

    const lid = new Parts();
    lid.cyl(PAL.mintDark, 0.082, 0.082, 0.02, 0, 0, 0, 18);
    lid.sphere(PAL.cream, 0.018, 0, 0.02, 0);
    this.potLid = this.part(lid, 'BakeryPotLid');

    // 客人：圓滾滾的小兔（身體＋耳朵＋尾巴一顆幾何，眼睛另一顆），顏色走 instance
    const cb = new Parts();
    cb.sphere(0xffffff, 0.11, 0, 0.12, 0, { x: 1, y: 1.05, z: 1 });
    cb.add(new THREE.CapsuleGeometry(0.028, 0.1, 4, 10), 0xffffff, { x: -0.045, y: 0.27, z: -0.01 }, { x: 0, y: 0, z: 0.18 });
    cb.add(new THREE.CapsuleGeometry(0.028, 0.1, 4, 10), 0xffffff, { x: 0.045, y: 0.27, z: -0.01 }, { x: 0, y: 0, z: -0.18 });
    cb.sphere(0xffffff, 0.035, 0, 0.1, -0.11);
    cb.sphere(0xffb3c4, 0.022, -0.06, 0.1, 0.085, { x: 1, y: 0.6, z: 0.5 });
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

    const regMat = toon({ vertexColors: true });
    for (let i = 0; i < MAX_REGULARS_IN; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), regMat);
      m.name = `BakeryRegular${i}`;
      m.visible = false;
      m.scale.setScalar(REGULAR_SCALE);
      this.regularMeshes.push(m);
      this.scene.add(m);
    }

    this.buildHitBoxes();
  }

  private part(p: Parts, name: string): THREE.Mesh {
    const m = new THREE.Mesh(p.merge(), new THREE.MeshToonMaterial({ gradientMap: toonGradient(), toneMapped: false, vertexColors: true }));
    m.name = name;
    m.visible = false;
    this.scene.add(m);
    return m;
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
    for (const id of ['stove', 'crack', 'mix', 'mold'] as StationId[]) {
      const a = STATION_ANCHOR[id];
      add(id, 0.46, 1.3, 0.8, a.x, 0.65, a.z - 0.2);
    }
    add('bake', OVEN.w + 0.36, 1.1, OVEN.len, OVEN.x - 0.16, 0.55, OVEN.z);
    add('chill', CHILL.len, 1.1, CHILL.w + 0.3, CHILL.x, 0.55, CHILL.z - 0.12);
    const d = STATION_ANCHOR.decorate;
    add('decorate', 0.46, 1.3, 0.9, d.x, 0.65, d.z - 0.2);
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
   * 把房間的 8 個角投影到螢幕，逐步拉遠直到「寬在 ±1 內、高在可見段的比例內」（2026-09-23 截圖定案的做法）。
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

  /**
   * 各站底座牌那一點（機器正前方的輸送帶側板）投到畫面上的位置（NDC，x/y 在 −1〜1）；HUD 的站標籤貼在這裡。
   * 工坊鏡頭是固定的，main.ts 只在 resize／HUD 偏移變了之後重算一次。
   */
  stationNdc(): Record<StationId, { x: number; y: number }> {
    this.camera.updateMatrixWorld();
    const out = {} as Record<StationId, { x: number; y: number }>;
    const v = new THREE.Vector3();
    for (const id of STATION_IDS) {
      const p = STATION_PLATE[id];
      v.set(p.x, p.y, p.z).project(this.camera);
      out[id] = { x: v.x, y: v.y };
    }
    return out;
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

  /** 常客來店（`regularVisit` 事件；main.ts 只在玩家正在看工坊時轉進來，離線的不演） */
  regularCame(id: RegularId, bought: boolean, dessert: SpeciesId | null) {
    if (this.regulars.some((r) => r.id === id)) return;
    this.regulars.push({ id, bought, dessert, x: DOOR.x, z: DOOR.z, tx: 0, phase: 'queue', t: 0, hop: Math.random() * 6 });
  }

  /** 店裡（不含門外排隊）有幾位常客（測試用） */
  get regularCount(): number {
    return this.regulars.filter((r) => r.phase !== 'queue').length;
  }

  /** 店裡常客的頭頂在畫面上的位置（名字泡泡用；會走動所以每幀投影） */
  regularAnchors(): RegularAnchor[] {
    const v = new THREE.Vector3();
    const out: RegularAnchor[] = [];
    for (const r of this.regulars) {
      if (r.phase === 'queue') continue;
      v.set(r.x, 2.35 * REGULAR_SCALE, r.z).project(this.camera);
      out.push({ id: r.id, ndc: { x: v.x, y: v.y }, mood: r.phase === 'in' ? 'walk' : r.bought ? 'happy' : 'sad' });
    }
    return out;
  }

  sync(state: GameState, dt: number) {
    this.time += dt;
    const t = this.time;
    this.nItems = 0;
    this.nTops = 0;

    this.syncMachines(state);
    this.syncDaylight(state);
    this.detectRides(state);

    // 帶面：線上有東西才走（停著的帶子＝閒著，一眼看得出來）
    if (batchesOnLine(state) > 0 || this.rides.length > 0) this.beltTex.offset.x -= (dt * BELT_SPEED) / STRIPE;

    const st = state.bakery.stations;
    const riding = new Set(this.rides.map((r) => r.to));
    const shown = (id: StationId) => (riding.has(id) ? null : st[id].batch);
    const working = (id: StationId) => stationStatus(state, id) === 'working' && !riding.has(id);
    const own = state.bakery.machines;

    // ── 每一站上的那一盤 ──
    for (const id of STATION_IDS) {
      const b = shown(id);
      if (!b) continue;
      const a = STATION_ANCHOR[id];
      this.putBatch(a.x, a.z, pathPoint(STATION_AT[id]).dir, b, id, stationProgress(state, id));
    }

    // 爐台：鍋蓋在加熱時跳
    this.potLid.visible = own.stove > 0;
    const sa = STATION_ANCHOR.stove;
    this.potLid.position.set(sa.x - 0.09, 0.85 + (working('stove') ? Math.abs(Math.sin(t * 9)) * 0.025 : 0), sa.z - 0.36);

    // 打蛋：臂上一顆蛋落下、裂成兩半
    this.eggs.count = 0;
    if (own.crack > 0 && shown('crack')) this.drawEgg(working('crack') ? (t * 0.9) % 1 : 0.2);

    // 攪拌：打蛋器降進碗裡轉
    this.whisk.visible = own.mix > 0;
    const ma = STATION_ANCHOR.mix;
    this.whisk.position.set(ma.x, BELT.y + (shown('mix') ? 0.08 : 0.24), ma.z);
    if (working('mix')) this.whisk.rotation.y = t * 18;

    // 裝模：注模嘴沿門架在杯子之間來回
    this.nozzle.visible = own.mold > 0;
    const mo = STATION_ANCHOR.mold;
    const moldB = shown('mold');
    if (moldB && working('mold')) {
      const n = cupsFor(moldB.qty);
      const k = stationProgress(state, 'mold');
      const which = Math.min(n - 1, Math.floor(k * n));
      this.nozzle.position.x = mo.x + cupPos(which, n)[0] + Math.sin(t * 12) * 0.008;
    } else {
      this.nozzle.position.x = lerp(this.nozzle.position.x || mo.x, mo.x, 0.1);
    }
    this.nozzle.position.set(this.nozzle.position.x, BELT.y + 0.3 + (working('mold') ? Math.abs(Math.sin(t * 6)) * 0.02 : 0), mo.z);

    // 烤箱：隧道裡發橘光（脈動）；冷藏櫃：冷光一閃一閃
    const bakePulse = working('bake') ? 0.75 + Math.sin(t * 5) * 0.25 : shown('bake') ? 0.45 : 0;
    this.glowMat.color.set(0x6d5b86).lerp(new THREE.Color(0xffb04d), bakePulse);
    const chillPulse = working('chill') ? 0.6 + Math.sin(t * 3) * 0.4 : 0;
    this.chillMat.color.set(0xdff4ff).lerp(new THREE.Color(0x8fd3ff), chillPulse);

    // 裝飾：擠花袋下壓
    this.bag.visible = own.decorate > 0;
    const da = STATION_ANCHOR.decorate;
    this.bag.position.set(da.x, BELT.y + 0.42 - (working('decorate') ? Math.abs(Math.sin(t * 5)) * 0.06 : 0), da.z);

    // ── 帶子上滑動中的盤子、跳進成品櫃的甜點 ──
    this.rides = this.rides.filter((r) => r.t < 1);
    for (const r of this.rides) {
      r.t = Math.min(1, r.t + dt / r.dur);
      const p = pathPoint(lerp(r.from, r.dest, ease(r.t)));
      this.putBatch(p.x, p.z, p.dir, r.batch, r.after, 1);
      if (r.t >= 1 && r.to === null) {
        // D60：一整盤一杯接一杯跳進成品櫃（每杯落到自己的格子，最後一杯落在最新的那格）
        const total = totalStock(state, 'desserts');
        const n = Math.min(MAX_HOPS, r.batch.qty);
        for (let i = 0; i < n; i++) {
          const slot = RACK_SLOTS[Math.max(0, Math.min(total - n + i, RACK_SLOTS.length - 1))]!;
          const [along, across] = cupPos(i, n);
          const cx = Math.cos(p.dir) * along - Math.sin(p.dir) * across;
          const cz = Math.sin(p.dir) * along + Math.cos(p.dir) * across;
          this.hops.push({ from: { x: p.x + cx, y: BELT.y, z: p.z + cz }, dest: slot, t: -i * HOP_GAP / 0.5, species: r.batch.species });
        }
      }
    }
    this.hops = this.hops.filter((h) => h.t < 1);
    for (const h of this.hops) {
      h.t = Math.min(1, h.t + dt / 0.5);
      if (h.t < 0) continue;
      const k = ease(h.t);
      this.putItem(lerp(h.from.x, h.dest.x, k), lerp(h.from.y, h.dest.y, k) + Math.sin(Math.PI * h.t) * 0.3, lerp(h.from.z, h.dest.z, k), h.species, 0, 1, 1.35, 1, 0);
    }

    // ── 成品櫃與展示架 ──
    let k = 0;
    for (const id of SPECIES_IDS) {
      for (let i = 0, n = stockOf(state, 'desserts', id); i < n && k < RACK_SLOTS.length; i++, k++) {
        const s = RACK_SLOTS[k]!;
        this.putItem(s.x, s.y, s.z, id, k, 1, 1.35, 1, 0);
      }
    }
    k = 0;
    for (const id of SPECIES_IDS) {
      for (let i = 0, n = stockOf(state, 'shelf', id); i < n && k < SHELF_SLOTS.length; i++, k++) {
        const s = SHELF_SLOTS[k]!;
        this.putItem(s.x, s.y, s.z, id, k, 1, 1.35, 1, Math.sin(t * 1.3 + k) * 0.15);
      }
    }

    this.syncCustomers(dt);
    this.syncRegulars(dt);

    for (const m of [this.cups, this.fills, this.tops]) {
      m.count = m === this.tops ? this.nTops : this.nItems;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.eggs.instanceMatrix.needsUpdate = true;
  }

  /** 機身：機器等級變了（買了／升級）才重建 */
  private syncMachines(state: GameState) {
    const sig = machinesSignature(state.bakery.machines);
    if (sig === this.machineSig) return;
    this.machineSig = sig;
    this.machines.geometry.dispose();
    this.machines.geometry = buildMachines(state.bakery.machines);
    for (const o of this.ovenParts) o.visible = state.bakery.machines.bake > 0;
    for (const o of this.chillParts) o.visible = state.bakery.machines.chill > 0;
  }

  /**
   * 晝夜：窗景白天藍、晚上深藍；天黑燈就開（2026-09-24 使用者：「甜點店應該要開燈」——
   * 原本 19 點後整間暗到一半，營業到 21 點客人卻在暗店裡買東西）。
   * 燈一路亮到天亮：打烊後線上的機器照樣在做（離線也算），打烊靠門口的 CLOSED 牌表示，不靠關燈。
   * 室內亮度維持接近白天、色溫轉暖；「是晚上」由窗外深藍與壁燈光暈講。
   */
  private syncDaylight(state: GameState) {
    const c = dayClock(state);
    const night = c.hour < 6 || c.hour >= 19 ? 1 : c.hour >= 17 ? (c.hour - 17) / 2 : c.hour < 7 ? 1 - (c.hour - 6) : 0;
    this.lampLevel = night;
    this.hemi.intensity = lerp(1.9, 1.7, night);
    this.hemi.color.set(0xfffaf2).lerp(WARM_SKY, night);
    this.sun.intensity = lerp(1.3, 1.0, night);
    this.sun.color.set(0xfff0dc).lerp(WARM_SUN, night);
    this.windowMat.color.set(0xbfe6ff).lerp(new THREE.Color(0x2c3566), night);
    this.lampMat.color.set(LAMP_OFF).lerp(LAMP_ON, night);
    this.haloMat.opacity = 0.42 * night;
    this.openSign.visible = c.open;
    this.closedSign.visible = !c.open;
  }

  /**
   * 比對上一幀各站的那一盤：新出現的就從它路線上的上一站（或帶子起點）沿帶子滑過來；
   * 最後一站的那一盤不見了、成品櫃變多了＝出爐，滑到出口再跳進成品櫃。
   */
  private detectRides(state: GameState) {
    const st = state.bakery.stations;
    const first = this.prevDesserts < 0;
    for (const id of STATION_IDS) {
      const b = st[id].batch;
      const key = b ? `${b.species}:${b.qty}:${st[id].doneAt}` : '';
      if (key && key !== this.prev[id] && !first) {
        const route = RECIPES[b!.species].route;
        const before = route[route.indexOf(id) - 1];
        const from = before ? STATION_AT[before] : Math.max(0, STATION_AT[id] - 0.4);
        const dist = STATION_AT[id] - from;
        this.rides.push({ batch: b!, to: id, from, dest: STATION_AT[id], t: 0, dur: Math.max(0.35, dist / BELT_SPEED), after: before ?? id });
      }
      this.prev[id] = key;
    }
    const total = totalStock(state, 'desserts');
    if (!first && total > this.prevDesserts) {
      // 哪一站剛做完最後一步：上一幀有盤、這一幀空了、而且那是它路線的最後一站
      const done = STATION_IDS.find((id) => {
        const pb = this.prevBatch[id];
        if (!pb || st[id].batch) return false;
        const route = RECIPES[pb.species].route;
        return route[route.length - 1] === id;
      });
      if (done) {
        const pb = this.prevBatch[done]!;
        const dist = BELT_LENGTH - STATION_AT[done];
        this.rides.push({ batch: pb, to: null, from: STATION_AT[done], dest: BELT_LENGTH, t: 0, dur: Math.max(0.35, dist / BELT_SPEED), after: done });
      }
    }
    for (const id of STATION_IDS) this.prevBatch[id] = st[id].batch ? { ...st[id].batch! } : null;
    this.prevDesserts = total;
  }

  /**
   * 畫一盤：裝模之前是一只攪拌碗（碗裡的麵糊由奶油色轉成物種色）；裝模之後一杯一杯排在帶子上，
   * 烤過會膨起來、裝飾過頂上有奶油。`at`＝這一盤現在在（或剛離開）哪一站、`k`＝那一站的進度。
   */
  private putBatch(x: number, z: number, dir: number, b: Batch, at: StationId, k: number) {
    const idx = STATION_IDS.indexOf(at);
    const info = SPECIES[b.species];
    if (idx < MOLD_IDX) {
      // 攪拌碗隨份數變大（D60：一次做一批要看得出來）；上限 ×1.4，再大就壓到帶子外面了
      const mixK = at === 'mix' ? k : idx > STATION_IDS.indexOf('mix') ? 1 : 0;
      const bowl = 2.3 * Math.min(1.4, 0.85 + 0.15 * Math.sqrt(b.qty));
      this.putItem(x, BELT.y, z, b.species, 3, 0.7, 1, 0, 0, bowl, this.color.set(0xffe6a0).lerp(new THREE.Color(info.bodyColor), mixK).getHex());
      return;
    }
    const route = RECIPES[b.species].route;
    const passed = (s: StationId) => route.includes(s) && (idx > STATION_IDS.indexOf(s) || (at === s && k >= 1));
    const fill = at === 'mold' ? 0.15 + k * 0.85 : 1;
    const rise = at === 'bake' ? 1 + ease(k) * 0.35 : idx > BAKE_IDX && route.includes('bake') ? 1.35 : 1;
    const top = at === 'decorate' ? Math.min(1, k * 1.15) : passed('decorate') ? 1 : 0;
    const n = cupsFor(b.qty);
    const cx = Math.cos(dir);
    const cz = Math.sin(dir);
    const sc = cupScale(n);
    for (let i = 0; i < n; i++) {
      const [along, across] = cupPos(i, n);
      this.putItem(x + cx * along - cz * across, BELT.y, z + cz * along + cx * across, b.species, i, fill, rise, top, 0, sc);
    }
  }

  /** 一杯甜點：杯（粉彩）＋內容物（物種色，高度＝fill×rise）＋奶油頂（頂料色，大小＝top） */
  private putItem(x: number, y: number, z: number, species: SpeciesId, idx: number, fill: number, rise: number, top: number, rotY: number, scale = 1, fillHex?: number) {
    if (this.nItems >= MAX_ITEMS) {
      if (!this.warnedFull) console.error(`[bakery] 杯子超過 ${MAX_ITEMS} 個，後面的沒畫出來`);
      this.warnedFull = true;
      return;
    }
    const i = this.nItems++;
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(0, rotY, 0);
    d.scale.set(scale, scale * 0.8 + 0.2, scale);
    d.updateMatrix();
    this.cups.setMatrixAt(i, d.matrix);
    this.cups.setColorAt(i, this.color.set(scale > 1 ? PAL.metal : CUP_COLORS[idx % CUP_COLORS.length]!));

    const info = SPECIES[species];
    // 縮小的杯子（一盤排不下，D60）內容物與奶油頂跟著縮，不然會冒出杯口
    const small = Math.min(1, scale);
    const h = Math.max(0.004, CUP_H * 0.85 * fill * rise * Math.min(1, scale * 0.8 + 0.2));
    d.position.set(x, y + 0.006, z);
    d.scale.set(scale, h, scale);
    d.updateMatrix();
    this.fills.setMatrixAt(i, d.matrix);
    this.fills.setColorAt(i, this.color.set(fillHex ?? info.bodyColor));

    if (top <= 0.01) return;
    const s = top * small;
    const j = this.nTops++;
    d.position.set(x, y + 0.006 + h, z);
    d.scale.set(s, s, s);
    d.updateMatrix();
    this.tops.setMatrixAt(j, d.matrix);
    this.tops.setColorAt(j, this.color.set(info.toppingColor).lerp(new THREE.Color(0xffffff), 0.35));
  }

  /** 打蛋動畫的一格：phase 0–0.55 蛋從臂上落到碗口，0.55–1 裂成兩半往兩邊倒 */
  private drawEgg(phase: number) {
    const a = STATION_ANCHOR.crack;
    const fall = Math.min(1, phase / 0.55);
    const y = lerp(0.96, BELT.y + 0.12, ease(fall));
    const open = phase < 0.55 ? 0 : (phase - 0.55) / 0.45;
    const d = this.dummy;
    const spread = open * 0.06;
    const tilt = open * 1.2;
    d.position.set(a.x - spread, y, a.z);
    d.rotation.set(0, 0, tilt);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    this.eggs.setMatrixAt(this.eggs.count++, d.matrix);
    d.position.set(a.x + spread, y, a.z);
    d.rotation.set(Math.PI, 0, -tilt);
    d.updateMatrix();
    this.eggs.setMatrixAt(this.eggs.count++, d.matrix);
  }

  private syncRegulars(dt: number) {
    const speed = 0.8;
    // 門外排隊的：店裡少於 2 位、而且前一位已經走進來一段（同時進門會整個疊在一起）才放進來；
    // 放進來的時候才決定站哪一格（避開另一位已經佔的那格）
    for (const r of this.regulars) {
      if (r.phase !== 'queue' || this.regularCount >= MAX_REGULARS_IN) continue;
      const inside = this.regulars.filter((q) => q.phase !== 'queue');
      if (inside.some((q) => q.phase === 'in' && q.t < 1.1)) break;
      const taken = new Set(inside.map((q) => q.tx));
      const slot = REGULAR_SLOTS.map((i) => SHELF_SLOTS[i]!.x).find((x) => !taken.has(x)) ?? SHELF_SLOTS[REGULAR_SLOTS[0]!]!.x;
      r.tx = slot;
      r.phase = 'in';
      r.t = 0;
    }
    let n = 0;
    for (const r of this.regulars) {
      if (r.phase === 'queue') continue;
      r.t += dt;
      r.hop += dt * 8;
      let face = 0;
      if (r.phase === 'in') {
        const tz = QUEUE_Z;
        if (Math.abs(r.z - tz) > 0.01) r.z += Math.sign(tz - r.z) * Math.min(Math.abs(tz - r.z), speed * dt);
        else r.x += Math.sign(r.tx - r.x) * Math.min(Math.abs(r.tx - r.x), speed * dt);
        face = Math.atan2(r.tx - r.x, tz - r.z);
        if (Math.abs(r.x - r.tx) < 0.01 && Math.abs(r.z - tz) < 0.01) {
          r.phase = 'pick';
          r.t = 0;
        }
      } else if (r.phase === 'pick') {
        // 常客會多待一下、而且轉過來面向玩家（散客面向展示櫃，玩家只看得到背影）：買到的開心跳、沒買到的搖頭
        face = 0;
        if (r.t > 1.8) {
          r.phase = 'out';
          r.t = 0;
        }
      } else {
        r.x += Math.sign(DOOR.x + 0.4 - r.x) * Math.min(Math.abs(DOOR.x + 0.4 - r.x), speed * dt);
        r.z += Math.sign(DOOR.z - r.z) * Math.min(Math.abs(DOOR.z - r.z), speed * dt);
        face = Math.PI / 2;
      }
      const m = this.regularMeshes[n++]!;
      const geo = regularGeometry(r.id);
      if (m.geometry !== geo) m.geometry = geo;
      const moving = r.phase !== 'pick';
      const y = moving ? Math.abs(Math.sin(r.hop)) * 0.04 : r.bought ? Math.abs(Math.sin(r.t * 9)) * 0.07 : 0;
      const sad = !r.bought && r.phase === 'pick';
      m.position.set(r.x, y, r.z);
      m.rotation.set(sad ? 0.18 : 0, face + (sad ? Math.sin(r.t * 14) * 0.3 : 0), 0);
      m.visible = true;
      if (r.bought && r.dessert && r.phase !== 'in') this.putItem(r.x, y + 0.5, r.z, r.dessert, 200 + n, 1, 1.35, 1, 0);
    }
    for (let i = n; i < this.regularMeshes.length; i++) this.regularMeshes[i]!.visible = false;
    this.regulars = this.regulars.filter((r) => !(r.phase === 'out' && Math.abs(r.x - (DOOR.x + 0.4)) < 0.02 && Math.abs(r.z - DOOR.z) < 0.02));
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

function emptyKeys(): Record<StationId, string> {
  const out = {} as Record<StationId, string>;
  for (const id of STATION_IDS) out[id] = '';
  return out;
}
function emptyBatches(): Record<StationId, Batch | null> {
  const out = {} as Record<StationId, Batch | null>;
  for (const id of STATION_IDS) out[id] = null;
  return out;
}

/**
 * 壁燈燈罩＋燈泡、展示櫃頂的燈條：頂點色、`MeshBasicMaterial`（不吃光照，開燈時就是原色＝讀得出「在發光」）。
 * 壁燈的木頭托架是靜態的，在 room.ts。
 */
function lampGeometry(): THREE.BufferGeometry {
  const p = new Parts();
  for (const l of WALL_LAMPS) {
    const x = l.x + l.nx * 0.11;
    // 倒扣的燈罩（上窄下寬）＋底下露出一顆燈泡
    p.cone(0xffdc9a, 0.085, 0.1, x, l.y + 0.02, l.z, 18);
    p.sphere(0xfffbe8, 0.04, x, l.y - 0.04, l.z);
  }
  // 展示櫃：玻璃頂後緣一條燈條（俯視看得到的「櫥窗亮著」）
  const { x, z, w, d, baseH, glassH } = SHOWCASE;
  p.box(0xfff4d0, w - 0.1, 0.02, 0.04, x, baseH + glassH - 0.01, z - d / 2 + 0.05);
  return p.merge();
}

/** 光暈：側牆上壁燈後面一圈、地上三個光圈；同一張放射漸層貼圖、一個 mesh */
function haloGeometry(): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (const l of WALL_LAMPS) {
    const g = new THREE.PlaneGeometry(0.9, 0.9);
    g.rotateY(l.nx > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(l.x + l.nx * 0.012, l.y - 0.05, l.z);
    list.push(g);
  }
  for (const f of FLOOR_POOLS) {
    const g = new THREE.PlaneGeometry(f.r * 2, f.r * 2);
    g.rotateX(-Math.PI / 2);
    g.translate(f.x, 0.004, f.z);
    list.push(g);
  }
  // 展示櫃裡的光：櫃內地板一片
  const g = new THREE.PlaneGeometry(SHOWCASE.w * 1.1, SHOWCASE.d * 1.6);
  g.rotateX(-Math.PI / 2);
  g.translate(SHOWCASE.x, SHOWCASE.baseH + 0.018, SHOWCASE.z);
  list.push(g);
  const out = mergeGeometries(list, false);
  if (!out) throw new Error('[lpg] halo merge failed');
  return out;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 一盤畫幾杯：幾份就畫幾杯（D60：一次做一批要看得到整批；份數上限 20） */
function cupsFor(qty: number): number {
  return Math.max(1, Math.min(MAX_MACHINE_LEVEL, qty));
}

/**
 * 一盤杯子怎麼排：4 杯以內一排；8 杯以內兩排；再多三排。
 * 一站能用的地方沿行進方向約 0.44（站距 0.5）、橫向約 0.32（帶寬 0.34），排不下就把杯子縮小。
 */
function trayGrid(n: number): { rows: number; cols: number; along: number; across: number } {
  const rows = n <= 4 ? 1 : n <= 8 ? 2 : 3;
  const cols = Math.ceil(n / rows);
  return { rows, cols, along: Math.min(0.11, 0.44 / cols), across: Math.min(0.105, 0.3 / rows) };
}

/** 第 i 杯的位移：[沿行進方向, 橫向]，整盤置中 */
function cupPos(i: number, n: number): [number, number] {
  const g = trayGrid(n);
  const col = i % g.cols;
  const row = Math.floor(i / g.cols);
  return [(col - (g.cols - 1) / 2) * g.along, (row - (g.rows - 1) / 2) * g.across];
}

/** 杯子縮放：排得下原尺寸就 1 */
function cupScale(n: number): number {
  const g = trayGrid(n);
  return Math.min(1, g.along / 0.11, g.across / 0.105);
}

/** 帶面條紋：淺灰底＋深一點的橫條，重複鋪 */
function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a8196';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#a79fb3';
  g.fillRect(0, 0, 40, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * 帶面幾何：每一段一條平面，u 座標＝沿線距離 / 條紋間距（跨段連續），所以貼圖 offset 一捲，
 * 整條 U 型上的條紋都朝行進方向走。轉角的圓盤不捲（靜態的在 room.ts）。
 */
function beltSurface(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let d0 = 0;
  for (let i = 0; i < BELT_PATH.length - 1; i++) {
    const a = BELT_PATH[i]!;
    const b = BELT_PATH[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const g = new THREE.PlaneGeometry(len, BELT.w - 0.04);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (d0 + uv.getX(k) * len) / STRIPE);
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
    g.translate((a.x + b.x) / 2, BELT.y - 0.008, (a.z + b.z) / 2);
    parts.push(g.toNonIndexed());
    d0 += len;
  }
  const out = mergeGeometries(parts, false);
  if (!out) throw new Error('[lpg] belt merge failed');
  return out;
}

/** 擠花奶油：三層由大到小的圓環疊成的螺旋頂＋一顆小點綴 */
function swirlGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry) => parts.push(g.index ? g.toNonIndexed() : g);
  for (let i = 0; i < 3; i++) {
    const r = 0.042 - i * 0.012;
    // 6×14 段（原本 8×20）：杯子只有畫面上十幾 px，一盤 20 份時這一個頂就是面數大宗（D60 實測）
    const g = new THREE.TorusGeometry(r, 0.015 - i * 0.002, 6, 14);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.012 + i * 0.018, 0);
    add(g);
  }
  const tip = new THREE.ConeGeometry(0.013, 0.028, 10);
  tip.translate(0, 0.064, 0);
  add(tip);
  for (const g of parts) g.deleteAttribute('uv');
  const out = mergeGeometries(parts, false);
  if (!out) throw new Error('[lpg] swirl merge failed');
  return out;
}

/**
 * 店招＋營業牌畫在同一張 canvas 上（每塊平面的 UV 對到自己那一列）。前七列是 2026-09-24 以前的機器名牌，已不貼到場景上。
 * 沒買的站畫灰底「○○・未購買」，買了畫白底「○○ Lv.N」；等級變了重畫同一張 canvas（不換 mesh）。
 * OPEN／CLOSED 牌也在同一張圖上，但各自一個小 mesh 才能切換顯示。
 */
class LabelAtlas {
  readonly mesh: THREE.Mesh;
  readonly open: THREE.Mesh;
  readonly closed: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: THREE.CanvasTexture;
  private static readonly W = 512;
  /** 列高：跟機器名牌 0.46×0.13 同比例（3.5:1），字才不會被壓扁 */
  private static readonly RH = 146;
  private static readonly ROWS = STATION_IDS.length + 3;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LabelAtlas.W;
    this.canvas.height = LabelAtlas.RH * LabelAtlas.ROWS;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true });

    const rows = LabelAtlas.ROWS;
    const plate = (row: number, w: number, h: number, x: number, y: number, z: number, rotY = 0) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      const v0 = 1 - (row + 1) / rows;
      const v1 = 1 - row / rows;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
      geo.rotateY(rotY);
      geo.translate(x, y, z);
      return geo;
    };
    // 機器名牌拿掉了（2026-09-24 使用者：名稱與等級改寫在機器頭上的 HUD 標籤）；圖集前七列留著不畫上去，列號不必重排
    const parts = [plate(STATION_IDS.length, 1.2, 0.3, 0, 1.92, ROOM.backZ + 0.02)];
    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error('[lpg] label merge failed');
    this.mesh = new THREE.Mesh(merged, mat);
    this.mesh.name = 'BakeryLabels';
    this.mesh.renderOrder = 3;

    const signAt = { x: ROOM.halfW - 0.02, y: 1.2, z: ROOM.backZ + 2.9 + 0.25 };
    this.open = new THREE.Mesh(plate(STATION_IDS.length + 1, 0.34, 0.085, 0, 0, 0, -Math.PI / 2 + 0.6), mat);
    this.closed = new THREE.Mesh(plate(STATION_IDS.length + 2, 0.34, 0.085, 0, 0, 0, -Math.PI / 2 + 0.6), mat);
    for (const m of [this.open, this.closed]) {
      m.position.set(signAt.x, signAt.y, signAt.z);
      m.renderOrder = 3;
    }
    this.open.name = 'BakeryOpenSign';
    this.closed.name = 'BakeryClosedSign';
    this.draw(Object.fromEntries(STATION_IDS.map((id) => [id, 0])) as Record<StationId, number>);
  }

  draw(levels: Record<StationId, number>) {
    const rows = [
      ...STATION_IDS.map((id) => levels[id] > 0
        ? { text: `${STATIONS[id].name} ${'★'.repeat(levels[id])}`, bg: '#ffffff', fg: '#7a5a6e', edge: '#f5b8c6' }
        : { text: `${STATIONS[id].name} 未購買`, bg: '#ece6ef', fg: '#9a8fa3', edge: '#d6ccdc' }),
      { text: '小布丁甜點店', bg: '#f28aa3', fg: '#ffffff', edge: '#f5b8c6' },
      { text: 'OPEN 營業中', bg: '#6cc58a', fg: '#ffffff', edge: '#f5b8c6' },
      { text: 'CLOSED 打烊', bg: '#7d7394', fg: '#ffffff', edge: '#f5b8c6' },
    ];
    const W = LabelAtlas.W, RH = LabelAtlas.RH;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    rows.forEach((r, i) => {
      const y = i * RH;
      g.fillStyle = r.bg;
      const pad = 6, rad = 36;
      g.beginPath();
      g.roundRect(pad, y + pad, W - pad * 2, RH - pad * 2, rad);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = r.edge;
      g.stroke();
      g.fillStyle = r.fg;
      // 字級盡量大、但不超出牌子（「冷藏櫃 未購買」比「烤箱 ★」長得多）
      let size = 96;
      const font = (px: number) => `bold ${px}px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
      g.font = font(size);
      while (size > 30 && g.measureText(r.text).width > W - 56) g.font = font(--size);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(r.text, W / 2, y + RH / 2 + 2);
    });
    this.tex.needsUpdate = true;
  }
}
