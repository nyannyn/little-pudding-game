import * as THREE from 'three';
import { BALANCE } from '../game/balance';
import { SPECIES } from '../game/species';

/** 蛋的顏色（通用原料，刻意用象牙白跟各物種的原料分開） */
const EGG_COLOR = 0xfff3dc;
import type { GameState } from '../game/state';
import { toonGradient } from './toon';

const SIZE = 0.055;

/**
 * 掉落原料。上限只有 5 份，但每份顏色不同——用 InstancedMesh ＋ instanceColor
 * 一個 draw call 畫完；一份一個 Mesh 會直接吃掉五分之一的預算。
 */
export class DropsView {
  readonly mesh: THREE.InstancedMesh;
  /** instanceId → drop.id，點擊後要回頭問邏輯層撿哪一份 */
  private ids: (string | null)[] = [];
  private readonly dummy = new THREE.Object3D();
  private t = 0;

  constructor() {
    const geo = new THREE.IcosahedronGeometry(SIZE, 0);
    const mat = new THREE.MeshToonMaterial({ gradientMap: toonGradient() });
    this.mesh = new THREE.InstancedMesh(geo, mat, BALANCE.dropCap);
    this.mesh.name = 'Drops';
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** 每幀更新：位置、剛掉出來的彈跳、緩慢自轉（告訴玩家「這個可以點」）。只畫啟用區。 */
  sync(state: GameState, zone: string, ox: number, oy: number, dt: number) {
    this.t += dt;
    const mine = state.drops.filter((d) => d.zone === zone);
    const n = Math.min(mine.length, BALANCE.dropCap);
    this.mesh.count = n;
    this.ids.length = n;

    for (let i = 0; i < n; i++) {
      const d = mine[i];
      if (!d) continue;
      this.ids[i] = d.id;
      const age = Math.max(0, state.time - d.bornAt);
      const pop = age < 0.45 ? Math.sin((age / 0.45) * Math.PI) * 0.08 : 0; // 掉出來時彈一下
      const idle = Math.sin(this.t * 2.2 + i) * 0.006;
      this.dummy.position.set(ox + d.pos.x, oy + SIZE * 0.8 + pop + idle, d.pos.z);
      this.dummy.rotation.set(0.5, this.t * 0.8 + i, 0.2);
      const grow = age < 0.25 ? 0.4 + (age / 0.25) * 0.6 : 1;
      // 蛋拉長一點點：同一個 InstancedMesh 只能換縮放，換不了幾何，但蛋型看得出來
      if (d.kind === 'egg') this.dummy.scale.set(grow * 0.82, grow * 1.15, grow * 0.82);
      else this.dummy.scale.setScalar(grow);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      // 蛋是通用原料，用象牙白；物種原料沿用該物種的體色（一眼分得出撿到什麼）
      this.mesh.setColorAt(i, new THREE.Color(d.kind === 'egg' ? EGG_COLOR : SPECIES[d.species].bodyColor));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // InstancedMesh 的射線檢測先用「所有實例合起來的包圍球」粗篩；那顆球是第一次被要到時才算，
    // 而第一次通常發生在 count 還是 0 的時候 → 半徑 −1 的空球，之後不管掉幾份原料射線都打不到，
    // 玩家點地上的原料永遠沒反應。實例最多 5 個，每幀重算不痛。
    this.mesh.computeBoundingSphere();
  }

  /** 射線打到第幾個 instance → 那一份原料的 id */
  idAt(instanceId: number | undefined): string | null {
    if (instanceId === undefined) return null;
    return this.ids[instanceId] ?? null;
  }
}
