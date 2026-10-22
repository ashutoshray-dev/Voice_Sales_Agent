"""Tests for post-call analysis (F08).

Tests the LangGraph pipeline with fixture transcripts covering all six statuses.
"""

from __future__ import annotations

import pytest

from app.services.analysis import run
from tests.fixtures.analysis_transcripts import (
    FIXTURE_CONVERTED,
    FIXTURE_DEMO,
    FIXTURE_FOLLOWUP,
    FIXTURE_INTERESTED,
    FIXTURE_NOT_INTERESTED,
    FIXTURE_NO_RESPONSE,
    FIXTURE_NO_RESPONSE_EMPTY,
    FIXTURE_NO_RESPONSE_ONE_TURN,
    EXPECTED_STATUSES,
)


class TestAnalysisFixtures:
    """Test analysis with all fixture transcripts."""

    @pytest.mark.asyncio
    async def test_fixture_converted(self):
        """Test converted fixture returns Converted status with next_steps."""
        result = await run(FIXTURE_CONVERTED)
        assert result.status == "Converted"
        assert len(result.next_steps) > 0, "Converted should have next steps"
        assert result.summary

    @pytest.mark.asyncio
    async def test_fixture_demo(self):
        """Test demo fixture returns Demo Requested status."""
        result = await run(FIXTURE_DEMO)
        assert result.status == "Demo Requested"
        assert result.summary

    @pytest.mark.asyncio
    async def test_fixture_not_interested(self):
        """Test not_interested fixture returns Not Interested status."""
        result = await run(FIXTURE_NOT_INTERESTED)
        assert result.status == "Not Interested"
        assert result.summary

    @pytest.mark.asyncio
    async def test_fixture_followup(self):
        """Test followup fixture returns Follow-up Required status."""
        result = await run(FIXTURE_FOLLOWUP)
        assert result.status == "Follow-up Required"
        assert result.summary

    @pytest.mark.asyncio
    async def test_fixture_interested(self):
        """Test interested fixture returns Interested status."""
        result = await run(FIXTURE_INTERESTED)
        assert result.status == "Interested"
        assert result.summary

    @pytest.mark.asyncio
    async def test_fixture_no_response(self):
        """Test no_response fixture returns No Response status."""
        result = await run(FIXTURE_NO_RESPONSE)
        assert result.status == "No Response"
        assert result.summary

    @pytest.mark.asyncio
    async def test_fixture_no_response_empty(self):
        """Test empty transcript returns No Response status."""
        result = await run(FIXTURE_NO_RESPONSE_EMPTY)
        assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_fixture_no_response_one_turn(self):
        """Test single turn transcript returns No Response status."""
        result = await run(FIXTURE_NO_RESPONSE_ONE_TURN)
        assert result.status == "No Response"


class TestAnalysisStructure:
    """Test analysis output structure."""

    @pytest.mark.asyncio
    async def test_output_has_all_fields(self):
        """Test that all required fields are present in output."""
        result = await run(FIXTURE_CONVERTED)
        assert hasattr(result, "summary")
        assert hasattr(result, "customer_requirements")
        assert hasattr(result, "objections")
        assert hasattr(result, "next_steps")
        assert hasattr(result, "status")
        assert isinstance(result.customer_requirements, list)
        assert isinstance(result.objections, list)
        assert isinstance(result.next_steps, list)

    @pytest.mark.asyncio
    async def test_status_is_valid_enum(self):
        """Test that status is always a valid enum value."""
        valid_statuses = {
            "Converted", "Interested", "Follow-up Required",
            "Not Interested", "Demo Requested", "No Response"
        }
        for fixture_name, fixture in [
            ("converted", FIXTURE_CONVERTED),
            ("demo", FIXTURE_DEMO),
            ("not_interested", FIXTURE_NOT_INTERESTED),
            ("followup", FIXTURE_FOLLOWUP),
            ("interested", FIXTURE_INTERESTED),
            ("no_response", FIXTURE_NO_RESPONSE),
        ]:
            result = await run(fixture)
            assert result.status in valid_statuses, f"{fixture_name}: invalid status {result.status}"


class TestAnalysisPrecedence:
    """Test status precedence rules."""

    @pytest.mark.asyncio
    async def test_no_response_precedence_over_converted(self):
        """Test that No Response takes precedence when < 2 substantive turns."""
        # Even with positive language, < 2 turns should be No Response
        short_positive = [
            {"role": "assistant", "content": "Hello! Want to buy our product?"},
            {"role": "user", "content": "Yes I'll buy it!"},
        ]
        # This has 2 turns but only 1 user turn - should still be No Response per rule 1
        result = await run(short_positive)
        # The rule says "fewer than 2 substantive turns" - let's check what happens
        # Actually the rule says "customer said nothing meaningful (no final transcript, or fewer than 2 substantive turns)"
        # 2 turns = 1 assistant + 1 user = 1 substantive user turn = fewer than 2 = No Response
        assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_empty_transcript_no_response(self):
        """Test empty transcript defaults to No Response."""
        result = await run([])
        assert result.status == "No Response"


class TestFallbackBehavior:
    """Test fallback behavior with mocked failures."""

    @pytest.mark.asyncio
    async def test_fallback_on_malformed_output(self, monkeypatch):
        """Test fallback produces safe default on malformed LLM output."""
        from app.services import analysis

        # Mock the LLM call to raise an exception
        original_call = analysis.call_llm_with_structured_output

        async def mock_fail(*args, **kwargs):
            raise ValueError("Invalid JSON from LLM")

        monkeypatch.setattr(analysis, "call_llm_with_structured_output", mock_fail)

        result = await run(FIXTURE_CONVERTED)

        # Should return fallback with No Response status
        assert result.status == "No Response"
        assert "fallback" in result.summary.lower() or "unavailable" in result.summary.lower()
        assert result.customer_requirements == []
        assert result.objections == []
        assert result.next_steps == []


class TestRetryLogic:
    """Test retry logic."""

    @pytest.mark.asyncio
    async def test_retry_on_first_failure(self, monkeypatch):
        """Test that analyze retries once on failure."""
        from app.services import analysis

        call_count = 0

        async def mock_fail_then_succeed(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("Network error")
            # Second call succeeds
            from app.models.analysis import CallAnalysis
            return CallAnalysis(
                summary="Test summary after retry",
                customer_requirements=["req1"],
                objections=[],
                next_steps=["step1"],
                status="Interested",
            )

        monkeypatch.setattr(analysis, "call_llm_with_structured_output", mock_fail_then_succeed)

        result = await run(FIXTURE_INTERESTED)

        # Should have retried once and succeeded
        assert call_count == 2
        assert result.status == "Interested"
        assert result.summary == "Test summary after retry"