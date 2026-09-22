import * as THREE from 'three';
import { toonGradient } from './toon';

/** 同時最多幾枚金幣在飛。一次出貨最多彈 6 枚，留四次重疊的餘裕 */
const MAX = 24;
/**
 * 金幣半徑與厚度（世界單位）。
 * **0.032 太小**：iPhone 視口下鏡頭離櫃子 2 公尺出頭，那個尺寸在畫面上只有十幾 px，
 * 看起來像雜訊不像金幣（2026-09-22 截圖實測）。掉落原料是 0.055 且讀得出來，取 0.05 同量級。
 */
const R = 0.05;
const THICK = 0.016;

const GOLD = 0xffd764;

/** 各階段的秒數：彈出 → 在地上停一下 → 縮小消失 */
const REST_SEC = 0.55;
const VANISH_SEC = 0.35;
/** 重力（世界單位／秒²）。櫥窗只有 1.5 高，用真實重力會快到看不見 */
const GRAVITY = 2.6;
/** 落地反彈保留多少速度 */
const BOUNCE = 0.42;

interface Coin {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** 地板高度：落到這裡就停 */
  floor: number;
  spin: number;
  spinSpeed: number;
  tilt: number;
  /** 躺平程度 0→1：落地之後從側立轉成平躺 */
  flat: number;
  /** 停在地上多久了；還在飛就是 0 */
  rest: number;
  vanish: number;
  dead: boolean;
}

/**
 * 賣出時從外帶窗口彈出來、撒在地上、消失的金幣（D42）。
 *
 * 為什麼要有：`autoSell` 原本是靜靜把甜點變成金幣，畫面上只有一則 2.6 秒的 toast
 * 和頂列跳動的數字。整條自動化生產線做完之後，玩家其實看不到「賣掉了」這件事發生
 * ——跟 D39 那三個靜默是同一個病。
 *
 * 一個 `InstancedMesh` ＝ 一個 draw call，而且**沒有金幣在飛的時候整個 `visible = false`**：
 * 這個演出大概只有 5% 的時間開著，預算（35）不該被它長期佔一格。
 */
export class CoinsView {
  readonly mesh: THREE.InstancedMesh;
  private readonly coins: Coin[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor() {
    // 立著的圓柱＝側看是一枚硬幣。躺平由 rotation.x 轉過去，不必換幾何
    const geo = new THREE.CylinderGeometry(R, R, THICK, 12);
    geo.rotateX(Math.PI / 2); // 預設面朝鏡頭（側立），落地後再轉平
    const mat = new THREE.MeshToonMaterial({ color: GOLD, gradientMap: toonGradient() });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = 'Coins';
    this.mesh.castShadow = false; // 金幣只活一秒多，陰影 pass 的三角形加倍不值得
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** 現在畫面上有沒有金幣（測試與 draw call 斷言用） */
  get active(): number {
    return this.coins.length;
  }

  /**
   * 從 `(x, y, z)` 彈出 `n` 枚金幣，落到 `floorY` 的地板上。
   *
   * `n` 由呼叫端依成交金額決定並**在同一幀累加完**再叫一次：`shipDesserts` 是逐物種賣的，
   * 一次出貨可能在同一幀丟出好幾個 `sell` 事件，用「距離上次 N 秒才准播」的節流
   * 會把同幀的其他幾筆吃掉。
   */
  burst(x: number, y: number, z: number, n: number, floorY: number, rng: () => number = Math.random) {
    const count = Math.max(1, Math.min(n, 8));
    for (let i = 0; i < count; i++) {
      // 扇形撒開：左右散開，深度方向往 **−z**（櫥窗內側）拋。
      // ①不可以往 +z：窗口 mesh 在 z=0.68、前玻璃在 0.7，只剩 2 公分，往那邊撒會穿模。
      // ②往 −z 也不能只滾一點點：外帶窗是個 0.3×0.2 的箱體，落在它正後方（z≈0.5）
      //   的金幣會被它整個擋住，玩家只看得到一角（2026-09-22 截圖實測）。
      //   要拋過窗體、落到 z≈0.35 那片空地上才看得見。
      const spread = (i / Math.max(1, count - 1) - 0.5) * 1.4 + (rng() - 0.5) * 0.3;
      if (this.coins.length >= MAX) this.coins.shift();
      this.coins.push({
        x, y, z,
        vx: spread * 0.5,
        vy: 0.72 + rng() * 0.28,
        vz: -(0.30 + rng() * 0.22),
        floor: floorY + THICK / 2,
        spin: rng() * Math.PI * 2,
        spinSpeed: (6 + rng() * 6) * (rng() < 0.5 ? -1 : 1),
        tilt: rng() * 0.6,
        flat: 0,
        rest: 0,
        vanish: 0,
        dead: false,
      });
    }
  }

  update(dtRaw: number) {
    // 主迴圈的 dt 已經夾在 0.1（`main.ts` 的 setAnimationLoop），這裡再夾一次是給
    // `window.__lpg.step(dt)` 那條 debug 路徑用的：截圖工具會一次推一整秒，
    // 不夾的話整段演出會在單一幀裡跑完，截到的是殘影（2026-09-22 第一次截圖就踩到）。
    const dt = Math.min(dtRaw, 0.05);
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (!c) continue;
      this.step(c, dt);
      if (c.dead) this.coins.splice(i, 1);
    }

    const n = this.coins.length;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;

    for (let i = 0; i < n; i++) {
      const c = this.coins[i];
      if (!c) continue;
      const shrink = c.vanish > 0 ? Math.max(0, 1 - c.vanish / VANISH_SEC) : 1;
      this.dummy.position.set(c.x, c.y, c.z);
      // flat=0 側立（面朝鏡頭）、flat=1 躺平；躺下去的同時自轉慢下來
      this.dummy.rotation.set(-c.flat * (Math.PI / 2), c.spin, c.tilt * (1 - c.flat));
      this.dummy.scale.setScalar(shrink);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private step(c: Coin, dt: number) {
    if (c.rest > 0) {
      // 躺在地上：先停一下讓玩家看見，再縮小消失
      c.rest += dt;
      c.flat = Math.min(1, c.flat + dt * 8);
      if (c.rest > REST_SEC) c.vanish += dt;
      if (c.vanish >= VANISH_SEC) c.dead = true;
      return;
    }

    c.vy -= GRAVITY * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.spin += c.spinSpeed * dt;

    if (c.y > c.floor || c.vy > 0) return;

    c.y = c.floor;
    if (c.vy < -0.25) {
      // 還有力氣就彈一下再滾一小段（「撒在地上」的那個撒）
      c.vy = -c.vy * BOUNCE;
      c.vx *= 0.7;
      c.vz *= 0.7;
      c.spinSpeed *= 0.6;
      return;
    }
    c.vy = 0;
    c.rest = 0.0001; // 進入躺平階段
  }
}
