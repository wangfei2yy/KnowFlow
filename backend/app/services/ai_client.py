"""统一 AI 客户端：调用兼容 OpenAI API 的服务。密钥仅服务端。"""
import os
import json
import time
import httpx

# 简单内存限流：按客户端 IP 限制每分钟请求数（生产可换 Redis）
_RATE: dict[str, list[float]] = {}
_RATE_LIMIT = 30  # 每分钟
_TIMEOUT = 30.0


def _check_rate(client_ip: str) -> None:
    now = time.time()
    ts = _RATE.get(client_ip, [])
    ts = [t for t in ts if now - t < 60]
    if len(ts) >= _RATE_LIMIT:
        raise RuntimeError("请求过于频繁，请稍后再试")
    ts.append(now)
    _RATE[client_ip] = ts


def _build_prompt(task_type: str, payload) -> str:
    if task_type == "summary":
        return (
            "你是资料整理助手。请基于标题和正文输出 JSON，"
            '格式：{"summary":"...","keyPoints":["..."],"keywords":["..."]}。\n\n'
            f"标题：{payload.title}\n正文：{payload.content}"
        )
    if task_type == "qa":
        ctx = "\n---\n".join(
            f"[{c['documentId']}] {c['title']}：{c['excerpt']}" for c in payload.contexts
        )
        return (
            "仅根据给定资料回答，引用资料 ID；无依据时明确说明。"
            '只输出 JSON：{"answer":"...","sources":[{"documentId":"...","title":"...","excerpt":"..."}],'
            '"confidence":"low|medium|high"}。\n\n'
            f"资料：\n{ctx}\n\n问题：{payload.question}"
        )
    if task_type == "tasks":
        return (
            "只提取文本中明确存在的任务，输出 JSON 数组："
            '[{"title":"...","description":"...","dueDate":null,"priority":"low|medium|high","evidence":"..."}]。\n\n'
            f"{payload.content}"
        )
    if task_type == "flashcards":
        return (
            "生成问答卡片，输出 JSON 数组：[{\"question\":\"...\",\"answer\":\"...\"}]。\n\n"
            f"根据以下内容生成 {payload.count} 张卡片：\n{payload.content}"
        )
    raise ValueError(f"未知任务类型：{task_type}")


async def call_model(task_type: str, payload, client_ip: str) -> dict:
    _check_rate(client_ip)

    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    if not api_key:
        raise RuntimeError("AI_PROVIDER_ERROR: 服务端未配置 API Key")

    prompt = _build_prompt(task_type, payload)

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        )
        resp.raise_for_status()
        data = resp.json()

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    return _parse_json(content)


def _parse_json(raw: str) -> dict:
    try:
        start = max(raw.find("{"), raw.find("["))
        if start < 0:
            raise ValueError("无 JSON 内容")
        cleaned = raw[start:].replace("```json", "").replace("```", "").strip()
        return json.loads(cleaned)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"AI 返回格式异常: {exc}") from exc
