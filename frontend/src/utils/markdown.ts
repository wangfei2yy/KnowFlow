/**
 * 轻量 Markdown 渲染（零依赖）。
 *
 * 只覆盖语法文档实际用到的语法，够用即可，不追求完整实现：
 *   - 标题 #~######、水平线
 *   - GFM 表格（语法资料里大量时态对照表，必须有）
 *   - 引用 >、代码块 ```、行内代码
 *   - 有序 / 无序列表
 *   - 粗体、斜体、链接
 *
 * 安全：所有文本先做 HTML 转义，再做标记替换，因此内容里出现 <script> 不会被执行。
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 行内标记：转义 → 行内代码 → 粗体 → 斜体 → 链接。
 * 转义必须放在这里（而不是整份文本前置转义），否则引用符号 > 会变成 &gt;，块级解析全部失效。
 */
function inline(text: string): string {
  let s = escapeHtml(text);

  // 行内代码先占位，避免其中的 * 被当成强调
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

function isDelimiterRow(line: string): boolean {
  return /^\s*\|?[\s:-]*\|[\s|:-]*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function renderTable(rows: string[]): string {
  const header = splitRow(rows[0]);
  const aligns = splitRow(rows[1]).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
  const body = rows.slice(2).map(splitRow);
  const th = header
    .map((c, i) => `<th style="text-align:${aligns[i] ?? "left"}">${inline(c)}</th>`)
    .join("");
  const tb = body
    .map(
      (cells) =>
        `<tr>${cells
          .map((c, i) => `<td style="text-align:${aligns[i] ?? "left"}">${inline(c)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}

function renderList(lines: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const items = lines
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))
    .map((l) => `<li>${inline(l)}</li>`)
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

/** Markdown → HTML（已转义，可直接 v-html） */
export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束的 ```
      out.push(`<pre class="md-pre"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 水平线
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    // 表格：当前行含 |，下一行是分隔行
    if (line.includes("|") && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const rows: string[] = [line];
      i += 1;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(rows));
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} class="md-h${level}">${inline(h[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // 引用（连续多行合并）
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote class="md-quote">${buf.map(inline).join("<br />")}</blockquote>`);
      continue;
    }

    // 列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      out.push(renderList(buf, false));
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      out.push(renderList(buf, true));
      continue;
    }

    // 普通段落：连续非空行合并为一段
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(?:#{1,6}\s|>|[-*+]\s|\d+\.\s|```)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isDelimiterRow(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p class="md-p">${buf.map(inline).join("<br />")}</p>`);
  }

  return out.join("\n");
}

/** 粗略判断一段文本是否含 Markdown 结构（用于决定详情页是否启用富文本渲染） */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  return /^\s*#{1,6}\s/m.test(text) || /\|.*\|/.test(text) || /^\s*```/m.test(text);
}

/** 从 Markdown 提取纯文本（用于摘要、字数统计） */
export function markdownToPlain(src: string): string {
  return (src ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^\s*[>#]+\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    // 表格分隔行（|---|:--:|）先整体删掉，否则会残留 "- - " 噪声
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
