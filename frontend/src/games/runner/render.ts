/**
 * 单词跑酷 · Canvas 渲染。
 *
 * 视角是「侧视跑道」：玩家固定在最左侧，门从右侧过来。
 * 引擎里的 x 是世界单位（0 = 玩家，900 = 生成点），这里只负责把它映射到屏幕，
 * 并且保证换到任何屏幕宽度，门都能从右边缘进来。
 *
 * 全部在屏幕坐标里画：不 ctx.scale，文字大小才不会随着屏幕宽度忽大忽小。
 */
import { RUNNER, type RunnerState } from "./engine";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/** 玩家在屏幕上的横向位置（比例） */
const PLAYER_X_RATIO = 0.2;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: string;
}

export interface RunnerRenderer {
  resize(width: number, height: number): void;
  draw(state: RunnerState, dt: number): void;
  burst(x: number, y: number, color: string, count?: number): void;
  destroy(): void;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function createRunnerRenderer(canvas: HTMLCanvasElement): RunnerRenderer {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas 2D");
  const ctx = context;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let time = 0;
  let particles: Particle[] = [];

  function resize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    const ratio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    dpr = Math.min(2, ratio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function burst(x: number, y: number, color: string, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const speed = 70 + Math.random() * 120;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45,
        maxLife: 0.45,
        r: 2 + Math.random() * 2.5,
        color
      });
    }
    if (particles.length > 14) particles = particles.slice(-14);
  }

  function laneY(lane: number): number {
    const laneH = height / RUNNER.lanes;
    return laneH * (lane + 0.5);
  }

  /** 世界 x → 屏幕 x：spawnX 落在右边缘 */
  function worldToScreen(wx: number, playerX: number): number {
    const scale = (width - playerX) / RUNNER.spawnX;
    return playerX + wx * scale;
  }

  function drawTrack(speedRatio: number) {
    const laneH = height / RUNNER.lanes;

    // 三条跑道底色交替，一眼能看出换道
    for (let i = 0; i < RUNNER.lanes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#f1f5f9" : "#e8eef6";
      ctx.fillRect(0, laneH * i, width, laneH);
    }

    // 车道分隔虚线：向左滚动，用来表达「在跑」
    const dash = 46;
    const gap = 34;
    const offset = (time * 260 * speedRatio) % (dash + gap);
    ctx.strokeStyle = "rgba(148,163,184,0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([dash, gap]);
    for (let i = 1; i < RUNNER.lanes; i++) {
      const y = laneH * i;
      ctx.beginPath();
      ctx.lineDashOffset = -offset;
      ctx.moveTo(-offset, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  function drawGate(gate: RunnerState["gates"][number], playerX: number) {
    const wx = gate.x;
    const sx = worldToScreen(wx, playerX);
    const laneH = height / RUNNER.lanes;
    const h = Math.min(58, laneH * 0.62);
    const w = Math.min(width * 0.3, 150);

    if (sx < -w || sx > width + w) return;

    const cy = laneY(gate.lane);
    const x = sx - w / 2;
    const y = cy - h / 2;

    // 门框
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = gate.resolved ? "rgba(148,163,184,0.4)" : "#c7d2fe";
    ctx.stroke();

    if (gate.resolved) {
      ctx.globalAlpha = 0.35;
    }

    // 单词：按宽度自适应，长词拆两行
    const maxTextW = w - 18;
    let size = Math.min(17, Math.max(11, h * 0.32));
    const draw = (text: string, s: number) => {
      ctx.font = `600 ${s}px ${FONT_STACK}`;
      return ctx.measureText(text).width;
    };
    while (size > 9 && draw(gate.word, size) > maxTextW) size -= 1;

    ctx.fillStyle = "#1e293b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (draw(gate.word, size) <= maxTextW) {
      ctx.font = `600 ${size}px ${FONT_STACK}`;
      ctx.fillText(gate.word, sx, cy + 0.5);
    } else if (gate.word.length >= 11) {
      const mid = Math.ceil(gate.word.length / 2);
      const line1 = gate.word.slice(0, mid);
      const line2 = gate.word.slice(mid);
      const s2 = Math.min(size, 13);
      ctx.font = `600 ${s2}px ${FONT_STACK}`;
      ctx.fillText(line1, sx, cy - s2 * 0.6);
      ctx.fillText(line2, sx, cy + s2 * 0.6);
    } else {
      ctx.font = `600 ${size}px ${FONT_STACK}`;
      ctx.fillText(gate.word, sx, cy + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(lane: number, playerX: number, shake: number) {
    const cy = laneY(lane) + (shake > 0 ? Math.sin(time * 90) * 4 * shake : 0);
    const r = Math.min(20, height / RUNNER.lanes / 3.4);

    // 影子
    ctx.beginPath();
    ctx.ellipse(playerX, cy + r * 0.95, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15,23,42,0.12)";
    ctx.fill();

    // 身体
    const grad = ctx.createRadialGradient(playerX - r * 0.3, cy - r * 0.35, r * 0.2, playerX, cy, r);
    grad.addColorStop(0, "#8aa4ff");
    grad.addColorStop(1, "#4f6ef7");
    ctx.beginPath();
    ctx.arc(playerX, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();

    // 眼睛 + 跑动小尾巴
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(playerX + r * 0.28, cy - r * 0.18, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(playerX - r * 0.18, cy - r * 0.18, r * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(79,110,247,0.35)";
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      const len = r * (0.9 + i * 0.35) + Math.sin(time * 12 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(playerX - r - 4, cy - r * 0.25 + i * 5);
      ctx.lineTo(playerX - r - 4 - len, cy - r * 0.25 + i * 5);
      ctx.stroke();
    }
  }

  function drawParticles(dt: number) {
    if (!particles.length) return;
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(state: RunnerState, dt: number) {
    if (!width || !height) return;
    time += dt;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    const playerX = Math.max(56, width * PLAYER_X_RATIO);
    const speedRatio = Math.min(1.6, state.speed / RUNNER.baseSpeed);

    let ox = 0;
    let oy = 0;
    if (state.shake > 0) {
      ox = Math.sin(time * 95) * 6 * state.shake;
      oy = Math.cos(time * 82) * 4 * state.shake;
    }

    ctx.save();
    ctx.translate(ox, oy);
    drawTrack(speedRatio);
    for (const gate of state.gates) drawGate(gate, playerX);
    drawPlayer(state.lane, playerX, state.shake);
    ctx.restore();

    drawParticles(dt);
  }

  function destroy() {
    particles = [];
  }

  return { resize, draw, burst, destroy };
}

/** 屏幕上的跑道（供点击换道换算） */
export function laneFromY(y: number, height: number): number {
  const lane = Math.floor((y / height) * RUNNER.lanes);
  return Math.max(0, Math.min(RUNNER.lanes - 1, lane));
}
