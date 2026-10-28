# 知间 AI（KnowFlow）

AI 万能资料管家 · 个人知识与行动中心

让知识不止于收藏，让信息最终成为行动。

## 项目结构

```
KnowFlow/
├── docs/                 # 需求文档与开发文档
├── frontend/             # 前端（Vue 3 + TS + Vite）
└── backend/              # 后端（FastAPI，可选）
```

## 技术栈

- **前端**：Vue 3 + TypeScript + Vite + Pinia + Vue Router + Tailwind CSS + Dexie.js（IndexedDB）
- **后端**（可选）：FastAPI + Python（`hello_agents` conda 环境）

## 启动前端

```bash
cd frontend
npm install
npm run dev        # 开发预览
npm run build      # 生产构建
npm run preview    # 预览生产包
```

## 数据存储

默认「本地优先」：资料保存在浏览器 IndexedDB 中，无需后端即可运行全部核心功能。

## AI 功能

- 默认使用**演示模式（MockAIProvider）**，无需任何密钥即可体验摘要、资料问答、行动项提取、卡片生成。
- 接入真实模型时，通过 FastAPI 后端代理（密钥仅存服务端）。

## 启动后端（可选）

```bash
conda activate hello_agents
cd backend
cp .env.example .env      # 编辑填入 OPENAI_API_KEY
uvicorn app.main:app --reload --port 8022   # 或直接 python run.py（默认 8022）
```

然后在「设置 → AI 配置」中切换为「接入真实模型」，填入后端地址 `http://localhost:8022`。

## 发布

前端为纯静态应用，`npm run build` 产出 `dist/`，可部署到任意静态托管（WorkBuddy 发布、Vercel、Netlify 等）。
已使用 hash 路由（`#/...`）与相对路径（`base: "./"`），可直接部署到任意子路径，刷新不 404。

## 详细文档

- 开发规格书：`docs/plans/KnowFlow开发技术文档.md`
- 四大模块开发文档：`docs/plans/模块一~四_*.md`
- 环境依赖：`docs/开发依赖文档.md`
