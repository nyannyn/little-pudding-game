import { BALANCE } from './balance';
import { runAutomation } from './equipment';
import type { EventSink, SimEvent } from './events';
import { tickOrders } from './orders';
import { tickPudding, type FloorRect, type SimContext } from './pudding';
import { createRng, type Rng } from './rng';
import type { GameState } from './state';

/**
 * 世界＝state ＋ 亂數 ＋ 地板邊界。
 * state 是要存檔的資料，rng 與 floor 是執行期的東西（floor 由 scene 層量出來傳進來）。
 *
 * tick 直接就地改 state（不回新物件）：這是每幀都要跑的迴圈，
 * 每幀複製整份 state 只會製造 GC 壓力。玩家動作那一層才是純函式語意（見 actions.ts）。
 */
export interface World {
  state: GameState;
  rng: Rng;
  floor: FloorRect;
  /** 最近的事件（給 scene／ui 消費，每幀 drain 一次） */
  events: SimEvent[];
  emit: EventSink;
}

/** 事件佇列上限：離線結算八小時會產生上千個事件，全留著只是浪費記憶體 */
const EVENT_CAP = 256;

export function createWorld(state: GameState, floor: FloorRect): World {
  const w: World = {
    state,
    rng: createRng(state.rngState),
    floor,
    events: [],
    emit: (e) => {
      w.events.push(e);
      if (w.events.length > EVENT_CAP) w.events.splice(0, w.events.length - EVENT_CAP);
    },
  };
  return w;
}

export function drainEvents(w: World): SimEvent[] {
  const out = w.events;
  w.events = [];
  return out;
}

function context(w: World): SimContext {
  return { rng: w.rng, floor: w.floor, emit: w.emit };
}

/** 跑一個固定步長 */
function step(w: World, dt: number, ctx: SimContext): void {
  const s = w.state;
  s.time += dt;
  for (const p of s.puddings) tickPudding(s, p, dt, ctx);
  runAutomation(s, w.emit);
  tickOrders(s, w.rng, w.emit);
}

/**
 * 推進 dt 秒遊戲時間。大的 dt 會切成不超過 1 秒的小步。
 *
 * 這不是「離線與線上逐步等價」的保證——線上每步約 0.016 秒、離線每步 1 秒，
 * 亂數抽取次數與落點都會不同。切步長的目的是別讓單一大步跳過整個狀態機
 * （例如一步就跨過泡澡的 20 秒），並讓自動化每「遊戲秒」最多跑一次。
 */
export function advance(w: World, dt: number): void {
  if (!(dt > 0)) return;
  const ctx = context(w);
  let left = dt;
  const max = BALANCE.offlineStepSec;
  while (left > 1e-6) {
    const d = Math.min(max, left);
    step(w, d, ctx);
    left -= d;
  }
  w.state.rngState = w.rng.s;
}

/**
 * 離線結算：用 `lastSeenAt` 補跑，上限 offlineCapSec（8 小時）。
 * 回傳實際補跑了幾秒，UI 可以拿去說「你離開時布丁又泡了幾次澡」。
 */
export function settleOffline(w: World, nowMs: number): number {
  const elapsedSec = Math.max(0, (nowMs - w.state.lastSeenAt) / 1000);
  const capped = Math.min(elapsedSec, BALANCE.offlineCapSec);
  if (capped > 0) advance(w, capped);
  w.state.lastSeenAt = nowMs;
  return capped;
}

/** 存檔前呼叫：把執行期的亂數狀態與時間戳寫回 state */
export function syncForSave(w: World, nowMs: number): GameState {
  w.state.rngState = w.rng.s;
  w.state.lastSeenAt = nowMs;
  return w.state;
}
