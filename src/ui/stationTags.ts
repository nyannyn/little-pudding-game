import { stationProgress, stationStatus } from '../game/bakery';
import { STATIONS, STATION_IDS, machinePortions, machinePrice, machineTier, type StationId } from '../game/recipes';
import type { GameState } from '../game/state';

/**
 * 工坊每台機器的底座牌（2026-09-24 使用者三則：「正在製作的地方上面應該顯示可容納數量跟可以升級的圖標跟進度條」→
 * 「容量字小一點、再用更小的字寫第幾 Lv 跟機器名稱，機器下方的名牌就可以移除」→
 * 「請改成可以看到機器的長相 現在這樣都被擋住了，參考主流甜點或餐廳遊戲的遊玩畫面做排版」）。
 * 主流料理經營遊戲的排法：機器完整露出來，狀態寫在機器正前方的小牌子上（`STATION_PLATE`＝舊 3D 名牌的位置），
 * 升級箭頭只在買得起時冒出來。名牌拿掉之後名稱只剩這裡，所以**七台一律都有**：
 * - 第一行：機器名稱＋「Lv2」（小字）。
 * - 第二行：進度條＋份數「這盤/這台上限」（使用者選的格式）；空著寫「0/上限」；沒買寫「未購買」、整塊變淡。
 *   上限＝這台自己的等級（1／2／4 份），一盤實際做幾份看路線上最低那台，所以左右數字不一樣＝材料或別台機器卡住。
 * - 進度條：做的時候粉紅往右長、做完在等下一站空出來變綠；空著是空條。
 * - 右上角綠色箭頭：還沒滿級、而且錢夠升（沒買的＝錢夠買）才出現。整塊就是按鈕（main.ts 決定點了做什麼）。
 *
 * 七個標籤建一次，之後只改文字、寬度、class——不重建 innerHTML（重建會把手指底下的按鈕換掉，D55／D56 各被咬過一次）。
 * 位置由 main.ts 在鏡頭重框後給一次（工坊鏡頭固定，不必每幀投影）。
 */
export class StationTags {
  readonly root: HTMLElement;
  private readonly tags = {} as Record<StationId, Tag>;
  /**
   * 有機器到兩位數等級（D61，Lv10–20）：「打蛋機Lv18」在 390px 的牌子裡塞不下（實測字寬 35 > 內寬 31），
   * 改用窄版的兩行排法（名稱一行、Lv 一行）——同一套排法、同一條避讓規則，不另開第三種版型。
   */
  private twoDigit = false;
  private lastPlace: [Record<StationId, { x: number; y: number }>, number] | null = null;

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
        '<span class="pr"><span class="bar"><i></i></span><span class="q"><b></b><span class="of">/<span class="cap"></span></span></span></span>' +
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
   * 擺位置。`points`＝各站底座牌中心的畫面座標（CSS px）；
   * `keepBelow`＝整塊牌子（含凸出的升級箭頭）都要在這條線以下（左上日曆卡；底座牌平常本來就在它下面，這是保險）。
   * 寬度按「同一排相鄰兩台的水平間距」縮：後排在 390px 寬隔約 44px、320px 寬只剩約 36px（窄到放不下就把名稱與 Lv 分兩行）。
   * 靠得太近的（不同排）把下面那個往下推，牌子之間不重疊。
   */
  place(points: Record<StationId, { x: number; y: number }>, keepBelow: number) {
    this.lastPlace = [points, keepBelow];
    let gap = Infinity;
    for (const a of STATION_IDS) {
      for (const b of STATION_IDS) {
        if (a < b && Math.abs(points[a].y - points[b].y) < 4) gap = Math.min(gap, Math.abs(points[a].x - points[b].x));
      }
    }
    const w = Math.max(MIN_W, Math.min(TAG_W, Math.floor(gap) - 3));
    const narrow = w < WIDE_W || this.twoDigit;
    const h = narrow ? TAG_H_NARROW : TAG_H;
    this.root.style.setProperty('--stag-w', `${w}px`);
    this.root.classList.toggle('narrow', narrow);

    const minCenter = keepBelow + BADGE_UP + h / 2 + 3;
    const ys: Record<string, number> = {};
    for (const id of STATION_IDS) ys[id] = Math.max(points[id].y, minCenter);
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
    const twoDigit = STATION_IDS.some((id) => state.bakery.machines[id] >= 10);
    if (twoDigit !== this.twoDigit) {
      this.twoDigit = twoDigit;
      if (this.lastPlace) this.place(...this.lastPlace);
    }
    for (const id of STATION_IDS) {
      const t = this.tags[id];
      const b = state.bakery.stations[id].batch;
      const status = stationStatus(state, id);
      const lv = state.bakery.machines[id];
      const price = machinePrice(id, lv);
      const maxed = price === null;
      const affordable = price !== null && state.coins >= price;
      const ready = status === 'ready';
      const qty = b && status !== 'idle' ? b.qty : 0;
      const cap = machinePortions(lv);
      const key = `${lv}:${qty}:${maxed ? 'max' : affordable ? 'up' : 'poor'}:${status}`;
      if (key !== t.key) {
        t.key = key;
        t.lv.textContent = lv > 0 ? `Lv${lv}` : '';
        t.qty.textContent = lv > 0 ? String(qty) : '未購買';
        t.of.hidden = lv === 0;
        t.cap.textContent = String(cap);
        t.up.hidden = !affordable;
        t.el.classList.toggle('off', lv === 0);
        t.el.classList.toggle('afford', affordable);
        t.el.classList.toggle('ready', ready);
        // 階級（D61）：鐵／銅／銀／金，牌子左邊一條色帶跟機器前面的星星同色
        t.el.dataset.tier = String(machineTier(lv));
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

/** 牌子最寬（CSS px）與高度（兩行；窄版名稱與 Lv 分兩行＝三行）；跟 hud.css 的 `.stag` 對齊 */
const TAG_W = 42;
const MIN_W = 30;
/** 比這窄就把名稱與 Lv 分兩行 */
const WIDE_W = 38;
const TAG_H = 25;
const TAG_H_NARROW = 32;
/** 升級徽章凸出標籤頂邊多少（hud.css `.stag .up` 的 top） */
const BADGE_UP = 14;

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
