# SPEC_共用慣例導入 — MealMate（第 4 批）＋commit 作者信箱改 noreply

> 狀態：已執行（2026-09-19）
> 〔2026-09-24 註：本檔寫的推送做法已作廢，推送一律用本 App 的推送閘門（見 `CLAUDE.md`）。〕
> 撰寫：Fable 統籌 Session，2026-09-19。依據：統籌工作區的 `SPEC_共用慣例.md` v2（Yolin 2026-09-19 拍板）與 Yolin 2026-09-19 對作者信箱的裁示。第 1–3 批（TripQuest、StockDiary、JLPT_App）用的是同一份副本；TripQuest 全新開場的 Session 第一行自動出現了回執，機制有實據。
> docs-only：**不要跑 `npm run bump`、不改版本號、不算一版。前置條件：`git status` 乾淨、沒有進行中的功能批次；不符合就先回報，不要開始。**

## 這份工單有兩件事，分兩個 commit，同一次做完

| commit | 內容 | 為什麼分開 |
|---|---|---|
| **A** | commit 作者信箱改成 GitHub noreply，並把文件裡兩處「作者 email 維持不動」改成新裁示 | 它會改到 `CLAUDE.md` 既有的一行 |
| **B** | 共用慣例導入：新增副本、`CLAUDE.md` 檔尾追加七行 | 這一步的驗證是「`CLAUDE.md` 刪除行數＝0」，跟 A 混在一起就量不出來。而且先 A 後 B，B 自己就是「新信箱生效」的實證 |

兩個 commit 都做完、自查完、回報完，**等 Dispatch 回覆才 push**（本 repo 是 public）。

---

## commit A：作者信箱改 noreply

**背景**：本 repo 是 public，到目前為止每一個 commit 的作者信箱都是真實信箱（TripQuest、StockDiary 也一樣；JLPT_App 一直用 noreply）。Yolin 2026-09-19 裁示（原話）：「照你的建議，請改noreply」。**這推翻了 2026-09-17 個資稽核時「commit 作者 email 維持不動」那半句；「不重寫 git 歷史」那半句不變**——只影響往後的 commit，過去的 commit 一個都不動。

### A1. 改設定（只改這個 repo 的本地設定）

```bash
git config user.email "43800182+yolin0513@users.noreply.github.com"
```

- 這是 Yolin 的 GitHub noreply 地址（數字是他的帳號 id）。統籌者 2026-09-19 用 GitHub API 實測過：用這個地址的 commit 會正確歸到 `yolin0513` 這個帳號。
- `user.name` 已經是 `yolin0513`，不用動。不要加 `--global`。不要設任何環境變數。

### A2. 改文件裡的兩處條文（只改這兩處）

1. `CLAUDE.md` 第 3 條「授權邊界」裡的「改寫 git 歷史（不准；commit 作者 email 也維持不動）」→ 改成意思如下（措辭你定，保持一行）：改寫 git 歷史不准；commit 作者信箱用本 repo 設定的 GitHub noreply，不要改回真實信箱（Yolin 2026-09-19 裁示，取代 09-17 的「維持不動」；只影響往後的 commit）。
2. `docs/STATUS.md`「常設規則補遺」第 5 條「**個資**：commit 作者 email 維持不動、**不重寫 git 歷史**（2026-09-17…）」→ 改成：不重寫 git 歷史（2026-09-17 的決定，不變）；commit 作者信箱自 2026-09-19 起用 GitHub noreply（Yolin 2026-09-19 裁示：「照你的建議，請改noreply」，取代 09-17「維持不動」那半句）。**請保留「09-17 曾經決定維持不動、09-19 改了」這段來龍去脈**——目的是避免日後有 Session 只讀到舊紀錄又把它改回去。

`doctest` 沒有釘這兩句（統籌者 grep 過 `scripts/doctest.mjs`，零命中）。

### A3. commit 與驗證

- commit 訊息例：`docs：commit 作者信箱改用 GitHub noreply（Yolin 2026-09-19 裁示）`，結尾照本 App 補遺第 4 條加署名行。
- 驗證（結果貼進回報；**真實信箱不要印出來**，用「真實信箱（遮蔽）」代替）：

| # | 做什麼 | 合格條件 |
|---|---|---|
| A-V1 | `git config --show-origin --get user.email` | 來源是本 repo 的 `.git/config`，值逐字等於上面那個 noreply 地址 |
| A-V2 | commit **之前**先跑 `git var GIT_AUTHOR_IDENT` 與 `git var GIT_COMMITTER_IDENT` | 兩個都顯示 noreply 地址（這個指令顯示「下一個 commit 會用的身分」，環境變數若有覆蓋也會反映出來） |
| A-V3 | commit 之後 `git log -2 --format='%h %ae %ce'` | 最新那一筆的作者與提交者**都是** noreply；**對照組**：前一筆（`a929389` 或當時的 HEAD）仍是舊信箱——證明這個查詢看得出差別 |
| A-V4 | `git diff --stat HEAD~1 HEAD` | 只有 `CLAUDE.md` 與 `docs/STATUS.md` 兩個檔 |

---

## commit B：共用慣例導入

### 為什麼

同一批規則（繁中、禁提示框、跨專案唯讀、測試紀律、開發流程）現在在四個 App 各寫一份，沒有機械方法知道它們有沒有漂移；Yolin 從手機上也看不出一個新 Session 到底讀了規則沒有。解法是一份主檔（在統籌工作區）＋各 App 一份副本＋開場一行回執。

### B1. 新增 `docs/CONVENTIONS.md`

內容＝下面「附錄：副本全文」那個區塊**裡面**的文字，逐字，從 `<!-- CONVENTIONS v1` 那一行開始，到 `## §8 變更紀錄` 底下那一條為止。

- 用 **Write 工具**直接寫檔，不要經過 shell heredoc（本 App 補遺第 8 條同一個理由）。
- UTF-8、無 BOM、LF（本 repo `.gitattributes` 是 `eol=lf`）；**第一行就是版本標記**，前面不能有空行。檔尾留一個換行。
- 掛得到統籌工作區的話，也可以直接複製它根目錄的 `CONVENTIONS.md`——兩者必須相同。掛不到就用附錄。

### B2. 在 `CLAUDE.md` 檔尾追加下面這一段（逐字；用 Edit 工具接在最後一行之後）

```markdown

## 共用慣例

四個 App 共用的工作慣例在 `docs/CONVENTIONS.md`。那是副本，主檔在統籌工作區，**不要在這裡改它**。
開工前把它跟 `docs/STATUS.md` 一起讀完，並在第一則回覆的**第一行**寫回執：`已讀共用慣例 vN（日期）`（N 與日期抄副本第一行）。
本檔與 `docs/STATUS.md` 的規則優先於共用慣例；兩邊衝突時照較嚴的做，並在回報裡指出來。

@docs/CONVENTIONS.md
```

最後一行 `@docs/CONVENTIONS.md` 是 Claude Code 的匯入語法，照抄即可。

### 不准做的事（兩個 commit 都適用）

- **`CLAUDE.md` 除了 A2 那一處，既有的每一行一字不動**——包括與共用慣例重複的條文、第 5 條健康紅線、第 7 條每次部署。重複就讓它重複。
- **`docs/STATUS.md` 除了 A2 那一處與你平常的收尾更新（檔頭「最後更新」、「目前進行中／交接」記一筆），其餘不動。** 特別是：工作慣例第 4、5、13 條的原文（`doctest` 釘著這三句）、「測試現況」列出 26 支測試與各自條數的那兩行（`doctest` 靠它們驗每支測試都在鏈裡，剪到會一次紅四條）、`mutationtest` 條數、食譜道數。
- 不要動 `docs/PLAN.md`（`doctest` 也釘著它約 30 處）。
- **不准跑 `npm test`**（它會連 `mutationtest` 一起跑 30–40 分鐘，而且跑的期間會暫時改寫原始碼）；不跑任何形式的 `mutationtest`、`assertaudit`（`assert-audit.jsonl` 不該出現在這次的 `git status` 裡）。
- 不改 `package.json`、`README.md`、`scripts/`、`js/`、`data/`、`css/`、`sw.js`、`index.html`、`.claude/`，不新增任何測試。
- 不要動其他 App 與統籌工作區的任何檔案。
- **這次不處理**「每版 26 支全套綠」與工作慣例第 15 條「平常只跑受影響的」之間的矛盾——那是另一件在等 Yolin 決定的事，照現行做法就好，不要順手改。
- 共用慣例的條文如果你覺得寫錯了、或跟本 App 的規則衝突：**不要改副本**，寫進回報，由統籌者改主檔。

### commit B 的驗證

本次不新增任何測試碼，所以沒有新斷言要用突變證明。如果你認為非加測試不可，停下來回報，不要自己加。

| # | 做什麼 | 合格條件 |
|---|---|---|
| V1 | commit B 之前 `git status --short` | 只有：`docs/CONVENTIONS.md`（新增）、`CLAUDE.md`（修改）、本工單 `docs/SPEC_共用慣例導入.md`（**新增**——統籌者放進來的，請跟 commit B 一起 commit）、`docs/STATUS.md`（你平常的收尾更新）。多一個檔都要解釋 |
| V2 | commit B 之後 `git diff --numstat HEAD~1 HEAD -- CLAUDE.md` | 刪除行數**＝0**、新增行數＝8。**只量 commit B**（commit A 本來就會改到一行，不算在這裡） |
| V3 | 看 `docs/CONVENTIONS.md` 第一行 | 逐字等於 `<!-- CONVENTIONS v1 2026-09-19 -->`，前面沒有空行、沒有 BOM、沒有 CR |
| V4 | 副本與附錄全文比對 | 逐字相同，比對方法要有對照組（故意改一個字應判成不同）。掛得到統籌工作區的話再加一道：`git diff --no-index --ignore-cr-at-eol --quiet ../../Fable_Planner/CONVENTIONS.md docs/CONVENTIONS.md`，exit code 0 |
| V5 | **公開前自查。兩個 commit 都做完之後、push 之前**，把兩個 commit 的全部新增行抽出來（`git show <hash> --format= --unified=0`，取 `+` 開頭、排除 `+++` 的行），查四類：(a) 金鑰或 token；(b) email；(c) 你這台機器的本機使用者名稱（從環境變數取，**不要寫進任何檔案、輸出也不要印**）；(d) 磁碟機代號開頭的路徑與家目錄路徑。搜尋式用 Grep 工具或寫成檔案的腳本（放 scratchpad），不要經過 `node -e`／heredoc | (a)(c)(d) 零命中。(b) **預期恰好命中 1 處，而且只能是這份工單 A1 裡的那個 noreply 地址**——它不是個資（它是 GitHub 提供來取代真實信箱的公開地址），回報時點名這 1 處即可；除此之外 (b) 必須零命中。A2 改的那兩處條文只寫「GitHub noreply」這幾個字，**不要把任何信箱地址寫進 `CLAUDE.md` 或 STATUS**。**每一類都要先有對照組命中才算數**：(d) 用同一個搜尋式去搜本 repo 的 `CLAUDE.md`（統籌者 2026-09-19 實測 1 處）與 `docs/STATUS.md`（2 處）；(b) 去搜 `git log -1 --format=%ae`；(c) 去搜一個你臨時造的字串；(a) 用臨時拼出來的假 token 樣式。另確認 `@docs/CONVENTIONS.md` 不會被 email 搜尋式誤判。**把搜尋式、對照組命中在哪、目標命中情形寫進回報；回報送出後先不要 push，等 Dispatch 回覆** |
| V6 | `npm run doctest` | 全綠（125 條上下，以實際為準）。兩個 commit 都做完之後跑一次即可 |
| V7 | commit B 之後 `git log -1 --format='%ae %ce'` | 都是 noreply——導入 commit 自己就是新信箱生效的第二個實證 |

## push 與回報

- **先做完 A、B 兩個 commit → 跑 V5、V6 → 回報 → 等 Dispatch 回覆 → 才 `git push`**（本 repo 的 `main` 有設 upstream，用你平常的方式）。推完不用核對三處版本號（沒有 bump）。推完可以到 GitHub 的 commit 頁面看一眼：兩個新 commit 應該顯示為 `yolin0513`。
- 回報請包含：
  1. 兩個 commit 的 hash（本機的；此時還沒 push）。
  2. A-V1–A-V4、V1–V7 逐項結果（貼指令輸出的關鍵行；真實信箱遮蔽）。分開寫「實測驗證過的」與「推論的」。
  3. **衝突清單**：把副本逐條讀過，列出共用條文與本 App 既有規則**實質衝突**的地方；沒有就明講沒有。統籌者勘查時看到、請你確認的幾處：
     - 本 App「常設規則補遺」開頭寫「（與工作慣例）兩邊衝突以這裡為準」；指向段寫「本檔與 STATUS 優先於共用慣例，衝突時照較嚴的做」。兩條管的是不同層，應該不打架——請確認你讀起來也是這樣。
     - 共用 §5.1 接受用突變「或拿修正前的程式跑」證明斷言會紅；本 App 限定用突變。照本 App 較嚴的做。
     - 共用 §2.1 說「動到本 App 以外的任何檔案要先問」，本 App 是「任何檔案都不改」。照本 App。
     - 共用 §2.3 把改寫 git 歷史留給各 App 自訂——本 App 是「不准」，不受影響。
     - 共用 §5.7「平常只跑受影響的測試」對上本 App「每版 26 支全套綠」：已知，等 Yolin 決定，這次照現行做法。
  4. 你執行時遇到、這份工單沒預期到的任何狀況。
- 完成後這個 Session **不需要**補寫回執（回執是給「之後全新開場的 Session」用的）。

---

## 附錄：副本全文（`docs/CONVENTIONS.md` 的內容＝下面區塊裡的文字）

````markdown
<!-- CONVENTIONS v1 2026-09-19 -->
# 四個 App 共用的工作慣例（CONVENTIONS.md）

適用：JLPT_App、StockDiary、TripQuest、MealMate。
主檔在統籌工作區（Fable 統籌 Session 的 repo）；每個 App 的 `docs/CONVENTIONS.md` 是內容相同的副本。**不要直接改副本**，要改照 §7。
這裡只收四個 App 都同意的規則。每個 App 自己的紅線、指令、門檻在它的 `CLAUDE.md` 與 `docs/STATUS.md`。

## §0 怎麼用這份

1. 開工前讀完本檔、本 App 的 `CLAUDE.md` 與 `docs/STATUS.md`。
2. 第一則回覆的第一行寫回執：`已讀共用慣例 v1（2026-09-19）`（版本與日期抄本檔第一行）。沒有回執，Yolin 就當你沒讀。
3. **本 App 的 `CLAUDE.md` 與 `docs/STATUS.md` 優先於本檔。** 兩邊衝突時照較嚴的那一邊做，並在回報裡指出來，讓統籌者修本檔。只有 §2 第 1、2 條與 §3 是專案不得放寬的。
4. 讀不到本檔：先試 `git show HEAD:docs/CONVENTIONS.md`；還是沒有，就在第一則回覆第一行寫「讀不到共用慣例」，然後照本 App 的 `CLAUDE.md` 與 `docs/STATUS.md` 工作。

## §1 角色與流程（Yolin 2026-09-14 明訂）

1. **規劃：Fable 5.1（effort high）統籌 Session。** 理解需求、拆解、寫成規格。單一 App 的規格放該 App 的 `docs/SPEC_<主題>.md`；跨 App 的放統籌工作區。
2. **開發：Opus 5，平常 effort high；只有 Yolin 明講「大工程」才切 Max。** Opus 負責實作，也負責查找、蒐集資料。
3. **流程**：Fable 寫 spec → Opus 實作＋查資料 → 回報並逐項與 spec 對照 → 與 Yolin 確認。
4. **較大改動或值得討論的議題**：由 Fable 開 3 個代理投票，同一份 prompt、各自獨立、多數決、分歧採保守；各代理當統籌，查資料交給 Opus；Fable 彙整後回報。哪些算「較大」、實作途中臨時遇到時怎麼辦，看本 App 的規定。
5. **Fable 額度用盡就自動改用 Opus 5，不要停下來問。**（Yolin 2026-09-10 明訂）代理因 429／quota 失敗 → 改 `claude-opus-5` **整批重跑**（投票要在同一個模型上才可比）→ 回報註明「因 Fable 額度用盡改用 Opus 5」。連 Opus 5 也不可用才暫停。

## §2 授權的地板

1. **這三件一定先問 Yolin**：刪除或破壞使用者資料；花錢、或需要註冊帳號／綁卡的服務；動到本 App 以外的任何檔案。
2. **其他 App 的目錄可以讀、不可以寫**（讀來抄慣例、對照同一種 bug）。統籌 Session 只會在本 App 寫 `docs/SPEC_<主題>.md`；它不改程式、不 commit、不 push。
3. **本檔不規定的**：一般 commit／push／部署、改寫 git 歷史、force push、刪除已 commit 的檔案、建新 repo——看本 App 的 `CLAUDE.md` 與 `docs/STATUS.md`。那裡也沒寫的破壞性操作，一律當作要先問。

## §3 溝通

1. **禁止互動式提示框／多選題工具（`AskUserQuestion` 之類）。**（Yolin 2026-09-16 明訂）需要 Yolin 決定的事一律用**純文字**寫在回覆裡：列出選項、每個選項的代價、你的建議與理由，然後**停下來等**，由 Dispatch 轉達。理由：Yolin 常從手機或另一台電腦遠端操作，提示框只渲染在本機那台 PC，遠端點不到，Session 就此卡死。
2. **全程繁體中文，包括思考與判斷的過程。**（Yolin 2026-09-16 明訂）維持原樣不硬翻：程式碼、變數與函式名、檔名與路徑、指令、專有名詞、引用出處。理由：Yolin 要能看懂你為什麼這樣決定。
3. **回報分開寫「實測驗證過的」與「推論的」。** 結尾放需要 Yolin 決定的事項，沒有就明講沒有。

## §4 給使用者看的文案要誠實

拿不到、算不出、還沒開放的，就照實寫（「尚未取得」「未估算」「這一版尚未開放」這類話）——不顯示 0、不用預設值冒充使用者輸入、不用舊資料冒充新資料。

## §5 測試紀律

1. **每條新斷言都要證明它會紅**：把對應邏輯改壞（突變），或拿修正前的程式跑，測試必須失敗；修回去必須綠。修 bug 時補一條「修正前會紅」的回歸斷言，並說明既有測試為什麼沒抓到。有新行為就補斷言。
2. **不寫假斷言。** 抓到過的形狀：母體是空的；母體恰好是「有問題的那幾個」；等待條件在上一頁就已經成立；反例太弱、被別條規則順便擋掉；掃描器把註解當程式碼；「應該是 0」旁邊沒有「母體非空」。寫完一條 `noneOf`／`everyOf` 就問一次：**這個母體現在有幾個元素？** 註解不是斷言。
3. **檢查器要有對照組**：餵已知該被抓到的輸入，斷言真的抓到。**斷言驗語意、不貼字面。**
4. **從使用者實際會走的入口測**：每個功能至少一條斷言從真實入口（畫面上的按鈕、對外的函式）進去，不能只驗內層純函式。
5. **含 regex 或反斜線的測試碼、補丁，一律用 Write／Edit 工具直接寫檔，不要經過 shell heredoc 或 `node -e`**：`\s` 變 `\\s` 或被吃掉都不報錯、測試照樣綠、但永遠不命中。
6. **打真網路的測試不進 `npm test`**，另開獨立指令；對外部服務的請求頻率照該服務的規矩。
7. **平常只跑受影響的測試，全面檢測由 Yolin 叫。**（Yolin 對全部專案的指示）沒有放寬的那一條：新斷言仍然必須證明會紅。
8. 隨機產生的輸出不得綁死單一結果；需要特定情境的斷言用固定 seed 自己造情境，並加一條前置斷言把情境講出來。

## §6 文件

1. **`docs/STATUS.md` 是接手契約。** 最上面是「目前進行中／交接」與「等 Yolin 回覆」兩節；這兩節過期了就改寫，不要往下追加。只存在對話裡的決定、規則、踩坑，收尾前寫進 STATUS。
2. 規格 `docs/SPEC_<主題>.md`；投票紀錄 `docs/VOTE_<日期>.md`。
3. 文件裡的數字盡量由靜態稽核從程式數出來比對；文件會漂移，而漂移不會讓任何測試變紅。

## §7 本檔怎麼改

1. **一條規則該進本檔還是留專案**，依序問：(a) 把規則裡的 App 名、檔名、數字換成另一個 App 的，還成立且措辭不必改嗎？(b) 在任何一個 App 違反它，Yolin 都會認為做錯了嗎？(c) 它是「原則＋某 App 的執行細節」嗎？——(a)(b) 都是 → 原則進本檔，細節留專案。領域紅線（健康、投資、使用者資料）永遠留專案；Yolin 指名「全部專案」的直接進本檔。
2. **只有統籌 Session 改主檔**：第一行版本 +1、日期改當天、§8 加一行。各 App 的副本由該 App 自己的 Session 依統籌者寫的工單更新。副本落後不擋任何工作。
3. 開發 Session 發現值得變成通則的規則：先照常寫進本 App 的 STATUS，並在回報裡標「候選通則」，由 Dispatch 轉給統籌者。不要改副本。
4. Yolin 明訂的直接進；Session 提議的要 Yolin 點頭；會改變四個 App 做法的才開 3 代理投票。

## §8 變更紀錄

- v1（2026-09-19）：初版。只收四個 App 現有條文的交集。規格：統籌工作區的 `SPEC_共用慣例.md`（v2）。
````
