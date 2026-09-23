import { BALANCE } from './balance';
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
  linePortions,
  recipeBlockers,
  takeRecipeMaterials,
  type StationId,
} from './recipes';
import { range, type Rng } from './rng';
import { SPECIES, SPECIES_IDS, type SpeciesId } from './species';
import type { GameState } from './state';

export { STATIONS, STATION_IDS, type StationId } from './recipes';

/**
 * 甜點工坊（D51／D52 → D56／D57，2026-09-24 改成食譜制全自動流水線）。
 *
 * 一條 7 站的線（`recipes.ts`）；玩家從菜單挑一道甜點「放上線」，那一盤就沿著自己的路線
 * 一站一站自動走到底（下一站還有一盤就在原站等）、做完進成品櫃。玩家只負責上架與交預訂單。
 * 機器要買、有等級：一盤份數＝路線上最低那台的份數。
 */

export interface Batch {
  species: SpeciesId;
  qty: number;
}

export interface Station {
  /** 這一站上的那一盤；null＝空站 */
  batch: Batch | null;
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
  /** 展示架上的甜點（客人只從這裡買） */
  shelf: Record<SpeciesId, number>;
  /** 下一位客人上門的遊戲時間 */
  nextCustomerAt: number;
  /** 今天到目前為止 */
  today: DayTally;
  /** 上一個打烊的營業日；還沒打烊過是 null。畫面常駐顯示它，不做每日 toast（離線一次跑 24 天） */
  lastDay: DayTally | null;
  /** 已經結算到第幾天（避免同一天結算兩次） */
  closedDay: number;
  /** 每台機器的等級（0＝沒買，D57） */
  machines: Record<StationId, number>;
}

export type StationStatus = 'idle' | 'working' | 'ready';

function zeroShelf(): Record<SpeciesId, number> {
  const out = {} as Record<SpeciesId, number>;
  for (const id of SPECIES_IDS) out[id] = 0;
  return out;
}

function emptyStations(): Record<StationId, Station> {
  const out = {} as Record<StationId, Station>;
  for (const id of STATION_IDS) out[id] = { batch: null, doneAt: 0 };
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
    shelf: zeroShelf(),
    nextCustomerAt: epoch + BALANCE.bakery.customerIntervalMin,
    today: { day: 1, revenue: 0, served: 0, missed: 0 },
    lastDay: null,
    closedDay: 0,
    machines: noMachines(),
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
    if (id !== 'crack') state.ingredients[b.species as SpeciesId] += qty * LEGACY_ING_PER;
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
    for (const id of STATION_IDS) {
      const src = (r.stations as Record<string, Partial<Station> | undefined> | undefined)?.[id];
      const b = src?.batch;
      if (b && SPECIES_IDS.includes(b.species as SpeciesId) && num(b.qty, 0) > 0) {
        out.stations[id] = { batch: { species: b.species as SpeciesId, qty: Math.floor(num(b.qty, 1)) }, doneAt: num(src?.doneAt, now) };
      }
    }
    const m = r.machines as Record<string, unknown> | undefined;
    for (const id of STATION_IDS) out.machines[id] = Math.min(MAX_MACHINE_LEVEL, Math.max(0, Math.floor(num(m?.[id], 0))));
  }
  const shelf = r.shelf as Record<string, unknown> | undefined;
  for (const id of SPECIES_IDS) out.shelf[id] = Math.max(0, Math.floor(num(shelf?.[id], 0)));
  out.nextCustomerAt = num(r.nextCustomerAt, out.nextCustomerAt);
  out.today = tally(r.today, 1);
  out.lastDay = r.lastDay ? tally(r.lastDay, Math.max(1, out.today.day - 1)) : null;
  out.closedDay = Math.max(0, Math.floor(num(r.closedDay, 0)));
  return out;
}

// ── 時鐘 ─────────────────────────────────────────

export interface DayClock {
  /** 第幾天（1 起） */
  day: number;
  /** 0–24 的小時（含小數） */
  hour: number;
  open: boolean;
}

/** epoch 是第 1 天 07:00：時鐘往前平移營業開始的那幾個小時 */
export function dayClock(state: GameState): DayClock {
  const B = BALANCE.bakery;
  const t = state.time - state.bakery.epoch + (B.openHour / 24) * B.dayLengthSec;
  const day = Math.floor(t / B.dayLengthSec) + 1;
  const hour = ((t % B.dayLengthSec + B.dayLengthSec) % B.dayLengthSec) / B.dayLengthSec * 24;
  return { day, hour, open: hour >= B.openHour && hour < B.closeHour };
}

/** 「14:05」這種顯示字串 */
export function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
  const total = STATIONS[id].sec;
  return Math.min(1, Math.max(0, 1 - (st.doneAt - state.time) / total));
}

/** 這一盤在自己的路線上，下一站是哪裡（null＝這一站是最後一站） */
export function nextStationFor(species: SpeciesId, from: StationId): StationId | null {
  const route = RECIPES[species].route;
  return route[route.indexOf(from) + 1] ?? null;
}

export function shelfCount(state: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + state.bakery.shelf[id], 0);
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

// ── 動作 ─────────────────────────────────────────

export type BakeryResult = { ok: true } | { ok: false; error: string };
const OK: BakeryResult = { ok: true };
const fail = (error: string): BakeryResult => ({ ok: false, error });

/**
 * 從菜單把一盤放上線（D56）。機器、材料、起始站三項都要過，原料開工時一次扣齊；
 * 一盤份數＝這條線最低那台的份數（D57）。
 */
export function startBatch(state: GameState, species: SpeciesId, emit: EventSink): BakeryResult {
  const lines = blockerLines(recipeBlockers(state, species));
  if (lines.length) return fail(lines.join('；'));
  const qty = linePortions(state, species);
  takeRecipeMaterials(state, species, qty);
  const first = RECIPES[species].route[0]!;
  const st = state.bakery.stations[first];
  st.batch = { species, qty };
  st.doneAt = state.time + STATIONS[first].sec;
  emit({ type: 'bakeStep', station: first, species, auto: false });
  return OK;
}

/** 買機器或升一級（D57）：價錢在 `STATIONS[id].prices`，商店目錄讀同一份 */
export function buyMachine(state: GameState, id: StationId, emit: EventSink): BakeryResult {
  const lv = state.bakery.machines[id];
  if (lv >= MAX_MACHINE_LEVEL) return fail(`${STATIONS[id].name}已經是最高級`);
  const price = STATIONS[id].prices[lv]!;
  if (state.coins < price) return fail('焦糖幣不夠');
  state.coins -= price;
  state.bakery.machines[id] = lv + 1;
  emit({ type: 'buy', what: lv === 0 ? STATIONS[id].name : `${STATIONS[id].name} Lv.${lv + 1}`, cost: price, auto: false });
  return OK;
}

/** 下一級要多少錢；滿級回 null */
export function machineNextPrice(state: GameState, id: StationId): number | null {
  const lv = state.bakery.machines[id];
  return lv >= MAX_MACHINE_LEVEL ? null : STATIONS[id].prices[lv]!;
}

/**
 * 把成品櫃的甜點擺上展示架，擺到架滿為止；**預訂單要的份數留在成品櫃**，
 * 擺上架就會被散客買走、訂單永遠交不出去。回傳擺了幾份。
 */
export function stockShelf(state: GameState, emit: EventSink, auto = false): number {
  const cap = BALANCE.bakery.shelfCap;
  let room = cap - shelfCount(state);
  let moved = 0;
  // 輪流擺：一種擺一份再換下一種，架上才會有好幾種口味（客人按份數加權挑）
  let progress = true;
  while (room > 0 && progress) {
    progress = false;
    for (const id of SPECIES_IDS) {
      if (room <= 0) break;
      const spare = state.desserts[id] - reservedForOrders(state, id);
      if (spare <= 0) continue;
      state.desserts[id]--;
      state.bakery.shelf[id]++;
      room--;
      moved++;
      progress = true;
    }
  }
  if (moved > 0) emit({ type: 'shelfStocked', qty: moved, auto });
  return moved;
}

/** 交一張預訂單：成品櫃先扣、不夠再從展示架拿 */
export function fulfillOrder(state: GameState, orderId: string, emit: EventSink, auto = false): BakeryResult {
  const i = state.orders.findIndex((o) => o.id === orderId);
  const o = state.orders[i];
  if (!o) return fail('訂單已經不在了');
  if (o.expiresAt <= state.time) return fail('訂單已經過期');
  const have = state.desserts[o.species] + state.bakery.shelf[o.species];
  if (have < o.qty) return fail(`${SPECIES[o.species].dessert}還差 ${o.qty - have} 份`);
  const fromBack = Math.min(o.qty, state.desserts[o.species]);
  state.desserts[o.species] -= fromBack;
  state.bakery.shelf[o.species] -= o.qty - fromBack;
  state.coins += o.price;
  state.stats.sold += o.qty;
  state.stats.ordersDone++;
  state.bakery.today.revenue += o.price;
  state.orders.splice(i, 1);
  emit({ type: 'orderDone', orderId: o.id, species: o.species, coins: o.price, auto });
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

/** 一位客人：按架上份數加權挑一種買 1 份（有時 2 份）；架空就記一次錯過 */
function serveCustomer(state: GameState, rng: Rng, emit: EventSink): void {
  const bk = state.bakery;
  const total = shelfCount(state);
  if (total <= 0) {
    bk.today.missed++;
    state.stats.missed++;
    emit({ type: 'customerMissed' });
    return;
  }
  let r = rng.next() * total;
  let species: SpeciesId = SPECIES_IDS[0] as SpeciesId;
  for (const id of SPECIES_IDS) {
    r -= bk.shelf[id];
    if (r < 0) { species = id; break; }
  }
  if (bk.shelf[species] <= 0) species = SPECIES_IDS.find((id) => bk.shelf[id] > 0) as SpeciesId;
  const qty = bk.shelf[species] >= 2 && rng.next() < BALANCE.bakery.customerDoubleChance ? 2 : 1;
  const coins = dessertPrice(species) * qty;
  bk.shelf[species] -= qty;
  state.coins += coins;
  state.stats.sold += qty;
  state.stats.served++;
  bk.today.revenue += coins;
  bk.today.served++;
  emit({ type: 'customer', species, qty, coins });
  grantXp(state, BALANCE.xp.sellDessert * qty, emit);
}

/** 最後一站做完：每份獨立擲失敗（D56），成功的進成品櫃 */
function finishBatch(state: GameState, b: Batch, rng: Rng, emit: EventSink): void {
  const p = lineFailRate(state, b.species);
  let ok = 0;
  for (let i = 0; i < b.qty; i++) if (rng.next() >= p) ok++;
  const failed = b.qty - ok;
  if (failed > 0) emit({ type: 'bakeFailed', species: b.species, qty: failed });
  if (ok === 0) return;
  state.desserts[b.species] += ok;
  state.stats.baked += ok;
  emit({ type: 'bakeDone', species: b.species, qty: ok, auto: true });
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
    st[next].batch = b;
    st[next].doneAt = state.time + STATIONS[next].sec;
    st[id].batch = null;
    emit({ type: 'bakeStep', station: next, species: b.species, auto: true });
  }
}

export function tickBakery(state: GameState, rng: Rng, emit: EventSink): void {
  runLine(state, rng, emit);

  const B = BALANCE.bakery;
  const bk = state.bakery;
  const c = dayClock(state);

  // 打烊結算：時鐘過了今天的打烊時間、而且今天還沒結算過
  if (c.hour >= B.closeHour && bk.closedDay < c.day) settleDay(state, c.day, emit);
  // 跨了整天都沒 tick 到打烊（不該發生：advance 最大步長 1 秒）也要補結，不可以把那天的營收吞掉
  else if (bk.closedDay < c.day - 1) settleDay(state, c.day - 1, emit);

  // 還沒湊齊任何一道甜點的整條線：店還沒開張，不排客人（D57）
  if (!c.open || !anyLineReady(state)) {
    // 打烊中不排客人；開門那一刻第一位就上門
    bk.nextCustomerAt = state.time;
    return;
  }
  if (bk.today.day !== c.day) bk.today = { day: c.day, revenue: 0, served: 0, missed: 0 };
  if (state.time < bk.nextCustomerAt) return;
  serveCustomer(state, rng, emit);
  bk.nextCustomerAt = state.time + range(rng, B.customerIntervalMin, B.customerIntervalMax);
}
