import type { StationId } from '../../game/bakery';

/**
 * 甜點工坊的平面配置（世界座標，地板 y=0，+z 朝鏡頭）。
 *
 * 直向手機只有約 18° 的水平視角：房間做得跟農場櫥窗一樣「窄而深」，
 * 五站排成一條往鏡頭走的 Z 字——後排工作檯（打蛋 → 攪拌 → 裝模）、
 * 中排（烤箱 → 裝飾台）、前排展示櫃與店門。甜點一路往前流、最後擺到客人面前，
 * 玩家從上往下看就是「做甜點的順序」。
 */
export const ROOM = {
  halfW: 1.25,
  backZ: -2.4,
  frontZ: 2.4,
  wallH: 2.1,
} as const;

/** 後排工作檯 */
export const COUNTER = { z: -2.05, depth: 0.62, top: 0.78 } as const;

/** 每一站「那一盤」擺在哪裡（盤子中心） */
export const STATION_ANCHOR: Record<StationId, { x: number; y: number; z: number }> = {
  crack: { x: -0.8, y: COUNTER.top + 0.1, z: -1.88 },
  mix: { x: 0, y: COUNTER.top + 0.13, z: -1.9 },
  mold: { x: 0.8, y: COUNTER.top + 0.09, z: -1.86 },
  bake: { x: -0.62, y: 0.47, z: -0.52 },
  decorate: { x: 0.68, y: 0.86, z: -0.62 },
};

/** 名牌掛在各站上方多高、往前多少（z） */
export const STATION_LABEL: Record<StationId, { x: number; y: number; z: number }> = {
  crack: { x: -0.8, y: 1.66, z: -2.3 },
  mix: { x: 0, y: 1.66, z: -2.3 },
  mold: { x: 0.8, y: 1.66, z: -2.3 },
  bake: { x: -0.62, y: 1.5, z: -0.62 },
  decorate: { x: 0.68, y: 1.5, z: -0.8 },
};

export const OVEN = { x: -0.62, z: -0.72, w: 0.98, h: 1.12, d: 0.68 } as const;
export const DECOR = { x: 0.68, z: -0.62, top: 0.74, w: 0.82, d: 0.62 } as const;

/** 展示櫃：兩層、每層 6 格＝`shelfCap` 12 */
export const SHOWCASE = { x: -0.25, z: 1.2, w: 1.84, d: 0.6, baseH: 0.52, glassH: 0.46 } as const;
export const SHELF_SLOTS: { x: number; y: number; z: number }[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  const cols = 6;
  const x0 = SHOWCASE.x - SHOWCASE.w / 2 + 0.18;
  const step = (SHOWCASE.w - 0.36) / (cols - 1);
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: x0 + c * step, y: SHOWCASE.baseH + 0.02 + row * 0.16, z: SHOWCASE.z + 0.1 - row * 0.2 });
    }
  }
  return out;
})();

/** 成品櫃（做好還沒上架的甜點）：靠左牆的三層小架 */
export const RACK = { x: -1.02, z: 0.2, w: 0.36, d: 0.5 } as const;
export const RACK_SLOTS: { x: number; y: number; z: number }[] = (() => {
  const out: { x: number; y: number; z: number }[] = [];
  for (let tier = 0; tier < 3; tier++) {
    for (let i = 0; i < 3; i++) out.push({ x: RACK.x, y: 0.36 + tier * 0.34, z: RACK.z - 0.15 + i * 0.15 });
  }
  return out;
})();

export const REGISTER = { x: 0.95, z: 1.2 } as const;

/** 右牆的店門開口（z 範圍） */
export const DOOR_Z0 = 1.3;
export const DOOR_Z1 = 2.05;
/** 客人：從右牆的店門進來，走到展示櫃前面挑，再走出去 */
export const DOOR = { x: 1.6, z: (DOOR_Z0 + DOOR_Z1) / 2 } as const;
export const QUEUE_Z = 1.72;

/** 前排左邊的小咖啡座 */
export const CAFE = { x: -0.62, z: 2.0 } as const;

/** 蛋籃（打蛋站的新一盤從這裡飛過去） */
export const EGG_BASKET = { x: -1.05, y: COUNTER.top + 0.08, z: -1.75 } as const;

/** 鏡頭：從前上方往下看整間店 */
export const VIEW = {
  target: { x: 0, y: 0.55, z: -0.05 },
  /** 俯角（從水平往下） */
  tiltDeg: 50,
  /** 要塞進畫面的寬度（房間寬＋一點邊） */
  fitWidth: 2.72,
} as const;
