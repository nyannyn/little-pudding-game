import { BALANCE, EQUIPMENT_IDS, type EquipmentId } from './balance';
import { LIQUID_IDS, SPECIES_IDS, type LiquidId, type SpeciesId } from './species';

export const SCHEMA_VERSION = 1;

/** 布丁在地板上的行為狀態 */
export type PuddingMode = 'hopping' | 'resting' | 'bathing';

export interface Vec2 { x: number; z: number }

export interface Pudding {
  id: string;
  species: SpeciesId;
  /** 0–100，會隨時間下降；低於門檻就想泡澡 */
  caramel: number;
  /** 最近幾次泡澡用的液體（滑動窗，長度上限 BALANCE.milkWindow） */
  bathHistory: LiquidId[];
  /** 0–1 變白程度；1 就在下一次落地突變成鮮奶酪 */
  tint: number;
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
}

export interface Basin {
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

export interface Drop {
  id: string;
  /** 掉的是哪個物種的原料 */
  species: SpeciesId;
  pos: Vec2;
  /** 出生時間（遊戲秒），scene 端做彈出動畫用 */
  bornAt: number;
}

export interface Order {
  id: string;
  species: SpeciesId;
  qty: number;
  /** 成交總價 */
  price: number;
  createdAt: number;
  expiresAt: number;
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
  /** 液體庫存（份） */
  stock: Record<LiquidId, number>;
  /** 已買下的特殊澡盆液體 */
  ownedBasins: LiquidId[];
  ingredients: Record<SpeciesId, number>;
  desserts: Record<SpeciesId, number>;
  puddings: Pudding[];
  basins: Basin[];
  drops: Drop[];
  orders: Order[];
  equipment: Record<EquipmentId, boolean>;
  /** 下一張訂單卡的生成時間（遊戲秒） */
  nextOrderAt: number;
  /** 流水號，產生 id 用（不用亂數，存檔重開才不會撞號） */
  nextId: number;
  stats: { baths: number; sold: number; mutations: number; picked: number; crafted: number };
}

function zeroBySpecies(): Record<SpeciesId, number> {
  const out = {} as Record<SpeciesId, number>;
  for (const id of SPECIES_IDS) out[id] = 0;
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

export interface NewSaveOptions {
  seed?: number;
  now?: number;
  /** 澡盆位置（地板座標），由 scene 層算好傳進來 */
  basinPos?: Vec2;
  /** 布丁初始位置 */
  puddingPositions?: Vec2[];
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

  const puddings: Pudding[] = spots.slice(0, 2).map((pos, i) => ({
    id: `p${i + 1}`,
    species: 'caramel' as SpeciesId,
    caramel: i === 0 ? 24 : 58,
    bathHistory: [],
    tint: 0,
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
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    time: 0,
    lastSeenAt: now,
    seed,
    rngState: seed >>> 0,
    coins: BALANCE.startCoins,
    stock,
    ownedBasins: [],
    ingredients: zeroBySpecies(),
    desserts: zeroBySpecies(),
    puddings,
    basins: [{ liquid: null, units: 0, preferredLiquid: null, pos: { ...basinPos }, occupantId: null }],
    drops: [],
    orders: [],
    equipment: noEquipment(),
    nextOrderAt: BALANCE.orderIntervalMin,
    nextId: 1,
    stats: { baths: 0, sold: 0, mutations: 0, picked: 0, crafted: 0 },
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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
  const rawIng = r.ingredients as Record<string, unknown> | undefined;
  const rawDes = r.desserts as Record<string, unknown> | undefined;
  for (const id of SPECIES_IDS) {
    out.ingredients[id] = Math.max(0, num(rawIng?.[id], 0));
    out.desserts[id] = Math.max(0, num(rawDes?.[id], 0));
  }
  const rawEq = r.equipment as Record<string, unknown> | undefined;
  for (const id of EQUIPMENT_IDS) out.equipment[id] = rawEq?.[id] === true;
  out.ownedBasins = Array.isArray(r.ownedBasins)
    ? (r.ownedBasins.filter((x) => LIQUID_IDS.includes(x as LiquidId)) as LiquidId[])
    : [];

  out.puddings = r.puddings.map((p, i) => {
    const src = (p ?? {}) as Partial<Pudding>;
    const tpl = base.puddings[Math.min(i, base.puddings.length - 1)] as Pudding;
    const pos = { x: num(src.pos?.x, tpl.pos.x), z: num(src.pos?.z, tpl.pos.z) };
    return {
      id: typeof src.id === 'string' ? src.id : `p${i + 1}`,
      species: SPECIES_IDS.includes(src.species as SpeciesId) ? (src.species as SpeciesId) : 'caramel',
      caramel: Math.min(100, Math.max(0, num(src.caramel, 100))),
      bathHistory: Array.isArray(src.bathHistory)
        ? (src.bathHistory.filter((x) => LIQUID_IDS.includes(x as LiquidId)) as LiquidId[]).slice(-BALANCE.milkWindow)
        : [],
      tint: Math.min(1, Math.max(0, num(src.tint, 0))),
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
    };
  });

  if (Array.isArray(r.basins) && r.basins.length > 0) {
    const tpl = base.basins[0] as Basin;
    out.basins = r.basins.map((b, i) => {
      const src = (b ?? {}) as Partial<Basin>;
      return {
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
          species: SPECIES_IDS.includes(src.species as SpeciesId) ? (src.species as SpeciesId) : 'caramel',
          pos: { x: num(src.pos?.x, 0), z: num(src.pos?.z, 0) },
          bornAt: num(src.bornAt, out.time),
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
        }];
      })
    : [];

  const st = (r.stats ?? {}) as Record<string, unknown>;
  out.stats = {
    baths: Math.max(0, num(st.baths, 0)),
    sold: Math.max(0, num(st.sold, 0)),
    mutations: Math.max(0, num(st.mutations, 0)),
    picked: Math.max(0, num(st.picked, 0)),
    crafted: Math.max(0, num(st.crafted, 0)),
  };

  out.schemaVersion = SCHEMA_VERSION;
  return out;
}
