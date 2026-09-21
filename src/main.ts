import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buyEquipment,
  buySpecialBasin,
  buyStock,
  craft,
  fillBasin,
  fulfillOrder,
  pickAllDrops,
  pickDrop,
  sellDessert,
  sellIngredient,
} from './game/actions';
import type { SimEvent } from './game/events';
import { advance, createWorld, drainEvents, settleOffline, syncForSave } from './game/sim';
import { LIQUIDS, SPECIES, SPECIES_IDS, type LiquidId, type SpeciesId } from './game/species';
import { load, save } from './game/storage';
import { createNewSave, type GameState, type Vec2 } from './game/state';
import { createRenderer } from './scene/renderer';
import { createCamera, createControls, fitBoxDistance, applyDistance } from './scene/camera';
import { addLighting } from './scene/lighting';
import {
  ACTIVE_TANK,
  TANK,
  createCabinet,
  floorBounds,
  tankFloorY,
  UNIT_HEIGHT,
  UNIT_OUTER_W,
  UNIT_OUTER_D,
} from './scene/cabinet';
import { createCabinetRow } from './scene/cabinetRow';
import { BASIN_SINK, BasinsView } from './scene/basinMesh';
import { DropsView } from './scene/dropMesh';
import { EquipmentView } from './scene/equipmentMesh';
import { Particles } from './scene/particles';
import { PuddingView } from './scene/puddingView';
import { spawnPudding } from './scene/puddingMesh';
import { Sfx } from './scene/audio';
import { Hud } from './ui/hud';
import { createStats } from './debug/stats';

const params = new URLSearchParams(location.search);
const container = document.getElementById('app')!;

/** 櫥窗裡放澡盆的位置（地板座標）。買了特殊澡盆就往後遞補一格。 */
// 右前方要留給名牌（`createPlates` 貼在該層右下角），澡盆放那裡會被蓋住。
const BASIN_SLOTS: Vec2[] = [
  { x: -0.52, z: 0.12 },
  { x: 0.52, z: -0.24 },
  { x: -0.52, z: -0.24 },
];

// ── 場景 ──────────────────────────────────────────────
const renderer = createRenderer(container);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6e7d2);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const target = new THREE.Vector3(0, UNIT_HEIGHT * 0.5, 0);
const camera = createCamera(container.clientWidth / container.clientHeight);
const FIT_W = UNIT_OUTER_W + 0.06;
const FIT_H = UNIT_HEIGHT + 0.10;
const controls = createControls(camera, renderer.domElement, target, fitBoxDistance(camera, FIT_W, FIT_H, UNIT_OUTER_D));
addLighting(scene);

const bounds = floorBounds();
const floorY = bounds.y;
const ceilY = tankFloorY(ACTIVE_TANK) + TANK.height;

scene.add(createCabinetRow());
const cabinet = createCabinet([
  { title: '第一層', sub: '未解鎖', locked: true },
  { title: '焦糖布丁', sub: '營業中' },
  { title: '第三層', sub: '未解鎖', locked: true },
]);
scene.add(cabinet);

const basins = new BasinsView(floorY);
const drops = new DropsView(floorY);
const equipment = new EquipmentView(floorY, ceilY);
const particles = new Particles();
scene.add(basins.group, drops.mesh, equipment.group, particles.points);

const sfx = new Sfx();
sfx.attachUnlock(renderer.domElement);

// ── 世界 ──────────────────────────────────────────────
const seedParam = Number(params.get('seed'));
const fastTime = Math.max(1, Number(params.get('fastTime')) || 1);
const fresh = params.get('fresh') === '1';

const newSaveOptions = {
  seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : undefined,
  basinPos: BASIN_SLOTS[0],
  puddingPositions: [
    { x: 0.05, z: 0.1 },
    { x: 0.5, z: -0.02 },
  ],
};

// `?fresh=1`：不讀舊檔，直接開新的（e2e 與「重新玩一次」用）
const loaded = fresh ? { state: createNewSave(newSaveOptions), restored: false } : load(newSaveOptions);
const state: GameState = loaded.state;
const world = createWorld(state, bounds);

// 離線結算：上限 8 小時，回來時告訴玩家發生了什麼
let offlineSeconds = 0;
if (loaded.restored) {
  const before = { coins: state.coins, baths: state.stats.baths };
  offlineSeconds = settleOffline(world, Date.now());
  drainEvents(world); // 離線那幾千個事件不需要逐一播音效
  if (offlineSeconds > 60) {
    const mins = Math.round(offlineSeconds / 60);
    const gained = Math.round(state.coins - before.coins);
    const baths = state.stats.baths - before.baths;
    setTimeout(
      () =>
        hud.showWelcome(
          `你離開的 ${mins} 分鐘裡，布丁泡了 ${baths} 次澡，賺了 ${gained} 焦糖幣。` +
            (state.drops.length > 0 ? `地板上還有 ${state.drops.length} 份原料沒收。` : ''),
        ),
      0,
    );
  }
} else {
  state.lastSeenAt = Date.now();
}

// ── 玩家動作 ──────────────────────────────────────────
/** 這種液體該倒進哪一個盆：普通液體進 0 號，特殊液體進它自己的盆 */
function basinFor(liquid: LiquidId): number {
  if (!LIQUIDS[liquid].needsBasin) return 0;
  const i = state.basins.findIndex((b) => b.preferredLiquid === liquid);
  return i >= 0 ? i : 0;
}

function report(r: { ok: true } | { ok: false; error: string }) {
  if (!r.ok) hud.toast(r.error, true);
  hud.update(state, performance.now(), true);
  return r.ok;
}

const hud = new Hud(document.body, {
  pour: (liquid) => report(fillBasin(state, basinFor(liquid), liquid, world.emit)),
  pickAll: () => {
    pickAllDrops(state, world.emit);
    hud.update(state, performance.now(), true);
  },
  craft: () => {
    // 從原料最多的物種開始做，玩家按一下就有明確結果
    const best = [...SPECIES_IDS].sort((a, b) => state.ingredients[b] - state.ingredients[a])[0] as SpeciesId;
    report(craft(state, best, world.emit));
  },
  ship: () => {
    // 先交掉接得到的訂單（出價 2–3 倍），剩下的才直接賣
    for (const o of [...state.orders]) {
      if (state.desserts[o.species] >= o.qty && o.expiresAt > state.time) fulfillOrder(state, o.id, world.emit);
    }
    for (const s of SPECIES_IDS) if (state.desserts[s] > 0) sellDessert(state, s, state.desserts[s], world.emit);
    hud.update(state, performance.now(), true);
  },
  fulfill: (id) => report(fulfillOrder(state, id, world.emit)),
  sellIngredients: (s) => report(sellIngredient(state, s, state.ingredients[s], world.emit)),
  buyStock: (liquid, qty) => report(buyStock(state, liquid, qty, world.emit)),
  buyEquipment: (id) => report(buyEquipment(state, id, world.emit)),
  buyBasin: (liquid) => {
    const slot = BASIN_SLOTS[Math.min(state.basins.length, BASIN_SLOTS.length - 1)] as Vec2;
    return report(buySpecialBasin(state, liquid, slot, world.emit));
  },
  toggleMute: () => {
    sfx.muted = !sfx.muted;
    return sfx.muted;
  },
});

// ── 事件 → 聲音／粒子／提示 ───────────────────────────
const views = new Map<string, PuddingView>();

function handle(e: SimEvent) {
  switch (e.type) {
    case 'splat':
      sfx.splat(0.42);
      break;
    case 'bathDone':
      particles.burst(0, floorY + 0.1, 0, 0xfff0c0, 6);
      break;
    case 'drop':
      particles.burst(e.x, floorY + 0.06, e.z, SPECIES.caramel.toppingColor, 8);
      break;
    case 'mutate': {
      views.get(e.puddingId)?.pulse();
      particles.burst(e.x, floorY + 0.12, e.z, SPECIES[e.to].bodyColor, 22);
      sfx.coin(0.4);
      hud.toast(`突變！變成${SPECIES[e.to].name}`);
      break;
    }
    case 'sell':
      sfx.coin(0.26);
      hud.toast(`賣出${SPECIES[e.species].dessert}，+${e.coins}`);
      break;
    case 'orderDone':
      sfx.coin(0.36);
      hud.toast(`訂單成交，+${e.coins}`);
      break;
    case 'orderNew':
      hud.toast(`新訂單：${SPECIES[e.species].dessert} × ${e.qty}`);
      break;
    case 'orderExpired':
      hud.toast(`訂單過期了：${SPECIES[e.species].dessert}`, true);
      break;
    case 'craft':
      if (!e.auto) hud.toast(`做好一份${SPECIES[e.species].dessert}`);
      break;
    case 'buy':
      if (!e.auto) hud.toast(`購入${e.what}，−${e.cost}`);
      break;
    default:
      break;
  }
}

// ── 觸控：點掉落物撿起來、點澡盆倒液體 ────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = { x: 0, y: 0, t: 0 };

renderer.domElement.addEventListener('pointerdown', (ev) => {
  downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (ev) => {
  // 只有「短按而且幾乎沒移動」才算點擊，否則那是在環繞鏡頭
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
  if (moved > 10 || performance.now() - downAt.t > 400) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);

  const hitDrop = raycaster.intersectObject(drops.mesh, false)[0];
  if (hitDrop) {
    const id = drops.idAt(hitDrop.instanceId);
    if (id) {
      report(pickDrop(state, id, world.emit));
      return;
    }
  }

  const hitBasin = raycaster.intersectObjects(basins.group.children, false)[0];
  if (hitBasin) {
    // 點澡盆＝倒它上次裝的那種；還沒倒過就給焦糖（開局就是要先倒焦糖）
    const i = nearestBasin(hitBasin.point);
    const liquid = state.basins[i]?.preferredLiquid ?? 'caramel';
    report(fillBasin(state, i, liquid, world.emit));
  }
});

function nearestBasin(point: THREE.Vector3): number {
  let best = 0, bestD = Infinity;
  state.basins.forEach((b, i) => {
    const d = Math.hypot(b.pos.x - point.x, b.pos.z - point.z);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// ── 存檔 ──────────────────────────────────────────────
let sinceSave = 0;
function persist() {
  save(syncForSave(world, Date.now()));
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});
window.addEventListener('pagehide', persist);

// ── 布丁的 view ───────────────────────────────────────
async function boot() {
  if (params.get('noPudding') !== '1') {
    const url = `${import.meta.env.BASE_URL}models/pudding_base.glb`;
    for (const p of state.puddings) {
      try {
        const g = await spawnPudding(url);
        const view = new PuddingView(g, p);
        views.set(p.id, view);
        scene.add(view.root);
      } catch (e) {
        console.error('[lpg] pudding load failed', e);
        break;
      }
    }
  }
  stats.stats.ready = true;
}

// ── 主迴圈 ────────────────────────────────────────────
const stats = createStats(renderer, params.get('debug') === '1');
window.__lpg.three = { scene, camera, renderer, controls, raycaster };
window.__lpg.state = state;

let last = performance.now();
let bubbleT = 0;

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  applyDistance(camera, controls, fitBoxDistance(camera, FIT_W, FIT_H, UNIT_OUTER_D));
}
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  const now = performance.now();
  // 分頁切回來時 dt 會很大；那段時間交給離線結算，不要在一幀裡補跑
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  advance(world, dt * fastTime);
  for (const e of drainEvents(world)) handle(e);

  // 泡澡冒泡：靠狀態每隔一段時間生一顆，不必為此發事件
  bubbleT += dt;
  if (bubbleT > 0.22) {
    bubbleT = 0;
    for (const p of state.puddings) {
      if (p.mode !== 'bathing') continue;
      const b = p.basinIndex === null ? undefined : state.basins[p.basinIndex];
      const color = p.bathLiquid ? LIQUIDS[p.bathLiquid].color : 0xffffff;
      particles.bubble(b?.pos.x ?? p.pos.x, floorY + 0.06, b?.pos.z ?? p.pos.z, color);
    }
  }

  basins.sync(state);
  drops.sync(state, dt);
  equipment.sync(state);
  particles.update(dt);
  for (const p of state.puddings) views.get(p.id)?.update(p, dt, floorY, BASIN_SINK);

  hud.update(state, now);

  sinceSave += dt;
  if (sinceSave > 5) {
    sinceSave = 0;
    persist();
  }

  controls.update();
  renderer.render(scene, camera);
  stats.tick();
});

void boot();
