// 狀態層 —— 畫面只跟這裡講話，不直接碰 db.js 或 fetch。
//
// 這個 App 沒有任何外部請求。這裡的 fetch 只抓同源的 data/*.json（SW 有快取，離線也在）。
// 抓不到不能擋住 App 開啟，但也不能假裝成功：錯誤留著，畫面要講「尚未取得」。

import * as db from './db.js';
import * as prefs from './prefs.js';
import { indexFoods } from './foods.js';

const state = {
  ready: false,
  foods: null,        // indexFoods() 的結果
  units: null,
  recipes: null,      // data/recipes.json 的 recipes 陣列
  recipesMeta: null,
  edu: null,          // Map id → entry
  dataErrors: {},     // 檔名 → 錯誤訊息
};

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
  const [foods, aliases, units, recipes, edu] = await Promise.all([
    tryLoad('foods.json'), tryLoad('aliases.json'), tryLoad('units.json'), tryLoad('recipes.json'), tryLoad('edu.json'),
  ]);
  if (foods) state.foods = indexFoods(foods, aliases ?? { aliases: {} });
  state.units = units;
  if (recipes) { state.recipes = recipes.recipes; state.recipesMeta = { version: recipes.version, count: recipes.recipes.length }; }
  if (edu) state.edu = new Map(edu.entries.map((e) => [e.id, e]));
  state.ready = true;
}

export function dataError(name) { return state.dataErrors[name] ?? null; }
export function dataErrors() { return { ...state.dataErrors }; }

export function foodsIndex() { return state.foods; }
export function foodsVersion() { return state.foods?.version ?? null; }
export function units() { return state.units; }

export function recipes() { return state.recipes ?? []; }
export function recipesMeta() { return state.recipesMeta; }
export function recipeById(id) { return (state.recipes ?? []).find((r) => r.id === id) ?? null; }

export function eduEntry(id) { return state.edu?.get(id) ?? null; }

// ---------- 使用者資料（M1 起會長大） ----------
export async function members() { return db.getAll('members'); }
