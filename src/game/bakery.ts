import { BALANCE } from './balance';
import type { EventSink } from './events';
import { grantXp } from './level';
import { range, type Rng } from './rng';
import { SPECIES, SPECIES_IDS, dessertPrice, type SpeciesId } from './species';
import type { GameState } from './state';

/**
 * 甜點工坊（D51／D52，2026-09-23 使用者要求「製作甜點有一個專屬的地方」「每個步驟都要有
 * 動畫跟對應的機器」「烘焙需要時間、擺在架上販賣、營業時間、日營收」）。
 *
 * 五站流水線：打蛋 → 攪拌 → 裝模 → 烘烤 → 裝飾。一次一盤（`batchSize` 份同一物種），
 * 每站同時只放一盤，所以五站可以各做一盤。手動＝點「完成」的那一站把這盤推到下一站；
 * 自動化設備（`bakery.auto`，**規則先做好、商店尚未上架**）在 `tickBakery` 裡呼叫同一組函式——
 * 手動與自動共用規則，UI 端不准自己抄一份（2026-09-22 出貨吃掉訂單就是這樣來的）。
 */

export type StationId = 'crack' | 'mix' | 'mold' | 'bake' | 'decorate';
export const STATION_IDS: StationId[] = ['crack', 'mix', 'mold', 'bake', 'decorate'];

export interface StationInfo {
  id: StationId;
  /** 機器名（場景名牌、HUD） */
  name: string;
  /** 動作名（按鈕上的動詞） */
  verb: string;
  /**
   * 之後上架的自動化設備售價（D54：「甜點製作自動化系統應該很貴」）。
   * **本包只定價、不上架**——使用者說「我之後才能上架自動化機器」。
   */
  autoPrice: number;
  autoName: string;
}

export const STATIONS: Record<StationId, StationInfo> = {
  crack: { id: 'crack', name: '打蛋機', verb: '打蛋', autoPrice: 1500, autoName: '自動打蛋機' },
  mix: { id: 'mix', name: '攪拌機', verb: '攪拌', autoPrice: 2000, autoName: '自動攪拌臂' },
  mold: { id: 'mold', name: '裝模機', verb: '裝模', autoPrice: 2500, autoName: '自動注模嘴' },
  bake: { id: 'bake', name: '烤箱', verb: '烘烤', autoPrice: 4000, autoName: '烤箱輸送帶' },
  decorate: { id: 'decorate', name: '裝飾台', verb: '裝飾', autoPrice: 5000, autoName: '自動擠花機' },
};

/** 之後才上架的其他昂貴升級（D54，只定價）：烤箱加速兩級、店員 */
export const BAKERY_UPGRADE_PRICES = { ovenSpeed: [3000, 8000], ovenSpeedFactor: 0.7, clerk: 6000, clerkDailyWage: 100 } as const;

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
  /** 每一站有沒有裝自動化（D54；商店尚未上架，全是 false） */
  auto: Record<StationId, boolean>;
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

function noAuto(): Record<StationId, boolean> {
  const out = {} as Record<StationId, boolean>;
  for (const id of STATION_IDS) out[id] = false;
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
    auto: noAuto(),
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
 * 從存檔還原工坊。沒有這欄（v7 以前）→ 以 `now`（升級那一刻的遊戲時間）當 epoch 開新工坊。
 * 站上的那一盤照存檔還原（包括還沒做完的），物種認不得的丟掉——寧可少一盤也不要讓
 * 一盤未知物種卡死整條流水線。
 */
export function restoreBakery(raw: unknown, now: number): BakeryState {
  if (typeof raw !== 'object' || raw === null) return createBakery(now);
  const r = raw as Partial<BakeryState>;
  const out = createBakery(num(r.epoch, now));
  for (const id of STATION_IDS) {
    const src = (r.stations as Record<string, Partial<Station> | undefined> | undefined)?.[id];
    const b = src?.batch;
    if (b && SPECIES_IDS.includes(b.species as SpeciesId) && num(b.qty, 0) > 0) {
      out.stations[id] = { batch: { species: b.species as SpeciesId, qty: Math.floor(num(b.qty, 1)) }, doneAt: num(src?.doneAt, now) };
    }
  }
  const shelf = r.shelf as Record<string, unknown> | undefined;
  for (const id of SPECIES_IDS) out.shelf[id] = Math.max(0, Math.floor(num(shelf?.[id], 0)));
  out.nextCustomerAt = num(r.nextCustomerAt, out.nextCustomerAt);
  out.today = tally(r.today, 1);
  out.lastDay = r.lastDay ? tally(r.lastDay, Math.max(1, out.today.day - 1)) : null;
  out.closedDay = Math.max(0, Math.floor(num(r.closedDay, 0)));
  const auto = r.auto as Record<string, unknown> | undefined;
  for (const id of STATION_IDS) out.auto[id] = auto?.[id] === true;
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
  const total = BALANCE.bakery.stepSec[id] ?? 1;
  return Math.min(1, Math.max(0, 1 - (st.doneAt - state.time) / total));
}

export function nextStation(id: StationId): StationId | null {
  return STATION_IDS[STATION_IDS.indexOf(id) + 1] ?? null;
}

export function shelfCount(state: GameState): number {
  return SPECIES_IDS.reduce((n, id) => n + state.bakery.shelf[id], 0);
}

/** 這個物種現在開得了一盤嗎：蛋與原料都要夠整盤（不然做到攪拌站才卡住） */
export function canStartBatch(state: GameState, species: SpeciesId): boolean {
  const q = BALANCE.bakery.batchSize;
  return state.eggs >= q * BALANCE.eggsPerDessert && state.ingredients[species] >= q * BALANCE.ingredientsPerDessert;
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
 * 打蛋站開一盤。**開工前就驗齊整盤的蛋與原料**：只驗蛋的話，玩家可能在攪拌之前
 * 把原料賣掉，那一盤就永遠卡在打蛋站。打蛋扣蛋；原料到攪拌站才扣（那一步才加得進去）。
 */
export function startBatch(state: GameState, species: SpeciesId, emit: EventSink, auto = false): BakeryResult {
  const st = state.bakery.stations.crack;
  if (st.batch) return fail('打蛋機上還有一盤');
  const q = BALANCE.bakery.batchSize;
  const eggs = q * BALANCE.eggsPerDessert;
  const ing = q * BALANCE.ingredientsPerDessert;
  if (state.eggs < eggs) return fail(`一盤要 ${eggs} 顆蛋`);
  if (state.ingredients[species] < ing) return fail(`一盤要 ${ing} 份${SPECIES[species].ingredient}`);
  state.eggs -= eggs;
  st.batch = { species, qty: q };
  st.doneAt = state.time + (BALANCE.bakery.stepSec.crack ?? 1);
  emit({ type: 'bakeStep', station: 'crack', species, auto });
  return OK;
}

/**
 * 把做完的那一盤推到下一站並立刻開工；裝飾站做完就進成品櫃。
 * 下一站還有一盤就推不動（留在原站等），這就是流水線的節流。
 */
export function advanceStation(state: GameState, id: StationId, emit: EventSink, auto = false): BakeryResult {
  const st = state.bakery.stations[id];
  const b = st.batch;
  if (!b) return fail(`${STATIONS[id].name}上沒有東西`);
  if (state.time < st.doneAt) return fail(`${STATIONS[id].name}還在${STATIONS[id].verb}`);

  const next = nextStation(id);
  if (next === null) {
    state.desserts[b.species] += b.qty;
    state.stats.baked += b.qty;
    st.batch = null;
    emit({ type: 'bakeDone', species: b.species, qty: b.qty, auto });
    grantXp(state, BALANCE.xp.craft * b.qty, emit);
    return OK;
  }

  const to = state.bakery.stations[next];
  if (to.batch) return fail(`${STATIONS[next].name}還有一盤`);
  if (next === 'mix') {
    const ing = b.qty * BALANCE.ingredientsPerDessert;
    if (state.ingredients[b.species] < ing) return fail(`攪拌要 ${ing} 份${SPECIES[b.species].ingredient}`);
    state.ingredients[b.species] -= ing;
  }
  to.batch = b;
  to.doneAt = state.time + (BALANCE.bakery.stepSec[next] ?? 1);
  st.batch = null;
  emit({ type: 'bakeStep', station: next, species: b.species, auto });
  return OK;
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

/** 自動化：下游先動（裝飾 → 打蛋），上游推過來時下一站才空得出來 */
function runBakeryAutomation(state: GameState, emit: EventSink): void {
  const auto = state.bakery.auto;
  for (const id of [...STATION_IDS].reverse()) {
    if (!auto[id]) continue;
    if (stationStatus(state, id) === 'ready') advanceStation(state, id, emit, true);
  }
  if (auto.crack && !state.bakery.stations.crack.batch) {
    // 自動打蛋機挑「原料最多、做得起」的那一種
    const pickable = SPECIES_IDS.filter((id) => canStartBatch(state, id));
    const best = pickable.sort((a, b) => state.ingredients[b] - state.ingredients[a])[0];
    if (best) startBatch(state, best, emit, true);
  }
}

export function tickBakery(state: GameState, rng: Rng, emit: EventSink): void {
  runBakeryAutomation(state, emit);

  const B = BALANCE.bakery;
  const bk = state.bakery;
  const c = dayClock(state);

  // 打烊結算：時鐘過了今天的打烊時間、而且今天還沒結算過
  if (c.hour >= B.closeHour && bk.closedDay < c.day) settleDay(state, c.day, emit);
  // 跨了整天都沒 tick 到打烊（不該發生：advance 最大步長 1 秒）也要補結，不可以把那天的營收吞掉
  else if (bk.closedDay < c.day - 1) settleDay(state, c.day - 1, emit);

  if (!c.open) {
    // 打烊中不排客人；開門那一刻第一位就上門
    bk.nextCustomerAt = state.time;
    return;
  }
  if (bk.today.day !== c.day) bk.today = { day: c.day, revenue: 0, served: 0, missed: 0 };
  if (state.time < bk.nextCustomerAt) return;
  serveCustomer(state, rng, emit);
  bk.nextCustomerAt = state.time + range(rng, B.customerIntervalMin, B.customerIntervalMax);
}
