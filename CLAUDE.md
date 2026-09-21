# 小布丁農場（little-pudding-game）

three.js 網頁 3D 手機遊戲；先在 iPhone Safari 玩，後期用 Expo WebView 包 App。設計與 checkpoint 見記憶庫的計畫檔與 STATE.md。

## 指令
- `npm run dev -- --host`：開發（手機同熱點開 `http://<PC IP>:5173`；`?debug=1` 顯示 fps／draw calls／三角形數）
- `npm run build`：tsc 型別檢查＋vite build
- `npm test`：vitest（`src/game` 純邏輯）
- `npm run e2e`：Playwright（iPhone 視口，無頭 WebGL）
- `npm run models:optimize`：壓縮 `public/models/*.glb` 並檢查資產預算（超標 exit 1）

## 分層鐵則
- `src/game/`：純邏輯，**零 three.js 依賴**，所有規則（跳去哪、何時泡澡、何時突變）在這裡，vitest 全覆蓋；亂數走 `rng.ts` 可注入種子。
- `src/scene/`：只讀 state、播動畫，不改規則。
- `src/ui/`：HTML/CSS 疊層；圖示用 SVG，**不用 emoji**。

## 效能預算（AC 會擋）
每幀 draw calls ≤ 30；總面數 ≤ 50k；貼圖 ≤ 1024²；資產總量 ≤ 3 MB；每個 GLB ≤ 3k 面／300 KB；iPhone 中位數 ≥ 50 fps。
玻璃**不用** `transmission`（每幀多一次全場景 pass）。

## 美術管線
Blender MCP（`.mcp.json`，Blender 端要先按 Start MCP Server）→ `tools/blender/render_preview.py` 出 4 角度預覽 → 使用者簽核 → `export_scene` 出 GLB 到 `public/models/` → `npm run models:optimize`。

## 提交
繁體中文一行 commit；不加 Co-Authored-By 標記。
