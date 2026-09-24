import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buyEquipment,
  buyPantry,
  buySpecialBasin,
  buyStock,
  fillBasin,
  movePudding,
  pickAllDrops,
  pickDrop,
  puddingSaleBlock,
  sellEggs,
  sellIngredient,
  sellPudding,
  setZoneMode,
  switchZone,
  unlockZone,
} from './game/actions';
import { useStarTonic } from './game/stars';
import { REGULARS, awaySummary, deliverOrder, markStorySeen } from './game/regulars';
import { claimAchievement, claimAllAchievements } from './game/achievements';
import { STATIONS, STATION_IDS, buyFame, buyMachine, fulfillOrder, machineNextPrice, shelfOne, startBatch, stationStatus, stockShelf, type StationId } from './game/bakery';
import { STARS, addStock, stockOf, takeStock, totalStock } from './game/stock';
import { MACHINE_TIER_NAMES, dessertLook, dessertName } from './game/recipes';
import type { SimEvent } from './game/events';
import { BALANCE } from './game/balance';
import { grantXp } from './game/level';
import { puddingMood } from './game/pudding';
import {
  BASIN_RADIUS,
  clampToTank,
  equipmentPos,
  findFreeSpot,
  furnitureIn,
  isDraggable,
  moveFurniture,
  placeFromStorage,
  placementError,
  storageError,
  storageSpot,
  storeFurniture,
  type FurnitureRef,
} from './game/furniture';
import { dumpWarning, parseRefKey } from './ui/storage';
import { unlockedAtLevel } from './game/shop';
import { advance, createWorld, drainEvents, settleOffline, syncForSave } from './game/sim';
import { LIQUIDS, SPECIES, SPECIES_IDS, type LiquidId, type SpeciesId } from './game/species';
import { exportCode, importCode } from './game/savecode';
import { load, overwrite, save, useTestSave } from './game/storage';
import { createNewSave, type GameState, type Vec2 } from './game/state';
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
import { BakeryView } from './scene/bakery/bakeryView';
import { Particles } from './scene/particles';
import { ENTER as POUR_ENTER, PourView, THICKNESS, flowSeconds } from './scene/pourView';
import { PuddingView } from './scene/puddingView';
import { loadPuddingParts, PuddingPool } from './scene/puddingPool';
import { MoodIcons } from './scene/moodIcons';
import { Sfx } from './scene/audio';
import { nextHint } from './ui/hints';
import { shouldSuggestHomeScreen } from './ui/homeScreen';
import { Hud, type GameView, type HudActions } from './ui/hud';
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

/**
 * 甜點工坊（D51）：獨立的 scene＋鏡頭，只有切到「甜點店」時才畫。
 * `?view=bakery` 直接開在工坊（e2e 與截圖用）。
 */
const bakery = new BakeryView();
bakery.resize(container.clientWidth / container.clientHeight);
let view: GameView = params.get('view') === 'bakery' ? 'bakery' : 'farm';

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
  // 前兩個是開局的兩隻；後面的是 `?pop=` 量 draw call 時才用得到的落點，
  // 補到 15 個（＝D41 的 `zoneCapacity` 上限）才量得到滿層的基準。地板 x∈±0.875、z∈±0.4，避開澡盆 (−0.52, 0.12)
  puddingPositions: [
    { x: 0.05, z: 0.1 },
    { x: 0.5, z: -0.02 },
    { x: -0.45, z: 0.14 },
    { x: -0.12, z: -0.26 },
    { x: 0.7, z: 0.24 },
    { x: -0.75, z: -0.3 },
    { x: -0.3, z: -0.32 },
    { x: 0.25, z: -0.3 },
    { x: 0.75, z: -0.28 },
    { x: -0.2, z: 0.3 },
    { x: 0.3, z: 0.32 },
    { x: 0.55, z: 0.1 },
    { x: -0.8, z: 0.3 },
    { x: 0.8, z: 0.05 },
    { x: -0.25, z: 0.0 },
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
      // 精養區（D62）在名牌上講清楚：上限 5 隻、只有這裡會長星
      sub: !z.unlocked ? `${z.price} 焦糖幣` : z.mode === 'elite' ? `精養 ${n}/${BALANCE.eliteCapacity} 隻` : `住客 ${n} 隻`,
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
  const before = { coins: state.coins, baths: state.stats.baths, days: state.stats.daysClosed, served: state.stats.served, time: state.time };
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
            (state.stats.daysClosed > before.days || state.stats.served > before.served
              ? `甜點店營業了 ${state.stats.daysClosed - before.days} 天，客人買走 ${state.stats.served - before.served} 次。`
              : '') +
            awayText(before.time) +
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

/**
 * 「你不在的時候」常客的摘要（D66／AC11-9）：從 `regulars[*].lastResult` 推導，不是逐條 toast——
 * 離線一次可能跑 24 個營業日，每位常客來兩三次，逐條講會把畫面塞爆。
 */
function awayText(since: number): string {
  const rows = awaySummary(state, since);
  if (!rows.length) return '';
  return rows
    .map(({ id, result: r }) => (r.bought && r.dessert
      ? `${REGULARS[id].name}來過，買了 ★${r.star} ${dessertName(r.dessert)}。`
      : `${REGULARS[id].name}來過，但架上沒有想買的。`))
    .join('');
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

function report(r: { ok: true } | { ok: false; error: string }) {
  if (!r.ok) hud.toast(r.error, true);
  hud.update(state, performance.now(), true);
  return r.ok;
}

/** 新解鎖的一區要放一隻布丁與一個空澡盆 */
function spawnFor() {
  return { puddingPos: { x: 0.1, z: 0.05 }, basinPos: { ...(BASIN_SLOTS[0] as Vec2) } };
}

const hudActions: HudActions = {
  pour: (liquid) => report(fillBasin(state, basinIndexFor(liquid), liquid, world.emit)),
  pickAll: () => {
    pickAllDrops(state, world.emit, false, state.activeZone);
    hud.update(state, performance.now(), true);
  },
  setView: (v) => setView(v),
  startBatch: (species, qty, star) => report(startBatch(state, species, qty, world.emit, star)),
  shelfOne: (id, star) => report(shelfOne(state, id, star, world.emit)),
  movePudding: (pid, zone) => {
    if (!report(movePudding(state, pid, zone, world.emit))) return;
    refreshShells(); // 名牌上的住客數
    hud.toast(`搬到${findZone(state, zone)?.shortName ?? ''}了`);
  },
  useTonic: (pid) => report(useStarTonic(state, pid, world.emit)),
  readStory: (id, ch) => {
    markStorySeen(state, id, ch);
    hud.update(state, performance.now(), true);
  },
  sellPuddingById: (pid) => report(sellPudding(state, pid, world.emit)),
  setZoneMode: (zone, mode) => {
    if (!report(setZoneMode(state, zone, mode, world.emit))) return;
    refreshShells();
  },
  buyMachine: (id) => report(buyMachine(state, id, world.emit)),
  buyFame: () => report(buyFame(state, world.emit)),
  // 機器頭上的標籤：還能升級＝開商店工坊頁、捲到這台並標亮；滿級了就跟點 3D 機器一樣講它在做什麼
  stationTag: (id) => {
    if (machineNextPrice(state, id) !== null) hud.openShop('bakery', `machine:${id}`);
    else tapStation(id);
  },
  buyPantry: (id, qty) => report(buyPantry(state, id, qty, world.emit)),
  stockShelf: () => {
    // 什麼都沒擺上去一定要講為什麼（D39 的教訓：按了沒反應＝玩家以為壞了）
    if (stockShelf(state, world.emit) === 0) hud.toast(shelfNothingReason(), true);
    hud.update(state, performance.now(), true);
  },
  claimAchievement: (id) => report(claimAchievement(state, id, world.emit)),
  claimAllAchievements: () => {
    claimAllAchievements(state, world.emit);
    hud.update(state, performance.now(), true);
  },
  sellPudding: (species) => {
    // 優先賣「正在看的這一區」的那隻：玩家在看著的那一區少一隻，才看得到賣掉這件事
    const candidates = state.puddings.filter((p) => p.species === species && puddingSaleBlock(state, p.id) === null);
    const p = candidates.find((x) => x.zone === state.activeZone) ?? candidates[0];
    if (!p) {
      const any = state.puddings.find((x) => x.species === species);
      hud.toast(any ? (puddingSaleBlock(state, any.id) ?? '現在沒有可以賣的') : '沒有這種布丁', true);
      return;
    }
    report(sellPudding(state, p.id, world.emit));
  },
  // 常客的特別訂單交了要 +2 心（D67），所以一律走 `deliverOrder`（它包著 fulfillOrder）
  fulfill: (id) => report(deliverOrder(state, id, world.emit)),
  sellIngredients: (s, star) => report(sellIngredient(state, s, stockOf(state, 'ingredients', s, star), world.emit, star)),
  sellEggs: () => report(sellEggs(state, state.eggs, world.emit)),
  buyStock: (liquid, qty) => report(buyStock(state, liquid, qty, world.emit)),
  buyEquipment: (id) => report(buyEquipment(state, id, world.emit)),
  buyBasin: (liquid) => {
    const used = basinsIn(state, state.activeZone).length;
    const slot = BASIN_SLOTS[Math.min(used, BASIN_SLOTS.length - 1)] as Vec2;
    // 家具可以被拖到任何地方（D49），預設格位可能已經被佔了：從那附近找一個空位
    const spot = findFreeSpot(state, state.activeZone, { kind: 'basin', index: -1 }, slot) ?? slot;
    report(buySpecialBasin(state, liquid, spot, state.activeZone, world.emit));
  },
  placeFurniture: (key) => takeFromStorage(key),
  editOk: () => confirmEdit(),
  editCancel: () => endEdit(),
  editStore: () => storeEdit(),
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
};
const hud = new Hud(document.body, hudActions);

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
    case 'starUp': {
      // 升星（D62）：頭上冒一圈金色星星。不在看的那一區只給 toast（畫面上看不到牠）
      const p = state.puddings.find((x) => x.id === e.puddingId);
      if (!p) break;
      if (p.zone === state.activeZone) {
        views.get(p.id)?.pulse();
        particles.burst(ox + p.pos.x, oy + 0.22, p.pos.z, 0xf7c95a, 26);
      }
      sfx.coin(0.45);
      hud.toast(`${e.byTonic ? '喝了升星藥，' : ''}${SPECIES[p.species].name}升到 ★${e.star}！`);
      break;
    }
    case 'zoneMode':
      hud.toast(e.mode === 'elite'
        ? `${findZone(state, e.zone)?.shortName ?? ''}改成精養區：泡本命液的布丁會慢慢升星`
        : `${findZone(state, e.zone)?.shortName ?? ''}改回量產`);
      break;
    case 'sell':
      sfx.coin(0.26);
      hud.toast(`賣給商店，+${e.coins}`);
      break;
    case 'puddingSold': {
      // scene 從來只有「出生」沒有「離開」：view 不拿掉的話 state 少一隻、畫面上牠還在跳（AC8-6）
      const v = views.get(e.puddingId);
      if (v) {
        scene.remove(v.root);
        views.delete(e.puddingId);
      }
      refreshShells(); // 名牌上的住客數
      sfx.coin(0.3);
      hud.toast(`賣出一隻${SPECIES[e.species].name}，+${e.coins}`);
      break;
    }
    case 'bakeStep':
      if (!e.auto && view === 'bakery') sfx.splat(0.18);
      break;
    case 'bakeDone':
      // D57 起線上自己走，出爐一律是 auto；離線那幾百盤在 drainEvents 就丟了，這裡一盤最多一則
      sfx.coin(0.32);
      // D60：看著工坊時是一張大字卡（同一幀好幾盤出爐合併成一張）；在農場就只給一則 toast
      if (view === 'bakery') hud.bakeBanner(dessertName(e.species), e.qty);
      else hud.toast(`出爐！${dessertName(e.species)} ×${e.qty} 放進成品櫃`);
      break;
    case 'tierUp':
      sfx.coin(0.4);
      hud.toast(`${e.what}升上${MACHINE_TIER_NAMES[e.tier - 1]}級！機器前的星星換成${MACHINE_TIER_NAMES[e.tier - 1]}色`);
      break;
    case 'bakeFailed':
      hud.toast(`${dessertName(e.species)}失敗了 ${e.qty} 份（升級機器可以少失敗）`, true);
      break;
    case 'customer':
      // 客人演出只在看著工坊時播；離線結算的那幾百位早在 drainEvents 丟掉了
      if (view === 'bakery') {
        bakery.customerCame(e.species);
        sfx.coin(0.16);
      }
      break;
    case 'customerMissed':
      if (view === 'bakery') bakery.customerCame(null);
      break;
    // ── 常客（D66／D67）。離線那幾天的在 drainEvents 就丟了，回來看「歡迎回來」卡的摘要 ──
    case 'regularVisit': {
      const name = REGULARS[e.id].name;
      if (view === 'bakery') {
        bakery.regularCame(e.id, e.bought, e.dessert && dessertLook(e.dessert));
        if (e.bought) sfx.coin(0.3);
      } else {
        hud.toast(e.bought && e.dessert ? `${name}來店裡買了 ★${e.star} ${dessertName(e.dessert)}，+${e.coins}` : `${name}來了，架上沒有想買的甜點`, !e.bought);
      }
      if (e.gift) hud.toast(e.gift === 'tonic' ? `${name}送你一瓶升星藥！（布丁卡裡用）` : `${name}送你幾份原料`);
      break;
    }
    case 'regularUnlocked':
      hud.toast(`新常客：${REGULARS[e.id].name}會來店裡（甜點店右邊的愛心鈕看口味）`);
      break;
    case 'regularOrder':
      hud.toast(`${REGULARS[e.id].name}下了一張特別訂單（預訂單裡看）`);
      break;
    case 'hearts':
      if (e.reached === 10) hud.toast(`${REGULARS[e.id].name} ♥10：故事完結章，招牌甜點上了菜單！`);
      else if (e.reached === 2 || e.reached === 8) hud.toast(`${REGULARS[e.id].name} ♥${e.reached}：解鎖新的故事章節`);
      else if (e.reached === 4) hud.toast(`${REGULARS[e.id].name} ♥4：之後來店會下特別訂單`);
      else if (e.reached === 6) hud.toast(`${REGULARS[e.id].name} ♥6：之後買到有時會送禮`);
      break;
    case 'dayClosed':
      // 只會在「開著遊戲時剛好打烊」走到這裡（離線那 24 天的事件在 drainEvents 就丟了），
      // 所以一天最多一則；昨日營收另外常駐在工坊的日曆列上。
      // 機器還沒買齊、整天沒開張（D57 閘門：不來客）就不講——「營收 0，客人 0 位」只是雜訊
      if (e.revenue === 0 && e.served === 0 && e.missed === 0) break;
      hud.toast(`第 ${e.day} 天打烊：營收 ${Math.floor(e.revenue)}，客人 ${e.served} 位${e.missed ? `，${e.missed} 位沒買到` : ''}`);
      break;
    case 'achievement':
      sfx.coin(0.4);
      hud.toast(`成就「${e.name}」+${e.reward}`);
      break;
    case 'achievementsClaimed':
      sfx.coin(0.4);
      hud.toast(`領了 ${e.count} 個成就，+${e.reward}`);
      break;
    case 'orderDone':
      sfx.coin(0.36);
      hud.toast(`訂單成交，+${e.coins}`);
      break;
    case 'orderNew':
      hud.toast(`新訂單：${dessertName(e.species)} × ${e.qty}`);
      break;
    case 'orderExpired':
      hud.toast(`訂單過期了：${dessertName(e.species)}`, true);
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
 * 賣出的金幣撒在地板上再消失（D42）。D50 起販售口退役，一律從前緣帶 z=0.6 正中央生：
 * 布丁地板是 ±0.4，落在 0.42–0.60 這條帶才不會蓋住布丁。
 */
function spawnCoins(earned: number, ox: number, oy: number) {
  const x = ox;
  const z = 0.6;
  const y = oy + 0.28;
  // 金額越大越多枚，但看得清楚比例更重要：2–6 枚
  const n = Math.max(2, Math.min(6, 2 + Math.floor(earned / 40)));
  coins.burst(x, y, z, n, oy, Math.random, 'both');
  particles.burst(x, y, z, 0xffe08a, 10);
}

// ── 工坊的動作 ────────────────────────────────────────
/** 切換農場／工坊：HUD 換一組按鈕、主迴圈換一個 scene 畫 */
function setView(v: GameView) {
  view = v;
  hud.setView(v);
  controls.enabled = v === 'farm'; // 工坊是固定鏡頭；不關的話在工坊裡拖手指會偷偷轉農場的鏡頭
  if (edit) endEdit();
  applyHudOffset();
  hud.update(state, performance.now(), true);
}

/**
 * 點 3D 的某台機器（D57 起不用推站，線上自己走）：
 * 沒買＝說明並把商店開在工坊頁；上面有一盤＝講它在做什麼、還要幾秒；空著＝開菜單。
 * 每一種情況都要講得出話（D39：按了沒反應＝玩家以為壞了）。
 */
function tapStation(id: StationId) {
  if (state.bakery.machines[id] === 0) {
    hud.toast(`還沒有${STATIONS[id].name}：到商店的「工坊」頁購買`);
    hud.openShop('bakery');
    return;
  }
  const b = state.bakery.stations[id].batch;
  if (b) {
    const left = Math.max(0, Math.ceil(state.bakery.stations[id].doneAt - state.time));
    const what = dessertName(b.species);
    hud.toast(stationStatus(state, id) === 'working'
      ? `${STATIONS[id].name}正在${STATIONS[id].verb}${what}，再 ${left} 秒`
      : `${what}在${STATIONS[id].name}等下一台空出來`);
    return;
  }
  hud.openMenu();
}

/** 按了上架卻一份都沒擺上去的原因 */
function shelfNothingReason(): string {
  const total = totalStock(state, 'desserts');
  if (total === 0) return '成品櫃是空的：做完一盤甜點（裝飾台做完點一下）才有東西上架。';
  const onShelf = totalStock(state, 'shelf');
  if (onShelf >= BALANCE.bakery.shelfCap) return `展示架滿了（${BALANCE.bakery.shelfCap} 份），等客人買走再補。`;
  return '成品櫃裡的甜點都留給預訂單了，交完訂單再上架。';
}

// ── 觸控：點掉落物撿起來、點澡盆倒液體 ────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = { x: 0, y: 0, t: 0 };

renderer.domElement.addEventListener('pointerdown', (ev) => {
  downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  if (view === 'bakery') return; // 工坊沒有家具可以長按搬
  if (edit) {
    startEditDrag(ev);
    return;
  }
  armLongPress(ev);
});
renderer.domElement.addEventListener('pointerup', (ev) => {
  // 擺放模式（D49）裡的放手只是「放開手指」，不是點擊：不然放在澡盆上會順手倒一份液體
  if (edit) {
    edit.dragging = false;
    return;
  }
  cancelLongPress();
  // 只有「短按而且幾乎沒移動」才算點擊，否則那是在環繞鏡頭
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
  if (moved > 10 || performance.now() - downAt.t > 400) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);

  if (view === 'bakery') {
    // 點機器＝點 HUD 上那一站；點展示櫃／成品櫃＝上架
    raycaster.setFromCamera(pointer, bakery.camera);
    const hit = bakery.pick(raycaster);
    if (hit === 'shelf' || hit === 'rack') hud.openShelf();
    else if (hit) tapStation(hit as StationId);
    return;
  }
  raycaster.setFromCamera(pointer, camera);

  const hitDrop = raycaster.intersectObject(drops.mesh, false)[0];
  if (hitDrop) {
    const id = drops.idAt(hitDrop.instanceId);
    if (id) {
      report(pickDrop(state, id, world.emit));
      return;
    }
  }

  // 點布丁＝布丁卡（D70）：星級、照顧進度、搬家。instance 的順序跟這一幀 pool.add 的順序一樣（`poolIds`）
  // InstancedMesh 的 raycast 先用包圍球篩，而包圍球只在第一次算、之後不會跟著 instance 矩陣更新——
  // 布丁一直在跳，不重算的話點得到點不到看運氣。最多 16 個 instance，重算很便宜
  if (pool?.body.visible) pool.body.computeBoundingSphere();
  const hitPud = pool && pool.body.visible ? raycaster.intersectObject(pool.body, false)[0] : undefined;
  if (hitPud && hitPud.instanceId !== undefined) {
    const id = poolIds[hitPud.instanceId];
    if (id) {
      hud.openPudding(id);
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

// ── 擺放模式（D49） ─────────────────────────────────
/**
 * 照一般手機經營遊戲的做法（Hay Day／動森）：家具要「拿起來」才能動，拿起來之後停在擺放模式，
 * 畫面下方換成一排「收進倉庫／取消／確定」，按確定才寫進 state。
 * 兩個入口：① 長按櫥窗裡的家具 `LONG_PRESS_MS`；② 倉庫卡點一件——拿出來就在擺放模式裡，可以直接拖。
 * 擺放模式中鏡頭不轉，手指在畫面任何地方拖都是在拖這件家具（手指小、家具更小，要求按準它是折磨）。
 * 合不合法的判定全在 `game/furniture.ts`，這裡只負責預覽。
 */
const LONG_PRESS_MS = 450;
let pressTimer = 0;
let pressRef: FurnitureRef | null = null;
/** 長按時手指打到家具的那一點（世界座標）：拖曳平面取它的高度，否則按機身一拖就跳到後牆 */
const pressHit = new THREE.Vector3();
interface Edit {
  ref: FurnitureRef;
  /** 拿起來的那一區；切區就視同取消 */
  zone: string;
  pos: Vec2;
  valid: boolean;
  /** 從倉庫拿出來的（state 裡還在倉庫，按確定才擺進來） */
  fromStorage: boolean;
  /** 設備單獨做成一台 mesh 跟著手指走（澡盆直接用 BasinsView 的預覽） */
  mesh: THREE.Mesh | null;
  /** 手指正按著在拖 */
  dragging: boolean;
  /** 拖曳平面的世界高度 */
  planeY: number;
  /** 家具中心－手指落點（區域座標）：家具跟著手指「平移」，不是跳到手指底下 */
  dx: number;
  dz: number;
}
let edit: Edit | null = null;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragHit = new THREE.Vector3();
const ringMat = new THREE.MeshBasicMaterial({ color: 0x7cb85c, transparent: true, opacity: 0.85, depthTest: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), ringMat);
ring.rotation.x = -Math.PI / 2;
ring.renderOrder = 12;
ring.visible = false;
ring.name = 'DragRing';
scene.add(ring);
// iOS 長按會跳放大鏡／選字選單，會把長按手勢吃掉
renderer.domElement.style.setProperty('-webkit-touch-callout', 'none');
renderer.domElement.style.setProperty('-webkit-user-select', 'none');
renderer.domElement.style.userSelect = 'none';

function setPointer(ev: { clientX: number; clientY: number }) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

/**
 * 手指底下是哪一件家具：打到澡盆或設備的 mesh，再在**同一類**裡挑離打點最近的那件。
 * 分類要看打到哪個 group：注液閥就掛在澡盆正上方，只比水平距離會分不出按的是管子還是盆。
 */
function furnitureUnder(ev: PointerEvent): FurnitureRef | null {
  setPointer(ev);
  const hit = raycaster.intersectObjects([...basins.group.children, ...equipment.group.children], false)[0];
  if (!hit) return null;
  pressHit.copy(hit.point);
  const kind = basins.group.children.includes(hit.object) ? 'basin' : 'equipment';
  const { ox } = activeOrigin();
  const lx = hit.point.x - ox, lz = hit.point.z;
  let best: FurnitureRef | null = null, bestD = Infinity;
  for (const f of furnitureIn(state, state.activeZone)) {
    if (f.ref.kind !== kind) continue;
    const d = Math.hypot(f.pos.x - lx, f.pos.z - lz);
    if (d < bestD) { bestD = d; best = f.ref; }
  }
  return bestD < 0.45 ? best : null;
}

function armLongPress(ev: PointerEvent) {
  cancelLongPress();
  if (!ev.isPrimary) return;
  pressRef = furnitureUnder(ev);
  if (!pressRef) return;
  pressTimer = window.setTimeout(() => {
    const ref = pressRef;
    pressRef = null;
    if (!ref) return;
    // 手指還按著：拿起來就直接進入拖曳，偏移從手指按到的那一點算
    const { ox } = activeOrigin();
    const pos = currentPos(ref);
    beginEdit(ref, pos, false);
    if (edit) {
      edit.dragging = true;
      edit.planeY = pressHit.y;
      edit.dx = pos.x - (pressHit.x - ox);
      edit.dz = pos.z - pressHit.z;
    }
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  if (pressTimer) window.clearTimeout(pressTimer);
  pressTimer = 0;
  pressRef = null;
}

function currentPos(ref: FurnitureRef): Vec2 {
  if (ref.kind === 'basin') return { ...(state.basins[ref.index]?.pos ?? { x: 0, z: 0 }) };
  return { ...equipmentPos(state, state.activeZone, ref.id) };
}

function footprintRadius(ref: FurnitureRef): number {
  if (ref.kind === 'basin') return BASIN_RADIUS + 0.03;
  return ref.id === 'collector' ? 0.09 : 0.14;
}

/** 不是從長按進來的拖曳（倉庫拿出來、放開後再拖）：平面取這件家具大約中段的高度 */
function grabHeight(ref: FurnitureRef): number {
  if (ref.kind === 'basin') return 0.05;
  if (ref.id === 'collector') return TANK.height - 0.3;
  return ref.id === 'autoFill' ? 0.3 : 0.15;
}

function editValid(e: Edit): boolean {
  if (e.fromStorage) return !storageError(state, e.zone, e.ref) && !placementError(state, e.zone, e.ref.kind === 'basin' ? { kind: 'basin', index: -1 } : e.ref, e.pos);
  return isDraggable(e.ref) && !placementError(state, e.zone, e.ref, e.pos);
}

function beginEdit(ref: FurnitureRef, pos: Vec2, fromStorage: boolean) {
  endEdit();
  const { oy, ceilY } = activeOrigin();
  controls.enabled = false; // 擺放模式中手指是拖家具，不轉鏡頭
  edit = { ref, zone: state.activeZone, pos: { ...pos }, valid: true, fromStorage, mesh: null, dragging: false, planeY: oy + grabHeight(ref), dx: 0, dz: 0 };
  edit.valid = editValid(edit);
  if (ref.kind === 'equipment') {
    edit.mesh = equipment.buildDragMesh(ref.id, oy, ceilY);
    scene.add(edit.mesh);
  }
  const r = footprintRadius(ref);
  ring.scale.set(r, r, 1);
  ring.visible = true;
  placeEditVisuals();
  hud.showEditBar({ canStore: !fromStorage, movable: isDraggable(ref), ok: edit.valid });
  navigator.vibrate?.(12);
}

function placeEditVisuals() {
  if (!edit) return;
  const { ox, oy } = activeOrigin();
  edit.mesh?.position.set(ox + edit.pos.x, 0, edit.pos.z);
  ring.position.set(ox + edit.pos.x, oy + 0.006, edit.pos.z);
  ringMat.color.setHex(edit.valid ? 0x7cb85c : 0xe5704f);
}

/** 擺放模式中手指按下：從這裡開始拖（不必按準家具） */
function startEditDrag(ev: PointerEvent) {
  if (!edit || !isDraggable(edit.ref)) return;
  setPointer(ev);
  dragPlane.constant = -edit.planeY;
  if (!raycaster.ray.intersectPlane(dragPlane, dragHit)) return;
  const { ox } = activeOrigin();
  edit.dx = edit.pos.x - (dragHit.x - ox);
  edit.dz = edit.pos.z - dragHit.z;
  edit.dragging = true;
}

renderer.domElement.addEventListener('pointermove', (ev) => {
  if (pressRef && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 10) cancelLongPress();
  if (!edit || !edit.dragging || !isDraggable(edit.ref)) return;
  const { ox } = activeOrigin();
  setPointer(ev);
  dragPlane.constant = -edit.planeY;
  if (!raycaster.ray.intersectPlane(dragPlane, dragHit)) return;
  edit.pos = clampToTank(edit.ref, { x: dragHit.x - ox + edit.dx, z: dragHit.z + edit.dz });
  edit.valid = editValid(edit);
  placeEditVisuals();
  hud.setEditOk(edit.valid);
});
renderer.domElement.addEventListener('pointercancel', () => {
  cancelLongPress();
  if (edit) edit.dragging = false;
});

/** 離開擺放模式（不寫入）。回傳剛才是不是在擺放模式 */
function endEdit(): boolean {
  if (!edit) return false;
  const e = edit;
  edit = null;
  if (e.mesh) {
    scene.remove(e.mesh);
    e.mesh.geometry.dispose();
  }
  ring.visible = false;
  hud.hideEditBar();
  controls.enabled = true;
  return true;
}

/** 按「確定」：搬家或從倉庫擺出來，規則在 `game/furniture.ts` */
function confirmEdit() {
  if (!edit) return;
  const e = edit;
  if (e.fromStorage) {
    const r = placeFromStorage(state, e.zone, e.ref, e.pos);
    if (!r.ok) {
      hud.toast(r.error, true);
      return; // 留在擺放模式讓玩家換個位置
    }
    if (r.message) hud.toast(r.message);
  } else if (isDraggable(e.ref)) {
    const r = moveFurniture(state, e.zone, e.ref, e.pos);
    if (!r.ok) {
      hud.toast(r.error, true);
      return;
    }
  }
  endEdit();
  hud.update(state, performance.now(), true);
}

/** 按「收進倉庫」；盆裡還有液體就先跳確認卡（收起來＝倒掉，D49） */
function storeEdit() {
  if (!edit || edit.fromStorage) return;
  const { ref, zone } = edit;
  endEdit();
  const doStore = () => {
    const r = storeFurniture(state, zone, ref);
    if (r.ok && r.message) hud.toast(r.message);
    report(r);
  };
  const warn = dumpWarning(state, ref);
  if (warn) hud.confirmStore(warn, doStore);
  else doStore();
}

/** 倉庫卡點了一件：拿出來、直接進擺放模式 */
function takeFromStorage(key: string) {
  const ref = parseRefKey(key);
  if (!ref) return;
  const bad = storageError(state, state.activeZone, ref);
  if (bad) {
    hud.toast(bad, true);
    return;
  }
  const spot = storageSpot(state, state.activeZone, ref);
  if (!spot) {
    hud.toast('這一區擺不下了，先把別的收起來', true);
    return;
  }
  beginEdit(ref, spot, true);
}

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
/** 所有布丁共用的 InstancedMesh（D41）；GLB 載好才有 */
let pool: PuddingPool | null = null;
/** 這一幀 pool 裡第 i 個 instance 是哪一隻布丁（點布丁開布丁卡用，D70） */
const poolIds: string[] = [];
/** 頭頂小圖示（D48）：想泡澡／幼布丁，取代原本左側的狀態卡 */
const moodIcons = new MoodIcons();
scene.add(moodIcons.mesh);

/** 每隻布丁一個 view（只是骨架，mesh 在 pool 裡）；非啟用區的每幀不進 pool，就不吃 draw call */
async function ensureViews() {
  if (noPudding || creating) return;
  creating = true;
  try {
    if (!pool) {
      pool = new PuddingPool(await loadPuddingParts(modelUrl));
      scene.add(pool.body, pool.eyes);
    }
    for (const p of state.puddings) {
      if (views.has(p.id)) continue;
      const view = new PuddingView(pool.parts, p);
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
window.__lpg.bakery = bakery;
window.__lpg.setView = (v: GameView) => setView(v);
window.__lpg.sfx = sfx;
window.__lpg.grantXp = (n) => grantXp(state, n, world.emit);
window.__lpg.stock = {
  of: (kind, id, star) => stockOf(state, kind, id as SpeciesId, star),
  add: (kind, id, star, n) => addStock(state, kind, id as SpeciesId, star, n),
  set: (kind, id, counts) => {
    for (const star of STARS) {
      const now = stockOf(state, kind, id as SpeciesId, star);
      takeStock(state, kind, id as SpeciesId, star, now);
      addStock(state, kind, id as SpeciesId, star, Math.max(0, Math.floor(counts[star - 1] ?? 0)));
    }
  },
};
window.__lpg.toScreen = (x, y, z) => {
  const { ox, oy } = activeOrigin();
  const v = new THREE.Vector3(ox + x, oy + y, z).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
};

let last = performance.now();
let bubbleT = 0;

/**
 * HUD 蓋掉上下兩截，把鏡頭的「畫面中心」移到看得見那一段的中心（D26）。
 * 只動投影（setViewOffset），不動 target 與角度：拉遠、環繞、切區都照舊。
 */
function applyHudOffset() {
  const w = container.clientWidth, h = container.clientHeight;
  const band = measureVisibleBand(h);
  const dy = viewOffsetY(h, band);
  for (const cam of [camera, bakery.camera]) {
    if (dy === 0) cam.clearViewOffset();
    else cam.setViewOffset(w, h, 0, dy, w, h);
  }
  // 工坊的動作列比農場高（五站＋上架），可見段不一樣：切畫面時重框一次
  bakery.resize(w / h, (band.bottom - band.top) / h);
  placeStationTags();
}

/**
 * 機器頭上的標籤（份數／進度條／升級）跟著鏡頭定位：工坊鏡頭固定，只在重框後、日曆卡高度變了之後算一次。
 * 整塊標籤要在日曆卡下緣以下——後排四台的頭頂剛好在日曆卡的高度。
 */
function placeStationTags() {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = bakery.stationNdc();
  const pts = {} as Record<StationId, { x: number; y: number }>;
  for (const id of STATION_IDS) {
    pts[id] = { x: rect.left + ((ndc[id].x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc[id].y) / 2) * rect.height };
  }
  const day = document.querySelector('.daybar')?.getBoundingClientRect();
  hud.tags.place(pts, day && day.height > 0 ? day.bottom : 0);
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
// 日曆卡多一行「流水線上 N 盤」就長高：標籤要跟著往下讓
const daybarEl = document.querySelector('.daybar');
if (daybarEl && 'ResizeObserver' in window) new ResizeObserver(() => placeStationTags()).observe(daybarEl);
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
    if (e.type === 'sell' || e.type === 'puddingSold') earned += e.coins;
    handle(e);
  }

  const { ox, oy, ceilY } = activeOrigin();
  if (earned > 0 && view === 'farm') spawnCoins(earned, ox, oy);

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

  // 擺放模式：切到別區就取消（拿起來的東西是這一區的）
  if (edit && edit.zone !== state.activeZone) endEdit();
  const dg = edit; // 擺放中的預覽位置（按確定前不進 state）
  basins.sync(state, state.activeZone, ox, oy, dt, dg && dg.ref.kind === 'basin' ? { index: dg.ref.index, pos: dg.pos } : null);
  pours.update(state, dt, ox, oy); // 要在 basins.sync 之後：水流的落點讀的是這一幀顯示中的液面
  drops.sync(state, state.activeZone, ox, oy, dt);
  equipment.sync(state, state.activeZone, ox, oy, ceilY, dg && dg.ref.kind === 'equipment' ? dg.ref.id : null);
  particles.update(dt);
  coins.update(dt);

  pool?.begin();
  moodIcons.begin(dt);
  poolIds.length = 0;
  for (const p of state.puddings) {
    const view = views.get(p.id);
    if (!view) continue;
    const visible = p.zone === state.activeZone;
    view.root.visible = visible;
    if (!visible) continue;
    const mood = puddingMood(p, state.time);
    view.update(p, dt, ox, oy, BASIN_SINK, mood);
    pool?.add(view);
    poolIds.push(p.id);
    moodIcons.add(view.root, mood, camera, p.star);
  }
  pool?.commit();
  moodIcons.commit();

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

  if (view === 'bakery') {
    hud.tags.update(state);
    bakery.sync(state, dt);
    const rect = renderer.domElement.getBoundingClientRect();
    hud.rtags.place(bakery.regularAnchors(), rect.width, rect.height);
    renderer.render(bakery.scene, bakery.camera);
  } else {
    controls.update();
    renderer.render(scene, camera);
  }
  stats.tick();
}

function loop() {
  const now = performance.now();
  // 分頁切回來時 dt 會很大；那段時間交給離線結算，不要在一幀裡補跑
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame(paused ? 0 : dt, now);
}
// 要等 HUD、擺放模式（`edit`）都宣告完才切：setView 會碰到它們
if (view === 'bakery') setView('bakery');
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
