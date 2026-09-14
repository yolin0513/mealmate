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
//   `--only <關鍵字>` 只跑名稱／檔名／測試名含關鍵字的那幾條；多個關鍵字用 | 分隔（任一個命中就選）。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, note } from './tap.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const MUTATIONS = [
  // ---- 使用者回報第四輪：客人欄直式、自己加的項目、清單摺疊、日期列按鈕 ----
  {
    name: "日期列回到 flex-wrap（有買菜日標籤就擠掉「一起煮」）",
    why: "使用者截圖：有「買菜日」標籤的那天，「一起煮」被擠到下一行、跑到左邊，跟其他天對不齊。",
    file: "css/style.css",
    find: ".day-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: 8px; }",
    replace: ".day-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }",
    test: "layouttest",
  },
  {
    name: "「這次有客人？」葷素兩格不再並排對齊",
    why: "使用者回報說明跟兩個框擠在一起；改回去的話兩個框會疊成上下兩列、寬度也不一。",
    file: "css/style.css",
    find: ".extra-inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: end; max-width: 22em; }",
    replace: ".extra-inputs { display: block; }",
    test: "shoppingviewtest",
  },
  {
    name: "自己加的項目不標「自己加的」",
    why: "看起來跟系統算出來的食材一樣，她會以為加了會影響菜單或營養。",
    file: "js/views/shopping.js",
    find: "            h('span', { class: 'muted xs shop-uses' }, pill('自己加的'), '　', del))));",
    replace: "            h('span', { class: 'muted xs shop-uses' }, del))));",
    test: "shoppingviewtest",
  },
  {
    name: "進度總數不算自己加的項目",
    why: "「已買 N／M」少算了飯後水果那幾樣，她會以為都買齊了，其實還缺。",
    file: "js/views/shopping.js",
    find: "      const total = range.items.length + range.custom.length;",
    replace: "      const total = range.items.length;",
    test: "shoppingviewtest",
  },
  {
    name: "複製出去的清單漏掉自己加的項目",
    why: "貼到 LINE 給家人代買，飯後水果那幾樣不見了。",
    file: "js/shopping.js",
    find: "  if (range.custom?.length) {",
    replace: "  if (false) {",
    test: "shoppingtest",
  },
  {
    name: "自己加的項目不分採買卡（每張卡都出現）",
    why: "週三那趟加的水果，週六那張清單也冒出來，會買兩次。",
    file: "js/shopping.js",
    find: "    custom: sanitizeCustom(customByRange[r.key]),",
    replace: "    custom: sanitizeCustom(Object.values(customByRange).flat()),",
    test: "shoppingtest",
  },
  {
    name: "自己加的項目名稱空白也收",
    why: "清單上多出一列沒有名字的項目，不知道要買什麼。",
    file: "js/shopping.js",
    find: "    if (!name || !id || seen.has(id)) continue;",
    replace: "    if (!id || seen.has(id)) continue;",
    test: "shoppingtest",
  },
  {
    name: "買齊了也不自動收合",
    why: "使用者要的是「清楚知道還缺什麼」—— 買齊的區塊一直攤開，還沒買的就被淹沒了。",
    file: "js/views/shopping.js",
    find: "        const open = manual ? manual === 'open' : !allDone;",
    replace: "        const open = manual ? manual === 'open' : true;",
    test: "shoppingviewtest",
  },
  {
    name: "手動展開的區塊又被自動收回去",
    why: "她特地打開一個買齊的區塊要確認，勾一下就又被收起來 —— 手動意圖要優先。",
    file: "js/views/shopping.js",
    find: "        const open = manual ? manual === 'open' : !allDone;",
    replace: "        const open = !allDone;",
    test: "shoppingviewtest",
  },
  {
    name: "「家裡有」不算買齊",
    why: "使用者說「家裡有也等同於已購買」；只看「買了」的話，勾了家裡有的區塊永遠收不起來。",
    file: "js/views/shopping.js",
    find: "    const isDone = (k) => !!row.checked?.[k] || !!row.have?.[k];",
    replace: "    const isDone = (k) => !!row.checked?.[k];",
    test: "shoppingviewtest",
  },
  {
    name: "收合只改外觀，不用 hidden 移出版面",
    why: "看起來收了，但版面還被佔著、螢幕閱讀器仍然念整區 —— 跟本週頁摺疊同一個要求。",
    file: "js/views/shopping.js",
    find: "        f.body.hidden = !open;",
    replace: "        f.body.style.opacity = open ? '1' : '0.4';",
    test: "shoppingviewtest",
  },
  // ---- 「家裡有」降級並自己解釋自己、客人數收合 ----
  {
    name: "generateWeek 不把 haveFoods 接下去",
    why: "本週頁傳進來的「家裡有」被靜默丟掉，冰箱裡的東西不會被優先吃掉。這是實際踩過的 bug：scoreSoft 是對的，少接一個參數就整個功能沒作用，而且畫面上看不出來。",
    file: "js/planner.js",
    find: "  const ctx = buildContext({ recipes, members, idx, units, rules, favorites, shoppingDays, haveFoods });\n  const rng = makeRng(`${seed}|${monday}`);",
    replace: "  const ctx = buildContext({ recipes, members, idx, units, rules, favorites, shoppingDays });\n  const rng = makeRng(`${seed}|${monday}`);",
    test: "plannertest",
  },
  {
    name: "本週頁不講「家裡有」讓哪幾道菜被選上",
    why: "使用者覺得「家裡有」跟「買了」重複，就是因為看不到它的作用。不講的話這個功能永遠自己解釋不了自己。",
    file: "js/views/week.js",
    find: "  const haveCard = haveUsed.count ? h('section', { class: 'card', dataset: { card: 'usedHave' } },",
    replace: "  const haveCard = false ? h('section', { class: 'card', dataset: { card: 'usedHave' } },",
    test: "weekviewtest",
  },
  {
    name: "「這次有客人」不收合",
    why: "逐項手改是每次買菜都用的，客人數偶爾才用。兩個並排會讓主要動作被稀釋。",
    file: "js/views/shopping.js",
    find: "    const extraBlock = h('details', { class: 'how no-print', open: extraOpen ? 'open' : null, dataset: { field: 'extraRow' } },",
    replace: "    const extraBlock = h('details', { class: 'how no-print', open: 'open', dataset: { field: 'extraRow' } },",
    test: "shoppingviewtest",
  },
  {
    name: "填了客人數卻仍然收起來",
    why: "調過的痕跡被藏在收合區裡，她看不到數量為什麼變多（使用者明確要求要看得出來）。",
    file: "js/views/shopping.js",
    find: "    const extraOpen = (range.extra.meat + range.extra.veg) > 0;",
    replace: "    const extraOpen = false;",
    test: "shoppingviewtest",
  },
  // ---- 使用者實測回報的四項 ----
  {
    name: "手改的數量被忽略",
    why: "她在菜攤前把小黃瓜改成 3 條，清單卻還是印 2 條 —— 這正是使用者要的功能，壞了等於沒做。",
    file: "js/shopping.js",
    find: "          item.manual = true;",
    replace: "          item.manual = false;",
    test: "shoppingtest",
  },
  {
    name: "手改之後不留建議值",
    why: "「原本建議多少」講不出來，「改回建議值」也回不去 —— 她只能自己記得原本是幾條。",
    file: "js/shopping.js",
    find: "      item.suggested = { grams: item.grams, buy: item.buy ? { ...item.buy } : null };",
    replace: "      item.suggested = null;",
    test: "shoppingtest",
  },
  {
    name: "手改之後還附上食譜需要的克數",
    why: "「約 3 顆（375 g）」會讓人以為 3 顆就是 375 克。括號裡是食譜需要的量，跟她決定要買幾顆是兩件事。",
    file: "js/shopping.js",
    find: "  if (item.manual && item.buy) return `約 ${fmtQty(item.buy.qty)} ${item.buy.unit}`;",
    replace: "  if (false) return `約 ${fmtQty(item.buy.qty)} ${item.buy.unit}`;",
    test: "shoppingtest",
  },
  {
    name: "複製出去的清單不標「已改」",
    why: "貼到 LINE 給家人代買，對方不知道哪幾項是特地改過的量。",
    file: "js/shopping.js",
    find: "      lines.push(`${mark} ${it.labels[0] ?? it.name}　${quantityText(it)}${it.manual ? '（已改）' : ''}`);",
    replace: "      lines.push(`${mark} ${it.labels[0] ?? it.name}　${quantityText(it)}`);",
    test: "shoppingtest",
  },
  {
    name: "畫面上不標「已改」",
    why: "數量被悄悄改掉卻沒有痕跡，她下次看不懂這個數字哪來的（使用者明確要求要看得出來）。",
    file: "js/views/shopping.js",
    find: "                  it.manual ? h('span', { class: 'qty-manual' }, '已改') : null,",
    replace: "                  null,",
    test: "shoppingviewtest",
  },
  {
    name: "早餐可以連兩天一樣",
    why: "使用者實際用過之後回報的第一件事就是這個。早餐不吃「幾天內不重複」那一套，但連著兩天一模一樣是另一回事。",
    file: "js/planner.js",
    find: "  if (!relaxBreakfast && role === 'breakfast' && state.lastServed && state.lastServed(recipe.id, date) === 1) return 'breakfastRepeat';",
    replace: "  void relaxBreakfast;",
    test: "plannertest",
  },
  {
    name: "使用者自己加的菜仍然強制 3 步",
    why: "現成的滷雞腳就「盛盤上桌」一步，卻被擋著存不了 —— 長輩會直接放棄。",
    file: "js/recipeschema.js",
    find: "  const minSteps = ctx.relaxRequired ? 1 : 3;",
    replace: "  const minSteps = 3;",
    test: "recipetest",
  },
  {
    name: "使用者自己加的菜不准填 0 分鐘",
    why: "買回來就能吃的菜，烹調時間真的是 0。逼她填 1 分鐘是要她說謊。",
    file: "js/recipeschema.js",
    find: "  const minTime = ctx.relaxRequired ? 0 : 1;",
    replace: "  const minTime = 1;",
    test: "recipetest",
  },
  {
    name: "驗證訊息用回程式術語",
    why: "使用者原話：「meatOnly 的菜裡沒有任何葷食材」這段文字不知道是什麼意思。",
    file: "js/recipeschema.js",
    find: "    err('這道菜標成「葷」，但食材裡沒有肉或海鮮。如果它其實吃素的人也能吃，請把「誰能吃」改成「素」。');",
    replace: "    err('meatOnly 的菜裡沒有任何葷食材');",
    test: "recipetest",
  },
  {
    name: "別名表查不到「雞腳」",
    why: "把表單簡化到沒有必填也沒用 —— 使用者舉的那道現成滷雞腳，食材還是解析不到編號、加不進去。",
    file: "data/aliases.json",
    find: "    \"雞腳\": \"I0420801\",",
    replace: "",
    test: "recipetest",
  },
  // ---- 購物清單：這張清單多幾個人吃 ----
  {
    name: "購物清單忽略「多幾個人吃」",
    why: "她填了「多 2 位吃葷」，數量卻一點都沒變 —— 客人來了買不夠。",
    file: "js/shopping.js",
    find: "        const scale = scaleWithGuests(r, members, extraByRange[range.key]);",
    replace: "        const scale = scaleFor(r, members);",
    test: "shoppingtest",
  },
  {
    name: "客人的人數套到素葷兩軌",
    why: "加 2 位吃葷的客人，素鍋軌也跟著乘 —— 這就是「全域倍率」的錯法：同時多買素菜、又買不夠肉。分軌的正確性要由結構保證。",
    file: "js/shopping.js",
    find: "  return { base: (veg + meat) / recipe.servings, veg: veg / recipe.splitServings.veg, meat: meat / recipe.splitServings.meat };",
    replace: "  return { base: (veg + meat) / recipe.servings, veg: (veg + meat) / recipe.splitServings.veg, meat: (veg + meat) / recipe.splitServings.meat };",
    test: "shoppingtest",
  },
  {
    name: "客人的倍數提早進位（先四捨五入再加）",
    why: "倍數在合併進克數之前就被進位，手算對照的數字全部對不上。份量換算只能在**最後**做一次。",
    file: "js/shopping.js",
    find: "  if (recipe.vegMode !== 'splittable') return { base: all / recipe.servings, veg: 0, meat: 0 };\n  return { base: (veg + meat) / recipe.servings",
    replace: "  if (recipe.vegMode !== 'splittable') return { base: Math.round(all / recipe.servings), veg: 0, meat: 0 };\n  return { base: (veg + meat) / recipe.servings",
    test: "shoppingtest",
  },
  {
    name: "常備品也跟著人數乘",
    why: "油鹽醬油被列進主清單並乘上人數。常備品是「用完再補」，不該因為多兩個客人就叫她再買一瓶醬油。",
    file: "js/shopping.js",
    find: "          if (ing.pantry) {",
    replace: "          if (false) {",
    test: "shoppingtest",
  },
  {
    name: "換頁之後忘記加過幾個人",
    why: "她調好人數、去別頁看一眼再回來，數量又縮回去了，而且畫面上的痕跡也不見了。",
    file: "js/views/shopping.js",
    find: "    extraByRange[r.key] = { meat: saved.extra?.meat ?? 0, veg: saved.extra?.veg ?? 0 };",
    replace: "    extraByRange[r.key] = { meat: 0, veg: 0 };\n    void saved;",
    test: "shoppingviewtest",
  },
  // ---- 本週頁：每一天可以摺疊 ----
  {
    name: "摺疊只改外觀，不用 hidden 移出版面",
    why: "看起來收起來了，但螢幕閱讀器仍然會把整天的菜念一遍，版面也還被它佔著。「收起來」變成一句視覺上的謊。",
    file: "js/views/week.js",
    find: "      body.hidden = !open;\n      summary.hidden = open;",
    replace: "      body.style.opacity = open ? '1' : '0.35';\n      summary.hidden = open;",
    test: "weekviewtest",
  },
  {
    name: "重新載入後不套用收起來的狀態",
    why: "每次進本週頁都是全部展開，使用者收起來的那幾天又冒回來。",
    file: "js/views/week.js",
    find: "    body.hidden = !isOpen;",
    replace: "    body.hidden = false;",
    test: "weekviewtest",
  },
  {
    name: "摺疊不更新 aria-expanded",
    why: "用讀螢幕的人不知道那一天是開還是收，按了也不曉得發生什麼事。",
    file: "js/views/week.js",
    find: "      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');",
    replace: "      toggle.setAttribute('aria-expanded', 'true');",
    test: "weekviewtest",
  },
  {
    name: "摺疊狀態不存起來",
    why: "收起來的日子重新整理就跑掉了 —— 一天要看好幾次菜單的人每次都要重收一遍。",
    file: "js/views/week.js",
    find: "      await prefs.setCollapsedDay(weekKey, day, !open);",
    replace: "      void weekKey;",
    test: "weekviewtest",
  },
  {
    name: "摺疊狀態不分週（變成全域）",
    why: "這一週收起週三，下一週的週三也是收的。摺疊多半是「這幾天已經煮過了」，那是這一週的事。",
    file: "js/prefs.js",
    find: "  return Array.isArray(all[weekKey]) ? all[weekKey] : [];",
    replace: "  return Object.values(all)[0] ?? [];",
    test: "weekviewtest",
  },
  {
    name: "日期列的觸控高度縮回 30px",
    why: "整條日期列就是開關；站在廚房拿手機的人點不到 30px 的東西。",
    file: "css/style.css",
    find: "  flex: 1 1 auto; min-width: 0; min-height: 44px;",
    replace: "  flex: 1 1 auto; min-width: 0; min-height: 30px;",
    test: "weekviewtest",
  },
  // ---- 檢測後修的六項：理由與診斷照實際原因、措辭分肉菜、欄位順序、文件對齊 ----
  {
    name: "理由回去照「開了哪些旗標」寫",
    why: "放寬是累加的：只因為保存期限才放寬的菜會被貼上「超過這一餐的時間上限」。使用者看到一個不存在的原因，照它去調時間上限也沒用。",
    file: "js/planner.js",
    find: "      const relaxed = actualRelaxations(best.recipe, { ...slotInfo, role }, ctx, state, base);",
    replace: "      const relaxed = Object.keys(relax).filter((k) => relax[k] && k.startsWith('relax'));",
    test: "plannertest",
  },
  {
    name: "actualRelaxations 探測時沒把那一條關掉",
    why: "四次探測都全部放寬的話 hardBlock 每次都回 null，等於「永遠沒有放寬」，理由整個消失。",
    file: "js/planner.js",
    find: "    const relax = { ...base, relaxMethod: true, relaxTime: true, relaxShelf: true, relaxDay: true, [key]: false };",
    replace: "    const relax = { ...base, relaxMethod: true, relaxTime: true, relaxShelf: true, relaxDay: true };",
    test: "plannertest",
  },
  {
    name: "「要先冷凍」對蔬菜也講",
    why: "九層塔、青江菜、板豆腐被叫去冷凍。保存天數只是排菜假設，講錯處理方式會被當成食材保存指引。",
    file: "js/planner.js",
    find: "    return FREEZABLE_CATS.has(b.cat)",
    replace: "    return true",
    test: "plannertest",
  },
  {
    name: "保存天數只認食材的第一個叫法",
    why: "overrides 寫 30 天的「薑」會落回蔬菜類的 3 天（別名表先收「老薑」）。畫面上出現「薑大約只放 3 天」的錯數字，排菜也被沒必要地卡住。",
    file: "js/units.js",
    find: "  for (const t of terms) if (typeof o[t] === 'number' && (best == null || o[t] < best)) best = o[t];",
    replace: "  for (const t of terms.slice(0, 1)) if (typeof o[t] === 'number') best = o[t];",
    test: "unittest",
  },
  {
    name: "診斷卡回到「一個旗標一筆」",
    why: "一道菜每踩到一條就多算一道，6 道會被講成十幾道，使用者以為菜單爛掉了。",
    file: "js/planner.js",
    find: "        if (relaxed.length) diagnostics.relaxed.push({ date, meal, role, pos, recipeId: recipe.id, constraints: relaxed });",
    replace: "        for (const c of relaxed) diagnostics.relaxed.push({ date, meal, role, pos, recipeId: recipe.id, constraints: [c] });",
    test: "weekviewtest",
  },
  {
    name: "診斷卡的原因寫死成「時間上限或同餐烹法」",
    why: "真正的主因（保存期限）從來不會被講出來，使用者照著去新增食譜是加錯方向。",
    file: "js/views/week.js",
    find: "  return RELAXABLE.filter((k) => counts[k]).map((k) => `${counts[k]} 道${RELAX_LABELS[k]}`).join('、');",
    replace: "  return '時間上限或同餐烹法';",
    test: "weekviewtest",
  },
  {
    name: "不提示「多勾一個買菜日」",
    why: "保存期限造成的放寬，最有效的解法就是多一個買菜日。不講的話使用者只看得到「食材放不到那一天」，不知道能做什麼。",
    file: "js/views/week.js",
    find: "  if (!n || shoppingDays.length !== 1) return null;",
    replace: "  if (true) return null;",
    test: "weekviewtest",
  },
  {
    name: "留意欄位回到「誰先被加進來」的順序",
    why: "同一個家庭換個新增順序，欄位順序就不一樣；每次都要重新找自己要看的那一欄。",
    file: "js/members.js",
    find: "  return NUTRIENT_ORDER.filter((k) => set.has(k));",
    replace: "  return [...set];",
    test: "membertest",
  },
  {
    name: "PLAN 的海鮮天數改回 2 天",
    why: "文件漂開是靜默的：下一個接手的人照 PLAN 把 units.json 改回 2 天，離買菜日最遠那兩天就排不出葷菜了。",
    file: "docs/PLAN.md",
    find: "（葉菜 3、海鮮 3、肉類 4、豆製品 3",
    replace: "（葉菜 3、海鮮 2、肉類 2、豆製品 3",
    test: "doctest",
  },
  {
    name: "PLAN 把「時間上限可設」寫回去",
    why: "文件寫「可設」但家人頁根本沒有這個設定，讀的人會去找一個不存在的開關。",
    file: "docs/PLAN.md",
    find: "**「可設」尚未實作**",
    replace: "（可設）",
    test: "doctest",
  },
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
    find: 'noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 0, staple: 0 },',
    replace: 'noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 14, staple: 0 },',
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
    find: '    if (!food) err(`${where} 在食材資料庫裡找不到「${ing?.food}」，換個常見的叫法試試（例如「雞腿」「高麗菜」）`);',
    replace: '    if (false) err(`${where} 找不到`);',
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
    find: '  if (steps.length < minSteps) err(ctx.relaxRequired ? \'至少要寫 1 個步驟\' : `步驟至少 3 步，只有 ${steps.length}`);',
    replace: '  if (steps.length < 0) err(`步驟太少`);',
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
    find: '      if (!(ctx.allowMissingGrams && ing?.grams == null)) err(`${where} grams 要 > 0：${ing?.grams}`);',
    replace: '      if (false) err(`${where} grams 要 > 0：${ing?.grams}`);',
    test: 'recipetest',
  },
  {
    name: '缺 split 步驟不算錯',
    why: '可分流的菜沒有「先盛出素食份」這一步，煮菜時間線就沒有分流點。',
    file: 'js/recipeschema.js',
    find: "    if (splitAt < 0) err('「可分流（一鍋兩吃）」的菜要有一個「分流」步驟（就是「先盛出素食份」那一步）');",
    replace: "    if (false) err('缺分流步驟');",
    test: 'recipetest',
  },
  {
    name: 'meat 軌裡沒有葷食材不算錯',
    why: '一道其實全素的菜被標成可分流，會佔掉素食家庭的「分流」名額。',
    file: 'js/recipeschema.js',
    find: "    if (!tags.has('meat') && !tags.has('seafood')) err('這道菜標成「可分流（一鍋兩吃）」，但整道都沒有肉或海鮮 —— 那它其實是素的，請把「誰能吃」改成「素」。');",
    replace: "    if (false) err('整道都沒有葷的');",
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
    name: '首次說明塞進一句「有助控制血糖」',
    why: '這是療效宣稱，App 的第一條紅線。',
    file: 'js/views/welcome.js',
    find: "  '三、長輩實際怎麼吃，請以醫師或營養師的指示為準。',",
    replace: "  '三、長輩實際怎麼吃，請以醫師或營養師的指示為準。這樣吃有助控制血糖。',",
    test: 'copytest',
  },
  // ---- M1：營養估算 ----
  {
    name: '素版把 meat 軌也加進去',
    why: '素食成員看到的鈉、蛋白質會多出葷鍋那一份 —— 兩版永遠不相加是紅線。',
    file: 'js/nutrition.js',
    find: "  if (version === 'veg') return ['base', 'veg'];",
    replace: "  if (version === 'veg') return ['base', 'veg', 'meat'];",
    test: 'nutritiontest',
  },
  {
    name: '資料庫的 null 當 0 累加',
    why: '「不知道」變成「沒有」：白飯的糖會顯示 0 g，而且看起來像量過。',
    file: 'js/nutrition.js',
    find: '  if (per100 == null || !Number.isFinite(per100)) return null;',
    replace: '  if (per100 == null || !Number.isFinite(per100)) return 0;',
    test: 'nutritiontest',
  },
  {
    name: '每人一份忘了除以份數',
    why: '四人份的總量標成每人一份，數字大四倍。',
    file: 'js/nutrition.js',
    find: '    const gramsPerServing = ing.grams / divisor;',
    replace: '    const gramsPerServing = ing.grams;',
    test: 'nutritiontest',
  },
  {
    name: '部分食材沒值時不記 partial',
    why: '畫面上少了「＊有食材未計入」，部分和會被當成完整的估計。',
    file: 'js/nutrition.js',
    find: '      if (val == null) { missing.push(k); partial[k].push(ing.label); continue; }',
    replace: '      if (val == null) { missing.push(k); continue; }',
    test: 'nutritiontest',
  },
  // ---- M1：家人 ----
  {
    name: '腎臟病沒勾子項時自動帶出鈉鉀磷蛋白質',
    why: 'STATUS 易錯第 2 條：限鉀只在醫囑時。沒勾就不該顯示、不該影響排序。',
    file: 'js/members.js',
    find: '      for (const k of member.kidneyWatch ?? []) if (KIDNEY_FIELDS.includes(k)) push(k);',
    replace: '      for (const k of (member.kidneyWatch?.length ? member.kidneyWatch : KIDNEY_FIELDS)) if (KIDNEY_FIELDS.includes(k)) push(k);',
    test: 'membertest',
  },
  {
    name: '全素不含五辛忽略五辛',
    why: '有蒜的三杯會排給不吃五辛的家人。',
    file: 'js/members.js',
    find: "    if (tags.includes('allium') && !recipe.alliumOptional) return null;",
    replace: '    if (false) return null;',
    test: 'membertest',
  },
  {
    name: '全素可以吃蛋奶',
    why: '番茄炒蛋會排給全素的家人。',
    file: 'js/members.js',
    find: "  if (tags.includes('egg') || tags.includes('dairy')) return null;",
    replace: '  if (false) return null;',
    test: 'membertest',
  },
  {
    name: '新家人的每日目標偷放一個醣量',
    why: 'App 不替任何人設目標；一個預設醣量就是在替使用者下處方。',
    file: 'js/members.js',
    find: '    targets: Object.fromEntries(TARGET_FIELDS.map((k) => [k, null])),',
    replace: "    targets: Object.fromEntries(TARGET_FIELDS.map((k) => [k, k === 'carb' ? 200 : null])),",
    test: 'membertest',
  },
  {
    name: '每日目標欄位載入時預先填 200',
    why: '畫面上的預設值就是建議值。',
    file: 'js/views/member.js',
    find: "      value: m.targets?.[k] == null ? '' : String(m.targets[k]),",
    replace: "      value: m.targets?.[k] == null ? '200' : String(m.targets[k]),",
    test: 'familytest',
  },
  {
    name: 'splitServings 加起來不等於 servings 也放行',
    why: '素版葷版的份數對不上總份數，每人一份就算錯。',
    file: 'js/recipeschema.js',
    find: '    else if (ss.veg + ss.meat !== r.servings) err(',
    replace: '    else if (false) err(',
    test: 'recipetest',
  },
  // ---- M1：畫面與資料 ----
  {
    name: '營養值不帶「估」字、null 顯示 0',
    why: '「每個數字前有估」是紅線；null 變 0 更是。',
    file: 'js/views/recipe.js',
    find: "      fmtNutrient(est.perServing[k], units[k]), est.partial[k].length ? h('sup'",
    replace: "      String(Math.round(est.perServing[k] ?? 0)), est.partial[k].length ? h('sup'",
    test: 'recipeviewtest',
  },
  {
    name: '「誰要吃」的飲食型態被忽略',
    why: '全素不含五辛的人會看到有肉有蒜的菜。',
    file: 'js/views/recipes.js',
    find: "  if (eater.startsWith('diet:')) return versionFor(recipe, eater.slice(5));",
    replace: "  if (eater.startsWith('diet:')) return recipe.vegMode === 'splittable' ? 'meat' : 'all';",
    test: 'recipeviewtest',
  },
  {
    name: '本週想吃沒有上限',
    why: '第 8 道也勾得起來，M2 的「本週想吃大加分」會把整週塞滿。',
    file: 'js/store.js',
    find: '  if (on && !current.includes(recipeId) && current.length >= MAX_WANT_THIS_WEEK) {',
    replace: '  if (false) {',
    test: 'recipeviewtest',
  },
  {
    name: '沒按「我知道了」也能進其他頁',
    why: '首次說明是健康界線的第一道；跳過它就沒有人看過那三句話。',
    file: 'js/app.js',
    find: "  if (!prefs.get('disclaimerAcceptedAt')) { navigate('/welcome', { replace: true }); return; }",
    replace: "  if (false) { navigate('/welcome', { replace: true }); return; }",
    test: 'shelltest',
  },
  // ---- M2：週計畫 ----
  {
    name: '規劃器用 Math.random',
    why: '同種子同輸入就該同輸出；不然「重新產生（鎖住的不動）」與測試都不可重現。',
    file: 'js/planner.js',
    find: '    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;',
    replace: '    return Math.random();',
    test: 'plannertest',
  },
  {
    name: '拿掉不重複扣分',
    why: '主菜會在 14 天內重複，「每週儘量不重複」就沒了。',
    file: 'js/planner.js',
    find: '    if (last != null && last <= noRepeat) { score -= NO_REPEAT_PENALTY[role] ?? 60;',
    replace: '    if (false) { score -= NO_REPEAT_PENALTY[role] ?? 60;',
    test: 'plannertest',
  },
  {
    name: '被迫重複時不記 diagnostics',
    why: '池子不夠時要明講，不是靜默重複。',
    file: 'js/planner.js',
    find: '        if (noRepeat > 0 && last != null && last <= noRepeat) diagnostics.forcedRepeats.push(',
    replace: '        if (false) diagnostics.forcedRepeats.push(',
    test: 'plannertest',
  },
  {
    name: '留意欄位高於中位數就排除（降分變排除）',
    why: 'STATUS 易錯第 1 條：慢性病只影響顯示與排序。變成排除，糖尿病家庭的池子會剩一半，等於 App 替醫師決定「這道不能吃」。',
    file: 'js/planner.js',
    find: '    if (val > med) { score -= WATCH_PENALTY;',
    replace: '    if (val > med) { return { score: -Infinity, reasons: [] };',
    test: 'plannertest',
  },
  {
    name: '腎臟病沒勾子項也拿鉀來計分',
    why: 'STATUS 易錯第 2 條：限鉀只在醫囑時。',
    file: 'js/planner.js',
    find: '  for (const m of members) for (const f of watchFields(m)) { if (!watchers.has(f)) watchers.set(f, []); watchers.get(f).push(m); }',
    replace: "  for (const m of members) for (const f of [...watchFields(m), ...((m.conditions ?? []).includes('kidney') ? ['potassium'] : [])]) { if (!watchers.has(f)) watchers.set(f, []); watchers.get(f).push(m); }",
    test: 'plannertest',
  },
  {
    name: '早餐也吃 14 天不重複',
    why: '11 道早餐兩週就耗光，每天早餐都被算成「被迫重複」。',
    file: 'js/planner.js',
    find: '  noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 0, staple: 0 },',
    replace: '  noRepeatDays: { main: 14, side: 7, soup: 7, breakfast: 14, staple: 0 },',
    test: 'plannertest',
  },
  {
    name: '有素食成員時也排他們吃不了的菜',
    why: '全素的家人會被排到清蒸魚。',
    file: 'js/planner.js',
    find: '  for (const m of ctx.vegetarians) if (versionFor(recipe, m.diet) === null) return `diet:${m.name}`;',
    replace: '  for (const m of ctx.vegetarians) if (false) return `diet:${m.name}`;',
    test: 'plannertest',
  },
  {
    name: '忽略保存期限',
    why: '週一買的葉菜排到週日煮。',
    file: 'js/planner.js',
    find: '    if (days != null && since > days) return { label: ing.label, cat: food.cat, days, since };',
    replace: '    if (false) return { label: ing.label, cat: food.cat, days, since };',
    test: 'plannertest',
  },
  {
    name: '重新產生時忽略鎖住的菜',
    why: '使用者鎖住的菜被換掉，「鎖定」就是騙人的。',
    file: 'js/planner.js',
    find: '      for (const it of lockedItems) items.push({ ...it, method: state.byId.get(it.recipeId).method });',
    replace: '      for (const it of []) items.push({ ...it, method: state.byId.get(it.recipeId).method });',
    test: 'plannertest',
  },
  {
    name: '外食格重新產生時被填回菜',
    why: '使用者標了外食，重新產生又排回菜、購物清單也會多買。',
    file: 'js/planner.js',
    find: "      if (prev && prev.kind !== 'cook') { slots.push({ ...prev, date }); continue; }",
    replace: '      if (false) { slots.push({ ...prev, date }); continue; }',
    test: 'plannertest',
  },
  {
    name: '「為什麼選這道」寫空的',
    why: '透明說明是 PLAN §5C 的定案功能。',
    file: 'js/planner.js',
    find: "        items.push({ recipeId: recipe.id, role, pos, locked: false, reasons, method: recipe.method });",
    replace: "        items.push({ recipeId: recipe.id, role, pos, locked: false, reasons: [], method: recipe.method });",
    test: 'plannertest',
  },
  {
    name: '「避開精緻糖」開關無效',
    why: '使用者自己開的硬約束是唯一允許排除菜的慢性病相關機制；它不生效，開關就是裝飾。',
    file: 'js/planner.js',
    find: "  if (rules.avoid.sweet && recipe.tags.includes('sweet')) return 'avoid:sweet';",
    replace: "  if (false) return 'avoid:sweet';",
    test: 'plannertest',
  },
  {
    name: '每日估計把葷版算給素食成員',
    why: '素葷各自算是紅線；全素的家人會看到含肉的數字。',
    file: 'js/planner.js',
    find: '        const v = versionFor(r, w.diet);\n        if (v === null) { missing += 1; continue; }',
    replace: "        const v = r.vegMode === 'splittable' ? 'meat' : 'all';\n        if (false) { missing += 1; continue; }",
    test: 'plannertest',
  },
  {
    name: '沒填目標的家人也顯示對照條',
    why: '對照條只給醫師或營養師有給目標的人；其他人看到「目標 undefined」等於 App 在暗示目標。',
    file: 'js/views/week.js',
    find: '        ...fields.filter((f) => targets[f] != null && row.fields[f] != null).map((f) => h(',
    replace: '        ...fields.filter((f) => row.fields[f] != null).map((f) => h(',
    test: 'weekviewtest',
  },
  // ---- M3：購物清單 ----
  {
    name: '共用軌不依人數縮放',
    why: '四人份食譜給三個人吃還是買四人份；數量是使用者會實際照著買的。',
    file: 'js/shopping.js',
    find: '  return { base: eaters / recipe.servings, veg: veg / recipe.splitServings.veg, meat: meat / recipe.splitServings.meat };',
    replace: '  return { base: 1, veg: veg / recipe.splitServings.veg, meat: meat / recipe.splitServings.meat };',
    test: 'shoppingtest',
  },
  {
    name: '素鍋軌不看吃素版的人數',
    why: '全家吃葷也會買一份素鍋的料。',
    file: 'js/shopping.js',
    find: '  return { base: eaters / recipe.servings, veg: veg / recipe.splitServings.veg, meat: meat / recipe.splitServings.meat };',
    replace: '  return { base: eaters / recipe.servings, veg: 1, meat: meat / recipe.splitServings.meat };',
    test: 'shoppingtest',
  },
  {
    name: '常備品混進主清單',
    why: '每張清單都會列鹽、油、醬油，真正要買的被淹沒。',
    file: 'js/shopping.js',
    find: '          if (ing.pantry) {',
    replace: '          if (false) {',
    test: 'shoppingtest',
  },
  {
    name: '外食那一餐的食材也買',
    why: '標了外食還是買一份菜回家。',
    file: 'js/shopping.js',
    find: "      if (slot.kind !== 'cook' || !range.dates.includes(slot.date)) continue;",
    replace: '      if (!range.dates.includes(slot.date)) continue;',
    test: 'shoppingtest',
  },
  {
    name: '同一食材不跨餐加總',
    why: '兩餐都用高麗菜只會顯示後面那一餐的量。',
    file: 'js/shopping.js',
    find: '          item.grams += grams;',
    replace: '          item.grams = grams;',
    test: 'shoppingtest',
  },
  {
    name: '不換算成顆、把',
    why: '清單只剩克數，站在菜攤前沒人知道 713 克高麗菜是幾顆。',
    file: 'js/shopping.js',
    find: '      item.buy = u ? toBuyQty(item.grams, u) : null;',
    replace: '      item.buy = null;',
    test: 'shoppingtest',
  },
  {
    name: '「家裡有」不加分',
    why: 'PLAN §4.3：勾了家裡有的食材下次產生要優先用掉。',
    file: 'js/planner.js',
    find: '    if (have.length) { score += Math.min(9, have.length * 3);',
    replace: '    if (false) { score += Math.min(9, have.length * 3);',
    test: 'plannertest',
  },
  {
    name: '「避開」開關預設全開',
    why: '慢性病相關的排除必須是使用者自己開的；預設開等於 App 替人決定。',
    file: 'js/views/family.js',
    find: "      label: a.label, hint: a.hint, checked: avoidNow()[a.key] === true, key: `avoid-${a.key}`,",
    replace: "      label: a.label, hint: a.hint, checked: true, key: `avoid-${a.key}`,",
    test: 'familytest',
  },
  {
    name: '買菜頁只顯示克數、不顯示顆把',
    why: '畫面上的數量跟邏輯層算出來的要一致；只顯示克數就失去換算的意義。',
    file: 'js/views/shopping.js',
    find: "          }, quantityText(it));",
    replace: "          }, `約 ${it.grams} g`);",
    test: 'shoppingviewtest',
  },
  {
    name: '拿掉 [hidden] 的 display:none !important',
    why: '.sub-block 與 .notice 是 display:flex，hidden 屬性會被蓋掉：腎臟病沒開時子項照樣顯示、空的錯誤框變成一條紅框。',
    file: 'css/style.css',
    find: '[hidden] { display: none !important; }',
    replace: '',
    test: 'familytest',
  },
  {
    name: 'toast 拿掉 pointer-events:none',
    why: 'toast 淡出的 250 毫秒會擋住底下的按鈕；使用者按存檔那一下會沒反應。',
    file: 'css/style.css',
    find: '  pointer-events: none;\n  position: fixed;\n  left: 50%;\n  bottom: calc(var(--tabbar-h) + 18px + env(safe-area-inset-bottom, 0px));',
    replace: '  position: fixed;\n  left: 50%;\n  bottom: calc(var(--tabbar-h) + 18px + env(safe-area-inset-bottom, 0px));',
    test: 'shelltest',
  },
  {
    name: '匯入前不驗證',
    why: '壞檔會走到 clear 之後才炸，使用者的資料一半沒了。',
    file: 'js/backup.js',
    find: '  const errors = validateImport(bundle);\n  if (errors.length) throw new Error(',
    replace: '  const errors = validateImport(bundle);\n  if (false) throw new Error(',
    test: 'backuptest',
  },
  {
    name: '匯入驗證不檢查主鍵',
    why: '缺主鍵的那一列會讓 put() 丟錯，而那時 store 已經清空了。',
    file: 'js/backup.js',
    find: '      else if (!hasKey(row, kp)) errors.push(',
    replace: '      else if (false) errors.push(',
    test: 'backuptest',
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
    find: "  if (best != null) return best;",
    replace: "  if (false) return best;",
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

  // ---- M4：今日煮時間線、非同步守門、換版、版面 ----
  {
    name: '備料沒有排在開火之前',
    why: '一邊炒一邊切，鍋子燒焦。時間線的第一條規則。',
    file: 'js/timeline.js',
    find: "  if (step?.type === 'prep') return 'prep';",
    replace: "  if (false) return 'prep';",
    test: 'timelinetest',
  },
  {
    name: '煮最久的那道沒有先下鍋',
    why: '先炒五分鐘的青菜、最後才燉五十分鐘的湯，全家等到九點。',
    file: 'js/timeline.js',
    find: '    .sort((a, b) => (b.d.recipe.time ?? 0) - (a.d.recipe.time ?? 0) || a.i - b.i)',
    replace: '    .sort((a, b) => (a.d.recipe.time ?? 0) - (b.d.recipe.time ?? 0) || a.i - b.i)',
    test: 'timelinetest',
  },
  {
    name: '素葷收尾排到「盛出素食份」之前',
    why: '肉下鍋之後才盛素食份，素食成員吃到的是葷的。這是這個 App 的核心分流。',
    file: 'js/timeline.js',
    find: "export const PHASES = ['prep', 'cookBase', 'split', 'veg', 'meat', 'serve'];",
    replace: 'export const PHASES = ["prep", "cookBase", "veg", "meat", "split", "serve"];',
    test: 'timelinetest',
  },
  {
    name: '外食那一餐也給一條時間線',
    why: '說好外食，App 還叫人開火。',
    file: 'js/timeline.js',
    find: "  return !!slot && slot.kind === 'cook' && Array.isArray(slot.items) && slot.items.length > 0;",
    replace: '  return !!slot && Array.isArray(slot.items) && slot.items.length > 0;',
    test: 'timelinetest',
  },
  {
    name: '**把素版與葷版的營養加起來**',
    why: 'PLAN §3.3 的核心紅線：素版＝base＋veg、葷版＝base＋meat，各除各的份數，兩版永遠不相加。加起來的數字不屬於任何一個人。',
    file: 'js/timeline.js',
    find: '        est: estimate(r, idx, { version }),',
    replace: "        est: (() => { const e = estimate(r, idx, { version }); if (r.vegMode === 'splittable') { const o = estimate(r, idx, { version: version === 'veg' ? 'meat' : 'veg' }); for (const k of Object.keys(e.perServing)) { if (e.perServing[k] != null && o.perServing[k] != null) e.perServing[k] += o.perServing[k]; } } return e; })(),",
    test: 'timelinetest',
  },
  {
    name: '兩道菜的步驟共用同一個編號',
    why: '勾一步，另一道菜的那一步也跟著被劃掉。',
    file: 'js/timeline.js',
    find: '        id: `${dish.recipeId}#${i}`,',
    replace: '        id: dish.recipeId,',
    test: 'timelinetest',
  },
  {
    name: '畫面上把素版葷版加起來顯示',
    why: '同一條紅線的畫面版：邏輯層分開算，畫面卻印出兩版相加的數字。',
    file: 'js/views/today.js',
    find: '          fmtNutrient(t.est.perServing[f], units[f]),',
    replace: '          fmtNutrient(d.tracks.reduce((n, x) => n + (x.est.perServing[f] ?? 0), 0), units[f]),',
    test: 'todaytest',
  },
  {
    name: '勾了「完成」不存起來',
    why: '煮到一半去接個電話，回來全部重來。',
    file: 'js/views/today.js',
    find: '        await store.saveCookDone(dateIso, meal, done);',
    replace: '        void 0;',
    test: 'todaytest',
  },
  {
    name: '本週頁沒有「一起煮」的入口',
    why: 'PLAN §6：今日煮是從本週頁點今天進去的，沒有入口等於這個功能不存在。',
    file: 'js/views/week.js',
    find: "        anyCook ? h('a', { class: 'btn btn-sm no-print', href: `#/today?d=${date}`, dataset: { action: 'cookToday', day: String(day) } }, '一起煮 ›') : null),",
    replace: '        null),',
    test: 'todaytest',
  },
  {
    name: '沒有特大字級可以選',
    why: '會去調字級的人正是看不清楚的長輩；只有「標準／大字」對他們不夠。',
    file: 'js/prefs.js',
    find: "export const FONT_SCALES = ['md', 'lg', 'xl'];",
    replace: 'export const FONT_SCALES = ["md", "lg"];',
    test: 'familytest',
  },
  {
    name: 'pill 回到不可斷行（特大字級下壓到旁邊的字）',
    why: '「可分流（一鍋兩吃）」在 320px／特大下比整欄還寬，會蓋住右邊的「約 25 分」。',
    file: 'css/style.css',
    find: '  white-space: normal; overflow-wrap: anywhere; max-width: 100%;',
    replace: '  white-space: nowrap;',
    test: 'layouttest',
  },
  {
    name: '留意欄位整段不可斷行（被切出畫面外）',
    why: '「碳水化合物（醣） 估 28.2 g」不可斷行時是 215px，而它那一欄只有 163px —— 右半邊會蓋掉旁邊的「約 20 分」。注意它**不會**超出畫面（右緣 248px < 320px），所以只比畫面寬度的溢出檢查抓不到，要比的是容器。',
    file: 'css/style.css',
    find: '.watch-line .num { white-space: normal; max-width: 100%; }',
    replace: '.watch-line .num { white-space: nowrap; }',
    test: 'layouttest',
  },
  {
    name: '買菜列的名稱與數量不放在同一行',
    why: '站在菜攤前要一眼看到「這個買幾顆」。',
    file: 'css/style.css',
    find: '.shop-line1 { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }',
    replace: '.shop-line1 { display: block; }',
    test: 'layouttest',
  },
  {
    name: '菜名連結縮回 27px',
    why: '本週頁最常按的就是菜名（點進去看食譜）。整列 44px 不夠，連結自己要 44px。',
    file: 'css/style.css',
    find: '.meal-name { color: inherit; text-decoration: none; font-weight: 600; overflow-wrap: anywhere; display: flex; align-items: center; min-height: 44px; }',
    replace: '.meal-name { color: inherit; text-decoration: none; font-weight: 600; overflow-wrap: anywhere; }',
    test: 'uikittest',
  },
  {
    name: '衛教「開原文」縮回 20px',
    why: '每一句衛教都要點得到出處，那是紅線七的一部分。',
    file: 'css/style.css',
    find: '.edu a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; }',
    replace: '.edu a { text-decoration: underline; }',
    test: 'uikittest',
  },
  {
    name: '拿掉非同步畫面的守門',
    why: 'StockDiary 的使用者實際回報過：「點某顆按鈕會直接跳回主頁」。根因是慢的舊畫面醒來之後把自己畫上去。',
    file: 'js/router.js',
    find: 'export function renderIsStale() { return paintGen !== gen; }',
    replace: 'export function renderIsStale() { return false; }',
    test: 'racetest',
  },
  {
    name: '過期的畫面還能把使用者導走',
    why: '查不到食譜 id 時的 navigate 在 await 之後；使用者早就點去別頁了，這一導就是把人硬扯回來。',
    file: 'js/router.js',
    find: '  if (renderIsStale()) return;',
    replace: '  if (false) return;',
    test: 'racetest',
  },
  {
    name: '不認得的網址靜默跳回首頁',
    why: '版本混搭時使用者只會看到「按了就跳回首頁」，完全不知道要更新。',
    file: 'js/app.js',
    find: '  showVersionMismatch(path);',
    replace: "  void path; navigate('/', { replace: true });",
    // 守這條的是 shelltest：versionmixtest 的混搭情境服務的是**舊版** app.js，
    // 改新版的 notFound 影響不到它（第一版指錯測試，突變不會紅）。
    test: 'shelltest',
  },
  {
    name: '換版時直接在使用者手上重載，不問一聲',
    why: '使用者正在看菜單、正在照著時間線煮，畫面突然被抽掉重載。剛開 App 還沒動過才可以自動換版。',
    file: 'js/app.js',
    find: '    showUpdateBar(() => applyNow(worker));',
    replace: '    applyNow(worker);',
    test: 'versionmixtest',
  },
  {
    name: '舊版計畫不補位置欄位（純函式）',
    why: 'v0.6.0 以前存的計畫沒有 pos。不補的話，升級後那一週的本週頁找不到菜、換菜也會換錯道。',
    file: 'js/planner.js',
    find: '  if (!plan?.slots) return plan;',
    replace: '  if (plan) return plan;',
    test: 'plannertest',
  },
  {
    name: '讀計畫時不做相容轉換（畫面端）',
    why: '同上，但這條守的是「讀出來就補」這個接線 —— 純函式對了、沒有接上也一樣壞。',
    file: 'js/store.js',
    find: "export async function getPlan(weekKey) { return withPositions((await db.get('plans', weekKey)) ?? null); }",
    replace: "export async function getPlan(weekKey) { return (await db.get('plans', weekKey)) ?? null; }",
    test: 'weekviewtest',
  },

  // ---- 優化：一餐 3–5 道、每餐有葷、營養標示精簡 ----
  {
    name: '午晚餐回到一道配菜',
    why: '使用者說「推薦的數量太少，一餐以 3～5 道菜為準」。少一道配菜就回到一餐三道。',
    file: 'js/planner.js',
    find: "  lunch: ['main', 'side', 'side', 'staple'],",
    replace: "  lunch: ['main', 'side', 'staple'],",
    test: 'plannertest',
  },
  {
    name: '主菜不要求葷',
    why: '使用者說「每餐都要有葷食」。拿掉之後半數的午晚餐會變成全素，吃葷的人沒有肉。',
    file: 'js/planner.js',
    find: '        const requireMeaty = wantsMeat && role === \'main\';',
    replace: '        const requireMeaty = false;',
    test: 'plannertest',
  },
  {
    name: '素食保障不檢查就放葷加菜',
    why: '「每餐有葷」不可以蓋過素食成員的份。加菜之前要先確認他們還吃得到三道。',
    file: 'js/planner.js',
    find: '        if (!ctx.vegetarians.length) return Infinity;',
    replace: '        return Infinity;',
    test: 'plannertest',
  },
  {
    name: '每道菜不記位置（兩道配菜分不開）',
    why: '一餐有兩道配菜，只記角色的話換菜、鎖定、指定會作用到錯的那一道。',
    file: 'js/planner.js',
    find: '        items.push({ recipeId: recipe.id, role, pos, locked: false, reasons, method: recipe.method });',
    replace: '        items.push({ recipeId: recipe.id, role, locked: false, reasons, method: recipe.method });',
    test: 'plannertest',
  },
  {
    name: '肉類的保存天數回到 2 天',
    why: '一週買兩次的家庭離下一次買菜最遠是 3 天，設 2 天的話那幾天排不出任何葷菜 —— 「每餐有葷」會逼出每週重複同兩道加工肉。',
    file: 'data/units.json',
    find: '"肉類": 4,',
    replace: '"肉類": 2,',
    test: 'plannertest',
  },
  {
    name: '加菜不標「僅葷食成員」',
    why: '素食成員會以為那道也是給他們的。',
    file: 'js/views/week.js',
    find: "        it.extraMeat ? pill('僅葷食成員', 'accent') : null,",
    replace: '        null,',
    test: 'weekviewtest',
  },
  {
    name: '營養標示忽略家人的留意項目',
    why: '精簡的原則是「沒設就少顯示，有設的一定顯示」。忽略留意項目等於把糖尿病看醣、腎臟病看鈉鉀磷這件事拿掉 —— 那正是這個 App 對慢性病使用者的用處。',
    file: 'js/members.js',
    find: '  return [...BASE_DISPLAY_FIELDS, ...watch.filter((k) => !BASE_DISPLAY_FIELDS.includes(k))];',
    replace: '  return [...BASE_DISPLAY_FIELDS];',
    test: 'weekviewtest',
  },
  {
    name: '營養標示又變回全部 12 項',
    why: '使用者說標示太多；預設應該只有熱量與蛋白質，12 項收在「看全部 12 項」裡。',
    file: 'js/members.js',
    find: "export const BASE_DISPLAY_FIELDS = ['kcal', 'protein'];",
    replace: "export const BASE_DISPLAY_FIELDS = ['kcal', 'protein', 'fat', 'satFat', 'carb', 'sugar', 'fiber', 'sodium', 'potassium', 'phosphorus', 'calcium', 'cholesterol'];",
    test: 'recipeviewtest',
  },

  // ---- M5：食譜量、foods.json 格式、不重複天數、加到主畫面 ----
  {
    name: 'foods.json 的營養值順序改用寫死的一份',
    why: '檔案裡每筆的 n 是陣列。讀檔端不照檔案宣告的順序還原，而是自己寫死一份，兩邊一旦不同步，每個營養值都會錯位 —— 而且畫面上看起來還是一個合理的數字。',
    file: 'js/foods.js',
    find: '  const order = foodsJson.nutrients;',
    replace: '  const order = [...foodsJson.nutrients].reverse();',
    test: 'datatest',
  },
  {
    name: '不重複天數只給配菜與湯，主菜不能調',
    why: '主菜是最需要不重複的那一個（PLAN §2 預設 14 天），沒有 UI 等於使用者改不了。',
    file: 'js/views/family.js',
    find: "    { key: 'main', label: '主菜', options: [7, 14, 21] },",
    replace: '',
    test: 'familytest',
  },
  {
    name: '內容區底部沒有留出分頁列的高度',
    why: '最後一張卡片會被固定的分頁列蓋住 —— 在 iPhone 上那可能正好是「匯出備份檔」。',
    file: 'css/style.css',
    find: '  padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));',
    replace: '  padding-bottom: 0;',
    test: 'pwatest',
  },
  {
    name: '加到主畫面之後還是開在瀏覽器分頁裡',
    why: 'display 不是 standalone 的話，加到主畫面只是一個書籤，長輩看到的還是網址列。',
    file: 'manifest.webmanifest',
    find: '"display": "standalone",',
    replace: '"display": "browser",',
    test: 'pwatest',
  },
  {
    name: 'SW 快取照字面比對版本參數',
    why: '帶 ?v= 的請求命中不了預快取，線上看不出來（會走網路），**離線就整個打不開**。',
    file: 'sw.js',
    find: '    e.respondWith(caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request)));',
    replace: '    e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));',
    test: 'versionmixtest',
  },
];

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? String(process.argv[i + 1] ?? '') : '';
})();
const onlyKeys = only ? only.split('|').map((k) => k.trim()).filter(Boolean) : [];
const SELECTED = only ? MUTATIONS.filter((m) => [m.name, m.file, m.test].some((s) => onlyKeys.some((k) => s.includes(k)))) : MUTATIONS;
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
  // 沒有任何 ✗ 的失敗＝子行程根本沒跑完（崩潰、逾時、被殺），那時候要看的是尾端輸出，不是斷言。
  const fails = r.out.split('\n').filter((l) => l.includes('✗')).slice(0, 5);
  ok(r.passed, `基準 ${t} 通過`, r.passed ? '' : (fails.length ? fails : r.out.split('\n').filter(Boolean).slice(-8)).join('\n      '));
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
