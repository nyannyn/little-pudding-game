import { BALANCE } from './balance';
import { cross, phenotype, type Genes } from './genetics';
import type { SimContext } from './pudding';
import { range } from './rng';
import type { GameState, Pudding, Vec2 } from './state';

/**
 * 自動繁殖（D29，2026-09-22 使用者要求「過一段時間自動繁殖」）。
 *
 * 全自動：玩家不按任何按鈕，能控制的是**條件**——誰跟誰住同一區、澡盆裡倒什麼
 * （影響配子，見 `genetics.gamete`）、以及要不要花錢解鎖下一區騰出空位。
 *
 * 判定是**位準觸發**（看當下的數值，不累積計時器）：線上一幀 0.016 秒、
 * 離線一步 1 秒，若改成「每秒累積機率」兩邊的結果會差很多。
 * 位準觸發配上冷卻與住客上限，離線八小時跑完也不會炸出一堆布丁。
 */

/** 這隻現在有沒有資格當親代 */
export function readyToBreed(state: GameState, p: Pudding): boolean {
  if (p.mode === 'bathing') return false; // 泡澡中的布丁在盆裡，讓牠泡完
  if (state.time - p.bornAt < BALANCE.matureAgeSec) return false;
  if (state.time < p.breedReadyAt) return false;
  return p.caramel >= BALANCE.breedCaramelMin;
}

/** 這一區還能不能再多一隻 */
export function zoneHasRoom(state: GameState, zone: string): boolean {
  return state.puddings.filter((p) => p.zone === zone).length < BALANCE.zoneCapacity;
}

/**
 * 新生兒要落在哪一區：優先跟雙親同區；雙親那一區滿了就搬到**住客最少的已解鎖區**。
 *
 * 沒有這條溢出規則，繁殖跑幾分鐘就會整個停住（2026-09-22 `npm run pacing` 實測：
 * 三小時只生了一隻）——起始區生一隻就滿員，而解鎖的新區各只送一隻住客、
 * 一隻湊不成一對，於是每一區都卡死。溢出等於「太擠了就搬去隔壁櫥窗」，
 * 玩家買下的空櫥窗也因此自己住滿，不必手動搬家。
 *
 * 回傳 null＝全場都滿了，這時整個繁殖暫停（去解鎖下一區就是出口）。
 */
export function placementZone(state: GameState, homeZone: string): string | null {
  if (zoneHasRoom(state, homeZone)) return homeZone;
  const counts = new Map<string, number>();
  for (const z of state.zones) if (z.unlocked) counts.set(z.id, 0);
  for (const p of state.puddings) {
    if (counts.has(p.zone)) counts.set(p.zone, (counts.get(p.zone) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = Number.POSITIVE_INFINITY;
  // 照 state.zones 的順序掃，同票數一律取先出現的那一區（要能用 `?seed=` 重現）
  for (const z of state.zones) {
    const n = counts.get(z.id);
    if (n === undefined || n >= BALANCE.zoneCapacity) continue;
    if (n < bestN) { bestN = n; best = z.id; }
  }
  return best;
}

/** 新生布丁的落點：貼在親代旁邊一點點，夾回地板範圍內 */
function birthPos(parent: Pudding, ctx: SimContext): Vec2 {
  const { floor, rng } = ctx;
  const a = range(rng, 0, Math.PI * 2);
  const r = BALANCE.puddingSpacing;
  return {
    x: Math.min(floor.maxX, Math.max(floor.minX, parent.pos.x + Math.cos(a) * r)),
    z: Math.min(floor.maxZ, Math.max(floor.minZ, parent.pos.z + Math.sin(a) * r)),
  };
}

function newborn(state: GameState, zone: string, genes: Genes, pos: Vec2, ctx: SimContext): Pudding {
  return {
    // 流水號一定要走 state.nextId：撞號會讓 scene 端以 id 為鍵的 view 綁到錯的那一隻
    id: `p${state.nextId++}`,
    zone,
    genes,
    species: phenotype(genes),
    bornAt: state.time,
    // 剛出生的先過一次冷卻才輪到牠當親代（成年期通常更長，這只是保險）
    breedReadyAt: state.time + BALANCE.breedCooldownSec,
    caramel: BALANCE.newbornCaramel,
    bathHistory: [],
    tint: 0,
    flavorExposure: {},
    mode: 'resting',
    pos: { ...pos },
    from: { ...pos },
    to: { ...pos },
    hopT: 1,
    restT: range(ctx.rng, BALANCE.hopRestMin, BALANCE.hopRestMax),
    bathT: 0,
    basinIndex: null,
    bathLiquid: null,
    pendingMutation: null,
  };
}

/**
 * 讓一對親代生一隻。回傳新生兒，全場都滿了就回 null。
 * `zone` 可以指定新生兒落點，不給就照 `placementZone` 決定。
 */
export function breed(state: GameState, a: Pudding, b: Pudding, ctx: SimContext, zone?: string): Pudding | null {
  const target = zone ?? placementZone(state, a.zone);
  if (target === null) return null;
  const genes = cross(a, b, ctx.rng);
  const child = newborn(state, target, genes, birthPos(a, ctx), ctx);
  state.puddings.push(child);

  for (const parent of [a, b]) {
    // 扣到低於泡澡門檻：親代會自己跳回澡盆，繁殖因此接回既有的生產迴圈
    parent.caramel = Math.max(0, parent.caramel - BALANCE.breedCaramelCost);
    parent.breedReadyAt = state.time + BALANCE.breedCooldownSec;
  }
  state.stats.births++;
  ctx.emit({
    type: 'birth',
    puddingId: child.id,
    zone: child.zone,
    species: child.species,
    parents: [a.id, b.id],
    x: child.pos.x,
    z: child.pos.z,
  });
  return child;
}

/**
 * 每個 tick 跑一次：每一區各自找「前兩隻符合條件的」配成一對。
 * 配對刻意不用亂數（照陣列順序取前兩隻），亂數只花在配子上——
 * 這樣同一個 `?seed=` 重跑才會得到同一群布丁。
 */
export function tickBreeding(state: GameState, ctx: SimContext): void {
  const zones = new Set(state.puddings.map((p) => p.zone));
  for (const zone of zones) {
    if (placementZone(state, zone) === null) continue; // 全場滿員
    const ready = state.puddings.filter((p) => p.zone === zone && readyToBreed(state, p));
    if (ready.length < 2) continue;
    breed(state, ready[0] as Pudding, ready[1] as Pudding, ctx);
  }
}
