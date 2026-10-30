/**
 * 单词球球 · Canvas 渲染。
 *
 * 只用状态、不写状态：`draw(state, dt)` 拿一帧就画一帧，
 * 引擎和渲染层的唯一约定是 OrbState 的形状。
 *
 * 两个刻意的取舍：
 * 1. 全部在屏幕坐标里画（不 ctx.scale），否则相机缩到 0.5 时文字会一起糊掉；
 *    圆的半径按 scale 缩，字号按屏幕像素给，保证再远的球也能读清单词。
 * 2. 环境装饰用「世界网格 + 哈希」生成，不存数组。玩家走到哪都有装饰，
 *    又不用维护一张会越铺越大的地图。
 */
import { cameraScale, TIERS, type Food, type OrbState } from "./engine";

interface TierStyle {
  bg: string;
  /** 装饰 emoji，按顺序取用 */
  deco: string[];
  /** 是否深色背景（深色时装饰要更亮） */
  dark?: boolean;
}

const TIER_STYLE: TierStyle[] = [
  { bg: "#eef7ea", deco: ["🏡", "🌳", "🌾", "🐄"] },
  { bg: "#e8eee4", deco: ["🏘️", "🏢", "🚗", "🌲"] },
  { bg: "#e2e9f4", deco: ["🏙️", "🌉", "🚦", "🏬"] },
  { bg: "#dde6f6", deco: ["🗺️", "⛰️", "🌊", "🛤️"] },
  { bg: "#dbe3fb", deco: ["🌏", "🏔️", "☁️", "🛰️"] },
  { bg: "#101736", deco: ["🌍", "✨", "🌑", "🛸"], dark: true },
  { bg: "#06080f", deco: ["☀️", "🪐", "⭐", "🌌"], dark: true }
];

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

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

export interface OrbRenderer {
  resize(width: number, height: number): void;
  draw(state: OrbState, dt: number): void;
  burst(x: number, y: number, color: string, count?: number): void;
  clearParticles(): void;
  destroy(): void;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16)
  ];
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(r1 + (r2 - r1) * k);
  const g = Math.round(g1 + (g2 - g1) * k);
  const bl = Math.round(b1 + (b2 - b1) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

function styleOf(tier: number): TierStyle {
  return TIER_STYLE[Math.max(0, Math.min(TIER_STYLE.length - 1, tier))];
}

export function createOrbRenderer(canvas: HTMLCanvasElement): OrbRenderer {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持 Canvas 2D");
  const ctx: CanvasRenderingContext2D = context;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let time = 0;
  let particles: Particle[] = [];

  // 背景过渡：记住上一个已显示的层级，切换时插值 0.6 秒
  let shownTier = -1;
  let fromTier = 0;
  let transition = 1;

  function resize(w: number, h: number) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    // 非浏览器环境（单测）没有 window，回落 1 倍
    const ratio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    dpr = Math.min(2, ratio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function burst(x: number, y: number, color: string, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 60 + Math.random() * 90;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5,
        maxLife: 0.5,
        r: 2 + Math.random() * 2.5,
        color
      });
    }
    // 上限 12 个，多了只是浪费绘制
    if (particles.length > 12) particles = particles.slice(-12);
  }

  function clearParticles() {
    particles = [];
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

  const fontOf = (size: number) => `600 ${size}px ${FONT_STACK}`;

  /**
   * 给食物球排英文单词：先试单行逐级缩字号，长词拆两行，
   * 实在放不下才截断加省略号（纯逻辑在 layoutWordWithMeasure，见文件末尾）。
   *
   * 为什么不按单词长度改球的大小：那会变成「看球大小猜答案」，干扰项就白设计了。
   */
  function widthOfText(t: string, size: number): number {
    ctx.font = fontOf(size);
    return ctx.measureText(t).width;
  }

  /**
   * 排版缓存：同一批球每帧都要重新排版，而 measureText 是慢路径。
   * 球大小 / 缩放一变 key 就变，按「词 + 宽度 + 字号」缓存后，
   * 一局里绝大多数帧都能直接命中。
   */
  const layoutCache = new Map<string, { lines: string[]; size: number }>();
  function layoutCached(text: string, maxWidth: number, maxFont: number, minFont = 9) {
    const key = `${text}|${Math.round(maxWidth)}|${Math.round(maxFont)}`;
    const hit = layoutCache.get(key);
    if (hit) return hit;
    const next = layoutWordWithMeasure(text, maxWidth, maxFont, minFont, widthOfText);
    // 上限兜底：词库上万条，缓存不能无限长（一局里实际只会出现十几个词）
    if (layoutCache.size > 400) layoutCache.clear();
    layoutCache.set(key, next);
    return next;
  }

  /** 中文按字折行，最多两行 */
  function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
    const lines: string[] = [];
    let rest = text;
    while (rest && lines.length < maxLines) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (rest && lines.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
    }
    return lines;
  }

  function drawDecor(scale: number, halfW: number, halfH: number, px: number, py: number, style: TierStyle) {
    const cell = 200;
    const left = px - halfW / scale;
    const right = px + halfW / scale;
    const top = py - halfH / scale;
    const bottom = py + halfH / scale;
    const gx0 = Math.floor(left / cell);
    const gx1 = Math.ceil(right / cell);
    const gy0 = Math.floor(top / cell);
    const gy1 = Math.ceil(bottom / cell);

    /**
     * 相机缩小后，同样一屏要扫的格子数按 1/scale² 增长（scale 0.5 时是 4 倍）。
     * 每格一次 emoji fillText，在低端手机上就会把帧率打下去 ——
     * 而帧率正是「球长大后感觉变慢」的元凶之一（引擎侧已改成固定步长兜底，
     * 这里再把绘制量摁住，双保险）。
     * 抽稀而不是缩小视野：位置还是那些位置（同一套哈希），只是隔一格画一个，
     * 观感是「装饰变稀」，不会跳来跳去。
     */
    const cells = (gx1 - gx0 + 1) * (gy1 - gy0 + 1);
    const skip = cells > 40 ? Math.ceil(Math.sqrt(cells / 40)) : 1;

    const size = Math.max(11, Math.min(34, cell * scale * 0.32));
    ctx.font = `${size}px ${FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = style.dark ? 0.55 : 0.45;

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        if (skip > 1 && (gx + gy) % skip !== 0) continue;
        const h = hash2(gx, gy, shownTier + 1);
        // 约 55% 的格子不放东西，留白才像风景
        if (h % 100 < 55) continue;
        const emoji = style.deco[h % style.deco.length];
        const ox = (h % 131) - 65;
        const oy = ((h >>> 7) % 131) - 65;
        const wx = gx * cell + ox;
        const wy = gy * cell + oy;
        const sx = halfW + (wx - px) * scale;
        const sy = halfH + (wy - py) * scale;
        if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;
        ctx.fillText(emoji, sx, sy);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFood(f: Food, scale: number, px: number, py: number, halfW: number, halfH: number) {
    const sx = halfW + (f.x - px) * scale;
    const sy = halfH + (f.y - py) * scale;
    // 缩得再远也要留住可读性：屏幕半径不低于 24px（英文单词才放得下）
    const r = Math.max(24, f.r * scale);
    if (sx < -r * 3 || sy < -r * 3 || sx > width + r * 3 || sy > height + r * 3) return;

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#cbd5e1";
    ctx.stroke();

    const { lines, size } = layoutCached(f.word, r * 1.72, Math.min(20, Math.max(11, r * 0.62)));
    ctx.font = fontOf(size);
    ctx.fillStyle = "#1e293b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (lines.length === 1) {
      ctx.fillText(lines[0], sx, sy + 0.5);
    } else {
      const lh = size * 1.12;
      lines.forEach((line, i) => ctx.fillText(line, sx, sy - lh / 2 + i * lh + 0.5));
    }
  }

  function drawPlayer(state: OrbState, scale: number, halfW: number, halfH: number) {
    const r = Math.max(16, state.player.r * scale);
    const cx = halfW;
    const cy = halfH;

    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
    grad.addColorStop(0, "#8aa4ff");
    grad.addColorStop(1, "#4f6ef7");
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();

    const label = state.label;
    if (!label) return;
    // 中文短义：字少就大、字多就小。最多三行 —— 两行时「准时的，守时的」只能塞 8 个字，
    // 玩家分不清近义词（用户反馈「释义显示不全」多半是这里）。
    const perLine = r > 90 ? 7 : r > 60 ? 6 : 5;
    const lines = wrapLines(label, perLine, 3);
    const longest = Math.max(...lines.map((l) => l.length));
    let size = Math.min(28, Math.max(10, (r * 1.6) / Math.max(3, longest)));
    const maxWidth = r * 1.72;
    const fits = () => lines.every((l) => ctx.measureText(l).width <= maxWidth);
    ctx.font = `700 ${size}px ${FONT_STACK}`;
    while (size > 9 && !fits()) {
      size -= 1;
      ctx.font = `700 ${size}px ${FONT_STACK}`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    const lineHeight = size * 1.22;
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
  }

  function draw(state: OrbState, dt: number) {
    if (!width || !height) return;
    time += dt;

    const style = styleOf(state.tier);
    if (shownTier !== state.tier) {
      fromTier = shownTier < 0 ? state.tier : shownTier;
      shownTier = state.tier;
      transition = 0;
    }
    transition = Math.min(1, transition + dt / 0.6);
    const bg = mixHex(styleOf(fromTier).bg, style.bg, transition);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const scale = cameraScale(state.player.r);
    const halfW = width / 2;
    const halfH = height / 2;

    // 抖动：吃错时整个场景晃一下（比让球乱飞更省事，也不影响操作）
    let ox = 0;
    let oy = 0;
    if (state.shake > 0) {
      const amp = 7 * state.shake;
      ox = Math.sin(time * 95) * amp;
      oy = Math.cos(time * 78) * amp;
    }

    ctx.save();
    ctx.translate(ox, oy);

    drawDecor(scale, halfW, halfH, state.player.x, state.player.y, transition < 0.5 ? styleOf(fromTier) : style);

    for (const f of state.foods) drawFood(f, scale, state.player.x, state.player.y, halfW, halfH);
    drawPlayer(state, scale, halfW, halfH);

    ctx.restore();

    drawParticles(dt);
  }

  function destroy() {
    particles = [];
  }

  return { resize, draw, burst, clearParticles, destroy };
}

/** 层级名（HUD 与提示条共用） */
export function tierName(tier: number): string {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))].name;
}

/**
 * 单词排版的纯逻辑（从 render 里抽出来，方便单测）：
 * 先单行逐级缩字号 → 长词拆两行 → 兜底截断。
 * `measure` 是「给定文本与字号 → 宽度」的回调，注入便于脱离 canvas 测试。
 */
export interface WordLayout {
  lines: string[];
  size: number;
}

export function layoutWordWithMeasure(
  text: string,
  maxWidth: number,
  maxFont: number,
  minFont: number,
  measure: (text: string, size: number) => number
): WordLayout {
  for (let size = Math.round(maxFont); size >= minFont; size--) {
    if (measure(text, size) <= maxWidth) return { lines: [text], size };
  }

  // 放不下一行就折：原先只对 ≥11 字母的词折行，导致 9~10 字母的词
  // （cet4 571 个 / cet6 835 个）既放不进一行、也不折行，直接被截成「abando…」。
  for (const lineCount of [2, 3]) {
    if (text.length < lineCount * 2) break;
    const per = Math.ceil(text.length / lineCount);
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += per) lines.push(text.slice(i, i + per));
    for (let size = Math.round(maxFont * 0.92); size >= minFont; size--) {
      if (lines.every((line) => measure(line, size) <= maxWidth)) return { lines, size };
    }
  }

  // 三行都放不下才截断
  let out = text;
  while (out.length > 1 && measure(`${out}…`, minFont) > maxWidth) out = out.slice(0, -1);
  return { lines: [out === text ? text : `${out}…`], size: minFont };
}

