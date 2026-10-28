import { defineStore } from "pinia";
import { listDueCards } from "@/services/flashcardService";

/**
 * 复习进度统计（队列数量、今日已复习）。
 * 侧边栏 badge、首页行动卡共用，避免各自查库。
 */
export const useReviewStore = defineStore("review", {
  state: () => ({
    /** 今天到期（含逾期） */
    due: 0,
    /** 其中早于今天 0 点 */
    overdue: 0,
    /** 从未复习过的新卡片 */
    fresh: 0,
    /** 今日已复习张数 */
    todayDone: 0,
    /** 队列总量 = due + fresh */
    pending: 0,
    loaded: false,
    loading: false
  }),
  getters: {
    /** 是否有待复习内容（badge 显示条件） */
    hasPending: (state) => state.pending > 0
  },
  actions: {
    async refresh() {
      if (this.loading) return;
      this.loading = true;
      try {
        const stats = await listDueCards();
        this.due = stats.due;
        this.overdue = stats.overdue;
        this.fresh = stats.fresh;
        this.todayDone = stats.todayDone;
        this.pending = stats.pending;
        this.loaded = true;
      } catch (e) {
        console.warn("[KnowFlow] 复习统计加载失败：", e);
      } finally {
        this.loading = false;
      }
    }
  }
});
