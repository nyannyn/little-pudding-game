import './hud.css';
import { claimableCount, type AchievementCategory } from '../game/achievements';
import { AchievementSheet } from './achievements';
import { batchesOnLine, clockText, dayClock, reservedForOrders, shelfCount, type StationId } from '../game/bakery';
import { BALANCE, type EquipmentId } from '../game/balance';
import { levelFor } from '../game/level';
import {
  RECIPES,
  STATIONS,
  blockerLines,
  canStartRecipe,
  dessertPrice,
  anyLineReady,
  lineCost,
  lineFailRate,
  linePortions,
  materialHave,
  materialName,
  recipeBlockers,
  recipeMaterials,
  recipeSeconds,
  type PantryId,
} from '../game/recipes';
import { SPECIES, SPECIES_IDS, type LiquidId, type SpeciesId } from '../game/species';
import type { GameState } from '../game/state';
import { puddingsIn, unlockedZones } from '../game/zones';
import { LIQUID_SHORT, bakeryHint, closeHintForGood, closedHint, dismissHints, hintsDismissed, nextHint } from './hints';
import { dismissHomeScreenTip } from './homeScreen';
import { cuteIcon, icon, type CuteIconName } from './icons';
import { ShopView, type ShopPage } from './shop';
import { artHtml } from './shop';
import { INGREDIENT_ART } from './shopArt';
import { storageZoneLabel, storedRows, type StorageRow } from './storage';

export type GameView = 'farm' | 'bakery';

export interface HudActions {
  pour(liquid: LiquidId): void;
  pickAll(): void;
  /** 切換農場／甜點工坊（D51：兩個獨立場景） */
  setView(view: GameView): void;
  /** 從菜單把一盤放上流水線（D56；之後自己一站一站走完） */
  startBatch(species: SpeciesId): void;
  /** 買工坊機器或升一級（D57） */
  buyMachine(id: StationId): void;
  /** 買基礎材料（D58） */
  buyPantry(id: PantryId, qty: number): void;
  stockShelf(): void;
  claimAchievement(id: string): void;
  claimAllAchievements(): void;
  /** 賣一隻這個物種的成年布丁（D53） */
  sellPudding(species: SpeciesId): void;
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
  /** 倉庫（D49）：點倉庫裡的一件拿出來擺；`key` 是 `storage.refKey()` 的格式 */
  placeFurniture(key: string): void;
  /** 擺放模式下方那排按鈕 */
  editOk(): void;
  editCancel(): void;
  editStore(): void;
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

/** 成品櫃裡「可以上架」的份數：扣掉預訂單要留的，再受展示架剩餘空位限制 */
function shelvable(s: GameState): number {
  const spare = SPECIES_IDS.reduce((n, id) => n + Math.max(0, s.desserts[id] - reservedForOrders(s, id)), 0);
  return Math.min(spare, BALANCE.bakery.shelfCap - shelfCount(s));
}
function totalDesserts(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + s.desserts[id], 0);
}
function totalIngredients(s: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + s.ingredients[id], 0);
}

/** 點頂列數字時小布丁講的話。用玩家的語言講「這個數字怎麼變多、拿來做什麼」，不是名詞解釋 */
const CHIP_TIPS: Record<string, string> = {
  coins: '焦糖幣！賣原料、甜點店的營收、領成就都會進來，拿去補液體、買設備、解鎖新櫥窗。',
  egg: '蛋。布丁每隔一陣子就會下一顆。可以直接賣，也可以在甜點店打蛋做甜點（一份兩顆）。',
  ing: '物種原料。哪一種布丁就掉哪一種原料：直接賣給商店，或送進甜點店做成那個口味的甜點。',
  des: '成品櫃裡做好的甜點。到甜點店按「上架」擺進展示櫃，營業時間客人會來買；預訂單也從這裡交。',
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
  private readonly btnShelf: HTMLButtonElement;
  private readonly dayBar: HTMLElement;
  private readonly achBadge: HTMLElement;
  private readonly ach = new AchievementSheet();
  /** 菜單卡（D56）：十道食譜，缺什麼寫在各自下面 */
  private readonly menuCard: HTMLElement;
  /** 預訂單卡（工坊的右欄只放一顆鈕：卡片直接疊在畫面上會蓋掉半間店，2026-09-23 iPhone SE 截圖） */
  private readonly orderCard: HTMLElement;
  private readonly ordBadge: HTMLElement;
  private menuSig = '';
  private view: GameView = 'farm';
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
  /** 按 × 永久關掉的告知類警告 id（`Hint.dismissable`），存在 localStorage */
  private hintForever = closedHint();
  private hintDismissable = false;
  private readonly storeCard: HTMLElement;
  private storeSig = '';
  private readonly editBar: HTMLElement;
  private readonly confirmCard: HTMLElement;
  private onConfirm: (() => void) | null = null;
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
        <div class="daybar bakery-only">
          <span class="when"><b class="day"></b><b class="clock"></b><span class="open"></span></span>
          <span class="money"><span class="today"></span><span class="yday"></span></span>
          <span class="onl"></span>
        </div>
        <button class="iconbtn storebtn farm-only" data-a="storage" aria-label="倉庫">${icon('storage')}<span class="lbl">倉庫</span></button>
        <div class="rightcol">
          <button class="iconbtn achbtn" data-a="achievements" aria-label="成就">${icon('trophy')}<i class="badge" hidden></i></button>
          <button class="iconbtn ordbtn bakery-only" data-a="openOrders" aria-label="預訂單">${icon('order')}<i class="badge" hidden></i></button>
        </div>
        <div class="dock">
          <div class="line farm-only" data-k="pour"></div>
          <div class="line farm-only">
            <button data-a="pick" class="tilebtn t-pick">${cuteIcon('hand', 'tile')}<span class="label">撿原料</span><span class="n"></span></button>
            <button data-a="goBakery" class="tilebtn primary t-bakery">${cuteIcon('bakery', 'tile')}<span class="label">甜點店</span><span class="n"></span></button>
          </div>
          <div class="line bakery-only">
            <button data-a="openMenu" class="tilebtn t-menu">${cuteIcon('book', 'tile')}<span class="label">菜單</span><span class="n"></span></button>
            <button data-a="stockShelf" class="tilebtn t-shelf">${cuteIcon('shelf', 'tile')}<span class="label">上架</span><span class="n"></span></button>
            <button data-a="goFarm" class="tilebtn primary t-farm">${cuteIcon('farm', 'tile')}<span class="label">回農場</span><span class="n"></span></button>
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
        <div class="welcome storecard" hidden>
          <div class="card">
            <h2>倉庫</h2>
            <p class="lead">點一件拿出來擺。想搬動或收回櫥窗裡的家具，長按它就好。</p>
            <p class="where"></p>
            <div class="sgrid"></div>
            <button data-a="closeStorage" class="ghost">關閉</button>
          </div>
        </div>
        <div class="editbar" hidden>
          <p class="tip">拖動來換位置</p>
          <div class="row">
            <button data-a="editStore" class="store">${icon('storage')}<span>收進倉庫</span></button>
            <button data-a="editCancel" class="cancel" aria-label="取消">${icon('close')}<span>取消</span></button>
            <button data-a="editOk" class="ok" aria-label="確定"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>確定</span></button>
          </div>
        </div>
        <div class="welcome confirmcard" hidden>
          <div class="card">
            <h2>收進倉庫</h2>
            <p></p>
            <div class="row">
              <button data-a="confirmNo" class="ghost">取消</button>
              <button data-a="confirmYes" class="danger">倒掉並收起</button>
            </div>
          </div>
        </div>
        <div class="welcome menucard" hidden>
          <div class="card">
            <h2>菜單</h2>
            <p class="lead">挑一道甜點放上流水線，機器會自己一站一站做完。</p>
            <div class="rlist"></div>
            <button data-a="closeMenu" class="ghost">關閉</button>
          </div>
        </div>
        <div class="welcome ordercard" hidden>
          <div class="card">
            <h2>預訂單</h2>
            <p class="lead">客人預訂的甜點：湊齊份數按「交貨」，價錢是平常的 2–3 倍。成品櫃不夠會從展示架補。</p>
            <div class="orders"></div>
            <p class="empty">現在沒有預訂單，過一陣子就會有客人來訂。</p>
            <button data-a="closeOrders" class="ghost">關閉</button>
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
    this.root.insertBefore(this.ach.root, this.root.querySelector('.welcome'));
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
    this.btnShelf = q('[data-a="stockShelf"]');
    this.dayBar = q('.daybar');
    this.achBadge = q('.achbtn .badge');
    this.menuCard = q('.menucard');
    this.shopLvl = q('.shopbtn .lvl');
    this.hint = q('.hint');
    this.toasts = q('.toasts');
    this.welcome = q('.welcome:not(.a2hs):not(.glcard):not(.savecard):not(.storecard):not(.confirmcard):not(.menucard):not(.ordercard)');
    this.orderCard = q('.ordercard');
    this.ordBadge = q('.ordbtn .badge');
    this.storeCard = q('.storecard');
    this.editBar = q('.editbar');
    this.confirmCard = q('.confirmcard');
    this.glCard = q('.glcard');
    this.a2hs = q('.a2hs');
    this.saveCard = q('.savecard');
    this.saveText = q('.savecard .code');
    this.tipBubble = q('.tipbubble');
    this.muteIcon = q('.savecard [data-a="mute"] .ic');
    this.muteVal = q('.savecard [data-a="mute"] .val');

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.dataset.view = 'farm';

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
      case 'goBakery': this.act.setView('bakery'); break;
      case 'goFarm': this.act.setView('farm'); break;
      case 'openMenu': this.openMenu(); break;
      case 'startBatch':
        this.menuCard.hidden = true;
        this.act.startBatch(arg as SpeciesId);
        break;
      case 'closeMenu': this.menuCard.hidden = true; break;
      case 'buyMachine': this.act.buyMachine(arg as StationId); break;
      case 'buyPantry': this.act.buyPantry(arg as PantryId, Number(target.dataset.qty) || BALANCE.stockBuyQty); break;
      case 'stockShelf': this.act.stockShelf(); break;
      case 'achievements':
        // 兩張底部抽屜疊在一起會只看得到上面那張：開成就就把商店收起來
        if (this.shop.open) this.toggleShop(false);
        this.ach.show();
        this.lastRefresh = -1;
        break;
      case 'closeAch': this.ach.hide(); break;
      case 'achTab':
        this.ach.setTab(arg as AchievementCategory);
        this.lastRefresh = -1;
        break;
      case 'claimAllAch': this.act.claimAllAchievements(); break;
      case 'openOrders':
        this.orderCard.hidden = false;
        this.lastRefresh = -1;
        break;
      case 'closeOrders': this.orderCard.hidden = true; break;
      case 'claim':
        this.act.claimAchievement(arg);
        break;
      case 'sellPud': this.act.sellPudding(arg as SpeciesId); break;
      case 'fulfill': this.act.fulfill(arg); break;
      case 'sellIng': this.act.sellIngredients(arg as SpeciesId); break;
      case 'sellEggs': this.act.sellEggs(); break;
      case 'buyStock': this.act.buyStock(arg as LiquidId, Number(target.dataset.qty) || BALANCE.stockBuyQty); break;
      case 'buyEquip': this.act.buyEquipment(arg as EquipmentId); break;
      case 'buyBasin': this.act.buyBasin(arg as LiquidId); break;
      case 'unlockZone': this.act.unlockZone(arg); break;
      case 'zoneStep': this.stepZone(Number(arg)); break;
      // 引導正說「去商店買原料收集手」時，直接開在設備頁——開在補貨頁玩家找不到
      case 'shop': this.toggleShop(true, this.hintOff ? undefined : this.hintId === 'buy' ? 'equipment' : this.hintId === 'bk-buy' ? 'bakery' : undefined); break;
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
      case 'storage':
        this.storeCard.hidden = false;
        this.storeSig = '';
        this.lastRefresh = -1;
        break;
      case 'closeStorage': this.storeCard.hidden = true; break;
      case 'placeItem':
        // 拿出來就進擺放模式：卡片先收掉，玩家要看得到櫥窗才擺得了
        this.storeCard.hidden = true;
        this.act.placeFurniture(arg);
        break;
      case 'editOk': this.act.editOk(); break;
      case 'editCancel': this.act.editCancel(); break;
      case 'editStore': this.act.editStore(); break;
      case 'confirmYes': {
        const yes = this.onConfirm;
        this.onConfirm = null;
        this.confirmCard.hidden = true;
        yes?.();
        break;
      }
      case 'confirmNo':
        this.onConfirm = null;
        this.confirmCard.hidden = true;
        break;
      case 'copySave': void this.copyCode(); break;
      case 'restoreSave':
        // 還原成功之後由 main.ts 重新載入整頁：把讀檔那條路徑跑一次，
        // 比在活著的世界裡逐欄位換掉安全得多
        if (!this.act.importSave(this.saveText.value)) this.toast('這串碼看起來不完整，請整串重貼一次', true);
        break;
      case 'hintClose':
        if (this.hintDismissable) {
          this.hintForever = this.hintId;
          closeHintForGood(this.hintId);
        }
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
    if (open) this.ach.hide();
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

    // 甜點店鈕的徽章：做好、等你上架的份數（D57 起線上自己走，玩家要做的只剩上架）——人在農場也看得到。
    // 錢夠買焦糖布丁塔整條線、卻一台機器都沒有：換成「!」提醒去工坊（教學在買完收集手就結束了）
    const waiting = shelvable(state);
    const needLine = !anyLineReady(state) && state.coins >= lineCost(state, 'caramel');
    const goBakery = this.root.querySelector('[data-a="goBakery"]') as HTMLElement;
    goBakery.classList.toggle('alert', needLine);
    (goBakery.querySelector('.n') as HTMLElement).textContent = needLine ? '!' : waiting ? String(waiting) : '';
    this.syncBakery(state);

    const claimable = claimableCount(state);
    this.achBadge.hidden = claimable === 0;
    this.achBadge.textContent = String(claimable);
    if (this.ach.open) this.ach.render(state);
    if (!this.menuCard.hidden) this.syncMenu(state);

    this.shopLvl.textContent = `Lv.${levelFor(state.xp)}`;
    this.syncHint(state, nowMs);
    if (this.shop.open) this.shop.render(state);
    if (!this.storeCard.hidden) this.syncStorage(state);
  }

  /** 切換農場／工坊：只換 HUD 上哪些東西看得到（`.farm-only`／`.bakery-only`），場景由 main.ts 換 */
  setView(view: GameView) {
    this.view = view;
    this.root.dataset.view = view;
    this.menuCard.hidden = true;
    this.orderCard.hidden = true;
    this.lastRefresh = -1;
  }

  /** 開菜單（工坊的「菜單」鈕、點空著的機器都走這裡） */
  openMenu() {
    this.menuCard.hidden = false;
    this.menuSig = '';
    this.lastRefresh = -1;
  }

  private syncBakery(state: GameState) {
    const c = dayClock(state);
    const bk = state.bakery;
    (this.dayBar.querySelector('.day') as HTMLElement).textContent = `第 ${c.day} 天`;
    (this.dayBar.querySelector('.clock') as HTMLElement).textContent = clockText(c.hour);
    const open = this.dayBar.querySelector('.open') as HTMLElement;
    open.textContent = c.open ? '營業中' : `打烊・${String(BALANCE.bakery.openHour).padStart(2, '0')}:00 開門`;
    open.classList.toggle('closed', !c.open);
    (this.dayBar.querySelector('.today') as HTMLElement).textContent = `今日 +${Math.floor(bk.today.revenue)}`;
    const yday = this.dayBar.querySelector('.yday') as HTMLElement;
    yday.textContent = bk.lastDay ? `昨日 +${Math.floor(bk.lastDay.revenue)}・客 ${bk.lastDay.served}` : '';
    const onLine = batchesOnLine(state);
    (this.dayBar.querySelector('.onl') as HTMLElement).textContent = onLine ? `流水線上 ${onLine} 盤` : '';

    // 菜單鈕的徽章：現在就能開工的甜點有幾道
    const startable = SPECIES_IDS.filter((id) => canStartRecipe(state, id)).length;
    (this.root.querySelector('[data-a="openMenu"] .n') as HTMLElement).textContent = startable ? String(startable) : '';
    const shelf = shelvable(state);
    this.btnShelf.disabled = shelf <= 0;
    (this.btnShelf.querySelector('.n') as HTMLElement).textContent = shelf > 0 ? String(shelf) : '';
  }

  /**
   * 菜單（D56）：十道食譜一道一張卡——原料有／需、總時長、失敗率、售價、這條線一盤幾份；
   * 機器與原料都齊、起始站空著才能按「開始製作」，不然卡片下面逐條寫缺什麼。
   *
   * 結構（能不能開工、缺哪幾樣、份數上限）變了才重建；持有數每 160ms 就地改字——
   * 收集手一直在撿，把持有數放進 sig（包括「缺原料：蛋 3/4」這種字）等於一兩秒重建一次，
   * 手指底下的按鈕會被換掉（D55 的教訓）。所以缺料那行只寫材料名，數字在晶片上。
   */
  private syncMenu(state: GameState) {
    const rows = SPECIES_IDS.map((id) => {
      const b = recipeBlockers(state, id);
      return { id, ok: canStartRecipe(state, id), lines: blockerLines(b, false), qty: linePortions(state, id), fail: lineFailRate(state, id) };
    });
    const sig = JSON.stringify(rows);
    if (sig !== this.menuSig) {
      this.menuSig = sig;
      const list = this.menuCard.querySelector('.rlist') as HTMLElement;
      const scroll = list.scrollTop;
      list.innerHTML = rows
        .map(({ id, ok, lines, qty, fail }) => {
          const info = SPECIES[id];
          const r = RECIPES[id];
          const secs = recipeSeconds(id);
          const time = secs >= 60 ? `${Math.floor(secs / 60)} 分 ${secs % 60} 秒` : `${secs} 秒`;
          // 晶片寫「一份要幾個」：份數是上限（D57），夠 1 份就開得了工
          const mats = recipeMaterials(id)
            .map(([k, n]) => `<span class="mat" data-k="${k}" data-need="${n}">${materialName(k)} <b>0</b>/${n}</span>`)
            .join('');
          return `<div class="rcard" data-id="${id}" data-ok="${ok}">
            <div class="rhead">
              ${artHtml(INGREDIENT_ART[id])}
              <div class="txt"><b>${info.dessert}</b><small>${r.route.map((st) => STATIONS[st].name).join(' → ')}</small></div>
              <span class="price">${dessertPrice(id)}</span>
            </div>
            <div class="meta"><span>總時長 ${time}</span><span>失敗率 ${Math.round(fail * 1000) / 10}%</span><span>${qty > 0 ? `一盤最多 ${qty} 份` : '還沒有機器'}</span></div>
            <div class="mats">${mats}</div>
            ${lines.map((t) => `<p class="miss">${t}</p>`).join('')}
            <button class="buy" data-a="startBatch" data-arg="${id}"${ok ? '' : ' disabled'}>開始製作</button>
          </div>`;
        })
        .join('');
      list.scrollTop = scroll;
    }
    for (const m of this.menuCard.querySelectorAll<HTMLElement>('.mat')) {
      const have = materialHave(state, m.dataset.k as never);
      (m.querySelector('b') as HTMLElement).textContent = String(have);
      m.classList.toggle('short', have < Number(m.dataset.need));
    }
  }

  /** 倉庫卡：一件一格（圖＋名字＋數量）；只在內容變了才重建 DOM（每幀重建會吃掉按到一半的點擊） */
  private syncStorage(state: GameState) {
    const stored = storedRows(state);
    const sig = JSON.stringify([state.activeZone, stored]);
    if (sig === this.storeSig) return;
    this.storeSig = sig;
    const tile = (r: StorageRow) => `<button class="stile" data-a="placeItem" data-arg="${r.key}"${r.disabled ? ' disabled' : ''}>
        ${artHtml(r.art, r.count && r.count > 1 ? `×${r.count}` : '')}
        <b>${r.name}</b>${r.sub ? `<small>${r.sub}</small>` : ''}
      </button>`;
    const where = this.storeCard.querySelector('.where') as HTMLElement;
    where.hidden = stored.length === 0;
    where.textContent = `會擺到你正在看的${storageZoneLabel(state)}。`;
    (this.storeCard.querySelector('.sgrid') as HTMLElement).innerHTML =
      stored.map(tile).join('') || '<p class="empty">倉庫是空的</p>';
  }

  /**
   * 擺放模式（D49）：動作列換成「收進倉庫／取消／確定」。
   * `canStore`＝櫥窗裡的家具才收得回去（從倉庫拿出來的，取消就是放回去）；`movable`＝注液閥拖不動，提示改口。
   */
  showEditBar(o: { canStore: boolean; movable: boolean; ok: boolean }) {
    this.editBar.hidden = false;
    this.root.classList.add('editing');
    (this.editBar.querySelector('.store') as HTMLElement).hidden = !o.canStore;
    (this.editBar.querySelector('.tip') as HTMLElement).textContent = o.movable
      ? '在畫面上拖動來換位置，按確定放好'
      : '注液閥掛在澡盆上、跟著澡盆走，可以收進倉庫';
    (this.editBar.querySelector('.ok') as HTMLElement).hidden = !o.movable && o.canStore;
    this.setEditOk(o.ok);
  }

  setEditOk(ok: boolean) {
    (this.editBar.querySelector('.ok') as HTMLButtonElement).disabled = !ok;
  }

  hideEditBar() {
    this.editBar.hidden = true;
    this.root.classList.remove('editing');
  }

  /** 收起來會倒掉液體時的確認卡（不用 confirm()：它會卡住 iOS 與測試） */
  confirmStore(text: string, onYes: () => void) {
    (this.confirmCard.querySelector('p') as HTMLElement).textContent = text;
    this.onConfirm = onYes;
    this.confirmCard.hidden = false;
  }

  private syncHint(state: GameState, nowMs: number) {
    const h = this.view === 'bakery' ? bakeryHint(state) : nextHint(state);
    // 「不再顯示提示」＝全部都不顯示，包含警告（2026-09-23 使用者回報：警告無視這顆鈕＝按了沒反應）。
    // 農場停住的事，離線回來的歡迎卡照樣會講（main.ts 的離線結算摘要）
    if (this.hintOff) {
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
    this.hintDismissable = h.dismissable === true;
    this.hint.hidden = this.isClosed(h, nowMs);
  }

  /**
   * × 關掉的那一則要不要繼續藏著。
   *
   * 教學句：藏到換下一則為止（id 變了就重新出現）。
   * **警告類（農場停住、住滿了）：只藏 `WARNING_SNOOZE_MS`**——這種狀況不會因為時間過去
   * 自己好轉，`id` 也不會變，所以「關掉＝這一整場都不再講」等於把玩家重新關回
   * 那個沒人告訴他農場已經死掉的狀態（2026-09-22 修好的正是這個洞）。
   * 要真的永久安靜，按「不再顯示提示」（連警告一起關）。
   */
  private isClosed(h: { id: string; warning?: boolean; dismissable?: boolean }, nowMs: number): boolean {
    if (h.dismissable && h.id === this.hintForever) return true;
    if (h.id !== this.hintClosed) return false;
    if (!h.warning) return true;
    return nowMs - this.hintClosedAt < Hud.WARNING_SNOOZE_MS;
  }

  private syncZones(state: GameState) {
    if (this.view === 'bakery') {
      this.zonesBar.hidden = true;
      return;
    }
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
    const live = state.orders.filter((o) => o.expiresAt > state.time);
    const ready = live.filter((o) => state.desserts[o.species] + state.bakery.shelf[o.species] >= o.qty).length;
    // 徽章：有交得出來的就顯示可交的張數（綠），否則顯示張數
    this.ordBadge.hidden = live.length === 0;
    this.ordBadge.textContent = String(ready || live.length);
    this.ordBadge.classList.toggle('ok', ready > 0);
    (this.orderCard.querySelector('.empty') as HTMLElement).hidden = state.orders.length > 0;
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
      btn.disabled = state.desserts[o.species] + state.bakery.shelf[o.species] < o.qty;
      const left = Math.max(0, (o.expiresAt - state.time) / BALANCE.orderTtlSec);
      (card.querySelector('.clock > i') as HTMLElement).style.width = `${Math.round(left * 100)}%`;
    }
  }
}
