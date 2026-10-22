"""LLM provider factory and retry logic (F03).

Provides:
- get_chat_model(): factory returning a LangChain chat model with fallback support.
- with_retry(): decorator for handling 429/rate-limit and transient errors with backoff.
"""

from __future__ import annotations

import asyncio
import logging
import os
from functools import wraps
from typing import Any, Callable, TypeVar

from app.config import GOOGLE_API_KEY, GROQ_API_KEY, LLM_PROVIDER

logger = logging.getLogger(__name__)

T = TypeVar("T")


def with_retry(
    fn: Callable[..., T], retries: int = 3, base_delay: float = 1.0
) -> Callable[..., T]:
    """Wrap an async function to retry on rate limits and transient errors.

    Args:
        fn: Async function to wrap.
        retries: Maximum number of retry attempts (default 3).
        base_delay: Base delay in seconds for exponential backoff (default 1.0).

    Returns:
        Wrapped function that retries on 429/rate-limit and transient errors.
    """

    @wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> T:
        last_exception: Exception | None = None
        for attempt in range(retries + 1):
            try:
                return await fn(*args, **kwargs)
            except Exception as e:
                last_exception = e
                error_msg = str(e).lower()

                # Check if it's a rate limit error (429) or transient error
                is_rate_limit = any(
                    keyword in error_msg
                    for keyword in ["429", "rate limit", "rate_limit", "too many requests"]
                )
                is_transient = any(
                    keyword in error_msg
                    for keyword in ["timeout", "connection", "unavailable", "503", "502", "504"]
                )

                if not (is_rate_limit or is_transient):
                    # Non-retryable error, re-raise immediately
                    raise

                if attempt < retries:
                    delay = base_delay * (2 ** attempt)  # Exponential backoff
                    logger.warning(
                        "LLM call failed (attempt %d/%d): %s. Retrying in %.1fs...",
                        attempt + 1,
                        retries + 1,
                        e,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "LLM call failed after %d retries: %s", retries + 1, e
                    )

        # All retries exhausted
        raise last_exception

    return wrapper


def _create_groq_model():
    """Create Groq chat model (primary provider)."""
    if not GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY is required for Groq provider. "
            "Set it in your .env or environment."
        )
    from langchain_groq import ChatGroq

    # Use openai/gpt-oss-20b which supports tool calling on Groq
    return ChatGroq(
        model="openai/gpt-oss-20b",
        api_key=GROQ_API_KEY,
        temperature=0.3,
        max_tokens=500,
    )


def _create_gemini_model():
    """Create Gemini chat model (fallback provider)."""
    if not GOOGLE_API_KEY:
        raise RuntimeError(
            "GOOGLE_API_KEY is required for Gemini provider. "
            "Set it in your .env or environment."
        )
    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=GOOGLE_API_KEY,
        temperature=0.3,
        max_output_tokens=500,
    )


def _create_ollama_model():
    """Create Ollama chat model (offline development)."""
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model="qwen2.5:3b",
        temperature=0.3,
        num_predict=500,
    )


def get_chat_model():
    """Factory function returning a LangChain chat model with fallback support.

    Reads LLM_PROVIDER env var (default: "groq"):
    - "groq": returns ChatGroq, falls back to Gemini on failure
    - "gemini": returns ChatGoogleGenerativeAI
    - "ollama": returns ChatOllama (no fallback)

    Raises:
        RuntimeError: If required API keys are missing.
        ValueError: If LLM_PROVIDER is an unknown value.
    """
    provider = LLM_PROVIDER.lower().strip()

    if provider == "groq":
        # Primary: Groq, Fallback: Gemini
        try:
            logger.info("Initializing primary LLM provider: Groq")
            return _create_groq_model()
        except Exception as e:
            logger.warning("Failed to initialize Groq: %s. Falling back to Gemini...", e)
            try:
                logger.info("Initializing fallback LLM provider: Gemini")
                return _create_gemini_model()
            except Exception as fallback_error:
                logger.error("Fallback to Gemini also failed: %s", fallback_error)
                raise RuntimeError(f"Both Groq and Gemini failed. Groq: {e}, Gemini: {fallback_error}")

    if provider == "gemini":
        logger.info("Initializing LLM provider: Gemini")
        return _create_gemini_model()

    if provider == "ollama":
        logger.info("Initializing LLM provider: Ollama")
        return _create_ollama_model()

    raise ValueError(
        f"Unknown LLM_PROVIDER: '{provider}'. Supported: groq, gemini, ollama"
    )


# Optional: LangSmith tracing setup
def setup_langsmith() -> None:
    """Enable LangSmith tracing if LANGSMITH_TRACING=true and keys are present.

    This is a no-op if tracing is disabled or keys are missing.
    Call this at app startup (e.g., in main.py lifespan).
    """
    tracing = os.getenv("LANGSMITH_TRACING", "false").lower() == "true"
    if not tracing:
        logger.debug("LangSmith tracing disabled (LANGSMITH_TRACING != true)")
        return

    api_key = os.getenv("LANGSMITH_API_KEY")
    project = os.getenv("LANGSMITH_PROJECT", "voice-sales-agent")

    if not api_key:
        logger.warning(
            "LANGSMITH_TRACING=true but LANGSMITH_API_KEY not set. Tracing disabled."
        )
        return

    os.environ["LANGSMITH_API_KEY"] = api_key
    os.environ["LANGSMITH_PROJECT"] = project
    os.environ["LANGSMITH_TRACING"] = "true"

    logger.info("LangSmith tracing enabled for project: %s", project)