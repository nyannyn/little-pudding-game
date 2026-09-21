import type * as THREE from 'three';

export interface LpgStats { fps: number; drawCalls: number; triangles: number; ready: boolean }

declare global {
  interface Window {
    __lpg: {
      stats: LpgStats;
      state?: unknown;
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
  const stats: LpgStats = { fps: 0, drawCalls: 0, triangles: 0, ready: false };
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
      if (visible) el.textContent = `fps ${stats.fps}\ndraw ${stats.drawCalls}\ntris ${stats.triangles}`;
    },
  };
}
