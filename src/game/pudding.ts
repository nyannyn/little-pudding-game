import { BALANCE } from './balance';
import { basinAvailable, consumeBathUnit, findBasinFor } from './basin';
import type { EventSink } from './events';
import { breedFromBath } from './breeding';
import { applySpeciesAsPure } from './genetics';
import { range, type Rng } from './rng';
import { LIQUIDS, SPECIES, type SpeciesId } from './species';
import type { DropKind, GameState, Pudding, Vec2 } from './state';

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

/** 掉一份原料在地上；滿了就不掉（計畫：上限 5 份，滿了後續不再掉） */
export function spawnDrop(
  state: GameState,
  zone: string,
  species: SpeciesId,
  kind: DropKind,
  at: Vec2,
  ctx: SimContext,
): boolean {
  // 上限是「每一區各自 5 份」：解鎖第二區之後，兩區的地板要各自算
  if (state.drops.filter((d) => d.zone === zone).length >= BALANCE.dropCap) return false;
  // 沿澡盆外圍的一圈掉，不掉在盆心——掉進盆裡會被盆身遮住，看起來像沒產出
  const a = range(ctx.rng, 0, Math.PI * 2);
  const r = BALANCE.dropSpawnRadius;
  const x = Math.min(ctx.floor.maxX, Math.max(ctx.floor.minX, at.x + Math.cos(a) * r));
  const z = Math.min(ctx.floor.maxZ, Math.max(ctx.floor.minZ, at.z + Math.sin(a) * r * 0.7));
  state.drops.push({ id: `d${state.nextId++}`, zone, kind, species, pos: { x, z }, bornAt: state.time });
  ctx.emit({ type: 'drop', kind, species, x, z });
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

/**
 * 泡完澡（D32／D34 改版）：
 * - 補 caramel（焦糖澡補滿、牛奶澡補一半…數值見 `LIQUIDS[*].caramelAfterBath`）
 * - 風味澡盆累積曝露，滿門檻就排定母體自己的突變（既有規則，沒有動）
 * - **牛奶澡＝生一隻小布丁**（D34）
 * - **不再產出原料**：原料改成固定間隔自然掉落（D32，見 `tickDrops`）
 */
function finishBath(state: GameState, p: Pudding, ctx: SimContext): void {
  const liquid = p.bathLiquid ?? 'caramel';
  const info = LIQUIDS[liquid];

  p.caramel = info.caramelAfterBath;

  // 風味曝露：泡特殊澡盆才累積，滿門檻就排定突變
  if (info.flavorFor) {
    const key = info.flavorFor;
    const next = (p.flavorExposure[key] ?? 0) + BALANCE.flavorExposurePerBath;
    p.flavorExposure[key] = next;
    if (next >= BALANCE.flavorThresholdSec && p.species !== key) p.pendingMutation = key;
  }

  state.stats.baths++;
  ctx.emit({ type: 'bathDone', puddingId: p.id, liquid });

  // 牛奶澡就是繁殖。生不出來（全場住滿）要講出來，否則玩家會以為規則壞了
  if (liquid === 'milk') {
    const child = breedFromBath(state, p, ctx);
    if (child === null) ctx.emit({ type: 'error', message: '櫥窗住滿了，生不出新的小布丁' });
  }

  const bi = p.basinIndex;
  const basin = bi === null ? undefined : state.basins[bi];
  if (basin && basin.occupantId === p.id) basin.occupantId = null;
  p.basinIndex = null;
  p.bathLiquid = null;
  p.bathT = 0;
  p.mode = 'resting';
  p.restT = range(ctx.rng, 0.4, 1.0);
}

/**
 * 固定間隔自然掉落（D32）。時間到就掉一份，`eggChance` 的機率是蛋、否則是自己物種的原料。
 * 泡澡中不掉——布丁人在盆子裡，掉出來的東西會被盆身蓋住看不見。
 * **焦糖見底時也不掉（D35）**：這是「布丁保持愉快才生產」的最小判定，
 * 也讓「液體用完」重新有後果——否則 D32 之後焦糖澡與補貨完全沒有作用。
 */
function tickDrops(state: GameState, p: Pudding, ctx: SimContext): void {
  if (p.mode === 'bathing') return;
  // 焦糖見底的布丁不生產。計時器一起往後推，補好液體之後才不會一次倒出一堆積欠的原料
  if (p.caramel < BALANCE.dropCaramelMin) {
    p.nextDropAt = Math.max(p.nextDropAt, state.time);
    return;
  }
  if (state.time < p.nextDropAt) return;

  const kind: DropKind = ctx.rng.next() < BALANCE.eggChance ? 'egg' : 'ingredient';
  spawnDrop(state, p.zone, p.species, kind, p.pos, ctx);

  const jitter = 1 + range(ctx.rng, -BALANCE.dropJitter, BALANCE.dropJitter);
  p.nextDropAt = state.time + BALANCE.dropIntervalSec * jitter;
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
  tickDrops(state, p, ctx);

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
  return `${name}・悠閒彈跳`;
}
