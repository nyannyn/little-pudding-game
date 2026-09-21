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
 *
 * 2026-09-21 第二次調整（D24「前期要快速有成就感」）：
 * - 一輪泡澡約 65 秒（衰減 1.4/秒、泡澡 12 秒），液體單價 4→2、甜點倍率 3→4：
 *   一次泡澡做成甜點的淨收入從 5 元變 10 元（＝BATH_INCOME）。
 * - 設備與分區價格全部以 BATH_INCOME 重新定：收集手 6 次、注液閥 8 次、加工機 12 次、
 *   販售口 18 次、補貨合約 40 次；上層 20 次、下層 50 次、二號櫥窗 120 次。
 * - 量表：`npm run pacing`。改前第一台設備 12 分鐘、上層 3 小時內達不到；
 *   改後收集手 1.7 分、注液閥 4–6 分、上層 16–21 分、二號櫥窗 55–66 分（勤勞玩家）。
 */
export const BALANCE = {
  /** 每秒掉多少 caramel */
  caramelDecayPerSec: 1.4,
  /** 低於這個值就想去泡澡 */
  batheThreshold: 30,
  /** 泡一次澡幾秒 */
  bathDurationSec: 12,

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
  dessertPriceMult: 4,
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

  /**
   * 商店一次買幾份。兩隻布丁一分鐘用掉約 2 份（D24 節奏），5 份只撐兩分半，
   * 玩家會一直被叫回商店；10 份（20 元）約撐五分鐘。
   */
  stockBuyQty: 10,
  /**
   * 大桶裝：一次買 stockBulkQty 份、打 stockBulkDiscount 折扣，店長 Lv.stockBulkLevel 起才上架。
   * 只有焦糖與牛乳有大桶裝（跟補貨合約的範圍一致）；折扣是「等級到了的獎勵」，不是必需品。
   */
  stockBulkQty: 30,
  stockBulkDiscount: 0.1,
  stockBulkLevel: 4,
  /** 補貨合約：庫存低於 restockFloor 就補到 restockTarget */
  restockFloor: 4,
  restockTarget: 20,

  /** 特殊澡盆一次性價格 */
  specialBasinPrice: 300,
  /** 特殊澡盆的上架等級：抹茶先、草莓後，兩條風味線不要同時開 */
  specialBasinLevel: { matcha: 3, strawberry: 5 } as Record<string, number>,

  /**
   * 店長等級（D25，2026-09-22）。經驗值是真的存檔欄位（`GameState.xp`），
   * 由生產動作累積；商店商品各自有上架等級，門檻由 `levelFor()` 查這張表。
   * `levelXp[i]` ＝ 升到 Lv.(i+1) 所需的累積 xp；Lv.1 從 0 起，表長＝等級上限。
   * 數字用 `npm run pacing` 對過：目標是每件商品「上架」略早於「買得起」，
   * 等級是進度感不是第二道錢關。
   */
  levelXp: [0, 30, 80, 150, 260, 420, 650, 950, 1350, 1900],
  /** 各動作給多少 xp（自動化做的也算——生產就是生產，不然裝了設備等級就停了） */
  xp: { bath: 2, pick: 1, craft: 3, sellDessert: 2, sellIngredient: 1, order: 10, mutate: 40, birth: 30 },

  // ── 繁殖與配種（D28–D30，2026-09-22）───────────────
  /**
   * 每一區最多住幾隻。滿了就停止繁殖——這就是「去解鎖下一區」的動力。
   *
   * **這個數字直接換算成 draw calls**（2026-09-22 實測 `?pop=N`，iPhone 14 視口）：
   * 無布丁 13，每多一隻剛好 +5（1 隻 18／2 隻 23／3 隻 28／4 隻 33／5 隻 38），
   * 預算 35、最壞情況（掉落物＋粒子＋設備）另加約 5。
   * 上限 2 等於繁殖永遠不會發生（開局就滿員），所以下限是 3；
   * 但 3 隻同框會超出效能預算，要真的塞得下得先做「body／caramel／blush 併成
   * vertex color 單一 mesh」那筆美術優化（每隻省 2 個 draw call）。
   */
  zoneCapacity: 3,
  /** 出生後幾秒才算成年、可以繁殖 */
  matureAgeSec: 60,
  /** 雙親各自要有這麼多焦糖才願意繁殖（牛奶澡泡完是 60，門檻不能高過它） */
  breedCaramelMin: 55,
  /** 繁殖一次雙親各扣多少焦糖（扣完低於泡澡門檻 → 自己跳回澡盆，接回既有迴圈） */
  breedCaramelCost: 35,
  /** 繁殖後多久才能再繁殖（遊戲秒） */
  breedCooldownSec: 90,
  /** 新生布丁的起始焦糖 */
  newbornCaramel: 70,
  /** 配子被環境改寫的機率（D30） */
  gameteShiftChance: 0.35,
  /** 風味曝露達「突變門檻 × 此比例」就開始影響配子 */
  gameteShiftExposureRatio: 0.5,
  /** 變白程度達此值就開始把配子推向鮮奶酪 */
  gameteShiftTintRatio: 0.5,

  /** 開局 */
  startCoins: 30,
  startStock: { caramel: 6, milk: 2 } as Record<string, number>,
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
  /** 店長幾級才上架（`BALANCE.levelXp`） */
  level: number;
}

/** 定價單位＝一次焦糖泡澡做成甜點的淨收入（12 − 2 液體 ＝ 10 元），對齊計畫「約 N 次泡澡的收入」 */
const BATH_INCOME = 10;

export const EQUIPMENT: Record<EquipmentId, EquipmentInfo> = {
  autoFill: { id: 'autoFill', name: '自動注液閥', replaces: '倒澡盆', desc: '澡盆低於一份就自動從庫存補滿', price: 8 * BATH_INCOME, tier: 1, level: 1 },
  collector: { id: 'collector', name: '原料收集手', replaces: '撿原料', desc: '掉落的原料直接進庫存', price: 6 * BATH_INCOME, tier: 1, level: 1 },
  crafter: { id: 'crafter', name: '甜點加工機', replaces: '按加工', desc: '原料夠就自動加工成甜點', price: 12 * BATH_INCOME, tier: 2, level: 2 },
  seller: { id: 'seller', name: '自動販售口', replaces: '按賣', desc: '自動賣甜點、自動交訂單', price: 18 * BATH_INCOME, tier: 2, level: 3 },
  restock: { id: 'restock', name: '補貨合約', replaces: '去商店補貨', desc: '焦糖與牛乳庫存見底就自動補貨', price: 40 * BATH_INCOME, tier: 3, level: 6 },
};

export const EQUIPMENT_IDS = Object.keys(EQUIPMENT) as EquipmentId[];
