// 共用元件與觸控區（npm run uikittest）。沿用 StockDiary 的作法。
//
// 守的是「收斂之後不要再散開」：
//   1. 全 App 只有一套切換開關（ui.switchRow），而且它看起來像開關（軌道＋滑塊會動）
//   2. 畫面字串裡不可以出現 markdown 記號（h() 全是 textNode，寫 ** 只會看到兩個星號）
//   3. 營養數字一律走 fmtNutrient／fmtEst，沒有人自己 toFixed（那會少掉「估」字）
//   4. **所有可點的東西都 ≥ 44px** —— 標準與特大字級各掃一次，掃全部頁面
//
// 第 4 條在 StockDiary 只寫在註解裡、實際只驗了一顆，於是 .btn-sm 長期是 36px，
// 而它正好用在最常按的那幾顆。這裡從一開始就用掃的。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { ok, eq, section, done, noneOf, everyOf } from './tap.mjs';
import { listen } from './serve.mjs';
import { stripComments } from './srcscan.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const viewFiles = fs.readdirSync(path.join(ROOT, 'js/views')).filter((f) => f.endsWith('.js')).map((f) => `js/views/${f}`);
const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const uiStrings = (rel) => {
  const src = read(rel);
  return [...[...src.matchAll(/'([^'\n]{4,})'/g)].map((m) => m[1]), ...[...src.matchAll(/`([^`]{4,}?)`/g)].map((m) => m[1])];
};

section('靜態：只有一套開關、沒有 markdown、營養數字走同一支格式器');
ok(viewFiles.length >= 8, `（母體）檢查了 ${viewFiles.length} 個畫面檔`);
const allStrings = viewFiles.flatMap(uiStrings);
ok(allStrings.length > 150, `（母體）掃了 ${allStrings.length} 條畫面字串`);
const markdownish = viewFiles.flatMap((f) => uiStrings(f).filter((t) => /\*\*|^#{1,3} |\[.+\]\(.+\)/.test(t)).map((t) => `${f}: ${t.slice(0, 50)}`));
eq(markdownish, [], '畫面字串裡沒有 **粗體**、# 標題或 [連結](網址) 這類記號');
noneOf(viewFiles, (f) => /role:\s*['"]switch['"]/.test(read(f)), '沒有任何畫面自己手刻切換開關 —— 一律用 ui.switchRow()');
ok(/role:\s*['"]switch['"]/.test(read('js/ui.js')), '（對照）ui.js 裡確實有那個共用元件 —— 上面那條不是因為整個 App 都沒有開關');
const usesSwitch = viewFiles.filter((f) => /switchRow\(/.test(read(f)));
ok(usesSwitch.length >= 1, `而且有 ${usesSwitch.length} 個畫面在用它：${usesSwitch.map((f) => f.split('/').pop()).join('、')}`);
// 2026-09-16：家人表單的慢性病從一排開關改成搜尋式挑選，所以用開關的畫面剩家人頁（排菜規則的三個避開開關）。
noneOf(viewFiles, (f) => /\.toFixed\(/.test(read(f)), '沒有任何畫面自己 toFixed 一個營養值（要走 fmtNutrient／fmtEst，才會有「估」字）');
const usesFmt = viewFiles.filter((f) => /fmtNutrient\(|fmtEst\(/.test(read(f)));
ok(usesFmt.length >= 3, `（對照）有 ${usesFmt.length} 個畫面在顯示營養值、走的是共用格式器：${usesFmt.map((f) => f.split('/').pop()).join('、')}`);
ok(/minimumFractionDigits/.test(read('js/ui.js')), '（對照）小數位數的規則集中在 ui.js —— 上面那條不是因為整個 App 都沒有小數');
noneOf(viewFiles, (f) => /innerHTML/.test(read(f)), '沒有任何畫面用 innerHTML');

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

  section('先種資料 —— 沒有資料的話很多按鈕根本不會出現，掃了等於沒掃');
  const seeded = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const prefs = await import('./js/prefs.js');
    const { newMember } = await import('./js/members.js');
    const { generateWeek, mondayOf, isoDate } = await import('./js/planner.js');
    await store.saveMember({ ...newMember(), name: '外婆（住在三重那位）', ageGroup: 'senior', diet: 'veganNoAllium', conditions: ['diabetes', 'kidney'], kidneyWatch: ['sodium'], texture: 'minced', allergens: ['peanut'] });
    await store.saveMember({ ...newMember(), name: '爸', diet: 'omni', conditions: ['hypertension'] });
    await prefs.set('shoppingDays', [1, 4]);
    await store.toggleFavorite('r-mapo-tofu-split');
    const mondayIso = mondayOf(isoDate(new Date()));
    const { plan, diagnostics } = generateWeek({
      recipes: store.allRecipes(), members: store.members(), idx: store.foodsIndex(), units: store.units(),
      rules: { noRepeatDays: prefs.get('noRepeatDays'), avoid: prefs.get('avoid') },
      favorites: store.favoritesList(), history: [], mondayIso, seed: 'uikit', shoppingDays: [1, 4], haveFoods: new Set(),
    });
    await store.savePlan({ ...plan, diagnostics });
    const slot = plan.slots.find((s) => s.kind === 'cook' && s.items.length > 1);
    return { memberId: store.members()[0].id, today: { d: slot.date, meal: slot.meal }, dishes: plan.slots.reduce((n, s) => n + s.items.length, 0) };
  });
  ok(seeded.dishes >= 40, `種了一週 ${seeded.dishes} 道菜、兩位家人`);

  section('切換開關看起來像開關，而且真的會動');
  await page.evaluate(() => { location.hash = '#/family'; });
  await page.waitForSelector('#view .switch[data-pref="avoid-sweet"]');
  const sw = await page.evaluate(async () => {
    const el = document.querySelector('#view .switch[data-pref="avoid-sweet"]');
    const knob = el.querySelector('.switch-knob');
    const before = {
      checked: el.getAttribute('aria-checked'), on: el.classList.contains('on'),
      knobX: knob.getBoundingClientRect().left,
      trackW: el.querySelector('.switch-track').getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      role: el.getAttribute('role'), label: el.getAttribute('aria-label'),
    };
    el.click();
    await new Promise((r) => setTimeout(r, 700));
    const el2 = document.querySelector('#view .switch[data-pref="avoid-sweet"]');
    const after = { checked: el2.getAttribute('aria-checked'), on: el2.classList.contains('on'), knobX: el2.querySelector('.switch-knob').getBoundingClientRect().left };
    const prefs = await import('./js/prefs.js');
    return { before, after, stored: prefs.get('avoid').sweet };
  });
  eq(sw.before.role, 'switch', '用的是 role="switch"，不是普通按鈕');
  ok(sw.before.label && sw.before.label.length > 1, `有 aria-label：「${sw.before.label}」`);
  ok(sw.before.height >= 44, `觸控區夠大（${Math.round(sw.before.height)}px ≥ 44px）`);
  ok(sw.before.trackW >= 40, `軌道看得見（寬 ${Math.round(sw.before.trackW)}px）`);
  ok(sw.before.checked !== sw.after.checked, 'aria-checked 有跟著切換');
  ok(Math.abs(sw.after.knobX - sw.before.knobX) >= 10, `**滑塊真的移動了**（${Math.round(Math.abs(sw.after.knobX - sw.before.knobX))}px）—— 不是只換了字`);
  eq(sw.stored, sw.after.checked === 'true', '而且存進設定了');
  await page.evaluate(async () => {
    const prefs = await import('./js/prefs.js');
    await prefs.set('avoid', { sweet: false, processed: false, fried: false });
  });

  section('每一頁的每一個可點元素都 ≥ 44px（標準與特大字級各掃一次）');
  const ROUTES = ['/', `/today?d=${seeded.today.d}&meal=${seeded.today.meal}`, '/shopping', '/recipes', '/recipes/r-mapo-tofu-split', '/recipes/new', '/family', '/family/new', `/family/${seeded.memberId}`];
  const tooSmall = [];
  const counted = [];
  const chipInfo = [];
  for (const scale of ['md', 'xl']) {
    await page.evaluate(async (sc) => {
      const prefs = await import('./js/prefs.js');
      await prefs.set('fontScale', sc);
      prefs.applyFontScale(sc);
    }, scale);
    for (const route of ROUTES) {
      await page.evaluate(() => { location.hash = '#/family/new'; });
      await new Promise((r) => setTimeout(r, 200));
      await page.evaluate((r) => { location.hash = `#${r}`; }, route);
      await page.waitForFunction(() => document.querySelector('#view')?.textContent?.trim().length > 20, { timeout: 60000 });
      await new Promise((r) => setTimeout(r, 500));
      const found = await page.evaluate((info) => {
        const out = [];
        let n = 0;
        for (const el of document.querySelectorAll('#view a, #view button, #view select, #view input, #view summary, #tabbar .tab')) {
          const r = el.getBoundingClientRect();
          if (r.height === 0) continue;          // 藏起來的（檔案選擇欄）不算
          n += 1;
          // 勾選框本身是 24px，但**整個 label 才是觸控區**（點文字也會勾）
          const target = el.type === 'checkbox' ? (el.closest('label') ?? el) : el;
          const h = target.getBoundingClientRect().height;
          if (h < 44) out.push({ ...info, label: (el.textContent.trim() || el.type || el.tagName).slice(0, 14), cls: String(el.className).slice(0, 20), h: Math.round(h) });
        }
        // 只看「群組裡的」chip —— .chip 也被拿來當單純的按鈕樣式用（例如本週頁的「自己煮／外食」
        // 那顆是開選單的，不是切換），把它們算進來會逼出一條沒有意義的斷言。
        // 高度 0 的是收在 hidden 區塊裡的（腎臟病子項還沒打開），量不到也不該算。
        const chips = [...document.querySelectorAll('#view [data-chips] .chip, #view [role="group"] .chip')]
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => ({
          ...info,
          group: e.closest('[data-chips]')?.dataset.chips ?? e.closest('[role="group"]')?.getAttribute('aria-label') ?? '',
          id: e.dataset.value ?? e.dataset.filter ?? '',
          pressed: e.getAttribute('aria-pressed'),
          h: Math.round(e.getBoundingClientRect().height),
        }));
        return { out, n, chips };
      }, { scale, route });
      tooSmall.push(...found.out);
      counted.push({ scale, route, n: found.n });
      chipInfo.push(...found.chips);
    }
  }
  await page.evaluate(async () => {
    const prefs = await import('./js/prefs.js');
    await prefs.set('fontScale', 'md');
    prefs.applyFontScale('md');
  });
  const total = counted.reduce((a, b) => a + b.n, 0);
  ok(total >= 150, `（對照）真的掃到東西了：${ROUTES.length} 頁 × 2 種字級，共 ${total} 個可點元素`);
  everyOf(counted, (c) => c.n >= 5, `每一頁每一種字級都至少掃到 5 個可點元素（最少的一組 ${Math.min(...counted.map((c) => c.n))} 個）`);
  eq(tooSmall, [], '沒有任何可點元素低於 44px');

  section('chip：每一顆都講得出自己被選中、都按得到');
  ok(chipInfo.length >= 40, `（母體）九頁 × 兩種字級一共 ${chipInfo.length} 顆 chip`);
  ok(new Set(chipInfo.map((c) => c.route)).size >= 5, `分布在 ${new Set(chipInfo.map((c) => c.route)).size} 個頁面`);
  everyOf(chipInfo, (c) => c.pressed === 'true' || c.pressed === 'false', '每顆 chip 都有 aria-pressed');
  everyOf(chipInfo, (c) => c.h >= 44, `每顆 chip 都 ≥ 44px（最小 ${Math.min(...chipInfo.map((c) => c.h))}px）`);
  everyOf(chipInfo, (c) => c.id.length > 0, '每顆 chip 都帶 data-value 或 data-filter（測試才點得到）');
  everyOf(chipInfo, (c) => c.group.length > 0, '每顆 chip 都屬於一個有名字的群組（data-chips 或 aria-label）');

  eq(pageErrors, [], '整段沒有未攔截的例外');
} finally {
  await browser.close();
  srv.close();
}

done('uikittest');
