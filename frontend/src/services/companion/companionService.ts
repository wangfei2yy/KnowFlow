import {
  levelTitle,
  levelFromAffection,
  daysSince,
  type CompanionState
} from "./types";

/**
 * 软件答疑：规则匹配 FAQ。关键词命中返回对应说明。
 */
interface FAQItem {
  keywords: string[];
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    keywords: ["作用", "是什么", "干嘛", "介绍", "功能", "能做什么"],
    answer:
      "我是「知间 AI（KnowFlow）」——一个 AI 万能资料管家。你可以把我当成你的个人知识与行动中心：\n\n① 收集：保存笔记、文本、文件、网页内容；\n② 理解：AI 帮你生成摘要、提炼关键词；\n③ 检索：全文搜索，快速找回资料；\n④ 行动：从资料提取待办任务、制作记忆卡片复习。\n\n简单说：让知识不止于收藏，让信息最终成为行动！"
  },
  {
    keywords: ["新增", "保存", "记录", "写", "创建资料", "添加资料"],
    answer:
      "点击左侧「资料库」，再点右上角「新增资料」，或直接在首页点「新增资料」快捷入口。填好标题和正文，选分类、加标签，点「保存」即可。"
  },
  {
    keywords: ["搜索", "查找", "找", "检索"],
    answer:
      "在首页或资料库顶部的搜索框输入关键词即可实时搜索，支持标题、正文、标签检索，命中词会高亮显示。还可以按分类和收藏状态筛选哦。"
  },
  {
    keywords: ["摘要", "总结", "概括", "ai 摘要"],
    answer:
      "打开任意资料的详情页，点「生成摘要」，AI 会提炼出核心结论、重点和关键词，确认后可保存到资料中。"
  },
  {
    keywords: ["问答", "提问", "问问题", "回答"],
    answer:
      "进入「AI 工作台」，切到「资料问答」标签，输入问题即可。我会基于你保存的资料回答，并展示来源引用和原文片段，绝不凭空编造。"
  },
  {
    keywords: ["任务", "待办", "行动项", "提取"],
    answer:
      "在资料详情点「提取行动项」，或去「AI 工作台」的「提取行动项」标签，AI 会从资料中识别待办任务，你确认后即可保存到「任务清单」，还能回溯到来源资料。"
  },
  {
    keywords: ["卡片", "复习", "学习", "记忆", "闪卡"],
    answer:
      "去「AI 工作台」的「生成卡片」标签，把资料变成问答卡片，然后在「学习中心」翻面复习、标记掌握程度，让知识真正被记住。"
  },
  {
    keywords: ["导入", "文件", "pdf", "txt", "上传"],
    answer:
      "点击左侧「文件导入」，支持 TXT、Markdown 和可提取文本的 PDF，单文件不超过 10MB。拖入文件后预览、确认即可导入。"
  },
  {
    keywords: ["备份", "导出", "恢复", "数据", "设置"],
    answer:
      "在「设置」页面可以导出全部数据为 JSON 备份，随时重新导入恢复（支持合并和覆盖两种模式）。你的数据默认存在浏览器本地，隐私有保障。"
  },
  {
    keywords: ["隐私", "安全", "上传", "泄露", "云端"],
    answer:
      "放心～你的资料默认保存在浏览器本地（IndexedDB），不会上传到服务器。只有在你主动使用 AI 功能时，才会把相关内容发送处理，且会先告知你。"
  },
  {
    keywords: ["ai", "模型", "key", "密钥", "真实模型", "配置"],
    answer:
      "默认是「演示模式」，无需任何密钥就能体验全部功能。如果想接入真实大模型，需要在「设置 → AI 配置」切换，并让后端代理保管密钥（前端不接触 Key）。"
  }
];

/**
 * 根据用户输入，返回机器人的回复。
 * 优先级：软件答疑 FAQ > 闲聊问候 > 鼓励/兜底。
 */
export function getCompanionReply(input: string, state: CompanionState): string {
  const text = input.trim().toLowerCase();

  // 1. 软件答疑
  for (const faq of FAQS) {
    if (faq.keywords.some((k) => text.includes(k))) {
      return faq.answer;
    }
  }

  // 2. 问候
  if (/^(你好|hi|hello|嗨|在吗|哈喽)/.test(text)) {
    return `${greeting(state)} 我是${state.name}，你的学习小助手！有什么想了解的，或者想让我鼓励你一下吗？`
  }

  // 3. 感谢
  if (/谢谢|感谢|辛苦|棒/.test(text)) {
    return "不客气～看到你在认真使用我整理知识，我也很开心！继续保持哦 💪"
  }

  // 4. 关于机器人自己
  if (/你是谁|你叫什么|名字/.test(text)) {
    return `我是「${state.name}」，知间 AI 的陪伴型学习助手。我会在你使用软件时给你鼓励，也会解答关于软件的疑问。我们已经相处 ${daysSince(state.firstMetAt)} 天啦，好感度 ${state.affection} 分，关系等级「${levelTitle(levelFromAffection(state.affection))}」！`
  }

  // 5. 鼓励兜底
  return encouragement(state);
}

function greeting(state: CompanionState): string {
  const days = daysSince(state.firstMetAt);
  if (days === 0) return "你好呀！";
  if (days < 3) return `又见面啦！`;
  return `欢迎回来！我们已经认识 ${days} 天啦～`;
}

/**
 * 随机鼓励语，好感度/等级越高，语气越亲近。
 */
export function encouragement(state: CompanionState): string {
  const lvl = levelFromAffection(state.affection);
  const pool = [
    "每一份整理的资料，都是你为自己积累的财富，继续加油！🌟",
    "你今天又进步了一点点，学习就是这样积少成多～",
    "别小看这一条笔记，它可能在未来某天帮你大忙！",
    "完成任务的感觉是不是很棒？继续保持这个节奏！",
    "知识不会辜负努力的人，你已经做得很好了！",
    "累了就休息一下，但别忘了你已经走了很远的路。"
  ];
  const extra =
    lvl >= 3
      ? " 说真的，看着你一点点成长，我特别开心～"
      : lvl >= 1
        ? " 我们越来越有默契了呢。"
        : "";
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick + extra;
}
