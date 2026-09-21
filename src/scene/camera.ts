import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;
const TILT = 25 * DEG;            // 俯角（D5）
// 左右環繞上限。D5 原訂 ±30°，改直立落地櫃後收窄到 ±18°（D17）：
// 櫃子要正面填滿畫面就沒有多餘邊距，轉太多側面會被裁掉。
export const MAX_AZIMUTH = 18 * DEG;

// 固定俯角、只允許有限左右環繞與縮放（D5）
export function createCamera(aspect: number) {
  return new THREE.PerspectiveCamera(38, aspect, 0.1, 100);
}

// 依視口長寬把整個櫥窗（寬 fitWidth）塞進畫面：直向手機以水平視角為準
export function fitDistance(camera: THREE.PerspectiveCamera, fitWidth: number, fitHeight: number) {
  const vFov = camera.fov * DEG;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const byWidth = (fitWidth / 2) / Math.tan(hFov / 2);
  const byHeight = (fitHeight / 2) / Math.tan(vFov / 2);
  // 不再乘魔術倍率：fitWidth 由呼叫端依環繞極限算好（見 main.ts 的 FIT_W）
  return Math.max(byWidth, byHeight);
}

/**
 * 把一個長寬高已知的盒子塞滿畫面。
 * 只用寬高算會太近：盒子正面比中心更靠近鏡頭，投影會脹大（實測脹 15%、超出畫面）。
 * 先算一次距離，再用 D/(D − 深度/2) 把尺寸放大後重算一次。
 */
export function fitBoxDistance(camera: THREE.PerspectiveCamera, w: number, h: number, depth: number) {
  const d0 = fitDistance(camera, w, h);
  const k = d0 / Math.max(d0 - depth / 2, 0.1);
  return fitDistance(camera, w * k, h * k);
}

export function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement, target: THREE.Vector3, distance: number) {
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minAzimuthAngle = -MAX_AZIMUTH;
  controls.maxAzimuthAngle = MAX_AZIMUTH;
  controls.minPolarAngle = Math.PI / 2 - TILT - 8 * DEG;
  controls.maxPolarAngle = Math.PI / 2 - TILT + 8 * DEG;
  applyDistance(camera, controls, distance);
  return controls;
}

export function applyDistance(camera: THREE.PerspectiveCamera, controls: OrbitControls, distance: number) {
  controls.minDistance = distance * 0.7;
  // 初始距離是「zoom in 到主櫥窗」的狀態（D15）；拉遠上限放寬到 2.4 倍才看得到整排鄰櫥窗
  controls.maxDistance = distance * 2.4;
  const polar = Math.PI / 2 - TILT;
  camera.position.set(0, Math.cos(polar) * distance, Math.sin(polar) * distance).add(controls.target);
  camera.lookAt(controls.target);
  controls.update();
}
