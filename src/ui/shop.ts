import { BALANCE } from '../game/balance';
import { levelProgress } from '../game/level';
import { shopCatalog, type ShopEntry, type ShopTab } from '../game/shop';
import { puddingSaleBlock } from '../game/actions';
import { SPECIES, SPECIES_IDS, dessertPrice, puddingPrice, type SpeciesId } from '../game/species';
import type { GameState } from '../game/state';
import { findZone } from '../game/zones';
import { icon } from './icons';
import { ART, EGG_ART, INGREDIENT_ART, artFor, type ArtSpec } from './shopArt';

/**
 * 商店抽屜（D25）。主流經營遊戲（開心農場／Hay Day）的商店長相：
 * 上方分頁、下方兩欄商品卡、每張卡一張大商品圖＋價格鈕；
 * 等級不夠的商品不藏起來，灰掉＋掛「Lv.N 解鎖」——看得到下一個目標才有存錢的動力。
 *
 * DOM 只在「結構」變了才重建（分頁、商品清單、每件的 owned／locked 狀態）；
 * 錢夠不夠、庫存幾份、經驗條這些每 160ms 會變的東西就地改字。
 * 全量重寫 innerHTML 會把玩家手指正按著的按鈕換掉、click 掉失（見 hud.ts 的教訓）。
 */

export type ShopPage = ShopTab | 'sell';

const TABS: { id: ShopPage; label: string; art: keyof typeof ART }[] = [
  { id: 'stock', label: '補貨', art: 'honeyJar' },
  { id: 'equipment', label: '設備', art: 'eqCollector' },
  { id: 'basin', label: '澡盆', art: 'bathtub' },
  { id: 'zone', label: '擴建', art: 'window' },
  { id: 'sell', label: '賣出', art: 'ingCaramel' },
];

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export function artHtml(spec: ArtSpec, badge = ''): string {
  return `<div class="art">
    <img class="main" src="${ART[spec.main]}" alt="" draggable="false">
    ${spec.corner ? `<img class="corner" src="${ART[spec.corner]}" alt="" draggable="false">` : ''}
    ${badge ? `<span class="badge">${badge}</span>` : ''}
  </div>`;
}

function cardHtml(e: ShopEntry): string {
  const badge = e.qty ? `×${e.qty}` : '';
  let foot: string;
  switch (e.status) {
    case 'owned':
      foot = `<span class="owned">${e.action === 'buyEquip' ? '已安裝' : '已擁有'}</span>`;
      break;
    case 'locked':
      foot = `<span class="lockedtag"><img src="${ART.lock}" alt="">Lv.${e.level} 解鎖</span>`;
      break;
    case 'needs':
      foot = `<span class="needs">${e.needsText ?? ''}</span>`;
      break;
    default:
      foot = `<button class="buy" data-a="${e.action}" data-arg="${e.arg}"${e.qty ? ` data-qty="${e.qty}"` : ''}>${e.price}</button>`;
  }
  return `<div class="card" data-id="${e.id}" data-status="${e.status}">
    ${artHtml(artFor(e), badge)}
    <div class="name">${e.name}</div>
    <div class="desc">${e.desc}</div>
    ${e.stock !== undefined ? '<div class="stock">庫存 <b>0</b></div>' : ''}
    <div class="foot">${foot}</div>
  </div>`;
}

function sellCardHtml(s: SpeciesId): string {
  const info = SPECIES[s];
  return `<div class="card" data-id="sell:${s}" data-status="available">
    ${artHtml(INGREDIENT_ART[s])}
    <div class="name">${info.ingredient}</div>
    <div class="desc">直接賣 ${info.ingredientPrice}／份。送進甜點店做成${info.dessert}可賣 ${dessertPrice(s)}</div>
    <div class="stock">持有 <b>0</b></div>
    <div class="foot"><button class="buy sell" data-a="sellIng" data-arg="${s}">0</button></div>
  </div>`;
}

/** 蛋是通用原料，不屬於任何物種，所以自己一張卡（D33） */
function eggCardHtml(): string {
  return `<div class="card" data-id="sell:egg" data-status="available">
    ${artHtml(EGG_ART)}
    <div class="name">蛋</div>
    <div class="desc">直接賣 ${BALANCE.eggPrice}／顆。甜點店一份甜點要 ${BALANCE.eggsPerDessert} 顆</div>
    <div class="stock">持有 <b>0</b></div>
    <div class="foot"><button class="buy sell" data-a="sellEggs">0</button></div>
  </div>`;
}

/**
 * 賣布丁（D53）：一個物種一張卡，按一下賣一隻（成年、沒在泡澡的；優先賣目前這一區的）。
 * 一隻一張卡在養滿 60 隻時會變成一整頁的捲動，而玩家要的其實是「這種賣掉一隻」。
 */
function puddingCardHtml(s: SpeciesId): string {
  const info = SPECIES[s];
  return `<div class="card" data-id="sellpud:${s}" data-status="available">
    ${artHtml(INGREDIENT_ART[s])}
    <div class="name">${info.name}</div>
    <div class="desc">賣一隻 ${puddingPrice(s)}。幼布丁與泡澡中的不賣，最後一隻留著</div>
    <div class="stock">可賣 <b>0</b> 隻</div>
    <div class="foot"><button class="buy sell" data-a="sellPud" data-arg="${s}">${puddingPrice(s)}</button></div>
  </div>`;
}

/** 這個物種現在可以賣幾隻 */
export function sellablePuddings(state: GameState, s: SpeciesId): number {
  return state.puddings.filter((p) => p.species === s && puddingSaleBlock(state, p.id) === null).length;
}

export class ShopView {
  readonly root: HTMLElement;
  private readonly lvlNum: HTMLElement;
  private readonly lvlBar: HTMLElement;
  private readonly lvlHint: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly body: HTMLElement;
  private page: ShopPage = 'stock';
  private structureKey = '';

  constructor() {
    this.root = el(`
      <div class="sheet" hidden>
        <header>
          <h2>布丁商店</h2>
          <div class="lvl">
            <div class="row"><img src="${ART.star}" alt=""><b>Lv.<span class="n">1</span></b><span class="xptext"></span></div>
            <div class="xpbar"><i></i></div>
          </div>
          <button class="iconbtn" data-a="closeShop" aria-label="關閉">${icon('close')}</button>
        </header>
        <div class="tabs" role="tablist">
          ${TABS.map((t) => `<button role="tab" data-a="shopTab" data-arg="${t.id}"><img src="${ART[t.art]}" alt=""><span>${t.label}</span><i class="dot" hidden></i></button>`).join('')}
        </div>
        <div class="body"></div>
      </div>`);
    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
    this.lvlNum = q('.lvl .n');
    this.lvlBar = q('.lvl .xpbar > i');
    this.lvlHint = q('.lvl .xptext');
    this.tabs = q('.tabs');
    this.body = q('.body');
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** 打開（可指定分頁：點櫃子上的鎖牌就直接跳到「擴建」） */
  show(page?: ShopPage) {
    if (page) this.setPage(page);
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  setPage(page: ShopPage) {
    if (this.page === page) return;
    this.page = page;
    this.body.scrollTop = 0;
  }

  render(state: GameState) {
    const lp = levelProgress(state.xp);
    this.lvlNum.textContent = String(lp.level);
    this.lvlBar.style.width = `${Math.round(lp.ratio * 100)}%`;
    this.lvlHint.textContent = lp.span > 0 ? `${lp.into}／${lp.span}` : '滿級';

    const catalog = shopCatalog(state);
    const sellable = SPECIES_IDS.filter((s) => state.ingredients[s] > 0);
    const hasEggs = state.eggs > 0;
    const pudSpecies = SPECIES_IDS.filter((s) => state.puddings.some((p) => p.species === s));

    // 分頁鈕：作用中的那頁＋「賣出」有沒有東西可賣
    for (const btn of this.tabs.querySelectorAll<HTMLButtonElement>('[data-a="shopTab"]')) {
      const id = btn.dataset.arg as ShopPage;
      btn.setAttribute('aria-selected', String(id === this.page));
      const dot = btn.querySelector<HTMLElement>('.dot');
      if (dot) {
        // 賣出：有東西可賣；其他頁：這一級剛上架的（跟卡片上的 NEW 同條件），
        // 或「一次性商品現在買得起」——新手引導叫玩家去買收集手時，商店開在補貨頁，設備頁要有個記號
        const n = id === 'sell'
          ? sellable.length + (hasEggs ? 1 : 0)
          : catalog.filter((e) =>
              e.tab === id && e.status === 'available' &&
              ((e.level === lp.level && e.level > 1) || (e.action !== 'buyStock' && e.affordable)),
            ).length;
        dot.hidden = n === 0;
      }
    }

    const entries = catalog.filter((e) => e.tab === this.page);
    // 設備是每一區各買各的（D45）：設備頁要講清楚現在買的裝在哪一區，不然玩家切到新區
    // 看到整頁「可買」會以為剛才的錢白花了
    const zoneName = findZone(state, state.activeZone)?.shortName ?? '';
    const zoneNote =
      this.page === 'equipment'
        ? `<div class="note">設備裝在目前這一區（${zoneName}）。每一區各買各的，別區要另外買。</div>`
        : '';
    const key =
      this.page === 'sell'
        ? `sell:${sellable.join(',')}:egg${hasEggs ? 1 : 0}:pud${pudSpecies.join(',')}`
        : `${this.page}:${zoneName}:${entries.map((e) => `${e.id}=${e.status}`).join(',')}:lv${lp.level}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      // 買了一件（owned）也會走到這裡重建：捲動位置要留住，不然買完清單跳回最上面
      const scroll = this.body.scrollTop;
      this.body.innerHTML =
        this.page === 'sell'
          ? (sellable.length || hasEggs
              ? `<div class="grid">${hasEggs ? eggCardHtml() : ''}${sellable.map(sellCardHtml).join('')}</div>`
              : '<div class="empty">還沒有原料可賣。布丁待著就會掉蛋與原料，撿起來就進庫存。</div>') +
            `<div class="note">賣布丁</div><div class="grid">${pudSpecies.map(puddingCardHtml).join('')}</div>`
          : `${zoneNote}<div class="grid">${entries.map(cardHtml).join('')}</div>`;
      // 這一級剛上架的商品貼 NEW：不存「看過沒」，升下一級自然消失
      for (const e of entries) {
        if (e.level === lp.level && e.level > 1 && e.status === 'available') {
          this.body.querySelector(`[data-id="${e.id}"] .art`)?.appendChild(el('<span class="new">NEW</span>'));
        }
      }
      this.body.scrollTop = scroll;
    }

    // 每 160ms 會變的：錢夠不夠、庫存、可賣總價
    if (this.page === 'sell') {
      const eggCard = this.body.querySelector('[data-id="sell:egg"]');
      if (eggCard) {
        (eggCard.querySelector('.stock b') as HTMLElement).textContent = String(state.eggs);
        (eggCard.querySelector('button') as HTMLButtonElement).textContent = String(BALANCE.eggPrice * state.eggs);
      }
      for (const s of sellable) {
        const card = this.body.querySelector(`[data-id="sell:${s}"]`);
        if (!card) continue;
        const n = state.ingredients[s];
        (card.querySelector('.stock b') as HTMLElement).textContent = String(n);
        (card.querySelector('button') as HTMLButtonElement).textContent = String(SPECIES[s].ingredientPrice * n);
      }
      for (const s of pudSpecies) {
        const card = this.body.querySelector(`[data-id="sellpud:${s}"]`);
        if (!card) continue;
        const n = sellablePuddings(state, s);
        (card.querySelector('.stock b') as HTMLElement).textContent = String(n);
        (card.querySelector('button') as HTMLButtonElement).disabled = n === 0;
      }
      return;
    }
    for (const e of entries) {
      const card = this.body.querySelector(`[data-id="${e.id}"]`);
      if (!card) continue;
      const btn = card.querySelector<HTMLButtonElement>('button.buy');
      if (btn) btn.disabled = !e.affordable;
      if (e.stock !== undefined) (card.querySelector('.stock b') as HTMLElement).textContent = String(e.stock);
    }
  }
}
