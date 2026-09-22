import * as THREE from 'three';
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
  el.hidden = !visible;
  const stats: LpgStats = { fps: 0, drawCalls: 0, triangles: 0, ready: false, pixels: 0, gpu: gpuName(renderer) };
  window.__lpg = { ...(window.__lpg ?? {}), stats };

  let frames = 0, last = performance.now();
  return {
    stats,
    tick() {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        stats.fps = Math.round((frames * 1000) / (now - last));
        frames = 0; last = now;
      }
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      stats.pixels = size.x * size.y;
      if (visible) {
        el.textContent =
          `fps ${stats.fps}\ndraw ${stats.drawCalls}\ntris ${stats.triangles}\n` +
          `${size.x}×${size.y} (dpr ${renderer.getPixelRatio()})\n` +
          `${(stats.pixels / 1e6).toFixed(1)} Mpx\n${stats.gpu}`;
      }
    },
  };
}
