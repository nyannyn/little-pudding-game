import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BALANCE } from '../game/balance';
import type { PuddingView } from './puddingView';
import { toonGradient } from './toon';

/**
 * 腮紅與眼睛的顏色：所有物種同一色，所以是 uniform／材質色，不是 instance 屬性。
 * 數值抄 build_pudding.py 的 SKIN_BLUSH／Pudding_EyeMat，而且是**線性空間**——
 * 以前這兩色是 GLTFLoader 從 GLB 讀的（baseColorFactor 是線性值），用 setHex 會被當 sRGB 再轉一次，腮紅會變濃。
 */
const BLUSH_COLOR = new THREE.Color().setRGB(1.0, 0.47, 0.52, THREE.LinearSRGBColorSpace);
const EYE_COLOR = new THREE.Color().setRGB(0.09, 0.065, 0.06, THREE.LinearSRGBColorSpace);

/**
 * 同時畫得出幾隻。只有啟用區的布丁會進 pool（非啟用區的完全不畫），
 * 所以是「一區的上限」，不是總住客數；`?pop=` 塞超過會被夾住並警告一次。
 */
export const POOL_CAPACITY = Math.max(16, BALANCE.zoneCapacity);

/** GLB 裡一個部件：幾何＋它相對 Pudding_Root 的局部變換（quantize 會把縮放與平移搬到節點上） */
export interface PuddingPart {
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export interface PuddingParts {
  /** 本體＋焦糖＋腮紅併成的一顆 mesh，頂點色 `Mask`＝(本體, 焦糖, 腮紅) 三個遮罩 */
  body: PuddingPart;
  /** 兩顆眼睛；獨立一顆 mesh 是為了閉眼時單獨壓扁 */
  eyes: PuddingPart;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<PuddingParts>>();

/** 載 GLB、拆出兩個部件；同一檔只載一次 */
export function loadPuddingParts(url: string): Promise<PuddingParts> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      const part = (name: string): PuddingPart => {
        const o = gltf.scene.getObjectByName(name);
        if (!(o instanceof THREE.Mesh)) throw new Error(`pudding GLB 缺 ${name}`);
        return { geometry: o.geometry as THREE.BufferGeometry, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
      };
      const parts = { body: part('Pudding_Body'), eyes: part('Pudding_Eyes') };
      if (!parts.body.geometry.getAttribute('color')) throw new Error('pudding GLB 的 Pudding_Body 沒有頂點色遮罩（重跑 tools/blender/build_pudding.py）');
      return parts;
    });
    cache.set(url, p);
  }
  return p;
}

/**
 * 所有布丁共用的兩個 InstancedMesh（D41）：不管幾隻，本體 1 個 draw call＋眼睛 1 個＋本體陰影 1 個。
 *
 * 每隻的物種顏色走 instance 屬性 `aBody`／`aTopping`，在 vertex shader 裡用頂點色遮罩混出來：
 *   顏色 ＝ aBody·Mask.r ＋ aTopping·Mask.g ＋ 腮紅·Mask.b
 * 跟 Blender 端 `_skin_mat` 同一條公式。表情（閉眼）是眼睛那顆 mesh 的 instance 矩陣各自壓扁。
 *
 * 每幀由 main 迴圈 `begin()` → 對每隻可見的布丁 `add(view)` → `commit()`；
 * view 只負責把自己的骨架（`root` 與兩個空節點）擺好，矩陣由這裡讀走。
 */
export class PuddingPool {
  readonly body: THREE.InstancedMesh;
  readonly eyes: THREE.InstancedMesh;
  private readonly aBody: THREE.InstancedBufferAttribute;
  private readonly aTopping: THREE.InstancedBufferAttribute;
  private n = 0;
  private warnedOverflow = false;

  constructor(readonly parts: PuddingParts) {
    // 幾何 clone 一份：instance 屬性掛在幾何上，不要汙染快取裡的模板
    const bodyGeo = parts.body.geometry.clone();
    this.aBody = new THREE.InstancedBufferAttribute(new Float32Array(POOL_CAPACITY * 3), 3);
    this.aTopping = new THREE.InstancedBufferAttribute(new Float32Array(POOL_CAPACITY * 3), 3);
    this.aBody.setUsage(THREE.DynamicDrawUsage);
    this.aTopping.setUsage(THREE.DynamicDrawUsage);
    bodyGeo.setAttribute('aBody', this.aBody);
    bodyGeo.setAttribute('aTopping', this.aTopping);

    const bodyMat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() });
    bodyMat.onBeforeCompile = (shader) => {
      shader.uniforms.uBlush = { value: BLUSH_COLOR };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBody;\nattribute vec3 aTopping;\nuniform vec3 uBlush;')
        // 原本的 chunk 是 vColor = 頂點色；這裡頂點色是遮罩，真正的顏色從 instance 屬性混
        .replace('#include <color_vertex>', 'vColor = vec4( aBody * color.r + aTopping * color.g + uBlush * color.b, 1.0 );');
    };
    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, POOL_CAPACITY);
    this.body.name = 'Puddings_Body';
    // 陰影只留本體：眼睛的影子在這個尺寸下看不出來，但會多一個陰影 pass 的 draw call
    this.body.castShadow = true;
    this.body.receiveShadow = false;

    const eyeMat = new THREE.MeshToonMaterial({ color: EYE_COLOR, gradientMap: toonGradient() });
    this.eyes = new THREE.InstancedMesh(parts.eyes.geometry, eyeMat, POOL_CAPACITY);
    this.eyes.name = 'Puddings_Eyes';
    this.eyes.castShadow = false;

    for (const m of [this.body, this.eyes]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.visible = false;
      // 布丁永遠在畫面裡；InstancedMesh 的包圍球要自己算，不算就會整批被剔除
      m.frustumCulled = false;
    }
  }

  begin() {
    this.n = 0;
  }

  /** 把一隻（已經 `update()` 過、可見的）布丁的骨架矩陣與顏色收進這一幀 */
  add(view: PuddingView) {
    const i = this.n;
    if (i >= POOL_CAPACITY) {
      if (!this.warnedOverflow) {
        this.warnedOverflow = true;
        console.warn(`[lpg] 同一區超過 ${POOL_CAPACITY} 隻布丁，多出來的不畫`);
      }
      return;
    }
    view.root.updateMatrixWorld(true);
    this.body.setMatrixAt(i, view.bodyNode.matrixWorld);
    this.eyes.setMatrixAt(i, view.eyesNode.matrixWorld);
    const c = view.bodyColor, t = view.toppingColor;
    this.aBody.setXYZ(i, c.r, c.g, c.b);
    this.aTopping.setXYZ(i, t.r, t.g, t.b);
    this.n = i + 1;
  }

  commit() {
    const n = this.n;
    for (const m of [this.body, this.eyes]) {
      m.count = n;
      // 一隻都沒有就整個不畫：count 0 的 InstancedMesh 還是會走一次 draw
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
    }
    this.aBody.needsUpdate = true;
    this.aTopping.needsUpdate = true;
  }
}
