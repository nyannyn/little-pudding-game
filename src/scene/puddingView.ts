import * as THREE from 'three';
import { BALANCE } from '../game/balance';
import type { PuddingMood } from '../game/pudding';
import type { Pudding } from '../game/state';
import { SPECIES } from '../game/species';
import type { PuddingPart, PuddingParts } from './puddingPool';

const PUDDING_MODEL_WIDTH = 1.0; // build_pudding.py 回報的出廠 bbox 寬
export const PUDDING_WIDTH = 0.2; // 使用者定案

// 落地形變的比例（WP2 在 Blender 端實測過的那一組，見 STATE「Q 感需求已驗」）。
// Blender 是 Z-up 記成 (1.20, 1.20, 0.70)，three.js 是 Y-up，所以垂直分量換到 y。
const SQUASH = new THREE.Vector3(1.2, 0.7, 1.2);
const STRETCH = new THREE.Vector3(0.86, 1.3, 0.86);
const SQUASH_SEC = 0.22;
// 想泡澡的「沒精神」姿態（D48）：身體微塌、眼睛半垂。幅度刻意小——這是風味，
// 讀狀態靠的是頭頂小圖示；塌太多會跟落地壓扁（SQUASH）混在一起。
const SLUMP = new THREE.Vector3(1.06, 0.9, 1.06);
const EYE_BATH = 0.22; // 泡澡：閉眼
const EYE_TIRED = 0.55; // 想泡澡：半垂

/** GLB 節點的局部變換照抄到一個空節點上（沒有 mesh，不吃 draw call） */
function skeletonNode(name: string, part: PuddingPart): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.copy(part.position);
  o.quaternion.copy(part.quaternion);
  o.scale.copy(part.scale);
  return o;
}

/**
 * 一隻布丁的演出。只讀 `Pudding` 狀態，不改任何規則——
 * 「跳去哪」是 game/ 決定的，這裡只負責把 A→B 演成拋物線＋落地壓扁。
 *
 * 這個物件本身**沒有 mesh**（D41）：`root` 底下只有兩個空節點 `Pudding_Body`／`Pudding_Eyes`
 * 當骨架，位置、縮放、面向、閉眼全都擺在這副骨架上；每幀由 `PuddingPool` 把兩個節點的
 * world matrix 抄進共用的 InstancedMesh。骨架照舊掛在 scene 裡，所以量測（e2e 的投影位置、
 * 眼睛比值）還是從 scene graph 讀得到。
 */
export class PuddingView {
  readonly root: THREE.Group;
  readonly bodyNode: THREE.Object3D;
  readonly eyesNode: THREE.Object3D;
  /** 這隻現在畫的物種顏色（instance 屬性的來源） */
  readonly bodyColor = new THREE.Color();
  readonly toppingColor = new THREE.Color();
  /**
   * 眼睛節點在 GLB 裡的原始 y 縮放（實測 0.1387，等比縮放的一部分）。
   * 閉眼要「乘上一個係數」，不是「把 scale.y 設成絕對值」——
   * 直接設 1 會把眼睛拉高 7.2 倍（使用者回報「眼睛被拉長、澡盆裡才正常」，
   * 因為泡澡時設的 0.12 剛好接近原始值，反而看起來對）。
   */
  private readonly eyeBaseY: number;
  private readonly baseScale: number;
  private squashT = 0;
  private wasAirborne = false;
  private shownSpecies: Pudding['species'];
  private bob = 0;
  /** 0＝正常、1＝整個塌下去；朝目標慢慢靠，才不會一跳一跳地切換 */
  private slump = 0;

  constructor(parts: PuddingParts, p: Pudding) {
    this.root = new THREE.Group();
    this.root.name = 'Pudding';
    this.baseScale = PUDDING_WIDTH / PUDDING_MODEL_WIDTH;
    this.root.scale.setScalar(this.baseScale);

    this.bodyNode = skeletonNode('Pudding_Body', parts.body);
    this.eyesNode = skeletonNode('Pudding_Eyes', parts.eyes);
    this.root.add(this.bodyNode, this.eyesNode);
    this.eyeBaseY = this.eyesNode.scale.y;

    this.shownSpecies = p.species;
    this.applySpecies(p.species);
  }

  private applySpecies(id: Pudding['species']) {
    const info = SPECIES[id];
    this.bodyColor.setHex(info.bodyColor);
    this.toppingColor.setHex(info.toppingColor);
    this.shownSpecies = id;
  }

  /** 突變瞬間的縮放脈衝，由外部在收到 mutate 事件時呼叫 */
  pulse() {
    this.squashT = SQUASH_SEC * 1.6;
  }

  /**
   * @param floorY  啟用層地板的世界高度
   * @param basinY  泡澡時身體要沉到多低（相對地板）
   * @param mood    `puddingMood()` 的結果；規則在 game/，這裡只負責演
   */
  update(p: Pudding, dt: number, ox: number, floorY: number, basinSink: number, mood: PuddingMood) {
    if (p.species !== this.shownSpecies) this.applySpecies(p.species);

    const bathing = p.mode === 'bathing';
    const airborne = p.mode === 'hopping';

    // 落地：從空中轉成不在空中的那一幀，開始壓扁計時
    if (this.wasAirborne && !airborne) this.squashT = SQUASH_SEC;
    this.wasAirborne = airborne;
    if (this.squashT > 0) this.squashT = Math.max(0, this.squashT - dt);

    let x = ox + p.pos.x, z = p.pos.z, y = floorY;
    if (airborne) {
      // 大彈跳（突變那一跳）跳得比平常高，看得出來「要發生什麼事」
      const h = BALANCE.hopHeight * (p.pendingMutation ? 2.6 : 1);
      y += Math.sin(Math.PI * Math.min(1, Math.max(0, p.hopT))) * h;
    }
    if (bathing) {
      this.bob += dt;
      y = floorY - basinSink + Math.sin(this.bob * 1.8) * 0.006;
    }
    this.root.position.set(x, y, z);

    // squash & stretch：落地壓扁→回彈拉長→回正
    const k = this.squashT / SQUASH_SEC;
    const s = this.root.scale;
    if (k > 0) {
      const phase = k > 0.5 ? (k - 0.5) * 2 : k * 2; // 前半壓扁、後半拉長
      const target = k > 0.5 ? SQUASH : STRETCH;
      const amt = k > 0.5 ? phase : 1 - phase;
      s.set(
        this.baseScale * (1 + (target.x - 1) * amt),
        this.baseScale * (1 + (target.y - 1) * amt),
        this.baseScale * (1 + (target.z - 1) * amt),
      );
    } else if (airborne) {
      // 空中稍微拉長，讀起來比較 Q
      s.set(this.baseScale * 0.94, this.baseScale * 1.12, this.baseScale * 0.94);
    } else {
      s.setScalar(this.baseScale);
    }
    // 沒精神的塌陷只疊在地上休息時；空中與落地形變自己有一套，疊上去會變形得很怪
    const slumpTarget = mood === 'wantsBath' && !airborne ? 1 : 0;
    this.slump += (slumpTarget - this.slump) * Math.min(1, dt * 4);
    if (k === 0 && !airborne && this.slump > 1e-3) {
      s.set(
        s.x * (1 + (SLUMP.x - 1) * this.slump),
        s.y * (1 + (SLUMP.y - 1) * this.slump),
        s.z * (1 + (SLUMP.z - 1) * this.slump),
      );
    }

    // 閉眼：泡澡時把眼睛壓扁成一條線、想泡澡時半垂（只動眼睛那顆 instance 的矩陣，不必換 mesh）。
    // 係數乘在原始縮放上，不可以直接指定絕對值。
    const eye = bathing ? EYE_BATH : mood === 'wantsBath' ? EYE_TIRED : 1;
    const target = this.eyeBaseY * eye;
    this.eyesNode.scale.y += (target - this.eyesNode.scale.y) * Math.min(1, dt * 10);

    // 面向移動方向，跳躍時才轉（泡澡時面向鏡頭）
    if (airborne) {
      const dx = p.to.x - p.from.x, dz = p.to.z - p.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
        const want = Math.atan2(dx, dz);
        // 只轉一點點：布丁的臉是正面畫的，轉太多就看不到臉了
        const limited = Math.max(-0.5, Math.min(0.5, want));
        this.root.rotation.y += (limited - this.root.rotation.y) * Math.min(1, dt * 4);
      }
    } else {
      this.root.rotation.y += (0 - this.root.rotation.y) * Math.min(1, dt * 3);
    }
  }
}
