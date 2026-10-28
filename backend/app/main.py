import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from app.routers import ai

load_dotenv()

app = FastAPI(title="KnowFlow AI Proxy", version="0.1.0")

_origins = os.getenv("CORS_ORIGINS", "http://localhost:5195").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai.router, prefix="/api/ai")


@app.get("/api/health")
def health():
    return {"status": "ok"}
