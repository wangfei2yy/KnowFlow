/**
 * 语音转写：调用 OpenAI 兼容的 `/audio/transcriptions` 接口（Whisper 协议）。
 *
 * 用途：浏览器自带语音识别不可用（如 Chrome 语音服务在国内网络不可达）时，
 * 用用户自备的 AI Key 把录音上传转文字。仅在网页版使用，
 * 小工具构建会被替身模块替换（容器禁止联网，麦克风入口也已隐藏）。
 */
export interface TranscribeConfig {
  baseUrl?: string;
  /** 用户自备 Key（BYOK）；无 Key 时无法转写 */
  apiKey?: string;
  /** 转写模型，默认 whisper-1；部分服务商为 FunAudioLLM/SenseVoiceSmall 等 */
  model?: string;
}

/** 把录音 Blob 转成文字，失败时抛出带中文原因的 Error */
export async function transcribeAudio(blob: Blob, cfg: TranscribeConfig): Promise<string> {
  const base = (cfg.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("未配置 AI 服务地址，无法使用语音转写");
  }
  if (!cfg.apiKey) {
    throw new Error("未配置 API Key，无法使用语音转写");
  }

  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "m4a" : "webm";
  form.append("file", blob, `voice.${ext}`);
  form.append("model", cfg.model?.trim() || "whisper-1");
  form.append("language", "zh");
  form.append("response_format", "json");

  let res: Response;
  try {
    res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form
    });
  } catch {
    throw new Error("语音转写请求失败，请检查网络或服务地址");
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("语音转写鉴权失败，请检查 API Key");
    }
    if (res.status === 404) {
      throw new Error("当前 AI 服务不支持语音转写（无 /audio/transcriptions 接口），可改用浏览器语音输入或在设置中更换服务商");
    }
    if (res.status === 400) {
      throw new Error("语音转写参数被拒绝，请检查「语音转写模型」是否填写正确");
    }
    if (res.status === 429) {
      throw new Error("语音转写额度不足或请求过于频繁");
    }
    throw new Error(`语音转写失败（${res.status}）`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
