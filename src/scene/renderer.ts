import * as THREE from 'three';

export interface RendererOptions {
  /** pixelRatio 上限（`?dpr=` 覆寫）。降這個值是「畫面卡」最有效的第一顆旋鈕： */
  maxPixelRatio?: number;
  /** 關掉 MSAA（`?aa=0`）。大畫布上 MSAA 很吃填充率 */
  antialias?: boolean;
}

/**
 * 手機優先：pixelRatio 上限 2（Retina 已足夠，再高只燒 GPU）。
 *
 * 兩個參數是拿來**現場分辨卡在哪**的：畫素量＝CSS 寬 × 高 × dpr²，
 * PC 視窗比手機大得多，同樣一份場景在 PC 上的畫素量可能是手機的好幾倍。
 * `?dpr=1` 一開就順＝填充率問題（要降解析度／關 MSAA／減透明疊層），
 * 降了還是卡＝不是填充率，要往「有沒有硬體加速」查（遠端桌面常讓瀏覽器退回軟體渲染）。
 */
export function createRenderer(container: HTMLElement, opts: RendererOptions = {}): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: opts.antialias ?? true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 已移除 PCFSoft，radius 靠 shadow.radius
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  return renderer;
}
