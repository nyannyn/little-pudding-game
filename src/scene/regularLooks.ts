import type { RegularId } from '../game/regulars';

/**
 * 常客的外觀（D69）：原創方塊動物。使用者給的參考圖是方塊像素風格的角色選單——
 * **那些角色是別人的作品，不能放進公開 repo**；這裡只取「方塊組成、配色鮮明、一個配件講個性」的風格，
 * 八位全部是自己的設定（故事草稿 `docs/plans/regulars-stories.md` 的外觀描述）。
 *
 * 純資料、不 import three.js：3D 產生器（`voxelAnimal.ts`）與名冊的 2D 頭像（`ui/regularPortrait.ts`）讀同一份，
 * 頭像才會跟店裡走進來的那一位長得一樣。座標單位：身高約 2.2（場景端再縮放）。
 */

/** 一顆方塊：寬、高、深、中心 x／y／z、顏色 */
export type Box = [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

export type EarKind = 'round' | 'long' | 'wool' | 'pointy' | 'none';

export interface AnimalSpec {
  body: number;
  belly: number;
  ears: EarKind;
  earIn?: number;
  /** 臉的顏色（綿羊是深色臉）；不給＝跟身體同色 */
  face?: number;
  /** 口鼻那一塊的顏色；不給＝肚子色 */
  muzzle?: number;
  nose?: number;
  /** 眼睛長在頭頂（青蛙） */
  eyesTop?: boolean;
  /** 配件（領結、圍裙、眼鏡、帽子…） */
  acc: Box[];
}

const DARK = 0x2a1d18;

export const REGULAR_LOOKS: Record<RegularId, AnimalSpec> = {
  // 棕熊、奶油色口鼻、紅領結
  bear: {
    body: 0x9a6035, belly: 0xf1d3a8, ears: 'round',
    acc: [[0.5, 0.14, 0.1, 0, 0.98, 0.37, 0xd9485f], [0.14, 0.14, 0.12, 0, 0.98, 0.4, 0xb8354b]],
  },
  // 白兔、粉紅長耳、草莓圍裙
  rabbit: {
    body: 0xfaf6f0, belly: 0xffe3ea, ears: 'long', earIn: 0xf7a7b8,
    acc: [[0.7, 0.55, 0.06, 0, 0.55, 0.38, 0xf28aa5], [0.2, 0.2, 0.08, 0, 0.62, 0.42, 0xe0405c], [0.1, 0.06, 0.06, 0, 0.75, 0.42, 0x6cbf6a]],
  },
  // 捲捲羊毛、深色臉、金框眼鏡
  sheep: {
    body: 0xfff1dc, belly: 0xfff8ec, ears: 'wool', face: 0x6a5a54, muzzle: 0x8a7a72,
    acc: [[0.2, 0.12, 0.04, -0.2, 1.42, 0.44, 0xd6b25a], [0.2, 0.12, 0.04, 0.2, 1.42, 0.44, 0xd6b25a], [0.2, 0.04, 0.04, 0, 1.44, 0.44, 0xd6b25a]],
  },
  // 綠青蛙、眼睛長在頭頂、抹茶色圍巾
  frog: {
    body: 0x7cc46a, belly: 0xdaf0c0, ears: 'none', eyesTop: true, nose: 0x4f8f45,
    acc: [[0.95, 0.16, 0.8, 0, 1.0, 0.02, 0x4f8f45], [0.18, 0.4, 0.08, 0.3, 0.75, 0.42, 0x4f8f45]],
  },
  // 灰褐貓頭鷹、單片眼鏡、學士帽
  owl: {
    body: 0x8a7058, belly: 0xe9dcc4, ears: 'pointy', earIn: 0x6e5844, muzzle: 0xe9dcc4, nose: 0xe0a33a,
    acc: [
      [0.22, 0.22, 0.04, 0.22, 1.42, 0.43, 0xd6b25a], [0.12, 0.12, 0.05, 0.22, 1.42, 0.44, 0xfff8e6],
      [0.9, 0.08, 0.9, 0, 1.72, 0.05, 0x2d2a33], [0.5, 0.14, 0.5, 0, 1.64, 0.05, 0x2d2a33], [0.04, 0.3, 0.04, 0.4, 1.58, 0.45, 0xe0a33a],
    ],
  },
  // 橘紅狐狸、白尾尖、廚師小帽
  fox: {
    body: 0xe8773a, belly: 0xfff6ec, ears: 'pointy', earIn: 0x3a2a24, muzzle: 0xfff6ec,
    acc: [
      [0.44, 0.3, 0.44, 0, 1.78, 0.05, 0xffffff], [0.56, 0.1, 0.56, 0, 1.66, 0.05, 0xffffff],
      [0.26, 0.26, 0.5, 0.35, 0.45, -0.5, 0xe8773a], [0.26, 0.26, 0.16, 0.35, 0.45, -0.82, 0xfff6ec],
    ],
  },
  // 粉紅小豬、白色廚師帽、藍圍巾
  pig: {
    body: 0xf6b3c0, belly: 0xfad3dc, ears: 'round', earIn: 0xe98aa0, muzzle: 0xee9fb0, nose: 0xc76a82,
    acc: [
      [0.5, 0.36, 0.5, 0, 1.86, 0.05, 0xffffff], [0.62, 0.1, 0.62, 0, 1.7, 0.05, 0xffffff],
      [0.95, 0.14, 0.8, 0, 1.0, 0.02, 0x5b8fd6],
    ],
  },
  // 黑白企鵝、郵差帽、斜背信差包
  penguin: {
    body: 0x2c2d3a, belly: 0xffffff, ears: 'none', face: 0x2c2d3a, muzzle: 0xffffff, nose: 0xf0a030,
    acc: [
      [0.84, 0.16, 0.76, 0, 1.73, 0.04, 0x3f63a8], [0.5, 0.05, 0.22, 0, 1.66, 0.45, 0x2f4a80], [0.16, 0.12, 0.05, 0, 1.76, 0.43, 0xf4d35e],
      [0.1, 0.8, 0.06, -0.1, 0.62, 0.37, 0x9a6a3a], [0.34, 0.3, 0.16, 0.42, 0.34, 0.2, 0xb07a44],
    ],
  },
};

/** 動物模板：身體＋頭＋腳＋眼＋口鼻，耳朵與配件按 spec 換（2026-09-25 原型 `tools/proto-regulars/` 的同一套） */
export function animalBoxes(s: AnimalSpec): Box[] {
  const B: Box[] = [];
  const face = s.face ?? s.body;
  B.push([0.9, 0.8, 0.7, 0, 0.55, 0, s.body]);
  B.push([0.6, 0.5, 0.05, 0, 0.5, 0.36, s.belly]);
  B.push([0.25, 0.2, 0.3, -0.25, 0.1, 0.05, s.body]);
  B.push([0.25, 0.2, 0.3, 0.25, 0.1, 0.05, s.body]);
  B.push([0.8, 0.7, 0.7, 0, 1.3, 0.05, face]);
  B.push([0.4, 0.25, 0.15, 0, 1.18, 0.45, s.muzzle ?? s.belly]);
  B.push([0.14, 0.1, 0.06, 0, 1.26, 0.53, s.nose ?? 0x3a2a24]);
  if (s.eyesTop) {
    B.push([0.28, 0.24, 0.28, -0.24, 1.7, 0.15, s.body], [0.28, 0.24, 0.28, 0.24, 1.7, 0.15, s.body]);
    B.push([0.12, 0.14, 0.06, -0.22, 1.72, 0.32, DARK], [0.12, 0.14, 0.06, 0.22, 1.72, 0.32, DARK]);
  } else {
    B.push([0.12, 0.14, 0.06, -0.22, 1.42, 0.41, DARK], [0.12, 0.14, 0.06, 0.22, 1.42, 0.41, DARK]);
  }
  B.push([0.1, 0.06, 0.04, -0.3, 1.24, 0.42, 0xf5a3b5], [0.1, 0.06, 0.04, 0.3, 1.24, 0.42, 0xf5a3b5]);
  const e = s.earIn ?? s.belly;
  if (s.ears === 'round') B.push([0.22, 0.22, 0.15, -0.3, 1.75, 0, s.body], [0.22, 0.22, 0.15, 0.3, 1.75, 0, s.body], [0.12, 0.12, 0.04, -0.3, 1.75, 0.08, e], [0.12, 0.12, 0.04, 0.3, 1.75, 0.08, e]);
  if (s.ears === 'long') B.push([0.18, 0.6, 0.12, -0.18, 1.95, -0.05, s.body], [0.18, 0.6, 0.12, 0.18, 1.95, -0.05, s.body], [0.08, 0.45, 0.04, -0.18, 1.95, 0.02, e], [0.08, 0.45, 0.04, 0.18, 1.95, 0.02, e]);
  if (s.ears === 'pointy') B.push([0.2, 0.3, 0.12, -0.28, 1.78, 0, s.body], [0.2, 0.3, 0.12, 0.28, 1.78, 0, s.body], [0.1, 0.12, 0.13, -0.28, 1.9, 0, e], [0.1, 0.12, 0.13, 0.28, 1.9, 0, e]);
  if (s.ears === 'wool') for (const [x, z] of [[-0.25, -0.1], [0, 0], [0.25, -0.1], [-0.12, 0.15], [0.12, 0.15]] as const) B.push([0.32, 0.25, 0.32, x, 1.7, z, 0xfff6e6]);
  B.push(...s.acc);
  return B;
}
