import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;
const TILT = 25 * DEG; // 俯角（D5）

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
  return Math.max(byWidth, byHeight) * 1.15;
}

export function createControls(camera: THREE.PerspectiveCamera, dom: HTMLElement, target: THREE.Vector3, distance: number) {
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minAzimuthAngle = -30 * DEG;
  controls.maxAzimuthAngle = 30 * DEG;
  controls.minPolarAngle = Math.PI / 2 - TILT - 8 * DEG;
  controls.maxPolarAngle = Math.PI / 2 - TILT + 8 * DEG;
  applyDistance(camera, controls, distance);
  return controls;
}

export function applyDistance(camera: THREE.PerspectiveCamera, controls: OrbitControls, distance: number) {
  controls.minDistance = distance * 0.7;
  controls.maxDistance = distance * 1.3;
  const polar = Math.PI / 2 - TILT;
  camera.position.set(0, Math.cos(polar) * distance, Math.sin(polar) * distance).add(controls.target);
  camera.lookAt(controls.target);
  controls.update();
}
