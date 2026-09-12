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
  { name: 'week', hash: '#/', wait: '#view [data-card="weekEmpty"]' },
  { name: 'recipes', hash: '#/recipes', wait: '#view [data-list="recipes"] a.row' },
  { name: 'recipe-split', hash: '#/recipes/r-cabbage-pork-stirfry', wait: '#view [data-card="recipeNutrition"] .nutri-value' },
  { name: 'recipe-veg', hash: '#/recipes/r-tomato-egg', wait: '#view [data-card="recipeNutrition"] .nutri-value' },
  { name: 'member-new', hash: '#/family/new', wait: '#view [data-card="memberTargets"]' },
  { name: 'recipe-edit', hash: '#/recipes/new', wait: '#view [data-card="editIngredients"]' },
  { name: 'shopping', hash: '#/shopping', wait: '#view [data-card="shoppingEmpty"]' },
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
} finally {
  await close();
}
