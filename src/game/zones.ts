import type { Basin, Drop, GameState, Pudding } from './state';

/**
 * 分區＝一個可以住布丁的玻璃箱。兩種解鎖走同一套資料：
 * - 同一座落地櫃的其他層（`cabinet` 相同、`tier` 不同）
 * - 隔壁那一座櫃子（`cabinet` 不同）
 *
 * `game/` 只認 id 與「每區各自一塊 2.35×1.4 的地板」，
 * 那塊地板在世界座標的哪裡是 `scene/` 的事（見 `zoneOrigin`）。
 */
export interface Zone {
  id: string;
  /** 0＝主櫃；正負數＝右／左邊第幾座鄰櫃 */
  cabinet: number;
  /** 0＝最下層 */
  tier: number;
  name: string;
  /** 切換列用的短名（列在畫面正中央、旁邊還有訂單卡，塞不下全名） */
  shortName: string;
  unlocked: boolean;
  /** 解鎖價（焦糖幣）；起始區為 0 */
  price: number;
}

export function zoneKey(cabinet: number, tier: number): string {
  return `c${cabinet}t${tier}`;
}

/** 開局就在玩的那一區＝主櫃中層（D17：中層啟用、上下未解鎖） */
export const START_ZONE = zoneKey(0, 1);

/**
 * v1 的四個分區。價格級距刻意拉開：
 * 上層是「第一次擴張」（勤勞玩家 20 分鐘內；D24），鄰櫃是長期目標。
 *
 * 2026-09-22：下層 500→700、二號 1200→1800。生產迴圈改版（D32–D34）之後產量
 * 與住客數同時變多，後兩區一度在 13／19 分就解鎖，長期目標變得不長期。
 * 這兩個數字調完實測回到 24／37 分（D24 目標 ≤45／≤90）。
 */
export function defaultZones(): Zone[] {
  return [
    { id: zoneKey(0, 1), cabinet: 0, tier: 1, name: '一號櫥窗・中層', shortName: '中層', unlocked: true, price: 0 },
    { id: zoneKey(0, 2), cabinet: 0, tier: 2, name: '一號櫥窗・上層', shortName: '上層', unlocked: false, price: 200 },
    { id: zoneKey(0, 0), cabinet: 0, tier: 0, name: '一號櫥窗・下層', shortName: '下層', unlocked: false, price: 700 },
    { id: zoneKey(1, 1), cabinet: 1, tier: 1, name: '二號櫥窗・中層', shortName: '二號・中層', unlocked: false, price: 1800 },
  ];
}

export function findZone(state: GameState, id: string): Zone | undefined {
  return state.zones.find((z) => z.id === id);
}

export function unlockedZones(state: GameState): Zone[] {
  return state.zones.filter((z) => z.unlocked);
}

/** 下一個買得起／該買的分區（UI 只推一個，不要一次列四個讓人選） */
export function nextLockedZone(state: GameState): Zone | undefined {
  return state.zones.filter((z) => !z.unlocked).sort((a, b) => a.price - b.price)[0];
}

export function puddingsIn(state: GameState, zone: string): Pudding[] {
  return state.puddings.filter((p) => p.zone === zone);
}

export function basinsIn(state: GameState, zone: string): Basin[] {
  return state.basins.filter((b) => b.zone === zone);
}

export function dropsIn(state: GameState, zone: string): Drop[] {
  return state.drops.filter((d) => d.zone === zone);
}

/** 澡盆在全域陣列裡的索引（`Pudding.basinIndex` 存的是這個） */
export function basinIndicesIn(state: GameState, zone: string): number[] {
  const out: number[] = [];
  state.basins.forEach((b, i) => {
    if (b.zone === zone) out.push(i);
  });
  return out;
}
