// 瀏覽器測試共用：開伺服器與 puppeteer、按過首次說明、等標題、等一下。

import puppeteer from 'puppeteer';
import { listen } from './serve.mjs';

export async function openApp({ width = 390, height = 844 } = {}) {
  const { srv, port } = await listen(0);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width, height });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  const close = async () => { await browser.close(); srv.close(); };
  return { browser, page, port, srv, pageErrors, close };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function titleIs(page, want) {
  return page.waitForFunction((t) => document.getElementById('topTitle')?.textContent === t, { timeout: 60000 }, want);
}

export async function goto(page, hash) {
  await page.evaluate((x) => { location.hash = x; }, hash);
}

/** 首次說明頁：按「我知道了」進到本週。 */
export async function acceptWelcome(page) {
  await page.waitForSelector('[data-action="acceptDisclaimer"]');
  await page.click('[data-action="acceptDisclaimer"]');
  await titleIs(page, '本週菜單');
}

/** 一顆 .chip（用 data-chips 群組名 ＋ data-value）。 */
export function chipSel(group, value) {
  return `[data-chips="${group}"] .chip[data-value="${value}"]`;
}

/** 清掉所有 IndexedDB store 並重新載入（測試情境之間要乾淨）。 */
export async function resetDb(page) {
  await page.evaluate(async () => {
    const db = await import('./js/db.js');
    for (const st of db.STORE_NAMES) await db.clear(st);
  });
  await page.reload({ waitUntil: 'networkidle0' });
}

export async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.textContent.replace(/\s+/g, ' ').trim());
}

/**
 * 點一個元素之前先把它捲到畫面正中央。
 * puppeteer 的 click 只檢查元素「在視窗範圍內」就點它的中心 —— 頁面底部的按鈕常常在範圍內、
 * 卻被 fixed 的分頁列蓋住，那一下就點到分頁去了（recipeviewtest 實際踩過：存食譜變成換頁）。
 */
export async function clickEl(page, selector) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(120);
  await page.click(selector);
}

/**
 * 等 toast 完全消失（hidden 屬性設回去，不只是拿掉 .show）。
 * toast 現在 pointer-events:none 不會擋點擊了，但測試要量它的文字時仍需要它在或不在的明確狀態。
 */
export async function waitToastGone(page) {
  await page.waitForFunction(() => { const t = document.getElementById('toast'); return !t || t.hidden; }, { timeout: 10000 });
}
