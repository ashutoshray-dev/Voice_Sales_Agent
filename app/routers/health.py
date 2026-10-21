"""Health check endpoint.

GET /health -> {"status":"ok","env":"dev|prod","supabase_ok":bool,"timestamp":"..."}
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.config import ENV, get_supabase

router = APIRouter(tags=["health"])


def check_supabase() -> bool:
    """Return True if Supabase client can be created and a simple query works.

    Why a real query: just constructing the client doesn't prove the credentials
    are valid. A lightweight select from a known table confirms connectivity.
    """
    client = get_supabase()
    if client is None:
        return False
    try:
        # A simple select on a system table; won't affect app data.
        client.table("calls").select("id", count="exact").limit(1).execute()
        return True
    except Exception:
        return False


@router.get("/health")
def health() -> dict:
    """Health endpoint. Always returns 200; supabase_ok tells you if DB works."""
    return {
        "status": "ok",
        "env": ENV,
        "supabase_ok": check_supabase(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }