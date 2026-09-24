// 文件對程式（npm run doctest）。
//
// PLAN／STATUS 宣稱「做了」「決定了」的事，逐條回去對程式與資料。文件漂開是靜默的：
// 讀的人（包括下一個接手的工作階段）會照文件做決定，而程式早就不是那樣了。
//
// 每一條的寫法都是**兩段**：先斷言文件裡真的有那句話（不然文件改了、測試還在守一條沒人宣稱的規則），
// 再斷言程式跟它一致。少了前半段，文件刪掉這條之後測試會繼續綠，等於守著一個幽靈。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf, detects } from './tap.mjs';
import { loadMutations, expectProblems, missingExpectOverLimit, EXPECT_MISSING_MAX } from './checkmutations.mjs';
import { main, scanText, controlSamples, TARGETS, ORPHAN_EXEMPT, ESCAPE_EXEMPT, walkScripts, escapeScan } from './gatescan.mjs';
import { selfcheck, gitEnvProblems } from './selfcheck.mjs';
import { STATIC_RULES } from './auditrules.mjs';
import { outputProblems, writeAtomically } from './build-recipes.mjs';
import { selfControls as bgControls, names, registrationDecision as bgDecide, BG_FILES, BG_REG, finalizeRegistration, compare as bgCompare } from './buildguard-verify.mjs';
import { rawProblems, foodsProblems, REQUIRED_FIELDS, NUTRIENT_KEYS, nutrientOrder } from './build-foods.mjs';
import { FORBIDDEN } from './copyrules.mjs';
import { CONDITION_FIELDS, DIETS, DIET_LABELS, CONDITIONS, KIDNEY_FIELDS, BASE_DISPLAY_FIELDS } from '../js/members.js';
import { DEFAULTS, FONT_SCALES } from '../js/prefs.js';
import { DEFAULT_RULES } from '../js/planner.js';
import { MEAL_ROLES, VEG_MIN_DISHES } from '../js/planner.js';
import { STORE_NAMES } from '../js/db.js';
import { NUTRIENT_ORDER } from '../js/foods.js';
import { parseCheckLines, chainExcludesMutation, reminderLines, mutationNames, neverRunNames, lastFullMatchesStatus, lastFullProblems, shouldRecordFull, writeLastFull, FULL_LIMITS, overLimitLine, auditTargets, orphanTests } from './sincefull.mjs';

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

section('加菜格收得下哪些角色：排菜器與「為什麼沒排進去」必須用同一份清單');
{
  // 兩邊各寫各的，畫面就會講一個跟排菜器不同的原因（使用者 2026-09-17 看到的
  // 「這道只有吃葷的人能吃，奶奶吃素」正是這種漂開的結果）。
  const src = read('js/planner.js');
  ok(STATUS.includes('EXTRA_MEAT_ROLES'), '（文件）STATUS 寫了這份清單的名字');
  ok(/export const EXTRA_MEAT_ROLES = \['main', 'side'\]/.test(src), '程式：清單是主菜與配菜');
  const uses = [...src.matchAll(/EXTRA_MEAT_ROLES/g)].length;
  ok(uses >= 4, `程式：一共被引用 ${uses} 次（宣告、fillMeal 的想吃清單、挑選迴圈、wantMissReason）`);
  const reasonFn = src.slice(src.indexOf('export function wantMissReason'), src.indexOf('export function pickForSlot'));
  ok(/EXTRA_MEAT_ROLES\.includes\(recipe\.role\)/.test(reasonFn), '程式：wantMissReason 判斷「能不能走加菜」時用的就是這份清單');
  ok(!/recipe\.role === 'main'/.test(reasonFn), '程式：它沒有另外寫死一份「只有主菜」的判斷');
}

section('自主優化一輪（2026-09-17）：文件宣稱的每一條都對得到程式');
{
  const dbSrc = read('js/db.js');
  const appSrc = read('js/app.js');
  const shopSrc = read('js/shopping.js');

  ok(STATUS.includes('唯一的通報口'), '（文件）STATUS 說寫入失敗只有一個通報口');
  ok(/export function onWriteError/.test(dbSrc), '程式：db.js 匯出 onWriteError');
  ok(/db\.onWriteError\(/.test(appSrc), '程式：app.js 訂閱了它');
  ok(STATUS.includes('unhandledrejection'), '（文件）STATUS 說另外有一道安全網');
  ok(/unhandledrejection/.test(appSrc), '程式：app.js 真的掛了');

  ok(STATUS.includes('不再停在「載入中…」'), '（文件）STATUS 說開機失敗不再停在載入中');
  ok(/showStorageBlocked/.test(appSrc), '程式：app.js 有那張說明卡');

  ok(STATUS.includes('同一頁重畫不重播'), '（文件）STATUS 說同一頁重畫不重播');
  ok(/lastAnnounced/.test(read('js/shell.js')), '程式：shell.js 記得上一次播報過什麼');
  ok(!/<main id="view" aria-live/.test(read('index.html')), '程式：#view 身上沒有 aria-live');

  ok(STATUS.includes('沒有真的螢幕閱讀器可以驗'), '（文件）STATUS 誠實寫明這一項沒有真的螢幕閱讀器驗過');

  ok(STATUS.includes('拿掉動畫不等於拿掉資訊'), '（文件）STATUS 寫了減少動態的界線');
  ok(/prefers-reduced-motion/.test(read('css/style.css')), '程式：CSS 有那個 media query');

  ok(PLAN.includes('整個過去的'), '（文件）PLAN §4.3 寫了買菜清單的順序規則');
  ok(PLAN.includes('不是買菜日本身'), '（文件）而且寫明「過去了」看的是它給哪幾餐');
  ok(/export function orderRangesForToday/.test(shopSrc), '程式：shopping.js 有 orderRangesForToday');
  ok(/dates\.every\(\(d\) => d < todayIso\)/.test(shopSrc), '程式：rangeIsPast 真的是看每一天，不是看 key');
  ok(/orderRangesForToday\(/.test(read('js/views/shopping.js')), '程式：買菜頁真的用了它（不是寫了沒接上）');
}

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
everyOf(['omni', 'lactoOvo', 'vegan', 'veganNoAllium'], (k) => DIETS.includes(k), '舊的四個值原封不動（2026-09-18 起再加五種素食組合，舊資料不用搬）');
eq(DIETS.length, 9, '葷＋素食三個勾的八種組合');
 eq(DIET_LABELS.vegan, '五辛素', '2026-09-16 正名：vegan 本來就允許五辛 → 標籤叫「五辛素」');
 eq(DIET_LABELS.veganNoAllium, '全素', '連五辛都不吃的才叫「全素」');
ok(PLAN.includes('葷／素（吃不吃蛋、奶、五辛三個勾）'), '（文件）PLAN 寫的是葷／素＋三個勾');
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

section('STATUS：上次全面檢測／上次突變整套的兩行紀錄（npm run sincefull 讀它；SPEC_測試範圍_修訂一 §2-3、§2-4）');
{
  // D1 兩段式：先斷言那兩行在，再斷言 sincefull 的解析器讀得出日期、版本、條數
  const fullLine = STATUS.split('\n').find((l) => l.startsWith('上次全面檢測：'));
  const mutLine = STATUS.split('\n').find((l) => l.startsWith('上次突變整套：'));
  ok(!!fullLine && !!mutLine, '（文件）STATUS 有「上次全面檢測：」「上次突變整套：」兩行');
  let parsed = null;
  try { parsed = parseCheckLines(STATUS); } catch (e) { parsed = { error: e.message }; }
  ok(!!parsed?.full && /^\d{4}-\d{2}-\d{2}$/.test(parsed.full.date) && /^mealmate-v\d+\.\d+\.\d+$/.test(parsed.full.version)
    && /^\d{4}-\d{2}-\d{2}$/.test(parsed.mut?.date) && /^mealmate-v\d+\.\d+\.\d+$/.test(parsed.mut?.version) && parsed.mut.count > 0,
    `D1 sincefull 讀得出兩行的日期、版本、條數（${JSON.stringify(parsed)}）`);
  // D2 格式對不上 → 丟錯，不是回傳一個看起來像「剛跑過」的結果
  const broken = STATUS.replace(/^上次突變整套：(\d{4}-\d{2}-\d{2})、/m, '上次突變整套：$1 ');
  ok(broken !== STATUS, '（前提）故意寫壞的那一份真的跟原文不同');
  let threw = false;
  try { parseCheckLines(broken); } catch { threw = true; }
  ok(threw, 'D2 那一行格式壞掉時，sincefull 的解析器丟錯（不印 0 天）');
  let threwEmpty = false;
  try { parseCheckLines(''); } catch { threwEmpty = true; }
  ok(threwEmpty, 'D2 整份 STATUS 讀不到那兩行時也丟錯');
  // D3（條數相減）2026-09-19 由下面的 N1–N4 取代：刪過或改名過突變時條數相減會系統性偏低（docs/SPEC_sincefull_按名稱計數.md）。
  // N1 從未整套跑過＝現在的突變名稱裡，不在基準清單上的（照名稱比對，改名的算沒跑過）
  const lastfull = JSON.parse(read('scripts/mutation-lastfull.json'));
  const curNames = mutationNames(read('scripts/mutationtest.mjs'));
  eq(curNames.length, mutCount, `（前提）照名稱取出的突變 ${curNames.length} 條＝用行數數的 ${mutCount} 條（名稱沒有漏抓）`);
  eq(neverRunNames(['a', 'b', 'c2'], ['a', 'b', 'c']), ['c2'], 'N1（對照）基準 3 條、現在 3 條但 1 條改名 → 從未整套跑過是 1 條（條數相減會得 0）');
  // 真實的突變名稱＋當下造的基準：拿掉其中一條、多放一條已經刪掉的舊名稱（2026-09-23 起不再寫死某一次基準裡有誰——
  // 原本寫死「v0.36.0 之後加的那一條」，09-21 整套跑完、基準收進全部 428 條就不成立了；共用慣例 §5.3）
  const dropped = curNames[Math.floor(curNames.length / 2)];
  const madeBase = [...curNames.filter((n) => n !== dropped), '（已刪掉的舊突變）'];
  ok(curNames.length > 1 && !!dropped, `（前提）真實的突變名稱不只一條（${curNames.length} 條）`);
  const never = neverRunNames(curNames, madeBase);
  eq(never, [dropped], `N1 真實資料：基準少了「${dropped}」→ 只有它算從未整套跑過；基準裡多的舊名稱、其餘 ${curNames.length - 1} 條都不算`);
  // N2 基準清單的日期、版本、條數跟 STATUS「上次突變整套」那一行一致
  ok(!!lastfull.date && !!lastfull.version && !!parsed?.mut, `（前提）兩邊都讀得到：基準 ${lastfull.date}、${lastfull.version}、${lastfull.names?.length} 條；STATUS ${parsed?.mut?.date}、${parsed?.mut?.version}、${parsed?.mut?.count} 條`);
  ok(lastFullMatchesStatus(lastfull, parsed), 'N2 基準清單與 STATUS 那一行的日期、版本、條數一致');
  ok(!lastFullMatchesStatus({ ...lastfull, names: lastfull.names.slice(1) }, parsed), 'N2（對照）條數差一條 → 判成不一致');
  // N3 帶 --only、中斷或漏跑時不寫基準；完整跑完才寫（用假的小清單，不真的跑整套）
  ok(!shouldRecordFull({ only: '蛋豆奶', ran: 5, total: 5 }), 'N3 帶 --only → 不寫基準');
  ok(!shouldRecordFull({ only: '', ran: 4, total: 5 }), 'N3 少跑一條（中斷或漏跑）→ 不寫基準');
  ok(shouldRecordFull({ only: '', ran: 5, total: 5 }) && shouldRecordFull({ only: '蛋豆奶', ran: 1, total: 5, recordFlag: true }), 'N3（對照）完整跑完會寫；人明確下 --record-full 也寫');
  {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lastfull-')), 'lastfull.json');
    writeLastFull(tmp, { date: '2026-01-02', version: 'mealmate-v9.9.9', names: ['甲', '乙'] });
    const back = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    eq([back.date, back.version, back.names], ['2026-01-02', 'mealmate-v9.9.9', ['甲', '乙']], 'N3（對照）寫入函式寫得出來、讀得回去');
  }
  // N4 基準清單非空、沒有重複
  eq(lastFullProblems(lastfull), [], `N4 基準清單 ${lastfull.names?.length} 條，非空、沒有重複`);
  ok(lastFullProblems({ names: [] }).length > 0 && lastFullProblems({ names: ['甲', '甲'] }).length > 0, 'N4（對照）空清單、有重複的清單都會被抓到');
  // D6 整套的上限（共用慣例 v3 §5.7：上限由各 App 自己定，超過才在回報最前面提一行）
  const limitTxt = /距上次突變整套 \*\*(\d+) 版\*\*，或從未整套跑過的突變 \*\*(\d+) 條\*\*/.exec(STATUS);
  ok(!!limitTxt, `（文件）STATUS 寫了整套的上限（${limitTxt ? limitTxt[0] : '找不到那一句'}）`);
  eq([Number(limitTxt?.[1]), Number(limitTxt?.[2])], [FULL_LIMITS.versions, FULL_LIMITS.never],
    `D6 STATUS 寫的上限＝sincefull 的 FULL_LIMITS（${JSON.stringify(FULL_LIMITS)}）`);
  const overVers = overLimitLine({ versMut: FULL_LIMITS.versions + 1, never: 0 });
  ok(typeof overVers === 'string' && overVers.includes(`${FULL_LIMITS.versions + 1} 版`) && overVers.includes('建議這一批做完就跑'),
    `D6 版數超過上限 → 多印一行講出是哪一項：${overVers}`);
  const overNever = overLimitLine({ versMut: 0, never: FULL_LIMITS.never + 1 });
  ok(typeof overNever === 'string' && overNever.includes(`${FULL_LIMITS.never + 1} 條`) && !overNever.includes('版（上限'),
    `D6 條數超過上限 → 只講條數那一項：${overNever}`);
  eq(overLimitLine({ versMut: FULL_LIMITS.versions, never: FULL_LIMITS.never }), null,
    'D6（對照）剛好在上限上 → 不提（沒超過就照舊只印兩行）');
  // D6 真實入口：直接跑 npm run sincefull 那支程式，驗它印的跟 STATUS 寫的上限一致。
  // 不寫死「現在沒超過」—— 2026-09-21 那一版加了 10 條突變就真的超過了，寫死現況的斷言會跟著紅。
  // 判準刻意不經 overLimitLine：那支函式正是被驗的對象，拿它當標準答案就成了「自己跟自己比」。
  const cliOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts/sincefull.mjs')], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const cliMut = cliOut.find((l) => l.startsWith('距上次突變整套（')) ?? '';
  const cliVers = Number(/：(\d+) 版/.exec(cliMut)?.[1]);
  const cliNever = Number(/其中 (\d+) 條/.exec(cliMut)?.[1]);
  ok(Number.isFinite(cliVers) && Number.isFinite(cliNever) && cliOut.some((l) => l.startsWith('距上次全面檢測（')),
    `（前提）sincefull 印得出那兩行，而且讀得到版數與條數（${cliVers} 版／${cliNever} 條）`);
  const overNow = cliVers > Number(limitTxt?.[1]) || cliNever > Number(limitTxt?.[2]);
  ok(cliOut.length === (overNow ? 3 : 2) && (overNow ? cliOut[0].startsWith('已超過上限（') : cliOut[0].startsWith('距上次全面檢測（')),
    `D6（真實入口）現在 ${cliVers} 版／${cliNever} 條，${overNow ? '超過' : '沒超過'} STATUS 寫的上限 → sincefull ${overNow ? '在最前面多印一行提醒' : '只印那兩行'}：${JSON.stringify(cliOut)}`);
  // D4 npm test 的鏈裡沒有 mutationtest（它會暫時改寫原始碼、跑三十分鐘以上），但它的 npm script 還在
  ok(chainExcludesMutation(pkg), 'D4 package.json 的 test 鏈裡沒有 mutationtest');
  ok(!chainExcludesMutation({ scripts: { test: 'node scripts/datatest.mjs && node scripts/mutationtest.mjs' } }), 'D4（對照）含 mutationtest 的假鏈會被判成不合格');
  ok(typeof pkg.scripts.mutationtest === 'string' && pkg.scripts.mutationtest.includes('scripts/mutationtest.mjs'), 'D4 npm run mutationtest 這個獨立指令還在');
  // D5 兩行提醒要帶上次實測耗時（SPEC_嫩莢豆芽與蛋白質門檻 §8：被低估成半小時、實際要半天的工作，很容易一直往後排）
  const nums = { versFull: 1, versMut: 1, daysFull: 2, daysMut: 2, never: 3 };
  if (parsed?.full?.took && parsed?.mut?.took) {
    const lines = reminderLines(parsed, nums);
    ok(lines.length === 2 && lines[0].includes(`上次實測耗時${parsed.full.took}`) && lines[1].includes(`上次實測耗時${parsed.mut.took}`),
      `D5 兩行都帶 STATUS 記的實測耗時：${lines.join('｜')}`);
  } else ok(false, `D5 STATUS 那兩行讀不到耗時欄位（${JSON.stringify(parsed)}）`);
  const noRecord = STATUS.replace(/總耗時 約 [\d,]+ 秒/, '總耗時 無紀錄').replace(/、耗時 約 [\d,]+ 秒/, '、耗時 無紀錄');
  ok(noRecord !== STATUS, '（前提）改成「無紀錄」的那一份真的跟原文不同');
  const nrLines = reminderLines(parseCheckLines(noRecord), nums);
  ok(nrLines.every((l) => l.includes('上次實測耗時無紀錄')), `D5（對照）耗時寫「無紀錄」時照實印「無紀錄」，不省略、不印 0：${nrLines.join('｜')}`);
}

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
// 2026-09-23 起路徑改寫成相對的（共用慣例 v5 §2.4：本機絕對路徑不進 repo），所以比語意、不比字面：
// 工作慣例第 13 條那一行要講「不動」，而且三個其他 App 都點到名
{
  const rule13 = STATUS.split('\n').find((l) => /^13\. /.test(l) && l.includes('不動')) ?? '';
  ok(['TripQuest', 'JLPT_App', 'StockDiary'].every((a) => rule13.includes(`../${a}`)), `（文件）慣例 13：不動其他專案（${rule13.slice(0, 40)}…）`);
}

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

section('突變的 expect 都找得到（A2；共用慣例 v6 §5.9，2026-09-23 抄 StockDiary 的 expectProblems）');
{
  // 秒級：expect 過期（斷言訊息改了、expect 沒跟上）的突變會「紅錯地方」，以前要等整套跑到那一條才看得到
  const readRel = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
  const MUTS = loadMutations(read('scripts/mutationtest.mjs')) ?? [];
  const withExpect = MUTS.filter((m) => m.expect != null);
  ok(withExpect.length >= 100, `（前提）帶 expect 的突變有 ${withExpect.length} 條（全部 ${MUTS.length} 條）`);
  everyOf(withExpect, (m) => expectProblems(m, readRel).length === 0,
    'A2 每一條 expect 都是對應測試原始碼裡的一段字面（打錯字、過期的永遠不會命中）',
    withExpect.filter((m) => expectProblems(m, readRel).length).slice(0, 3).map((m) => `${m.name}：${expectProblems(m, readRel).join('；')}`).join(' ／ '));
  // 對照組：合成的假突變，跑同一個檢查。正例含 StockDiary 點名的坑——拿執行時才組出來的字（插值之後的）當 expect
  const REAL_TEST = 'doctest';
  const REAL_LINE = 'A2 每一條 expect 都是對應測試原始碼裡的一段字面';
  const fakeTestSrc = 'ok(x, `${label}：標了 ${want}`);';
  const fakeRead = (rel) => (rel === 'scripts/fake-a2.mjs' ? fakeTestSrc : readRel(rel));
  detects((m) => expectProblems(m, fakeRead).length > 0, {
    shouldHit: [
      { name: '假：打錯字', test: REAL_TEST, expect: REAL_LINE + '（打錯）' },
      { name: '假：空字串', test: REAL_TEST, expect: '   ' },
      { name: '假：測試不存在', test: 'no-such-test', expect: REAL_LINE },
      { name: '假：執行時才組出來的字', test: 'fake-a2', expect: '豬肉酥：標了' },
    ],
    shouldMiss: [
      { name: '假：正確', test: REAL_TEST, expect: REAL_LINE },
      { name: '假：原始碼裡照字寫著的那一段', test: 'fake-a2', expect: '：標了 ' },
      { name: '假：沒帶 expect', test: REAL_TEST },
    ],
  }, 'A2（對照）expect 檢查抓得到打錯字、空字串、測試不存在、插值後的字，也不會誤殺正確的');
  // 沒帶 expect 的只准變少：新突變一律帶 expect
  const missing = MUTS.length - withExpect.length;
  ok(missing <= EXPECT_MISSING_MAX && missingExpectOverLimit(MUTS) === null,
    `A3 沒帶 expect 的突變 ${missing} 條（上限 ${EXPECT_MISSING_MAX}，只准變少）`);
  detects((ms) => missingExpectOverLimit(ms, 2) !== null, {
    shouldHit: [[{}, {}, {}], [{ expect: 'x' }, {}, {}, {}]],
    shouldMiss: [[{}, {}], [{ expect: 'x' }, {}, {}], []],
  }, 'A3（對照）上限 2：沒帶 expect 的有 3 條 → 擋；2 條或更少 → 放行');
  // 回傳值：有過期時一定要回非 0（接在 && 後面的指令才擋得住）。把腳本複製到暫存資料夾、餵一份假的突變清單實際執行
  const runIn = (mutationsLiteral) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-checkmut-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(ROOT, 'scripts/checkmutations.mjs'), path.join(dir, 'scripts/checkmutations.mjs'));
    fs.writeFileSync(path.join(dir, 'scripts/mutationtest.mjs'), `const MUTATIONS = [\n${mutationsLiteral}\n];\n`);
    fs.writeFileSync(path.join(dir, 'scripts/faketest.mjs'), 'ok(x, "A2 假的斷言訊息");\n');
    fs.writeFileSync(path.join(dir, 'target.txt'), 'alpha beta\n');
    try { lastOut = execFileSync(process.execPath, [path.join(dir, 'scripts/checkmutations.mjs')], { cwd: dir, encoding: 'utf8' }); return 0; }
    catch (e) { lastOut = String(e.stdout ?? ''); return e.status ?? -1; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  let lastOut = '';
  const good = "{ name: 'g', file: 'target.txt', find: 'alpha', replace: 'omega', test: 'faketest', expect: 'A2 假的斷言訊息' },";
  const badExpect = "{ name: 'b', file: 'target.txt', find: 'alpha', replace: 'omega', test: 'faketest', expect: 'A2 打錯的訊息' },";
  eq([runIn(good), runIn(badExpect)], [0, 1], 'A4 checkmutations 的回傳值：乾淨 → 0；有一條 expect 找不到 → 非 0');
  // A5「find 要剛好出現一次」那一段（2026-09-24 v9 盤點：把它改壞、再讓一條 find 過期，checkmutations 照樣回 0、doctest 全綠——沒有對照組）。
  // 比對理由，不只看回傳值：這兩條的 expect 都是對的，只有 find 那一段會讓它不通過
  const badFind = "{ name: 'f', file: 'target.txt', find: 'gamma', replace: 'omega', test: 'faketest', expect: 'A2 假的斷言訊息' },";
  const rcMissing = runIn(badFind); const outMissing = lastOut;
  ok(rcMissing !== 0 && outMissing.includes('find 出現 0 次') && !outMissing.includes('expect'),
    `A5 checkmutations：find 在目標檔裡找不到 → 非 0，理由是「find 出現 0 次」（回傳 ${rcMissing}）`);
  const twiceFind = "{ name: 't', file: 'target.txt', find: 'a', replace: 'o', test: 'faketest', expect: 'A2 假的斷言訊息' },";
  const rcTwice = runIn(twiceFind); const outTwice = lastOut;
  ok(rcTwice !== 0 && /find 出現 [2-9] 次/.test(outTwice), `A5 checkmutations：find 出現不只一次 → 非 0，理由是「find 出現 N 次」（回傳 ${rcTwice}）`);
}

section('assertaudit 的母體＝測試鏈（2026-09-24，Yolin 選 A）：丟一個工具進 scripts/ 不會被當成測試');
{
  // 以前是「scripts/*.mjs 扣掉略過清單」：新工具沒進略過清單就紅，而 assertaudit 只在全面檢測才跑——
  // 2026-09-19 sincefull.mjs、2026-09-24 selfcheck.mjs 各漏一次。這一段在 doctest 裡，每一版都跑得到。
  const scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => !f.startsWith('.'));
  const targets = auditTargets(pkg, scriptFiles);
  eq(targets.length, 26, `T1 assertaudit 要掃的＝測試鏈的 ${targets.length} 支（package.json）`);
  everyOf(targets, (f) => scriptFiles.includes(f), 'T1 測試鏈登記的每一支測試檔都存在');
  // 新行為：scripts/ 底下真的有的工具，不會被當成測試
  const TOOLS = ['selfcheck.mjs', 'sincefull.mjs', 'checkmutations.mjs', 'build-recipes.mjs'];
  ok(TOOLS.every((f) => scriptFiles.includes(f)), `（前提）這幾支工具真的在 scripts/ 底下：${TOOLS.join('、')}`);
  noneOf(TOOLS, (f) => targets.includes(f), 'T2 scripts/ 底下的工具不會被 assertaudit 當成測試');
  // 合成的：往 scripts/ 丟一支新工具——它不會變成要掃的測試
  const fakePkg = { scripts: { test: 'node scripts/alphatest.mjs && node scripts/betatest.mjs' } };
  eq(auditTargets(fakePkg, ['alphatest.mjs', 'betatest.mjs', 'newtool.mjs']), ['alphatest.mjs', 'betatest.mjs'],
    'T2（合成）丟一支 newtool.mjs 進 scripts/ → 要掃的仍然只有測試鏈那兩支');
  // 孤兒：檔名像測試、卻沒登記進測試鏈（新測試忘了登記，npm test 不會跑）
  eq(orphanTests(pkg, scriptFiles), [], 'T3 沒有孤兒測試（mutationtest 刻意不在鏈裡，除外）');
  detects((files) => orphanTests(fakePkg, files).length > 0, {
    shouldHit: [['alphatest.mjs', 'gammatest.mjs'], ['betatest.mjs', 'deltatest.mjs', 'newtool.mjs']],
    shouldMiss: [['alphatest.mjs', 'betatest.mjs'], ['alphatest.mjs', 'newtool.mjs'], ['mutationtest.mjs', 'betatest.mjs']],
  }, 'T3（對照）沒登記的 *test.mjs 抓得到；工具與 mutationtest 不算孤兒');
}

section('F8 產資料的工具：資料不見、壞掉、變少時停下、點名單位（2026-09-24；每版驗純函式，整套矩陣見 scripts/buildguard-verify.mjs）');
{
  // build-recipes：0 道、上一版有這次沒有的逐道點名；--allow-shrink 才放行
  const prevR = { recipes: [{ id: 'r-a', name: '甲' }, { id: 'r-b', name: '乙' }] };
  ok(outputProblems([], null).some((l) => l.includes('0 道')), 'F8-1 build-recipes：0 道 → 停，理由「0 道」');
  const shrinkR = outputProblems([{ id: 'r-a', name: '甲' }], prevR);
  ok(shrinkR.length === 1 && shrinkR[0].includes('r-b') && !shrinkR[0].includes('r-a'), `F8-2 build-recipes：上一版有 r-b、這次沒有 → 點名 r-b（${shrinkR.join('；')}）`);
  eq(outputProblems([{ id: 'r-a', name: '甲' }], prevR, { allowShrink: true }), [], 'F8-2（對照）加 --allow-shrink → 放行');
  const realR = JSON.parse(read('data/recipes.json'));
  eq(outputProblems(realR.recipes, realR), [], `F8-3（真實資料不誤擋）現有 ${realR.recipes.length} 道對現有的 recipes.json → 沒有問題`);
  // build-foods：0 列、必要欄位找不到、營養素沒有值、分類整個不見、食材變少
  const fullRow = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, 'x']));
  ok(rawProblems([]).some((l) => l.includes('0 列')), 'F8-4 build-foods：原始資料 0 列 → 停，理由「0 列」');
  for (const fld of REQUIRED_FIELDS) {
    const { [fld]: _, ...rest } = fullRow;
    const p = rawProblems([rest, rest]);
    ok(p.length === 1 && p[0].includes(`「${fld}」`), `F8-4 build-foods：欄位「${fld}」一列都找不到 → 點名它`);
  }
  eq(rawProblems([fullRow]), [], 'F8-4（對照）六個欄位都在 → 沒有問題');
  const order = nutrientOrder();
  const food = (id, cat, n = order.map(() => 1)) => ({ id, cat, n });
  ok(foodsProblems([], null).some((l) => l.includes('0 種')), 'F8-5 build-foods：轉出 0 種食材 → 停');
  const labels = Object.fromEntries(Object.entries(NUTRIENT_KEYS).map(([label, key]) => [key, label]));
  order.forEach((key, i) => {
    const p = foodsProblems([food('A1', '甲類', order.map((_, j) => (j === i ? null : 1)))], null);
    ok(p.length === 1 && p[0].includes(`「${labels[key]}」`), `F8-5 build-foods：營養素「${labels[key]}」一種食材都沒有值 → 點名它`);
  });
  const prevF = { foods: [food('A1', '甲類'), food('B1', '乙類')] };
  const gone = foodsProblems([food('A1', '甲類')], prevF);
  ok(gone.some((l) => l.includes('「乙類」')) && gone.some((l) => l.includes('少了 1 種') && l.includes('B1')), `F8-5 build-foods：乙類整個不見、少了 B1 → 兩件都點名（${gone.join('；')}）`);
  eq(foodsProblems([food('A1', '甲類')], prevF, { allowShrink: true }), [], 'F8-5（對照）加 --allow-shrink → 放行');
  const realF = JSON.parse(read('data/foods.json'));
  eq(foodsProblems(realF.foods, realF), [], `F8-6（真實資料不誤擋）現有 ${realF.foods.length} 種食材對現有的 foods.json → 沒有問題`);
  // F8-7 寫檔那一步也要能失敗、而且不中斷（2026-09-24 補充說明四）：用假的 fs 造三種失敗，stop 要被叫到、例外不能漏出來
  const fakeFs = ({ write, rename, rm, exists }) => {
    const calls = [];
    return { calls, writeFileSync: (p) => { calls.push('write'); if (write) throw new Error(write); },
      renameSync: () => { calls.push('rename'); if (rename) throw new Error(rename); },
      rmSync: () => { calls.push('rm'); if (rm) throw new Error(rm); }, existsSync: () => exists };
  };
  const tryWrite = (opts) => {
    const fx = fakeFs(opts); let stopped = null; let leaked = null;
    try { writeAtomically('/x/data/recipes.json', '{}', (lines) => { stopped = lines; }, fx); } catch (e) { leaked = e.message; }
    return { stopped, leaked, calls: fx.calls };
  };
  const w1 = tryWrite({ write: 'EISDIR', exists: true });
  ok(w1.leaked === null && w1.stopped?.some((l) => l.includes('recipes.json.tmp') && l.includes('已經有東西')) && !w1.calls.includes('rm'),
    `F8-7 暫存檔的位置本來就有東西（寫不進去）→ 點名那個位置、不去刪不是自己寫的東西、例外沒漏出來（${(w1.stopped ?? []).join('；')}｜呼叫 ${w1.calls.join(',')}｜漏出 ${w1.leaked}）`);
  const w2 = tryWrite({ rename: 'EPERM', rm: 'EBUSY' });
  ok(w2.leaked === null && w2.stopped?.some((l) => l.includes('失敗：EPERM')) && w2.stopped?.some((l) => l.includes('刪不掉') && l.includes('EBUSY')),
    `F8-7 換上失敗、清理也失敗（檔被鎖住）→ 兩件都點名、不中斷（${(w2.stopped ?? []).join('；')}｜漏出 ${w2.leaked}）`);
  const w3 = tryWrite({});
  ok(w3.stopped === null && w3.leaked === null && w3.calls.join(',') === 'write,rename', 'F8-7（對照）都成功 → 不叫 stop、寫了再換上');
  // F8-8 驗法的判準（只在錯誤訊息的位置找點名；兩個方向的對照組）每版都跑，不等手動跑矩陣才發現壞了
  const bgc = bgControls();
  ok(bgc.length >= 10 && bgc.every((c) => c.ok), `F8-8 buildguard 驗法的對照組 ${bgc.filter((c) => c.ok).length}/${bgc.length} 對（${bgc.filter((c) => !c.ok).map((c) => c.label).join('；') || '全對'}）`);
  ok(names('處理 r-foo.json …\n✗ 沒有寫檔：\n  - 一道食譜都沒有（0 道）', 'r-foo') === false,
    'F8-8 只出現在正常進度訊息裡的單位名，不算點名（「出現過」不等於「是理由」）');
  // F8-9 登記制（推送閘門第零關之二）：只有「HEAD、全跑、全擋、途中 HEAD 沒動、工作區三支＝HEAD」才登記
  const ok0 = { only: null, fail: 0, isHead: true, headMoved: false, dirty: [] };
  eq(bgDecide(ok0).action, 'register', 'F8-9（對照）HEAD、全跑、全擋、工作區乾淨 → 登記');
  eq(bgDecide({ ...ok0, isHead: false }).action, 'keep', 'F8-9 --rev 不是 HEAD → 不登記、不動現有的登記（證明的是別的版本）');
  eq(bgDecide({ ...ok0, only: 'recipes' }).action, 'keep', 'F8-9 只跑一部分（--only）→ 不登記');
  eq(bgDecide({ ...ok0, fail: 1 }).action, 'delete', 'F8-9 HEAD 沒全擋 → 刪掉登記（閘門會擋下）');
  eq(bgDecide({ ...ok0, headMoved: true }).action, 'delete', 'F8-9 跑的途中 HEAD 動了 → 不登記、刪掉舊登記');
  eq(bgDecide({ ...ok0, dirty: ['scripts/build-foods.mjs'] }).action, 'delete', 'F8-9 工作區的 build 跟 HEAD 不一樣 → 不登記、刪掉舊登記（F9 第 1 點）');
  eq([...BG_FILES].sort(), ['scripts/build-foods.mjs', 'scripts/build-recipes.mjs', 'scripts/buildguard-verify.mjs'],
    'F8-9 登記的三支＝兩支 build＋驗法本身（閘門第零關之二比對的就是這三支）');
  // F8-10 常設情境（Dispatch 2026-09-24：「證據裡實跑過」不等於「有常設情境守著」）：
  // 從驗法實際走的那一步（finalizeRegistration）進來，在暫時的 git repo 造「被守的檔工作區有改動」→ 必須沒有登記、舊登記被刪。
  // 缺口的形狀（統籌者在 JLPT 查到）：「工作區跟 HEAD 不一樣」那段一律當成沒改動 → 驗的是工作區、登記的是 HEAD，HEAD 那一版從沒被驗過卻被登記。
  const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const regRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bgreg-'));
  gitIn(regRepo, 'init', '-q');
  for (const f of BG_FILES) { fs.mkdirSync(path.dirname(path.join(regRepo, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(regRepo, f)); }
  gitIn(regRepo, 'add', '-A');
  gitIn(regRepo, '-c', 'user.name=probe', '-c', 'user.email=probe@users.noreply.github.com', 'commit', '-q', '-m', 'probe');
  const regHead = gitIn(regRepo, 'rev-parse', 'HEAD');
  const regFile = path.join(regRepo, BG_REG);
  // 另一個來源（ls-tree）算出 HEAD 裡的 blob，拿來跟登記比——不拿登記程式自己用的 rev-parse 跟自己比
  const lsTree = Object.fromEntries(gitIn(regRepo, 'ls-tree', '-r', 'HEAD').split('\n').map((l) => { const [meta, name] = l.split('\t'); return [name, meta.split(' ')[2]]; }));
  const fin = () => finalizeRegistration(regRepo, { only: null, fail: 0, revFull: regHead, headAtStart: regHead });
  const clean = fin();
  const regText = fs.existsSync(regFile) ? fs.readFileSync(regFile, 'utf8') : '';
  ok(clean.action === 'register' && regText === BG_FILES.map((f) => `${f} ${lsTree[f]}\n`).join('') && BG_FILES.every((f) => /^[0-9a-f]{40}$/.test(lsTree[f] ?? '')),
    `F8-10（對照）工作區跟 HEAD 一樣 → 登記，內容＝HEAD 裡三支的 blob（用 ls-tree 另外算來比）（${clean.action}）`);
  fs.writeFileSync(regFile, 'scripts/build-foods.mjs 舊登記\n');
  fs.appendFileSync(path.join(regRepo, 'scripts/build-foods.mjs'), '\n// 工作區改一行、沒 commit\n');
  const workBlob = gitIn(regRepo, 'hash-object', 'scripts/build-foods.mjs');
  ok(fs.existsSync(regFile) && workBlob !== lsTree['scripts/build-foods.mjs'],
    '（前提）F8-10 的情境真的造成了：舊登記在、工作區的 build-foods 跟 HEAD 裡的 blob 不一樣（兩個不同的來源）');
  const dirtyRun = fin();
  ok(dirtyRun.action === 'delete' && !fs.existsSync(regFile),
    `F8-10 被守的檔工作區有改動時跑完驗法 → 沒有登記、舊登記被刪（${dirtyRun.action}｜${dirtyRun.why}）`);
  fs.rmSync(regRepo, { recursive: true, force: true });
  // F8-11「A 跟 B 一樣」要先證明是兩個不同的來源：比對模式拿同一個版本的兩份 log（或同一份比兩次）要判失敗
  const cmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bgcmp-'));
  const logOf = (v) => `版本 ${v}｜build-recipes sha=x\nbuild-recipes｜刪掉那一道｜3 格｜擋 3｜沒擋 0（其中…）\n`;
  fs.writeFileSync(path.join(cmpDir, 'a.log'), logOf('aaaaaaa')); fs.writeFileSync(path.join(cmpDir, 'b.log'), logOf('bbbbbbb'));
  const quiet = console.log; console.log = () => {};
  let cmpSelf, cmpDiff;
  try { cmpSelf = bgCompare(path.join(cmpDir, 'a.log'), path.join(cmpDir, 'a.log')); cmpDiff = bgCompare(path.join(cmpDir, 'a.log'), path.join(cmpDir, 'b.log')); }
  finally { console.log = quiet; }
  ok(cmpSelf === 1 && cmpDiff === 0, `F8-11 比對模式：同一份 log 比兩次 → 判失敗（${cmpSelf}）；兩個不同版本 → 通過（${cmpDiff}）`);
  // F8-12 失敗分支（F10）：登記那一步讀不到雜湊 → 刪掉登記（故障時停下，不是放行、也不是留著舊登記）。
  // 造法：外部依賴（git）從參數來的 repo 路徑進來——給一個不是 git repo 的資料夾，git 自然失敗；不在程式裡留後門
  const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bgnogit-'));
  fs.mkdirSync(path.join(noGit, '.logs'), { recursive: true });
  fs.writeFileSync(path.join(noGit, BG_REG), 'scripts/build-foods.mjs 舊登記\n');
  let gitFails = false;
  try { execFileSync('git', ['-C', noGit, 'rev-parse', 'HEAD'], { stdio: 'ignore' }); } catch { gitFails = true; }
  ok(gitFails && fs.existsSync(path.join(noGit, BG_REG)), '（前提）F8-12 的情境真的造成了：那個資料夾裡 git 會失敗、舊登記在');
  const noGitRun = finalizeRegistration(noGit, { only: null, fail: 0, revFull: 'x', headAtStart: 'x' });
  ok(noGitRun.action === 'delete' && !fs.existsSync(path.join(noGit, BG_REG)) && noGitRun.why.startsWith('讀不到雜湊'),
    `F8-12 登記那一步讀不到雜湊 → 刪掉登記、理由講明（${noGitRun.action}｜${noGitRun.why.slice(0, 5)}…）`);
  fs.rmSync(noGit, { recursive: true, force: true });
  fs.rmSync(cmpDir, { recursive: true, force: true });
  const gateSrc = read('scripts/pushgate.sh');
  ok(BG_FILES.every((f) => gateSrc.includes(f)) && gateSrc.includes(BG_REG) && /exit 5/.test(gateSrc),
    `F8-9 推送閘門比對同樣三支、同一個登記檔（${BG_REG}），對不上回 5`);
}

section('F1 必敗對照組：斷言函式、執行器、稽核器（2026-09-24，SPEC_檢查器修補；每版都跑）');
{
  // 每一種情境寫成一支小腳本、開子程序跑（跟 doctest 自己的計數分開）；比對回傳值與理由。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-f1-'));
  const tapUrl = new URL('./tap.mjs', import.meta.url).href;
  const probe = (name, body) => { const p = path.join(dir, `${name}.mjs`); fs.writeFileSync(p, `import { ok, eq, everyOf, noneOf, detects, done } from '${tapUrl}';\n${body}\n`); return p; };
  // 探針是對照組，不是測試：拿掉 MM_AUDIT，免得 assertaudit 跑 doctest 時，探針故意寫的空母體被記進 assert-audit.jsonl、
  // 冒充成真的測試斷言（2026-09-24 完整 assertaudit 抓到：「沒有任何 everyOf／noneOf 的母體是空的」紅了）
  const probeEnv = () => { const e = { ...process.env }; delete e.MM_AUDIT; delete e.MM_AUDIT_OUT; return e; };
  const runP = (cmd, args, opts = {}) => {
    try { return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: probeEnv(), ...opts }) }; }
    catch (e) { return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
  };
  const cases = [
    ['F1-1（對照）全部通過', "ok(1 === 1, 'a');\ndone('probe');", 0, 'probe：1 項通過'],
    ['F1-2 一條一定失敗的斷言', "ok(1 === 2, '一定失敗');\ndone('probe');", 1, '1 項失敗'],
    ['F1-3 everyOf 母體是空的', "everyOf([], (x) => x, '空母體');\ndone('probe');", 1, '母體是空的'],
    ['F1-4 noneOf 母體是空的', "noneOf([], (x) => x, '空母體');\ndone('probe');", 1, '母體是空的'],
    ['F1-5 detects 沒給正例', "detects((x) => x, { shouldHit: [], shouldMiss: [0] }, '沒正例');\ndone('probe');", 1, '沒有給正例'],
    ['F1-6 一條斷言都沒有就結束', "done('probe');", 1, '一條斷言都沒有跑到'],
    ['F1-7 第一條斷言之前就崩掉', "throw new Error('寫出結果前就崩掉');", 1, '寫出結果前就崩掉'],
    ['F1-8 做到一半崩掉（沒走到 done）', "ok(1 === 1, 'a');\nthrow new Error('做到一半崩掉');", 1, '做到一半崩掉'],
  ];
  for (const [label, body, wantCode, reason] of cases) {
    const r = runP(process.execPath, [probe(label.replace(/[^\w]/g, '_'), body)]);
    const saysPass = wantCode !== 0 && /：\d+ 項通過\s*$/.test(r.out.trim());   // 失敗時不能印成「N 項通過」（訊息不能說反）
    ok(r.code === wantCode && r.out.includes(reason) && !saysPass, `${label}：回傳 ${r.code}（預期 ${wantCode}），理由含「${reason}」`);
  }
  // F1-12 探針不能寫進斷言紀錄：暫時讓本程序帶著 MM_AUDIT=1（就像 assertaudit 跑 doctest 時），跑一個故意寫空母體的探針，
  // 紀錄檔不能出現（2026-09-24 修正前：完整 assertaudit 紅在「沒有任何 everyOf／noneOf 的母體是空的」）
  {
    const auditFile = path.join(dir, 'probe-audit.jsonl');
    const saved = { a: process.env.MM_AUDIT, o: process.env.MM_AUDIT_OUT };
    process.env.MM_AUDIT = '1'; process.env.MM_AUDIT_OUT = auditFile;
    const r = runP(process.execPath, [probe('audit_leak', "everyOf([], (x) => x, '空母體');\ndone('probe');")]);
    if (saved.a === undefined) delete process.env.MM_AUDIT; else process.env.MM_AUDIT = saved.a;
    if (saved.o === undefined) delete process.env.MM_AUDIT_OUT; else process.env.MM_AUDIT_OUT = saved.o;
    ok(r.code === 1 && r.out.includes('母體是空的') && !fs.existsSync(auditFile),
      `F1-12 探針不會把斷言寫進 assert-audit 紀錄（探針回 ${r.code}；紀錄檔${fs.existsSync(auditFile) ? '出現了' : '沒出現'}）`);
  }
  // 執行器：npm test 是 && 鏈——一支失敗，後面不跑、整條鏈回非 0
  const next = path.join(dir, 'next.mjs'); fs.writeFileSync(next, "console.log('NEXT_RAN');\n");
  const chain = runP('bash', ['-c', `node "${probe('chain_fail', "ok(1 === 2, 'x');\ndone('probe');")}" && node "${next}"`]);
  ok(chain.code !== 0 && !chain.out.includes('NEXT_RAN'), `F1-9 執行器（&& 鏈）：一支有失敗的斷言 → 後面那一支沒跑、鏈回 ${chain.code}`);
  // 稽核器：checkmutations 的突變清單是空的 → 判失敗（不是 0 個過期）
  const cm = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-f1cm-'));
  fs.mkdirSync(path.join(cm, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts/checkmutations.mjs'), path.join(cm, 'scripts/checkmutations.mjs'));
  fs.writeFileSync(path.join(cm, 'scripts/mutationtest.mjs'), 'const MUTATIONS = [\n];\n');
  const cme = runP(process.execPath, [path.join(cm, 'scripts/checkmutations.mjs')], { cwd: cm });
  ok(cme.code !== 0 && cme.out.includes('突變清單是空的'), `F1-10 稽核器（checkmutations）：突變清單是空的 → 回 ${cme.code}，理由「突變清單是空的」`);
  // 執行器：mutationtest 的 --only 對不到任何突變 → 判失敗（不是「0 條都紅了」）。
  // 在 scripts/ 的暫存複本裡跑，不在 repo 裡跑：mutationtest 一啟動就 recoverPending()——外層正在跑突變時，
  // 它會把外層改壞的檔「還原」並刪掉 pending，doctest 後面的斷言就對著沒改壞的程式跑（2026-09-24 寫這一條時查到的）
  const mtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-f1mt-'));
  fs.mkdirSync(path.join(mtRoot, 'scripts'));
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) {
    if (/\.m?js$/.test(f)) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(mtRoot, 'scripts', f));
  }
  ok(!fs.existsSync(path.join(mtRoot, 'scripts/.mutation-pending.json')), '（前提）暫存複本裡沒有 pending 檔（碰不到 repo 裡那一份）');
  const mt = runP(process.execPath, [path.join(mtRoot, 'scripts/mutationtest.mjs'), '--only', 'F1探針：不會對到任何突變的關鍵字'], { cwd: mtRoot });
  fs.rmSync(mtRoot, { recursive: true, force: true });
  ok(mt.code !== 0 && /選了 0 條突變/.test(mt.out), `F1-11 執行器（mutationtest）：--only 對不到任何突變 → 回 ${mt.code}，理由「選了 0 條突變」`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(cm, { recursive: true, force: true });
}

section('assertaudit 的靜態掃描（auditrules）：每版都跑、附對照組（2026-09-24，v9 盤點第 3 件）');
{
  // 以前這幾段只在全面檢測才跑、也沒有對照組（v9 盤點實測：把常數述詞的樣式改壞，assertaudit 照樣全過）
  const scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => !f.startsWith('.'));
  const targets = auditTargets(pkg, scriptFiles);
  const srcs = targets.map((f) => [f, fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')]);
  const lineCount = srcs.reduce((n, [, s]) => n + s.split('\n').length, 0);
  ok(srcs.length === 26 && lineCount > 10000, `（母體）掃測試鏈 ${srcs.length} 支、${lineCount} 行`);
  for (const [name, fn] of Object.entries(STATIC_RULES)) {
    eq(srcs.flatMap(([f, s]) => fn(s, f)), [], `S1 ${name}：測試鏈 26 支都沒有這種寫法`);
  }
  // 對照組：樣本當場拼出來——原始碼裡照字寫出壞寫法的話，這一段會掃到 doctest 自己
  const BS1 = String.fromCharCode(92);
  const cases = {
    constPredHits: { label: 'S2（對照）常數述詞：', hit: ['every' + 'Of(xs, () => tr' + 'ue, "m");', 'none' + 'Of(xs, (x) => fal' + 'se, "m");'], miss: ['every' + 'Of(xs, (x) => x > 0, "m");', 'const f = () => true;'] },
    okTrueHits: { label: 'S2（對照）ok(true)：', hit: ['ok(' + 'true, "說明");', 'ok( ' + 'true , "x")'], miss: ['ok(value === true, "m");', 'note("說明");'] },
    eqSameHits: { label: 'S2（對照）eq(x, x)：', hit: ['eq(' + 'foo.bar, foo.bar, "m");'], miss: ['eq(' + 'foo.bar, foo.baz, "m");', 'eq(' + 'a.b, 1, "m");'] },
    doubledEscapeHits: { label: 'S2（對照）雙反斜線：', hit: ['const r = /a' + BS1 + BS1 + 's+b/;', 'x.replace(/' + BS1 + BS1 + 'd/g, "")'],
      miss: ['const r = /a' + BS1 + 's+b/;', '// 註解裡講 ' + BS1 + BS1 + 's 不算', "const q = /[^'" + BS1 + BS1 + BS1 + "n]/;"] },
  };
  for (const [name, { label, hit, miss }] of Object.entries(cases)) {
    detects((s) => STATIC_RULES[name](s, 'x').length > 0, { shouldHit: hit, shouldMiss: miss }, `${label}${name} 該抓的抓到、正常寫法不抓`);
  }
}

section('自查的失敗分支（F10 第 1b 點：node 呼叫的 git；每版都跑）');
{
  // 「執行 git」從參數傳進去：真的 git 造不出「抽取對不上」「取不到訊息與作者欄」，用假的 runner 造
  const fakeRunner = ({ diff, numstat, meta, throwOn = null }) => (args) => {
    if (throwOn && args.includes(throwOn)) throw new Error('假的 git 失敗');
    if (args[0] === 'rev-list') return 'c1\n';
    if (args.includes('-p')) return diff;
    if (args.includes('--numstat')) return numstat;
    if (args[0] === 'log') return meta;
    throw new Error(`假的 runner 沒準備這一種：${args.join(' ')}`);
  };
  const DIFF1 = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -0,0 +1 @@\n+乾淨的一行\n';
  const META1 = 'probe\nprobe <probe@users.noreply.github.com>\nprobe <probe@users.noreply.github.com>\n';
  const good = { diff: DIFF1, numstat: '1\t0\tf\n', meta: META1 };
  const runSc = (opts) => { const lines = []; const res = selfcheck('x..y', fakeRunner(opts), (l) => lines.push(l)); return { res, text: lines.join('\n') }; };
  const sc0 = runSc(good);
  ok(sc0.res === true && sc0.text.includes('查了：commit 1 個；新增行 1 行（numstat 1 行）') && sc0.text.includes('自查通過'),
    'SC-0（對照）假的 runner 輸出一致 → 自查通過（證明假 runner 本身沒把自查弄壞）');
  const sc1 = runSc({ ...good, numstat: '2\t0\tf\n' });
  ok(sc1.res === false && sc1.text.includes('抽取壞了：抽出的新增行 1 行，numstat 是 2 行') && !sc1.text.includes('命中｜'),
    'SC-1 抽出的新增行數跟 numstat 對不上 → 判不通過，理由是「抽取壞了」（不是「有命中」）');
  const sc2 = runSc({ ...good, meta: '' });
  ok(sc2.res === false && sc2.text.includes('取不到 commit 訊息與作者欄'),
    'SC-2 範圍裡有 commit、卻取不到訊息與作者欄 → 判不通過，理由講明');
  let sc3 = 'returned';
  try { sc3 = selfcheck('x..y', fakeRunner({ ...good, throwOn: '-p' }), () => {}) ? 'returned-true' : 'returned-false'; } catch { sc3 = 'threw'; }
  eq(sc3, 'threw', 'SC-3 取 diff 的 git 失敗 → 例外丟出去（CLI 以未處理例外結束、回非 0），不是當成空的通過');
  // SC-4 真的 git 失敗（F10 第 1b 點第 1 步：不存在的範圍；程式裡沒有為測試開的分支）。
  // 2026-09-25 以前用 GIT_DIR 造——自查加了入口拒絕之後，GIT_DIR 會在入口就被擋掉，這條照樣綠但理由變了，所以改造法、並斷言理由不是入口拒絕
  const pre = spawnSync('git', ['rev-list', 'no-such-ref-for-sc4..HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const ctl = spawnSync(process.execPath, ['scripts/selfcheck.mjs', '--range', 'HEAD~1..HEAD'], { cwd: ROOT, encoding: 'utf8' });
  ok(pre.status !== 0 && ctl.status === 0 && ctl.stdout.includes('自查通過'),
    `（前提）SC-4：不存在的範圍真的 git 會失敗（回傳 ${pre.status}）；正常範圍同一行自查照常通過（回傳 ${ctl.status}）`);
  const sc4 = spawnSync(process.execPath, ['scripts/selfcheck.mjs', '--range', 'no-such-ref-for-sc4..HEAD'], { cwd: ROOT, encoding: 'utf8' });
  ok(sc4.status !== 0 && !sc4.stdout.includes('自查通過') && !sc4.stdout.includes('【擋下：執行環境】'),
    `SC-4 真的 git 失敗 → 自查回非 0（${sc4.status}）、沒有印「自查通過」，理由不是入口拒絕`);
  // SC-5 node 這一層的入口拒絕（補充說明十一第 4 點）：前綴、不分大小寫、只放行三個；長得像的（GITHUB_）不攔
  eq(gitEnvProblems({ GIT_DIR: '', GIT_EDITOR: 'vim', Git_Pager: 'less', GITHUB_TOKEN: 't', git_exec_path: 'x', PATH: '/bin' }), ['GIT_DIR', 'git_exec_path'],
    'SC-5 自查的入口拒絕：GIT_ 開頭的（空字串、小寫也算）要攔；放行清單（不分大小寫）與只是長得像的 GITHUB_ 不攔');
  // SC-6 從真實入口：列舉寫法會漏的 GIT_EXEC_PATH，自查在入口就停
  const sc6 = spawnSync(process.execPath, ['scripts/selfcheck.mjs', '--range', 'HEAD~1..HEAD'], { cwd: ROOT, env: { ...process.env, GIT_EXEC_PATH: path.join(os.tmpdir(), 'mm-no-such-exec') }, encoding: 'utf8' });
  ok(sc6.status !== 0 && sc6.stdout.includes('【擋下：執行環境】GIT_EXEC_PATH') && !sc6.stdout.includes('查了：'),
    `SC-6 設了 GIT_EXEC_PATH 跑自查 → 入口就停（回傳 ${sc6.status}）、點名它、沒開始查`);
}

section('推送閘門、自查、驗法的壞寫法掃描（gatescan；共用慣例 v9 §5.16，每版都跑）');
{
  // G1 從真實入口跑：回傳值 0、對照組每一種都抓到、查的檔數正確（0 命中要附查了多少）
  let g1 = { code: 0, out: '' };
  try { g1.out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/gatescan.mjs')], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { g1 = { code: e.status ?? -1, out: String(e.stdout ?? '') }; }
  const ctlLines = g1.out.split('\n').filter((l) => l.startsWith('對照組｜') && !l.startsWith('對照組｜env-read｜'));
  const envCtlLine = g1.out.split('\n').find((l) => l.startsWith('對照組｜env-read｜')) ?? '';
  ok(g1.code === 0 && ctlLines.length === 7 && ctlLines.every((l) => /｜(\d+)\/\1 抓到$/.test(l)) && /^對照組｜env-read｜(\d+)\/\1 對$/.test(envCtlLine) && g1.out.includes('查了：3 支檔案'),
    `G1 gatescan 通過：回傳 ${g1.code}、對照組 ${ctlLines.length} 種全部抓到、讀環境變數的對照組「${envCtlLine.slice(4)}」、${(/查了：[^；]*/.exec(g1.out) ?? ['（沒有「查了」）'])[0]}`);
  // G2 每一種寫法：該抓的抓到、不該抓的不抓（反例含 2026-09-24 被誤報的那一行）
  const S = controlSamples();
  const hitsId = ([id, text]) => scanText(text).some((h) => h.id === id);
  detects(hitsId, {
    shouldHit: Object.entries(S).flatMap(([id, list]) => list.map((t) => [id, t])),
    shouldMiss: [
      ['pipe', 'git push -q origin main'], ['pipe', 'git fetch -q origin main || exit 1'],
      ['or-true', 'git push -q origin main || exit 2'],
      ['empty-catch', 'catch (e) { check = String(e.stdout); }'],
      ['plus3-header', "if (inHunk && l.startsWith('+')) out.push(l.slice(1));"],
      ['absence', 'ok(fs.existsSync(p), "在")'],
      ['shell-regex', 'printf "%s\\n" "$NS" | grep -qE "^[1-9]"'],
      ['pipe', '# 註解裡講 git push | tail 不算'],
      ['format-no-meta', "git log --format=%B%n%an <%ae> && git log -p --format= -U0"],
    ],
  }, 'G2（對照）七種壞寫法都抓得到；正確寫法、註解、2026-09-24 誤報過的那一行不抓');
  // G3 被掃的檔讀不到 → 停（不是 0 個問題）
  // 比對「為什麼」不通過（§5.11 第一層）：2026-09-24 第一版只看回傳值是 false——讀不到的時候，
  // 登記的例外也一條都沒用到，就算「讀不到就停」被拿掉，照樣是 false（突變證明它沒紅）
  // 暫存目錄不是 git repo：追蹤清單用走訪結果代替（跳脫掃描的孤兒核對另外在 G6 驗）
  const run = (root, listTracked = walkScripts) => { const lines = []; const res = main(root, (l) => lines.push(l), listTracked); return { res, text: lines.join('\n') }; };
  // 暫存目錄要放的檔：被掃的三支＋孤兒檢查、跳脫掃描登記了例外的（不放，例外用不到，原樣就不通過）
  const seedFiles = [...new Set([...TARGETS, ...ORPHAN_EXEMPT.map((e) => e.file), ...ESCAPE_EXEMPT.map((e) => e.file)])];
  const seed = (root) => { for (const rel of seedFiles) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel)); } };
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatescan-'));
  const g3 = run(emptyRoot);
  ok(g3.res === false && (g3.text.match(/讀不到或是空的：/g) ?? []).length === TARGETS.length,
    `G3 被掃的檔讀不到時，gatescan 判不通過、理由是「讀不到或是空的」（${(g3.text.match(/讀不到或是空的：/g) ?? []).length}/${TARGETS.length} 支）`);
  // G4 登記的例外沒用到 → 不通過（那一行改掉了，例外就該拿掉）
  const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatescan-'));
  // 孤兒檢查登記了例外的那兩支也要放：不放的話例外用不到，原樣就不通過（2026-09-24 加孤兒檢查時這條前提紅了才發現）
  seed(copyRoot);
  ok(run(copyRoot).res === true, '（前提）原樣複本 gatescan 通過');
  const gate = path.join(copyRoot, 'scripts/pushgate.sh');
  fs.writeFileSync(gate, fs.readFileSync(gate, 'utf8').replace('if [ ! -f "$REG" ]; then', 'if [ -z "$(cat "$REG" 2>/dev/null)" ]; then'));
  const g4 = run(copyRoot);
  // 比對指名到那一條例外的完整訊息：只比「登記的例外沒用到」的話，孤兒那邊的「孤兒的登記例外沒用到」也會讓它通過
  ok(g4.res === false && g4.text.includes('登記的例外沒用到（那一行改掉了？拿掉這條例外）｜scripts/pushgate.sh｜absence') && !g4.text.includes('命中｜'),
    'G4 登記的例外那一行改掉之後，gatescan 判不通過、理由是「登記的例外沒用到」（不是別的命中）');
  fs.rmSync(emptyRoot, { recursive: true, force: true }); fs.rmSync(copyRoot, { recursive: true, force: true });
  // G5 孤兒（v9 F4，每版都跑）：專案裡有推送指令、卻沒登記進掃描清單的腳本要報出來。
  // 暫存目錄放被掃的三支＋兩支登記了例外的，先確認基準通過；再丟一支沒登記的推送腳本，理由要點名它
  const orphanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatescan-'));
  seed(orphanRoot);
  ok(run(orphanRoot).res === true, '（前提）孤兒檢查的暫存目錄：原樣通過');
  fs.writeFileSync(path.join(orphanRoot, 'scripts/quickpush.sh'), '#!/usr/bin/env bash\ngit add -A && git commit -m wip\n' + 'git ' + 'push origin main\n');
  const g5 = run(orphanRoot);
  ok(g5.res === false && g5.text.includes('孤兒｜scripts/quickpush.sh'),
    'G5 丟一支有推送指令、卻沒登記的腳本 → gatescan 判不通過，理由點名那一支（孤兒｜scripts/quickpush.sh）');
  fs.rmSync(orphanRoot, { recursive: true, force: true });
  // G6 跳脫掃描擴到 repo 裡所有腳本（2026-09-24 補充說明四；以前只掃 TARGETS 三支）＋孤兒核對
  const escRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatescan-'));
  seed(escRoot);
  ok(run(escRoot).res === true, '（前提）跳脫掃描的暫存目錄：原樣通過');
  const BS = String.fromCharCode(92);
  fs.mkdirSync(path.join(escRoot, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(escRoot, 'tools/deploy.sh'), "#!/usr/bin/env bash\ngrep -E '^" + BS + "s+foo' out.txt\n");
  const g6a = run(escRoot);
  ok(g6a.res === false && g6a.text.includes('跳脫｜tools/deploy.sh:2'),
    'G6-1 跳脫掃描：不在 TARGETS、也不在 scripts/ 的腳本裡有 grep 樣式帶反斜線 → 判不通過，點名那一行（跳脫｜tools/deploy.sh:2）');
  fs.rmSync(path.join(escRoot, 'tools'), { recursive: true });
  const g6b = run(escRoot, (r) => [...walkScripts(r), 'node_modules/x/evil.sh']);
  ok(g6b.res === false && g6b.text.includes('跳脫掃描的孤兒｜node_modules/x/evil.sh'),
    'G6-2 跳脫掃描的孤兒：git 有追蹤、目錄走訪卻沒走到的腳本 → 判不通過，點名它');
  const g6c = run(escRoot, () => { throw new Error('not a git repository'); });
  ok(g6c.res === false && g6c.text.includes('跳脫掃描壞了：取不到 git 追蹤的檔案清單'),
    'G6-3 取不到 git 追蹤清單 → 判不通過、講明是檢查器壞了（不是 0 個孤兒）');
  fs.rmSync(escRoot, { recursive: true, force: true });
  // G6-5 真的 git 取不到追蹤清單（F10 第 1b 點第 1 步：GIT_DIR 指向不存在的目錄；G6-3 只驗了傳入會丟例外的函式）
  const gitDirBefore = process.env.GIT_DIR;
  let g6e;
  process.env.GIT_DIR = path.join(os.tmpdir(), 'mm-no-such-gitdir');
  try { g6e = escapeScan(ROOT); } finally { if (gitDirBefore === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = gitDirBefore; }
  const g6eCtl = escapeScan(ROOT);
  ok(g6e.ok === false && String(g6e.error).startsWith('取不到 git 追蹤的檔案清單') && g6eCtl.ok === true,
    `G6-5 真的 git 取不到追蹤清單 → 判成檢查器壞了；（對照）拿掉 GIT_DIR 照常通過（${g6eCtl.ok}）`);
  // G7 正式閘門讀了沒登記的環境變數（2026-09-25；起因：pushgate.sh 的 PUSHGATE_REMOTE，整個 repo 沒人用、設了會讓閘門對著別的遠端說通過）
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gatescan-'));
  seed(envRoot);
  ok(run(envRoot).res === true, '（前提）讀環境變數的暫存目錄：原樣通過');
  const gatePath = path.join(envRoot, 'scripts/pushgate.sh');
  const gateOrig = fs.readFileSync(gatePath, 'utf8');
  const knob = 'SOME_TEST' + '_KNOB';
  fs.writeFileSync(gatePath, gateOrig.replace('REMOTE=origin\n', `REMOTE="\${${knob}:-origin}"\n`));
  const g7a = run(envRoot);
  ok(g7a.res === false && g7a.text.includes(`讀環境變數｜scripts/pushgate.sh｜${knob}`),
    `G7-1 閘門讀了沒登記的環境變數（REMOTE="\${${knob}:-origin}"）→ 判不通過，點名那一支、那個變數`);
  fs.writeFileSync(gatePath, gateOrig.replace('REMOTE=origin\n', `${knob}="\${${knob}:-origin}"\nREMOTE="$${knob}"\n`));
  const g7b = run(envRoot);
  ok(g7b.res === false && g7b.text.includes(`讀環境變數｜scripts/pushgate.sh｜${knob}`),
    'G7-2 賦值那一行自己讀自己（X="${X:-預設}"）也算讀環境變數——只看「有沒有賦值」會躲過去');
  // G7-3 間接讀取（變數名不在字面上：process.env[k]、${!v}）→ 列成「(間接)」，沒登記就不通過（2026-09-25：閘門入口拒絕 GIT_DIR 用的正是這種讀法，原本掃描看不到）
  fs.writeFileSync(gatePath, gateOrig);
  const scPath = path.join(envRoot, 'scripts/selfcheck.mjs');
  fs.appendFileSync(scPath, "\nconst someKey = 'X';\nvoid process.env[" + 'someKey];\n');
  const g7c = run(envRoot);
  ok(g7c.res === false && g7c.text.includes('讀環境變數｜scripts/selfcheck.mjs｜(間接:process.env[變數])'),
    'G7-3 間接讀取環境變數（process.env[變數]）→ 判不通過、按分支列成「(間接:process.env[變數])」（自查登記過另一種間接讀法也照樣報）');
  fs.rmSync(envRoot, { recursive: true, force: true });
  // G8 對照樣本要打到每一個分支（補充說明十一第 3 點）：每條規則的「分支」行都要 n/n，而且要有 8 條（7 條寫法＋讀環境變數）
  const branchLines = g1.out.split('\n').filter((l) => l.startsWith('分支｜'));
  ok(branchLines.length === 8 && branchLines.every((l) => /｜(\d+)\/\1 各有只靠它的樣本$/.test(l)),
    `G8 每條規則的每個分支都有只靠它的對照樣本（拿掉那個分支就抓不到）：${branchLines.map((l) => l.split('｜').slice(1, 3).join(' ')).join('；')}`);
  const walked = /跳脫掃描：走了 (\d+) 支/.exec(g1.out);
  ok(walked && Number(walked[1]) >= 50, `G6-4 真實 repo：跳脫掃描走了 ${walked ? walked[1] : '（沒有這一行）'} 支腳本（母體要涵蓋 scripts/、js/、根目錄）`);
}

done('doctest');
