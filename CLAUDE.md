# 小布丁農場（little-pudding-game）

three.js 網頁 3D 手機遊戲；先在 iPhone Safari 玩，後期用 Expo WebView 包 App。**動手前先讀 `docs/STATE.md`**（五區塊續跑檔＋checkpoint 進度表），離開前先寫回。遊戲設計定稿與決策在 `docs/plans/game-plan-v1.md`，**要改遊戲規則先改那份的設計表再改 code**。機器層資訊（本機路徑、帳號識別碼、內網設定）與手機截圖證據**刻意不放這裡**，在本機私有記憶庫；讀不到就直接問使用者，不要自行猜。

## 語言
本專案的工作語言是**繁體中文**：與使用者的對話、PR／issue 說明一律用繁體中文（commit 見最後一節）。
程式碼、識別字、檔名、API 名稱、技術術語依各自慣例，不要硬翻。

## 指令
- `npm run dev`：本機開發
- `npm run build`：tsc 型別檢查＋vite build
- `npm run preview`：跑正式建置（**Service Worker 只在 PROD 註冊，要驗 SW／離線就用這個**）
- `npm test`：vitest（`tests/unit/**`，覆蓋率只算 `src/game`）
- `npm run e2e`：Playwright（iPhone 視口，無頭 WebGL）
- `npm run pacing`：無頭跑 3 小時遊戲時間，印每個里程碑在第幾分鐘（調數值前後各跑一次）；`PACING_ONLY=month PACING_JSON=<檔> npm run pacing` 跑 30 天月玩家（約 5 分鐘），再 `node tools/pacing/ac11-12.mjs <檔>` 判星級與常客節奏（AC11-12）
- `npm run playtest`：從頭試玩找 bug 的整套腳本（`tools/playtest/`）；流程與判讀見 `.claude/skills/playtest/SKILL.md`
- `npm run smoke:live`：對正式建置或線上網址跑整頁煙霧測（`LPG_BASE` 指定網址）
- `npm run models:optimize`：壓縮 `public/models/*.glb` 並檢查資產預算（超標 exit 1）
- `npm run art:shop`：重抓商店商品圖（Microsoft Fluent Emoji 3D，MIT，釘 commit）縮成 160px WebP 到 `src/assets/shop/`；授權全文在同目錄 `LICENSE.txt`。只在改 `tools/fetch-shop-art.mjs` 的 ART 表時才需要重跑，輸出已進版控
- 網址參數：`?debug=1` 在**設定卡（右上角齒輪）裡**顯示 fps／draw calls／三角形數、顯示卡與存檔狀態（原本是畫面左下的常駐浮層，D38 搬進去的；沒帶參數時連設定卡裡也不會出現）、`?fresh=1` 開新檔（**測試模式**）、`?seed=N` 固定亂數、`?fastTime=N` 倍速、`?pop=N` 指定布丁隻數、`?noPudding=1` 不載布丁、`?dpr=N`／`?aa=0` 降解析度與關 MSAA（查效能）、`?view=bakery` 直接開在甜點工坊（e2e／截圖用）
- 手機實測走 GitHub Pages：push `master` 自動部署到 `https://nyannyn.github.io/little-pudding-game/`（`.github/workflows/pages.yml`）；PC 沒有 Wi-Fi 卡且防火牆擋 5173 入站，區網直連不可行

## 分層鐵則
- `src/game/`：純邏輯，**零 three.js 依賴**，所有規則（跳去哪、何時泡澡、何時突變）在這裡，vitest 全覆蓋；亂數走 `rng.ts` 可注入種子。
- `src/scene/`：只讀 state、播動畫，不改規則。
- `src/ui/`：HTML/CSS 疊層；圖示用 SVG，**不用 emoji**。
- **原料／成品櫃／展示架帶星級（D64），讀寫一律經 `src/game/stock.ts`**：`tests/unit/stockAccess.test.ts` 掃 `src/` 與 `tools/`，直接索引 `ingredients[`／`.desserts.`／`shelf[` 就紅。`tools/` 在瀏覽器裡改庫存用 `window.__lpg.stock.set/add/of`（`tools/` 不在 tsconfig，tsc 管不到，寫錯只會靜默算錯）。

## 存檔
- localStorage，玩家那格 key 是 `lpg.save.v1`（`src/game/storage.ts`）；每 5 秒（真實時間）＋切到背景＋關分頁各存一次。
- **`?fresh=1` 是測試模式，寫到另一格 `lpg.save.test`**，玩家那格一個位元組都不碰（曾經共用同一格，在自己手機上開一次測試網址就把進度洗掉）。
- **`GameState` 加欄位一定要同步改 `migrate()` 並升 `SCHEMA_VERSION`**，而且舊檔補值要補對方向——補錯不會有測試紅，只會讓老玩家的存檔靜默走樣。
- 離線結算靠 `lastSeenAt`，上限 8 小時（`BALANCE.offlineCapSec`）。
- 存不進去（無痕／被擋）時退回記憶體、遊戲照玩，但要提示玩家；**不可以靜默失敗**。
- **`save()` 是有守衛的寫入，不是無條件覆蓋**（D37）：每份存檔帶 `rev`，發現別的分頁寫過就比 `progressScore()`，進度少的那一份寫不進去而且從此停寫。判分**只能用單調遞增的欄位**（`xp` 與 `stats` 累計次數）——用 `coins` 會被花掉、用 `time` 會被 `settleOffline` 推高，拿它們判新舊會讓過期的舊分頁贏。
- **備份格 `<key>.bak` 走同一條分數規則**，只在進度變高時更新；主格讀不到時 `load()` 自動從備份還原（`source: 'backup'`）。備份要是也用無條件寫入器去寫，它會跟主格一起被寫空，等於沒有備份。
- **存檔碼（`savecode.ts`）是玩家唯一帶得走的備份**：`LPG1.<base64url>.<檢查碼>`，匯入一律過 `migrate()`，壞碼回 `null`。**匯入後要先停掉這一頁的自動存檔再 `location.reload()`**——不然 `pagehide` 會把匯入前那份狀態原封不動蓋回去。

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
- **視覺簽核一定要給使用者一個手機打得開的網址**：使用者是在手機上看效果，`localhost`／區網網址在手機上打不開，截圖只能當輔助、不能取代。目前唯一能給的網址是 GitHub Pages（只部署 `master`），所以視覺類改動的收尾流程是：開 PR → merge（低風險直接 merge，其餘先問，判準見「提交」） → 等 Pages 部署跑完（`gh run watch` 或查 Actions 綠）→ 確認線上版已是新 build → 附上 `https://nyannyn.github.io/little-pudding-game/`（需要時帶 `?fresh=1` 等參數）請使用者看。不要只丟 PR 連結或本機截圖就當作「請簽核」。

## 完成與回報
- **沒有實跑或 read-back 證據，不得宣告完成。** `npm run build`（tsc）綠只代表型別沒錯，不代表功能會動；碰到畫面或互動就要真的把頁面開起來跑過。
- 回報前逐條稽核：每個「已完成」的宣稱都要有本次留下的工具輸出當證據，沒有就明標「未驗」。失敗與跳過的部分如實講，不要只報跑通的那幾條。

## 美術管線
Blender MCP（`.mcp.json`；Blender 端側欄分頁「MCP for Blender」按連線鈕，**按鈕名稱隨 addon 版本變**，本機 4.5 是「Connect to Claude」）→ `tools/blender/render_preview.py` 出 4 角度預覽 → 使用者簽核 → `export_scene` 出 GLB 到 `public/models/` → `npm run models:optimize`。
布丁本體不必開 Blender 介面：`blender --background --python tools/blender/build_pudding.py -- --out public/models/pudding_base.glb --preview docs/previews/pudding_base` 一條龍（建模＋預覽＋匯出；`shade_auto_smooth` 在背景模式失效，腳本已改用資料 API）。GLB 的 `Pudding_Body` 是本體／焦糖／腮紅併成的一顆 mesh，頂點色層 `Mask` 是遮罩不是顏色（R 本體、G 焦糖、B 腮紅），顏色在 `src/scene/puddingPool.ts` 的 shader 從 instance 屬性混出來——**改布丁外觀兩邊都要看**。
商店商品圖（2D）走 `npm run art:shop`，不在 `models:optimize` 的預算檢查範圍內。
甜點工坊（D51）**不用 Blender**：房間與五台機器是 `src/scene/bakery/room.ts` 用程式拼的圓角幾何，顏色寫在頂點色、整間併成一個 mesh（D46 做法）；會動的部件在 `bakeryView.ts`。簽核截圖：`node tools/shoot-bakery.mjs <輸出資料夾>`（`LPG_BASE` 指向這棵樹的 dev server）。

## 提交
- 繁體中文一行 commit；不加 Co-Authored-By 標記。
- **開分支走 PR，不要直接推 `master`**：push `master` 會立刻部署到 GitHub Pages 上線。使用者同意後由 Claude 執行 merge。
- **低風險的 PR 不用問，CI 綠就直接 merge**（2026-09-23 使用者授權，為了加快開發）：只動文件，或小範圍的畫面／文案／數值微調，而且 `npm run build` 與 `npm test` 都綠。merge 完照「測試紀律」的流程給線上網址。**以下情況仍要先問**：動到存檔（`GameState`／`migrate()`／`storage.ts`／`savecode.ts`）、Service Worker、`.github/workflows/`、遊戲規則（要先改計畫檔的設計表）、刪除東西，或自己也拿不準影響範圍的改動。
