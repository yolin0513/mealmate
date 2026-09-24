#!/usr/bin/env bash
# 推送閘門的驗法（共用慣例 §2.5）：用實際推送的那一支 scripts/pushgate.sh，分別製造每一關的失敗。
# 完全不碰 GitHub：在暫存目錄建 bare repo 當假遠端，複製本 repo **已 commit 的內容**過去（閘門要先 commit 才驗得到）。
# 用法（在 repo 根目錄）：bash scripts/pushgate-verify.sh。全部符合回傳 0；任何一種不符合回傳 1。
set -u
# 驗法自己也用 git：執行環境裡有 GIT_ 開頭的變數（放行清單以外、不分大小寫）就不跑（同閘門的入口檢查）
VERIFY_GIT_ALLOW=" GIT_EDITOR GIT_SEQUENCE_EDITOR GIT_PAGER "
for v in $(compgen -e); do
  u="${v^^}"
  case "$u" in GIT_*) case "$VERIFY_GIT_ALLOW" in *" $u "*) ;; *) echo "閘門驗法：執行環境裡有 $v（git 自己認得 GIT_ 開頭的變數），先 unset 再跑"; exit 1;; esac;; esac
done
# 第 23 種拿來打閘門的清單（另一份獨立的清單）：改指 repo 或設定的，外加列舉寫法漏掉的 GIT_EXEC_PATH
GIT_ENV_EXPECT="GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_CEILING_DIRECTORIES GIT_DISCOVERY_ACROSS_FILESYSTEM GIT_NAMESPACE GIT_REPLACE_REF_BASE GIT_CONFIG GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_EXEC_PATH"
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
# 第零關之二（F8 驗法登記）：複本裡同樣登記三支的「已 commit 版本」（閘門比的是 HEAD 裡的），才走得到後面的關卡；第 15–20 種專驗這一關
BG_FILES="scripts/build-recipes.mjs scripts/build-foods.mjs scripts/buildguard-verify.mjs"
register_bg() { local out="" f; for f in $BG_FILES; do out="${out}${f} $(git rev-parse "HEAD:$f")"$'\n'; done; printf '%s' "$out" > .logs/buildguard-verified.txt; }
# 一個動到被守的檔的 commit（build-foods 多一行註解）
touch_guarded() { printf '\n// 改過一行（%s）\n' "$1" >> scripts/build-foods.mjs; git add scripts/build-foods.mjs; git commit -q -m "probe $1：動到 build-foods"; }
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
  git commit -q -m "probe j" --author="someone <$(printf '%s@%s' someone example-mail.test)>"
  AE="$(git log -1 --format=%ae)"; CE="$(git log -1 --format=%ce)"
  if precondition "10 只有作者信箱是一般信箱" '[ "${AE%noreply.github.com}" = "$AE" ] && [ "${CE%noreply.github.com}" != "$CE" ]' "作者要是一般信箱、提交者要是 noreply（作者 ${AE%%@*}@…、提交者 ${CE%%@*}@…）"; then
    run_gate; check "10 只有作者信箱是一般信箱" 1 same "來源：commit 訊息或作者欄" "已推送"
  fi; }

# 24 只有提交者信箱是一般信箱（作者是 noreply；例如 rebase 別人的 commit、用 --author 代填）→ 同樣擋在自查
s24() { fresh
  printf '乾淨的一行\n' > docs/x.md; git add docs/x.md
  git -c user.name=someone -c user.email="$(printf '%s@%s' someone example-mail.test)" commit -q -m "probe x" --author="probe <probe@users.noreply.github.com>"
  AE="$(git log -1 --format=%ae)"; CE="$(git log -1 --format=%ce)"
  if precondition "24 只有提交者信箱是一般信箱" '[ "${AE%noreply.github.com}" != "$AE" ] && [ "${CE%noreply.github.com}" = "$CE" ]' "作者要是 noreply、提交者要是一般信箱（作者 ${AE%%@*}@…、提交者 ${CE%%@*}@…）"; then
    run_gate; check "24 只有提交者信箱是一般信箱" 1 same "來源：commit 訊息或作者欄" "已推送"
  fi; }

# 11 一行以 ++ 開頭的命中：在一個 commit 加進去、下一個 commit 刪掉（只存在於新增行裡）→ 擋在自查，理由指到「新增行」
s11() { fresh
  printf '++ contact: %s\n' "$(printf '%s@%s' tester example-mail.test)" > docs/k.md; git add docs/k.md; git commit -q -m "probe k add"
  git rm -q docs/k.md; git commit -q -m "probe k remove"
  # 先寫檔再數，不接管線（M4，統籌者 2026-09-24 裁示：不設永久例外）：取 diff 失敗就明講，不靠「數到 0 行≠3」間接擋下
  # 取不到 diff 這條失敗路徑：scripts/gatemutants.mjs 用 PATH 最前面的假 git 觸發（F10：不在正式程式留後門）
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

# 15 要推的 commit 動到 build、還沒在 HEAD 跑過 F8 驗法（登記對不上）→ 回 5，停在第零關之二，連自查都沒跑
s15() { fresh
  touch_guarded o
  run_gate; check "15 動到 build 沒跑 F8 驗法" 5 same "跟上次在 HEAD 全擋時不一樣" "查了："; }

# 16 要推的 commit 動到 build、而且沒有 F8 驗法的登記檔 → 回 5
s16() { fresh
  rm -f .logs/buildguard-verified.txt
  touch_guarded p
  run_gate; check "16 動到 build、沒有登記檔" 5 same "卻沒有 F8 驗法的登記檔" "查了："; }

# 17 新 clone（沒有 F8 驗法的登記檔）推一個沒碰被守的檔的 commit → 照推（F9 第 2 點：不必一律先跑 7 分鐘）
s17() { fresh
  rm -f .logs/buildguard-verified.txt
  probe_commit q "乾淨的一行"
  run_gate; check "17 沒動到 build、沒有登記檔" 0 local "沒動到被守的三支" "擋下"; }

# 18 登記的是已 commit 版本：動到 build 的 commit 登記過了，工作區另有一行沒 commit 的改動（不會被推）→ 照推
s18() { fresh
  touch_guarded r
  register_bg
  printf '\n// 沒 commit 的改動\n' >> scripts/build-foods.mjs
  run_gate; check "18 登記的是已 commit 版本" 0 local "登記對得上" "擋下"; }

# 19 動到 build 的是前一個 commit、最後一個 commit 是乾淨的 → 照樣回 5（要逐個 commit 看，不能只看最後一個）
s19() { fresh
  touch_guarded s
  probe_commit s2 "乾淨的一行"
  run_gate; check "19 前一個 commit 動到 build" 5 same "跟上次在 HEAD 全擋時不一樣" "查了："; }

# 20 取不到這次要推的檔名清單（git log --name-only 失敗）→ 回 5，不是當成「沒動到」放行
#    假的 git 放在 PATH 最前面：遇到 --name-only 就失敗，其他指令轉給真的 git（閘門是 bash，照 PATH 找 git）
s20() { fresh
  local real; real="$(command -v git)"
  mkdir -p "$T/fakegit"
  printf '#!/usr/bin/env bash\nfor a in "$@"; do if [ "$a" = --name-only ]; then echo "fake git：故意失敗" >&2; exit 128; fi; done\nexec "%s" "$@"\n' "$real" > "$T/fakegit/git"
  chmod +x "$T/fakegit/git"
  probe_commit t "乾淨的一行"
  FAKEHEAD="$(PATH="$T/fakegit:$PATH" git rev-parse HEAD 2>/dev/null)"
  FAKELOG="$(PATH="$T/fakegit:$PATH" git log -1 --format=%H HEAD 2>/dev/null)"
  if precondition "20 取不到檔名清單" '! PATH="$T/fakegit:$PATH" git log -1 --format= --name-only HEAD >/dev/null 2>&1 && [ "$FAKEHEAD" = "$(git rev-parse HEAD)" ] && [ "$FAKELOG" = "$(git rev-parse HEAD)" ]' "假的 git：--name-only 要失敗；不相干的 rev-parse（得到 $FAKEHEAD）、同一個 log 子指令不帶 --name-only（得到 $FAKELOG）都要照常"; then
    BEFORE="$(remote_main)"; PATH="$T/fakegit:$PATH" bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
    check "20 取不到檔名清單" 5 same "取不到這次要推的檔名清單" "查了："
  fi; }

# 假的 git（F10）：參數裡出現指定的子指令就失敗，其他交給真的 git。放在 PATH 最前面，閘門（bash）照 PATH 找到它
fake_git_on() { local word="$1" real; real="$(command -v git)"; mkdir -p "$T/fake-$word"
  printf '#!/usr/bin/env bash\nfor a in "$@"; do if [ "$a" = "%s" ]; then echo "fake git：故意失敗（%s）" >&2; exit 128; fi; done\nexec "%s" "$@"\n' "$word" "$word" "$real" > "$T/fake-$word/git"
  chmod +x "$T/fake-$word/git"; }
# 假的 git 自己的對照組：指定的子指令必須失敗；不相干的 rev-parse、log 必須照常
fake_ok() { local word="$1" cmd="$2" h l; h="$(PATH="$T/fake-$word:$PATH" git rev-parse HEAD 2>/dev/null)"; l="$(PATH="$T/fake-$word:$PATH" git log -1 --format=%H HEAD 2>/dev/null)"
  ! PATH="$T/fake-$word:$PATH" eval "$cmd" >/dev/null 2>&1 && [ "$h" = "$(git rev-parse HEAD)" ] && [ "$l" = "$h" ]; }

# 21 讀不到遠端（git fetch 失敗）→ 擋在自查那一關（回 1）、理由「讀不到遠端」，不推
s21() { fresh
  fake_git_on fetch
  probe_commit u "乾淨的一行"
  if precondition "21 讀不到遠端" 'fake_ok fetch "git fetch -q origin main"' "假的 git：fetch 要失敗；rev-parse、log 要照常"; then
    BEFORE="$(remote_main)"; PATH="$T/fake-fetch:$PATH" bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
    check "21 讀不到遠端" 1 same "讀不到遠端，自查的範圍不確定" "已推送"
  fi; }

# 22 推上去之後問不到遠端的 main（git ls-remote 失敗）→ 回 3、講明「讀不到」，不印「已推送」
s22() { fresh
  fake_git_on ls-remote
  probe_commit v "乾淨的一行"
  if precondition "22 問不到遠端的 main" 'fake_ok ls-remote "git ls-remote origin refs/heads/main"' "假的 git：ls-remote 要失敗；rev-parse、log 要照常"; then
    BEFORE="$(remote_main)"; PATH="$T/fake-ls-remote:$PATH" bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
    check "22 問不到遠端的 main" 3 local "遠端 main=（讀不到）" "已推送"
  fi; }

# 23 執行環境裡有 git 自己認得的變數（GIT_DIR 之類）→ 閘門在任何 git 呼叫之前就停（回 6）、點名那個變數，不跑自查、不推
#    清單裡每一個逐一設定（指向不存在的地方）各跑一次；另加「GIT_DIR 設成空字串」也要擋。對照（沒設要放行）是第 7 種
s23() { fresh
  probe_commit w "乾淨的一行"
  BEFORE="$(remote_main)"; : > "$T/out"; RC=6; local v r n=0
  for v in $GIT_ENV_EXPECT; do
    n=$((n + 1))
    env "$v=$T/no-such-place" bash scripts/pushgate.sh > "$T/out1" 2>&1; r=$?
    cat "$T/out1" >> "$T/out"
    if [ "$r" != 6 ] || ! grep -q -- "【擋下：執行環境】$v 有設定" "$T/out1"; then RC="$r"; echo "23｜$v 沒擋下（回傳 $r）" >> "$T/out"; fi
  done
  env GIT_DIR= bash scripts/pushgate.sh > "$T/out1" 2>&1; r=$?
  cat "$T/out1" >> "$T/out"
  if [ "$r" != 6 ]; then RC="$r"; echo "23｜GIT_DIR 設成空字串沒擋下（回傳 $r）" >> "$T/out"; fi
  env git_dir="$T/no-such-place" bash scripts/pushgate.sh > "$T/out1" 2>&1; r=$?
  cat "$T/out1" >> "$T/out"
  if [ "$r" != 6 ] || ! grep -q -- "【擋下：執行環境】git_dir 有設定" "$T/out1"; then RC="$r"; echo "23｜小寫的 git_dir 沒擋下（回傳 $r）" >> "$T/out"; fi
  if precondition "23 執行環境有 git 自己認得的變數" '[ "$n" -ge 16 ]' "清單要逐一打過（實際 $n 個）"; then
    check "23 執行環境有 git 自己認得的變數" 6 same "【擋下：執行環境】" "查了："
  fi; }

# 25 不該攔的不攔：放行清單裡的（GIT_EDITOR、GIT_SEQUENCE_EDITOR、GIT_PAGER）、以及只是長得像的（GITHUB_ACTIONS）→ 照常推上去
s25() { fresh
  probe_commit y "乾淨的一行"
  BEFORE="$(remote_main)"; env GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_PAGER=cat GITHUB_ACTIONS=true bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
  check "25 不該攔的不攔" 0 local "已推送" "擋下"; }

# 7 全部正常 → 推上去、假遠端＝本機
s7() { fresh
  probe_commit g "乾淨的一行"
  run_gate; check "7 全部正常" 0 local "已推送" "擋下"; }

ALL="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25"
ORDER="${PUSHGATE_VERIFY_ORDER:-1 2 3 4 5 6 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 7}"
# 順序清單要恰好是 25 種、每種一次：少了幾種還說「全部符合」，就是另一種假驗證
if [ "$(printf '%s\n' $ORDER | sort -n | tr '\n' ' ')" != "$(printf '%s\n' $ALL | sort -n | tr '\n' ' ')" ]; then
  echo "閘門驗法：順序清單不是恰好 25 種各一次（$ORDER）"; rm -f "$SRC/.logs/pushgate-verified.txt"; exit 1
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
