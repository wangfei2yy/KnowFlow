import { db } from "@/db/database";
import { createDocument } from "@/services/documentService";
import { createCategory } from "@/services/categoryService";
import { createTask } from "@/services/taskService";

/**
 * 内置原创示例资料（虚构内容，不含真实个人信息/密钥/内部文档）。
 * 用于「加载示例资料」入口，让用户进入即可体验完整流程。
 */
export async function seedExampleData(): Promise<void> {
  const existing = await db.documents.count();
  if (existing > 0) {
    // 已有数据时不重复灌入，避免污染用户数据
    return;
  }

  const work = await createCategory("工作", "#3b6ef6");
  const study = await createCategory("学习", "#16a34a");
  const life = await createCategory("生活", "#f59e0b");

  const meeting = await createDocument({
    title: "项目周会记录（示例）",
    content:
      "本周例会讨论了 KnowFlow 首页改版方案。确定三件事：周五前完成接口联调并提交测试结果；下周一输出新版设计稿；由小王跟进用户反馈渠道的搭建。数据统计模块本周由小李负责开发。",
    sourceType: "note",
    categoryId: work.id,
    tags: ["会议", "项目"]
  });

  // 为该示例预置关联任务，用户无需 AI 提取即可在任务页看到行动项
  await createTask({
    title: "周五前完成接口联调并提交测试结果",
    sourceDocumentId: meeting.id,
    priority: "high"
  });
  await createTask({
    title: "下周一输出新版设计稿",
    sourceDocumentId: meeting.id,
    priority: "medium"
  });
  await createTask({
    title: "跟进用户反馈渠道的搭建",
    sourceDocumentId: meeting.id,
    priority: "medium"
  });

  await createDocument({
    title: "数据库索引学习笔记（示例）",
    content:
      "数据库索引是帮助数据库更快定位数据的数据结构。常见的索引类型包括 B+ 树索引和哈希索引。B+ 树索引适合范围查询和排序，哈希索引仅适合等值查询。创建索引会占用额外存储空间，并降低写入性能，因此需要根据查询场景权衡。",
    sourceType: "text",
    categoryId: study.id,
    tags: ["数据库", "学习"]
  });

  await createDocument({
    title: "每周健身计划（示例）",
    content:
      "本周目标：完成三次力量训练和两次有氧。周一练胸背，周三练腿，周五练肩臂。每次训练前热身 10 分钟，训练后拉伸。饮食上控制糖分摄入，保证蛋白质充足。",
    sourceType: "note",
    categoryId: life.id,
    tags: ["健身", "计划"]
  });

  await createDocument({
    title: "Vue 3 组合式 API 要点（示例）",
    content:
      "组合式 API 通过 setup 函数组织逻辑，ref 和 reactive 用于创建响应式数据，computed 用于派生状态，watch 用于监听变化。组件间的逻辑复用可以通过自定义组合函数（composables）实现，相比 mixin 更加清晰。",
    sourceType: "text",
    categoryId: study.id,
    tags: ["前端", "Vue"]
  });

  await createDocument({
    title: "读书笔记：高效能人士的七个习惯（示例）",
    content:
      "习惯一：积极主动，把精力放在自己能影响的事情上。习惯二：以终为始，先想清楚目标再行动。习惯三：要事第一，优先处理重要但不紧急的事。习惯四：双赢思维，寻求互利的解决方案。习惯五：知彼解己，先理解别人再求被理解。习惯六：统合综效，创造 1+1>2 的成果。习惯七：不断更新，从身体、精神、智力、情感四个维度持续提升。",
    sourceType: "file",
    sourceName: "高效能人士的七个习惯.md",
    categoryId: study.id,
    tags: ["读书", "成长"]
  });

  const prd = await createDocument({
    title: "产品需求：智能待办清单（示例）",
    content:
      "功能需求：1. 支持快速添加任务，支持语音输入。2. 任务支持设置优先级和截止时间。3. 到期未完成自动提醒。4. 支持按项目分类查看。5. 数据本地保存并支持云同步。验收标准：完成以上功能并通过测试，下周五前交付第一版。",
    sourceType: "web",
    sourceName: "https://example.com/prd",
    categoryId: work.id,
    tags: ["产品", "需求"]
  });

  // 预置关联任务
  await createTask({
    title: "实现任务快速添加与语音输入",
    sourceDocumentId: prd.id,
    priority: "high"
  });
  await createTask({
    title: "实现到期未完成自动提醒",
    sourceDocumentId: prd.id,
    priority: "medium"
  });
  await createTask({
    title: "下周五前交付智能待办清单第一版",
    sourceDocumentId: prd.id,
    priority: "high"
  });

  await createDocument({
    title: "英语口语常用表达（示例）",
    content:
      "How's it going? 最近怎么样？\nLong time no see. 好久不见。\nCould you do me a favor? 能帮我个忙吗？\nI'm on it. 我马上处理。\nLet's call it a day. 今天就到这里吧。\nThat makes sense. 有道理。",
    sourceType: "note",
    categoryId: study.id,
    tags: ["英语", "口语"]
  });
}
