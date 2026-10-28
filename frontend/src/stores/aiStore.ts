import { defineStore } from "pinia";
import { createProvider, type AIProviderConfig } from "@/services/ai";
import type { AIProvider } from "@/services/ai/AIProvider";

/** 非敏感配置（模式/地址/模型）持久化 */
const CONFIG_KEY = "knowflow.ai.config";
/** API Key 单独存放，默认只存会话级 */
const KEY_SESSION = "knowflow.ai.key.session";
const KEY_PERSIST = "knowflow.ai.key.persist";

function loadConfig(): AIProviderConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw) as AIProviderConfig;
      // 安全：兼容历史版本，配置里若残留 apiKey，迁移到独立存储后删除
      if (cfg.apiKey) {
        try {
          sessionStorage.setItem(KEY_SESSION, cfg.apiKey);
        } catch {
          /* ignore */
        }
        delete cfg.apiKey;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      }
      return cfg;
    }
  } catch {
    /* ignore */
  }
  return { mode: "mock" };
}

/** 读取 Key：优先会话级，其次持久化 */
function loadApiKey(): string {
  try {
    return (
      sessionStorage.getItem(KEY_SESSION) ||
      localStorage.getItem(KEY_PERSIST) ||
      ""
    );
  } catch {
    return "";
  }
}

/**
 * 语音转写配置（与聊天模型独立）。
 * 现实约束：国内浏览器（百度/微信等）没有可用的 Web Speech API，
 * 只能走「录音上传转写」；而聊天常用的 OpenAI 国内不可直连，
 * 因此允许语音单独指向国内可直连的兼容服务（如硅基流动 SenseVoice）。
 */
const SPEECH_CONFIG_KEY = "knowflow.ai.speech.config";
const SPEECH_KEY_SESSION = "knowflow.ai.speech.key.session";
const SPEECH_KEY_PERSIST = "knowflow.ai.speech.key.persist";

export interface SpeechConfig {
  /** 兼容 OpenAI 的服务地址，如 https://api.siliconflow.cn/v1 */
  baseUrl?: string;
  /** 转写模型，如 FunAudioLLM/SenseVoiceSmall */
  model?: string;
}

function loadSpeechConfig(): SpeechConfig {
  try {
    const raw = localStorage.getItem(SPEECH_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as SpeechConfig;
  } catch {
    /* ignore */
  }
  return {};
}

function loadSpeechKey(): string {
  try {
    return sessionStorage.getItem(SPEECH_KEY_SESSION) || localStorage.getItem(SPEECH_KEY_PERSIST) || "";
  } catch {
    return "";
  }
}

export const useAIStore = defineStore("ai", {
  state: () => ({
    config: loadConfig() as AIProviderConfig,
    apiKey: loadApiKey(),
    rememberKey: false, // 是否持久化到本设备
    /** 语音转写独立配置（留空则跟随主 AI 配置） */
    speech: loadSpeechConfig(),
    speechKey: loadSpeechKey(),
    speechRemember: false
  }),
  getters: {
    provider(state): AIProvider {
      // 每次取 provider 时合并当前 Key，保证改配置后立即生效
      const cfg: AIProviderConfig = { ...state.config, apiKey: state.apiKey || undefined };
      return createProvider(cfg);
    },
    isMock: (state) => state.config.mode === "mock",
    hasKey: (state) => !!state.apiKey,
    /**
     * 语音转写的实际生效配置：语音独立配置优先，缺省回落主 AI 配置。
     */
    speechRuntime(state): { baseUrl?: string; apiKey?: string; model?: string } {
      return {
        baseUrl: state.speech.baseUrl?.trim() || state.config.baseUrl,
        apiKey: state.speechKey || state.apiKey || undefined,
        model: state.speech.model?.trim() || state.config.speechModel
      };
    },
    /** 语音转写是否可用（地址 + Key 都有） */
    speechReady(): boolean {
      const rt = this.speechRuntime;
      return !!rt.baseUrl && !!rt.apiKey;
    }
  },
  actions: {
    /**
     * 保存配置。
     * @param config 非敏感配置
     * @param apiKey 用户自备 Key（空字符串表示清除）
     * @param remember 是否持久化 Key 到本设备
     */
    saveConfig(config: AIProviderConfig, apiKey?: string, remember = false) {
      // 1. 配置永远不含 Key
      const safeConfig: AIProviderConfig = {
        mode: config.mode,
        baseUrl: config.baseUrl,
        model: config.model,
        speechModel: config.speechModel
      };
      this.config = safeConfig;
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(safeConfig));
      } catch {
        /* ignore */
      }

      // 2. Key 单独处理
      if (apiKey !== undefined) {
        this.setApiKey(apiKey, remember);
      }
      this.rememberKey = remember;
    },

    setApiKey(key: string, remember = false) {
      this.apiKey = key;
      this.rememberKey = remember;
      try {
        // 默认仅会话级：关闭浏览器即失效
        sessionStorage.setItem(KEY_SESSION, key);
        if (remember && key) {
          localStorage.setItem(KEY_PERSIST, key);
        } else {
          localStorage.removeItem(KEY_PERSIST);
        }
        if (!key) {
          sessionStorage.removeItem(KEY_SESSION);
          localStorage.removeItem(KEY_PERSIST);
        }
      } catch {
        /* ignore */
      }
    },

    clearApiKey() {
      this.setApiKey("", false);
    },

    /**
     * 保存语音转写独立配置。
     * @param config 服务地址与模型（都留空表示跟随主 AI 配置）
     * @param key 语音专用 Key（留空表示复用主 Key）
     * @param remember 是否持久化 Key 到本设备
     */
    saveSpeechConfig(config: SpeechConfig, key: string, remember = false) {
      const safe: SpeechConfig = {
        baseUrl: config.baseUrl?.trim() || undefined,
        model: config.model?.trim() || undefined
      };
      this.speech = safe;
      try {
        localStorage.setItem(SPEECH_CONFIG_KEY, JSON.stringify(safe));
      } catch {
        /* ignore */
      }
      this.speechKey = key;
      this.speechRemember = remember;
      try {
        if (key) {
          sessionStorage.setItem(SPEECH_KEY_SESSION, key);
          if (remember) localStorage.setItem(SPEECH_KEY_PERSIST, key);
          else localStorage.removeItem(SPEECH_KEY_PERSIST);
        } else {
          sessionStorage.removeItem(SPEECH_KEY_SESSION);
          localStorage.removeItem(SPEECH_KEY_PERSIST);
        }
      } catch {
        /* ignore */
      }
    }
  }
});
