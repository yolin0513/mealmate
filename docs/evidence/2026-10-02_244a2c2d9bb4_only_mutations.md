# 突變證據：2026-10-02、244a2c2d9bb4-dirty、跑法 only

> 由 `scripts/evidence.mjs` 從執行器的原始 log 逐項產生（原始 log 在 `.logs/`，不進版控）。每一條突變一列；結束方式與秒數取自帳本 `scripts/mutation-ledger.json`。

- 選了 20 條（清單共 577 條）；證據 20 列
- 情境成立：抓到 19、紅錯地方 0、沒紅 0、還原失敗 0、過期 0；情境未成立（不算數）1；其他 0
- 總耗時：2652 秒
- 資源紀錄的峰值：工作程序 3、合計記憶體 228 MB、系統可用最低 4718 MB（45 行；.logs\2026-10-02_244a2c2d9bb4-dirty_only_reslog.log）

| # | 判定 | 測試 | 突變 | 結束方式 | 秒數 |
|---|---|---|---|---|---|
| 1 | 抓到 | doctest | runkind 把「✓ 行裡提到 ✗」當成斷言失敗 | assert | 30 |
| 2 | 抓到 | doctest | mutationtest 的 expect 比對認「行裡有 ✗ 這個字」 | assert | 30 |
| 3 | 抓到 | resume-verify | 還原紀錄讀不懂就當成沒有紀錄 | assert | 188 |
| 4 | 抓到 | resume-verify | 還原紀錄欄位不對也照寫 | assert | 188 |
| 5 | 抓到 | doctest | 情境未成立：宣告了也照樣判成斷言失敗 | assert | 31 |
| 6 | 抓到 | doctest | 情境未成立：回 0 時照樣判成通過 | assert | 30 |
| 7 | 抓到 | doctest | 情境未成立：那幾個字出現在任何地方都算宣告 | assert | 31 |
| 8 | 抓到 | doctest | 情境未成立：不列在不算數裡 | assert | 30 |
| 9 | 抓到 | resume-verify | 情境未成立：不看痕跡、一律當成情境成立 | assert | 182 |
| 10 | 抓到 | doctest | 只差空白的突變：判斷永遠說「不是」 | assert | 32 |
| 11 | 抓到 | doctest | 只差空白的突變：檢查的條數不核對 | assert | 31 |
| 12 | 抓到 | doctest | 只差空白的突變：執行器開跑前不擋 | assert | 33 |
| 13 | 抓到 | resume-verify | 護欄：還原紀錄被移掉也照跑 | assert | 190 |
| 14 | 抓到 | resume-verify | 護欄：帳本有未收尾的紀錄就一律拒絕（檔案已經是原樣也拒絕） | assert | 169 |
| 15 | 情境未成立 | resume-verify | 護欄：不在帳本記開跑未完成 | noscenario | 113 |
| 16 | 抓到 | resume-verify | 護欄一：工作區不等於 HEAD 也照跑整套 | assert | 261 |
| 17 | 抓到 | resume-verify | 護欄一：--only 也要求工作區等於 HEAD | assert | 203 |
| 18 | 抓到 | resume-verify | 護欄一：--only 的目標檔已經是改壞後的樣子也照跑 | assert | 194 |
| 19 | 抓到 | resume-verify | 護欄：「是不是原樣」逐位元組比（不統一行尾） | assert | 189 |
| 20 | 抓到 | resume-verify | 護欄：還原紀錄還在時照樣改第二支檔 | assert | 223 |
