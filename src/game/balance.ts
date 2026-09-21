/**
 * 所有可調數值集中在這裡（計畫：「數值是初版，放 balance.ts 隨時調」）。
 * 一格 tick ＝ 1 秒遊戲時間；`?fastTime=N` 讓 1 秒現實時間跑 N 秒遊戲時間。
 *
 * 2026-09-21 調整（相對計畫初版）與理由：
 * - `caramelDecayPerSec` 1/秒（原 1/分）、`bathDurationSec` 20（原 60）：
 *   原數值一輪生產要 70 分鐘遊戲時間，開著看不到任何事發生，讀起來像壞掉。
 *   現在一隻布丁約 90 秒產一份原料，兩隻約 45 秒一份。
 * - `flavorExposurePerBath` 8 小時（原 1 小時），門檻仍維持 48 小時：
 *   風味突變改成 6 次泡澡（約 9 分鐘），原本要 48 次泡澡＝好幾小時。
 * - 訂單卡間隔 150–300 秒（原 10–20 分鐘）：對齊上面加快的生產節奏。
 */
export const BALANCE = {
  /** 每秒掉多少 caramel */
  caramelDecayPerSec: 1,
  /** 低於這個值就想去泡澡 */
  batheThreshold: 30,
  /** 泡一次澡幾秒 */
  bathDurationSec: 20,

  /** 跳躍：落地後休息時間區間、單次跳躍時長、跳躍高度（世界單位） */
  hopRestMin: 1.2,
  hopRestMax: 2.8,
  hopDurationSec: 0.62,
  hopHeight: 0.14,
  /** 布丁之間的最小間距，跳躍目標會避開 */
  puddingSpacing: 0.22,

  /** 澡盆容量（份） */
  basinCapacity: 3,
  /** 一次泡澡消耗幾份液體 */
  bathLiquidCost: 1,

  /** 地板上最多堆幾份掉落原料，滿了就不再掉 */
  dropCap: 5,
  /**
   * 原料掉在離澡盆多遠的地方（世界單位）。
   * 不能是 0：掉在盆心會被盆身擋住看不到，玩家以為沒產出。
   * 這個距離要大於澡盆半徑（scene 端 BASIN.radius = 0.21）。
   */
  dropSpawnRadius: 0.32,

  /** 牛奶窗：最近幾次泡澡納入計算 */
  milkWindow: 5,
  /**
   * 牛奶占比達這個值才推進變白。
   * 用 0.85 而不是計畫寫的 0.8：設計意圖是「完全不給焦糖」才過載，
   * 而 0.8 配 `>=` 會讓「五次裡給了一次焦糖」也算過載，跟意圖相反。
   * 窗內只要出現一次非牛奶，占比就掉到 0.8，變白改為往回退（灌一次焦糖救得回來）。
   */
  milkRatioThreshold: 0.85,
  /** 達標時每次泡澡的變白量；tint ≥ 1 就在下一次落地突變 */
  tintPerBath: 0.25,

  /** 特殊澡盆每泡一次累積多少秒風味曝露 */
  flavorExposurePerBath: 8 * 3600,
  /** 風味突變門檻（遊戲秒） */
  flavorThresholdSec: 48 * 3600,

  /** 加工：幾份原料換一份甜點 */
  ingredientsPerDessert: 2,
  /** 甜點售價＝原料售價 × 此倍率 */
  dessertPriceMult: 3,
  /** 訂單卡出價＝甜點售價 × [min, max] 之間 */
  orderPriceMultMin: 2,
  orderPriceMultMax: 3,

  /** 訂單卡間隔（遊戲秒）與存活時間 */
  orderIntervalMin: 150,
  orderIntervalMax: 300,
  orderTtlSec: 300,
  /** 同時最多幾張訂單卡 */
  orderMaxActive: 3,

  /** 離線結算上限（遊戲秒） */
  offlineCapSec: 8 * 3600,
  /** 離線結算的步長（秒）——太小會在 8 小時上花太久 */
  offlineStepSec: 1,

  /** 補貨合約：庫存低於 restockFloor 就補到 restockTarget */
  restockFloor: 2,
  restockTarget: 6,

  /** 特殊澡盆一次性價格 */
  specialBasinPrice: 480,

  /** 開局 */
  startCoins: 40,
  startStock: { caramel: 4, milk: 2 } as Record<string, number>,
} as const;

export type EquipmentId = 'autoFill' | 'collector' | 'crafter' | 'seller' | 'restock';

export interface EquipmentInfo {
  id: EquipmentId;
  name: string;
  /** 取代哪個手動動作（UI 文案） */
  replaces: string;
  desc: string;
  price: number;
  /** 進程分層 T1–T3 */
  tier: 1 | 2 | 3;
}

/** 定價單位＝一次焦糖泡澡的原料收入（6 元），對齊計畫「約 N 次泡澡的收入」 */
const BATH_INCOME = 6;

export const EQUIPMENT: Record<EquipmentId, EquipmentInfo> = {
  autoFill: { id: 'autoFill', name: '自動注液閥', replaces: '倒澡盆', desc: '澡盆低於一份就自動從庫存補滿', price: 20 * BATH_INCOME, tier: 1 },
  collector: { id: 'collector', name: '原料收集手', replaces: '撿原料', desc: '掉落的原料直接進庫存', price: 20 * BATH_INCOME, tier: 1 },
  crafter: { id: 'crafter', name: '甜點加工機', replaces: '按加工', desc: '原料夠就自動加工成甜點', price: 60 * BATH_INCOME, tier: 2 },
  seller: { id: 'seller', name: '自動販售口', replaces: '按賣', desc: '甜點自動販售，並自動交付訂單卡', price: 60 * BATH_INCOME, tier: 2 },
  restock: { id: 'restock', name: '補貨合約', replaces: '去商店補貨', desc: '焦糖與牛乳庫存見底就自動補貨', price: 150 * BATH_INCOME, tier: 3 },
};

export const EQUIPMENT_IDS = Object.keys(EQUIPMENT) as EquipmentId[];
