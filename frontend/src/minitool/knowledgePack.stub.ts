/**
 * 小工具构建替身：端内无网络，内置知识包（词库/语法）无法加载。
 * 用替身替换掉真实实现，保证产物里不出现 fetch。
 */
import type { WordEntry } from "@/services/quest/engine";
import type {
  GrammarTopic,
  IdiomEntry,
  PackIndex,
  RecipeEntry,
  SeasonEntry
} from "@/services/knowledgePack";

export interface PackMeta {
  id: string;
  kind: "words" | "docs";
  title: string;
  count: number;
  bytes: number;
  file: string;
}

function unavailable(): never {
  throw new Error("小工具内不支持内置知识包，请在网页版使用");
}

export function loadPackIndex(): Promise<PackIndex> {
  return Promise.resolve({ version: 0, generatedAt: "", packs: [] });
}

export function loadWords(_id: string): Promise<WordEntry[]> {
  return Promise.reject(unavailable());
}

export function loadGrammar(): Promise<GrammarTopic[]> {
  return Promise.reject(unavailable());
}

export function loadIdioms(): Promise<IdiomEntry[]> {
  return Promise.reject(unavailable());
}

export function loadRecipes(): Promise<RecipeEntry[]> {
  return Promise.reject(unavailable());
}

export function loadSeasons(): Promise<SeasonEntry[]> {
  return Promise.reject(unavailable());
}
