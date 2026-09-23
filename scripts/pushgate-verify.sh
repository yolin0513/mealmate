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
git remote set-url origin "$T/remote.git"
git push -q origin main || exit 1
git config user.name probe
git config user.email probe@users.noreply.github.com

remote_main() { git --git-dir="$T/remote.git" rev-parse main; }
probe_commit() { printf '%s\n' "$2" > "docs/$1.md"; git add "docs/$1.md"; git commit -q -m "probe $1"; }
reset_local() { git reset -q --hard "$(remote_main)"; git checkout -q -- .; }
FAIL=0
# check <名稱> <預期回傳值> <預期遠端：same|local> <輸出裡必須有的字> <輸出裡不能有的字>
check() {
  local name="$1" want="$2" wantRemote="$3" must="$4" mustNot="$5"
  local after; after="$(remote_main)"
  local remoteOk=no
  if [ "$wantRemote" = same ] && [ "$after" = "$BEFORE" ]; then remoteOk=yes; fi
  if [ "$wantRemote" = local ] && [ "$after" = "$(git rev-parse HEAD)" ]; then remoteOk=yes; fi
  local outOk=yes
  grep -q -- "$must" "$T/out" || outOk=no
  if [ -n "$mustNot" ] && grep -q -- "$mustNot" "$T/out"; then outOk=no; fi
  local verdict=符合
  if [ "$RC" != "$want" ] || [ "$remoteOk" != yes ] || [ "$outOk" != yes ]; then verdict=不符合; FAIL=1; fi
  printf '%s｜回傳 %s（預期 %s）｜假遠端 %s → %s（預期 %s）｜%s\n' "$name" "$RC" "$want" "${BEFORE:0:7}" "${after:0:7}" "$wantRemote" "$verdict"
}
run_gate() { BEFORE="$(remote_main)"; bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?; }

# 1 要推的檔有命中：當場組出來的合成 email
probe_commit a "contact: $(printf '%s@%s' tester example-mail.test)"
run_gate; check "1 自查命中" 1 same "擋下：自查" "已推送"; reset_local

# 2 自查的對照組弄壞（email 的對照樣本換成不是 email 的字），內容乾淨
node -e "const fs=require('fs');const f='scripts/selfcheck.mjs';const s=fs.readFileSync(f,'utf8');const a=\"const fakeMail = ['someone', 'example-mail.test'].join('@');\";if(!s.includes(a))process.exit(9);fs.writeFileSync(f,s.replace(a,\"const fakeMail = 'not-an-email';\"))" || { echo "2 對照組：找不到要弄壞的那一行（驗法過期）"; FAIL=1; }
probe_commit b "乾淨的一行"
run_gate; check "2 對照組壞掉" 1 same "對照組命中=false" "已推送"; reset_local

# 3 取不到使用者名稱（自查丟例外）
probe_commit c "乾淨的一行"
BEFORE="$(remote_main)"; USERNAME= USER= bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
check "3 取不到使用者名稱" 1 same "擋下：自查" "已推送"; reset_local

# 4 沒有新 commit
run_gate; check "4 沒有新 commit" 1 same "新增行數是 0" "已推送"

# 5 推送被拒（pre-receive 回傳 1）→ 停在推送，後面的比對沒跑
printf '#!/bin/sh\nexit 1\n' > "$T/remote.git/hooks/pre-receive"; chmod +x "$T/remote.git/hooks/pre-receive"
probe_commit e "乾淨的一行"
run_gate; check "5 推送被拒" 2 same "擋下：推送失敗" "遠端對不上"
rm "$T/remote.git/hooks/pre-receive"; reset_local

# 6 推送回報成功、遠端卻沒更新（post-receive 把 main 退回舊值）→ 停在比對遠端
printf '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && git update-ref refs/heads/main "$old"; done\n' > "$T/remote.git/hooks/post-receive"; chmod +x "$T/remote.git/hooks/post-receive"
probe_commit f "乾淨的一行"
run_gate; check "6 推了沒更新" 3 same "擋下：遠端對不上" "已推送"
rm "$T/remote.git/hooks/post-receive"; reset_local

# 8 本機的追蹤分支跑在遠端前面（例如上一次「推了沒更新」之後），而它指的那個 commit 有命中、從沒真的推上去
#   → 閘門要先 fetch、照遠端的實際狀態算範圍，照樣查到命中、照樣擋
probe_commit h "contact: $(printf '%s@%s' tester example-mail.test)"
git update-ref refs/remotes/origin/main HEAD
probe_commit h2 "乾淨的一行"
run_gate; check "8 追蹤分支過時" 1 same "擋下：自查" "已推送"; reset_local

# 7 全部正常 → 推上去、假遠端＝本機
probe_commit g "乾淨的一行"
run_gate; check "7 全部正常" 0 local "已推送" "擋下"

if [ "$FAIL" -ne 0 ]; then echo "閘門驗法：有不符合的情境"; exit 1; fi
echo "閘門驗法：7 種全部符合"
exit 0
