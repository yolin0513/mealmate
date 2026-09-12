// 開發用：查 data/foods.json 裡某個口語詞對應到哪些食藥署條目（npm run build-foods 之後用）。
//
//   node scripts/findfood.mjs 高麗菜 豆腐 "豬 絞肉"
//
// 每個詞印出：精確命中名稱 → 精確命中俗名 → 名稱包含 → 俗名包含，最多幾筆。
// 這支只是幫人建 data/aliases.json 用的，App 本身不用它（App 的搜尋在 js/foods.js）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { foods } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));

const LIMIT = Number(process.env.LIMIT || 6);
const fmt = (f) => `${f.id} ${f.name}${f.state ? `〔${f.state}〕` : ''} ${f.cat}${f.unitWeight ? ` 單位${f.unitWeight}g` : ''}`;

for (const q of process.argv.slice(2)) {
  const exactName = foods.filter((f) => f.name === q);
  const exactAlias = foods.filter((f) => f.name !== q && f.aliases.includes(q));
  const nameHas = foods.filter((f) => f.name !== q && f.name.includes(q));
  const aliasHas = foods.filter((f) => !f.aliases.includes(q) && !f.name.includes(q) && f.aliases.some((a) => a.includes(q)));
  console.log(`\n== ${q}  （名稱精確 ${exactName.length}、俗名精確 ${exactAlias.length}、名稱包含 ${nameHas.length}、俗名包含 ${aliasHas.length}）`);
  for (const [label, list] of [['名', exactName], ['俗', exactAlias], ['名含', nameHas], ['俗含', aliasHas]]) {
    for (const f of list.slice(0, LIMIT)) console.log(`  [${label}] ${fmt(f)}`);
    if (list.length > LIMIT) console.log(`  [${label}] …另 ${list.length - LIMIT} 筆`);
  }
}
