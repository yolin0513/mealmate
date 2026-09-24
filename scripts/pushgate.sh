#!/usr/bin/env bash
# 推送的閘門（共用慣例 §2.5）：自查 → 推送 → 比對遠端，每一關失敗都真的停下。
# 用法（在 repo 根目錄）：bash scripts/pushgate.sh
# 回傳值：0 推上去了且遠端＝本機；1 自查沒過（沒推）；2 推送失敗（沒做後面的比對）；3 推送回報成功、遠端 main 卻不等於本機 HEAD；
#         4 閘門、自查或驗法改過之後，還沒跑過驗法（登記對不上或沒有登記）。
# 不接管線：每一步的輸出寫到 .logs/（已在 .gitignore），回傳值直接拿那一步的。
# 驗法：bash scripts/pushgate-verify.sh（本機假遠端分別製造每一關的失敗）。全部通過時它登記三支檔案的雜湊，本檔推送前比對。
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
REMOTE="${PUSHGATE_REMOTE:-origin}"
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
