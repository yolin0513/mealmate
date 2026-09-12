// 把衛福部食藥署「食品營養成分資料庫」的 JSON 匯出檔轉成 data/foods.json（npm run build-foods）。
//
// 這是**開發者本機工具**，不進 npm test、App 執行期也不會打食藥署。
//
// 來源：政府資料開放平臺資料集 8543「食品營養成分資料集」
//   下載端點 https://data.fda.gov.tw/data/opendata/export/20/json（回 zip，內含一個 JSON）
//   授權：政府資料開放授權條款－第1版（與 CC BY 4.0 相容；使用時須標示來源）
//   原始檔一列 ＝ 一個食材 × 一個分析項，2,180 種食材 × 104 項 ≈ 226,720 列、128MB。
//
// 轉出來的每個食材只留 App 會用到的 12 項營養素（每 100 克含量）、每單位重、廢棄率、
// 分類、名稱、俗名（拆成 aliases）。原始值為空 → 輸出 null，**絕不轉成 0**。
//
// 用法：
//   node scripts/build-foods.mjs                  用 data/raw/ 裡最新的 tfnd-*.json
//   node scripts/build-foods.mjs --download       先從食藥署抓 zip 存到 data/raw/tfnd-<今天>.{zip,json}
//
// FEASIBILITY.md §1 記錄了實測：白飯 A0550601 每 100 克 熱量 183、粗蛋白 3.1、總碳水化合物 41、
// 鈉 2、鉀 40、磷 39 —— datatest 拿同一筆的原始列當固定樣本驗這支腳本的轉換。

import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const RAW_DIR = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'data/foods.json');
export const EXPORT_URL = 'https://data.fda.gov.tw/data/opendata/export/20/json';

export const SOURCE = {
  org: '衛生福利部食品藥物管理署',
  title: '食品營養成分資料庫',
  dataset: 'https://data.gov.tw/dataset/8543',
  license: '政府資料開放授權條款－第1版',
  licenseUrl: 'https://data.gov.tw/license',
};

/** 原始檔的「分析項」→ App 用的鍵。順序就是畫面上的顯示順序。 */
export const NUTRIENT_KEYS = {
  '熱量': 'kcal',
  '粗蛋白': 'protein',
  '粗脂肪': 'fat',
  '飽和脂肪': 'satFat',
  '總碳水化合物': 'carb',
  '糖質總量': 'sugar',
  '膳食纖維': 'fiber',
  '鈉': 'sodium',
  '鉀': 'potassium',
  '磷': 'phosphorus',
  '鈣': 'calcium',
  '膽固醇': 'cholesterol',
};

/** 空字串、null、非數字 → null（不是 0）。 */
export function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "121.0克" → 121；"0.0克"、空白、認不得的 → null（不能拿 0 去換算「一顆幾克」）。 */
export function parseUnitWeight(s) {
  const m = /^\s*([\d.]+)\s*克\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 俗名欄是逗號分隔的一串；拆開、去空白、去重、去掉跟正式名稱一樣的。 */
export function splitAliases(s, name) {
  const out = [];
  for (const raw of String(s ?? '').split(/[,，、;；]/)) {
    const a = raw.trim();
    if (!a || a === name || out.includes(a)) continue;
    out.push(a);
  }
  return out;
}

/** 「內容物描述」裡的樣品狀態（生／熟／乾…），沒有就 null。 */
export function sampleState(desc) {
  const m = /樣品狀態\s*[:：]\s*([^;；]+)/.exec(String(desc ?? ''));
  return m ? m[1].trim() : null;
}

const YEAR_VARIANT = /^(.*?)\s*\((\d{4})年取樣\)\s*$/;

/**
 * 原始列 → 食材陣列。純函式，datatest 用固定樣本驗它。
 *
 * 規則：
 *   · 同一個整合編號的所有列合成一個食材；分析項只留 NUTRIENT_KEYS 裡的 12 項
 *   · 值為空 → null（永遠不是 0）
 *   · 「XX(2022年取樣)」這種同名不同年的重複樣品：有不帶年份的同名條目就整筆略過，
 *     沒有的話留最新一年、顯示名去掉年份
 *   · 剩下還同名的（同名但內容物描述不同，例如生／熟），用樣品狀態消歧；還是同名就掛編號
 *   · 每個營養素的單位在整份資料裡必須一致，不一致就丟錯（寧可 build 失敗）
 */
export function transform(rows) {
  const byId = new Map();
  const units = {};
  for (const r of rows) {
    const id = String(r['整合編號'] ?? '').trim();
    if (!id) continue;
    let f = byId.get(id);
    if (!f) {
      const name = String(r['樣品名稱'] ?? '').trim();
      f = {
        id,
        name,
        cat: String(r['食品分類'] ?? '').trim(),
        state: sampleState(r['內容物描述']),
        aliases: splitAliases(r['俗名'], name),
        unitWeight: parseUnitWeight(r['每單位重']),
        wasteRate: num(r['廢棄率']),
        n: Object.fromEntries(Object.values(NUTRIENT_KEYS).map((k) => [k, null])),
      };
      byId.set(id, f);
    }
    const key = NUTRIENT_KEYS[String(r['分析項'] ?? '').trim()];
    if (!key) continue;
    f.n[key] = num(r['每100克含量']);
    const unit = String(r['含量單位'] ?? '').trim();
    if (unit) {
      if (units[key] && units[key] !== unit) {
        throw new Error(`營養素 ${key} 的單位不一致：${units[key]} vs ${unit}（${id} ${f.name}）`);
      }
      units[key] = unit;
    }
  }

  // 同名不同年取樣
  const plainNames = new Set([...byId.values()].filter((f) => !YEAR_VARIANT.test(f.name)).map((f) => f.name));
  const keepLatest = new Map(); // base name → food
  const dropped = [];
  for (const f of byId.values()) {
    const m = YEAR_VARIANT.exec(f.name);
    if (!m) continue;
    const base = m[1].trim();
    const year = Number(m[2]);
    if (plainNames.has(base)) { dropped.push(f.id); byId.delete(f.id); continue; }
    const cur = keepLatest.get(base);
    if (!cur || cur.year < year) {
      if (cur) { dropped.push(cur.food.id); byId.delete(cur.food.id); }
      keepLatest.set(base, { year, food: f });
      f.sampleYear = year;
      f.name = base;
    } else { dropped.push(f.id); byId.delete(f.id); }
  }

  // 剩下的同名：先用樣品狀態消歧，再掛編號
  const byName = new Map();
  for (const f of byId.values()) {
    if (!byName.has(f.name)) byName.set(f.name, []);
    byName.get(f.name).push(f);
  }
  let disambiguated = 0;
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const states = new Set(group.map((f) => f.state ?? ''));
    for (const f of group) {
      const tag = states.size === group.length && f.state ? f.state : f.id;
      f.name = `${f.name}（${tag}）`;
      disambiguated += 1;
    }
  }

  const foods = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { foods, units, report: { rows: rows.length, foods: foods.length, droppedYearVariants: dropped.length, disambiguated } };
}

// ---------- zip（單一檔案）解壓，不裝相依 ----------
export function unzipSingle(buf) {
  // 從尾端找 End of Central Directory（簽名 0x06054b50）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip 檔（找不到 EOCD）');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('zip 的中央目錄壞掉');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip 的本地檔頭壞掉');
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + lNameLen + lExtraLen;
  const data = buf.subarray(start, start + compSize);
  if (method === 0) return { name, data: Buffer.from(data) };
  if (method === 8) return { name, data: inflateRawSync(data) };
  throw new Error(`不支援的 zip 壓縮方式 ${method}`);
}

// ---------- CLI ----------
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function download() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const stamp = today();
  console.log(`下載 ${EXPORT_URL} …`);
  const res = await fetch(EXPORT_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(RAW_DIR, `tfnd-${stamp}.zip`), zip);
  const { name, data } = unzipSingle(zip);
  const jsonPath = path.join(RAW_DIR, `tfnd-${stamp}.json`);
  fs.writeFileSync(jsonPath, data);
  console.log(`zip ${(zip.length / 1e6).toFixed(2)}MB → ${name} ${(data.length / 1e6).toFixed(1)}MB → ${path.relative(ROOT, jsonPath)}`);
  return jsonPath;
}

function latestRaw() {
  if (!fs.existsSync(RAW_DIR)) return null;
  const files = fs.readdirSync(RAW_DIR).filter((f) => /^tfnd-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

async function main() {
  let raw = process.argv.includes('--download') ? await download() : latestRaw();
  if (!raw) {
    console.error('data/raw/ 裡沒有 tfnd-YYYY-MM-DD.json；用 --download 抓一份');
    process.exit(1);
  }
  const version = /tfnd-(\d{4}-\d{2}-\d{2})\.json$/.exec(raw)[1];
  console.log(`讀 ${path.relative(ROOT, raw)} …`);
  const rows = JSON.parse(fs.readFileSync(raw, 'utf8'));
  const { foods, units, report } = transform(rows);

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const out = {
    version,
    source: SOURCE,
    generatedAt: today(),
    note: '每 100 克可食部位的含量；估計值，未計烹調變化。null 表示資料庫沒有該值（不是 0）。',
    units,
    foods,
  };
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');

  const cats = {};
  for (const f of foods) cats[f.cat] = (cats[f.cat] ?? 0) + 1;
  console.log(`列 ${report.rows}、食材 ${report.foods}、略過同名不同年 ${report.droppedYearVariants}、消歧 ${report.disambiguated}`);
  console.log('單位', units);
  console.log('分類', cats);
  console.log(`→ ${path.relative(ROOT, OUT)} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB（版本 ${version}）`);

  // 每季更新時比對前一版：編號消失或營養值改變都要看得到，不然食譜會悄悄對到別的東西
  if (prev && Array.isArray(prev.foods)) {
    const prevById = new Map(prev.foods.map((f) => [f.id, f]));
    const gone = prev.foods.filter((f) => !foods.some((g) => g.id === f.id)).map((f) => `${f.id} ${f.name}`);
    const changed = foods.filter((f) => prevById.has(f.id) && JSON.stringify(prevById.get(f.id).n) !== JSON.stringify(f.n)).length;
    const added = foods.filter((f) => !prevById.has(f.id)).length;
    console.log(`與前一版（${prev.version}）比：消失 ${gone.length}、營養值改變 ${changed}、新增 ${added}`);
    if (gone.length) console.log('消失的編號：', gone.slice(0, 20).join('、'), gone.length > 20 ? '…' : '');
  }
}

if (process.argv[1] && process.argv[1].endsWith('build-foods.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
