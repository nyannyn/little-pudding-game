import { BALANCE } from './balance';
import { dayClock } from './clock';
import type { EventSink } from './events';
import { grantXp } from './level';
import {
  MAX_MACHINE_LEVEL,
  RECIPES,
  STATIONS,
  STATION_IDS,
  anyLineReady,
  blockerLines,
  dessertPrice,
  lineFailRate,
  machinePrice,
  machineTier,
  maxBatch,
  upgradePrice,
  recipeBlockers,
  stationSeconds,
  takeRecipeMaterials,
  DESSERT_IDS,
  type DessertId,
  type StationId,
} from './recipes';
import { range, type Rng } from './rng';
import { SPECIES, SPECIES_IDS, type SpeciesId } from './species';
import { walkInMult } from './stars';
import type { GameState } from './state';
import {
  STARS,
  addStock,
  clampStar,
  lowestStar,
  moveStock,
  restoreTable,
  starCounts,
  stockAtLeast,
  stockOf,
  takeLowest,
  totalStock,
  zeroTable,
  type Star,
  type StarStock,
} from './stock';

export { STATIONS, STATION_IDS, type StationId } from './recipes';
export { clockText, dayClock, type DayClock } from './clock';

/**
 * 甜點工坊（D51／D52 → D56／D57，2026-09-24 改成食譜制全自動流水線）。
 *
 * 一條 7 站的線（`recipes.ts`）；玩家從菜單挑一道甜點「放上線」，那一盤就沿著自己的路線
 * 一站一站自動走到底（下一站還有一盤就在原站等）、做完進成品櫃。玩家只負責上架與交預訂單。
 * 機器要買、有等級：一盤份數＝路線上最低那台的份數。
 */

export interface Batch {
  /** 做哪一道甜點（D68 起可以是招牌甜點；欄位名沿用 `species`，舊存檔不必轉換） */
  species: DessertId;
  qty: number;
  /** 這一盤用的原料星級＝做出來的甜點星級（D64） */
  star: Star;
}

export interface Station {
  /** 這一站上的那一盤；null＝空站 */
  batch: Batch | null;
  /**
   * 這一盤進到這一站的遊戲時間（D60）。秒數看機器等級、而等級做到一半可能被升上去，
   * 所以進度條要用「進站那一刻定下的長度」（doneAt − startedAt）算，不能拿當下等級的秒數重算——
   * 否則升級那一瞬間進度條會往前跳。
   */
  startedAt: number;
  /** 這一站做完的遊戲時間（batch 為 null 時無意義） */
  doneAt: number;
}

export interface DayTally {
  day: number;
  revenue: number;
  served: number;
  missed: number;
}

export interface BakeryState {
  /**
   * 工坊時鐘的起點（遊戲秒）＝第 1 天 07:00。**舊存檔升上來時是升級那一刻的 `time`**：
   * 老玩家的 `time` 已經好幾萬秒，直接拿 `time / 一天` 算會第一天就顯示 Day 30。
   */
  epoch: number;
  stations: Record<StationId, Station>;
  /** 展示架上的甜點（客人只從這裡買），按星級分格（D64）。**讀寫一律經 `stock.ts`** */
  shelf: Record<DessertId, StarStock>;
  /** 下一位客人上門的遊戲時間 */
  nextCustomerAt: number;
  /** 今天到目前為止 */
  today: DayTally;
  /** 上一個打烊的營業日；還沒打烊過是 null。畫面常駐顯示它，不做每日 toast（離線一次跑 24 天） */
  lastDay: DayTally | null;
  /** 已經結算到第幾天（避免同一天結算兩次） */
  closedDay: number;
  /** 每台機器的等級（0＝沒買，D57；Lv1–20，D61） */
  machines: Record<StationId, number>;
  /** 店面人氣 Lv1–20（D61）：客人間隔、一次買幾份、店員自動上架 */
  fame: number;
}

/**
 * 店面人氣（D61）：需求那一條。實測（2026-09-24）Lv3 之後產量就超過客流，
 * 只加機器等級的話 Lv3 以後的升級買不到任何東西。每級同級距：客人間隔 ×`interval`。
 * 跨階里程碑：`staffLevel` 起店員自動上架（離線也照賣）、`buy3Level`／`buy4Level` 起客人一次最多買 3／4 份。
 */
export const FAME = {
  max: 20,
  interval: 0.93,
  staffLevel: 6,
  buy3Level: 11,
  buy4Level: 16,
} as const;

/** 從人氣 `lv` 升到 `lv + 1` 要多少錢；滿級 null */
export function famePrice(lv: number): number | null {
  if (lv >= FAME.max) return null;
  return upgradePrice(lv);
}

/** 這個人氣下客人間隔的倍率 */
export function fameIntervalMult(lv: number): number {
  return FAME.interval ** (Math.max(1, lv) - 1);
}

/** 這個人氣下一位客人最多買幾份 */
export function fameMaxBuy(lv: number): number {
  return lv >= FAME.buy4Level ? 4 : lv >= FAME.buy3Level ? 3 : 2;
}

export function hasStaff(state: GameState): boolean {
  return state.bakery.fame >= FAME.staffLevel;
}

export type StationStatus = 'idle' | 'working' | 'ready';

function emptyStations(): Record<StationId, Station> {
  const out = {} as Record<StationId, Station>;
  for (const id of STATION_IDS) out[id] = { batch: null, startedAt: 0, doneAt: 0 };
  return out;
}

function noMachines(): Record<StationId, number> {
  const out = {} as Record<StationId, number>;
  for (const id of STATION_IDS) out[id] = 0;
  return out;
}

export function createBakery(epoch: number): BakeryState {
  return {
    epoch,
    stations: emptyStations(),
    shelf: zeroTable(DESSERT_IDS),
    nextCustomerAt: epoch + BALANCE.bakery.customerIntervalMin,
    today: { day: 1, revenue: 0, served: 0, missed: 0 },
    lastDay: null,
    closedDay: 0,
    machines: noMachines(),
    fame: 1,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function tally(v: unknown, fallbackDay: number): DayTally {
  const src = (v ?? {}) as Partial<DayTally>;
  return {
    day: Math.max(1, Math.floor(num(src.day, fallbackDay))),
    revenue: Math.max(0, num(src.revenue, 0)),
    served: Math.max(0, num(src.served, 0)),
    missed: Math.max(0, num(src.missed, 0)),
  };
}

/**
 * v9 的機器等級（D57，3 級：1/2/4 份、失敗 ×1/×0.6/×0.3）換成 D61 的 20 級：**每一項都不能比舊的差**。
 * 舊 Lv2＝2 份／×0.6 → 新 Lv3（3 份／×0.49）；舊 Lv3＝4 份／×0.3 → 新 Lv5（5 份／×0.24）；秒數新版只會更快。
 * 照原數字留（舊 Lv3 → 新 Lv3＝3 份）等於上線當天默默少一份，而且不會有測試紅。
 */
export const V9_MACHINE_LEVEL = [0, 1, 3, 5] as const;

/** 存檔裡的工坊是 D61 以前的 3 級版：沒有 `fame` 欄（看形狀不看 schemaVersion，D45 的教訓） */
export function isV9Bakery(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'machines' in raw && !('fame' in raw);
}

/** 存檔裡的工坊是 D57 以前的五站版（沒有 `machines` 欄）：看形狀不看 schemaVersion（D45 的教訓） */
export function isLegacyBakery(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && !('machines' in raw);
}

/** D57 以前的配方：每份蛋 2、該物種原料 1；打蛋站扣蛋、攪拌站扣原料 */
const LEGACY_EGGS_PER = 2;
const LEGACY_ING_PER = 1;

/**
 * v8 → v9：舊五站線上做到一半的那幾盤退回材料（使用者選「舊存檔一樣要重新買」，
 * 機器歸零之後那幾盤再也走不完）。**打蛋站只扣過蛋、只退蛋；攪拌站以後蛋與原料都扣過、都退**。
 * 回傳退了幾盤（測試用）。只在 `isLegacyBakery` 時呼叫。
 */
export function refundLegacyBatches(raw: unknown, state: GameState): number {
  const stations = (raw as { stations?: Record<string, { batch?: { species?: unknown; qty?: unknown } | null } | undefined> })?.stations;
  if (!stations) return 0;
  let n = 0;
  for (const [id, st] of Object.entries(stations)) {
    const b = st?.batch;
    if (!b || !SPECIES_IDS.includes(b.species as SpeciesId)) continue;
    const qty = Math.max(0, Math.floor(num(b.qty, 0)));
    if (qty <= 0) continue;
    state.eggs += qty * LEGACY_EGGS_PER;
    if (id !== 'crack') addStock(state, 'ingredients', b.species as SpeciesId, 1, qty * LEGACY_ING_PER);
    n++;
  }
  return n;
}

/**
 * 從存檔還原工坊。沒有這欄（v7 以前）→ 以 `now`（升級那一刻的遊戲時間）當 epoch 開新工坊。
 * 舊五站版（v8）：時鐘、展示架、營業紀錄照留，站上的盤子不還原（`migrate` 另外退材料）、機器全無。
 * 站上的那一盤物種認不得的丟掉——寧可少一盤也不要讓一盤未知物種卡死整條流水線。
 */
export function restoreBakery(raw: unknown, now: number): BakeryState {
  if (typeof raw !== 'object' || raw === null) return createBakery(now);
  const r = raw as Partial<BakeryState>;
  const out = createBakery(num(r.epoch, now));
  if (!isLegacyBakery(raw)) {
    const v9 = isV9Bakery(raw);
    for (const id of STATION_IDS) {
      const src = (r.stations as Record<string, Partial<Station> | undefined> | undefined)?.[id];
      const b = src?.batch;
      if (b && DESSERT_IDS.includes(b.species as DessertId) && num(b.qty, 0) > 0) {
        const doneAt = num(src?.doneAt, now);
        // v9 沒有 startedAt：那一盤是用 Lv1 的固定秒數排的（D57 的秒數不隨等級變）
        const startedAt = Math.min(doneAt, num(src?.startedAt, doneAt - STATIONS[id].sec));
        // D71：v10 以前的盤子沒有星級 → ★1（原料當初就是 ★1 那一格扣的）
        const star = clampStar((b as Partial<Batch>).star);
        out.stations[id] = { batch: { species: b.species as DessertId, qty: Math.floor(num(b.qty, 1)), star }, startedAt, doneAt };
      }
    }
    const m = r.machines as Record<string, unknown> | undefined;
    for (const id of STATION_IDS) {
      const lv = Math.max(0, Math.floor(num(m?.[id], 0)));
      out.machines[id] = Math.min(MAX_MACHINE_LEVEL, v9 ? (V9_MACHINE_LEVEL[Math.min(3, lv)] ?? 0) : lv);
    }
    out.fame = Math.min(FAME.max, Math.max(1, Math.floor(num(r.fame, 1))));
  }
  // D71：舊的數字全部放進 ★1
  out.shelf = restoreTable(r.shelf, DESSERT_IDS);
  out.nextCustomerAt = num(r.nextCustomerAt, out.nextCustomerAt);
  out.today = tally(r.today, 1);
  out.lastDay = r.lastDay ? tally(r.lastDay, Math.max(1, out.today.day - 1)) : null;
  out.closedDay = Math.max(0, Math.floor(num(r.closedDay, 0)));
  return out;
}

// ── 查詢 ─────────────────────────────────────────

export function stationStatus(state: GameState, id: StationId): StationStatus {
  const st = state.bakery.stations[id];
  if (!st.batch) return 'idle';
  return state.time >= st.doneAt ? 'ready' : 'working';
}

/** 0–1 的進度（空站 0） */
export function stationProgress(state: GameState, id: StationId): number {
  const st = state.bakery.stations[id];
  if (!st.batch) return 0;
  const total = st.doneAt - st.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (state.time - st.startedAt) / total));
}

/** 這一盤在自己的路線上，下一站是哪裡（null＝這一站是最後一站） */
export function nextStationFor(species: DessertId, from: StationId): StationId | null {
  const route = RECIPES[species].route;
  return route[route.indexOf(from) + 1] ?? null;
}

export function shelfCount(state: GameState): number {
  return totalStock(state, 'shelf');
}

/** 線上正在做的盤數 */
export function batchesOnLine(state: GameState): number {
  return STATION_IDS.filter((id) => state.bakery.stations[id].batch).length;
}

/** 進行中的預訂單要保留多少份在成品櫃（上架時不能把它們擺出去被客人買走） */
export function reservedForOrders(state: GameState, species: SpeciesId): number {
  return state.orders
    .filter((o) => o.species === species && o.expiresAt > state.time)
    .reduce((n, o) => n + o.qty, 0);
}

/**
 * 成品櫃裡某一種甜點、每一星扣掉預訂單保留量之後還能上架幾份（索引 0＝★1）。
 * 保留量照「交單時會拿哪幾份」扣：常客的特別訂單從它要求的最低星級往上扣（先扣要求高的那張），
 * 散客訂單從最低星扣——跟 `fulfillOrder` 拿貨的順序一致，才不會上架上掉交單要用的那一份。
 */
export function spareDesserts(state: GameState, id: DessertId): number[] {
  const left = starCounts(state, 'desserts', id);
  const live = state.orders
    .filter((o) => o.species === id && o.expiresAt > state.time)
    .sort((a, b) => (b.star ?? 1) - (a.star ?? 1));
  for (const o of live) {
    let need = o.qty;
    for (let i = (o.star ?? 1) - 1; i < left.length && need > 0; i++) {
      const t = Math.min(left[i]!, need);
      left[i]! -= t;
      need -= t;
    }
  }
  return left;
}

/** 上架時要替誰保留一份（D70：今天有常客要來，店員先替他擺一份符合的） */
export interface ShelfWant {
  /** 常客吃得下的甜點（口味） */
  accepts: DessertId[];
  minStar: Star;
}

// ── 動作 ─────────────────────────────────────────

export type BakeryResult = { ok: true } | { ok: false; error: string };
const OK: BakeryResult = { ok: true };
const fail = (error: string): BakeryResult => ({ ok: false, error });

/** 一盤進到某一站：這一站要多久在這一刻定下（看這台當下的等級，D60） */
function enterStation(state: GameState, id: StationId, b: Batch): void {
  const st = state.bakery.stations[id];
  st.batch = b;
  st.startedAt = state.time;
  st.doneAt = state.time + stationSeconds(state, id);
}

/**
 * 從菜單把一盤放上線（D56）。機器、材料（至少 1 份）、起始站三項都要過，原料開工時一次扣齊。
 * **份數由玩家疊**（D60）：1 ≤ qty ≤ `maxBatch`（這條線最低那台的上限、材料夠做的份數取小）。
 * 超過就拒絕、不夾到上限——夾了等於 UI 算錯的時候靜默少做，玩家看到「按了 5 份、出爐 3 份」。
 */
export function startBatch(state: GameState, species: DessertId, qty: number, emit: EventSink, star: Star = 1): BakeryResult {
  // D64：一盤只用一個星級的原料；那一星不夠就拒絕，不從別的星級湊（AC11-5）
  const lines = blockerLines(recipeBlockers(state, species, star));
  if (lines.length) return fail(`★${star} ${lines.join('；')}`);
  const max = maxBatch(state, species, star);
  if (!Number.isInteger(qty) || qty < 1) return fail('至少要做 1 份');
  if (qty > max) return fail(`這一盤最多 ${max} 份`);
  takeRecipeMaterials(state, species, qty, star);
  const first = RECIPES[species].route[0]!;
  enterStation(state, first, { species, qty, star });
  emit({ type: 'bakeStep', station: first, species, auto: false });
  return OK;
}

/**
 * 買機器或升一級（D57／D61）：價錢由 `machinePrice` 照公比算，商店目錄讀同一個函式。
 * 正在這一站做的那一盤不受影響（它的 doneAt 在進站時就定了），下一盤才照新等級。
 */
export function buyMachine(state: GameState, id: StationId, emit: EventSink): BakeryResult {
  const lv = state.bakery.machines[id];
  const price = machinePrice(id, lv);
  if (price === null) return fail(`${STATIONS[id].name}已經是最高級`);
  if (state.coins < price) return fail('焦糖幣不夠');
  state.coins -= price;
  state.bakery.machines[id] = lv + 1;
  emit({ type: 'buy', what: lv === 0 ? STATIONS[id].name : `${STATIONS[id].name} Lv.${lv + 1}`, cost: price, auto: false });
  if (lv > 0 && machineTier(lv + 1) > machineTier(lv)) emit({ type: 'tierUp', what: STATIONS[id].name, tier: machineTier(lv + 1) });
  return OK;
}

/** 下一級要多少錢；滿級回 null */
export function machineNextPrice(state: GameState, id: StationId): number | null {
  return machinePrice(id, state.bakery.machines[id]);
}

/** 升店面人氣一級（D61） */
export function buyFame(state: GameState, emit: EventSink): BakeryResult {
  const lv = state.bakery.fame;
  const price = famePrice(lv);
  if (price === null) return fail('店面人氣已經是最高級');
  if (state.coins < price) return fail('焦糖幣不夠');
  state.coins -= price;
  state.bakery.fame = lv + 1;
  emit({ type: 'buy', what: `店面人氣 Lv.${lv + 1}`, cost: price, auto: false });
  return OK;
}

/**
 * 把成品櫃的甜點擺上展示架，擺到架滿為止；**預訂單要的份數留在成品櫃**，
 * 擺上架就會被散客買走、訂單永遠交不出去。回傳擺了幾份。
 *
 * D70 的上架順序：① 今天要來的常客（`wants`）架上還沒有他吃得下的，先替他擺一份（符合條件裡最低星）；
 * ② 其餘**先上低星**——散客最多付 ★2（D65），高星先上架只會被散客便宜買走。
 */
export function stockShelf(state: GameState, emit: EventSink, auto = false, wants: readonly ShelfWant[] = []): number {
  const cap = BALANCE.bakery.shelfCap;
  let room = cap - shelfCount(state);
  let moved = 0;
  const spare = new Map<DessertId, number[]>();
  const spareOf = (id: DessertId): number[] => {
    let s = spare.get(id);
    if (!s) spare.set(id, (s = spareDesserts(state, id)));
    return s;
  };
  const move = (id: DessertId, star: Star): void => {
    moveStock(state, 'desserts', 'shelf', id, star, 1);
    spareOf(id)[star - 1]!--;
    room--;
    moved++;
  };

  for (const w of wants) {
    if (room <= 0) break;
    if (w.accepts.some((id) => stockAtLeast(state, 'shelf', id, w.minStar) > 0)) continue;
    let best: { id: DessertId; star: Star } | null = null;
    for (const id of w.accepts) {
      const s = spareOf(id);
      for (const star of STARS) {
        if (star < w.minStar || (s[star - 1] ?? 0) <= 0) continue;
        if (!best || star < best.star) best = { id, star };
        break;
      }
    }
    if (best) move(best.id, best.star);
  }

  // 輪流擺：一種擺一份再換下一種，架上才會有好幾種口味（客人按份數加權挑）；每一種先擺最低星
  let progress = true;
  while (room > 0 && progress) {
    progress = false;
    for (const id of SPECIES_IDS) {
      if (room <= 0) break;
      const s = spareOf(id);
      const i = s.findIndex((n) => n > 0);
      if (i < 0) continue;
      move(id, (i + 1) as Star);
      progress = true;
    }
  }
  if (moved > 0) emit({ type: 'shelfStocked', qty: moved, auto });
  return moved;
}

/**
 * 上架卡的「上架 1」（D70）：從成品櫃把某一星的一份擺上架。預訂單要留的那幾份不能動（同 `stockShelf`）。
 */
export function shelfOne(state: GameState, id: DessertId, star: Star, emit: EventSink): BakeryResult {
  if (shelfCount(state) >= BALANCE.bakery.shelfCap) return fail(`展示架滿了（${BALANCE.bakery.shelfCap} 份）`);
  if ((spareDesserts(state, id)[star - 1] ?? 0) <= 0) return fail('這一種都留給預訂單了');
  moveStock(state, 'desserts', 'shelf', id, star, 1);
  emit({ type: 'shelfStocked', qty: 1, auto: false });
  return OK;
}

/** 這張訂單現在手上夠格的有幾份（成品櫃＋展示架，不低於訂單的最低星級） */
export function orderHave(state: GameState, o: { species: DessertId; star?: Star }): number {
  const min = o.star ?? 1;
  return stockAtLeast(state, 'desserts', o.species, min) + stockAtLeast(state, 'shelf', o.species, min);
}

/** 交一張預訂單：成品櫃先扣、不夠再從展示架拿 */
export function fulfillOrder(state: GameState, orderId: string, emit: EventSink, auto = false): BakeryResult {
  const i = state.orders.findIndex((o) => o.id === orderId);
  const o = state.orders[i];
  if (!o) return fail('訂單已經不在了');
  if (o.expiresAt <= state.time) return fail('訂單已經過期');
  // 常客的特別訂單有最低星級（D67）；散客訂單不挑。一律從最低星拿，高星留著
  const min = o.star ?? 1;
  const have = orderHave(state, o);
  const label = o.star ? `★${o.star} 以上的` : '';
  if (have < o.qty) return fail(`${label}${SPECIES[o.species].dessert}還差 ${o.qty - have} 份`);
  const fromBack = Math.min(o.qty, stockAtLeast(state, 'desserts', o.species, min));
  takeLowest(state, 'desserts', o.species, fromBack, min);
  takeLowest(state, 'shelf', o.species, o.qty - fromBack, min);
  state.coins += o.price;
  state.stats.sold += o.qty;
  state.stats.ordersDone++;
  state.bakery.today.revenue += o.price;
  state.orders.splice(i, 1);
  emit({ type: 'orderDone', orderId: o.id, species: o.species, coins: o.price, auto, regularId: o.regularId ?? null });
  grantXp(state, BALANCE.xp.order + BALANCE.xp.sellDessert * o.qty, emit);
  return OK;
}

// ── 每 tick ───────────────────────────────────────

function settleDay(state: GameState, day: number, emit: EventSink): void {
  const bk = state.bakery;
  const t = { ...bk.today, day };
  bk.lastDay = t;
  bk.closedDay = day;
  state.stats.daysClosed++;
  state.stats.bestDayRevenue = Math.max(state.stats.bestDayRevenue, t.revenue);
  bk.today = { day: day + 1, revenue: 0, served: 0, missed: 0 };
  emit({ type: 'dayClosed', day, revenue: t.revenue, served: t.served, missed: t.missed });
}

/** 散客買一份 `star` 星的這道甜點付多少：最多只付到 ★2 的價（D65） */
export function walkInPrice(id: DessertId, star: Star): number {
  return Math.round(dessertPrice(id) * walkInMult(star));
}

/**
 * 一位散客：按架上份數加權挑一種、**拿那一種最低星的那一份**（D65），買 1 份（有時更多）；
 * 付的是 `walkInPrice`（最多 ★2 的價）。架空就記一次錯過。
 */
function serveCustomer(state: GameState, rng: Rng, emit: EventSink): void {
  const bk = state.bakery;
  // 散客只買物種甜點（招牌甜點散客買不起，D68）：架上只剩招牌甜點＝對散客來說是空架
  const total = SPECIES_IDS.reduce((n, id) => n + stockOf(state, 'shelf', id), 0);
  if (total <= 0) {
    bk.today.missed++;
    state.stats.missed++;
    emit({ type: 'customerMissed' });
    return;
  }
  let r = rng.next() * total;
  let species: SpeciesId = SPECIES_IDS[0] as SpeciesId;
  for (const id of SPECIES_IDS) {
    r -= stockOf(state, 'shelf', id);
    if (r < 0) { species = id; break; }
  }
  if (stockOf(state, 'shelf', species) <= 0) species = SPECIES_IDS.find((id) => stockOf(state, 'shelf', id) > 0) as SpeciesId;
  const qty = customerQty(state, stockOf(state, 'shelf', species), rng);
  const stars = takeLowest(state, 'shelf', species, qty) ?? [];
  const coins = stars.reduce((n, s) => n + walkInPrice(species, s), 0);
  const star = stars[0] ?? lowestStar(state, 'shelf', species) ?? 1;
  state.coins += coins;
  state.stats.sold += qty;
  state.stats.served++;
  bk.today.revenue += coins;
  bk.today.served++;
  emit({ type: 'customer', species, qty, coins, star });
  grantXp(state, BALANCE.xp.sellDessert * qty, emit);
}

/**
 * 一位客人買幾份：人氣 Lv11 以前照舊（`customerDoubleChance` 的機率買 2 份）；
 * 之後在 1…最多份數之間平均擲（Lv11 最多 3、Lv16 最多 4），不超過架上那一種有的份數。
 */
function customerQty(state: GameState, onShelf: number, rng: Rng): number {
  const max = fameMaxBuy(state.bakery.fame);
  const want = max <= 2 ? (rng.next() < BALANCE.bakery.customerDoubleChance ? 2 : 1) : 1 + Math.floor(rng.next() * max);
  return Math.max(1, Math.min(want, onShelf));
}

/** 最後一站做完：每份獨立擲失敗（D56），成功的進成品櫃 */
function finishBatch(state: GameState, b: Batch, rng: Rng, emit: EventSink): void {
  const p = lineFailRate(state, b.species);
  let ok = 0;
  for (let i = 0; i < b.qty; i++) if (rng.next() >= p) ok++;
  const failed = b.qty - ok;
  if (failed > 0) emit({ type: 'bakeFailed', species: b.species, qty: failed });
  if (ok === 0) return;
  addStock(state, 'desserts', b.species, b.star, ok);
  state.stats.baked += ok;
  emit({ type: 'bakeDone', species: b.species, qty: ok, auto: true, star: b.star });
  grantXp(state, BALANCE.xp.craft * ok, emit);
}

/**
 * 輸送帶（D57）：做完的那一盤自動往自己路線的下一站走；下一站還有一盤就留在原站等。
 * **下游先動**：後面的站先清出來，前面的才推得過去（同一 tick 內一條線可以整排往前挪）。
 */
function runLine(state: GameState, rng: Rng, emit: EventSink): void {
  const st = state.bakery.stations;
  for (const id of [...STATION_IDS].reverse()) {
    const b = st[id].batch;
    if (!b || state.time < st[id].doneAt) continue;
    const next = nextStationFor(b.species, id);
    if (next === null) {
      st[id].batch = null;
      finishBatch(state, b, rng, emit);
      continue;
    }
    if (st[next].batch) continue;
    enterStation(state, next, b);
    st[id].batch = null;
    emit({ type: 'bakeStep', station: next, species: b.species, auto: true });
  }
}

export function tickBakery(state: GameState, rng: Rng, emit: EventSink, wants: readonly ShelfWant[] = []): void {
  runLine(state, rng, emit);
  // 店員（人氣 Lv6 起）：成品櫃有貨、架上有空就補——離線結算也照跑，所以離線那幾小時賣得到東西。
  // `wants`＝今天要來的常客（D70：先替他擺一份），由 sim 從名冊算好傳進來
  if (hasStaff(state)) stockShelf(state, emit, true, wants);

  const B = BALANCE.bakery;
  const bk = state.bakery;
  const c = dayClock(state);

  // 打烊結算：時鐘過了今天的打烊時間、而且今天還沒結算過
  if (c.hour >= B.closeHour && bk.closedDay < c.day) settleDay(state, c.day, emit);
  // 跨了整天都沒 tick 到打烊（不該發生：advance 最大步長 1 秒）也要補結，不可以把那天的營收吞掉
  else if (bk.closedDay < c.day - 1) settleDay(state, c.day - 1, emit);

  // 還沒湊齊任何一道甜點的整條線、架上也沒貨：店還沒開張，不排客人（D57）。
  // 架上有貨就照常營業——v8 老玩家升上來機器歸零，但展示架上的貨不能就這樣凍住賣不掉
  if (!c.open || (!anyLineReady(state) && shelfCount(state) === 0)) {
    // 打烊中不排客人；開門那一刻第一位就上門
    bk.nextCustomerAt = state.time;
    return;
  }
  if (bk.today.day !== c.day) bk.today = { day: c.day, revenue: 0, served: 0, missed: 0 };
  if (state.time < bk.nextCustomerAt) return;
  serveCustomer(state, rng, emit);
  const k = fameIntervalMult(bk.fame);
  bk.nextCustomerAt = state.time + range(rng, B.customerIntervalMin * k, B.customerIntervalMax * k);
}
