"""后端启动入口。

默认监听 8022（原 8000 + 22），可用环境变量 APP_PORT / PORT 覆盖：
    python run.py
    APP_PORT=9000 python run.py
"""
import os

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("APP_PORT") or os.getenv("PORT") or "8022")
    reload_flag = (os.getenv("RELOAD", "1") == "1")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=reload_flag)
