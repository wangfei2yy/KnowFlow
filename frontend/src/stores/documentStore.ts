import { defineStore } from "pinia";
import type { Document, Category } from "@/types/document";
import * as docService from "@/services/documentService";
import * as catService from "@/services/categoryService";
import { searchDocuments, type SearchResult } from "@/services/searchService";
import { seedExampleData } from "@/db/seed";

// 首次使用标记：仅首次打开且空库时自动灌入示例，避免用户主动清空后又被重新灌入
const FIRST_RUN_KEY = "knowflow.firstRunSeeded";

export const useDocumentStore = defineStore("document", {
  state: () => ({
    documents: [] as Document[],
    categories: [] as Category[],
    loading: false,
    // 搜索与筛选条件
    searchKeyword: "",
    activeCategoryId: "" as string,
    onlyFavorite: false
  }),
  getters: {
    totalCount: (s) => s.documents.length,
    favoriteCount: (s) => s.documents.filter((d) => d.favorite).length,
    recentDocuments: (s) => s.documents.slice(0, 5),
    categoryById: (s) => (id?: string) => s.categories.find((c) => c.id === id),
    // 近期新增（7 天内）
    recentAddedCount: (s) => {
      const now = Date.now();
      const week = 7 * 24 * 3600 * 1000;
      return s.documents.filter((d) => now - new Date(d.createdAt).getTime() <= week).length;
    },
    // 搜索结果（带分数与上下文片段）
    searchResults(): SearchResult[] {
      return searchDocuments(this.documents, this.searchKeyword);
    },
    // 过滤后的文档列表（搜索 + 分类 + 收藏）
    filteredDocuments(state): Document[] {
      let list: Document[];
      if (state.searchKeyword.trim()) {
        list = this.searchResults.map((r) => r.document);
      } else {
        list = state.documents;
      }
      if (state.activeCategoryId) {
        list = list.filter((d) => d.categoryId === state.activeCategoryId);
      }
      if (state.onlyFavorite) {
        list = list.filter((d) => d.favorite);
      }
      return list;
    }
  },
  actions: {
    /**
     * 加载资料与分类。首次使用且资料库为空时自动灌入内置示例，
     * 让用户打开即可看到内容、快速理解产品（已有数据或已清空过则不重复灌入）。
     */
    async loadAll(autoSeed = true) {
      this.loading = true;
      try {
        this.documents = await docService.listDocuments();
        this.categories = await catService.listCategories();
      } finally {
        this.loading = false;
      }
      // 仅首次使用（localStorage 无标记）且空库时自动灌入示例
      if (autoSeed && this.documents.length === 0) {
        let firstRun = true;
        try {
          firstRun = !localStorage.getItem(FIRST_RUN_KEY);
        } catch {
          /* ignore */
        }
        if (firstRun) {
          await seedExampleData();
          this.documents = await docService.listDocuments();
          this.categories = await catService.listCategories();
          try {
            localStorage.setItem(FIRST_RUN_KEY, "1");
          } catch {
            /* ignore */
          }
        }
      }
    },
    async create(input: docService.CreateDocumentInput) {
      const doc = await docService.createDocument(input);
      await this.loadAll();
      return doc;
    },
    async update(id: string, patch: Partial<Document>) {
      await docService.updateDocument(id, patch);
      await this.loadAll();
    },
    async remove(id: string) {
      await docService.deleteDocument(id);
      await this.loadAll();
    },
    /** 批量删除（返回被删资料，用于撤销） */
    async bulkRemove(ids: string[]): Promise<Document[]> {
      const removed = this.documents.filter((d) => ids.includes(d.id));
      for (const d of removed) {
        await docService.deleteDocument(d.id);
      }
      this.documents = this.documents.filter((d) => !ids.includes(d.id));
      return removed;
    },

    /** 撤销批量删除：按原 id 恢复 */
    async restoreSnapshot(docs: Document[]) {
      await docService.restoreDocuments(docs);
      await this.loadAll(false);
    },

    /** 批量改分类（传空表示未分类） */
    async bulkUpdateCategory(ids: string[], categoryId: string) {
      for (const id of ids) {
        await docService.updateDocument(id, { categoryId: categoryId || undefined });
      }
      await this.loadAll(false);
    },

    async toggleFavorite(id: string) {
      await docService.toggleFavorite(id);
      await this.loadAll();
    },
    async addCategory(name: string, color?: string) {
      const cat = await catService.createCategory(name, color);
      await this.loadAll();
      return cat;
    },
    async removeCategory(id: string) {
      await catService.deleteCategory(id);
      await this.loadAll();
    },
    async loadExamples() {
      await seedExampleData();
      await this.loadAll();
    }
  }
});
