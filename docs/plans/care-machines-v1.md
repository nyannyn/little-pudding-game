# 計畫：風味與焦糖離開澡盆，改成「手動保養動作 ＋ 三台自動機」

狀態：**已核准設計方向，實作延後**（2026-09-22，使用者說「紀錄進 STATE.md，我之後做」）。
決策編號**還沒佔**——落筆前重查（見末節「編號衝突」）。動手時把設計表與決策列寫進 `game-plan-v1.md`，這份檔只是工作計畫。

## 0. 使用者已定案的七件事

| 題目 | 選定 |
|---|---|
| 草莓要不要跟著改 | **兩種一起改**，並帶上已決定未實作的 D40（焦糖離開澡盆）→ 澡盆只剩「倒牛乳＝繁殖」 |
| 機器怎麼運作 | **手動撒 ＋ 另外買自動機**（照 D40 焦糖刷的模式） |
| 手動介面 | **點動作列進入選取 → 點布丁，對那一隻做** |
| 自動機顆粒 | **分開三台**，按等級陸續上架 |
| 焦糖成本 | **要扣焦糖庫存**（D35 的「沒料就停產」因果才維持成立） |
| 注液閥 | 改名**「自動注乳閥」**，只管牛乳，`preferredLiquid` 整個拿掉 |
| 消耗品命名 | 商店補給品叫**「宇治抹茶粉」**，抹茶布丁掉的原料維持「抹茶粉罐」 |

## 1. 現況盤點（本機實查，2026-09-22 15:0x）

**既有資產（專案內）**
- `src/game/species.ts:118-140`：`LiquidId = caramel|milk|matcha|strawberry`、`LIQUIDS` 表（`needsBasin`／`flavorFor`／`caramelAfterBath`／`unitPrice`）、`SPECIAL_LIQUIDS`
- `src/game/basin.ts`：`findBasinFor` 特殊盆 −1000 偏好、`pourIntoBasin` 的 `needsBasin` 守衛與「不准混液體」守衛、`consumeBathUnit`
- `src/game/pudding.ts:finishBath`：`caramelAfterBath` 補焦糖、`info.flavorFor` 累積曝露 → `pendingMutation`；`tickDrops` 的 `dropCaramelMin` 停產判定
- `src/game/balance.ts`：`flavorExposurePerBath`(8h)／`flavorThresholdSec`(48h)／`specialBasinPrice`(300)／`specialBasinLevel`{matcha:3,strawberry:5}／`EQUIPMENT` 五台
- `src/game/equipment.ts`：`autoFill`、`autoRestock`（basics=['caramel','milk']）
- `src/game/state.ts`：`stock`、`ownedBasins`、`Basin.{liquid,preferredLiquid,units,occupantId}`、`Pudding.{caramel,flavorExposure,bathLiquid,basinIndex}`、`SCHEMA_VERSION`／`migrate()`
- UI：`ui/hud.ts` 的「倒抹茶」動作鈕、`ui/shop.ts` 的「澡盆」分頁、`ui/hints.ts:26`、`ui/shopArt.ts` ＋ `tools/fetch-shop-art.mjs` 的 ART 表
- scene：`scene/basinMesh.ts`、`scene/equipmentMesh.ts`
- 測試：`tests/e2e/cp3-expansion.spec.ts:38-78`、`cp3-shop.spec.ts:56`、`cp3-pour.spec.ts`、`tests/unit/{economy:140, pudding:188, breeding:126/140/160/458}`、`tools/check-negative-controls.mjs`、`tools/pacing/`、`tools/playtest/`
- **`焦糖刷`／`caramelBrush` 在 `src/` grep 0 命中 → D40 只有決策、沒有實作**

**機器層／並行狀態（不在 repo）**
- 本機 master 與 `origin/master` **分岔**：本地多 3 個未推 commit（`6bc9043`／`9dea396`／`aa32de3`，WP7-1 InstancedMesh），origin 多 1 個（`eaf96e4` WebGL context lost，＝origin 那邊的 D44）
- **另一個 session 正在同一棵工作樹寫 code**（檔案 mtime 15:05，29 檔未提交）：正在做「設備每一區各買各的」，`state.equipment` 改成 `Record<zoneId, Record<EquipmentId,boolean>>`、`SCHEMA_VERSION` 5→6，並把它寫成 **D44**——與 origin/master 上已存在的 D44 **撞號**
- 其他 worktree：`lpg-wt-vending`(feat/vending-machine)、`lpg-wt-glcontext`(docs/state-d44-closeout)、`.claude/worktrees/shop-ui`（商店商品圖改自繪，**動過 `tools/fetch-shop-art.mjs` 的 ART 表**）

**缺口**：三台自動機的 mesh、三張商品圖、保養動作的選取模式 UI，全部沒有既有物可沿用。

## 2. 規則設計（先改 `docs/plans/game-plan-v1.md` 的設計表，再改 code）

### 2.1 澡盆只剩牛乳
- `LiquidId` 收成 `'milk'`；`needsBasin`／`flavorFor`／`SPECIAL_LIQUIDS`／`ownedBasins`／商店「澡盆」分頁全部移除
- `findBasinFor` 拿掉特殊盆偏好（只剩一種液體，偏好無意義）
- **`caramelAfterBath` 一併拿掉**：焦糖唯一來源改成「刷」。若泡牛乳還補焦糖，焦糖刷會半廢、D35 的停產因果又斷一次。（這條是我補的，不是使用者原話——列出來就是要被審）

### 2.2 三個保養動作（新檔 `src/game/care.ts`）
| 動作 | 吃什麼 | 效果 |
|---|---|---|
| 刷焦糖 | 焦糖 ×1 | `p.caramel = 100` |
| 撒抹茶粉 | 宇治抹茶粉 ×1 | `flavorExposure.matcha += flavorExposurePerCare`(8h)，滿 48h → `pendingMutation='matcha'` |
| 淋草莓醬 | 大湖草莓醬 ×1 | 同上，對 strawberry |

- **一個動作一個意義**：撒粉／淋醬**不補焦糖**（原本抹茶澡補 80）
- 突變仍是 6 次（8h × 6 ≥ 48h），跟現行泡 6 次澡完全同量級 → 節奏不變
- 庫存沿用 `state.stock` 的四個 key（**不刪 key，遷移最省**），只是 `caramel/matcha/strawberry` 從「液體」變「保養用品」
- 失敗（庫存 0／目標已是該物種）必須 `state` 完全沒動＋回錯誤訊息（沿用 actions 層既有紀律）

### 2.3 手動介面
動作列三顆鈕（刷焦糖／撒抹茶粉／淋草莓醬）→ 按下進入**選取模式**（鈕高亮、提示「點一隻布丁」）→ 點布丁執行 → 退出。再按一次或點空白取消。
鈕的出現條件＝該項庫存 > 0（同構於現在「買了澡盆才長出倒抹茶鈕」）。

### 2.4 三台自動機（新 `EquipmentId`）
| id | 名稱 | 取代 | 價格 | 等級 | tier | 行為 |
|---|---|---|---|---|---|---|
| `caramelBrush` | 自動焦糖刷 | 刷焦糖 | 80 | 1 | 1 | 區內 `caramel < batheThreshold`(30) 就刷，扣 1 份 |
| `matchaDuster` | 自動撒粉機 | 撒抹茶粉 | 300 | 3 | 2 | 區內尚未滿曝露的布丁定期撒，扣 1 份 |
| `berrySaucer` | 自動淋醬機 | 淋草莓醬 | 300 | 5 | 3 | 同上，對草莓 |

- 價格／等級直接沿用原本兩個特殊澡盆的 300／Lv.3／Lv.5，節奏不動
- **自動機是整區作用**：裝了撒粉機的那一區會整區變抹茶。搭配「設備每區各買各的」（並行 session 正在做的那條）剛好成為「抹茶區／草莓區分開養」的玩法。**商品描述要明講「這一區的布丁都會變成抹茶」**，否則玩家會覺得被偷改
- 新增 `careIntervalSec`（自動機作業間隔）到 `balance.ts`
- 自動機跳過「已經是該物種」的布丁（等同 `finishBath` 現有的 `p.species !== key` 守衛）

**⚠ 一個規則層的副作用，要使用者裁示**：裝了撒粉機的那一區會**持續**對所有布丁撒粉，而牛乳澡生下來的子代也在同一區。單親複製＋`gameteShiftChance` 之下，那一區會**收斂成純抹茶**——而 `sakura`（抹茶＋草莓）這種混種需要兩個不同等位基因共存，在裝了撒粉機的區裡就配不出來。三個選項：①接受（混種要在沒裝自動機的區手動配，自動機＝「量產純種」的工具）；②自動機加一個「只撒 N 次就停」或「只撒手動指定的那幾隻」的開關；③自動機只對**成年**布丁撒，讓新生代有一段不被污染的窗口。**建議①**，但要在商品描述講明白，否則玩家會覺得混種線莫名其妙斷掉。

### 2.5 連帶
- `autoFill` 只補牛乳、改名「自動注乳閥」，`Basin.preferredLiquid` 移除
- `autoRestock` 的 basics 維持 `caramel`+`milk`（焦糖仍是維生必需品）
- `hints.ts` 停擺提示從「倒焦糖」改指「刷焦糖」；新增「沒有焦糖庫存」的警告
- `orders.ts:17` 註解裡的「去買個抹茶澡盆」要改

### 2.6 存檔遷移（`SCHEMA_VERSION` ＝**動手當下讀到的值 +1**，不預先寫死——並行 session 的那一版還沒提交）
| 舊資料 | 補值方向 | 理由 |
|---|---|---|
| `ownedBasins` 含 `matcha`／`strawberry` | **送對應自動機，裝在「那個盆實際所在的那一區」**（`Basin.zone`），不是起始區 | 老玩家已經付過 300，不送＝默默沒收；設備改逐區之後（並行 session 那條），補到錯的區等於也沒收，而且**不會有測試紅** |
| `basins[].liquid ∈ {caramel,matcha,strawberry}` 且 `units>0` | 清空盆，`units` **退回 `stock`** | 不退＝默默沒收庫存 |
| 盆裡正在泡這些液體的布丁 | `mode='resting'`、`basinIndex=null`、`bathLiquid=null`、盆 `occupantId=null` | 不清會留下指向不存在液體的狀態，`LIQUIDS[liquid]` 查表炸掉 |
| `Basin.preferredLiquid` | 刪欄位 | — |
| `stock.matcha/strawberry` | **原值保留**（語意從液體變粉／醬） | 同樣是已付費的東西 |

## 3. 派工拆解

| # | 工作包 | 誰做 | 模板 | 驗收 | 串／並 |
|---|---|---|---|---|---|
| W0 | 確認落點、開分支、存基準線（`npm test`／`npm run e2e`／`npm run pacing` 各跑一次存檔） | 主對話 | — | 三份基準線輸出落檔 | 串（前置） |
| W1 | 改 `docs/plans/game-plan-v1.md`：設計表 ＋ D45／D46 兩列 | 主對話 | — | 使用者讀過核准 | 串 |
| W2 | game 層：`species.ts`／`basin.ts`／`care.ts`(新)／`pudding.ts`／`equipment.ts`／`balance.ts`／`actions.ts`／`shop.ts` | 主對話（規則耦合太緊，不派） | — | `npm test` 綠 ＋ 新負向對照會紅 | 串 |
| W3 | `state.ts` migrate ＋ 遷移測試（含「舊檔帶滿盆抹茶＋泡澡中布丁」那組） | 主對話 | — | 負向對照：拿掉退回庫存那段 → 紅 | 串（跟 W2 同批） |
| W4 | UI：動作列選取模式、商店收掉「澡盆」分頁、hints 文案 | 主對話 | — | e2e ＋ 使用者看畫面簽核 | W2 後 |
| W5 | scene：三台設備 mesh、拿掉特殊盆外觀分支、**重量 draw calls** | 主對話 | — | e2e `DRAW_CALL_BUDGET` 35 不破，實測數字寫進 STATE | W4 並行 |
| W6 | 三張商品圖（`tools/fetch-shop-art.mjs` ART 表）——**`.claude/worktrees/shop-ui` 剛改過這張表，先對齊再動** | 主對話 | — | `npm run art:shop` 產出 ＋ 商店頁無破圖 | W4 後 |
| W7 | 文案橫掃：`grep 澡盆` 全 `src/`＋`docs/`（掃的是「要買澡盆」這個事實主張，不是我列到的行號） | `ella-harness:Explore`（haiku，唯讀，只回檔案:行號） | 探索模板 | 逐處判定表 | W2 後並行 |
| W8 | 測試改寫：`cp3-expansion`／`cp3-shop`／`cp3-pour`／`economy`／`pudding`／`breeding`／`check-negative-controls`／`tools/playtest` | 主對話 | — | 全套綠 | W2–W5 後 |
| W9 | `npm run pacing` 改後再跑一次，跟 W0 基準線比 | 主對話 | — | 三個里程碑仍在 D24 目標內（≤20／≤45／≤90 分） | W8 後 |
| W10 | fresh-context 驗收 | `ella-harness:acceptor` | 驗收模板（只給驗收條件＋產物路徑） | 逐條判定 | 最後 |

## 4. 驗收條件（每條含判定方法與負向對照）

| # | 條件 | 判定方法 | 通過標準 | 負向對照（要真的紅過） |
|---|---|---|---|---|
| A1 | 撒 5 次不變、撒 6 次變抹茶 | `tests/unit/pudding.test.ts` 改寫 | 5 次 species 不變、6 次 `pendingMutation='matcha'` | 拿掉門檻比較 → 5 次那條紅 |
| A2 | 手動撒粉會扣庫存、庫存 0 時整個 state 不動 | 單元測試 | `stock.matcha` −1；0 時回錯誤且 state 深度相等 | 把「先扣再檢查」放回去 → 紅 |
| A3 | 自動撒粉機整區生效、沒庫存不動作 | 單元測試 | 有料時區內布丁曝露增加；無料時 0 變化 | 拿掉設備旗標判斷 → 手動／自動兩組結果變一樣 → 紅 |
| A4 | 焦糖庫存斷炊 → 布丁 caramel 歸零 → 停產 | 單元測試（沿用 D35 那組） | 跑六個 `dropIntervalSec` 一份都不掉；補料後恢復且不爆量 | — |
| A5 | 舊檔遷移不掉東西 | `tests/unit/persistence.test.ts`：造一份舊檔（盆滿抹茶 3 份、一隻布丁泡澡中、`ownedBasins:['matcha']`） | 遷移後：`stock.matcha` +3、有 `matchaDuster`、布丁 `mode='resting'`、無 crash | 拿掉退回庫存那段 → 紅 |
| A6 | e2e：買抹茶粉 → 點布丁撒 6 次 → 突變 → 掉抹茶原料 | `cp3-expansion.spec.ts` 改寫 | 全綠 | — |
| A7 | draw calls 不破預算 | `npm run e2e`（`DRAW_CALL_BUDGET=35`） | 15 隻＋三台新設備 ≤ 35，實測數字入 STATE | — |
| A8 | 節奏沒跑掉 | `npm run pacing` 前後比 | 上層／下層／二號櫥窗仍 ≤20／≤45／≤90 分 | — |
| A9 | 畫面簽核 | 截圖給使用者 | 使用者說可以 | — |

## 5. 落點與編號衝突（**要使用者裁示**）

1. **工作樹被佔用**：另一個 session 15:05 還在寫 `src/game/{state,shop,actions,equipment}.ts`、`src/ui/shop.ts`、`docs/plans/game-plan-v1.md`——與本計畫幾乎完全重疊，且兩邊都要動 `SCHEMA_VERSION`。**建議等它 commit 再開工**；要立刻開工就得另開 worktree，並接受之後一次大衝突。
2. **D 編號現況（2026-09-22 15:1x 實查全分支）**：
   - `origin/master` 的 **D44 ＝ 繪圖環境被系統回收（WebGL context lost）**
   - 本地 master 的計畫檔有 **D46（每個物種有自己的外觀）／D47（狀態卡改表情＋頭頂圖示）**，但 **D45 是空號**（被跳過）
   - 並行 session 的未提交改動把「設備逐區」也寫成 **D44 → 撞號**，它應該改成別的號
   - 本計畫**不預先佔號**：動手當下重查 `grep -o "^| D[0-9]*" docs/plans/game-plan-v1.md` 取最大值 +1（目前空號有 D45 與 D48 起）
   - **2026-09-23 01:2x 更新：上面三條已過期，撞號已解**。`origin/master`：D44 WebGL context lost／D45 設備逐區／D46 迷你販賣機；`feat/zone-capacity-15`：D47 物種外觀／D48 狀態卡改表情。照現況本計畫從 D49 起，W1 的「D45／D46 兩列」改成動手當下的實際號碼。`SCHEMA_VERSION` 在 `origin/master` 已是 6，第 1 點的工作樹佔用也已結束（設備逐區已 merge）
3. **分支**：本地 master 有 3 個未推的 WP7-1 commit 且與 origin 分岔。建議先把 master 對齊 origin 再開 feature 分支，否則 PR 會夾帶那三個 commit。
