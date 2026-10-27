// 測試用的小工具（沿用 StockDiary 的 tap.mjs）。
//
// 設計上要擋掉三種「假斷言」：
//
//   1. 「應該一筆都沒有」的斷言，如果母體本來就是空的，它永遠會過。
//      → noneOf() 強制同時斷言母體非空，忘不掉。
//
//   2. 「檢查器有抓到壞東西」的斷言，如果檢查器壞掉變成「什麼都抓」，它也會過。
//      → detects() 強制同時給正例與反例（該抓的抓到、不該抓的沒抓）。
//
//   3. **說明行混進斷言數裡。** `ok(true, …)` 永遠會過，但它根本不是在檢查東西；
//      混進「N 項通過」之後，讀的人會以為驗了 N 件事。
//      → note() 專門放這種說明行，不計入通過數。
//
// 另外：註解不是斷言，訊息裡要寫出實際看到的值，失敗時才知道發生什麼事。
//
// `MM_AUDIT=1` 時會把每條斷言（含母體大小）寫進 JSONL，給假斷言健檢用。

import fs from 'node:fs';
import { CRASH_MARK } from './crashmark.mjs';

// 中途丟例外（2026-10-27，(i)）：測試主體是頂層 await、只有最後一行的 done()，任何一行丟例外都會跳過 done()，
// 印不出結算行，執行器只能判「沒跑完、不算數」——就算崩潰之前，預期的那條斷言已經紅了（10-24 整套 43 條）。
// 這裡接住沒接住的例外，印一行固定開頭的崩潰行（scripts/crashmark.mjs），**不印結算行**，以 1 結束（跟 Node 預設的崩潰碼一樣，
// 既有拿回傳值判斷崩潰的檢查不必跟著改）。算不算數由執行器決定（runkind 的 crashmid；判準見 mutationtest 的判定那一段）。
// 別的程式自己也掛了處理器（例：mutationtest 的 CRASH——要先還原被改壞的檔、以 70 結束）：這裡讓開，交給它收尾。
// 崩潰行用 stdout 的 write callback 再結束：之前 console.log 排隊中的輸出先送完，崩潰行才會是最後一行（crashShape 靠這一點）。
function onUncaught(type) {
  return (e) => {
    if (process.listenerCount(type) > 1) return;
    const first = String(e?.message ?? e).split('\n')[0].slice(0, 300);
    console.error(String(e?.stack ?? e));
    process.stdout.write(`  ${CRASH_MARK}${first}\n`, () => process.exit(1));
    setTimeout(() => process.exit(1), 5000);
  };
}
process.on('uncaughtException', onUncaught('uncaughtException'));
process.on('unhandledRejection', onUncaught('unhandledRejection'));

let pass = 0;
let fail = 0;
let notes = 0;

const AUDIT = process.env.MM_AUDIT === '1';
const audit = [];
let currentSection = '';

function record(kind, msg, n = null) {
  if (AUDIT) audit.push({ kind, section: currentSection, msg: String(msg).slice(0, 140), n });
}

export function ok(cond, msg, extra = '') {
  record('ok', msg);
  if (cond) { pass += 1; console.log('  ✓ ' + msg); }
  else { fail += 1; console.log('  ✗ ' + msg + (extra ? '\n      ' + extra : '')); }
  return !!cond;
}

/** 說明行，**不是斷言**，不計入通過數。 */
export function note(msg) {
  notes += 1;
  record('note', msg);
  console.log('  · ' + msg);
}

const show = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));

export function eq(actual, expected, msg) {
  const a = show(actual);
  const e = show(expected);
  record('eq', msg);
  if (a === e) { pass += 1; console.log('  ✓ ' + msg); return true; }
  fail += 1;
  console.log(`  ✗ ${msg}\n      實際 ${a}，預期 ${e}`);
  return false;
}

export function near(actual, expected, tol, msg) {
  const good = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  return ok(good, msg, `實際 ${actual}，預期 ${expected} ±${tol}`);
}

export function throws(fn, rx, msg) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) return ok(false, msg, '沒有丟出例外');
  return ok(rx.test(String(err.message || err)), msg, `例外訊息是「${String(err.message || err)}」，預期符合 ${rx}`);
}

/** 母體非空，而且裡面沒有任何一個符合 pred。兩件事一起斷言。 */
export function noneOf(list, pred, msg) {
  const arr = [...list];
  record('noneOf', msg, arr.length);
  if (arr.length === 0) {
    fail += 1;
    console.log(`  ✗ ${msg}\n      母體是空的 —— 這條斷言沒有檢查到任何東西`);
    return false;
  }
  const hits = arr.filter((x, i) => pred(x, i, arr));
  const good = hits.length === 0;
  if (good) { pass += 1; console.log(`  ✓ ${msg}（檢查了 ${arr.length} 項）`); return true; }
  fail += 1;
  console.log(`  ✗ ${msg}（檢查了 ${arr.length} 項）\n      命中 ${hits.length} 項，例如 ${show(hits[0]).slice(0, 200)}`);
  return false;
}

/** 母體非空，而且每一個都符合 pred。 */
export function everyOf(list, pred, msg) {
  const arr = [...list];
  record('everyOf', msg, arr.length);
  if (arr.length === 0) {
    fail += 1;
    console.log(`  ✗ ${msg}\n      母體是空的 —— 這條斷言沒有檢查到任何東西`);
    return false;
  }
  const bad = arr.filter((x, i) => !pred(x, i, arr));
  const good = bad.length === 0;
  if (good) { pass += 1; console.log(`  ✓ ${msg}（檢查了 ${arr.length} 項）`); return true; }
  fail += 1;
  console.log(`  ✗ ${msg}（檢查了 ${arr.length} 項）\n      不符合 ${bad.length} 項，例如 ${show(bad[0]).slice(0, 200)}`);
  return false;
}

/**
 * 檢查器對照組：正例（shouldHit）每個都要被抓到，反例（shouldMiss）每個都不能被抓到。
 * 只測正例的話，一個「永遠回 true」的壞檢查器也會全過。
 */
export function detects(fn, { shouldHit, shouldMiss }, msg) {
  record('detects', msg, Math.min(shouldHit.length, shouldMiss.length));
  const missed = shouldHit.filter((x) => !fn(x));
  const falsePos = shouldMiss.filter((x) => fn(x));
  const good = shouldHit.length > 0 && shouldMiss.length > 0 && missed.length === 0 && falsePos.length === 0;
  const label = `${msg}（正例 ${shouldHit.length}、反例 ${shouldMiss.length}）`;
  if (good) { pass += 1; console.log('  ✓ ' + label); return true; }
  fail += 1;
  console.log(`  ✗ ${label}\n      ` + [
    shouldHit.length === 0 ? '沒有給正例' : '',
    shouldMiss.length === 0 ? '沒有給反例' : '',
    missed.length ? `該抓沒抓到：${show(missed).slice(0, 200)}` : '',
    falsePos.length ? `不該抓卻抓了：${show(falsePos).slice(0, 200)}` : '',
  ].filter(Boolean).join('；'));
  return false;
}

export function section(title) {
  currentSection = String(title);
  record('section', title);
  console.log(`\n— ${title} —`);
}

// failCode（2026-10-23）：有失敗時用哪個回傳值結束，預設 1。mutationtest 用它把「沒測到（不算數）」跟「不如預期」分開（3 對 1）
export function done(name, failCode = 1) {
  if (AUDIT) {
    const out = process.env.MM_AUDIT_OUT || 'assert-audit.jsonl';
    fs.appendFileSync(out, `${audit.map((a) => JSON.stringify({ test: name, ...a })).join('\n')}\n`, 'utf8');
  }
  // 一條斷言都沒跑就結束＝這一支什麼都沒檢查（v9 F1，2026-09-24：以前印「0 項通過」、回 0，看起來像全綠）
  if (pass + fail === 0) {
    console.log(`\n${name}：一條斷言都沒有跑到——這一支什麼都沒檢查，判失敗`);
    process.exit(1);
  }
  console.log(`\n${name}：${pass} 項通過`
    + (notes ? `（另有 ${notes} 行說明，不算斷言）` : '')
    + (fail ? `，${fail} 項失敗` : ''));
  if (fail) process.exit(failCode);
}
