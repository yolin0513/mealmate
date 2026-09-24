# SPEC_CLAUDEmd歷史條文 — `CLAUDE.md` 第 10 行「改寫 git 歷史（不准）」加上範圍

> 狀態：已執行（2026-09-24）
> 撰寫：統籌 Session（Opus 5.5，effort Max），2026-09-24。依據：**Yolin 2026-09-24 同意**（Dispatch 轉達）。
> 建議 effort：medium（改一行文字）。不 bump 版本、不部署、不算一版。

## 為什麼

`CLAUDE.md` 第 10 行寫「改寫 git 歷史（不准；…）」，字面沒有範圍。它的出處是 Yolin 09-17、09-19 對**已推送歷史**的決定（不用 filter-repo 重寫、作者信箱不改回），管的是已經公開的歷史。2026-09-24 你把兩個從沒推出去過的 commit 併成一個（Dispatch 核准的 A 案），合乎這條的本意，但字面會讓之後的 Session 要嘛照字面判成不准、要嘛拿它當前例擴大解讀。Yolin 同意把範圍寫清楚。

## 要做的事

把 `CLAUDE.md` 第 10 行裡的這一段（逐字）：

> 改寫 git 歷史（不准；

改成：

> 改寫已推送的 git 歷史（不准；還沒推出去的本機 commit 可以整理——Yolin 2026-09-24 同意；

**只改這一段**，同一行後面（commit 作者信箱那一段）與其他每一行一字不動。STATUS 記一筆（日期、改了哪一段、依據）。

## 不准做的事

- 只准動 `CLAUDE.md` 那一段、`docs/STATUS.md`、本工單（新增，請一起 commit）。
- 已推送的歷史照舊不改寫：這一條放寬的只有「還沒推出去的本機 commit」。

## 驗證（結果貼進回報）

| # | 做什麼 | 合格條件 |
|---|---|---|
| U1 | `git diff -- CLAUDE.md` | 只有第 10 行那一段不同，其他每一行不變 |
| U2 | `git status --short` | 只有 `CLAUDE.md`、`docs/STATUS.md`、本工單 |
| U3 | 推送 | 用你的推送閘門，不接管線 |
| U4 | `npm run doctest` | 全綠（它會讀 `CLAUDE.md` 的就一起驗到） |

## commit 與回報

- 一個 commit，訊息以 `docs:` 開頭。
- 回報：最前面一行寫你這個 Session 實際跑的模型與 effort；然後 commit hash、U1–U4。
