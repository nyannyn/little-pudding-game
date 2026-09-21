import { defineConfig } from 'vitest/config';

// base 由 CI 注入（GitHub Pages 需要 /<repo>/），本機開發為 /
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: { target: 'es2022', sourcemap: false },
  server: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: { include: ['src/game/**'] },
  },
});
