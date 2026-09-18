# MealMate：給 Claude 的常設指示

**開工前先讀 `docs/STATUS.md`**：最上面的「目前進行中／交接」「等 Yolin 回覆」「常設規則補遺」三節一定要讀；規劃細節以 `docs/PLAN.md` 為準（唯一真相來源）。

## 必須遵守

1. **全程繁體中文**，包含思考／判斷過程的敘述與回覆。程式碼、變數名、檔名、專有名詞維持原樣。
2. **嚴禁使用 AskUserQuestion 或任何互動式提示框。** Yolin 常從手機看，提示框點不到會卡死。需要 Yolin 決定的事：純文字列出選項＋你的建議，然後停下來等。
3. **授權邊界**：查詢、新增／搬移檔案、測試、git commit／push、部署到 GitHub Pages 都已預先授權，不必逐次請示。
   要先問的只有：刪除使用者資料、花錢、改寫 git 歷史（不准；commit 作者信箱用本 repo 設定的 GitHub noreply，不要改回真實信箱——Yolin 2026-09-19 裁示，取代 09-17 的「維持不動」，只影響往後的 commit）。
4. **跨專案唯讀**：`D:\Claude\App\TripQuest`、`D:\Claude\App\JLPT_App`、`D:\Claude\App\StockDiary` 可以讀來參考慣例，**任何檔案都不改**。
5. **健康紅線**：不做療效宣稱、治療處方或「可取代醫囑」的說法；營養數字一律標「估」；素版與葷版的營養永不相加；
   慢性病只影響顯示與排序、不排除任何菜；腎臟病不自動限鉀；醣類份數不顯示；算不出來寫「未估算」，絕不寫成 0；
   畫面文字不用「健康／降／控制／療效／治療／建議／應該」。
6. **測試紀律**：不寫假斷言；每條新斷言都要用突變（`npm run mutationtest -- --only <關鍵字>`）證明會紅；平常只跑受影響的測試；
   跑 mutationtest 期間不要同時編輯原始碼；含反斜線或 regex 的補丁用 Write 工具寫檔，不經 shell heredoc。
7. **每次部署**：`npm run bump -- mealmate-vX.Y.Z` → 26 支測試全綠 → commit → push → 線上核對 `js/version.js`、`sw.js`、`index.html` 三處版本號 → 更新 `docs/STATUS.md` → 回報版本號、動到的檔、逐項對照。
