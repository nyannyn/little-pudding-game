import { EQUIPMENT_IDS, type EquipmentId, EQUIPMENT } from './balance';
import { LIQUIDS } from './species';
import { STORAGE_ZONE, type GameState, type Vec2 } from './state';
import { findZone } from './zones';

/**
 * 家具擺放與倉庫（D49）。
 *
 * 「家具」＝澡盆＋五台設備。玩家可以長按拖到同一層的別處、收進倉庫、再從倉庫擺到任何
 * 一個已解鎖的區。倉庫是全場共用的：一台設備永遠只是一台，想兩區同時用還是得買兩台（D45 不變），
 * 多出來的只是「搬家」。
 *
 * 座標全部是**區域座標**（地板中心為原點，同 `Pudding.pos`）。櫃子內部尺寸跟
 * `scene/cabinet.ts` 的 `TANK` 是同一組數字——`game/` 不能 import scene，
 * 所以這裡抄一份，`tests/unit/furniture.test.ts` 比對兩邊相等，改櫃子尺寸時會紅。
 */
export const TANK_INNER = { halfW: 2.35 / 2, halfD: 1.4 / 2 } as const;

/**
 * 家具離玻璃至少留這麼多，否則模型會穿出去。
 * 改版前販賣機的雨遮停在 z=0.695（離玻璃 0.005），新規則不可以把舊擺法判成違規，所以取 0.004。
 */
const WALL_GAP = 0.004;
/** 兩件家具之間至少留這麼多 */
const ITEM_GAP = 0.02;

/** 澡盆半徑（跟 `scene/basinMesh.ts` 的 `BASIN.radius` 相同，測試比對） */
export const BASIN_RADIUS = 0.21;

export type FurnitureRef = { kind: 'basin'; index: number } | { kind: 'equipment'; id: EquipmentId };

/**
 * 每件落地家具在地板上的佔地：半寬 hx、半深 hz，佔地中心比家具中心往 +z 偏 cz。
 * 含往外凸的零件：販賣機的雨遮／展示架往前凸到中心 +0.095、底座往後到 −0.07，
 * 前後不對稱，所以 hz＝0.0825、cz＝0.0125。
 * 收集手掛在頂板、注液閥掛在澡盆上方，它們不佔地板，沒有佔地。
 */
interface Footprint { hx: number; hz: number; cz: number }
const EQUIPMENT_FOOTPRINT: Partial<Record<EquipmentId, Footprint>> = {
  restock: { hx: 0.11, hz: 0.07, cz: 0 },
};

/** 預設位置＝改版前寫死的位置，舊檔沒存位置就用這組，畫面跟改版前一模一樣 */
export const EQUIPMENT_DEFAULT_POS: Record<EquipmentId, Vec2> = {
  autoFill: { x: -0.52, z: 0.12 }, // 只在這一區沒有澡盆時用得到（平常跟著第一個澡盆）
  collector: { x: -0.282, z: -0.168 },
  restock: { x: -1.015, z: 0.52 },
};

/** 收集手的夾爪在頂板滑軌上能走的範圍（滑軌本身跟著夾爪的 z） */
const COLLECTOR_RANGE = { x: 0.78, z: 0.55 };

/** 可以拖的設備：注液閥是澡盆上方的管線，跟著澡盆走，不能單獨拖 */
export function isDraggable(ref: FurnitureRef): boolean {
  return ref.kind === 'basin' || ref.id !== 'autoFill';
}

function footprint(ref: FurnitureRef): Footprint | null {
  if (ref.kind === 'basin') return { hx: BASIN_RADIUS, hz: BASIN_RADIUS, cz: 0 };
  return EQUIPMENT_FOOTPRINT[ref.id] ?? null;
}

/** 某一區第一個澡盆的位置（注液閥掛在它上面）；沒有澡盆就是 null */
export function firstBasinPos(state: GameState, zone: string): Vec2 | null {
  return state.basins.find((b) => b.zone === zone)?.pos ?? null;
}

/** 設備在這一區的位置：玩家擺過就用擺過的，沒擺過用預設 */
export function equipmentPos(state: GameState, zone: string, id: EquipmentId): Vec2 {
  if (id === 'autoFill') return firstBasinPos(state, zone) ?? EQUIPMENT_DEFAULT_POS.autoFill;
  return state.equipmentPos[zone]?.[id] ?? EQUIPMENT_DEFAULT_POS[id];
}

export function furniturePos(state: GameState, zone: string, ref: FurnitureRef): Vec2 | null {
  if (ref.kind === 'basin') {
    const b = state.basins[ref.index];
    return b && b.zone === zone ? b.pos : null;
  }
  return state.equipment[zone]?.[ref.id] ? equipmentPos(state, zone, ref.id) : null;
}

export interface PlacedFurniture {
  ref: FurnitureRef;
  pos: Vec2;
  /** 佔地（不佔地板的全是 0、floor=false）；佔地中心＝pos 往 +z 偏 cz */
  hx: number;
  hz: number;
  cz: number;
  floor: boolean;
}

/** 這一區擺著的全部家具 */
export function furnitureIn(state: GameState, zone: string): PlacedFurniture[] {
  const out: PlacedFurniture[] = [];
  state.basins.forEach((b, index) => {
    if (b.zone === zone) out.push({ ref: { kind: 'basin', index }, pos: b.pos, hx: BASIN_RADIUS, hz: BASIN_RADIUS, cz: 0, floor: true });
  });
  const eq = state.equipment[zone];
  if (eq) {
    for (const id of EQUIPMENT_IDS) {
      if (!eq[id]) continue;
      const fp = footprint({ kind: 'equipment', id });
      out.push({ ref: { kind: 'equipment', id }, pos: equipmentPos(state, zone, id), hx: fp?.hx ?? 0, hz: fp?.hz ?? 0, cz: fp?.cz ?? 0, floor: fp !== null });
    }
  }
  return out;
}

function sameRef(a: FurnitureRef, b: FurnitureRef): boolean {
  return a.kind === 'basin' ? b.kind === 'basin' && a.index === b.index : b.kind === 'equipment' && a.id === b.id;
}

/** 位置夾進這件家具的合法範圍（拖曳預覽用：手指拖出玻璃時，家具貼著玻璃走而不是消失） */
export function clampToTank(ref: FurnitureRef, pos: Vec2): Vec2 {
  if (ref.kind === 'equipment' && ref.id === 'collector') {
    return {
      x: Math.max(-COLLECTOR_RANGE.x, Math.min(COLLECTOR_RANGE.x, pos.x)),
      z: Math.max(-COLLECTOR_RANGE.z, Math.min(COLLECTOR_RANGE.z, pos.z)),
    };
  }
  const fp = footprint(ref) ?? { hx: 0, hz: 0, cz: 0 };
  const mx = TANK_INNER.halfW - fp.hx - WALL_GAP;
  const mz = TANK_INNER.halfD - fp.hz - WALL_GAP;
  // 佔地中心（pos.z + cz）夾在 ±mz 裡，再換回家具中心
  return { x: Math.max(-mx, Math.min(mx, pos.x)), z: Math.max(-mz, Math.min(mz, pos.z + fp.cz)) - fp.cz };
}

/**
 * 能不能把 `ref` 放到 `pos`：在櫃子裡面、而且不壓到同一區的其他落地家具。
 * 回傳錯誤訊息，可以放就回 null。布丁擋路不算——牠下一跳自己會跳開（落點避開家具）。
 */
export function placementError(state: GameState, zone: string, ref: FurnitureRef, pos: Vec2): string | null {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return '位置不對';
  const c = clampToTank(ref, pos);
  if (Math.abs(c.x - pos.x) > 1e-6 || Math.abs(c.z - pos.z) > 1e-6) return '放不進櫃子裡';
  const fp = footprint(ref);
  if (!fp) return null; // 掛在頂板上的不會撞到地上的東西
  for (const other of furnitureIn(state, zone)) {
    if (!other.floor || sameRef(other.ref, ref)) continue;
    if (Math.abs(other.pos.x - pos.x) < other.hx + fp.hx + ITEM_GAP && Math.abs(other.pos.z + other.cz - (pos.z + fp.cz)) < other.hz + fp.hz + ITEM_GAP) {
      return '跟別的家具重疊了';
    }
  }
  return null;
}

/** 布丁的落點要不要避開：落在任何落地家具（含留邊 `pad`）上就算擋住 */
export function blockedByFurniture(state: GameState, zone: string, p: Vec2, pad: number): boolean {
  for (const f of furnitureIn(state, zone)) {
    if (!f.floor) continue;
    if (Math.abs(f.pos.x - p.x) < f.hx + pad && Math.abs(f.pos.z + f.cz - p.z) < f.hz + pad) return true;
  }
  return false;
}

/** 找一個放得下的位置：先試 `prefer`，不行就從中間往外掃一圈格子 */
export function findFreeSpot(state: GameState, zone: string, ref: FurnitureRef, prefer: Vec2): Vec2 | null {
  const first = clampToTank(ref, prefer);
  if (!placementError(state, zone, ref, first)) return first;
  const cands: Vec2[] = [];
  for (let x = -1.1; x <= 1.1001; x += 0.1) for (let z = -0.65; z <= 0.6501; z += 0.1) cands.push(clampToTank(ref, { x, z }));
  cands.sort((a, b) => Math.hypot(a.x - prefer.x, a.z - prefer.z) - Math.hypot(b.x - prefer.x, b.z - prefer.z));
  return cands.find((c) => !placementError(state, zone, ref, c)) ?? null;
}

// ── 動作 ──────────────────────────────────────────────
export type FurnitureResult = { ok: true; message?: string } | { ok: false; error: string };
const fail = (error: string): FurnitureResult => ({ ok: false, error });

function unlockedZone(state: GameState, zone: string): string | null {
  const z = findZone(state, zone);
  if (!z) return '沒有這個櫥窗';
  if (!z.unlocked) return '這一區還沒解鎖';
  return null;
}

/**
 * 盆子要動（搬走或收起）之前，把跟它有關係的布丁放掉：
 * 正在泡的請出來、正要跳進去的取消。`follow`＝盆只是換位置，泡著的那隻跟著盆走、繼續泡。
 */
function releaseBasin(state: GameState, index: number, follow: Vec2 | null) {
  const b = state.basins[index];
  if (!b) return;
  for (const p of state.puddings) {
    if (p.basinIndex !== index) continue;
    if (p.mode === 'bathing' && follow) {
      p.pos = { ...follow };
      p.from = { ...follow };
      p.to = { ...follow };
      continue;
    }
    if (p.mode === 'bathing') {
      // 泡到一半被請出來：不給泡完的效果（盆收起來了），站在原地休息一下再決定
      p.bathT = 0;
      p.bathLiquid = null;
      p.mode = 'resting';
      p.restT = 0.6;
    } else if (p.mode === 'hopping') {
      // 正在跳過去：落地時 `land()` 看到 basinIndex 是 null 就只是普通落地
    }
    p.basinIndex = null;
    if (b.occupantId === p.id) b.occupantId = null;
  }
  if (!follow) b.occupantId = null;
}

/** 把一件家具搬到同一區的別處 */
export function moveFurniture(state: GameState, zone: string, ref: FurnitureRef, pos: Vec2): FurnitureResult {
  const bad = unlockedZone(state, zone);
  if (bad) return fail(bad);
  if (!isDraggable(ref)) return fail('注液閥跟著澡盆走，搬澡盆就好');
  if (!furniturePos(state, zone, ref)) return fail('這一區沒有這件家具');
  const err = placementError(state, zone, ref, pos);
  if (err) return fail(err);
  const to = { x: pos.x, z: pos.z };
  if (ref.kind === 'basin') {
    const b = state.basins[ref.index]!;
    // 正要跳過去的那隻跳向舊位置，會落在空地上；取消掉讓牠重新找盆
    for (const p of state.puddings) {
      if (p.basinIndex === ref.index && p.mode === 'hopping') {
        p.basinIndex = null;
        if (b.occupantId === p.id) b.occupantId = null;
      }
    }
    releaseBasin(state, ref.index, to);
    b.pos = to;
  } else {
    (state.equipmentPos[zone] ??= {})[ref.id] = to;
  }
  return { ok: true };
}

/** 收進倉庫。澡盆裡剩的液體直接倒掉（使用者定的：收起來＝清除） */
export function storeFurniture(state: GameState, zone: string, ref: FurnitureRef): FurnitureResult {
  const bad = unlockedZone(state, zone);
  if (bad) return fail(bad);
  if (!furniturePos(state, zone, ref)) return fail('這一區沒有這件家具');
  if (ref.kind === 'basin') {
    const b = state.basins[ref.index]!;
    const dumped = b.units;
    const liquid = b.liquid;
    releaseBasin(state, ref.index, null);
    b.zone = STORAGE_ZONE;
    b.units = 0;
    b.liquid = null;
    return { ok: true, message: dumped > 0 && liquid ? `倒掉 ${dumped} 份${LIQUIDS[liquid].name}，澡盆收進倉庫` : '澡盆收進倉庫' };
  }
  state.equipment[zone]![ref.id] = false;
  if (state.equipmentPos[zone]) delete state.equipmentPos[zone][ref.id];
  state.storedEquipment[ref.id] += 1;
  return { ok: true, message: `${EQUIPMENT[ref.id].name}收進倉庫` };
}

/** 倉庫裡的澡盆（在 `state.basins` 的索引） */
export function storedBasins(state: GameState): number[] {
  const out: number[] = [];
  state.basins.forEach((b, i) => {
    if (b.zone === STORAGE_ZONE) out.push(i);
  });
  return out;
}

/** 倉庫是不是空的 */
export function storageEmpty(state: GameState): boolean {
  return storedBasins(state).length === 0 && EQUIPMENT_IDS.every((id) => state.storedEquipment[id] <= 0);
}

/**
 * 從倉庫拿到這一區「行不行」（還沒談位置）：倉庫裡有沒有、這一區是不是已經裝了同一台。
 * 擺放模式（UI 預覽）與 `placeFromStorage`（寫入）共用這一條，不然預覽說可以、按確定才被退。
 */
export function storageError(state: GameState, zone: string, ref: FurnitureRef): string | null {
  const bad = unlockedZone(state, zone);
  if (bad) return bad;
  if (ref.kind === 'basin') {
    const b = state.basins[ref.index];
    return b && b.zone === STORAGE_ZONE ? null : '倉庫裡沒有這個澡盆';
  }
  if (state.storedEquipment[ref.id] <= 0) return '倉庫裡沒有這台';
  const eq = state.equipment[zone];
  if (!eq) return '沒有這個櫥窗';
  if (eq[ref.id]) return '這一區已經裝了一台';
  return null;
}

/** 檢查位置時代表「倉庫裡那一件」的 ref：澡盆用不存在的索引，才不會跟自己比重疊 */
function probe(ref: FurnitureRef): FurnitureRef {
  return ref.kind === 'basin' ? { kind: 'basin', index: -1 } : ref;
}

/** 從倉庫拿出來的預設落點：先試老位置（澡盆＝第一個格位、設備＝改版前的位置），不行就找最近的空位 */
export function storageSpot(state: GameState, zone: string, ref: FurnitureRef): Vec2 | null {
  const prefer = ref.kind === 'basin' ? { x: -0.52, z: 0.12 } : EQUIPMENT_DEFAULT_POS[ref.id];
  if (!footprint(ref)) return { ...prefer };
  return findFreeSpot(state, zone, probe(ref), prefer);
}

/** 從倉庫擺到這一區的 `pos`（擺放模式按「確定」）；位置不合法就擋下，不自己挪到別處 */
export function placeFromStorage(state: GameState, zone: string, ref: FurnitureRef, pos: Vec2): FurnitureResult {
  const bad = storageError(state, zone, ref);
  if (bad) return fail(bad);
  const err = placementError(state, zone, probe(ref), pos);
  if (err) return fail(err);
  const to = { x: pos.x, z: pos.z };
  if (ref.kind === 'basin') {
    const b = state.basins[ref.index]!;
    b.zone = zone;
    b.pos = to;
    b.occupantId = null;
    return { ok: true, message: '澡盆擺好了' };
  }
  state.equipment[zone]![ref.id] = true;
  state.storedEquipment[ref.id] -= 1;
  if (ref.id !== 'autoFill') (state.equipmentPos[zone] ??= {})[ref.id] = to;
  return { ok: true, message: `${EQUIPMENT[ref.id].name}擺好了` }
}
