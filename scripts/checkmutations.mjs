// 只做一件事：把 mutationtest.mjs 裡每一條突變的 find 字串拿去目標檔案數一次。
// 剛好一次才算有效；0 次＝過期（程式改了、突變沒跟上），≥2 次＝改到不只一個地方。
// 給 assertaudit 呼叫，也可以自己跑：`node scripts/checkmutations.mjs`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const src = fs.readFileSync(path.join(ROOT, 'scripts/mutationtest.mjs'), 'utf8');

// 把 MUTATIONS 陣列整段抽出來當成模組求值（它只是字面資料，沒有副作用）
const start = src.indexOf('const MUTATIONS = [');
const end = src.indexOf('\n];', start);
if (start < 0 || end < 0) { console.log('STALE 找不到 MUTATIONS 陣列'); process.exit(1); }
const literal = src.slice(start + 'const MUTATIONS = '.length, end + 2);
// eslint-disable-next-line no-new-func
const MUTATIONS = new Function(`return ${literal};`)();

let stale = 0;
for (const m of MUTATIONS) {
  const file = path.join(ROOT, m.file);
  if (!fs.existsSync(file)) { console.log(`STALE ${m.name}：找不到檔案 ${m.file}`); stale += 1; continue; }
  const body = fs.readFileSync(file, 'utf8');
  const n = body.split(m.find).length - 1;
  if (n !== 1) { console.log(`STALE ${m.name}（${m.file}）：find 出現 ${n} 次`); stale += 1; }
  if (m.find === m.replace) { console.log(`STALE ${m.name}：find 與 replace 一模一樣，改了等於沒改`); stale += 1; }
  const testFile = path.join(ROOT, 'scripts', `${m.test}.mjs`);
  if (!fs.existsSync(testFile)) { console.log(`STALE ${m.name}：指定的測試 ${m.test} 不存在`); stale += 1; }
}
console.log(`TOTAL ${MUTATIONS.length}`);
console.log(`STALECOUNT ${stale}`);
