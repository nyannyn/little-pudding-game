import { BALANCE } from './balance';
import { cloneGenes, phenotype, type Genes } from './genetics';
import { grantXp } from './level';
import type { SimContext } from './pudding';
import { range } from './rng';
import { childPotential, isEliteZone, residents, zoneCap } from './stars';
import type { GameState, Pudding, Vec2 } from './state';
import { findZone } from './zones';

/**
 * 繁殖（D34，2026-09-22 改版：**牛奶澡就是繁殖**）。
 *
 * 觸發點只有一個：布丁泡完一次牛奶澡（`pudding.finishBath`）。
 * 不設成年、不設冷卻、不看焦糖——使用者的規則是「泡完澡就會生成布丁」，
 * 多加任何隱藏條件，玩家泡了沒生就會以為壞掉。實際的節流是牛奶要花錢、
 * 泡一次要 12 秒、而且該區住滿就生不出來。
 *
 * 子代是**單親複製**（`genetics.cloneGenes`）：複製母體的兩個等位基因，
 * 每個都有機率被環境改寫（牛奶→鮮奶酪，或母體累積的抹茶／草莓曝露）。
 */

/** 這一區還能不能再多一隻（精養區上限 `eliteCapacity`，D62） */
export function zoneHasRoom(state: GameState, zone: string): boolean {
  return residents(state, zone) < zoneCap(state, zone);
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
 *
 * **精養區不當落點**（D62）：母體住精養區也一樣送到別區。鮮奶酪系的本命液是牛奶、牛奶澡就是繁殖，
 * 不送走的話精養區會被自己生的寶寶塞爆、永遠長不了星。
 */
export function placementZone(state: GameState, homeZone: string): string | null {
  if (!isEliteZone(state, homeZone) && zoneHasRoom(state, homeZone)) return homeZone;
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
    if (n === undefined || z.mode === 'elite' || n >= BALANCE.zoneCapacity) continue;
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

/** 生不出來的時候給玩家看的原因（AC11-2：全場只剩精養區有空位也要講得出為什麼） */
export function birthBlockReason(state: GameState, homeZone: string): string {
  const eliteRoom = state.zones.some((z) => z.unlocked && z.mode === 'elite' && residents(state, z.id) < zoneCap(state, z.id));
  if (eliteRoom) return '量產的櫥窗都住滿了（精養區不收新生兒），生不出新的小布丁';
  if (findZone(state, homeZone)?.mode === 'elite') return '精養區的寶寶要送到別區，但其他櫥窗都住滿了';
  return '櫥窗住滿了，生不出新的小布丁';
}

function newborn(state: GameState, zone: string, genes: Genes, pos: Vec2, ctx: SimContext, parent: Pudding): Pudding {
  return {
    // 流水號一定要走 state.nextId：撞號會讓 scene 端以 id 為鍵的 view 綁到錯的那一隻
    id: `p${state.nextId++}`,
    zone,
    genes,
    species: phenotype(genes),
    bornAt: state.time,
    caramel: BALANCE.newbornCaramel,
    // 新生兒自己的掉落計時器：出生後過一個完整間隔才掉第一份
    nextDropAt: state.time + BALANCE.dropIntervalSec,
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
    // D63：出生一律 ★1、點數 0，潛力＝母體當下星級＋1
    star: 1,
    care: 0,
    potential: childPotential(parent),
  };
}

/**
 * 讓一隻剛泡完牛奶澡的布丁生一隻。全場都滿了就回 null（呼叫端要據此提示玩家）。
 * `zone` 可以指定落點，不給就照 `placementZone` 決定。
 */
export function breedFromBath(state: GameState, parent: Pudding, ctx: SimContext, zone?: string): Pudding | null {
  const target = zone ?? placementZone(state, parent.zone);
  if (target === null) return null;

  const genes = cloneGenes(parent, ctx.rng);
  const child = newborn(state, target, genes, birthPos(parent, ctx), ctx, parent);
  state.puddings.push(child);
  state.stats.births++;
  ctx.emit({
    type: 'birth',
    puddingId: child.id,
    zone: child.zone,
    species: child.species,
    parents: [parent.id, parent.id],
    x: child.pos.x,
    z: child.pos.z,
  });
  grantXp(state, BALANCE.xp.birth, ctx.emit);
  return child;
}
