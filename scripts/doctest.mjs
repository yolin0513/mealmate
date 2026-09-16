// 文件對程式（npm run doctest）。
//
// PLAN／STATUS 宣稱「做了」「決定了」的事，逐條回去對程式與資料。文件漂開是靜默的：
// 讀的人（包括下一個接手的工作階段）會照文件做決定，而程式早就不是那樣了。
//
// 每一條的寫法都是**兩段**：先斷言文件裡真的有那句話（不然文件改了、測試還在守一條沒人宣稱的規則），
// 再斷言程式跟它一致。少了前半段，文件刪掉這條之後測試會繼續綠，等於守著一個幽靈。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { FORBIDDEN } from './copyrules.mjs';
import { CONDITION_FIELDS, DIETS, DIET_LABELS, CONDITIONS, KIDNEY_FIELDS, BASE_DISPLAY_FIELDS } from '../js/members.js';
import { DEFAULTS, FONT_SCALES } from '../js/prefs.js';
import { DEFAULT_RULES } from '../js/planner.js';
import { MEAL_ROLES, VEG_MIN_DISHES } from '../js/planner.js';
import { STORE_NAMES } from '../js/db.js';
import { NUTRIENT_ORDER } from '../js/foods.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PLAN = read('docs/PLAN.md');
const STATUS = read('docs/STATUS.md');
const recipes = JSON.parse(read('data/recipes.json')).recipes;
const units = JSON.parse(read('data/units.json'));
const pkg = JSON.parse(read('package.json'));

section('PLAN §1.2：健康界線的每一條都要對得到程式');
ok(PLAN.includes('腎臟病不自動限鉀'), '（文件）PLAN 寫了「腎臟病不自動限鉀」');
eq(CONDITION_FIELDS.kidney, [], '程式：腎臟病預設帶 0 個欄位');
eq(KIDNEY_FIELDS, ['sodium', 'potassium', 'phosphorus', 'protein'], '勾選的選項就是鈉、鉀、磷、蛋白質');
ok(PLAN.includes('糖尿病 → 醣、糖、膳食纖維'), '（文件）PLAN 寫了糖尿病對到哪三項');
eq(CONDITION_FIELDS.diabetes, ['carb', 'sugar', 'fiber'], '程式：糖尿病＝醣、糖、膳食纖維');
ok(PLAN.includes('高血壓 → 鈉'), '（文件）PLAN 寫了高血壓對到鈉');
eq(CONDITION_FIELDS.hypertension, ['sodium'], '程式：高血壓＝鈉');
ok(PLAN.includes('高血脂 → 飽和脂肪、膽固醇'), '（文件）PLAN 寫了高血脂對到哪兩項');
eq(CONDITION_FIELDS.lipid, ['satFat', 'cholesterol'], '程式：高血脂＝飽和脂肪、膽固醇');
ok(PLAN.includes('心血管疾病 | 飽和脂肪'), '（文件）PLAN 列了心血管疾病對到哪幾項');
eq(CONDITION_FIELDS.cardio, ['satFat', 'cholesterol', 'sodium'], '程式：心血管疾病＝飽和脂肪、膽固醇、鈉');
ok(PLAN.includes('骨質疏鬆 | 鈣'), '（文件）PLAN 列了骨質疏鬆對到鈣');
eq(CONDITION_FIELDS.osteoporosis, ['calcium'], '程式：骨質疏鬆＝鈣');
ok(PLAN.includes('沒有數字的病不放進清單'), '（文件）PLAN 寫了「沒有數字的病不放進清單」這條界線');
everyOf(CONDITIONS.filter((c) => c !== 'kidney'), (c) => (CONDITION_FIELDS[c] ?? []).length > 0,
  '程式：除了腎臟病以外，每一項慢性病都對得到至少一個欄位');
everyOf(CONDITIONS.flatMap((c) => CONDITION_FIELDS[c] ?? []), (f) => NUTRIENT_ORDER.includes(f),
  '程式：沒有任何一項指到食藥署資料庫沒有的欄位（普林、鐵都還沒有來源）');
noneOf(CONDITIONS, (c) => ['gout', 'anemia'].includes(c), '痛風、貧血仍然不在清單裡');
ok(PLAN.includes('痛風不做'), '（文件）PLAN 確實寫了痛風不做');

section('排菜葷素比例：混合家庭每個午晚餐放一道純葷加菜（2026-09-16）');
ok(STATUS.includes('SPEC_排菜葷素比例'), '（文件）STATUS 指到規格');
ok(STATUS.includes('每個午晚餐') && STATUS.includes('純葷加菜'), '（文件）STATUS 寫了「每個午晚餐放一道純葷加菜」');
eq(VEG_MIN_DISHES, 3, '素食保障的門檻沒有變（仍是 3 道，含主食）');
ok(read('js/planner.js').includes('export function refillSlot'), '程式：planner 匯出 refillSlot');
ok(read('js/planner.js').includes('export function fillMeal'), '程式：填一餐抽成 fillMeal 給兩個入口共用');
ok(read('js/views/weekops.js').includes('refillSlot({'), '程式：外食改回自己煮走 refillSlot');
ok(!/regenerateSlot[\s\S]{0,600}swapItem\(/.test(read('js/views/weekops.js')),
  '程式：regenerateSlot 不再逐格呼叫 swapItem（同一條規則不可以有兩套寫法）');

section('食量只影響採買，不碰營養（2026-09-16 份數同步）');
ok(STATUS.includes('食量只影響採買'), '（文件）STATUS 寫了這條界線');
noneOf(['js/nutrition.js', 'js/planner.js'], (f) => read(f).includes('appetite'),
  '程式：營養估算與排菜器完全不認識食量 —— 它只走購物清單那條路');
ok(read('js/shopping.js').includes('appetiteOf'), '（對照）購物清單那條路確實有用到食量');

section('PLAN §1.2 第 5 點：禁用詞清單');
const planWords = ['治療', '療效', '控制血糖', '降血糖', '降血壓', '改善腎功能', '糖尿病專用', '腎臟病專用', '減重', '瘦身', '排毒', '保證', '建議攝取', '應該吃'];
everyOf(planWords, (w) => PLAN.includes(w), `（文件）PLAN 列的 ${planWords.length} 個禁用詞都還在文件裡`);
everyOf(planWords, (w) => FORBIDDEN.includes(w), '程式的禁用詞清單涵蓋 PLAN 列的每一個');
ok(FORBIDDEN.includes('取代醫囑'), '「取代醫囑」也在清單裡（肯定句才算）');
noneOf(FORBIDDEN, (w) => ['低醣', '低鈉', '留意鈉', '鉀較低'].includes(w), 'PLAN 明列「允許」的詞沒有被誤收進禁用清單');
ok(PLAN.includes('不寫「無過敏原」'), '（文件）PLAN 寫了不可以宣稱無過敏原');
const jsFiles = ['js', 'js/views'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));
noneOf(jsFiles, (f) => read(f).includes('無過敏原'), `程式裡沒有任何一處寫「無過敏原」（掃了 ${jsFiles.length} 個檔）`);

section('PLAN §2 定案總表：數字對得上');
eq(DIETS, ['omni', 'lactoOvo', 'vegan', 'veganNoAllium'], '飲食型態四種（存的值不變）');
 eq(DIET_LABELS.vegan, '五辛素', '2026-09-16 正名：vegan 本來就允許五辛 → 標籤叫「五辛素」');
 eq(DIET_LABELS.veganNoAllium, '全素', '連五辛都不吃的才叫「全素」');
ok(PLAN.includes('葷／蛋奶素／五辛素／全素'), '（文件）PLAN 也是這四種');
ok(PLAN.includes('主菜 14 天內不重複、配菜 7 天、湯 7 天'), '（文件）PLAN 寫了不重複天數');
eq([DEFAULTS.noRepeatDays.main, DEFAULTS.noRepeatDays.side, DEFAULTS.noRepeatDays.soup], [14, 7, 7], '程式的預設：主菜 14、配菜 7、湯 7');
ok(PLAN.includes('早餐不納入不重複'), '（文件）PLAN 寫了早餐不納入不重複');
eq(DEFAULTS.noRepeatDays.breakfast, 0, '程式：早餐 0 天（不扣分）');
ok(PLAN.includes('v1 做滿 170 道'), '（文件）PLAN 訂的食譜量是 170 道');
const byRole = {};
for (const r of recipes) byRole[r.role] = (byRole[r.role] ?? 0) + 1;
ok(recipes.length >= 170, `實際 ${recipes.length} 道（≥ 170）：${Object.entries(byRole).map(([k, v]) => `${k} ${v}`).join('、')}`);
everyOf([['main', 80], ['side', 50], ['soup', 25], ['staple', 6]], ([role, min]) => (byRole[role] ?? 0) >= min, 'PLAN 訂的主菜 80、配菜 50、湯 25、主食 6 都達標');
ok((byRole.breakfast ?? 0) >= 10, `早餐 ${byRole.breakfast} 道（PLAN 訂 10 道；使用者後來要求補「簡單健康」的早餐）`);
ok(PLAN.includes('深色模式 v1 不做'), '（文件）PLAN 說深色模式不做');
noneOf([read('css/style.css')], (c) => c.includes('prefers-color-scheme'), '程式：CSS 裡沒有深色模式的區塊');
ok(PLAN.includes('零後端、零 AI、零成本'), '（文件）PLAN 說零後端');
ok(read('index.html').includes("connect-src 'self'"), "程式：CSP 寫死 connect-src 'self'");

section('PLAN §2 保存期限：葉菜與海鮮 3 天');
ok(PLAN.includes('葉菜／海鮮排在買菜日後 3 天內'), '（文件）PLAN 寫了葉菜與海鮮的期限');
eq(units.shelfDays.byCategory['蔬菜類'], 3, '程式：蔬菜類 3 天');
eq(units.shelfDays.byCategory['魚貝類'], 3, '程式：魚貝類 3 天');
ok(units.shelfDays.byCategory['肉類'] === 4 && /冷凍/.test(units.shelfDays.note),
  `肉類 ${units.shelfDays.byCategory['肉類']} 天，而且 note 講明是「當天冷藏、超過兩天冷凍」的排菜假設`);
ok(/不是食品安全建議/.test(units.shelfDays.note), 'note 明講這不是食品安全建議 —— 排菜用的天數不可以被當成食安指引');

section('STATUS：宣稱的數字與清單');
const statusRecipes = /食譜現況：\*\*(\d+) 道\*\*/.exec(STATUS)?.[1];
ok(statusRecipes, `（文件）STATUS 宣稱食譜 ${statusRecipes} 道`);
eq(Number(statusRecipes), recipes.length, 'STATUS 宣稱的食譜數＝data/recipes.json 實際筆數');
const statusMut = /`mutationtest` 共 \*\*(\d+) 條\*\*/.exec(STATUS)?.[1];
ok(statusMut, `（文件）STATUS 宣稱突變 ${statusMut} 條`);
const mutCount = (read('scripts/mutationtest.mjs').match(/^ {4}name: /gm) ?? []).length;
eq(Number(statusMut), mutCount, 'STATUS 宣稱的突變條數＝mutationtest.mjs 實際條數');
const statusTests = [...STATUS.matchAll(/([a-z]+test) \d+/g)].map((m) => m[1]);
ok(statusTests.length >= 15, `（母體）STATUS 點名了 ${new Set(statusTests).size} 支測試`);
everyOf([...new Set(statusTests)], (t) => fs.existsSync(path.join(ROOT, 'scripts', `${t}.mjs`)), 'STATUS 點名的每一支測試都真的存在');
everyOf([...new Set(statusTests)], (t) => typeof pkg.scripts[t] === 'string', 'STATUS 點名的每一支測試都有 npm script');
everyOf([...new Set(statusTests)], (t) => pkg.scripts.test.includes(`scripts/${t}.mjs`), '而且都在 npm test 的鏈裡（不會有人跑不到）');
const storeLine = /IndexedDB `mealmate`（([^）]+)）/.exec(STATUS)?.[1] ?? '';
ok(storeLine.length > 10, `（文件）STATUS 列了 store：${storeLine}`);
everyOf(STORE_NAMES, (s) => storeLine.includes(s), 'db.js 的每一個 store 都列在 STATUS 的部署表裡');

section('STATUS：追加優化那兩項的宣稱');
ok(STATUS.includes('午餐是 `[\'main\',\'side\',\'side\',\'staple\']`') || STATUS.includes("午餐是 `['main','side','side','staple']`"),
  '（文件）STATUS 寫了午餐的組成');
eq(MEAL_ROLES.lunch, ['main', 'side', 'side', 'staple'], '程式：午餐＝主菜＋兩配菜＋主食');
eq(MEAL_ROLES.dinner, ['main', 'side', 'side', 'soup', 'staple'], '程式：晚餐再加一道湯');
eq(MEAL_ROLES.breakfast, ['breakfast'], '程式：早餐一道');
ok(STATUS.includes('VEG_MIN_DISHES'), '（文件）STATUS 提到素食保障的門檻常數');
eq(VEG_MIN_DISHES, 3, '程式：每餐至少 3 道素食成員吃得到');
ok(STATUS.includes('熱量與蛋白質'), '（文件）STATUS 寫了預設顯示熱量與蛋白質');
eq(BASE_DISPLAY_FIELDS, ['kcal', 'protein'], '程式：預設欄位就是這兩項');
ok(STATUS.includes('特大'), '（文件）STATUS 寫了字級三段含特大');
eq(FONT_SCALES, ['md', 'lg', 'xl'], '程式：字級三段');

section('STATUS 工作慣例：說有的稽核真的存在');
ok(STATUS.includes('含 regex 的測試碼一律用 Write 工具直接寫檔'), '（文件）慣例 5：regex 測試碼用 Write 寫');
ok(fs.existsSync(path.join(ROOT, 'scripts/assertaudit.mjs')), '有一支會掃雙反斜線的健檢（assertaudit）');
ok(STATUS.includes('每條斷言都要能用突變測試證明它真的會紅'), '（文件）慣例 4：每條斷言要有突變證明');
ok(fs.existsSync(path.join(ROOT, 'scripts/checkmutations.mjs')), '有一支會檢查突變是否過期的工具（checkmutations）');
ok(STATUS.includes('不動 `D:\\Claude\\App\\TripQuest`') || STATUS.includes('不動 `D:\\Claude\\App\\TripQuest`'), '（文件）慣例 13：不動其他專案');

section('PLAN 對齊（2026-09-13 全面檢測抓到五處漂開，逐條補守）');
// 這五條在檢測前都是綠的 —— 因為根本沒有人守。文件漂開是靜默的：
// 讀的人照文件做決定，程式早就不是那樣了。

// 1. 醣類份數：紅線是「拿到可引用來源前不顯示」，文件要標成延後，不能留成待辦
ok(PLAN.includes('「醣類份數」：**v1 不做，已延後**'), '（文件）PLAN §4.1 把醣類份數標成已延後');
ok(PLAN.includes('拿到來源之前不要恢復'), '（文件）而且寫明為什麼不要急著恢復');
noneOf(jsFiles, (f) => read(f).includes('醣類份數'), '程式：沒有任何一頁顯示醣類份數');

// 2. 保存天數：§2、§4.3 與 data/units.json 三邊一致
ok(PLAN.includes('葉菜 3、海鮮 3、肉類 4'), '（文件）PLAN §4.3 的天數改成海鮮 3、肉類 4（原本寫 2，跟自己的 §2 打架）');
eq([units.shelfDays.byCategory['蔬菜類'], units.shelfDays.byCategory['魚貝類'], units.shelfDays.byCategory['肉類']], [3, 3, 4],
  '程式：蔬菜 3、魚貝 3、肉類 4，跟 §4.3 寫的一樣');
ok(PLAN.includes('不是食品安全建議'), '（文件）§4.3 也講明這是排菜假設、不是食安建議');
ok(PLAN.includes('一個食材的**所有**口語詞都會拿去對 overrides'), '（文件）PLAN 寫了別名要全查');

// 3. 「可設／可關」但其實只有寫死的預設值 —— 文件要講明還沒實作
ok(PLAN.includes('**「可關」尚未實作**'), '（文件）PLAN 講明「魚每週 2 次」還不能關');
ok(PLAN.includes('**「可設」尚未實作**'), '（文件）PLAN 講明時間上限還不能設');
eq(DEFAULT_RULES.fishPerWeek, 2, '程式：fishPerWeek 是寫死的 2');
eq(DEFAULT_RULES.timeCaps.weekday, { breakfast: 20, lunch: 35, dinner: 40 }, '程式：平日時間上限是寫死的 20／35／40');
const viewFiles = fs.readdirSync(path.join(ROOT, 'js/views')).filter((f) => f.endsWith('.js')).map((f) => `js/views/${f}`);
noneOf(viewFiles, (f) => read(f).includes('fishPerWeek') || read(f).includes('timeCaps'),
  `程式：${viewFiles.length} 個畫面檔裡真的沒有這兩個設定（所以文件不能寫成「可設」）`);

// 4. wasteRate：M5 瘦身時刪掉，欄位表不可以還列著
const schemaLine = PLAN.split('\n').find((l) => l.includes('data/foods.json') && l.includes('食材：'));
ok(schemaLine, '（文件）PLAN §3 有 foods.json 的欄位表');
ok(!schemaLine.includes('wasteRate'), 'PLAN 的欄位表不再列 wasteRate');
ok(PLAN.includes('M5 瘦身 `foods.json` 時刪掉了'), '（文件）PLAN 講明它是什麼時候被刪的');
noneOf(JSON.parse(read('data/foods.json')).foods.slice(0, 200), (f) => 'wasteRate' in f, '程式：資料裡真的沒有這個欄位');

// 5. 格子順序：實作是位置制，主菜先選、主食最後
ok(PLAN.includes('午餐 主菜 → 配菜 → 配菜 → 主食'), '（文件）PLAN §4.3 的午餐順序改成跟實作一致');
ok(PLAN.includes('晚餐 主菜 → 配菜 → 配菜 → 湯 → 主食'), '（文件）晚餐順序也是');
eq(MEAL_ROLES.lunch, ['main', 'side', 'side', 'staple'], '程式：午餐的位置順序');
eq(MEAL_ROLES.dinner, ['main', 'side', 'side', 'soup', 'staple'], '程式：晚餐的位置順序');
ok(PLAN.includes('位置 `pos`'), '（文件）PLAN 講了每道菜記的是位置不是角色');

done('doctest');
