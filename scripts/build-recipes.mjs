// 把 data/recipes/*.json 驗證、正規化後合併成 data/recipes.json（npm run build-recipes）。
//
// 每一道都過 js/recipeschema.js 的 validateRecipe：食材解析到食藥署編號、克數 > 0、
// 步驟 ≥ 3、素葷分流的結構與順序、葷食材不准出現在素的菜或素的軌。
// 任何一道有錯 → 不寫檔、exit 1。recipetest 會確認 data/recipes.json 跟現在重建的一模一樣
// （改了食譜忘了 build 就會紅）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecipe } from '../js/recipeschema.js';
import { indexFoods, resolveFood } from '../js/foods.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_DIR = path.join(ROOT, 'data/recipes');
const OUT = path.join(ROOT, 'data/recipes.json');

export function loadContext() {
  const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
  const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
  const foodtags = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foodtags.json'), 'utf8'));
  // 標籤也掛進索引（2026-09-21）：App 端的 idx 帶 foodTags，這裡不帶的話，用 loadContext 的測試看到的索引跟 App 不一樣
  const idx = indexFoods(foods, aliases, foodtags.tags);
  return { idx, foodsVersion: foods.version, ctx: { resolve: (t) => resolveFood(t, idx), foodTags: foodtags.tags } };
}

/** 讀一個資料夾的食譜、逐道驗證。回 { recipes（正規化、依 id 排序）, errors: [{file, errors}] } */
export function buildRecipes(dir, ctx) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const recipes = [];
  const errors = [];
  const ids = new Set();
  for (const f of files) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { errors.push({ file: f, errors: [`JSON 壞掉：${e.message}`] }); continue; }
    const { errors: errs, recipe } = validateRecipe(raw, ctx);
    if (raw?.id && f !== `${raw.id}.json`) errs.push(`檔名 ${f} 跟 id ${raw.id} 對不起來`);
    if (raw?.id && ids.has(raw.id)) errs.push(`id 重複：${raw.id}`);
    if (raw?.id) ids.add(raw.id);
    if (errs.length) errors.push({ file: f, errors: errs });
    else recipes.push(recipe);
  }
  recipes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { recipes, errors };
}

export function summarize(recipes) {
  const by = (key) => recipes.reduce((m, r) => { m[r[key]] = (m[r[key]] ?? 0) + 1; return m; }, {});
  return { count: recipes.length, roles: by('role'), vegModes: by('vegMode'), textures: by('texture') };
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 輸出物件（不含會每天變的欄位，recipetest 才能比對「重建後一模一樣」）。 */
export function outputFor(recipes, foodsVersion) {
  return { foodsVersion, count: recipes.length, recipes };
}

/**
 * 寫檔之前的整體檢查（v9 F8，2026-09-24）：回問題清單，每一條點名是哪一道、哪一種狀況；沒問題回 []。
 * 以前食譜資料夾清空時照樣回 0、印「✓ 0 道食譜」，把 recipes.json 改寫成 0 道；刪掉一道也照寫、少一道。
 * · 0 道 → 停。
 * · 資料變少也停：上一版（現有的 recipes.json）有、這次沒有的，逐道點名。真的要刪就加 --allow-shrink。
 */
export function outputProblems(recipes, prev, { allowShrink = false } = {}) {
  const out = [];
  if (recipes.length === 0) out.push('一道食譜都沒有（0 道）：data/recipes/ 是空的？');
  if (!allowShrink && prev && Array.isArray(prev.recipes)) {
    const now = new Set(recipes.map((r) => r.id));
    for (const r of prev.recipes) {
      if (!now.has(r.id)) out.push(`少了 ${r.id}（${r.name}）：上一版有、這次沒有——真的要刪就加 --allow-shrink`);
    }
  }
  return out;
}

/**
 * 先寫暫存檔、成功才換上（v9 F8）；寫失敗也要點名、不能中斷（2026-09-24 補充說明四）。
 * · 只清自己寫出來的暫存檔：寫都沒寫成（例如那個位置本來就有同名資料夾、或被防毒鎖住），就不碰它——
 *   以前不管有沒有寫成都去刪，刪不掉就在 catch 裡再丟一次例外，吐出堆疊、設計好的理由印不出來。
 * · 清理本身失敗也不中斷：把「暫存檔刪不掉、留在哪裡」一起點名，照樣走 stop()。
 */
export function writeAtomically(out, text, stop, fsx = fs) {
  const tmp = `${out}.tmp`;
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  let wrote = false;
  try { fsx.writeFileSync(tmp, text, 'utf8'); wrote = true; fsx.renameSync(tmp, out); }
  catch (e) {
    const lines = [`寫 ${rel(out)} 失敗：${e.message}`];
    if (wrote) {
      try { fsx.rmSync(tmp, { force: true }); }
      catch (e2) { lines.push(`暫存檔 ${rel(tmp)} 刪不掉、留在原地：${e2.message}`); }
    } else if (fsx.existsSync(tmp)) {
      lines.push(`${rel(tmp)} 那個位置已經有東西（不是這次寫的，沒有動它）`);
    }
    stop(lines);
  }
}

if (process.argv[1] && process.argv[1].endsWith('build-recipes.mjs')) {
  const stop = (lines) => { console.error('✗ 沒有寫檔：'); for (const l of lines) console.error(`  - ${l}`); process.exit(1); };
  // 每一個輸入都要在：讀不到就點名是哪一個，不要丟一串 ENOENT
  for (const rel of ['data/recipes', 'data/foods.json', 'data/aliases.json', 'data/foodtags.json']) {
    if (!fs.existsSync(path.join(ROOT, rel))) stop([`${rel} 不存在`]);
  }
  const { ctx, foodsVersion } = loadContext();
  const { recipes, errors } = buildRecipes(SRC_DIR, ctx);
  if (errors.length) {
    console.error(`✗ ${errors.length} 道食譜有問題，沒有寫檔：`);
    for (const e of errors) console.error(`  ${e.file}\n    - ${e.errors.join('\n    - ')}`);
    process.exit(1);
  }
  let prev = null;
  if (fs.existsSync(OUT)) {
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { stop([`現有的 ${path.relative(ROOT, OUT)} 讀不出來，比不了「有沒有變少」`]); }
  }
  const problems = outputProblems(recipes, prev, { allowShrink: process.argv.includes('--allow-shrink') });
  if (problems.length) stop(problems);
  // 先寫暫存檔，成功才換上：寫到一半失敗不會留下半份 recipes.json
  const out = { ...outputFor(recipes, foodsVersion), generatedAt: today() };
  writeAtomically(OUT, JSON.stringify(out), stop);
  const s = summarize(recipes);
  console.log(`✓ ${s.count} 道食譜 → ${path.relative(ROOT, OUT)} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
  console.log('  角色', s.roles);
  console.log('  素葷', s.vegModes);
  console.log('  質地', s.textures);
}
