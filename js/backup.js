// 匯出／匯入（PLAN §3.1；做法沿用 StockDiary 的 backup.js）。
//
// 兩條不可退讓的規則：
//   1. 匯入是「取代」：先 clear 再 put。所以**驗證必須整段跑在 clear 之前**——
//      任何一列會失敗就一列都不要動，錯誤訊息要先回答「你現在的資料沒有被動到」。
//   2. 只匯出 EXPORTABLE_STORES（這個 App 就是全部 store；沒有金鑰）。

import * as db from './db.js';
import { APP_VERSION } from './version.js';

export const BUNDLE_APP = 'mealmate';
export const BUNDLE_FORMAT = 1;

export async function exportBundle() {
  const stores = {};
  for (const s of db.EXPORTABLE_STORES) stores[s] = await db.getAll(s);
  return { app: BUNDLE_APP, format: BUNDLE_FORMAT, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), stores };
}

export function bundleFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `mealmate-備份-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

function hasKey(row, keyPath) {
  if (Array.isArray(keyPath)) return keyPath.every((k) => row?.[k] != null && row[k] !== '');
  return row?.[keyPath] != null && row[keyPath] !== '';
}

/**
 * 整份先驗完再說。回錯誤陣列；空陣列才可以匯入。
 * 認得的 store 逐列檢查主鍵；不認得的 store 直接拒收（不是略過 —— 略過會讓人以為匯進去了）。
 */
export function validateImport(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return ['這不是備份檔（不是 JSON 物件）'];
  if (bundle.app !== BUNDLE_APP) errors.push(`不是 MealMate 的備份檔（app 是「${bundle.app ?? '空'}」）`);
  if (bundle.format !== BUNDLE_FORMAT) errors.push(`備份格式版本不對（${bundle.format ?? '空'}，需要 ${BUNDLE_FORMAT}）`);
  if (!bundle.stores || typeof bundle.stores !== 'object' || Array.isArray(bundle.stores)) { errors.push('缺 stores'); return errors; }
  for (const name of Object.keys(bundle.stores)) {
    if (!db.EXPORTABLE_STORES.includes(name)) errors.push(`不認得的資料表「${name}」`);
  }
  for (const name of db.EXPORTABLE_STORES) {
    const rows = bundle.stores[name];
    if (rows === undefined) { errors.push(`缺資料表「${name}」`); continue; }
    if (!Array.isArray(rows)) { errors.push(`資料表「${name}」不是陣列`); continue; }
    const kp = db.keyPathOf(name);
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) errors.push(`「${name}」第 ${i + 1} 列不是物件`);
      else if (!hasKey(row, kp)) errors.push(`「${name}」第 ${i + 1} 列缺主鍵 ${Array.isArray(kp) ? kp.join('+') : kp}`);
    });
  }
  return errors;
}

/** 每個 store 幾列（給確認對話框用）。 */
export function bundleCounts(bundle) {
  const out = {};
  for (const name of db.EXPORTABLE_STORES) out[name] = Array.isArray(bundle?.stores?.[name]) ? bundle.stores[name].length : 0;
  return out;
}

/**
 * 套用匯入（取代）。**呼叫前一定要先 validateImport 為空**；這裡再驗一次，不通就丟錯、不動資料。
 */
export async function applyImport(bundle) {
  const errors = validateImport(bundle);
  if (errors.length) throw new Error(`備份檔有問題，資料沒有被動到：${errors[0]}`);
  for (const name of db.EXPORTABLE_STORES) {
    await db.clear(name);
    if (bundle.stores[name].length) await db.putAll(name, bundle.stores[name]);
  }
}
