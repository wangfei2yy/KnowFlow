import uuid
from fastapi import APIRouter, Request, HTTPException
from app.schemas.ai import SummaryRequest, QaRequest, TasksRequest, FlashcardsRequest
from app.services.ai_client import call_model

router = APIRouter()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _error(message: str, code: str = "AI_PROVIDER_ERROR") -> HTTPException:
    return HTTPException(
        status_code=502,
        detail={"code": code, "message": message, "requestId": str(uuid.uuid4())[:12]},
    )


@router.post("/summary")
async def summary(req: SummaryRequest, request: Request):
    if not req.content.strip():
        raise _error("正文为空，无法生成摘要", "INVALID_INPUT")
    try:
        result = await call_model("summary", req, _client_ip(request))
        return result
    except Exception as exc:  # noqa: BLE001
        raise _error(f"AI 服务暂时不可用：{exc}") from exc


@router.post("/qa")
async def qa(req: QaRequest, request: Request):
    if not req.question.strip():
        raise _error("问题不能为空", "INVALID_INPUT")
    try:
        result = await call_model("qa", req, _client_ip(request))
        return result
    except Exception as exc:  # noqa: BLE001
        raise _error(f"AI 服务暂时不可用：{exc}") from exc


@router.post("/tasks")
async def tasks(req: TasksRequest, request: Request):
    if not req.content.strip():
        raise _error("内容为空，无法提取任务", "INVALID_INPUT")
    try:
        result = await call_model("tasks", req, _client_ip(request))
        return result
    except Exception as exc:  # noqa: BLE001
        raise _error(f"AI 服务暂时不可用：{exc}") from exc


@router.post("/flashcards")
async def flashcards(req: FlashcardsRequest, request: Request):
    if not req.content.strip():
        raise _error("内容为空，无法生成卡片", "INVALID_INPUT")
    try:
        result = await call_model("flashcards", req, _client_ip(request))
        return result
    except Exception as exc:  # noqa: BLE001
        raise _error(f"AI 服务暂时不可用：{exc}") from exc
