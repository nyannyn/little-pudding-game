---
name: playtest
description: 從頭試玩小布丁農場找 bug／調機制的固定流程——無頭 iPhone 瀏覽器按 HUD 按鈕玩、state 作弊跳階段、幾何量測 HUD 遮擋、純規則節奏量表。使用者說「試玩」「重頭玩一次」「找 bug」「調節奏／機制」時用。
---

# 試玩流程（playtest）

遊戲沒有帳號：存檔只在瀏覽器的 localStorage，`?fresh=1` 就是新玩家。
「玩」分三層，由便宜到貴，每次試玩都從第 1 層做到第 3 層，不要只看截圖。

## 0. 前置

- 本機：`npm run dev`（5173）。**若 console 出現 `504 (Outdated Optimize Dep)`＝那個 dev server 是別的 session 起的、依賴快取過期，自己另起一個** `npx vite --port 5174 --strictPort`，腳本用 `LPG_BASE=http://127.0.0.1:5174`。
- 線上（已 commit 的版本）：`LPG_BASE=https://nyannyn.github.io/little-pudding-game`。修完 push 後**一定**用線上再跑一次，Pages 綠 ≠ 你的東西在線上。
- 有並行 session 在改 `src/` 時，Vite 會在測到一半整頁 reload（腳本症狀：click 逾時、log 出現 `navigated to`）。先 `git status` 看有沒有別人的未提交檔，有就對線上版跑。
- 網址參數：`fresh=1` 新存檔｜`seed=N` 固定亂數（同 seed 可重現）｜`fastTime=N` 一秒現實跑 N 秒遊戲｜`debug=1` 顯示 fps／draw calls｜`pw=` 布丁尺寸。
- 除錯把手：頁面上 `window.__lpg = { stats, state, three: { scene, camera, controls, raycaster } }`。改 `state` 就是作弊（給錢、開設備、塞訂單），腳本都靠它。

## 1. 純規則節奏（不開瀏覽器，幾百毫秒）

`npm run pacing`：勤勞玩家 bot 直接呼叫 `src/game/` 規則，印「第幾分鐘買到第一台設備／解鎖上層／第一張訂單成交」。
- 改 `balance.ts`／`zones.ts` 之前先跑一次存基準線，改完對照計畫 D24 的目標表。
- 曲線只看 equip-first 不夠，zone-first（先存錢擴張）也要看；後段「全買完後沒事做」要看 `coins 3000` 那一行。

## 2. 真的開網頁玩（Playwright 無頭 iPhone Chromium，同 e2e 那套）

腳本在 `tools/playtest/`，共用 `lib.mjs`（起瀏覽器、boot、投影 3D→螢幕、截圖、狀態摘要）。截圖落 `docs/previews/playtest/`（gitignored）。

| 腳本 | 玩什麼 | 看什麼 |
|---|---|---|
| `opening.mjs` | 新手：**只按 HUD 按鈕、照引導做，不改 state**（`FAST=4 MIN=8`） | 引導有沒有卡在同一句、第一次出貨／第一台設備／第一張訂單幾分鐘、toast 文案、console error |
| `midgame.mjs` | 作弊跳階段：全自動 5 分鐘 → 解鎖三區＋拉遠 → 牛奶突變 → 晚期商店 | draw calls ≤ 預算、切區後住客／盆／設備跟著換、toast 有沒有蓋布丁、突變演出、全買完還剩什麼 |
| `offline.mjs` | 存檔撥回 30 分鐘前重開（庫存充足／用完兩組） | 歡迎卡數字合理、停擺有講、回來的引導句 |
| `layout.mjs` | 兩種寬度（390／320）最壞情況：切換列＋長名住客＋三張訂單＋五份原料＋警告泡泡 | **bounding box 判定**：HUD 互不疊、‹ › 點得到、訂單卡不蓋布丁／原料、布丁投影在 topbar 底～dock 頂之間。exit 1＝有疊 |
| `taps.mjs` | 點畫布：澡盆、原料、鎖著的層、另一層 | 投影座標 mouse.click 後 state 有沒有變。exit 1＝點不到 |
| `shop-click.mjs` | 商店按鈕點擊延遲 ×3 | >1 秒或「element was detached」＝頁面在定時重寫 innerHTML，是產品 bug |

從頭玩一次的順序：`pacing` → `opening` → `taps` → `layout` → `midgame` → `offline` → `shop-click`，每支都看 `errors:` 那行。

## 3. 看圖與量圖

- 截圖用 Read 讀進來看；**顯示類 bug（疊／蓋／消失）常零 console 訊號，第一步就是截圖**。
- 眼睛量不到 1px：用 `hudBoxes()`＋`projectedActors()` 比矩形；卡片在可捲動欄裡要跟欄的可見範圍取交集。
- 「HUD 有沒有蓋住遊戲區」要用**3D 投影座標對 HUD 矩形**，HUD 對 HUD 全綠不代表沒蓋到布丁。

## 4. 找到問題之後

1. 先在最便宜的層重現（規則 bug 用 vitest 一段 `advance()`；顯示 bug 用幾何量測）。
2. 修 → 寫回歸鎖（vitest 或 `tests/e2e/*.spec.ts`，幾何類照 `cp3-hud-band.spec.ts` 的寫法）。
3. **負向對照要真的紅過**：把修法還原（反向 sed，不用 `git checkout --`），跑一次看它紅，再還原回來。
4. 規則／數值改動先寫進計畫檔 `plans/game-plan-v1.md` 的決策表（D 編號），再改 code。
5. push 後對線上再跑一次同一支腳本。

## 已知限制（別當 bug 報）

- SwiftShader 軟體渲染：fps 沒意義、每幀 100–200ms，Playwright 的「元素穩定」檢查會慢；draw calls／三角形數是真的。
- 沒有真手指、safe-area、iOS 字級偏好；「手機上好不好玩」仍要使用者實機。
- 非啟用區不畫布丁與設備（draw call 預算），拉遠時其他層看起來是空的但名牌寫住客數——這是取捨不是 bug。
- `midgame`／`offline` 用 state 作弊，數值不代表真實節奏；節奏看第 1 層。
