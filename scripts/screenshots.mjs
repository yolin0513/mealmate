// 功能截圖（npm run screenshots）：用 puppeteer 把主要畫面存到 screenshots/features/。
// 每版上線流程的最後一步（STATUS.md 工作慣例 11）。手機直向 390×844，長輩模式另存一份首頁。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { listen } from './serve.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'screenshots/features');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: 'week', hash: '#/', wait: '#view [data-card="weekEmpty"]' },
  { name: 'recipes', hash: '#/recipes', wait: '#view [data-list="recipes"] a.row' },
  { name: 'recipe-split', hash: '#/recipes/r-cabbage-pork-stirfry', wait: '#view [data-card="recipeSteps"]' },
  { name: 'recipe-veg', hash: '#/recipes/r-tomato-egg', wait: '#view [data-card="recipeSteps"]' },
  { name: 'shopping', hash: '#/shopping', wait: '#view [data-card="shoppingEmpty"]' },
  { name: 'family', hash: '#/family', wait: '#view [data-card="about"]' },
];

const { srv, port } = await listen(0);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  for (const s of SHOTS) {
    await page.evaluate((h) => { location.hash = h; }, s.hash);
    await page.waitForSelector(s.wait);
    await new Promise((r) => setTimeout(r, 250));
    const file = path.join(OUT, `${s.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${s.name}.png  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  srv.close();
}
