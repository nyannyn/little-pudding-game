import './hud.css';
import { BALANCE, type EquipmentId } from '../game/balance';
import { levelFor } from '../game/level';
import { SPECIES, SPECIES_IDS, type LiquidId, type SpeciesId } from '../game/species';
import type { GameState } from '../game/state';
import { puddingsIn, unlockedZones } from '../game/zones';
import { LIQUID_SHORT, dismissHints, hintsDismissed, nextHint } from './hints';
import { dismissHomeScreenTip } from './homeScreen';
import { cuteIcon, icon, type CuteIconName } from './icons';
import { ShopView, type ShopPage } from './shop';

export interface HudActions {
  pour(liquid: LiquidId): void;
  pickAll(): void;
  craft(): void;
  ship(): void;
  fulfill(orderId: string): void;
  sellIngredients(species: SpeciesId): void;
  sellEggs(): void;
  buyStock(liquid: LiquidId, qty: number): void;
  buyEquipment(id: EquipmentId): void;
  buyBasin(liquid: LiquidId): void;
  unlockZone(zoneId: string): void;
  switchZone(zoneId: string): void;
  toggleMute(): boolean;
  /** 目前進度的存檔碼（玩家複製帶走的那一串） */
  exportSave(): string;
  /** 用存檔碼還原；false＝這串碼不完整或根本不是存檔碼 */
  importSave(code: string): boolean;
}

const LIQUID_ICON: Record<LiquidId, CuteIconName> = {
  caramel: 'caramel',
  milk: 'milk',
  matcha: 'matcha',
  strawberry: 'strawberry',
};

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/**
 * 能加工的份數（D33：一份甜點＝蛋 ×2 ＋ 該物種原料 ×1）。
 * 蛋是共用的，所以總數受「蛋夠做幾份」與「各物種原料加起來能做幾份」雙重限制。
 */
function craftableCount(s: GameState): number {
  const byIngredient = SPECIES_IDS.reduce(
    (n, id) => n + Math.floor(s.ingredients[id] / BALANCE.ingredientsPerDessert),
    0,
  );
  const byEggs = Math.floor(s.eggs / BALANCE.eggsPerDessert);
  return Math.min(byIngredient, byEggs);
}
function totalDesserts(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + s.desserts[id], 0);
}
function totalIngredients(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + s.ingredients[id], 0);
}

/** 點頂列數字時小布丁講的話。用玩家的語言講「這個數字怎麼變多、拿來做什麼」，不是名詞解釋 */
const CHIP_TIPS: Record<string, string> = {
  coins: '焦糖幣！賣甜點和原料賺來的，拿去補液體、買設備、解鎖新櫥窗。',
  egg: '蛋。布丁每隔一陣子就會下一顆，每做一份甜點要用掉兩顆。',
  ing: '物種原料。哪一種布丁就掉哪一種原料，做那個口味的甜點會用到。',
  des: '做好的甜點。交訂單或按出貨，就會變成焦糖幣。',
};

export class Hud {
  /** 警告類提示被 × 關掉之後，多久再講一次（毫秒，真實時間） */
  private static readonly WARNING_SNOOZE_MS = 45_000;

  readonly root: HTMLElement;
  private readonly chipCoins: HTMLElement;
  private readonly chipEgg: HTMLElement;
  private readonly chipIng: HTMLElement;
  private readonly chipDes: HTMLElement;
  private readonly zonesBar: HTMLElement;
  private readonly ordersBox: HTMLElement;
  private readonly dockPour: HTMLElement;
  private readonly btnPick: HTMLButtonElement;
  private readonly btnCraft: HTMLButtonElement;
  private readonly btnShip: HTMLButtonElement;
  private readonly shop = new ShopView();
  private readonly shopLvl: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly welcome: HTMLElement;
  private readonly glCard: HTMLElement;
  private readonly a2hs: HTMLElement;
  private readonly saveCard: HTMLElement;
  private readonly saveText: HTMLTextAreaElement;
  private readonly tipBubble: HTMLElement;
  private tipTimer: ReturnType<typeof setTimeout> | undefined;
  /** 最後一次 update 收到的狀態；點訂單卡要用它算氣泡文字 */
  private last: GameState | null = null;
  private readonly muteIcon: HTMLElement;
  private readonly muteVal: HTMLElement;

  private hintOff = hintsDismissed();
  private hintId = '';
  /** 被 × 關掉的那一則（只在這一次開著的頁面裡有效，不進 localStorage） */
  private hintClosed = '';
  private hintClosedAt = 0;
  private zoneOrder: string[] = [];
  private activeZone = '';
  private pourKeys = '';
  private orderKeys = '';
  private lastRefresh = -1;

  constructor(parent: HTMLElement, private readonly act: HudActions) {
    this.root = el(`
      <div class="hud">
        <div class="topbar">
          <div class="chips">
            <span class="chip" data-k="coins" data-a="tip" data-arg="coins">${icon('coin', 'bubble')}<b>0</b></span>
            <span class="chip" data-k="egg" data-a="tip" data-arg="egg">${icon('egg', 'bubble')}<b>0</b></span>
            <span class="chip" data-k="ing" data-a="tip" data-arg="ing">${icon('ingredient', 'bubble')}<b>0</b></span>
            <span class="chip" data-k="des" data-a="tip" data-arg="des">${icon('dessert', 'bubble')}<b>0</b></span>
          </div>
          <button class="iconbtn" data-a="settings" aria-label="設定">${icon('gear')}</button>
          <button class="iconbtn shopbtn" data-a="shop" aria-label="商店">${cuteIcon('shop')}<span class="lvl">Lv.1</span></button>
        </div>
        <div class="zones" hidden>
          <button data-a="zoneStep" data-arg="-1" aria-label="上一個櫥窗">&#8249;</button>
          <span class="name"></span>
          <button data-a="zoneStep" data-arg="1" aria-label="下一個櫥窗">&#8250;</button>
        </div>
        <div class="orders"></div>
        <div class="dock">
          <div class="line" data-k="pour"></div>
          <div class="line">
            <button data-a="pick" class="tilebtn t-pick">${cuteIcon('hand', 'tile')}<span class="label">撿原料</span><span class="n"></span></button>
            <button data-a="craft" class="tilebtn t-craft">${cuteIcon('dessert', 'tile')}<span class="label">加工</span><span class="n"></span></button>
            <button data-a="ship" class="tilebtn primary">${cuteIcon('box', 'tile')}<span class="label">出貨</span><span class="n"></span></button>
          </div>
        </div>
        <div class="hint" hidden>
          <span class="who">小提示</span>
          <button class="x" data-a="hintClose" aria-label="收起這則提示">${icon('close')}</button>
          <div class="body"><span class="t"></span><button class="never" data-a="hintOff">不再顯示提示</button></div>
        </div>
        <div class="toasts"></div>
        <div class="tipbubble" hidden><span class="who">小布丁</span><span class="t"></span></div>
        <div class="welcome" hidden>
          <div class="card">
            <h2>歡迎回來</h2>
            <p></p>
            <button data-a="closeWelcome">看看櫥窗</button>
          </div>
        </div>
        <div class="welcome glcard" hidden>
          <div class="card">
            <h2>畫面被系統收走了</h2>
            <p>iPhone 切去別的 App 或放太久，會把 3D 繪圖收掉，回來就只剩背景色。進度沒事，已經先幫你存好了——重新整理就回得去。</p>
            <button data-a="reloadPage">重新整理</button>
          </div>
        </div>
        <div class="welcome a2hs" hidden>
          <div class="card">
            <h2>把農場加到主畫面</h2>
            <p>按 Safari 下方的分享鈕，選「加入主畫面」。從主畫面開才存得住進度——留在 Safari 分頁裡，七天沒回來就會被清掉。</p>
            <button data-a="closeA2hs">知道了</button>
          </div>
        </div>
        <div class="welcome savecard" hidden>
          <div class="card">
            <h2>設定</h2>
            <button data-a="mute" class="optrow">
              <span class="ic">${icon('sound')}</span><span class="label">音效</span><span class="val">開</span>
            </button>
            <h3>存檔碼</h3>
            <p>這串碼就是你的進度。複製起來貼到備忘錄，換手機或進度不見時貼回來按還原。</p>
            <textarea class="code" spellcheck="false" autocapitalize="off" autocorrect="off" rows="3"></textarea>
            <div class="row">
              <button data-a="copySave">複製</button>
              <button data-a="restoreSave">還原</button>
            </div>
            <div class="debugbox" hidden>
              <h3>效能與存檔狀態</h3>
              <pre id="debug"></pre>
            </div>
            <button data-a="closeSettings" class="ghost">關閉</button>
          </div>
        </div>
      </div>`);
    // 商店抽屜疊在歡迎卡下面、其他 HUD 上面
    this.root.insertBefore(this.shop.root, this.root.querySelector('.welcome'));
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
    this.chipCoins = q('[data-k="coins"] b');
    this.chipEgg = q('[data-k="egg"] b');
    this.chipIng = q('[data-k="ing"] b');
    this.chipDes = q('[data-k="des"] b');
    this.zonesBar = q('.zones');
    this.ordersBox = q('.orders');
    this.dockPour = q('[data-k="pour"]');
    this.btnPick = q('[data-a="pick"]');
    this.btnCraft = q('[data-a="craft"]');
    this.btnShip = q('[data-a="ship"]');
    this.shopLvl = q('.shopbtn .lvl');
    this.hint = q('.hint');
    this.toasts = q('.toasts');
    this.welcome = q('.welcome:not(.a2hs):not(.glcard):not(.savecard)');
    this.glCard = q('.glcard');
    this.a2hs = q('.a2hs');
    this.saveCard = q('.savecard');
    this.saveText = q('.savecard .code');
    this.tipBubble = q('.tipbubble');
    this.muteIcon = q('.savecard [data-a="mute"] .ic');
    this.muteVal = q('.savecard [data-a="mute"] .val');

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
      case 'sellEggs': this.act.sellEggs(); break;
      case 'buyStock': this.act.buyStock(arg as LiquidId, Number(target.dataset.qty) || BALANCE.stockBuyQty); break;
      case 'buyEquip': this.act.buyEquipment(arg as EquipmentId); break;
      case 'buyBasin': this.act.buyBasin(arg as LiquidId); break;
      case 'unlockZone': this.act.unlockZone(arg); break;
      case 'zoneStep': this.stepZone(Number(arg)); break;
      // 引導正說「去商店買原料收集手」時，直接開在設備頁——開在補貨頁玩家找不到
      case 'shop': this.toggleShop(true, !this.hintOff && this.hintId === 'buy' ? 'equipment' : undefined); break;
      case 'closeShop': this.toggleShop(false); break;
      case 'shopTab':
        this.shop.setPage(arg as ShopPage);
        this.lastRefresh = -1;
        break;
      case 'closeWelcome': this.welcome.hidden = true; break;
      // 繪圖環境被系統收走之後唯一走得通的出路：整頁重載（進度在 localStorage，不會掉）
      case 'reloadPage': location.reload(); break;
      case 'closeA2hs':
        dismissHomeScreenTip();
        this.a2hs.hidden = true;
        break;
      case 'tip': this.showTip(target, arg); break;
      case 'settings':
        this.saveText.value = this.act.exportSave();
        this.saveCard.hidden = false;
        break;
      case 'closeSettings': this.saveCard.hidden = true; break;
      case 'copySave': void this.copyCode(); break;
      case 'restoreSave':
        // 還原成功之後由 main.ts 重新載入整頁：把讀檔那條路徑跑一次，
        // 比在活著的世界裡逐欄位換掉安全得多
        if (!this.act.importSave(this.saveText.value)) this.toast('這串碼看起來不完整，請整串重貼一次', true);
        break;
      case 'hintClose':
        this.hintClosed = this.hintId;
        this.hintClosedAt = performance.now();
        this.hint.hidden = true;
        break;
      case 'hintOff':
        dismissHints();
        this.hintOff = true;
        this.hint.hidden = true;
        break;
      case 'mute': {
        const muted = this.act.toggleMute();
        this.muteIcon.innerHTML = icon(muted ? 'mute' : 'sound');
        this.muteVal.textContent = muted ? '關' : '開';
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

  private toggleShop(open: boolean, page?: ShopPage) {
    if (open) this.shop.show(page);
    else this.shop.hide();
    this.lastRefresh = -1; // 下一次 update 一定要重畫商店內容
  }

  /** 場景端也會叫（點櫃子上的鎖牌＝去商店的「擴建」頁解鎖） */
  openShop(page?: ShopPage) {
    this.toggleShop(true, page);
  }

  /** 歡迎卡正開著（「加到主畫面」那張要讓路，不然兩張疊在一起） */
  get welcomeVisible(): boolean {
    return !this.welcome.hidden;
  }

  showHomeScreenTip() {
    this.a2hs.hidden = false;
  }

  /** 繪圖環境被系統回收：3D 只剩背景色，要講出來並給一顆重新整理 */
  showContextLost() {
    this.glCard.hidden = false;
  }

  hideContextLost() {
    this.glCard.hidden = true;
  }

  showWelcome(text: string) {
    const p = this.welcome.querySelector('p');
    if (p) p.textContent = text;
    this.welcome.hidden = false;
  }

  /**
   * 點數字跳一則小布丁的說明。
   * 氣泡本身 `pointer-events: none`——它會蓋在畫面上，能點穿才不會擋住下一個動作。
   */
  private showTip(target: HTMLElement, kind: string) {
    const text = kind === 'order' ? this.orderTip(target) : CHIP_TIPS[kind];
    if (!text) return;

    const body = this.tipBubble.querySelector('.t') as HTMLElement;
    body.textContent = text;
    this.tipBubble.hidden = false;

    // 先讓它可見再量寬高，不然拿到的是 0
    const host = this.root.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const w = this.tipBubble.offsetWidth;
    const h = this.tipBubble.offsetHeight;
    const left = Math.min(Math.max(8, r.left - host.left + r.width / 2 - w / 2), Math.max(8, host.width - w - 8));
    // 預設放在被點的東西下面；下面放不下就改放上面（訂單卡在畫面偏下時會用到）
    const below = r.bottom - host.top + 10;
    const top = below + h > host.height - 8 ? Math.max(8, r.top - host.top - h - 10) : below;
    this.tipBubble.style.left = `${Math.round(left)}px`;
    this.tipBubble.style.top = `${Math.round(top)}px`;

    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => { this.tipBubble.hidden = true; }, 4200);
  }

  private orderTip(target: HTMLElement): string {
    const id = (target.closest('.order') as HTMLElement | null)?.dataset.id;
    const o = this.last?.orders.find((x) => x.id === id);
    if (!o) return '';
    return (
      `這張單要 ${o.qty} 份「${SPECIES[o.species].dessert}」，交得出來給 ${o.price} 焦糖幣。` +
      '下面那條時間條走完就過期，訂單會自己不見喔。'
    );
  }

  /** 複製存檔碼。clipboard API 被擋（非 https／權限）時退回「幫玩家選起來，請他長按複製」 */
  private async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.saveText.value);
      this.toast('存檔碼複製好了，貼到備忘錄存著');
    } catch {
      this.saveText.focus();
      this.saveText.setSelectionRange(0, this.saveText.value.length);
      this.toast('複製不了，請長按選取後自己複製', true);
    }
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
    this.last = state;
    if (!force && nowMs - this.lastRefresh < 160) return;
    this.lastRefresh = nowMs;

    this.chipCoins.textContent = String(Math.floor(state.coins));
    this.chipEgg.textContent = String(state.eggs);
    this.chipIng.textContent = String(totalIngredients(state));
    this.chipDes.textContent = String(totalDesserts(state));

    this.syncZones(state);
    this.syncPourButtons(state);
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

    this.shopLvl.textContent = `Lv.${levelFor(state.xp)}`;
    this.syncHint(state, nowMs);
    if (this.shop.open) this.shop.render(state);
  }

  private syncHint(state: GameState, nowMs: number) {
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
    this.hint.hidden = this.isClosed(h, nowMs);
  }

  /**
   * × 關掉的那一則要不要繼續藏著。
   *
   * 教學句：藏到換下一則為止（id 變了就重新出現）。
   * **警告類（農場停住、住滿了）：只藏 `WARNING_SNOOZE_MS`**——這種狀況不會因為時間過去
   * 自己好轉，`id` 也不會變，所以「關掉＝這一整場都不再講」等於把玩家重新關回
   * 那個沒人告訴他農場已經死掉的狀態（2026-09-22 修好的正是這個洞）。
   * 要真的永久安靜，按「不再顯示提示」。
   */
  private isClosed(h: { id: string; warning?: boolean }, nowMs: number): boolean {
    if (h.id !== this.hintClosed) return false;
    if (!h.warning) return true;
    return nowMs - this.hintClosedAt < Hud.WARNING_SNOOZE_MS;
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

  private syncOrders(state: GameState) {
    const key = state.orders.map((o) => o.id).join(',');
    if (key !== this.orderKeys) {
      this.orderKeys = key;
      this.ordersBox.innerHTML = state.orders
        .map((o) => {
          const info = SPECIES[o.species];
          return `<div class="order" data-id="${o.id}">
            <div class="t" data-a="tip" data-arg="order"><span>${info.dessert} ×${o.qty}</span><span class="sub">${o.price}</span></div>
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
}
