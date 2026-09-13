// 版面掃描（npm run layouttest）。沿用 StockDiary 的作法。
//
// 每一頁 × 三種字級 × 三種寬度，掃四件事：
//   **溢出**：有沒有東西超出畫面右緣（手機上就是被切掉看不到）
//   **重疊**：兩段文字有沒有疊在一起
//   **橫向捲動**：整頁會不會左右晃
//   **對齊**：買菜清單同一區裡，數量欄的右緣要對齊、不會被擠到下一行
//
// 為什麼要掃**特大字級**：中文在特大下會把數字欄、pill 列、兩欄營養擠爆，
// 而這種問題在標準字級下完全看不出來 —— 會去調特大的人，正是最需要看得清楚的長輩。
//
// 這支會**先塞一批資料**（三位家人、一週菜單、購物清單勾選、煮到一半的進度、我的食譜），
// 因為空畫面不會爆版：掃一個沒有資料的 App 等於什麼都沒掃。
// 樣本裡放最長的名字與最多的標籤 —— 短名字照不出使用者真正會看到的那一版。

import puppeteer from 'puppeteer';
import { ok, eq, section, done, noneOf, everyOf, note } from './tap.mjs';
import { listen } from './serve.mjs';

const SCALES = ['md', 'lg', 'xl'];
const WIDTHS = [320, 390, 430]; // 320：iPhone SE；390：主流；430：Pro Max
const LONG_RECIPE = 'r-mapo-tofu-split'; // 名字最長的內建食譜：家常麻婆豆腐（可分素葷）

const { srv, port } = await listen(0);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-action="acceptDisclaimer"]');
  await page.click('[data-action="acceptDisclaimer"]');
  await page.waitForSelector('#view .card');

  section('先把畫面塞滿 —— 空畫面不會爆版');
  const seeded = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    const { generateWeek, mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const { buildShoppingList } = await import('./js/shopping.js');
    const { buildTimeline } = await import('./js/timeline.js');

    // 名字長、標籤多的都放進去：暱稱上限 20 字，長輩＋四種留意項目＋質地＋兩種過敏原
    await store.saveMember({ ...newMember(), name: '外婆（住在三重那位）', ageGroup: 'senior', diet: 'veganNoAllium', conditions: ['diabetes', 'hypertension', 'kidney', 'lipid'], kidneyWatch: ['sodium', 'potassium', 'phosphorus', 'protein'], texture: 'minced', allergens: ['peanut', 'seafood'], targets: { kcal: 1600, carb: 180, protein: 55, sodium: 2000, potassium: null, phosphorus: null, satFat: null } });
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'], texture: 'soft' });
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni', conditions: ['hypertension'] });
    await prefs.set('shoppingDays', [1, 4]);

    // 我的食譜：名字放到上限，克數故意留一個沒填（畫面會出現「未估算」那條長字串）
    const mine = {
      id: store.newUserRecipeId(), name: '媽媽的番茄炒蛋加九層塔版本', role: 'main', servings: 4, time: 15,
      method: 'stirfry', vegMode: 'nativeVeg', texture: 'soft', season: [],
      ingredients: [
        { food: '雞蛋', label: '雞蛋', grams: 200 },
        { food: '番茄', label: '牛番茄（切塊）', grams: 300 },
        { food: '鹽', label: '鹽', grams: 3, pantry: true },
        { food: '九層塔', label: '九層塔（最後放，沒量過）', grams: null },
      ],
      steps: [
        { stage: 'base', type: 'prep', text: '番茄切塊、蛋打散加一點鹽；九層塔洗淨摘葉。' },
        { stage: 'base', type: 'cook', text: '熱鍋下油炒蛋，半熟就先盛起來。' },
        { stage: 'base', type: 'cook', text: '同一鍋炒番茄到出汁，倒回蛋拌勻，起鍋前放九層塔。' },
      ],
    };
    await store.saveUserRecipe(mine);
    await store.toggleFavorite(mine.id);
    await store.toggleFavorite('r-mapo-tofu-split');
    await store.setWantThisWeek('r-mapo-tofu-split', true);

    const mondayIso = mondayOf(isoDate(new Date()));
    const { plan, diagnostics } = generateWeek({
      recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
      rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
      favorites: store.favoritesList(), history: [], mondayIso, seed: 'layout', shoppingDays: [1, 4], haveFoods: new Set(),
    });
    // 一格外食、一格不煮：本週頁三種狀態都要掃到
    const lunchIdx = plan.slots.findIndex((s) => s.meal === 'lunch');
    plan.slots[lunchIdx] = { ...plan.slots[lunchIdx], kind: 'eatOut', items: [] };
    const bIdx = plan.slots.findIndex((s) => s.meal === 'breakfast' && s.day === 1);
    plan.slots[bIdx] = { ...plan.slots[bIdx], kind: 'skip', items: [] };
    plan.slots.find((s) => s.kind === 'cook' && s.items.length).items[0].locked = true;
    await store.savePlan({ ...plan, diagnostics });

    // 購物清單：勾幾項「買了」「家裡有」
    const recipesById = new Map(store.allRecipes().map((r) => [r.id, r]));
    const { ranges } = buildShoppingList({ plan, recipesById, members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: [1, 4] });
    const r0 = ranges[0];
    await store.saveShopping({ rangeKey: r0.key, weekKey: plan.weekKey, checked: { [r0.items[0].foodId]: true }, have: { [r0.items[1].foodId]: true } });

    // 今日煮：挑**菜名最長**的那一餐（那一頁的 pill 是「家常麻婆豆腐（可分素葷）（主菜約 25 分）」
    // 這種長度，是全 App 最寬的一塊；隨便挑一餐的話樣本裡就沒有最寬的組合，等於沒掃）。
    // 順便勾兩步，讓劃線狀態也掃得到。
    const longestName = (s) => Math.max(...s.items.map((it) => recipesById.get(it.recipeId)?.name.length ?? 0));
    const slot = plan.slots.filter((s) => s.kind === 'cook' && s.items.length > 1)
      .sort((a, b) => longestName(b) - longestName(a))[0];
    const tl = buildTimeline({ slot, recipesById });
    await store.saveCookDone(slot.date, slot.meal, tl.groups[0].steps.slice(0, 2).map((s) => s.id));

    return {
      members: store.members().length,
      dishes: plan.slots.reduce((n, s) => n + s.items.length, 0),
      shoppingItems: r0.items.length,
      steps: tl.stepCount,
      today: { d: slot.date, meal: slot.meal },
      longestDish: slot.items.map((it) => recipesById.get(it.recipeId)?.name ?? '').sort((a, b) => b.length - a.length)[0],
      memberId: store.members()[0].id,
      myRecipeId: mine.id,
    };
  });
  ok(seeded.members === 3 && seeded.dishes >= 40, `塞了 ${seeded.members} 位家人、一週 ${seeded.dishes} 道菜`);
  ok(seeded.shoppingItems >= 10 && seeded.steps >= 8, `購物清單 ${seeded.shoppingItems} 項、今日煮 ${seeded.steps} 步`);
  ok(seeded.longestDish.length >= 9, `（樣本要有最寬的組合）今日煮那一餐的最長菜名是「${seeded.longestDish}」${seeded.longestDish.length} 字`);

  const ROUTES = [
    { name: '本週', hash: '#/' },
    { name: '今日煮', hash: `#/today?d=${seeded.today.d}&meal=${seeded.today.meal}` },
    { name: '買菜', hash: '#/shopping' },
    { name: '食譜清單', hash: '#/recipes' },
    { name: '食譜（最長名）', hash: `#/recipes/${LONG_RECIPE}` },
    { name: '我的食譜', hash: `#/recipes/${seeded.myRecipeId}` },
    { name: '新增食譜', hash: '#/recipes/new' },
    { name: '家人', hash: '#/family' },
    { name: '編輯家人（最多標籤）', hash: `#/family/${seeded.memberId}` },
  ];

  // 掃描器：溢出、重疊、橫向捲動、買菜清單的欄位對齊
  const scan = () => page.evaluate(() => {
    const root = document.getElementById('app');
    const docW = document.documentElement.clientWidth;
    const els = [...root.querySelectorAll('*')];
    // 收起來的 <details> 裡面沒有排版，Chrome 仍會回傳矩形（全部疊在 details 自己的位置上）——
    // 不排除的話，每一頁都會冒出一堆假的「重疊」。summary 本身看得見，要留著。
    const inClosedDetails = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const p = n.parentElement;
        if (p && p.tagName === 'DETAILS' && !p.open && n.tagName !== 'SUMMARY') return true;
      }
      return false;
    };
    const overflow = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (inClosedDetails(el)) continue;
      if (r.right > docW + 1 || r.left < -1) {
        overflow.push({ tag: el.tagName.toLowerCase(), cls: String(el.className ?? '').slice(0, 30), left: Math.round(r.left), right: Math.round(r.right), docW, text: (el.textContent ?? '').trim().slice(0, 30) });
      }
    }
    // 重疊只比對**帶文字的葉節點**；固定／黏著定位的東西（頂列、分頁列）與它們的子孫要排除，
    // 內容本來就會從它們底下捲過去，那不是爆版。
    const inFixed = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
      }
      return false;
    };
    const boxes = els.filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.children.length > 0) return false;
      if (inFixed(el) || inClosedDetails(el)) return false;
      return (el.textContent ?? '').trim().length > 0;
    }).map((el) => ({ r: el.getBoundingClientRect(), text: el.textContent.trim().slice(0, 24) }))
      .filter((b) => b.r.width > 0 && b.r.height > 0);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].r; const b = boxes[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) overlaps.push({ a: boxes[i].text, b: boxes[j].text, ox: Math.round(ox), oy: Math.round(oy) });
      }
    }
    // 買菜清單的欄位對齊：溢出與重疊都看不到「這一列換行了」——
    // 換行的那一列包得好好的，只是數量掉到名稱下面、右緣歪掉。
    const columns = [];
    for (const sec of root.querySelectorAll('.shop-section')) {
      const rows = [...sec.querySelectorAll('.shop-row')];
      if (rows.length < 2) continue;
      const parts = rows.map((row) => {
        const name = row.querySelector('.shop-name')?.getBoundingClientRect() ?? null;
        const qty = row.querySelector('.shop-qty')?.getBoundingClientRect() ?? null;
        const line = row.querySelector('.shop-line1')?.getBoundingClientRect() ?? null;
        if (!name || !qty || !line) return null;
        return {
          drop: qty.top - name.top,
          right: qty.right,
          // 這一列的名稱＋數量本來就放得下嗎？（放不下的列換行是刻意的，見測試裡的說明）
          fits: name.width + qty.width + 10 <= line.width + 0.5,
        };
      }).filter(Boolean);
      const rights = parts.map((p) => p.right);
      columns.push({
        rows: rows.length,
        maxDrop: parts.length ? Math.round(Math.max(...parts.map((p) => p.drop))) : 0,
        rightSpread: rights.length ? Math.round(Math.max(...rights) - Math.min(...rights)) : 0,
        fitting: parts.filter((p) => p.fits).length,
        fittingDropped: parts.filter((p) => p.fits && p.drop > 8).length,
        wrapped: parts.filter((p) => p.drop > 8).length,
      });
    }
    const pillChars = [...root.querySelectorAll('.pill')].map((e) => e.textContent.trim().length);
    // 留意欄位：量「這一項有沒有寬過它的父層」。父層就是它該待的那一欄。
    const watch = [];
    for (const el of root.querySelectorAll('.watch-line .num')) {
      if (inClosedDetails(el)) continue;
      const r = el.getBoundingClientRect();
      const pr = el.parentElement?.getBoundingClientRect();
      if (!pr || r.width === 0) continue;
      watch.push({ chars: el.textContent.trim().length, over: r.width > pr.width + 0.5, text: el.textContent.trim().slice(0, 24) });
    }
    return { overflow, overlaps, columns, docW, scrollW: document.documentElement.scrollWidth, leafCount: boxes.length,
      maxPillChars: pillChars.length ? Math.max(...pillChars) : 0,
      watchCount: watch.length,
      maxWatchChars: watch.length ? Math.max(...watch.map((w) => w.chars)) : 0,
      watchOver: watch.filter((w) => w.over).map((w) => w.text).slice(0, 3) };
  });

  const all = [];
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844 });
    for (const scale of SCALES) {
      await page.evaluate(async (s) => {
        const prefs = await import('./js/prefs.js');
        await prefs.set('fontScale', s);
        prefs.applyFontScale(s);
      }, scale);
      for (const route of ROUTES) {
        await page.evaluate(() => { location.hash = '#/family/new'; });
        await new Promise((r) => setTimeout(r, 180));
        await page.evaluate((h) => { location.hash = h; }, route.hash);
        await page.waitForFunction(() => document.querySelector('#view')?.textContent?.trim().length > 20, { timeout: 60000 });
        await new Promise((r) => setTimeout(r, 320));
        all.push({ width, scale, route: route.name, ...(await scan()) });
      }
    }
  }
  await page.evaluate(async () => {
    const prefs = await import('./js/prefs.js');
    await prefs.set('fontScale', 'md');
    prefs.applyFontScale('md');
  });

  const where = (p) => `${p.route} @${p.width}px/${p.scale}`;
  section(`掃了 ${all.length} 個組合（${ROUTES.length} 頁 × ${SCALES.length} 字級 × ${WIDTHS.length} 寬度）`);
  eq(all.length, ROUTES.length * SCALES.length * WIDTHS.length, '組合數對得上');
  everyOf(SCALES, (s) => all.filter((p) => p.scale === s).length === ROUTES.length * WIDTHS.length, '每一種字級都掃了全部頁面與寬度');
  ok(all.filter((p) => p.scale === 'xl').length === ROUTES.length * WIDTHS.length, `特大字級掃了 ${all.filter((p) => p.scale === 'xl').length} 組`);
  everyOf(all, (p) => p.leafCount >= 8, `每一組都真的量到東西（最少的一組有 ${Math.min(...all.map((p) => p.leafCount))} 個文字節點）`);
  // 沒有這一條，pill 的換行規則就沒有樣本可以驗 —— 標籤一改短，那條 CSS 的突變就不會紅了。
  ok(Math.max(...all.map((p) => p.maxPillChars)) >= 16,
    `（樣本要有最寬的組合）掃到的最長 pill 有 ${Math.max(...all.map((p) => p.maxPillChars))} 個字`);

  // 留意欄位：跟 pill 一樣要先確認**樣本裡有最寬的那個標籤**。
  // 少了這一條，哪天欄位順序或清單筆數一變、最長的標籤沒被渲染出來，
  // 下面那條就會安靜地變成恆真（2026-09-13 就是這樣：改成照 NUTRIENT_ORDER 排之後，
  // 「留意欄位整段不可斷行」那條突變不紅了，而且是完整套件才抓到的）。
  const watchPages = all.filter((p) => p.watchCount > 0);
  ok(watchPages.length >= 6, `（母體）${watchPages.length} 個組合真的渲染出留意欄位`);
  ok(Math.max(...watchPages.map((p) => p.maxWatchChars)) >= 16,
    `（樣本要有最寬的標籤）掃到的最長留意欄位有 ${Math.max(...watchPages.map((p) => p.maxWatchChars))} 個字（「碳水化合物（醣） 估 28.2 g」這種）`);
  noneOf(watchPages, (p) => p.watchOver.length > 0, '留意欄位沒有一項撐破它所在的那一欄（撐破的話右半邊會蓋掉旁邊的烹調時間）',
    watchPages.filter((p) => p.watchOver.length).slice(0, 3).map((p) => `${where(p)}：${p.watchOver.join('、')}`).join(' ／ '));

  noneOf(all, (p) => p.overflow.length > 0, '沒有任何元素超出畫面寬度',
    all.filter((p) => p.overflow.length).slice(0, 3).map((p) => `${where(p)}：${JSON.stringify(p.overflow.slice(0, 2))}`).join(' ／ '));
  noneOf(all, (p) => p.overlaps.length > 0, '沒有任何兩段文字疊在一起',
    all.filter((p) => p.overlaps.length).slice(0, 3).map((p) => `${where(p)}：${JSON.stringify(p.overlaps.slice(0, 2))}`).join(' ／ '));
  noneOf(all, (p) => p.scrollW > p.docW + 1, '畫面不會橫向捲動',
    all.filter((p) => p.scrollW > p.docW + 1).slice(0, 3).map((p) => `${where(p)}：scrollWidth ${p.scrollW} > ${p.docW}`).join(' ／ '));

  section('買菜清單：數量欄要對齊，不會被擠到下一行');
  const withList = all.filter((p) => p.columns.length > 0);
  ok(withList.length >= SCALES.length * WIDTHS.length, `有 ${withList.length} 個組合的畫面上有多列清單（母體不是空的）`);
  everyOf(withList, (p) => p.columns.every((c) => c.rows >= 2), '每一區都至少兩列可以互相比對');
  noneOf(withList, (p) => p.columns.some((c) => c.rightSpread > 2), '同一區裡數量欄的右緣對齊（差 ≤ 2px）',
    withList.filter((p) => p.columns.some((c) => c.rightSpread > 2)).slice(0, 3).map((p) => `${where(p)}：${Math.max(...p.columns.map((c) => c.rightSpread))}px`).join(' ／ '));
  // 「一律不准換行」在 320px／特大下做不到：「豬里肌肉片」＋「約 0.5 斤（133 g）」＋「家裡有」
  // 加起來就是比一行寬。硬寫成那樣只會變成一條永遠紅、或被放寬到沒有意義的斷言。
  // 真正的規則是：**放得下的那些列，一定要在同一行**；放不下的才准換到自己那一行（仍然靠右）。
  const totalFitting = withList.reduce((n, p) => n + p.columns.reduce((m, c) => m + c.fitting, 0), 0);
  const totalWrapped = withList.reduce((n, p) => n + p.columns.reduce((m, c) => m + c.wrapped, 0), 0);
  ok(totalFitting >= 60, `（母體）${totalFitting} 列的名稱＋數量本來就放得下（另有 ${totalWrapped} 列真的放不下）`);
  noneOf(withList, (p) => p.columns.some((c) => c.fittingDropped > 0), '**放得下的列，數量一定跟名稱在同一行**',
    withList.filter((p) => p.columns.some((c) => c.fittingDropped > 0)).slice(0, 3).map((p) => `${where(p)}：${p.columns.reduce((m, c) => m + c.fittingDropped, 0)} 列`).join(' ／ '));
  noneOf(withList, (p) => p.columns.some((c) => c.maxDrop > 60), '放不下的列最多換一行，不會散成兩行以上',
    withList.filter((p) => p.columns.some((c) => c.maxDrop > 60)).slice(0, 3).map((p) => `${where(p)}：掉了 ${Math.max(...p.columns.map((c) => c.maxDrop))}px`).join(' ／ '));
  note(`換行的列：${SCALES.map((s) => `${s} ${WIDTHS.map((w) => `${w}px:${withList.filter((p) => p.scale === s && p.width === w).reduce((n, p) => n + p.columns.reduce((m, c) => m + c.wrapped, 0), 0)}`).join('／')}`).join('、')}`);

  eq(pageErrors, [], '整段沒有未攔截的例外');
} finally {
  await browser.close();
  srv.close();
}

done('layouttest');
