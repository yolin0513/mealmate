#!/usr/bin/env bash
# 推送的閘門（共用慣例 §2.5）：自查 → 推送 → 比對遠端，每一關失敗都真的停下。
# 用法（在 repo 根目錄）：bash scripts/pushgate.sh
# 回傳值：0 推上去了且遠端＝本機；1 自查沒過（沒推）；2 推送失敗（沒做後面的比對）；3 推送回報成功、遠端 main 卻不等於本機 HEAD；
#         4 閘門、自查或驗法改過之後，還沒跑過驗法（登記對不上或沒有登記）；
#         5 這次要推的 commit 動到 build-recipes、build-foods 或 buildguard-verify，卻還沒在 HEAD 跑過 F8 驗法（登記對不上或沒有登記）；取不到檔名清單也回 5。
#         6 執行環境裡有 GIT_ 開頭的變數（不分大小寫；只放行 GIT_EDITOR、GIT_SEQUENCE_EDITOR、GIT_PAGER），在任何 git 呼叫之前就停。
#         7 突變的還原紀錄還在（scripts/.mutation-pending.json，或帳本的 inflight）：突變跑到一半被中斷、壞檔可能還在工作區。
#         9 鎖定的 commit 之後本機又多了 commit（自查之後、或推送期間）：只推鎖定的那一個，新的沒經自查、沒推；重跑閘門。
# 鎖定 commit（2026-10-03，StockDiary 挖出、Dispatch 排第 1）：以前自查掃「當下的 HEAD」、推「推送那一刻的 main」、第三關比的
# HEAD 又是自查之後才記的——中間多一個 commit，它會不經自查公開，而且第三關連報錯都不會。現在一開頭就記下 LOCK_SHA，
# 自查只掃到它、推送只推它（明寫 LOCK_SHA:refs/heads/main）、第三關拿遠端跟它比；推之前、推之後都查 HEAD 有沒有動。
# 逾時（同一天）：取遠端、自查、推送、問遠端都有上限（用 Git Bash 的 /usr/bin/timeout，找不到就停），卡住不會一直卡著。
# 不接管線：每一步的輸出寫到 .logs/（已在 .gitignore），回傳值直接拿那一步的。
# 驗法：bash scripts/pushgate-verify.sh（本機假遠端分別製造每一關的失敗）。全部通過時它登記三支檔案的雜湊，本檔推送前比對。
set -u
# 入口：執行環境裡 git 自己認得的變數（2026-09-25，JLPT 提出、Dispatch 核准）。程式碼裡看不到它們、掃描也找不到——
# git 自己就會讀。設了（空字串也算），整個閘門會對著另一個 repo 或另一份設定跑完全套檢查、然後說通過。所以在任何 git 呼叫之前主動拒絕（回 6）。
# 前綴寫法（補充說明十一第 4 點）：GIT_ 開頭的一律拒絕，只放行登記過、只影響互動介面的（編輯器、分頁器）——逐一列舉一定會漏（例：GIT_EXEC_PATH）。
# 名稱不分大小寫：Windows 上環境變數不分大小寫，git_dir 跟 GIT_DIR 是同一個。
GIT_ENV_ALLOW=" GIT_EDITOR GIT_SEQUENCE_EDITOR GIT_PAGER "
for v in $(compgen -e); do
  u="${v^^}"
  case "$u" in GIT_*) case "$GIT_ENV_ALLOW" in *" $u "*) ;; *) echo "【擋下：執行環境】$v 有設定：git 自己認得 GIT_ 開頭的變數，閘門會對著別的 repo 或設定跑完全套檢查；先 unset $v 再推"; exit 6;; esac;; esac
done
cd "$(git rev-parse --show-toplevel)" || exit 1
# 鎖定這一次要推的 commit：之後每一關都對這一個編號，不再讀「當下的 HEAD」
LOCK_SHA="$(git rev-parse HEAD)"
if [ -z "$LOCK_SHA" ]; then echo "【擋下：鎖定 commit】讀不到 HEAD，不推送"; exit 1; fi
# 逾時用的 timeout：寫死 Git Bash 的那一支（Windows 自己也有一支同名的 timeout.exe，用法完全不同）；找不到就停，不退回「不設逾時」
TO=/usr/bin/timeout
if [ ! -x "$TO" ]; then echo "【擋下：逾時】找不到 $TO，閘門的每一關都要有逾時，不推送"; exit 1; fi
# 遠端固定是 origin（2026-09-25 移除 PUSHGATE_REMOTE：整個 repo 沒人用，設了它 fetch、自查範圍、推送會一起改指到別的遠端，閘門照樣說通過）
REMOTE=origin
mkdir -p .logs
LOG=".logs/pushgate.out"

# 第零關之零：突變跑到一半被殺掉留下的壞檔（2026-10-02，StockDiary 挖出來、Dispatch 指示各家照查）。
# 執行器改壞原始碼之前，會先把原檔寫進 scripts/.mutation-pending.json、在帳本記 inflight；被殺掉時 finally 不會跑，
# 還原只在下次啟動執行器時才發生——中間有人 commit、推送，壞檔就被收進去、推出去。所以紀錄還在就擋（回 7），點名該還原哪支檔。
# 紀錄讀不出檔名也擋（讀不出來不是「沒有紀錄」）。這個檔在 .gitignore 裡，git status 看不到，只能這裡主動看。
PENDINGF="scripts/.mutation-pending.json"
if [ -e "$PENDINGF" ]; then
  prel="$(grep -o '"rel":"[^"]*"' "$PENDINGF")"
  echo "【擋下：突變的還原紀錄】$PENDINGF 還在：突變跑到一半被中斷，${prel:-（紀錄讀不出檔名）} 可能還是改壞的版本。先跑一次 node scripts/mutationtest.mjs --dry-run 讓它還原（或照紀錄人工還原、確認 git diff），再推"
  exit 7
fi
if grep -q '"inflight": {' scripts/mutation-ledger.json 2>/dev/null; then
  echo "【擋下：突變的還原紀錄】帳本 scripts/mutation-ledger.json 記著一條改壞了還沒收尾的突變（inflight），先跑一次 node scripts/mutationtest.mjs --dry-run 核對兩處紀錄，再推"
  exit 7
fi

# 第零關：驗法登記（2026-09-24 起）。以前「改過閘門就重跑驗法」靠人記得；現在沒跑過就推不出去。
REG=".logs/pushgate-verified.txt"
cur=""
for f in scripts/pushgate.sh scripts/selfcheck.mjs scripts/pushgate-verify.sh; do
  h="$(git hash-object "$f" 2>/dev/null)"
  if [ -z "$h" ]; then echo "【擋下：驗法登記】讀不到 $f 的雜湊，不推送"; exit 4; fi
  cur="${cur}${f} ${h}"$'\n'
done
if [ ! -f "$REG" ]; then
  echo "【擋下：驗法登記】沒有登記檔（$REG）：閘門、自查或驗法改過之後還沒跑過驗法，先跑 bash scripts/pushgate-verify.sh"; exit 4
fi
if [ "$(cat "$REG")" != "$(printf '%s' "$cur")" ]; then
  echo "【擋下：驗法登記】閘門、自查或驗法跟上次驗法通過時不一樣（改過之後還沒跑過驗法），先 commit 再跑 bash scripts/pushgate-verify.sh"; exit 4
fi

# 第一關：自查。先 fetch：自查的範圍是「追蹤分支..HEAD」，追蹤分支若停在一次「推了但遠端沒更新」之後，
# 那幾個沒真的推上去的 commit 會落在範圍外、不經檢查就被推出去（pushgate-verify 第 8 種）
"$TO" 120 git fetch -q "$REMOTE" main > "$LOG" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then cat "$LOG"; if [ "$rc" -eq 124 ]; then echo "【擋下：自查】取遠端逾時（120 秒），自查的範圍不確定，不推送"; else echo "【擋下：自查】讀不到遠端，自查的範圍不確定，不推送"; fi; exit 1; fi

# 第零關之二：F8 驗法登記（2026-09-24 起；F9 四家統一）。build-recipes、build-foods 的故障矩陣一輪 7 分鐘以上、不進 npm test；
# 以前寫「改到這兩支就手動跑一次」靠人記得，現在：HEAD 全擋時登記三支「已 commit 版本」的雜湊，推送前比對（回 5）。
# **只在這次要推的 commit 動到被守的檔時才看登記**（F9 第 2 點）：新 clone 推一個沒碰它們的 commit，不必先跑 7 分鐘。
# 範圍照遠端的實際狀態算（上面剛 fetch 過），逐個 commit 取檔名（中途改了又改回去的也算動到）；取不到檔名清單 → 停。
# 比的是 HEAD 裡的版本（推出去的就是它），不是工作區——工作區沒 commit 的改動不會被推。
BGREG=".logs/buildguard-verified.txt"
BGFILES="scripts/build-recipes.mjs scripts/build-foods.mjs scripts/buildguard-verify.mjs"
BGRUN="node --max-old-space-size=4096 scripts/buildguard-verify.mjs --rev HEAD（7 分鐘以上）"
if ! git log --format= --name-only "$REMOTE/main..$LOCK_SHA" > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：F8 驗法登記】取不到這次要推的檔名清單，不知道有沒有動到被守的檔，不推送"; exit 5; fi
bgtouched=""
for f in $BGFILES; do
  if grep -qxF -- "$f" "$LOG"; then bgtouched="${bgtouched} $f"; fi
done
if [ -z "$bgtouched" ]; then
  echo "F8 驗法登記：這次要推的 commit 沒動到被守的三支（$BGFILES），不看登記"
else
  bgcur=""
  for f in $BGFILES; do
    h="$(git rev-parse "$LOCK_SHA:$f" 2>/dev/null)"
    if [ -z "$h" ]; then echo "【擋下：F8 驗法登記】讀不到鎖定的 commit 裡 $f 的雜湊，不推送"; exit 5; fi
    bgcur="${bgcur}${f} ${h}"$'\n'
  done
  if [ ! -f "$BGREG" ]; then
    echo "【擋下：F8 驗法登記】這次要推的 commit 動到了$bgtouched，卻沒有 F8 驗法的登記檔（$BGREG），先跑 $BGRUN"; exit 5
  fi
  if [ "$(cat "$BGREG")" != "$(printf '%s' "$bgcur")" ]; then
    echo "【擋下：F8 驗法登記】這次要推的 commit 動到了$bgtouched，跟上次在 HEAD 全擋時不一樣（改過之後還沒跑過），先跑 $BGRUN"; exit 5
  fi
  echo "F8 驗法登記：動到了$bgtouched，登記對得上"
fi
"$TO" 300 node scripts/selfcheck.mjs "$REMOTE" --head "$LOCK_SHA" > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -eq 124 ]; then echo "【擋下：自查】逾時（300 秒），不推送"; exit 1; fi
if [ "$rc" -ne 0 ]; then echo "【擋下：自查】回傳 $rc，不推送"; exit 1; fi
echo "自查掃的範圍尾端＝鎖定的 commit ${LOCK_SHA:0:7}"

# 第二關之前：鎖定之後 HEAD 有沒有動（自查期間或自查之後多了 commit）——動了就不推，那個 commit 沒經自查
NOW_SHA="$(git rev-parse HEAD)"
if [ "$NOW_SHA" != "$LOCK_SHA" ]; then
  echo "【擋下：鎖定 commit】自查之後本機 HEAD 變了（鎖定 ${LOCK_SHA:0:7}，現在 ${NOW_SHA:0:7}）：多出來的 commit 沒經自查，不推送；重跑閘門"
  exit 9
fi

# 第二關：推送——只推鎖定的那一個（不推「推送那一刻的 main」）
"$TO" 120 git push -q "$REMOTE" "$LOCK_SHA:refs/heads/main" > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -eq 124 ]; then echo "【擋下：推送失敗】推送逾時（120 秒），不做後面的確認（遠端可能已更新、也可能沒有：重跑閘門會從遠端的實際狀態重算）"; exit 2; fi
if [ "$rc" -ne 0 ]; then echo "【擋下：推送失敗】回傳 $rc，不做後面的確認"; exit 2; fi

# 第三關：遠端 main 等於鎖定的 commit（直接問遠端，不看本機的追蹤分支）
LS="$("$TO" 60 git ls-remote "$REMOTE" refs/heads/main 2>"$LOG")"
REMOTE_SHA="${LS%%[[:space:]]*}"
if [ "$REMOTE_SHA" != "$LOCK_SHA" ]; then
  echo "【擋下：遠端對不上】遠端 main=${REMOTE_SHA:-（讀不到）}，鎖定的 commit=$LOCK_SHA"
  exit 3
fi
# 推送期間本機又多了 commit：推上去的是鎖定的那一個（對的），但多出來的沒推、也沒經自查——照實講、回 9
NOW_SHA="$(git rev-parse HEAD)"
if [ "$NOW_SHA" != "$LOCK_SHA" ]; then
  echo "【已推送鎖定的 commit，但推送期間本機多了 commit】遠端 main＝${LOCK_SHA:0:7}；本機現在 ${NOW_SHA:0:7}，多出來的沒推、沒經自查；重跑閘門"
  exit 9
fi
echo "【已推送】遠端 main＝鎖定的 commit＝本機 HEAD（${LOCK_SHA:0:7}）"
exit 0
