import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonGradient } from './toon';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map<string, Promise<THREE.Group>>();

// 載入 GLB 並把材質換成卡通著色（保留 Blender 給的底色）；同一檔只載一次
export function loadPuddingTemplate(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const src = o.material as THREE.MeshStandardMaterial;
          o.material = new THREE.MeshToonMaterial({
            color: src.color ?? new THREE.Color(0xffc857),
            map: src.map ?? null,
            gradientMap: toonGradient(),
          });
          o.castShadow = true;
          o.receiveShadow = false;
        }
      });
      return gltf.scene;
    });
    cache.set(url, p);
  }
  return p;
}

export async function spawnPudding(url: string): Promise<THREE.Group> {
  const template = await loadPuddingTemplate(url);
  return template.clone(true);
}
