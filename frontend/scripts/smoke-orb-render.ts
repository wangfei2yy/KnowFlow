/**
 * 渲染层冒烟：用一个假的 2D context 跑几帧，确认 draw() 不依赖真实浏览器、
 * 也不会因为状态缺字段而崩，并锁住「球上的英文单词看得清」这条底线。
 * 真正的像素效果仍要在浏览器里看。
 */
import { createOrbGame, startOrb, stepOrb, ORB, type OrbState } from "@/games/orb/engine";
import { createOrbRenderer, tierName, layoutWordWithMeasure } from "@/games/orb/render";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

interface TextCall {
  text: string;
  size: number;
}

/** 记录调用情况的假 context：measureText 按当前字号估算宽度，模拟真实排版 */
function fakeCtx() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const gradient = { addColorStop: () => bump("addColorStop") };
  const texts: TextCall[] = [];
  const arcs: number[] = [];
  let font = "";

  const sizeOf = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(font);
    return m ? Number(m[1]) : 16;
  };

  const ctx = {
    setTransform: () => bump("setTransform"),
    fillRect: () => bump("fillRect"),
    save: () => bump("save"),
    restore: () => bump("restore"),
    translate: () => bump("translate"),
    beginPath: () => bump("beginPath"),
    arc: (_x: number, _y: number, r: number) => {
      bump("arc");
      arcs.push(r);
    },
    fill: () => bump("fill"),
    stroke: () => bump("stroke"),
    fillText: (t: string) => {
      bump("fillText");
      texts.push({ text: String(t), size: sizeOf() });
    },
    createRadialGradient: () => {
      bump("createRadialGradient");
      return gradient;
    },
    // 拉丁字母约 0.55em 宽，够用
    measureText: (t: string) => ({ width: String(t).length * sizeOf() * 0.55 }),
    get font() {
      return font;
    },
    set font(v: string) {
      font = v;
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: "center",
    textBaseline: "middle"
  };
  return { ctx, calls, texts, arcs };
}

const built = fakeCtx();
const calls = built.calls;

const canvas = {
  width: 0,
  height: 0,
  style: {} as Record<string, string>,
  getContext: () => built.ctx
};

const renderer = createOrbRenderer(canvas as unknown as HTMLCanvasElement);
// node 里没有 devicePixelRatio，模拟一台 2 倍屏手机
(globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio = 2;
renderer.resize(390, 520);
ok(canvas.width === 780 && canvas.height === 1040, `DPR=2 时画布像素应是 2 倍，实际 ${canvas.width}x${canvas.height}`);
ok(canvas.style.width === "390px", "CSS 宽度要写回元素");

const words = Array.from({ length: 20 }, (_, i) => ({ w: `word${i}`, m: `释义${i}` }));
let state: OrbState = startOrb(createOrbGame({ words, seed: 42 }));

// ready 阶段也能画（首帧就在 ready 上）
renderer.draw(state, 1 / 60);
ok((calls.fillRect ?? 0) >= 1, "应该铺了背景");
ok((calls.arc ?? 0) > 0, "应该画了球");
ok((calls.fillText ?? 0) > 0, "应该画了文字（球上的词 / 中文短义）");

// 连画 60 帧
for (let i = 0; i < 60; i++) {
  state = stepOrb(state, 1 / 60, { x: 0.6, y: 0.2 });
  renderer.draw(state, 1 / 60);
}

// 层级切换（大球背景 + 深色系）不应崩
state = { ...state, player: { ...state.player, r: 700 }, tier: 6 };
renderer.draw(state, 1 / 60);
ok(tierName(6) === "太阳系", "层级名应对应太阳系");

// 抖动 + 粒子
state = { ...state, shake: 1 };
renderer.burst(100, 120, "#34d399", 10);
renderer.draw(state, 1 / 60);
renderer.draw(state, 1 / 60);

// 结算：场上没球了也要能画
state = { ...state, foods: [], phase: "over", label: "" };
renderer.draw(state, 1 / 60);

// 零尺寸（元素还没布局好）不应崩
renderer.resize(0, 0);
renderer.draw(state, 1 / 60);

const total = Object.values(calls).reduce((a, b) => a + b, 0);
ok(total > 200, `应该发生了大量绘制调用，实际 ${total}`);
console.log("绘制调用统计:", calls);

// ---------------- 文字可读性（用户反馈过「球太小、字看不清」）----------------
// 直接测排版纯函数：不依赖随机词池，行为确定。
// measure 模拟「拉丁字母约 0.55em 宽」，和真实 canvas 同量级。
const measure = (t: string, size: number) => t.length * size * 0.55;

// 短词 + 宽裕空间 → 单行、字号大
const a = layoutWordWithMeasure("abandon", 200, 20, 9, measure);
ok(a.lines.length === 1 && a.lines[0] === "abandon", "短词应整词单行显示");
ok(a.size >= 12, `短词字号应 ≥12px，实际 ${a.size}`);

// 长词 + 挤空间 → 拆成两行，且字号不低于下限
const b = layoutWordWithMeasure("extraordinarily", 70, 20, 9, measure);
ok(b.lines.length === 2, `长词应拆两行，实际 ${b.lines.join("/")}`);
ok(b.lines.join("") === "extraordinarily", "拆行不能丢字母");
ok(b.size >= 9, `长词字号应 ≥9px，实际 ${b.size}`);

// 极窄空间 → 兜底截断加省略号
const c = layoutWordWithMeasure("extraordinarily", 30, 20, 9, measure);
ok(c.lines[0].endsWith("…"), "放不下应截断加省略号");
ok(c.size === 9, "兜底应停在下限字号");

console.log(`文字可读性：短词 ${a.size}px 单行；长词拆 ${b.lines.length} 行 @${b.size}px；极窄截断 ${c.lines[0]}`);

// 球数量与半径：10 个，别一屏塞满
ok(ORB.foodCount === 10, `场上食物球应为 10 个，实际 ${ORB.foodCount}`);
ok(ORB.foodR >= 26, `食物球世界半径应 ≥26，实际 ${ORB.foodR}`);

renderer.clearParticles();
renderer.destroy();

console.log("\n✅ 渲染层冒烟通过（2x 画布 / 6 级背景 / 抖动 / 粒子 / 空场 / 零尺寸 / 文字可读性）");
