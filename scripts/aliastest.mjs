// 食材別名表與解析（npm run aliastest）。
//
// 守的事：每個別名都指到存在的編號；解析用精確比對，搜「豬」不會回「馬齒莧」；
// 搜尋畫面的排序是精確命中在前。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section, done, noneOf, everyOf, detects } from './tap.mjs';
import { indexFoods, resolveFood, searchFoods } from '../js/foods.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/aliases.json'), 'utf8'));
const idx = indexFoods(foods, aliases);

section('別名表');
const entries = Object.entries(aliases.aliases);
ok(entries.length >= 150, `別名 ${entries.length} 個（≥ 150）`);
everyOf(entries, ([, id]) => idx.byId.has(id), '每個別名都指到 foods.json 裡存在的整合編號');
everyOf(entries, ([term]) => term.trim() === term && term.length > 0, '別名沒有前後空白、不是空字串');
eq(aliases.foodsVersion, foods.version, '別名表宣告的 foodsVersion 跟 foods.json 一致（資料換季要重新核對）');
for (const t of ['鹽', '糖', '米酒', '白米']) ok(typeof aliases.notes[t] === 'string' && aliases.notes[t].length > 10, `取捨有寫在 notes：${t}`);

section('解析是精確比對');
// 母體先確認：這兩筆真的存在，而且俗名／名稱裡真的含那個字 —— 少了這兩條，
// 下面「搜豬不回馬齒莧」在資料庫根本沒有馬齒莧時也會過。
const purslane = idx.list.find((f) => f.name === '馬齒莧');
ok(purslane && purslane.aliases.some((a) => a.includes('豬')), '（母體）馬齒莧存在，而且俗名含「豬」', JSON.stringify(purslane?.aliases));
const chickpea = idx.list.find((f) => f.name === '鷹嘴豆');
ok(chickpea && chickpea.aliases.some((a) => a.includes('雞')), '（母體）鷹嘴豆存在，而且俗名含「雞」（雞豆、雞心豆）', JSON.stringify(chickpea?.aliases));
eq(resolveFood('豬', idx), null, '解析「豬」→ null（不是馬齒莧）');
eq(resolveFood('雞', idx), null, '解析「雞」→ null（不是鷹嘴豆）');
eq(resolveFood('米', idx), null, '解析「米」→ null');
detects((t) => resolveFood(t, idx) !== null, {
  shouldHit: ['高麗菜', '白飯', '鹽', 'A05002', '甘藍平均值', '雞蛋', '豬絞肉', '板豆腐'],
  shouldMiss: ['豬', '雞', '米', '', '  ', '白米飯XYZ', 'a0550601'],
}, '解析器：口語詞／編號／正式名稱都解得到；子字串、空白、大小寫錯的都解不到');
eq(resolveFood('高麗菜', idx)?.id, 'E30001', '高麗菜 → 甘藍平均值 E30001');
eq(resolveFood('白飯', idx)?.id, 'A0550601', '白飯 → A0550601');
eq(resolveFood('A0550601', idx)?.name, '白飯', '直接給編號也解得到');
eq(resolveFood(' 高麗菜 ', idx)?.id, 'E30001', '前後空白會修掉');
eq(resolveFood('包菜', idx)?.id, 'E30001', '俗名欄精確命中也算（包菜是甘藍的俗名之一）');

section('搜尋：精確命中排最前，子字串在後');
const r1 = searchFoods('豬絞肉', idx);
ok(r1.length > 0 && r1[0].food.id === 'I03104', `搜「豬絞肉」第一筆是別名指到的 I03104（實際 ${r1[0]?.food.id}）`);
const r2 = searchFoods('豬', idx, 50);
ok(r2.length > 5, `（母體）搜「豬」有 ${r2.length} 筆`);
const firstAliasHas = r2.findIndex((x) => x.how === 'aliasHas');
const lastNameHas = r2.map((x) => x.how).lastIndexOf('nameHas');
ok(firstAliasHas === -1 || lastNameHas < firstAliasHas, '名稱包含的排在俗名包含的前面');
noneOf(r2.slice(0, 5), (x) => x.food.name === '馬齒莧', '搜「豬」前五筆沒有馬齒莧');
eq(searchFoods('', idx), [], '空字串搜不到東西（不是全部）');
const r3 = searchFoods('雞蛋', idx);
eq(r3[0]?.food.id, 'K01001', '搜「雞蛋」第一筆是別名的雞蛋平均值 K01001');
ok(r3.every((x) => x.food.name.includes('雞蛋') || x.food.aliases.some((a) => a.includes('雞蛋')) || x.how === 'alias'), '搜到的每一筆都真的跟「雞蛋」有關');

section('嫩莢類的口語別名（2026-09-19 補：買菜清單靠別名表的詞找採買單位）');
{
  const NEW = { 甜豆: 'H1200401', 大豌豆莢: 'H1200301', 長豆: 'H0800101', 肉豆: 'H1300101' };
  everyOf(Object.entries(NEW), ([t, id]) => resolveFood(t, idx)?.id === id, `四個新別名各自對到那一筆嫩莢：${Object.entries(NEW).map(([t, id]) => `${t}→${resolveFood(t, idx)?.id ?? 'null'}(${id})`).join('、')}`);
  // 每個新詞都不是別的食材名稱或俗名的一部分（撞名的話，打那個詞的人會被靜默算成豆莢）
  noneOf(Object.entries(NEW), ([t, id]) => idx.list.some((f) => f.id !== id && (f.name.includes(t) || f.aliases.some((a) => a.includes(t)))), '四個新別名都不是別的食材名稱或俗名的一部分');
  // 對照：「扁豆」是萊豆仁的俗名（白扁豆）、也在「紅扁豆仁」（lentil）的名稱裡 —— 所以鵲豆莢不用它
  ok(idx.list.some((f) => f.id !== 'H1300101' && (f.name.includes('扁豆') || f.aliases.some((a) => a.includes('扁豆')))), '（前提）「扁豆」確實是別的食材名稱或俗名的一部分（紅扁豆仁、白扁豆）');
  ok(resolveFood('扁豆', idx)?.id !== 'H1300101', `打「扁豆」不會對到鵲豆莢（實際：${resolveFood('扁豆', idx)?.name ?? 'null'}）`);
}

done('aliastest');
