import { createPinia, setActivePinia } from "pinia";
import { useVoiceInput } from "@/composables/useVoiceInput";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
const errors: string[] = [];

// 假的原生识别：可控地吐结果
class FakeRec {
  static last: FakeRec | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() { FakeRec.last = this; }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
  emit(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] as any });
    (this.onresult as any).__final = isFinal;
  }
}
(window as any).SpeechRecognition = FakeRec;

async function main() {
  setActivePinia(createPinia());

  // 1) 基础能力判断（未配 Key → 浏览器识别通道）
  const v1 = useVoiceInput({ onText: (t) => results.push(t), onError: (m) => errors.push(m) });
  console.log("mode:", v1.mode.value, "| available:", v1.available.value);

  // 2) 按住 → 识别中 → 松手
  await v1.start();
  console.log("after start:", v1.status.value);
  const rec = FakeRec.last!;
  rec.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: "把 SQL 笔记做成卡片" }, isFinal: true, length: 1 }] as any });
  console.log("liveText:", v1.liveText.value, "| hint:", v1.hint.value);
  await v1.finish(false);
  console.log("after finish:", v1.status.value, "| onText:", results);

  // 3) 取消路径：上滑后松手不应产生文本
  await v1.start();
  v1.setSlide(80);
  console.log("cancelArmed:", v1.cancelArmed.value, "| hint:", v1.hint.value);
  await v1.finish(true);
  console.log("after cancel:", v1.status.value, "| onText total:", results.length);

  // 4) 说话太短：没有识别结果 → 提示
  await v1.start();
  await v1.finish(false);
  console.log("short-utterance errors:", errors);

  // 5) 断言
  if (v1.mode.value !== "browser") throw new Error("通道判断错误");
  if (results.length !== 1) throw new Error(`期望 1 条文本，实际 ${results.length}`);
  if (results[0] !== "把 SQL 笔记做成卡片") throw new Error("文本回传错误: " + results[0]);
  if (errors.length !== 1) throw new Error(`期望 1 条提示，实际 ${errors.length}`);
  console.log("VOICE SMOKE PASS");
  process.exit(0);
}
main().catch((e) => { console.error("VOICE SMOKE FAIL:", e); process.exit(1); });
