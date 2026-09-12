# MealMate 專案狀態（docs/STATUS.md）

> 最後更新：2026-09-13。**M0 完成並上線（`mealmate-v0.1.0`）；M1 尚未開始。**
> repo `yolin0513/mealmate` 已建立、GitHub Pages 已啟用。
> 給接手的工作階段快速接手用。規劃細節見 `PLAN.md`（唯一真相來源），實測見 `FEASIBILITY.md`，資料與衛教來源見 `SOURCES.md`。

## 進度

| 里程碑 | 狀態 | 線上版本 |
|---|---|---|
| M0 資料與骨架 | ✅ 完成（2026-09-13） | `mealmate-v0.1.0` |
| M1 家人與食譜瀏覽 | ⏳ 未開始（**下一步從這裡開始**） | — |
| M2 週計畫 | ⏳ 未開始 | — |
| M3 買菜 | ⏳ 未開始 | — |
| M4 今日煮與打磨 | ⏳ 未開始 | — |
| M5 上線 | ⏳ 未開始 | — |

測試現況：7 支測試（datatest 57、aliastest 26、unittest 29、edutest 13、copytest 7、recipetest 42、shelltest 81 項）＋ `mutationtest` **30 條突變逐一證明關鍵斷言改壞會紅**。全套約 4 分鐘。

### M0 開發期的實測發現（補充或修正規劃期假設）

1. **國健署網站用真實瀏覽器可以開**（規劃期 curl 403、WebFetch 憑證失敗）。開放宣告已人工確認：文字採政府資料開放授權條款第1版，須註明出處；**影音、圖像、專人專案撰文不在範圍** → App 只引用文字。全文與五頁衛教紀錄在 `docs/sources/`。
2. **「高齡營養健康食譜」「食物代換表」兩個 Detail 頁回的是檔案下載，不是網頁**（會跳儲存對話框，本次未下載）。食譜本來就自撰、不依賴；但「1 份醣類 ≈ 15 克」**還沒有可引用的原文**，M1 做醣類份數顯示前要先取得（見 `SOURCES.md` §2）。
3. **食藥署資料庫沒有「食鹽」「白砂糖」「米酒」**：鹽對到「岩鹽」P0300101、糖對到「紅砂糖」N0100301（二砂），取捨寫在 `data/aliases.json` 的 notes；**米酒無對應，這 36 道食譜都沒用米酒**。日後要加米酒等資料庫沒有的食材，需要另議「食材允許無編號」的規則 —— 那會改掉 PLAN「每個食材都解析得到編號」的測試保證，**要先問使用者**。
4. `data/foods.json` 實際 **686KB**（規劃估 100–350KB）：2,151 種食材全帶俗名與樣品狀態，方便手動加菜時搜尋。GitHub Pages 會 gzip，SW 快取一次。若要瘦身，選項是拿掉 `state` 與空欄位（估可省三成），M5 前決定。
5. 食藥署匯出檔用同名條目消歧後 **沒有任何兩筆同顯示名**（同名不同年 29 筆略過、9 筆改名去年份）。
6. **puppeteer 的 Chrome 下載在這台機器會失敗**（`downloadBrowsers` 階段）。改釘 `puppeteer@23.11.1`（跟 StockDiary 同版）並用 `PUPPETEER_SKIP_DOWNLOAD=1 npm install`，直接用 `~/.cache/puppeteer` 裡已有的 Chrome 131。**換機器要先確認快取裡有那一版 Chrome**，沒有就 `npx puppeteer browsers install chrome@131.0.6778.204`。
7. 突變測試抓到一條假斷言：「步驟順序錯」的反例同時踩到兩條規則，拿掉其中一條檢查時另一條順便擋住 → 突變不會紅。已改成三個各自只違反一條規則的反例（StockDiary 慣例 13 的形狀）。

## 部署

| 項目 | 位置 |
|---|---|
| 前端（GitHub Pages） | `https://yolin0513.github.io/mealmate/`（repo `yolin0513/mealmate`，公開；push main 即部署；`sw.js` 的 VERSION 每版必 bump） |
| Worker／後端 | **無**。App 沒有任何外部請求，CSP `connect-src 'self'`；`shelltest` 掃程式碼確認零外部 fetch |
| 靜態資料 | `data/foods.json` 由 `scripts/build-foods.mjs` 從食藥署 zip 產生（本機執行、commit；`--download` 重抓）；`data/recipes.json` 由 `scripts/build-recipes.mjs` 合併 `data/recipes/*.json`（改食譜忘了 build → recipetest 紅）；`data/edu.json`、`data/aliases.json`、`data/units.json`、`data/foodtags.json` 手寫 |
| 原始資料 | `data/raw/tfnd-2026-08-26.{zip,json}` 在本機（`.gitignore`），不進 repo |
| 本機預覽 | `npm run dev`（5190）；Claude 桌面版用 `.claude/launch.json` 的 `mealmate-dev` |

## 工作慣例（常設規則，給每一個接手的工作階段）

1. **使用者已授權自行執行**查詢、新增檔案、搬移檔案、git 操作（建 repo、commit、push、部署），**不必逐項請示**。只有「刪除使用者資料」「花錢」「動到其他專案（JLPT_App、TripQuest、StockDiary）」才要問。
2. **重大決策開多代理投票**：架構、資料結構、部署方式、需付費或註冊的服務 → 開 **3 個 Fable 5.1（`claude-fable-5-1`）代理**、同一份 prompt、各自獨立、多數決；分歧採保守；決議寫進回報與本文件。規劃期**沒有開**（純前端單一架構、無付費服務），使用者 2026-09-12 確認；開發期照 `PLAN.md` 做不需要開，**要偏離 PLAN 的架構或資料結構時才開**。
3. **Fable 額度用盡就自動改用 Opus 5，不要停下來問。** 代理因 429／quota 失敗 → 自動改 `claude-opus-5` **整批重跑**（投票要在同一模型上才可比），回報中註明「因 Fable 額度用盡改用 Opus 5」。只有 Opus 5 也不可用時才暫停。
4. **測試不得有假斷言。每條斷言都要能用突變測試證明它真的會紅**：把對應邏輯改壞（例如讓素版營養把葷軌加進去、讓慢性病降分變成排除、讓缺克數當 0），測試必須失敗；修回去必須綠。檢查器（禁用詞掃描、食材解析、regex 跳脫掃描）要有**對照組**：餵已知該被抓到的輸入，斷言真的抓到。「應該是 0」的斷言旁邊要有「母體非空」的斷言。註解不是斷言。寫完一條 `noneOf`／`everyOf` 就問一次：**這個母體現在有幾個元素？** `everyOf([1], () => true)` 是 `ok(true)` 換衣服，不算斷言。**反例要只踩一條規則**（M0 就抓到一次踩兩條的）。
5. **含 regex 的測試碼一律用 Write 工具直接寫檔，不要經過 shell heredoc。** StockDiary 踩過：`\s` 變成 `\\s`，在 regex 裡是「反斜線接字母 s」，**不報錯、測試綠、但那條斷言從此不命中任何東西**。`shelltest` 有「regex 字面值裡出現雙反斜線＋類別字元」的掃描，跳過註解與字串，附兩條對照組。M0 全程用 Write 寫檔（規劃期一次 heredoc 就因引號炸掉）。
6. **繁體中文介面**；文案誠實——算不出來就寫「未估算」「尚未設定」「這一版尚未開放」，不顯示 0、不用預設值冒充使用者輸入、不用舊資料冒充新資料。
7. **健康界線（本 App 的第一條紅線）**：
   - **不得出現療效宣稱、治療處方、可取代醫囑的內容**——UI 文案、內建食譜文字、`edu.json`、說明頁、測試對照組全部適用。禁用詞清單在 `scripts/copytest.mjs` 的 `FORBIDDEN`（與 `PLAN.md` §1.2 第 5 點一致），母體 2,500+ 字串、有對照組、有兩條突變。
   - **營養數字一律標「估」，且可展開來源**：`fmtEst()` 有值回「估 42 g」、null 回「未估算」（datatest 盯著；突變「顯示估 0」會紅）。M1 接營養累加時，「怎麼算的」要列食材 × 克數 × 食藥署條目 ＋ 資料版本 ＋「未計烹調變化」。
   - **慢性病只做一般衛教，不做治療建議**：留意項目只影響「顯示哪些欄位」與「排序分數」，**不硬過濾**（唯一的排除是使用者自己打開的「避開」開關）；**不算個人目標**，`prefs.DEFAULTS.dailyTargets` 是空物件（有突變盯著）；**腎臟病不自動限鉀**；每一句衛教文字都指向 `edu.json` 的一個 id（edutest 掃 `edu()`／`eduText()`／`eduNode()` 的呼叫）。
8. **不做帳號、雲端、任何外部請求。** 家人的健康設定只在本機 IndexedDB 與使用者自己的匯出檔。程式碼裡出現非同源 `fetch(` 或 CSP 多開主機 → `shelltest` 紅（各有突變）。
9. 沿用 JLPT_App／TripQuest／StockDiary 技術路線：原生 JS ES Modules ＋ IndexedDB ＋ Service Worker，無框架、無打包；`h()` 全 textNode、URL 屬性白名單；CSP `script-src 'self'`；**任何一頁不准自己 `mount(#view)`，一律走 `shell.js` 的 `render(...nodes)`**（router 的 `gen`／`paintGen` 守門照抄 StockDiary）；**`js/app.js` 是進入點，不准被任何模組 import**；`index.html` 每個網址帶不帶版本參數要跟模組圖一致。都有 `shelltest` 靜態稽核。
10. **資料授權標示**：食藥署資料（政府資料開放授權條款第1版）→ 家人分頁「關於與資料來源」卡片已標（`eduNode('fda.tfnd.attribution')`）；M1 起每個營養估算的「怎麼算的」底部也要標。國健署引用只用文字、不用圖像（開放宣告排除影音圖像，已人工確認）。
11. 每版流程：`npm run bump -- mealmate-vX.Y.Z` → `npm test`（受影響的）→ `npm run build-recipes`（有改食譜時）→ commit/push → `curl https://yolin0513.github.io/mealmate/js/version.js` 確認線上版本 → `npm run screenshots`（`screenshots/features/`）。
12. 打真網路的測試：**沒有**（App 無網路呼叫）。`build-foods.mjs --download` 是開發者本機工具，不進 `npm test`；它的轉換邏輯用固定樣本（白飯的原始列）在 `datatest` 驗。
13. 不動 `D:\Claude\App\TripQuest`、`D:\Claude\App\JLPT_App`、`D:\Claude\App\StockDiary` 的任何檔案（可讀，用來抄慣例：`backup.js` 逐列先驗證再 clear、`layouttest`／`uikittest` 的全頁掃描、`racetest`／`versionmixtest`）。
14. **斷言驗語意、不貼字面。** 文案一改就紅的斷言要改成驗語意（筆數、連結指向、幾個關鍵詞之一）。
15. **測試範圍：平常只跑受影響的，全面檢測由使用者叫**（沿用 StockDiary 的使用者指示）。判斷受影響：`grep -l "views/<改到的檔>" scripts/*.mjs`；改到 view 要加 `shelltest`；`css/style.css` → `shelltest`（M4 起加 `layouttest`、`uikittest`）；`js/app.js`／`router.js`／`shell.js` → `shelltest`；`js/recipeschema.js`／`data/recipes/` → `recipetest`、`copytest`；`js/foods.js`／`data/aliases.json` → `aliastest`、`recipetest`、`unittest`；`data/edu.json`／任何 `edu(` 呼叫 → `edutest`、`copytest`。**沒有放寬的那一條：新的斷言仍然必須經突變驗證會紅**（`npm run mutationtest -- --only <關鍵字>`）。
16. **資料庫換季（食藥署每季更新）**：`npm run build-foods -- --download` 會印出「消失的編號／營養值改變／新增」；消失的編號若被別名表或食譜用到，`aliastest`／`recipetest` 會紅；`aliases.json` 的 `foodsVersion` 要同步改（datatest 之外 aliastest 也比對）。

## 開發順序與驗收條件

### M0 資料與骨架 ✅（2026-09-13，`mealmate-v0.1.0`）

| 工作 | 驗收（實際） |
|---|---|
| ~~repo、Pages、package.json、.gitignore~~ | 線上開得起來；puppeteer 釘 23.11.1（見實測發現 6） |
| ~~PWA 殼~~（`index.html`、`sw.js`、`js/{app,router,shell,db,ui,store,prefs,version,foods,units,recipeschema,edu}.js`、四個分頁 view） | `shelltest` 81 項：import 圖 ⊆ SHELL、版本三處一致、無人 import app.js、無頁繞過 render、regex 跳脫掃描、零外部 fetch、CSP connect-src 'self'、h() 拒 html:、URL 白名單、五條路由都畫得出、不認得的網址不靜默跳首頁、關於卡片有版本與兩個資料來源、首頁有健康三句 |
| ~~`build-foods.mjs` → `data/foods.json`~~ | `datatest` 57 項：白飯固定樣本六個值、空值 null 不是 0（對照：「0」是 0）、同名不同年略過、同名不同狀態消歧、單位不一致丟錯、真資料 2,151 筆無同名、12 key 皆在、1,001 筆 sugar 為 null 且沒有一筆被寫成 0 |
| ~~食材別名表~~ `data/aliases.json`（198 個口語詞） | `aliastest` 26 項：每個別名指到存在的編號；解析精確（豬→null 且母體確認馬齒莧俗名含豬、雞→null 且鷹嘴豆俗名含雞）；搜尋精確命中在前 |
| ~~採買單位、匙量、保存天數~~ `data/units.json` ＋ `js/units.js` | `unittest` 29 項：鍵都在別名表；18 個分類都有預設；918 組換算不少買、多買 < 半單位（對照：四捨五入會少買）；override 優先 |
| ~~人工開國健署頁面~~ → `docs/sources/` 五頁、`docs/SOURCES.md`、`data/edu.json` 12 筆 | `edutest` 13 項：每筆有機關／標題／https／擷取日／版本／紀錄檔；9 筆 quote 逐字可在紀錄檔找到（對照：改一字、加尾巴都抓到）；js/ 用到的 3 個 id 都存在 |
| ~~食譜 schema ＋ 驗證器 ＋ 36 道~~（主菜 18、配菜 8、湯 5、主食 2、早餐 3；素 22、可分流 10、葷 4） | `recipetest` 42 項：204 個食材列全部是存在的編號；三軌、split 順序；素的菜零葷標籤；標籤推導（番茄炒蛋→五辛＋蛋、鯛魚→海鮮／fish、麻婆豆腐→soy＋pork）；`recipes.json` 與重建一致；驗證器抓到 11 種壞法且放行好的 |
| ~~`copytest` 禁用詞掃描~~ | 7 項：2,558 個字串、45 個檔案、零禁用詞；判準對照組 7 正 8 反 |
| ~~`mutationtest`~~ | 30 條全部證明會紅 |

### M1 家人與食譜瀏覽（下一步）

| 工作 | 驗收 |
|---|---|
| `members` store、家人頁（暱稱、年齡層、飲食型態四選一、留意項目 toggle、腎臟病子勾選、質地、過敏原）、買菜日七鈕、首次啟動說明頁（三句話已在首頁，改成首次一頁＋設定常駐） | `membertest`：腎臟病未勾任何子項時 `watch[]` 不含 potassium 等；說明頁「我知道了」前 `disclaimerAcceptedAt` 為空 |
| `js/nutrition.js`：食材克數 × 每 100 克累加、素版／葷版分開、每份＝總量 ÷ 該版份數、「怎麼算的」展開（食材 × 克數 × 條目 ＋ 資料版本 ＋ 未計烹調變化 ＋ `eduNode('fda.tfnd.attribution')`） | `nutritiontest`：固定食譜（白飯 200 g ＋ 雞蛋 50 g ＋ 醬油 10 g）等於由 `foods.json` 值手算到小數一位（期望值由 fixture 算，不寫死）；**素版不含任何 meat 軌食材**（突變：把 meat 加進素版 → 紅）；null 值的食材 → 該欄「未估算」不是 0，且「怎麼算的」列出「未計入：X（資料庫無此值）」；每個數字前有「估」 |
| 食譜頁補篩選（低醣／低鈉／當季／收藏／我的）、詳情頁（份數切換重算、素版葷版切換、加入本週、收藏、複製修改） | `recipeviewtest`：篩選「全素不含五辛」後清單零 `allium`／`egg`／`dairy`／`meat`／`seafood`（母體：池中有這些標籤的菜 ≥ 20 道，目前 36 道裡有）；切份數 4 → 6 時每份數字不變、總量變 |
| 手動新增食譜（克數選填），用同一支 `validateRecipe`（放寬：使用者食譜克數可缺 → 該食材「未估算」） | 沒填克數 → DOM 顯示「未估算」且不出現「0 g」（突變：缺值當 0 → 紅） |
| 收藏、「本週想吃」（最多 7 道） | 第 8 道勾不起來且有提示 |
| 匯出／匯入 JSON（沿用 StockDiary `backup.js`） | `backuptest`：round-trip（匯出 → 清空 → 匯入完全一致，中間有「確實清空過」斷言）；壞檔整份拒收且現有資料一列不少（附「補上主鍵就放行」對照組） |
| 每日目標欄位 | 載入時全為空字串；DOM 不含「建議攝取」「應該吃」；對照組：塞預設值 → 紅 |
| 醣類份數顯示（1 份 ≈ 15 克） | **先取得可引用的原文**（食物代換表 PDF 人工下載核對頁碼，或找到 HTML 版），寫進 `edu.json` 才做；沒來源就不顯示份數 |

### M2 週計畫

| 工作 | 驗收 |
|---|---|
| `js/planner.js` 純函式（輸入輸出見 `PLAN.md` §4.3）、固定種子 PRNG、`reasons[]`、`diagnostics` | `plannertest`：同種子同輸入 → 同輸出（突變：`Math.random()` → 紅）；主菜池 ≥ 40 時 4 週主菜 14 天內不重複（**目前主菜 18 道，要先補食譜或用合成池**）；池子縮到 10 道時 `diagnostics.forcedRepeats` 非空 |
| 不重複規則：主菜 14、配菜 7、湯 7、**早餐 0** | 早餐同一道可週一、週三重複（突變：早餐吃 14 天扣分 → 紅） |
| 慢性病計分（只降分）、「避開」開關（使用者開才排除）、腎臟病只對勾選欄位計分 | **池子只剩高醣主菜時，糖尿病家庭仍排得出菜且 reasons 說明**（突變：降分改排除 → 紅）；未勾「鉀」時鉀不影響分數（突變：鉀永遠計分 → 紅） |
| 素食規則：有素食成員時每餐至少一道 `nativeVeg` 或 `splittable` 主菜；`meatOnly` 只能是加菜 | 改壞 → 紅；母體：測試家庭含蛋奶素與全素不含五辛各一人 |
| 蛋白質輪替（用 `recipe.proteins`）、魚每週 ≥ 2、當季加分、質地加分、採買效率加分、保存期限硬約束（`shelfDaysFor`）、烹調時間上限、同餐不同烹法 | 各一條斷言＋突變；保存期限：葉菜不會排在買菜日後第 4 天以上 |
| 本週頁：一天一卡／桌機七欄、換一道、指定、鎖定、外食、「為什麼選這道」、每日估算彙總與一般衛教參考（灰字、附 edu id） | `weekviewtest`：鎖定格重新產生後不變；外食格無菜；每格 reasons 非空 |

### M3 買菜

| 工作 | 驗收 |
|---|---|
| 採買區間切分、清單彙整（同食材加總）、`toBuyQty` 換算、賣場分區、常備品另列、勾「買了」「家裡有」、複製成文字、印出樣式 | `shoppingtest`：週三＋週六 → 兩區間覆蓋 7 天無重疊；同一食材跨三餐加總正確；`pantry` 不在主清單但在常備段；外食格食材不進清單；週中改菜後已勾「買了」保留；「家裡有」下次產生時加分 |
| 保存期限與買菜日的耦合（planner 已做，這裡驗整合） | 端對端：產生 → 清單 → 每個葉菜出現的餐都在該區間買菜日後 3 天內 |

### M4 今日煮與打磨

| 工作 | 驗收 |
|---|---|
| `js/timeline.js`：當餐所有菜的步驟合併成一條時間線（`prep` 全部在前；燉湯的 `cook` 先開火；`split` 在同道菜的 `veg`／`meat` 之前；每步大按鈕「完成」） | `timelinetest`：順序斷言各一條＋突變；**時間線只合併步驟，不合併營養**（斷言時間線頁的營養區塊仍是素版／葷版兩欄） |
| 印出樣式（週菜單＋清單）、長輩字級 19px、首次啟動三步、觸控 ≥ 44px | `layouttest`：全部頁 × 2 字級 × 3 寬度，零溢出、零重疊、零橫向捲動，母體是全部組合；fixture 放最長菜名與最多家人；`uikittest` 掃全頁所有可點元件 ≥ 44px |
| 非同步畫面守門、換版提示列（照 StockDiary） | `racetest`、`versionmixtest` 沿用 |

### M5 上線

| 工作 | 驗收 |
|---|---|
| 食譜補到 **170 道**（主菜 80、配菜 50、湯 25、早餐 10、主食 6；主菜中 `nativeVeg`＋`splittable` ≥ 45） | `recipetest` 數量門檻斷言（各角色、各 vegMode）；`copytest` 母體門檻升到 1,500 |
| `foods.json` 瘦身決定（見實測發現 4）、iPhone 主畫面 App 實測（離線開啟、儲存與 Safari 分開的提示） | 線上 VERSION 一致；設定頁有「主畫面 App 與 Safari 不共用資料，匯出是唯一救援」的說明 |
| 全面檢測 | **只在使用者要求時**跑：全部測試＋全部突變 |

## 接手者最容易做錯的事

1. **把慢性病設定做成硬過濾。** 留意項目只決定「卡片顯示哪三個數字」與「排序分數」。一旦變成過濾，有糖尿病長輩的家庭池子會剩一半、重複感暴增，而且等於 App 在替醫師決定「這道不能吃」。唯一的排除是使用者自己打開的「避開」開關。`plannertest` 要有「池子只剩高醣主菜時仍排得出菜」的斷言，突變「降分改排除」必須紅。
2. **腎臟病自動限鉀（或限蛋白）。** 衛教一致：限鉀只在血鉀高或醫囑時。只對使用者勾選的鈉／鉀／磷／蛋白質計分，沒勾的欄位連分數都不參與。突變「鉀永遠計分」必須紅。
3. **營養數字沒標「估」、不能展開來源，或把 null 當 0。** 食藥署有 1,001 筆糖質、1,138 筆膽固醇是空的，手動食譜可能沒填克數——那一欄要寫「未估算」，不是 0；每個數字都要能點開看「食材 × 克數 × 條目 ＋ 版本」。`fmtEst()` 已經這樣做，M1 累加時不要自己另寫一個格式器。
4. **素葷合成時間線時把兩版營養加在一起。** 時間線合併的是**步驟**（依 stage／type 排序），營養永遠是素版＝base＋veg、葷版＝base＋meat，各除各的份數。把 veg 與 meat 兩軌都加進同一份會讓數字憑空多三成。`nutritiontest` 的突變「素版含 meat」必須紅，`timelinetest` 要斷言時間線頁仍是兩欄。
5. **用名稱字串（尤其子字串）去查食藥署營養。** 實測：「白米」0 筆、「豬」83 筆前幾筆是馬齒莧、「雞」撈到鷹嘴豆。食譜只存整合編號；口語詞經 `resolveFood` 精確比對（有突變盯著「退回子字串」）；新食材先用 `npm run findfood -- 詞` 查再寫進 `aliases.json`。

另外三件較小但會一路痛的：**早餐納入不重複計分**（10 道早餐兩週就耗光；`noRepeatDays.breakfast` 是 0，有突變）；**池子不夠時靜默重複**（要進 `diagnostics` 並在本週頁明講「本週有 N 道重複，因為符合條件的菜只有 M 道」）；**改了食譜沒跑 `npm run build-recipes`**（`recipetest` 會紅，訊息是「data/recipes.json 跟現在重建的一模一樣」失敗）。
