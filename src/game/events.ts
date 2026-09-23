import type { LiquidId, SpeciesId } from './species';
import type { StationId } from './bakery';
import type { DropKind } from './state';

/**
 * 模擬層丟出的事件，由 scene／ui／audio 層消費（播啪嘰、冒泡泡、閃光、跳數字）。
 * 規則本身不依賴事件有沒有被讀走——沒人讀就只是沒有演出。
 */
export type SimEvent =
  | { type: 'splat'; puddingId: string; x: number; z: number }
  | { type: 'bathStart'; puddingId: string; liquid: LiquidId }
  | { type: 'bathDone'; puddingId: string; liquid: LiquidId }
  | { type: 'drop'; kind: DropKind; species: SpeciesId; x: number; z: number }
  | { type: 'pick'; kind: DropKind; species: SpeciesId; x: number; z: number; auto: boolean }
  | { type: 'mutate'; puddingId: string; from: SpeciesId; to: SpeciesId; x: number; z: number }
  | { type: 'birth'; puddingId: string; zone: string; species: SpeciesId; parents: [string, string]; x: number; z: number }
  | { type: 'move'; puddingId: string; zone: string }
  // ── 甜點工坊（D51／D52）──
  | { type: 'bakeStep'; station: StationId; species: SpeciesId; auto: boolean }
  | { type: 'bakeDone'; species: SpeciesId; qty: number; auto: boolean }
  | { type: 'shelfStocked'; qty: number; auto: boolean }
  | { type: 'customer'; species: SpeciesId; qty: number; coins: number }
  | { type: 'customerMissed' }
  /** 打烊結算。**不要接成 toast**：離線一次會跑出 24 個（D52），畫面讀 `bakery.lastDay` */
  | { type: 'dayClosed'; day: number; revenue: number; served: number; missed: number }
  | { type: 'achievement'; id: string; name: string; reward: number }
  /** 「全部領取」一次領好幾條：只發這一個，不逐條發 `achievement`（七則 toast 會把別的通知擠掉） */
  | { type: 'achievementsClaimed'; count: number; reward: number }
  | { type: 'puddingSold'; puddingId: string; species: SpeciesId; coins: number }
  | { type: 'sell'; species: SpeciesId; coins: number; auto: boolean }
  | { type: 'orderNew'; orderId: string; species: SpeciesId; qty: number; price: number }
  | { type: 'orderDone'; orderId: string; species: SpeciesId; coins: number; auto: boolean }
  | { type: 'orderExpired'; orderId: string; species: SpeciesId }
  | { type: 'pour'; basinIndex: number; liquid: LiquidId; units: number; auto: boolean }
  | { type: 'buy'; what: string; cost: number; auto: boolean }
  | { type: 'levelUp'; level: number; from: number }
  | { type: 'error'; message: string };

export type EventSink = (e: SimEvent) => void;
