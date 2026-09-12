// 突變測試（npm run mutationtest）—— 沿用 StockDiary 的做法。
//
// 一條「跑得過」的斷言可能根本沒在檢查東西。證明它有用的唯一方法是**把對應的邏輯改壞，看它會不會紅**。
// 對每一條突變：
//   1. 要改的那段程式碼在檔案裡必須**剛好出現一次**（找不到＝突變過期＝失敗，不是略過）
//   2. 改壞、跑指定的測試、確認它**真的失敗**
//   3. 還原，並比對內容與原檔一模一樣
// 開頭先跑一次沒有突變的基準：所有涉及的測試必須是綠的。
//
// ⚠ 執行期間會暫時改寫工作目錄裡的原始碼（改完立刻還原）。跑的時候不要同時編輯檔案、不要並行跑別的測試。
//   `--only <關鍵字>` 只跑名稱／檔名／測試名含關鍵字的那幾條。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, note } from './tap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const MUTATIONS = [
  // ---- 資料轉換 ----
  {
    name: '食藥署原始值為空時輸出 0 而不是 null',
    why: '「資料庫沒有這個值」會變成「這個食材沒有鈉」—— 對長輩來說是一句假話。',
    file: 'scripts/build-foods.mjs',
    find: "  if (s === '') return null;\n  const n = Number(s);",
    replace: "  if (s === '') return 0;\n  const n = Number(s);",
    test: 'datatest',
  },
  {
    name: '每單位重 0 克照抄成 0',
    why: '用 0 去換算「一顆幾克」會除以零或算出 0 顆。',
    file: 'scripts/build-foods.mjs',
    find: 'return Number.isFinite(n) && n > 0 ? n : null;',
    replace: 'return Number.isFinite(n) ? n : null;',
    test: 'datatest',
  },
  {
    name: '同名不同年取樣兩筆都留',
    why: '搜尋會出現兩個「傳統豆腐」，食譜對到哪一筆看運氣。',
    file: 'scripts/build-foods.mjs',
    find: 'if (plainNames.has(base)) { dropped.push(f.id); byId.delete(f.id); continue; }',
    replace: 'if (false) { dropped.push(f.id); byId.delete(f.id); continue; }',
    test: 'datatest',
  },
  {
    name: 'fmtEst(null) 顯示「估 0」',
    why: '「未估算」變成 0，畫面上看起來像真的量過。',
    file: 'js/ui.js',
    find: "  if (n == null || !Number.isFinite(n)) return NOT_ESTIMATED;\n  return `估 ${fmtNum(n, digits)}",
    replace: "  if (n == null || !Number.isFinite(n)) return '估 0';\n  return `估 ${fmtNum(n, digits)}",
    test: 'datatest',
  },
  {
    name: '早餐也吃 14 天不重複的扣分',
    why: '10 道早餐兩週就耗光，每天早餐都被迫「重複」。',
    file: 'js/prefs.js',
    find: 'noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 0 },',
    replace: 'noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 14 },',
    test: 'datatest',
  },
  {
    name: '每日目標偷放一個預設值',
    why: 'App 不替任何人設目標；一個預設醣量就是在替使用者下處方。',
    file: 'js/prefs.js',
    find: '  dailyTargets: {},',
    replace: '  dailyTargets: { carb: 200 },',
    test: 'datatest',
  },
  // ---- 食材解析 ----
  {
    name: '解析不到時退回子字串搜尋',
    why: '搜「豬」會對到馬齒莧（俗名豬母乳）、搜「雞」會對到鷹嘴豆 —— 食譜的營養會是別的東西。',
    file: 'js/foods.js',
    find: "  if (idx.byAlias.has(t)) return idx.byAlias.get(t);\n  return null;\n}",
    replace: "  if (idx.byAlias.has(t)) return idx.byAlias.get(t);\n  return idx.list.find((f) => f.name.includes(t) || f.aliases.some((a) => a.includes(t))) ?? null;\n}",
    test: 'aliastest',
  },
  {
    name: '搜尋把俗名包含排到名稱包含前面',
    why: '搜「豬」前幾筆會是馬齒莧那種東西。',
    file: 'js/foods.js',
    find: "    if (f.name.includes(q)) push(f, 'nameHas');",
    replace: "    if (f.aliases.some((a) => a.includes(q))) push(f, 'aliasHas');",
    test: 'aliastest',
  },
  // ---- 食譜驗證 ----
  {
    name: '食材解析不到不算錯',
    why: '假編號會一路進到 recipes.json，畫面上那個食材永遠沒有營養。',
    file: 'js/recipeschema.js',
    find: '    if (!food) err(`${where} 的 food「${ing?.food}」解析不到食藥署編號`);',
    replace: '    if (false) err(`${where} 的 food「${ing?.food}」解析不到食藥署編號`);',
    test: 'recipetest',
  },
  {
    name: '素的菜放葷食材不算錯',
    why: '「素」標籤變成裝飾，素食成員會被排到有肉的菜。',
    file: 'js/recipeschema.js',
    find: "      if (nonVeg && r.vegMode === 'nativeVeg') err(",
    replace: "      if (false) err(",
    test: 'recipetest',
  },
  {
    name: '可分流的菜葷食材放在 base 軌不算錯',
    why: '素食那鍋會吃到肉 —— 一鍋兩吃的整個前提就沒了。',
    file: 'js/recipeschema.js',
    find: "      if (nonVeg && r.vegMode === 'splittable' && track !== 'meat') err(",
    replace: "      if (false) err(",
    test: 'recipetest',
  },
  {
    name: '步驟只要一步就好',
    why: '「煮熟」一句話也算食譜。',
    file: 'js/recipeschema.js',
    find: 'if (steps.length < 3) err(`步驟至少 3 步，只有 ${steps.length}`);',
    replace: 'if (steps.length < 1) err(`步驟至少 3 步，只有 ${steps.length}`);',
    test: 'recipetest',
  },
  {
    name: 'split 之後還可以有 base 步驟',
    why: '「先盛出素食份」之後才炒共同食材，素食那鍋會漏掉那一步。',
    file: 'js/recipeschema.js',
    find: "        if (s === 'base' && i > splitAt) err(",
    replace: "        if (false) err(",
    test: 'recipetest',
  },
  {
    name: '克數 0 也放行',
    why: '購物清單會列一個 0 克的食材，營養也算不進去。',
    file: 'js/recipeschema.js',
    find: '    if (!isPosNum(ing?.grams)) err(`${where} grams 要 > 0：${ing?.grams}`);',
    replace: '    if (false) err(`${where} grams 要 > 0：${ing?.grams}`);',
    test: 'recipetest',
  },
  {
    name: '缺 split 步驟不算錯',
    why: '可分流的菜沒有「先盛出素食份」這一步，煮菜時間線就沒有分流點。',
    file: 'js/recipeschema.js',
    find: "    if (splitAt < 0) err('splittable 的菜缺 split 步驟（「先盛出素食份」那一步）');",
    replace: "    if (false) err('splittable 的菜缺 split 步驟（「先盛出素食份」那一步）');",
    test: 'recipetest',
  },
  {
    name: 'meat 軌裡沒有葷食材不算錯',
    why: '一道其實全素的菜被標成可分流，會佔掉素食家庭的「分流」名額。',
    file: 'js/recipeschema.js',
    find: "    if (!tags.has('meat') && !tags.has('seafood')) err('splittable 的菜 meat 軌裡沒有任何葷食材，那它其實是素的');",
    replace: "    if (false) err('splittable 的菜 meat 軌裡沒有任何葷食材，那它其實是素的');",
    test: 'recipetest',
  },
  {
    name: '五辛標籤不推導',
    why: '全素不含五辛的成員會被排到有蔥蒜的菜。',
    file: 'js/recipeschema.js',
    find: '    if (Array.isArray(ids) && ids.includes(food.id)) out.add(tag);',
    replace: "    if (Array.isArray(ids) && ids.includes(food.id) && tag !== 'allium') out.add(tag);",
    test: 'recipetest',
  },
  {
    name: '蛋類先判斷的規則拿掉（雞蛋被算成雞）',
    why: '蛋白質輪替會把「番茄炒蛋」當成雞肉，連續兩餐雞。',
    file: 'js/recipeschema.js',
    find: "  if (tags.has('egg')) return 'egg';\n  if (tags.has('seafood'))",
    replace: "  if (tags.has('seafood'))",
    test: 'recipetest',
  },
  // ---- 文案紅線 ----
  {
    name: '首頁健康說明塞進一句「有助控制血糖」',
    why: '這是療效宣稱，App 的第一條紅線。',
    file: 'js/views/week.js',
    find: "    h('p', {}, '三、長輩實際怎麼吃，請以醫師或營養師的指示為準。'),",
    replace: "    h('p', {}, '三、長輩實際怎麼吃，請以醫師或營養師的指示為準。這樣吃有助控制血糖。'),",
    test: 'copytest',
  },
  {
    name: '食譜步驟裡寫「保證」',
    why: '食譜文字也是文案，一樣要過禁用詞。',
    file: 'data/recipes/r-steamed-egg.json',
    find: '"取出後淋一點醬油和香油。牙口不好的長輩也很好入口。"',
    replace: '"取出後淋一點醬油和香油。保證牙口不好的長輩也很好入口。"',
    test: 'copytest',
  },
  // ---- 衛教引用 ----
  {
    name: '關於頁引用一個不存在的衛教 id',
    why: '畫面上會出現「（衛教引用尚未取得）」，來源標示就沒了。',
    file: 'js/views/family.js',
    find: "    eduNode('hpa.open-data.attribution'),",
    replace: "    eduNode('hpa.open-data.attribution-typo'),",
    test: 'edutest',
  },
  {
    name: '把一筆逐字引用改一個字',
    why: '引用跟原文不一樣就不是引用；「不得惡意變更其相關資訊」是開放宣告的條件。',
    file: 'data/edu.json',
    find: '"text": "每餐都要攝取煮熟後體積比拳頭多一些的蔬菜類食物才足夠，',
    replace: '"text": "每餐都要攝取煮熟後体積比拳頭多一些的蔬菜類食物才足夠，',
    test: 'edutest',
  },
  // ---- 採買單位 ----
  {
    name: '採買數量用四捨五入（會少買）',
    why: '437 克需要的菜算成 0 顆。',
    file: 'js/units.js',
    find: '  const qty = Math.ceil(raw * 2) / 2;',
    replace: '  const qty = Math.round(raw * 2) / 2;',
    test: 'unittest',
  },
  {
    name: '保存天數忽略口語詞的 override',
    why: '高麗菜會被當成葉菜 3 天內要煮掉，排菜會綁手綁腳；反過來文蛤若沒有 1 天的 override 就會排到第三天。',
    file: 'js/units.js',
    find: "  if (alias && typeof o[alias] === 'number') return o[alias];",
    replace: "  if (false) return o[alias];",
    test: 'unittest',
  },
  // ---- 殼 ----
  {
    name: '讓 h() 支援 html: prop',
    why: 'h() 一旦能把字串當 HTML 解析，任何外部文字（食材名、使用者輸入的菜名）都變成注入點。',
    file: 'js/ui.js',
    find: "    if (k === 'class') el.className = v;",
    replace: "    if (k === 'html') { el.innerHTML = v; }\n    else if (k === 'class') el.className = v;",
    test: 'shelltest',
  },
  {
    name: '網址屬性不過白名單',
    why: 'javascript: 連結會變成可執行的程式碼。',
    file: 'js/ui.js',
    find: '      if (SAFE_URL.test(String(v).trim())) el.setAttribute(k, v);',
    replace: '      el.setAttribute(k, v);',
    test: 'shelltest',
  },
  {
    name: 'SHELL 清單漏掉一個 view',
    why: '離線時那一頁是白畫面；換版當下舊 app.js 動態 import 到不在快取裡的新檔案會被踢回首頁。',
    file: 'sw.js',
    find: "  './js/views/family.js',\n",
    replace: '',
    test: 'shelltest',
  },
  {
    name: 'Service Worker 連跨網域回應也快取',
    why: '這個 App 沒有跨網域請求；這條是結構性防線，日後有人加了外部請求也不會被快取住舊資料。',
    file: 'sw.js',
    find: '  if (url.origin !== self.location.origin) return;',
    replace: '  if (url.origin !== self.location.origin) { /* 照樣往下走 */ }',
    test: 'shelltest',
  },
  {
    name: 'CSP 的 connect-src 多開一個外部主機',
    why: '「沒有任何外部連線」是隱私承諾，CSP 是它的結構性保證。',
    file: 'index.html',
    find: "connect-src 'self'; object-src 'none';",
    replace: "connect-src 'self' https://example.com; object-src 'none';",
    test: 'shelltest',
  },
  {
    name: '關於卡片不顯示版本',
    why: '換版之後沒有人講得出手機上跑的是哪一版。',
    file: 'js/views/family.js',
    find: "    h('p', { dataset: { field: 'appVersion' } }, `MealMate 家庭三餐規劃 · 版本 ${APP_VERSION}`),",
    replace: "    h('p', { dataset: { field: 'appVersion' } }, 'MealMate 家庭三餐規劃'),",
    test: 'shelltest',
  },
];

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? String(process.argv[i + 1] ?? '') : '';
})();
const SELECTED = only ? MUTATIONS.filter((m) => [m.name, m.file, m.test].some((s) => s.includes(only))) : MUTATIONS;
const TESTS = [...new Set(SELECTED.map((m) => m.test))];

function runTest(name) {
  const file = path.join(ROOT, 'scripts', `${name}.mjs`);
  try {
    const out = execFileSync(process.execPath, [file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60 * 1000, encoding: 'utf8' });
    return { passed: true, out };
  } catch (e) {
    return { passed: false, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}` };
  }
}

// 突變跑到一半被殺掉時，原始碼會停在改壞的狀態；下一次啟動先還原。
const PENDING = path.join(ROOT, 'scripts/.mutation-pending.json');
function writePending(rel, content) { fs.writeFileSync(PENDING, JSON.stringify({ rel, content }), 'utf8'); }
function clearPending() { fs.rmSync(PENDING, { force: true }); }
function recoverPending() {
  if (!fs.existsSync(PENDING)) return null;
  const { rel, content } = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
  clearPending();
  return rel;
}

section('前置');
const recovered = recoverPending();
if (recovered) note(`上一次被中斷，已還原 ${recovered}`);
const missingTests = TESTS.filter((t) => !fs.existsSync(path.join(ROOT, 'scripts', `${t}.mjs`)));
eq(missingTests, [], '每條突變指定的測試檔都存在');
ok(SELECTED.length > 0, `選了 ${SELECTED.length} 條突變（共 ${MUTATIONS.length}）${only ? `，關鍵字「${only}」` : ''}`);

section('基準：沒有突變時全部要綠');
let baselineOk = true;
for (const t of TESTS) {
  const r = runTest(t);
  ok(r.passed, `基準 ${t} 通過`, r.passed ? '' : r.out.split('\n').filter((l) => l.includes('✗')).slice(0, 5).join('\n      '));
  if (!r.passed) baselineOk = false;
}

if (baselineOk) {
  section('逐條突變');
  for (const m of SELECTED) {
    const full = path.join(ROOT, m.file);
    const original = fs.readFileSync(full, 'utf8');
    const count = original.split(m.find).length - 1;
    if (count !== 1) {
      ok(false, `【${m.test}】${m.name}`, `要改的程式碼在 ${m.file} 出現 ${count} 次（要剛好 1 次）—— 這條突變過期了`);
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    writePending(m.file, original);
    fs.writeFileSync(full, mutated, 'utf8');
    let result;
    try {
      result = runTest(m.test);
    } finally {
      fs.writeFileSync(full, original, 'utf8');
      clearPending();
    }
    const restored = fs.readFileSync(full, 'utf8') === original;
    ok(!result.passed && restored, `【${m.test}】${m.name}`,
      !restored ? `${m.file} 沒有還原成功！` : `改壞之後 ${m.test} 居然還是綠的 —— 對應的斷言沒有在檢查東西。${m.why}`);
  }
} else {
  note('基準沒過，不跑突變（先把測試修綠）');
}

done('mutationtest');
