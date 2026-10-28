/**
 * 小工具容器替身：端内既无麦克风权限也无网络，语音输入整体不可用。
 * 该实现保证产物中不出现 getUserMedia / MediaRecorder / 音频上传代码。
 */
export function canRecordAudio(): boolean {
  return false;
}

export interface WhisperSession {
  stop(): Promise<string>;
  abort(): void;
}

export async function startWhisperSession(): Promise<WhisperSession> {
  throw new Error("当前环境不支持语音输入");
}
