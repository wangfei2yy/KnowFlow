import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import { useAIStore } from "@/stores/aiStore";
import { IS_MINITOOL, detectInAppBrowser } from "@/utils/runtime";
import { startWhisperSession, type WhisperSession } from "@/services/speech/whisperRecorder";

export type VoiceStatus = "idle" | "listening" | "transcribing";
/** 语音输入通道：whisper = 自备 Key 录音上传转写；browser = 浏览器原生识别 */
export type VoiceMode = "whisper" | "browser" | "none";

interface VoiceOptions {
  /** 转写完成，拿到最终文本 */
  onText: (text: string) => void;
  /** 出错或需要提示用户 */
  onError?: (message: string) => void;
}

/** 最长录音时长（毫秒），避免误按一直录 */
const MAX_DURATION_MS = 60_000;
/** 上滑取消的位移阈值（px） */
const CANCEL_SLIDE_PX = 56;

/** 读取浏览器原生语音识别构造器（Chrome / Edge / Safari） */
function getSpeechCtor(): (new () => any) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => any) | undefined;
  return ctor ?? null;
}

/**
 * 语音输入状态机（微信式「按住说话」）：
 * idle → listening →（松手）→ transcribing → idle，结果通过 onText 回传。
 */
export function useVoiceInput(options: VoiceOptions) {
  const aiStore = useAIStore();

  const status = ref<VoiceStatus>("idle");
  const seconds = ref(0);
  /** 上滑到取消区域 */
  const cancelArmed = ref(false);
  /** 浏览器识别过程中的实时文字 */
  const liveText = ref("");

  const hasBrowserSTT = !!getSpeechCtor();
  /** 是否在第三方/端内浏览器中（百度、微信、QQ、UC 等） */
  const inAppBrowser = detectInAppBrowser();

  /** 是否单独配置了语音服务（地址或专用 Key） */
  const hasSpeechOverride = computed(
    () => !!aiStore.speech.baseUrl?.trim() || !!aiStore.speechKey
  );

  /**
   * 通道选择：
   * - 小工具容器内一律不可用（无麦克风权限、无网络）
   * - 单独配了语音服务：优先录音上传转写（国内可直连，最可靠）
   * - 浏览器支持原生识别：用它（免费、免 Key）
   * - 否则若主 AI 配置可用于转写：兜底走转写
   */
  const mode = computed<VoiceMode>(() => {
    if (IS_MINITOOL) return "none";
    if (hasSpeechOverride.value && aiStore.speechReady) return "whisper";
    if (hasBrowserSTT) return "browser";
    if (aiStore.speechReady) return "whisper";
    return "none";
  });

  const available = computed(() => mode.value !== "none");

  /** 是否具备录音能力（有无 MediaRecorder/getUserMedia） */
  const canRecord = computed(
    () =>
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
  );

  /** 按钮是否显示：除小工具容器外始终显示，不可用时点击给出引导（隐藏按钮会让用户以为功能不存在） */
  const visible = computed(() => !IS_MINITOOL);

  /** 不可用时的具体原因，用于引导用户 */
  const unavailableHint = computed(() => {
    if (!canRecord.value) {
      return "当前浏览器不支持录音，建议用手机自带浏览器 / Chrome / Safari 打开，或在设置里配置语音转写服务";
    }
    if (inAppBrowser) {
      return `${inAppBrowser.name}没有可用的网页语音识别：${inAppBrowser.tip}；也可在设置里配置语音转写服务`;
    }
    return "当前浏览器不支持语音识别，建议用手机自带浏览器 / Chrome / Safari 打开，或在设置里配置语音转写服务（推荐硅基流动 SenseVoice）";
  });

  // ---------- 内部资源 ----------
  let recognition: any = null;
  let whisper: WhisperSession | null = null;
  let timer: number | undefined;
  let startedAt = 0;
  let lastBrowserError = "";
  /** 正在启动（申请麦克风权限等异步阶段） */
  let starting = false;
  /** 启动未完成时的松手请求：true = 取消，false = 发送 */
  let pendingStop: boolean | null = null;

  function stopTimer() {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function abortRecognition() {
    if (!recognition) return;
    try {
      recognition.abort();
    } catch {
      /* ignore */
    }
    recognition = null;
  }

  // ---------- 浏览器原生识别通道 ----------
  async function startBrowser(): Promise<void> {
    const Ctor = getSpeechCtor();
    if (!Ctor) throw new Error("当前浏览器不支持语音识别");
    lastBrowserError = "";
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += result[0]?.transcript ?? "";
        else interim += result[0]?.transcript ?? "";
      }
      liveText.value = (finalText + interim).trim();
    };
    rec.onerror = (e: any) => {
      lastBrowserError = String(e?.error ?? "");
    };
    recognition = rec;
    rec.start();
    // 识别服务启动失败不阻塞交互，靠 onerror 兜底提示
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  function stopBrowser(): Promise<string> {
    return new Promise((resolve) => {
      const rec = recognition;
      if (!rec) {
        resolve(liveText.value.trim());
        return;
      }
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        recognition = null;
        resolve(liveText.value.trim());
      };
      rec.onend = settle;
      rec.onerror = () => settle();
      try {
        rec.stop();
      } catch {
        settle();
      }
      // 部分浏览器 stop 后不触发 end，加超时兜底
      setTimeout(settle, 1200);
    });
  }

  // ---------- 对外动作 ----------
  async function start() {
    if (status.value !== "idle" || !available.value) return;
    cancelArmed.value = false;
    liveText.value = "";
    seconds.value = 0;
    startedAt = Date.now();
    status.value = "listening";
    starting = true;

    timer = window.setInterval(() => {
      seconds.value = (Date.now() - startedAt) / 1000;
      if (Date.now() - startedAt > MAX_DURATION_MS) {
        void finish(false);
      }
    }, 100);

    try {
      if (mode.value === "whisper") {
        const rt = aiStore.speechRuntime;
        whisper = await startWhisperSession(() => ({
          baseUrl: rt.baseUrl,
          apiKey: rt.apiKey,
          model: rt.model
        }));
      } else {
        await startBrowser();
      }
    } catch (e) {
      stopTimer();
      whisper = null;
      status.value = "idle";
      starting = false;
      pendingStop = null;
      options.onError?.(e instanceof Error ? e.message : "语音输入启动失败");
      return;
    }

    starting = false;
    // 启动期间用户已松手：按松手时的意图立即结束
    if (pendingStop !== null) {
      const cancelled = pendingStop;
      pendingStop = null;
      void finish(cancelled);
    }
  }

  /** 上滑位移（px），超过阈值进入取消态 */
  function setSlide(distance: number) {
    cancelArmed.value = distance > CANCEL_SLIDE_PX;
  }

  /** 结束录音：cancelled=true 丢弃；否则转写并回调文本 */
  async function finish(cancelled = false) {
    if (status.value !== "listening") return;
    // 麦克风权限弹窗中松手：记下意图，等 start 完成后处理
    if (starting) {
      pendingStop = cancelled;
      return;
    }
    stopTimer();
    const durationMs = Date.now() - startedAt;

    if (cancelled) {
      abortRecognition();
      whisper?.abort();
      whisper = null;
      status.value = "idle";
      cancelArmed.value = false;
      liveText.value = "";
      return;
    }

    try {
      let text = "";
      if (mode.value === "whisper") {
        status.value = "transcribing";
        const session = whisper;
        whisper = null;
        text = session ? (await session.stop()).trim() : "";
      } else {
        text = (await stopBrowser()).trim();
      }

      if (!text) {
        if (durationMs < 800) options.onError?.("说话时间太短，按住多说一会儿再说");
        else if (lastBrowserError === "network" || lastBrowserError === "service-not-allowed")
          options.onError?.(
            inAppBrowser
              ? `${inAppBrowser.name}的语音服务不可用：${inAppBrowser.tip}`
              : "浏览器语音服务不可用（该服务需访问境外服务器），建议换用手机自带浏览器，或在设置里配置语音转写服务"
          );
        else if (lastBrowserError === "not-allowed")
          options.onError?.("麦克风权限被拒绝，请在浏览器地址栏允许后重试");
        else options.onError?.("没听清，再说一遍试试～");
        return;
      }
      options.onText(text);
    } catch (e) {
      whisper = null;
      options.onError?.(e instanceof Error ? e.message : "语音转文字失败");
    } finally {
      status.value = "idle";
      cancelArmed.value = false;
      liveText.value = "";
    }
  }

  onBeforeUnmount(() => {
    stopTimer();
    abortRecognition();
    whisper?.abort();
    whisper = null;
  });

  const hint = computed(() => {
    if (status.value === "transcribing") return "正在转成文字…";
    if (cancelArmed.value) return "松开手指，取消发送";
    if (liveText.value) return liveText.value;
    return "松开发送，上滑取消";
  });

  return {
    status: status as Ref<VoiceStatus>,
    seconds,
    cancelArmed,
    liveText,
    hint,
    mode,
    available,
    visible,
    canRecord,
    unavailableHint,
    start,
    finish,
    setSlide
  };
}
