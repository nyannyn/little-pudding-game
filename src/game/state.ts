import { ACHIEVEMENT_IDS } from './achievements';
import { createBakery, isLegacyBakery, refundLegacyBatches, restoreBakery, type BakeryState } from './bakery';
import { DESSERT_IDS, PANTRY_IDS, type DessertId, type PantryId } from './recipes';
import { createRegulars, restoreRegulars, type RegularId, type RegularState } from './regulars';
import { BALANCE, EQUIPMENT_IDS, RETIRED_EQUIPMENT_PRICE, type EquipmentId } from './balance';
import { isAllele, normalizeGenes, phenotype, type Genes } from './genetics';
import { xpFromStats } from './level';
import { LIQUID_IDS, SPECIES, SPECIES_IDS, type AlleleId, type LiquidId, type SpeciesId } from './species';
import { clampStar, restoreTable, zeroTable, type Star, type StarStock } from './stock';
import { START_ZONE, defaultZones, type Zone } from './zones';

/**
 * 2（2026-09-21）：加入分區。v1 的存檔沒有 `zone` 欄位，
 * migrate 會把所有布丁／澡盆／掉落物補成起始區，不然它們會從所有查詢裡消失。
 * 3（2026-09-22）：加入基因型（D28）。舊存檔沒有 `genes`，一律補成「該物種的純合」——
 * 補錯方向會讓老玩家的布丁突然變成別的物種，所以不可以拿預設值敷衍。
 * 4（2026-09-22）：加入店長經驗值 `xp`。沒有這欄的存檔用 `stats` 回推（`level.ts`），
 * 老玩家不會被降回 Lv.1。
 * 5（2026-09-22）：生產迴圈改版（D32–D34）。新增「蛋」庫存與掉落物種類、布丁的掉落計時器；
 * 移除 `tint`／`bathHistory`（變白突變整套拿掉）與 `breedReadyAt`（繁殖改由牛奶澡觸發）。
 *
 * **4 有兩個版本**：店長等級與生產迴圈改版在兩條並行的線上各自升到 4，合併時把
 * 生產迴圈那份改成 5。兩邊的欄位補法互不相干（`xp` 回推自 stats、`eggs` 補 0、
 * `genes` 依 species 補純合），所以任一種 v4 存檔讀進來都會被補成完整的 v5。
 * 6（2026-09-22）：設備改成每一區各買各的（D45）。`equipment` 由「設備 → 布林」變成
 * 「分區 → 設備 → 布林」；舊檔的旗標補給**當下所有已解鎖的區**（老玩家已經付過錢，
 * 只補起始區等於默默拔掉他第二區的自動化）。
 * 7（2026-09-23）：家具擺放＋倉庫（D49）。新增 `storedEquipment`（倉庫裡的設備台數）與
 * `equipmentPos`（玩家擺過的設備位置）；收起來的澡盆留在 `basins` 裡、`zone` 改成 `STORAGE_ZONE`
 * （不從陣列刪：`Pudding.basinIndex`／`pour` 事件／液面動畫都以索引為鍵，刪了會全部錯位）。
 * 舊檔補值：倉庫空、位置不補（沒存位置＝用改版前寫死的那組），畫面跟改版前一模一樣。
 * 8（2026-09-23）：甜點工坊＋成就＋賣布丁（D50–D54）。新增 `bakery`（五站、展示架、營業日）、
 * `claimedAchievements`、`speciesSeen` 與九個累計統計。補值方向：
 * ① **工坊時鐘的 epoch＝升級那一刻的 `time`**（不是 0：老玩家的 time 好幾萬秒，會第一天就是 Day 30）；
 * ② 手上的 `desserts` 原樣留著，當工坊的成品櫃；
 * ③ **甜點加工機／自動販售口退役，照原價退款**——各區已安裝＋倉庫裡的台數全算，位置紀錄一併清掉；
 * ④ `speciesSeen` 從目前的住客補（不知道他以前養過什麼，只能保證不少算現在有的）；
 * ⑤ 新統計補 0，舊的 picked／baths／births 照舊——老玩家開檔就領得到那幾條成就，這是對的。
 * 9（2026-09-24）：食譜制全自動流水線（D56–D58）。工坊由五站變七站、新增 `bakery.machines`（機器等級）、
 * 拿掉 `bakery.auto`；新增 `pantry`（麵粉、糯米粉）。補值方向（使用者選「舊存檔一樣要重新買」）：
 * ① **機器全部未購買**（不因為舊版五站免費就送）；② 舊線上做到一半的盤子**退回材料**——打蛋站只扣過蛋只退蛋、
 * 攪拌站以後蛋與原料都退（`bakery.refundLegacyBatches`）；③ 時鐘、展示架、成品櫃、營業紀錄原樣留；
 * ④ `pantry` 補開局那一份。分辨新舊看 `bakery` 有沒有 `machines` 欄，不看 schemaVersion。
 * 10（2026-09-24）：機器 20 級＋店面人氣（D60／D61）。新增 `bakery.fame`、每站 `startedAt`。補值方向：
 * ① 機器等級換算成**每一項都不比舊的差**的新等級（1→1、2→3、3→5，`bakery.V9_MACHINE_LEVEL`）；
 * ② 人氣補 Lv1；③ 站上那一盤補 `startedAt`＝`doneAt`－舊的固定秒數，照原本的 `doneAt` 做完。
 * 分辨新舊看 `bakery` 有沒有 `fame` 欄，不看 schemaVersion。
 * 11（2026-09-25）：星級布丁與常客（D62–D71）。補值方向**不讓舊檔吃虧也不白送**：
 * ① 布丁全部 ★1、照顧點數 0、潛力 ★2（跟開局的布丁一樣）；
 * ② `ingredients`／`desserts`／`shelf` 舊的數字全部放進 ★1（最低估：不會一上線就有高星貨，也不少一份）；
 * ③ 站上那一盤、地上的掉落物補 ★1；④ 區補「量產」；⑤ 名冊補初值，解鎖條件當場判一次
 * （甜點店已開張的舊檔，熊先生直接解鎖）；⑥ 升星藥 0；⑦ 散客訂單原樣保留。
 * 分辨新舊看形狀（數字還是陣列），不看 schemaVersion。
 */
export const SCHEMA_VERSION = 11;

/** 收進倉庫的澡盆的 `zone`。不是任何一個分區，所有「這一區的盆」查詢自然會略過它 */
export const STORAGE_ZONE = 'storage';

/** 布丁在地板上的行為狀態 */
export type PuddingMode = 'hopping' | 'resting' | 'bathing';

export interface Vec2 { x: number; z: number }

export interface Pudding {
  id: string;
  /** 住在哪一區（`zones.ts`） */
  zone: string;
  /**
   * 基因型：兩個等位基因，照 `ALLELES` 的順序正規化（D28）。
   * 這是物種的唯一真相，`species` 只是它的快取。
   */
  genes: Genes;
  /** `phenotype(genes)` 的快取。**只能由 `genetics.applyGenes()` 寫入** */
  species: SpeciesId;
  /** 出生時間（遊戲秒）。只影響頭頂的幼布丁小圖示（D48）；D34 之後繁殖不看成年 */
  bornAt: number;
  /** 0–100，會隨時間下降；低於門檻就想泡澡。D32 之後**不控制產出**，只影響行為與顯示 */
  caramel: number;
  /** 下一次掉原料的遊戲時間（D32：固定間隔掉落，與 caramel 無關） */
  nextDropAt: number;
  /** 對特殊澡盆的累積曝露（遊戲秒） */
  flavorExposure: Partial<Record<SpeciesId, number>>;
  mode: PuddingMode;
  /** 目前位置（啟用層地板的 2D 座標，y 由 scene 層決定） */
  pos: Vec2;
  /** 這一跳的起點與終點 */
  from: Vec2;
  to: Vec2;
  /** 這一跳的進度 0–1 */
  hopT: number;
  /** 落地後還要休息幾秒 */
  restT: number;
  /** 泡澡剩餘秒數 */
  bathT: number;
  /** 正在使用或正要跳進的澡盆索引；null＝沒有 */
  basinIndex: number | null;
  /** 這次泡的是哪種液體（進盆時鎖定；盆子空掉後 liquid 會歸 null，不能事後才讀） */
  bathLiquid: LiquidId | null;
  /** 這一跳落地時要突變成什麼（大彈跳）；null＝不突變 */
  pendingMutation: SpeciesId | null;
  /** 星級 ★1–★5（D62）：掉的原料帶這個星級 */
  star: Star;
  /** 照顧點數：只有住在精養區才會累積，滿 `BALANCE.starCare[star-1]` 升一星並歸零 */
  care: number;
  /** 這隻最高能長到幾星（D63：出生時＝母體星級＋1，上限 5） */
  potential: Star;
}

export interface Basin {
  /** 放在哪一區 */
  zone: string;
  /** 目前裝的液體；null＝空盆（空了才可以換液體） */
  liquid: LiquidId | null;
  /** 剩餘份數 */
  units: number;
  /**
   * 玩家上次倒的是哪一種。units 歸零時 `liquid` 會清成 null（才換得了口味），
   * 但自動注液閥要知道「該補哪一種」，所以另外記一格。
   */
  preferredLiquid: LiquidId | null;
  /** 盆口在地板上的位置 */
  pos: Vec2;
  /** 正在泡澡的布丁 id；一次只容一隻 */
  occupantId: string | null;
}

/** 掉落物種類（D32）：蛋是通用原料，ingredient 是該物種的專屬原料 */
export type DropKind = 'egg' | 'ingredient';

export interface Drop {
  id: string;
  /** 掉在哪一區 */
  zone: string;
  kind: DropKind;
  /** 哪隻布丁掉的（`kind: 'egg'` 時只決定顏色，入庫一律記到 `eggs`） */
  species: SpeciesId;
  pos: Vec2;
  /** 出生時間（遊戲秒），scene 端做彈出動畫用 */
  bornAt: number;
  /** 掉下來那一刻布丁的星級（D64）；蛋沒有星級，一律 1 */
  star: Star;
}

export interface Order {
  id: string;
  species: SpeciesId;
  qty: number;
  /** 成交總價 */
  price: number;
  createdAt: number;
  expiresAt: number;
  /** 常客的特別訂單（D67）才有：哪一位開的、最低星級 */
  regularId?: RegularId;
  star?: Star;
}

export interface GameState {
  schemaVersion: number;
  /** 遊戲時間（秒），從 0 開始累加 */
  time: number;
  /** 最後一次存檔時的真實時間（ms epoch），離線結算用 */
  lastSeenAt: number;
  seed: number;
  rngState: number;
  coins: number;
  /** 店長經驗值，只增不減；等級由 `level.ts` 推導 */
  xp: number;
  /** 液體庫存（份） */
  stock: Record<LiquidId, number>;
  /** 已買下的特殊澡盆液體 */
  ownedBasins: LiquidId[];
  /** 蛋（通用原料，D33） */
  eggs: number;
  /** 基礎材料（麵粉、糯米粉；布丁不會掉，要在補貨頁買，D58） */
  pantry: Record<PantryId, number>;
  /** 物種原料，每一種按星級分格（D64）。**讀寫一律經 `stock.ts`** */
  ingredients: Record<SpeciesId, StarStock>;
  /** 成品櫃的甜點，按星級分格（D64）。**讀寫一律經 `stock.ts`** */
  desserts: Record<DessertId, StarStock>;
  puddings: Pudding[];
  basins: Basin[];
  drops: Drop[];
  orders: Order[];
  /** 全部分區（含未解鎖的），解鎖狀態存在這裡 */
  zones: Zone[];
  /** 玩家目前在看哪一區：鏡頭對著它，HUD 的動作也作用在它身上 */
  activeZone: string;
  /**
   * 每一區各自裝了哪些設備（D45）：外層鍵＝`Zone.id`，每一個已知分區都有一筆（未解鎖的全 false）。
   * 注液閥／收集手只作用在裝了它的那一區；加工機／販售口／補貨合約任一區裝了就全場生效。
   * 讀取走 `equipmentIn()`，不要直接索引——`noUncheckedIndexedAccess` 會在每個呼叫點逼你補 `?.`。
   */
  equipment: Record<string, Record<EquipmentId, boolean>>;
  /** 倉庫裡的設備台數（D49）：全場共用，可以擺到任何一個已解鎖、還沒裝這台的區 */
  storedEquipment: Record<EquipmentId, number>;
  /** 玩家擺過的設備位置（區域座標）；沒有紀錄＝預設位置（`furniture.EQUIPMENT_DEFAULT_POS`） */
  equipmentPos: Record<string, Partial<Record<EquipmentId, Vec2>>>;
  /** 下一張訂單卡的生成時間（遊戲秒） */
  nextOrderAt: number;
  /** 流水號，產生 id 用（不用亂數，存檔重開才不會撞號） */
  nextId: number;
  stats: Stats;
  /** 甜點工坊（D51／D52） */
  bakery: BakeryState;
  /** 已領取的成就 id（D54） */
  claimedAchievements: string[];
  /** 養過的物種（只增不減，成就用；賣掉了也還是「養過」） */
  speciesSeen: SpeciesId[];
  /** 常客名冊（D66） */
  regulars: Record<RegularId, RegularState>;
  /** 道具（D67）：升星藥 */
  items: Items;
}

export interface Items {
  starTonic: number;
}

/**
 * 累計統計：**全部只增不減**（`progressScore` 與成就都靠這個性質）。
 * `crafted` 是 D50 以前農場一鍵加工的次數，改版後不再增加，留著給舊存檔的 xp 回推用。
 */
export interface Stats {
  baths: number;
  sold: number;
  mutations: number;
  picked: number;
  crafted: number;
  births: number;
  /** 工坊出爐的份數 */
  baked: number;
  /** 買到東西的客人數 */
  served: number;
  /** 上門但架上空空的客人數 */
  missed: number;
  /** 打烊結算過幾天 */
  daysClosed: number;
  /** 直接賣給商店的原料／蛋份數 */
  ingredientsSold: number;
  puddingsSold: number;
  ordersDone: number;
  /** 單日最高營收（取最大值，所以也是單調的） */
  bestDayRevenue: number;
  /** 常客買到東西的次數（D71） */
  regularsServed: number;
  /** 布丁升星的次數（照顧升星＋升星藥） */
  starUps: number;
}

export const STAT_KEYS: (keyof Stats)[] = [
  'baths', 'sold', 'mutations', 'picked', 'crafted', 'births',
  'baked', 'served', 'missed', 'daysClosed', 'ingredientsSold', 'puddingsSold', 'ordersDone', 'bestDayRevenue',
  'regularsServed', 'starUps',
];

export function zeroStats(): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = 0;
  return out;
}

function zeroByLiquid(): Record<LiquidId, number> {
  const out = {} as Record<LiquidId, number>;
  for (const id of LIQUID_IDS) out[id] = 0;
  return out;
}

function noEquipment(): Record<EquipmentId, boolean> {
  const out = {} as Record<EquipmentId, boolean>;
  for (const id of EQUIPMENT_IDS) out[id] = false;
  return out;
}

function zeroEquipment(): Record<EquipmentId, number> {
  const out = {} as Record<EquipmentId, number>;
  for (const id of EQUIPMENT_IDS) out[id] = 0;
  return out;
}

function noEquipmentByZone(zones: Zone[]): Record<string, Record<EquipmentId, boolean>> {
  const out: Record<string, Record<EquipmentId, boolean>> = {};
  for (const z of zones) out[z.id] = noEquipment();
  return out;
}

/** 某一區的設備旗標。沒有這一區的紀錄（不該發生）就當作什麼都沒裝，不改 state */
export function equipmentIn(state: GameState, zone: string): Readonly<Record<EquipmentId, boolean>> {
  return state.equipment[zone] ?? noEquipment();
}

/** 任一區裝了這台設備——加工／販售／補貨這三台操作的是全場共用的庫存，看的是這個 */
export function hasEquipmentAnywhere(state: GameState, id: EquipmentId): boolean {
  return Object.values(state.equipment).some((eq) => eq[id]);
}

/** 全場有沒有任何一台設備（教學要不要繼續講的依據）。倉庫裡的也算：收起來不代表沒買過 */
export function hasAnyEquipment(state: GameState): boolean {
  return (
    Object.values(state.equipment).some((eq) => Object.values(eq).some(Boolean)) ||
    Object.values(state.storedEquipment).some((n) => n > 0)
  );
}

export interface NewSaveOptions {
  seed?: number;
  now?: number;
  /** 澡盆位置（地板座標），由 scene 層算好傳進來 */
  basinPos?: Vec2;
  /** 布丁初始位置 */
  puddingPositions?: Vec2[];
  /** 開局住客數（`?pop=` 量 draw call 用）；預設 2，上限＝傳進來的位置數 */
  puddingCount?: number;
}

/**
 * 開新檔。開局刻意「馬上有事做」：
 * 庫存已經有焦糖、第一隻布丁的 caramel 已經低於泡澡門檻，
 * 玩家一進遊戲倒一盆就會看到布丁跳進去，不必先等好幾分鐘。
 */
export function createNewSave(opts: NewSaveOptions = {}): GameState {
  const now = opts.now ?? Date.now();
  const seed = opts.seed ?? (now & 0x7fffffff);
  const basinPos = opts.basinPos ?? { x: 0.62, z: 0.28 };
  const spots = opts.puddingPositions ?? [{ x: -0.45, z: 0.1 }, { x: 0.15, z: -0.22 }];

  const stock = zeroByLiquid();
  for (const [k, v] of Object.entries(BALANCE.startStock)) stock[k as LiquidId] = v;

  const count = Math.max(1, Math.min(spots.length, Math.round(opts.puddingCount ?? 2)));
  const puddings: Pudding[] = spots.slice(0, count).map((pos, i) => ({
    id: `p${i + 1}`,
    zone: START_ZONE,
    genes: ['caramel', 'caramel'] as Genes,
    species: 'caramel' as SpeciesId,
    // 開局的兩隻是成年住客：出生時間往前推一個成年期，否則玩家要先等一分鐘才可能繁殖
    bornAt: -BALANCE.matureAgeSec,
    caramel: i === 0 ? 24 : 58,
    // 開局第一份原料不要讓玩家等滿一個間隔：錯開一點，馬上看得到東西掉下來
    nextDropAt: BALANCE.dropIntervalSec * (0.3 + i * 0.4),
    flavorExposure: {},
    mode: 'resting' as PuddingMode,
    pos: { ...pos },
    from: { ...pos },
    to: { ...pos },
    hopT: 1,
    restT: 0.6 + i * 0.9,
    bathT: 0,
    basinIndex: null,
    bathLiquid: null,
    pendingMutation: null,
    star: 1 as Star,
    care: 0,
    potential: BALANCE.startPotential,
  }));

  const zones = defaultZones();
  return {
    schemaVersion: SCHEMA_VERSION,
    time: 0,
    lastSeenAt: now,
    seed,
    rngState: seed >>> 0,
    coins: BALANCE.startCoins,
    xp: 0,
    stock,
    ownedBasins: [],
    eggs: 0,
    pantry: startPantry(),
    ingredients: zeroTable(SPECIES_IDS),
    desserts: zeroTable(DESSERT_IDS),
    puddings,
    basins: [{ zone: START_ZONE, liquid: null, units: 0, preferredLiquid: null, pos: { ...basinPos }, occupantId: null }],
    zones,
    activeZone: START_ZONE,
    drops: [],
    orders: [],
    equipment: noEquipmentByZone(zones),
    storedEquipment: zeroEquipment(),
    equipmentPos: {},
    nextOrderAt: BALANCE.orderIntervalMin,
    // 開局的住客叫 p1、p2，流水號要從它們之後開始：
    // 從 1 開始的話，解鎖第二區生出來的布丁會叫 p1 撞號，
    // scene 端以 id 為鍵的 view Map 就會綁到錯的那一隻。
    nextId: puddings.length + 1,
    stats: zeroStats(),
    bakery: createBakery(0),
    claimedAchievements: [],
    speciesSeen: ['caramel'],
    regulars: createRegulars(),
    items: { starTonic: 0 },
  };
}

function startPantry(): Record<PantryId, number> {
  const out = {} as Record<PantryId, number>;
  for (const id of PANTRY_IDS) out[id] = BALANCE.startPantry[id] ?? 0;
  return out;
}

/** 這一區在這份 state 裡是不是已解鎖（migrate 內部用，避免循環 import zones.findZone） */
function findZoneUnlocked(s: GameState, id: string): boolean {
  return s.zones.some((z) => z.id === id && z.unlocked);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * 還原基因型（D28）。優先順序：
 * ① 存檔有合法的 `genes` → 用它（正規化後重算 `species`，快取不信任存檔）
 * ② 只有 `species`（v2 以前的存檔）→ 補成該物種的基因型（純種＝純合、混種＝它的兩個等位基因）
 * ③ 兩者都壞 → 焦糖純種
 * 絕不能反過來以存檔的 `species` 為準：那樣「玩家養出來的布丁」會在改版後變成別的物種。
 */
function restoreGenes(src: Partial<Pudding>): { genes: Genes; species: SpeciesId } {
  const raw = src.genes;
  if (Array.isArray(raw) && raw.length === 2 && isAllele(raw[0]) && isAllele(raw[1])) {
    const genes = normalizeGenes(raw[0] as AlleleId, raw[1] as AlleleId);
    return { genes, species: phenotype(genes) };
  }
  const known = SPECIES_IDS.includes(src.species as SpeciesId) ? (src.species as SpeciesId) : 'caramel';
  const [a, b] = SPECIES[known].alleles;
  const genes = normalizeGenes(a, b);
  return { genes, species: phenotype(genes) };
}

/**
 * D71：星級欄位。舊檔沒有 → ★1／0／★2；有就夾進合法範圍。
 * 星級比潛力高（壞存檔）時抬高潛力而不是削星：寧可多給也不要讓玩家的布丁掉星。
 */
function restoreStar(src: Partial<Pudding>): { star: Star; care: number; potential: Star } {
  const star = src.star === undefined ? (1 as Star) : clampStar(src.star);
  const potential = clampStar(Math.max(star, src.potential === undefined ? BALANCE.startPotential : clampStar(src.potential)));
  return { star, care: Math.max(0, num(src.care, 0)), potential };
}

/**
 * 把任意來源的存檔補成目前 schema 的合法 state。
 * 原則：寧可補欄位也不要丟整份存檔——玩家的進度比欄位乾淨重要；
 * 但結構真的認不出來（不是物件、沒有 puddings）就回新檔。
 */
export function migrate(raw: unknown, opts: NewSaveOptions = {}): GameState {
  const base = createNewSave(opts);
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Partial<GameState> & Record<string, unknown>;
  if (!Array.isArray(r.puddings) || r.puddings.length === 0) return base;

  const out: GameState = {
    ...base,
    time: Math.max(0, num(r.time, 0)),
    lastSeenAt: num(r.lastSeenAt, base.lastSeenAt),
    seed: num(r.seed, base.seed),
    rngState: num(r.rngState, base.rngState) >>> 0,
    coins: Math.max(0, num(r.coins, base.coins)),
    nextOrderAt: num(r.nextOrderAt, base.nextOrderAt),
    nextId: Math.max(1, num(r.nextId, base.nextId)),
  };

  const rawStock = r.stock as Record<string, unknown> | undefined;
  for (const id of LIQUID_IDS) out.stock[id] = Math.max(0, num(rawStock?.[id], 0));
  out.eggs = Math.max(0, num(r.eggs, 0));
  // 基礎材料（D58）：v8 以前沒有這欄 → 補開局那一份（跟新玩家一樣）
  const rawPantry = r.pantry as Record<string, unknown> | undefined;
  for (const id of PANTRY_IDS) out.pantry[id] = rawPantry ? Math.max(0, num(rawPantry[id], 0)) : out.pantry[id];
  // D71：舊的數字全部放進 ★1、新的陣列逐星還原（`stock.restoreTable`）
  out.ingredients = restoreTable(r.ingredients, SPECIES_IDS);
  out.desserts = restoreTable(r.desserts, DESSERT_IDS);
  out.regulars = restoreRegulars(r.regulars);
  out.ownedBasins = Array.isArray(r.ownedBasins)
    ? (r.ownedBasins.filter((x) => LIQUID_IDS.includes(x as LiquidId)) as LiquidId[])
    : [];

  // 分區：v1 存檔沒有這欄，補成起始區——不補的話這些布丁不屬於任何一區，
  // 所有以 zone 過濾的查詢都會漏掉它們，玩家的住客會憑空消失。
  const knownZones = new Set(base.zones.map((z) => z.id));
  const zoneOf = (v: unknown): string => (typeof v === 'string' && knownZones.has(v) ? v : START_ZONE);
  if (Array.isArray(r.zones)) {
    for (const z of out.zones) {
      const src = (r.zones as Partial<Zone>[]).find((x) => x?.id === z.id);
      if (src?.unlocked === true) z.unlocked = true;
      // D62：v10 以前沒有模式 → 量產（改版前每一區都是量產的行為）
      z.mode = src?.mode === 'elite' ? 'elite' : 'mass';
    }
  }
  out.activeZone = zoneOf(r.activeZone);
  if (!(findZoneUnlocked(out, out.activeZone))) out.activeZone = START_ZONE;

  // 設備（D45）：v6 起每一區各一份。v5 以前是全場一份布林表，補給**當下所有已解鎖的區**——
  // 老玩家在舊規則下付過一次錢就全場生效，只補起始區會把他第二區的自動化默默拔掉。
  // 兩種形狀用「值是不是布林」分辨而不是看 schemaVersion：存檔碼可能被人手改過版本號。
  const rawEq = (r.equipment ?? {}) as Record<string, unknown>;
  const legacyFlat = EQUIPMENT_IDS.some((id) => typeof rawEq[id] === 'boolean');

  // D50：甜點加工機與自動販售口退役，照原價退款。台數＝各已知分區裝了幾台＋倉庫裡幾台；
  // 舊的扁平形狀（v5 以前）在舊規則下是「付一次錢全場生效」，所以只退一台。
  const rawStoredAll = (r.storedEquipment ?? {}) as Record<string, unknown>;
  for (const [id, price] of Object.entries(RETIRED_EQUIPMENT_PRICE)) {
    let n = legacyFlat
      ? (rawEq[id] === true ? 1 : 0)
      : out.zones.filter((z) => (rawEq[z.id] as Record<string, unknown> | undefined)?.[id] === true).length;
    n += Math.max(0, Math.floor(num(rawStoredAll[id], 0)));
    out.coins += n * price;
  }
  out.equipment = noEquipmentByZone(out.zones);
  for (const z of out.zones) {
    const src = legacyFlat ? (z.unlocked ? rawEq : undefined) : (rawEq[z.id] as Record<string, unknown> | undefined);
    const eq = out.equipment[z.id]!;
    for (const id of EQUIPMENT_IDS) eq[id] = src?.[id] === true;
  }

  // 倉庫與家具位置（D49）：v6 以前沒有，倉庫補空、位置不補（＝預設位置，畫面不變）
  const rawStored = (r.storedEquipment ?? {}) as Record<string, unknown>;
  out.storedEquipment = zeroEquipment();
  for (const id of EQUIPMENT_IDS) out.storedEquipment[id] = Math.max(0, Math.floor(num(rawStored[id], 0)));
  out.equipmentPos = {};
  const rawPos = (r.equipmentPos ?? {}) as Record<string, unknown>;
  for (const z of out.zones) {
    const src = rawPos[z.id] as Record<string, Partial<Vec2> | undefined> | undefined;
    if (!src || typeof src !== 'object') continue;
    for (const id of EQUIPMENT_IDS) {
      const v = src[id];
      // 只收已安裝的：沒裝的設備留著位置，下次擺出來會用到一個可能已經被別的家具佔住的位置
      if (!out.equipment[z.id]![id] || !v) continue;
      if (typeof v.x !== 'number' || typeof v.z !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.z)) continue;
      (out.equipmentPos[z.id] ??= {})[id] = { x: v.x, z: v.z };
    }
  }

  out.puddings = r.puddings.map((p, i) => {
    const src = (p ?? {}) as Partial<Pudding>;
    const tpl = base.puddings[Math.min(i, base.puddings.length - 1)] as Pudding;
    const pos = { x: num(src.pos?.x, tpl.pos.x), z: num(src.pos?.z, tpl.pos.z) };
    return {
      id: typeof src.id === 'string' ? src.id : `p${i + 1}`,
      zone: zoneOf(src.zone),
      ...restoreGenes(src),
      // 舊檔沒有這欄：當成早就長大（不要讓老玩家的布丁全部退回幼體）
      bornAt: num(src.bornAt, Math.min(0, -BALANCE.matureAgeSec)),
      caramel: Math.min(100, Math.max(0, num(src.caramel, 100))),
      // 舊存檔沒有這欄：從讀檔當下起算一個間隔，不要一載入就噴一堆原料
      nextDropAt: num(src.nextDropAt, 0) > 0 ? num(src.nextDropAt, 0) : Math.max(0, num(r.time, 0)) + BALANCE.dropIntervalSec,
      flavorExposure:
        typeof src.flavorExposure === 'object' && src.flavorExposure !== null ? { ...src.flavorExposure } : {},
      // 存檔可能正卡在 bathing；還原成 resting 讓模擬重新決策，比還原一半的狀態安全
      mode: 'resting' as PuddingMode,
      pos,
      from: { ...pos },
      to: { ...pos },
      hopT: 1,
      restT: Math.max(0, num(src.restT, 0.5)),
      bathT: 0,
      basinIndex: null,
      bathLiquid: null,
      pendingMutation: SPECIES_IDS.includes(src.pendingMutation as SpeciesId)
        ? (src.pendingMutation as SpeciesId)
        : null,
      // D71：舊布丁全部 ★1、潛力 ★2（跟開局的布丁一樣，不白送也不吃虧）
      ...restoreStar(src),
    };
  });

  if (Array.isArray(r.basins) && r.basins.length > 0) {
    const tpl = base.basins[0] as Basin;
    out.basins = r.basins.map((b, i) => {
      const src = (b ?? {}) as Partial<Basin>;
      return {
        // 倉庫裡的盆要留在倉庫：`zoneOf` 會把不認得的區補成起始區，那等於讀檔就把盆擺回去
        zone: src.zone === STORAGE_ZONE ? STORAGE_ZONE : zoneOf(src.zone),
        liquid: LIQUID_IDS.includes(src.liquid as LiquidId) ? (src.liquid as LiquidId) : null,
        units: Math.max(0, Math.min(BALANCE.basinCapacity, num(src.units, 0))),
        preferredLiquid: LIQUID_IDS.includes(src.preferredLiquid as LiquidId) ? (src.preferredLiquid as LiquidId) : null,
        pos: { x: num(src.pos?.x, tpl.pos.x + i * 0.4), z: num(src.pos?.z, tpl.pos.z) },
        occupantId: null, // 佔用關係由第一個 tick 重新建立
      };
    });
  }

  out.drops = Array.isArray(r.drops)
    ? r.drops.slice(0, BALANCE.dropCap).map((d, i) => {
        const src = (d ?? {}) as Partial<Drop>;
        return {
          id: typeof src.id === 'string' ? src.id : `d${i + 1}`,
          zone: zoneOf(src.zone),
          // 舊存檔的掉落物都是物種原料（那時還沒有蛋）
          kind: src.kind === 'egg' ? ('egg' as const) : ('ingredient' as const),
          species: SPECIES_IDS.includes(src.species as SpeciesId) ? (src.species as SpeciesId) : 'caramel',
          pos: { x: num(src.pos?.x, 0), z: num(src.pos?.z, 0) },
          bornAt: num(src.bornAt, out.time),
          // 漏補這欄，撿起來的原料會落到 `undefined` 星（AC11-10 的負向對照）
          star: clampStar(src.star),
        };
      })
    : [];

  out.orders = Array.isArray(r.orders)
    ? r.orders.flatMap((o) => {
        const src = (o ?? {}) as Partial<Order>;
        if (!SPECIES_IDS.includes(src.species as SpeciesId)) return [];
        return [{
          id: typeof src.id === 'string' ? src.id : `o${out.nextId++}`,
          species: src.species as SpeciesId,
          qty: Math.max(1, Math.round(num(src.qty, 1))),
          price: Math.max(0, Math.round(num(src.price, 0))),
          createdAt: num(src.createdAt, out.time),
          expiresAt: num(src.expiresAt, out.time + BALANCE.orderTtlSec),
          ...(typeof src.regularId === 'string' && src.regularId in out.regulars
            ? { regularId: src.regularId, star: clampStar(src.star) }
            : {}),
        }];
      })
    : [];

  const st = (r.stats ?? {}) as Record<string, unknown>;
  out.stats = zeroStats();
  for (const k of STAT_KEYS) out.stats[k] = Math.max(0, num(st[k], 0));

  // 工坊（D51）：沒有這欄就以「現在」當第 1 天 07:00
  out.bakery = restoreBakery(r.bakery, out.time);
  // v8 五站線上做到一半的盤子退回材料（D57）；機器由 restoreBakery 歸零
  if (isLegacyBakery(r.bakery)) refundLegacyBatches(r.bakery, out);
  out.claimedAchievements = Array.isArray(r.claimedAchievements)
    ? [...new Set(r.claimedAchievements.filter((x): x is string => typeof x === 'string' && ACHIEVEMENT_IDS.includes(x)))]
    : [];
  const seen = new Set<SpeciesId>();
  if (Array.isArray(r.speciesSeen)) for (const x of r.speciesSeen) if (SPECIES_IDS.includes(x as SpeciesId)) seen.add(x as SpeciesId);
  for (const p of out.puddings) seen.add(p.species);
  out.speciesSeen = [...seen];
  // v2 以前沒有 xp：用累計統計回推，不然老玩家開檔會被降回 Lv.1、商店整片鎖住
  out.xp = Math.max(0, num(r.xp, xpFromStats(out.stats)));

  // 常客（D66／D71）：沒有這欄 → 名冊初值（上面還原訂單前就讀了）；解鎖條件由 `sim` 的每個 tick 判
  // （`regulars.checkUnlocks`），甜點店已開張的舊檔熊先生因此一開檔就解鎖，其他照條件
  const rawItems = (r.items ?? {}) as Record<string, unknown>;
  out.items = { starTonic: Math.max(0, Math.floor(num(rawItems.starTonic, 0))) };

  // 舊存檔的 nextId 可能落後於實際用掉的號碼（或根本沒有這欄），
  // 不推到最大值之後，接下來生成的 id 會跟既有的撞號
  const used = [...out.puddings, ...out.drops, ...out.orders]
    .map((x) => Number(/(\d+)$/.exec(x.id)?.[1] ?? 0))
    .filter((n) => Number.isFinite(n));
  out.nextId = Math.max(out.nextId, ...used, 0) + 1;

  out.schemaVersion = SCHEMA_VERSION;
  return out;
}
