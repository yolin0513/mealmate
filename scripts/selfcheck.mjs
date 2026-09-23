// 公開前自查（共用慣例 §2.4、§2.5 第一關）：查「所有還沒推上去的 commit」（<遠端>/main..HEAD）的新增行。
// 用法：node scripts/selfcheck.mjs [遠端名，預設 origin]。由 scripts/pushgate.sh 呼叫；也可以單獨跑。
// 回傳值：通過 0；有命中、任何一類的對照組沒命中（檢查器壞了）、沒有新增行可查、或丟例外 → 非 0。
// 推送那一行要用回傳值擋，不要接管線（`… | tail -1 && git push` 的回傳值是 tail 的，失敗會被吞掉）。
// 沒有不能公開的樣式或黑名單：使用者名稱執行時從環境變數取，email 的對照組是當場組出來的，都不寫進任何檔。
// 路徑照附錄 A：磁碟機開頭的路徑、帶使用者名稱的家目錄路徑擋；用 ~、$HOME 寫的泛稱不擋。
import { execFileSync } from 'node:child_process';

const remote = process.argv[2] || 'origin';
const diff = execFileSync('git', ['-c', 'core.quotepath=off', 'log', '-p', `${remote}/main..HEAD`, '--format=', '-U0'], { encoding: 'utf8' });
const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
const user = process.env.USERNAME || process.env.USER || '';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const checks = {
  金鑰或token: /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,})/i,
  email: { test: (s) => (s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).some((m) => !/@(users\.noreply\.github\.com|anthropic\.com)$/i.test(m)) },
  本機使用者名稱: user ? new RegExp(esc(user), 'i') : { test: () => { throw new Error('取不到使用者名稱'); } },
  磁碟機或家目錄路徑: /(\b[A-Za-z]:[\\/]|\/(Users|home)\/[^\s/]+)/,
};
// 對照組：當下組出來的合成樣本，跑的是同一個檢查（共用慣例 §5.3）；不寫進任何檔
const fakeMail = ['someone', 'example-mail.test'].join('@');
const controls = {
  金鑰或token: ['ghp_' + 'A'.repeat(30)],
  email: [fakeMail],
  本機使用者名稱: ['path ' + user + ' here'],
  磁碟機或家目錄路徑: ['E:' + '\\' + 'Foo', '/' + 'home' + '/someone/x'],
};
let ok = true;
console.log('新增行數：', added.length);
for (const [name, re] of Object.entries(checks)) {
  const ctl = controls[name].every((c) => re.test(c));
  const hits = added.filter((l) => re.test(l)).length;
  console.log(`${name}：對照組命中=${ctl}，新增行命中=${hits}`);
  if (!ctl || hits) ok = false;
}
// 泛稱路徑不該被擋（附錄 A：~、$HOME 不算）——反向的對照：擋了就是樣式寫太寬
const generic = '~' + '/.cache/x';
if (checks.磁碟機或家目錄路徑.test(generic)) { console.log('磁碟機或家目錄路徑：連泛稱路徑也擋（樣式太寬）'); ok = false; }
console.log(ok ? '自查通過' : '自查不通過');
if (!ok) process.exitCode = 1;
if (added.length === 0) { console.log('新增行數是 0：沒有東西可查，當成失敗（避免查錯範圍還顯示通過）'); process.exitCode = 1; }
