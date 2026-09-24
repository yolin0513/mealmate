#!/usr/bin/env bash
# 推送閘門的驗法（共用慣例 §2.5）：用實際推送的那一支 scripts/pushgate.sh，分別製造每一關的失敗。
# 完全不碰 GitHub：在暫存目錄建 bare repo 當假遠端，複製本 repo **已 commit 的內容**過去（閘門要先 commit 才驗得到）。
# 用法（在 repo 根目錄）：bash scripts/pushgate-verify.sh。全部符合回傳 0；任何一種不符合回傳 1。
set -u
SRC="$(git rev-parse --show-toplevel)" || exit 1
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
git init -q --bare "$T/remote.git"
git clone -q --no-local "$SRC" "$T/work" || exit 1
cd "$T/work" || exit 1
# 驗的是「目前 checkout 的那個 commit」：來源是 detached HEAD 或別的分支時，clone 過來的 main 不一定是它
git checkout -q -B main
git remote set-url origin "$T/remote.git"
git push -q origin main || exit 1
git config user.name probe
git config user.email probe@users.noreply.github.com

remote_main() { git --git-dir="$T/remote.git" rev-parse main; }
probe_commit() { printf '%s\n' "$2" > "docs/$1.md"; git add "docs/$1.md"; git commit -q -m "probe $1"; }
reset_local() { git reset -q --hard "$(remote_main)"; git checkout -q -- .; }
BASE="$(remote_main)"
# 會把東西推上假遠端的情境跑完，把假遠端、本機追蹤分支、本機都還原成開始前的狀態——每一種情境各自獨立，
# 不會因為前一種漏出去的東西，讓後面的情境被連帶弄紅（例如推送被拒）而看起來像抓到了
restore_all() { git --git-dir="$T/remote.git" update-ref refs/heads/main "$BASE"; git update-ref refs/remotes/origin/main "$BASE"; git reset -q --hard "$BASE"; git checkout -q -- .; }
# 驗法登記（閘門第零關）：複本裡的閘門也要有登記才走得到後面的關卡——登記複本當下的三支檔案
GATE_FILES="scripts/pushgate.sh scripts/selfcheck.mjs scripts/pushgate-verify.sh"
register_work() { local out="" f; for f in $GATE_FILES; do out="${out}${f} $(git hash-object "$f")"$'\n'; done; mkdir -p .logs; printf '%s' "$out" > .logs/pushgate-verified.txt; register_bg; }
# 第零關之二（F8 驗法登記）：複本裡同樣登記當下的三支檔案，才走得到後面的關卡；第 15、16 種專驗這一關
BG_FILES="scripts/build-recipes.mjs scripts/build-foods.mjs scripts/buildguard-verify.mjs"
register_bg() { local out="" f; for f in $BG_FILES; do out="${out}${f} $(git hash-object "$f")"$'\n'; done; printf '%s' "$out" > .logs/buildguard-verified.txt; }
register_work
# 前置斷言：情境沒造成就中止，不讓一個根本沒發生的情境看起來符合
precondition() { if ! eval "$2"; then echo "$1｜前置不成立：$3｜不符合（情境沒造成，中止）"; FAIL=1; return 1; fi; }
FAIL=0
N=0
# check <名稱> <預期回傳值> <預期遠端：same|local> <輸出裡必須有的字> <輸出裡不能有的字>
# 「必須有的字」要講得出**為什麼**擋（命中的來源、例外的訊息），不能只比「擋下」——被別的理由擋下也會判成符合（v8 §5.11；2026-09-24 突變 M5 抓到）
check() {
  local name="$1" want="$2" wantRemote="$3" must="$4" mustNot="$5"
  local after; after="$(remote_main)"
  local remoteOk=no
  if [ "$wantRemote" = same ] && [ "$after" = "$BEFORE" ]; then remoteOk=yes; fi
  if [ "$wantRemote" = local ] && [ "$after" = "$(git rev-parse HEAD)" ]; then remoteOk=yes; fi
  local outOk=yes
  grep -q -- "$must" "$T/out" || outOk=no
  if [ -n "$mustNot" ] && grep -q -- "$mustNot" "$T/out"; then outOk=no; fi
  N=$((N + 1))
  local verdict=符合
  if [ "$RC" != "$want" ] || [ "$remoteOk" != yes ] || [ "$outOk" != yes ]; then verdict=不符合; FAIL=1; fi
  printf '%s｜回傳 %s（預期 %s）｜假遠端 %s → %s（預期 %s）｜%s\n' "$name" "$RC" "$want" "${BEFORE:0:7}" "${after:0:7}" "$wantRemote" "$verdict"
}
run_gate() { BEFORE="$(remote_main)"; bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?; }

# 每一種情境是獨立的函式，開頭一律先把假遠端、本機追蹤分支、本機、hook、登記還原成開始前的狀態（M6，2026-09-24）：
# 誰先誰後都不影響結果。順序由 PUSHGATE_VERIFY_ORDER 決定，預設是下面那一行；換一個順序跑，每一種的結論要一樣。
fresh() { rm -f "$T/remote.git/hooks/pre-receive" "$T/remote.git/hooks/post-receive"; restore_all; register_work; }

# 1 要推的檔有命中：當場組出來的合成 email
s1() { fresh
  probe_commit a "contact: $(printf '%s@%s' tester example-mail.test)"
  run_gate; check "1 自查命中" 1 same "來源：新增行" "已推送"; }

# 2 自查的對照組弄壞（email 的對照樣本換成不是 email 的字），內容乾淨
s2() { fresh
  node -e "const fs=require('fs');const f='scripts/selfcheck.mjs';const s=fs.readFileSync(f,'utf8');const a=\"const fakeMail = ['someone', 'example-mail.test'].join('@');\";if(!s.includes(a))process.exit(9);fs.writeFileSync(f,s.replace(a,\"const fakeMail = 'not-an-email';\"))" || { echo "2 對照組：找不到要弄壞的那一行（驗法過期）"; FAIL=1; }
  register_work   # 這一種驗的是自查的對照組，不是登記：改壞之後重新登記，才走得到自查
  probe_commit b "乾淨的一行"
  run_gate; check "2 對照組壞掉" 1 same "對照組命中=false" "已推送"; }

# 3 取不到使用者名稱（自查丟例外）
s3() { fresh
  probe_commit c "乾淨的一行"
  BEFORE="$(remote_main)"; USERNAME= USER= bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
  check "3 取不到使用者名稱" 1 same "取不到使用者名稱" "已推送"; }

# 4 沒有新 commit
s4() { fresh
  run_gate; check "4 沒有新 commit" 1 same "範圍裡沒有 commit" "已推送"; }

# 5 推送被拒（pre-receive 回傳 1）→ 停在推送，後面的比對沒跑
s5() { fresh
  printf '#!/bin/sh\nexit 1\n' > "$T/remote.git/hooks/pre-receive"; chmod +x "$T/remote.git/hooks/pre-receive"
  probe_commit e "乾淨的一行"
  run_gate; check "5 推送被拒" 2 same "擋下：推送失敗" "遠端對不上"; }

# 6 推送回報成功、遠端卻沒更新（post-receive 把 main 退回舊值）→ 停在比對遠端
s6() { fresh
  printf '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && git update-ref refs/heads/main "$old"; done\n' > "$T/remote.git/hooks/post-receive"; chmod +x "$T/remote.git/hooks/post-receive"
  probe_commit f "乾淨的一行"
  run_gate; check "6 推了沒更新" 3 same "擋下：遠端對不上" "已推送"; }

# 8 本機的追蹤分支跑在遠端前面（例如上一次「推了沒更新」之後），而它指的那個 commit 有命中、從沒真的推上去
#   → 閘門要先 fetch、照遠端的實際狀態算範圍，照樣查到命中、照樣擋
s8() { fresh
  probe_commit h "contact: $(printf '%s@%s' tester example-mail.test)"
  git update-ref refs/remotes/origin/main HEAD
  probe_commit h2 "乾淨的一行"
  run_gate; check "8 追蹤分支過時" 1 same "來源：新增行" "已推送"; }

# 9 命中只放在 commit 訊息（檔案內容乾淨）→ 擋在自查，理由指到「commit 訊息或作者欄」
s9() { fresh
  printf '乾淨的一行\n' > docs/i.md; git add docs/i.md; git commit -q -m "probe i：聯絡 $(printf '%s@%s' tester example-mail.test)"
  run_gate; check "9 命中只在 commit 訊息" 1 same "來源：commit 訊息或作者欄" "已推送"; }

# 10 作者信箱是一般信箱（檔案與訊息都乾淨）→ 同上
s10() { fresh
  printf '乾淨的一行\n' > docs/j.md; git add docs/j.md
  git -c user.name=someone -c user.email="$(printf '%s@%s' someone example-mail.test)" commit -q -m "probe j"
  run_gate; check "10 作者信箱是一般信箱" 1 same "來源：commit 訊息或作者欄" "已推送"; }

# 11 一行以 ++ 開頭的命中：在一個 commit 加進去、下一個 commit 刪掉（只存在於新增行裡）→ 擋在自查，理由指到「新增行」
s11() { fresh
  printf '++ contact: %s\n' "$(printf '%s@%s' tester example-mail.test)" > docs/k.md; git add docs/k.md; git commit -q -m "probe k add"
  git rm -q docs/k.md; git commit -q -m "probe k remove"
  # 先寫檔再數，不接管線（M4，統籌者 2026-09-24 裁示：不設永久例外）：取 diff 失敗就明講，不靠「數到 0 行≠3」間接擋下
  if ! git log -p --no-color --format= -U0 origin/main..HEAD > "$T/k.diff"; then echo "11 ++ 開頭的新增行｜取不到 diff｜不符合（情境沒造成，中止）"; FAIL=1; fi
  PP="$(grep -c '^+++ ' "$T/k.diff")"
  if precondition "11 ++ 開頭的新增行" '[ "$PP" = 3 ]' "diff 裡以「+++ 」開頭的行應該恰好 3 行（兩個檔頭＋那一行內容），實際 $PP 行"; then
    run_gate; check "11 ++ 開頭的新增行" 1 same "來源：新增行" "抽取壞了"
  fi; }

# 12 只刪不增：一個 commit 只刪掉一個既有的乾淨檔 → 通過、推上去（範圍裡有 commit，但新增行 0 行不該被當成故障）
s12() { fresh
  git rm -q docs/SOURCES.md; git commit -q -m "probe l：只刪不增"
  NC="$(git rev-list --count origin/main..HEAD)"; NS="$(git log --numstat --format= origin/main..HEAD)"
  if precondition "12 只刪不增" '[ "$NC" -ge 1 ] && ! printf "%s\n" "$NS" | grep -qE "^[1-9]"' "範圍裡要有 commit（實際 $NC 個）、numstat 新增行要是 0"; then
    run_gate; check "12 只刪不增" 0 local "已推送" "擋下"
  fi; }

# 13 閘門改過、還沒跑過驗法（登記對不上）→ 回 4，停在第零關，連自查都沒跑
s13() { fresh
  printf '\n# 改過一行\n' >> scripts/pushgate.sh
  probe_commit m "乾淨的一行"
  run_gate; check "13 改過沒跑驗法" 4 same "改過之後還沒跑過驗法" "查了："; }

# 14 沒有登記檔（例如剛改完、還沒跑過驗法的 repo；新 clone 也是）→ 回 4
s14() { fresh
  rm -f .logs/pushgate-verified.txt
  probe_commit n "乾淨的一行"
  run_gate; check "14 沒有登記檔" 4 same "沒有登記檔" "查了："; }

# 15 build 改過、還沒在 HEAD 跑過 F8 驗法（登記對不上）→ 回 5，停在第零關之二，連自查都沒跑
s15() { fresh
  printf '\n// 改過一行\n' >> scripts/build-foods.mjs
  probe_commit o "乾淨的一行"
  run_gate; check "15 build 改過沒跑 F8 驗法" 5 same "build-recipes、build-foods 或它們的驗法跟上次全擋時不一樣" "查了："; }

# 16 沒有 F8 驗法的登記檔（新 session、新 clone；或上一次在 HEAD 沒全擋、登記被刪掉）→ 回 5
s16() { fresh
  rm -f .logs/buildguard-verified.txt
  probe_commit p "乾淨的一行"
  run_gate; check "16 沒有 F8 驗法的登記檔" 5 same "沒有 F8 驗法的登記檔" "查了："; }

# 7 全部正常 → 推上去、假遠端＝本機
s7() { fresh
  probe_commit g "乾淨的一行"
  run_gate; check "7 全部正常" 0 local "已推送" "擋下"; }

ALL="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16"
ORDER="${PUSHGATE_VERIFY_ORDER:-1 2 3 4 5 6 8 9 10 11 12 13 14 15 16 7}"
# 順序清單要恰好是 16 種、每種一次：少了幾種還說「全部符合」，就是另一種假驗證
if [ "$(printf '%s\n' $ORDER | sort -n | tr '\n' ' ')" != "$(printf '%s\n' $ALL | sort -n | tr '\n' ' ')" ]; then
  echo "閘門驗法：順序清單不是恰好 16 種各一次（$ORDER）"; rm -f "$SRC/.logs/pushgate-verified.txt"; exit 1
fi
echo "順序：$ORDER"
for n in $ORDER; do "s$n"; done
fresh

# 登記：全部通過才寫主 repo 的登記檔（登記的是驗過的那一版＝已 commit 的內容）；有任何一種不符就刪掉，閘門擋下推送
REGSRC="$SRC/.logs/pushgate-verified.txt"
if [ "$FAIL" -ne 0 ]; then rm -f "$REGSRC"; echo "閘門驗法：有不符合的情境（已刪掉登記，閘門會擋下推送）"; exit 1; fi
out=""
for f in $GATE_FILES; do
  h="$(git -C "$SRC" rev-parse "HEAD:$f" 2>/dev/null)"
  if [ -z "$h" ]; then rm -f "$REGSRC"; echo "閘門驗法：讀不到 $f 已 commit 的版本，不登記"; exit 1; fi
  out="${out}${f} ${h}"$'\n'
done
mkdir -p "$SRC/.logs"; printf '%s' "$out" > "$REGSRC"
echo "閘門驗法：$N 種全部符合（已登記三支檔案的雜湊）"
exit 0
