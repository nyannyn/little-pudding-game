import * as THREE from 'three';

// 暖色主光＋半球補光＋柔陰影；陰影貼圖 1024 已夠一個櫥窗
export function addLighting(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight(0xfff4e0, 0xf3c8c8, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c9, 2.2);
  sun.position.set(4, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5;
  sun.shadow.camera.bottom = -5;
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 4;
  scene.add(sun);

  return { hemi, sun };
}
