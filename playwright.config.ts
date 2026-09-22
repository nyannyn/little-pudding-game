import { defineConfig, devices } from '@playwright/test';

// iPhone 視口＋無頭 WebGL（SwiftShader）。dev server 由 Playwright 起。
// LPG_PORT：另一個 worktree／session 已經占著 5173 時，改用別的埠（reuseExistingServer 會沾到別人的樹）。
const PORT = Number(process.env.LPG_PORT ?? 5173);
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['iPhone 14'],
    // 桌面 chromium 模擬 iPhone 視口（不用 WebKit：無頭 WebKit 的 WebGL 不穩）
    defaultBrowserType: 'chromium',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
