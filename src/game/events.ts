import type { LiquidId, SpeciesId } from './species';

/**
 * 模擬層丟出的事件，由 scene／ui／audio 層消費（播啪嘰、冒泡泡、閃光、跳數字）。
 * 規則本身不依賴事件有沒有被讀走——沒人讀就只是沒有演出。
 */
export type SimEvent =
  | { type: 'splat'; puddingId: string; x: number; z: number }
  | { type: 'bathStart'; puddingId: string; liquid: LiquidId }
  | { type: 'bathDone'; puddingId: string; liquid: LiquidId }
  | { type: 'drop'; species: SpeciesId; x: number; z: number }
  | { type: 'pick'; species: SpeciesId; x: number; z: number; auto: boolean }
  | { type: 'mutate'; puddingId: string; from: SpeciesId; to: SpeciesId; x: number; z: number }
  | { type: 'craft'; species: SpeciesId; auto: boolean }
  | { type: 'sell'; species: SpeciesId; coins: number; auto: boolean }
  | { type: 'orderNew'; orderId: string; species: SpeciesId; qty: number; price: number }
  | { type: 'orderDone'; orderId: string; species: SpeciesId; coins: number; auto: boolean }
  | { type: 'orderExpired'; orderId: string; species: SpeciesId }
  | { type: 'pour'; basinIndex: number; liquid: LiquidId; auto: boolean }
  | { type: 'buy'; what: string; cost: number; auto: boolean }
  | { type: 'error'; message: string };

export type EventSink = (e: SimEvent) => void;
