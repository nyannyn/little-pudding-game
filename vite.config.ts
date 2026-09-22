import { defineConfig } from 'vitest/config';

// base 由 CI 注入（GitHub Pages 需要 /<repo>/），本機開發為 /
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  // assetsInlineLimit 0：商店商品圖（src/assets/shop）全部走獨立檔＋內容雜湊，
  // 由 service worker 快取；預設會把 <4 KB 的圖 base64 塞進 JS，改一張圖整包 JS 就換雜湊重抓。
  build: { target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  server: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: { include: ['src/game/**'] },
  },
});
