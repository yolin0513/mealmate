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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, everyOf, noneOf } from './tap.mjs';
import { FORBIDDEN } from './copyrules.mjs';
import { CONDITION_FIELDS, DIETS, DIET_LABELS, CONDITIONS, KIDNEY_FIELDS, BASE_DISPLAY_FIELDS } from '../js/members.js';
import { DEFAULTS, FONT_SCALES } from '../js/prefs.js';
import { DEFAULT_RULES } from '../js/planner.js';
import { MEAL_ROLES, VEG_MIN_DISHES } from '../js/planner.js';
import { STORE_NAMES } from '../js/db.js';
import { NUTRIENT_ORDER } from '../js/foods.js';
import { parseCheckLines, chainExcludesMutation, reminderLines, mutationNames, neverRunNames, lastFullMatchesStatus, lastFullProblems, shouldRecordFull, writeLastFull, FULL_LIMITS, overLimitLine } from './sincefull.mjs';

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
  const never = neverRunNames(curNames, lastfull.names);
  ok(never.includes('sincefull 耗時無紀錄時省略整段') && !never.includes('某一頁載不起來時 router 不通報（回到只 console.error）'),
    `N1 真實資料：v0.36.0 之後加的算從未整套跑過、之前就有的不算（現在 ${never.length} 條）`);
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
  // D6 真實入口：直接跑 npm run sincefull 那支程式。現在沒超過上限，所以第一行就該是「距上次全面檢測」——
  // 多印一行提醒就代表「沒超過也在提」，那行提醒就會被當成雜訊忽略。
  const cliOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts/sincefull.mjs')], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  ok(cliOut.length === 2 && cliOut[0].startsWith('距上次全面檢測（') && cliOut[1].startsWith('距上次突變整套（'),
    `D6（真實入口）現在沒超過上限 → sincefull 只印那兩行、不多印提醒：${JSON.stringify(cliOut)}`);
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
