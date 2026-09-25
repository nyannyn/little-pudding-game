import * as THREE from 'three';
import type { PuddingMood } from '../game/pudding';
import { POOL_CAPACITY } from './puddingPool';

/**
 * 布丁頭頂的小圖示（D48）：狀態卡拿掉之後，「想泡澡」「幼布丁」靠這個讀。
 *
 * 全部布丁共用一個 InstancedMesh（+1 draw call，沒有圖示要畫時整個不畫）。
 * 貼圖是 canvas 畫的兩格圖集，每隻用 instance 屬性 `aCell` 選格子；
 * 面向鏡頭靠每幀把鏡頭的 quaternion 寫進 instance 矩陣（billboard）。
 *
 * 不做深度測試、最後才畫：15 隻擠在一起時後排的圖示不能被前排的布丁或玻璃吃掉——
 * 表情只是風味，圖示才是手機上讀得出「誰要泡澡」的通道。
 *
 * D62（2026-09-25）：同一張圖集加 ★2–★5 四格星級徽章，一隻布丁最多兩個 instance（狀態＋星級），
 * 還是同一個 InstancedMesh、同一個 draw call。★1 是預設不畫（15 隻頭上都頂一顆 ★1 只是雜訊）。
 */

/** 圖集裡的格子，順序＝canvas 由左到右 */
const CELLS: Partial<Record<PuddingMood, number>> = { wantsBath: 0, baby: 1 };
/** 星級徽章的格子：★2 在第 2 格…★5 在第 5 格 */
const STAR_CELL0 = 2;
const CELL_COUNT = 6;
/** 一隻布丁最多幾個圖示（狀態＋星級） */
const PER_PUDDING = 2;
const CELL_PX = 128;

/** 圖示中心在布丁腳底上方多高（世界單位；布丁本體約 0.17 高） */
const ICON_Y = 0.29;
const ICON_SIZE = 0.16;
/** 星級徽章：小一點、偏右下，跟狀態圖示同時出現時不疊在一起 */
const STAR_Y = 0.24;
const STAR_SIZE = 0.12;
const STAR_RIGHT = 0.1;

function drawAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CELL_PX * CELL_COUNT;
  c.height = CELL_PX;
  const g = c.getContext('2d');
  if (!g) return c;
  const badge = (cx: number) => {
    // 圓底＋木色描邊，跟 HUD 的圓底圖示同一套視覺語言
    g.beginPath();
    g.arc(cx, 60, 52, 0, Math.PI * 2);
    g.fillStyle = '#fff8e8';
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#b8834f';
    g.stroke();
    // 下方小尖角，讀起來像「這隻在說話」
    g.beginPath();
    g.moveTo(cx - 12, 106);
    g.lineTo(cx, 124);
    g.lineTo(cx + 12, 106);
    g.closePath();
    g.fillStyle = '#b8834f';
    g.fill();
  };

  // 第 0 格：澡盆（想泡澡）
  let cx = CELL_PX * 0.5;
  badge(cx);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.fillStyle = '#7fb8e6';
  g.strokeStyle = '#3f6f99';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx - 34, 58);
  g.lineTo(cx + 34, 58);
  g.quadraticCurveTo(cx + 32, 88, cx, 88);
  g.quadraticCurveTo(cx - 32, 88, cx - 34, 58);
  g.closePath();
  g.fill();
  g.stroke();
  // 盆腳
  g.beginPath();
  g.moveTo(cx - 20, 88);
  g.lineTo(cx - 24, 96);
  g.moveTo(cx + 20, 88);
  g.lineTo(cx + 24, 96);
  g.stroke();
  // 泡泡
  g.lineWidth = 5;
  for (const [x, y, r] of [[-14, 40, 9], [6, 32, 7], [22, 42, 6]] as const) {
    g.beginPath();
    g.arc(cx + x, y, r, 0, Math.PI * 2);
    g.fillStyle = '#e2f0fb';
    g.fill();
    g.stroke();
  }

  // 第 2–5 格：星級徽章（★2–★5）。金色星星＋中間的數字，數字大才在手機上讀得出幾星
  for (let s = 2; s <= 5; s++) {
    const x = CELL_PX * (STAR_CELL0 + s - 2 + 0.5);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 58 : 27;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const px = x + Math.cos(a) * r;
      const py = 66 + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = s >= 5 ? '#ffd23f' : '#f7c95a';
    g.fill();
    g.lineWidth = 8;
    g.lineJoin = 'round';
    g.strokeStyle = s >= 4 ? '#c8751a' : '#b8834f';
    g.stroke();
    g.fillStyle = '#6b3f14';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(s), x, 72);
  }

  // 第 1 格：嫩芽（幼布丁）
  cx = CELL_PX * 1.5;
  badge(cx);
  g.strokeStyle = '#3f7a2c';
  g.fillStyle = '#98cc78';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx, 92);
  g.lineTo(cx, 58);
  g.stroke();
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx, 60);
    g.quadraticCurveTo(cx + dir * 34, 58, cx + dir * 32, 30);
    g.quadraticCurveTo(cx + dir * 6, 30, cx, 60);
    g.closePath();
    g.fill();
    g.stroke();
  }
  return c;
}

export class MoodIcons {
  readonly mesh: THREE.InstancedMesh;
  private readonly aCell: THREE.InstancedBufferAttribute;
  private n = 0;
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(ICON_SIZE, ICON_SIZE, ICON_SIZE);
  private readonly starScale = new THREE.Vector3(STAR_SIZE, STAR_SIZE, STAR_SIZE);
  private readonly right = new THREE.Vector3();

  constructor() {
    const tex = new THREE.CanvasTexture(drawAtlas());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(1, 1);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(POOL_CAPACITY * PER_PUDDING), 1);
    this.aCell.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.aCell);

    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv.x = ( vMapUv.x + aCell ) / ${CELL_COUNT}.0;`);
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, POOL_CAPACITY * PER_PUDDING);
    this.mesh.name = 'Pudding_MoodIcons';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 13; // 蓋在玻璃（10）與粒子（12）之上
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  begin(dt: number) {
    this.n = 0;
    this.t += dt;
  }

  /** 一隻可見的布丁：`root` 是牠已經擺好的骨架根節點（跟著跳躍與泡澡的上下晃）；`star` ≥2 才畫星級徽章 */
  add(root: THREE.Object3D, mood: PuddingMood, camera: THREE.Camera, star = 1) {
    const cell = CELLS[mood];
    if (cell !== undefined && this.n < POOL_CAPACITY * PER_PUDDING) {
      const i = this.n++;
      // 輕輕上下飄，同一幀大家相位錯開才不會整排一起點頭
      const bob = Math.sin(this.t * 3 + i * 1.7) * 0.006;
      this.pos.set(root.position.x, root.position.y + ICON_Y + bob, root.position.z);
      this.m.compose(this.pos, camera.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.m);
      this.aCell.setX(i, cell);
    }
    if (star >= 2 && this.n < POOL_CAPACITY * PER_PUDDING) {
      const i = this.n++;
      this.right.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(STAR_RIGHT);
      this.pos.set(root.position.x + this.right.x, root.position.y + STAR_Y + this.right.y, root.position.z + this.right.z);
      this.m.compose(this.pos, camera.quaternion, this.starScale);
      this.mesh.setMatrixAt(i, this.m);
      this.aCell.setX(i, STAR_CELL0 + Math.min(5, star) - 2);
    }
  }

  commit() {
    this.mesh.count = this.n;
    // count 0 的 InstancedMesh 還是會走一次 draw
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aCell.needsUpdate = true;
  }
}
