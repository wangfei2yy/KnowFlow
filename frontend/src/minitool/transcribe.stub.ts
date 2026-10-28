/**
 * 小工具容器替身：容器禁止联网，语音转写在端内不可用。
 * 该实现保证产物中不出现任何 fetch / FormData 上传代码。
 */
export interface TranscribeConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export async function transcribeAudio(_blob: Blob, _cfg: TranscribeConfig): Promise<string> {
  throw new Error("当前环境不支持语音转写");
}
