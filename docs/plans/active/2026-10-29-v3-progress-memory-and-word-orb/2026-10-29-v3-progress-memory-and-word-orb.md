# v3 · 学习进度记忆 + 单词球球游戏

> 制定日期：2026-10-29
> 状态：**待开发**
> 关联决策：先做球球吞噬；答错入队、答对只记成绩；「闯关」升级成「游戏」
> 前置文档：[03 学习模式](../../../功能模块/03_任务管理与学习模式.md)、[06 内置知识包](../../../功能模块/06_内置知识包与单词闯关.md)

---

## 01 背景

两个问题：

1. **进度不记忆**。单词闯关 `startSession()` 每次新建会话，`questions / index / lives / score` 全在内存，退出即丢；`localStorage` 只存了 `bestScore / plays / lastPlayedAt`。用户背到第 3 题退出，重进回到第 1 题。卡片复习的 `currentIndex` 同样是内存 ref，切页归零。
2. **学习形式单一**。现有学习只有「翻卡 + 四选一」两种形态，缺少即时反馈类玩法。用户希望做一个"边玩边学"的小游戏，第一优先是球球吞噬（吃对变大、吃错变小、环境随球变大而升级）。

## 02 目标与非目标

**目标**

- 关掉页面、切 Tab、刷新后，闯关与复习都能从上次位置继续
- 新增「游戏中心」，把单词闯关收纳为其中一种玩法，为后续小游戏留出扩展位
- 交付第一个新玩法「单词球球」：Canvas 2D、60 秒限时、3 条命、吃对涨球、吃错掉命、球变大后视野自动拉远并升级环境
- 游戏里答错的词自动进复习队列，答对只记成绩

**非目标**

- 不做多人对战 / 排行榜 / 账号体系
- 不做音效与背景音乐（第一版用震动与视觉反馈替代，后续可加）
- 不做成语接龙、配对消除（本期只预留入口位，标「即将上线」）
- 端内（小工具）不提供任何游戏，依赖词库在线加载

## 03 阶段 0：进度记忆（0.5 天）

### 3.1 闯关会话持久化

**存储键**：`knowflow.quest.session`

```ts
interface SavedQuest {
  packId: string;
  session: QuestSession;   // 必须存整个会话，只存 index 没意义（题目会重抽）
  savedAt: string;         // ISO 时间
}
```

**写入时机**：每次 `answerCurrent` 之后、`nextQuestion` 之后（约 0.3 秒节流，避免连点写爆 localStorage）。

**清除时机**：`phase` 进入 `result` 时；或存档超过 7 天（`savedAt` 判定）。

**读取时机**：进入游戏中心 → 加载词库卡片时读取一次。

**UI 表现**：

| 场景 | 卡片显示 |
| --- | --- |
| 无存档 | `开始闯关` |
| 有未完成存档（index 1~9） | 主按钮 `继续 · 第 3/10 题`，次按钮 `重新开始` |
| 存档已结束或过期 | 不显示继续，按无存档处理 |

**关键边界**：

- 继续时必须校验 `packId` 一致，切了词库就丢弃旧存档
- `session.questions` 里的 `WordEntry` 体积很小（10 条 × ~100 字节），localStorage 无压力
- `localStorage` 写失败不阻断答题（try/catch 静默）

### 3.2 复习位置持久化

**存储键**：`knowflow.study.position`

```ts
interface SavedPosition {
  fingerprint: string;   // 队列卡片 id 拼接后的简易 hash
  index: number;
}
```

进入复习页、切换卡片时保存；`listDueCards()` 结果变化（指纹不同）时丢弃旧位置、回到第 1 张。

**不持久化**：视图模式（复习/列表）、筛选条件 —— 这些属于"临时选择"，记住反而困惑。

## 04 阶段 1：游戏中心改造（0.5 天）

### 4.1 路由调整

```
/study/play            游戏中心（原闯关大厅升级）
/study/play/quest      单词闯关（原 /study/quest 内容）
/study/play/orb        单词球球（本期新增）
```

- `/study/quest` 加 redirect 到 `/study/play/quest`（旧链接兼容）
- `StudyTabs` 第 5 项：`闯关` → `游戏`，路径改为 `/study/play`

### 4.2 游戏中心页面（PlayHomePage.vue）

卡片列表，每张卡：图标、名称、一句话说明、最高分/局数、`开始` 按钮。

| 游戏 | 状态 | 说明 |
| --- | --- | --- |
| 单词闯关 | 可用 | 10 题一组，3 条命 |
| 单词球球 | 可用 | 吃对变大，60 秒 |
| 成语接龙 | 即将上线 | 置灰，不可点 |
| 中英配对 | 即将上线 | 置灰，不可点 |

**成绩存储**：`knowflow.game.progress`，结构 `{ [gameId]: { [packId]: { bestScore, plays, lastPlayedAt } } }`。与现有 `knowflow.quest.progress` 分开，避免球球和闯关的分数混在一起。

## 05 阶段 2：单词球球（核心，3 天）

### 5.1 玩法定义

```
玩家球：显示【当前目标词的中文短义】（≤8 字）
食物球：显示【英文单词】，场上 14 个，其中 1 个是正确答案
吃对：球 +8%，得分 +10（连击加成），换下一个目标词
吃错：球 -12%，扣 1 条命，屏幕抖动
结束：3 条命耗尽，或 60 秒倒计时归零
```

**为什么玩家球放中文、食物球放英文**：英文单词 1~3 个词，球上放得下；中文释义动辄十几个字，塞不进小圆。反过来会看不清。

**干扰项设计**（决定游戏是否真能学到东西）：不用随机词做干扰，而是从本局词池里选**形近词**（拼写相近）与**同类词**（同词性/同主题），逼玩家真看英文，而不是靠"长度猜"。

### 5.2 数值表

| 项 | 值 | 说明 |
| --- | --- | --- |
| 初始半径 | 40 | 世界单位 |
| 吃对增长 | ×1.08 | 复利，约 9 次翻倍 |
| 吃错缩小 | ×0.88 | 两次吃错约退回起点 |
| 半径下限 | 24 | 防止缩没 |
| 移动速度 | `base / (1 + r/160)` | 越大越慢，避免大球无脑碾压 |
| 初始命 | 3 | |
| 时限 | 60 秒 | |
| 场上食物球 | 14 | 吃掉 0.4 秒后补位 |
| 连击 | 连续答对 +2 分/次，最高 +10 | 答错清零 |
| 相机缩放 | `clamp(40 / r, 0.35, 1)` | r=40 → 1.0；r=400 → 0.35 |

### 5.3 环境层级（视野升级）

用户要的"球变大后环境等比变小"，实现为**相机 zoom out + 背景层切换**，世界坐标不变：

| 阈值（半径） | 层级 | 背景 | 装饰 |
| --- | --- | --- | --- |
| 40 | 村庄 | 浅绿草地 | 🏡 🌳 🌾 |
| 80 | 城镇 | 灰绿 | 🏘️ 🏢 🚗 |
| 140 | 城市 | 蓝灰 | 🏙️ 🌉 🚦 |
| 220 | 省 | 深蓝 | 🗺️ ⛰️ 🌊 |
| 320 | 国家 | 靛蓝 | 🌏 🏔️ ☁️ |
| 450 | 地球 | 深空黑 + 星点 | 🌍 ✨ |
| 600 | 太阳系 | 纯黑 + 星云 | ☀️ 🪐 ⭐ |

切换时做 0.6 秒背景色过渡 + 顶部提示条（`已进入 城市`），给玩家"升级感"。

### 5.4 渲染与性能

- **Canvas 2D**，`devicePixelRatio` 缩放（否则手机小字糊）
- 实体上限 20（玩家 + 14 食物 + 粒子），单帧绘制 ≈ 20 个圆 + 20 段文字，60fps 无压力
- 文字**按球半径自适应字号**：`fontSize = clamp(r * 0.5, 9, 18)`，超长自动缩到 2 行、仍放不下则截断加省略号
- 粒子效果限 12 个（吃对时向外扩散的小圆点），不做阴影/发光（离屏绘制开销）

### 5.5 操作

| 设备 | 操作 |
| --- | --- |
| 桌面 | 鼠标位置即目标方向，按住加速；或 WASD / 方向键 |
| 手机 | 左下角虚拟摇杆（固定半径 48px，拖动死区 8px）；手指在右半屏任意位置拖动也等效 |

**必须先做桌面版调手感，再做摇杆**——摇杆调不出"跟手"的感觉时，很难判断是引擎问题还是输入问题。

### 5.6 结果页

- 得分、答对/答错数、正确率、最高连击、到达的最高层级
- 本局答错的词列表（每个带「加入复习」按钮；进入结果页时已批量入队，这里只是展示）
- 按钮：`再来一局` / `换个词库` / `返回游戏中心`

### 5.7 答错入队（决策落地）

复用现有桥接：

```ts
// services/quest/wordCards.ts
addWordToReview(packId, word, /* wrong */ true)
```

- 在**结算时批量入队**，不在游戏中逐次写库（避免一局写 20 次 IndexedDB 造成卡顿）
- 答对**不动 SRS**，只 `saveGameResult` 记成绩
- 结算页显示「已加入 N 个词到复习队列」，给用户明确预期

## 06 数据与接口

### 6.1 新增文件

| 文件 | 职责 |
| --- | --- |
| `src/games/orb/engine.ts` | 纯逻辑：状态、物理、碰撞、计分、层级判定（可单测，不碰 DOM） |
| `src/games/orb/render.ts` | Canvas 绘制：球、文字、背景层、粒子 |
| `src/games/orb/input.ts` | 输入抽象：键盘 / 鼠标 / 触控摇杆 |
| `src/pages/PlayHomePage.vue` | 游戏中心 |
| `src/pages/OrbPage.vue` | 球球页面（Canvas 容器 + HUD + 弹窗） |
| `src/services/gameService.ts` | 成绩读写、进度存档、会话持久化 |

### 6.2 引擎接口

```ts
export interface OrbConfig {
  words: WordEntry[];        // 本局词池（30 个）
  duration?: number;         // 默认 60
  lives?: number;            // 默认 3
  rng?: () => number;
}

export interface OrbState {
  phase: "ready" | "playing" | "over";
  player: { x: number; y: number; r: number; vx: number; vy: number };
  foods: Food[];             // { id, x, y, r, word, isCorrect }
  target: WordEntry | null;  // 当前目标词
  lives: number;
  score: number;
  combo: number;
  bestCombo: number;
  correct: number;
  wrong: number;
  wrongWords: WordEntry[];
  elapsed: number;           // 秒
  tier: number;              // 环境层级 0~6
}

export function createOrbGame(config: OrbConfig): OrbState;
export function stepOrb(state: OrbState, dt: number, dir: { x: number; y: number }): OrbState;
export function cameraScale(r: number): number;
export function tierOf(r: number): number;
```

`stepOrb` 是纯函数（输入 + 时间步 → 新状态），渲染层只读状态，测试直接跑 1000 帧断言数值。

### 6.3 进度存档接口

```ts
// gameService.ts
export function loadQuestSession(): SavedQuest | null;
export function saveQuestSession(packId: string, session: QuestSession): void;
export function clearQuestSession(): void;

export function loadStudyPosition(): SavedPosition | null;
export function saveStudyPosition(fingerprint: string, index: number): void;

export function loadGameProgress(): GameProgress;
export function saveGameResult(gameId: string, packId: string, score: number): GameProgress;
```

## 07 文件改动清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/services/gameService.ts` | 新增 | 三个存储域 |
| `src/games/orb/engine.ts` | 新增 | 纯逻辑引擎 |
| `src/games/orb/render.ts` | 新增 | Canvas 渲染 |
| `src/games/orb/input.ts` | 新增 | 输入抽象 |
| `src/pages/OrbPage.vue` | 新增 | 球球页面 |
| `src/pages/PlayHomePage.vue` | 新增 | 游戏中心 |
| `src/pages/QuestPage.vue` | 改 | 从"大厅"改为"单游戏页"，phase 起点由路由决定 |
| `src/pages/StudyPage.vue` | 改 | 位置记忆 |
| `src/components/StudyTabs.vue` | 改 | 第 5 项改「游戏」→ `/study/play` |
| `src/router/index.ts` | 改 | 新增 play 子路由 + quest redirect |
| `src/services/quest/wordCards.ts` | 改 | 增加批量入队 `addWordsToReview` |
| `scripts/smoke-orb.ts` + `run-orb.mjs` | 新增 | 引擎单测 |
| `package.json` | 改 | `test:orb` |
| `docs/功能模块/08_学习小游戏.md` | 新增 | 玩法与数值说明 |

## 08 验收用例

**进度记忆**

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 闯关答到第 3 题，退出大厅再进 | 卡片显示「继续 · 第 3/10 题」，点进去是第 3 题 |
| 2 | 继续后答错扣命，刷新页面 | 生命数与得分保持 |
| 3 | 一局结束 | 存档清除，卡片回到「开始闯关」 |
| 4 | 有 cet4 存档时切到 cet6 | cet6 显示「开始闯关」，cet4 存档保留 |
| 5 | 复习到第 5 张，切到概览再回来 | 停在第 5 张 |
| 6 | 复习队列变化（标记掌握后队列缩短） | 回到第 1 张，不越界 |

**球球**

| # | 场景 | 期望 |
| --- | --- | --- |
| 7 | 吃对应英文球 | 球变大、+10 分、目标词切换、正确球重新生成 |
| 8 | 吃错球 | 球变小、扣 1 命、屏幕抖动 |
| 9 | 连续吃错 3 次 | 立即结算 |
| 10 | 60 秒到 | 结算，不能继续操作 |
| 11 | 球长到 r>140 | 相机缩小、背景切到「城市」、顶部提示 |
| 12 | 半径缩到下限 | 不再缩小（r 不低于 24） |
| 13 | 手机摇杆拖动 | 球朝摇杆方向移动，松手减速 |
| 14 | 结算 | 答错的词已进复习队列，数量与列表一致 |
| 15 | 刷新页面中途退出 | 球球不恢复进度（一局制），但成绩已按局记 |

## 09 排期（自然日，含周末）

| 日期 | 阶段 | 交付 |
| --- | --- | --- |
| 10/30（周五） | 阶段 0 | 闯关 + 复习进度记忆（含 6 条验收） |
| 10/31（周六） | 阶段 1 | 游戏中心、路由改造、Tab 改名 |
| 11/01（周日） | 阶段 2.1 | 球球引擎（物理/碰撞/计分/层级）+ 单测 |
| 11/02（周一） | 阶段 2.2 | Canvas 渲染 + 桌面手感调优 |
| 11/03（周二） | 阶段 2.3 | 手机摇杆 + 环境切换 + 结果页 |
| 11/04（周三） | 阶段 3 | 答错入队、成绩、打磨（粒子/抖动/提示） |
| 11/05（周四） | 阶段 4 | 门禁、文档、发布、线上验证 |

**合计 7 个自然日**，其中纯编码 6 天。

## 10 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 手机摇杆不跟手 | 手机上没法玩 | 摇杆做成"相对拖动"而非"绝对定位"；先桌面调好引擎再上摇杆 |
| 球上中文看不清 | 核心信息缺失 | 字号下限 9px + 两行 + 超长截断；实在不行改用"中文标签跟随球"（球上方浮动文字） |
| 玩家靠单词长度猜答案 | 学不到东西 | 干扰项用形近词；同长度优先 |
| Canvas 在低端机掉帧 | 体验崩 | 实体上限 20、粒子 12、不做阴影；`dt` 上限 50ms 防止切标签回来瞬移 |
| 一局写 20 次 IndexedDB 卡顿 | 结算卡 | 结算时批量入队（`bulkPut` / 循环但只一次事务） |
| 存档在多设备/多标签冲突 | 状态错乱 | 只做单标签使用；存档带 `savedAt`，7 天过期 |

## 11 测试计划

**单测（`npm run test:orb`，纯引擎，不碰 DOM）**

- 吃对：半径 ×1.08、分数 +10（含连击）、目标词切换、正确球重新生成且不与干扰球重复
- 吃错：半径 ×0.88、命 -1、连击清零、`wrongWords` 追加
- 半径下限 24、相机 scale 在 [0.35, 1] 区间、层级阈值边界（39/40/41、79/80/81）
- 时间到：`phase=over`，之后 `stepOrb` 不再改分数
- 干扰项不重复、必含正确项、正确项恰好 1 个

**浏览器实测**

- 桌面：鼠标移动吃 5 个球，验证半径/分数/层级变化，截图
- 手机 390px：摇杆拖动，验证球移动，截图
- 进度记忆：按 08 的 6 条逐条走
- 结算入队：检查 IndexedDB `flashcards` 增量与结果页数量一致

**门禁**（每次提交前）

```
type-check / test:orb（新增）/ test:packs / test:cards / test:srs
test:quest / test:markdown / test:render / test:voice
build / build:minitool（fetch = 0、无 Orb chunk、packs 已清理）
zip 审计 PASS（12 文件，约 1.23 MB）
```

## 12 后续（本期不做，留位）

1. 成语接龙：172 条成语可预生成接龙图，零美术，1.5 天
2. 中英配对消除：4×4 网格，限时，1.5 天
3. 音效与背景音乐（需音频资源，端内不可用）
4. 每日挑战：固定种子 + 全服同一套题，做完可分享成绩卡
5. 小知参与：连击高时小知弹出来鼓励（复用好感度）
