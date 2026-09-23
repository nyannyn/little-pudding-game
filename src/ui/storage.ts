import { EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../game/balance';
import { storedBasins, type FurnitureRef } from '../game/furniture';
import { furnitureArt, type ArtSpec } from './shopArt';
import { LIQUIDS } from '../game/species';
import type { Basin, GameState } from '../game/state';
import { findZone } from '../game/zones';

/**
 * 倉庫卡（D49）的內容：**只列倉庫裡的東西**，一件一格（圖＋名字＋數量），點一下就拿出來擺。
 * 收起來不在卡片上做，是長按櫥窗裡的家具 → 擺放模式的「收進倉庫」——
 * 卡片上列「這一區擺著的」時，兩區各有一台同名設備就分不出要收哪一台（2026-09-23 使用者回饋）。
 */
export interface StorageRow {
  /** `refKey()` 的結果，按鈕的 data-arg */
  key: string;
  name: string;
  /** 灰掉時的原因（例如這一區已經裝了同一台）；平常空字串 */
  sub: string;
  /** 同一種有幾件（設備可以收好幾台） */
  count?: number;
  /** 按下去要做什麼；disabled 時是灰的並顯示 `sub` 當原因 */
  disabled?: boolean;
  art: ArtSpec;
}

export function refKey(ref: FurnitureRef): string {
  return ref.kind === 'basin' ? `basin:${ref.index}` : `eq:${ref.id}`;
}

export function parseRefKey(key: string): FurnitureRef | null {
  const [kind, v] = key.split(':');
  if (kind === 'basin' && v !== undefined && /^\d+$/.test(v)) return { kind: 'basin', index: Number(v) };
  if (kind === 'eq' && (EQUIPMENT_IDS as string[]).includes(v ?? '')) return { kind: 'equipment', id: v as EquipmentId };
  return null;
}

function basinName(b: Basin): string {
  const l = b.preferredLiquid;
  return l && LIQUIDS[l].needsBasin ? `${LIQUIDS[l].name}澡盆` : '澡盆';
}

/**
 * 收起來會倒掉液體時要先問的那句話（D49：收進倉庫＝清除）；不需要問就回 null。
 * 按一下「收進倉庫」就把一整盆牛乳倒掉，玩家會以為是 bug。
 */
export function dumpWarning(state: GameState, ref: FurnitureRef): string | null {
  if (ref.kind !== 'basin') return null;
  const b = state.basins[ref.index];
  if (!b || b.units <= 0 || !b.liquid) return null;
  return `盆裡還有 ${b.units} 份${LIQUIDS[b.liquid].name}，收進倉庫會倒掉。`;
}

export function storedRows(state: GameState): StorageRow[] {
  const rows: StorageRow[] = [];
  for (const i of storedBasins(state)) {
    const b = state.basins[i]!;
    rows.push({ key: `basin:${i}`, name: basinName(b), sub: '', art: furnitureArt('basin', b.preferredLiquid) });
  }
  const here = state.equipment[state.activeZone];
  for (const id of EQUIPMENT_IDS) {
    const n = state.storedEquipment[id];
    if (n <= 0) continue;
    const dup = here?.[id] === true;
    rows.push({
      key: `eq:${id}`,
      name: EQUIPMENT[id].name,
      count: n,
      sub: dup ? '這一區已經有了' : '',
      disabled: dup,
      art: furnitureArt('equipment', id),
    });
  }
  return rows;
}

/** 卡片標題下那一行：目前在哪一區 */
export function storageZoneLabel(state: GameState): string {
  return findZone(state, state.activeZone)?.shortName ?? '';
}

