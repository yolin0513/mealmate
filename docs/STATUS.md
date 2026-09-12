# MealMate 專案狀態（docs/STATUS.md）

> 最後更新：2026-09-13。**M0、M1、M2 完成並上線（`mealmate-v0.3.0`）；M3 尚未開始。**
> repo `yolin0513/mealmate`，GitHub Pages `https://yolin0513.github.io/mealmate/`。
> 給接手的工作階段快速接手用。規劃細節見 `PLAN.md`（唯一真相來源），實測見 `FEASIBILITY.md`，資料與衛教來源見 `SOURCES.md`。

## 進度

| 里程碑 | 狀態 | 線上版本 |
|---|---|---|
| M0 資料與骨架 | ✅ 完成（2026-09-13） | `mealmate-v0.1.0` |
| M1 家人與食譜瀏覽 | ✅ 完成（2026-09-13） | `mealmate-v0.2.1` |
| M2 週計畫 | ✅ 完成（2026-09-13） | `mealmate-v0.3.0` |
| M3 買菜 | ⏳ 未開始（**下一步從這裡開始**） | — |
| M4 今日煮與打磨 | ⏳ 未開始 | — |
| M5 上線 | ⏳ 未開始 | — |

測試現況：14 支測試 ＋ `mutationtest`。Node 端：datatest 57、aliastest 26、unittest 29、edutest 13、copytest 7、recipetest 45、membertest 41、nutritiontest 95、plannertest 84；瀏覽器端（puppeteer）：shelltest 104、familytest 29、recipeviewtest 49、backuptest 30、weekviewtest 32。`mutationtest` **62 條突變逐一證明關鍵斷言改壞會紅**（M2 新增 14 條各別驗過會紅；完整套件約 25 分鐘，只在使用者要求時全跑）。平常只跑受影響的（慣例 15）。

### M2 開發期的實測發現

1. **食譜補到 90 道**（主菜 48、其中素食成員可吃 33；配菜 16、湯 10、早餐 11、主食 5），全部過同一支驗證器：每個食材解析到食藥署編號、可分流的有三軌與 `splitServings`、沒有米酒。新增三個由食材**推導**的標籤：`sweet`（糖類食材每份 ≥ 4 克）、`processed`（加工肉／醃漬）、`wholegrain`（糙米、五穀、燕麥、甘藷…）；目前池子裡沒有 sweet／processed 的菜，開關與突變用合成食譜驗。
2. **「留意欄位只降分不排除」需要特別設計的測試才分得出來**：「池子只剩高醣主菜」這個前提有漏洞——相對池子自己的中位數，永遠有一半不算高，排除掉一半後剩下的照樣填滿 14 格，突變不會紅。改成「高醣但沒吃過」對上「低醣但昨天吃過（扣 100）」：扣分制選高醣的、排除制被迫重複。這是 StockDiary 慣例 13（反例太弱）的又一個形狀。
3. **同一天不排同一道菜**要是硬約束（真的沒得選才放寬），只靠 14 天扣分會出現午晚餐都是塔香茄子。`lastServed()` 原本把同日排除掉了，是 bug。
4. **湯的池子 10 道、平日晚餐上限 40 分鐘擋掉三道慢湯**，7 天內重複是誠實的診斷；`diagnostics.forcedRepeats` 記下來、本週頁明講「因為符合條件的菜不夠」。主菜 48 道時 4 週零重複。
5. 「醣較低／鈉較低」與規劃器的「高於中位數」都是**相對這個池子**的事實描述，畫面與理由都寫出中位數是多少；不是任何營養學上限。
6. 「換一道」的亂數種子帶 `Date.now()`（同一格連按會給不同的菜），但排除現在這道是結構性的，所以「換到的不是原本那道」可測；「重新產生」換 seed、鎖住的不動。

### M1 開發期的實測發現

1. **三個真 bug**：(a) 沒有家人時營養卡多印出一個「null」字（`replaceChildren(null)` 不像 `h()` 會略過 null）→ shelltest 每條路由現在都斷言畫面上沒有 `null`／`undefined`／`NaN`；(b) toast 淡出的 250 毫秒仍在畫面上（opacity 0），會擋住底下的按鈕 → `#toast { pointer-events: none }`；(c) `.sub-block`／`.notice` 的 `display:flex` 蓋掉 `hidden` 屬性，腎臟病沒開時子項照樣顯示、空的錯誤框變成一條紅框 → `[hidden] { display: none !important }`。(a)(b) 是測試抓到的，(c) 是截圖走查抓到的——familytest 原本只驗「開了會出現」沒驗「沒開要看不到」，已補成量 computed style 與高度。三個都有突變。
2. **puppeteer 的 `page.click` 只檢查元素在視窗範圔內就點中心**，頁面底部的按鈕會被固定分頁列或 toast 蓋住。瀏覽器測試一律用 `browserlib.clickEl()`（先捲到畫面中央再點）。
3. **可分流的菜要宣告 `splitServings`**（素幾人份、葷幾人份，加起來等於 servings），否則「每人一份」算不出來。10 道內建食譜都設素 1、葷 3；分流步驟文字改成「依吃素的人數分」。M2 依實際家人人數縮放兩軌。
4. **醣類份數不做**（使用者 2026-09-13 確認）：食物代換表頁是檔案下載、沒有可引用原文；在拿到出處之前只顯示「估 醣 X g」。recipeviewtest 有一條斷言畫面上沒有「份醣／醣類份數」。
5. 「醣較低」「鈉較低」篩選的門檻是**這個池子每份估計值的中位數**，畫面上會寫出門檻與來由；不是任何營養學上限。
6. 使用者手動食譜跟內建食譜用同一支 `validateRecipe`，只放寬 `allowMissingGrams`：沒填克數的食材在營養標示裡整個不計入、列在「沒填克數、未計入」，不是 0。

### M0 開發期的實測發現（補充或修正規劃期假設）

1. **國健署網站用真實瀏覽器可以開**（規劃期 curl 403、WebFetch 憑證失敗）。開放宣告已人工確認：文字採政府資料開放授權條款第1版，須註明出處；**影音、圖像、專人專案撰文不在範圍** → App 只引用文字。全文與五頁衛教紀錶在 `docs/sources/`。
2. **「高齡營養健康食譜」「食物代換表」兩個 Detail 頁回的是檔案下載，不是網頁**（會跳儲存對話框，本次未下載）。食譜本來就自撰、不依賴。
3. **食藥署資料庫沒有「食鹽」「白砂糖」「米酒」**：鹽對到「岩鹽」P0300101、糖對到「紅砂糖」N0100301（二砂），取捨寫在 `data/aliases.json` 的 notes；**米酒無對應，內建食譜都沒用米酒**。使用者 2026-09-13 確認：不為了收錄食譜放寬「每個食材都要解析得到編號」；要加再問。
4. `data/foods.json` 實際 **686KB**（gzip 約 120KB）；使用者確認可接受，瘦身留到 M5。
5. 食藥署匯出檔用同名條目消歧後 **沒有任何兩筆同顯示名**（同名不同年 29 筆略過、9 筆改名去年份）。
6. **puppeteer 的 Chrome 下載在這台機器會失敗**。改釘 `puppeteer@23.11.1` 並用 `PUPPETEER_SKIP_DOWNLOAD=1 npm install`，直接用 `~/.cache/puppeteer` 裡已有的 Chrome 131。**換機器要先確認快取裡有那一版 Chrome**，沒有就 `npx puppeteer browsers install chrome@131.0.6778.204`。
7. 突變測試抓到一條假斷言：「步驟順序錯」的反例同時踩到兩條規則，拿掉其中一條檢查時另一條順便擋住 → 突變不會紅。已改成三個各自只違反一條規則的反例。

## 部署

| 項目 | 位置 |
|---|---|
| 前端（GitHub Pages） | `https://yolin0513.github.io/mealmate/`（repo `yolin0513/mealmate`，公開；push main 即部署；`sw.js` 的 VERSION 每版必 bump） |
| Worker／後端 | **無**。App 沒有任何外部請求，CSP `connect-src 'self'`；`shelltest` 掃程式碼確認零外部 fetch |
| 靜態資料 | `data/foods.json` 由 `scripts/build-foods.mjs` 從食藥署 zip 產生（本機執行、commit；`--download` 重抓）；`data/recipes.json` 由 `scripts/build-recipes.mjs` 合併 `data/recipes/*.json`（改食譜忘了 build → recipetest 紅）；`data/edu.json`、`data/aliases.json`、`data/units.json`、`data/foodtags.json` 手寫 |
| 使用者資料 | IndexedDB `mealmate`（members、settings、userRecipes、favorites、plans、history、shopping、recipeNotes）；匯出／匯入在家人分頁「備份」 |
| 原始資料 | `data/raw/tfnd-2026-08-26.{zip,json}` 在本機（`.gitignore`），不進 repo |
| 本機預覽 | `npm run dev`（5190）；Claude 桌面版用 `.claude/launch.json` 的 `mealmate-dev` |

## 工作慣例（常設規則，給每一個接手的工作階段）

1. **使用者已授權自行執行**查詢、新增檔案、搬移檔案、git 操作（建 repo、commit、push、部署），**不必逐項請示**。只有「刪除使用者資料」「花錢」「動到其他專案（JLPT_App、TripQuest、StockDiary）」才要問。
2. **重大決策開多代理投票**：架構、資料結構、部署方式、需付費或註冊的服務 → 開 **3 個 Fable 5.1（`claude-fable-5-1`）代理**、同一份 prompt、各自獨立、多數決；分歧採保守；決議寫進回報與本文件。規劃期沒有開（純前端單一架構、無付費服務），使用者 2026-09-12 確認；開發期照 `PLAN.md` 做不需要開，**要偏離 PLAN 的架構或資料結構時才開**。
3. **Fable 額度用盡就自動改用 Opus 5，不要停下來問。** 代理因 429／quota 失敗 → 自動改 `claude-opus-5` **整批重跑**，回報中註明。只有 Opus 5 也不可用時才暫停。
4. **測試不得有假斷言。每條斷言都要能用突變測試證明它真的會紅**：把對應邏輯改壞，測試必須失敗；修回去必須綠。檢查器要有**對照組**。「應該是 0」的斷言旁邊要有「母體非空」的斷言。註解不是斷言。寫完一條 `noneOf`／`everyOf` 就問一次：**這個母體現在有幾個元素？** **反例要只踩一條規則**。
5. **含 regex 的測試碼一律用 Write 工具直接寫檔，不要經過 shell heredoc。** `\s` 變 `\\s` 不報錯、測試綠、但永遠不命中。`shelltest` 有雙反斜線掃描與兩條對照組。批次改測試碼可以用 sed 做**純字串**替換（M1 用過），但一碰到反斜線就回 Write。
6. **繁體中文介面**；文案誠實——算不出來就寫「未估算」「尚未設定」「這一版尚未開放」，不顯示 0、不用預設值冒充使用者輸入。
7. **健康界線（本 App 的第一條紅線）**：
   - **不得出現療效宣稱、治療處方、可取代醫囑的內容**——UI 文案、內建食譜、`edu.json`、說明頁、測試對照組全部適用。禁用詞清單在 `scripts/copytest.mjs` 的 `FORBIDDEN`，母體 2,500+ 字串、有對照組、有突變。
   - **營養數字一律標「估」，且可展開來源**：`fmtNutrient()`／`fmtEst()` 有值回「估 42 g」、null 回「未估算」；「怎麼算的」列食材 × 克數 × 食藥署條目 ＋ 資料版本 ＋「未計烹調變化」＋ 來源。部分食材沒值 → 數字旁標「＊」並列出沒計入的食材。
   - **素版葷版各自算、永遠不相加**：`nutrition.tracksFor()` 素版 base＋veg、葷版 base＋meat（有突變）。
   - **慢性病只做一般衛教，不做治療建議**：留意項目只影響「顯示哪些欄位」與（M2 起）「排序分數」，**不硬過濾**；**不算個人目標**，`newMember().targets` 全 null、表單欄位載入時空字串、沒有帶數字的 placeholder；**腎臟病不自動限鉀**（`watchFields()` 只帶使用者勾的，有突變）；每一句衛教文字都指向 `edu.json` 的一個 id。
   - **醣類份數在拿到可引用來源前不顯示**（使用者 2026-09-13 確認）。
8. **不做帳號、雲端、任何外部請求。** 程式碎裡出現非同源 `fetch(` 或 CSP 多開主機 → `shelltest` 紅（各有突變）。
9. 沿用 JLPT_App／TripQuest／StockDiary 技術路線：原生 JS ES Modules ＋ IndexedDB ＋ Service Worker，無框架、無打包；`h()` 全 textNode、URL 屬性白名單；CSP `script-src 'self'`；任何一頁不准自己 `mount(#view)`，一律走 `shell.js` 的 `render(...nodes)`；`js/app.js` 不准被任何模組 import；`index.html` 每個網址帶不帶版本參數要跟模組圖一致。都有 `shelltest` 靜態稽核。**`replaceChildren(...)` 的參數要自己過濶 null**（h() 會略過、它不會）。
10. **資料授權標示**：食藥署資料 → 家人分頁「關於與資料來源」與每個「怎麼算的」底部（`eduNode('fda.tfnd.attribution')`）。國健署引用只用文字、不用圖像。
11. 每版流程：`npm run bump -- mealmate-vX.Y.Z` → 受影響的測試 → `npm run build-recipes`（有改食譜時）→ commit/push → `curl https://yolin0513.github.io/mealmate/js/version.js` 確認線上版本 → `npm run screenshots`。
12. 打真網路的測試：**沒有**。`build-foods.mjs --download` 是開發者本機工具，不進 `npm test`。
13. 不動 `D:\Claude\App\TripQuest`、`D:\Claude\App\JLPT_App`、`D:\Claude\App\StockDiary` 的任何檔案（可讀，用來抄慣例：`layouttest`／`uikittest` 的全頁掃描、`racetest`／`versionmixtest`）。
14. **斷言驗語意、不貼字面。**
15. **測試範圍：平常只跑受影響的，全面檢測由使用者叫**（沿用 StockDiary 的使用者指示）。判斷受影響：`grep -l "views/<改到的檔>" scripts/*.mjs`；改到任何 view → `shelltest`；`js/views/family.js`／`member.js` → `familytest`；`js/views/recipe*.js`／`js/nutrition.js`／`js/store.js` → `recipeviewtest`、`nutritiontest`；`js/planner.js`／`js/views/week*.js` → `plannertest`、`weekviewtest`；`js/backup.js`／`js/db.js` → `backuptest`；`js/members.js` → `membertest`、`familytest`、`recipeviewtest`、`plannertest`；`js/recipeschema.js`／`data/recipes/` → `recipetest`、`copytest`、`plannertest`；`js/foods.js`／`data/aliases.json` → `aliastest`、`recipetest`、`unittest`；`data/edu.json`／任何 `edu(` 呼叫 → `edutest`、`copytest`；`css/style.css` → `shelltest`（M4 起加 `layouttest`、`uikittest`）。**沒有放寬的那一條：新的斷言仍然必須經突變驗證會紅**（`npm run mutationtest -- --only <關鍵字>`）。
16. **瀏覽器測試的點擊一律 `clickEl()`**（先捲到中央再點）；要量 toast 文字就等 `#toast.show`，要等它走就 `waitToastGone()`。
17. **資料庫換季（食藥署每季更新）**：`npm run build-foods -- --download` 會印出差異；消失的編號若被別名表或食譜用到，`aliastest`／`recipetest` 會紅；`aliases.json` 的 `foodsVersion` 要同步改。

## 開發順序與驗收條件

### M0 資料與骨架 ✅（`mealmate-v0.1.0`）

食藥署轉檔、別名表、採買單位、國健署人工開頁、36 道食譜、PWA 殼、七支測試與 30 條突變。驗收明細見 git 歷史 `bf0cc6b`。

### M1 家人與食譜瀏覽 ✅（`mealmate-v0.2.1`）

| 工作 | 驗收（實際） |
|---|---|
| ~~`members` store、家人頁、成員表單（暱稱、年齡層、飲食型態四選一、留意項目 toggle、腎臟病子勾選、質地、過敏原、每日目標）、買菜日七鈕、長輩模式、首次說明頁（守門）~~ | `membertest` 41（腎臟病沒勾子項 → 不帶任何欄位；新家人目標全 null；飲食型態 vs 真食譜）；`familytest` 27（表單沒有處方式的字、目標欄位全空、腎臟病列沒有「留意：」、糖尿病列有醣糖纖維、買菜日與長輩模式重載後仍在、編輯刪除）；`shelltest` 守門：沒按「我知道了」去任何頁都導回 `#/welcome` |
| ~~`js/nutrition.js` 累加、素版／葷版分開、每份、部分缺值標記、「怎麼算的」~~ | `nutritiontest` 65：固定食譜（白飯 200 g ＋ 雞蛋 50 g ＋ 醬油 10 g）等於用 foods.json 的值手算；素版不含任何 meat 軌食材（10 道逐一驗＋鹽只放葷鍋的極端菜）；null 不計入、全部沒值 → null、部分沒值 → partial；克數缺 → missingGrams；人份縮放 |
| ~~食譜頁篩選（種類、需求、醣較低、鈉較低、當季、收藏、我的）、「誰要吃」、家人留意欄位；詳情頁營養卡（素葷切換、人份、全部 12 項、怎麼算的）、收藏、本週想吃、複製修改~~ | `recipeviewtest` 47：全素不含五辛可吃的清單剛好等於資料算出來的集合；每個營養值以「估」開頭或「未估算」；素版葷版蛋白質不同；人份改變每份不變、克數跟著變；第 8 道本週想吃被擋；沒有醣類份數 |
| ~~手動新增／修改食譜（克數選填）~~ | 沒填克數 → 每一項「未估算」、沒有任何 0；補上克數後有估計值；複製內建食譜的每份熱量與原版相同 |
| ~~匯出／匯入 JSON~~ | `backuptest` 30：round-trip（中間確實清空過）；八種壞檔整份拒收且筆數一列不少；缺主鍵補上就放行（對照） |
| 醣類份數 | **不做**（無可引用來源） |

### M2 週計畫 ✅（`mealmate-v0.3.0`）

| 工作 | 驗收（實際） |
|---|---|
| ~~食譜補到 90 道（主菜 48）~~ | `recipetest` 45（每個食材解析到編號、三軌結構、標籤推導、與重建一致）；`copytest` 零禁用詞 |
| ~~`js/planner.js` 純函式：固定種子、硬約束（素食成員可吃、保存期限、時間上限、同餐不同烹法、同日不同菜、使用者開的「避開」）、軟分數（不重複、蛋白質輪替、魚每週 ≥ 2、留意欄位相對中位數只降分、全穀主食、收藏、本週想吃、當季、質地、採買效率）、`reasons[]`、`diagnostics`、`swapItem`／`assignItem`／`dailyEstimates`~~ | `plannertest` 84：同種子同輸出；4 週 56 個主菜零 14 天內重複、主菜零被迫重複；池子縮到 10 道 → forcedRepeats 非空且理由明講；早餐重複不算被迫；高醣但沒吃過 vs 低醣昨天吃過 → 選高醣（扣分不是排除）；腎臟病沒勾子項 → 分數與沒有家人時一模一樣；素食家庭每道菜每位都吃得了、零 meatOnly；只有週一買菜時葉菜都在週一到週四；鎖住的重新產生不動、外食格保留；換一道排除原本那道；理由零建議語氣；「避開精緻糖」關著甜主菜照排、開了才排除且 diagnostics.empty 記 14 筆；每日估計素食成員算素版 |
| ~~本週頁：本週／下週、產生、重新產生（鎖住的不動）、一天一卡、桌機七欄、換一道、指定（含「誰吃不了」提示）、鎖定、外食／不煮、為什麼選這道、勉強排的地方明講、每日估算（每位家人各吃自己的版本）、只有填了目標的成員才有對照條、一般衛教參考~~ | `weekviewtest` 32：21 格、14 主菜、每道菜蛋奶素與全素不含五辛成員都吃得了、零 meatOnly；理由 ≥ 2 條且零建議語氣、寫出「姊（全素不含五辛）可吃」與醣的中位數比較；換一道變了；鎖住的重新產生不變、沒鎖的有變；外食格零菜；三位家人各一列估計、每個數字帶估；只有阿嬤有「醫師或營養師給的每日目標 180」對照條；重新載入計畫還在；下週空狀態 |
| ~~`plans`／`history` store（存計畫時取代該週的 history 列）~~ | plannertest 用 `historyRowsOf` 連排 4 週 |

### M3 買菜（下一步）

| 工作 | 驗收 |
|---|---|
| 採買區間切分（`lastShoppingDayOnOrBefore` 已在 planner）、清單彙整（同食材加總；可分流的菜依 `splitByDiet()` 的人數縮放兩軌）、`toBuyQty` 換算、賣場分區、常備品另列、勾「買了」「家裡有」、複製成文字、印出樣式 | `shoppingtest`：週三＋週六 → 兩區間覆蓋 7 天無重疊；同一食材跨三餐加總正確；`pantry` 不在主清單但在常備段；外食格食材不進清單；週中改菜後已勾「買了」保留；「家裡有」下次產生時加分 |
| 保存期限與買菜日的耦合（planner 已做，這裡驗整合） | 端對端：產生 → 清單 → 每個葉菜出現的餐都在該區間買菜日後 3 天內 |
| 家人頁加「排菜規則」卡：三個「避開」開關（預設關）、不重複天數 | `familytest`：開關預設關；開了「避開精緻糖」→ prefs.avoid.sweet true |

### M4 今日煮與打磨

| 工作 | 驗收 |
|---|---|
| `js/timeline.js`：當餐所有菜的步驟合併成一條時間線（`prep` 全部在前；燉湯的 `cook` 先開火；`split` 在同道菜的 `veg`／`meat` 之前；每步大按鈕「完成」） | `timelinetest`：順序斷言各一條＋突變；**時間線只合併步驟，不合併營養**（斷言時間線頁的營養區塊仍是素版／葷版兩欄） |
| 印出樣式（週菜單＋清單）、首次啟動三步、觸控 ≥ 44px | `layouttest`：全部頁 × 2 字級 × 3 寬度，零溢出、零重疊、零橫向捲動，母體是全部組合；fixture 放最長菜名與最多家人；`uikittest` 掃全頁所有可點元件 ≥ 44px |
| 非同步畫面守門、換版提示列（照 StockDiary） | `racetest`、`versionmixtest` 沿用 |

### M5 上線

| 工作 | 驗收 |
|---|---|
| 食譜補到 **170 道**（主菜 80、配菜 50、湯 25、早餐 10、主食 6；主菜中 `nativeVeg`＋`splittable` ≥ 45） | `recipetest` 數量門檻斷言；`copytest` 母體門檻升到 1,500 |
| `foods.json` 瘦身決定、iPhone 主畫面 App 實測 | 線上 VERSION 一致 |
| 全面檢測 | **只在使用者要求時**跑 |

## 接手者最容易做錯的事

1. **把慢性病設定做成硬過濾。** 留意項目只決定「卡片顯示哪三個數字」與「排序分數」。一旦變成過濾，有糖尿病長輩的家庭池子會剩一半、重複感暴增，而且等於 App 在替醫師決定「這道不能吃」。唯一的排除是使用者自己打開的「避開」開關。`plannertest` 要有「池子只剩高醣主菜時仍排得出菜」的斷言，突變「降分改排除」必須紅。
2. **腎臟病自動限鉀（或限蛋白）。** `watchFields()` 只帶使用者勾的鈉／鉀／磷／蛋白質，沒勾的欄位連分數都不參與。有突變。
3. **營養數字沒標「估」、不能展開來源，或把 null 當 0。** 用 `fmtNutrient()`，不要自己另寫格式器；`estimate()` 的 partial／missingGrams 要顯示出來。有突變。
4. **素葷合成時間線時把兩版營養加在一起。** 時間線合併的是**步驟**，營養永遠是素版＝base＋veg、葷版＝base＋meat，各除各的份數（`nutrition.tracksFor`／`servingsFor`）。M4 的 `timelinetest` 要斷言時間線頁仍是兩欄。
5. **用名稱字串（尤其子字串）去查食藥署營養。** 食譜只存整合編號；口語詞經 `resolveFood` 精確比對；新食材先 `npm run findfood -- 詞`。
6. **`replaceChildren()` 傳 null 進去。** 畫面上會出現「null」字。h() 會略過 null，`replaceChildren` 不會 —— 先 `.filter(Boolean)`。shelltest 每條路由都掃。
7. **瀏覽器測試用 `page.click` 點頁面底部的東西。** 會點到固定分頁列或正在淡出的 toast。用 `clickEl()`。
8. **「看不到」只驗 `hidden` 屬性。** 屬性在、東西照樣顯示（display:flex 蓋掉它）。要驗就量 `getComputedStyle().display` 與 `getBoundingClientRect().height`（familytest 的 `shownBox`）。
9. **用「池子只剩 X」去證明「只降分不排除」。** 相對池子自己的中位數永遠有一半不算高，排除掉一半照樣填得滿，突變不會紅。要讓被扣分的菜跟被扣更多的菜對決（plannertest「高醣沒吃過 vs 低醣昨天吃過」）。
10. **規劃器的 `lastServed()` 把「同一天」排除。** 午晚餐會排到同一道菜。同日也算，另加「同一天不排同一道」硬約束。

另外三件較小但會一路痛的：**早餐納入不重複計分**（`noRepeatDays.breakfast` 是 0，有突變）；**池子不夠時靜默重複**（要進 `diagnostics` 並在本週頁明講）；**改了食譜沒跑 `npm run build-recipes`**（`recipetest` 會紅）。
