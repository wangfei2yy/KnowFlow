from typing import List, Optional
from pydantic import BaseModel


class SummaryRequest(BaseModel):
    title: str
    content: str


class SourceItem(BaseModel):
    documentId: str
    title: str
    excerpt: str


class QaRequest(BaseModel):
    question: str
    contexts: List[SourceItem] = []


class TasksRequest(BaseModel):
    content: str


class FlashcardsRequest(BaseModel):
    content: str
    count: int = 3
