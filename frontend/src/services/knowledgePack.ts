/**
 * 内置知识包加载器：数据由 scripts/build-packs.mjs 从 data/英语 编译而来，
 * 放在 public/packs/ 下，运行时按需 fetch（不进主 bundle，避免拖慢首屏）。
 */
import type { WordEntry } from "@/services/quest/engine";

export interface PackMeta {
  id: string;
  kind: "words" | "docs";
  title: string;
  count: number;
  bytes: number;
  file: string;
}

export interface PackIndex {
  version: number;
  generatedAt: string;
  packs: PackMeta[];
}

/** 成语：w 成语 / m 释义 / from 出处 */
export interface IdiomEntry {
  w: string;
  m: string;
  from?: string;
  len: number;
}

export type MealKey = "breakfast" | "lunch" | "dinner" | "snack";

export interface RecipeEntry {
  id: string;
  name: string;
  meal: MealKey;
  materials: string[];
  steps: string[];
  tags: string[];
}

export interface SeasonEntry {
  season: "春" | "夏" | "秋" | "冬";
  vegetables: string[];
  fruits: string[];
}

export interface GrammarTopic {
  id: string;
  title: string;
  category: string;
  content: string;
}

const BASE = `${import.meta.env.BASE_URL}packs/`;
const cache = new Map<string, unknown>();

async function fetchJSON<T>(file: string): Promise<T> {
  if (cache.has(file)) return cache.get(file) as T;
  const res = await fetch(`${BASE}${file}`);
  if (!res.ok) throw new Error(`知识包加载失败（${res.status}）`);
  const data = (await res.json()) as T;
  cache.set(file, data);
  return data;
}

export function loadPackIndex(): Promise<PackIndex> {
  return fetchJSON<PackIndex>("index.json");
}

export function loadWords(id: string): Promise<WordEntry[]> {
  return fetchJSON<WordEntry[]>(`${id}.json`);
}

export function loadGrammar(): Promise<GrammarTopic[]> {
  return fetchJSON<GrammarTopic[]>("grammar.json");
}

export function loadIdioms(): Promise<IdiomEntry[]> {
  return fetchJSON<IdiomEntry[]>("idiom.json");
}

export function loadRecipes(): Promise<RecipeEntry[]> {
  return fetchJSON<RecipeEntry[]>("recipes.json");
}

export function loadSeasons(): Promise<SeasonEntry[]> {
  return fetchJSON<SeasonEntry[]>("seasons.json");
}
