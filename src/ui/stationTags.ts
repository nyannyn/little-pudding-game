import { stationProgress, stationStatus } from '../game/bakery';
import { MACHINE_PORTIONS, MAX_MACHINE_LEVEL, STATIONS, STATION_IDS, type StationId } from '../game/recipes';
import type { GameState } from '../game/state';

/**
 * 工坊每台機器頭上的小標籤（2026-09-24 使用者：「正在製作的地方上面應該顯示可容納數量跟可以升級的圖標跟進度條」；
 * 同日追加：「容量字小一點、再用更小的字寫第幾 Lv 跟機器名稱，機器下方的名牌就可以移除」）。
 * 名牌拿掉之後名稱只剩這裡，所以**七台一律都有標籤**：
 * - 第一行：機器名稱＋「Lv2」（小字）；沒買寫「未購買」、整塊變淡。
 * - 第二行：份數「這盤／這台上限」（使用者選的格式）；空著寫「0/上限」。上限＝這台自己的等級（1／2／4 份），
 *   一盤實際做幾份看路線上最低那台，所以左右數字不一樣＝材料或別台機器卡住。
 * - 進度條：做的時候粉紅往右長、做完在等下一站空出來變綠；空著是空條。
 * - 右上角升級徽章：還沒滿級才有（沒買的也有＝買）；錢夠亮綠、錢不夠灰。整塊標籤就是按鈕（main.ts 決定點了做什麼）。
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
      btn.innerHTML =
        `<span class="nm"><span class="n">${STATIONS[id].name}</span><span class="lv"></span></span>` +
        '<span class="q"><b></b><span class="of">/<span class="cap"></span>份</span></span>' +
        '<span class="bar"><i></i></span>' +
        '<span class="up" hidden><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.8 10.4 6.6H7.7V10.4H4.3V6.6H1.6Z" fill="currentColor"/></svg></span>';
      this.root.appendChild(btn);
      this.tags[id] = {
        el: btn,
        lv: btn.querySelector('.lv') as HTMLElement,
        qty: btn.querySelector('.q b') as HTMLElement,
        of: btn.querySelector('.q .of') as HTMLElement,
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
   * 寬度按「同一排相鄰兩台的水平間距」縮：後排在 390px 寬隔約 44px、320px 寬只剩約 36px（窄到放不下就把名稱與 Lv 分兩行）。
   * 不同排但靠得近的（320px 寬的裝模機與烤箱）把下面那個往下推，標籤之間不重疊。
   */
  place(points: Record<StationId, { x: number; y: number }>, keepBelow: number) {
    let gap = Infinity;
    for (const a of STATION_IDS) {
      for (const b of STATION_IDS) {
        if (a < b && Math.abs(points[a].y - points[b].y) < 4) gap = Math.min(gap, Math.abs(points[a].x - points[b].x));
      }
    }
    const w = Math.max(MIN_W, Math.min(TAG_W, Math.floor(gap) - 3));
    const narrow = w < WIDE_W;
    const h = narrow ? TAG_H_NARROW : TAG_H;
    this.root.style.setProperty('--stag-w', `${w}px`);
    this.root.classList.toggle('narrow', narrow);

    const minBottom = keepBelow + BADGE_UP + h + 3;
    const ys: Record<string, number> = {};
    for (const id of STATION_IDS) ys[id] = Math.max(points[id].y, minBottom);
    // 由上往下排：跟上面任何一個水平重疊、垂直又太近，就推到它下面
    const order = [...STATION_IDS].sort((a, b) => ys[a]! - ys[b]!);
    for (let i = 0; i < order.length; i++) {
      const id = order[i]!;
      for (let j = 0; j < i; j++) {
        const up = order[j]!;
        if (Math.abs(points[id].x - points[up].x) < w + 2 && ys[id]! - ys[up]! < h + 4) ys[id] = ys[up]! + h + 4;
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
      const maxed = lv >= MAX_MACHINE_LEVEL;
      const affordable = !maxed && state.coins >= (STATIONS[id].prices[lv] ?? Infinity);
      const ready = status === 'ready';
      const qty = b && status !== 'idle' ? b.qty : 0;
      const cap = MACHINE_PORTIONS[lv] ?? 0;
      const key = `${lv}:${qty}:${maxed ? 'max' : affordable ? 'up' : 'poor'}:${status}`;
      if (key !== t.key) {
        t.key = key;
        t.lv.textContent = lv > 0 ? `Lv${lv}` : '';
        t.qty.textContent = lv > 0 ? String(qty) : '未購買';
        t.of.hidden = lv === 0;
        t.cap.textContent = String(cap);
        t.up.hidden = maxed;
        t.el.classList.toggle('off', lv === 0);
        t.el.classList.toggle('afford', affordable);
        t.el.classList.toggle('ready', ready);
        const name = STATIONS[id].name;
        t.el.setAttribute(
          'aria-label',
          lv === 0
            ? `${name}：未購買${affordable ? '，買得起' : ''}`
            : `${name} Lv${lv}：這盤 ${qty} 份，這台最多 ${cap} 份${maxed ? '，已滿級' : affordable ? '，可以升級' : ''}`,
        );
      }
      const pct = ready ? 100 : status === 'working' ? Math.round(stationProgress(state, id) * 200) / 2 : 0;
      if (pct !== t.pct) {
        t.pct = pct;
        t.fill.style.width = `${pct}%`;
      }
    }
  }
}

/** 標籤最寬（CSS px）與高度（含兩行字＋進度條；窄版名稱與 Lv 分兩行）；跟 hud.css 的 `.stag` 對齊 */
const TAG_W = 42;
const MIN_W = 30;
/** 比這窄就把名稱與 Lv 分兩行 */
const WIDE_W = 38;
const TAG_H = 34;
const TAG_H_NARROW = 41;
/** 升級徽章凸出標籤頂邊多少（hud.css `.stag .up` 的 top） */
const BADGE_UP = 13;

interface Tag {
  el: HTMLButtonElement;
  lv: HTMLElement;
  qty: HTMLElement;
  of: HTMLElement;
  cap: HTMLElement;
  up: HTMLElement;
  fill: HTMLElement;
  key: string;
  pct: number;
}
