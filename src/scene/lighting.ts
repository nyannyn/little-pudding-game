import * as THREE from 'three';
import { UNIT_HEIGHT } from './cabinet';

// 暖色主光＋半球補光＋柔陰影；陰影貼圖 1024 已夠一個櫥窗
/**
 * 把主光與陰影相機重新框到指定位置。
 * 陰影貼圖只有 1024，框在 ±2.6 上才夠細；不跟著啟用區移動的話，
 * 切到二號櫥窗（x≈2.55）時那一區會整個落在陰影相機外面，影子直接消失。
 */
export function focusShadow(sun: THREE.DirectionalLight, x: number, y: number) {
  sun.position.set(x + 3.5, y + 6, 5);
  sun.target.position.set(x, y, 0);
  sun.target.updateMatrixWorld();
  const r = 2.6;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.updateProjectionMatrix();
}

export function addLighting(scene: THREE.Scene) {
  const focusY = UNIT_HEIGHT * 0.5; // 直立櫃的重心，陰影相機要對準這裡而不是地面原點
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0xf3c8c8, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c9, 2.2);
  sun.position.set(3.5, 8 + focusY, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  // 框緊一點：1024 攤在 ±5 的範圍上，落在直立櫃的層板間會出現階梯噪點
  sun.shadow.camera.left = -3.6;
  sun.shadow.camera.right = 3.6;
  sun.shadow.camera.top = 3.6;
  sun.shadow.camera.bottom = -3.6;
  // normalBias 比 bias 更能消除斜面上的自遮蔽噪點（層板上表面就是斜著被照到的）
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.target.position.set(0, focusY, 0);
  scene.add(sun);
  scene.add(sun.target);

  return { hemi, sun };
}
