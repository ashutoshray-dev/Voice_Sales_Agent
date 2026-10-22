# AI Voice Sales Bot

An AI-powered voice sales agent that makes outbound calls, handles conversations naturally, and provides post-call analysis.

## 🚀 Quick Start (Run locally in 10 minutes)

### Prerequisites
- Python 3.11+
- A Supabase account (free tier)
- A Groq account (free tier) - or Google AI Studio for Gemini
- Optional: LangSmith account for tracing

### Setup Steps

1. **Clone and install dependencies**
   ```bash
   git clone <your-repo-url>
   cd Voice_sales_agent
   pip install -r requirements.txt
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in:
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (from Supabase project settings)
   - `GROQ_API_KEY` (from [Groq Console](https://console.groq.com/keys)) - or `GOOGLE_API_KEY` for Gemini
   - Optional: `LANGSMITH_API_KEY` and `LANGSMITH_PROJECT` for tracing

3. **Set up Supabase database**
   - Create a new Supabase project at [supabase.com](https://supabase.com)
   - Go to SQL Editor and run the schema from `supabase/schema.sql` (see below)
   - Create a Storage bucket named `recordings` (private, not public)

4. **Run the app**
   ```bash
   uvicorn app.main:app --reload
   ```
   Open http://localhost:8000 in Chrome/Edge (requires HTTPS for microphone - use the smoke test page at `/`)

### Supabase Schema

Run this in your Supabase SQL Editor:

```sql
-- Calls table
CREATE TABLE calls (
  id UUID PRIMARY KEY,
  device_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_sec INTEGER,
  status TEXT NOT NULL DEFAULT 'In Progress',
  summary JSONB,
  transcript JSONB DEFAULT '[]'::jsonb,
  recording_path TEXT,
  error TEXT
);

CREATE INDEX idx_calls_device_id ON calls(device_id);
CREATE INDEX idx_calls_started_at ON calls(started_at DESC);

-- Storage bucket for recordings (create via Supabase Dashboard -> Storage)
-- Name: recordings, Public: false
```

## 📖 How It Works (Architecture → File Mapping)

| Component | Description | File(s) |
|-----------|-------------|---------|
| **Entry Point** | FastAPI app, static file serving, lifespan | `app/main.py` |
| **Configuration** | Env vars, product config, Supabase client, LLM provider | `app/config.py` |
| **Health Check** | `/health` endpoint with dependency status | `app/routers/health.py` |
| **WebSocket** | Real-time conversation streaming (`/ws`) | `app/routers/ws.py` |
| **LLM Service** | Provider factory (Groq/Gemini/Ollama), retry logic | `app/services/llm.py` |
| **Conversation** | Message history, prompt building | `app/services/conversation.py` |
| **Prompt Builder** | System prompt from product.yaml | `app/services/prompt_builder.py` |
| **TTS Service** | Edge-TTS streaming synthesis | `app/services/tts.py` |
| **Call Storage** | Supabase CRUD for calls, analysis | `app/services/calls.py` |
| **Recording Storage** | Supabase Storage upload/signed URLs | `app/services/storage.py` |
| **Post-Call Analysis** | LLM-based call summarization | `app/services/analysis.py` |
| **Call Endpoints** | REST API for calls, recordings | `app/routers/calls.py`, `app/routers/recording.py` |
| **Frontend Shell** | HTML, views, routing, overlays | `frontend/index.html` |
| **State Machine** | Call state (idle→connecting→listening→thinking→speaking→ended/error) | `frontend/js/state.js` |
| **WebSocket Client** | WS connection, message handling | `frontend/js/ws.js` |
| **UI Controller** | Chat rendering, buttons, timer, overlays | `frontend/js/ui.js` |
| **Speech Input** | Web Speech API wrapper, silence detection | `frontend/js/stt.js` |
| **TTS Player** | Audio queue, playback, mute/volume | `frontend/js/tts-player.js` |
| **Consent Modal** | Recording consent via `<dialog>` | `frontend/js/consent.js` |
| **Audio Recorder** | MediaRecorder mixing mic + bot audio | `frontend/js/recorder.js` |
| **History View** | Call list, filtering, detail view | `frontend/js/history.js` |
| **Post-Call View** | Analysis display | `frontend/js/postcall.js` |
| **Styles** | Responsive CSS, mobile-first | `frontend/styles.css` |

## 🌐 Free-Tier Setup Guide

### Groq (LLM - Recommended)
1. Sign up at [groq.com](https://groq.com)
2. Create API key at [console.groq.com/keys](https://console.groq.com/keys)
3. Set `LLM_PROVIDER=groq` and `GROQ_API_KEY` in `.env`
4. Free tier: 14,400 req/day, 30 RPM

### Google Gemini (Alternative LLM)
1. Get API key at [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Set `LLM_PROVIDER=gemini` and `GOOGLE_API_KEY` in `.env`
3. Free tier: 15 RPM, 1M tokens/min

### Ollama (Local LLM - No API key needed)
1. Install [Ollama](https://ollama.ai)
2. Pull model: `ollama pull qwen2.5:3b`
3. Set `LLM_PROVIDER=ollama` in `.env`
4. Runs locally, no internet needed after model download

### Supabase (Database + Storage)
1. Create project at [supabase.com](https://supabase.com)
2. Get URL and anon key from Project Settings → API
3. Run the schema SQL (see Quick Start)
4. Create Storage bucket `recordings` (private)
5. Free tier: 500MB database, 1GB storage, 2GB bandwidth

### Render (Deployment)
1. Push repo to GitHub
2. Create Web Service at [render.com](https://render.com)
3. Connect GitHub repo
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables from `.env`
7. Free tier: 750 hrs/month, auto-spins down (cold start ~50s)

### LangSmith (Optional Tracing)
1. Sign up at [smith.langchain.com](https://smith.langchain.com)
2. Create API key
3. Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` in `.env`

## 💻 Local Development

```bash
# Start with auto-reload
uvicorn app.main:app --reload

# Run tests
pytest

# Check health endpoint
curl http://localhost:8000/health
```

## 📋 Smoke Test Checklist (8 Requirements)

See `tests/smoke_checklist.md` for the complete end-to-end verification checklist covering all 8 requirements.

## 🎬 Demo Script & Video Outline

- **3-minute walkthrough**: `DEMO_SCRIPT.md`
- **Demo video shot list**: `VIDEO_OUTLINE.md`

## 🔧 Error Handling (F10 Hardening)

| Error Scenario | Behavior |
|----------------|----------|
| Mic denied | Shows banner, falls back to typed input |
| WebSocket drop | Shows "Connection lost. Reconnecting..." overlay with Retry button |
| LLM failure (429/rate limit) | Shows "I'm getting a lot of requests right now. Could you repeat that?" |
| TTS failure (edge-tts) | Falls back to browser `speechSynthesis` with notice |
| Upload failure | Call saved with `recording_path=null`, `error` set |
| Supabase down | `/health` reports `supabase_ok: false`; calls work without persistence |
| Render cold start | Spinner shows "Connecting to the sales bot..." until WS connects |

## 📱 Mobile Responsive

- Minimum 16px side gutter at all widths
- No horizontal scroll
- Touch-friendly buttons (≥44px)
- Stacked layout on narrow screens (<480px)
- Tested at 360px and 1400px widths

## 📄 License

MIT