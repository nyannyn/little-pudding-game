import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATEGORIES,
  categoryClaimable,
  claimableCount,
  claimedRewardTotal,
  seriesList,
  type AchievementCategory,
  type SeriesView,
} from '../game/achievements';
import type { GameState } from '../game/state';
import { cuteIcon, icon, type CuteIconName } from './icons';

/**
 * 成就抽屜（D55）：跟商店同款的底部抽屜（樣式共用 `:is(.sheet, .achsheet)`；**不掛 `.sheet`**——測試與試玩腳本都把 `.sheet` 當商店），分四類分頁；同一種條件的成就合成一列「系列」，
 * 獎章底色照目前那一階走銅→銀→金，星星＝已領幾階。
 *
 * 不掛 `.card`：舊版成就卡的外框沿用 `.card`，商店商品卡的 `.card .foot { width:100% }`
 * 漏進來把文字欄擠成一個字寬（2026-09-23 使用者截圖的直排）。
 */

const CATEGORY_ICON: Record<AchievementCategory, CuteIconName> = {
  farm: 'farm',
  family: 'pudding',
  bakery: 'bakery',
  shop: 'coin',
};

/** 每個系列的獎章圖；沒列到的退回分類圖 */
const SERIES_ICON: Record<string, CuteIconName> = {
  pick: 'hand',
  bath: 'basin',
  zone: 'farm',
  birth: 'pudding',
  species: 'book',
  hybrid: 'mix',
  mutation: 'sparkle',
  puddingSale: 'heart',
  bake: 'oven',
  served: 'dessert',
  day: 'shop',
  missed: 'shelf',
  ingredient: 'box',
  order: 'order',
  bestDay: 'coin',
};

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

/** 獎章底色：單階系列直接金色；多階照目前那一階銅→銀→金；全部領完＝金 */
function medalTier(v: SeriesView): 'bronze' | 'silver' | 'gold' {
  if (v.tiers.length === 1 || (v.status === 'claimed' && v.claimed === v.tiers.length)) return 'gold';
  return (['bronze', 'silver', 'gold'] as const)[Math.min(v.tier, 2)]!;
}

function rowHtml(v: SeriesView): string {
  const a = v.current;
  const complete = v.status === 'claimed';
  const medal = v.concealed
    ? '<span class="q">?</span>'
    : cuteIcon(SERIES_ICON[v.series] ?? CATEGORY_ICON[v.category]);
  const stars = v.tiers.length > 1
    ? `<span class="stars" aria-label="${v.claimed}／${v.tiers.length} 階">${v.tiers.map((_, i) => `<i${i < v.claimed ? ' class="on"' : ''}></i>`).join('')}</span>`
    : '';
  const name = v.concealed ? '？？？' : a.name;
  const desc = v.concealed ? (a.hint ?? '還沒被發現的成就') : a.desc;
  const pct = Math.round((v.value / a.target) * 100);
  const prog = v.status === 'locked' && !v.concealed
    ? `<span class="prog"><i class="abar"><i style="width:${pct}%"></i></i><small class="cnt">${fmt(v.value)}／${fmt(a.target)}</small></span>`
    : '';
  const act =
    v.status === 'claimable'
      ? `<button class="claim" data-a="claim" data-arg="${a.id}"><span>領取</span><b>${fmt(a.reward)}</b></button>`
      : complete
        ? '<span class="done">完成</span>'
        : `<span class="reward">${v.concealed ? '？' : fmt(a.reward)}</span>`;
  return `<div class="arow" data-series="${v.series}" data-id="${a.id}" data-status="${v.status}"${v.concealed ? ' data-concealed' : ''}>
    <div class="medal m-${v.concealed ? 'hidden' : medalTier(v)}">${medal}${complete ? '<i class="check"></i>' : ''}</div>
    <div class="txt"><span class="ttl"><b>${name}</b>${stars}</span><small class="desc">${desc}</small>${prog}</div>
    <div class="act">${act}</div>
  </div>`;
}

export class AchievementSheet {
  readonly root: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly list: HTMLElement;
  private readonly body: HTMLElement;
  private readonly sumN: HTMLElement;
  private readonly sumBar: HTMLElement;
  private readonly sumCoins: HTMLElement;
  private readonly claimAll: HTMLButtonElement;
  private tab: AchievementCategory = 'farm';
  private sig = '';
  /** 剛打開：下一次 render 先跳到有東西可領的分頁 */
  private jump = false;

  constructor() {
    this.root = el(`
      <div class="achsheet" hidden>
        <header>
          <h2>成就</h2>
          <div class="achsum">
            <div class="row">${cuteIcon('trophy')}<b><span class="n">0</span>／${ACHIEVEMENTS.length}</b><span class="coins">${cuteIcon('coin')}<span class="c">0</span></span></div>
            <div class="xpbar"><i></i></div>
          </div>
          <button class="iconbtn" data-a="closeAch" aria-label="關閉">${icon('close')}</button>
        </header>
        <div class="tabs" role="tablist">
          ${ACHIEVEMENT_CATEGORIES.map((c) => `<button role="tab" data-a="achTab" data-arg="${c.id}">${cuteIcon(CATEGORY_ICON[c.id])}<span>${c.label}</span><i class="dot" hidden></i></button>`).join('')}
        </div>
        <div class="body">
          <button class="claimall" data-a="claimAllAch" hidden></button>
          <div class="alist"></div>
        </div>
      </div>`);
    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
    this.tabs = q('.tabs');
    this.list = q('.alist');
    this.body = q('.body');
    this.sumN = q('.achsum .n');
    this.sumBar = q('.achsum .xpbar > i');
    this.sumCoins = q('.achsum .c');
    this.claimAll = q('.claimall');
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** 打開時跳到第一個有東西可領的分頁（在下一次 render 做，那時才有 state）；都沒有就留在上次看的那頁 */
  show() {
    this.root.hidden = false;
    this.jump = true;
    this.sig = '';
  }

  hide() {
    this.root.hidden = true;
  }

  setTab(tab: AchievementCategory) {
    if (this.tab === tab) return;
    this.tab = tab;
    this.body.scrollTop = 0;
    this.sig = '';
  }

  /**
   * 只在「結構」變了才重建（哪一階、可不可領、藏不藏、紅點）：遊戲跑著的時候撿／泡／生的次數
   * 每一兩秒就在加，把進度值也算進去的話整張清單會一直 innerHTML，手指底下的「領取」被換掉＝按了沒反應。
   * 單純進度變了就只改進度條寬度與數字，節點不動
   */
  render(state: GameState) {
    if (this.jump) {
      this.jump = false;
      const first = ACHIEVEMENT_CATEGORIES.find((c) => categoryClaimable(state, c.id) > 0);
      if (first) this.setTab(first.id);
    }
    const rows = seriesList(state, this.tab);
    const total = claimableCount(state);
    const sig = [
      this.tab,
      total,
      state.claimedAchievements.length,
      ...ACHIEVEMENT_CATEGORIES.map((c) => categoryClaimable(state, c.id)),
      ...rows.map((v) => `${v.current.id}:${v.status}:${v.concealed}`),
    ].join(',');
    if (sig === this.sig) {
      for (const v of rows) this.updateProgress(v);
      return;
    }
    this.sig = sig;

    const got = state.claimedAchievements.length;
    this.sumN.textContent = String(got);
    this.sumBar.style.width = `${Math.round((got / ACHIEVEMENTS.length) * 100)}%`;
    this.sumCoins.textContent = fmt(claimedRewardTotal(state));

    for (const btn of this.tabs.querySelectorAll<HTMLButtonElement>('[data-a="achTab"]')) {
      const id = btn.dataset.arg as AchievementCategory;
      btn.setAttribute('aria-selected', String(id === this.tab));
      (btn.querySelector('.dot') as HTMLElement).hidden = categoryClaimable(state, id) === 0;
    }

    this.claimAll.hidden = total < 2;
    if (total >= 2) {
      const sum = ACHIEVEMENTS.filter((a) => !state.claimedAchievements.includes(a.id) && a.value(state) >= a.target)
        .reduce((n, a) => n + a.reward, 0);
      this.claimAll.innerHTML = `<span>全部領取（${total}）</span><b>${fmt(sum)}</b>`;
    }

    // 可領的排最前、再來進行中（隱藏的殿後）、全系列領完的沉到最後
    const rank = (v: SeriesView) => (v.status === 'claimable' ? 0 : v.status === 'locked' ? (v.concealed ? 2 : 1) : 3);
    this.list.innerHTML = [...rows].sort((a, b) => rank(a) - rank(b)).map(rowHtml).join('');
  }

  private updateProgress(v: SeriesView) {
    const row = this.list.querySelector<HTMLElement>(`.arow[data-series="${v.series}"]`);
    const bar = row?.querySelector<HTMLElement>('.abar > i');
    const cnt = row?.querySelector<HTMLElement>('.cnt');
    if (!bar || !cnt) return;
    bar.style.width = `${Math.round((v.value / v.current.target) * 100)}%`;
    cnt.textContent = `${fmt(v.value)}／${fmt(v.current.target)}`;
  }
}
