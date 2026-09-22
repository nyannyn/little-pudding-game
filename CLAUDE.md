# 小布丁農場（little-pudding-game）

three.js 網頁 3D 手機遊戲；先在 iPhone Safari 玩，後期用 Expo WebView 包 App。設計與 checkpoint 見記憶庫的計畫檔與 STATE.md（**不在 repo 內**，由本機記憶庫提供）。

## 指令
- `npm run dev`：本機開發
- `npm run build`：tsc 型別檢查＋vite build
- `npm run preview`：跑正式建置（**Service Worker 只在 PROD 註冊，要驗 SW／離線就用這個**）
- `npm test`：vitest（`tests/unit/**`，覆蓋率只算 `src/game`）
- `npm run e2e`：Playwright（iPhone 視口，無頭 WebGL）
- `npm run pacing`：無頭跑 3 小時遊戲時間，印每個里程碑在第幾分鐘（調數值前後各跑一次）
- `npm run playtest`：從頭試玩找 bug 的整套腳本（`tools/playtest/`）；流程與判讀見 `.claude/skills/playtest/SKILL.md`
- `npm run smoke:live`：對正式建置或線上網址跑整頁煙霧測（`LPG_BASE` 指定網址）
- `npm run models:optimize`：壓縮 `public/models/*.glb` 並檢查資產預算（超標 exit 1）
- `npm run art:shop`：重抓商店商品圖（Microsoft Fluent Emoji 3D，MIT，釘 commit）縮成 160px WebP 到 `src/assets/shop/`；授權全文在同目錄 `LICENSE.txt`。只在改 `tools/fetch-shop-art.mjs` 的 ART 表時才需要重跑，輸出已進版控
- 網址參數：`?debug=1` 顯示 fps／draw calls／三角形數與顯示卡、`?fresh=1` 開新檔（**測試模式**）、`?seed=N` 固定亂數、`?fastTime=N` 倍速、`?pop=N` 指定布丁隻數、`?noPudding=1` 不載布丁、`?dpr=N`／`?aa=0` 降解析度與關 MSAA（查效能）
- 手機實測走 GitHub Pages：push `master` 自動部署到 `https://nyannyn.github.io/little-pudding-game/`（`.github/workflows/pages.yml`）；PC 沒有 Wi-Fi 卡且防火牆擋 5173 入站，區網直連不可行

## 分層鐵則
- `src/game/`：純邏輯，**零 three.js 依賴**，所有規則（跳去哪、何時泡澡、何時突變）在這裡，vitest 全覆蓋；亂數走 `rng.ts` 可注入種子。
- `src/scene/`：只讀 state、播動畫，不改規則。
- `src/ui/`：HTML/CSS 疊層；圖示用 SVG，**不用 emoji**。

## 存檔
- localStorage，玩家那格 key 是 `lpg.save.v1`（`src/game/storage.ts`）；每 5 秒（真實時間）＋切到背景＋關分頁各存一次。
- **`?fresh=1` 是測試模式，寫到另一格 `lpg.save.test`**，玩家那格一個位元組都不碰（曾經共用同一格，在自己手機上開一次測試網址就把進度洗掉）。
- **`GameState` 加欄位一定要同步改 `migrate()` 並升 `SCHEMA_VERSION`**，而且舊檔補值要補對方向——補錯不會有測試紅，只會讓老玩家的存檔靜默走樣。
- 離線結算靠 `lastSeenAt`，上限 8 小時（`BALANCE.offlineCapSec`）。
- 存不進去（無痕／被擋）時退回記憶體、遊戲照玩，但要提示玩家；**不可以靜默失敗**。

## PWA／Service Worker
- HTML 一律 **network-first**（cache-first 會讓玩家永遠停在舊版，而且看起來完全正常）；其他同源資產 stale-while-revalidate。
- `caches.match` 一律帶 `{ ignoreVary: true }`：GitHub Pages 對靜態資產回 `Vary: Origin`，不加會整份快取 miss、離線時白畫面。
- SW 只在 `import.meta.env.PROD` 註冊，所以它的驗證不在 e2e（跑 dev server），在 `npm run smoke:live`。

## 效能預算
誰擋要分清楚：
- **e2e 擋**：每幀 draw calls ≤ 35（`tests/e2e/helpers.ts` 的 `DRAW_CALL_BUDGET`，只有這一處；2026-09-22 由 30 上調，見計畫 D31：繁殖讓一層住到 3 隻，每隻 +5）
- **`npm run models:optimize` 擋**：每個 GLB ≤ 3k 面／300 KB、資產總量 ≤ 3 MB
- **沒有自動檢查、動到要自己量**：總面數 ≤ 50k、貼圖 ≤ 1024²
- **靠真機、目前尚未驗過**：iPhone 中位數 ≥ 50 fps（AC1-3）

玻璃**不用** `transmission`（每幀多一次全場景 pass）。

## 測試紀律
- **跑 e2e／playtest 期間不要改 `src/`**：Vite HMR 會重新載入頁面，測試看到的是「element was detached／非預期 navigation」，長得跟產品 bug 一樣。
- 視覺類改動要使用者看畫面簽核；負向對照要真的紅過才算數。

## 美術管線
Blender MCP（`.mcp.json`；Blender 端側欄分頁「MCP for Blender」按連線鈕，**按鈕名稱隨 addon 版本變**，本機 4.5 是「Connect to Claude」）→ `tools/blender/render_preview.py` 出 4 角度預覽 → 使用者簽核 → `export_scene` 出 GLB 到 `public/models/` → `npm run models:optimize`。
商店商品圖（2D）走 `npm run art:shop`，不在 `models:optimize` 的預算檢查範圍內（目前 17 張共約 62 KB）。

## 提交
繁體中文一行 commit；不加 Co-Authored-By 標記。
