import { BALANCE } from './balance';
import { pick, type Rng } from './rng';
import {
  ALLELES,
  GENOTYPE_TO_SPECIES,
  SPECIES,
  genotypeKey,
  type AlleleId,
  type SpeciesId,
} from './species';
import type { Pudding } from './state';

/**
 * 配種機制（D28／D30）。
 *
 * 每隻布丁帶兩個等位基因，`species` 只是 `phenotype(genes)` 的快取：
 * **唯一的寫入點是 `applyGenes()`**，出生、突變、migrate 都走它。
 * 若哪天有人只改 `species` 不改 `genes`，那隻布丁看起來是鮮奶酪、
 * 傳給子代的卻還是焦糖等位基因——玩家只會讀成 bug，所以不變式
 * `species === phenotype(genes)` 由單元測試守著。
 *
 * 這一層不 import three.js、也不碰 scene：規則全在 `game/`（分層鐵則）。
 */

export type Genes = [AlleleId, AlleleId];

export function isAllele(v: unknown): v is AlleleId {
  return typeof v === 'string' && (ALLELES as string[]).includes(v);
}

/** 正規化：照 `ALLELES` 的順序排，`[a,b]` 與 `[b,a]` 是同一個基因型 */
export function normalizeGenes(a: AlleleId, b: AlleleId): Genes {
  return ALLELES.indexOf(a) <= ALLELES.indexOf(b) ? [a, b] : [b, a];
}

/** 基因型 → 看得到的物種。純合＝該純種，異合＝該組合專屬的混種 */
export function phenotype(genes: Genes): SpeciesId {
  const id = GENOTYPE_TO_SPECIES[genotypeKey(genes[0], genes[1])];
  // 查不到就退回第一個等位基因的純種。配種表由 SPECIES 反推、且有完整性測試守著，
  // 正常情況不會走到這裡；但壞存檔補進來的怪組合不該讓整個遊戲當掉。
  return id ?? genes[0];
}

/** 物種 → 它的基因型（純種是兩份同樣的等位基因，混種是它的兩個親代風味） */
export function genesOf(species: SpeciesId): Genes {
  const [a, b] = SPECIES[species].alleles;
  return normalizeGenes(a, b);
}

/** 改基因的唯一入口：同時把 `species` 快取寫成一致的值 */
export function applyGenes(p: Pudding, a: AlleleId, b: AlleleId): void {
  p.genes = normalizeGenes(a, b);
  p.species = phenotype(p.genes);
}

/** 突變（牛奶過載／風味曝露）：整隻換成該物種的**純合**基因型，表面行為與 D28 之前一樣 */
export function applySpeciesAsPure(p: Pudding, species: SpeciesId): void {
  const [a, b] = genesOf(species);
  applyGenes(p, a, b);
}

/**
 * 這個親代「泡澡泡到快要突變」的那個風味；沒有就回 null。
 * 門檻取正式突變門檻的一半——玩家倒了幾次特殊澡盆就先影響下一代，
 * 不必等到親代自己突變完成（D30）。
 */
export function environmentBias(p: Pudding): AlleleId | null {
  for (const key of ALLELES) {
    const exposure = p.flavorExposure[key] ?? 0;
    if (exposure >= BALANCE.flavorThresholdSec * BALANCE.gameteShiftExposureRatio) return key;
  }
  // 變白＝牛奶過載那條線，對應鮮奶酪
  if (p.tint >= BALANCE.gameteShiftTintRatio) return 'panna';
  return null;
}

/**
 * 送出一個配子：隨機取自己的一個等位基因；若正泡著某種風味的澡（環境偏向），
 * 有 `gameteShiftChance` 的機率改送那個風味。
 */
export function gamete(p: Pudding, rng: Rng): AlleleId {
  const own = pick(rng, p.genes) as AlleleId;
  const bias = environmentBias(p);
  if (bias && bias !== own && rng.next() < BALANCE.gameteShiftChance) return bias;
  return own;
}

/** 雙親各出一個配子 → 子代基因型 */
export function cross(a: Pudding, b: Pudding, rng: Rng): Genes {
  return normalizeGenes(gamete(a, rng), gamete(b, rng));
}
