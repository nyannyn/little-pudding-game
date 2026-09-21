import { BALANCE } from './balance';
import { basinAvailable, consumeBathUnit, findBasinFor } from './basin';
import type { EventSink } from './events';
import { applySpeciesAsPure } from './genetics';
import { range, type Rng } from './rng';
import { LIQUIDS, SPECIES, type SpeciesId } from './species';
import type { GameState, Pudding, Vec2 } from './state';

/** 啟用層地板的 2D 邊界。由 scene 層（`cabinet.floorBounds()`）算好傳進來——
 *  `game/` 不可以 import three.js，也不該知道 y 在哪一層。 */
export interface FloorRect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface SimContext {
  rng: Rng;
  floor: FloorRect;
  emit: EventSink;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 在地板內挑一個落點，盡量避開其他布丁與澡盆；挑不到就用最後一次的候選 */
function randomFloorPoint(state: GameState, self: Pudding, ctx: SimContext): Vec2 {
  const { floor, rng } = ctx;
  let fallback: Vec2 = { x: self.pos.x, z: self.pos.z };
  for (let attempt = 0; attempt < 8; attempt++) {
    const p: Vec2 = { x: range(rng, floor.minX, floor.maxX), z: range(rng, floor.minZ, floor.maxZ) };
    fallback = p;
    if (dist(p, self.pos) < 0.12) continue; // 原地跳看起來像卡住
    let clear = true;
    for (const other of state.puddings) {
      if (other.id === self.id || other.zone !== self.zone) continue;
      if (dist(p, other.pos) < BALANCE.puddingSpacing) { clear = false; break; }
    }
    if (clear) for (const b of state.basins) {
      if (b.zone !== self.zone) continue;
      if (dist(p, b.pos) < 0.26) { clear = false; break; }
    }
    if (clear) return p;
  }
  return fallback;
}

function startHop(p: Pudding, to: Vec2, ctx: SimContext): void {
  p.from = { ...p.pos };
  p.to = { ...to };
  p.hopT = 0;
  p.mode = 'hopping';
  void ctx;
}

/** 這隻布丁現在想不想泡澡 */
export function wantsBath(p: Pudding): boolean {
  return p.caramel < BALANCE.batheThreshold;
}

/** 最近 milkWindow 次泡澡裡牛奶的占比 */
export function milkRatio(p: Pudding): number {
  if (p.bathHistory.length === 0) return 0;
  const milk = p.bathHistory.filter((l) => l === 'milk').length;
  return milk / p.bathHistory.length;
}

/** 掉一份原料在地上；滿了就不掉（計畫：上限 5 份，滿了後續不再掉） */
export function spawnDrop(state: GameState, zone: string, species: SpeciesId, at: Vec2, ctx: SimContext): boolean {
  // 上限是「每一區各自 5 份」：解鎖第二區之後，兩區的地板要各自算
  if (state.drops.filter((d) => d.zone === zone).length >= BALANCE.dropCap) return false;
  // 沿澡盆外圍的一圈掉，不掉在盆心——掉進盆裡會被盆身遮住，看起來像沒產出
  const a = range(ctx.rng, 0, Math.PI * 2);
  const r = BALANCE.dropSpawnRadius;
  const x = Math.min(ctx.floor.maxX, Math.max(ctx.floor.minX, at.x + Math.cos(a) * r));
  const z = Math.min(ctx.floor.maxZ, Math.max(ctx.floor.minZ, at.z + Math.sin(a) * r * 0.7));
  state.drops.push({ id: `d${state.nextId++}`, zone, species, pos: { x, z }, bornAt: state.time });
  ctx.emit({ type: 'drop', species, x, z });
  return true;
}

/** 落地瞬間：先處理突變（大彈跳的終點），再處理「是不是落進澡盆」 */
function land(state: GameState, p: Pudding, ctx: SimContext): void {
  p.pos = { ...p.to };
  p.hopT = 1;

  if (p.pendingMutation && p.pendingMutation !== p.species) {
    const from = p.species;
    // 突變寫的是**基因型**不是 species（D28）：只改 species 的話，一隻泡成鮮奶酪的布丁
    // 還是會把焦糖等位基因傳給每一個子代。突變一律換成該物種的純合，表面行為不變。
    applySpeciesAsPure(p, p.pendingMutation);
    p.tint = 0;
    p.bathHistory = [];
    p.flavorExposure = {};
    state.stats.mutations++;
    ctx.emit({ type: 'mutate', puddingId: p.id, from, to: p.species, x: p.pos.x, z: p.pos.z });
  }
  p.pendingMutation = null;

  const bi = p.basinIndex;
  const basin = bi === null ? undefined : state.basins[bi];
  if (basin && basin.occupantId === p.id) {
    // 走到這裡才真的扣液體：跳到一半盆被倒空的情況要能退場
    if (basin.units >= BALANCE.bathLiquidCost && basin.liquid) {
      const liquid = basin.liquid;
      consumeBathUnit(basin);
      p.bathLiquid = liquid;
      p.mode = 'bathing';
      p.bathT = BALANCE.bathDurationSec;
      ctx.emit({ type: 'splat', puddingId: p.id, x: p.pos.x, z: p.pos.z });
      ctx.emit({ type: 'bathStart', puddingId: p.id, liquid });
      return;
    }
    basin.occupantId = null;
    p.basinIndex = null;
  }

  p.mode = 'resting';
  p.restT = range(ctx.rng, BALANCE.hopRestMin, BALANCE.hopRestMax);
  ctx.emit({ type: 'splat', puddingId: p.id, x: p.pos.x, z: p.pos.z });
}

/** 泡完澡：補 caramel、推進牛奶窗與風味曝露、產一份原料、讓出澡盆 */
function finishBath(state: GameState, p: Pudding, ctx: SimContext): void {
  const liquid = p.bathLiquid ?? 'caramel';
  const info = LIQUIDS[liquid];

  p.caramel = info.caramelAfterBath;
  p.bathHistory.push(liquid);
  if (p.bathHistory.length > BALANCE.milkWindow) p.bathHistory = p.bathHistory.slice(-BALANCE.milkWindow);

  // 變白：窗內牛奶占比夠高就累積，不夠就退回去（灌一次焦糖救得回來）
  if (p.bathHistory.length >= 2 && milkRatio(p) >= BALANCE.milkRatioThreshold) {
    p.tint = Math.min(1, p.tint + BALANCE.tintPerBath);
  } else {
    p.tint = Math.max(0, p.tint - BALANCE.tintPerBath);
  }
  if (p.tint >= 1 && p.species !== 'panna') p.pendingMutation = 'panna';

  // 風味曝露：泡特殊澡盆才累積，滿門檻就排定突變
  if (info.flavorFor) {
    const key = info.flavorFor;
    const next = (p.flavorExposure[key] ?? 0) + BALANCE.flavorExposurePerBath;
    p.flavorExposure[key] = next;
    if (next >= BALANCE.flavorThresholdSec && p.species !== key) p.pendingMutation = key;
  }

  state.stats.baths++;
  ctx.emit({ type: 'bathDone', puddingId: p.id, liquid });

  // 原料：裝了收集手就直接入庫，否則掉在盆邊等玩家點
  const bi = p.basinIndex;
  const basin = bi === null ? undefined : state.basins[bi];
  const at = basin ? basin.pos : p.pos;
  if (state.equipment.collector) {
    state.ingredients[p.species]++;
    state.stats.picked++;
    ctx.emit({ type: 'pick', species: p.species, x: at.x, z: at.z, auto: true });
  } else {
    spawnDrop(state, p.zone, p.species, at, ctx);
  }

  if (basin && basin.occupantId === p.id) basin.occupantId = null;
  p.basinIndex = null;
  p.bathLiquid = null;
  p.bathT = 0;
  p.mode = 'resting';
  p.restT = range(ctx.rng, 0.4, 1.0);
}

/** 決定下一跳要去哪：缺焦糖且有盆可用就去泡澡，否則在地板上隨機挑一點 */
function chooseNextHop(state: GameState, p: Pudding, ctx: SimContext): void {
  if (wantsBath(p)) {
    const bi = findBasinFor(state, p.zone, p.pos.x, p.pos.z);
    const basin = bi === null ? undefined : state.basins[bi];
    if (bi !== null && basin && basinAvailable(basin)) {
      basin.occupantId = p.id; // 先佔位，第二隻才不會同時跳進同一盆
      p.basinIndex = bi;
      startHop(p, basin.pos, ctx);
      return;
    }
  }
  p.basinIndex = null;
  startHop(p, randomFloorPoint(state, p, ctx), ctx);
}

/** 單隻布丁的一步 */
export function tickPudding(state: GameState, p: Pudding, dt: number, ctx: SimContext): void {
  if (p.mode === 'bathing') {
    p.bathT -= dt;
    if (p.bathT <= 0) finishBath(state, p, ctx);
    return;
  }

  p.caramel = Math.max(0, p.caramel - BALANCE.caramelDecayPerSec * dt);

  if (p.mode === 'resting') {
    p.restT -= dt;
    if (p.restT <= 0) chooseNextHop(state, p, ctx);
    return;
  }

  // hopping
  p.hopT += dt / BALANCE.hopDurationSec;
  if (p.hopT >= 1) {
    land(state, p, ctx);
  } else {
    p.pos = {
      x: p.from.x + (p.to.x - p.from.x) * p.hopT,
      z: p.from.z + (p.to.z - p.from.z) * p.hopT,
    };
  }
}

/**
 * UI 用：這隻布丁現在在做什麼（一行中文）。用短名：狀態列在右邊還要留位置給訂單卡。
 * 給了 `time` 才判斷得出「還沒長大」——新生兒要看得出來是新生兒，
 * 否則畫面上突然多一隻布丁，玩家不知道那是繁殖出來的（D29）。
 */
export function describePudding(p: Pudding, time?: number): string {
  const name = SPECIES[p.species].shortName;
  if (time !== undefined && time - p.bornAt < BALANCE.matureAgeSec) return `${name}・幼布丁`;
  if (p.mode === 'bathing') return `${name}・泡澡中`;
  if (wantsBath(p)) return `${name}・想泡澡了`;
  if (p.tint > 0) return `${name}・有點發白`;
  return `${name}・悠閒彈跳`;
}
