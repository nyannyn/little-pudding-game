import { stationProgress, stationStatus } from '../game/bakery';
import { MACHINE_PORTIONS, MAX_MACHINE_LEVEL, STATIONS, STATION_IDS, type StationId } from '../game/recipes';
import type { GameState } from '../game/state';

/**
 * 工坊每台機器頭上的小標籤（2026-09-24 使用者：「正在製作的地方上面應該顯示可容納數量跟可以升級的圖標跟進度條」）。
 * 只在那一站上有一盤時出現：
 * - 份數「這盤／這台上限」（使用者選的格式）：上限＝這台自己的等級（1／2／4 份）；一盤實際做幾份看路線上最低那台，
 *   所以左右數字不一樣就代表是材料或別台機器卡住。
 * - 進度條：做的時候粉紅往右長、做完在等下一站空出來變綠。
 * - 升級圖示：還沒滿級才有；錢夠亮綠、錢不夠灰。整塊標籤就是按鈕，點了開商店工坊頁、捲到這台（main.ts）。
 *
 * 七個標籤建一次，之後只改文字、寬度、class——不重建 innerHTML（重建會把手指底下的按鈕換掉，D55／D56 各被咬過一次）。
 * 位置由 main.ts 在鏡頭重框後給一次（工坊鏡頭固定，不必每幀投影）。
 */
export class StationTags {
  readonly root: HTMLElement;
  private readonly tags = {} as Record<StationId, Tag>;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'stags bakery-only';
    for (const id of STATION_IDS) {
      const btn = document.createElement('button');
      btn.className = 'stag';
      btn.dataset.a = 'stationTag';
      btn.dataset.arg = id;
      btn.hidden = true;
      btn.innerHTML =
        '<span class="q"><b></b>/<span class="cap"></span><span class="u">份</span></span>' +
        '<span class="bar"><i></i></span>' +
        '<span class="up" hidden><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.8 10.4 6.6H7.7V10.4H4.3V6.6H1.6Z" fill="currentColor"/></svg></span>';
      this.root.appendChild(btn);
      this.tags[id] = {
        el: btn,
        qty: btn.querySelector('.q b') as HTMLElement,
        cap: btn.querySelector('.cap') as HTMLElement,
        up: btn.querySelector('.up') as HTMLElement,
        fill: btn.querySelector('.bar > i') as HTMLElement,
        key: '',
        pct: -1,
      };
    }
  }

  /**
   * 擺位置。`points`＝各站頭上那一點的畫面座標（CSS px，標籤底邊中點對齊它）；
   * `keepBelow`＝整塊標籤（含凸出的升級徽章）都要在這條線以下（後排四台的頭頂在左上日曆卡的高度，不壓低就被卡片蓋掉，2026-09-24 截圖）。
   * 寬度按「同一排相鄰兩台的水平間距」縮：後排在 390px 寬隔約 44px、320px 寬只剩約 36px（窄到放不下就省掉「份」字）。
   * 不同排但靠得近的（320px 寬的裝模機與烤箱）把下面那個往下推，標籤之間不重疊。
   */
  place(points: Record<StationId, { x: number; y: number }>, keepBelow: number) {
    const minBottom = keepBelow + BADGE_UP + TAG_H + 3;
    const ys: Record<string, number> = {};
    for (const id of STATION_IDS) ys[id] = Math.max(points[id].y, minBottom);
    let gap = Infinity;
    for (const a of STATION_IDS) {
      for (const b of STATION_IDS) {
        if (a < b && Math.abs(ys[a]! - ys[b]!) < 4) gap = Math.min(gap, Math.abs(points[a].x - points[b].x));
      }
    }
    const w = Math.max(MIN_W, Math.min(TAG_W, Math.floor(gap) - 3));
    this.root.style.setProperty('--stag-w', `${w}px`);
    this.root.classList.toggle('narrow', w < WIDE_W);
    // 由上往下排：跟上面任何一個水平重疊、垂直又太近，就推到它下面
    const order = [...STATION_IDS].sort((a, b) => ys[a]! - ys[b]!);
    for (let i = 0; i < order.length; i++) {
      const id = order[i]!;
      for (let j = 0; j < i; j++) {
        const up = order[j]!;
        if (Math.abs(points[id].x - points[up].x) < w + 2 && ys[id]! - ys[up]! < TAG_H + 4) ys[id] = ys[up]! + TAG_H + 4;
      }
    }
    for (const id of STATION_IDS) {
      const st = this.tags[id].el.style;
      st.left = `${Math.round(points[id].x)}px`;
      st.top = `${Math.round(ys[id]!)}px`;
    }
  }

  update(state: GameState) {
    for (const id of STATION_IDS) {
      const t = this.tags[id];
      const b = state.bakery.stations[id].batch;
      const status = stationStatus(state, id);
      const lv = state.bakery.machines[id];
      if (!b || status === 'idle') {
        if (!t.el.hidden) t.el.hidden = true;
        t.key = '';
        continue;
      }
      const maxed = lv >= MAX_MACHINE_LEVEL;
      const affordable = !maxed && state.coins >= (STATIONS[id].prices[lv] ?? Infinity);
      const ready = status === 'ready';
      const key = `${b.qty}/${MACHINE_PORTIONS[lv] ?? 0}:${maxed ? 'max' : affordable ? 'up' : 'poor'}:${ready ? 'r' : 'w'}`;
      if (key !== t.key) {
        t.key = key;
        t.el.hidden = false;
        t.qty.textContent = String(b.qty);
        t.cap.textContent = String(MACHINE_PORTIONS[lv] ?? 0);
        t.up.hidden = maxed;
        t.el.classList.toggle('afford', affordable);
        t.el.classList.toggle('ready', ready);
        t.el.setAttribute(
          'aria-label',
          `${STATIONS[id].name}：這盤 ${b.qty} 份，這台最多 ${MACHINE_PORTIONS[lv] ?? 0} 份${maxed ? '，已滿級' : affordable ? '，可以升級' : ''}`,
        );
      }
      const pct = ready ? 100 : Math.round(stationProgress(state, id) * 200) / 2;
      if (pct !== t.pct) {
        t.pct = pct;
        t.fill.style.width = `${pct}%`;
      }
    }
  }
}

/** 標籤最寬（CSS px）與高度（判斷兩個標籤是不是在同一排）；跟 hud.css 的 `.stag` 對齊 */
const TAG_W = 42;
const MIN_W = 30;
/** 比這窄就只寫「2/4」不寫「份」 */
const WIDE_W = 38;
const TAG_H = 26;
/** 升級徽章凸出標籤頂邊多少（hud.css `.stag .up` 的 top） */
const BADGE_UP = 10;

interface Tag {
  el: HTMLButtonElement;
  qty: HTMLElement;
  cap: HTMLElement;
  up: HTMLElement;
  fill: HTMLElement;
  key: string;
  pct: number;
}
