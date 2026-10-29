import { renderMarkdown, looksLikeMarkdown, markdownToPlain } from "@/utils/markdown";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

// 1) 标题分级
const h = renderMarkdown("# 一级\n\n## 二级\n\n##### 五级");
console.log("1) 标题:", h.replace(/\n/g, " "));
ok(h.includes("<h1 class=\"md-h1\">一级</h1>"), "h1 未渲染");
ok(h.includes("<h2 class=\"md-h2\">二级</h2>"), "h2 未渲染");
ok(h.includes("<h5 class=\"md-h5\">五级</h5>"), "h5 未渲染");

// 2) GFM 表格（语法资料核心场景）
const table = renderMarkdown(
  "| 一般现在时 | am/is/are made |\n| --- | --- |\n| 现在完成时 | has/have been made |"
);
console.log("2) 表格:", table.slice(0, 120));
ok(table.includes("<table>"), "表格未渲染");
ok(table.includes("<th style=\"text-align:left\">一般现在时</th>"), "表头错误");
ok(table.includes("<td style=\"text-align:left\">has/have been made</td>"), "单元格错误");
ok(!table.includes("| ---"), "分隔行未被消费");

// 3) 表格对齐
const align = renderMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
ok(align.includes('text-align:left">a'), "左对齐失效");
ok(align.includes('text-align:center">b'), "居中失效");
ok(align.includes('text-align:right">c'), "右对齐失效");

// 4) 引用 / 列表 / 分隔线
const block = renderMarkdown("> **重点**：被动语态\n\n- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二\n\n---");
console.log("4) 块级:", block.replace(/\n/g, " ").slice(0, 200));
ok(block.includes('<blockquote class="md-quote">'), "引用未渲染");
ok(block.includes("<strong>重点</strong>"), "引用内粗体未渲染");
ok(block.includes("<ul><li>第一项</li>"), "无序列表未渲染");
ok(block.includes("<ol><li>步骤一</li>"), "有序列表未渲染");
ok(block.includes("<hr />"), "分隔线未渲染");

// 5) 行内代码里的 * 不被当成强调
const code = renderMarkdown("用 `a * b` 表示乘法，**加粗**生效");
console.log("5) 行内:", code);
ok(code.includes("<code>a * b</code>"), "行内代码内容被破坏");
ok(!code.includes("<em>"), "代码里的 * 被误判为斜体");
ok(code.includes("<strong>加粗</strong>"), "粗体失效");

// 6) 安全：HTML 必须被转义
const evil = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
console.log("6) 转义:", evil.slice(0, 90));
ok(!evil.includes("<script>"), "script 标签未转义");
ok(!evil.includes("<img"), "img 标签未转义");
ok(evil.includes("&lt;script&gt;"), "转义结果不正确");

// 7) 段落换行保留
const para = renderMarkdown("第一行\n第二行\n\n新段落");
ok(para.includes("第一行<br />第二行"), "同段换行未保留");
ok(para.split("<p").length === 3, "段落切分错误：" + para);

// 8) looksLikeMarkdown 判定
ok(looksLikeMarkdown("## 标题"), "含标题应判为 markdown");
ok(looksLikeMarkdown("| a | b |\n| - | - |"), "含表格应判为 markdown");
ok(!looksLikeMarkdown("这是一段普通笔记，没有任何结构。"), "普通文本不应判为 markdown");

// 9) markdownToPlain 提取
const plain = markdownToPlain("# 标题\n\n> 引用**粗体**\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- 列表项");
console.log("9) 纯文本:", JSON.stringify(plain));
ok(!plain.includes("#"), "残留标题符号");
ok(!plain.includes("|"), "残留表格符号");
ok(!plain.includes("**"), "残留粗体符号");
ok(plain.includes("标题") && plain.includes("列表项"), "正文丢失");

// 10) 真实语法文件片段
const real = renderMarkdown("## 1. 被动语态的各种时态\n\n##### (1) 一般现在时的被动语态\n\nI am not so easily deceived.  我不会轻易上当受骗的。");
ok(real.includes("<h2"), "真实内容二级标题未渲染");
ok(real.includes("<h5"), "真实内容五级标题未渲染");
ok(real.includes("我不会轻易上当受骗的"), "例句丢失");

console.log("MARKDOWN SMOKE PASS");
process.exit(0);
