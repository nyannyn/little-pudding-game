import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../../src/scene/toon';

type Box = [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

/** 一堆方塊併成一顆 mesh（頂點色）＝一位客人一個 draw call */
function voxel(boxes: Box[]): THREE.Mesh {
  const geos = boxes.map(([w, h, d, x, y, z, c]) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const m = new THREE.Mesh(mergeGeometries(geos), toonMaterial(0xffffff, { vertexColors: true }));
  m.castShadow = true;
  return m;
}

interface Spec { body: number; belly: number; ears: 'round' | 'long' | 'none' | 'wool'; earIn?: number; acc: Box[]; eyesTop?: boolean; face?: number }

/** 動物模板：身體＋頭＋腳＋眼＋口鼻，耳朵與配件按 spec 換 */
function animal(s: Spec): THREE.Mesh {
  const B: Box[] = [];
  const face = s.face ?? s.body;
  B.push([0.9, 0.8, 0.7, 0, 0.55, 0, s.body]);
  B.push([0.6, 0.5, 0.05, 0, 0.5, 0.36, s.belly]);
  B.push([0.25, 0.2, 0.3, -0.25, 0.1, 0.05, s.body]);
  B.push([0.25, 0.2, 0.3, 0.25, 0.1, 0.05, s.body]);
  B.push([0.8, 0.7, 0.7, 0, 1.3, 0.05, face]);
  B.push([0.4, 0.25, 0.15, 0, 1.18, 0.45, s.belly]);
  B.push([0.14, 0.1, 0.06, 0, 1.26, 0.53, 0x3a2a24]);
  if (s.eyesTop) {
    B.push([0.28, 0.24, 0.28, -0.24, 1.7, 0.15, s.body], [0.28, 0.24, 0.28, 0.24, 1.7, 0.15, s.body]);
    B.push([0.12, 0.14, 0.06, -0.22, 1.72, 0.32, 0x2a1d18], [0.12, 0.14, 0.06, 0.22, 1.72, 0.32, 0x2a1d18]);
  } else {
    B.push([0.12, 0.14, 0.06, -0.22, 1.42, 0.41, 0x2a1d18], [0.12, 0.14, 0.06, 0.22, 1.42, 0.41, 0x2a1d18]);
  }
  B.push([0.1, 0.06, 0.04, -0.3, 1.24, 0.42, 0xf5a3b5], [0.1, 0.06, 0.04, 0.3, 1.24, 0.42, 0xf5a3b5]);
  const e = s.earIn ?? s.belly;
  if (s.ears === 'round') B.push([0.22, 0.22, 0.15, -0.3, 1.75, 0, s.body], [0.22, 0.22, 0.15, 0.3, 1.75, 0, s.body], [0.12, 0.12, 0.04, -0.3, 1.75, 0.08, e], [0.12, 0.12, 0.04, 0.3, 1.75, 0.08, e]);
  if (s.ears === 'long') B.push([0.18, 0.6, 0.12, -0.18, 1.95, -0.05, s.body], [0.18, 0.6, 0.12, 0.18, 1.95, -0.05, s.body], [0.08, 0.45, 0.04, -0.18, 1.95, 0.02, e], [0.08, 0.45, 0.04, 0.18, 1.95, 0.02, e]);
  if (s.ears === 'wool') for (const [x, z] of [[-0.25, -0.1], [0, 0], [0.25, -0.1], [-0.12, 0.15], [0.12, 0.15]]) B.push([0.32, 0.25, 0.32, x, 1.7, z, 0xfff6e6]);
  B.push(...s.acc);
  return voxel(B);
}

const REGULARS: { name: string; taste: string; hearts: number; spec: Spec }[] = [
  { name: '熊先生', taste: '焦糖系・至少 ★3', hearts: 4, spec: { body: 0x9a6035, belly: 0xf1d3a8, ears: 'round',
    acc: [[0.5, 0.14, 0.1, 0, 0.98, 0.37, 0xd9485f], [0.14, 0.14, 0.12, 0, 0.98, 0.4, 0xb8354b]] } },
  { name: '兔子太太', taste: '草莓系・至少 ★2', hearts: 6, spec: { body: 0xfaf6f0, belly: 0xffe3ea, ears: 'long', earIn: 0xf7a7b8,
    acc: [[0.7, 0.55, 0.06, 0, 0.55, 0.38, 0xf28aa5], [0.2, 0.2, 0.08, 0, 0.62, 0.42, 0xe0405c], [0.1, 0.06, 0.06, 0, 0.75, 0.42, 0x6cbf6a]] } },
  { name: '綿羊奶奶', taste: '鮮奶酪系・至少 ★4', hearts: 1, spec: { body: 0xfff1dc, belly: 0xfff8ec, ears: 'wool', face: 0x6a5a54,
    acc: [[0.2, 0.12, 0.04, -0.2, 1.42, 0.44, 0xd6b25a], [0.2, 0.12, 0.04, 0.2, 1.42, 0.44, 0xd6b25a], [0.2, 0.04, 0.04, 0, 1.44, 0.44, 0xd6b25a]] } },
  { name: '青蛙小弟', taste: '抹茶系・至少 ★2', hearts: 9, spec: { body: 0x7cc46a, belly: 0xdaf0c0, ears: 'none', eyesTop: true,
    acc: [[0.95, 0.16, 0.8, 0, 1.0, 0.02, 0x4f8f45], [0.18, 0.4, 0.08, 0.3, 0.75, 0.42, 0x4f8f45]] } },
];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfbe7ea);
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
cam.position.set(0, 11, 10);
cam.lookAt(0, 0.3, -1.2);
scene.add(new THREE.HemisphereLight(0xffffff, 0xf3c9b0, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun);
const tiles: Box[] = [];
for (let i = -4; i < 4; i++) for (let j = -5; j < 5; j++) tiles.push([1, 0.1, 1, i + 0.5, -0.05, j - 0.5, (i + j) & 1 ? 0xf6c1c4 : 0xffe8c4]);
const floor = voxel(tiles);
floor.receiveShadow = true;
floor.castShadow = false;
scene.add(floor);

const pos = [[-1.3, -3.2], [1.3, -3.2], [-1.3, 1.4], [1.3, 1.4]];
const meshes: { m: THREE.Mesh; tag: HTMLElement }[] = [];
REGULARS.forEach((r, i) => {
  const m = animal(r.spec);
  m.position.set(pos[i][0], 0, pos[i][1]);
  m.rotation.y = pos[i][0] < 0 ? 0.35 : -0.35;
  scene.add(m);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.innerHTML = `<b>${r.name}</b><small>${r.taste}</small><br><i>${'♥'.repeat(r.hearts)}${'♡'.repeat(10 - r.hearts)}</i>`;
  document.body.appendChild(tag);
  meshes.push({ m, tag });
});
let t = 0;
function frame() {
  t += 1 / 60;
  meshes.forEach(({ m, tag }, i) => {
    m.position.y = Math.abs(Math.sin(t * 3 + i)) * 0.12;
    const p = new THREE.Vector3(m.position.x, 0, m.position.z + 0.45).project(cam);
    tag.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    tag.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  });
  renderer.render(scene, cam);
  (window as unknown as { __calls: number }).__calls = renderer.info.render.calls;
  requestAnimationFrame(frame);
}
frame();
