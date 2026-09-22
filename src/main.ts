import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buyEquipment,
  buySpecialBasin,
  buyStock,
  craft,
  fillBasin,
  fulfillOrder,
  nearestPendingOrder,
  pickAllDrops,
  pickDrop,
  sellDessert,
  sellEggs,
  sellIngredient,
  shipDesserts,
  switchZone,
  unlockZone,
  type ShipResult,
} from './game/actions';
import type { SimEvent } from './game/events';
import { BALANCE } from './game/balance';
import { grantXp } from './game/level';
import { unlockedAtLevel } from './game/shop';
import { advance, createWorld, drainEvents, settleOffline, syncForSave } from './game/sim';
import { LIQUIDS, SPECIES, SPECIES_IDS, type LiquidId, type SpeciesId } from './game/species';
import { exportCode, importCode } from './game/savecode';
import { load, overwrite, save, useTestSave } from './game/storage';
import { createNewSave, equipmentIn, hasEquipmentAnywhere, type GameState, type Vec2 } from './game/state';
import { basinsIn, findZone, puddingsIn, unlockedZones, zoneKey } from './game/zones';
import { createRenderer } from './scene/renderer';
import { MAX_AZIMUTH, createCamera, createControls, fitBoxDistance, applyDistance } from './scene/camera';
import { CoinsView } from './scene/coinsView';
import { addLighting, focusShadow } from './scene/lighting';
import {
  CABINET_PITCH,
  CabinetView,
  TANK,
  UNIT,
  UNIT_HEIGHT,
  UNIT_OUTER_D,
  UNIT_OUTER_W,
  floorRect,
  zoneFocusY,
  zoneWorld,
  type TankStatus,
} from './scene/cabinet';
import { createCabinetRow } from './scene/cabinetRow';
import { BASIN_SINK, BasinsView } from './scene/basinMesh';
import { DropsView } from './scene/dropMesh';
import { EquipmentView } from './scene/equipmentMesh';
import { Particles } from './scene/particles';
import { ENTER as POUR_ENTER, PourView, THICKNESS, flowSeconds } from './scene/pourView';
import { PuddingView } from './scene/puddingView';
import { spawnPudding } from './scene/puddingMesh';
import { Sfx } from './scene/audio';
import { nextHint } from './ui/hints';
import { shouldSuggestHomeScreen } from './ui/homeScreen';
import { Hud } from './ui/hud';
import { SHOP_ART_URLS } from './ui/shopArt';
import { measureVisibleBand, viewOffsetY } from './ui/viewport';
import { createStats } from './debug/stats';

const params = new URLSearchParams(location.search);
const container = document.getElementById('app')!;

/**
 * 每一區放澡盆的位置（區域座標，各區共用這一組）。
 * 右前方留給該層名牌（`cabinet.createPlates`），澡盆放那裡會被蓋住。
 */
const BASIN_SLOTS: Vec2[] = [
  { x: -0.52, z: 0.12 },
  { x: 0.52, z: -0.24 },
  { x: -0.52, z: -0.24 },
];

/**
 * 鏡頭要看到的水平範圍（世界單位）。
 * 這個值有下限：布丁跳的範圍是 ±0.875，掉落物再往外 0.32，低於約 1.9
 * 就會有東西掉在畫面外。直向手機（9:19.5）下水平 1.9 對應垂直 4.6——
 * 「只框啟用層」在這個長寬比下做不到，能做的是把整櫃的 2.93 收到 2.14。
 */
const TIER_VIEW_W = 1.9;

// ── 場景 ──────────────────────────────────────────────
// `?dpr=`／`?aa=0`：現場分辨「卡在填充率」還是「卡在沒有硬體加速」用的旋鈕（見 renderer.ts）
const renderer = createRenderer(container, {
  maxPixelRatio: Number(params.get('dpr')) > 0 ? Number(params.get('dpr')) : 2,
  antialias: params.get('aa') !== '0',
});
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf6e7d2);

/**
 * 環境貼圖是 PMREM 算在 GPU 的 render target 上的，繪圖環境被回收時內容跟著沒。
 * three 還原 context 時會把幾何與貼圖從 CPU 端重傳一次，這張不在它的清單裡，要自己重做。
 */
function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment?.dispose();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
buildEnvironment();

const camera = createCamera(container.clientWidth / container.clientHeight);

function tierDistance() {
  const w = TIER_VIEW_W * Math.cos(MAX_AZIMUTH) + TANK.depth * Math.sin(MAX_AZIMUTH);
  return fitBoxDistance(camera, w, TANK.height * 1.02, TANK.depth);
}
/** 拉遠上限＝整座櫃子塞滿畫面的距離，玩家要看得回自己買下的整座櫃 */
function cabinetDistance() {
  return fitBoxDistance(camera, UNIT_OUTER_W + 0.06, UNIT_HEIGHT + 0.1, UNIT_OUTER_D);
}

const controls = createControls(
  camera,
  renderer.domElement,
  new THREE.Vector3(0, zoneFocusY(1), 0),
  tierDistance(),
  cabinetDistance(),
);
const { sun } = addLighting(scene);

const floor = floorRect();
const basins = new BasinsView();
const drops = new DropsView();
const equipment = new EquipmentView();
const particles = new Particles();
const pours = new PourView(basins, particles);
const coins = new CoinsView();
scene.add(basins.group, drops.mesh, equipment.group, particles.points, pours.group, coins.mesh);

const sfx = new Sfx();
// 掛 window 不掛 canvas：教學的第一個動作是 HUD 上的「倒焦糖」按鈕，事件不會經過 canvas
sfx.attachUnlock(window);

// ── 世界 ──────────────────────────────────────────────
const seedParam = Number(params.get('seed'));
const fastTime = Math.max(1, Number(params.get('fastTime')) || 1);
const fresh = params.get('fresh') === '1';
// 測試模式寫到另一個存檔格：在自己手機上開一次測試網址，不可以把真的進度洗掉
if (fresh) useTestSave(true);

const newSaveOptions = {
  seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : undefined,
  basinPos: BASIN_SLOTS[0],
  // 前兩個是開局的兩隻；後面幾個是 `?pop=` 量 draw call 時才用得到的落點
  puddingPositions: [
    { x: 0.05, z: 0.1 },
    { x: 0.5, z: -0.02 },
    { x: -0.45, z: 0.14 },
    { x: -0.12, z: -0.26 },
    { x: 0.7, z: 0.24 },
  ],
  puddingCount: Math.max(1, Number(params.get('pop')) || 2),
};

const loaded = fresh ? { state: createNewSave(newSaveOptions), restored: false, source: 'new' as const } : load(newSaveOptions);
const state: GameState = loaded.state;
// `?lv=N&coins=M`：看商店各等級長相用（跟 `?pop=` 一樣是量測／簽核參數，不是遊戲功能）
{
  const lv = Number(params.get('lv'));
  if (lv >= 1) state.xp = Math.max(state.xp, BALANCE.levelXp[Math.min(lv, BALANCE.levelXp.length) - 1] ?? 0);
  const coins = Number(params.get('coins'));
  if (coins > 0) state.coins = coins;
}
const world = createWorld(state, floor);

// ── 櫃體：主櫃永遠在，解鎖的鄰櫃升級成完整櫃子 ────────
const cabinets = new Map<number, CabinetView>();
let row: THREE.Group | null = null;
let shellSignature = '';

function statusesFor(cabinet: number): TankStatus[] {
  const out: TankStatus[] = [];
  for (let tier = 0; tier < UNIT.tanks; tier++) {
    const z = state.zones.find((q) => q.cabinet === cabinet && q.tier === tier);
    if (!z) {
      out.push({ title: `第 ${tier + 1} 層`, sub: '未開放', locked: true });
      continue;
    }
    const n = puddingsIn(state, z.id).length;
    out.push({
      title: z.name.split('・')[1] ?? z.name,
      sub: z.unlocked ? `住客 ${n} 隻` : `${z.price} 焦糖幣`,
      locked: !z.unlocked,
    });
  }
  return out;
}

function refreshShells() {
  const unlockedCabinets = [...new Set(unlockedZones(state).map((z) => z.cabinet))].sort((a, b) => a - b);
  const sig = state.zones.map((z) => (z.unlocked ? '1' : '0')).join('') + '|' + unlockedCabinets.join(',');
  if (sig === shellSignature) {
    for (const [i, view] of cabinets) view.setStatuses(statusesFor(i));
    return;
  }
  shellSignature = sig;

  for (const i of unlockedCabinets) {
    let view = cabinets.get(i);
    if (!view) {
      view = new CabinetView(i, statusesFor(i));
      cabinets.set(i, view);
      scene.add(view.group);
    }
    view.setStatuses(statusesFor(i));
  }
  // 升級成完整櫃子的座位要從合併的裝飾列裡拿掉，否則兩座疊在同一個位置
  if (row) {
    scene.remove(row);
    row.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
  row = createCabinetRow(unlockedCabinets.filter((i) => i !== 0));
  scene.add(row);
}

// ── 鏡頭：對準啟用區，切區時平滑移過去 ────────────────
const desiredTarget = new THREE.Vector3();
const moveTmp = new THREE.Vector3();

function focusActiveZone(instant = false) {
  const z = findZone(state, state.activeZone);
  if (!z) return;
  desiredTarget.set(z.cabinet * CABINET_PITCH, zoneFocusY(z.tier), 0);
  focusShadow(sun, desiredTarget.x, desiredTarget.y);
  if (instant) {
    moveTmp.copy(desiredTarget).sub(controls.target);
    controls.target.add(moveTmp);
    camera.position.add(moveTmp);
    controls.update();
  }
}

/** 區域座標搬到世界座標的唯一入口 */
function activeOrigin() {
  const z = findZone(state, state.activeZone);
  const w = zoneWorld(z?.cabinet ?? 0, z?.tier ?? 1);
  return { ox: w.x, oy: w.y, ceilY: w.y + TANK.height - 0.02 };
}

refreshShells();
focusActiveZone(true);

// 離線結算：上限 8 小時，回來時告訴玩家發生了什麼
if (loaded.restored) {
  const before = { coins: state.coins, baths: state.stats.baths };
  const offlineSeconds = settleOffline(world, Date.now());
  drainEvents(world); // 離線那幾千個事件不需要逐一播音效
  if (offlineSeconds > 60) {
    const mins = Math.round(offlineSeconds / 60);
    const gained = Math.round(state.coins - before.coins);
    const baths = state.stats.baths - before.baths;
    setTimeout(
      () =>
        hud.showWelcome(
          `你離開的 ${mins} 分鐘裡，布丁泡了 ${baths} 次澡，賺了 ${gained} 焦糖幣。` +
            (state.drops.length > 0 ? `地板上還有 ${state.drops.length} 份原料沒收。` : '') +
            // 離線期間液體用完＝生產線停了，回來第一眼就要知道，不然「泡了 0 次澡」讀起來像壞掉
            (nextHint(state)?.warning ? nextHint(state)!.text : ''),
        ),
      0,
    );
  }
} else {
  state.lastSeenAt = Date.now();
}

// 加到主畫面：Safari 分頁裡的存檔七天沒互動就會被清掉，加到主畫面的 web app 不吃那條規則。
// 測試模式不提示；歡迎卡開著的話讓路，等下一次再說（兩張卡疊在一起沒人看得懂）。
// 主存檔不見了、備份撈得回來。這個要用卡片不能用 toast：
// toast 2.6 秒就自己消失，玩家很可能整段沒看到，然後以為進度是憑空少了一截。
// 排在離線結算後面＝兩者都要講時，這則蓋過離線摘要（少賺幾分鐘的帳沒有這件事重要）。
if (loaded.source === 'backup') {
  setTimeout(
    () =>
      hud.showWelcome(
        '主存檔不見了，已經從備份幫你還原進度（可能少掉最後那一小段）。' +
          '建議點右上角的齒輪，複製一份存檔碼收到備忘錄裡。',
      ),
    0,
  );
}

if (!fresh && shouldSuggestHomeScreen()) {
  setTimeout(() => {
    if (!hud.welcomeVisible) hud.showHomeScreenTip();
  }, 0);
}

// ── 玩家動作 ──────────────────────────────────────────
/** 這種液體該倒進啟用區的哪一個盆：普通液體進第一個，特殊液體進它自己的盆 */
function basinIndexFor(liquid: LiquidId): number {
  const mine: number[] = [];
  state.basins.forEach((b, i) => {
    if (b.zone === state.activeZone) mine.push(i);
  });
  if (mine.length === 0) return -1;
  if (!LIQUIDS[liquid].needsBasin) return mine[0] as number;
  return mine.find((i) => state.basins[i]?.preferredLiquid === liquid) ?? (mine[0] as number);
}

/** 按了出貨卻一份都沒出去時的說明。分成「被訂單扣著」與「根本沒甜點」兩種 */
function shipNothingReason(r: ShipResult): string {
  if (r.reserved > 0) {
    const pending = nearestPendingOrder(state);
    if (pending) {
      const { order, short } = pending;
      return `手上的甜點留給訂單了：「${SPECIES[order.species].dessert} ×${order.qty}」還差 ${short} 份才交得出來。`;
    }
    return '手上的甜點都留給訂單了，湊齊份數就會自己交出去。';
  }
  if (hasEquipmentAnywhere(state, 'seller')) return '自動販售口已經幫你賣掉了，沒有甜點要出貨。';
  return '還沒有甜點可以出貨，先按「加工」做一份。';
}

function report(r: { ok: true } | { ok: false; error: string }) {
  if (!r.ok) hud.toast(r.error, true);
  hud.update(state, performance.now(), true);
  return r.ok;
}

/** 新解鎖的一區要放一隻布丁與一個空澡盆 */
function spawnFor() {
  return { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { ...(BASIN_SLOTS[0] as Vec2) } };
}

const hud = new Hud(document.body, {
  pour: (liquid) => report(fillBasin(state, basinIndexFor(liquid), liquid, world.emit)),
  pickAll: () => {
    pickAllDrops(state, world.emit, false, state.activeZone);
    hud.update(state, performance.now(), true);
  },
  craft: () => {
    // 挑原料最多的那個物種做（蛋是共用的，不影響選誰）
    const best = [...SPECIES_IDS].sort((a, b) => state.ingredients[b] - state.ingredients[a])[0] as SpeciesId;
    report(craft(state, best, world.emit));
  },
  ship: () => {
    // 規則在 game/：手動與自動販售口共用同一個函式（含「訂單預留量」），
    // 這裡再抄一份就是上次「出貨把湊到一半的甜點賣掉、訂單永遠交不出去」的成因
    const r = shipDesserts(state, world.emit);
    // 什麼都沒出貨就一定要講話。手上的甜點被進行中的訂單預留住時，這顆鈕是亮的、
    // 按下去卻完全沒有反應也沒有任何字——玩家看到的就是「按鍵壞了」
    // （2026-09-22 使用者回報，存檔碼實證：裝了自動販售口＋一張焦糖 ×3 的單）
    if (r.fulfilled === 0 && r.sold === 0) hud.toast(shipNothingReason(r), true);
    hud.update(state, performance.now(), true);
  },
  fulfill: (id) => report(fulfillOrder(state, id, world.emit)),
  sellIngredients: (s) => report(sellIngredient(state, s, state.ingredients[s], world.emit)),
  sellEggs: () => report(sellEggs(state, state.eggs, world.emit)),
  buyStock: (liquid, qty) => report(buyStock(state, liquid, qty, world.emit)),
  buyEquipment: (id) => report(buyEquipment(state, id, world.emit)),
  buyBasin: (liquid) => {
    const used = basinsIn(state, state.activeZone).length;
    const slot = BASIN_SLOTS[Math.min(used, BASIN_SLOTS.length - 1)] as Vec2;
    report(buySpecialBasin(state, liquid, slot, state.activeZone, world.emit));
  },
  unlockZone: (id) => {
    if (!report(unlockZone(state, id, spawnFor(), world.emit))) return;
    refreshShells();
    focusActiveZone();
    void ensureViews();
  },
  switchZone: (id) => {
    if (report(switchZone(state, id))) focusActiveZone();
  },
  exportSave: () => exportCode(syncForSave(world, Date.now())),
  importSave: (code) => {
    // 匯入之後這個分頁的世界就是過期的了。不先關掉自動存檔的話，
    // reload 觸發的 pagehide 會把匯入前那份狀態原封不動蓋回去（實測踩過）。
    const incoming = importCode(code);
    if (!incoming) return false;
    imported = true;
    overwrite(incoming);
    // 重新載入＝走一次正常的讀檔路徑。在活著的世界裡逐欄位替換才是真的危險
    location.reload();
    return true;
  },
  toggleMute: () => {
    sfx.muted = !sfx.muted;
    return sfx.muted;
  },
});

// ── 事件 → 聲音／粒子／提示 ───────────────────────────
const views = new Map<string, PuddingView>();

function handle(e: SimEvent) {
  const { ox, oy } = activeOrigin();
  switch (e.type) {
    case 'splat':
      sfx.splat(0.42);
      break;
    case 'drop':
      particles.burst(ox + e.x, oy + 0.06, e.z, SPECIES.caramel.toppingColor, 8);
      break;
    case 'pour': {
      // 非啟用層的盆沒畫出來，ox/oy 也是啟用層的；在那裡播會是一條懸空的水流
      if (state.basins[e.basinIndex]?.zone !== state.activeZone) break;
      // 聲音跟著畫面走：同時只畫一組水流，沒畫出來的（被壓掉的並行注液）也不出聲
      if (!pours.begin(state, e.basinIndex, e.liquid, e.units, e.auto, ox, oy)) break;
      // 手動倒是玩家手勢觸發的：走同步解鎖路徑，第一次按就要有聲音；自動注液閥小聲、不等壺進場
      sfx.pour(THICKNESS[e.liquid], flowSeconds(e.units) + 0.1, e.auto ? 0.24 : 0.5, !e.auto, e.auto ? 0 : POUR_ENTER * 0.8);
      break;
    }
    case 'mutate': {
      views.get(e.puddingId)?.pulse();
      particles.burst(ox + e.x, oy + 0.12, e.z, SPECIES[e.to].bodyColor, 22);
      sfx.coin(0.4);
      hud.toast(`突變！變成${SPECIES[e.to].name}`);
      break;
    }
    case 'birth': {
      // 新生兒要先有 view，否則牠只存在於 state、畫面上不會出現任何東西
      void ensureViews();
      refreshShells(); // 名牌上的「住客 N 隻」
      const zoneName = findZone(state, e.zone)?.shortName ?? '';
      if (e.zone === state.activeZone) {
        particles.burst(ox + e.x, oy + 0.1, e.z, SPECIES[e.species].bodyColor, 18);
        hud.toast(`生了一隻${SPECIES[e.species].name}`);
      } else {
        hud.toast(`${zoneName}生了一隻${SPECIES[e.species].name}`);
      }
      sfx.coin(0.3);
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
    case 'levelUp': {
      sfx.coin(0.4);
      const names = unlockedAtLevel(state, e.level).map((x) => x.name);
      hud.toast(names.length ? `店長升到 Lv.${e.level}！商店上架：${names.join('、')}` : `店長升到 Lv.${e.level}！`);
      break;
    }
    default:
      break;
  }
}

/**
 * 賣出的金幣從外帶窗口彈出來、撒在窗前的地板上、消失（D42）。
 *
 * 生成點卡在 z=0.60：窗口 mesh 在 `d/2 − 0.02 = 0.68`、前玻璃在 0.7，
 * 從 0.68 生會卡在窗體裡、落在玻璃後面；布丁地板是 ±0.4，落在 0.42–0.60
 * 這條前緣帶才不會蓋住布丁。沒買販售口時（手動出貨）用同一條帶的正中央。
 */
function spawnCoins(earned: number, ox: number, oy: number) {
  const hasWindow = equipmentIn(state, state.activeZone).seller; // 窗口 mesh 只畫在裝了它的那一區
  const x = ox + (hasWindow ? -0.3 : 0);
  const z = 0.6;
  const y = oy + 0.28; // 窗體頂在 floorY+0.25，從它上緣冒出來才不會第一幀就被擋住
  // 金額越大越多枚，但看得清楚比例更重要：2–6 枚
  const n = Math.max(2, Math.min(6, 2 + Math.floor(earned / 40)));
  coins.burst(x, y, z, n, oy);
  particles.burst(x, y, z, 0xffe08a, 10); // 窗口冒一下，告訴玩家錢是從這裡出來的
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
    const i = nearestBasinIndex(hitBasin.point);
    if (i >= 0) report(fillBasin(state, i, state.basins[i]?.preferredLiquid ?? 'caramel', world.emit));
    return;
  }

  // 點櫃子本身：鎖牌／名牌／鄰櫃 → 對應的那一區。
  // 鎖著的去商店（畫面上寫著價格，玩家自然會去點它）；已解鎖的直接切過去，不必回上面按 ‹ ›。
  const hitTier = raycaster.intersectObjects(tierTargets(), false)[0];
  if (hitTier) tapZone(hitTier.point);
});

const TIER_TARGET_NAMES = new Set(['TankPlates', 'TankLocks', 'TankGlass', 'TankFloors', 'NeighbourLock', 'NeighbourGlass', 'NeighbourWood']);
function tierTargets(): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (TIER_TARGET_NAMES.has(o.name)) out.push(o);
  });
  return out;
}

function tapZone(point: THREE.Vector3) {
  const cabinet = Math.round(point.x / CABINET_PITCH);
  let tier = 0;
  for (let t = 0; t < UNIT.tanks; t++) if (point.y >= zoneWorld(cabinet, t).y - 0.02) tier = t;
  const id = zoneKey(cabinet, tier);
  const z = findZone(state, id);
  if (!z) {
    hud.toast('這一層還沒開放');
    return;
  }
  if (!z.unlocked) {
    hud.openShop('zone');
    return;
  }
  if (z.id !== state.activeZone && report(switchZone(state, z.id))) focusActiveZone();
}

function nearestBasinIndex(point: THREE.Vector3): number {
  const { ox } = activeOrigin();
  let best = -1, bestD = Infinity;
  state.basins.forEach((b, i) => {
    if (b.zone !== state.activeZone) return;
    const d = Math.hypot(ox + b.pos.x - point.x, b.pos.z - point.z);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// ── 存檔 ──────────────────────────────────────────────
let lastSaveAt = performance.now();
let saveWarned = false;
let saveBlocked = false;
let imported = false;
function persist() {
  if (imported) return; // 剛匯入存檔碼、正要重新載入：這份世界已經作廢
  const outcome = save(syncForSave(world, Date.now()));
  if (outcome === 'saved') return;
  if (outcome === 'outdated') {
    // 另一個分頁的進度比這份新。繼續寫下去就是拿舊狀態蓋掉它——
    // 「開著沒關的舊分頁把進度洗掉」就是走這條路徑，所以這裡一個位元組都不寫。
    if (saveBlocked) return;
    saveBlocked = true;
    hud.toast('另一個分頁有更新的進度，這個分頁已停止存檔（重新整理就好）', true);
    return;
  }
  // 靜默失敗最糟：玩家會一路玩下去，然後整份消失。
  if (saveWarned) return;
  saveWarned = true;
  hud.toast('這個瀏覽器存不了進度，關掉分頁就會歸零（無痕模式？）', true);
}
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persist();
    return;
  }
  // 回到前景要補跑那段時間。每幀的 dt 被夾在 0.1 秒（避免一幀跑掉整個世界），
  // 所以切出去十分鐘再回來，不補跑的話那十分鐘就整段消失——手機上這是常態不是例外。
  settleOffline(world, Date.now());
  drainEvents(world);
  last = performance.now(); // 不重設的話下一幀的 dt 會是離開的總時長
  hud.update(state, performance.now(), true);
  // iOS 有時候是靜靜地把繪圖環境收掉，連 webglcontextlost 都不發；回到前景自己查一次
  if (renderer.getContext().isContextLost()) onGlLost();
});
window.addEventListener('pagehide', persist);

// ── 布丁的 view ───────────────────────────────────────
const modelUrl = `${import.meta.env.BASE_URL}models/pudding_base.glb`;
const noPudding = params.get('noPudding') === '1';
let creating = false;

/** 每隻布丁一個 view（最多五隻）；非啟用區的隱藏起來，隱藏的物件不吃 draw call */
async function ensureViews() {
  if (noPudding || creating) return;
  creating = true;
  try {
    for (const p of state.puddings) {
      if (views.has(p.id)) continue;
      const g = await spawnPudding(modelUrl);
      const view = new PuddingView(g, p);
      views.set(p.id, view);
      scene.add(view.root);
    }
  } catch (e) {
    console.error('[lpg] pudding load failed', e);
  } finally {
    creating = false;
  }
}

// ── 主迴圈 ────────────────────────────────────────────
const stats = createStats(renderer, params.get('debug') === '1');
window.__lpg.three = { scene, camera, renderer, controls, raycaster };
window.__lpg.state = state;
window.__lpg.sfx = sfx;
window.__lpg.grantXp = (n) => grantXp(state, n, world.emit);

let last = performance.now();
let bubbleT = 0;

/**
 * HUD 蓋掉上下兩截，把鏡頭的「畫面中心」移到看得見那一段的中心（D26）。
 * 只動投影（setViewOffset），不動 target 與角度：拉遠、環繞、切區都照舊。
 */
function applyHudOffset() {
  const w = container.clientWidth, h = container.clientHeight;
  const dy = viewOffsetY(h, measureVisibleBand(h));
  if (dy === 0) camera.clearViewOffset();
  else camera.setViewOffset(w, h, 0, dy, w, h);
}

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  applyDistance(camera, controls, tierDistance(), cabinetDistance());
  applyHudOffset();
  focusActiveZone(true);
}
window.addEventListener('resize', resize);
// 動作列高度會變（倒○○的按鈕隨解鎖的澡盆變多），變了就重算偏移
applyHudOffset();
if ('ResizeObserver' in window) {
  const dock = document.querySelector('.hud .dock');
  if (dock) new ResizeObserver(applyHudOffset).observe(dock);
}

/**
 * `?pause=1`：時間停住，只重繪；由 `window.__lpg.step(dt)` 一幀一幀推。
 * 給截圖用——無頭 SwiftShader 只有十幾 fps、截一張要幾百毫秒，靠 wall clock 抓不到
 * 「倒到一半」這種只有零點幾秒的畫面。
 */
const paused = params.get('pause') === '1';

function frame(dt: number, now: number) {
  advance(world, dt * fastTime);
  // 同一幀的成交金額要**累加成一次金幣彈出**：`shipDesserts` 是逐物種賣的，
  // 一次出貨可能在同一幀丟出好幾個 sell／orderDone，用「距上次 N 秒才准播」的節流
  // 會把同幀的其他幾筆吃掉（D42）
  let earned = 0;
  for (const e of drainEvents(world)) {
    if (e.type === 'sell' || e.type === 'orderDone') earned += e.coins;
    handle(e);
  }

  const { ox, oy, ceilY } = activeOrigin();
  if (earned > 0) spawnCoins(earned, ox, oy);

  // 泡澡冒泡：靠狀態每隔一段時間生一顆，不必為此發事件
  bubbleT += dt;
  if (bubbleT > 0.22) {
    bubbleT = 0;
    for (const p of puddingsIn(state, state.activeZone)) {
      if (p.mode !== 'bathing') continue;
      const b = p.basinIndex === null ? undefined : state.basins[p.basinIndex];
      const color = p.bathLiquid ? LIQUIDS[p.bathLiquid].color : 0xffffff;
      particles.bubble(ox + (b?.pos.x ?? p.pos.x), oy + 0.06, b?.pos.z ?? p.pos.z, color);
    }
  }

  basins.sync(state, state.activeZone, ox, oy, dt);
  pours.update(state, dt, ox, oy); // 要在 basins.sync 之後：水流的落點讀的是這一幀顯示中的液面
  drops.sync(state, state.activeZone, ox, oy, dt);
  equipment.sync(state, state.activeZone, ox, oy, ceilY);
  particles.update(dt);
  coins.update(dt);

  for (const p of state.puddings) {
    const view = views.get(p.id);
    if (!view) continue;
    const visible = p.zone === state.activeZone;
    view.root.visible = visible;
    if (visible) view.update(p, dt, ox, oy, BASIN_SINK);
  }

  // 切區時把鏡頭平移過去，保留玩家自己轉過的角度與縮放
  moveTmp.copy(desiredTarget).sub(controls.target);
  if (moveTmp.lengthSq() > 1e-7) {
    moveTmp.multiplyScalar(Math.min(1, dt * 4));
    controls.target.add(moveTmp);
    camera.position.add(moveTmp);
  }

  hud.update(state, now);

  // 存檔間隔算真實時間：dt 被夾在 0.1 秒，跟著 dt 累加的話低 fps 的手機會愈存愈稀
  if (now - lastSaveAt > 5000) {
    lastSaveAt = now;
    persist();
  }

  controls.update();
  renderer.render(scene, camera);
  stats.tick();
}

function loop() {
  const now = performance.now();
  // 分頁切回來時 dt 會很大；那段時間交給離線結算，不要在一幀裡補跑
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame(paused ? 0 : dt, now);
}
renderer.setAnimationLoop(loop);
window.__lpg.step = (dt: number) => frame(dt, performance.now());

// ── 繪圖環境被系統回收 ────────────────────────────────
/**
 * iPhone 切去別的 App、或放著很久，iOS 會把 WebGL 的繪圖環境收走（D44）。
 * 症狀是 **HUD 照常在動、訂單照常跳，但 3D 整片只剩背景色**——布丁和櫃子都不見，
 * 看起來完全像存檔壞掉，實際上存檔一個位元組都沒事。
 *
 * three 自己會 `preventDefault()` 並在還原時重建 GL 物件，但它不會告訴玩家，
 * 也不會把環境貼圖做回來；而 iOS 常常根本不還原，那就只能重新整理。
 * 所以這裡做三件事：停迴圈（畫不出東西還在跑只是耗電）、先存檔、給玩家一條出路。
 */
let glLost = false;

function onGlLost() {
  if (glLost) return;
  glLost = true;
  persist(); // 收掉繪圖環境之後常常連分頁一起被丟掉，進度先寫下去
  renderer.setAnimationLoop(null);
  hud.showContextLost();
}

function onGlRestored() {
  if (!glLost) return;
  glLost = false;
  buildEnvironment();
  // 空白的那段時間照離線結算補回來，跟切到背景再回來走同一條路
  settleOffline(world, Date.now());
  drainEvents(world);
  last = performance.now();
  hud.hideContextLost();
  hud.update(state, last, true);
  renderer.setAnimationLoop(loop);
}

renderer.domElement.addEventListener('webglcontextlost', onGlLost);
renderer.domElement.addEventListener('webglcontextrestored', onGlRestored);

// ── PWA：註冊 service worker（只在正式版）──────────────
// dev 不註冊：Vite 的 public/ 在開發時也會被服務到，快取住 dev 資產會讓 HMR 行為變得很難查。
if (import.meta.env.PROD && 'serviceWorker' in navigator && params.get('nosw') !== '1') {
  /**
   * 把這一輪實際載到的同源資源清單交給 SW 去補快取。
   * 第一次載入時 SW 還沒接管，那些檔案是繞過 SW 抓的；不補的話
   * 「加入主畫面後第一次離線開」會是白畫面。
   */
  const warm = async () => {
    const reg = await navigator.serviceWorker.ready;
    const urls = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.startsWith(location.origin) && !u.includes('/sw.js'));
    // 商品圖是開商店才會抓的，不在這一輪的資源清單裡；離線第一次開商店也要有圖，所以一併補
    const art = SHOP_ART_URLS.map((u) => new URL(u, location.href).href);
    reg.active?.postMessage({ type: 'warm', urls: [location.href.split('?')[0], ...new Set([...urls, ...art])] });
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      // GLB 是在 load 之後才抓的，等模型掛上去再補一次才收得齊
      .then(() => ensureViews().then(warm))
      .catch((e) => console.error('[lpg] service worker 註冊失敗', e));
  });
}

void ensureViews().then(() => {
  // ready 要等模型真的掛上去才翻：e2e 的三角形斷言靠它當閘門
  stats.stats.ready = true;
});
