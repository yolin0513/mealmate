// 衛教引用（npm run edutest）。
//
// 守的事：edu.json 每筆有來源；逐字引用（quote）真的能在 docs/sources/ 找到原文；
// js/ 裡用到的每個 edu id 都存在。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, detects } from './tap.mjs';
import { stripComments } from './srcscan.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const edu = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/edu.json'), 'utf8'));
const entries = edu.entries;

section('每筆都有來源');
ok(entries.length >= 10, `${entries.length} 筆引用`);
eq(new Set(entries.map((e) => e.id)).size, entries.length, 'id 不重複');
everyOf(entries, (e) => ['quote', 'summary', 'attribution'].includes(e.kind), 'kind 只有 quote／summary／attribution');
everyOf(entries, (e) => typeof e.text === 'string' && e.text.trim().length >= 8, '文字非空');
everyOf(entries, (e) => e.source && typeof e.source.org === 'string' && typeof e.source.title === 'string' && /^https:\/\//.test(e.source.url) && /^\d{4}-\d{2}-\d{2}$/.test(e.source.fetchedAt) && typeof e.source.version === 'string',
  '每筆來源都有機關、標題、https 網址、擷取日、版本');
everyOf(entries, (e) => typeof e.source.file === 'string' && fs.existsSync(path.join(ROOT, e.source.file)), '每筆指到的紀錄檔都存在');

section('逐字引用能在 docs/sources/ 找到原文');
const sourceDir = path.join(ROOT, 'docs/sources');
const corpus = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(sourceDir, f), 'utf8')).join('\n');
ok(corpus.length > 3000, `（母體）docs/sources/ 共 ${corpus.length} 字`);
const quotes = entries.filter((e) => e.kind === 'quote');
ok(quotes.length >= 6, `（母體）${quotes.length} 筆逐字引用`);
const found = (text) => corpus.includes(text);
everyOf(quotes, (e) => found(e.text), '每一筆 quote 的文字都逐字出現在紀錄檔裡');
detects(found, {
  shouldHit: quotes.slice(0, 3).map((e) => e.text),
  shouldMiss: ['每餐都要攝取煮熟後体積比拳頭多一些', '這是一句根本不存在於任何來源的話', quotes[0].text.replace(/。|！/g, '') + '外加尾巴'],
}, '「找得到原文」這個檢查認得出改了一個字、多了尾巴的假引用');

section('js/ 用到的 edu id 都存在');
const ids = new Set(entries.map((e) => e.id));
const files = ['js', 'js/views'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
const used = [];
for (const rel of files) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  for (const m of src.matchAll(/\bedu(?:Text|Node)?\(\s*'([^']+)'\s*\)/g)) used.push({ rel, id: m[1] });
}
ok(used.length >= 2, `（母體）js/ 裡用了 ${used.length} 處衛教引用`);
everyOf(used, (u) => ids.has(u.id), '每一處用到的 id 都在 edu.json 裡');
detects((line) => [...line.matchAll(/\bedu(?:Text|Node)?\(\s*'([^']+)'\s*\)/g)].length > 0, {
  shouldHit: ["eduNode('fda.tfnd.attribution')", "eduText('a.b')", "edu( 'x.y' )"],
  shouldMiss: ["educate('x')", "const edu = 1;", "myedu('x.y')", "eduNode(id)"],
}, '掃描器認得 edu／eduText／eduNode 的呼叫，不會把別的字當成引用');

done('edutest');
