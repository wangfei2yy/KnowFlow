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
import {
  buildDistractorPool,
  buildWordOrder,
  cleanWords,
  type WordMode
} from "@/games/words";

export type { WordEntry };

/** 难度档：只改「场上有几个待选单词」，其它规则一律不动 */
export type DifficultyId = "easy" | "normal" | "hard" | "expert";

export interface OrbDifficulty {
  id: DifficultyId;
  name: string;
  /** 场上待选单词数（含唯一的正确答案） */
  options: number;
  desc: string;
}

/**
 * 四档难度 = 四个数字。
 *
 * 之前固定 10 个球，新手第一局就得在一屏小字里找一个词，劝退；老手又觉得太送。
 * 现在把「干扰项密度」拆出来当难度：选项目越少，扫视成本越低。
 * 顺带把场地跟着收一点（见 fieldRadius），否则 4 个球铺在 10 个球的场地里会显得空旷。
 */
export const DIFFICULTIES: OrbDifficulty[] = [
  { id: "easy", name: "简单", options: 4, desc: "场上 4 个词，先熟悉手感" },
  { id: "normal", name: "普通", options: 6, desc: "6 个词，干扰适中" },
  { id: "hard", name: "复杂", options: 8, desc: "8 个词，形近词更多" },
  { id: "expert", name: "困难", options: 10, desc: "10 个词，满场干扰" }
];

export function difficultyOf(id?: string): OrbDifficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

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
  /** 默认待选球数（= 困难档；建局时会被难度覆盖） */
  foodCount: 10,
  /** 吃对放大倍率（复利） */
  grow: 1.08,
  /** 吃错缩小倍率 */
  shrink: 0.88,
  /** 半径下限，防止缩没 */
  minR: 24,
  /**
   * 屏幕上的移动速度（px/秒）。世界速度 = speedBase / cameraScale(r)，
   * 所以不管球多大，**看起来的移动快慢都一样** —— 这就是「吃越多越慢」的修法。
   *
   * 两处曾经踩过的坑：
   * 1. 早期写成 speedBase/(1+r/160)，球一大就真的变慢（r=76 时只剩 68%）；
   * 2. 只改公式还不够：主循环 dt 上限 0.05，掉到 20fps 以下时每帧只算 50ms，
   *    实际速度会被悄悄砍掉一截。现在页面用固定步长累加，跟帧率彻底解耦。
   *
   * 250 有点温吞（手机上要 2.8 秒才穿过一屏），提到 300。
   */
  speedBase: 300,
  /** 初始命（上限见 games/lives.ts 的 LIFE_RULE：连对 3 个回 1 格，最多 5 格） */
  lives: 3,
  /** 时长（秒） */
  duration: 60,
  /** 吃到判定：球心进入玩家半径的这个比例内即算吃中 */
  eatFactor: 0.92,
  /** 干扰项候选池大小（从整库随机抽这么多个，只在它上面挑形近词） */
  poolSize: 240
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

/**
 * 出词顺序（定义在 games/words.ts，球球和跑酷共用）：
 * - `order`：按词库原有顺序一关一关往下走，配合存档游标，一轮刷完前不重复；
 * - `random`：整库洗牌，一局之内不重复。
 * 以前是「只抽 30 个词反复轮回」，玩两分钟就把 30 个词背下来了。
 */
export { cleanWords };
export type { WordMode };

export interface OrbState {
  phase: OrbPhase;
  player: OrbPlayer;
  foods: Food[];
  pool: WordEntry[];
  /** 本局难度与「场上待选数」（存进 state，补位时才知道该补到几个） */
  difficulty: DifficultyId;
  options: number;
  /** 出词模式与取词顺序（指向 pool 的下标） */
  mode: WordMode;
  order: number[];
  orderPos: number;
  /** 干扰项候选池：只从这个小池子里抽，避免每次都在整库上做排序 */
  distractors: WordEntry[];
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
  /** 难度档（默认普通档 6 个词） */
  difficulty?: DifficultyId;
  /** 出词模式（默认 random，保持老行为；页面会传用户选的那个） */
  mode?: WordMode;
  /** 顺序模式：这一局从词库的第几个词开始（0 基，越界自动取模） */
  startIndex?: number;
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
 * 相机最小缩放：视野最多退到原来的 0.75（可见面积 ≈ 1.8 倍）。
 *
 * 原来是 40/r、下限 0.5 —— 打到满级时可见面积是 3.6 倍，
 * 背景装饰、食物球这些「按视野面积画」的东西跟着翻好几倍，低端机就掉帧。
 * 现在改成轻微后撤：视野只放大 1.8 倍，其余「我变大了」交给球本身
 * （球在屏幕上从 40px 长到 57px），参照物变化小，判断距离反而更稳。
 */
export const CAMERA_MIN = 0.75;

/**
 * 相机缩放：球越大背景越远，但幅度受 CAMERA_MIN 限制。
 * 「球半径 × 缩放」不再是常数 —— 球在屏幕上会真的长大一点点，这是故意的。
 */
export function cameraScale(r: number): number {
  const span = ORB.maxR - ORB.startR;
  const t = Math.max(0, Math.min(1, (r - ORB.startR) / span));
  return Math.max(CAMERA_MIN, Math.min(1, 1 - (1 - CAMERA_MIN) * t));
}

/**
 * 场上食物分布半径：随球长大一起外扩，避免"球大了却没东西吃"。
 *
 * 再按选项数收敛：4 个球铺在 10 个球的场地上会显得空旷、要走很久才碰到一个，
 * 用 √(选项/10) 缩放，让「球间距」在各档之间保持接近（密度守恒）。
 */
export function fieldRadius(r: number, options: number = ORB.foodCount): number {
  // 相机不再大幅拉远之后，场地也没必要长那么快：原来 450+1.7r 打满时食物铺到
  // 434 屏幕像素外，一屏只看得见两三个，得满地图找。收成 360+0.6r 之后
  // 起始 384、满级 406（屏幕上 ~305），大部分球都在视野里，
  // 「找词」靠读英文而不是靠走路。
  const base = 360 + r * 0.6;
  const density = Math.sqrt(Math.max(1, options) / ORB.foodCount);
  return base * Math.max(0.55, density);
}

/**
 * 世界坐标里的移动速度。
 * 除以 cameraScale 之后，屏幕上的速度恒为 ORB.speedBase —— 球变大不会变慢。
 */
export function moveSpeed(r: number): number {
  return ORB.speedBase / cameraScale(r);
}

/** 屏幕速度（px/秒）：与半径无关，是恒定值本身。留给单测和调参看 */
export function screenSpeed(): number {
  return ORB.speedBase;
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
  // 只用干扰池（几百个词），不是整库：整库 4000+ 条时每次挑干扰项都要做一遍排序
  const candidates = s.distractors.filter((w) => w.w !== targetWord && !exclude.has(w.w));
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
  const radius = fieldRadius(s.player.r, s.options);
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
  while (foods.length < state.options) {
    foods.push(makeFood(state, distractorWord(state, new Set(foods.map((f) => f.word)))));
  }
}

export function createOrbGame(config: OrbConfig): OrbState {
  const usable = cleanWords(config.words);
  const duration = config.untimed ? Number.POSITIVE_INFINITY : (config.duration ?? ORB.duration);
  const lives = config.lives ?? ORB.lives;
  const difficulty = difficultyOf(config.difficulty);
  const mode: WordMode = config.mode ?? "random";

  const state: OrbState = {
    phase: "ready",
    player: { x: 0, y: 0, r: ORB.startR, vx: 0, vy: 0 },
    foods: [],
    pool: [],
    difficulty: difficulty.id,
    options: difficulty.options,
    mode,
    order: [],
    orderPos: 0,
    distractors: [],
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

  /**
   * 词池 = 整个词库（以前只抽 30 个反复轮回，玩两分钟就摸清规律了）。
   * 顺序模式按词库原顺序从游标处往下走，随机模式整库洗牌；两者一轮内都不重复。
   */
  state.pool = usable;
  const n = usable.length;
  const shuffle = <T,>(list: T[]) => shuffleInPlace(list, state);
  state.order = buildWordOrder(mode, n, config.startIndex ?? 0, shuffle);
  // 干扰项只在这个小池子里挑（整库四五千条时，形近词评分排序太浪费）
  state.distractors = buildDistractorPool(usable, state.order, state.orderPos, ORB.poolSize, shuffle);

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
 * 推进一帧。dt 单位秒，上限 100ms——切标签回来时 dt 可能是好几秒，
 * 不夹住会让球瞬移穿过所有食物。
 *
 * 为什么从 50ms 放宽到 100ms：50ms 意味着只要帧率掉到 20fps 以下，
 * 每帧只被算作 50ms，实际移动速度就被悄悄砍掉一截 —— 玩家感受到的
 * 「越玩越慢」有一部分是这么来的（球长大后背景要画的装饰变多，更容易掉帧）。
 * 页面那边已经改成固定步长累加，这里是第二道保险。
 */
export function stepOrb(
  prev: OrbState,
  dtRaw: number,
  dir: { x: number; y: number }
): OrbState {
  if (prev.phase !== "playing") return prev;
  const dt = Math.max(0, Math.min(dtRaw, 0.1));

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
  const field = fieldRadius(state.player.r, state.options);
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
