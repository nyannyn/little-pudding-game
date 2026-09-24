import { REGULARS } from '../game/regulars';
import type { RegularAnchor } from '../scene/bakery/bakeryView';

/**
 * 常客頭上的名字泡泡（D70）：走進來時寫名字，買到換成愛心、沒買到換成失望的臉。
 * HTML 疊層，不吃 draw call（跟底座牌同一套）；常客會走動，所以每幀由 main.ts 餵畫面座標。
 * 同時最多 2 位（D69），泡泡建兩顆重複用，不每幀建 DOM。
 */
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2c-4.8-3-8.2-6.2-8.2-9.8a4.2 4.2 0 0 1 8.2-1.3 4.2 4.2 0 0 1 8.2 1.3c0 3.6-3.4 6.8-8.2 9.8Z" fill="#ec5a63" stroke="#c2394a" stroke-width="1.6"/></svg>';
const SAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#cfe3f2" stroke="#6f8fa8" stroke-width="1.6"/><circle cx="9" cy="10" r="1.2" fill="#3d5568"/><circle cx="15" cy="10" r="1.2" fill="#3d5568"/><path d="M8.6 16.4c2-1.8 4.8-1.8 6.8 0" fill="none" stroke="#3d5568" stroke-width="1.6" stroke-linecap="round"/></svg>';

export class RegularTags {
  readonly root: HTMLElement;
  private readonly tags: HTMLElement[] = [];

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'rtags bakery-only';
    for (let i = 0; i < 2; i++) {
      const t = document.createElement('div');
      t.className = 'rtag';
      t.hidden = true;
      t.innerHTML = '<span class="ic"></span><b></b>';
      this.root.appendChild(t);
      this.tags.push(t);
    }
  }

  /** `anchors` 的 ndc 轉成 CSS px；`w`／`h`＝畫布的 CSS 尺寸 */
  place(anchors: readonly RegularAnchor[], w: number, h: number) {
    this.tags.forEach((t, i) => {
      const a = anchors[i];
      if (!a) {
        t.hidden = true;
        return;
      }
      t.hidden = false;
      const name = REGULARS[a.id].name;
      const b = t.querySelector('b') as HTMLElement;
      if (b.textContent !== name) b.textContent = name;
      if (t.dataset.mood !== a.mood) {
        t.dataset.mood = a.mood;
        (t.querySelector('.ic') as HTMLElement).innerHTML = a.mood === 'happy' ? HEART : a.mood === 'sad' ? SAD : '';
      }
      t.style.transform = `translate(${Math.round(((a.ndc.x + 1) / 2) * w)}px, ${Math.round(((1 - a.ndc.y) / 2) * h)}px) translate(-50%, -100%)`;
    });
  }

  hide() {
    for (const t of this.tags) t.hidden = true;
  }
}
