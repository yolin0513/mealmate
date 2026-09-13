// 文案禁用詞掃描（npm run copytest）—— 這個 App 的第一條紅線（PLAN §1.2 第 5 點）。
//
// 掃 index.html、js/ 所有字串字面值、data/ 裡的文字（食譜、衛教引用、別名與單位表的說明）。
// 母體要夠大（不然等於沒掃），而且判準本身要有對照組（不然一個「永遠回 false」的判準也全過）。
// 不掃 data/foods.json：那是食藥署的資料，不是我們的文案。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, section, done, noneOf, detects, note } from './tap.mjs';
import { stripComments } from './srcscan.mjs';
import { FORBIDDEN as WORDS, forbiddenIn as scan } from './copyrules.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// 判準搬到 scripts/copyrules.mjs，跟 redlinetest（掃畫面上渲染出來的字）共用同一份清單，
// 兩邊才不會各自維護一份而漂開。
export { FORBIDDEN, forbiddenIn } from './copyrules.mjs';

/** JS 原始碼裡的字串字面值（去掉註解之後）。 */
export function stringLiterals(source) {
  const src = stripComments(source);
  const out = [];
  for (const m of src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
    const lit = m[0].slice(1, -1);
    if (lit.trim()) out.push(lit);
  }
  return out;
}

/** JSON 裡所有字串值（遞迴；不含 key）。 */
export function jsonStrings(value, out = []) {
  if (typeof value === 'string') { if (value.trim()) out.push(value); }
  else if (Array.isArray(value)) value.forEach((v) => jsonStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => jsonStrings(v, out));
  return out;
}

/** HTML 裡看得到的文字與幾個會顯示的屬性。 */
export function htmlStrings(html) {
  const out = [];
  for (const m of html.matchAll(/>([^<>]+)</g)) if (m[1].trim()) out.push(m[1].trim());
  for (const m of html.matchAll(/(?:content|aria-label|placeholder|title|alt)="([^"]+)"/g)) out.push(m[1]);
  return out;
}

const corpus = [];
const add = (file, strings) => strings.forEach((s) => corpus.push({ file, s }));

add('index.html', htmlStrings(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
add('manifest.webmanifest', jsonStrings(JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'))));
for (const d of ['js', 'js/views']) {
  for (const f of fs.readdirSync(path.join(ROOT, d)).filter((x) => x.endsWith('.js'))) {
    add(`${d}/${f}`, stringLiterals(fs.readFileSync(path.join(ROOT, d, f), 'utf8')));
  }
}
for (const f of ['data/edu.json', 'data/aliases.json', 'data/units.json', 'data/foodtags.json']) {
  add(f, jsonStrings(JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
}
const recipeDir = path.join(ROOT, 'data/recipes');
for (const f of fs.readdirSync(recipeDir).filter((x) => x.endsWith('.json'))) {
  add(`data/recipes/${f}`, jsonStrings(JSON.parse(fs.readFileSync(path.join(recipeDir, f), 'utf8'))));
}

section('母體');
ok(corpus.length >= 1500, `掃了 ${corpus.length} 個字串（≥ 1,500）`);
const files = new Set(corpus.map((c) => c.file));
ok(files.size >= 40, `來自 ${files.size} 個檔案`);
ok(corpus.some((c) => c.file.startsWith('js/views/')), '有掃到畫面文案');
ok(corpus.some((c) => c.file.startsWith('data/recipes/')), '有掃到食譜文字');
ok(corpus.some((c) => c.file === 'data/edu.json'), '有掃到衛教引用');
note(`禁用詞 ${WORDS.length} 個：${WORDS.join("、")}`);

section('沒有任何禁用詞');
noneOf(corpus, (c) => scan(c.s).length > 0, '所有文案、食譜、衛教引用都不含禁用詞');

section('判準本身的對照組');
detects((s) => scan(s).length > 0, {
  shouldHit: ['有助控制血糖', '這道菜可以治療感冒', '糖尿病專用餐', '每日建議攝取 2000 大卡', '低鹽有降血壓的療效', '可取代醫囑', '保證有效'],
  shouldMiss: ['低醣', '留意鈉', '鉀較低', '估 42 g', '建議選擇當季盛產的蔬菜', '請以醫師或營養師的指示為準', '不是醫囑', '減糖'],
}, '禁用詞判準：抓得到療效與處方式的句子，不會誤抓「低醣」「留意鈉」「建議選擇當季」');

done('copytest');
