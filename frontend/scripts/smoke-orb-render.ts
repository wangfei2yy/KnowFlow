/**
 * 渲染层冒烟：用一个假的 2D context 跑几帧，确认 draw() 不依赖真实浏览器、
 * 也不会因为状态缺字段而崩。真正的像素效果仍要在浏览器里看。
 */
import { createOrbGame, startOrb, stepOrb, type OrbState } from "@/games/orb/engine";
import { createOrbRenderer, tierName } from "@/games/orb/render";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

/** 记录调用情况的假 context */
function fakeCtx() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const gradient = { addColorStop: () => bump("addColorStop") };
  const ctx = {
    setTransform: () => bump("setTransform"),
    fillRect: () => bump("fillRect"),
    save: () => bump("save"),
    restore: () => bump("restore"),
    translate: () => bump("translate"),
    beginPath: () => bump("beginPath"),
    arc: () => bump("arc"),
    fill: () => bump("fill"),
    stroke: () => bump("stroke"),
    fillText: () => bump("fillText"),
    createRadialGradient: () => {
      bump("createRadialGradient");
      return gradient;
    },
    measureText: (t: string) => ({ width: String(t).length * 9 }),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: "center",
    textBaseline: "middle"
  };
  return { ctx, calls };
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

renderer.clearParticles();
renderer.destroy();

const total = Object.values(calls).reduce((a, b) => a + b, 0);
ok(total > 200, `应该发生了大量绘制调用，实际 ${total}`);
console.log("绘制调用统计:", calls);
console.log("\n✅ 渲染层冒烟通过（画布 2x、6 级背景、抖动、粒子、空场、零尺寸）");
