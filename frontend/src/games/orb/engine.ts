/**
 * 单词球球 · 纯逻辑引擎。
 *
 * 设计原则：不碰 DOM、不读时间、不用 Math.random。
 * 输入 (state, dt, 方向) → 输出新 state，随机数走内部 LCG（种子存在 state 里），
 * 这样单测可以跑满 1000 帧断言数值，线上也不会因为掉帧出现不可复现的怪状态。
 *
 * 玩法：玩家球上写中文短义，场上 14 个球写英文单词，吃对涨球、吃错掉命。
 */
import { shortMeaning, type WordEntry } from "@/services/quest/engine";
import { healForStreak, maxLivesOf } from "@/games/lives";

export type { WordEntry };

/** 一局参数，集中在一处方便调手感 */
export const ORB = {
  /** 初始半径 */
  startR: 40,
  /**
   * 半径上限。不封顶的话球会一直长：玩家半径决定「吃到」的判定范围（r × eatFactor），
   * 长到 200 就能一次吞掉半屏的食物球 —— 用户反馈的「一次吃到多个」就是这么来的。
   * 封顶后成长改由「背景缩小（视野变大）+ 层级」体现。
   */
  maxR: 76,
  /** 食物球半径（屏幕上要放得下英文单词，太小会看不清） */
  foodR: 27,
  /** 场上食物球数量：之前 14 个太密，选项一多反而难找 */
  foodCount: 10,
  /** 吃对放大倍率（复利） */
  grow: 1.08,
  /** 吃错缩小倍率 */
  shrink: 0.88,
  /** 半径下限，防止缩没 */
  minR: 24,
  /**
   * 屏幕上的移动速度（px/秒）。世界速度 = speedBase / cameraScale(r)，
   * 所以不管球多大，看起来的移动快慢都一样。
   * 原来写成 speedBase/(1+r/160)，球一大就越来越慢（r=76 时只剩 68%），是另一个反馈点。
   */
  speedBase: 250,
  /** 初始命（上限见 games/lives.ts 的 LIFE_RULE：连对 3 个回 1 格，最多 5 格） */
  lives: 3,
  /** 时长（秒） */
  duration: 60,
  /** 吃到判定：球心进入玩家半径的这个比例内即算吃中 */
  eatFactor: 0.92,
  /** 本局词池大小 */
  poolSize: 30
} as const;

export interface Food {
  id: number;
  x: number;
  y: number;
  r: number;
  word: string;
  correct: boolean;
}

export interface OrbPlayer {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
}

/** 一次吃球事件，渲染层靠 seq 变化决定要不要撒粒子 */
export interface OrbHit {
  seq: number;
  x: number;
  y: number;
  r: number;
  correct: boolean;
  word: string;
}

export type OrbPhase = "ready" | "playing" | "over";

export interface OrbState {
  phase: OrbPhase;
  player: OrbPlayer;
  foods: Food[];
  pool: WordEntry[];
  /** 目标词的取用顺序（洗牌后的下标），循环使用 */
  order: number[];
  orderPos: number;
  target: WordEntry | null;
  /** 玩家球上显示的中文短义，随目标词更新（渲染层直接用，免得每帧算） */
  label: string;
  /** 顶部提示条的完整释义：球内放不下，屏幕上方的横条可以换行显示 */
  labelFull: string;
  lives: number;
  maxLives: number;
  score: number;
  combo: number;
  bestCombo: number;
  correct: number;
  wrong: number;
  wrongWords: WordEntry[];
  elapsed: number;
  duration: number;
  tier: number;
  /** 层级切换时的 elapsed，用于背景过渡 */
  tierAt: number;
  /** 吃错时的抖动强度 0~1，随时间衰减 */
  shake: number;
  hitSeq: number;
  lastHit: OrbHit | null;
  /** 内部随机种子（LCG 状态） */
  rngState: number;
  nextFoodId: number;
}

export interface OrbConfig {
  words: WordEntry[];
  duration?: number;
  /** 练习模式：不限时（duration 视为无限） */
  untimed?: boolean;
  lives?: number;
  /** 指定随机种子，便于复现 */
  seed?: number;
}

/**
 * 环境层级：按「吃对个数」升级，不再按半径。
 *
 * 半径封顶后（maxR）用半径做阈值会让玩家永远停在第一层，
 * 而层级的本意是「进度感」，用吃对个数更准。
 */
export const TIERS: { minCorrect: number; name: string; hint: string }[] = [
  { minCorrect: 0, name: "村庄", hint: "草地上的小地方" },
  { minCorrect: 6, name: "城镇", hint: "房子多了起来" },
  { minCorrect: 14, name: "城市", hint: "高楼与天桥" },
  { minCorrect: 24, name: "省", hint: "山川与河流" },
  { minCorrect: 38, name: "国家", hint: "整个版图" },
  { minCorrect: 56, name: "地球", hint: "看见大气层了" },
  { minCorrect: 80, name: "太阳系", hint: "脚下是星辰" }
];

export function tierOf(correct: number): number {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (correct >= TIERS[i].minCorrect) idx = i;
  }
  return idx;
}

/**
 * 相机缩放：球越大，背景越远（作为参照物同比例缩小），
 * 而「球半径 × 缩放」恰好是个常数 —— 所以玩家球在屏幕上一直那么大，
 * 食物球也是（渲染层还有 24px 下限兜底）。
 */
export function cameraScale(r: number): number {
  const s = ORB.startR / Math.max(ORB.minR, r);
  return Math.min(1, Math.max(0.5, s));
}

/** 场上食物分布半径：随球长大一起外扩，避免"球大了却没东西吃" */
export function fieldRadius(r: number): number {
  // 球少了，场地也收一点，保持「球间距」和之前接近，不至于让人满地图找
  return 450 + r * 1.7;
}

/**
 * 世界坐标里的移动速度。
 * 除以 cameraScale 之后，屏幕上的速度恒为 ORB.speedBase —— 球变大不会变慢。
 */
export function moveSpeed(r: number): number {
  return ORB.speedBase / cameraScale(r);
}

// ---------------- 随机数 ----------------

function rand(s: OrbState): number {
  s.rngState = (Math.imul(s.rngState, 1664525) + 1013904223) >>> 0;
  return s.rngState / 4294967296;
}

function shuffleInPlace<T>(list: T[], s: OrbState): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------------- 干扰项 ----------------

/**
 * 拼写相似度：首字母、长度、公共前缀。
 * 用形近词当干扰项，逼玩家真看英文；随机抽词会让"看长度"就能过关。
 */
export function spellSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  let score = 0;
  if (a[0] === b[0]) score += 3;
  score += Math.max(0, 3 - Math.abs(a.length - b.length));
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  score += Math.min(3, prefix);
  return score;
}

/** 挑一个干扰词：从形近的前半段里随机取，保证同一局也不会总撞同一个词 */
function distractorWord(s: OrbState, exclude: Set<string>): string {
  const targetWord = s.target?.w ?? "";
  const candidates = s.pool.filter((w) => w.w !== targetWord && !exclude.has(w.w));
  if (!candidates.length) return targetWord;
  const scored = candidates.map((w) => ({ w: w.w, score: spellSimilarity(targetWord, w.w) + rand(s) * 2 }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.5)));
  return top[Math.floor(rand(s) * top.length)].w;
}

// ---------------- 构造 ----------------

function nextTarget(s: OrbState): WordEntry | null {
  if (!s.pool.length) return null;
  if (!s.order.length) return null;
  const idx = s.order[s.orderPos % s.order.length];
  return s.pool[idx] ?? null;
}

function ringPosition(s: OrbState): { x: number; y: number } {
  const angle = rand(s) * Math.PI * 2;
  const radius = fieldRadius(s.player.r);
  const dist = radius * (0.45 + 0.5 * rand(s));
  return {
    x: s.player.x + Math.cos(angle) * dist,
    y: s.player.y + Math.sin(angle) * dist
  };
}

function makeFood(s: OrbState, word: string, correct = false): Food {
  const pos = ringPosition(s);
  return {
    id: s.nextFoodId++,
    x: pos.x,
    y: pos.y,
    r: ORB.foodR,
    word,
    correct
  };
}

/**
 * 保证场上「恰好一个」正确球，且没有第二个球写着一模一样的词。
 * 三种情况：
 * - 目标没变（答错）：原来的正确球还在，什么都不用改
 * - 目标变了（答对）：原来的正确球已被吃掉，随机把一个干扰球改成新目标
 * - 补齐新球时撞了目标词：重挑一个干扰词
 *
 * 注意入参是整份 state（要读 target / pool / rng），就地改 state.foods。
 */
function normalizeFoods(state: OrbState): void {
  const target = state.target;
  const foods = state.foods;
  if (!target) return;

  const correctIndex = foods.findIndex((f) => f.correct);
  if (correctIndex >= 0) {
    foods[correctIndex].word = target.w;
  } else if (foods.length) {
    const idx = Math.floor(rand(state) * foods.length);
    foods[idx].correct = true;
    foods[idx].word = target.w;
  }

  const used = new Set<string>([target.w]);
  for (const f of foods) {
    if (f.correct) {
      if (f.word !== target.w) {
        f.correct = false;
        f.word = distractorWord(state, used);
        used.add(f.word);
      }
      continue;
    }
    if (f.word === target.w || used.has(f.word)) {
      f.word = distractorWord(state, used);
    }
    used.add(f.word);
  }
}

/** 补足场上球数（就地 push 进 state.foods） */
function topUpFoods(state: OrbState): void {
  const foods = state.foods;
  while (foods.length < ORB.foodCount) {
    foods.push(makeFood(state, distractorWord(state, new Set(foods.map((f) => f.word)))));
  }
}

export function createOrbGame(config: OrbConfig): OrbState {
  const usable = config.words.filter((w) => w.w && w.m);
  const duration = config.untimed ? Number.POSITIVE_INFINITY : (config.duration ?? ORB.duration);
  const lives = config.lives ?? ORB.lives;

  const state: OrbState = {
    phase: "ready",
    player: { x: 0, y: 0, r: ORB.startR, vx: 0, vy: 0 },
    foods: [],
    pool: [],
    order: [],
    orderPos: 0,
    target: null,
    label: "",
    labelFull: "",
    lives,
    maxLives: maxLivesOf(lives),
    score: 0,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    wrong: 0,
    wrongWords: [],
    elapsed: 0,
    duration,
    tier: tierOf(0),
    tierAt: 0,
    shake: 0,
    hitSeq: 0,
    lastHit: null,
    rngState: (config.seed ?? Date.now()) >>> 0,
    nextFoodId: 1
  };

  // 本局词池：洗牌后取 30 个（词库上万条也不能全铺到场上去）
  const pool = shuffleInPlace(usable.slice(), state).slice(0, Math.min(ORB.poolSize, usable.length));
  state.pool = pool;
  state.order = shuffleInPlace(
    pool.map((_, i) => i),
    state
  );
  state.target = nextTarget(state);
  state.label = targetLabel(state.target);
  state.labelFull = fullLabel(state.target);

  topUpFoods(state);
  normalizeFoods(state);
  return state;
}

/** 从 ready 进 playing；已开始的不重复初始化 */
export function startOrb(state: OrbState): OrbState {
  if (state.phase === "playing") return state;
  return { ...state, phase: "playing", elapsed: 0 };
}

// ---------------- 主循环 ----------------

function normalizeDir(dir: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(dir.x, dir.y);
  if (!Number.isFinite(len) || len < 1e-6) return { x: 0, y: 0 };
  // 摇杆/键盘的幅度允许 0~1，但超过 1 的斜向输入要归一化
  if (len <= 1) return { x: dir.x, y: dir.y };
  return { x: dir.x / len, y: dir.y / len };
}

function pushWrongWord(state: OrbState, word: WordEntry): WordEntry[] {
  if (state.wrongWords.some((w) => w.w === word.w)) return state.wrongWords;
  return [...state.wrongWords, word];
}

/**
 * 推进一帧。dt 单位秒，上限 50ms——切标签回来时 dt 可能是好几秒，
 * 不夹住会让球瞬移穿过所有食物。
 */
export function stepOrb(
  prev: OrbState,
  dtRaw: number,
  dir: { x: number; y: number }
): OrbState {
  if (prev.phase !== "playing") return prev;
  const dt = Math.max(0, Math.min(dtRaw, 0.05));

  const state: OrbState = {
    ...prev,
    player: { ...prev.player },
    // 每帧都可能改到 food 对象（吃掉的移除、重排位置、重贴词），
    // 元素也要复制，否则会改到上一帧的 state，单测里拿旧快照对比就失真了
    foods: prev.foods.map((f) => ({ ...f }))
  };

  // 1) 计时
  state.elapsed = prev.elapsed + dt;
  if (state.elapsed >= state.duration) {
    return { ...state, phase: "over", elapsed: state.duration, shake: 0 };
  }

  // 2) 移动：速度随半径衰减，加速度做一点平滑，手感才不会像贴地飞行
  const d = normalizeDir(dir);
  const speed = moveSpeed(state.player.r);
  const targetVx = d.x * speed;
  const targetVy = d.y * speed;
  const k = Math.min(1, dt * 9);
  state.player.vx += (targetVx - state.player.vx) * k;
  state.player.vy += (targetVy - state.player.vy) * k;
  state.player.x += state.player.vx * dt;
  state.player.y += state.player.vy * dt;

  // 3) 抖动衰减
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.5);

  // 4) 落在视野外的食物回到附近，否则球长大了场上就"没得吃"
  const field = fieldRadius(state.player.r);
  state.foods = state.foods.map((f) => {
    const dist = Math.hypot(f.x - state.player.x, f.y - state.player.y);
    if (dist <= field * 1.35) return f;
    const pos = ringPosition(state);
    return { ...f, x: pos.x, y: pos.y };
  });

  // 5) 碰撞：球心进入玩家半径的 eatFactor 内即算吃中，取最近的一个
  let hit: Food | null = null;
  let hitDist = Infinity;
  for (const f of state.foods) {
    const dist = Math.hypot(f.x - state.player.x, f.y - state.player.y);
    if (dist <= state.player.r * ORB.eatFactor) {
      if (dist < hitDist) {
        hit = f;
        hitDist = dist;
      }
    }
  }
  if (!hit) return finishStep(state);

  return finishStep(resolveEat(state, hit));
}

function resolveEat(state: OrbState, food: Food): OrbState {
  const target = state.target;
  state.foods = state.foods.filter((f) => f.id !== food.id);
  state.hitSeq = state.hitSeq + 1;
  state.lastHit = {
    seq: state.hitSeq,
    x: food.x,
    y: food.y,
    r: food.r,
    correct: food.correct,
    word: food.word
  };

  if (food.correct && target) {
    // 吃对：涨球 + 得分（连击加成）+ 进入下一个目标词
    state.correct += 1;
    state.combo = state.combo + 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.score += 10 + Math.min(10, (state.combo - 1) * 2);
    // 连对 3 个回一格（上限 5）：血条要有正反馈，不然只能一路挨打
    state.lives = healForStreak(state.lives, state.maxLives, state.combo);
    state.player.r = Math.min(ORB.maxR, Math.max(ORB.minR, state.player.r * ORB.grow));

    state.orderPos = (state.orderPos + 1) % Math.max(1, state.order.length);
    state.target = nextTarget(state);
    state.label = targetLabel(state.target);
  state.labelFull = fullLabel(state.target);
  } else {
    // 吃错：缩球 + 掉命 + 目标词不变（还得继续找它）
    state.wrong += 1;
    state.combo = 0;
    state.lives = Math.max(0, state.lives - 1);
    state.player.r = Math.max(ORB.minR, state.player.r * ORB.shrink);
    state.shake = 1;
    if (target) state.wrongWords = pushWrongWord(state, target);
  }

  // 补齐 + 重排：保证场上恰好一个正确球
  topUpFoods(state);
  normalizeFoods(state);

  if (state.lives <= 0) {
    return { ...state, phase: "over", shake: 0, foods: [] };
  }
  return state;
}

/** 每帧收尾：更新层级（升级时记时间用于过渡） */
function finishStep(state: OrbState): OrbState {
  const tier = tierOf(state.correct);
  if (tier !== state.tier) {
    return { ...state, tier, tierAt: state.elapsed };
  }
  return state;
}

// ---------------- 展示辅助 ----------------

/** 词性前缀：词典释义多是「n. 假期」这种，球上空间小，先去掉 */
const POS_PREFIX = /^(?:(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr|a)\.\s*)+/i;
/**
 * 词性不只是出现在开头：「n.锁v.锁,锁上,锁住」这种是紧贴在汉字后面的。
 * 所以匹配「分隔符或汉字 + 词性」，替换时把那个前导字符留下。
 */
const POS_INLINE = /(^|[\s,，、;；/\\\u4e00-\u9fa5])(?:vt|vi|v|n|adj|adv|prep|conj|pron|num|art|int|aux|abbr|a)\.\s*/gi;

/**
 * 把词性标记去掉，但**保留它作为义项边界**。
 *
 * 直接删掉会把两个义项黏成一句：「成本,价钱,代价vt.价值为…」→「成本,价钱,代价价值为…」，
 * 再按 15 字截断就变成一锅粥。换成「；」之后，取第一个义项仍然是干净的。
 */
function stripPos(text: string): string {
  let out = text.replace(POS_PREFIX, "");
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(POS_INLINE, "$1；");
  }
  return out.replace(/；{2,}/g, "；").replace(/^；/, "").trim();
}

/**
 * 玩家球上显示的中文短义。
 *
 * 原来的写法是「按逗号切第一段 + 最多 8 字」，结果「准时的，守时的；精确的」只剩「准时的」，
 * 玩家分不清近义词。现在的口径：
 * - 去掉词性前缀（n. / adj. …）
 * - **按分号切第一个义项**，保留逗号（逗号里常是同一义项的不同说法）
 * - 再按 limit 截断，球上最多三行显示
 */
export function targetLabel(word: WordEntry | null, limit = 15): string {
  if (!word) return "";
  const raw = (word.m ?? "").trim();
  if (!raw) return "";
  const noPos = stripPos(raw);
  const base = noPos || raw;
  const first = base.split(/[；;]/)[0].trim() || base;
  return first.length > limit ? `${first.slice(0, limit)}…` : first;
}

/**
 * 顶部提示条用的释义：保留**全部义项**，只是把词性标记换成「；」。
 *
 * 为什么和 targetLabel 分开：球内空间就那么大，15 字已经是极限（再多就要缩字号，
 * 上次就是因为缩字号被反馈「看不清」）。完整意思放到屏幕上方的横条里，那里可以换行。
 */
export function fullLabel(word: WordEntry | null, limit = 40): string {
  if (!word) return "";
  const raw = (word.m ?? "").trim();
  if (!raw) return "";
  const base = stripPos(raw) || raw;
  const compact = base.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}

/** 结果页用的正确率 */
export function orbAccuracy(state: OrbState): number {
  const total = state.correct + state.wrong;
  return total === 0 ? 0 : state.correct / total;
}

/** 计时器文案 mm:ss */
export function timeText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
