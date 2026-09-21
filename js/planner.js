// 週計畫規劃器（PLAN §4.3）。**純函式、不碰 DOM、不碰 IndexedDB**，固定種子 → 固定結果。
//
// 紅線在程式碼裡的位置（每一條都有 plannertest 與突變盯著）：
//   · 慢性病留意項目**只降分、不排除**（scoreSoft 裡的 WATCH_PENALTY）；唯一會把菜排除出池子的
//     慢性病相關機制是使用者自己打開的「避開」開關（rules.avoid）
//   · 腎臟病只對 watchFields() 帶出來的欄位計分 —— 沒勾的欄位連分數都不參與
//   · 有素食成員時，**除了標記 extraMeat 的加菜**，每一格的菜都要是每位素食成員吃得了的版本
//     （加菜是給吃葷的人的，放之前一定先確認素食成員那一餐仍吃得到 VEG_MIN_DISHES 道；見 docs/SPEC_排菜葷素比例.md）（versionFor ≠ null）
//   · 早餐不吃「不重複」扣分（noRepeatDays.breakfast = 0）
//   · 池子不夠時**明講**（diagnostics.forcedRepeats／relaxed），不硬塞也不靜默重複
//   · reasons[] 只寫事實（「估 鈉 320 mg／份，低於池子中位數」），沒有建議語氣

import { estimate } from './nutrition.js';
import { versionFor, watchFields, DIET_LABELS } from './members.js';
import { shelfDaysFor } from './units.js';
import { NUTRIENT_LABELS, foodFamilies, displayNameOf } from './foods.js';
import { ROLE_LABELS, METHOD_LABELS, proteinGroupOf, tagsOfFood } from './recipeschema.js';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };
export const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
/**
 * 一餐由哪些位置組成（**依序**填，主菜最受限所以先選；主食看主菜是否已含主食）。
 * 陣列裡可以有重複的角色（午晚餐各兩道配菜），所以每道菜記的是**位置 pos**，不是角色 ——
 * 只用角色的話「第一道配菜」與「第二道配菜」在換菜、鎖定、指定時分不開。
 * 早餐維持一道：台灣家庭的早餐本來就是一份（優格水果、燕麥粥這種），
 * 硬湊三道只會逼出重複（早餐池 19 道，全素吃得到 4 道）。
 */
export const MEAL_ROLES = {
  breakfast: ['breakfast'],
  lunch: ['main', 'side', 'side', 'staple'],
  dinner: ['main', 'side', 'side', 'soup', 'staple'],
};

/** 有素食成員時，每一餐至少要有這麼多道是**每位素食成員都吃得到**的。 */
export const VEG_MIN_DISHES = 3;

/**
 * 「菜色選項」卡上要顯示的理由：**把帶估算數字的那幾句拿掉**。
 *
 * 2026-09-18 使用者回報：家裡設了高血壓＋糖尿病之後，每道菜的選單卡都多出「估 鈉 466 mg／份，不高於主菜池子的
 * 中位數 485」「估 碳水化合物（醣）…」「估 糖…」「估 膳食纖維…」四行，一般人看不懂，畫面也被撐爆。
 * 那些句子是排菜器**排序**時的依據，留意欄位照樣影響排序 —— 這裡只是不把它印在卡上。
 * 要看營養數字：食譜頁的營養卡、本週頁的每日估算都還在。
 * 判準：含「估」字（含「比較豐盛：估每份熱量…」那句）或「中位數」的就是營養敘述。
 */
export function plainReasons(reasons) {
  return (reasons ?? []).filter((t) => !/估|中位數/.test(String(t)));
}

/**
 * 加菜格（僅葷食成員）收得下哪些角色的菜。
 *
 * 一般的加菜照舊只挑主菜 —— 那是 SPEC_排菜葷素比例 定的，動它會讓每一份菜單都變樣。
 * 但**勾了「本週想吃」的純葷菜不限主菜**：滷雞腳、雞翅這類菜使用者多半填成配菜，
 * 以前加菜格只從主菜裡挑，它就哪一格都進不去（一般格被飲食型態擋、加菜格又不收配菜），
 * 最後只能在本週頁說「排不進去」。2026-09-17 使用者回報的就是這件事。
 */
export const EXTRA_MEAT_ROLES = ['main', 'side'];
/** 吃葷的人能吃到肉的菜：純葷，或可分流（素食成員吃素版，同一鍋分兩邊）。 */
export function isMeaty(recipe) { return !!recipe && recipe.vegMode !== 'nativeVeg'; }

export const DEFAULT_RULES = {
  noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 0, staple: 0 },
  timeCaps: { weekday: { breakfast: 20, lunch: 35, dinner: 40 }, weekend: { breakfast: 40, lunch: 60, dinner: 60 } },
  fishPerWeek: 2,
  avoid: { sweet: false, processed: false, fried: false },
  // 一週排幾道比較豐盛的主菜（少 2／適中 4／多 6）。家人頁可調，預設適中。
  heartyLevel: 'medium',
  // 主食的米（2026-09-18 Yolin 定案，九項調整第 9 項）：家裡平常煮哪一種，飯類主食就只排那一種。
  // 預設白米；**不因為家人的留意項目自動換成糙米**（換不換米是家裡的決定）。麵條這類沒有米的主食不受影響。
  riceKind: 'white',
};

export const RICE_KINDS = ['white', 'brown', 'multigrain'];
export const RICE_KIND_LABELS = { white: '白米', brown: '糙米', multigrain: '五穀米' };
// 2026-09-18 Yolin：設了哪一種米，**主食格一律是那種米**，不再排白麵條或其他主食。
// （v0.29.0 時讓沒有米的主食照常通過 —— 設五穀米還會出現白麵條，就是這條。）麵類當主菜的菜（炒米粉這類）不受影響：
// 它們本身含主食，那一餐的主食格直接略過。
export const RICE_KIND_HINT = '主食格只排這一種米（白米會在白飯、地瓜飯、芋頭飯之間輪流）；麵類的主菜不受影響。';
/**
 * 一樣食材是哪一種米；不是米回 null。看食藥署的名稱，所以使用者自己加的主食也適用。
 * 米粉、米胚芽、糯米不算「煮飯的米」。
 */
export function riceKindOfFood(name) {
  const n = String(name ?? '');
  if (!/米/.test(n) || /米粉|米胚芽|糯|米漿|米苔目|米血/.test(n)) return null;
  if (/五穀|雜糧|高纖/.test(n)) return 'multigrain';
  if (/糙|發芽|紅米/.test(n)) return 'brown';
  if (/^(秈米|稉米|蓬萊米|在來米|白米|越光米|胚芽|加鈣米)/.test(n)) return 'white';
  return null;
}
/** 這道主食用哪一種米（第一樣是米的食材）；沒有米回 null。 */
export function riceKindOf(recipe, idx) {
  for (const ing of recipe?.ingredients ?? []) {
    const k = riceKindOfFood(idx?.byId?.get(ing.food)?.name ?? ing.label);
    if (k) return k;
  }
  return null;
}

// ---------- 主角食材短期不要太常出現（2026-09-18 Yolin：三天內午晚餐出現四道杏鮑菇）----------
// 「幾天內不重複」只看同一道菜；三杯杏鮑菇、薑燒杏鮑菇、醬燒杏鮑菇是三道不同的菜，擋不到。
// 主角食材＝這道菜（家人實際吃的那個版本）裡份量最大的一兩樣：非常備品、不是蔥薑蒜辣椒這類配料、不是調味料，
// 份量至少是最大宗那樣的一半、每人至少 25 克。胡蘿蔔絲、燉肉裡的幾塊馬鈴薯是配角，不算。
// 同一家族算同一樣（杏鮑菇大中小都是杏鮑菇）。只看午晚餐的主菜、配菜、湯；早餐、主食不算。
// 規則是**扣分、不排除**：真的排不開時照樣排得進去。
export const STAR_WINDOW_DAYS = 2;          // 這一天往前往後各 2 天（連續三天的任何一段都看得到）
export const STAR_PENALTY = [0, 12, 45, 90]; // 這段期間同一樣主角食材已經排了 0／1／2／3 次以上時扣的分
const STAR_AROMA_RX = /蔥|蒜|薑|辣椒|九層塔|香菜|芹菜|紅蔥|檸檬/;
const STAR_MIN_GRAMS = 25;
const STAR_SHARE = 0.5;
/** 一道菜某個版本的主角食材（家族代表的編號，最多兩樣）。version：'veg' | 'meat' | 'all'。 */
export function starFoods(recipe, version, idx) {
  if (!recipe || !idx) return [];
  const fam = foodFamilies(idx);
  const tracks = version === 'veg' ? ['base', 'veg'] : version === 'meat' ? ['base', 'meat'] : ['base', 'veg', 'meat'];
  const sideServ = version === 'veg' ? (recipe.splitServings?.veg ?? 1) : (recipe.splitServings?.meat ?? recipe.servings);
  const cand = [];
  for (const ing of recipe.ingredients ?? []) {
    const track = ing.track ?? 'base';
    if (!tracks.includes(track) || ing.pantry || !ing.food || !(ing.grams > 0)) continue;
    const f = idx.byId.get(ing.food);
    if (!f || STAR_AROMA_RX.test(f.name) || /調味|油脂|糖/.test(f.cat)) continue;
    // 共用那一鍋是全部人份；素食那鍋、葷食那鍋各自是那一邊的人份
    const per = ing.grams / (track === 'base' ? recipe.servings : sideServ);
    cand.push({ key: fam.parent.get(f.id) ?? f.id, per });
  }
  if (!cand.length) return [];
  const top = Math.max(...cand.map((c) => c.per));
  return [...new Set(cand.filter((c) => c.per >= top * STAR_SHARE && c.per >= STAR_MIN_GRAMS).sort((a, b) => b.per - a.per).map((c) => c.key))].slice(0, 2);
}

// ---------- 素食成員每餐一道蛋、豆製品或奶類的菜（2026-09-18 Yolin 定案，家人頁開關，有素食成員時預設開）----------
// 只講「組成」：這一餐素食成員吃得到的菜裡，有沒有一道是蛋、豆製品（豆腐、豆干、豆皮、麵腸、毛豆…）或奶類做的。
// 做法是**加分、不硬擋**：這一餐某位素食成員還沒有這種菜時，後面的位置優先挑給得到他的；排不到照樣出菜，本週頁講是哪幾餐。
export const VEG_PROTEIN_BONUS = 35;
/** 這一餐後面還有位置可以補的時候只加這麼多：主菜先照原本的變化挑，蛋白質菜由後面的配菜、湯補（Yolin：「後面的位置優先挑」）。 */
export const VEG_PROTEIN_EARLY_BONUS = 12;
export const VEG_PROTEIN_MIN_GRAMS = 15; // 每人至少這麼多克才算（一小匙豆豉、幾片奶油不算）
export const VEG_PROTEIN_LABEL = '蛋、豆製品或奶類';
/**
 * 蔬菜類的食材，這道菜每份吃到的蛋白質至少這麼多克，也算達標（Yolin 2026-09-19：嫩莢與豆芽歸蔬菜，
 * 「但如果他們的蛋白質含量很高也可以排菜」）。看**每份吃到幾克**、不看每 100 克：乾香菇、金針乾每 100 克很高，
 * 但一道菜只用幾克；黃豆芽（每份約 5.3）算、四季豆（約 1.7）與豌豆莢（約 1.8）不算，所以門檻落在 4。
 */
export const VEG_PROTEIN_VEG_GRAMS = 4;
/**
 * 高蛋白質的食材（麵腸、麵筋、素肉這一類）份量夠也算達標（Yolin 2026-09-21：「麵腸等高蛋白質食材也算」）。
 * 是通則、不是名稱清單：看**每 100 克的含量**與**每份吃到幾克**，兩個都要過。
 * 14：乾麵條 11.6、麵線 11.7 之上留 2.4 的距離（主食不能因為這條路達標）；冷凍素雞塊 14.2 在裡面。
 */
export const HIGH_PROTEIN_PER_100G = 14;
/** 6：約等於 40 克豆干或半顆蛋以上。擋掉「只放幾克乾香菇」那種靠含量高、份量極少的食材。 */
export const HIGH_PROTEIN_PER_SERVING = 6;
/** 這兩類不走高蛋白那條路：小麥胚芽 31.4、薏仁 14.1 這些含量夠，但它們是主食，不是「那一餐的蛋白質來源」。 */
export const HIGH_PROTEIN_EXCLUDED_CATS = new Set(['穀物類', '澱粉類']);
/**
 * 這道菜的這個版本靠哪一樣算達標：'egg' | 'dairy' | 'soy' | 'vegprotein' | 'highprotein'，都不是回 null。
 * 蛋、奶、豆製品看份量（每人 ≥ VEG_PROTEIN_MIN_GRAMS 克這樣食材）；蔬菜類看每份吃到的蛋白質（≥ VEG_PROTEIN_VEG_GRAMS 克）；
 * 其餘食材看「每 100 克 ≥ HIGH_PROTEIN_PER_100G 且每份 ≥ HIGH_PROTEIN_PER_SERVING 克」（排除穀物類、澱粉類與帶肉／海鮮標籤的）。
 * 任一食材達標即可，不累加；常備品、沒有編號、沒有克數的食材不算；蛋白質沒有資料（null）的不算。
 */
export function proteinDishKind(recipe, version, idx) {
  return proteinDishMatch(recipe, version, idx)?.kind ?? null;
}
/** 高蛋白質那條路（2026-09-21）：一樣食材每 100 克 ≥ 14 克、這道菜每份從它吃到 ≥ 6 克 → 達標。 */
function highProteinFood(f, perServing, foodTags) {
  const protein = f.n?.protein;
  if (typeof protein !== 'number') return false;                       // 沒有資料的不算（不當 0、也不當達標）
  if (HIGH_PROTEIN_EXCLUDED_CATS.has(f.cat)) return false;
  const tags = tagsOfFood(f, foodTags);
  if (tags.has('meat') || tags.has('seafood')) return false;           // 香腸、培根：素食成員本來就吃不到，別讓葷菜靠這條路達標
  return protein >= HIGH_PROTEIN_PER_100G && perServing * protein / 100 >= HIGH_PROTEIN_PER_SERVING;
}
/** 同 proteinDishKind，另外回是哪一樣食材讓它達標：{ kind, food } 或 null（理由句要點名那樣食材）。 */
export function proteinDishMatch(recipe, version, idx) {
  if (!recipe || !idx) return null;
  const tracks = version === 'veg' ? ['base', 'veg'] : version === 'meat' ? ['base', 'meat'] : ['base', 'veg', 'meat'];
  const sideServ = version === 'veg' ? (recipe.splitServings?.veg ?? 1) : (recipe.splitServings?.meat ?? recipe.servings);
  const rows = [];
  for (const ing of recipe.ingredients ?? []) {
    const track = ing.track ?? 'base';
    if (!tracks.includes(track) || ing.pantry || !ing.food || !(ing.grams > 0)) continue;
    const f = idx.byId.get(ing.food);
    if (!f) continue;
    rows.push({ f, perServing: ing.grams / (track === 'base' ? recipe.servings : sideServ) });
  }
  // 既有的四條路先判**整道菜**，判定結果一道都不變：一道菜同時有麵腸與豆干時，照舊回 soy（不是看哪一樣排在前面）
  for (const { f, perServing } of rows) {
    const kind = f.cat === '蛋類' ? 'egg' : f.cat === '乳品類' ? 'dairy' : proteinGroupOf(f, new Set()) === 'soy' ? 'soy' : null;
    if (kind && perServing >= VEG_PROTEIN_MIN_GRAMS) return { kind, food: f };
    const protein = f.n?.protein;
    if (f.cat === '蔬菜類' && typeof protein === 'number' && perServing * protein / 100 >= VEG_PROTEIN_VEG_GRAMS) return { kind: 'vegprotein', food: f };
  }
  // 都沒有，才看高蛋白質的食材
  for (const { f, perServing } of rows) if (highProteinFood(f, perServing, idx.foodTags)) return { kind: 'highprotein', food: f };
  return null;
}
/** 這道菜的這個版本（'veg' | 'meat' | 'all'）是不是一道蛋、豆製品、奶類，或蛋白質較多的蔬菜菜。看食材，不看營養估算。 */
export function isProteinDish(recipe, version, idx) {
  return proteinDishKind(recipe, version, idx) !== null;
}
/** 這位家人吃這道菜時，吃到的是不是一道蛋、豆製品、奶類，或份量夠的蛋白質較多的蔬菜菜（吃不了的回 false）。 */
export function proteinDishFor(recipe, member, idx) {
  return proteinDishMatchFor(recipe, member, idx) !== null;
}
/** 同 proteinDishFor，回 proteinDishMatch 的結果（吃不了的回 null）。 */
export function proteinDishMatchFor(recipe, member, idx) {
  const v = versionFor(recipe, member.diet);
  if (v === null) return null;
  return proteinDishMatch(recipe, v === 'veg' ? 'veg' : v === 'meat' ? 'meat' : 'all', idx);
}
/**
 * 現在的菜單裡，哪幾餐（午晚餐、自己煮）有素食成員吃不到任何一道蛋、豆製品或奶類的菜。
 * 本週頁從**現在的菜單**算（換過、指定過的都算進去），不是排菜當下的紀錄。
 * @returns [{ date, meal, names: 成員暱稱[] }]
 */
export function vegProteinMisses(plan, members, recipesById, idx) {
  const vegs = (members ?? []).filter((m) => m.diet !== 'omni');
  if (!vegs.length || !plan) return [];
  const out = [];
  for (const s of plan.slots ?? []) {
    if (s.kind !== 'cook' || s.meal === 'breakfast' || !(s.items ?? []).length) continue;
    const rs = s.items.map((it) => recipesById.get(it.recipeId)).filter(Boolean);
    const names = vegs.filter((m) => !rs.some((r) => proteinDishFor(r, m, idx))).map((m) => m.name);
    if (names.length) out.push({ date: s.date, meal: s.meal, names });
  }
  return out;
}

const NO_REPEAT_PENALTY = { main: 100, side: 60, soup: 60, breakfast: 0, staple: 0 };
/**
 * 早餐不套「幾天內不重複」，只做輪替：這 7 天出現過幾次就扣幾次這個分數。
 * 2026-09-19 從 2 調成 6：補了 10 道全素早餐之後，「這幾天已經會買」（同一趟買菜共用食材，最多 +12）
 * 會把用到豆腐、高麗菜、香菇的那幾道一直拉回來，扣 2 壓不住 —— 有全素成員的家庭 7 天內再出現 14%；扣 6 是 4.5%。
 * 再大（10）會把共用食材的加分整個壓掉，買菜清單變長，所以停在 6。
 */
export const BREAKFAST_ROTATE_PENALTY = 6;
/** 同一餐不重複的烹法（PLAN §4.3：兩道炸、兩道湯）。兩道炒在台灣家常菜很平常，不算衝突。 */
export const EXCLUSIVE_METHODS = new Set(['deepfry', 'soup']);
const WATCH_PENALTY = 12;

// ---------- 一週平衡（使用者 2026-09-14 確認的方案）----------
// 使用者原話：「可以多加一些稍微沒那麼健康的料理並用其他天中和回來」。
// 做法是**加減分**，不排除任何一道：豐盛的主菜照一週配額分散開來，上一餐豐盛（或昨天估計的鈉偏高）時，
// 這一餐傾向清淡一點。參照一律是「同一類菜的相對位置」，不是任何營養上限，也不是處方。
export const HEARTY_LEVELS = { low: 2, medium: 4, high: 6 };
export const HEARTY_LEVEL_LABELS = { low: '少', medium: '適中', high: '多' };
/** 午晚餐主菜的一週配額（超過只扣分）。 */
export const WEEK_CAPS = { fried: 1, processed: 1, redMeat: 5 };
/** 主菜池裡，熱量、鈉、飽和脂肪的百分位平均排在前這麼多的，算「比較豐盛」。 */
export const HEARTY_TOP_SHARE = 0.25;
const HEARTY_BONUS = 6;              // 配額內的豐盛菜小加分：讓它們真的會出現，菜單才不會又變得清淡單調
const HEARTY_WEEKEND_BONUS = 4;      // 週末再多一點（燉的菜本來就只排得進週末）
const HEARTY_OVER_PENALTY = 40;      // 超過配額，每多一道扣這麼多
const HEARTY_SAME_DAY_PENALTY = 30;  // 同一天另一餐已經豐盛
const HEARTY_AFTER_HEARTY_PENALTY = 15;
const HEARTY_AHEAD_PENALTY = 8;      // 還在配額內，但比一週的進度超前（前半週就用完的話，週末的燉菜排不進來）
const LIGHT_BONUS = 10;              // 上一餐豐盛／昨天鈉偏高 → 清淡的菜加分
// 紅肉原本扣 25，有素食成員的家庭壓不住（可分素葷的葷菜多半是豬肉，量到一週 6～10 道），調成跟其他配額一樣重
const CAP_OVER_PENALTY = { fried: 40, processed: 40, redMeat: 40 };
const SODIUM_TILT_RATIO = 1.2;       // 昨天估計的鈉比更早幾天的平均高出兩成
const RED_MEAT = new Set(['beef', 'pork', 'lamb']);
/** 本週頁與家人頁都會帶的那句話（使用者要求保留）。 */
export const BALANCE_NOTE = '這是一般飲食常識的安排，不是營養處方。';
export const HEARTY_HINT = '燉肉、油炸、重口味這類比較豐盛的主菜，一週排幾道；排了豐盛的菜，前後幾餐會傾向清淡一點。只影響排菜的先後，不會把菜拿掉。';
const PROTEIN_LABELS = { pork: '豬', chicken: '雞', beef: '牛', lamb: '羊', duck: '鴨鵝', meat: '肉', fish: '魚', shellfish: '蝦蟹貝', egg: '蛋', soy: '豆製品' };

// ---------- 日期（一律本地日期字串，不用 toISOString，避免時區差一天） ----------
const pad2 = (n) => String(n).padStart(2, '0');
export function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(iso, n) { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
/** 這一天所屬那週的星期一。 */
export function mondayOf(iso) { const d = parseDate(iso); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return isoDate(d); }
export function weekDates(mondayIso) { return Array.from({ length: 7 }, (_, i) => addDays(mondayIso, i)); }
/** ISO 週編號：2026-W38。 */
export function weekKeyOf(iso) {
  const d = parseDate(mondayOf(iso));
  const thursday = new Date(d); thursday.setDate(d.getDate() + 3);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.floor((thursday - jan1) / 86400000 / 7) + 1;
  return `${thursday.getFullYear()}-W${pad2(week)}`;
}
export function isWeekend(iso) { const g = parseDate(iso).getDay(); return g === 0 || g === 6; }

// ---------- 決定性亂數 ----------
export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32：同一個 seed 永遠給同一串數字。 */
export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 採買日 ----------
/** 這一天（含）之前最近的買菜日；沒設買菜日回 null。shoppingDays 用 JS getDay 的 0=週日。 */
export function lastShoppingDayOnOrBefore(iso, shoppingDays) {
  if (!Array.isArray(shoppingDays) || shoppingDays.length === 0) return null;
  for (let back = 0; back < 7; back += 1) {
    const d = addDays(iso, -back);
    if (shoppingDays.includes(parseDate(d).getDay())) return d;
  }
  return null;
}

// ---------- 中位數 ----------
export function medianOf(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---------- 建立規劃上下文 ----------
/**
 * @param recipes 全部食譜（內建＋使用者）
 * @param members 家人
 * @param idx     foods 索引（indexFoods）
 * @param units   data/units.json
 * @param rules   DEFAULT_RULES 的形狀（可部分覆寫）
 * @param favorites [{recipeId, wantThisWeek}]
 */
export function buildContext({ recipes, members = [], idx, units, rules = {}, favorites = [], shoppingDays = [] }) {
  const r = {
    noRepeatDays: { ...DEFAULT_RULES.noRepeatDays, ...(rules.noRepeatDays ?? {}) },
    timeCaps: { weekday: { ...DEFAULT_RULES.timeCaps.weekday, ...(rules.timeCaps?.weekday ?? {}) }, weekend: { ...DEFAULT_RULES.timeCaps.weekend, ...(rules.timeCaps?.weekend ?? {}) } },
    fishPerWeek: rules.fishPerWeek ?? DEFAULT_RULES.fishPerWeek,
    avoid: { ...DEFAULT_RULES.avoid, ...(rules.avoid ?? {}) },
    heartyLevel: Object.hasOwn(HEARTY_LEVELS, rules.heartyLevel ?? '') ? rules.heartyLevel : DEFAULT_RULES.heartyLevel,
    riceKind: RICE_KINDS.includes(rules.riceKind) ? rules.riceKind : DEFAULT_RULES.riceKind,
    // 對照用：false 時完全不做一週平衡的加減分。**不在畫面上給使用者**，只給測試比較「有平衡／沒平衡」。
    balance: rules.balance !== false,
    // 對照用：false 時不做「主角食材短期不要太常出現」的扣分。同樣**不在畫面上給使用者**。
    starSpacing: rules.starSpacing !== false,
    // 素食成員每餐一道蛋、豆製品或奶類的菜：家人頁的開關（prefs.vegProteinEachMeal，預設開）
    vegProtein: rules.vegProtein !== false,
  };
  const vegetarians = members.filter((m) => m.diet !== 'omni');
  const hasOmni = members.some((m) => m.diet === 'omni') || members.length === 0;
  // 誰留意哪個欄位（腎臟病只帶勾選的；沒勾就沒有）
  const watchers = new Map(); // field → [member]
  for (const m of members) for (const f of watchFields(m)) { if (!watchers.has(f)) watchers.set(f, []); watchers.get(f).push(m); }
  const hasDiabetes = members.some((m) => (m.conditions ?? []).includes('diabetes'));
  const needsSoft = members.some((m) => m.texture && m.texture !== 'normal');
  // 只勾「本週想吃」、沒按收藏的菜不算收藏（兩個開關各自獨立）；舊資料沒有 favorite 欄位 → 那時有紀錄就是收藏
  const favSet = new Set(favorites.filter((f) => f.favorite !== false).map((f) => f.recipeId));
  const wantSet = new Set(favorites.filter((f) => f.wantThisWeek).map((f) => f.recipeId));
  // 一個編號的**所有**口語詞都收著。只留第一個的話，保存天數的 override 會查不到
  // （「薑」在表上是 30 天，但第一個別名是「老薑」，就落回蔬菜類的 3 天了）。
  const aliasesById = new Map();
  for (const [term, id] of idx?.aliasMap ?? []) { if (!aliasesById.has(id)) aliasesById.set(id, []); aliasesById.get(id).push(term); }

  // 家人實際吃到的主角食材：有素食成員看素版、有吃葷的（或沒設家人）看葷版；不分流的菜就是那一版
  const starCache = new Map();
  const starsOf = (recipe) => {
    if (!starCache.has(recipe.id)) {
      const vs = recipe.vegMode === 'splittable'
        ? [...(vegetarians.length ? ['veg'] : []), ...(hasOmni ? ['meat'] : [])]
        : ['all'];
      starCache.set(recipe.id, [...new Set(vs.flatMap((v) => starFoods(recipe, v, idx)))]);
    }
    return starCache.get(recipe.id);
  };
  const vpCache = new Map();
  const proteinFor = (recipe, m) => {
    const k = `${recipe.id}|${m.diet}`;
    if (!vpCache.has(k)) vpCache.set(k, proteinDishFor(recipe, m, idx));
    return vpCache.get(k);
  };
  const riceCache = new Map();
  const riceOf = (recipe) => {
    if (!riceCache.has(recipe.id)) riceCache.set(recipe.id, riceKindOf(recipe, idx));
    return riceCache.get(recipe.id);
  };
  // 設定的米種有幾道飯：只有一道（糙米、五穀米）時，飯類主食不套「同一天不排同一道」（hardBlock 的 riceAllDay）
  const riceDishes = recipes.filter((x) => x.role === 'staple' && riceOf(x) === r.riceKind).length;
  const estCache = new Map();
  const perServing = (recipe, version) => {
    const key = `${recipe.id}|${version}`;
    if (!estCache.has(key)) estCache.set(key, idx ? estimate(recipe, idx, { version }).perServing : null);
    return estCache.get(key);
  };
  /** 這道菜對「留意這個欄位的那些人」最高的每份值（他們各吃各的版本）。 */
  const watchedValue = (recipe, field) => {
    const ms = watchers.get(field) ?? [];
    let max = null;
    for (const m of ms) {
      const v = versionFor(recipe, m.diet);
      if (v === null) continue;
      const val = perServing(recipe, v)?.[field];
      if (val != null && (max == null || val > max)) max = val;
    }
    if (max == null && ms.length === 0) {
      const v = recipe.vegMode === 'splittable' ? (hasOmni ? 'meat' : 'veg') : 'all';
      max = perServing(recipe, v)?.[field] ?? null;
    }
    return max;
  };
  // 每個角色、每個留意欄位的池子中位數（拿來當「較高／較低」的參照，不是任何上限）
  const medians = {};
  for (const role of ['main', 'side', 'soup', 'staple', 'breakfast']) {
    medians[role] = {};
    for (const f of watchers.keys()) medians[role][f] = medianOf(recipes.filter((x) => x.role === role).map((x) => watchedValue(x, f)));
  }

  // ---------- 一週平衡：哪些主菜「比較豐盛」、哪些菜「清淡」----------
  // 參照版本：可分流的菜，家裡有人吃葷就看葷版（豐盛的是那一鍋），全家吃素就看素版。
  const refVersion = (recipe) => (recipe.vegMode === 'splittable' ? (hasOmni ? 'meat' : 'veg') : 'all');
  const refPerServing = (recipe) => (idx ? perServing(recipe, refVersion(recipe)) : null);
  const RICH_FIELDS = ['kcal', 'sodium', 'satFat'];
  const sortedBy = {};
  const roleMedian = {};
  for (const role of ['main', 'side', 'soup']) {
    const pool = recipes.filter((x) => x.role === role);
    sortedBy[role] = Object.fromEntries(RICH_FIELDS.map((f) => [f, pool.map((x) => refPerServing(x)?.[f]).filter((v) => typeof v === 'number').sort((a, b) => a - b)]));
    roleMedian[role] = { kcal: medianOf(sortedBy[role].kcal), sodium: medianOf(sortedBy[role].sodium) };
  }
  /** 在同一類菜裡的百分位（0＝最低；比它低的佔幾成）。 */
  const rankIn = (sorted, v) => {
    if (!sorted?.length || typeof v !== 'number') return null;
    let n = 0;
    while (n < sorted.length && sorted[n] < v) n += 1;
    return n / sorted.length;
  };
  // 三項各自的百分位取平均 —— **合起來**排前四分之一才算豐盛。
  // 不用「任一項在前四分之一」：量過，那樣主菜池一半都算豐盛，一週 4 道的配額會把菜單壓回清淡單調。
  const richnessOf = (recipe) => {
    const p = refPerServing(recipe);
    const ranks = RICH_FIELDS.map((f) => rankIn(sortedBy[recipe.role]?.[f], p?.[f])).filter((x) => x != null);
    return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
  };
  const mainRichness = recipes.filter((x) => x.role === 'main').map(richnessOf).filter((x) => x != null).sort((a, b) => a - b);
  const richCut = mainRichness.length ? mainRichness[Math.floor(mainRichness.length * (1 - HEARTY_TOP_SHARE))] : Infinity;
  const heartyCache = new Map();
  const NOT_MAIN = Object.freeze({ hearty: false, weight: 0, why: [], high: [], fried: false, processed: false, sweet: false, redMeat: false });
  const heartyOf = (recipe) => {
    if (recipe.role !== 'main') return NOT_MAIN;
    if (heartyCache.has(recipe.id)) return heartyCache.get(recipe.id);
    const p = refPerServing(recipe);
    const high = RICH_FIELDS.filter((f) => (rankIn(sortedBy.main[f], p?.[f]) ?? 0) >= 1 - HEARTY_TOP_SHARE);
    const fried = recipe.method === 'deepfry';
    const processed = recipe.tags.includes('processed');
    const sweet = recipe.tags.includes('sweet');
    const rich = (richnessOf(recipe) ?? -1) >= richCut;
    const hearty = fried || processed || sweet || rich;
    const why = [];
    if (fried) why.push('油炸');
    if (processed) why.push('用到加工肉或醃漬');
    if (sweet) why.push('含精緻糖');
    if (high.length) why.push(`估每份${high.map((f) => NUTRIENT_LABELS[f]).join('、')}在主菜裡偏高`);
    else if (rich) why.push('估每份熱量、鈉、飽和脂肪合起來在主菜裡偏高');
    // 家裡有人留意的那一項偏高 → 算兩道（評分收斂，不排除）。watchers 已經照「腎臟病只帶勾選的子項」建好，
    // 所以腎臟病沒勾鈉的家人不會讓鈉偏高的菜變兩道 —— 不自動限制。
    const doubled = (high.includes('sodium') && watchers.has('sodium')) || (high.includes('satFat') && watchers.has('satFat')) || (sweet && hasDiabetes);
    const info = { hearty, weight: hearty ? (doubled ? 2 : 1) : 0, why, high, fried, processed, sweet, redMeat: recipe.proteins.some((x) => RED_MEAT.has(x)) };
    heartyCache.set(recipe.id, info);
    return info;
  };
  /** 清淡：不是豐盛的菜，估每份熱量與鈉都不高於同類菜的中位數；或是蒸、燙、涼拌。 */
  const isLight = (recipe) => {
    if (!['main', 'side', 'soup'].includes(recipe.role)) return false;
    if (heartyOf(recipe).hearty || recipe.method === 'deepfry' || recipe.tags.includes('processed') || recipe.tags.includes('sweet')) return false;
    if (['steam', 'boil', 'cold'].includes(recipe.method)) return true;
    const p = refPerServing(recipe);
    const m = roleMedian[recipe.role];
    return p?.kcal != null && p?.sodium != null && m.kcal != null && m.sodium != null && p.kcal <= m.kcal && p.sodium <= m.sodium;
  };

  // 混合家庭：同時有吃葷與吃素的人。hasOmni 在「還沒新增家人」時也是 true，但那時 vegetarians 是空的，所以不算。
  const mixedHome = vegetarians.length > 0 && hasOmni;
  const recipeById = new Map(recipes.map((x) => [x.id, x]));
  return { recipeById, proteinFor, starsOf, riceOf, riceDishes, recipes, members, idx, units, rules: r, vegetarians, hasOmni, mixedHome, watchers, hasDiabetes, needsSoft, favSet, wantSet, aliasesById, perServing, watchedValue, medians, shoppingDays, refPerServing, heartyOf, isLight };
}

// ---------- 保存期限 ----------
/** 冷凍講得通的分類。葉菜、辛香料叫人冷凍是錯的建議，所以措辭要分開。 */
export const FREEZABLE_CATS = new Set(['肉類', '魚貝類']);

/**
 * 這道菜排在這一天時，第一個「從買菜日撐不到」的生鮮食材。撐得到（或沒設買菜日）回 null。
 * 抽出來是為了讓 hardBlock 與「為什麼選這道」的理由用**同一份計算** ——
 * 理由自己再算一次的話，兩邊會各自漂開，畫面上說的食材可能根本不是擋住的那一個。
 */
/**
 * 這道菜在這一天**所有**放不住的食材（shelfBlocker 只回第一樣）。
 * 2026-09-18 抓到：只有週一買菜時，週日晚餐放寬保存期限，挑到「沙茶牛肉空心菜」——
 * 第一樣過期的是牛肉（可以冷凍），空心菜放了 6 天卻沒人看。放寬時要分得出「只要冷凍」跟「真的放不住」。
 */
export function shelfOverdue(recipe, date, ctx) {
  const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
  if (!lastShop || !ctx.idx) return [];
  const since = daysBetween(lastShop, date);
  const out = [];
  for (const ing of recipe.ingredients) {
    if (ing.pantry) continue;
    const food = ctx.idx.byId.get(ing.food);
    if (!food) continue;
    const days = shelfDaysFor({ aliases: ctx.aliasesById.get(food.id) ?? [], cat: food.cat }, ctx.units);
    if (days != null && since > days) out.push({ label: ing.label, cat: food.cat, days, since });
  }
  return out;
}
/** 放寬保存期限時，每一樣不能冷凍又放不住的食材扣這麼多（肉魚冷凍就好，不扣）。 */
export const SHELF_FRESH_PENALTY = 60;

export function shelfBlocker(recipe, date, ctx) {
  const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
  if (!lastShop || !ctx.idx) return null;
  const since = daysBetween(lastShop, date);
  for (const ing of recipe.ingredients) {
    if (ing.pantry) continue;
    const food = ctx.idx.byId.get(ing.food);
    if (!food) continue;
    const days = shelfDaysFor({ aliases: ctx.aliasesById.get(food.id) ?? [], cat: food.cat }, ctx.units);
    if (days != null && since > days) return { label: ing.label, cat: food.cat, days, since };
  }
  return null;
}

// ---------- 硬約束 ----------
/** 這道菜在這一格能不能選。回 null 表示可以，否則回不能的原因（給 diagnostics）。 */
export function hardBlock(recipe, { role, meal, date }, ctx, state, { relaxTime = false, relaxMethod = false, relaxDay = false, relaxShelf = false, relaxBreakfast = false, requireMeaty = false, meatOnlyExtra = false } = {}) {
  if (recipe.role !== role) return 'role';
  // 同一天不排同一道菜（午餐晚餐都是番茄炒蛋這種）；真的沒得選才放寬。
  // 例外：設定的米只有一道飯（糙米、五穀米）時，飯類主食午晚都排是正常的 —— 不例外的話，
  // 晚餐的主食只剩麵條，設了糙米的家庭會有一半的餐吃麵（plannertest 量過 48%）。
  const riceAllDay = role === 'staple' && ctx.riceDishes === 1 && ctx.riceOf?.(recipe);
  if (!relaxDay && !riceAllDay && state.dayRecipes && state.dayRecipes(date).has(recipe.id)) return 'sameDay';
  const { rules } = ctx;
  if (rules.avoid.sweet && recipe.tags.includes('sweet')) return 'avoid:sweet';
  if (rules.avoid.processed && recipe.tags.includes('processed')) return 'avoid:processed';
  if (rules.avoid.fried && recipe.method === 'deepfry') return 'avoid:fried';
  // 主食的米：不是設定的那一種就不排 —— 沒有米的主食（白麵條）也不排（riceOf 是 null ≠ 設定）
  if (role === 'staple') {
    const kind = ctx.riceOf ? ctx.riceOf(recipe) : riceKindOf(recipe, ctx.idx);
    if (kind !== rules.riceKind) return 'rice';
  }
  if (meatOnlyExtra) {
    // 「僅葷食成員」的加菜：這一格刻意排素食成員吃不到的菜，所以跳過飲食型態的過濾，
    // 但只收純葷的（可分流的菜本來就兩邊都吃得到，不必當加菜），而且呼叫端要先確認素食保障還成立。
    if (recipe.vegMode !== 'meatOnly') return 'notMeatOnly';
  } else {
    // 有素食成員：每一位都要吃得了（吃素版也算）
    for (const m of ctx.vegetarians) if (versionFor(recipe, m.diet) === null) return `diet:${m.name}`;
  }
  // 家裡有吃葷的人時，午晚餐的主菜要排到葷的（可分流的算 —— 素食成員吃素版）
  if (requireMeaty && !isMeaty(recipe)) return 'needMeat';
  // 早餐不跟前一天一樣。早餐**不納入**「幾天內不重複」（池子小、長輩不介意隔幾天再吃一次），
  // 但連著兩天一模一樣是另一回事 —— 使用者實際用了之後回報的第一件事就是這個。
  // 真的排不出來時（例如全素家庭吃得到的早餐只剩一兩道）才放寬，而且會記進 diagnostics 明講。
  if (!relaxBreakfast && role === 'breakfast' && state.lastServed && state.lastServed(recipe.id, date) === 1) return 'breakfastRepeat';
  // 保存期限：距上次買菜日太久的葉菜、海鮮不排
  if (!relaxShelf) {
    const b = shelfBlocker(recipe, date, ctx);
    if (b) return `shelf:${b.label}`;
  }
  // 時間上限不算主食：電鍋煮飯是放著不管的時間，不是動手時間
  if (!relaxTime && role !== 'staple') {
    const caps = isWeekend(date) ? rules.timeCaps.weekend : rules.timeCaps.weekday;
    if (recipe.time > caps[meal]) return 'time';
  }
  const mealItems = state.slotItems ?? [];
  if (mealItems.some((it) => it.recipeId === recipe.id)) return 'dup';
  if (!relaxMethod && EXCLUSIVE_METHODS.has(recipe.method) && mealItems.some((it) => it.method === recipe.method)) return 'method';
  return null;
}

// ---------- 軟分數 ＋ 理由 ----------
export function scoreSoft(recipe, { role, meal, date, day }, ctx, state, rng) {
  let score = 0;
  const reasons = [];
  const { rules } = ctx;

  // 不重複（早餐與主食是 0 天 → 不扣）
  const noRepeat = rules.noRepeatDays[role] ?? 0;
  const last = state.lastServed(recipe.id, date);
  if (noRepeat > 0) {
    if (last != null && last <= noRepeat) {
      score -= NO_REPEAT_PENALTY[role] ?? 60;
      // 勾了「本週想吃」的菜是使用者自己要排的，不是「菜不夠」
      const wanted = ctx.wantSet.has(recipe.id) && !state.placedWant?.has(recipe.id);
      reasons.push(wanted ? `上次是 ${last} 天前（你勾了「本週想吃」，照樣排）` : `上次是 ${last} 天前（${noRepeat} 天內重複，因為符合條件的菜不夠）`);
    }
    else reasons.push(last == null ? `${noRepeat} 天內沒出現過` : `上次是 ${last} 天前`);
  } else if (role === 'breakfast') {
    // 早餐只做輪替、不算重複：出現過幾次就小扣幾分，讓幾道早餐輪著來
    const times = state.timesServedWithin(recipe.id, date, 7);
    score -= BREAKFAST_ROTATE_PENALTY * times;
    reasons.push(times ? `早餐輪替，這 7 天第 ${times + 1} 次` : '早餐輪替，這 7 天第 1 次');
  }

  // 蛋白質輪替（主菜）
  if (role === 'main' && recipe.proteins.length) {
    const labels = recipe.proteins.map((p) => PROTEIN_LABELS[p] ?? p);
    const sameDay = recipe.proteins.filter((p) => state.dayProteins(day).has(p));
    if (sameDay.length) score -= 25;
    const prev = recipe.proteins.filter((p) => state.prevDayMealProteins(day, meal).has(p));
    if (prev.length) score -= 8;
    const isFish = recipe.proteins.some((p) => p === 'fish' || p === 'shellfish');
    if (isFish && state.fishCount() < rules.fishPerWeek) { score += 15; reasons.push(`蛋白質來源：${labels.join('、')}；這週第 ${state.fishCount() + 1} 次吃魚貝`); }
    else reasons.push(`蛋白質來源：${labels.join('、')}${sameDay.length ? '（今天另一餐也是）' : ''}`);
  }

  // 一週平衡：豐盛的主菜照配額分散；上一餐豐盛、或昨天估計的鈉偏高時，這一餐傾向清淡。
  // 全部是加減分 —— 池子不夠、你勾了本週想吃、指定或鎖定時照樣排得進來，而且理由與本週頁都會講出來。
  if (meal !== 'breakfast' && ctx.heartyOf && rules.balance) {
    const prevMeal = meal === 'dinner' ? { day, meal: 'lunch' } : { day: day - 1, meal: 'dinner' };
    const prevHearty = state.heartySlot ? state.heartySlot(prevMeal.day, prevMeal.meal) : null;
    const sodiumHigh = state.sodiumHighYesterday ? state.sodiumHighYesterday(day) : false;
    if (role === 'main') {
      const info = ctx.heartyOf(recipe);
      const budget = HEARTY_LEVELS[rules.heartyLevel];
      const bal = state.balance ?? { load: 0, count: 0, fried: 0, processed: 0, redMeat: 0 };
      if (info.hearty) {
        const after = bal.load + info.weight;
        const twice = info.weight > 1 ? '（家裡有人留意這一項，算兩道）' : '';
        // 一週的進度：到這一天為止大約可以排幾道（週一 1、週四 3、週日 4 —— 以一週 4 道為例）
        // 四捨五入而不是無條件進位：進位的話「少（一週 2 道）」週四前就用完，週末永遠排不到燉菜
        const pace = Math.round((budget * (day + 1)) / 7);
        if (after <= budget) {
          if (bal.count < pace) score += HEARTY_BONUS + (isWeekend(date) ? HEARTY_WEEKEND_BONUS : 0);
          else score -= HEARTY_AHEAD_PENALTY;
          reasons.push(`比較豐盛：${info.why.join('、')}；這週第 ${bal.count + 1} 道豐盛的主菜，在一週 ${budget} 道內${twice}`);
        } else {
          score -= HEARTY_OVER_PENALTY * (after - budget);
          reasons.push(`比較豐盛：${info.why.join('、')}；這週已經有 ${bal.count} 道豐盛的主菜，這道超過一週 ${budget} 道的設定${twice}`);
        }
        const sameDay = (state.heartyMealsOn ? state.heartyMealsOn(day) : []).filter((m) => m !== meal);
        if (sameDay.length) { score -= HEARTY_SAME_DAY_PENALTY; reasons.push(`今天${MEAL_LABELS[sameDay[0]]}已經比較豐盛`); }
        if (prevHearty) score -= HEARTY_AFTER_HEARTY_PENALTY;
      }
      if (info.fried && bal.fried >= WEEK_CAPS.fried) { score -= CAP_OVER_PENALTY.fried; reasons.push(`這週已經有 ${bal.fried} 道油炸的主菜`); }
      if (info.processed && bal.processed >= WEEK_CAPS.processed) { score -= CAP_OVER_PENALTY.processed; reasons.push(`這週已經有 ${bal.processed} 道用到加工肉或醃漬的主菜`); }
      if (info.redMeat && bal.redMeat >= WEEK_CAPS.redMeat) { score -= CAP_OVER_PENALTY.redMeat; reasons.push(`這週的紅肉（牛、豬）主菜已經有 ${bal.redMeat} 道`); }
    }
    if ((prevHearty || sodiumHigh) && ctx.isLight(recipe)) {
      if (prevHearty) { score += LIGHT_BONUS; reasons.push(`上一餐比較豐盛（${prevHearty}），這一餐傾向清淡`); }
      if (sodiumHigh) { score += LIGHT_BONUS; reasons.push('昨天估計的鈉比這週前幾天高，今天傾向清淡'); }
    }
  }

  // 素食成員：吃哪個版本（事實）
  for (const m of ctx.vegetarians) {
    const v = versionFor(recipe, m.diet);
    if (v) reasons.push(`${m.name}（${DIET_LABELS[m.diet]}）可吃${v === 'veg' ? '素版' : ''}`);
  }

  // 留意欄位：只降分、不排除。參照是這個角色池子的中位數，不是任何上限。
  for (const [field] of ctx.watchers) {
    const val = ctx.watchedValue(recipe, field);
    const med = ctx.medians[role]?.[field];
    if (val == null || med == null) continue;
    const unit = ctx.idx?.units?.[field] ?? '';
    const fmt = (x) => (unit === 'g' ? (Math.round(x * 10) / 10) : Math.round(x));
    if (val > med) { score -= WATCH_PENALTY; reasons.push(`估 ${NUTRIENT_LABELS[field]} ${fmt(val)} ${unit}／份，高於${ROLE_LABELS[role]}池子的中位數 ${fmt(med)}`); }
    else reasons.push(`估 ${NUTRIENT_LABELS[field]} ${fmt(val)} ${unit}／份，不高於${ROLE_LABELS[role]}池子的中位數 ${fmt(med)}`);
  }
  if (ctx.hasDiabetes) {
    if (role === 'staple' && recipe.tags.includes('wholegrain')) { score += 12; reasons.push('全穀雜糧主食（家中有留意醣的成員）'); }
    if (recipe.tags.includes('sweet')) { score -= 15; reasons.push('含精緻糖（家中有留意醣的成員）'); }
  }
  if (role === 'staple' && !(ctx.hasDiabetes && recipe.tags.includes('wholegrain'))) {
    reasons.push(recipe.tags.includes('wholegrain') ? '全穀雜糧主食' : '一般主食（白米或麵）');
  }

  // 收藏、本週想吃
  if (ctx.wantSet.has(recipe.id) && !state.placedWant.has(recipe.id)) { score += 40; reasons.push('你勾了「本週想吃」'); }
  else if (ctx.favSet.has(recipe.id)) { score += 12; reasons.push('你的收藏'); }

  // 當季
  const month = parseDate(date).getMonth() + 1;
  if (recipe.season.length === 0 || recipe.season.includes(month)) { if (recipe.season.length) { score += 6; reasons.push(`當季（${month} 月）`); } }
  else score -= 6;

  // 質地
  if (ctx.needsSoft && (role === 'main' || role === 'side') && recipe.texture !== 'normal') { score += 8; reasons.push('軟質，家裡有需要好咬的成員'); }

  // 主角食材短期不要太常出現（見 STAR_PENALTY）。取這道菜幾樣主角裡最常出現的那一樣。
  let starWorst = 0;
  if (rules.starSpacing && meal !== 'breakfast' && ['main', 'side', 'soup'].includes(role) && ctx.starsOf && state.starCount) {
    let worst = null;
    for (const k of ctx.starsOf(recipe)) { const c = state.starCount(k, date); if (!worst || c > worst.c) worst = { k, c }; }
    starWorst = worst?.c ?? 0;
    if (worst && worst.c > 0) {
      score -= STAR_PENALTY[Math.min(worst.c, STAR_PENALTY.length - 1)];
      reasons.push(`${displayNameOf(ctx.idx?.byId.get(worst.k), ctx.idx)}前後幾天已經排了 ${worst.c} 道`);
    }
  }

  // 素食成員每餐一道蛋、豆製品或奶類的菜（見 VEG_PROTEIN_BONUS）：這一餐已經排的菜裡還沒有的成員，這道給得到他就加分
  if (rules.vegProtein && ctx.vegetarians.length && meal !== 'breakfast' && ['main', 'side', 'soup'].includes(role) && ctx.proteinFor) {
    const placed = (state.slotItems ?? []).map((it) => ctx.recipeById.get(it.recipeId)).filter(Boolean);
    const lacking = ctx.vegetarians.filter((m) => !placed.some((r) => ctx.proteinFor(r, m)));
    const gives = lacking.filter((m) => ctx.proteinFor(recipe, m));
    // 主角食材前後幾天已經排了 2 道以上（例如第三道豆干）就不加這個分 —— 「三天內不要太常出現」優先（Yolin 先提的那一條）
    // 主菜一定不是最後一個位置 → 最多只加 VEG_PROTEIN_EARLY_BONUS（12），小於「同一天另一餐已經豐盛」的扣分（30），
    // 所以不會把豐盛的豆腐主菜推成一天兩餐都豐盛（第一版從主菜就加滿 35 時會，plannertest 的一週平衡抓到）。
    if (gives.length && starWorst < 2) {
      // 這一格之後，這一餐還剩幾個素食成員吃得到的位置（主食不算；混合家庭最後一道配菜會是給葷食的加菜，也不算）
      const vegRoles = (MEAL_ROLES[meal] ?? []).filter((r) => r !== 'staple');
      const placedN = (state.slotItems ?? []).filter((it) => it.role !== 'staple').length;
      const extraPending = ctx.mixedHome && !(state.slotItems ?? []).some((it) => it.extraMeat) ? 1 : 0;
      const later = vegRoles.length - placedN - 1 - extraPending;
      score += (later >= 1 ? VEG_PROTEIN_EARLY_BONUS : VEG_PROTEIN_BONUS) * (gives.length / lacking.length);
      // 靠「蔬菜類、每份蛋白質夠」（黃豆芽）或「高蛋白質的食材」（麵腸）達標的，都不說它是豆製品的菜：
      // 點名那樣食材、只講份量（v0.37.0 R6 的句型，2026-09-21 高蛋白那條沿用）
      const matches = gives.map((m) => proteinDishMatchFor(recipe, m, ctx.idx));
      if (matches.every((x) => x?.kind === 'vegprotein' || x?.kind === 'highprotein')) {
        const foods = [...new Set(matches.map((x) => displayNameOf(x.food, ctx.idx)))];
        reasons.push(`${gives.map((m) => m.name).join('、')}這一餐吃得到份量夠的${foods.join('、')}`);
      } else reasons.push(`${gives.map((m) => m.name).join('、')}這一餐吃得到的${VEG_PROTEIN_LABEL}的菜`);
    }
  }

  // 保存期限：正常情況 hardBlock 已經擋掉放不住的；會走到這裡的是「放寬保存期限」那一輪。
  // 那一輪裡，只有肉魚過期（冷凍就好）的菜要排在葉菜也過期的菜前面。
  if (ctx.shoppingDays?.length) {
    const fresh = shelfOverdue(recipe, date, ctx).filter((b) => !FREEZABLE_CATS.has(b.cat));
    if (fresh.length) score -= SHELF_FRESH_PENALTY * fresh.length;
  }

  // 採買效率：同一個採買區間已經會買的食材
  const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
  if (lastShop) {
    const already = recipe.ingredients.filter((ing) => !ing.pantry && state.rangeHas(lastShop, ing.food));
    if (already.length) { score += Math.min(12, already.length * 3); reasons.push(`${already.slice(0, 2).map((i) => i.label.replace(/（.*?）/g, '')).join('、')}這幾天已經會買`); }
  }

  reasons.push(`約 ${recipe.time} 分鐘，${METHOD_LABELS[recipe.method]}`);
  score += rng() * 3;
  return { score, reasons };
}

// ---------- 狀態（這一週已經排了什麼） ----------
function makeState(history, ctx, monday) {
  const served = new Map(); // recipeId → [dates]
  const add = (id, date) => { if (!served.has(id)) served.set(id, []); served.get(id).push(date); };
  // 主角食材 → 排到的日期（午晚餐的主菜、配菜、湯；一道菜算一次）
  const starDates = new Map();
  const STAR_ROLES = ['main', 'side', 'soup'];
  const addStars = (recipe, meal, date) => {
    if (!recipe || meal === 'breakfast' || !STAR_ROLES.includes(recipe.role) || !ctx.starsOf) return;
    for (const k of ctx.starsOf(recipe)) { if (!starDates.has(k)) starDates.set(k, []); starDates.get(k).push(date); }
  };
  const byIdEarly = new Map(ctx.recipes.map((r) => [r.id, r]));
  for (const h of history) { add(h.recipeId, h.date); addStars(byIdEarly.get(h.recipeId), h.meal, h.date); }
  const proteinsByDay = new Map();    // `${day}` → Set
  const mainProteinsByDayMeal = new Map(); // `${day}|${meal}` → Set
  const rangeFoods = new Map();       // lastShopDate → Set(foodId)
  let fish = 0;
  const placedWant = new Set();
  // 一週平衡：豐盛的主菜幾道（加權）、油炸／加工醃漬／紅肉各幾道、哪幾餐是豐盛的、每天估計的鈉
  const balance = { load: 0, count: 0, fried: 0, processed: 0, redMeat: 0 };
  const heartySlots = new Map();   // `${day}|${meal}` → 菜名
  const daySodium = new Map();     // day → 這天已排的菜每份鈉（參照版本）加總
  const byId = new Map(ctx.recipes.map((r) => [r.id, r]));
  const state = {
    slotItems: [],
    placedWant,
    // 同一天另一餐排過也算（diff 0）：正在評分的這道菜還沒 place()，所以不會算到自己
    lastServed(id, date) {
      const dates = served.get(id) ?? [];
      if (!dates.length) return null;
      let best = null;
      for (const d of dates) { const diff = Math.abs(daysBetween(d, date)); if (best == null || diff < best) best = diff; }
      return best;
    },
    timesServedWithin(id, date, days) { return (served.get(id) ?? []).filter((d) => Math.abs(daysBetween(d, date)) <= days).length; },
    dayRecipes(date) { return new Set([...served].filter(([, ds]) => ds.includes(date)).map(([id]) => id)); },
    dayProteins(day) { return proteinsByDay.get(String(day)) ?? new Set(); },
    prevDayMealProteins(day, meal) { return mainProteinsByDayMeal.get(`${day - 1}|${meal}`) ?? new Set(); },
    fishCount() { return fish; },
    balance,
    heartySlot(day, meal) { return heartySlots.get(`${day}|${meal}`) ?? null; },
    heartyMealsOn(day) { return MEALS.filter((m) => heartySlots.has(`${day}|${m}`)); },
    /** 昨天估計的鈉，比這週更早幾天的平均高出一截（至少要有兩天可以比，不然不算）。 */
    sodiumHighYesterday(day) {
      const prev = daySodium.get(day - 1);
      const earlier = [];
      for (let d = 0; d < day - 1; d += 1) if (daySodium.has(d)) earlier.push(daySodium.get(d));
      if (prev == null || earlier.length < 2) return false;
      const avg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
      return avg > 0 && prev > avg * SODIUM_TILT_RATIO;
    },
    rangeHas(lastShop, foodId) { return rangeFoods.get(lastShop)?.has(foodId) ?? false; },
    /** 這樣主角食材在 date 前後 STAR_WINDOW_DAYS 天內已經排了幾道。 */
    starCount(key, date) { return (starDates.get(key) ?? []).filter((d) => Math.abs(daysBetween(d, date)) <= STAR_WINDOW_DAYS).length; },
    /** 把一道菜記進這一週的狀態。 */
    place(recipe, { day, meal, date }) {
      add(recipe.id, date);
      addStars(recipe, meal, date);
      if (recipe.role === 'main' && meal !== 'breakfast' && ctx.heartyOf) {
        const info = ctx.heartyOf(recipe);
        if (info.hearty) { balance.load += info.weight; balance.count += 1; heartySlots.set(`${day}|${meal}`, recipe.name.split('／')[0].replace(/（.*?）/g, '')); }
        if (info.fried) balance.fried += 1;
        if (info.processed) balance.processed += 1;
        if (info.redMeat) balance.redMeat += 1;
      }
      const na = ctx.refPerServing?.(recipe)?.sodium;
      if (typeof na === 'number') daySodium.set(day, (daySodium.get(day) ?? 0) + na);
      if (recipe.role === 'main') {
        if (!proteinsByDay.has(String(day))) proteinsByDay.set(String(day), new Set());
        for (const p of recipe.proteins) proteinsByDay.get(String(day)).add(p);
        const k = `${day}|${meal}`;
        if (!mainProteinsByDayMeal.has(k)) mainProteinsByDayMeal.set(k, new Set());
        for (const p of recipe.proteins) mainProteinsByDayMeal.get(k).add(p);
        if (recipe.proteins.some((p) => p === 'fish' || p === 'shellfish')) fish += 1;
      }
      const lastShop = lastShoppingDayOnOrBefore(date, ctx.shoppingDays);
      if (lastShop) {
        if (!rangeFoods.has(lastShop)) rangeFoods.set(lastShop, new Set());
        for (const ing of recipe.ingredients) if (!ing.pantry && ing.food) rangeFoods.get(lastShop).add(ing.food);
      }
      if (ctx.wantSet.has(recipe.id)) placedWant.add(recipe.id);
    },
    byId,
  };
  void monday;
  return state;
}

/**
 * 可以被放寬的四條限制，**由輕到重**（越後面越不想動）。
 * 這個順序同時決定 pickForSlot 的嘗試順序與畫面上列理由的順序。
 */
export const RELAXABLE = ['relaxMethod', 'relaxTime', 'relaxShelf', 'relaxBreakfast', 'relaxDay'];
const BLOCK_PREFIX = { relaxMethod: 'method', relaxTime: 'time', relaxShelf: 'shelf', relaxBreakfast: 'breakfastRepeat', relaxDay: 'sameDay' };

/**
 * 這道菜在這一格，**實際**踩到哪幾條可放寬的限制。
 *
 * 為什麼需要這支：pickForSlot 的放寬是**累加**的（第 4 次嘗試同時開烹法、時間、保存期限），
 * 所以「這次開了哪些旗標」≠「這道菜實際被哪些擋住」。照旗標寫理由的話，
 * 只是因為保存期限才需要放寬的菜會被一起貼上「超過這一餐的時間上限」——
 * 使用者看到的是一個不存在的原因，照著它去調時間上限也不會有用。
 *
 * 作法：逐條把**那一條關掉、其餘全放寬**，hardBlock 回什麼就是什麼。
 * 這道菜既然被選上，不可放寬的那些（角色、飲食型態、避開開關、同餐重複）本來就都過了，
 * 所以每次探測只會回那一條的代碼或 null。
 */
export function actualRelaxations(recipe, slotInfo, ctx, state, base = {}) {
  const out = [];
  for (const key of RELAXABLE) {
    const relax = { ...base, relaxMethod: true, relaxTime: true, relaxShelf: true, relaxDay: true, [key]: false };
    const hit = hardBlock(recipe, slotInfo, ctx, state, relax);
    if (typeof hit === 'string' && hit.startsWith(BLOCK_PREFIX[key])) out.push(key);
  }
  return out;
}

/** 把「實際踩到的那一條」寫成一句話。只陳述事實，建議留給診斷卡。 */
export function relaxReason(key, recipe, { meal, date }, ctx) {
  if (key === 'relaxTime') {
    const caps = isWeekend(date) ? ctx.rules.timeCaps.weekend : ctx.rules.timeCaps.weekday;
    return `約 ${recipe.time} 分鐘，超過這一餐的 ${caps[meal]} 分鐘上限，因為符合條件的菜不夠`;
  }
  if (key === 'relaxShelf') {
    // 每一樣放不住的都講（以前只講第一樣：牛肉要冷凍講了，空心菜放 6 天沒講）
    const all = shelfOverdue(recipe, date, ctx);
    if (!all.length) return null;
    const since = all[0].since;
    // 肉魚才講冷凍：叫人把九層塔、青江菜冷凍是錯的。
    const frozen = all.filter((b) => FREEZABLE_CATS.has(b.cat));
    const fresh = all.filter((b) => !FREEZABLE_CATS.has(b.cat));
    const parts = [];
    if (frozen.length) parts.push(`${frozen.map((b) => `${b.label}冷藏大約放 ${b.days} 天`).join('、')}，這道的肉要先冷凍`);
    if (fresh.length) parts.push(`${fresh.map((b) => `${b.label}大約只放 ${b.days} 天`).join('、')}，不耐放`);
    return `離上次買菜 ${since} 天，${parts.join('；')}`;
  }
  if (key === 'relaxBreakfast') return '昨天早餐也是這道，因為家裡吃得到的早餐不夠多';
  if (key === 'relaxMethod') return `同一餐已經有一道${METHOD_LABELS[recipe.method]}的菜，因為符合條件的菜不夠`;
  if (key === 'relaxDay') return '今天另一餐也排了這道，因為符合條件的菜不夠';
  return null;
}

const AVOID_TEXT = { sweet: '含精緻糖的菜', processed: '用到加工肉或醃漬的菜', fried: '油炸的菜' };

/**
 * 勾了「本週想吃」卻沒排進去的原因（本週頁照實講，不是泛泛的「條件不夠」）。
 * 拿一個空的狀態逐格問 hardBlock：每一格都被擋 → 講擋住的那幾類；
 * 有格子沒被硬條件擋卻還是沒排到 → 純葷的菜在有素食家人時只能走加菜位置，那是素食保障排不出位置；其餘是同一天、同一餐的衝突或鎖住的菜佔了。
 */
export function wantMissReason(recipe, slots, ctx) {
  const open = slots.filter((s) => s.kind === 'cook' && (MEAL_ROLES[s.meal] ?? []).includes(recipe.role));
  if (!open.length) return '這週排得進這道菜的餐都設成外食或不煮';
  // 跟 fillMeal 的加菜格用同一份角色清單 —— 兩邊若不一致，畫面會講一個跟排菜器不同的原因。
  const viaExtra = EXTRA_MEAT_ROLES.includes(recipe.role) && recipe.vegMode === 'meatOnly' && ctx.vegetarians.length > 0 && ctx.hasOmni;
  const blank = { slotItems: [], dayRecipes: () => new Set(), lastServed: () => null };
  const codes = open.map((s) => hardBlock(recipe, { role: recipe.role, meal: s.meal, date: s.date }, ctx, blank, { meatOnlyExtra: viaExtra }));
  if (codes.every(Boolean)) {
    const texts = [];
    const add = (t) => { if (!texts.includes(t)) texts.push(t); };
    const names = [...new Set(codes.filter((c) => c.startsWith('diet:')).map((c) => c.slice(5)))];
    if (names.length) add(recipe.vegMode === 'meatOnly' ? `這道只有吃葷的人能吃，${names.join('、')}吃素` : `${names.join('、')}吃不了這道（食材裡有吃素的人不吃的東西）`);
    for (const c of codes) {
      if (c.startsWith('avoid:')) add(`你在排菜規則設了避開${AVOID_TEXT[c.slice(6)] ?? '這一類的菜'}`);
      else if (c === 'time') {
        const longest = Math.max(...open.map((s) => (isWeekend(s.date) ? ctx.rules.timeCaps.weekend : ctx.rules.timeCaps.weekday)[s.meal]));
        add(`要花約 ${recipe.time} 分鐘，超過這週每一餐的時間上限（最長的一餐是 ${longest} 分鐘）`);
      } else if (c.startsWith('shelf:')) add(`${c.slice(6)}離買菜日太久放不住`);
      else if (c === 'rice') add(`你在排菜規則設了主食的米用${RICE_KIND_LABELS[ctx.rules.riceKind]}`);
    }
    if (texts.length) return texts.join('；');
  }
  if (viaExtra) return `這道只有吃葷的人能吃，家裡有吃素的家人，每一餐要先讓他們吃得到至少 ${VEG_MIN_DISHES} 道，排不出多加一道葷菜的位置`;
  return '這週每一餐都卡到同一天不排同一道、同一餐不重複湯或油炸，或位置被鎖住的菜佔了';
}

/** 在一格裡為某個角色挑一道菜。回 { recipe, reasons, relaxed } 或 null（真的沒得選）。 */
export function pickForSlot(ctx, state, slotInfo, role, rng, { exclude = new Set(), requireMeaty = false, meatOnlyExtra = false, strict = false } = {}) {
  const base = { requireMeaty, meatOnlyExtra };
  // 放寬的順序＝「越後面越不想動」。保存期限排在「同一天重複同一道菜」前面：
  // 拿離買菜日久一點的食材（冷凍的肉）比午晚餐吃同一道菜好。
  const attempts = [{}];
  for (let i = 0; i < RELAXABLE.length; i += 1) attempts.push(Object.fromEntries(RELAXABLE.slice(0, i + 1).map((k) => [k, true])));
  // strict：一條都不放寬（「本週想吃」先試的那一輪 —— 這一格排不進去就等下一格，不為了它放寬限制）
  const tries = (strict ? [{}] : attempts).map((a) => ({ ...base, ...a }));
  for (const relax of tries) {
    let best = null;
    for (const recipe of ctx.recipes) {
      if (exclude.has(recipe.id)) continue;
      if (hardBlock(recipe, { ...slotInfo, role }, ctx, state, relax)) continue;
      const { score, reasons } = scoreSoft(recipe, { ...slotInfo, role }, ctx, state, rng);
      if (!best || score > best.score) best = { recipe, score, reasons };
    }
    if (best) {
      // 注意：不是 Object.keys(relax) —— 那是「這次開了哪些旗標」，不是「實際踩到哪幾條」。
      const relaxed = actualRelaxations(best.recipe, { ...slotInfo, role }, ctx, state, base);
      for (const key of relaxed) {
        const line = relaxReason(key, best.recipe, { ...slotInfo, role }, ctx);
        if (line) best.reasons.push(line);
      }
      return { ...best, relaxed };
    }
  }
  return null;
}

/**
 * 填一餐：鎖住的先擺回去，再照 MEAL_ROLES 逐格挑。
 *
 * 為什麼抽出來：generateWeek 與 refillSlot（外食改回自己煮）**必須走同一條規則**。
 * 以前 regenerateSlot 是逐格呼叫 swapItem，那條路永遠補配菜、不會有加菜 ——
 * 同一個規則在兩個入口行為不同，正是「家裡有」那次的形狀（慣例 21）。
 *
 * 回傳的 item 帶著 method（同餐不重複烹法要用），呼叫端存檔前自己剝掉。
 */
export function fillMeal(ctx, state, slotInfo, { lockedItems = [], rng, diagnostics = null, pendingWant = () => [], onlyThese = () => new Set() } = {}) {
  const { day, meal, date } = slotInfo;
  const items = [];
  state.slotItems = items;
  for (const it of lockedItems) items.push({ ...it, method: state.byId.get(it.recipeId).method });
  const hasStapleInMain = () => items.some((it) => it.role === 'main' && state.byId.get(it.recipeId)?.includesStaple);
  const roles = MEAL_ROLES[meal];
  // 家裡有吃葷的人（或還沒新增家人）→ 這一餐要有一道葷的。早餐不套用：
  // 早餐以簡單為準（優格水果、燕麥粥這種），為了湊葷加重口味不划算，葷早餐的池子也太小。
  const wantsMeat = ctx.hasOmni && meal !== 'breakfast';
  const lastSidePos = roles.lastIndexOf('side');
  const note = (key, row) => { if (diagnostics && Array.isArray(diagnostics[key])) diagnostics[key].push(row); };
  /** 挑到一道之後要記的診斷：勉強重複、實際放寬了哪幾條。一般位置與加菜共用同一支，不然加菜會漏報。 */
  const recordPick = ({ role, pos, recipe, relaxed, wanted }) => {
    const last = state.lastServed(recipe.id, date);
    const noRepeat = ctx.rules.noRepeatDays[role] ?? 0;
    if (!wanted && noRepeat > 0 && last != null && last <= noRepeat) note('forcedRepeats', { date, meal, role, recipeId: recipe.id, daysAgo: last });
    // 一道菜一筆。舊版是「每開一個旗標推一筆」，12 道菜會被講成 37 道。
    if (relaxed?.length) note('relaxed', { date, meal, role, pos, recipeId: recipe.id, constraints: relaxed });
  };
  /** 這一餐排完之後，每位素食成員吃得到幾道（還沒填的位置都會過飲食型態過濾，所以算得進去）。 */
  const vegDishesAfter = (extraRecipe, pos) => {
    if (!ctx.vegetarians.length) return Infinity;
    const eatable = items.filter((it) => {
      const r = state.byId.get(it.recipeId);
      return r && ctx.vegetarians.every((m) => versionFor(r, m.diet) !== null);
    }).length;
    const extraOk = ctx.vegetarians.every((m) => versionFor(extraRecipe, m.diet) !== null) ? 1 : 0;
    // 還沒填的位置：主菜本身含主食（炒米粉）時主食那一格會略過，不能算成素食成員吃得到的一道
    const later = roles.slice(pos + 1).filter((r) => !(r === 'staple' && hasStapleInMain())).length;
    return eatable + extraOk + later;
  };
  roles.forEach((role, pos) => {
    if (items.some((it) => it.pos === pos)) return;                // 鎖住的已經佔了這個位置
    if (role === 'staple' && hasStapleInMain()) return;            // 炒米粉這類主菜本身就是主食
    // 最後一道配菜：改排一道「只有吃葷的人吃」的純葷菜（extraMeat）。三種情況會開這一格：
    //   1. 勾了純葷菜的「本週想吃」—— 那道菜只能從這裡進來
    //   2. 主菜排不到葷（葷食保障，現有行為）
    //   3. **混合家庭的每一個午晚餐**（SPEC_排菜葷素比例）：不可分流的純葷菜（滷雞腳這種）本來永遠排不進去
    // 素食保障是唯一的硬門檻：放之前一定先算 vegDishesAfter >= VEG_MIN_DISHES，算不到就不放、照常排配菜。
    if (wantsMeat && role === 'side' && pos === lastSidePos) {
      const mainMeaty = items.some((it) => isMeaty(state.byId.get(it.recipeId)));
      // 勾了「本週想吃」的純葷菜先挑，而且**不限主菜**（EXTRA_MEAT_ROLES）——
      // 使用者把滷雞腳填成配菜，以前它進不了加菜格，本週頁只能說「排不進去」。
      const wantMeatOnly = ctx.vegetarians.length
        ? EXTRA_MEAT_ROLES.flatMap((r) => pendingWant(r, day)).filter((r) => r.vegMode === 'meatOnly')
        : [];
      const openExtra = !mainMeaty || ctx.mixedHome;
      const tries = [];
      for (const wantRole of EXTRA_MEAT_ROLES) {
        const list = wantMeatOnly.filter((r) => r.role === wantRole);
        if (!list.length) continue;
        tries.push({ wanted: true, pick: () => pickForSlot(ctx, state, slotInfo, wantRole, rng, { meatOnlyExtra: true, strict: true, exclude: onlyThese(list) }) });
      }
      // 一般的加菜照舊只挑主菜（SPEC_排菜葷素比例），不然每一份菜單都會變樣。
      if (openExtra) tries.push({ wanted: false, pick: () => pickForSlot(ctx, state, slotInfo, 'main', rng, { meatOnlyExtra: true }) });
      let skipWhy = null;
      for (const t of tries) {
        const extra = t.pick();
        if (!extra) { skipWhy = skipWhy ?? 'noCandidate'; continue; }
        if (vegDishesAfter(extra.recipe, pos) < VEG_MIN_DISHES) { skipWhy = 'vegGuarantee'; continue; }
        const wanted = t.wanted;
        // 角色照那道菜自己的（配菜就是配菜）—— 一週平衡、每日估算都靠這個欄位分類。
        items.push({ recipeId: extra.recipe.id, role: extra.recipe.role, pos, locked: false, extraMeat: true, method: extra.recipe.method,
          reasons: [...extra.reasons, mainMeaty ? '這道是給吃葷的人的加菜（素食家人吃這一餐其他的菜）' : '這一餐的主菜是素的，這道是給吃葷的人的加菜'] });
        recordPick({ role: extra.recipe.role, pos, recipe: extra.recipe, relaxed: extra.relaxed, wanted });
        state.place(extra.recipe, slotInfo);
        return;
      }
      // 混合家庭本來每餐都要放一道，沒放成要留下原因（只給測試與除錯，不上畫面）
      if (ctx.mixedHome && tries.length) note('meatExtraSkipped', { date, meal, why: skipWhy ?? 'noCandidate' });
    }
    const requireMeaty = wantsMeat && role === 'main';
    // 本週想吃先挑（不要求葷：勾了素的主菜也排得進來，這一餐的葷由上面的加菜補）
    const wants = pendingWant(role, day);
    let picked = wants.length ? pickForSlot(ctx, state, slotInfo, role, rng, { strict: true, exclude: onlyThese(wants) }) : null;
    const wanted = !!picked;
    if (!picked && requireMeaty) picked = pickForSlot(ctx, state, slotInfo, role, rng, { requireMeaty: true });
    if (!picked) picked = pickForSlot(ctx, state, slotInfo, role, rng);
    if (!picked) { note('empty', { date, meal, role, pos }); return; }
    const { recipe, reasons, relaxed } = picked;
    recordPick({ role, pos, recipe, relaxed, wanted });
    items.push({ recipeId: recipe.id, role, pos, locked: false, reasons, method: recipe.method });
    state.place(recipe, slotInfo);
  });
  // 排完還是沒有葷的 → 記下來，本週頁明講（不硬塞、也不靜默）
  if (wantsMeat && !items.some((it) => isMeaty(state.byId.get(it.recipeId)))) {
    note('noMeat', { date, meal, why: ctx.vegetarians.length ? '要先確保素食成員吃得到' : '沒有葷菜排得進來' });
  }
  return items;
}

/**
 * 產生一週。prevPlan 裡 kind 不是 cook 的格子與 locked 的菜會原樣保留。
 * @returns {{ plan, diagnostics }}
 */
export function generateWeek({ recipes, members = [], idx, units, rules = {}, favorites = [], history = [], mondayIso, seed, prevPlan = null, shoppingDays = [] }) {
  const monday = mondayOf(mondayIso);
  const dates = weekDates(monday);
  const ctx = buildContext({ recipes, members, idx, units, rules, favorites, shoppingDays });
  const rng = makeRng(`${seed}|${monday}`);
  // 這一週自己的歷史不算（重新產生時舊格子會被換掉）；只帶這週之前 28 天內的
  const past = history.filter((h) => h.date < monday && daysBetween(h.date, monday) <= 28);
  const state = makeState(past, ctx, monday);
  // rules：這週實際用的豐盛程度與主食的米（跟著 plan 存）。設定頁改了、排出來卻沒跟著變時，查得到是哪一環沒傳到。
  const diagnostics = { forcedRepeats: [], relaxed: [], empty: [], noMeat: [], wantMissed: [], meatExtraSkipped: [], poolSizes: {}, rules: { heartyLevel: ctx.rules.heartyLevel, riceKind: ctx.rules.riceKind, vegProtein: ctx.rules.vegProtein } };
  for (const role of ['main', 'side', 'soup', 'staple', 'breakfast']) diagnostics.poolSizes[role] = recipes.filter((r) => r.role === role).length;

  // 「本週想吃」＝這週一定要排到（2026-09-14 使用者回報：勾了滷雞腳，重新產生幾次都沒排進去，畫面上也沒說為什麼）。
  // 以前只有 +40 分：蓋不過不重複（-100）、一週平衡這些扣分；更糟的是家裡有素食成員時，純葷的菜在一般位置一定被飲食型態擋下，
  // 唯一進得來的「給吃葷的人的加菜」又只在主菜排不到葷時才開 —— 可分流的主菜幾乎每餐都有，所以永遠排不到。
  // 現在每一格先只在「還沒排到的本週想吃」裡挑（一條限制都不放寬），挑得到就排；最後還沒排到的記進 diagnostics.wantMissed 講原因。
  // 不讓每道都擠在週一：每道菜從週一到週三之間的某一天開始試（跟著種子變，重新產生會換）。
  const wantStart = (id) => Math.abs(hashSeed(`${seed}|want|${id}`)) % 3;
  const pendingWant = (role, day) => ctx.recipes.filter((r) => r.role === role && ctx.wantSet.has(r.id) && !state.placedWant.has(r.id) && day >= wantStart(r.id));
  const onlyThese = (list) => { const keep = new Set(list.map((r) => r.id)); return new Set(ctx.recipes.filter((r) => !keep.has(r.id)).map((r) => r.id)); };

  const prevSlots = new Map((prevPlan?.slots ?? []).map((s) => [`${s.day}|${s.meal}`, s]));
  const slots = [];
  // 先把鎖住的菜登記進狀態，別的格子才會避開它們
  for (let day = 0; day < 7; day += 1) for (const meal of MEALS) {
    const prev = prevSlots.get(`${day}|${meal}`);
    if (!prev) continue;
    for (const it of prev.items ?? []) if (it.locked || prev.kind !== 'cook') { const r = state.byId.get(it.recipeId); if (r && prev.kind === 'cook') state.place(r, { day, meal, date: dates[day] }); }
  }

  for (let day = 0; day < 7; day += 1) {
    for (const meal of MEALS) {
      const date = dates[day];
      const prev = prevSlots.get(`${day}|${meal}`);
      const slotInfo = { day, meal, date };
      if (prev && prev.kind !== 'cook') { slots.push({ ...prev, date }); continue; }
      const lockedItems = (prev?.items ?? []).filter((it) => it.locked && state.byId.has(it.recipeId));
      const items = fillMeal(ctx, state, slotInfo, { lockedItems, rng, diagnostics, pendingWant, onlyThese });
      slots.push({ day, date, meal, kind: 'cook', items: items.map(({ method, ...it }) => it).sort((a, b) => a.pos - b.pos) });
    }
  }
  state.slotItems = [];
  // 勾了「本週想吃」卻沒排進去：記下來、講實際原因，本週頁照實告訴使用者（不靜默）
  for (const id of ctx.wantSet) {
    const recipe = state.byId.get(id);
    if (!recipe || state.placedWant.has(id)) continue;
    diagnostics.wantMissed.push({ recipeId: id, why: wantMissReason(recipe, slots, ctx) });
  }
  return { plan: { weekKey: weekKeyOf(monday), monday, seed: String(seed), slots }, diagnostics };
}

/**
 * 這一週的平衡摘要（本週頁「一週平衡」那一段用）。從**現在的菜單**重算 ——
 * 換過、鎖過、指定過的菜都算進去；存在 diagnostics 裡的話，換一道之後就不準了。
 */
export function weekBalance({ plan, recipes, members = [], idx, units, rules = {} }) {
  const ctx = buildContext({ recipes, members, idx, units, rules });
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const budget = HEARTY_LEVELS[ctx.rules.heartyLevel];
  const out = { level: ctx.rules.heartyLevel, budget, load: 0, hearty: [], doubled: 0, fried: 0, processed: 0, redMeat: 0, over: 0 };
  for (const s of plan?.slots ?? []) {
    if (s.kind !== 'cook' || s.meal === 'breakfast') continue;
    for (const it of s.items ?? []) {
      const r = byId.get(it.recipeId);
      if (!r || r.role !== 'main') continue;
      const info = ctx.heartyOf(r);
      if (info.hearty) {
        out.load += info.weight;
        if (info.weight > 1) out.doubled += 1;
        out.hearty.push({ day: s.day, date: s.date, meal: s.meal, recipeId: r.id, name: r.name, why: info.why, weight: info.weight });
      }
      if (info.fried) out.fried += 1;
      if (info.processed) out.processed += 1;
      if (info.redMeat) out.redMeat += 1;
    }
  }
  out.over = Math.max(0, out.load - budget);
  return out;
}

/** 本週頁「一週平衡」那一段話。只講事實，最後一定帶 BALANCE_NOTE。 */
export function balanceSentence(b) {
  const parts = [];
  if (!b.hearty.length) {
    parts.push(`這週沒有排到比較豐盛的主菜（一週最多 ${b.budget} 道，可以到「家人」分頁的排菜規則調整）。`);
  } else {
    const names = b.hearty.map((x) => x.name.split('／')[0].replace(/（.*?）/g, ''));
    // 超過配額時不能說「前後幾餐排得清淡一點平衡」—— 那不是真的（例如能選的主菜幾乎都是豐盛的）
    const tail = b.over ? '。' : '，前後幾餐排得清淡一點平衡。';
    parts.push(`這週有 ${b.hearty.length} 餐的主菜比較豐盛（${names.slice(0, 4).join('、')}${names.length > 4 ? ' 等' : ''}）${tail}`);
    if (b.doubled) parts.push(`家裡有人留意鈉、飽和脂肪或醣，其中 ${b.doubled} 道各算兩道。`);
    if (b.over) parts.push(`合起來比你設定的一週 ${b.budget} 道多了 ${b.over} 道（指定、鎖定的菜，或符合條件的菜不夠）。`);
  }
  // 其他配額超過也照講，不靜默
  const capOver = [
    b.redMeat > WEEK_CAPS.redMeat ? `紅肉（牛、豬）主菜 ${b.redMeat} 道` : null,
    b.fried > WEEK_CAPS.fried ? `油炸的主菜 ${b.fried} 道` : null,
    b.processed > WEEK_CAPS.processed ? `用到加工肉或醃漬的主菜 ${b.processed} 道` : null,
  ].filter(Boolean);
  if (capOver.length) parts.push(`這週${capOver.join('、')}，比平常排的多一些（指定、鎖定的菜，或要讓家裡每個人都吃得到、符合條件的菜不夠）。`);
  parts.push(BALANCE_NOTE);
  return parts.join('');
}

/**
 * 把某一格整個重填（外食改回自己煮）。走的是 generateWeek 同一支 fillMeal ——
 * 以前這裡是逐格呼叫 swapItem，那條路永遠補配菜、不會有加菜，同一條規則在兩個入口行為不同。
 * @returns {{ items, diagnostics }} items 已經剝掉 method、依位置排好
 */
export function refillSlot({ plan, slotIndex, recipes, members = [], idx, units, rules = {}, favorites = [], history = [], shoppingDays = [], seed }) {
  const slot = plan.slots[slotIndex];
  const ctx = buildContext({ recipes, members, idx, units, rules, favorites, shoppingDays });
  const past = history.filter((h) => h.date < plan.monday && daysBetween(h.date, plan.monday) <= 28);
  const state = makeState(past, ctx, plan.monday);
  // 這一週其他格子的菜都算「已排」（這一格自己要重填，所以不算）
  for (const s of plan.slots) {
    if (s.kind !== 'cook' || s === slot) continue;
    for (const it of s.items) {
      const r = state.byId.get(it.recipeId);
      if (r) state.place(r, { day: s.day, meal: s.meal, date: s.date });
    }
  }
  const diagnostics = { forcedRepeats: [], relaxed: [], empty: [], noMeat: [], meatExtraSkipped: [] };
  const rng = makeRng(`${seed}|refill|${slotIndex}`);
  const lockedItems = (slot.items ?? []).filter((it) => it.locked && state.byId.has(it.recipeId));
  const items = fillMeal(ctx, state, { day: slot.day, meal: slot.meal, date: slot.date }, { lockedItems, rng, diagnostics });
  state.slotItems = [];
  return { items: items.map(({ method, ...it }) => it).sort((a, b) => a.pos - b.pos), diagnostics };
}


/** 直接指定一道菜到某格的某個位置（使用者手選）。理由寫「你指定的」。 */
export function assignItem(plan, slotIndex, pos, recipe) {
  const slot = plan.slots[slotIndex];
  const others = slot.items.filter((it) => it.pos !== pos);
  slot.items = [...others, { recipeId: recipe.id, role: recipe.role, pos, locked: true, reasons: ['你指定的，已鎖定'] }]
    .sort((a, b) => a.pos - b.pos);
  return slot;
}

/**
 * 舊版的計畫沒有 pos（那時一餐一個角色只有一道）。讀出來時補上，
 * 換菜、鎖定、指定才對得到位置。就地修改並回傳同一個物件。
 */
export function withPositions(plan) {
  if (!plan?.slots) return plan;
  for (const slot of plan.slots) {
    const list = slot.items ?? [];
    if (!list.length || list.every((it) => Number.isInteger(it.pos))) continue;
    const roles = MEAL_ROLES[slot.meal] ?? [];
    const used = new Set();
    for (const it of list) {
      let pos = roles.findIndex((r, i) => r === it.role && !used.has(i));
      if (pos < 0) pos = roles.length + used.size;
      it.pos = pos;
      used.add(pos);
    }
    list.sort((a, b) => a.pos - b.pos);
  }
  return plan;
}

/** 這一週要寫進 history 的列。 */
export function historyRowsOf(plan) {
  const rows = [];
  for (const s of plan.slots) {
    if (s.kind !== 'cook') continue;
    for (const it of s.items) rows.push({ date: s.date, recipeId: it.recipeId, meal: s.meal, role: it.role, weekKey: plan.weekKey });
  }
  return rows;
}

/**
 * 一天的每人估計（每位家人吃自己的版本；沒有家人時給「不分流／葷版」一份）。
 * 回 [{ label, diet, fields: {key: number|null}, missing: number }]
 */
/**
 * 把每日估算併成幾組：**數字一模一樣的成員算同一組**。
 * 使用者 2026-09-16 回報：吃葷的家人每人各列一份、數字完全相同，看起來只是重複佔版面。
 * 併的鍵包含每一個欄位的值、吃不了的道數、部分估算的道數 —— 只要有一項不同就分開列，不會把不一樣的數字混在一起。
 * 回 [{ labels: 成員名[], diets: 飲食型態[], fields, missing, partialDishes? }]，順序照第一次出現的成員。
 */
export function groupEstimates(rows, fields) {
  const groups = [];
  const byKey = new Map();
  for (const row of rows) {
    const key = JSON.stringify([fields.map((f) => row.fields?.[f] ?? null), row.missing ?? 0, row.partialDishes ?? 0]);
    if (!byKey.has(key)) {
      const g = { labels: [], diets: [], fields: row.fields, missing: row.missing ?? 0, ...(row.partialDishes ? { partialDishes: row.partialDishes } : {}) };
      byKey.set(key, g);
      groups.push(g);
    }
    const g = byKey.get(key);
    g.labels.push(row.label);
    if (!g.diets.includes(row.diet)) g.diets.push(row.diet);
  }
  return groups;
}

export function dailyEstimates(daySlots, members, idx, recipesById, fields) {
  const rows = [];
  const who = members.length ? members.map((m) => ({ label: m.name, diet: m.diet })) : [{ label: '每人一份', diet: 'omni' }];
  for (const w of who) {
    const sums = Object.fromEntries(fields.map((f) => [f, null]));
    let missing = 0;
    let partialDishes = 0;   // 含查不到營養資料的食材的菜（數字只是部分估算）
    for (const s of daySlots) {
      if (s.kind !== 'cook') continue;
      for (const it of s.items) {
        const r = recipesById.get(it.recipeId);
        if (!r) continue;
        const v = versionFor(r, w.diet);
        if (v === null) { missing += 1; continue; }
        const est = estimate(r, idx, { version: v });
        const per = est.perServing;
        if (est.unresolved.length) partialDishes += 1;
        for (const f of fields) if (per[f] != null) sums[f] = (sums[f] ?? 0) + per[f];
      }
    }
    rows.push({ ...w, fields: sums, missing, ...(partialDishes ? { partialDishes } : {}) });
  }
  return rows;
}
