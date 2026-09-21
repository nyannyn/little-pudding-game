import * as THREE from 'three';
import { toonMaterial } from './toon';

// 櫥窗尺寸（世界單位，1 ≈ 10 cm）。地板邊界給邏輯層決定布丁跳躍範圍。
export const CABINET = { width: 5, depth: 3.2, height: 3, wall: 0.06, base: 0.5 } as const;

export function floorBounds() {
  const m = 0.45; // 留邊，避免布丁貼玻璃
  return { minX: -CABINET.width / 2 + m, maxX: CABINET.width / 2 - m, minZ: -CABINET.depth / 2 + m, maxZ: CABINET.depth / 2 - m, y: 0 };
}

// 玻璃：不用 transmission（D6），用透明＋clearcoat＋環境反射表現
export function createCabinet(): THREE.Group {
  const g = new THREE.Group();
  const { width, depth, height, wall, base } = CABINET;

  const wood = toonMaterial(0xd9a066);
  const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, base, depth + 0.4), wood);
  baseMesh.position.y = -base / 2;
  baseMesh.receiveShadow = true;
  baseMesh.castShadow = true;
  g.add(baseMesh);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, depth), toonMaterial(0xfff3df));
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  g.add(floor);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdff4ff,
    transparent: true,
    opacity: 0.16,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), glass);
  box.position.y = height / 2;
  box.renderOrder = 10; // 透明物最後畫
  g.add(box);

  // 玻璃邊框（12 條）：合併成一個 mesh，省 draw call
  const frame = toonMaterial(0xf7e6c8);
  const edges: THREE.BoxGeometry[] = [];
  const x = width / 2, y = height / 2, z = depth / 2;
  const bar = (sx: number, sy: number, sz: number, px: number, py: number, pz: number) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    geo.translate(px, py, pz);
    edges.push(geo);
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(wall, height, wall, sx * x, y, sz * z);
  for (const sy of [0, 1]) for (const sz of [-1, 1]) bar(width, wall, wall, 0, sy * height, sz * z);
  for (const sy of [0, 1]) for (const sx of [-1, 1]) bar(wall, wall, depth, sx * x, sy * height, 0);
  const merged = mergeBoxes(edges);
  const frameMesh = new THREE.Mesh(merged, frame);
  frameMesh.castShadow = false; // 細框投影在地板上是硬線，關掉更乾淨
  g.add(frameMesh);

  return g;
}

function mergeBoxes(geos: THREE.BoxGeometry[]): THREE.BufferGeometry {
  // 手動合併（避免額外 import BufferGeometryUtils 的整包）
  let pos: number[] = [], nor: number[] = [], idx: number[] = [], offset = 0;
  for (const geo of geos) {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), i = geo.getIndex()!;
    for (let k = 0; k < p.count; k++) { pos.push(p.getX(k), p.getY(k), p.getZ(k)); nor.push(n.getX(k), n.getY(k), n.getZ(k)); }
    for (let k = 0; k < i.count; k++) idx.push(i.getX(k) + offset);
    offset += p.count;
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
