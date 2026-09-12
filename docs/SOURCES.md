# 資料與衛教來源總表（docs/SOURCES.md）

> App 裡每一句衛教文字都指向 `data/edu.json` 的一個 id；每個 id 都能在這裡與 `docs/sources/` 找到原文與擷取紀錄。`edutest` 會檢查：每筆有來源欄位、`kind=quote` 的文字能在 `docs/sources/*.md` 找到、`js/` 裡用到的 id 都存在。

## 1. 營養資料

| 項目 | 內容 |
|---|---|
| 來源 | 衛生福利部食品藥物管理署「食品營養成分資料庫」，政府資料開放平臺資料集 8543 |
| 下載 | `https://data.fda.gov.tw/data/opendata/export/20/json`（zip） |
| 授權 | 政府資料開放授權條款－第1版（與 CC BY 4.0 相容；須標示來源） |
| 版本 | 資料檔 2026-08-26（`data/foods.json` 的 `version`；每季更新，更新時跑 `npm run build-foods -- --download` 並看差異報告） |
| 轉換 | `scripts/build-foods.mjs`；規則與實測見 `FEASIBILITY.md` §1 |
| 標示位置 | 家人分頁「關於與資料來源」卡片；每個營養估算的「怎麼算的」底部（M1） |

## 2. 國健署衛教文字（人工開頁，2026-09-12）

規劃期 curl 對 `www.hpa.gov.tw` 回 403（WAF）、WebFetch 憑證驗證失敗；M0 改用 Claude 桌面版內建瀏覽器（真實 Chrome）開頁，全部可讀。

| 頁面 | 網址 | 紀錄檔 | 用途 |
|---|---|---|---|
| 政府網站資料開放宣告 | `Pages/Detail.aspx?nodeid=92&pid=5141` | `sources/hpa-open-data-declaration.md` | **授權依據**：文字可引用須註明出處；影音圖像不可用 |
| 6大類食物 | `Pages/List.aspx?nodeid=4086` | `sources/hpa-six-food-groups.md` | 均衡、蛋白質順序、當季蔬菜、全穀、油、乳品 |
| 國人膳食營養素參考攝取量（第八版索引） | `Pages/List.aspx?nodeid=4613` | `sources/hpa-dris-8th-index.md` | 「以健康人為對象」；**數值尚未核對，不放數字** |
| 質地調整飲食 | `Pages/Detail.aspx?nodeid=4131&pid=11931` | `sources/hpa-texture-modified-diet.md` | 三好一巧、質地分級名稱 |
| 植物為主飲食專區 | `Pages/List.aspx?nodeid=4530` | `sources/hpa-plant-based-diet.md` | 「豆＞魚＞蛋＞肉」 |

### 開不起來或沒開的（記錄，不當來源）

| 頁面 | 狀況 |
|---|---|
| 高齡營養健康食譜 `Pages/Detail.aspx?nodeid=485&pid=8695` | 瀏覽器開啟時**回的是檔案下載**（跳出儲存對話框），不是網頁；本次未下載。食譜本來就全部自撰，不依賴它 |
| 食物代換表 `Pages/Detail.aspx?nodeid=485&pid=8380` | 同上，檔案下載。「1 份醣類 ≈ 15 克」的換算**尚未有可引用的原文**，M1 做醣類份數顯示前要先找到 HTML 版來源或人工下載 PDF 核對後記錄頁碼 |
| 「我的餐盤」均衡飲食圖像及口訣 `Pages/List.aspx?nodeid=4686` | 頁面只有外食文章清單，口訣本文不在此頁；未引用 |
| 健康九九 `health99.hpa.gov.tw/material/3368`（花漾銀髮食譜手冊） | 伺服器回 500 |
| 健康九九 `material/8279`（質地調整飲食衛教手冊） | 未開 |
| 《糖尿病與我》、《慢性腎臟病健康管理手冊》 | 未開（PDF 手冊）。慢性病留意項目的衛教句子在 M1 做家人設定前要補來源；補不到就只顯示欄位名稱與數字，不寫任何衛教句 |

## 3. 引用規則

1. `kind=quote` 逐字引用，不改字；要濃縮就用 `kind=summary` 並在文字裡讓人看得出是摘要。
2. 任何數字（幾茶匙、幾毫升、幾克）只能出現在 `quote` 裡，不得由 App 換算成使用者的目標或上限。
3. 不引用含「治療」「療效」「控制血糖」等字的句子；`copytest` 對 `edu.json` 同樣掃禁用詞。
4. 不使用國健署任何圖片、海報、影片、PDF 版面。
