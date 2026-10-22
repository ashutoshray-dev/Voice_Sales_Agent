"""Tests for post-call analysis fallback behavior (F08).

Tests that malformed LLM responses produce safe defaults.
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from app.services.analysis import run
from tests.fixtures.analysis_transcripts import FIXTURE_CONVERTED


class TestFallback:
    """Test fallback behavior."""

    @pytest.mark.asyncio
    async def test_fallback_on_llm_exception(self):
        """Test fallback produces safe default when LLM raises exception."""
        with patch("app.services.analysis.call_llm_with_structured_output") as mock_llm:
            mock_llm.side_effect = Exception("LLM unavailable")

            result = await run(FIXTURE_CONVERTED)

            assert result.status == "No Response"
            assert result.customer_requirements == []
            assert result.objections == []
            assert result.next_steps == []
            assert "fallback" in result.summary.lower() or "unavailable" in result.summary.lower()

    @pytest.mark.asyncio
    async def test_fallback_on_rate_limit(self):
        """Test fallback on rate limit (429) after retry."""
        with patch("app.services.analysis.call_llm_with_structured_output") as mock_llm:
            # First call: rate limit, second call: rate limit again (retries exhausted)
            mock_llm.side_effect = [
                Exception("429 Rate limit exceeded"),
                Exception("429 Rate limit exceeded"),
            ]

            result = await run(FIXTURE_CONVERTED)

            assert result.status == "No Response"
            assert result.customer_requirements == []
            assert result.objections == []
            assert result.next_steps == []

    @pytest.mark.asyncio
    async def test_fallback_on_invalid_status(self):
        """Test fallback when LLM returns invalid status."""
        from app.models.analysis import CallAnalysis

        with patch("app.services.analysis.call_llm_with_structured_output") as mock_llm:
            # Return analysis with invalid status
            mock_llm.return_value = CallAnalysis(
                summary="Test summary",
                customer_requirements=["req1"],
                objections=[],
                next_steps=["step1"],
                status="InvalidStatus",  # Not in enum - Pydantic would catch, but test validate logic
            )

            result = await run(FIXTURE_CONVERTED)

            # Should fall back to safe default
            assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_fallback_preserves_heuristic_status(self):
        """Test fallback uses heuristic status from transcript when available."""
        with patch("app.services.analysis.call_llm_with_structured_output") as mock_llm:
            mock_llm.side_effect = Exception("LLM error")

            # Transcript with clear "buy" keyword
            transcript_with_buy = [
                {"role": "assistant", "content": "Want to buy?"},
                {"role": "user", "content": "Yes I want to buy this product"},
                {"role": "assistant", "content": "Great!"},
                {"role": "user", "content": "Let's sign up now"},
            ]

            result = await run(transcript_with_buy)

            # Fallback heuristic should detect "buy" and set Converted
            assert result.status == "Converted"
            assert "fallback" in result.summary.lower() or "heuristic" in result.summary.lower()

    @pytest.mark.asyncio
    async def test_fallback_no_response_when_short_transcript(self):
        """Test fallback returns No Response for short transcripts."""
        with patch("app.services.analysis.call_llm_with_structured_output") as mock_llm:
            mock_llm.side_effect = Exception("LLM error")

            short_transcript = [
                {"role": "assistant", "content": "Hello?"},
                {"role": "user", "content": "Hi"},
            ]

            result = await run(short_transcript)

            assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_fallback_interested_heuristic(self):
        """Test fallback detects interested from positive keywords."""
        with patch("app.services.analysis.call_llm_with_structured_output") as mock_llm:
            mock_llm.side_effect = Exception("LLM error")

            transcript = [
                {"role": "assistant", "content": "Interested in our product?"},
                {"role": "user", "content": "This looks really interesting and great!"},
                {"role": "assistant", "content": "Thanks!"},
                {"role": "user", "content": "I like what I'm hearing"},
            ]

            result = await run(transcript)

            # Should detect "interested" or "like" and set Interested
            assert result.status == "Interested"