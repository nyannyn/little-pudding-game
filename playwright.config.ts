import { defineConfig, devices } from '@playwright/test';

// iPhone 視口＋無頭 WebGL（SwiftShader）。dev server 由 Playwright 起。
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['iPhone 14'],
    // 桌面 chromium 模擬 iPhone 視口（不用 WebKit：無頭 WebKit 的 WebGL 不穩）
    defaultBrowserType: 'chromium',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
