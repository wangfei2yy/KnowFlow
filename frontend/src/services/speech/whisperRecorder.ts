import { transcribeAudio, type TranscribeConfig } from "./transcribe";

/** 一次录音会话：stop 停止并转写，abort 丢弃 */
export interface WhisperSession {
  stop(): Promise<string>;
  abort(): void;
}

/**
 * 开始录音（用户自备 Key 的转写通道）。
 * 录完调用 stop() 上传 `/audio/transcriptions` 拿到文字。
 */
export async function startWhisperSession(getConfig: () => TranscribeConfig): Promise<WhisperSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持录音，请更换浏览器");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("需要麦克风权限才能语音输入，请在浏览器地址栏允许麦克风");
  }

  const preferWebm =
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm");
  const recorder = preferWebm
    ? new MediaRecorder(stream, { mimeType: "audio/webm" })
    : new MediaRecorder(stream);
  const mimeType = recorder.mimeType || "audio/webm";
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    abort() {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
      release();
    },
    async stop() {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
      release();

      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 1500) return "";
      return await transcribeAudio(blob, getConfig());
    }
  };
}
