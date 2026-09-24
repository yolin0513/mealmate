// build-recipes、build-foods 的驗法（v9 F8，2026-09-24）：資料不見、壞掉、變少時，要停下、點名是哪一個單位、一個檔都不寫。
// 用法：node --max-old-space-size=4096 scripts/buildguard-verify.mjs --rev <commit> [--only recipes|foods]
//   在 repo 外的拋棄式 worktree（那個 commit）裡跑。原始資料用「複本」（主 repo 的 data/raw/ 不碰）。
//
// 母體是「每一個單位 × 每一種情境」，寫成迴圈、不挑代表：
//   build-recipes：每一道食譜檔 ×（刪掉、內容清空、欄位名稱打錯）＋ 整體（資料夾清空、資料夾不存在、foods.json 不存在）
//   build-foods：必要欄位 × 改名、營養素 × 那一項的列全部拿掉、分類 × 那一類的列全部拿掉 ＋ 整體（資料夾不存在、空陣列、JSON 壞掉、只給前 5%）
// 每一格三件事都要成立才算「擋」：回傳值非 0、**錯誤輸出（stderr）**點名這個單位、輸出檔雜湊前後相同且沒有留下 .tmp。
// 回傳非 0 但理由沒點名這個單位的——被別的規則碰巧擋下——一律算「沒擋」。
// 全部都擋、而且基準（什麼都不改）放行，才回 0。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const rev = args[args.indexOf('--rev') + 1];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (!args.includes('--rev') || !rev) { console.log('用法：--rev <commit> [--only recipes|foods]'); process.exit(2); }
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const RAW_NAME = 'tfnd-2026-08-26.json';
const RAW_MAIN = path.join(repo, 'data/raw', RAW_NAME);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const fileSha = (p) => (fs.existsSync(p) ? sha(fs.readFileSync(p)) : '（不存在）');

const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-bg-'));
fs.rmSync(wt, { recursive: true });
execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', wt, rev]);
let fail = 0;
try {
  const head = execFileSync('git', ['-C', wt, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const br = fs.readFileSync(path.join(wt, 'scripts/build-recipes.mjs'), 'utf8');
  const bf = fs.readFileSync(path.join(wt, 'scripts/build-foods.mjs'), 'utf8');
  console.log(`版本 ${head}｜build-recipes sha=${sha(br)}（outputProblems：${br.includes('export function outputProblems') ? '有' : '沒有'}）｜build-foods sha=${sha(bf)}（rawProblems／foodsProblems：${bf.includes('export function rawProblems') && bf.includes('export function foodsProblems') ? '有' : '沒有'}）`);
  const restore = () => {
    execFileSync('git', ['-C', wt, 'checkout', '-q', '--', 'data']);
    execFileSync('git', ['-C', wt, 'clean', '-q', '-fd', '--', 'data/recipes']);
    for (const p of ['data/recipes.json.tmp', 'data/foods.json.tmp']) fs.rmSync(path.join(wt, p), { force: true });
  };
  // 跑一格：setup → 記輸出檔雜湊 → 跑 → 判三件事
  const cell = (script, outRel, setup, token) => {
    restore();
    setup();
    const out = path.join(wt, outRel); const tmp = `${out}.tmp`;
    const before = fileSha(out);
    const r = spawnSync(process.execPath, ['--max-old-space-size=4096', `scripts/${script}`], { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const err = r.stderr ?? '';
    const blocked = r.status !== 0 && (token === null || err.includes(token)) && fileSha(out) === before && !fs.existsSync(tmp);
    return { blocked, code: r.status, named: token === null || err.includes(token), same: fileSha(out) === before, tmpLeft: fs.existsSync(tmp), err, out: r.stdout ?? '' };
  };
  const report = (group, results) => {
    const bad = results.filter((x) => !x.blocked);
    const coincid = bad.filter((x) => x.code !== 0 && !x.named).length;
    console.log(`${group}｜${results.length} 格｜擋 ${results.length - bad.length}｜沒擋 ${bad.length}（其中回非 0 但沒點名這個單位＝被別的規則碰巧擋下 ${coincid}）`);
    for (const x of bad.slice(0, 5)) console.log(`    沒擋：${x.unit}｜回傳 ${x.code}｜點名 ${x.named}｜輸出檔沒動 ${x.same}｜留下 .tmp ${x.tmpLeft}｜${(x.err.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 90)}`);
    if (bad.length) fail += 1;
  };

  if (!only || only === 'recipes') {
    const B = 'build-recipes.mjs', OUT = 'data/recipes.json';
    const base = cell(B, OUT, () => {}, null);
    const baseOk = base.code === 0;
    console.log(`build-recipes｜基準（什麼都不改）｜回傳 ${base.code}｜${baseOk ? '放行' : '沒放行——基準不綠，下面的結果不採信'}`);
    if (!baseOk) fail += 1;
    const files = fs.readdirSync(path.join(wt, 'data/recipes')).filter((f) => f.endsWith('.json')).sort();
    const p = (f) => path.join(wt, 'data/recipes', f);
    const scen = {
      '刪掉那一道': (f) => fs.rmSync(p(f)),
      '內容清空': (f) => fs.writeFileSync(p(f), ''),
      '欄位名稱打錯（ingredients → ingredient）': (f) => { const j = JSON.parse(fs.readFileSync(p(f), 'utf8')); j.ingredient = j.ingredients; delete j.ingredients; fs.writeFileSync(p(f), JSON.stringify(j)); },
    };
    for (const [name, fn] of Object.entries(scen)) {
      report(`build-recipes｜${name}`, files.map((f) => ({ unit: f, ...cell(B, OUT, () => fn(f), f.replace(/\.json$/, '')) })));
    }
    report('build-recipes｜整體', [
      { unit: '資料夾清空', ...cell(B, OUT, () => { for (const f of files) fs.rmSync(p(f)); }, '0 道') },
      { unit: '資料夾不存在', ...cell(B, OUT, () => fs.rmSync(path.join(wt, 'data/recipes'), { recursive: true }), 'data/recipes') },
      { unit: 'foods.json 不存在', ...cell(B, OUT, () => fs.rmSync(path.join(wt, 'data/foods.json')), 'data/foods.json') },
    ]);
  }

  if (!only || only === 'foods') {
    const B = 'build-foods.mjs', OUT = 'data/foods.json';
    const rawDir = path.join(wt, 'data/raw');
    const rows = JSON.parse(fs.readFileSync(RAW_MAIN, 'utf8'));
    const putRaw = (list) => { fs.mkdirSync(rawDir, { recursive: true }); fs.writeFileSync(path.join(rawDir, RAW_NAME), typeof list === 'string' ? list : JSON.stringify(list)); };
    const base = cell(B, OUT, () => putRaw(rows), null);
    const baseOk = base.code === 0;
    console.log(`build-foods｜基準（真實原始資料的複本）｜回傳 ${base.code}｜${baseOk ? '放行' : '沒放行——基準不綠，下面的結果不採信'}`);
    if (!baseOk) fail += 1;
    const FIELDS = ['整合編號', '樣品名稱', '食品分類', '分析項', '每100克含量', '含量單位'];
    report('build-foods｜欄位改名', FIELDS.map((fld) => ({ unit: fld, ...cell(B, OUT, () => putRaw(rows.map((r) => { const { [fld]: v, ...rest } = r; return { ...rest, [`${fld}_改名`]: v }; })), fld) })));
    const NUTRIENTS = ['熱量', '粗蛋白', '粗脂肪', '飽和脂肪', '總碳水化合物', '糖質總量', '膳食纖維', '鈉', '鉀', '磷', '鈣', '膽固醇'];
    report('build-foods｜營養素的列全部拿掉', NUTRIENTS.map((nut) => ({ unit: nut, ...cell(B, OUT, () => putRaw(rows.filter((r) => String(r['分析項'] ?? '').trim() !== nut)), `「${nut}」`) })));
    const cats = [...new Set(JSON.parse(fs.readFileSync(path.join(wt, OUT), 'utf8')).foods.map((f) => f.cat))].sort();
    report('build-foods｜分類的列全部拿掉', cats.map((cat) => ({ unit: cat, ...cell(B, OUT, () => putRaw(rows.filter((r) => String(r['食品分類'] ?? '').trim() !== cat)), `「${cat}」`) })));
    report('build-foods｜整體', [
      { unit: '原始資料資料夾不存在', ...cell(B, OUT, () => fs.rmSync(rawDir, { recursive: true, force: true }), 'data/raw') },
      { unit: '空陣列', ...cell(B, OUT, () => putRaw('[]'), '0 列') },
      { unit: 'JSON 壞掉', ...cell(B, OUT, () => putRaw('[{壞掉'), RAW_NAME) },
      { unit: '只給前 5%', ...cell(B, OUT, () => putRaw(rows.slice(0, Math.floor(rows.length * 0.05))), '少了') },
    ]);
  }
} finally {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]);
}
console.log(fail ? `buildguard 驗法：有 ${fail} 組沒全擋（或基準不綠）` : 'buildguard 驗法：每一格都擋下、理由點名那個單位、輸出檔沒動');
process.exitCode = fail ? 1 : 0;
