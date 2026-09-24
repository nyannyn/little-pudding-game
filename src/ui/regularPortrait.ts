import type { RegularId } from '../game/regulars';
import { REGULAR_LOOKS, animalBoxes } from '../scene/regularLooks';

/**
 * 名冊頭像（D69）：同一份方塊 spec 在 2D canvas 畫**正面投影**——不另開第二個 WebGL context
 * （手機 Safari 同時開兩個 context 很容易觸發 context lost）。
 * 由後往前畫每一顆方塊的正面矩形，側面用一條深一點的邊帶一點立體感。畫一次、存成 data URL。
 */
const cache = new Map<RegularId, string>();

function shade(hex: number, k: number): string {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return `rgb(${r},${g},${b})`;
}

export function regularPortrait(id: RegularId, size = 96): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return '';
  // 頭部為主（名冊的格子很小）：取 y 0.75–2.3 那一段
  const top = 2.3;
  const bottom = 0.75;
  const scale = size / (top - bottom);
  const cx = size / 2;
  const boxes = animalBoxes(REGULAR_LOOKS[id]).slice().sort((a, b) => a[5] + a[2] / 2 - (b[5] + b[2] / 2));
  for (const [w, h, d, x, y, z, col] of boxes) {
    void d;
    void z;
    const px = cx + (x - w / 2) * scale;
    const py = (top - (y + h / 2)) * scale;
    const pw = w * scale;
    const ph = h * scale;
    g.fillStyle = shade(col, 0.82);
    g.fillRect(px, py, pw, ph);
    g.fillStyle = shade(col, 1);
    g.fillRect(px, py, pw, Math.max(1, ph - Math.max(1, ph * 0.08)));
  }
  const url = c.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
