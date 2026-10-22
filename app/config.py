"""Central configuration: env vars, product YAML, Supabase client.

Why this exists: FastAPI needs one place to read environment variables and
build shared singletons (the Supabase client). Keeping it here means later
features (F03+ F07/F08/F09) import from a single source instead of scattering
`os.getenv(...)` across the codebase.

Fail-fast behaviour:
- `config/product.yaml` missing or malformed -> raise at import time so the
  developer sees the error immediately instead of at first LLM call.
- Supabase env vars missing -> `get_supabase()` returns None; the app keeps
  running and `/health` reports `supabase_ok: false`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

# Load .env (gitignored) so local runs work without exporting vars manually.
load_dotenv()

# --- Environment -----------------------------------------------------------

ENV: str = os.getenv("ENV", "dev")
"""`dev` or `prod`. Used by /health to report which environment we are in."""

# --- Product knowledge -----------------------------------------------------

PRODUCT_YAML_PATH: Path = Path(__file__).resolve().parent.parent / "config" / "product.yaml"


def load_product_config() -> dict[str, Any]:
    """Load and parse config/product.yaml. Fails fast if missing/malformed."""
    if not PRODUCT_YAML_PATH.exists():
        raise RuntimeError(
            f"Product config not found at {PRODUCT_YAML_PATH}. "
            "Create it (see F02) before running the app."
        )
    with PRODUCT_YAML_PATH.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise RuntimeError(f"Product config at {PRODUCT_YAML_PATH} must be a YAML mapping.")
    return data


PRODUCT: dict[str, Any] = load_product_config()
"""Parsed product.yaml. Imported by prompt_builder and any feature needing it."""

# --- Supabase --------------------------------------------------------------

SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY: str | None = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY: str | None = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def get_supabase():
    """Return a Supabase client (anon key), or None if env vars are not configured.

    Why return None instead of raising: the health endpoint must report
    DB status without crashing the app, and F01 has no DB writes yet.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def get_supabase_admin():
    """Return a Supabase admin client (service role key), or None if not configured.

    Used for operations that require elevated privileges (e.g., bucket creation).
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return None
    from supabase import create_client

    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# --- LLM -------------------------------------------------------------------

LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "groq")
"""`groq` (default), `gemini`, or `ollama`. Consumed by app/services/llm.py."""

GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")
GOOGLE_API_KEY: str | None = os.getenv("GOOGLE_API_KEY")