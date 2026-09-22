# STATE — little-pudding-game（小布丁農場）

續跑檔：**開場先讀這份**，離開前先寫。機器層（本機路徑、帳號識別碼、內網與防火牆設定）與手機截圖證據不在這裡，留在私有記憶庫的 `projects/little-pudding-game/`。

## Verified facts
- **公開 repo `nyannyn/little-pudding-game` 已建（2026-09-21 第四場，使用者自己跑 `gh repo create`）**，remote `origin`、分支 `master`；最新 commit `715ddaa`。**GitHub Pages 已通**：`https://nyannyn.github.io/little-pudding-game/`，push master 自動部署（workflow build＋deploy 皆綠）；線上頁面用 iPhone 視口無頭實開過：布丁／名牌／鎖都在、20 draw calls、GLB 200 23,240 bytes。
- `tools/shoot-viewport.mjs` 吃 `LPG_BASE` 環境變數可指向線上網址（預設 `http://127.0.0.1:5173`）。
- Blender MCP 上游已改名（2026-09-21 實查 PyPI＋README）：套件 `blender-mcp` → **`mcp-for-blender`**，repo → `github.com/ahujasid/mcp-for-blender`；`blender-mcp` 只剩相容 wrapper。**本 repo `.mcp.json` 寫的 `uvx mcp-for-blender` 已是正確新名，不需改**。
- **不必重開 Claude Code 也能驗 addon 端**：addon 在 `127.0.0.1:9876` 收裸 TCP JSON，`{"type":"<工具名>","params":{}}` → `{"status":"success","result":...}`；debug MCP 接不通時可用這招切開「addon 沒起來」vs「MCP server／PATH 問題」。
- Blender 端 UI（**讀 addon 原始碼驗過**，`blender_mcp.py:4286/4411`）：側欄分頁 `MCP for Blender`，按鈕 **Connect to Claude**。install-addon 自己印的提示字「click Start MCP Server」是過時文案，不要照著找。
- winget ID 實查有效：`BlenderFoundation.Blender`（5.2.1）、`BlenderFoundation.Blender.LTS.4.5`（4.5.10）、`astral-sh.uv`（0.12.17）。
- three r186 已移除 `PCFSoftShadowMap`（用 `PCFShadowMap`＋`shadow.radius`）。
- **CP0 已綠（2026-09-21 第三場）**：MCP `get_scene_info` 回預設場景（Cube/Light/Camera、materials_count 2），與上一場裸 socket 的結果同一份；`get_addon_status` 回 addon 1.7／protocol 7／expected 7 相符、`blender_version` 4.5.10 LTS、`up_to_date: true`。
- **陰影 pass 會被記進 `renderer.info.render.triangles`（2026-09-21 實測）**：布丁 mesh 1228 面，e2e 量到的差值是 **2456＝剛好 2 倍**（`castShadow=true`）。算 AC 的三角形預算一律要乘 2。
- **布丁細節的限制已經換成 AC1-1 的上限，不是資產預算**：差值 2456／上限 3000，只剩 544＝**272 個 mesh 面**的空間（乘 2）。之後要加嘴巴、加細分、CP4 美術擴充，先撞到的是 AC1-1 的天花板而不是 `optimize-models.mjs` 的 3k 面。要加量就得同步調 AC 區間並在計畫檔記一筆。
- **CP1 場景實測數字（一隻布丁）**：`?noPudding=1` → 204 面／6 draw calls；含布丁 → 2660 面／**14 draw calls**。兩隻布丁預估 22 draw calls，預算 30——CP3 要加澡盆／設備／掉落物時剩餘額度很窄，新增物件前先算。
- **改 GLB 節點的 transform 一律「乘原始值」，不可以寫絕對值**（2026-09-21 使用者回報「小布丁的眼睛被拉長，澡盆裡才是正常狀態」）。閉眼動畫把 `eyes.scale.y` 設成 1，但 `Pudding_Eyes` 在 GLB 裡的原始縮放是**等比 0.1387**——等於把眼睛拉高 7.2 倍；泡澡時設的 0.12 剛好接近原始值，所以只有泡澡看起來對。修法是建構時記下 `eyeBaseY`，之後乘係數（泡澡 0.22、平常 1）。
- **回歸鎖用「比值」不用絕對數字**：`tests/e2e/cp3-pudding-look.spec.ts` 斷言 `Pudding_Eyes` 的 `scale.y / scale.x ≈ 1`（該節點本來就等比縮放），換模型改尺寸都不必改測試。負向對照實跑過：改回絕對值寫法，比值 7.21、測試紅。
- GLB 節點的原始 transform（`node tools/…` 讀出來，2026-09-21）：`Pudding_Body` S 0.5、`Pudding_Caramel` S 0.399、`Pudding_Eyes` S 0.1387、`Pudding_Blush` S 0.3483，全部等比，`Pudding_Root` S 1。
- **PWA 已上線（2026-09-21 第四場）**：`public/manifest.webmanifest`（standalone／portrait／相對 start_url 與 scope）、`public/icons/*`（`tools/make-icons.mjs` 用 Playwright 把 SVG 畫成 192／512／180 PNG，iOS 只吃 PNG）、`public/sw.js`。**SW 兩種策略分開用**：HTML network-first（cache-first 會讓玩家永遠停在舊版且看起來完全正常），其他同源資產 stale-while-revalidate（Vite 檔名帶雜湊）。
- **SW 有兩個踩過的坑，都已修且有測試守**：
  1. **`Vary: Origin` 會讓快取完全 miss**。GitHub Pages 對靜態資產回 `Vary: Origin`；用 URL 字串寫進快取的 Request 沒有 Origin 標頭，但瀏覽器抓 module script 的 Request 有 → Vary 比對不過 → 離線時 JS／CSS 全部 `ERR_FAILED`，而快取裡明明有。`caches.match` 一律要帶 `{ ignoreVary: true }`。實測分辨法：`caches.match(url)` 命中但 `caches.match(實際 request)` 不命中。
  2. **第一次載入時 SW 還沒接管**，那一輪的 JS／CSS／GLB 是繞過 SW 抓的，不會進快取 → 「加入主畫面後第一次離線開」會是白畫面。解法是頁面載完把 `performance.getEntriesByType('resource')` 的同源清單 postMessage 給 SW 去補（不用在 install 寫死檔名，Vite 的雜湊檔名寫死就得多一個建置步驟）。GLB 在 load 之後才抓，要等 `ensureViews()` 完再送。
- **SW 只在 `import.meta.env.PROD` 註冊**：dev 也會服務 `public/`，快取住 dev 資產會讓 HMR 行為很難查。所以 SW 的驗證不在 Playwright e2e（跑 dev server），而在 `tools/smoke-live.mjs`（跑正式建置或線上）。本機要驗就 `vite build` ＋ `vite preview` 再把網址傳給它。
- **新手引導完全從 state 推導**（`src/ui/hints.ts`），沒有「教學進度」欄位——少一個欄位就少一條要 migrate、會跟實際狀態不同步的路徑。結束條件＝買下第一台自動化設備。目前步驟曝露成 `.hint[data-hint]`，測試與 debug 都靠它（**斷言不要用文字：元素隱藏時 textContent 還在，會誤判成沒變**）。
- **Git Bash 會把 `VITE_BASE=/little-pudding-game/` 這種以 `/` 開頭的值改寫成 `C:/Program Files/Git/little-pudding-game/`**（MSYS 路徑轉換）。本機驗 base 前綴要加 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`，而且**驗的時候要用 `startsWith` 不要用 `grep` 子字串**——被改寫後的路徑仍然含有 `/little-pudding-game/assets/`，子字串比對會假性通過（本 session 踩過一次）。CI 跑在 Linux 上沒這問題。
- **線上網址已可玩（2026-09-21 第四場實測）**：`https://nyannyn.github.io/little-pudding-game/`，remote sha `f3ae744`。`npm run smoke:live`（`tools/smoke-live.mjs`）對**線上**跑八項全過：tris 7886、**draw calls 23/30**、模擬有推進、倒焦糖進得了澡盆、布丁自己跳進去泡、console 無錯誤、無 404。截圖 `docs/previews/live-smoke.png`。
- **部署驗證要分兩層**：CI 的 `Verify build output` 只驗檔案層級（index.html 在不在、GLB 有沒有進 dist、base 前綴對不對）；資產 404、GLB 載入失敗、shader patch 在正式建置下靜默失效，只有真的開一次才看得到——那是 `tools/smoke-live.mjs` 的工作。
- **draw call 實測（2026-09-21 第四場，iPhone 14 視口／SwiftShader）**：開局 23、泡澡 24、有掉落物 25、五台設備全裝 27、**最壞情況（全設備＋5 份掉落物＋粒子）28**；分區改版後：上層 17、二號櫥窗 25、拉到最遠 25。預算 30。**只剩 2 個額度**——再加任何新 mesh 之前先算，或把布丁的 body/caramel/blush 併成 vertex color 單一 mesh（眼睛要留著做閉眼）。
- **布丁的 `castShadow` 已收斂成只有 `Pudding_Body`**（原本四個 mesh 全投影）：省 6 個 draw call（兩隻）。代價是 AC1-1 的三角形差值公式改成每隻 1228＋468＝1696。
- **`window.__lpg.state` 已曝露真正的 `GameState`**（型別在 `src/debug/stats.ts` 宣告），e2e 全部靠讀它做斷言。`?fresh=1` 開新檔、`?seed=` 固定亂數、`?fastTime=N` 加速遊戲時間。
- **啪嘰音效用 WebAudio 現場合成**（`src/scene/audio.ts`），沒有 mp3 資產；iOS 要在第一次 pointerdown/touchend 解鎖 AudioContext。

## 繁殖與配種（2026-09-22 第六場，使用者要求「過一段時間自動繁殖，不同屬性培養不同種類」）

- 計畫新增 **D28**（基因型＝兩個等位基因，`species` 降級成 `phenotype(genes)` 的快取）、**D29**（`zoneCapacity`＋溢出規則）、**D30**（澡盆曝露影響配子）、**D31**（draw call 預算 30→35）。
- 新檔 `src/game/genetics.ts`（配種規則）與 `src/game/breeding.ts`（觸發與落點）；`SCHEMA_VERSION` 升到 **3**。
- **物種從 4 種變 10 種**：4 純種＋6 混種（`custard`／`hojicha`／`brulee`／`matchalatte`／`berrymilk`／`sakura`）。**配種表只有一份資料**——`SPECIES[*].alleles`，`GENOTYPE_TO_SPECIES` 由它反推，加混種只要加一條物種資料。顯示名稱使用者已簽核「甜點店風」那套。
- **`species` 只能由 `genetics.applyGenes()` 寫**。突變（牛奶過載／風味曝露）改成寫純合基因型——只改 `species` 的話，泡成鮮奶酪的布丁還是會傳焦糖等位基因給子代。不變式 `species === phenotype(genes)` 有測試守，負向對照（手動改 `species`）確實會紅。
- **每隻布丁剛好 +5 draw calls／+1696 面（2026-09-22 實測 `?pop=N`）**：無布丁 13、1 隻 18、2 隻 23、3 隻 28、4 隻 33、5 隻 38。新增的 `?pop=N` 參數走 `createNewSave({puddingCount})`，量測用。
- **`npm run pacing` 抓到真 bug**：第一版繁殖三小時只生一隻——起始區生一隻就滿員（上限 3），而每個新解鎖區只送一隻住客、一隻湊不成一對，於是全場卡死。加了**溢出規則**（雙親那區滿了就落到住客最少的已解鎖區）後：住客 5→12、三小時泡澡 921→1807、收入 9.5k→18.4k，里程碑 上層 12.1 分／下層 25.2／二號 36.7（D24 目標 20／45／90，仍達標但明顯變快）。
- **教訓：新機制要用 `npm run pacing` 跑一次再說「做完了」**。單元測試只證明「條件對的時候會生」，量表才看得出「實際玩起來幾乎不會生」。
- `movePudding()`（搬家，玩家配種的直接槓桿）規則層完成、**UI 尚未接線**。
- **混種經濟已實測，不是只有單元測試**：`tools/pacing/pacing.test.ts` 加了 `hybrid` 情境（開局一隻卡士達）。三小時 **15 張混種訂單全部成交、0 過期**，收入 18.4k→28.5k（＋55%）、物種維持 caramel＋custard。**原本的三個情境全是純焦糖（0 張混種訂單），等於完全沒驗到混種**——加新物種時量表也要跟著加情境，否則數字看起來有覆蓋、其實沒有。
- **AC1-1 的面數區間（2000–5000）只涵蓋「開局兩隻」**：繁殖上線後穩定狀態是一層三隻＝5088 面，超出是預期不是退步；e2e 用 `?fresh=1` 固定兩隻所以照樣綠，要量三隻用 `?pop=3`。
- **使用者決定（2026-09-22）**：混種名稱用「甜點店風」那套（已實作，不必改）；draw call 預算 **30 → 35**（D31），三個 e2e 斷言改讀 `tests/e2e/helpers.ts` 的 `DRAW_CALL_BUDGET`，只有一處要改。**代價**：AC1-3（iPhone 中位數 ≥ 50 fps）要在「一層住三隻」的狀態下驗，退路是 body／caramel／blush 併成 vertex color 單一 mesh。
- **已上線（2026-09-22）**：commit `464555f` 推上 master，Pages workflow 35632493613 綠、`headSha` 相符。**「Pages 綠 ≠ 東西在線上」照規矩驗過**：抓線上 bundle `assets/index-CqmyR_ZL.js` grep 只有新版才有的字串（櫻花抹茶布丁／卡士達布丁／幼布丁／焙茶布丁）四個都在。`npm run smoke:live` **15 項全過**（draw calls 23/35）。
- **線上正式建置也實測過繁殖**（不是只有 dev server）：餵飽雙親 → 2→3 隻、draw 23→28、三角形**正好 +1696**（＝一隻布丁）、console 無錯誤。跑法：腳本要放 repo 內跑（**ESM 不吃 `NODE_PATH`**，放 scratchpad 會 `ERR_MODULE_NOT_FOUND`），跑完即刪。
- **並行 session 在同一個 repo 工作（2026-09-22 實例）**：我做繁殖時對方 commit 了 `77bba74`（tools/playtest＋playtest skill），HEAD 從 `aca34d5` 移到它。兩邊都改到 `CLAUDE.md`，**commit 前有實查 `git show --name-only` 比對重疊、再看自己的 diff 確認沒蓋掉對方的兩行**。同 repo 並行時這一步不能省。
- **驗證證據（2026-09-22）**：vitest **103 passed**（新增 33 條，含 10 條負向對照）、`npm run build` 綠、`npx playwright test` **16 passed** 後再加 `cp3-breeding.spec.ts` 2 條。
- **新 e2e `cp3-breeding.spec.ts` 判定用幾何不用 state**：斷言三角形數多出一隻布丁的量（1696），因為 `puddings.length` 對、畫面卻空白（漏接 birth → `ensureViews()`）才是最可能的錯法。**負向對照實跑過**：把 `main.ts` 的 `void ensureViews()` 註解掉 → 第 58 行三角形斷言紅；還原後綠（還原用反向 sed，不用 `git checkout --`）。
- **踩過的坑：e2e 跑到一半改 `src/`，Vite HMR 會重新載入頁面**，測試看到的是「element was detached / 非預期 navigation」，看起來像產品 bug。第一次全跑 2 failed 全是這個原因，停手後重跑 16 passed。**跑 e2e 期間不要碰 `src/` 與尚未執行到的 spec**。
- **`tools/playtest/` 是未提交的檔案且不是本 session 產生的**（mtime 01:08–01:17，我沒寫過）——疑似並行 session 或使用者自己的腳本，**沒有動它、也不要一起 commit**。

## 出貨吃掉訂單的 bug（2026-09-22 使用者回報「焦糖布丁塔出貨後沒有解開任務」）

- **成因是「同一條規則寫了兩份」**：`equipment.autoSell`（在 `game/`、有單元測試）會扣掉「進行中訂單的預留量」再賣；但手動「出貨」按鈕在 `main.ts` 自己抄了一份**沒有預留**的版本。訂單 ×2 而手上只有 1 份時，那份會被當多餘甜點賣掉 → 永遠湊不到第二份 → 玩家按了出貨、拿到零錢、訂單一直掛著。
- **修法：規則搬回 `game/`**。新增 `actions.shipDesserts(state, emit, auto)`，手動與自動**共用同一個函式**；`autoSell` 現在只是呼叫它。
- **教訓（通則）：UI handler 裡不准有規則**。單元測試覆蓋率再高也照不到 `main.ts` 的按鈕邏輯——這個 bug 就是在「規則層全綠」的情況下出貨的。看到 `main.ts` 裡出現迴圈＋條件判斷，就該搬進 `game/`。
- **兩層負向對照都實跑過**：把 `- reserved` 拿掉 → 單元測試「那份不可以被賣掉」紅、e2e `cp3-order-ship.spec.ts` 也紅（`Expected: 1, Received: 0`，正是使用者描述的症狀）；還原後兩層都綠。
- e2e 一定要**真的點那顆按鈕**（`cp3-order-ship.spec.ts`），因為壞的是按鈕那條路不是規則。

## 效能診斷：卡的是畫素不是內容（2026-09-22）

- 使用者回報「畫面好卡」：**PC 開線上網址、持續低 fps、繁殖之前就有點卡** → 與繁殖無關。
- **實測四種視窗大小，draw calls 全都是 23 一個沒變，fps 卻從 4 掉到 0**——瓶頸是每幀要塗的畫素量，不是場景複雜度。iPhone 直向 1.32 Mpx；PC 1920×1080 dpr1.5＝**4.67 Mpx（3.5 倍）**。
- **無頭環境本身就是「沒有硬體加速」的樣本**：gpu 字串 `ANGLE … SwiftShader driver`，1.04 Mpx→4 fps、0.26 Mpx→32 fps（畫素砍 4 倍、fps 變 8 倍）。**遠端桌面連線常讓 Chrome 退回軟體渲染**，要先確認 `chrome://gpu` 的 WebGL 是 Hardware accelerated 還是 Software only，否則優化方向會全錯。
- 已加診斷（未 commit）：`?debug=1` 面板多顯示解析度／dpr／Mpx／**顯示卡字串**；`?dpr=N`、`?aa=0` 兩個旋鈕現場 A/B。
- 若確認有硬體加速、只是視窗大：正解是**直向手機遊戲在 PC 上不要把畫布拉滿視窗**，改成手機比例畫框，畫素量直接少一個量級。

## 商店改版＋店長等級（2026-09-22 第七場，使用者要求「參考開心農場美化商店、隨等級解鎖、每件商品要有吸引人的圖片」）

- **使用者三個決定（AskUserQuestion）**：等級用**真的 xp 存檔欄位**（不是從 stats 推導）；商品範圍＝**現有商品＋大桶裝補貨**；插圖＝**下載精緻的免費素材包**。
- 計畫新增 **D25**：`GameState.xp` 只增不減，`levelFor()` 查 `BALANCE.levelXp`（10 級）推等級，不另存 level 欄位。xp 來源 `BALANCE.xp`（泡澡 2／撿 1／加工 3／賣甜點 2／賣原料 1／訂單 10／突變 40／生小孩 30），**自動化做的也給 xp**（不然裝了設備等級就停）。**`SCHEMA_VERSION` 4**（第六場繁殖用掉 3）；舊檔沒 xp 用 `xpFromStats()` 回推。
- **上架等級**（`EQUIPMENT[].level`／`Zone.level`／`BALANCE.specialBasinLevel`／`stockBulkLevel`）：T1 兩台 Lv.1、加工機 Lv.2、販售口＋抹茶盆 Lv.3、大桶裝＋上層 Lv.4、草莓盆 Lv.5、補貨合約＋下層 Lv.6、二號櫥窗 Lv.7；Lv.8–10 目前沒商品（留給之後）。`npm run pacing` 對過：上架略早於買得起（equip-first 上層 Lv.4 在 12.4 分、買得起 15.6 分），只有 zone-first 那種先存錢的玩法會被等級擋幾分鐘。
- **守衛在 game 層**：`actions.ts` 的 `levelGate()` 用跟 `src/game/shop.ts` 目錄同一組數字；單元測試「目錄 locked 的每一項直接呼叫 action 也買不到、available 的都買得到」雙向對照，負向對照兩條（拿掉守衛／目錄門檻寫錯）都真的紅過（`npm run test:negative` 10/10）。
- **商店 UI**（`src/ui/shop.ts` 從 hud.ts 拆出）：五分頁（補貨／設備／澡盆／擴建／賣出）＋兩欄商品卡；鎖住的商品**不藏**、灰掉掛「Lv.N 解鎖」（沒有購買鈕，不會撞到 `[data-a=...]` 選擇器）；風味液體沒買澡盆前是 `needs`（「先買抹茶澡盆」）不是 locked。這一級剛上架貼 NEW；分頁紅點＝有 NEW 或一次性商品買得起或有原料可賣。抽屜**固定高度 82%**（max-height 會讓切頁時分頁列上下跳）。DOM 只在結構鍵變時重建，並保留 scrollTop（買了一件會重建）。
- **商品圖＝Microsoft Fluent Emoji 3D（MIT）**，`tools/fetch-shop-art.mjs`（`npm run art:shop`）釘 commit 抓 PNG → Playwright canvas 縮 160px WebP → `src/assets/shop/`（21 張 79 KB，授權全文同目錄 `LICENSE.txt`）。走 Vite import（`assetsInlineLimit: 0`，否則 <4 KB 的會被 base64 進 JS），`SHOP_ART_URLS` 併進 SW warm 清單——**離線第一次開商店有圖實測過**（快取 17→21 張、0 破圖）。混種原料圖用「主圖＋角落小圖」拼（抹茶生乳＝茶杯＋牛奶）。
- **使用者簽核（2026-09-22）**：「現在這樣可以」，但三處改圖＋一條原則：**設備五件一律自己畫**（理由：設備之後要真的出現在玻璃箱裡，商店圖要跟箱裡那件同款——已照 `equipmentMesh.ts` 的金屬 #cfd6dd＋珊瑚 #e58a7b 畫成 `eqAutoFill/eqCollector/eqCrafter/eqSeller/eqRestock.svg`）；熱焦糖→蜂蜜罐（`honeyJar.svg`）、牛乳→紙盒（`milkCarton.svg`）、草莓醬→果醬罐（`jam.svg`）。素材包只剩澡盆／櫥窗／原料／鎖／星等背景性質的圖。**emoji 規則的衝突未再追問**（使用者已看圖簽核），CLAUDE.md 那條尚未改。
- 簽核用網址參數 `?lv=N&coins=M`（commit `ff0826c`）；dev server 5174 起法見踩坑①。
- **新手引導接線**：引導說「去買原料收集手」時按商店直接開在設備頁（`Hud.onClick` 看 `hintId === 'buy'`），點櫃子鎖牌開的是擴建頁（`openShop('zone')`）。
- **分支狀態**：worktree `.claude/worktrees/shop-ui`、分支 `worktree-shop-ui`、commit `92b0687`（已 rebase 到 `464555f` 繁殖版之上、整併成一個 commit）。**未 merge 未 push**，等使用者簽核截圖與 emoji 決定。主樹另有並行 session 的未提交 `?pop=` 改動（`state.ts`／`main.ts`）不可蓋。
- **驗證證據**：vitest 118 passed、`npm run build` 綠、playwright **25 passed**（新 `cp3-shop.spec.ts` 7 條：每頁圖片 naturalWidth>0、鎖卡無鈕、升級 toast＋大桶裝入庫、分頁列不跳、引導開設備頁、買後捲動保留、320px、**真的寫一份 v2 存檔進 localStorage 再開**）、負向對照 10/10、`smoke-live` 對本機 preview 15 項全過、playtest `shop-click`／`taps`／`midgame` 實跑通過。簽核截圖：`evidence/shop-before-2026-09-22.png` vs `shop-after-lv4-*-2026-09-22.png`。
- **踩坑**：① 在 worktree 用 `cd wt && npx vite &` 起的 server **root 竟是主樹**（served 舊 hud.ts）——改用 `Start-Process vite.cmd <wt> --port` 指定 root 與 WorkingDirectory，並 **curl 一個只在 worktree 有的檔案確認**。② `playwright.config.ts` 的 `reuseExistingServer` 會沾到別棵樹的 5173，加了 `LPG_PORT` 環境變數。③ e2e 要寫舊存檔進 localStorage，必須在**非遊戲頁**（`/manifest.webmanifest`）上寫——遊戲頁 pagehide 會把自己的 state 存回去蓋掉。④ 這場的 heredoc 多次被 worktree 安全檢查擋，改成把 python 寫進 scratchpad 檔再執行。

## 存檔／進度保留（2026-09-22 第七場，使用者問「每個玩家開遊戲要保留進度」）

- **`?fresh=1` 以前會洗掉玩家的存檔**（實測：玩家那格 coins 123456 → 開一次測試網址 → 變 30）。已修：測試模式寫 `lpg.save.test`，玩家那格 `lpg.save.v1` 完全不碰（旗標在 `src/game/storage.ts` 的 `useTestSave()`，不在 `main.ts` 三個寫入點各判一次）。`tools/playtest/offline.mjs` 跟著改讀測試那格。
- **自動存檔改吃真實時間**：原本 `sinceSave += dt` 而 `dt` 被夾在 0.1 秒，低 fps 裝置會愈存愈稀——SwiftShader 下實測 7 秒真實時間只推進 2 秒遊戲時間、localStorage 一片空白。改成 `performance.now()` 差值後，e2e 在同一個慢環境下 8 秒內就看得到存檔（這條斷言本身就是回歸鎖）。
- **存不進去不再靜默**：`backend()` 現在回報 `durable`，無痕／被擋時 `save()` 回 false，`main.ts` 出一次 toast。以前退回記憶體 Map 之後 `save()` 照樣回 true，玩家會一路玩到關分頁才整份消失。
- **加到主畫面提示**（`src/ui/homeScreen.ts`）：只在 iOS Safari 分頁且未 standalone 時顯示，按「知道了」記在 `lpg.a2hs.off`。理由是 iOS 13.4 起 Safari 七天沒互動就清 script-writable storage，而加到主畫面的 web app 有自己的計數器不吃這條；**Expo WebView 階段也不吃**（WKWebView 不在 Safari 行程裡），所以包成 App 之後這張卡可以拿掉。
- **跨裝置仍然做不到**，純 localStorage 本質無解；要換手機接得回來就得有後端。使用者強調「這是手機遊戲」＝不接受存檔碼那種要玩家自己保管的做法。建議排到 Expo App 階段用 Sign in with Apple＋一張 `player_id → save JSON` 表，尚未定案。
- **已 commit `cbbf205`（2026-09-22）**，驗證是在**乾淨的隔離工作樹**跑的（做法見下）：`tsc --noEmit` 綠、vitest **106 passed**（原 103＋新增 3 條測試模式隔離）、`npx playwright test` **20 passed**（原 18＋新增 2）、`npm run playtest` 六支跑完 errors none（離線那支確認讀得到新的測試存檔格）。**兩個負向對照都實際紅過**：取消 key 分離 → 玩家存檔逐字比對那行紅；存檔失敗時謊報成功 → toast 那條紅；還原後皆綠（還原用反向 sed，不用 `git checkout --`）。

### 這一場的環境事故：同一個工作樹有並行 session 在即時編輯
- `npx playwright test` 全跑 **19 passed / 5 failed**，但五支**單獨跑全部綠**。原因不是產品 bug：`src/game/actions.ts` 在我全跑到一半的 02:00 被改寫，`genetics.ts`／`state.ts`／`balance.ts` 在 02:13–02:14 又被改——Vite HMR 讓測試中的頁面重載，症狀是「element detached／Execution context was destroyed」。`npm run playtest` 也因此跑不完。
- **診斷法**：`git diff --name-only` ＋ `stat -c %Y` 排序看 mtime，就知道哪些檔是幾秒前被別人動的（我自己的最後一次是 02:11 的 storage.ts）。
- **共用檔怎麼在不碰對方工作的情況下 commit（使用者裁示「你先」）**：`src/main.ts`、`src/ui/hud.ts`、`tests/unit/persistence.test.ts` 三個檔同時含我的存檔工作與對方的 pour／shipping／`kind`＋`eggs` 改動，具名 add 拆不開。做法＝**用 `git show HEAD:<檔>` 取乾淨版、只重新套用我自己的那幾處改動、`git hash-object -w` ＋ `git update-index --cacheinfo` 直接把「我的版本」放進索引**，工作區檔案一個位元組都不碰（對方繼續改不受影響，他之後 commit 時 diff 自然只剩他的部分）。**不要用 `git add -p` 去切對方半成品的 hunk**。
- **驗證也靠同一招隔離**：`git write-tree` → `git commit-tree` → `git worktree add --detach` 出一棵只有「HEAD＋我的改動」的樹，node_modules 用 `cmd /c mklink /J` 接過去（PowerShell 跑，Git Bash 的 `cmd //c mklink /J` 會被 MSYS 改寫參數而失敗），playwright.config 的 port 改掉避免撞到別人的 dev server。這棵樹裡跑出來的綠才算數——主工作樹當下 tsc 與 vitest 都是紅的（紅在對方進行中的 `actions.ts`／`state.ts`）。收尾：先 kill 該 port 的程序 → `rmdir` 拆 junction → 刪目錄 → `git worktree prune`。

## 生產迴圈改版（2026-09-22 使用者要求：蛋＋焦糖隨機掉落、牛奶澡生布丁）

- 計畫新增 **D32**（固定間隔掉落，不看 caramel）、**D33**（配方＝蛋×2＋該物種原料×1）、**D34**（牛奶澡＝繁殖、單親複製、拿掉變白突變）、**D35**（caramel／焦糖澡降級成演出，待使用者定案）。`SCHEMA_VERSION` 升到 **4**。
- **使用者的兩個答案會互相打架，要主動算後果再回報**：選「單親複製」＋「拿掉變白突變」＝鮮奶酪與它的四個混種永遠養不出來（複製沒有孟德爾分離，變白又是原本唯一的 panna 來源）。回報後使用者選「牛奶澡本身就是鮮奶酪的風味來源」補上。**多題問卷要逐對檢查答案的交互作用，不是各自實作。**
- **`npm run pacing` 又抓到兩件事**（第二次證明量表比單元測試更早發現問題）：
  1. **無窮迴圈**：harness 的 `while (ingredients >= need) craft(...)` 在 craft 改成「還要蛋」之後，craft 一直失敗但迴圈條件永遠成立 → 量表跑不完（300 秒逾時）。**改配方就要同步改所有「以配方為條件」的迴圈**。
  2. **量表沒覆蓋新機制**：harness 只倒焦糖，於是繁殖從頭到尾沒發生（住客永遠是解鎖送的 5 隻、0 張混種訂單）。補上「有空位就倒牛乳」之後才真的養出 `caramel,panna,custard`、混種訂單 8 張全成交。
- **改版後節奏（3 小時，seed 7）**：住客 12 隻、泡澡 2550、收入 **57k（改版前 18k）**、上層 7.5 分／下層 13.2／二號櫥窗 **18.6 分**（D24 目標 20／45／90）。**全部「達標但明顯過快」，數值要不要收斂是使用者的決定**。
- **三個平衡點已修（2026-09-22 使用者「幫我修正」）**：`dropIntervalSec` 20→28、`dropCap` 5→8、下層 500→700、二號 1200→1800，並加上 `dropCaramelMin`＝焦糖見底就停止掉落。曲線 7.5／13.2／18.6 → **12.1／22.1／31.9 分**、三小時收入 57k→33k，前期不受影響（收集手 0.8–1.4 分）。**調數值一定要用 `npm run pacing` 前後對照，不要憑感覺**。
- **`keepFed(w)` 測試輔助（`tests/unit/helpers.ts`）**：D35 之後焦糖見底就停產，所以任何「要量掉落節奏」的測試都必須先餵飽，否則量到的是停產而不是節奏（一加閘就有三條既有測試變紅，全是這個原因）。
- **改規則時，e2e 的失敗有兩種要分清楚**：①測試寫死了舊規則（該改測試）②規則本身有死路（該改設計）。這次三條 e2e 全紅：`cp3-game-loop` 等「泡完澡掉原料」是①；`cp3-expansion` 看 `drops` 但那一步已裝收集手、掉落物會被立刻收走是①（改看 `stats.picked`）；而「等不到 ingredient 掉落」是②——**地板被 5 顆蛋塞滿就完全停止掉落**（eggChance 0.65 下連掉 5 顆蛋的機率 11.6%，固定 seed 必然重現）。
- **`dropCap = 5` 在雙掉落物之後容易塞爆**：沒有收集手時地板很快被蛋堆滿，堆滿就不再掉任何東西（單元測試裡踩到，靠裝收集手才測得下去）。這是待調整的平衡點。

## 進度消失 → 存檔碼＋備份格（2026-09-22 第九場，使用者回報「我剛剛 push 了 但網頁上的遊玩進度消失了 可能還是得做登入」）
- **事故事實**：iPhone Safari，兩個分頁（其中一個是遺留的 `?debug=1` 分頁）都只剩全新農場。查到「主格 `lpg.save.v1` 讀不到」為止，**根因查不出來**，那份進度救不回來（已告知使用者）。
- 排除掉的：`migrate()` 不可能把有效存檔變成新農場（`out.puddings = r.puddings.map(...)`）、`src/` 全樹沒有任何 `clear()`、存檔 key 從 `d0f558e` 到現在只有 `lpg.save.v1`、那次 push（`5bb7e02`）只動 `docs/` 與 `CLAUDE.md`。加到主畫面的分區假設也排除了（使用者一直在 Safari 分頁玩）。
- **過程中挖到一個真的 bug**：`persist()` 無條件寫整份 state，開著沒關的舊分頁一回到前景就 `settleOffline` 往前推、5 秒後把新分頁的進度蓋掉。已修（D37）。
- **`isDurable()` 偵測不到 Safari 無痕**：無痕的 localStorage 真的寫得進去、只在 session 結束被清，所以「這個瀏覽器存不了進度」的提示在最需要它的時候不會跳。**這條還沒解**，存檔碼只是繞過它。
- 做了：`rev` ＋ `progressScore` 寫入守衛、備份格 `.bak`、存檔碼（設定卡，齒輪取代喇叭）、`?debug=1` 顯示兩格狀態。**帳號登入／雲端存檔沒做**，留待使用者決定。
- 測試：`tests/unit/save-guard.test.ts`（12）、`tests/unit/savecode.test.ts`（7）、`tests/e2e/cp5-savecode.spec.ts`（4）。兩個守衛都做過突變負向對照——拿掉 `rev` 比對 → 3 條紅；備份改成無條件寫 → 2 條紅。
- 同一場使用者追加兩件（D38）：效能面板搬進設定卡（維持 `?debug=1` 才存在）、頂列四顆 chip 與訂單卡數字點得出小布丁說明氣泡。測試 `tests/e2e/cp5-tips.spec.ts`（3 條）。
- **`npm run playtest` 的 C 段（牛奶突變）是壞的，不是這次弄壞的**：`tools/playtest/midgame.mjs:39` 還在等 `p.tint >= 0.5`，而 `tint` 在 `e9c08be`（D34 拿掉變白突變）就移除了，所以那個 `waitForFunction` 永遠等不到。前三段（opening／taps／layout，都走 `?fresh=1`）正常。**要修的話得把 C 段改成驗繁殖**，還沒做。
- **既有 flake，不要誤判成回歸**：`cp3-game-loop.spec.ts` 的 AC3-1／AC3-1b 整檔連跑會隨機在「等下一批掉落物」逾時，單跑就過；在乾淨 worktree（HEAD `5bb7e02`、無本次改動）實測同樣紅，與這次無關。

## 停擺與靜默（2026-09-22 第十場，使用者回報「我的小布丁跑完牛奶沒有再增加」「出貨按鍵有時按不了」）

- **使用者存檔碼是最有力的證據，記得要**。齒輪 → 設定 → 複製，貼回來用 `savecode.ts` 的格式在本機解（純 base64url＋FNV-1a，四行 node 就解得開）。這次解出來直接定案，不必靠推論：`baths 21 / births 1`、3 隻布丁 `caramel` 全 0、`drops 0`、盆空、`preferredLiquid: 'milk'`、`stock {caramel:2, milk:0}`、只解鎖一區、`equipment` 四台全有（`restock` 沒有）。
- **根因鏈（三個坑都是靜默，不是規則錯）**：倒過一次牛乳 → 注液閥的 `preferredLiquid` 從此黏在牛乳（`autoFill` 讀 `b.liquid ?? b.preferredLiquid`，**永遠不會換回焦糖**）→ 剩下的牛乳全燒在「住滿了生不出來」的澡上 → 牛乳歸零 → 注液閥停擺 → 布丁焦糖歸零 → `dropCaramelMin` 判停產 → **整座農場死掉，而畫面上那句提示還寫著「布丁照樣會掉原料」**。
- **已修（D39，分支 `fix/stall-and-ship-feedback`，commit `d962f99`）**：①停擺提示改成指名亮著的那顆按鈕；②新增 `zoneFullHint` 常駐警告（`pudding.ts:150` emit 的 `{type:'error'}` 從來沒有人接，但**不可以接成 toast**——離線八小時會丟上百次）；③`ShipResult` 加 `reserved`＋`nearestPendingOrder()`，出貨沒動靜時講得出「『焦糖布丁塔 ×3』還差 1 份」。證據：單元 168 綠、三組突變各自紅過、無頭 iPhone 四情境實跑、頁面零 error。
- **使用者當下的解卡動作**：手動按一次「倒焦糖」（庫存還有 2 份），注液閥從此改補焦糖。
- **待辦（已寫進計畫 D40／D41／D42 與 CP7 工作包）**：焦糖離開澡盆改手動刷＋新設備「焦糖刷」、`zoneCapacity` 3→15（**前置 WP7-1 布丁 InstancedMesh**，15 隻現況 88 draw calls／預算 35）、自動販售口販售動畫。**D40 與 D42 都有「動手前要先問使用者」的未定項**，別直接開工。

## General rules
- 使用者**沒有 Mac**；所有 iOS 路徑只給 Windows／雲端做法。
- 遊戲設計定稿與決策 D1–D14 在 [plans/game-plan-v1.md](plans/game-plan-v1.md)；改規則先改計畫檔的設計表再改 code。
- 分層鐵則：`src/game/` 純邏輯零 three.js；`src/scene/` 只演出；UI 不用 emoji。效能預算見 repo `CLAUDE.md`。
- 驗收：每個 CP 的 AC 要有工具證據或使用者截圖；視覺類一律使用者簽核；負向對照要真的紅過。
- 手機截圖與效能基準線存私有記憶庫的 `evidence/`，不進公開 repo。
- commit 繁中一行、不加 Co-Authored-By；禁 `git add -A`（改用具名 add）。

## Open failures
- **WP3 只剩手機端（2026-09-21 第四場）**：Pages 已通**且線上就是完整遊戲版（`f3ae744`）**，AC1-3（iPhone 中位數 ≥ 50 fps）、AC1-4／AC3-4（使用者看畫面簽核）等使用者用 iPhone 行動網路開 `https://nyannyn.github.io/little-pudding-game/?debug=1` 回報。**CP1 未綠**。
- **「Pages 綠」曾經 ≠「你做的東西在線上」（2026-09-21 第四場實際發生）**：使用者回報「遊戲已上線」，但當時 remote 停在 `715ddaa`＝做遊戲之前的 hello scene，五個 commit 都還在本機。**宣告上線前一律 `git ls-remote --heads origin` 比對 sha，再抓線上 index.html 找一段只有新版才有的字串**（那次用 `#debug` 的定位方式，新版是 bottom、舊版是 top）。
- **CP0 負向對照以代用證據結案**：計畫寫的是「Blender 端按 Stop 再呼叫一次必須失敗」，實際沒按 Stop 跑；代用的是上一場 addon 未啟動時 MCP 呼叫回 `CONNECTION_CLOSED`（同一條失敗路徑）。要嚴格補跑就請使用者按一次斷線再呼叫。
- **AC1-1 已轉綠**：CP3 起住客變兩隻、`castShadow` 只留 `Pudding_Body`，門檻改成 **2000–5000**（每隻 1228＋468＝1696，兩隻約 3392），線上實測 tris 7886。負向對照的紅在 WP2 之前就實際發生過（GLB 不存在時差值＝0），不是推論。
- 桌面上殘留空目錄 `little_pudding_game` 待使用者刪（session 結束後才刪得掉）。

## Lessons learned
- **要「連成一整排」，每一個高度的寬度都要對齊，不是只讓最寬的那圈相接**：裝飾線腳若在寬度方向外擴，就只有線腳碰得到、層板以上全是縫。線腳只往深度凸即可保留裝飾又不破壞連續。立柱要貼齊最外緣，相鄰兩根才會碰成一根共用柱。
- **「有沒有縫」用射線掃，不要用眼睛看**：沿畫面水平線射線、統計打空點數，比對截圖可靠得多，而且可以做負向對照（塞 0.25 的縫進去確認會紅）。
- **鄰櫃要「連成一整排」，間距就必須等於最外緣寬度**（含底座線腳），留任何間隙都會讀成分開的好幾座。`CABINET_PITCH = UNIT_OUTER_W`。
- **把盒子塞滿畫面不能只用寬高算距離**：盒子正面比中心更靠近鏡頭，投影會脹大——實測算出來的距離讓櫃子超出畫面 14.6%。要先算一次再用 `D/(D−深度/2)` 放大尺寸重算（`fitBoxDistance`）。
- **直立鏤空櫃不能排後列**：後面那排會透過玻璃看進來，變成一堆對不上的水平層板，比空白還糟。橫向櫃體沒這問題（實心底座擋住），改直立後要把後列拿掉。
- **物件變高後陰影相機要重新框**：1024 的 shadow map 攤在 ±5 範圍上，落在直立櫃層板間會出現階梯噪點。框到 ±3.6 ＋ `normalBias`（比 `bias` 更能消斜面自遮蔽）＋ 光源 target 對準櫃子重心才乾淨。
- **canvas 貼圖做多張名牌要共用一張圖**：一層一列畫、每個 quad 改 UV 對到自己那列，三張名牌只吃一個 draw call。注意貼圖預設 `flipY`，uv.y=0 對到 canvas 底部，所以第 i 層要畫在「由下往上」第 i 列。
- **名牌要 `renderOrder` 蓋過玻璃**：畫在玻璃之後才不會被半透明玻璃洗淡。
- **鄰櫥窗一定要跨座位合併**：八座櫥窗若各自 add，光殼體就近 50 個 draw call。合併成 4 個 mesh（wood／frame／lock／glass）＋全部不投影後，整場含布丁只用 21 個（預算 30）。`mergeGeometries` 要求各幾何屬性一致，BoxGeometry／SphereGeometry／TorusGeometry 都有 position+normal+uv，可直接混合併。
- **同一盞燈做前後兩條會變成兩片層板**：透視會把同高度不同 z 的兩條分開成兩條水平線，讀起來像層板不像燈。只留正面一條並貼緊頂框才對。
- **後列裝飾物拉遠才有透視**：背景櫥窗放 z=-7.5 像貼在主櫥窗後面的貼圖，拉到 z=-12 才讀得出「一排往後退」。
- **注視點是畫面中心**：抬高 `controls.target` 會把主體往畫面下方推。直向手機下半的留白用這個調，比動相機距離有效。
- **直向手機塞橫向物體是結構性問題，不是邊距沒調好**：5 寬×3.5 高的櫥窗放進 9:19.5 螢幕，填滿寬就只能占四成高，數學上無解。收邊距只買到 38.6%→40.6%，真正的槓桿是改物體長寬比（3.4×2.8 → 51.2%）。遇到「留白太多」先量占比再決定要不要動相機。
- **構圖邊距要按環繞極限算，不是按正面**：`OrbitControls` 左右各 30°，櫥窗投影寬度 81.4%→88.4%。照正面收緊邊距，使用者一轉就被裁掉。FIT 寬度已改成 `寬·cos(maxAz) + 深·sin(maxAz)` 自動推算，不留魔術數字。
- **玻璃不用 transmission 也能像玻璃**：fresnel 調 alpha（正面 0.05、掠角 0.62）＋`DoubleSide` 邊緣自然疊兩層。shader chunk patch 要加「找不到就 console.error」的守衛，否則版本升級後會靜默退回均勻半透明，跟改壞了長得一樣。
- **gltf-transform 的 `quantize()` 碰到「自己有 mesh 又有子節點」的節點，會把 mesh 搬到一個新的無名子節點**，該節點原本的名字就只剩群組。要靠名字抓 mesh 的話，Blender 端就要用不帶 mesh 的 Empty 當根節點（已改成 `Pudding_Root`）。
- **壓扁的球正面輪廓只由緯度環數 `ring_count` 決定**，加經線 `segments` 對輪廓毫無幫助——腮紅的多邊形邊我第一次就加錯參數。
- 讀 GLB 階層別自己寫縮排印法：名字是空字串時會印出假縮排，害我誤判階層壞掉。要判父子關係就直接印 `getParentNode()`。
- **Blender 4.x 預設 view transform 是 AgX，會把飽和底色洗成米白**；預覽渲染要判斷「材質顏色對不對」必須切 `Standard`，否則會誤判成材質設錯（第一版布丁就被誤判成沒上色）。
- `render_preview.py` 的燈**位置**隨物件 radius 線性縮放但**能量**沒縮放 → 小物件過曝。能量要隨 radius 平方縮放（已修）。
- 貼在曲面上的壓扁小球（腮紅／眼睛），外推量 `out` 必須大於壓扁後的半厚度，否則整顆埋進本體、渲染起來像沒做。
- 糖衣類外殼**沿輪廓法線等距外推**才對；純半徑方向外推在頂部圓頂推不夠，本體會從殼裡冒出來形成一圈色環。
- 旋轉體的波浪邊瓣數受經線數限制：26 條經線配 5 瓣就取樣不足變鋸齒，4 瓣才順；瓣相位要對正正面讓臉不被蓋到。
- session cwd 所在目錄在 Windows 上無法改名（`Device or resource busy`／`in use`）；要改名的專案目錄先在計畫裡排到「開新 session 前」。
- 直向手機視口用 three.js 要以**水平視角**算鏡頭距離（`fitDistance`），否則寬物件被裁掉。
- 細框（櫥窗玻璃邊）`castShadow` 會在地板留硬線，關掉更乾淨。

## 直立落地櫃改版（2026-09-21 第三場結尾，使用者要求「櫥窗太小、要占滿整個頁面、改成水族箱式直排三層、右下角要名牌」）
- 計畫新增 **D17**（落地櫃三層、填滿畫面、每層名牌、MAX_AZIMUTH 收窄到 ±18°）與 **D18**（fitBoxDistance 要算近面），並修訂 D5。
- 尺寸：`TANK` 2.35×1.5×1.4、層板 0.13、落地底座 0.45 → 總高 5.34、外寬 2.77。**中層啟用**（`ACTIVE_TANK = 1`），上下未解鎖並掛鎖。
- 實測構圖：主櫃占畫面**寬 98.2%／高 91.3%，不裁切**；布丁從 15% 放大到 **29.4%**。**20 draw calls**（預算 30）、5390 面、`npm run e2e` 2 passed、無 console 錯誤。
- **一整排左右連續（使用者要求兩次）**：第一版只讓底座線腳相接，層板以上仍有 0.22 的縫。真正的作法是**寬度方向一律不外擴**（底座與線腳只往深度凸）＋**立柱貼齊層板最外緣**（相鄰兩座立柱剛好碰成一根）＋`CABINET_PITCH = UNIT_OUTER_W = UNIT_WIDTH`。左右各排三座，拉到縮放上限看不到盡頭。
- **連續性有自動檢查**：`tools/check-row-continuity.mjs` 沿頂蓋／中層層板／底座三條水平線各射 241 條射線，全部要打到櫃體。**負向對照實跑過**：把間距加回 0.25 → 三條線分別 10／14／12 點打空、exit 1；還原後全綠。
- 鄰櫃間距改為 `UNIT_OUTER_W`（左右緊貼連成一整排，使用者要求）；布丁縮放走 `PUDDING_WIDTH` 常數，並加 `?pw=` 覆寫參數方便當場比對尺寸。
- 名牌：三層畫在同一張 canvas（一層一列）＋三個 quad 各自對到自己那列 UV → **一個 draw call**。`renderOrder = 11` 蓋在玻璃(10)之上，否則會被半透明玻璃洗淡。
- **`floorBounds()` 意義變了**：現在回傳「啟用層」的地板矩形，`y` 不再是 0 而是 `tankFloorY(1)+0.02`。`main.ts` 放布丁已改用 `b.y`。CP2／CP3 寫規則時要注意這點。

## 多櫥窗改版（2026-09-21 第三場中段，使用者要求「細節太少」）
- 計畫已修訂：**D6 更新**（fresnel 玻璃取代均勻 opacity）、**新增 D15**（多櫥窗＋初始 zoom in，v1 只做視覺、state 預留 `cabinets`）、**新增 D16**（細節範圍＝櫥窗本身＋櫥窗內擺設，**不做**店鋪環境）。
- 使用者選擇：鄰櫥窗＝「之後可解鎖的擴充」；補細節＝「櫥窗本身」＋「櫥窗裡的擺設」。
- 實作：`src/scene/cabinetRow.ts`（新檔）八座鄰櫥窗，前列 ±1／±2 格、後列 z=-12 錯開半格；合併成 4 個 mesh、不投影、上鎖外觀（鎖板＋torus 鎖環）。`cabinet.ts` 重寫：底座上下線腳、正面名牌、四角托盤＋小標籤＋粉彩小物、頂部單條燈條（`MeshBasicMaterial` 不吃光照才讀得出是燈）。
- 相機：`controls.maxDistance` 由 1.3 倍放寬到 2.4 倍（要能拉遠看整排）；`target` 由 `height*0.4` 抬到 `height*0.62`。
- 實測：**21 draw calls（預算 30）**、6108 面、`npm run e2e` 2 passed、無 console 錯誤。主櫥窗占畫面高 40.9%、寬 87.2%，±30° 環繞不裁切。

## Commit 4d69d66（2026-09-21 存檔點）
- 內容：布丁 GLB＋建模腳本、直立落地櫃（三層／名牌／鎖）、鄰櫃連續排列、相機 `fitBoxDistance`、陰影修正、四個新 tools 腳本。
- `PUDDING_WIDTH = 0.2`（使用者定案）。`?pw=<數字>` 覆寫參數保留著，調尺寸不必改 code。
- `docs/previews/` 已加進 `.gitignore`：可由腳本重產，且視覺證據不進公開 repo。
- 存檔當下驗證：`npm run build` 綠、`npm run e2e` 2 passed、`tools/check-row-continuity.mjs` 三線 241 點全中。

## Checkpoint 進度（2026-09-21）
| CP | 狀態 | 證據 |
|---|---|---|
| CP0 Blender MCP 接通 | **綠（2026-09-21 收尾）** | MCP `get_scene_info` 回 Cube/Light/Camera＋materials_count 2，與裸 socket 版同一份；`get_addon_status` 版本相符。負向對照用上一場 `CONNECTION_CLOSED` 代用（見 Open failures） |
| CP1 一隻布丁到 iPhone | **只剩使用者端**：WP1＋WP2 完成（使用者簽核「可愛」，要求眼睛小一點＋彈跳要 Q，皆已處理）。AC1-1 綠（差值 2456）、AC1-2 綠（1228 面／23,240 bytes）。**AC1-3 iPhone 實機、AC1-4 使用者看截圖仍未做＝WP3** | `npm run e2e` 2 passed；`node tools/optimize-models.mjs` ok |
| CP2 規則模擬 | 未開始 | |
| CP3 場景互動＋Pages | **Pages 部分已通**（2026-09-21 第四場）；互動未開始 | workflow 35562921163 build+deploy 綠、線上 index/GLB 200 |
| CP4 美術擴充 | 未開始（**下一個大項**：三物種與四澡盆目前只是換色，要用 Blender MCP 做出各自的頂料／盆身） | |
| CP5 PWA | **程式完成，待使用者在 iPhone 實際「加入主畫面」驗證** | `npm run smoke:live` 對線上 14 項全過（含 manifest 直向全螢幕、apple-touch-icon、SW scope、**離線重新整理仍開得起來**）；`npx playwright test cp5-pwa` 3 passed |
| CP6 包 App | 未開始（選配） | |

## 分區改版（2026-09-21 第四場後半，使用者選「兩個都做」）

- 計畫新增 **D22**（通用分區 zone：同櫃上下層＋鄰櫃同一套資料）與 **D23**（鏡頭框啟用區、切區平移）。
- **`schemaVersion` 升到 2**：`Pudding`／`Basin`／`Drop` 都加 `zone`，`GameState` 加 `zones` 與 `activeZone`。v1 存檔沒有這些欄位，`migrate()` 一律補成起始區 `c0t1`——**不補的話那些實體不屬於任何一區，所有以 zone 過濾的查詢都會漏掉它們，玩家的住客會憑空消失**（有 fixture 守著）。
- **經濟全場共用、住客分區**：金幣／液體庫存／原料／甜點／設備都是全域，只有布丁、澡盆、掉落物帶 zone。掉落上限是**每區各自 5 份**。玩家按「撿原料」只撿看得到的那一區；原料收集手是全場。
- **`nextId` 起始值是 bug 來源**：開局住客叫 `p1`/`p2` 但 `nextId` 從 1 開始，解鎖新區生出來的布丁會叫 `p1` 撞號，scene 端以 id 為鍵的 view Map 就綁錯隻。已改成 `puddings.length + 1`，migrate 另外掃所有 id 的數字尾碼取 max+1。單元測試抓到的。
- **`Object3D.add()` 會從原父節點移除子物件**，所以 `for (const c of built.group.children) this.group.add(c)` 會邊走邊縮、只搬到一半——名牌與燈條就是這樣整個不見（draw call 從 23 掉到 20 是徵兆）。要先 `[...children]` 複製。
- **直向手機「只框啟用層」做不到（實算）**：布丁活動範圍 ±0.875 加掉落物外推 0.32 → 水平至少要 1.9；9:19.5 下水平 1.9 ＝垂直 4.6，還是看得到大半座櫃子。實際做到的是近面覆蓋 2.93→2.14、布丁占畫面寬 6.8%→9.3%。真正的槓桿是布丁尺寸（`PUDDING_WIDTH`，目前仍是使用者定案的 0.2）。
- 鏡頭切區用「`controls.target` 與 `camera.position` 同步位移」，不重設角度與距離，玩家轉過的視角會保留。
- 名牌往內收 0.24（原本貼齊右緣 x=1.085，近距離下會被畫面切掉）。液體庫存從上方 chips 移到「倒○○」按鈕上（五個 chips 在 390px 會換行撞到櫥窗切換列）。

## HUD 動森風改版（2026-09-21 第五場，commit `a2018e1`，只動 `src/ui/{hud.css,hud.ts,icons.ts}`＋`index.html`）
- 使用者要求「參考動物森友會美化 UI／按鈕太醜參考主流放置遊戲／按鈕全部變成可愛圖示」。做法：粉圓體（Huninn，Google Fonts，OFL，**只有 400 字重**→全域不設粗體、短字串局部 700，否則合成粗體糊掉；**離線 PWA 會退回系統字**，SW 只 warm 同源）；奶油紙＋木邊 2px＋`0 4px 0` 厚邊、按下沉 3px；動作列＝托盤上的圖示磚（`.tilebtn`，彩色填色 SVG `CUTE_ICONS`，數量徽章掛右上角）；引導改對話泡泡＋「小布丁」名牌，**移到上方 `top:+200px`**（在下方會蓋住布丁）；商店列加圖示、價格鈕加錢幣。
- **坑：`.hud button`（0,1,1）壓過 `.tilebtn`（0,1,0）**，圖示磚的 padding/min-height 一直沒生效、動作列高到 200px。修法＝變體選擇器一律帶 `.hud` 前綴。
- `--dock-h` 由 `hud.ts` ResizeObserver 量實際高度寫到 `:root`，toast／#debug 位置由它推導；另一個並行 session 同時做了 D26（`src/ui/viewport.ts`＋`camera.setViewOffset` 把畫面中心移到 HUD 沒遮的段），`tests/e2e/cp3-hud-band.spec.ts` 用我的 dock 實跑綠。
- 驗證：`npm test` 67 綠、`npm run build` 綠、十張流程截圖（暫存區 `after/`）逐張看過；e2e 有 3 紅**全是另一 session 未提交的 balance 改動**（startStock 4→6 vs 測試期待 3；decay 1→1.4）與 `renderShop` 每 160ms 重寫 innerHTML 的既有 race（unlockZone 按鈕 detached），不是本次 CSS 造成。
- 並行 session 併跑 Playwright 會互刪 `test-results/`（ENOENT trace）→ 單跑時加 `--output <暫存目錄>`。

## 倒液體演出（2026-09-22 第八場，使用者要求「到牛奶、到焦糖要有真正的傾倒動畫跟聲音」）

- **已上線（2026-09-22 03:15）**：commit `cfc1655` 直接建在 `origin/master`（`bd8662d`）之上 fast-forward 推上去，Pages run 35642460835 綠；線上 bundle `index-AbTh23d1.js` 含 PourJug/PourStream，`smoke:live` 全過，無頭對線上按倒焦糖：水流可見、played=1、draw 32。**本機 master 仍停在並行 session 的 `cbbf205`（未推、與遠端分岔：遠端另有商店改版 92b0687/ff0826c/bd8662d）**，我的 9 個檔在工作樹仍是 modified/untracked——並行 session 要先 `git pull --rebase` 才能推。
- **subagent（opus）四題決定已執行**：①同時只畫一組壺＋水流（三盆同時倒實測 37 超預算→現在 ≤35）、手動可搶掉注液閥的水流、被壓掉的只升液面；②注液閥保留 0.24 小聲但只在水流真的畫出時出聲（`begin()` 回 boolean）；③液面升完再 0.2 秒淡出（`Rise.to`＋`DRAIN_TAU`），布丁中途進盆不再瞬間消失；④乾淨樹驗證後只推本次 hunk（`git archive`＋臨時 `GIT_INDEX_FILE`＋`commit-tree`，不動共用 index、不 stash）。e2e 共 7 條，兩條新負向對照也紅過。
- **事故：scratch 樹 `head/node_modules` 是 junction 指向 repo 的 node_modules，`rm -rf head` 會穿透把真的 node_modules 刪掉一半**（`.bin`、`@playwright`、`@gltf-transform` 消失，並行 session 的 vitest/vite 還在跑）。已 `npm install` 復原（lockfile 未變、`npm ls` 齊）。**規矩：刪含 junction 的目錄前先 `cmd /c rmdir <junction>`**。
- 改動：`src/scene/pourView.ts`（新：小壺進場→傾倒→水流→退場；自動注液閥走「閥門放水」變體無壺）、`src/scene/basinMesh.ts`（液面高度不進重建 signature，改寫合併 geometry 的頂點 Y 逐幀升；`beginPour(hold, rise)`）、`src/scene/audio.ts`（合成倒液聲：帶通雜訊中心頻率隨時間上爬＋幾顆下滑正弦「咕嚕」，稠度由 `THICKNESS` 表給；`played` 計數；`live(gesture)` 同步路徑）、`main.ts`（`case 'pour'`、`?pause=1`＋`window.__lpg.step(dt)` 逐幀推、`attachUnlock(window)`）、事件 `pour` 多帶 `units`、新 e2e `tests/e2e/cp3-pour.spec.ts` 5 條。
- **抓到既有 bug：AudioContext 只掛 canvas 解鎖，而教學第一個動作是 HUD 的「倒焦糖」DOM 按鈕**，玩家第一次按永遠沒聲音。改掛 `window`＋手勢音走同步 `ensureCtx()+resume()` 不等 promise。**iPhone 上是否真的出聲仍未驗**（無頭 chromium autoplay 放行，`played` 只證明節點有排進 context）。
- **證據**：tsc 綠、vitest 103 passed、`cp3-pour.spec.ts` 5 passed；負向對照三條都紅（藏水流→stream 斷言紅；液面改瞬升→「已開始升」斷言紅；拿掉切區守衛→切區測試紅）。全套 e2e 第一次 18 passed／2 failed（cp1-hello-scene、cp3-expansion，錯誤是 execution context destroyed／trace ENOENT，判 flake，`--last-failed` 重跑 3 條全過）。截圖：scratchpad `pour/` 的 caramel／milk／valve strip 都看過，壺 tint 0.55 太淡看不見已改 0.3、壺放大 1.35。
- **最壞情況（全設備＋5 掉落物＋3 隻）倒液體那幾幀 draw calls = 35/35，剛好頂到預算**（壺＋水流各 +1）。要留餘裕的退路：壺與水流併成一個 mesh（CPU 端逐幀寫頂點）。
- **並行 session 同時在改 `src/scene/renderer.ts`（dpr／aa 旋鈕）與 `src/debug/stats.ts`（pixels／gpu）及 `main.ts` 的 `createRenderer(...)` 那段**——`main.ts`／`stats.ts` 是混的，commit 時只能 add 自己的 hunk（`git diff` 剪 patch 後 `git apply --cached`）。另外我以為自己起的 5173 dev server 其實是 09/21 11:25 就在跑的舊 process（strictPort 讓我的那支沒起來），**被我 Stop-Process 掉了**，對方 session 若在用要重起。
- 待使用者：iPhone 實機聽倒液聲（未驗）；**手機上別開 `?fresh=1`**（線上版的 fresh 會覆寫真實存檔，`useTestSave` 隔離在並行 session 未推的 cbbf205 裡）；「布丁泡澡中盆裡看不到液體」是規則設計（進盆即扣），要不要改成泡完才扣另議。

## Last session（2026-09-22 第七場：商店改版＋店長等級，待簽核）
- 產出在 worktree 分支 `worktree-shop-ui`（commit `bd8662d`），未 merge。使用者已簽核整體與改圖；**下一步**：使用者看 `evidence/shop-after-*.png` 簽核＋回答 emoji 素材去留 → 依回答調 `tools/fetch-shop-art.mjs` 的 ART 表（改圖只要改那張表重跑 `npm run art:shop`）→ merge 到 master 推上 Pages → `npm run smoke:live` 驗線上。
- 主樹的 dev server 5173 是並行 session 的；本場自己起的 5174（dev）與 4174（preview）已在收尾時關閉。

## Last session（2026-09-21 第五場：/loop「試玩、修 bug、前期要快速有成就感」，進行中）

**一句話**：量到前期節奏壞掉（第一台設備 12 分鐘、第一次擴張 3 小時內達不到），重定價＋訂單偏向養得出的物種＋引導順序修正＋鏡頭避開 HUD，commit `f89e6ba` 已推（遠端同 sha）。

**並行 session 注意**：本場開始時 `index.html`／`src/ui/hud.css`／`src/ui/hud.ts`／`src/ui/icons.ts` 已有未提交的動森風 HUD 改版且持續在改（mtime 一直更新、dev server 5173 由 PID 23496 持有）。本場**沒碰這四個檔**，也沒 add。它們留給那個 session 收。

**已做（皆有證據）**
- D24 節奏：`npm run pacing`（`tools/pacing/`，勤勞玩家 bot 每 3 秒操作一次、兩種買法、印里程碑分鐘數）。改前：收集手 11.8／注液閥 30.4／訂單成交 80.2／上層 3h 未達；改後：收集手 1.7／注液閥 4–6／訂單 3–5／加工機 6–8／上層 16–21／下層 37–41／二號櫥窗 55–66（分鐘）。數值：衰減 1.4/s、泡澡 12s、液體 2 元、甜點 4 倍、BATH_INCOME=10、設備 6/8/12/18/40 倍、分區 200/500/1200、特殊盆 300、開局 30 幣 6 焦糖。
- D25 訂單 80% 從住客物種抽（`orders.ts`），單元測試＋負向對照（比例改 0 會紅）。
- 引導順序（`hints.ts`）：泡澡中／撿原料排在「倒焦糖」前——手動只倒一份、進盆就歸零，原本玩家全程只看到「倒焦糖」。真實流程回歸測試＋負向對照（還原順序會紅）。
- D26 鏡頭 `setViewOffset` 把畫面中心移到 topbar 底～dock 頂的中心（`src/ui/viewport.ts`＋`main.ts` applyHudOffset、ResizeObserver）。e2e `cp3-hud-band.spec.ts` 幾何鎖，負向對照 dy=0 → 33% 而紅。
- 驗證：vitest 69 綠、`npm run build` 綠、`npm run test:negative` 8/8 紅得出來、e2e 10/12 綠。

**已做（續）**
- 並行 session 已把 HUD 改版 commit 成 `a2018e1`（在我的 `f89e6ba` 之前），之後 hud.ts 閒置 30 分鐘才動它。
- **商店按鈕不穩（既有 bug，線上舊版重現：3 次有 2 次 8 秒內點不到）**：`renderShop` 每 160ms 重寫 innerHTML → 手指按到一半按鈕被換掉。改成內容字串沒變就不重繪（commit `6c6c880`，已推）。點擊延遲 3–4 秒→35ms，e2e 13/13 綠（原本 `cp3-game-loop`／`cp3-expansion #2` 逾時就是這個）。商店文案「泡滿 48 小時」改「泡 6 次澡」（由常數算）。
- 用 HUD 按鈕實跑新手流程（`tools/_scratch/play-human.mjs`，4 倍速 8 分鐘）：倒→泡澡中→撿→加工→出貨 0.6 分、收集手 1.7 分、第一張訂單成交 2.8 分（+61），無 console error。

- **點地上原料從來沒反應過（既有 bug，線上舊版重現 hits=0）**：`DropsView` 的 InstancedMesh 包圍球在 count=0 時被算成空球（半徑 −1），之後射線粗篩永遠不過。每次 sync 重算（≤5 實例）。commit `aa53016`；e2e 加「投影原料位置點下去要撿到＋往下點 offsetY 不能撿到」（同時鎖 D26 偏移有進射線）。點澡盆倒液體實測正常（units 0→1）。
- 商店重繪守衛的後期補量：全設備開啟、8 倍速 6 秒內 DOM 重寫 0 次（只在補液／跨價格門檻時變），不是每秒重寫。
- `tools/_scratch/`（未追蹤）裡的 measure-band／play-human／probe-click／probe-tap／probe-basin 都可重跑，**要不要收進 repo 待問使用者**。

**第二輪（中後期試玩，commit `3b61ab2`→`2ab98e1`，線上已驗）**
- **生產線靜默停擺**：開局 6 份焦糖，裝收集手＋注液閥後約 4 分鐘用完，之後布丁只在地板跳、什麼都不產、沒有任何提示（教學在買第一台設備後就停）。加 `stalledHint`（warning 類，按 × 關教學後仍顯示；離線歡迎卡也附上）。**注液閥只補「上次倒的那一種」（`preferredLiquid`）**：庫存有牛乳也不會自己換口味，所以有閥時判定看 preferred 的庫存、無閥時看所有可倒的庫存；裝了補貨合約就不講。
- 商店一次買 10 份（`BALANCE.stockBuyQty`）、補貨合約 floor 4／target 20：兩隻布丁一分鐘用 2 份，5 份只撐兩分半。
- HUD 上方改左右兩欄：切換列靠左（原本置中被訂單卡蓋住「›」，有訂單時切不回去）、住客列用物種短名（`SPECIES.shortName`／`Zone.shortName`）、訂單卡壓矮（100→75px）、**訂單欄限高 42vh 可捲動**（SE 三張卡疊到 309px、地板 257px 起，兩隻布丁被蓋住且點不到）、toast 改貼動作列上方（原本落在地板上蓋住突變那一刻）。320px 另有 media query（字 11px、量條 30px、欄寬 126px；**media query 寫在 .orders 規則之前要提高特異度**）。
- e2e 新增：320×568 三張訂單＋五份掉落物，卡片（與欄可見範圍取交集）不得蓋任何布丁／原料投影；負向對照拿掉 max-height 會紅。全套 15/15 綠、vitest 70。
- 用 `tools/_scratch/orders-vs-floor.mjs`／`layout-check.mjs` 對線上兩種尺寸再量一次都乾淨。
- 突變、解鎖上層鏡頭切換、全自動畫面、離線歡迎卡都實跑過，無 console error；draw calls 最高 27。

**第三輪（commit `aca34d5`，線上已驗）**
- 二號櫥窗解鎖→鏡頭橫移、拉遠上限、切回一號都正常（draw ≤ 27）。
- D27 點櫃子＝操作：鎖著的層→開商店、已解鎖的另一層→直接切區、鄰櫃上下層→toast「還沒開放」。`cabinet.ts` 給 TankFloors／TankGlass 命名；e2e `cp3-tap-tier.spec.ts`（負向對照拿掉 tapZone 會紅）。全套 e2e 16/16。
- **已知取捨**：非啟用區的布丁與設備不畫（draw call 預算），拉遠時其他層看起來是空的但名牌寫「住客 2 隻」。要改得先把布丁 4 個 mesh 合併，否則 5 隻全畫會到 39 draws。

**收尾（2026-09-22 凌晨，commit `77bba74`）**
- 使用者問「你怎麼自己玩」並要求記錄：試玩方法落成 repo 的 `.claude/skills/playtest/SKILL.md`＋`tools/playtest/`（lib／opening／midgame／offline／layout／taps／shop-click）＋`npm run playtest`；scratch 腳本已刪。六支都對線上跑過：layout 兩尺寸無疊、taps 4/4、shop-click 36–111ms、opening／midgame／offline 正常。
- **又有並行 session 在做「繁殖／基因」**（`src/game/breeding.ts`、`genetics.ts`、改 pacing 加 hybrid 情境、CLAUDE.md draw call 預算 30→35 D31）。本場只 commit 自己的檔；CLAUDE.md 用 `git apply --cached` 只進自己那個 hunk。**它的 dev server（5173）依賴快取過期會回 504 Outdated Optimize Dep，要自己另起 5174。**
- `tools/_scratch/` 去留：已收進 repo 為 `tools/playtest/`（使用者要求記錄玩法＝要留）。後期價格問題仍待使用者回。

**未做／待下一輪**
- 引導泡泡與第三張訂單卡在 390px 會重疊（泡泡在上、可讀；只在教學期＋三張訂單同時出現）。
- 二號櫥窗解鎖後的鏡頭橫移與遠景還沒截圖看。
- 後期內容薄：約 100 分鐘全部買完後無事可做（3000 幣時已無購買項），之後要加內容或拉開後段價格。
- 手機實測仍待使用者（AC1-3 fps、畫面簽核）。

## Last session（2026-09-21 第四場）
- 使用者跑 `gh repo create` 與 `gh api POST pages`（Claude 被分類器擋），Claude 接手 rerun deploy、curl 驗線上 index/JS 前綴/GLB、`LPG_BASE` 指線上網址跑 shoot-viewport 截圖確認場景正常。
- CLAUDE.md 開發指令改寫（區網直連改為 Pages），commit `715ddaa` 已推。
- 下一步：使用者 iPhone 開 Pages 網址 `?debug=1` 回報 fps 中位數（AC1-3）＋簽核畫面（AC1-4）→ CP1 綠 → CP2 規則模擬。

## Last session（2026-09-21 第四場：/loop「做成可以遊玩的養成遊戲」，已收尾）

**一句話**：遊戲從「只有櫥窗」做到「完整可玩並上線」。CP2 綠、CP3 程式完成、CP5 PWA 完成、公開網址 `https://nyannyn.github.io/little-pudding-game/` 實測可玩可離線。commit `d0f558e` → `95e43d7`，本機與遠端同 sha。

**下一場最先做的三件事**
1. **等使用者回報**：iPhone fps 中位數（AC1-3 基準線）、畫面簽核（AC1-4／AC3-4）、布丁尺寸要不要 0.2 → 0.26。這三件卡住 CP1 與 CP3 收綠。
2. **數值節奏稽核**（原訂第四輪、未做）：寫無頭長時間模擬，量「幾分鐘存到第一台設備／第一次突變／解鎖上層／解鎖二號櫥窗」，曲線不合理就調 `balance.ts`。這是唯一不需要使用者在場就能推進精緻度的項目。
3. **CP4 美術擴充**：鮮奶酪／抹茶／草莓目前只是 `SPECIES` 換色，四種澡盆共用同一個盆。要用 Blender MCP 做各自的頂料與盆身，每件先出預覽給使用者簽核。**動手前先算 draw call**：最壞情況已經 28／30。

**本場產出的可重跑工具**
- `npm run test:negative`（`tools/check-negative-controls.mjs`）：八條負向對照，把規則一條條改壞確認測試會紅；反向字串還原，不碰 git。
- `npm run smoke:live`（`tools/smoke-live.mjs`）：對線上或本機正式版跑 14 項（含 PWA 與離線重整）。本機要驗就 `vite build` ＋ `vite preview` 再把網址傳進去。
- `node tools/shoot-gameplay.mjs`：十張流程截圖（開局／泡澡／掉料／全自動／變白／突變／商店／上層／二號櫥窗／拉遠）。
- `node tools/make-icons.mjs`：用 Playwright 把 SVG 畫成 PWA 圖示。

**測試現況**：`vitest` 67 passed（`src/game` 行覆蓋 92%）、`playwright` 12 passed、負向對照 8/8 會紅。

### 本場詳細紀錄


- **CP2 邏輯層完成**（commit `d0f558e`）：`src/game/` 十一個檔（rng／balance／species／state／basin／pudding／equipment／orders／sim／actions／storage／events），零 three.js 依賴。
  - `World = { state, rng, floor, events }`；`advance(w, dt)` 把大 dt 切成 ≤1 秒的步，**離線八小時與開著玩八小時跑同一條路徑**。
  - 玩家動作在 `actions.ts`：失敗時 state 必須完全沒動（負向對照就是把「先扣錢再檢查」放回去，測試會紅）。
  - tick 直接就地改 state（不回新物件）：每幀複製整份 state 只會製造 GC 壓力；純函式語意只保留在 actions 層。
- **CP3 場景與 UI 完成**（commit `dbae50c`）：`scene/{puddingView,basinMesh,dropMesh,equipmentMesh,particles,audio}` ＋ `ui/{hud,hud.css,icons}`。
- **新工具兩支**：`tools/check-negative-controls.mjs`（`npm run test:negative`，把規則一條條改壞確認測試會紅，用反向字串還原不碰 git）、`tools/shoot-gameplay.mjs`（拍 AC3-4 的七張流程截圖）。
- 裝了 `@vitest/coverage-v8`（AC2-11 要量行覆蓋）。
- **待使用者決定的兩件事**：① 中層只占畫面中間三分之一，布丁偏小——要不要把鏡頭改成只框啟用層（會裁掉櫃子左右，與 D17「整座填滿」互斥）；② 節奏（D21）是否合適。

## Last session（2026-09-21 第三場）
- 開場 `get_scene_info` 通 → **CP0 收尾**（負向對照代用，見 Open failures）。
- WP2 建模：`tools/blender/build_pudding.py`（新檔，冪等、可重跑）以 bpy 程序化生成布丁——本體旋轉體、沿法線外推的焦糖糖衣＋4 瓣淋流、左右眼併一個 mesh（閉眼切換用）、左右腮紅併一個 mesh。四物件 parent 到 `Pudding_Body`，原點一律在底面中心（彈跳／squash 用）。
- 面數 468＋312＋160＋120＝**1060**（預算 3000，Blender 端實測）。AC1-1 的三角形差值**尚未量測**：`castShadow=true` 若陰影 pass 也記進 `renderer.info.render.triangles` 就約 2120、否則約 1060，兩者都在 [500, 3000] 內；真值等 e2e 實跑再補。draw call 一隻 4 個。
- 修 `tools/blender/render_preview.py`：view transform 改 `Standard`（AgX 洗色）、燈能量隨 radius 平方縮放（過曝）。
- 四輪造型迭代（板凳感→顏色洗白→腮紅埋住／焦糖像硬帽→鋸齒淋流）後四角度預覽乾淨。
- **設計定案：不加嘴巴**（2026-09-21 使用者決定）。布丁的臉＝兩眼＋腮紅，維持一隻 4 個 draw call。
- **使用者簽核：「可愛，眼睛小一點，彈跳時要看起來很 Q」** → 眼睛半徑 0.054→0.042、間距 15°→13.5°；眼睛／腮紅 `ring_count` 4/5→8 消掉多邊形邊。最終 1228 面。
- **Q 感需求已驗**：原點在底面中心，縮放 `Pudding_Root` 即 squash & stretch，焦糖／五官跟著變形不脫殼。實測用的參數 squash `(1.20, 1.20, 0.70)`、stretch `(0.86, 0.86, 1.30)`，預覽存 `docs/previews/pudding_{squash,stretch}_000.png`，WP5 做彈跳動畫時直接沿用這組比例當起點。
- 匯出 → `optimize-models.mjs` → 讀回 GLB 驗過五個節點名全在、材質對應正確、baseColorFactor 與 Blender 設定一致。
- **`spawnPudding()` clone 後配件位置已用畫面確認無誤**（焦糖／眼睛／腮紅都貼對位置，地板有投影）：`matrix_parent_inverse` 被烘進 glTF 節點 transform 這件事沒有造成錯位。
- 新增 `tools/measure-framing.mjs`：量櫥窗／布丁在畫面上的占比與環繞極限時會不會被裁，改構圖前後用數字比。為此在 `main.ts` 曝露 `window.__lpg.three = { scene, camera, renderer, controls }`（e2e 做幾何斷言也會用到），並給櫥窗群組 `name = 'Cabinet'`。
- 新增 `tools/shoot-viewport.mjs`：對跑著的 dev server 用 iPhone 14 視口拍圖存 `docs/previews/cp1-iphone-*.png`，供遠端工作時做視覺簽核。**注意腳本跑的是 SwiftShader 軟體渲染，印出來的 fps（2～7）沒有意義，不可拿來當 AC1-3 的數字。**
- `npm run e2e` 2 passed。**尚未 commit。**

## Last session（2026-09-21 第二場）
- 純環境安裝（Blender／uv／addon），紀錄含本機路徑，留在私有記憶庫的 `STATE.md`。沒有動 code。

## Last session（2026-09-21 第一場）
- 計畫兩輪修訂後核准（第一輪被退：使用者給了完整遊戲設計；第二輪補兩條進程軸）。
- 完成 WP1（骨架＋hello scene＋stats＋CP1 spec＋模型預算工具）、WP0-b（`.mcp.json`、CLAUDE.md）、WP8 記憶登記。
- 下一步：使用者做 WP0-a → 重開 Claude Code 於 `little-pudding-game` 目錄 → 驗 `get_scene_info` → WP2 建第一隻布丁。
