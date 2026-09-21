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

if (process.argv[1] && process.argv[1].endsWith('build-recipes.mjs')) {
  const { ctx, foodsVersion } = loadContext();
  const { recipes, errors } = buildRecipes(SRC_DIR, ctx);
  if (errors.length) {
    console.error(`✗ ${errors.length} 道食譜有問題，沒有寫檔：`);
    for (const e of errors) console.error(`  ${e.file}\n    - ${e.errors.join('\n    - ')}`);
    process.exit(1);
  }
  const out = { ...outputFor(recipes, foodsVersion), generatedAt: today() };
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
  const s = summarize(recipes);
  console.log(`✓ ${s.count} 道食譜 → ${path.relative(ROOT, OUT)} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
  console.log('  角色', s.roles);
  console.log('  素葷', s.vegModes);
  console.log('  質地', s.textures);
}
