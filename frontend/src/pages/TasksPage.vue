<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useTaskStore } from "@/stores/taskStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { useCompanionStore } from "@/stores/companionStore";
import EmptyState from "@/components/EmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { TASK_STATUS_LABEL, TASK_PRIORITY_LABEL, type Task, type TaskStatus, type TaskPriority } from "@/types/task";
import { formatDate } from "@/utils/format";
import { Plus, Trash2, Calendar, FileText, CheckCircle2, Circle, Clock3 } from "lucide-vue-next";

const router = useRouter();
const taskStore = useTaskStore();
const docStore = useDocumentStore();
const appStore = useAppStore();
const companionStore = useCompanionStore();

const showCreate = ref(false);
const showDeleteDialog = ref(false);
const deleteTargetId = ref("");

const newTitle = ref("");
const newPriority = ref<TaskPriority>("medium");
const newDueDate = ref("");

const tabs: { key: "all" | TaskStatus; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待办" },
  { key: "doing", label: "进行中" },
  { key: "done", label: "已完成" }
];

onMounted(async () => {
  await Promise.all([taskStore.load(), docStore.loadAll()]);
});

const priorityColor: Record<TaskPriority, string> = {
  high: "bg-red-50 text-red-600",
  medium: "bg-amber-50 text-amber-600",
  low: "bg-slate-100 text-slate-500"
};

function tabCount(key: "all" | TaskStatus): number {
  if (key === "all") return taskStore.tasks.length;
  if (key === "todo") return taskStore.todoCount;
  if (key === "doing") return taskStore.doingCount;
  return taskStore.doneCount;
}

function sourceTitle(task: Task): string | undefined {
  if (!task.sourceDocumentId) return undefined;
  return docStore.documents.find((d) => d.id === task.sourceDocumentId)?.title;
}

function gotoSource(task: Task) {
  if (task.sourceDocumentId) router.push(`/library/${task.sourceDocumentId}`);
}

async function toggleStatus(task: Task) {
  const next: TaskStatus = task.status === "todo" ? "doing" : task.status === "doing" ? "done" : "todo";
  await taskStore.setStatus(task.id, next);
  if (next === "done") {
    companionStore.addAffection("completeTask", "又完成一个任务，太厉害了！🎉 好感度 +5");
  }
}

async function createTask() {
  if (!newTitle.value.trim()) {
    appStore.showToast("请输入任务标题", "error");
    return;
  }
  await taskStore.create({
    title: newTitle.value,
    priority: newPriority.value,
    dueDate: newDueDate.value || undefined
  });
  appStore.showToast("任务已创建", "success");
  newTitle.value = "";
  newDueDate.value = "";
  showCreate.value = false;
}

function askDelete(id: string) {
  deleteTargetId.value = id;
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  await taskStore.remove(deleteTargetId.value);
  appStore.showToast("任务已删除", "success");
  showDeleteDialog.value = false;
}

function isOverdue(task: Task): boolean {
  return !!task.dueDate && task.status !== "done" && new Date(task.dueDate).getTime() < Date.now();
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-slate-900">任务清单</h1>
      <button class="btn-primary" @click="showCreate = !showCreate">
        <Plus :size="16" /> 新建任务
      </button>
    </div>

    <!-- 新建表单 -->
    <div v-if="showCreate" class="card mb-5 space-y-3 p-4">
      <input v-model="newTitle" type="text" class="input-base" placeholder="任务标题" @keyup.enter="createTask" />
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex gap-1.5">
          <button
            v-for="p in (['high', 'medium', 'low'] as TaskPriority[])"
            :key="p"
            class="rounded-full px-3 py-1 text-xs transition"
            :class="newPriority === p ? priorityColor[p] + ' ring-1 ring-current' : 'bg-slate-100 text-slate-500'"
            @click="newPriority = p"
          >
            {{ TASK_PRIORITY_LABEL[p] }}优先级
          </button>
        </div>
        <input v-model="newDueDate" type="date" class="input-base max-w-[180px]" />
        <div class="ml-auto flex gap-2">
          <button class="btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn-primary" @click="createTask">添加</button>
        </div>
      </div>
    </div>

    <!-- 状态筛选 Tab -->
    <div class="mb-4 flex gap-1 border-b border-slate-100">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="relative px-4 py-2.5 text-sm font-medium transition"
        :class="taskStore.filterStatus === t.key ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'"
        @click="taskStore.filterStatus = t.key"
      >
        {{ t.label }}
        <span class="ml-1 text-xs text-slate-400">{{ tabCount(t.key) }}</span>
        <span
          v-if="taskStore.filterStatus === t.key"
          class="absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand-600"
        ></span>
      </button>
    </div>

    <!-- 任务列表 -->
    <EmptyState
      v-if="taskStore.tasks.length === 0"
      title="还没有任务"
      description="从资料提取行动项，或手动创建任务。"
    />

    <EmptyState
      v-else-if="taskStore.filteredTasks.length === 0"
      title="该状态下没有任务"
      description="切换其他状态查看，或创建新任务。"
    />

    <div v-else class="space-y-2">
      <div
        v-for="task in taskStore.filteredTasks"
        :key="task.id"
        class="card flex items-start gap-3 p-4 transition hover:shadow-md"
      >
        <!-- 状态切换按钮 -->
        <button class="mt-0.5 shrink-0" @click="toggleStatus(task)">
          <CheckCircle2 v-if="task.status === 'done'" :size="22" class="text-emerald-500" />
          <Clock3 v-else-if="task.status === 'doing'" :size="22" class="text-amber-500" />
          <Circle v-else :size="22" class="text-slate-300 hover:text-brand-400" />
        </button>

        <div class="min-w-0 flex-1">
          <div
            class="font-medium text-slate-800"
            :class="task.status === 'done' ? 'text-slate-400 line-through' : ''"
          >
            {{ task.title }}
          </div>
          <div v-if="task.description" class="mt-0.5 text-sm text-slate-500">{{ task.description }}</div>
          <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span class="rounded px-1.5 py-0.5" :class="priorityColor[task.priority]">
              {{ TASK_PRIORITY_LABEL[task.priority] }}优先级
            </span>
            <span v-if="task.dueDate" class="flex items-center gap-1" :class="isOverdue(task) ? 'text-red-500' : 'text-slate-400'">
              <Calendar :size="12" />
              {{ formatDate(task.dueDate) }}
              <span v-if="isOverdue(task)">已逾期</span>
            </span>
            <button
              v-if="sourceTitle(task)"
              class="flex items-center gap-1 text-brand-500 hover:text-brand-700"
              @click="gotoSource(task)"
            >
              <FileText :size="12" /> 来源：{{ sourceTitle(task) }}
            </button>
          </div>
        </div>

        <button class="shrink-0 rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500" @click="askDelete(task.id)">
          <Trash2 :size="16" />
        </button>
      </div>
    </div>

    <ConfirmDialog
      :visible="showDeleteDialog"
      title="删除任务"
      message="删除后不可恢复，确定要删除这个任务吗？"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>
