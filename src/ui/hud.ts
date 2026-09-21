import './hud.css';
import { BALANCE, EQUIPMENT, EQUIPMENT_IDS, type EquipmentId } from '../game/balance';
import { describePudding } from '../game/pudding';
import { LIQUIDS, SPECIES, SPECIES_IDS, dessertPrice, type LiquidId, type SpeciesId } from '../game/species';
import type { GameState } from '../game/state';
import { icon, type IconName } from './icons';

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
  toggleMute(): boolean;
}

const LIQUID_ICON: Record<LiquidId, IconName> = {
  caramel: 'caramel',
  milk: 'milk',
  matcha: 'basin',
  strawberry: 'basin',
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
  private readonly chipStock: Partial<Record<LiquidId, HTMLElement>> = {};
  private readonly chipIng: HTMLElement;
  private readonly chipDes: HTMLElement;
  private readonly living: HTMLElement;
  private readonly ordersBox: HTMLElement;
  private readonly dockPour: HTMLElement;
  private readonly btnPick: HTMLButtonElement;
  private readonly btnCraft: HTMLButtonElement;
  private readonly btnShip: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly sheetBody: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly welcome: HTMLElement;
  private readonly muteBtn: HTMLElement;

  private pourKeys = '';
  private orderKeys = '';
  private sheetOpen = false;
  private lastRefresh = -1;

  constructor(parent: HTMLElement, private readonly act: HudActions) {
    this.root = el(`
      <div class="hud">
        <div class="topbar">
          <div class="chips">
            <span class="chip" data-k="coins">${icon('coin')}<b>0</b></span>
            <span class="chip" data-k="ing">${icon('ingredient')}<b>0</b></span>
            <span class="chip" data-k="des">${icon('dessert')}<b>0</b></span>
          </div>
          <button class="iconbtn" data-a="mute" aria-label="音效">${icon('sound')}</button>
          <button class="iconbtn" data-a="shop" aria-label="商店">${icon('cart')}</button>
        </div>
        <div class="living"></div>
        <div class="orders"></div>
        <div class="dock">
          <div class="line" data-k="pour"></div>
          <div class="line">
            <button data-a="pick">${icon('hand')}<span class="label">撿原料</span><span class="n"></span></button>
            <button data-a="craft">${icon('dessert')}<span class="label">加工</span><span class="n"></span></button>
            <button data-a="ship" class="primary">${icon('cart')}<span class="label">出貨</span><span class="n"></span></button>
          </div>
        </div>
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
      </div>`);
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
    this.chipCoins = q('[data-k="coins"] b');
    this.chipIng = q('[data-k="ing"] b');
    this.chipDes = q('[data-k="des"] b');
    this.living = q('.living');
    this.ordersBox = q('.orders');
    this.dockPour = q('[data-k="pour"]');
    this.btnPick = q('[data-a="pick"]');
    this.btnCraft = q('[data-a="craft"]');
    this.btnShip = q('[data-a="ship"]');
    this.sheet = q('.sheet');
    this.sheetBody = q('.sheet .body');
    this.toasts = q('.toasts');
    this.welcome = q('.welcome');
    this.muteBtn = q('[data-a="mute"]');

    this.root.addEventListener('click', (e) => this.onClick(e));
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
      case 'buyStock': this.act.buyStock(arg as LiquidId, 5); break;
      case 'buyEquip': this.act.buyEquipment(arg as EquipmentId); break;
      case 'buyBasin': this.act.buyBasin(arg as LiquidId); break;
      case 'shop': this.toggleShop(true); break;
      case 'closeShop': this.toggleShop(false); break;
      case 'closeWelcome': this.welcome.hidden = true; break;
      case 'mute': {
        const muted = this.act.toggleMute();
        this.muteBtn.innerHTML = icon(muted ? 'mute' : 'sound');
        break;
      }
    }
  }

  private toggleShop(open: boolean) {
    this.sheetOpen = open;
    this.sheet.hidden = !open;
    this.lastRefresh = -1; // 下一次 update 一定要重畫商店內容
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

    this.syncStockChips(state);
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

    if (this.sheetOpen) this.renderShop(state);
  }

  private syncStockChips(state: GameState) {
    const chips = this.root.querySelector('.chips')!;
    const shown: LiquidId[] = ['caramel', 'milk', ...state.ownedBasins.filter((l) => l !== 'caramel' && l !== 'milk')];
    for (const l of shown) {
      let node = this.chipStock[l];
      if (!node) {
        node = el(`<span class="chip" data-k="stock-${l}">${icon(LIQUID_ICON[l])}<b>0</b></span>`);
        chips.appendChild(node);
        this.chipStock[l] = node;
      }
      const b = node.querySelector('b')!;
      b.textContent = String(state.stock[l]);
      node.classList.toggle('low', state.stock[l] === 0);
    }
  }

  private syncPourButtons(state: GameState) {
    const liquids: LiquidId[] = ['caramel', 'milk', ...state.ownedBasins];
    const key = liquids.join(',');
    if (key !== this.pourKeys) {
      this.pourKeys = key;
      this.dockPour.innerHTML = liquids
        .map(
          (l) =>
            `<button data-a="pour" data-arg="${l}">${icon(LIQUID_ICON[l])}<span class="label">倒${LIQUID_SHORT[l]}</span></button>`,
        )
        .join('');
    }
    for (const l of liquids) {
      const btn = this.dockPour.querySelector<HTMLButtonElement>(`[data-arg="${l}"]`);
      if (btn) btn.disabled = state.stock[l] <= 0;
    }
  }

  private syncLiving(state: GameState) {
    while (this.living.childElementCount > state.puddings.length) this.living.lastElementChild?.remove();
    while (this.living.childElementCount < state.puddings.length) {
      this.living.appendChild(el(`<div class="row">${icon('pudding')}<span class="t"></span><span class="bar"><i></i></span></div>`));
    }
    state.puddings.forEach((p, i) => {
      const row = this.living.children[i] as HTMLElement | undefined;
      if (!row) return;
      (row.querySelector('.t') as HTMLElement).textContent = describePudding(p);
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
            <div class="t"><span>${info.dessert}</span><span>×${o.qty}</span></div>
            <div class="sub">${o.price} 焦糖幣</div>
            <button data-a="fulfill" data-arg="${o.id}">交貨</button>
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
      const cost = info.unitPrice * 5;
      rows.push(`<div class="item">
        <div class="grow"><div class="name">${info.name} × 5</div><div class="desc">庫存 ${state.stock[l]} 份</div></div>
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
        <div class="grow"><div class="name">T${info.tier}　${info.name}</div><div class="desc">${info.desc}</div></div>
        ${owned ? '<span class="owned">已安裝</span>' : `<button data-a="buyEquip" data-arg="${id}" ${state.coins < info.price ? 'disabled' : ''}>${info.price}</button>`}
      </div>`);
    }

    rows.push('<h3>風味澡盆</h3>');
    for (const l of ['matcha', 'strawberry'] as LiquidId[]) {
      const info = LIQUIDS[l];
      const owned = state.ownedBasins.includes(l);
      rows.push(`<div class="item">
        <div class="grow"><div class="name">${info.name}澡盆</div>
        <div class="desc">泡滿 48 小時會變成${SPECIES[info.flavorFor as SpeciesId].name}</div></div>
        ${owned ? '<span class="owned">已擁有</span>' : `<button data-a="buyBasin" data-arg="${l}" ${state.coins < BALANCE.specialBasinPrice ? 'disabled' : ''}>${BALANCE.specialBasinPrice}</button>`}
      </div>`);
    }

    this.sheetBody.innerHTML = rows.join('');
  }
}
