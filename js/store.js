// 狀態層 —— 畫面只跟這裡講話，不直接碰 db.js 或 fetch。
//
// 這個 App 沒有任何外部請求。這裡的 fetch 只抓同源的 data/*.json（SW 有快取，離線也在）。
// 抓不到不能擋住 App 開啟，但也不能假裝成功：錯誤留著，畫面要講「尚未取得」。

import * as db from './db.js';
import * as prefs from './prefs.js';
import { indexFoods } from './foods.js';
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
  favorites: new Map(), // recipeId → { recipeId, addedAt, wantThisWeek }
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
  if (foods) state.foods = indexFoods(foods, aliases ?? { aliases: {} });
  state.foodTags = foodtags?.tags ?? {};
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
export function recipeCtx({ allowMissingGrams = false } = {}) {
  const idx = state.foods;
  return {
    resolve: (t) => {
      if (!idx) return null;
      const s = String(t ?? '').trim();
      return idx.byId.get(s) ?? (idx.aliasMap.get(s) ? idx.byId.get(idx.aliasMap.get(s)) : null) ?? idx.byName.get(s) ?? idx.byAlias.get(s) ?? null;
    },
    foodTags: state.foodTags ?? {},
    allowMissingGrams,
  };
}

/** 存一道使用者食譜（新增或修改）。回 { errors, recipe }；有錯就不存。 */
export async function saveUserRecipe(raw) {
  const { errors, recipe } = validateRecipe({ ...raw, source: 'user' }, recipeCtx({ allowMissingGrams: true }));
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
export function favorite(recipeId) { return state.favorites.get(recipeId) ?? null; }
export function isFavorite(recipeId) { return state.favorites.has(recipeId); }
export function favoriteIds() { return [...state.favorites.keys()]; }
export function wantThisWeekIds() { return [...state.favorites.values()].filter((f) => f.wantThisWeek).map((f) => f.recipeId); }

export async function toggleFavorite(recipeId) {
  if (state.favorites.has(recipeId)) {
    await db.del('favorites', recipeId);
    state.favorites.delete(recipeId);
  } else {
    const row = { recipeId, addedAt: new Date().toISOString(), wantThisWeek: false };
    await db.put('favorites', row);
    state.favorites.set(recipeId, row);
  }
  emit();
  return state.favorites.has(recipeId);
}

/**
 * 切「本週想吃」。最多 MAX_WANT_THIS_WEEK 道 —— 超過回 { ok: false, reason }，不改任何東西。
 * 沒收藏的會順便收藏。
 */
export async function setWantThisWeek(recipeId, on) {
  const current = wantThisWeekIds();
  if (on && !current.includes(recipeId) && current.length >= MAX_WANT_THIS_WEEK) {
    return { ok: false, reason: `「本週想吃」最多 ${MAX_WANT_THIS_WEEK} 道，先取消一道再勾` };
  }
  const row = { ...(state.favorites.get(recipeId) ?? { recipeId, addedAt: new Date().toISOString() }), wantThisWeek: !!on };
  await db.put('favorites', row);
  state.favorites.set(recipeId, row);
  emit();
  return { ok: true };
}

// ---------- 週計畫與歷史 ----------
export async function getPlan(weekKey) { return (await db.get('plans', weekKey)) ?? null; }

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

// ---------- 衛教 ----------
export function eduEntry(id) { return state.edu?.get(id) ?? null; }
