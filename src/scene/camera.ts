import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;
const TILT = 25 * DEG;            // 俯角（D5）
// 左右環繞上限。D5 原訂 ±30° → D17 收到 ±18° → CP3 鏡頭改框單層後再收到 ±10°。
// 距離愈近，同樣的角度掃過的世界範圍愈大：要替環繞預留的左右邊距
// （w·cos + 深·sin）會直接吃掉「把這一層放大」的效果，兩者是對衝的。
export const MAX_AZIMUTH = 10 * DEG;

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

export function createControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  target: THREE.Vector3,
  distance: number,
  maxDistance?: number,
) {
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minAzimuthAngle = -MAX_AZIMUTH;
  controls.maxAzimuthAngle = MAX_AZIMUTH;
  controls.minPolarAngle = Math.PI / 2 - TILT - 8 * DEG;
  controls.maxPolarAngle = Math.PI / 2 - TILT + 8 * DEG;
  applyDistance(camera, controls, distance, maxDistance);
  return controls;
}

/**
 * @param maxDistance 拉遠上限。鏡頭改成框單層之後，這個值不能再用「初始距離 × 倍率」算——
 *   那會讓玩家拉不回整座櫃子。呼叫端另外算一個「整櫃塞滿」的距離傳進來。
 */
export function applyDistance(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  distance: number,
  maxDistance = distance * 2.4,
) {
  controls.minDistance = distance * 0.6;
  controls.maxDistance = Math.max(maxDistance, distance);
  const polar = Math.PI / 2 - TILT;
  camera.position.set(0, Math.cos(polar) * distance, Math.sin(polar) * distance).add(controls.target);
  camera.lookAt(controls.target);
  controls.update();
}
