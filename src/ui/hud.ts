import './hud.css';
import { BALANCE, EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../game/balance';
import { describePudding } from '../game/pudding';
import { LIQUIDS, SPECIES, SPECIES_IDS, dessertPrice, type LiquidId, type SpeciesId } from '../game/species';
import type { GameState } from '../game/state';
import { nextLockedZone, puddingsIn, unlockedZones } from '../game/zones';
import { dismissHints, hintsDismissed, nextHint } from './hints';
import { dismissHomeScreenTip } from './homeScreen';
import { cuteIcon, icon, type CuteIconName } from './icons';

export interface HudActions {
  pour(liquid: LiquidId): void;
  pickAll(): void;
  craft(): void;
  ship(): void;
  fulfill(orderId: string): void;
  sellIngredients(species: SpeciesId): void;
  buyStock(liquid: LiquidId, qty: number): void;
  buyEquipment(id: EquipmentId): void;
  buyBasin(liquid: LiquidId): void;
  unlockZone(zoneId: string): void;
  switchZone(zoneId: string): void;
  toggleMute(): boolean;
}

const LIQUID_ICON: Record<LiquidId, CuteIconName> = {
  caramel: 'caramel',
  milk: 'milk',
  matcha: 'matcha',
  strawberry: 'strawberry',
};

/** 短名，按鈕塞得下才用得了 */
const LIQUID_SHORT: Record<LiquidId, string> = {
  caramel: '焦糖',
  milk: '牛乳',
  matcha: '抹茶',
  strawberry: '草莓',
};

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/** 能加工的份數（各物種各自湊 2 份） */
function craftableCount(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + Math.floor(s.ingredients[id] / BALANCE.ingredientsPerDessert), 0);
}
function totalDesserts(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + s.desserts[id], 0);
}
function totalIngredients(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + s.ingredients[id], 0);
}

export class Hud {
  readonly root: HTMLElement;
  private readonly chipCoins: HTMLElement;
  private readonly chipIng: HTMLElement;
  private readonly chipDes: HTMLElement;
  private readonly zonesBar: HTMLElement;
  private readonly living: HTMLElement;
  private readonly ordersBox: HTMLElement;
  private readonly dockPour: HTMLElement;
  private readonly btnPick: HTMLButtonElement;
  private readonly btnCraft: HTMLButtonElement;
  private readonly btnShip: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly welcome: HTMLElement;
  private readonly a2hs: HTMLElement;
  private readonly muteBtn: HTMLElement;

  private hintOff = hintsDismissed();
  private hintId = '';
  private zoneOrder: string[] = [];
  private activeZone = '';
  private pourKeys = '';
  private orderKeys = '';
  private sheetOpen = false;
  private shopHtml = '';
  private lastRefresh = -1;

  constructor(parent: HTMLElement, private readonly act: HudActions) {
    this.root = el(`
      <div class="hud">
        <div class="topbar">
          <div class="chips">
            <span class="chip" data-k="coins">${icon('coin', 'bubble')}<b>0</b></span>
            <span class="chip" data-k="ing">${icon('ingredient', 'bubble')}<b>0</b></span>
            <span class="chip" data-k="des">${icon('dessert', 'bubble')}<b>0</b></span>
          </div>
          <button class="iconbtn" data-a="mute" aria-label="音效">${icon('sound')}</button>
          <button class="iconbtn shopbtn" data-a="shop" aria-label="商店">${cuteIcon('shop')}</button>
        </div>
        <div class="zones" hidden>
          <button data-a="zoneStep" data-arg="-1" aria-label="上一個櫥窗">&#8249;</button>
          <span class="name"></span>
          <button data-a="zoneStep" data-arg="1" aria-label="下一個櫥窗">&#8250;</button>
        </div>
        <div class="living"></div>
        <div class="orders"></div>
        <div class="dock">
          <div class="line" data-k="pour"></div>
          <div class="line">
            <button data-a="pick" class="tilebtn t-pick">${cuteIcon('hand', 'tile')}<span class="label">撿原料</span><span class="n"></span></button>
            <button data-a="craft" class="tilebtn t-craft">${cuteIcon('dessert', 'tile')}<span class="label">加工</span><span class="n"></span></button>
            <button data-a="ship" class="tilebtn primary">${cuteIcon('box', 'tile')}<span class="label">出貨</span><span class="n"></span></button>
          </div>
        </div>
        <div class="hint" hidden><span class="who">小布丁</span><span class="t"></span><button data-a="hintOff" aria-label="不再顯示">${icon('close')}</button></div>
        <div class="toasts"></div>
        <div class="sheet" hidden>
          <header><h2>布丁商店</h2><button class="iconbtn" data-a="closeShop" aria-label="關閉">${icon('close')}</button></header>
          <div class="body"></div>
        </div>
        <div class="welcome" hidden>
          <div class="card">
            <h2>歡迎回來</h2>
            <p></p>
            <button data-a="closeWelcome">看看櫥窗</button>
          </div>
        </div>
        <div class="welcome a2hs" hidden>
          <div class="card">
            <h2>把農場加到主畫面</h2>
            <p>按 Safari 下方的分享鈕，選「加入主畫面」。從主畫面開才存得住進度——留在 Safari 分頁裡，七天沒回來就會被清掉。</p>
            <button data-a="closeA2hs">知道了</button>
          </div>
        </div>
      </div>`);
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
    this.chipCoins = q('[data-k="coins"] b');
    this.chipIng = q('[data-k="ing"] b');
    this.chipDes = q('[data-k="des"] b');
    this.zonesBar = q('.zones');
    this.living = q('.living');
    this.ordersBox = q('.orders');
    this.dockPour = q('[data-k="pour"]');
    this.btnPick = q('[data-a="pick"]');
    this.btnCraft = q('[data-a="craft"]');
    this.btnShip = q('[data-a="ship"]');
    this.sheet = q('.sheet');
    this.sheetBody = q('.sheet .body');
    this.hint = q('.hint');
    this.toasts = q('.toasts');
    this.welcome = q('.welcome:not(.a2hs)');
    this.a2hs = q('.a2hs');
    this.muteBtn = q('[data-a="mute"]');

    this.root.addEventListener('click', (e) => this.onClick(e));

    // 引導泡泡／toast／除錯面板都疊在動作列上方，位置由 --dock-h 推導；
    // 動作列高度會隨解鎖的澡盆數（倒○○按鈕變多）改變，量實際高度才不會疊到。
    const dock = q<HTMLElement>('.dock');
    const syncDockHeight = () => document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    syncDockHeight();
    if ('ResizeObserver' in window) new ResizeObserver(syncDockHeight).observe(dock);
  }

  private onClick(e: Event) {
    const target = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!target) return;
    const a = target.dataset.a;
    const arg = target.dataset.arg ?? '';
    switch (a) {
      case 'pour': this.act.pour(arg as LiquidId); break;
      case 'pick': this.act.pickAll(); break;
      case 'craft': this.act.craft(); break;
      case 'ship': this.act.ship(); break;
      case 'fulfill': this.act.fulfill(arg); break;
      case 'sellIng': this.act.sellIngredients(arg as SpeciesId); break;
      case 'buyStock': this.act.buyStock(arg as LiquidId, BALANCE.stockBuyQty); break;
      case 'buyEquip': this.act.buyEquipment(arg as EquipmentId); break;
      case 'buyBasin': this.act.buyBasin(arg as LiquidId); break;
      case 'unlockZone': this.act.unlockZone(arg); break;
      case 'zoneStep': this.stepZone(Number(arg)); break;
      case 'shop': this.toggleShop(true); break;
      case 'closeShop': this.toggleShop(false); break;
      case 'closeWelcome': this.welcome.hidden = true; break;
      case 'closeA2hs':
        dismissHomeScreenTip();
        this.a2hs.hidden = true;
        break;
      case 'hintOff':
        dismissHints();
        this.hintOff = true;
        this.hint.hidden = true;
        break;
      case 'mute': {
        const muted = this.act.toggleMute();
        this.muteBtn.innerHTML = icon(muted ? 'mute' : 'sound');
        break;
      }
    }
  }

  /** 在已解鎖的分區之間循環切換（只有一區時整條列會藏起來） */
  private stepZone(dir: number) {
    const list = this.zoneOrder;
    if (list.length < 2) return;
    const i = list.indexOf(this.activeZone);
    const next = list[(i + dir + list.length) % list.length];
    if (next) this.act.switchZone(next);
  }

  private toggleShop(open: boolean) {
    this.sheetOpen = open;
    this.sheet.hidden = !open;
    this.lastRefresh = -1; // 下一次 update 一定要重畫商店內容
  }

  /** 場景端也會叫（點櫃子上的鎖牌＝去商店解鎖） */
  openShop() {
    this.toggleShop(true);
  }

  /** 歡迎卡正開著（「加到主畫面」那張要讓路，不然兩張疊在一起） */
  get welcomeVisible(): boolean {
    return !this.welcome.hidden;
  }

  showHomeScreenTip() {
    this.a2hs.hidden = false;
  }

  showWelcome(text: string) {
    const p = this.welcome.querySelector('p');
    if (p) p.textContent = text;
    this.welcome.hidden = false;
  }

  toast(message: string, bad = false) {
    const node = el(`<div class="toast${bad ? ' bad' : ''}"></div>`);
    node.textContent = message;
    this.toasts.appendChild(node);
    // 最多同時四則，久了自己消失——遊戲裡的訊息不該要玩家去關
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => node.remove(), 2600);
  }

  /** 每幀呼叫；內部節流成 6 Hz，動作後用 force 立刻反映 */
  update(state: GameState, nowMs: number, force = false) {
    if (!force && nowMs - this.lastRefresh < 160) return;
    this.lastRefresh = nowMs;

    this.chipCoins.textContent = String(Math.floor(state.coins));
    this.chipIng.textContent = String(totalIngredients(state));
    this.chipDes.textContent = String(totalDesserts(state));

    this.syncZones(state);
    this.syncPourButtons(state);
    this.syncLiving(state);
    this.syncOrders(state);

    const drops = state.drops.length;
    this.btnPick.disabled = drops === 0;
    (this.btnPick.querySelector('.n') as HTMLElement).textContent = drops ? String(drops) : '';

    const craftable = craftableCount(state);
    this.btnCraft.disabled = craftable === 0;
    (this.btnCraft.querySelector('.n') as HTMLElement).textContent = craftable ? String(craftable) : '';

    const desserts = totalDesserts(state);
    this.btnShip.disabled = desserts === 0;
    (this.btnShip.querySelector('.n') as HTMLElement).textContent = desserts ? String(desserts) : '';

    this.syncHint(state);
    if (this.sheetOpen) this.renderShop(state);
  }

  private syncHint(state: GameState) {
    const h = nextHint(state);
    if (this.hintOff && !h?.warning) {
      this.hint.hidden = true;
      return;
    }
    if (!h) {
      this.hint.hidden = true;
      this.hint.removeAttribute('data-hint');
      this.hintId = '';
      return;
    }
    if (h.id !== this.hintId) {
      this.hintId = h.id;
      this.hint.dataset.hint = h.id;
      (this.hint.querySelector('.t') as HTMLElement).textContent = h.text;
    }
    this.hint.hidden = false;
  }

  private syncZones(state: GameState) {
    // 順序固定成「同一座由下往上，再換下一座」，按左右鍵才不會亂跳
    const list = unlockedZones(state)
      .slice()
      .sort((a, b) => a.cabinet - b.cabinet || a.tier - b.tier);
    this.zoneOrder = list.map((z) => z.id);
    this.activeZone = state.activeZone;
    this.zonesBar.hidden = list.length < 2;
    if (list.length < 2) return;
    const z = list.find((q) => q.id === state.activeZone);
    const n = z ? puddingsIn(state, z.id).length : 0;
    (this.zonesBar.querySelector('.name') as HTMLElement).textContent = z ? `${z.shortName}・${n} 隻` : '';
  }

  private syncPourButtons(state: GameState) {
    const liquids: LiquidId[] = ['caramel', 'milk', ...state.ownedBasins];
    const key = liquids.join(',');
    if (key !== this.pourKeys) {
      this.pourKeys = key;
      this.dockPour.innerHTML = liquids
        .map(
          (l) =>
            `<button data-a="pour" data-arg="${l}" class="tilebtn t-${l}">${cuteIcon(LIQUID_ICON[l], 'tile')}<span class="label">倒${LIQUID_SHORT[l]}</span><span class="n"></span></button>`,
        )
        .join('');
    }
    // 庫存直接寫在按鈕上：上方 chips 擠五個會換行撞到櫥窗切換列，
    // 而且「還剩幾份」本來就該長在「要倒的那顆按鈕」上
    for (const l of liquids) {
      const btn = this.dockPour.querySelector<HTMLButtonElement>(`[data-arg="${l}"]`);
      if (!btn) continue;
      btn.disabled = state.stock[l] <= 0;
      const n = btn.querySelector('.n') as HTMLElement;
      n.textContent = String(state.stock[l]);
      n.classList.toggle('zero', state.stock[l] === 0);
    }
  }

  private syncLiving(state: GameState) {
    // 只列「看得到的那一區」的住客：其他區照樣在運作，但狀態列擠不下也沒意義
    const mine = puddingsIn(state, state.activeZone);
    while (this.living.childElementCount > mine.length) this.living.lastElementChild?.remove();
    while (this.living.childElementCount < mine.length) {
      this.living.appendChild(el(`<div class="row">${icon('pudding', 'bubble')}<span class="t"></span><span class="bar"><i></i></span></div>`));
    }
    mine.forEach((p, i) => {
      const row = this.living.children[i] as HTMLElement | undefined;
      if (!row) return;
      (row.querySelector('.t') as HTMLElement).textContent = describePudding(p, state.time);
      const bar = row.querySelector('.bar') as HTMLElement;
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round(p.caramel)}%`;
      bar.classList.toggle('low', p.caramel < BALANCE.batheThreshold);
    });
  }

  private syncOrders(state: GameState) {
    const key = state.orders.map((o) => o.id).join(',');
    if (key !== this.orderKeys) {
      this.orderKeys = key;
      this.ordersBox.innerHTML = state.orders
        .map((o) => {
          const info = SPECIES[o.species];
          return `<div class="order" data-id="${o.id}">
            <div class="t"><span>${info.dessert} ×${o.qty}</span><span class="sub">${o.price}</span></div>
            <button class="buy" data-a="fulfill" data-arg="${o.id}">交貨</button>
            <div class="clock"><i></i></div>
          </div>`;
        })
        .join('');
    }
    for (const o of state.orders) {
      const card = this.ordersBox.querySelector(`[data-id="${o.id}"]`);
      if (!card) continue;
      const btn = card.querySelector('button') as HTMLButtonElement;
      btn.disabled = state.desserts[o.species] < o.qty;
      const left = Math.max(0, (o.expiresAt - state.time) / BALANCE.orderTtlSec);
      (card.querySelector('.clock > i') as HTMLElement).style.width = `${Math.round(left * 100)}%`;
    }
  }

  private renderShop(state: GameState) {
    const rows: string[] = [];

    rows.push('<h3>補貨</h3>');
    const buyable: LiquidId[] = ['caramel', 'milk', ...state.ownedBasins];
    for (const l of buyable) {
      const info = LIQUIDS[l];
      const cost = info.unitPrice * BALANCE.stockBuyQty;
      rows.push(`<div class="item">
        ${cuteIcon(LIQUID_ICON[l], 'tile')}
        <div class="grow"><div class="name">${info.name} × ${BALANCE.stockBuyQty}</div><div class="desc">庫存 ${state.stock[l]} 份</div></div>
        <button data-a="buyStock" data-arg="${l}" ${state.coins < cost ? 'disabled' : ''}>${cost}</button>
      </div>`);
    }

    rows.push('<h3>賣原料</h3>');
    let any = false;
    for (const s of SPECIES_IDS) {
      if (state.ingredients[s] <= 0) continue;
      any = true;
      const info = SPECIES[s];
      const total = info.ingredientPrice * state.ingredients[s];
      rows.push(`<div class="item">
        ${icon('ingredient', 'tile')}
        <div class="grow"><div class="name">${info.ingredient} × ${state.ingredients[s]}</div>
        <div class="desc">加工成${info.dessert}可賣 ${dessertPrice(s, BALANCE.dessertPriceMult)}／份</div></div>
        <button data-a="sellIng" data-arg="${s}">${total}</button>
      </div>`);
    }
    if (!any) rows.push('<div class="item"><div class="grow desc">還沒有原料，先讓布丁泡個澡。</div></div>');

    rows.push('<h3>自動化設備</h3>');
    for (const id of EQUIPMENT_IDS) {
      const info = EQUIPMENT[id];
      const owned = state.equipment[id];
      rows.push(`<div class="item">
        ${icon('gear', 'tile')}
        <div class="grow"><div class="name">T${info.tier}　${info.name}</div><div class="desc">${info.desc}</div></div>
        ${owned ? '<span class="owned">已安裝</span>' : `<button data-a="buyEquip" data-arg="${id}" ${state.coins < info.price ? 'disabled' : ''}>${info.price}</button>`}
      </div>`);
    }

    rows.push('<h3>擴建櫥窗</h3>');
    const nz = nextLockedZone(state);
    if (nz) {
      rows.push(`<div class="item">
        ${cuteIcon('box', 'tile')}
        <div class="grow"><div class="name">${nz.name}</div>
        <div class="desc">解鎖後多一隻住客與一個澡盆，產量翻倍</div></div>
        <button data-a="unlockZone" data-arg="${nz.id}" ${state.coins < nz.price ? 'disabled' : ''}>${nz.price}</button>
      </div>`);
    } else {
      rows.push('<div class="item"><div class="grow desc">所有櫥窗都開了。</div></div>');
    }

    rows.push('<h3>風味澡盆</h3>');
    for (const l of ['matcha', 'strawberry'] as LiquidId[]) {
      const info = LIQUIDS[l];
      const owned = state.ownedBasins.includes(l);
      rows.push(`<div class="item">
        ${cuteIcon(LIQUID_ICON[l], 'tile')}
        <div class="grow"><div class="name">${info.name}澡盆</div>
        <div class="desc">泡 ${Math.ceil(BALANCE.flavorThresholdSec / BALANCE.flavorExposurePerBath)} 次澡會變成${SPECIES[info.flavorFor as SpeciesId].name}</div></div>
        ${owned ? '<span class="owned">已擁有</span>' : `<button data-a="buyBasin" data-arg="${l}" ${state.coins < BALANCE.specialBasinPrice ? 'disabled' : ''}>${BALANCE.specialBasinPrice}</button>`}
      </div>`);
    }

    // 內容沒變就不重寫 DOM：商店開著時 update 每 160ms 進來一次，
    // 每次都換掉 innerHTML 會把玩家手指正按著的按鈕換成新節點——pointerdown 與 pointerup
    // 落在不同節點，click 不會發生，體感就是「商店按鈕偶爾按不動」（e2e 也因此逾時）。
    const html = rows.join('');
    if (html === this.shopHtml) return;
    this.shopHtml = html;
    this.sheetBody.innerHTML = html;
  }
}
