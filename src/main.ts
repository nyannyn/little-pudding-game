import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer } from './scene/renderer';
import { createCamera, createControls, fitDistance, applyDistance } from './scene/camera';
import { addLighting } from './scene/lighting';
import { createCabinet, CABINET } from './scene/cabinet';
import { spawnPudding } from './scene/puddingMesh';
import { createStats } from './debug/stats';

const params = new URLSearchParams(location.search);
const container = document.getElementById('app')!;

const renderer = createRenderer(container);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6e7d2);

// 環境貼圖只給玻璃反射用，一次性 PMREM，成本可忽略
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const target = new THREE.Vector3(0, CABINET.height * 0.4, 0);
const camera = createCamera(container.clientWidth / container.clientHeight);
const FIT_W = CABINET.width + 1.2, FIT_H = CABINET.height + CABINET.base + 1.5;
const controls = createControls(camera, renderer.domElement, target, fitDistance(camera, FIT_W, FIT_H));
addLighting(scene);
scene.add(createCabinet());

const stats = createStats(renderer, params.get('debug') === '1');

async function boot() {
  if (params.get('noPudding') !== '1') {
    const url = `${import.meta.env.BASE_URL}models/pudding_base.glb`;
    try {
      const p = await spawnPudding(url);
      p.position.set(0, 0, 0);
      scene.add(p);
    } catch (e) {
      console.error('[lpg] pudding load failed', e);
    }
  }
  stats.stats.ready = true;
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  applyDistance(camera, controls, fitDistance(camera, FIT_W, FIT_H));
}
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  stats.tick();
});

void boot();
