# 小布丁農場（little-pudding-game）

three.js 網頁 3D 手機遊戲；先在 iPhone Safari 玩，後期用 Expo WebView 包 App。設計與 checkpoint 見記憶庫的計畫檔與 STATE.md。

## 指令
- `npm run dev`：本機開發；`?debug=1` 顯示 fps／draw calls／三角形數
- 手機實測走 GitHub Pages：push `master` 自動部署到 `https://nyannyn.github.io/little-pudding-game/`（`.github/workflows/`）；PC 沒有 Wi-Fi 卡且防火牆擋 5173 入站，區網直連不可行
- `npm run build`：tsc 型別檢查＋vite build
- `npm test`：vitest（`src/game` 純邏輯）
- `npm run e2e`：Playwright（iPhone 視口，無頭 WebGL）
- `npm run pacing`：無頭跑 3 小時遊戲時間，印每個里程碑在第幾分鐘（調數值前後各跑一次）
- `npm run playtest`：從頭試玩找 bug 的整套腳本（`tools/playtest/`）；流程與判讀見 `.claude/skills/playtest/SKILL.md`
- `npm run models:optimize`：壓縮 `public/models/*.glb` 並檢查資產預算（超標 exit 1）

## 分層鐵則
- `src/game/`：純邏輯，**零 three.js 依賴**，所有規則（跳去哪、何時泡澡、何時突變）在這裡，vitest 全覆蓋；亂數走 `rng.ts` 可注入種子。
- `src/scene/`：只讀 state、播動畫，不改規則。
- `src/ui/`：HTML/CSS 疊層；圖示用 SVG，**不用 emoji**。

## 效能預算（AC 會擋）
每幀 draw calls ≤ 35（2026-09-22 由 30 上調，見計畫 D31：繁殖讓一層住到 3 隻，每隻 +5）；總面數 ≤ 50k；貼圖 ≤ 1024²；資產總量 ≤ 3 MB；每個 GLB ≤ 3k 面／300 KB；iPhone 中位數 ≥ 50 fps。
玻璃**不用** `transmission`（每幀多一次全場景 pass）。

## 美術管線
Blender MCP（`.mcp.json`，Blender 端要先按 Start MCP Server）→ `tools/blender/render_preview.py` 出 4 角度預覽 → 使用者簽核 → `export_scene` 出 GLB 到 `public/models/` → `npm run models:optimize`。

## 提交
繁體中文一行 commit；不加 Co-Authored-By 標記。
