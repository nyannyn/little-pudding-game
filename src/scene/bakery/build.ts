import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * 頂點色拼裝工具（D46 同一套做法）：每一塊幾何把顏色寫進頂點，最後併成**一個** mesh、
 * 一個材質、一個 draw call。工坊的房間與五台機器的機身全部走這裡。
 *
 * 所有幾何先轉 non-indexed 再併：RoundedBox 與內建幾何的 index 形狀不一，`mergeGeometries`
 * 遇到「有的有 index、有的沒有」會直接回 null。
 */
export class Parts {
  private readonly list: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, hex: number, at: THREE.Vector3Like, rot?: THREE.Vector3Like, scale?: THREE.Vector3Like): THREE.BufferGeometry {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.deleteAttribute('uv');
    if (scale) geo.scale(scale.x, scale.y, scale.z);
    if (rot) {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot.x, rot.y, rot.z));
      geo.applyMatrix4(m);
    }
    geo.translate(at.x, at.y, at.z);
    const c = new THREE.Color(hex);
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.list.push(geo);
    return geo;
  }

  box(hex: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, rot?: THREE.Vector3Like) {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), hex, { x, y, z }, rot);
  }

  /** 圓角盒：可愛感的主力 */
  rbox(hex: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, r = 0.04, rot?: THREE.Vector3Like) {
    const rr = Math.min(r, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3);
    return this.add(new RoundedBoxGeometry(sx, sy, sz, 3, rr), hex, { x, y, z }, rot);
  }

  cyl(hex: number, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 20, rot?: THREE.Vector3Like) {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), hex, { x, y, z }, rot);
  }

  sphere(hex: number, r: number, x: number, y: number, z: number, scale?: THREE.Vector3Like, seg = 16) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)), hex, { x, y, z }, undefined, scale);
  }

  torus(hex: number, r: number, tube: number, x: number, y: number, z: number, rot?: THREE.Vector3Like, arc = Math.PI * 2) {
    return this.add(new THREE.TorusGeometry(r, tube, 8, 24, arc), hex, { x, y, z }, rot);
  }

  cone(hex: number, r: number, h: number, x: number, y: number, z: number, seg = 16, rot?: THREE.Vector3Like) {
    return this.add(new THREE.ConeGeometry(r, h, seg), hex, { x, y, z }, rot);
  }

  get count() {
    return this.list.length;
  }

  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false);
    if (!g) throw new Error('[lpg] bakery merge failed');
    for (const x of this.list) x.dispose();
    this.list.length = 0;
    return g;
  }
}
