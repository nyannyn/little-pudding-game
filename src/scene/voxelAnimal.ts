import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RegularId } from '../game/regulars';
import { REGULAR_LOOKS, animalBoxes, type Box } from './regularLooks';

/**
 * 方塊動物產生器（D69）：一堆方塊併成**一顆** geometry（頂點色）＝一位常客 1 個 draw call。
 * 每個方塊一個 mesh 的話一位就是 20 幾個 draw call（AC11-11 的負向對照）。
 * 之後 CP12 小鎮的居民也走這一支。
 */
export function voxelGeometry(boxes: readonly Box[]): THREE.BufferGeometry {
  const col = new THREE.Color();
  const geos = boxes.map(([w, h, d, x, y, z, c]) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    col.set(c);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('voxelGeometry：方塊合併失敗');
  return merged;
}

const cache = new Map<RegularId, THREE.BufferGeometry>();

/** 某位常客的 geometry（建一次、之後共用） */
export function regularGeometry(id: RegularId): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    g = voxelGeometry(animalBoxes(REGULAR_LOOKS[id]));
    cache.set(id, g);
  }
  return g;
}
