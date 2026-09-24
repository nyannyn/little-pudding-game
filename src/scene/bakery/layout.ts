import type { StationId } from '../../game/recipes';

/**
 * 甜點工坊的平面配置（世界座標，地板 y=0，+z 朝鏡頭）。
 *
 * D57（2026-09-24 使用者：「甜點店應該要有流水線的樣子」）：七台機器沿一條 **U 型輸送帶**排——
 * 後排由左往右 爐台 → 打蛋機 → 攪拌機 → 裝模機，右側轉下來穿過隧道烤箱，前排由右往左
 * 冷藏櫃 → 裝飾台，出口往下接成品櫃。每道甜點只在自己要的站停，其他站輸送帶直接帶過。
 * 店面（展示櫃、收銀台、店門、咖啡座）照舊在房間前半。
 */
export const ROOM = {
  halfW: 1.25,
  backZ: -2.4,
  frontZ: 2.4,
  wallH: 2.1,
} as const;

/** 輸送帶：帶面高度、寬度 */
export const BELT = { y: 0.6, w: 0.34 } as const;

/**
 * 輸送帶中心線（依行進方向）。後排 → 右轉往前 → 前排往左 → 左轉往前到出口。
 * 盤子的位置一律用「沿這條線走了多遠」表示（`pathPoint`），轉角就不必每站各寫一套。
 */
export const BELT_PATH: { x: number; z: number }[] = [
  { x: -1.0, z: -1.86 },
  { x: 0.98, z: -1.86 },
  { x: 0.98, z: -0.5 },
  { x: -0.98, z: -0.5 },
  { x: -0.98, z: -0.02 },
];

function segLen(i: number): number {
  const a = BELT_PATH[i]!;
  const b = BELT_PATH[i + 1]!;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export const BELT_LENGTH = BELT_PATH.slice(0, -1).reduce((n, _, i) => n + segLen(i), 0);

/** 沿輸送帶走了 d 的那一點（xz）與行進方向（弧度，0＝+x） */
export function pathPoint(d: number): { x: number; z: number; dir: number } {
  let left = Math.max(0, Math.min(BELT_LENGTH, d));
  for (let i = 0; i < BELT_PATH.length - 1; i++) {
    const a = BELT_PATH[i]!;
    const b = BELT_PATH[i + 1]!;
    const len = segLen(i);
    if (left <= len || i === BELT_PATH.length - 2) {
      const k = len > 0 ? left / len : 0;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, dir: Math.atan2(b.z - a.z, b.x - a.x) };
    }
    left -= len;
  }
  const last = BELT_PATH[BELT_PATH.length - 1]!;
  return { x: last.x, z: last.z, dir: Math.PI / 2 };
}

/** 各站在輸送帶上的位置（沿線距離）：後排四台間距 0.5、烤箱在右側中段、前排兩台 */
export const STATION_AT: Record<StationId, number> = {
  stove: 0.24,
  crack: 0.74,
  mix: 1.24,
  mold: 1.74,
  bake: 1.98 + 0.66,
  chill: 1.98 + 1.36 + 0.66,
  decorate: 1.98 + 1.36 + 1.36,
};

/** 各站「那一盤」在哪裡（盤子中心；y＝帶面） */
export const STATION_ANCHOR: Record<StationId, { x: number; y: number; z: number }> = (() => {
  const out = {} as Record<StationId, { x: number; y: number; z: number }>;
  for (const [id, d] of Object.entries(STATION_AT) as [StationId, number][]) {
    const p = pathPoint(d);
    out[id] = { x: p.x, y: BELT.y, z: p.z };
  }
  return out;
})();

/** 機器頭上那一點：HUD 標籤（名稱／等級／份數／進度條）貼在這裡 */
export const STATION_BAR: Record<StationId, { x: number; y: number; z: number }> = {
  stove: { x: STATION_ANCHOR.stove.x, y: 1.28, z: STATION_ANCHOR.stove.z - 0.1 },
  crack: { x: STATION_ANCHOR.crack.x, y: 1.3, z: STATION_ANCHOR.crack.z - 0.1 },
  mix: { x: STATION_ANCHOR.mix.x, y: 1.3, z: STATION_ANCHOR.mix.z - 0.1 },
  mold: { x: STATION_ANCHOR.mold.x, y: 1.44, z: STATION_ANCHOR.mold.z - 0.1 },
  bake: { x: 0.98, y: BELT.y + 0.8, z: STATION_ANCHOR.bake.z + 0.2 },
  chill: { x: STATION_ANCHOR.chill.x, y: BELT.y + 0.62, z: STATION_ANCHOR.chill.z },
  decorate: { x: STATION_ANCHOR.decorate.x, y: BELT.y + 0.8, z: STATION_ANCHOR.decorate.z },
};

/** 隧道烤箱：跨在右側那段帶子上（長邊沿 z） */
export const OVEN = { x: 0.98, z: STATION_ANCHOR.bake.z, len: 0.62, w: 0.56, h: 0.42 } as const;
/** 冷藏櫃：跨在前排帶子上的玻璃隧道 */
export const CHILL = { x: STATION_ANCHOR.chill.x, z: -0.5, len: 0.54, w: 0.54, h: 0.4 } as const;

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

/** 成品櫃（做好還沒上架的甜點）：輸送帶出口前面、靠左牆的三層小架 */
export const RACK = { x: -1.02, z: 0.4, w: 0.36, d: 0.5 } as const;
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

/** 蛋籃（打蛋機旁邊，打蛋時蛋從這裡飛上臂） */
export const EGG_BASKET = { x: -0.5, y: BELT.y + 0.02, z: -2.2 } as const;

/** 鏡頭：從前上方往下看整間店 */
export const VIEW = {
  target: { x: 0, y: 0.5, z: -0.1 },
  /** 俯角（從水平往下） */
  tiltDeg: 52,
  /** 要塞進畫面的寬度（房間寬＋一點邊） */
  fitWidth: 2.72,
} as const;

/**
 * 壁燈（2026-09-24 使用者：「甜點店應該要開燈」）：天黑之後亮。
 * 後牆上半段被頂列 HUD 蓋住，燈掛在左右兩面側牆才看得到；`nx` 是牆面朝室內的法線（x 方向）。
 * 左牆避開窗（z −0.9〜0.1）與成品櫃上方；右牆避開店門。
 */
export const WALL_LAMPS: { x: number; y: number; z: number; nx: number }[] = [
  { x: -ROOM.halfW, y: 1.5, z: -1.55, nx: 1 },
  { x: -ROOM.halfW, y: 1.5, z: 0.95, nx: 1 },
  { x: ROOM.halfW, y: 1.5, z: -1.95, nx: -1 },
  { x: ROOM.halfW, y: 1.5, z: 0.35, nx: -1 },
];

/** 天花板燈照在地上的暖光圈（俯視看得到的「燈開著」）：中間走道、展示櫃前、咖啡座 */
export const FLOOR_POOLS: { x: number; z: number; r: number }[] = [
  { x: 0, z: -1.2, r: 0.95 },
  { x: -0.1, z: 0.55, r: 0.95 },
  { x: 0.2, z: 1.85, r: 0.9 },
];
