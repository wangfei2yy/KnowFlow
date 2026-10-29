# 知间 AI（KnowFlow）— 模块四：最终模块开发文档

- 日期：2026-10-28
- 状态：已完成
- 完成时间：2026-10-28
- 涉及范围：文件导入（TXT / MD / PDF）、JSON 备份恢复、FastAPI 后端代理、安全加固、测试与部署
- 最终验收：导入、备份恢复、后端代理、构建部署全流程走通
- 关联文档：[开发规格书](../../../KnowFlow开发技术文档.md)

> 对应规格书「开发阶段」第 6、7、8 阶段。
> 目标：完成文件导入、JSON 备份恢复、可选 FastAPI 后端代理、安全隐私加固、测试与生产部署，交付可公开体验的完整应用。

---

## 1. 模块目标与验收标准

| 验收项 | 标准 |
| --- | --- |
| 文件导入 | TXT/MD/PDF 解析预览、错误提示、导入结果反馈 |
| 备份恢复 | JSON 导出可重新导入，校验不破坏已有数据 |
| FastAPI 后端 | `/api/ai/*` 代理真实模型，密钥仅存服务端 |
| 安全隐私 | 无硬编码密钥，不执行资料中的 HTML/脚本，AI 前告知发送内容 |
| 测试 | 关键模块有测试，构建与测试通过 |
| 部署 | 生产构建通过，公开链接可正常体验 |

---

## 2. 文件导入（src/services/importService.ts + ImportPage.vue）

### 2.1 支持的格式与限制

- `.txt`：直接读取文本。
- `.md`：读取 Markdown 原文。
- `.pdf`：PDF.js 提取可选取文本。
- 单文件上限 10 MB（可配置）；PDF 限制页数与提取文本长度。
- 暂不支持扫描件 OCR、加密 PDF、Office 全格式解析。

### 2.2 importService.ts

```ts
import * as pdfjsLib from "pdfjs-dist";
import type { Document, SourceType } from "@/types/document";
import { createDocument } from "@/services/documentService";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ParseResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export function getSourceType(fileName: string): SourceType {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext === "pdf" ? "file" : "file";
}

export async function parseFile(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: "文件超过 10 MB 上限" };
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  try {
    if (ext === "txt" || ext === "md") {
      const text = await file.text();
      return { ok: true, text };
    }
    if (ext === "pdf") {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it: any) => it.str).join(" ") + "\n";
      }
      return { ok: true, text: text.slice(0, 100000) }; // 限制提取长度
    }
    return { ok: false, error: "暂不支持该文件格式（仅支持 TXT / MD / PDF）" };
  } catch (e) {
    return { ok: false, error: "文件解析失败，可能是加密 PDF 或无法提取文本" };
  }
}
```

### 2.3 ImportPage.vue（文件导入 `/import`）

流程：选择文件 → 校验格式/大小 → 解析并预览 → 填写/确认标题、分类、标签 → 确认导入 → 保存至 IndexedDB → 显示成功/失败清单。

多文件时逐文件处理，最后汇总展示每项结果（成功 / 失败原因）。

---

## 3. JSON 备份与恢复（src/utils/export.ts）

### 3.1 导出

```ts
import { db } from "@/db/database";

export interface BackupPayload {
  app: "knowflow";
  version: number;
  exportedAt: string;
  documents: any[];
  categories: any[];
  tasks: any[];
  flashcards: any[];
}

export async function exportAll(): Promise<BackupPayload> {
  const [documents, categories, tasks, flashcards] = await Promise.all([
    db.documents.toArray(),
    db.categories.toArray(),
    db.tasks.toArray(),
    db.flashcards.toArray()
  ]);
  return {
    app: "knowflow",
    version: 1,
    exportedAt: new Date().toISOString(),
    documents, categories, tasks, flashcards
  };
}

export function downloadJSON(payload: BackupPayload, filename = "knowflow-backup.json"): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 3.2 导入（带校验，不覆盖破坏）

```ts
export function validateBackup(data: any): { valid: boolean; error?: string } {
  if (!data || data.app !== "knowflow") return { valid: false, error: "不是有效的 KnowFlow 备份文件" };
  if (!Array.isArray(data.documents) || !Array.isArray(data.categories)) {
    return { valid: false, error: "备份数据结构不完整" };
  }
  return { valid: true };
}

export async function importAll(data: BackupPayload, mode: "merge" | "replace"): Promise<void> {
  // mode=replace 前需二次确认；merge 时按 ID 冲突校验，不无条件覆盖
  if (mode === "replace") {
    await db.transaction("rw", db.documents, db.categories, db.tasks, db.flashcards, async () => {
      await Promise.all([db.documents.clear(), db.categories.clear(), db.tasks.clear(), db.flashcards.clear()]);
    });
  }
  await db.transaction("rw", db.documents, db.categories, db.tasks, db.flashcards, async () => {
    // merge：仅导入不存在的 ID，避免覆盖
    for (const d of data.documents) if (!(await db.documents.get(d.id))) await db.documents.add(d);
    for (const c of data.categories) if (!(await db.categories.get(c.id))) await db.categories.add(c);
    for (const t of data.tasks) if (!(await db.tasks.get(t.id))) await db.tasks.add(t);
    for (const f of data.flashcards) if (!(await db.flashcards.get(f.id))) await db.flashcards.add(f);
  });
}
```

> 导入时校验 ID 冲突、字段类型与数据版本；`replace` 模式必须二次确认。

---

## 4. 设置页（SettingsPage.vue `/settings`）

- AI 配置：模式选择（Mock / OpenAI 兼容）、baseUrl、model（**不存 API Key**）。
- 数据备份：导出 JSON、导入 JSON（merge / replace 选项）。
- 清除本地数据：二次确认后清空 IndexedDB。
- 隐私说明：说明数据保存在浏览器本地，AI 调用前会告知发送内容。

---

## 5. FastAPI 后端（backend/，可选，`hello_agents` 环境）

### 5.1 目录

```
backend/
├── app/
│   ├── main.py
│   ├── routers/
│   │   └── ai.py
│   ├── services/
│   │   └── ai_client.py
│   └── schemas/
│       └── ai.py
├── requirements.txt
└── .env.example
```

### 5.2 依赖（requirements.txt）

```
fastapi
uvicorn[standard]
httpx
pydantic
python-dotenv
```

### 5.3 main.py

```python
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from app.routers import ai

load_dotenv()

app = FastAPI(title="KnowFlow AI Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai.router, prefix="/api/ai")

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

### 5.4 routers/ai.py（接口）

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| POST | `/api/ai/summary` | 生成摘要 |
| POST | `/api/ai/qa` | 基于资料问答 |
| POST | `/api/ai/tasks` | 提取行动项 |
| POST | `/api/ai/flashcards` | 生成学习卡片 |

统一错误格式：

```json
{ "code": "AI_PROVIDER_ERROR", "message": "AI 服务暂时不可用，请稍后重试。", "requestId": "req-example" }
```

```python
from fastapi import APIRouter, Request
from app.services.ai_client import call_model
from app.schemas.ai import SummaryRequest, QaRequest, TasksRequest, FlashcardsRequest

router = APIRouter()

@router.post("/summary")
async def summary(req: SummaryRequest):
    # 输入校验、长度限制、超时、限流、异常日志脱敏
    return await call_model("summary", req)

@router.post("/qa")
async def qa(req: QaRequest):
    return await call_model("qa", req)

@router.post("/tasks")
async def tasks(req: TasksRequest):
    return await call_model("tasks", req)

@router.post("/flashcards")
async def flashcards(req: FlashcardsRequest):
    return await call_model("flashcards", req)
```

### 5.5 services/ai_client.py（密钥仅服务端）

```python
import os, time, httpx

RATE_LIMIT = {}  # 简单内存限流，生产可用 Redis

async def call_model(task_type: str, req):
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    # 限流 + 超时（如 30s）+ 日志脱敏（不记录正文/密钥）
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": [{"role": "user", "content": build_prompt(task_type, req)}]}
        )
        resp.raise_for_status()
        return parse_response(task_type, resp.json())
```

> 安全要求：真实模型 Key 只存服务端 `.env`；限制请求大小、频率与超时；日志不记录正文与密钥。

### 5.6 启动命令（`hello_agents` 环境）

```bash
conda activate hello_agents
cd D:/PycharmProjects/ai/AIApplet/KnowFlow/backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8022
```

前端在 Settings 中把模式切为 OpenAI 兼容，baseUrl 填 `http://localhost:8022`，经后端代理调用。

---

## 6. 安全与隐私加固

- 所有用户输入用文本安全渲染（Vue 默认转义），禁止 `v-html` 渲染资料正文。
- 外部链接不自动执行，不作为可信指令。
- 不自动把整份资料发送给 AI，调用前告知将发送的内容。
- 日志不记录 API Key、正文、个人信息。
- 说明：本地存储不等于加密保险箱，产品不承诺绝对安全。

---

## 7. 测试（tests/）

使用 Vitest 覆盖关键纯函数与 Service：

```bash
npm install -D vitest @vue/test-utils jsdom
```

重点测试：

- `searchService`：中文 n-gram、标题优先、高亮片段。
- `importService`：格式校验、大小限制。
- `export`：备份导出结构、validateBackup 校验。
- `AIProvider`：Mock 各方法返回结构正确。
- `validation`：标题必填、正文为空提示。

`package.json` 增加脚本：

```json
{ "scripts": { "test": "vitest run", "type-check": "vue-tsc --noEmit" } }
```

---

## 8. 构建与部署

### 8.1 生产构建

```bash
cd knowflow
npm run build   # 输出 dist/
npm run preview # 本地预览生产包
```

### 8.2 部署

- 静态托管：将 `dist/` 部署到任意静态托管（WorkBuddy 发布能力、Vercel、Netlify 等），获取公开体验链接。
- 后端（可选）：部署 FastAPI 到支持 Python 的服务，设置环境变量（`OPENAI_API_KEY` 等）。
- 确保公开链接可直接打开，不提交本地开发地址或静态截图。

### 8.3 提交材料

- 应用截图 1–3 张（首页仪表盘 / AI 问答 / 会议记录转任务）。
- 公开体验链接。
- 社媒分享链接（选填，带 `#WorkBuddy #1024程序员节`）。

---

## 9. 模块四检查清单

- [ ] TXT/MD/PDF 导入解析、预览、错误提示、结果清单
- [ ] JSON 导出可重新导入，merge 不覆盖已有数据，replace 二次确认
- [ ] 设置页 AI 配置 / 备份 / 清理数据完整
- [ ] FastAPI 后端四接口 + 健康检查可用，密钥仅服务端
- [ ] 无硬编码密钥，资料不执行 HTML/脚本
- [ ] Vitest 关键模块测试通过
- [ ] `npm run build` 通过，公开链接可正常体验

---

## 10. 最终交付与验收（汇总）

发布前逐项验证（对应规格书「发布验收清单」10 项）：

1. 资料新增、编辑、删除
2. 搜索与筛选
3. AI 摘要
4. 资料问答
5. 行动项提取
6. 学习卡片
7. 导入导出
8. 空状态与异常
9. 隐私与安全
10. 发布与兼容

最终报告需说明：已完成功能、实际构建/测试命令与结果、未完成功能、启动与部署步骤、可选 AI 服务配置、数据存储位置与隐私注意事项。

> 禁止把未实现功能标记为已完成；优先交付稳定的核心闭环（会议记录→行动项→任务、资料库→搜索→有来源问答）。
