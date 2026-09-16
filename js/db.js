// IndexedDB 底層封裝（沿用 StockDiary）。store 的切分照 PLAN §3.1。
//
// 這個 App 沒有金鑰、沒有任何不該匯出的東西，所以 EXPORTABLE_STORES 就是全部 store。
// 匯出／匯入（M1）一律只走 EXPORTABLE_STORES；新增 store 時要同時決定它要不要進備份。

const DB_NAME = 'mealmate';
const DB_VERSION = 1;

const STORES = {
  members: { keyPath: 'id', indexes: [] },
  settings: { keyPath: 'key', indexes: [] },
  userRecipes: { keyPath: 'id', indexes: [] },
  favorites: { keyPath: 'recipeId', indexes: [] },
  plans: { keyPath: 'weekKey', indexes: [] },
  history: { keyPath: ['date', 'recipeId'], indexes: [['byRecipe', 'recipeId'], ['byDate', 'date']] },
  shopping: { keyPath: 'rangeKey', indexes: [] },
  recipeNotes: { keyPath: 'recipeId', indexes: [] },
};

export const STORE_NAMES = Object.keys(STORES);
export const EXPORTABLE_STORES = [...STORE_NAMES];

/** 某個 store 的主鍵欄位名（複合鍵回陣列）。匯入前逐列檢查主鍵用。 */
export function keyPathOf(store) {
  return STORES[store]?.keyPath ?? null;
}

let _db = null;
let _opening = null;

function openOnce() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const s = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [idx, path] of def.indexes) s.createIndex(idx, path, { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 手機把 App 切到背景、分頁凍結時，瀏覽器會主動關掉閒置連線；下一次 tx() 要知道要重開。
      const invalidate = () => { if (_db === db) _db = null; };
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } invalidate(); };
      db.onclose = invalidate;
      _db = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { /* 交給呼叫端重試 */ };
  });
}

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (!_opening) _opening = openOnce().finally(() => { _opening = null; });
  return _opening;
}

async function tx(store, mode = 'readonly') {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const db = await openDB();
    try {
      return db.transaction(store, mode).objectStore(store);
    } catch (e) {
      _db = null;
      if (attempt === 1) throw e;
    }
  }
  throw new Error('開不了交易');
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 寫入失敗一定要有人講 ----------
//
// 每一次寫入都會經過 writing()。**不在這裡通報，就只能靠十幾個呼叫點各自記得 catch** ——
// 漏掉一個，使用者按了「儲存」就只會看到什麼都沒發生：按鈕彈回去、沒有訊息、資料無聲無息地掉了。
// 這個 App 沒有伺服器，寫不進去就是真的沒有了，不能假裝成功。
//
// 這裡只負責「通知」，不負責畫面（db.js 不認識 UI，也不該認識）。錯誤照樣往上丟，
// 所以呼叫端原本的行為一點都沒變 —— 這是加一條安全網，不是改流程。app.js 負責把它畫出來。
const writeErrorListeners = new Set();

/** 註冊「寫入失敗了」的聽眾。回傳取消註冊的函式。 */
export function onWriteError(fn) { writeErrorListeners.add(fn); return () => writeErrorListeners.delete(fn); }

async function writing(store, run) {
  try {
    return await run();
  } catch (e) {
    for (const fn of [...writeErrorListeners]) { try { fn({ store, error: e }); } catch { /* 聽眾自己壞掉不能蓋掉原始錯誤 */ } }
    throw e;
  }
}

export async function get(store, key) { return wrap((await tx(store)).get(key)); }
export async function getAll(store) { return wrap((await tx(store)).getAll()); }
export async function count(store) { return wrap((await tx(store)).count()); }

export async function put(store, value) { return writing(store, async () => wrap((await tx(store, 'readwrite')).put(value))); }
export async function del(store, key) { return writing(store, async () => wrap((await tx(store, 'readwrite')).delete(key))); }
export async function clear(store) { return writing(store, async () => wrap((await tx(store, 'readwrite')).clear())); }

export async function putAll(store, values) {
  return writing(store, async () => {
    const s = await tx(store, 'readwrite');
    await Promise.all(values.map((v) => wrap(s.put(v))));
  });
}

export async function getByIndex(store, index, key) {
  const s = await tx(store);
  return wrap(s.index(index).getAll(key));
}
