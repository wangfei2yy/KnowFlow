<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from "vue";
import { useAIStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { useCompanionStore } from "@/stores/companionStore";
import { levelFromAffection, formFromAffection, FORM_NAMES } from "@/services/companion/types";
import CompanionAvatar from "@/components/CompanionAvatar.vue";
import { db } from "@/db/database";
import {
  exportAll,
  validateBackup,
  importAll,
  documentsToMarkdown,
  cardsToAnkiCsv,
  type BackupPayload
} from "@/utils/export";
import { listFlashcards } from "@/services/flashcardService";
import { downloadText } from "@/utils/download";
import { downloadJSON } from "@/utils/download";
import { IS_MINITOOL } from "@/utils/runtime";
import { OpenAICompatibleProvider } from "@/services/ai/OpenAICompatibleProvider";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { Download, Upload, Trash2, Sparkles, ShieldCheck, Info, ImagePlus, Loader2, CheckCircle2, AlertCircle, FileText, Layers, Sun } from "lucide-vue-next";

const aiStore = useAIStore();
const docStore = useDocumentStore();
const appStore = useAppStore();
const companionStore = useCompanionStore();

const level = computed(() => levelFromAffection(companionStore.companion.affection));
const form = computed(() => formFromAffection(companionStore.companion.affection));

// 头像上传
const avatarInput = ref<HTMLInputElement | null>(null);

function pickAvatar() {
  avatarInput.value?.click();
}

async function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    appStore.showToast("请选择图片文件", "error");
    input.value = "";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    appStore.showToast("图片请控制在 2MB 以内", "error");
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    companionStore.setAvatar(reader.result as string);
    appStore.showToast("头像已更新", "success");
  };
  reader.readAsDataURL(file);
  input.value = "";
}

// AI 配置表单
const aiMode = ref<"mock" | "openai">(aiStore.config.mode);
const baseUrl = ref(aiStore.config.baseUrl ?? "");
const model = ref(aiStore.config.model ?? "");

// 语音转写（小知「按住说话」）独立配置
const speechBaseUrl = ref(aiStore.speech.baseUrl ?? "");
const speechModelName = ref(aiStore.speech.model ?? "");
const speechKey = ref(aiStore.speechKey ?? "");
const speechRemember = ref(aiStore.speechRemember);
const showSpeechKey = ref(false);
const maskedSpeechKey = computed(() => maskKey(aiStore.speechKey));

/** 主题选项 */
const themeOptions = [
  { value: "light" as const, label: "浅色" },
  { value: "dark" as const, label: "深色" },
  { value: "system" as const, label: "跟随系统" }
];

/** 一键填入国内可直连的语音转写服务（硅基流动 SenseVoice） */
function applySpeechPreset() {
  speechBaseUrl.value = "https://api.siliconflow.cn/v1";
  speechModelName.value = "FunAudioLLM/SenseVoiceSmall";
  appStore.showToast("已填入硅基流动地址与模型，再填上它的 API Key 即可", "info");
}

function applyWhisperPreset() {
  speechBaseUrl.value = "https://api.openai.com/v1";
  speechModelName.value = "whisper-1";
}
const apiKey = ref(aiStore.apiKey ?? "");

/**
 * 已保存 Key 的脱敏摘要：显示 `sk-…末四位`。
 * 手机上输入框较长时会被横向滚到末尾（前缀看不见），容易被误认为「sk- 被截断」，
 * 这里额外给一行摘要，能直接确认前缀是否完好。
 */
const maskedApiKey = computed(() => maskKey(aiStore.apiKey));
function maskKey(key: string): string {
  const k = (key ?? "").trim();
  if (!k) return "";
  if (k.length <= 10) return k;
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}

/**
 * 清洗 Key：手机键盘/输入法常会带入零宽字符、换行、空格，
 * 或把半角连字符替换成全角/破折号，导致 Key 校验失败。
 */
function normalizeKey(raw: string): string {
  return (raw ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\uFF0D]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

/** 输入框引用：用于挂载/失焦时把横向滚动复位，保证 sk- 前缀可见 */
const apiKeyInput = ref<HTMLInputElement | null>(null);
const speechKeyInput = ref<HTMLInputElement | null>(null);
function resetKeyScroll(el: HTMLInputElement | null) {
  if (el) el.scrollLeft = 0;
}

/** 切换明文/密文时把滚动复位，避免 iOS 上「显示」后看到的是末尾（前缀像被截断） */
function toggleShowKey() {
  showKey.value = !showKey.value;
  nextTick(() => resetKeyScroll(apiKeyInput.value));
}

function toggleShowSpeechKey() {
  showSpeechKey.value = !showSpeechKey.value;
  nextTick(() => resetKeyScroll(speechKeyInput.value));
}
// true = 走后端代理（不带 Key）；false = 自备 Key 浏览器直连
const useBackend = ref(!aiStore.apiKey);
const showKey = ref(false);
// 默认不持久化：关闭浏览器即失效
const rememberKey = ref(aiStore.rememberKey);

// 连接测试状态
const testingConnection = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);

// 备份导入
const importMode = ref<"merge" | "replace">("merge");
const importInput = ref<HTMLInputElement | null>(null);

// 确认弹窗
const showClearDialog = ref(false);
const showReplaceDialog = ref(false);
const pendingImport = ref<BackupPayload | null>(null);

onMounted(() => {
  docStore.loadAll();
  // iOS Safari 会把长值的输入框滚到末尾：重新进入时复位，保证前缀可见
  nextTick(() => {
    resetKeyScroll(apiKeyInput.value);
    resetKeyScroll(speechKeyInput.value);
  });
});

function saveAIConfig() {
  if (aiMode.value === "openai" && !baseUrl.value.trim()) {
    appStore.showToast("请填写服务地址", "error");
    return;
  }
  if (aiMode.value === "openai" && !useBackend.value && !apiKey.value.trim()) {
    appStore.showToast("自备 Key 模式需要填写 API Key", "error");
    return;
  }
  aiStore.saveConfig(
    {
      mode: aiMode.value,
      baseUrl: aiMode.value === "openai" ? baseUrl.value.trim() : undefined,
      model: model.value.trim() || undefined
    },
    // 走后端代理时不保存前端 Key（Key 在服务端）
    aiMode.value === "openai" && !useBackend.value ? normalizeKey(apiKey.value) : "",
    rememberKey.value
  );

  // 语音转写独立配置（留空表示跟随上面的 AI 配置）
  aiStore.saveSpeechConfig(
    { baseUrl: speechBaseUrl.value, model: speechModelName.value },
    normalizeKey(speechKey.value),
    speechRemember.value
  );
  apiKey.value = normalizeKey(apiKey.value);
  speechKey.value = normalizeKey(speechKey.value);
  const hasSpeech = !!(speechBaseUrl.value.trim() || speechKey.value.trim());
  appStore.showToast(
    aiMode.value === "mock"
      ? hasSpeech
        ? "语音转写配置已保存"
        : "已切换为演示模式"
      : hasSpeech
        ? "AI 配置与语音转写已保存"
        : "AI 配置已保存",
    "success"
  );
}

/** 导出全部资料为 Markdown（单文件，用分隔线拼接） */
function handleExportMarkdown() {
  if (docStore.documents.length === 0) {
    appStore.showToast("还没有资料可导出", "info");
    return;
  }
  const md = documentsToMarkdown(docStore.documents, (id) => docStore.categoryById(id)?.name);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  downloadText(md, `knowflow-docs-${stamp}.md`, "text/markdown;charset=utf-8");
  appStore.showToast(`已导出 ${docStore.documents.length} 份资料`, "success");
}

/** 导出全部卡片为 Anki 可导入的 CSV */
async function handleExportAnki() {
  const cards = await listFlashcards();
  if (cards.length === 0) {
    appStore.showToast("还没有学习卡片", "info");
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  downloadText(cardsToAnkiCsv(cards), `knowflow-cards-${stamp}.csv`, "text/csv;charset=utf-8");
  appStore.showToast(`已导出 ${cards.length} 张卡片`, "success");
}

function clearApiKey() {
  apiKey.value = "";
  aiStore.clearApiKey();
  appStore.showToast("密钥已清除", "success");
}

/**
 * 测试连接：用当前填写的地址/模型/Key 发一个最小请求，
 * 成功显示绿色提示，失败按原因显示红色提示。
 */
async function testConnection() {
  testResult.value = null;

  // 演示模式无需测试
  if (aiMode.value === "mock") {
    appStore.showToast("演示模式无需测试连接", "info");
    return;
  }
  if (!baseUrl.value.trim()) {
    testResult.value = { ok: false, message: "请先填写服务地址" };
    return;
  }
  if (!model.value.trim()) {
    testResult.value = { ok: false, message: "请先填写模型名" };
    return;
  }
  if (!useBackend.value && !apiKey.value.trim()) {
    testResult.value = { ok: false, message: "请先填写 API Key" };
    return;
  }

  testingConnection.value = true;
  try {
    const provider = new OpenAICompatibleProvider(
      baseUrl.value.trim(),
      model.value.trim(),
      useBackend.value ? undefined : apiKey.value.trim()
    );
    await provider.testConnection();
    testResult.value = { ok: true, message: "连接成功！AI 服务可用" };
  } catch (e: any) {
    testResult.value = {
      ok: false,
      message: e?.message ?? "连接失败，请检查配置"
    };
  } finally {
    testingConnection.value = false;
  }
}

async function handleExport() {
  const payload = await exportAll();
  downloadJSON(payload);
  appStore.showToast("已导出备份文件", "success");
}

function triggerImport() {
  importInput.value?.click();
}

async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const check = validateBackup(data);
    if (!check.valid) {
      appStore.showToast(check.error ?? "备份文件无效", "error");
      return;
    }
    pendingImport.value = data;
    if (importMode.value === "replace") {
      showReplaceDialog.value = true;
    } else {
      await doImport(data, "merge");
    }
  } catch {
    appStore.showToast("文件解析失败，请确认是有效的 JSON 备份", "error");
  } finally {
    input.value = "";
  }
}

async function doImport(data: BackupPayload, mode: "merge" | "replace") {
  await importAll(data, mode);
  await docStore.loadAll();
  appStore.showToast(mode === "replace" ? "已恢复备份（覆盖模式）" : "已合并导入", "success");
  pendingImport.value = null;
  showReplaceDialog.value = false;
}

async function clearAllData() {
  await db.transaction("rw", db.documents, db.categories, db.tasks, db.flashcards, db.aiJobs, async () => {
    await Promise.all([
      db.documents.clear(),
      db.categories.clear(),
      db.tasks.clear(),
      db.flashcards.clear(),
      db.aiJobs.clear()
    ]);
  });
  await docStore.loadAll();
  appStore.showToast("本地数据已清空", "success");
  showClearDialog.value = false;
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5">
      <h1 class="text-2xl font-bold text-slate-900">设置</h1>
    </div>

    <!-- 陪伴机器人 -->
    <div class="card p-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50">
            <CompanionAvatar :size="44" :level="level" :form="form" :avatar-url="companionStore.companion.avatarUrl" />
          </div>
          <div>
            <div class="font-semibold text-slate-800">陪伴机器人「小知」</div>
            <div class="text-sm text-slate-500">
              鼓励学习、解答软件用法，越用越亲近 · 当前{{ FORM_NAMES[form] }}
            </div>
          </div>
        </div>
        <!-- 开关 -->
        <button
          class="relative h-6 w-11 rounded-full transition"
          :class="companionStore.enabled ? 'bg-brand-600' : 'bg-slate-200'"
          @click="companionStore.toggle"
        >
          <span
            class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
            :class="companionStore.enabled ? 'left-[22px]' : 'left-0.5'"
          ></span>
        </button>
      </div>

      <!-- 头像自定义 -->
      <div class="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
        <button class="btn-secondary" @click="pickAvatar">
          <ImagePlus :size="16" /> 更换头像
        </button>
        <button
          v-if="companionStore.companion.avatarUrl"
          class="btn-ghost text-slate-400 hover:text-red-500"
          @click="companionStore.clearAvatar"
        >
          恢复默认形象
        </button>
        <span class="text-xs text-slate-400">支持上传图片，将作为机器人的形象</span>
        <input ref="avatarInput" type="file" accept="image/*" class="hidden" @change="onAvatarChange" />
      </div>
    </div>

    <!-- 小工具版说明 -->
    <div v-if="IS_MINITOOL" class="card mt-4 p-5">
      <div class="mb-2 flex items-center gap-2">
        <Info :size="18" class="text-amber-500" />
        <h2 class="font-semibold text-slate-800">小工具版说明</h2>
      </div>
      <ul class="list-inside list-disc space-y-1 text-sm text-slate-500">
        <li>小红书小工具运行在离线容器中，端内为「离线版」。</li>
        <li>可用：资料管理、全文搜索、任务清单、学习卡片、小知（本地规则对话）。</li>
        <li>不可用：联网 AI、文件导入（PDF/TXT）、备份导出，请在网页版使用。</li>
        <li>数据保存在小工具本地缓存中，卸载或清理后可能丢失。</li>
      </ul>
    </div>

    <!-- AI 配置 -->
    <div v-if="!IS_MINITOOL" class="card mt-4 p-5">
      <div class="mb-4 flex items-center gap-2">
        <Sparkles :size="18" class="text-brand-600" />
        <h2 class="font-semibold text-slate-800">AI 配置</h2>
      </div>

      <div class="mb-4 flex gap-2">
        <button
          class="rounded-full px-4 py-1.5 text-sm transition"
          :class="aiMode === 'mock' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'"
          @click="aiMode = 'mock'"
        >
          演示模式（无需密钥）
        </button>
        <button
          class="rounded-full px-4 py-1.5 text-sm transition"
          :class="aiMode === 'openai' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'"
          @click="aiMode = 'openai'"
        >
          接入真实模型
        </button>
      </div>

      <div v-if="aiMode === 'openai'" class="space-y-3">
        <!-- 使用方式选择 -->
        <div class="rounded-lg bg-slate-50 p-3">
          <div class="mb-2 text-xs font-medium text-slate-500">接入方式</div>
          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-full px-3 py-1 text-xs transition"
              :class="useBackend ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'"
              @click="useBackend = true"
            >
              后端代理（推荐，Key 在服务端）
            </button>
            <button
              class="rounded-full px-3 py-1 text-xs transition"
              :class="!useBackend ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'"
              @click="useBackend = false"
            >
              自备 Key（浏览器直连）
            </button>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm text-slate-600">
            {{ useBackend ? "后端代理地址" : "服务地址" }}
          </label>
          <input
            v-model="baseUrl"
            type="text"
            class="input-base"
            :placeholder="useBackend ? 'http://localhost:8022' : 'https://api.openai.com/v1'"
          />
          <p class="mt-1 text-xs text-slate-400">
            {{ useBackend ? "你的 FastAPI 后端地址" : "兼容 OpenAI 协议的服务地址，通常以 /v1 结尾" }}
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm text-slate-600">模型名</label>
          <input v-model="model" type="text" class="input-base" placeholder="gpt-4o-mini" />
        </div>

        <!-- 自备 Key 输入 -->
        <div v-if="!useBackend">
          <label class="mb-1 block text-sm text-slate-600">API Key</label>
          <div class="relative">
            <input
              ref="apiKeyInput"
              v-model="apiKey"
              :type="showKey ? 'text' : 'password'"
              class="input-base pr-16 font-mono"
              placeholder="sk-..."
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              autocomplete="new-password"
              @blur="resetKeyScroll(apiKeyInput)"
            />
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              @click="toggleShowKey"
            >
              {{ showKey ? "隐藏" : "显示" }}
            </button>
          </div>
          <p v-if="maskedApiKey" class="mt-1 text-xs text-emerald-600">
            已保存：<span class="font-mono">{{ maskedApiKey }}</span>
          </p>
          <p class="mt-1 flex items-start gap-1 text-xs text-amber-600">
            <Info :size="13" class="mt-0.5 shrink-0" />
            密钥不会上传到任何服务器。默认仅在本次会话有效，关闭浏览器后自动清除。
          </p>
          <label class="mt-2 flex cursor-pointer items-center gap-2 text-xs text-slate-500">
            <input v-model="rememberKey" type="checkbox" class="rounded border-slate-300" />
            在本设备记住密钥（关闭浏览器后仍保留，公共电脑请勿勾选）
          </label>
        </div>

        <p v-else class="flex items-start gap-1 text-xs text-slate-400">
          <Info :size="14" class="mt-0.5 shrink-0" />
          密钥保存在你的后端服务端 .env 中，浏览器完全接触不到，适合对外公开的产品。
        </p>
      </div>

        <!-- 语音转写独立配置 -->
        <div v-if="!IS_MINITOOL" class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-medium text-slate-700">语音转写（小知「按住说话」）</span>
            <div class="flex gap-3 text-xs">
              <button class="text-brand-600 hover:underline" @click="applySpeechPreset">硅基流动</button>
              <button class="text-slate-500 hover:underline" @click="applyWhisperPreset">OpenAI Whisper</button>
            </div>
          </div>
          <p class="mb-2 text-xs text-slate-400">
            留空则复用上面的 AI 配置。国内手机浏览器（百度/微信等）没有可用的语音识别，建议单独指向国内服务。
          </p>
          <div class="space-y-2">
            <input
              v-model="speechBaseUrl"
              type="text"
              class="input-base"
              placeholder="服务地址，如 https://api.siliconflow.cn/v1"
            />
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                v-model="speechModelName"
                type="text"
                class="input-base"
                placeholder="模型，如 FunAudioLLM/SenseVoiceSmall"
              />
              <div class="relative">
                <input
                  ref="speechKeyInput"
                  v-model="speechKey"
                  :type="showSpeechKey ? 'text' : 'password'"
                  class="input-base pr-12 font-mono"
                  placeholder="语音服务 Key（留空复用主 Key）"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  autocomplete="new-password"
                  @blur="resetKeyScroll(speechKeyInput)"
                />
                <button
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                  @click="toggleShowSpeechKey"
                >
                  {{ showSpeechKey ? "隐藏" : "显示" }}
                </button>
              </div>
            </div>
            <p v-if="maskedSpeechKey" class="text-xs text-emerald-600">
              语音 Key 已保存：<span class="font-mono">{{ maskedSpeechKey }}</span>
            </p>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
              <input v-model="speechRemember" type="checkbox" class="rounded border-slate-300" />
              记住语音 Key（否则关闭浏览器后失效）
            </label>
          </div>
        </div>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button v-if="!useBackend && aiStore.hasKey" class="btn-ghost text-slate-400 hover:text-red-500" @click="clearApiKey">
          清除密钥
        </button>
        <button class="btn-secondary" :disabled="testingConnection" @click="testConnection">
          <Loader2 v-if="testingConnection" :size="14" class="mr-1 animate-spin" />
          {{ testingConnection ? "测试中…" : "测试连接" }}
        </button>
        <button class="btn-primary" @click="saveAIConfig">保存配置</button>
      </div>

      <!-- 连接测试结果 -->
      <div v-if="testResult" class="mt-3">
        <div
          class="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
          :class="testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'"
        >
          <CheckCircle2 v-if="testResult.ok" :size="16" class="mt-0.5 shrink-0" />
          <AlertCircle v-else :size="16" class="mt-0.5 shrink-0" />
          <span>{{ testResult.message }}</span>
        </div>
      </div>
    </div>

    <!-- 外观 -->
    <div v-if="!IS_MINITOOL" class="card mt-4 p-5">
      <div class="mb-3 flex items-center gap-2">
        <Sun :size="18" class="text-brand-600" />
        <h2 class="font-semibold text-slate-800">外观</h2>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="t in themeOptions"
          :key="t.value"
          class="rounded-full px-3 py-1.5 text-xs transition"
          :class="appStore.theme === t.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="appStore.setTheme(t.value)"
        >
          {{ t.label }}
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-400">「跟随系统」会随手机/电脑的深色设置自动切换。</p>
    </div>

    <!-- 数据备份 -->
    <div v-if="!IS_MINITOOL" class="card mt-4 p-5">
      <div class="mb-4 flex items-center gap-2">
        <Download :size="18" class="text-brand-600" />
        <h2 class="font-semibold text-slate-800">数据备份与恢复</h2>
      </div>
      <p class="mb-4 text-sm text-slate-500">
        导出所有资料为 JSON 文件，可随时重新导入恢复。导入时支持「合并」或「覆盖」两种模式。
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-secondary" @click="handleExport">
          <Download :size="16" /> 导出备份
        </button>
        <button class="btn-secondary" @click="handleExportMarkdown">
          <FileText :size="16" /> 导出 Markdown
        </button>
        <button class="btn-secondary" @click="handleExportAnki">
          <Layers :size="16" /> 导出 Anki CSV
        </button>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" @click="triggerImport">
            <Upload :size="16" /> 导入备份
          </button>
          <select v-model="importMode" class="input-base w-24">
            <option value="merge">合并</option>
            <option value="replace">覆盖</option>
          </select>
        </div>
        <input ref="importInput" type="file" accept=".json" class="hidden" @change="handleImportFile" />
      </div>
    </div>

    <!-- 隐私说明 -->
    <div class="card mt-4 p-5">
      <div class="mb-2 flex items-center gap-2">
        <ShieldCheck :size="18" class="text-emerald-600" />
        <h2 class="font-semibold text-slate-800">隐私说明</h2>
      </div>
      <ul class="list-inside list-disc space-y-1 text-sm text-slate-500">
        <li v-if="IS_MINITOOL">你的资料保存在小工具本地缓存中，不会上传到服务器。</li>
        <li v-else>你的资料默认保存在浏览器本地（IndexedDB），不会上传到服务器。</li>
        <li v-if="!IS_MINITOOL">使用 AI 功能时，会先告知将发送的内容，且需你主动操作。</li>
        <li>本地存储不等于加密保险箱，请勿在资料中存放敏感信息。</li>
      </ul>
    </div>

    <!-- 危险区 -->
    <div class="card mt-4 border-red-100 p-5">
      <div class="mb-2 flex items-center gap-2">
        <Trash2 :size="18" class="text-red-500" />
        <h2 class="font-semibold text-red-600">清除本地数据</h2>
      </div>
      <p class="mb-4 text-sm text-slate-500">删除浏览器中保存的所有资料、任务和卡片，此操作不可恢复。建议先导出备份。</p>
      <button class="btn-secondary border-red-200 text-red-600 hover:bg-red-50" @click="showClearDialog = true">
        清除所有数据
      </button>
    </div>

    <!-- 弹窗 -->
    <ConfirmDialog
      :visible="showClearDialog"
      title="清除所有数据"
      message="将删除所有本地资料、任务和卡片，此操作不可恢复。确定继续吗？"
      confirm-text="确认清除"
      danger
      @confirm="clearAllData"
      @cancel="showClearDialog = false"
    />
    <ConfirmDialog
      :visible="showReplaceDialog"
      title="覆盖导入"
      message="覆盖模式将清空当前所有数据并替换为备份内容，确定继续吗？"
      confirm-text="确认覆盖"
      danger
      @confirm="pendingImport && doImport(pendingImport, 'replace')"
      @cancel="showReplaceDialog = false"
    />
  </div>
</template>
