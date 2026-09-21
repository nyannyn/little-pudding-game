import * as THREE from 'three';

const MAX = 48;

interface P { x: number; y: number; z: number; vy: number; life: number; max: number; r: number; g: number; b: number; size: number }

/**
 * 泡澡泡泡與突變閃光，全部共用一個 Points（一個 draw call）。
 * 粒子是「有事發生了」的訊號：泡澡在冒泡、突變閃一下，
 * 沒有純裝飾的粒子（D7：每個動畫都對應一條規則）。
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pool: P[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly siz: Float32Array;

  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.siz = new Float32Array(MAX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1));
    const mat = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'Particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    geo.setDrawRange(0, 0);
  }

  private spawn(p: P) {
    if (this.pool.length >= MAX) this.pool.shift();
    this.pool.push(p);
  }

  /** 泡澡冒的小泡泡 */
  bubble(x: number, y: number, z: number, color: number) {
    const c = new THREE.Color(color);
    this.spawn({
      x: x + (Math.random() - 0.5) * 0.12,
      y,
      z: z + (Math.random() - 0.5) * 0.08,
      vy: 0.06 + Math.random() * 0.05,
      life: 0, max: 1.1, r: c.r, g: c.g, b: c.b, size: 0.7 + Math.random() * 0.6,
    });
  }

  /** 突變／成交時的一次性閃光 */
  burst(x: number, y: number, z: number, color: number, n = 16) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn({
        x: x + Math.cos(a) * 0.04,
        y: y + 0.03,
        z: z + Math.sin(a) * 0.04,
        vy: 0.12 + Math.random() * 0.12,
        life: 0, max: 0.7, r: c.r, g: c.g, b: c.b, size: 1.1 + Math.random(),
      });
    }
  }

  update(dt: number) {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      if (!p) continue;
      p.life += dt;
      p.y += p.vy * dt;
      if (p.life >= p.max) this.pool.splice(i, 1);
    }

    const n = Math.min(this.pool.length, MAX);
    for (let i = 0; i < n; i++) {
      const p = this.pool[i];
      if (!p) continue;
      const fade = 1 - p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r * fade + (1 - fade);
      this.col[i * 3 + 1] = p.g * fade + (1 - fade);
      this.col[i * 3 + 2] = p.b * fade + (1 - fade);
      this.siz[i] = p.size * fade;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    this.points.visible = n > 0;
  }
}
