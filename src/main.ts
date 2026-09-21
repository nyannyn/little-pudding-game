import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRenderer } from './scene/renderer';
import { createCamera, createControls, fitBoxDistance, applyDistance } from './scene/camera';
import { addLighting } from './scene/lighting';
import { createCabinet, floorBounds, UNIT_HEIGHT, UNIT_OUTER_W, UNIT_OUTER_D } from './scene/cabinet';
import { createCabinetRow } from './scene/cabinetRow';
import { spawnPudding } from './scene/puddingMesh';
import { createStats } from './debug/stats';

const params = new URLSearchParams(location.search);
const PUDDING_MODEL_WIDTH = 1.0; // Blender 出廠的 bbox 寬（build_pudding.py 回報 1.0）
const PUDDING_WIDTH = 0.2;       // 使用者指定
const container = document.getElementById('app')!;

const renderer = createRenderer(container);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6e7d2);

// 環境貼圖只給玻璃反射用，一次性 PMREM，成本可忽略
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

// 注視點＝畫面中心，取整座櫃子的正中
const target = new THREE.Vector3(0, UNIT_HEIGHT * 0.5, 0);
const camera = createCamera(container.clientWidth / container.clientHeight);
// 落地櫃是直立的，正面剛好填滿畫面（D17）。
// 環繞時側面會稍微裁掉：要正面填滿就沒有多餘邊距，兩者不可兼得——
// 使用者要的是填滿，所以 MAX_AZIMUTH 收窄到 18° 限制裁切量。
const FIT_W = UNIT_OUTER_W + 0.06;
const FIT_H = UNIT_HEIGHT + 0.10;
const controls = createControls(camera, renderer.domElement, target, fitBoxDistance(camera, FIT_W, FIT_H, UNIT_OUTER_D));
addLighting(scene);
scene.add(createCabinetRow()); // 先加鄰櫃，主櫃的透明玻璃要最後畫
scene.add(createCabinet([
  { title: '第一層', sub: '未解鎖', locked: true },
  { title: '焦糖布丁', sub: '住客 1 隻・正常' },
  { title: '第三層', sub: '未解鎖', locked: true },
]));

const stats = createStats(renderer, params.get('debug') === '1');
// 曝露給 Playwright 做幾何斷言（構圖占比、物件不相交等）；不含任何遊戲規則
window.__lpg.three = { scene, camera, renderer, controls, raycaster: new THREE.Raycaster() };

async function boot() {
  if (params.get('noPudding') !== '1') {
    const url = `${import.meta.env.BASE_URL}models/pudding_base.glb`;
    try {
      const p = await spawnPudding(url);
      // GLB 出廠寬度 1.0 世界單位；縮到 PUDDING_WIDTH（?pw= 可覆寫供比對）
      const pw = Number(params.get('pw')) || PUDDING_WIDTH;
      p.scale.setScalar(pw / PUDDING_MODEL_WIDTH);
      const b = floorBounds();   // 布丁站在「啟用層」的地板上，不是世界原點
      p.position.set(0, b.y, 0);
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
  applyDistance(camera, controls, fitBoxDistance(camera, FIT_W, FIT_H, UNIT_OUTER_D));
}
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  stats.tick();
});

void boot();
