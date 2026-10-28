import { defineStore } from "pinia";
import type { Task, TaskStatus } from "@/types/task";
import * as taskService from "@/services/taskService";

export const useTaskStore = defineStore("task", {
  state: () => ({
    tasks: [] as Task[],
    filterStatus: "all" as "all" | TaskStatus
  }),
  getters: {
    filteredTasks(state): Task[] {
      if (state.filterStatus === "all") return state.tasks;
      return state.tasks.filter((t) => t.status === state.filterStatus);
    },
    pendingCount: (s) => s.tasks.filter((t) => t.status !== "done").length,
    // 按状态分组计数
    todoCount: (s) => s.tasks.filter((t) => t.status === "todo").length,
    doingCount: (s) => s.tasks.filter((t) => t.status === "doing").length,
    doneCount: (s) => s.tasks.filter((t) => t.status === "done").length
  },
  actions: {
    async load() {
      this.tasks = await taskService.listTasks();
    },
    async create(input: taskService.CreateTaskInput) {
      const t = await taskService.createTask(input);
      await this.load();
      return t;
    },
    async setStatus(id: string, status: TaskStatus) {
      await taskService.updateTaskStatus(id, status);
      await this.load();
    },
    async update(id: string, patch: Partial<Task>) {
      await taskService.updateTask(id, patch);
      await this.load();
    },
    async remove(id: string) {
      await taskService.deleteTask(id);
      await this.load();
    }
  }
});
