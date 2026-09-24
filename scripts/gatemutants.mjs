// 推送閘門的突變驗法（2026-09-24；Dispatch：「證據裡實跑過」不等於「有常設情境守著」）。
// 以前這些突變是 session 暫存區裡的一次性腳本，session 一沒了就不能重跑；收進 repo，改過閘門就跟 pushgate-verify 一起跑。
//
// 每一條：在 repo 外的拋棄式 worktree 把 scripts/pushgate.sh 改壞一處、commit → 確認跑到的是改壞的那一版 → 跑閘門驗法 →
// 比對「不符合的是哪幾種」要恰好等於預期（多紅、少紅、紅錯地方都算不如預期）。對照（原樣）要全部符合。
// 用法（在 repo 根目錄，閘門改完先 commit）：node scripts/gatemutants.mjs。全部如預期回 0，否則回 1。
// 耗時：每一條跑一次整套閘門驗法（約 30–60 秒），共 5 條。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** { label, find（null＝對照）, replace, expect: 預期不符合的情境編號（由小到大） } */
export const CASES = [
  { label: '對照：原樣', find: null, replace: null, expect: [] },
  { label: '拿掉第零關之二（F8 驗法登記）整段', find: 'BLOCK_0B', replace: '', expect: ['15', '16', '17', '18', '19'] },
  { label: '不管有沒有動到都看登記（新 clone 一律要先跑）', find: 'if [ -z "$bgtouched" ]; then', replace: 'if false; then', expect: ['17'] },
  { label: '比工作區、不比已 commit 版本', find: 'h="$(git rev-parse "HEAD:$f" 2>/dev/null)"', replace: 'h="$(git hash-object "$f" 2>/dev/null)"', expect: ['18'] },
  { label: '只看最後一個 commit 的檔名', find: 'git log --format= --name-only "$REMOTE/main..HEAD"', replace: 'git log -1 --format= --name-only HEAD', expect: ['19'] },
];
const B0_START = '# 第零關之二：F8 驗法登記';
const B0_END = 'node scripts/selfcheck.mjs "$REMOTE" > "$LOG" 2>&1';

/** 從閘門驗法的輸出抽出「不符合」的情境編號與總種數（擷取本身的對照組在 main 裡先跑） */
export function verdictsOf(out) {
  const lines = String(out).split('\n').filter((l) => /｜(不)?符合$/.test(l));
  return { total: lines.length, bad: lines.filter((l) => l.endsWith('｜不符合')).map((l) => l.split(' ')[0]).sort((a, b) => a - b) };
}

export function mutate(src, c) {
  if (c.find === 'BLOCK_0B') {
    const a = src.indexOf(B0_START), b = src.indexOf(B0_END);
    if (a < 0 || b < a || src.split(B0_START).length !== 2) return null;
    return src.slice(0, a) + src.slice(b);
  }
  if (src.split(c.find).length !== 2) return null;
  return src.replace(c.find, () => c.replace);
}

function main() {
  // 擷取的對照組：抓空的話，「不符合的恰好是預期那幾種」會退化成永遠「沒有不符合」
  const sample = '15 動到 build｜回傳 0（預期 5）｜假遠端 a → a（預期 same）｜不符合\n7 全部正常｜回傳 0（預期 0）｜假遠端 a → b（預期 local）｜符合\n閘門驗法：…';
  const sv = verdictsOf(sample);
  if (sv.total !== 2 || sv.bad.join(',') !== '15') { console.log('gatemutants：擷取的對照組不對（檢查器壞了），不往下跑'); return 1; }
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const origHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let bad = 0; let expectedTotal = null;
  for (const c of CASES) {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatemut-'));
    fs.rmSync(wt, { recursive: true });
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', wt, 'HEAD']);
    try {
      let head = origHead;
      if (c.find !== null) {
        const f = path.join(wt, 'scripts/pushgate.sh');
        const src = fs.readFileSync(f, 'utf8');
        const out = mutate(src, c);
        if (out === null) { console.log(`【${c.label}】錨點不是剛好一次（閘門改過了？更新這一條）｜不如預期`); bad += 1; continue; }
        fs.writeFileSync(f, out);
        execFileSync('git', ['-C', wt, '-c', 'user.name=probe', '-c', 'user.email=probe@users.noreply.github.com', 'commit', '-q', '-am', `mutant: ${c.label}`]);
        head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const committed = execFileSync('git', ['-C', wt, 'show', 'HEAD:scripts/pushgate.sh'], { encoding: 'utf8' });
        if (head === origHead || committed !== out) { console.log(`【${c.label}】跑到的不是改壞的那一版｜不如預期`); bad += 1; continue; }
      }
      const r = spawnSync('bash', ['scripts/pushgate-verify.sh'], { cwd: wt, encoding: 'utf8' });
      const v = verdictsOf(r.stdout + r.stderr);
      if (c.find === null) expectedTotal = v.total;
      const ok = v.total > 0 && v.total === expectedTotal && v.bad.join(',') === c.expect.join(',');
      if (!ok) bad += 1;
      console.log(`【${c.label}】HEAD ${head.slice(0, 7)}｜${v.total} 種、不符合：${v.bad.join('、') || '無'}（預期：${c.expect.join('、') || '無'}）｜${ok ? '如預期' : '不如預期'}`);
    } finally {
      execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]);
    }
  }
  console.log(bad ? `gatemutants：${bad} 條不如預期` : `gatemutants：${CASES.length} 條全部如預期（對照 ${expectedTotal} 種全部符合；每一條突變只紅在預期的那幾種）`);
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
