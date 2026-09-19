# SPEC_測試範圍 — 平常跑「底線＋受影響的測試」，全面檢測由 Yolin 定期指定

> 狀態：**已被 `docs/SPEC_測試範圍_修訂一.md` 大幅取代（2026-09-20）**——十三版回放沒過驗收，統籌者裁決**不做挑選器**。本檔的 R1–R5、§6 的「新增」、§7、§8 的回放驗收作廢；R6–R9 與 §6 的文件修改照修訂一調整後仍有效。**先讀修訂一。** 本檔留著是為了保存勘查事實與當初的設計理由。**依修訂一已執行（2026-09-19）。**
> 規劃：Fable 5.1 統籌 Session，2026-09-20。方向：Yolin 2026-09-19 裁示、2026-09-20 點名 MealMate 要做。細節的取捨見 §9，Yolin 可以否決其中任何一項。事實依據：Opus 勘查員 2026-09-20 的唯讀勘查（HEAD `58c934c`），以及 TripQuest 2026-09-19 做同一件事的實戰經驗（含它踩過的坑與兩次修訂）。

## 0. 前置條件已滿足（2026-09-20 更新）

這份規格原本要求排在「補早餐」之後才開始。早餐已於 `mealmate-v0.36.0`（commit `b98f271`）完成並部署，工作區乾淨，**現在可以開始**。

那一版正好是這份規格要處理的典型：只加菜不夠，還改了排菜器（早餐輪替扣分 2 → 6），`recipetest` 134 → 158、`plannertest` 444 → 451、突變 349 → 366。所以它被加進 §7 當回放的對照組（T1b）。

如果你在 v0.36.0 有記下 26 支跑一輪的總耗時與最慢五支的秒數，寫進 STATUS「測試現況」；沒記就照實寫「未量」，**不要為了量它專程再跑一次全套**，等下一次全面檢測。

**本規格裡出現的條數（突變 366 條、各測試的斷言數）一律以你實際數出來的為準**；統籌者引用的是勘查與回報當時的數字，這個 repo 的數字變得很快。

## 一句話

把「每版 26 支全套綠」改成「每版跑**底線＋受影響的測試**」；「受影響」由一支純函式挑選器依 git diff 算出來，不靠人讀工作慣例第 15 條那張表；`mutationtest` 從 `npm test` 的鏈裡拆出來成為獨立指令；每版回報附上「距上次全面檢測」與「距上次突變整套」各多久。

## 1. 現況（勘查事實）

- Yolin 的裁示（原話）：2026-09-12「全部專案不用每次上線都做全面測試，只需要針對此次調整的部分做測試，我會測到一個進度就請你全面檢測」；2026-09-19「請放寬，不用每一次小改動都全測，我會定期進行全面檢測」。共用慣例 §5.7（v2）明講這是**解除義務、不是設上限**：想多跑永遠可以。
- 本 App 的文件現在自相矛盾：`CLAUDE.md` 第 6 條、STATUS「開發流程慣例」第 5 條、工作慣例第 11、15 條寫「平常只跑受影響的」；`CLAUDE.md` 第 7 條、STATUS 檔頭交接節寫「每版 26 支全套綠」。實際生效的是後者。只有突變層真的放寬了（每版 `--only` 幾條＋`checkmutations`）。
- `npm test` 的鏈是 26 支測試＋最後一段 `mutationtest`（v0.36.0 起 366 條、整套 30–40 分鐘、跑的時候會暫時改寫原始碼）。**突變自 2026-09-13 起沒有整套跑過**（當時的條數遠少於現在；之後每版只跑 `--only` 的幾條）。
- **每版必動的檔**：`scripts/bump-version.mjs` 每版改三個檔——`js/version.js`（`APP_VERSION` 那一行）、`sw.js`（`VERSION` 那一行）、`index.html`（三處 `?v=`）。三種樣式都明文寫在 bump 腳本的 regex 裡。`package.json` 的版本欄位不動。最近 13 個發版 commit（v0.23.0–v0.35.0）每一版都動到這三個檔；扣掉版本行之後，真的動到 `js/app.js`／`js/router.js` 的只有 3 版（v0.24.0、v0.27.0、v0.28.0）。
- **import 圖**：`js/app.js` 的靜態閉包只有 14 個檔，因為 10 個 view 都是用**反引號模板字串**動態 import 的（`` import(`./views/week.js${V}`) ``）。`js/` 底下 29 個檔，每一個都至少被一支測試「點名」——但其中 4 個 view（`member.js`、`recipeedit.js`、`recipes.js`、`welcome.js`）只是被「整個 `js/views` 目錄」這種引用涵蓋：`copytest`、`doctest`、`edutest`、`shelltest`、`uikittest` 五支把整個目錄當語料掃。
- **共用 helper**：`scripts/browserlib.mjs` 被 9 支瀏覽器測試引用，而它自己 import `js/planner.js`。另有 `tap.mjs`（全部測試）、`serve.mjs`、`srcscan.mjs`、`copyrules.mjs`。
- **歷史上的波及案例**（勘查員找到 12 個，附了 STATUS 行號；§7 拿其中能回放的當對照組）。兩個最重要的型態：
  1. **排菜輸入面**：只要排菜器的亂數序列或食譜池變了，統計型斷言就可能紅，而且「改了哪個檔」跟「紅在哪」幾乎對不上。v0.29.0 新增 6 道早餐 → `plannertest` 兩條統計門檻掉出去、`nutritiontest` 條數變；v0.34.0 改主食規則 → `plannertest` 四條紅；v0.33.0 加蛋豆奶規則 → `weekviewtest` 連兩次紅，而且**買菜頁在 320 寬特大字級溢出 3px，是全套測試才抓到的**（菜單變了，清單上出現很長的字）。
  2. **人工挑測試會漏**：2026-09-13 改 `data/units.json` 只跑了 `shoppingtest`，`unittest` 紅了一版沒被發現。工作慣例第 15 條那張表到今天還有破口：`datatest`、`doctest`、`redlinetest`、`scenariotest`、`pwatest` 五支一列都沒被點到，照表做它們永遠不會跑。
- **git diff 永遠挑不到的兩類**（只有定期全測抓得到）：程式一個字沒改、日期走過去就紅（2026-09-14 `weekviewtest` 的診斷卡前置斷言）；既有突變因為別處的改動而靜默失效（留意欄位排序那次，只有完整套件抓到）。
- `doctest` 釘住的、這次不能碰的：工作慣例第 4、5、13 條的三句原文；「測試現況」列出各測試與條數的那兩行（它用 `測試名 數字` 的樣式當母體，**每一個都必須有 npm script 而且在 `test` 鏈裡**）；`` `mutationtest` 共 **N 條** `` 那句的格式；食譜道數那句；列出全部 store 名稱那句。`doctest` 不讀 `CLAUDE.md`、`README.md`。`mutationtest` 本身不在 `doctest` 的那個母體裡（STATUS 裡它前面總隔著反引號），沒有任何突變的目標檔是 `package.json`——所以**把 `mutationtest` 拆出鏈不會弄紅任何東西**。

## 2. 目標與非目標

**目標**：G1 平常一版的測試時間明顯下降；G2「受影響」由工具算；G3 歷史上能回放的波及案例，新流程都還抓得到；G4 回報永遠看得出這次跑了幾支、不是全綠；G5 Yolin 隨時看得到距離上次全面檢測與上次突變整套各多久；G6 `npm test` 不再暗藏一個會改寫原始碼、跑 30 分鐘以上的步驟。

**非目標**：不改任何 `js/`、`css/`、`data/`、`sw.js`、`index.html`；不重構既有測試；不調任何統計門檻；不動 `docs/PLAN.md`、`docs/CONVENTIONS.md`、`CLAUDE.md` 檔尾的「共用慣例」指向段；不為了量秒數專程跑全套；這一批不做 `mutationtest --changed`（列在 §10 第二步）。

## 3. 名詞

| 名詞 | 意思 |
|---|---|
| 鏈 | `package.json` 的 `test` script 串起來的那一串。本規格執行後＝27 支測試，**不含** `mutationtest` |
| 底線 | 不論改了什麼，每版都跑的一小組（R2） |
| 直接引用 | 測試腳本的文字裡出現的 repo 內路徑，**加上它引用的 `scripts/*.mjs` helper 所引用的路徑**（helper 展開到底） |
| 目錄引用 | 引用的是整個目錄（例如 `js/views`）。改到目錄底下的檔算命中，但**不沿著那些檔的 import 往下展開** |
| 閉包 | 一個 `js/` 檔沿著 import（含引號與**反引號**的動態 import）展開到的所有 `js/` 檔；**遇到 `js/app.js` 就停** |
| 版本行改動 | `sw.js`、`index.html`、`js/version.js` 的 diff 只有 bump 腳本會改的那幾行 |
| 全面檢測 | Yolin 指定才跑（R6） |

## 4. 規則

- **R1 每版要跑的＝底線 ∪ 挑選器算出來的測試。** 指令 `npm run test:affected`：先印清單與每支被挑中的理由，再**依鏈的順序、一次一支**跑（不平行——STATUS 記載過測試連續跑會互相干擾），任一支紅就停。只看不跑：`npm run affected`；餵假想改動：`npm run affected -- --files <路徑>…`；一版分好幾個 commit：`--base <commit>`；回放歷史：`--commit <sha>`。
- **R2 底線**：`affectedtest`（新增）、`doctest`、`datatest`、`copytest`、`shelltest`，外加指令 `checkmutations`（它不是測試、不在鏈裡，但每版必跑，`test:affected` 要順便跑它）。理由：前四支純 Node、便宜，而且 `doctest`、`datatest` 正是舊對照表點不到的；`shelltest` 守三處版本號一致與 SHELL 清單，而每一版都會 bump；`checkmutations` 幾秒，是唯一擋得住「突變靜默過期」的東西。
- **R3 挑選（`scripts/affected.mjs`，純函式：不讀 git、不跑測試）**：一支測試被挑中，條件是下列任一——(1) 它的腳本檔本身被改；(2) 它直接引用的檔被改（含 helper 展開、含目錄引用）；(3) 它直接引用的某個 `js/` 檔的閉包裡有檔被改；(4) 命中放大器。
- **R4 放大器**：

| 放大器 | 觸發 | 放大到 | 依據 |
|---|---|---|---|
| P 排菜輸入面 | `js/planner.js`、`js/prefs.js`、`js/recipeschema.js`、`js/members.js`、`data/recipes/**`、`data/recipes.json`、`data/units.json`、`data/aliases.json`、`data/foodtags.json` | 加跑 `plannertest`、`weekviewtest`、`shoppingviewtest`、`todaytest`、`scenariotest`、`layouttest`、`nutritiontest`、`recipetest`、`unittest` | v0.29.0、v0.33.0、v0.34.0 與 `data/units.json` 那次。菜單一變，統計門檻、畫面上的菜、清單上的字長都會變 |
| V 畫面結構 | 任何 `js/views/*.js`、`css/style.css`、`js/ui.js` | 加跑 `layouttest`、`uikittest`、`shelltest`、`pwatest`、`redlinetest` | 版面掃描與紅線掃的是渲染後的 DOM |
| C 骨架 | `js/app.js`、`js/router.js`、`js/shell.js`、`js/db.js`；`sw.js` 或 `index.html` 的**非版本行**改動；**新增或刪除**任何 `js/views/*.js`；`data/foods.json`（食材庫換季重建） | **全套**（＝整條鏈） | 入口、路由、畫布、儲存層的波及無法預測；新增 view 會同時動路由表與 SHELL 清單 |
| D 沒人認領 | 改到 `js/`、`css/` 底下、**沒有任何測試**透過直接引用或閉包涵蓋的檔（照 §3 的定義算） | **全套**，並點名那個檔 | 挑選器有洞的樣子就是「少挑幾支、看起來照樣綠」 |
| 保守退路 | 改到不屬於任何已知類別、也沒有測試引用的檔（`icons/`、`manifest.webmanifest`…） | 全套 | 這類改動很少，寧可多跑 |

  **版本行改動不觸發 C**：`sw.js`、`index.html`、`js/version.js` 的 diff 若只有版本行，就不算 C，只加跑 `shelltest`（已在底線）與 `versionmixtest`。判斷由呼叫端 `run-affected` 做（挑選器維持純函式），**樣式直接引用 `scripts/bump-version.mjs` 裡那三條 regex，不要另抄一份**；`index.html` 允許恰好三處。取不到 diff、樣式對不上、或該檔還有別的行改動 → 保守當成命中 C。
  只改 `docs/**`、`*.md`、`screenshots/**`、不在鏈裡的 `scripts/` 工具 → 只跑底線。只改 `package.json` → 底線。改到 `scripts/browserlib.mjs` 等 helper → 引用它的每一支都算被改到。
- **R5 輸出口徑**：每次都印 `這不是全綠：本次跑 N/M 支`（M 從 `package.json` 數，不寫死）。回報與 commit 訊息**不准寫「全綠」「全套綠」**，要寫「底線＋受影響 N/M 支綠」；只有真的跑完整條鏈才能寫全綠。
- **R6 `mutationtest` 拆出鏈**：`npm test`＝27 支測試，不含突變；`npm run mutationtest` 是獨立指令，用法不變（`--only` 照舊）。新斷言的驗紅照舊：`npm run mutationtest -- --only <關鍵字>`。**全面檢測**由 Yolin 指定才跑＝`npm test`（整條鏈）＋`npm run mutationtest`（整套，現在 366 條）＋`npm run assertaudit`＋`npm run checkmutations`；跑的期間不要同時編輯任何檔案（補遺第 7 條）。跑完在 STATUS「測試現況」更新兩行固定格式的紀錄：「上次全面檢測：日期、版本、結果、總耗時、最慢五支秒數」「上次突變整套：日期、版本、條數、結果、耗時」。基準：**上次突變整套＝2026-09-13**（那一次跑了幾條、結果如何，照 STATUS 當時的記載填；統籌者沒有查證那個數字，不要照抄這份規格裡的任何條數）；上次 26 支全跑＝你補早餐那一版。
- **R7 提醒而不自動**：每版回報最後加兩行——「距上次全面檢測：N 版／D 天」「距上次突變整套：N 版／D 天」（`npm run affected` 會印）。要不要跑由 Yolin 決定，Session 不自己跑。第二行存在的理由：突變已經一週沒整套跑過（而且這一週從 349 條長到 366 條），這是本 App 自己回報的最大測試盲點；放寬之後它只會更容易被忘記，所以要讓它每一版都出現在 Yolin 眼前。
- **R8 沒有放寬的**：每條新斷言仍然要用突變證明會紅；統計型斷言的門檻照補遺第 12 條（多組種子、留餘裕、確定性的行為另寫確定性的斷言）；跑 `mutationtest` 期間不編輯原始碼；不寫假斷言、母體非空、檢查器有對照組。
- **R9 新寫的測試若依賴日期**：fixture 不要寫死「相對今天」的筆數或週次；固定時鐘，或讓斷言引用程式自己算出來的數量。（既有測試不回頭檢查，留給下一次全面檢測。）

## 5. 與現有規則的交互

| 現有規則 | 結論 |
|---|---|
| `CLAUDE.md` 第 7 條「26 支測試全綠」 | 改寫（§6） |
| STATUS 交接節「26 支全套綠」、補遺第 10 條、工作慣例第 11、15、17 條、`README.md` 的 `npm test` 說明 | 改寫（§6） |
| 工作慣例第 4、5、13 條 | **原文一個字都不動**（`doctest` 釘著） |
| 共用慣例 §5.7、`CLAUDE.md` 第 6 條 | 已一致，不動 |
| 補遺第 7、9、11、12 條 | 不動，仍然有效 |
| `CLAUDE.md` 檔尾指向段「衝突時照較嚴的做」 | 改完上面幾處就不再衝突，不動 |

## 6. 資料與程式變更

**底子**：以 TripQuest 現在的 `scripts/affected.mjs`、`run-affected.mjs`、`affectedtest.mjs` 為骨架（跨專案唯讀，你可以去讀 `../TripQuest/scripts/` 與它的 `docs/SPEC_測試範圍.md`、`SPEC_測試範圍_修訂二.md`；**不要改它的任何檔**）。它已經含：鏈的解析、放大器、`sw.js` 版本行豁免、閉包停在 `js/app.js`、輸出口徑、歷史回放。要補的四處：

1. **反引號的動態 import**：TripQuest 建 import 圖的 regex 只認引號。StockDiary 的 `scripts/affected.mjs` 有認反引號的寫法，併進來（建圖與抽引用兩處都要）。併進來之後 `js/app.js` 的閉包會變成整個 App——所以「閉包停在 `js/app.js`」這條在這裡是必要的，不是裝飾。
2. **目錄引用不展開閉包**（TripQuest 修訂二的結論，這裡一開始就做對）。
3. **helper 展開**：`scripts/*.mjs` 互相 import 的要展開到底。
4. **版本行豁免涵蓋三個檔**，樣式取自 `bump-version.mjs`。

**新增**：`scripts/affected.mjs`、`scripts/run-affected.mjs`、`scripts/affectedtest.mjs`；`package.json` 加 `affected`、`test:affected`、`affectedtest` 三個 script；`test` 鏈**最前面**加 `affectedtest`、**最後面拿掉** `mutationtest`。

**修改文件**（定位用條文名稱，不要信行號；這個 repo 的 STATUS 這兩天被改過好幾次）：

1. `CLAUDE.md` 第 7 條「每次部署」：「26 支測試全綠」→「`npm run test:affected`（底線＋受影響）綠」；補一句「全面檢測由 Yolin 指定；回報不准把部分測試寫成全綠」。**這一條以外每一行都不動。**
2. `README.md`：`npm test` 那行的說明改成「全部 27 支測試（不含突變）」；另加一行 `npm run mutationtest`（會暫時改寫原始碼，跑的時候不要同時編輯）與一行 `npm run test:affected`。
3. STATUS 交接節那句「每一版都是…26 支全套綠…」：改成歷史敘述（到哪一版為止是這樣做的），並寫明之後的做法。你自己在那一節寫的「跟 `CLAUDE.md` 第 7 條不再衝突」那段，跟著更新。
4. STATUS 補遺第 10 條：改寫成「`npm test`＝27 支、不含突變；`mutationtest` 是獨立指令」。
5. STATUS「測試現況」：**那兩行列出各測試與條數的清單，加上 `affectedtest <條數>`**（寫了就必須在鏈裡——你已經把它放進鏈了，`doctest` 會驗）；「26 支測試」的口徑改成 27；`` `mutationtest` 共 **N 條** `` 那句的格式原樣保留（N 會因為 §7 新增的突變而變，照實改）；新增 R6 的兩行紀錄與 R7 的說明。
6. STATUS 工作慣例第 15 條：那張人工對照表**整段換成**「跑 `npm run test:affected`；規則與放大器見 `docs/SPEC_測試範圍.md`」，並把放大器表抄一份在這裡（人要看得到）。原表不要刪進虛空——搬到 `affectedtest.mjs` 當對照組（§7 的 T-表）。第 11 條「每版流程」、第 17 條「全面檢測怎麼跑」跟著 R1、R6 改。
7. 工作慣例第 4、5、13 條：**不動**。

**不准動**：§2 非目標列的全部；任何既有測試腳本（`mutationtest.mjs` 只准**新增** §7 要的突變條目）。**不 bump**（App 的檔案一個都沒變）。

## 7. 測試要求（`scripts/affectedtest.mjs`，純 Node）

紀律照本 App 的慣例：每條新斷言都要在 `mutationtest.mjs` 的 `MUTATIONS` 加對應的條目，並用 `npm run mutationtest -- --only affected` 證明會紅；`checkmutations` 要過。**新增的每一條突變都要用你在 v0.36.0 補強的機制，指定「失敗的一定要是哪一條斷言」**——下表每一列的突變對應哪一條斷言已經寫明，正好照填；只驗「有東西紅了」不夠，挑選器的斷言彼此很像，紅錯一條也會被當成通過。含 regex 的程式碼用 Write／Edit 工具寫檔。歷史 commit 的改動清單用 `git show --name-only <sha>` 實際查出來的為準，寫死在測試裡當 fixture。

| # | 斷言 | 前置／對照組 | 突變（必須讓它紅） |
|---|---|---|---|
| T1 | 回放 v0.29.0（`54e09f2`，新增 6 道早餐）：結果含 `plannertest`、`nutritiontest` | 前置：改動清單非空、點名的測試都在現在的鏈裡 | 拿掉放大器 P |
| T1b | 回放 v0.36.0（`b98f271`：新增 14 道早餐、改 `data/foodtags.json`、改排菜器的早餐輪替扣分）：結果含 `plannertest`、`recipetest`、`nutritiontest`、`weekviewtest` | 同上。這一版是你自己剛做完的，哪幾支真的因為它而要改，你最清楚——如果實際受波及的測試不在挑選結果裡，**那就是規則的洞，回報，不要改 fixture 去湊** | 拿掉放大器 P |
| T2 | 回放 v0.34.0（`20a5d69`）：含 `plannertest` | 同上 | 讓 `js/planner.js` 不再命中任何東西 |
| T3 | 回放 v0.33.0（`99cd5ce`）：含 `weekviewtest`、`shoppingviewtest`、`layouttest` | 同上 | 把 `layouttest` 從 P 拿掉 |
| T4 | 只改 `data/units.json` → 含 `unittest`（2026-09-13 漏掉的那一次） | 對照組：只改 `data/edu.json` → 不含 `unittest` | 把 `data/units.json` 從 P 拿掉、且讓直接引用失效 |
| T5 | 回放 v0.28.0（`ec50759`，動到 `app.js`＋`router.js`）→ 全套 | 對照組：v0.32.0（`2f21674`，只動 `planner.js`＋版本行）→ **不是**全套 | 拿掉放大器 C |
| T6 | **版本行豁免**：三個檔都只有版本行改動 → 不是全套、含 `shelltest` 與 `versionmixtest` | 對照組 a：`sw.js` 版本行＋另一行 → 全套；對照組 b：`index.html` 只改了兩處 `?v=`（不是三處）→ 全套；對照組 c：取不到 diff → 全套 | 判斷式改成永遠成立 → a、b、c 紅；改成永遠不成立 → 主斷言紅 |
| T7 | 舊對照表（工作慣例第 15 條原表）逐列當對照組：表上每一列「改到 X → 跑 Y」，挑選器的結果都**包含** Y | 前置：表的列數 ≥ 14；每個 Y 都在鏈裡 | 隨便拿掉一支測試的直接引用解析 → 至少一列紅 |
| T8 | 舊表的破口補上了：只改 `docs/x.md` → 結果恰好等於底線，而底線含 `doctest`、`datatest` | 前置：底線非空、每一支都在鏈裡 | 把 `doctest` 從底線拿掉 |
| T9 | 反引號動態 import 有被認得：`js/app.js` 的 import 圖裡抽得到 `js/views/week.js`（**閉包停點關掉時**）；閉包停點開著時，`js/app.js` 的閉包不含任何 view | 兩種狀態都驗，才證明兩個機制各自有作用 | 反引號的 regex 拿掉 → 前半紅；停點拿掉 → 後半紅 |
| T10 | 目錄引用不展開閉包：從實際的 import 圖裡挑一個「某個 view 有 import、但掃 `js/views` 目錄的那五支測試都沒有直接引用」的程式檔（挑哪一個由你照圖決定，寫進回報；找不到這樣的檔就照實回報，改用假圖驗）。改它 → 那五支**不因為目錄引用**而被挑中 | 對照組：改 `js/views/recipeedit.js` → 那五支被挑中 | 讓目錄引用展開閉包 → 主斷言紅 |
| T11 | helper 展開：改 `scripts/browserlib.mjs` → 引用它的每一支都被挑中（數量從程式掃出來，≥ 8）；改 `js/planner.js` → 這些測試也被挑中（因為 browserlib import 它） | — | helper 不展開 → 紅 |
| T12 | 放大器 D：造一個假檔 `js/__nobody.js` → 全套並點名；另外回報「目前沒有任何測試點名的真實程式檔」有幾個（以 §3 的定義算；可能是 0，是 0 就照實寫，不要硬湊斷言） | 對照組：改一個有人點名的檔 → 不觸發 D | 拿掉 D |
| T13 | 鏈的解析：支數 ≥ 25、每支對得到實際存在的檔、**鏈裡沒有 `mutationtest`** | 對照組：餵一條含 `mutationtest` 的假鏈 → 報錯 | 讓解析器靜默略過不認得的段 |
| T14 | 輸出含「這不是全綠」與正確的 N/M；全套時含「放大到全套」與原因 | M 從鏈數出來 | 把 N/M 寫死 |
| T15 | R7 的兩行：從 STATUS 讀得到兩個日期並算得出天數；STATUS 那兩行格式被改壞時**報錯**而不是印 0 天 | 兩段式 | 讓解析失敗時回傳 0 |

**這一版自己跑什麼**：`npm run test:affected`（只改了 `scripts/`、`package.json`、文件 → 底線）＋`npm run mutationtest -- --only affected`＋`npm run checkmutations`。**不用跑整條鏈。**

## 8. 版本、回報、驗收

- 不 bump、不部署。commit 可以分成「工具＋測試」與「文件」兩個。本 repo 是 **public**：commit 之後、push 之前做公開前自查（金鑰或 token、email〔noreply 不算〕、本機使用者名稱、本機路徑；每一類先確認對照組命中），寫進回報；自查通過就 push。
- 回報逐條對照：R1–R9 各怎麼落地；T1–T15 每條的突變與結果；§6 每一處文件修改；實測與推論分開；工單沒預期到的狀況。
- **十四版回放**（v0.23.0–v0.36.0）：每一版照這套規則會跑幾支，列成表。**驗收標準：至少一半的版本明顯少於全套（27 支）。** 達不到就回報，不要調規則去湊。勘查員的預估是 v0.23–v0.35 這 13 版裡只有 3 版該全套；但放大器 P 涵蓋的測試很重（`plannertest`、`layouttest`、`weekviewtest` 是最慢的幾支），所以請同時回報「命中 P 的版本有幾版」——如果十四版裡十版都命中 P，支數少了但時間沒省多少，那也要講。
- 你認為哪個放大器太寬或太窄：**不要自己改規則，附數據回報**，由統籌者調整。

## 9. 統籌者做的取捨（Yolin 可以否決）

| # | 取捨 | 理由 | 代價 |
|---|---|---|---|
| 1 | 自動挑選器取代工作慣例第 15 條的人工對照表 | 那張表漏過一次（`data/units.json`），而且到今天還有五支測試一列都沒被點到 | 三個新腳本、一支新測試 |
| 2 | `mutationtest` 拆出 `npm test` | `npm test` 不該暗藏一個會改寫原始碼、跑半小時以上的步驟；拆出去不會弄紅任何現有檢查（勘查員逐項查過） | 「跑 `npm test`」不再等於「連突變一起驗」，所以全面檢測的定義要明寫（R6） |
| 3 | 排菜輸入面整組放大（P），不靠 import 圖逐檔算 | 這個 App 的波及來自亂數序列與食譜池，跟檔案的依賴關係對不上 | 改排菜器或加食譜的版本，要跑的測試偏重。這是刻意的：那幾版正是歷史上出事的版本 |
| 4 | 骨架類（入口、路由、畫布、儲存層、SHELL 清單）仍跑全套；版本行除外 | 波及無法預測；不豁免版本行的話每一版都是全套（TripQuest 踩過） | 這類版本省不到時間 |
| 5 | 每版回報兩行提醒（全面檢測、突變整套各多久沒跑），不自動跑 | 突變一週沒整套跑（現在 366 條）；放寬之後更容易忘 | 回報多兩行 |
| 6 | 這一批不做 `mutationtest --changed` | 先讓挑選器穩定；一次改兩個機制，出事分不清是誰 | 新斷言驗紅仍靠人工 `--only`（現況） |

## 10. 第二步（這一批驗收之後另外談，現在不要做）

把 StockDiary 的 `selectAffected` 移植成 `mutationtest --changed`，取代人工 `--only`；回頭替舊的 348 條突變補上「失敗的一定要是哪一條」的指定（你在 v0.36.0 指出：沒指定的那些、尤其是改資料檔的，可能有「紅的是別條」的盲點——這件值得做，但條數多，適合配合一次全面檢測分批做，不要夾在這一批裡）；替「目前沒有任何測試點名的程式檔」補測試（如果 T12 回報的數字不是 0）。
