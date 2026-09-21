// 部署後的線上煙霧測試：真的去 Pages 網址開一次，確認遊戲跑得起來。
//
// 為什麼要有這支：CI 只驗「dist 裡有沒有檔案、index.html 有沒有 base 前綴」，
// 那是檔案層級的檢查。資產 404、GLB 載入失敗、shader patch 在正式建置下失效，
// 都只有真的開一次才看得到。
//
// 用法：node tools/smoke-live.mjs [網址]
// 預設 https://nyannyn.github.io/little-pudding-game/
// 全部通過 exit 0，任何一項失敗 exit 1。
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = (process.argv[2] ?? process.env.LPG_LIVE ?? 'https://nyannyn.github.io/little-pudding-game/').replace(/\/$/, '');
const OUT = 'docs/previews';
mkdirSync(OUT, { recursive: true });

const problems = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '[v]' : '[X]'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) problems.push(label);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

try {
  await page.goto(`${BASE}/?debug=1&fresh=1&seed=1&fastTime=20`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 40_000 });
  // ready 翻轉的當下布丁剛掛進場景，還沒被畫進任何一幀——
  // 馬上讀 renderer.info 會少算兩隻布丁（4494 vs 7886），要讓它先畫幾幀
  await page.waitForTimeout(900);

  const stats = await page.evaluate(() => ({ ...window.__lpg.stats }));
  check(stats.triangles > 4000, '場景畫出來了（含兩隻布丁的 GLB）', `tris ${stats.triangles}`);
  check(stats.drawCalls > 0 && stats.drawCalls <= 30, 'draw calls 在預算內', `${stats.drawCalls} / 30`);

  // 邏輯層真的在跑：遊戲時間會往前走
  const t0 = await page.evaluate(() => window.__lpg.state.time);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => window.__lpg.state.time);
  check(t1 > t0, '模擬有在推進', `${t0.toFixed(1)} → ${t1.toFixed(1)}`);

  // 一個真的玩家動作：倒焦糖
  await page.getByRole('button', { name: '倒焦糖' }).click();
  const basin = await page.evaluate(() => window.__lpg.state.basins[0]);
  check(basin.units === 1 && basin.liquid === 'caramel', '倒焦糖進得了澡盆', `units ${basin.units}`);

  // 布丁會自己跳進去泡
  await page.waitForFunction(() => window.__lpg.state.puddings.some((p) => p.mode === 'bathing'), null, { timeout: 60_000 })
    .then(() => check(true, '布丁自己跳進澡盆泡澡'))
    .catch(() => check(false, '布丁自己跳進澡盆泡澡', '逾時'));

  await page.screenshot({ path: `${OUT}/live-smoke.png` });
  console.log(`   截圖：${OUT}/live-smoke.png`);

  // ── PWA：「加入主畫面」要拿得到的東西 ──────────────────
  // 這裡才驗得到「相對路徑在 /repo/ 子路徑下解析正確」——dev server 會改寫成絕對路徑，
  // 本機 e2e 看不出這個差別。
  const pwa = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    const out = { manifestUrl: manifestLink?.href ?? '', appleUrl: appleLink?.href ?? '', manifestStatus: 0, appleStatus: 0, iconStatuses: [] };
    if (manifestLink) {
      const res = await fetch(manifestLink.href);
      out.manifestStatus = res.status;
      if (res.ok) {
        const m = await res.json();
        out.manifest = m;
        for (const icon of m.icons ?? []) {
          const r = await fetch(new URL(icon.src, manifestLink.href).href);
          out.iconStatuses.push(r.status);
        }
      }
    }
    if (appleLink) out.appleStatus = (await fetch(appleLink.href)).status;
    return out;
  });

  const base = new URL(BASE + '/').pathname;
  check(pwa.manifestUrl.includes(base), 'manifest 解析在 base 之下（不是網站根目錄）', pwa.manifestUrl);
  check(pwa.manifestStatus === 200, 'manifest 拿得到', String(pwa.manifestStatus));
  check(pwa.manifest?.display === 'standalone' && pwa.manifest?.orientation === 'portrait', 'manifest 是直向全螢幕');
  check(pwa.iconStatuses.length > 0 && pwa.iconStatuses.every((s) => s === 200), '所有圖示都拿得到', pwa.iconStatuses.join(','));
  check(pwa.appleStatus === 200, 'iOS 的 apple-touch-icon 拿得到', pwa.appleUrl);

  // ── service worker：註冊、接管、離線還開得起來 ──────────
  const swScope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.scope;
  }).catch(() => '');
  check(swScope.includes(base), 'service worker 註冊且 scope 正確', swScope || '沒有 ready');

  // 等快取真的收齊再斷網。第一次載入時 SW 還沒接管，資產是頁面 load 之後才補進快取的，
  // 沒等就斷網只是在測「補到一半」——那不是玩家會遇到的狀態（他們會先玩一陣子才離線）。
  const warmed = await page
    .waitForFunction(
      async () => {
        const c = await caches.open('lpg-v1');
        const keys = (await c.keys()).map((r) => r.url);
        return keys.some((u) => u.endsWith('.js')) && keys.some((u) => u.endsWith('.glb'));
      },
      null,
      { timeout: 20_000, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  check(warmed, 'service worker 把 app shell 收進快取了');

  await ctx.setOffline(true);
  const offlineOk = await page
    .reload({ waitUntil: 'load', timeout: 30_000 })
    .then(() => page.waitForFunction(() => window.__lpg?.stats?.ready === true, null, { timeout: 30_000 }))
    .then(() => true)
    .catch(() => false);
  check(offlineOk, '離線狀態下重新整理仍然開得起來');
  await ctx.setOffline(false);
} catch (e) {
  check(false, '頁面載入／操作', String(e).split('\n')[0]);
}

// 離線那一段本來就會有 net::ERR_INTERNET_DISCONNECTED，那是測試自己造成的，不算問題
const realFailures = failedRequests.filter((f) => !/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(f));
const realConsole = consoleErrors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED/.test(e));
check(realConsole.length === 0, 'console 沒有錯誤', realConsole.slice(0, 3).join(' | '));
check(realFailures.length === 0, '沒有 404／載入失敗的資產', realFailures.slice(0, 3).join(' | '));

await browser.close();

if (problems.length > 0) {
  console.error(`\n線上煙霧測試有 ${problems.length} 項沒過：${problems.join('、')}`);
  process.exit(1);
}
console.log('\n線上煙霧測試全部通過');
