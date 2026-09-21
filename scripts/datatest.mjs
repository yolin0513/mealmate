// 資料層測試（npm run datatest）：
//   A. build-foods 的轉換 —— 用固定樣本（白飯 A0550601 的原始列）驗，空值必須是 null 不是 0
//   B. data/foods.json 本身 —— 筆數、欄位、沒有同名、單位一致、白飯的實測值
//   C. 顯示層的「拿不到就不是 0」—— fmtEst(null) 是「未估算」
//   D. 設定預設值 —— 早餐不納入不重複、每日目標預設空

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, noneOf, everyOf, detects } from './tap.mjs';
import { transform, num, parseUnitWeight, splitAliases, sampleState, NUTRIENT_KEYS, nutrientOrder, CAT_OVERRIDES, applyCatOverrides } from './build-foods.mjs';
import { indexFoods, NUTRIENT_ORDER } from '../js/foods.js';
import { fmtEst, fmtNum, NOT_ESTIMATED, NO_VALUE } from '../js/ui.js';
import { DEFAULTS } from '../js/prefs.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ---------- A. 轉換 ----------
section('小工具：空值是 null，不是 0');
detects((v) => num(v) === null, {
  shouldHit: ['', null, undefined, 'abc', '  '],
  shouldMiss: ['0', '1.5', ' 183 ', 0, 41],
}, 'num()：空字串／null／非數字 → null；「0」是 0 不是 null');
eq(num('0'), 0, '（對照）字串 "0" 真的變成數字 0 —— null 與 0 是分得開的兩件事');
detects((s) => parseUnitWeight(s) === null, {
  shouldHit: ['0.0克', '', null, '一顆', '12'],
  shouldMiss: ['121.0克', '53.5克', ' 6克 '],
}, 'parseUnitWeight()：0 克與認不得的寫法 → null；正常的 → 數字');
eq(parseUnitWeight('121.0克'), 121, '121.0克 → 121');
eq(splitAliases('洋芋,洋薯、荷蘭薯；日本番薯,洋芋', '馬鈴薯'), ['洋芋', '洋薯', '荷蘭薯', '日本番薯'], '俗名拆開、去重');
eq(splitAliases('馬鈴薯,洋芋', '馬鈴薯'), ['洋芋'], '俗名跟正式名稱一樣的不重複列');
eq(sampleState('樣品狀態:生,黃皮種; 前處理描述:去皮'), '生,黃皮種', '從內容物描述取樣品狀態');
eq(sampleState('前處理描述:去皮'), null, '沒有樣品狀態就 null');

section('固定樣本：白飯 A0550601 的原始列');
// FEASIBILITY §1.4 實測到的每 100 克含量。一列一個分析項，跟食藥署匯出檔一樣的欄位名。
const RICE = { 熱量: ['183', 'kcal'], 粗蛋白: ['3.1', 'g'], 粗脂肪: ['0.3', 'g'], 飽和脂肪: ['0.1', 'g'], 總碳水化合物: ['41', 'g'], 糖質總量: ['', 'g'], 膳食纖維: ['0.6', 'g'], 鈉: ['2', 'mg'], 鉀: ['40', 'mg'], 磷: ['39', 'mg'], 鈣: ['1', 'mg'], 膽固醇: ['', 'mg'] };
const row = (id, name, item, [val, unit], extra = {}) => ({
  食品分類: '穀物類', 資料類別: '一般營養成分', 整合編號: id, 樣品名稱: name, 俗名: '', 樣品英文名稱: '',
  內容物描述: '樣品狀態:熟; 前處理描述:混合均勻打碎', 廢棄率: '', 分析項分類: '一般', 分析項: item, 含量單位: unit,
  每100克含量: val, 樣本數: '1', 標準差: '', 每單位含量: '', 每單位重: '0.0克', 每單位重含量: '', ...extra,
});
const riceRows = Object.entries(RICE).map(([item, v]) => row('A0550601', '白飯', item, v));
// 一列不相干的分析項（維生素）：要被略過，不能變成第 13 個 key
riceRows.push(row('A0550601', '白飯', '維生素B1', ['0.02', 'mg']));
const { foods: sampleFoods, units: sampleUnits } = transform(riceRows);
eq(sampleFoods.length, 1, '一種食材');
const rice = sampleFoods[0];
eq(rice.id, 'A0550601', 'id');
eq(rice.name, '白飯', '名稱');
eq(rice.state, '熟', '樣品狀態');
// n 是陣列，順序＝nutrientOrder()（也會寫進 foods.json 的 nutrients 欄位）
const nObj = (f) => Object.fromEntries(nutrientOrder().map((k, i) => [k, f.n[i] ?? null]));
const riceN = nObj(rice);
eq(riceN.kcal, 183, '熱量 183');
eq(riceN.protein, 3.1, '粗蛋白 3.1');
eq(riceN.carb, 41, '總碳水化合物 41');
eq(riceN.sodium, 2, '鈉 2');
eq(riceN.potassium, 40, '鉀 40');
eq(riceN.phosphorus, 39, '磷 39');
eq(riceN.sugar, null, '糖質總量原始值為空 → null');
ok(riceN.sugar !== 0, '（對照）而且不是 0 —— 「不知道」不可以變成「沒有」');
eq(riceN.cholesterol, null, '膽固醇原始值為空 → null');
eq(rice.n.length, 12, '剛好 12 個營養值，維生素那一列沒有混進來');
eq(Object.keys(riceN).sort(), Object.values(NUTRIENT_KEYS).sort(), '還原成物件後就是那 12 個 key');
eq(rice.unitWeight, null, '每單位重 0.0克 → null');
eq(sampleUnits.kcal, 'kcal', '單位表記到 kcal');
eq(sampleUnits.sodium, 'mg', '鈉的單位是 mg');

section('同名不同年、同名不同狀態');
const dup = [
  ...['熱量'].map((item) => row('X001', '傳統豆腐', item, ['88', 'kcal'], { 食品分類: '加工調理食品及其他類' })),
  ...['熱量'].map((item) => row('X002', '傳統豆腐(2022年取樣)', item, ['90', 'kcal'], { 食品分類: '加工調理食品及其他類' })),
  ...['熱量'].map((item) => row('X003', '鯖魚(2019年取樣)', item, ['200', 'kcal'], { 食品分類: '魚貝類' })),
  ...['熱量'].map((item) => row('X004', '鯖魚(2021年取樣)', item, ['210', 'kcal'], { 食品分類: '魚貝類' })),
  ...['熱量'].map((item) => row('X005', '雞蛋', item, ['130', 'kcal'], { 食品分類: '蛋類', 內容物描述: '樣品狀態:生' })),
  ...['熱量'].map((item) => row('X006', '雞蛋', item, ['150', 'kcal'], { 食品分類: '蛋類', 內容物描述: '樣品狀態:熟' })),
];
const { foods: dupFoods, report } = transform(dup);
const names = dupFoods.map((f) => f.name);
ok(!names.includes('傳統豆腐(2022年取樣)') && names.includes('傳統豆腐'), '有不帶年份的同名條目時，年份版整筆略過', names.join('、'));
eq(dupFoods.find((f) => f.name === '鯖魚')?.id, 'X004', '只有年份版時留最新一年、名稱去掉年份');
ok(names.includes('雞蛋（生）') && names.includes('雞蛋（熟）'), '同名不同狀態用樣品狀態消歧', names.join('、'));
eq(new Set(names).size, names.length, '轉完沒有任何兩筆同名');
eq(report.droppedYearVariants, 2, '報告：略過 2 筆年份版');

section('單位不一致要丟錯');
let threw = false;
try { transform([row('Y1', '甲', '鈉', ['1', 'mg']), row('Y2', '乙', '鈉', ['1', 'g'])]); } catch { threw = true; }
ok(threw, '同一個營養素兩種單位 → 丟錯（寧可 build 失敗，不要一半 mg 一半 g）');

// ---------- B. 真的 data/foods.json ----------
section('data/foods.json');
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
ok(/^\d{4}-\d{2}-\d{2}$/.test(real.version), `有資料版本：${real.version}`);
ok(real.source?.license === '政府資料開放授權條款－第1版', '記了授權條款');
ok(real.foods.length >= 2000, `食材 ${real.foods.length} 筆（≥ 2000）`);
const realNames = real.foods.map((f) => f.name);
eq(new Set(realNames).size, realNames.length, '沒有兩筆同顯示名');
// 檔案裡每筆的 n 是**陣列**（12 個鍵名重複 2,151 次會佔掉整個檔案三分之一：686KB → 415KB）。
// 順序由檔案自己的 nutrients 欄位宣告，讀檔端照它還原 —— 建檔端與讀檔端各自寫死一份順序的話，
// 每個營養值都會錯位，而且畫面上看起來還是一個合理的數字。下面三條就是在守這個契約。
eq(real.nutrients, nutrientOrder(), 'foods.json 宣告的營養值順序＝build-foods 產生時用的順序');
eq(real.nutrients, NUTRIENT_ORDER, '也跟畫面顯示用的 NUTRIENT_ORDER 一致');
everyOf(real.foods, (f) => Array.isArray(f.n) && f.n.length === 12, '每一筆都是 12 個營養值的陣列（值可以是 null）');
everyOf(real.foods, (f) => f.n.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))), '每個值不是 null 就是有限數字');
everyOf(real.foods, (f) => Array.isArray(f.aliases) && typeof f.cat === 'string' && f.cat.length > 0, '每一筆都有 aliases 陣列與分類');
noneOf(real.foods, (f) => 'wasteRate' in f, '沒有 App 用不到的欄位（廢棄率）');
// 以下用 indexFoods 還原成 App 看到的樣子再驗值
const realIdx = indexFoods(real, { aliases: {} });
const sugarIdx = real.nutrients.indexOf('sugar');
const nullSugar = realIdx.list.filter((f) => f.n.sugar === null).length;
ok(nullSugar > 100, `（母體）真的有 ${nullSugar} 筆糖質總量是 null —— 空值沒有被轉成 0 這件事在真資料上有意義`);
noneOf(realIdx.list.filter((f) => f.n.sugar === null), (f) => f.n.sugar === 0, '（同一批）沒有任何一筆把 null 寫成 0');
eq(real.foods.filter((f) => f.n[sugarIdx] === null).length, nullSugar, '檔案裡的 null 個數跟還原後一樣（還原沒有把 null 變成別的東西）');
const sortedEntries = (o) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
eq(sortedEntries(real.units), sortedEntries({ kcal: 'kcal', protein: 'g', fat: 'g', satFat: 'g', carb: 'g', sugar: 'g', fiber: 'g', sodium: 'mg', potassium: 'mg', phosphorus: 'mg', calcium: 'mg', cholesterol: 'mg' }), '單位表跟畫面假設一致（熱量 kcal、三大營養素與纖維糖 g、礦物質與膽固醇 mg）');
const realRice = realIdx.byId.get('A0550601');
ok(realRice && realRice.name === '白飯', '真資料裡有白飯 A0550601');
eq([realRice.n.kcal, realRice.n.protein, realRice.n.carb, realRice.n.sodium, realRice.n.potassium, realRice.n.phosphorus], [183, 3.1, 41, 2, 40, 39], '白飯的六個值跟 FEASIBILITY §1.4 實測一致');
// 錯位的話這一條會紅：拿另一筆手動查過的資料當第二個對照點
const realEgg = realIdx.byId.get('K01001');
ok(realEgg, `（對照）雞蛋平均值 K01001 也在：${realEgg?.name}`);
everyOf(['kcal', 'protein', 'fat'], (k) => typeof realEgg.n[k] === 'number' && realEgg.n[k] > 0, '雞蛋的熱量、蛋白質、脂肪都是正數（不是被錯位成 0 或 null）');
everyOf(real.foods.filter((f) => f.unitWeight != null), (f) => f.unitWeight > 0, '有每單位重的都是正數（0 已經變 null）');
ok(real.foods.filter((f) => f.unitWeight != null).length > 1000, '（母體）有每單位重的超過 1000 筆');

// ---------- C. 顯示 ----------
section('顯示：拿不到的值不是 0');
eq(fmtEst(null), NOT_ESTIMATED, 'fmtEst(null) 是「未估算」');
eq(fmtEst(undefined, 'g'), NOT_ESTIMATED, 'fmtEst(undefined) 是「未估算」');
eq(fmtEst(NaN, 'g'), NOT_ESTIMATED, 'fmtEst(NaN) 是「未估算」');
ok(!/0/.test(fmtEst(null)), '（對照）「未估算」裡連 0 這個字都沒有');
eq(fmtEst(42, 'g'), '估 42 g', 'fmtEst(42, g) 帶「估」字');
eq(fmtEst(0, 'mg'), '估 0 mg', '（對照）真的是 0 才顯示 0 —— 跟 null 分得開');
eq(fmtEst(3.14, 'g', 1), '估 3.1 g', '小數位數');
eq(fmtNum(null), NO_VALUE, 'fmtNum(null) 是「—」');

// ---------- D. 預設值 ----------
section('設定預設值');
eq(DEFAULTS.noRepeatDays.breakfast, 0, '早餐的不重複天數預設 0（早餐不納入不重複）');
ok(DEFAULTS.noRepeatDays.main >= 14, `主菜不重複 ${DEFAULTS.noRepeatDays.main} 天（≥ 14）`);
eq(DEFAULTS.dailyTargets, {}, '每日目標預設是空的 —— App 不替任何人設目標');
eq(DEFAULTS.disclaimerAcceptedAt, null, '「我知道了」預設沒按過');

// ---------- E. 類別覆寫（2026-09-19，SPEC_嫩莢豆芽與蛋白質門檻 R1） ----------
section('類別覆寫：吃嫩莢的豆類歸蔬菜（Yolin：「四季豆是屬於蔬菜，不是豆類」）');
{
  const PODS = ['H1000201', 'H1000101', 'H1000301', 'H1200201', 'H1200301', 'H1200401', 'H0800101', 'H1300101', 'H1800101'];
  const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
  const byIdB = new Map(built.foods.map((f) => [f.id, f]));
  eq(Object.keys(CAT_OVERRIDES).sort(), [...PODS].sort(), `覆寫表恰好是這九筆嫩莢類（${Object.keys(CAT_OVERRIDES).length} 筆）`);
  everyOf(PODS, (id) => CAT_OVERRIDES[id] === '蔬菜類', '覆寫表把九筆都寫成蔬菜類');
  everyOf(PODS, (id) => byIdB.get(id)?.cat === '蔬菜類', 'data/foods.json 裡九筆的類別都是蔬菜類（改了表忘了重建會紅）',
    PODS.filter((id) => byIdB.get(id)?.cat !== '蔬菜類').map((id) => `${id} ${byIdB.get(id)?.cat}`).join('、'));
  // 對照：範圍沒有被擴大 —— 吃豆仁的仍是豆類
  const BEANS = { H1100101: '毛豆仁', H1200101: '豌豆仁', H0900101: '萊豆仁(帶膜)', H1105101: '黃豆' };
  everyOf(Object.entries(BEANS), ([id, name]) => byIdB.get(id)?.name === name && byIdB.get(id)?.cat === '豆類', '（對照）毛豆仁、豌豆仁、萊豆仁、黃豆仍是豆類');
  // 表裡的編號在原始資料找不到 → 建檔失敗（不能靜默略過）
  const fixture = () => [{ id: 'H1000201', cat: '豆類' }, { id: 'A0550601', cat: '穀物類' }];
  const small = fixture();
  eq(applyCatOverrides(small, { H1000201: '蔬菜類' }), 1, '（對照）編號都在時照常套用');
  eq(small[0].cat, '蔬菜類', '（對照）套用之後類別真的改了');
  let threw = null;
  try { applyCatOverrides(fixture(), { H1000201: '蔬菜類', ZZ99999: '蔬菜類' }); } catch (e) { threw = e.message; }
  ok(!!threw && threw.includes('ZZ99999'), `覆寫表有原始資料找不到的編號 → 丟錯並點名（${threw ?? '沒有丟錯'}）`);
}

section('過敏原標籤：罐頭麵筋的花生（2026-09-21，SPEC_高蛋白食材也算 R5）');
{
  // 花生麵筋罐頭的食藥署內容物描述寫了花生，分類（加工調理食品）推不出來 —— foodtags 要明列，
  // 不然對花生過敏的家人會被排到。這是查到的成分，不是從名稱推定的（香菇麵筋罐頭的描述沒提花生）。
  const tags = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foodtags.json'), 'utf8')).tags;
  const idxT = indexFoods(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8')), { aliases: {} });
  ok(idxT.byId.get('R4900101')?.name === '花生麵筋罐頭' && idxT.byId.get('R4900201')?.name === '香菇麵筋罐頭',
    `（前提）兩筆罐頭都在：${idxT.byId.get('R4900101')?.name}、${idxT.byId.get('R4900201')?.name}`);
  ok(tags.peanut.includes('R4900101'), `H11 花生麵筋罐頭標了 peanut（peanut 一共 ${tags.peanut.length} 筆）`);
  ok(!tags.peanut.includes('R4900201'), 'H11（對照）香菇麵筋罐頭沒有被順手標上（描述沒提花生，不編造）');
}

done('datatest');
