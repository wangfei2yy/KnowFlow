# 计划目录

计划按状态分目录保存：

- `active/`：进行中的计划；
- `completed/`：已经完成或已收口的计划。

每个计划使用一个带日期前缀的独立文件夹，Markdown 文件名与文件夹同名。

## 进行中

| 日期 | 计划 | 文件 |
| --- | --- | --- |
| 2026-10-29 | v5 迭代：成语与饮食「从陈列到可用」 | [2026-10-29-v5-idiom-and-kitchen-flexible.md](active/2026-10-29-v5-idiom-and-kitchen-flexible/2026-10-29-v5-idiom-and-kitchen-flexible.md) |

## 已完成

| 日期 | 计划 | 文件 |
| --- | --- | --- |
| 2026-10-28 | 模块一：基础模块（项目初始化、数据模型、资料 CRUD、首页） | [2026-10-28-module-1-foundation.md](completed/2026-10-28-module-1-foundation/2026-10-28-module-1-foundation.md) |
| 2026-10-28 | 模块二：完善模块（全文搜索、筛选、任务、学习卡片） | [2026-10-28-module-2-polish.md](completed/2026-10-28-module-2-polish/2026-10-28-module-2-polish.md) |
| 2026-10-28 | 模块三：增强模块（AI Provider 与四类 AI 能力） | [2026-10-28-module-3-ai-enhancement.md](completed/2026-10-28-module-3-ai-enhancement/2026-10-28-module-3-ai-enhancement.md) |
| 2026-10-28 | 模块四：最终模块（导入、备份、后端代理、部署） | [2026-10-28-module-4-final-delivery.md](completed/2026-10-28-module-4-final-delivery/2026-10-28-module-4-final-delivery.md) |
| 2026-10-28 | v2 迭代：学习闭环与体验优化（完成于 2026-10-29） | [2026-10-28-v2-learning-loop-and-ux.md](completed/2026-10-28-v2-learning-loop-and-ux/2026-10-28-v2-learning-loop-and-ux.md) |
| 2026-10-29 | v3 迭代：学习进度记忆 + 单词球球（完成于 2026-10-29） | [2026-10-29-v3-progress-memory-and-word-orb.md](completed/2026-10-29-v3-progress-memory-and-word-orb/2026-10-29-v3-progress-memory-and-word-orb.md) |
| 2026-10-29 | v4 迭代：食材图鉴（营养与功效）（完成于 2026-10-29） | [2026-10-29-v4-food-atlas.md](completed/2026-10-29-v4-food-atlas/2026-10-29-v4-food-atlas.md) |

## 不在本目录的文档

以下文档不属于「计划」，已移出 `plans/`：

| 文档 | 位置 | 说明 |
| --- | --- | --- |
| 开发规格书 | [docs/KnowFlow开发技术文档.md](../KnowFlow开发技术文档.md) | 完整技术需求规格，所有模块文档的上级规格 |
| 活动要求描述 | [docs/开发要求描述.md](../开发要求描述.md) | 1024 造物挑战赛活动细则 |
| Test.py | `docs/_archive/Test.py` | 与本项目无关的一次性脚本，仅归档保留 |

## 约定

- **何时移动**：计划全部验收通过、线上验证完成后，`git mv` 到 `completed/<slug>/`，同时更新本索引的表格位置；
- **命名**：目录名与文件名统一为 `YYYY-MM-DD-英文短横线 slug`，中文标题写在文档一级标题里；
- **头部元信息**：`active` 用 `> 制定日期 / 状态 / 关联决策 / 前置文档`，`completed` 用 `- 日期 / 状态 / 完成时间 / 涉及范围 / 最终验收 / 关联文档`；
- **正文结构**：一级标题 → `## 一、xxx`（中文序号）→ `### 1.1 xxx`（数字子节），与参考项目 `storyAgent/docs/plans` 保持一致；
- **附属文件**：同一计划的截图、数据样例、补充说明放在该计划自己的目录里，不散落到 `plans/` 根下。
