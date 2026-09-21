// 狀態層 —— 畫面只跟這裡講話，不直接碰 db.js 或 fetch。
//
// 這個 App 沒有任何外部請求。這裡的 fetch 只抓同源的 data/*.json（SW 有快取，離線也在）。
// 抓不到不能擋住 App 開啟，但也不能假裝成功：錯誤留著，畫面要講「尚未取得」。

import * as db from './db.js';
import { withPositions } from './planner.js';
import * as prefs from './prefs.js';
import { indexFoods, searchFoods } from './foods.js';
import { validateRecipe } from './recipeschema.js';
import { validateMember } from './members.js';

const state = {
  ready: false,
  foods: null,        // indexFoods() 的結果
  foodTags: null,
  units: null,
  recipes: null,      // 內建食譜（data/recipes.json）
  recipesMeta: null,
  edu: null,          // Map id → entry
  dataErrors: {},     // 檔名 → 錯誤訊息
  members: [],
  userRecipes: [],
  favorites: new Map(), // recipeId → { recipeId, addedAt, favorite, wantThisWeek }（兩個開關各自獨立）
};

/** 「本週想吃」最多幾道（PLAN §4.4）。 */
export const MAX_WANT_THIS_WEEK = 7;

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
export function notifyChanged() { emit(); }

async function loadJson(name) {
  const res = await fetch(`./data/${name}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
  return res.json();
}

async function tryLoad(name) {
  try { return await loadJson(name); }
  catch (e) { state.dataErrors[name] = String(e.message || e); return null; }
}

export async function init() {
  if (state.ready) return;
  await prefs.load();
  const [foods, aliases, units, recipes, edu, foodtags] = await Promise.all([
    tryLoad('foods.json'), tryLoad('aliases.json'), tryLoad('units.json'), tryLoad('recipes.json'), tryLoad('edu.json'), tryLoad('foodtags.json'),
  ]);
  state.foodTags = foodtags?.tags ?? {};
  if (foods) state.foods = indexFoods(foods, aliases ?? { aliases: {} }, state.foodTags);
  state.units = units;
  if (recipes) { state.recipes = recipes.recipes; state.recipesMeta = { foodsVersion: recipes.foodsVersion, count: recipes.recipes.length }; }
  if (edu) state.edu = new Map(edu.entries.map((e) => [e.id, e]));
  await reloadUserData();
  state.ready = true;
}

/** 從 IndexedDB 重讀使用者資料（匯入之後、或測試清庫之後要叫）。 */
export async function reloadUserData() {
  const [members, userRecipes, favorites] = await Promise.all([db.getAll('members'), db.getAll('userRecipes'), db.getAll('favorites')]);
  state.members = members.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  state.userRecipes = userRecipes;
  state.favorites = new Map(favorites.map((f) => [f.recipeId, f]));
}

export function dataError(name) { return state.dataErrors[name] ?? null; }
export function dataErrors() { return { ...state.dataErrors }; }

export function foodsIndex() { return state.foods; }
export function foodsVersion() { return state.foods?.version ?? null; }
export function foodTags() { return state.foodTags ?? {}; }
export function units() { return state.units; }

// ---------- 食譜（內建 ＋ 使用者） ----------
export function recipes() { return state.recipes ?? []; }
export function recipesMeta() { return state.recipesMeta; }
export function userRecipes() { return state.userRecipes; }
/** 所有食譜：內建在前、使用者的在後。 */
export function allRecipes() { return [...(state.recipes ?? []), ...state.userRecipes]; }
export function recipeById(id) { return allRecipes().find((r) => r.id === id) ?? null; }

/** 驗證器用的上下文（解析口語詞、標籤）。使用者食譜允許不填克數。 */
// relaxRequired 不給預設值：沒指定時由食譜自己的 source 決定（使用者的菜放寬），見 recipeschema.validateRecipe。
export function recipeCtx({ allowMissingGrams = false, relaxRequired } = {}) {
  const idx = state.foods;
  return {
    resolve: (t) => {
      if (!idx) return null;
      const s = String(t ?? '').trim();
      return idx.byId.get(s) ?? (idx.aliasMap.get(s) ? idx.byId.get(idx.aliasMap.get(s)) : null) ?? idx.byName.get(s) ?? idx.byAlias.get(s) ?? null;
    },
    foodTags: state.foodTags ?? {},
    // 查不到的食材：訊息裡列幾個資料庫裡相近的名稱，讓使用者知道該怎麼改
    suggest: (t) => (idx ? searchFoods(String(t ?? '').trim(), idx, 3).map((x) => x.food.name) : []),
    allowMissingGrams,
    // 使用者自己加的菜：步驟 1 步就好、時間可以填 0（現成的）。硬底線（食材要解析得到編號、素葷分軌）不放。
    relaxRequired,
  };
}

/** 存一道使用者食譜（新增或修改）。回 { errors, recipe }；有錯就不存。 */
export async function saveUserRecipe(raw) {
  const { errors, recipe } = validateRecipe({ ...raw, source: 'user' }, recipeCtx({ allowMissingGrams: true, relaxRequired: true }));
  if ((state.recipes ?? []).some((r) => r.id === raw?.id)) errors.push('這個 id 跟內建食譜撞到了');
  if (errors.length) return { errors, recipe: null };
  const now = new Date().toISOString();
  const existing = state.userRecipes.find((r) => r.id === recipe.id);
  const saved = { ...recipe, source: 'user', createdAt: existing?.createdAt ?? now, updatedAt: now };
  await db.put('userRecipes', saved);
  state.userRecipes = [...state.userRecipes.filter((r) => r.id !== saved.id), saved];
  emit();
  return { errors: [], recipe: saved };
}

export async function deleteUserRecipe(id) {
  await db.del('userRecipes', id);
  state.userRecipes = state.userRecipes.filter((r) => r.id !== id);
  if (state.favorites.has(id)) { await db.del('favorites', id); state.favorites.delete(id); }
  emit();
}

export function newUserRecipeId() {
  return `r-user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

// ---------- 家人 ----------
export function members() { return state.members; }
export function memberById(id) { return state.members.find((m) => m.id === id) ?? null; }

export async function saveMember(m) {
  const errors = validateMember(m);
  if (errors.length) return { errors };
  const clean = { ...m, name: m.name.trim(), createdAt: m.createdAt ?? new Date().toISOString() };
  await db.put('members', clean);
  state.members = [...state.members.filter((x) => x.id !== clean.id), clean]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  emit();
  return { errors: [] };
}

export async function deleteMember(id) {
  await db.del('members', id);
  state.members = state.members.filter((m) => m.id !== id);
  emit();
}

// ---------- 收藏 ----------
// 一筆紀錄放「收藏」與「本週想吃」兩個**各自獨立**的開關。
// 2026-09-14 使用者回報：按「本週想吃」，「收藏」會一起亮 —— 以前「有這筆紀錄」就等於已收藏，而本週想吃會順手建紀錄。
// 舊資料沒有 favorite 欄位：那時有紀錄就是收藏，所以缺欄位當作已收藏（分辨不出哪幾筆是被連帶收藏的）。
export function isFavoriteRow(f) { return !!f && f.favorite !== false; }
export function favorite(recipeId) { return state.favorites.get(recipeId) ?? null; }
export function isFavorite(recipeId) { return isFavoriteRow(state.favorites.get(recipeId)); }
export function favoriteIds() { return [...state.favorites.values()].filter(isFavoriteRow).map((f) => f.recipeId); }
export function wantThisWeekIds() { return [...state.favorites.values()].filter((f) => f.wantThisWeek).map((f) => f.recipeId); }

/** 兩個開關都關了就刪掉那筆紀錄（不留空紀錄）。 */
async function putFavoriteRow(row) {
  if (!isFavoriteRow(row) && !row.wantThisWeek) {
    await db.del('favorites', row.recipeId);
    state.favorites.delete(row.recipeId);
  } else {
    await db.put('favorites', row);
    state.favorites.set(row.recipeId, row);
  }
}

/** 只動「收藏」，本週想吃不變。 */
export async function toggleFavorite(recipeId) {
  const cur = state.favorites.get(recipeId);
  await putFavoriteRow({ ...(cur ?? { recipeId, addedAt: new Date().toISOString(), wantThisWeek: false }), favorite: !isFavoriteRow(cur) });
  emit();
  return isFavorite(recipeId);
}

/** 勾／取消「本週想吃」。最多 MAX_WANT_THIS_WEEK 道。只動本週想吃，**不會**順便收藏。 */
export async function setWantThisWeek(recipeId, on) {
  const current = wantThisWeekIds();
  if (on && !current.includes(recipeId) && current.length >= MAX_WANT_THIS_WEEK) {
    return { ok: false, reason: `「本週想吃」最多 ${MAX_WANT_THIS_WEEK} 道，先取消一道再勾` };
  }
  const cur = state.favorites.get(recipeId);
  await putFavoriteRow({ ...(cur ?? { recipeId, addedAt: new Date().toISOString(), favorite: false }), wantThisWeek: !!on });
  emit();
  return { ok: true };
}

// ---------- 週計畫與歷史 ----------
export async function getPlan(weekKey) { return withPositions((await db.get('plans', weekKey)) ?? null); }

/** 存一週計畫，並用它取代那一週的 history 列（重新產生時舊的要清掉，不然會殘留）。 */
export async function savePlan(plan) {
  await db.put('plans', { ...plan, savedAt: new Date().toISOString() });
  const old = (await db.getAll('history')).filter((h) => h.weekKey === plan.weekKey);
  for (const h of old) await db.del('history', [h.date, h.recipeId]);
  const rows = [];
  for (const s of plan.slots) {
    if (s.kind !== 'cook') continue;
    for (const it of s.items) rows.push({ date: s.date, recipeId: it.recipeId, meal: s.meal, role: it.role, weekKey: plan.weekKey });
  }
  // 同一天同一道菜出現兩餐時主鍵會撞；保留第一筆就好（不重複的判斷只看日期）
  const seen = new Set();
  const unique = rows.filter((r) => { const k = `${r.date}|${r.recipeId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (unique.length) await db.putAll('history', unique);
  emit();
}

export async function deletePlan(weekKey) {
  await db.del('plans', weekKey);
  const old = (await db.getAll('history')).filter((h) => h.weekKey === weekKey);
  for (const h of old) await db.del('history', [h.date, h.recipeId]);
  emit();
}

export async function history() { return db.getAll('history'); }
export function favoritesList() { return [...state.favorites.values()]; }

// ---------- 購物清單的勾選狀態（每個採買區間一筆） ----------
export async function getShopping(rangeKey) { return (await db.get('shopping', rangeKey)) ?? { rangeKey, checked: {} }; }
export async function saveShopping(row) { await db.put('shopping', { ...row, updatedAt: new Date().toISOString() }); emit(); }

// ---------- 今日一起煮：哪幾步做完了（一餐一筆，存在 settings） ----------
//
// 煮菜是幾十分鐘內的事，但中途會離開畫面（去接電話、去拿東西），所以要存起來。
// key 帶日期與餐別，隔天不會沿用昨天的勾。
export function cookKey(dateIso, meal) { return `cook:${dateIso}:${meal}`; }
export async function getCookDone(dateIso, meal) {
  const row = await db.get('settings', cookKey(dateIso, meal));
  return new Set(Array.isArray(row?.value) ? row.value : []);
}
export async function saveCookDone(dateIso, meal, ids) {
  await db.put('settings', { key: cookKey(dateIso, meal), value: [...ids] });
  emit();
}

// ---------- 衛教 ----------
export function eduEntry(id) { return state.edu?.get(id) ?? null; }
