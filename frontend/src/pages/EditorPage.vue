<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { useCompanionStore } from "@/stores/companionStore";
import { validateDocument } from "@/utils/validation";
import { parseFile } from "@/services/importService";
import { IS_MINITOOL } from "@/utils/runtime";
import type { SourceType } from "@/types/document";
import { SOURCE_TYPE_LABEL } from "@/types/document";
import { ArrowLeft, Plus, X, Save, Upload, FileText, Globe, Loader2 } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const docStore = useDocumentStore();
const appStore = useAppStore();
const companionStore = useCompanionStore();

const isEdit = computed(() => !!route.params.id);
const editId = computed(() => route.params.id as string | undefined);

const title = ref("");
const content = ref("");
const sourceType = ref<SourceType>("note");
const categoryId = ref("");
const tags = ref<string[]>([]);
const tagInput = ref("");

const errors = ref<string[]>([]);
const saving = ref(false);
const showCategoryInput = ref(false);
const newCategoryName = ref("");

// 来源附加信息：文件类型记录文件名，网页类型记录链接
const sourceFileName = ref("");
const sourceUrl = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const parsingFile = ref(false);
const parseError = ref("");

// 小工具容器无法选择 TXT/PDF 文件，端内隐藏「文件」来源类型
const sourceTypes = Object.entries(SOURCE_TYPE_LABEL)
  .filter(([value]) => !(IS_MINITOOL && value === "file"))
  .map(([value, label]) => ({ value: value as SourceType, label }));

/** 重置表单为初始状态 */
function resetForm() {
  title.value = "";
  content.value = "";
  sourceType.value = "note";
  categoryId.value = "";
  tags.value = [];
  tagInput.value = "";
  errors.value = [];
  showCategoryInput.value = false;
  newCategoryName.value = "";
  sourceFileName.value = "";
  sourceUrl.value = "";
  parseError.value = "";
}

/** 按当前路由初始化表单（新增为空，编辑为原文） */
async function initForm() {
  await docStore.loadAll();
  resetForm();
  if (isEdit.value && editId.value) {
    const doc = docStore.documents.find((d) => d.id === editId.value);
    if (doc) {
      title.value = doc.title;
      content.value = doc.content;
      sourceType.value = doc.sourceType;
      categoryId.value = doc.categoryId ?? "";
      tags.value = [...doc.tags];
      // 恢复来源附加信息
      if (doc.sourceType === "web") {
        sourceUrl.value = doc.sourceName ?? "";
      } else if (doc.sourceType === "file") {
        sourceFileName.value = doc.sourceName ?? "";
      }
    }
  }
}

// 关键：/editor 与 /editor/:id 复用同一组件，
// 用 watch 监听路由参数变化，避免从"编辑"切到"新增"时残留旧数据。
watch(
  () => route.params.id,
  () => {
    if (route.name === "editor" || route.name === "editor-edit") {
      initForm();
    }
  },
  { immediate: true }
);

function addTag() {
  const t = tagInput.value.trim();
  if (t && !tags.value.includes(t)) {
    tags.value.push(t);
  }
  tagInput.value = "";
}

function removeTag(t: string) {
  tags.value = tags.value.filter((x) => x !== t);
}

async function addCategory() {
  const name = newCategoryName.value.trim();
  if (!name) return;
  const cat = await docStore.addCategory(name);
  categoryId.value = cat.id;
  newCategoryName.value = "";
  showCategoryInput.value = false;
}

/** 选择文件后自动解析并填充标题、正文 */
function triggerFilePick() {
  fileInput.value?.click();
}

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  parsingFile.value = true;
  parseError.value = "";
  try {
    const r = await parseFile(file);
    if (!r.ok || !r.text) {
      parseError.value = r.error ?? "文件解析失败";
      appStore.showToast(parseError.value, "error");
      return;
    }
    content.value = r.text;
    sourceFileName.value = file.name;
    // 标题为空时，用文件名（去扩展名）作为默认标题
    if (!title.value.trim()) {
      title.value = file.name.replace(/\.[^.]+$/, "");
    }
    appStore.showToast("文件已解析，正文已自动填入", "success");
  } finally {
    parsingFile.value = false;
  }
}

async function save() {
  // 保存时把输入框里尚未回车的标签也带上，避免用户以为已添加
  const pending = tagInput.value.trim();
  if (pending && !tags.value.includes(pending)) {
    tags.value.push(pending);
    tagInput.value = "";
  }

  const result = validateDocument({ title: title.value, content: content.value });
  if (!result.valid) {
    errors.value = result.errors;
    appStore.showToast(result.errors[0], "error");
    return;
  }
  errors.value = [];
  saving.value = true;
  try {
    // 根据来源类型记录附加信息
    const sourceName =
      sourceType.value === "file"
        ? sourceFileName.value.trim() || undefined
        : sourceType.value === "web"
          ? sourceUrl.value.trim() || undefined
          : undefined;

    const payload = {
      title: title.value.trim(),
      content: content.value,
      sourceType: sourceType.value,
      sourceName,
      categoryId: categoryId.value || undefined,
      tags: tags.value
    };
    let id: string;
    const isNew = !(isEdit.value && editId.value);
    if (isEdit.value && editId.value) {
      await docStore.update(editId.value, payload);
      id = editId.value;
    } else {
      const doc = await docStore.create(payload);
      id = doc.id;
    }
    appStore.showToast(
      result.warnings.length > 0 ? "保存成功（正文为空）" : "保存成功",
      "success"
    );
    if (isNew) {
      companionStore.addAffection("createDocument", "又记下一条知识，真棒！📝 好感度 +3");
    }
    router.push(`/library/${id}`);
  } catch (e: any) {
    // 暴露真实错误，便于定位问题（同时输出到控制台）
    console.error("[KnowFlow] 保存资料失败：", e);
    const msg =
      e?.name === "QuotaExceededError"
        ? "浏览器存储空间已满，请清理数据后重试"
        : e?.message
          ? `保存失败：${e.message}`
          : "保存失败，请重试";
    appStore.showToast(msg, "error");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5 flex items-center justify-between">
      <button class="btn-ghost" @click="router.back()">
        <ArrowLeft :size="18" /> 返回
      </button>
      <h1 class="text-lg font-bold text-slate-900">{{ isEdit ? "编辑资料" : "新增资料" }}</h1>
      <div class="w-16"></div>
    </div>

    <div class="card space-y-5 p-6">
      <!-- 标题 -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">
          标题 <span class="text-red-500">*</span>
        </label>
        <input v-model="title" type="text" class="input-base" placeholder="给这条资料起个名字" />
      </div>

      <!-- 来源类型 -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">来源类型</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in sourceTypes"
            :key="s.value"
            class="rounded-full px-3 py-1.5 text-sm transition"
            :class="sourceType === s.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="sourceType = s.value"
          >
            {{ s.label }}
          </button>
        </div>
        <p class="mt-1.5 text-xs text-slate-400">
          <template v-if="sourceType === 'file'">上传文件后会自动解析出正文，无需手动输入</template>
          <template v-else-if="sourceType === 'web'">记录网页链接，正文请粘贴进来</template>
          <template v-else-if="sourceType === 'text'">直接粘贴或输入一段文本</template>
          <template v-else>手写笔记，想到什么记什么</template>
        </p>
      </div>

      <!-- 文件上传（仅「文件」类型） -->
      <div v-if="sourceType === 'file'">
        <label class="mb-1.5 block text-sm font-medium text-slate-700">选择文件</label>
        <div
          class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
          @click="triggerFilePick"
        >
          <Loader2 v-if="parsingFile" :size="24" class="mb-2 animate-spin text-brand-500" />
          <Upload v-else :size="24" class="mb-2 text-brand-500" />
          <p class="text-sm font-medium text-slate-700">
            {{ parsingFile ? "正在解析文件…" : sourceFileName || "点击选择文件" }}
          </p>
          <p class="mt-1 text-xs text-slate-400">支持 TXT / MD / PDF，单文件 10 MB 以内</p>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.md,.markdown,.pdf"
          class="hidden"
          @change="handleFileUpload"
        />
        <p v-if="parseError" class="mt-1.5 text-xs text-red-500">{{ parseError }}</p>
        <p v-if="sourceFileName && !parseError" class="mt-1.5 flex items-center gap-1 text-xs text-emerald-600">
          <FileText :size="12" /> 已解析：{{ sourceFileName }}
        </p>
      </div>

      <!-- 网页链接（仅「网页」类型） -->
      <div v-if="sourceType === 'web'">
        <label class="mb-1.5 block text-sm font-medium text-slate-700">网页链接</label>
        <div class="relative">
          <Globe :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input v-model="sourceUrl" type="url" class="input-base pl-9" placeholder="https://example.com/article" />
        </div>
        <p class="mt-1.5 text-xs text-slate-400">
          浏览器安全限制无法自动抓取网页内容，请打开链接后把正文复制粘贴到下方
        </p>
      </div>

      <!-- 正文 -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">
          {{ sourceType === "file" ? "正文内容（已从文件解析，可编辑）" : sourceType === "web" ? "正文内容（请粘贴网页正文）" : "正文" }}
        </label>
        <textarea
          v-model="content"
          rows="10"
          class="input-base resize-y font-mono text-sm leading-relaxed"
          :placeholder="
            sourceType === 'file'
              ? '上传文件后，解析出的文字会自动出现在这里…'
              : sourceType === 'web'
                ? '把网页正文复制到这里…'
                : '粘贴或输入内容…'
          "
        ></textarea>
      </div>

      <!-- 分类 -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">分类</label>
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="rounded-full px-3 py-1.5 text-sm transition"
            :class="!categoryId ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="categoryId = ''"
          >
            未分类
          </button>
          <button
            v-for="c in docStore.categories"
            :key="c.id"
            class="rounded-full px-3 py-1.5 text-sm transition"
            :class="categoryId === c.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="categoryId = c.id"
          >
            {{ c.name }}
          </button>
          <button v-if="!showCategoryInput" class="btn-ghost text-brand-600" @click="showCategoryInput = true">
            <Plus :size="14" /> 新建分类
          </button>
        </div>
        <div v-if="showCategoryInput" class="mt-2 flex gap-2">
          <input
            v-model="newCategoryName"
            type="text"
            class="input-base max-w-xs"
            placeholder="分类名称"
            @keyup.enter="addCategory"
          />
          <button class="btn-secondary" @click="addCategory">添加</button>
          <button class="btn-ghost" @click="showCategoryInput = false">取消</button>
        </div>
      </div>

      <!-- 标签 -->
      <div>
        <label class="mb-1.5 block text-sm font-medium text-slate-700">标签</label>
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            v-for="t in tags"
            :key="t"
            class="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-600"
          >
            {{ t }}
            <button class="text-brand-400 hover:text-brand-700" @click="removeTag(t)">
              <X :size="12" />
            </button>
          </span>
          <input
            v-model="tagInput"
            type="text"
            class="input-base max-w-[160px] py-1"
            placeholder="回车添加"
            @keyup.enter="addTag"
          />
        </div>
      </div>

      <!-- 保存 -->
      <div class="flex items-center justify-end gap-2 border-t border-slate-100 pt-5">
        <button class="btn-secondary" @click="router.back()">取消</button>
        <button class="btn-primary" :disabled="saving" @click="save">
          <Save :size="16" /> {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </div>
  </div>
</template>
