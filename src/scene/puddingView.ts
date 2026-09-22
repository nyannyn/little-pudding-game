import * as THREE from 'three';
import { BALANCE } from '../game/balance';
import type { Pudding } from '../game/state';
import { SPECIES } from '../game/species';
import { spawnPudding } from './puddingMesh';

const PUDDING_MODEL_WIDTH = 1.0; // build_pudding.py 回報的出廠 bbox 寬
export const PUDDING_WIDTH = 0.2; // 使用者定案

// 落地形變的比例（WP2 在 Blender 端實測過的那一組，見 STATE「Q 感需求已驗」）。
// Blender 是 Z-up 記成 (1.20, 1.20, 0.70)，three.js 是 Y-up，所以垂直分量換到 y。
const SQUASH = new THREE.Vector3(1.2, 0.7, 1.2);
const STRETCH = new THREE.Vector3(0.86, 1.3, 0.86);
const SQUASH_SEC = 0.22;


/**
 * 一隻布丁的演出。只讀 `Pudding` 狀態，不改任何規則——
 * 「跳去哪」是 game/ 決定的，這裡只負責把 A→B 演成拋物線＋落地壓扁。
 */
export class PuddingView {
  readonly root: THREE.Group;
  private readonly bodyMat: THREE.MeshToonMaterial | null;
  private readonly caramelMat: THREE.MeshToonMaterial | null;
  private readonly eyes: THREE.Object3D | null;
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

  constructor(template: THREE.Group, p: Pudding) {
    this.root = template;
    this.baseScale = PUDDING_WIDTH / PUDDING_MODEL_WIDTH;
    this.root.scale.setScalar(this.baseScale);

    const find = (name: string) => this.root.getObjectByName(name) ?? null;
    const body = find('Pudding_Body');
    const caramel = find('Pudding_Caramel');
    this.eyes = find('Pudding_Eyes');

    // 陰影只留本體：焦糖／眼睛／腮紅的影子在這個尺寸下看不出來，
    // 但每個 castShadow 的 mesh 都會在陰影 pass 再吃一個 draw call（預算只有 35）。
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.name === 'Pudding_Body';
    });

    // `Group.clone()` 出來的 mesh 共用同一份材質；每隻要能各自變色就得自己一份
    if (body instanceof THREE.Mesh) body.material = (body.material as THREE.MeshToonMaterial).clone();
    if (caramel instanceof THREE.Mesh) caramel.material = (caramel.material as THREE.MeshToonMaterial).clone();
    this.bodyMat = body instanceof THREE.Mesh ? (body.material as THREE.MeshToonMaterial) : null;
    this.caramelMat = caramel instanceof THREE.Mesh ? (caramel.material as THREE.MeshToonMaterial) : null;

    this.eyeBaseY = this.eyes?.scale.y ?? 1;

    this.shownSpecies = p.species;
    this.applySpecies(p.species);
  }

  private applySpecies(id: Pudding['species']) {
    const info = SPECIES[id];
    this.bodyMat?.color.setHex(info.bodyColor);
    this.caramelMat?.color.setHex(info.toppingColor);
    this.shownSpecies = id;
  }

  /** 突變瞬間的縮放脈衝，由外部在收到 mutate 事件時呼叫 */
  pulse() {
    this.squashT = SQUASH_SEC * 1.6;
  }

  /**
   * @param floorY  啟用層地板的世界高度
   * @param basinY  泡澡時身體要沉到多低（相對地板）
   */
  update(p: Pudding, dt: number, ox: number, floorY: number, basinSink: number) {
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

    // 閉眼：泡澡時把眼睛壓扁成一條線（比換 mesh 便宜，也不必多一個 draw call）。
    // 係數乘在原始縮放上，不可以直接指定絕對值。
    if (this.eyes) {
      const target = this.eyeBaseY * (bathing ? 0.22 : 1);
      this.eyes.scale.y += (target - this.eyes.scale.y) * Math.min(1, dt * 10);
    }

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

export async function createPuddingView(url: string, p: Pudding): Promise<PuddingView> {
  const g = await spawnPudding(url);
  return new PuddingView(g, p);
}
