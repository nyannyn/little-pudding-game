import * as THREE from 'three';
import { storageReport } from '../game/storage';
import type { GameState } from '../game/state';

export interface LpgStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  ready: boolean;
  /** 實際畫多少畫素（CSS 尺寸 × pixelRatio）；填充率問題從這個數字看得出來 */
  pixels?: number;
  /** 顯示卡字串。出現 SwiftShader／llvmpipe＝瀏覽器沒拿到硬體加速，再怎麼減內容都會卡 */
  gpu?: string;
}

/**
 * 顯示卡字串。`WEBGL_debug_renderer_info` 在部分瀏覽器被隱私設定擋掉，
 * 拿不到就回退到 `renderer.getContext().getParameter(RENDERER)`（通常是通用字串）。
 */
function gpuName(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof raw === 'string' ? raw : '未知';
  } catch {
    return '讀不到';
  }
}

declare global {
  interface Window {
    __lpg: {
      stats: LpgStats;
      state?: GameState;
      /** `?pause=1` 時手動推一幀（秒）；截圖與 e2e 用來抓固定時間點的畫面 */
      step?: (dt: number) => void;
      /** 音效播放計數與解鎖狀態：截圖證不了聲音，e2e 靠這個斷言「按下去真的有排進 AudioContext」 */
      sfx?: { played: { splat: number; coin: number; pour: number }; isUnlocked: boolean; muted: boolean };
      /** 測試用：走遊戲自己的 grantXp（會丟 levelUp 事件），不是直接改欄位 */
      grantXp?: (amount: number) => void;
      /** 測試用：啟用區的區域座標（x, 高度, z）投到螢幕上的 CSS 像素——e2e 拿來長按拖家具（D49） */
      toScreen?: (x: number, y: number, z: number) => { x: number; y: number };
      /** 甜點工坊場景（D51）：e2e 讀客人數、工坊的 scene graph */
      bakery?: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; customerCount: number };
      /** 測試用：切換農場／工坊（等同按 HUD 的「甜點店」「回農場」） */
      setView?: (view: 'farm' | 'bakery') => void;
      three?: {
        scene: THREE.Scene;
        camera: THREE.PerspectiveCamera;
        renderer: THREE.WebGLRenderer;
        controls: { target: THREE.Vector3; update(): void };
        raycaster: THREE.Raycaster;
      };
    };
  }
}

// `?debug=1` 顯示面板；數字永遠寫進 window.__lpg.stats 供 Playwright 讀
export function createStats(renderer: THREE.WebGLRenderer, visible: boolean) {
  const el = document.getElementById('debug')!;
  // 面板現在住在設定卡裡（HUD 先建好才跑到這裡），要連標題那一框一起開關
  const box = (el.closest('.debugbox') as HTMLElement | null) ?? el;
  box.hidden = !visible;
  const stats: LpgStats = { fps: 0, drawCalls: 0, triangles: 0, ready: false, pixels: 0, gpu: gpuName(renderer) };
  window.__lpg = { ...(window.__lpg ?? {}), stats };

  // 存檔狀態：下一次「進度不見了」要看得到事實，不是用猜的。
  // 每半秒才更新一次——這行要讀兩次 localStorage，不能每幀跑。
  let storageLine = '';
  let frames = 0, last = performance.now();
  return {
    stats,
    tick() {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        stats.fps = Math.round((frames * 1000) / (now - last));
        frames = 0; last = now;
        const st = storageReport();
        storageLine =
          `${st.key} r${st.rev} ${st.mainBytes}B` +
          `${st.backupBytes > 0 ? ` bak ${st.backupBytes}B/p${st.backupScore}` : ' bak 無'}` +
          `${st.durable ? '' : ' 不持久'}${st.outdated ? ' 已停寫' : ''}`;
      }
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      stats.pixels = size.x * size.y;
      if (visible) {
        el.textContent =
          `fps ${stats.fps}\ndraw ${stats.drawCalls}\ntris ${stats.triangles}\n` +
          `${size.x}×${size.y} (dpr ${renderer.getPixelRatio()})\n` +
          `${(stats.pixels / 1e6).toFixed(1)} Mpx\n${stats.gpu}\n${storageLine}`;
      }
    },
  };
}
