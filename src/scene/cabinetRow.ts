import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CABINET_COLORS,
  CABINET_PITCH,
  TANK,
  UNIT,
  carcassGeometries,
  createGlassMaterial,
  tankFloorY,
  tankGlassGeometries,
} from './cabinet';
import { toonMaterial } from './toon';

// 鄰櫃座位（D15）：左右各三座、緊貼連成一整排，拉到縮放上限也看不到盡頭。
// 不做後列——直立櫃是鏤空的，後面那排會透過玻璃看進來，變成一堆對不上的水平層板。
const SEAT_INDICES = [-3, -2, -1, 1, 2, 3];

type PartKey = 'wood' | 'glass' | 'lock';

/** 一座未解鎖鄰櫃的幾何，已位移到 (x, 0, z)。每層掛一個鎖。 */
function neighbourGeometries(x: number, z: number): Record<PartKey, THREE.BufferGeometry[]> {
  const lock: THREE.BufferGeometry[] = [];
  for (let i = 0; i < UNIT.tanks; i++) {
    const y = tankFloorY(i) + TANK.height * 0.42;
    const body = new THREE.BoxGeometry(0.26, 0.26, 0.07);
    body.translate(0, y, TANK.depth / 2 + 0.05);
    const shackle = new THREE.TorusGeometry(0.065, 0.022, 6, 10);
    shackle.translate(0, y + 0.17, TANK.depth / 2 + 0.06);
    lock.push(body, shackle);
  }

  const parts: Record<PartKey, THREE.BufferGeometry[]> = {
    wood: carcassGeometries(),
    glass: tankGlassGeometries(),
    lock,
  };
  for (const arr of Object.values(parts)) for (const g of arr) g.translate(x, 0, z);
  return parts;
}

/**
 * 尚未解鎖的鄰櫃（v1 純裝飾，不參與模擬）。
 * 八座合併成 3 個 mesh 且一律不投影——陰影 pass 會把 draw call 再乘一次。
 */
/**
 * @param unlockedSeats 已解鎖的座位編號——這些座位不放在合併的裝飾列裡，
 *   改由 main 用完整的 `CabinetView` 蓋一座真的櫃子（有地板、名牌、可進去住）。
 */
export function createCabinetRow(unlockedSeats: readonly number[] = []): THREE.Group {
  const g = new THREE.Group();
  g.name = 'CabinetRow';

  const buckets: Record<PartKey, THREE.BufferGeometry[]> = { wood: [], glass: [], lock: [] };
  const keys = Object.keys(buckets) as PartKey[];
  for (const n of SEAT_INDICES) {
    if (unlockedSeats.includes(n)) continue;
    const parts = neighbourGeometries(CABINET_PITCH * n, 0);
    for (const key of keys) buckets[key].push(...parts[key]);
  }
  if (buckets.wood.length === 0) return g;

  const add = (name: string, geos: THREE.BufferGeometry[], material: THREE.Material, renderOrder = 0) => {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = renderOrder;
    g.add(mesh);
  };

  add('NeighbourWood', buckets.wood, toonMaterial(CABINET_COLORS.neighbourWood));
  add('NeighbourLock', buckets.lock, toonMaterial(CABINET_COLORS.neighbourLock));
  add('NeighbourGlass', buckets.glass, createGlassMaterial(), 9); // 比主櫃玻璃(10)早畫

  return g;
}
