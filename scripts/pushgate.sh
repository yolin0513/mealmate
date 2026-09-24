#!/usr/bin/env bash
# 推送的閘門（共用慣例 §2.5）：自查 → 推送 → 比對遠端，每一關失敗都真的停下。
# 用法（在 repo 根目錄）：bash scripts/pushgate.sh
# 回傳值：0 推上去了且遠端＝本機；1 自查沒過（沒推）；2 推送失敗（沒做後面的比對）；3 推送回報成功、遠端 main 卻不等於本機 HEAD；
#         4 閘門、自查或驗法改過之後，還沒跑過驗法（登記對不上或沒有登記）；
#         5 這次要推的 commit 動到 build-recipes、build-foods 或 buildguard-verify，卻還沒在 HEAD 跑過 F8 驗法（登記對不上或沒有登記）；取不到檔名清單也回 5。
#         6 執行環境裡有 GIT_ 開頭的變數（不分大小寫；只放行 GIT_EDITOR、GIT_SEQUENCE_EDITOR、GIT_PAGER），在任何 git 呼叫之前就停。
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
# 遠端固定是 origin（2026-09-25 移除 PUSHGATE_REMOTE：整個 repo 沒人用，設了它 fetch、自查範圍、推送會一起改指到別的遠端，閘門照樣說通過）
REMOTE=origin
mkdir -p .logs
LOG=".logs/pushgate.out"

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
if ! git fetch -q "$REMOTE" main > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：自查】讀不到遠端，自查的範圍不確定，不推送"; exit 1; fi

# 第零關之二：F8 驗法登記（2026-09-24 起；F9 四家統一）。build-recipes、build-foods 的故障矩陣一輪 7 分鐘以上、不進 npm test；
# 以前寫「改到這兩支就手動跑一次」靠人記得，現在：HEAD 全擋時登記三支「已 commit 版本」的雜湊，推送前比對（回 5）。
# **只在這次要推的 commit 動到被守的檔時才看登記**（F9 第 2 點）：新 clone 推一個沒碰它們的 commit，不必先跑 7 分鐘。
# 範圍照遠端的實際狀態算（上面剛 fetch 過），逐個 commit 取檔名（中途改了又改回去的也算動到）；取不到檔名清單 → 停。
# 比的是 HEAD 裡的版本（推出去的就是它），不是工作區——工作區沒 commit 的改動不會被推。
BGREG=".logs/buildguard-verified.txt"
BGFILES="scripts/build-recipes.mjs scripts/build-foods.mjs scripts/buildguard-verify.mjs"
BGRUN="node --max-old-space-size=4096 scripts/buildguard-verify.mjs --rev HEAD（7 分鐘以上）"
if ! git log --format= --name-only "$REMOTE/main..HEAD" > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：F8 驗法登記】取不到這次要推的檔名清單，不知道有沒有動到被守的檔，不推送"; exit 5; fi
bgtouched=""
for f in $BGFILES; do
  if grep -qxF -- "$f" "$LOG"; then bgtouched="${bgtouched} $f"; fi
done
if [ -z "$bgtouched" ]; then
  echo "F8 驗法登記：這次要推的 commit 沒動到被守的三支（$BGFILES），不看登記"
else
  bgcur=""
  for f in $BGFILES; do
    h="$(git rev-parse "HEAD:$f" 2>/dev/null)"
    if [ -z "$h" ]; then echo "【擋下：F8 驗法登記】讀不到 HEAD 裡 $f 的雜湊，不推送"; exit 5; fi
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
node scripts/selfcheck.mjs "$REMOTE" > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -ne 0 ]; then echo "【擋下：自查】回傳 $rc，不推送"; exit 1; fi

# 第二關：推送
HEAD_SHA="$(git rev-parse HEAD)"
git push -q "$REMOTE" main > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -ne 0 ]; then echo "【擋下：推送失敗】回傳 $rc，不做後面的確認"; exit 2; fi

# 第三關：遠端 main 等於本機 HEAD（直接問遠端，不看本機的追蹤分支）
LS="$(git ls-remote "$REMOTE" refs/heads/main 2>"$LOG")"
REMOTE_SHA="${LS%%[[:space:]]*}"
if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then
  echo "【擋下：遠端對不上】遠端 main=${REMOTE_SHA:-（讀不到）}，本機 HEAD=$HEAD_SHA"
  exit 3
fi
echo "【已推送】遠端 main＝本機 HEAD（${HEAD_SHA:0:7}）"
exit 0
