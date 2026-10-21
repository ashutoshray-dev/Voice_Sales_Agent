"""TTS service using edge-tts for streaming speech synthesis (F06).

Provides:
- synthesize_sentence(text, voice="en-US-AriaNeural"): async generator yielding MP3 chunks via edge-tts.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import AsyncGenerator

logger = logging.getLogger(__name__)


async def synthesize_sentence(
    text: str,
    voice: str = "en-US-AriaNeural",
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> AsyncGenerator[bytes, None]:
    """Synthesize text to speech using edge-tts, yielding MP3 chunks.

    Args:
        text: The text to synthesize.
        voice: Edge TTS voice name (default: "en-US-AriaNeural").
        rate: Speech rate adjustment (e.g., "+0%", "-10%", "+20%").
        pitch: Pitch adjustment (e.g., "+0Hz", "-10Hz", "+20Hz").

    Yields:
        MP3 audio chunks as bytes.

    Raises:
        RuntimeError: If edge-tts is not installed or synthesis fails.
    """
    try:
        import edge_tts
    except ImportError:
        logger.error("edge-tts not installed. Install with: pip install edge-tts")
        raise RuntimeError("edge-tts not available")

    if not text or not text.strip():
        logger.warning("Empty text provided to synthesize_sentence")
        return

    try:
        communicate = edge_tts.Communicate(text.strip(), voice, rate=rate, pitch=pitch)

        # Stream audio chunks from edge-tts
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]
            elif chunk["type"] == "WordBoundary":
                # Word boundary info - could be used for timing if needed
                pass
            elif chunk["type"] == "SentenceBoundary":
                # Sentence boundary - could be used for chunking if needed
                pass

    except Exception as e:
        logger.exception("edge-tts synthesis failed for text: %s", text[:50])
        raise RuntimeError(f"TTS synthesis failed: {e}") from e


def encode_audio_chunk(chunk: bytes) -> str:
    """Encode audio chunk as base64 string for WebSocket transport."""
    return base64.b64encode(chunk).decode("ascii")


async def synthesize_sentence_b64(
    text: str,
    voice: str = "en-US-AriaNeural",
    rate: str = "+0%",
    pitch: str = "+0Hz",
) -> AsyncGenerator[str, None]:
    """Synthesize text to speech, yielding base64-encoded MP3 chunks.

    This is a convenience wrapper for direct WebSocket use.

    Args:
        text: The text to synthesize.
        voice: Edge TTS voice name.
        rate: Speech rate adjustment.
        pitch: Pitch adjustment.

    Yields:
        Base64-encoded MP3 audio chunks.
    """
    async for chunk in synthesize_sentence(text, voice, rate, pitch):
        yield encode_audio_chunk(chunk)