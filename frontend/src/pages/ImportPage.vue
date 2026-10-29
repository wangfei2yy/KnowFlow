<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { parseFile, importItem, type ImportItem } from "@/services/importService";
import { createDocument } from "@/services/documentService";
import { loadGrammar, loadPackIndex, type PackMeta } from "@/services/knowledgePack";
import { IS_MINITOOL } from "@/utils/runtime";
import { Upload, FileText, Trash2, CheckCircle2, AlertCircle, Plus, X, FolderPlus, Package, Loader2 } from "lucide-vue-next";

const docStore = useDocumentStore();
const appStore = useAppStore();

const fileInput = ref<HTMLInputElement | null>(null);

// 已解析待确认的条目
const pendingItems = ref<ImportItem[]>([]);
// 导入结果清单
const results = ref<{ fileName: string; ok: boolean; error?: string }[]>([]);

const dragging = ref(false);

/* ------------------------- 内置知识包 ------------------------- */
const builtinPacks = ref<PackMeta[]>([]);
const importingBuiltin = ref(false);
const builtinProgress = ref("");

onMounted(async () => {
  try {
    const index = await loadPackIndex();
    builtinPacks.value = index.packs.filter((p) => p.kind === "docs");
  } catch (e) {
    console.warn("[KnowFlow] 内置包索引加载失败：", e);
  }
});

/** 一键导入英语语法专题（按标题去重，分类按专题文件夹创建） */
async function importGrammarPack() {
  importingBuiltin.value = true;
  builtinProgress.value = "";
  try {
    const topics = await loadGrammar();
    const existingTitles = new Set(docStore.documents.map((d) => d.title));
    const catCache = new Map<string, string>();
    let imported = 0;
    let skipped = 0;

    for (const topic of topics) {
      if (existingTitles.has(topic.title)) {
        skipped += 1;
        continue;
      }
      let catId = catCache.get(topic.category);
      if (!catId) {
        const found = docStore.categories.find((c) => c.name === topic.category);
        catId = found ? found.id : (await docStore.addCategory(topic.category)).id;
        catCache.set(topic.category, catId);
      }
      await createDocument({
        title: topic.title,
        content: topic.content,
        sourceType: "note",
        categoryId: catId,
        tags: ["英语语法"]
      });
      imported += 1;
      builtinProgress.value = `${imported} / ${topics.length}`;
    }

    await docStore.loadAll(false);
    appStore.showToast(
      `已导入 ${imported} 篇语法${skipped ? `，跳过 ${skipped} 篇已存在` : ""}`,
      "success"
    );
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "内置包导入失败", "error");
  } finally {
    importingBuiltin.value = false;
    builtinProgress.value = "";
  }
}

const categoryId = ref("");
const tags = ref<string[]>([]);
const tagInput = ref("");

// 新建分类
const showNewCategory = ref(false);
const newCategoryName = ref("");

onMounted(async () => {
  await docStore.loadAll();
});

/** 在当前页面直接新建分类并选中 */
async function createCategory() {
  const name = newCategoryName.value.trim();
  if (!name) {
    appStore.showToast("请输入分类名称", "error");
    return;
  }
  if (docStore.categories.some((c) => c.name === name)) {
    appStore.showToast("该分类已存在", "error");
    return;
  }
  const cat = await docStore.addCategory(name);
  categoryId.value = cat.id;
  newCategoryName.value = "";
  showNewCategory.value = false;
  appStore.showToast(`已创建分类「${cat.name}」`, "success");
}

function triggerSelect() {
  fileInput.value?.click();
}

async function handleFiles(files: FileList | File[]) {
  const list = Array.from(files);
  results.value = [];
  for (const file of list) {
    const r = await parseFile(file);
    if (r.ok && r.text) {
      pendingItems.value.push({
        fileName: r.fileName ?? file.name,
        title: file.name.replace(/\.[^.]+$/, ""),
        content: r.text,
        sourceType: "file",
        categoryId: categoryId.value || undefined,
        tags: [...tags.value]
      });
    } else {
      results.value.push({ fileName: file.name, ok: false, error: r.error });
    }
  }
  if (fileInput.value) fileInput.value.value = "";
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
}

function removeItem(index: number) {
  pendingItems.value.splice(index, 1);
}

function addTag() {
  const t = tagInput.value.trim();
  if (t && !tags.value.includes(t)) tags.value.push(t);
  tagInput.value = "";
}

async function confirmImport() {
  if (pendingItems.value.length === 0) return;
  // 以「确认导入」时选中的分类/标签为准，覆盖入队时的快照，
  // 这样上传文件后再改分类也能生效。
  const finalCategoryId = categoryId.value || undefined;
  const finalTags = [...tags.value];
  for (const item of pendingItems.value) {
    try {
      await importItem({ ...item, categoryId: finalCategoryId, tags: finalTags });
      results.value.push({ fileName: item.fileName, ok: true });
    } catch (e: any) {
      console.error("[KnowFlow] 导入失败：", e);
      results.value.push({
        fileName: item.fileName,
        ok: false,
        error: e?.message ?? "导入失败"
      });
    }
  }
  const okCount = results.value.filter((r) => r.ok).length;
  pendingItems.value = [];
  await docStore.loadAll();
  appStore.showToast(
    okCount > 0 ? `成功导入 ${okCount} 个文件` : "导入失败，请查看下方原因",
    okCount > 0 ? "success" : "error"
  );
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5">
      <h1 class="text-2xl font-bold text-slate-900">文件导入</h1>
      <p class="mt-1 text-sm text-slate-500">支持 TXT、Markdown 和可提取文本的 PDF，单文件不超过 10 MB。</p>
    </div>

    <!-- 内置知识包 -->
    <div v-if="!IS_MINITOOL && builtinPacks.length > 0" class="card mb-5 p-5">
      <div class="mb-2 flex items-center gap-2">
        <Package :size="18" class="text-brand-600" />
        <h2 class="font-semibold text-slate-800">内置知识包</h2>
      </div>
      <p class="mb-3 text-sm text-slate-500">
        不用准备资料，直接导入整理好的英语语法专题，导入后可让 AI 提炼重点、生成卡片。
      </p>
      <div class="space-y-2">
        <div
          v-for="p in builtinPacks"
          :key="p.id"
          class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5"
        >
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-slate-800">{{ p.title }}</div>
            <div class="text-xs text-slate-400">{{ p.count }} 篇 · 按语法点分类归档</div>
          </div>
          <span v-if="importingBuiltin && builtinProgress" class="text-xs text-brand-600">
            已导入 {{ builtinProgress }}
          </span>
          <button class="btn-primary" :disabled="importingBuiltin" @click="importGrammarPack">
            <Loader2 v-if="importingBuiltin" :size="14" class="animate-spin" />
            {{ importingBuiltin ? "导入中…" : "一键导入" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 小工具容器不支持文件选择（仅能选图片/视频）与 PDF 解析 -->
    <div v-if="IS_MINITOOL" class="card p-6 text-center">
      <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500">
        <Upload :size="26" />
      </div>
      <p class="font-medium text-slate-700">小工具内暂不支持文件导入</p>
      <p class="mx-auto mt-1 max-w-md text-sm text-slate-500">
        小红书小工具运行在离线容器中，仅允许选择图片/视频。你可以前往「新增资料」用文本或笔记方式录入内容，或使用网页版导入 TXT / MD / PDF。
      </p>
      <router-link to="/editor" class="btn-primary mt-4 inline-flex">去新增资料</router-link>
    </div>

    <template v-else>
    <!-- 拖拽上传区 -->
    <div
      class="card flex flex-col items-center justify-center border-2 border-dashed border-slate-200 px-6 py-12 text-center transition"
      :class="dragging ? 'border-brand-400 bg-brand-50/50' : ''"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
      @click="triggerSelect"
    >
      <div class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Upload :size="28" />
      </div>
      <p class="font-medium text-slate-700">点击选择文件，或拖拽文件到此处</p>
      <p class="mt-1 text-xs text-slate-400">TXT / MD / PDF</p>
      <input ref="fileInput" type="file" accept=".txt,.md,.markdown,.pdf" multiple class="hidden" @change="handleFiles(($event.target as HTMLInputElement).files!)" />
    </div>

    <!-- 导入选项 -->
    <div class="card mt-4 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="text-sm text-slate-600">默认分类：</div>
        <select v-model="categoryId" class="input-base max-w-[160px]">
          <option value="">未分类</option>
          <option v-for="c in docStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button
          v-if="!showNewCategory"
          class="btn-ghost text-brand-600"
          @click="showNewCategory = true"
        >
          <FolderPlus :size="14" /> 新建分类
        </button>

        <div class="text-sm text-slate-600">默认标签：</div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span v-for="t in tags" :key="t" class="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
            {{ t }}
            <button @click="tags = tags.filter((x) => x !== t)"><X :size="12" /></button>
          </span>
          <input v-model="tagInput" type="text" class="input-base max-w-[120px] py-1" placeholder="回车添加" @keyup.enter="addTag" />
        </div>
      </div>

      <!-- 内联新建分类 -->
      <div v-if="showNewCategory" class="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <input
          v-model="newCategoryName"
          type="text"
          class="input-base max-w-[200px]"
          placeholder="输入分类名称，如「工作资料」"
          @keyup.enter="createCategory"
        />
        <button class="btn-secondary" @click="createCategory">创建并选用</button>
        <button class="btn-ghost text-slate-400" @click="showNewCategory = false">取消</button>
      </div>

      <!-- 分类为空时的提示 -->
      <p v-if="docStore.categories.length === 0 && !showNewCategory" class="mt-2 text-xs text-slate-400">
        当前还没有分类，可直接点「新建分类」创建，或先导入为「未分类」，之后再到资料详情里调整。
      </p>
    </div>

    <!-- 待确认列表 -->
    <div v-if="pendingItems.length > 0" class="mt-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-medium text-slate-500">待导入（{{ pendingItems.length }}）</h2>
        <button class="btn-primary" @click="confirmImport">确认导入</button>
      </div>
      <div class="space-y-3">
        <div v-for="(item, i) in pendingItems" :key="i" class="card p-4">
          <div class="mb-2 flex items-center gap-2">
            <FileText :size="16" class="text-brand-500" />
            <input v-model="item.title" type="text" class="input-base flex-1" />
            <button class="text-slate-300 hover:text-red-500" @click="removeItem(i)"><Trash2 :size="16" /></button>
          </div>
          <div class="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-500">{{ item.content }}</div>
        </div>
      </div>
    </div>

    <!-- 导入结果 -->
    <div v-if="results.length > 0" class="mt-5">
      <h2 class="mb-3 text-sm font-medium text-slate-500">导入结果</h2>
      <div class="space-y-1.5">
        <div v-for="(r, i) in results" :key="i" class="flex items-center gap-2 text-sm">
          <CheckCircle2 v-if="r.ok" :size="16" class="text-emerald-500" />
          <AlertCircle v-else :size="16" class="text-red-500" />
          <span class="text-slate-700">{{ r.fileName }}</span>
          <span v-if="!r.ok" class="text-xs text-red-500">{{ r.error }}</span>
          <span v-else class="text-xs text-emerald-500">成功</span>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
