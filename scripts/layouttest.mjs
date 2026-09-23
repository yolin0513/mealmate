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
import { pinToday } from './browserlib.mjs';
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
  await pinToday(page); // 今天固定在本週一：七張日卡都在（今天之前的日子不列出來）
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
    // 自己的葷食譜：本週頁「我的」＋「僅葷食成員」＋🔒 那一列要用（2026-09-21 U11）
    const mineMeat = {
      id: store.newUserRecipeId(), name: '阿公的紅燒豬五花', role: 'main', servings: 4, time: 40,
      method: 'braise', vegMode: 'meatOnly', vegModeConfirmed: true, texture: 'soft', season: [],
      ingredients: [{ food: '', label: '豬五花肉', grams: 400 }, { food: '', label: '醬油', grams: 30, pantry: true }],
      steps: [{ stage: 'base', type: 'cook', text: '五花肉煎香，加醬油與水小火燒到軟。' }],
    };
    await store.saveUserRecipe(mineMeat);
    await store.toggleFavorite(mine.id);
    await store.toggleFavorite('r-mapo-tofu-split');
    await store.setWantThisWeek('r-mapo-tofu-split', true);

    const mondayIso = mondayOf(isoDate(new Date()));
    const { plan, diagnostics } = generateWeek({
      recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
      rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
      favorites: store.favoritesList(), history: [], mondayIso, seed: 'layout', shoppingDays: [1, 4],
    });
    // 一格外食、一格不煮：本週頁三種狀態都要掃到
    const lunchIdx = plan.slots.findIndex((s) => s.meal === 'lunch');
    plan.slots[lunchIdx] = { ...plan.slots[lunchIdx], kind: 'eatOut', items: [] };
    const bIdx = plan.slots.findIndex((s) => s.meal === 'breakfast' && s.day === 1);
    plan.slots[bIdx] = { ...plan.slots[bIdx], kind: 'skip', items: [] };
    plan.slots.find((s) => s.kind === 'cook' && s.items.length).items[0].locked = true;
    // 本週頁最擠的兩種列（使用者 2026-09-17 回報「⋯」被擠到下一行的就是第一種；
    // 2026-09-21 起自己的食譜多掛一個「我的」，所以兩種都改用自訂食譜，變成三個小標＋「⋯」）：
    //   · 我的 ＋ 自己加的 ＋ 🔒 → 角色標籤、菜名、三個小標、「⋯」
    //   · 我的 ＋ 僅葷食成員 ＋ 🔒 → 同上
    const busy = plan.slots.find((s) => s.kind === 'cook' && s.meal === 'lunch' && s.items.some((it) => it.extraMeat));
    if (busy) {
      busy.items.push({ recipeId: mine.id, role: 'side', pos: Math.max(...busy.items.map((it) => it.pos)) + 1, locked: true, added: true, reasons: ['你自己加的，已鎖定'] });
      const extra = busy.items.find((it) => it.extraMeat);
      extra.locked = true;
      extra.recipeId = mineMeat.id;
    }
    await store.savePlan({ ...plan, diagnostics });

    // 購物清單：勾幾項「買了」
    const recipesById = new Map(store.allRecipes().map((r) => [r.id, r]));
    const { ranges } = buildShoppingList({ plan, recipesById, members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: [1, 4] });
    const r0 = ranges[0];
    await store.saveShopping({ rangeKey: r0.key, weekKey: plan.weekKey, checked: { [r0.items[0].foodId]: true } });

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
    // 摺疊之後版面會變（桌機七欄少了內容、手機卡片只剩一行），要一起掃過三種字級
    { name: '本週（收起三天）', hash: '#/', collapse: [0, 3, 6] },
    { name: '今日煮', hash: `#/today?d=${seeded.today.d}&meal=${seeded.today.meal}` },
    { name: '買菜', hash: '#/shopping' },
    { name: '買菜（改過數量）', hash: '#/shopping', manualQty: true, longQty: true },
    // 自己加的項目（名稱與數量放到上限）
    { name: '買菜（自己加的）', hash: '#/shopping', guestsCustom: true },
    // 某一區全部買齊 → 自動收合，標題只剩摘要
    { name: '買菜（買齊收合）', hash: '#/shopping', foldDone: true },
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
        const qtyEl = row.querySelector('.shop-qty');
        const qty = qtyEl?.getBoundingClientRect() ?? null;
        const line = row.querySelector('.shop-line1')?.getBoundingClientRect() ?? null;
        if (!name || !qty || !line) return null;
        return {
          drop: qty.top - name.top,
          right: qty.right,
          // 數量本身（不換行）就比一整行寬：這種列靠 max-width 才不會把右緣推出去
          overLine: qtyEl.scrollWidth > line.width + 0.5,
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
        overLine: parts.filter((p) => p.overLine).length,
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
    // 摺疊：分別數「收起來的日子」與「展開的日子」各有多少餐格真的看得見
    const dayBodies = { collapsedVisible: 0, openVisible: 0 };
    let dayToggleMinH = Infinity;
    for (const card of root.querySelectorAll('[data-card="day"]')) {
      const isOpen = card.dataset.open !== 'false';
      const meals = [...card.querySelectorAll('.meal-block')].filter((e) => e.getBoundingClientRect().height > 0).length;
      if (isOpen) { if (meals > 0) dayBodies.openVisible += 1; } else { dayBodies.collapsedVisible += meals; }
      const btn = card.querySelector('[data-action="toggleDay"]');
      if (btn) dayToggleMinH = Math.min(dayToggleMinH, btn.getBoundingClientRect().height);
    }
    // 本週頁的菜列：「⋯」一定要跟菜名同一列、靠在列的最右邊、不溢出。
    // 使用者 2026-09-17 回報「自己加的」那一列（標籤＋🔒）把「⋯」擠到下一行 ——
    // 溢出與重疊都抓不到那件事（它包在卡片裡、只是換了行），所以直接量（慣例 20）。
    const mealRows = [...root.querySelectorAll('.meal-item')].map((el) => {
      const menu = el.querySelector('.item-menu');
      const label = el.querySelector('.meal-name') ?? el.querySelector('.muted');
      if (!menu || !label) return null;
      const row = el.getBoundingClientRect();
      const m = menu.getBoundingClientRect();
      const n = label.getBoundingClientRect();
      // 收起來的那幾天，裡面的菜列是 0×0（看不見）。量它們只會量到 0，不是版面壞了。
      if (row.width < 1 || row.height < 1) return null;
      return {
        added: el.dataset.added === 'true',
        extra: el.dataset.extra === 'meat',
        empty: el.classList.contains('empty'),
        badges: el.querySelectorAll('.meal-badges > *').length,
        badgeTexts: [...el.querySelectorAll('.meal-badges > *')].map((b) => b.textContent.trim()),
        // 同一列＝兩者在垂直方向真的有重疊（不是靠 top 差多少猜的）
        sameRow: Math.min(m.bottom, n.bottom) - Math.max(m.top, n.top) > 2,
        gapToRight: Math.round(row.right - m.right),
        overflows: m.right > docW + 1 || row.right > docW + 1,
        menuW: Math.round(m.width), menuH: Math.round(m.height),
      };
    }).filter(Boolean);
    return { overflow, overlaps, columns, docW, scrollW: document.documentElement.scrollWidth, leafCount: boxes.length,
      dayBodies, dayToggleMinH: Number.isFinite(dayToggleMinH) ? Math.round(dayToggleMinH) : 999,
      mealRows,
      manualMarks: root.querySelectorAll('.qty-manual').length,
      // 「＋ 加一道」：使用者 2026-09-16 回報看不到它（根因是舊版快取，不是版面）——
      // 加一條量測把「看得到、按得到、跟餐別同一列」釘住，以後真的被擠掉就會紅。
      addDish: (() => {
        const btns = [...root.querySelectorAll('[data-action="addDish"]')];
        if (!btns.length) return null;
        const docW = document.documentElement.clientWidth;
        const rows = btns.map((b) => {
          const r = b.getBoundingClientRect();
          const label = b.closest('.meal-head')?.querySelector('strong')?.getBoundingClientRect();
          return { h: r.height, w: r.width, right: r.right, sameRow: label ? Math.abs(r.top - label.top) < r.height : false };
        });
        return {
          n: btns.length,
          minH: Math.round(Math.min(...rows.map((x) => x.h))),
          allVisible: rows.every((x) => x.w > 0 && x.h > 0),
          allInside: rows.every((x) => x.right <= docW + 1),
          allSameRow: rows.every((x) => x.sameRow),
        };
      })(),
      // 每日目標：三欄要對齊 —— 輸入框左緣、寬度、單位的左緣都一致（使用者截圖回報參差）
      targets: (() => {
        const inputs = [...root.querySelectorAll('.target-grid [data-target]')];
        if (!inputs.length) return null;
        const r = inputs.map((el) => el.getBoundingClientRect());
        const units = [...root.querySelectorAll('.target-grid .target-unit')].map((el) => el.getBoundingClientRect());
        const spread = (xs) => Math.round(Math.max(...xs) - Math.min(...xs));
        return {
          n: inputs.length,
          leftSpread: spread(r.map((x) => x.left)),
          widthSpread: spread(r.map((x) => x.width)),
          unitLeftSpread: units.length ? spread(units.map((x) => x.left)) : null,
          minH: Math.round(Math.min(...r.map((x) => x.height))),
        };
      })(),
      // 需求篩選：等寬、同列高度一致、按得到
      needFilters: (() => {
        const box = root.querySelector('.filter-grid');
        if (!box) return null;
        const chips = [...box.querySelectorAll('.chip')];
        if (!chips.length) return { n: 0 };
        const r = chips.map((c) => c.getBoundingClientRect());
        const rows = new Map();
        for (const x of r) { const k = Math.round(x.top); rows.set(k, [...(rows.get(k) ?? []), x]); }
        const widths = r.map((x) => Math.round(x.width));
        return {
          n: chips.length,
          widthSpread: Math.max(...widths) - Math.min(...widths),
          minH: Math.round(Math.min(...r.map((x) => x.height))),
          rowAligned: [...rows.values()].every((row) => row.every((x) => Math.abs(x.height - row[0].height) <= 1)),
        };
      })(),
      // 食譜頁的分段控制：格子要等寬、同一列對齊、每格按得到、永遠剛好一格是選中的
      segmented: (() => {
        const bar = root.querySelector('.segmented');
        if (!bar) return null;
        const segs = [...bar.querySelectorAll('.seg')];
        if (!segs.length) return { n: 0 };
        const r = segs.map((s) => s.getBoundingClientRect());
        const rows = new Map();
        for (const x of r) { const k = Math.round(x.top); rows.set(k, [...(rows.get(k) ?? []), x]); }
        const widths = r.map((x) => Math.round(x.width));
        return {
          n: segs.length,
          rows: rows.size,
          widthSpread: Math.max(...widths) - Math.min(...widths),
          minH: Math.round(Math.min(...r.map((x) => x.height))),
          on: segs.filter((s) => s.getAttribute('aria-pressed') === 'true').length,
          rowAligned: [...rows.values()].every((row) => row.every((x) => Math.abs(x.height - row[0].height) <= 1)),
          insideBar: r.every((x) => x.right <= bar.getBoundingClientRect().right + 1),
        };
      })(),
      // 日期列：「一起煮」要跟日期在同一列、靠右（有沒有買菜日標籤都一樣）
      dayHeads: [...root.querySelectorAll('[data-card="day"]')].map((c) => {
        const btn = c.querySelector('[data-action="cookToday"]');
        const tog = c.querySelector('[data-action="toggleDay"]');
        const head = c.querySelector('.day-head');
        if (!btn || !tog || !head) return null;
        const b = btn.getBoundingClientRect(); const t = tog.getBoundingClientRect(); const hd = head.getBoundingClientRect();
        if (b.width === 0) return null;
        return { pill: !!tog.querySelector('.pill'), sameRow: b.top < t.bottom - 4, rightGap: Math.round(hd.right - b.right) };
      }).filter(Boolean),
      guestFields: root.querySelectorAll('[data-field="extraRow"], [data-field="extraMeat"], [data-field="extraVeg"]').length,
      customRows: root.querySelectorAll('.custom-row').length,
      // 設定列的標籤：每一行至少幾個字（被旁邊的長 chip 擠成「一欄一個字」時是 1）
      prefLabels: [...root.querySelectorAll('.pref-label')].filter((el) => el.getBoundingClientRect().height > 0).map((el) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        const lines = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size || 1;
        const chars = el.textContent.trim().length;
        return { text: el.textContent.trim().slice(0, 12), chars, lines, perLine: chars / lines };
      }),
      // 常備品預設就是收合的（用完再補），不算「買齊收合」
      foldedSections: [...root.querySelectorAll('.shop-section:not(.pantry-section)')].filter((x) => x.dataset.foldOpen === 'false').length,
      // 買菜頁控制項（使用者回報第五輪）：長得像超連結的控制項、摺疊箭頭、底下三顆按鈕的排列
      // 「數量」那顆刻意用虛線底線標「可以改」，不算超連結樣式
      linkish: [...document.querySelectorAll('#view button, #view a, #view summary')]
        .filter((b) => b.getBoundingClientRect().height > 0 && b.dataset.action !== 'editQty')
        .filter((b) => getComputedStyle(b).textDecorationLine.includes('underline') || b.classList.contains('linklike'))
        .map((b) => b.textContent.trim().slice(0, 12)),
      carets: [...root.querySelectorAll('[data-action="fold"]')].filter((t) => t.getBoundingClientRect().height > 0).map((t) => {
        const c = t.querySelector('.fold-caret');
        const r = c?.getBoundingClientRect();
        return { open: t.getAttribute('aria-expanded') === 'true', glyph: c?.textContent ?? null, ratio: r ? r.width / parseFloat(getComputedStyle(t).fontSize) : 0 };
      }),
      actions: [...root.querySelectorAll('[data-field="shopActions"]')].map((box) => {
        const rect = (sel) => box.querySelector(sel)?.getBoundingClientRect();
        const a = rect('[data-action="addCustom"]'); const c = rect('[data-action="copyList"]'); const p = rect('[data-action="print"]');
        if (!a || !c || !p) return { missing: true };
        // 字被拆成幾行：同一段文字的行框有幾種不同的上緣
        const lines = (sel) => { const rg = document.createRange(); rg.selectNodeContents(box.querySelector(sel)); return new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
        const card = box.closest('.card').getBoundingClientRect();
        return {
          minH: Math.round(Math.min(a.height, c.height, p.height)),
          copyPrintRow: Math.abs(c.top - p.top) <= 2 && p.left >= c.right - 1,
          copyPrintEqual: Math.abs(c.width - p.width) <= 2,
          addAbove: a.bottom <= c.top + 1,
          edges: Math.round(Math.max(Math.abs(a.left - c.left), Math.abs(a.right - p.right))),
          inside: a.left >= card.left - 1 && p.right <= card.right + 1 && a.right <= card.right + 1,
          maxLines: Math.max(lines('[data-action="addCustom"]'), lines('[data-action="copyList"]'), lines('[data-action="print"]')),
        };
      }),
      qtyBtnMinH: (() => {
        const hs = [...root.querySelectorAll('[data-action="editQty"]')].map((e) => e.getBoundingClientRect().height);
        return hs.length ? Math.round(Math.min(...hs)) : 999;
      })(),
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
        // 每一天都**明確**設成展開或收起（2026-09-18 起沒設的天會依今天收合，不能靠跑測試當天是星期幾）
        await page.evaluate(async (days) => {
          const prefs = await import('./js/prefs.js');
          const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
          const wk = weekKeyOf(mondayOf(isoDate(new Date())));
          await prefs.set('collapsedDays', { [wk]: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, days.includes(d) ? 'closed' : 'open'])) });
        }, route.collapse ?? []);
        // 每一個 route 前面都把「手改過的數量」設成它要的樣子，否則狀態會互相污染
        await page.evaluate(async (on) => {
          const store = await import('./js/store.js');
          const prefs = await import('./js/prefs.js');
          const { rangesOfPlan } = await import('./js/shopping.js');
          const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
          const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
          if (!plan) return;
          for (const r of rangesOfPlan(plan, prefs.get('shoppingDays') ?? [])) {
            const row = await store.getShopping(r.key);
            // 改一半的項目，另一半維持建議值 —— 兩種樣式會並排出現，才看得出會不會互相擠
            row.manual = {};
            if (on) {
              const { buildShoppingList } = await import('./js/shopping.js');
              const built = buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: prefs.get('shoppingDays') ?? [] });
              const items = built.ranges.find((x) => x.key === r.key)?.items ?? [];
              items.forEach((it, i) => { if (i % 2 === 0) row.manual[it.foodId] = (it.buy ? it.buy.qty : it.grams) + (it.buy ? 2 : 100); });
            }
            await store.saveShopping(row);
          }
        }, !!route.manualQty);
        await page.evaluate(async (opt) => {
          const store = await import('./js/store.js');
          const prefs = await import('./js/prefs.js');
          const { rangesOfPlan, buildShoppingList } = await import('./js/shopping.js');
          const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
          const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
          if (!plan) return;
          const days = prefs.get('shoppingDays') ?? [];
          const built = opt.foldDone ? buildShoppingList({ plan, recipesById: new Map(store.allRecipes().map((x) => [x.id, x])), members: store.members(), idx: store.foodsIndex(), units: store.units(), shoppingDays: days }) : null;
          for (const r of rangesOfPlan(plan, days)) {
            const row = await store.getShopping(r.key);
            row.custom = opt.guestsCustom ? [
              { id: 'c-long', name: '進口富士蘋果（要挑大顆一點不要太軟的）', qty: '一大袋約兩公斤' },
              { id: 'c-short', name: '香蕉', qty: '' },
            ] : [];
            // 2026-09-17：已經過去的採買卡預設是收起來的（shopping.orderRangesForToday）。
            // 這一支量的是「卡片展開時裡面排得整不整齊」，收起來的卡量到的一律是 0 —— 那不是版面壞了，是沒東西可量。
            // 所以每一張都用既有的手動展開機制（跟使用者點開補買走同一條路）打開，母體才會是全部的卡。
            // 「過去的卡預設收起來」本身由 shoppingviewtest 守。
            row.fold = { __card: 'open' };
            if (opt.foldDone) {
              const items = built.ranges.find((x) => x.key === r.key)?.items ?? [];
              const firstSec = items[0]?.section;
              row.checked = Object.fromEntries(items.filter((it) => it.section === firstSec).map((it) => [it.foodId, true]));
            } else {
              row.checked = {};
            }
            await store.saveShopping(row);
          }
        }, { guestsCustom: !!route.guestsCustom, foldDone: !!route.foldDone });
        await page.evaluate(() => { location.hash = '#/family/new'; });
        await new Promise((r) => setTimeout(r, 180));
        await page.evaluate((h) => { location.hash = h; }, route.hash);
        await page.waitForFunction(() => document.querySelector('#view')?.textContent?.trim().length > 20, { timeout: 60000 });
        await new Promise((r) => setTimeout(r, 320));
        // 食譜頁的需求篩選 2026-09-18 收進「更多選項」（預設收起）。量它們之前先打開；收起時的狀態另外記。
        const moreClosed = await page.evaluate(() => {
          const d = document.querySelector('[data-field="moreFilters"]');
          if (!d) return null;
          const wasClosed = !d.open;
          d.open = true;
          return wasClosed;
        });
        await new Promise((r) => setTimeout(r, 120));
        // 「數量比一整行還寬」要自己造：原本靠固定 seed 排出來的「約 21.5 根（1500 g）」，
        // 食譜一變就不在清單裡了，右緣那條斷言跟著靜默失效（2026-09-21 突變整套抓到；共用慣例 §5.8）。
        // 用當時那一串真實的字，前面補 hair space（U+200A，約 1–2px，nowrap 下不會被合併），
        // 補到剛好比一整行寬 3px 以上就停——跟當時一樣只多出幾 px（多太多會變成整頁橫向捲動，那是另一回事）。
        if (route.longQty) {
          await page.evaluate(() => {
            const el = document.querySelector('.shop-section .shop-row:not(.custom-row) .shop-qty');
            const line = el?.closest('.shop-line1');
            if (!el || !line) return;
            const base = '約 21.5 根（1500 g）';
            el.textContent = base;
            for (let i = 1; i <= 600 && el.scrollWidth <= line.getBoundingClientRect().width + 3; i += 1) {
              el.textContent = ' '.repeat(i) + base;
            }
          });
          await new Promise((r) => setTimeout(r, 60));
        }
        all.push({ width, scale, route: route.name, moreClosed, ...(await scan()) });
      }
    }
  }

  // ---- 菜色選項卡（modal）：三種字級 × 三種寬度各開一次量 ----
  // 2026-09-18 使用者回報：這張卡在別支手機上跑版（下方按鈕、關閉圖示都跑掉）。
  // 它是 modal，主掃描掃不到，所以另外開一次量：不溢出、✕ 在卡片裡且不壓到標題文字、
  // 三顆按鈕等寬且 ≥44px、「看食譜」跟菜名同一行、卡上沒有估算數字。
  const menuCards = [];
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844 });
    for (const scale of SCALES) {
      await page.evaluate(async (s) => { const prefs = await import('./js/prefs.js'); await prefs.set('fontScale', s); prefs.applyFontScale(s); }, scale);
      await page.evaluate(async () => {
        const prefs = await import('./js/prefs.js');
        const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
        await prefs.set('collapsedDays', { [weekKeyOf(mondayOf(isoDate(new Date())))]: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, 'open'])) });
      });
      await page.evaluate(() => { location.hash = '#/family/new'; });
      await new Promise((r) => setTimeout(r, 180));
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForSelector('.meal-item[data-extra="meat"] .item-menu', { timeout: 60000 });
      await new Promise((r) => setTimeout(r, 250));
      // 挑一道加菜：它的理由最多、卡片最容易被撐爆
      await page.$eval('.meal-item[data-extra="meat"] .item-menu', (el) => el.click());
      await page.waitForSelector('.modal-card .modal-actions .btn', { timeout: 30000 });
      await new Promise((r) => setTimeout(r, 200));
      menuCards.push({ width, scale, ...(await page.evaluate(() => {
        const c = document.querySelector('.modal-card');
        const cr = c.getBoundingClientRect();
        const docW = document.documentElement.clientWidth;
        const x = c.querySelector('.modal-x').getBoundingClientRect();
        const t = c.querySelector('.modal-title');
        const tr = t.getBoundingClientRect();
        const tPad = parseFloat(getComputedStyle(t).paddingRight);
        const btns = [...c.querySelectorAll('.modal-actions .btn')].map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), right: r.right, left: r.left, top: r.top }; });
        const name = c.querySelector('.menu-name')?.getBoundingClientRect();
        const open = c.querySelector('.menu-open')?.getBoundingClientRect();
        const inside = [...c.querySelectorAll('*')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.right <= cr.right + 1 && r.left >= cr.left - 1); });
        return {
          cardInDoc: cr.right <= docW + 1 && cr.left >= -1,
          allInside: inside,
          xInside: x.right <= cr.right + 1 && x.top >= cr.top - 1,
          titleClearOfX: (tr.right - tPad) <= x.left + 1,
          btns,
          // 2026-09-18 Yolin：上排「鎖定｜拿掉」兩顆等寬並排，下排「我來指定…」滿寬＝上排左緣到右緣（含中間間距）
          topPair: btns.length === 3 && Math.abs(btns[0].top - btns[1].top) <= 1 && Math.abs(btns[0].w - btns[1].w) <= 2,
          wideSpan: btns.length === 3 && btns[2].top > btns[0].top + 1 && Math.abs(btns[2].left - btns[0].left) <= 1.5 && Math.abs(btns[2].right - btns[1].right) <= 1.5,
          minBtnH: Math.min(...btns.map((b) => b.h)),
          openSameRow: name && open ? Math.abs(name.top - open.top) < Math.max(name.height, open.height) : false,
          hasEst: /估|中位數/.test(c.querySelector('.modal-body').textContent),
          docScrollW: document.documentElement.scrollWidth, docW,
        };
      })) });
      await page.evaluate(() => document.querySelector('.modal-x').click());
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  await page.setViewport({ width: 390, height: 844 });

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

  // 摺疊：收起來的那幾天不可以還佔著版面（不然「收起來」只是視覺上的謊）
  const folded = all.filter((p) => p.route === '本週（收起三天）');
  ok(folded.length === SCALES.length * WIDTHS.length, `（母體）收起三天的本週頁掃了 ${folded.length} 組（三種字級 × 三種寬度）`);
  everyOf(folded, (p) => p.dayBodies.collapsedVisible === 0,
    '收起來的三天，餐格一個都量不到（hidden 真的把它們移出版面）');
  everyOf(folded, (p) => p.dayBodies.openVisible >= 4,
    `沒收的那幾天照常顯示（最少一組還看得到 ${Math.min(...folded.map((p) => p.dayBodies.openVisible))} 天的內容）`);
  const open = all.filter((p) => p.route === '本週');
  ok(open.length === SCALES.length * WIDTHS.length, `（對照母體）沒收起來的本週頁也掃了 ${open.length} 組`);
  everyOf(open, (p) => p.dayBodies.collapsedVisible === 0 && p.dayBodies.openVisible === 7,
    '（對照）同一頁不收的時候，七天的內容都看得到 —— 上面那條不是因為本來就量不到');
  everyOf(folded, (p) => p.dayToggleMinH >= 44,
    `收起來之後，日期列仍然按得到（最小 ${Math.min(...folded.map((p) => p.dayToggleMinH))}px）`);

  noneOf(all, (p) => p.overflow.length > 0, '沒有任何元素超出畫面寬度',
    all.filter((p) => p.overflow.length).slice(0, 3).map((p) => `${where(p)}：${JSON.stringify(p.overflow.slice(0, 2))}`).join(' ／ '));
  noneOf(all, (p) => p.overlaps.length > 0, '沒有任何兩段文字疊在一起',
    all.filter((p) => p.overlaps.length).slice(0, 3).map((p) => `${where(p)}：${JSON.stringify(p.overlaps.slice(0, 2))}`).join(' ／ '));
  noneOf(all, (p) => p.scrollW > p.docW + 1, '畫面不會橫向捲動',
    all.filter((p) => p.scrollW > p.docW + 1).slice(0, 3).map((p) => `${where(p)}：scrollWidth ${p.scrollW} > ${p.docW}`).join(' ／ '));

  section('手改過數量的買菜頁：標記看得到，數量欄照樣對齊');
  const manualPages = all.filter((p) => p.route === '買菜（改過數量）');
  ok(manualPages.length === SCALES.length * WIDTHS.length, `（母體）改過數量的買菜頁掃了 ${manualPages.length} 組`);
  everyOf(manualPages, (p) => p.manualMarks >= 3, `每一組都看得到「已改」標記（最少 ${Math.min(...manualPages.map((p) => p.manualMarks))} 個）`);
  const plainPages = all.filter((p) => p.route === '買菜');
  everyOf(plainPages, (p) => p.manualMarks === 0, '（對照）沒改過的買菜頁一個「已改」都沒有 —— 上面那條不是因為到處都印這兩個字');
  everyOf(manualPages, (p) => p.qtyBtnMinH >= 44, `改過之後數量還是按得到（最小 ${Math.min(...manualPages.map((p) => p.qtyBtnMinH))}px）`);

  section('日期列：「一起煮」不論有沒有買菜日標籤都靠右、不掉行');
  // 使用者截圖：有「買菜日」標籤的那天，「一起煮」被擠到下一行、跑到左邊，跟其他天對不齊。
  // 為什麼以前沒抓到：fixture 早就設了買菜日（週一、週四），320px 也每次都掃 —— 那個壞掉的狀態
  // 其實每一輪都有被畫出來（修之前量到 320px 有標籤的日子 100% 掉行、沒標籤的 0%）。
  // 但掃描器只量「超出畫面」「兩段文字重疊」「橫向捲動」，按鈕整個換到下一行、靠左，三樣都不算。
  // 缺的不是狀態，是量測：這裡直接量按鈕跟日期在不在同一列、離右緣多遠。
  const heads = all.flatMap((p) => (p.dayHeads ?? []).map((d) => ({ ...d, where: where(p) })));
  const pillHeads = heads.filter((d) => d.pill);
  ok(pillHeads.length >= SCALES.length * WIDTHS.length, `（前提）掃到 ${pillHeads.length} 個有「買菜日」標籤的日期列（每種字級 × 寬度都要有）`);
  ok(heads.length - pillHeads.length >= SCALES.length * WIDTHS.length, `（對照母體）沒有標籤的日期列 ${heads.length - pillHeads.length} 個`);
  everyOf(heads, (d) => d.sameRow, '「一起煮」一律跟日期在同一列，不會掉到下一行',
    heads.filter((d) => !d.sameRow).slice(0, 3).map((d) => `${d.where}${d.pill ? '（有買菜日標籤）' : ''}`).join(' ／ '));
  everyOf(heads, (d) => d.rightGap <= 1, '而且一律靠右對齊',
    heads.filter((d) => d.rightGap > 1).slice(0, 3).map((d) => `${d.where} 離右緣 ${d.rightGap}px`).join(' ／ '));

  section('「＋ 加一道」在每一餐都看得到、按得到（三種字級 × 三種寬度）');
  {
    // 2026-09-16 使用者回報看不到加菜按鈕。實測根因是他的裝置還在跑舊版，但版面這一面也要有斷言守著。
    const addPages = all.filter((p) => p.route === '本週' && p.addDish);
    ok(addPages.length === SCALES.length * WIDTHS.length, `（母體）本週頁掃了 ${addPages.length} 組`);
    ok(addPages.every((p) => p.addDish.n >= 14), `每一組有 ${addPages[0]?.addDish.n} 顆加一道按鈕（21 個餐格）`);
    everyOf(addPages, (p) => p.addDish.allVisible, '每一顆都畫得出來（不是 0×0）');
    everyOf(addPages, (p) => p.addDish.minH >= 44, `每一顆都按得到（最小 ${Math.min(...addPages.map((p) => p.addDish.minH))}px）`);
    everyOf(addPages, (p) => p.addDish.allInside, '沒有一顆被擠出畫面');
    everyOf(addPages, (p) => p.addDish.allSameRow, '跟餐別名稱在同一列（不會掉到下一行找不到）');
  }

  section('菜色選項卡：各字級 × 寬度都不跑版（三種字級 × 三種寬度）');
  {
    ok(menuCards.length === SCALES.length * WIDTHS.length, `（母體）開了 ${menuCards.length} 次菜色選項卡`);
    const mw = (p) => `${p.width}px/${p.scale}`;
    everyOf(menuCards, (p) => p.cardInDoc && p.docScrollW <= p.docW + 1, '卡片在畫面裡，沒有橫向捲動');
    everyOf(menuCards, (p) => p.allInside, '卡片裡的每一個元素都沒有超出卡片邊緣', menuCards.filter((p) => !p.allInside).map(mw).join(' ／ '));
    everyOf(menuCards, (p) => p.xInside && p.titleClearOfX, '關閉的 ✕ 在卡片右上角，而且不壓到標題文字', menuCards.filter((p) => !(p.xInside && p.titleClearOfX)).map(mw).join(' ／ '));
    everyOf(menuCards, (p) => p.btns.map((b) => b.label).join('|') === '鎖定這道|拿掉這道|我來指定…', '順序：上排鎖定、拿掉，下排我來指定', menuCards.map((p) => p.btns.map((b) => b.label).join('|')).join(' ／ '));
    everyOf(menuCards, (p) => p.topPair, '上排兩顆同一行、等寬（差 ≤ 2px）', menuCards.filter((p) => !p.topPair).map((p) => `${mw(p)} ${p.btns.map((b) => `${b.w}@${Math.round(b.top)}`).join('/')}`).join(' ／ '));
    everyOf(menuCards, (p) => p.wideSpan, '下排「我來指定…」單獨一行、左右緣對齊上排兩顆的外緣（寬＝兩顆＋間距）', menuCards.filter((p) => !p.wideSpan).map((p) => `${mw(p)} ${p.btns.map((b) => `${Math.round(b.left)}-${Math.round(b.right)}`).join('/')}`).join(' ／ '));
    everyOf(menuCards, (p) => p.minBtnH >= 44, `每一顆都按得到（最小 ${Math.min(...menuCards.map((p) => p.minBtnH))}px）`);
    everyOf(menuCards, (p) => p.openSameRow, '「看食譜」跟菜名同一行', menuCards.filter((p) => !p.openSameRow).map(mw).join(' ／ '));
    noneOf(menuCards, (p) => p.hasEst, '卡上沒有任何估算數字（每一種字級與寬度都一樣）');
  }

  section('本週頁菜列：「⋯」永遠跟菜名同一列、釘在最右邊（標籤再多也一樣）');
  {
    // 2026-09-17 使用者回報：手動加的那一道（「自己加的」標籤 ＋ 🔒）把「⋯」擠到下一行。
    // 根因是 .meal-item 的欄數跟子元素個數綁在一起，第五個子元素就被排到隱含的第二列。
    // 溢出／重疊／橫向捲動都抓不到這件事（它好好地包在卡片裡，只是換了行）—— 慣例 20：要守什麼就量什麼。
    const rows = all.filter((p) => p.route.startsWith('本週')).flatMap((p) => p.mealRows.map((r) => ({ ...r, where: where(p) })));
    ok(rows.length >= 200, `（母體）本週頁的菜列一共量了 ${rows.length} 列`);
    const withAdded = rows.filter((r) => r.added);
    const withExtra = rows.filter((r) => r.extra);
    ok(withAdded.length >= SCALES.length * WIDTHS.length, `（前提）其中「自己加的」列 ${withAdded.length} 列 —— 就是使用者回報的那一種`);
    ok(withExtra.length >= SCALES.length * WIDTHS.length, `（前提）「加菜」列 ${withExtra.length} 列`);
    ok(rows.some((r) => r.badges >= 2), `（前提）有 ${rows.filter((r) => r.badges >= 2).length} 列同時掛了兩個以上的標籤（標籤＋🔒）`);
    everyOf(rows, (r) => r.sameRow, '每一列的「⋯」都跟菜名在同一列',
      rows.filter((r) => !r.sameRow).slice(0, 3).map((r) => `${r.where}（標籤 ${r.badges} 個）`).join(' ／ '));
    everyOf(rows, (r) => r.gapToRight <= 2, `每一列的「⋯」都靠在最右邊（最遠 ${Math.max(...rows.map((r) => r.gapToRight))}px）`,
      rows.filter((r) => r.gapToRight > 2).slice(0, 3).map((r) => `${r.where} 離右緣 ${r.gapToRight}px`).join(' ／ '));
    noneOf(rows, (r) => r.overflows, '沒有任何一列的「⋯」被推出畫面');
    everyOf(rows, (r) => r.menuW >= 44 && r.menuH >= 44, `每一顆「⋯」都按得到（最小 ${Math.min(...rows.map((r) => r.menuW))}×${Math.min(...rows.map((r) => r.menuH))}px）`);

    // U11（2026-09-21）：自己的食譜多掛一個「我的」之後，最擠的兩種列各有三個小標。
    // 上面那四條 everyOf／noneOf 的母體已經含這兩種列，這裡把「它們真的在樣本裡」釘住 ——
    // 沒有這兩條，哪天塞資料的地方改掉、最擠的組合從樣本裡消失，上面照樣全綠。
    const has = (r, ...want) => want.every((w) => r.badgeTexts.includes(w));
    const mineAdded = rows.filter((r) => has(r, '我的', '自己加的', '🔒'));
    const mineExtra = rows.filter((r) => has(r, '我的', '僅葷食成員', '🔒'));
    ok(mineAdded.length >= SCALES.length * WIDTHS.length, `（前提）「我的＋自己加的＋🔒」的列 ${mineAdded.length} 列（每種字級×寬度都有）`);
    ok(mineExtra.length >= SCALES.length * WIDTHS.length, `（前提）「我的＋僅葷食成員＋🔒」的列 ${mineExtra.length} 列`);
    const tightest = [...mineAdded, ...mineExtra];
    everyOf(tightest, (r) => r.badges === 3, `U11 最擠的兩種列真的掛了三個小標（${JSON.stringify(tightest[0]?.badgeTexts)}）`);
    everyOf(tightest, (r) => r.sameRow && r.gapToRight <= 2 && !r.overflows,
      'U11 三個小標的那兩種列，「⋯」照樣跟菜名同一列、釘在最右邊、沒被推出畫面',
      tightest.filter((r) => !(r.sameRow && r.gapToRight <= 2 && !r.overflows)).slice(0, 3)
        .map((r) => `${r.where}（同列 ${r.sameRow}、離右緣 ${r.gapToRight}px、溢出 ${r.overflows}）`).join(' ／ '));
  }

  section('每日目標：名稱／輸入框／單位三欄對齊（三種字級 × 三種寬度）');
  {
    // 使用者 2026-09-16 截圖回報：輸入框左緣參差、寬度不一。慣例 20：要守的是「對齊」就量對齊。
    const tPages = all.filter((p) => p.route === '編輯家人（最多標籤）' && p.targets);
    ok(tPages.length === SCALES.length * WIDTHS.length, `（母體）編輯家人頁掃了 ${tPages.length} 組`);
    ok(tPages.every((p) => p.targets.n >= 5), `每一組有 ${tPages[0]?.targets.n} 個每日目標欄位`);
    everyOf(tPages, (p) => p.targets.leftSpread <= 1, '所有輸入框的左緣切齊（最大差 ' + Math.max(...tPages.map((p) => p.targets.leftSpread)) + 'px）');
    everyOf(tPages, (p) => p.targets.widthSpread <= 1, '所有輸入框等寬');
    everyOf(tPages, (p) => p.targets.unitLeftSpread <= 1, '右邊的單位（kcal／g／mg）也對齊');
    everyOf(tPages, (p) => p.targets.minH >= 44, `每個輸入框都按得到（最小 ${Math.min(...tPages.map((p) => p.targets.minH))}px）`);
  }

  section('食譜頁需求篩選：跟分段控制同一套節奏（等寬、對齊、按得到）');
  {
    const nPages = all.filter((p) => p.route === '食譜清單' && p.needFilters);
    ok(nPages.length === SCALES.length * WIDTHS.length, `（母體）食譜清單掃了 ${nPages.length} 組`);
    everyOf(nPages, (p) => p.moreClosed === true, '「更多選項」一開始是收起來的（大字級下才不會換好幾行）');
    ok(nPages.every((p) => p.needFilters.n === 5), `打開之後需求篩選 ${nPages[0]?.needFilters.n} 顆`);
    everyOf(nPages, (p) => p.needFilters.widthSpread <= 1, '每一顆等寬');
    everyOf(nPages, (p) => p.needFilters.rowAligned, '同一列的高度一致（換行也對齊）');
    everyOf(nPages, (p) => p.needFilters.minH >= 44, '每一顆都按得到');
  }

  section('食譜頁篩選：一條分段控制，等寬、對齊、按得到（三種字級 × 三種寬度）');
  {
    // 使用者 2026-09-16 回報原本那排篩選按鈕「太雜亂」。慣例 20：要守的是「整齊」就量整齊，
    // 溢出與重疊抓不到「寬度參差、沒對齊」。
    const segPages = all.filter((p) => p.route === '食譜清單' && p.segmented);
    ok(segPages.length === SCALES.length * WIDTHS.length, `（母體）食譜清單掃了 ${segPages.length} 組`);
    ok(segPages.every((p) => p.segmented.n >= 6), `分段控制有 ${segPages[0]?.segmented.n} 格（全部／素／可分流／葷／我的／收藏／本週想吃）`);
    everyOf(segPages, (p) => p.segmented.widthSpread <= 1, '每一格等寬（最大差 ' + Math.max(...segPages.map((p) => p.segmented.widthSpread)) + 'px）');
    everyOf(segPages, (p) => p.segmented.rowAligned, '同一列的格子高度一致');
    everyOf(segPages, (p) => p.segmented.minH >= 44, `每一格都按得到（最小 ${Math.min(...segPages.map((p) => p.segmented.minH))}px）`);
    everyOf(segPages, (p) => p.segmented.on === 1, '永遠剛好一格是選中的');
    everyOf(segPages, (p) => p.segmented.insideBar, '每一格都在軌道裡（沒有被擠出去）');
  }

  section('買菜頁新狀態：自己加的、買齊收合');
  const guestPages = all.filter((p) => p.route === '買菜（自己加的）');
  ok(guestPages.length === SCALES.length * WIDTHS.length, `（母體）自己加的買菜頁掃了 ${guestPages.length} 組`);
  everyOf(guestPages, (p) => p.customRows >= 2, '自己加的項目有畫出來（名稱與數量放到上限的那項也在）');
  everyOf(all.filter((p) => p.route.startsWith('買菜')), (p) => p.guestFields === 0, '買菜頁沒有客人數的欄位（功能已移除）');
  const foldPages = all.filter((p) => p.route === '買菜（買齊收合）');
  ok(foldPages.length === SCALES.length * WIDTHS.length, `（母體）買齊收合的買菜頁掃了 ${foldPages.length} 組`);
  everyOf(foldPages, (p) => p.foldedSections >= 1, '買齊的那一區收起來了（上面的溢出、重疊、橫向捲動斷言也涵蓋收合後的標題）');
  everyOf(all.filter((p) => p.route === '買菜'), (p) => p.foldedSections === 0 && p.customRows === 0, '（對照）什麼都沒勾、沒加的買菜頁：沒有收合的區塊、沒有自己加的');

  section('買菜頁控制項：沒有超連結樣式、摺疊箭頭明顯、底下三顆按鈕對齊（三種字級 × 三種寬度）');
  // 使用者回報第五輪。為什麼這裡也要量：shoppingviewtest 只量 390／標準與 320／特大兩組，
  // 而三顆按鈕的排列、箭頭圖示的大小都跟字級與寬度一起變 —— 特大字級下「＋ 自己加一項」最寬，
  // 對齊一旦只靠 flex 換行就會在某些寬度散掉。溢出／重疊／橫向捲動抓不到「排得不整齊」（慣例 20），
  // 所以直接量：兩顆同列等寬、第一顆佔滿一列、左右緣對齊。四種買菜狀態都掃（自己加的那組才有「刪除」）。
  const shopPages = all.filter((p) => p.route.startsWith('買菜'));
  ok(shopPages.length === 4 * SCALES.length * WIDTHS.length, `（母體）買菜頁四種狀態掃了 ${shopPages.length} 組`);
  everyOf(shopPages, (p) => p.linkish.length === 0, '沒有任何控制項長得像超連結（刪除、摺疊標題都是按鈕）',
    shopPages.filter((p) => p.linkish.length).slice(0, 3).map((p) => `${where(p)}：${p.linkish.slice(0, 3).join('、')}`).join(' ／ '));
  const acts = shopPages.flatMap((p) => p.actions.map((a) => ({ ...a, where: where(p) })));
  ok(acts.length >= shopPages.length * 2, `（前提）每一組的每張採買卡都量到底下三顆按鈕（共 ${acts.length} 張卡）`);
  everyOf(acts, (a) => !a.missing && a.minH >= 44, `三顆都按得到（最小 ${Math.min(...acts.map((a) => a.minH ?? 0))}px）`);
  everyOf(acts, (a) => a.copyPrintRow && a.copyPrintEqual, '「複製清單」「印出」同一列、一樣寬',
    acts.filter((a) => !(a.copyPrintRow && a.copyPrintEqual)).slice(0, 3).map((a) => a.where).join(' ／ '));
  everyOf(acts, (a) => a.addAbove && a.edges <= 1, `「自己加一項」自成一列、左右緣跟下面兩顆對齊（最大差 ${Math.max(...acts.map((a) => a.edges ?? 99))}px）`,
    acts.filter((a) => !(a.addAbove && a.edges <= 1)).slice(0, 3).map((a) => `${a.where} 差 ${a.edges}px`).join(' ／ '));
  everyOf(acts, (a) => a.inside, '三顆都在卡片裡，特大字級也不撐破');
  // 對齊了但字被拆開一樣難看：320px 特大下半格只剩約 130px，「複製清單」曾經被拆成「複製清／單」（截圖走查抓到）
  everyOf(acts, (a) => a.maxLines === 1, '按鈕上的字都在一行，不會被拆成「複製清／單」',
    acts.filter((a) => a.maxLines !== 1).slice(0, 3).map((a) => `${a.where}：${a.maxLines} 行`).join(' ／ '));
  const carets = shopPages.flatMap((p) => p.carets.map((c) => ({ ...c, where: where(p) })));
  ok(carets.some((c) => c.open) && carets.some((c) => !c.open), `（前提）量到 ${carets.filter((c) => c.open).length} 個展開、${carets.filter((c) => !c.open).length} 個收合的摺疊標題`);
  everyOf(carets, (c) => c.glyph === (c.open ? '▾' : '▸'), '每個摺疊標題都有箭頭，展開 ▾、收合 ▸');
  everyOf(carets, (c) => c.ratio >= 1.4, `箭頭圖示夠大（最小是字寬的 ${Math.min(...carets.map((c) => c.ratio)).toFixed(2)} 倍）`);

  section('設定列的標籤不會被擠成一欄一個字');
  // 走查抓到（2026-09-14）：家人頁「一週豐盛程度」的三顆 chip 字很長，塞在 pref-row 右邊時，
  // 左邊的「豐盛的主菜」被擠成一欄一個字 —— 390px 標準字級就這樣。為什麼上面那些斷言沒抓到：
  // 字沒有超出畫面、沒有互相重疊、頁面也不會橫向捲動，只是**很難讀**（慣例 20：要守的是什麼就量什麼）。
  const labelRows = all.filter((p) => p.route === '家人').flatMap((p) => p.prefLabels.map((l) => ({ ...l, where: where(p) })));
  ok(labelRows.length >= SCALES.length * WIDTHS.length * 3, `（母體）家人頁 ${labelRows.length} 個設定列標籤（三種字級 × 三種寬度）`);
  everyOf(labelRows.filter((l) => l.chars >= 3), (l) => l.perLine >= 2, '每個設定列的標籤每一行至少兩個字（不會被擠成直的一欄）',
    labelRows.filter((l) => l.chars >= 3 && l.perLine < 2).slice(0, 3).map((l) => `${l.where}「${l.text}」${l.lines} 行`).join(' ／ '));

  section('買菜清單：數量欄要對齊，不會被擠到下一行');
  const withList = all.filter((p) => p.columns.length > 0);
  ok(withList.length >= SCALES.length * WIDTHS.length, `有 ${withList.length} 個組合的畫面上有多列清單（母體不是空的）`);
  everyOf(withList, (p) => p.columns.every((c) => c.rows >= 2), '每一區都至少兩列可以互相比對');
  const overLineAt = (w, s) => withList.filter((p) => p.width === w && p.scale === s).reduce((n, p) => n + p.columns.reduce((m, c) => m + c.overLine, 0), 0);
  ok(overLineAt(Math.min(...WIDTHS), 'xl') >= 1,
    `（前提）${Math.min(...WIDTHS)}px 特大字級的樣本裡有數量比一整行還寬的列（${overLineAt(Math.min(...WIDTHS), 'xl')} 列）——沒有的話，下面「右緣對齊」看不到 max-width 那條規則`);
  noneOf(withList, (p) => p.columns.some((c) => c.rightSpread > 2), '同一區裡數量欄的右緣對齊（差 ≤ 2px）',
    withList.filter((p) => p.columns.some((c) => c.rightSpread > 2)).slice(0, 3).map((p) => `${where(p)}：${Math.max(...p.columns.map((c) => c.rightSpread))}px`).join(' ／ '));
  // 「一律不准換行」在 320px／特大下做不到：「豬里肌肉片」＋「約 0.5 斤（133 g）」加起來就是比一行寬。
  // 硬寫成那樣只會變成一條永遠紅、或被放寬到沒有意義的斷言。
  // 真正的規則是：**放得下的那些列，一定要在同一行**；放不下的才准換到自己那一行（仍然靠右）。
  const totalFitting = withList.reduce((n, p) => n + p.columns.reduce((m, c) => m + c.fitting, 0), 0);
  const totalWrapped = withList.reduce((n, p) => n + p.columns.reduce((m, c) => m + c.wrapped, 0), 0);
  ok(totalFitting >= 60, `（母體）${totalFitting} 列的名稱＋數量本來就放得下（另有 ${totalWrapped} 列真的放不下）`);
  noneOf(withList, (p) => p.columns.some((c) => c.fittingDropped > 0), '**放得下的列，數量一定跟名稱在同一行**',
    withList.filter((p) => p.columns.some((c) => c.fittingDropped > 0)).slice(0, 3).map((p) => `${where(p)}：${p.columns.reduce((m, c) => m + c.fittingDropped, 0)} 列`).join(' ／ '));
  noneOf(withList, (p) => p.columns.some((c) => c.maxDrop > 60), '放不下的列最多換一行，不會散成兩行以上',
    withList.filter((p) => p.columns.some((c) => c.maxDrop > 60)).slice(0, 3).map((p) => `${where(p)}：掉了 ${Math.max(...p.columns.map((c) => c.maxDrop))}px`).join(' ／ '));
  note(`換行的列：${SCALES.map((s) => `${s} ${WIDTHS.map((w) => `${w}px:${withList.filter((p) => p.scale === s && p.width === w).reduce((n, p) => n + p.columns.reduce((m, c) => m + c.wrapped, 0), 0)}`).join('／')}`).join('、')}`);


  section('桌機七欄：摺疊在 grid 版型下也要合理');
  {
    // 手機那些組合都是 ≤ 430px（一天一卡）。七欄是 **≥ 1100px** 才生效（不是 720px，那一段只加寬內容區），所以要另外量。
    for (const scale of ['md', 'xl']) {
      await page.setViewport({ width: 1280, height: 900 });
      await page.evaluate(async (s2) => {
        const prefs = await import('./js/prefs.js');
        await prefs.set('fontScale', s2); prefs.applyFontScale(s2);
        const { weekKeyOf, mondayOf, isoDate } = await import('./js/planner.js');
        await prefs.set('collapsedDays', { [weekKeyOf(mondayOf(isoDate(new Date())))]: { 0: 'closed', 1: 'open', 2: 'open', 3: 'closed', 4: 'open', 5: 'open', 6: 'closed' } });
      }, scale);
      await page.evaluate(() => { location.hash = '#/family/new'; });
      await new Promise((r) => setTimeout(r, 200));
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForFunction(() => document.querySelectorAll('[data-card="day"]').length === 7, { timeout: 60000 });
      await new Promise((r) => setTimeout(r, 350));
      const g = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-card="day"]')];
        const rects = cards.map((c) => c.getBoundingClientRect());
        const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
        const collapsed = cards.filter((c) => c.dataset.open === 'false');
        const openCards = cards.filter((c) => c.dataset.open !== 'false');
        return {
          cards: cards.length,
          rows: tops.length,
          collapsedMeals: collapsed.reduce((n, c) => n + [...c.querySelectorAll('.meal-block')].filter((e) => e.getBoundingClientRect().height > 0).length, 0),
          openMeals: openCards.reduce((n, c) => n + [...c.querySelectorAll('.meal-block')].filter((e) => e.getBoundingClientRect().height > 0).length, 0),
          collapsedTitlesVisible: collapsed.filter((c) => c.querySelector('.card-title')?.getBoundingClientRect().height > 0).length,
          summariesVisible: collapsed.filter((c) => c.querySelector('[data-field="daySummary"]')?.getBoundingClientRect().height > 0).length,
          docScrollW: document.documentElement.scrollWidth,
          docW: document.documentElement.clientWidth,
        };
      });
      eq(g.cards, 7, `桌機 1280px／${scale}：七天都在`);
      eq(g.rows, 1, '七欄排成一列（grid 生效，收起來的欄不會被擠到第二行）');
      eq(g.collapsedMeals, 0, '收起來的三欄，餐格一個都量不到');
      ok(g.openMeals >= 10, `沒收的四欄照常有內容（${g.openMeals} 個餐格）`);
      eq(g.collapsedTitlesVisible, 3, '收起來的欄仍然看得到日期（不然點不回去）');
      eq(g.summariesVisible, 3, '而且每一欄都有那一行摘要');
      ok(g.docScrollW <= g.docW + 1, `桌機也沒有橫向捲動（scrollW ${g.docScrollW} ≤ ${g.docW}）`);
    }
    await page.evaluate(async () => {
      const prefs = await import('./js/prefs.js');
      await prefs.set('collapsedDays', {});
      await prefs.set('fontScale', 'md'); prefs.applyFontScale('md');
    });
  }


  eq(pageErrors, [], '整段沒有未攔截的例外');
} finally {
  await browser.close();
  srv.close();
}

done('layouttest');
