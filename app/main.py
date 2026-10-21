"""FastAPI application entry point.

Run locally:    uvicorn app.main:app --reload
Run in prod:    uvicorn app.main:app --host 0.0.0.0 --port 8000

Key responsibilities:
- Create the FastAPI app instance.
- Mount the frontend static files at /frontend.
- Include the health router (and later: ws, calls, history).
- Serve a smoke-test page at / (GET /) that exercises HTTPS + microphone.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import ENV
from app.routers import health

# --- Paths -----------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

# --- App -------------------------------------------------------------------

app = FastAPI(
    title="AI Voice Sales Bot",
    version="0.1.0",
    docs_url="/docs" if ENV == "dev" else None,
    redoc_url=None,
)

# Mount static frontend (no build step; edit HTML/CSS/JS directly)
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")

# Include routers
app.include_router(health.router)


# --- Smoke-test page -------------------------------------------------------

SMOKE_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Voice Sales Bot — Smoke Test</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    .ok { color: #157; font-weight: bold; }
    .err { color: #c11; font-weight: bold; }
    button { padding: 0.5rem 1rem; font-size: 1rem; cursor: pointer; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>AI Voice Sales Bot — Smoke Test</h1>
  <p>If you see this page, the app is running and HTTPS is working.</p>

  <div class="card">
    <h2>Microphone permission</h2>
    <p>Click below to request microphone access. You <strong>must</strong> see a browser permission prompt
    (Chrome/Edge). If you don't, check that the page loaded over HTTPS.</p>
    <button id="micBtn">Request microphone access</button>
    <p id="micResult" class="ok" style="display:none">Microphone granted ✓</p>
    <p id="micErr" class="err" style="display:none"></p>
  </div>

  <div class="card">
    <h2>Health endpoint</h2>
    <button id="healthBtn">GET /health</button>
    <pre id="healthOut">(click to fetch)</pre>
  </div>

  <script>
    const micBtn = document.getElementById('micBtn');
    const micResult = document.getElementById('micResult');
    const micErr = document.getElementById('micErr');
    micBtn.onclick = async () => {
      micBtn.disabled = true;
      micResult.style.display = 'none';
      micErr.style.display = 'none';
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        micResult.style.display = 'block';
      } catch (e) {
        micErr.textContent = 'Microphone denied or unavailable: ' + e.message;
        micErr.style.display = 'block';
      } finally {
        micBtn.disabled = false;
      }
    };

    const healthBtn = document.getElementById('healthBtn');
    const healthOut = document.getElementById('healthOut');
    healthBtn.onclick = async () => {
      healthBtn.disabled = true;
      healthOut.textContent = 'Loading...';
      try {
        const r = await fetch('/health');
        const data = await r.json();
        healthOut.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        healthOut.textContent = 'Error: ' + e.message;
      } finally {
        healthBtn.disabled = false;
      }
    };
  </script>
</body>
</html>
"""


@app.get("/")
def root() -> FileResponse:
    """Serve the smoke-test page at /.

    This is the page you open in Chrome/Edge to verify:
    1. The deploy is alive (HTML loads).
    2. HTTPS works (required for microphone).
    3. The browser microphone permission prompt appears.
    """
    from fastapi.responses import HTMLResponse

    return HTMLResponse(content=SMOKE_HTML)


@app.get("/frontend/index.html")
def frontend_index() -> FileResponse:
    """Convenience route so GET /frontend/index.html works even if the file exists."""
    path = FRONTEND_DIR / "index.html"
    if path.exists():
        return FileResponse(path)
    return FileResponse(BASE_DIR / "frontend" / "index.html")