import { EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../game/balance';
import { furnitureIn, storedBasins, type FurnitureRef } from '../game/furniture';
import { LIQUIDS } from '../game/species';
import type { Basin, GameState } from '../game/state';
import { findZone } from '../game/zones';

/**
 * 倉庫卡（D49）的內容。規則都在 `game/furniture.ts`，這裡只把 state 排成兩張清單：
 * 「這一區擺著的」（每件一顆「收起來」）與「倉庫裡的」（每件一顆「擺到這一區」）。
 */
export interface StorageRow {
  /** `refKey()` 的結果，按鈕的 data-arg */
  key: string;
  name: string;
  sub: string;
  /** 按下去要做什麼；disabled 時是灰的並顯示 `sub` 當原因 */
  disabled?: boolean;
  /** 收起來會倒掉液體：第一次按只武裝，第二次才真的收（不用 confirm()，它會卡住 iOS 與測試） */
  confirm?: string;
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

export function placedRows(state: GameState): StorageRow[] {
  return furnitureIn(state, state.activeZone).map(({ ref }) => {
    if (ref.kind === 'basin') {
      const b = state.basins[ref.index]!;
      const full = b.units > 0 && b.liquid;
      return {
        key: refKey(ref),
        name: basinName(b),
        sub: full ? `裝著 ${b.units} 份${LIQUIDS[b.liquid!].name}` : '空的',
        confirm: full ? `再按一次：倒掉 ${b.units} 份${LIQUIDS[b.liquid!].name}並收起` : undefined,
      };
    }
    return {
      key: refKey(ref),
      name: EQUIPMENT[ref.id].name,
      sub: ref.id === 'autoFill' ? '掛在澡盆上方，跟著澡盆走' : '長按櫥窗裡的它可以拖動',
    };
  });
}

export function storedRows(state: GameState): StorageRow[] {
  const rows: StorageRow[] = [];
  for (const i of storedBasins(state)) {
    const b = state.basins[i]!;
    rows.push({ key: `basin:${i}`, name: basinName(b), sub: '擺到這一區' });
  }
  const here = state.equipment[state.activeZone];
  for (const id of EQUIPMENT_IDS) {
    const n = state.storedEquipment[id];
    if (n <= 0) continue;
    const dup = here?.[id] === true;
    rows.push({
      key: `eq:${id}`,
      name: n > 1 ? `${EQUIPMENT[id].name} ×${n}` : EQUIPMENT[id].name,
      sub: dup ? '這一區已經裝了一台' : '擺到這一區',
      disabled: dup,
    });
  }
  return rows;
}

/** 卡片標題下那一行：目前在哪一區 */
export function storageZoneLabel(state: GameState): string {
  return findZone(state, state.activeZone)?.shortName ?? '';
}

