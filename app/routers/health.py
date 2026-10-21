"""Health check endpoint.

GET /health -> {"status":"ok","env":"dev|prod","supabase_ok":bool,"llm_ok":bool,"llm_provider":str,"timestamp":"..."}
"""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import ENV, get_supabase, LLM_PROVIDER, GROQ_API_KEY, GOOGLE_API_KEY

router = APIRouter(tags=["health"])


def check_supabase() -> bool:
    """Return True if Supabase client can be created and reaches the API.

    Why this approach: we don't want the health check to fail just because
    the app tables (e.g. 'calls') haven't been created yet (F08). A successful
    REST call to any PostgREST endpoint (even a 404 on a table) proves:
    1. The URL is reachable
    2. The anon key is valid
    3. The Supabase project is active
    """
    client = get_supabase()
    if client is None:
        return False
    try:
        # Any call to the PostgREST API works. We use a non-existent table
        # on purpose — a 404 still means the API responded. If the project
        # is paused or keys are wrong, we'll get a different error or timeout.
        client.table("_health_check").select("id").limit(1).execute()
        return True
    except Exception as e:
        # If the error mentions the table not found, that's actually success
        # (the API responded). Otherwise it's a real connectivity failure.
        msg = str(e).lower()
        if "could not find the table" in msg or "404" in msg or "pgrst205" in msg:
            return True
        return False


def check_llm() -> tuple[bool, str]:
    """Check if LLM provider is configured correctly.

    Returns:
        Tuple of (is_ok, provider_name)
    """
    provider = LLM_PROVIDER.lower().strip()
    if provider == "groq":
        return bool(GROQ_API_KEY), "groq"
    elif provider == "gemini":
        return bool(GOOGLE_API_KEY), "gemini"
    elif provider == "ollama":
        # Ollama doesn't require an API key, just a running server
        return True, "ollama"
    else:
        return False, provider


@router.get("/health")
def health() -> dict:
    """Health endpoint. Always returns 200; supabase_ok and llm_ok tell you if deps work."""
    supabase_ok = check_supabase()
    llm_ok, llm_provider = check_llm()

    return {
        "status": "ok",
        "env": ENV,
        "supabase_ok": supabase_ok,
        "llm_ok": llm_ok,
        "llm_provider": llm_provider,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }