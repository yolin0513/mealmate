// 功能截圖（npm run screenshots）：用 puppeteer 把主要畫面存到 screenshots/features/。
// 每版上線流程的最後一步（STATUS.md 工作慣例 11）。手機直向 390×844。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, acceptWelcome, goto, sleep } from './browserlib.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'screenshots/features');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: 'week-empty', hash: '#/', wait: '#view [data-card="weekEmpty"]' },
  { name: 'recipes', hash: '#/recipes', wait: '#view [data-list="recipes"] a.row' },
  { name: 'recipe-split', hash: '#/recipes/r-cabbage-pork-stirfry', wait: '#view [data-card="recipeNutrition"] .nutri-value' },
  { name: 'recipe-veg', hash: '#/recipes/r-tomato-egg', wait: '#view [data-card="recipeNutrition"] .nutri-value' },
  { name: 'member-new', hash: '#/family/new', wait: '#view [data-card="memberTargets"]' },
  { name: 'recipe-edit', hash: '#/recipes/new', wait: '#view [data-card="editIngredients"]' },
  { name: 'shopping-empty', hash: '#/shopping', wait: '#view [data-card="shoppingEmpty"]' },
  { name: 'family', hash: '#/family', wait: '#view [data-card="about"]' },
];

const { page, close } = await openApp();
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.waitForSelector('[data-card="welcome"]');
  await page.screenshot({ path: path.join(OUT, 'welcome.png'), fullPage: true });
  console.log('welcome.png');
  await acceptWelcome(page);
  // 種兩位家人，畫面才看得出「留意欄位」長什麼樣
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { newMember } = await import('./js/members.js');
    await store.saveMember({ ...newMember(), name: '阿嬤', ageGroup: 'senior', diet: 'lactoOvo', conditions: ['diabetes'], texture: 'soft' });
    await store.saveMember({ ...newMember(), name: '爸', conditions: ['hypertension'] });
  });
  for (const s of SHOTS) {
    await goto(page, s.hash);
    await page.waitForSelector(s.wait);
    await sleep(250);
    const file = path.join(OUT, `${s.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${s.name}.png  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
  // 已產生的本週菜單（先設買菜日再產生）
  await page.evaluate(async () => { const prefs = await import('./js/prefs.js'); await prefs.set('shoppingDays', [1, 4]); });
  await goto(page, '#/family');
  await page.waitForSelector('#view [data-card="about"]');
  await goto(page, '#/');
  await page.waitForSelector('[data-action="generate"]');
  await page.$eval('[data-action="generate"]', (el) => el.click());
  await page.waitForSelector('[data-card="weekHead"]');
  await page.$eval('[data-card="day"][data-day="0"] [data-field="dayEstimate"] summary', (el) => el.click());
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'week-plan.png'), fullPage: true });
  console.log('week-plan.png');
  await goto(page, '#/shopping');
  await page.waitForSelector('[data-card="shopRange"]');
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, 'shopping-list.png'), fullPage: true });
  console.log('shopping-list.png');
  // 今日一起煮：挑一格有可分流的菜的餐，素葷兩欄才看得到
  const today = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const { mondayOf, weekKeyOf, isoDate } = await import('./js/planner.js');
    const plan = await store.getPlan(weekKeyOf(mondayOf(isoDate(new Date()))));
    const byId = new Map(store.allRecipes().map((r) => [r.id, r]));
    const slot = plan.slots.find((s) => s.kind === 'cook' && s.items.length > 1 && s.items.some((it) => byId.get(it.recipeId)?.vegMode === 'splittable'));
    return slot ? `#/today?d=${slot.date}&meal=${slot.meal}` : '#/today';
  });
  await goto(page, today);
  await page.waitForSelector('[data-card="timeline"] .tl-step');
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, 'today-cook.png'), fullPage: true });
  console.log('today-cook.png');
} finally {
  await close();
}
