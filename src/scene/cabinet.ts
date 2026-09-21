import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from './toon';

/**
 * 落地櫃（參考水族箱）：一個直排三層，中層啟用、上下未解鎖（D15/D17）。
 * 直立比例是刻意的——直向手機塞橫向櫃子必然留白，直立櫃才填得滿。
 */
export const TANK = { width: 2.35, height: 1.5, depth: 1.4 } as const;
export const UNIT = {
  tanks: 3,
  divider: 0.13, // 層板厚度，也是頂蓋厚度
  base: 0.45,    // 落地底座
  post: 0.07,    // 四角立柱
  overhang: 0.1, // 層板比玻璃外擴
} as const;

/** 啟用中的那一層（0 = 最下層） */
export const ACTIVE_TANK = 1;

/** 第 i 層玻璃箱的底面高度 */
export function tankFloorY(i: number) {
  return UNIT.base + i * (TANK.height + UNIT.divider);
}

/** 整座櫃子的總高（含頂蓋）與外寬 */
export const UNIT_HEIGHT = tankFloorY(UNIT.tanks - 1) + TANK.height + UNIT.divider;
export const UNIT_WIDTH = TANK.width + UNIT.overhang * 2;
/**
 * 最外緣尺寸（構圖用）。
 * 寬度方向刻意不外擴：底座線腳只往「深度」凸，這樣一整排櫃子每一層高度都對得齊，
 * 左右才會是連續的一面，而不是只有最寬的線腳相接、層板以上留縫。
 */
export const UNIT_OUTER_W = UNIT_WIDTH;
export const UNIT_OUTER_D = TANK.depth + UNIT.overhang * 2 + 0.22;

/**
 * 鄰櫃間距（D15）。取「含底座線腳的最外緣寬度」＝左右緊貼連成一整排；
 * 留任何間隙都會讀成「分開的好幾座」而不是一整面櫃牆。
 */
export const CABINET_PITCH = UNIT_OUTER_W;

/** 布丁可跳的範圍＝啟用層的地板，扣掉貼玻璃的留邊 */
export function floorBounds() {
  const m = 0.3;
  return {
    minX: -TANK.width / 2 + m,
    maxX: TANK.width / 2 - m,
    minZ: -TANK.depth / 2 + m,
    maxZ: TANK.depth / 2 - m,
    y: tankFloorY(ACTIVE_TANK) + 0.02,
  };
}

export const CABINET_COLORS = {
  wood: 0xd9a066,
  frame: 0xf7e6c8,
  floor: 0xfff3df,
  glass: 0xe8f7ff,
  prop: 0xf3b6bd,
  lightBar: 0xfff4d6,
  neighbourWood: 0xb98a5c,
  neighbourFrame: 0xe4d3b8,
  neighbourLock: 0x7d6b55,
} as const;

function box(sx: number, sy: number, sz: number, px: number, py: number, pz: number) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(px, py, pz);
  return g;
}

/** 櫃體骨架：落地底座、每層之間的層板與頂蓋、四角立柱 */
export function carcassGeometries(): THREE.BufferGeometry[] {
  const { width: w, depth: d, height: th } = TANK;
  const ow = w + UNIT.overhang * 2, od = d + UNIT.overhang * 2;
  const out: THREE.BufferGeometry[] = [
    box(ow, UNIT.base, od + 0.14, 0, UNIT.base / 2, 0),          // 落地底座（寬度不外擴，見 UNIT_OUTER_W）
    box(ow, 0.07, od + 0.22, 0, UNIT.base - 0.035, 0),           // 底座上緣線腳
  ];
  for (let i = 0; i < UNIT.tanks; i++) {
    out.push(box(ow, UNIT.divider, od, 0, tankFloorY(i) + th + UNIT.divider / 2, 0)); // 層板／頂蓋
  }
  // 立柱貼齊層板最外緣：相鄰兩座的立柱剛好碰在一起，接縫看起來就是一根共用的柱子
  const px = ow / 2 - UNIT.post / 2, pz = d / 2 + UNIT.post / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(box(UNIT.post, UNIT_HEIGHT - UNIT.base, UNIT.post,
      sx * px, UNIT.base + (UNIT_HEIGHT - UNIT.base) / 2, sz * pz));
  }
  return out;
}

/** 每層的箱內地板 */
export function tankFloorGeometries(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < UNIT.tanks; i++) out.push(box(TANK.width, 0.02, TANK.depth, 0, tankFloorY(i) + 0.01, 0));
  return out;
}

/** 掛在某層正面的鎖（未解鎖的視覺標記，D15） */
export function lockGeometries(i: number): THREE.BufferGeometry[] {
  const y = tankFloorY(i) + TANK.height * 0.45;
  const body = new THREE.BoxGeometry(0.24, 0.24, 0.07);
  body.translate(0, y, TANK.depth / 2 + 0.05);
  const shackle = new THREE.TorusGeometry(0.062, 0.021, 6, 10);
  shackle.translate(0, y + 0.16, TANK.depth / 2 + 0.06);
  return [body, shackle];
}

/** 每層的玻璃箱（三層合併成一個 mesh，只吃一個 draw call） */
export function tankGlassGeometries(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < UNIT.tanks; i++) {
    out.push(box(TANK.width, TANK.height, TANK.depth, 0, tankFloorY(i) + TANK.height / 2, 0));
  }
  return out;
}

// 玻璃（D6）：不用 transmission（每幀多一次全場景 pass），改用 fresnel 調 alpha——
// 正面幾乎全透，掠角處變白，邊緣因 DoubleSide 疊兩層而更亮。
export function createGlassMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: CABINET_COLORS.glass,
    transparent: true,
    opacity: 1, // 實際 alpha 由下面的 fresnel 決定
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  mat.onBeforeCompile = (shader) => {
    const MARK = '#include <normal_fragment_maps>';
    if (!shader.fragmentShader.includes(MARK)) {
      // three 改了 shader chunk 名就會走到這裡。不擋畫面，但一定要吵，
      // 否則玻璃會靜默退回均勻半透明，跟改壞了長得一樣。
      console.error('[lpg] 玻璃 fresnel patch 失敗：找不到 shader chunk', MARK);
      return;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      MARK,
      `${MARK}
      float lpgFresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
      diffuseColor.a = mix(0.085, 0.68, lpgFresnel);`,
    );
  };

  return mat;
}

export interface TankStatus {
  title: string;
  sub: string;
  locked?: boolean;
}

const PLATE = { w: 0.8, h: 0.27, rowPx: 128, widthPx: 384 };

/**
 * 三張名牌畫在同一張 canvas 上（一層一列），三個 quad 各自對到自己那列的 UV。
 * 一張貼圖一個 mesh ＝ 一個 draw call；一層一張貼圖會變成三個。
 */
function createPlates(statuses: TankStatus[]): THREE.Mesh {
  const rows = UNIT.tanks;
  const canvas = document.createElement('canvas');
  canvas.width = PLATE.widthPx;
  canvas.height = PLATE.rowPx * rows;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < rows; i++) {
    const st = statuses[i] ?? { title: '', sub: '' };
    // uv.y=0 對到 canvas 底部（貼圖預設 flipY），所以第 i 層要畫在「由下往上」第 i 列
    const top = (rows - 1 - i) * PLATE.rowPx;
    ctx.fillStyle = st.locked ? '#cdbfa8' : '#fff6e2';
    ctx.fillRect(0, top, canvas.width, PLATE.rowPx);
    ctx.strokeStyle = st.locked ? '#9e8f78' : '#d9a066';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, top + 4, canvas.width - 8, PLATE.rowPx - 8);

    ctx.textAlign = 'center';
    ctx.fillStyle = st.locked ? '#6f6253' : '#7a5533';
    ctx.font = '600 46px "Microsoft JhengHei", system-ui, sans-serif';
    ctx.fillText(st.title, canvas.width / 2, top + 56);
    ctx.font = '400 34px "Microsoft JhengHei", system-ui, sans-serif';
    ctx.fillText(st.sub, canvas.width / 2, top + 101);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const quads: THREE.BufferGeometry[] = [];
  for (let i = 0; i < rows; i++) {
    const q = new THREE.PlaneGeometry(PLATE.w, PLATE.h);
    const uv = q.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setY(k, (i + uv.getY(k)) / rows);
    uv.needsUpdate = true;
    // 右下角（使用者指定）：貼在該層玻璃正面外側
    q.translate(TANK.width / 2 - PLATE.w / 2 - 0.09, tankFloorY(i) + 0.21, TANK.depth / 2 + 0.03);
    quads.push(q);
  }

  const mesh = new THREE.Mesh(mergeGeometries(quads), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.name = 'TankPlates';
  mesh.renderOrder = 11; // 要蓋在玻璃(10)之上，否則會被半透明玻璃洗淡
  return mesh;
}

/** 主櫃（鏡頭初始 zoom in 的那一座，D15） */
export function createCabinet(statuses: TankStatus[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Cabinet';

  const carcass = new THREE.Mesh(mergeGeometries(carcassGeometries()), toonMaterial(CABINET_COLORS.wood));
  carcass.castShadow = true;
  carcass.receiveShadow = true;
  g.add(carcass);

  const floors = new THREE.Mesh(mergeGeometries(tankFloorGeometries()), toonMaterial(CABINET_COLORS.floor));
  floors.receiveShadow = true;
  g.add(floors);

  const glass = new THREE.Mesh(mergeGeometries(tankGlassGeometries()), createGlassMaterial());
  glass.renderOrder = 10; // 透明物最後畫
  g.add(glass);

  // 每層頂部一條燈條：MeshBasicMaterial 不吃光照，才讀得出「這是燈」
  const bars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < UNIT.tanks; i++) {
    bars.push(box(TANK.width - 0.3, 0.03, 0.07, 0, tankFloorY(i) + TANK.height - 0.05, TANK.depth / 2 - 0.1));
  }
  g.add(new THREE.Mesh(mergeGeometries(bars), new THREE.MeshBasicMaterial({ color: CABINET_COLORS.lightBar })));

  // 主櫃自己未解鎖的層也要掛鎖：名牌寫「未解鎖」但沒有鎖，讀起來只像空層板
  const locks = statuses.flatMap((st, i) => (st.locked ? lockGeometries(i) : []));
  if (locks.length) {
    const lockMesh = new THREE.Mesh(mergeGeometries(locks), toonMaterial(CABINET_COLORS.neighbourLock));
    lockMesh.name = 'TankLocks';
    lockMesh.castShadow = false;
    g.add(lockMesh);
  }

  g.add(createPlates(statuses));

  return g;
}
