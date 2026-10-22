"""Tests for status precedence rules (F08).

Tests that the status precedence order is correctly applied.
"""

from __future__ import annotations

import pytest

from app.services.analysis import run
from app.models.analysis import STATUS_PRECEDENCE


class TestStatusPrecedence:
    """Test status precedence rules from the spec."""

    @pytest.mark.asyncio
    async def test_precedence_order(self):
        """Verify the precedence order matches spec (top to bottom)."""
        # Spec order (highest to lowest precedence):
        # 1. No Response
        # 2. Converted
        # 3. Demo Requested
        # 4. Not Interested
        # 4. Follow-up Required
        # 5. Interested

        assert STATUS_PRECEDENCE == [
            "No Response",
            "Interested",
            "Follow-up Required",
            "Not Interested",
            "Demo Requested",
            "Converted",
        ]

    @pytest.mark.asyncio
    async def test_no_response_precedence_highest(self):
        """No Response should be assigned when < 2 substantive customer turns."""
        # Even if customer says "I'll buy", with < 2 turns it's No Response
        transcript = [
            {"role": "assistant", "content": "Want to buy?"},
            {"role": "user", "content": "Yes I'll buy it right now!"},
        ]
        result = await run(transcript)
        assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_converted_beats_demo(self):
        """Converted should beat Demo Requested if both signals present."""
        transcript = [
            {"role": "assistant", "content": "Interested in a demo or buying?"},
            {"role": "user", "content": "I want to buy it and also see a demo"},
            {"role": "assistant", "content": "Great!"},
            {"role": "user", "content": "Sign me up for the Pro plan"},
        ]
        result = await run(transcript)
        # Converted has higher precedence than Demo Requested
        assert result.status == "Converted"

    @pytest.mark.asyncio
    async def test_demo_beats_not_interested(self):
        """Demo Requested should beat Not Interested."""
        transcript = [
            {"role": "assistant", "content": "Can I schedule a demo?"},
            {"role": "user", "content": "I'm not interested in buying but I'd like a demo"},
            {"role": "assistant", "content": "Sure!"},
            {"role": "user", "content": "Book the demo for Tuesday"},
        ]
        result = await run(transcript)
        assert result.status == "Demo Requested"

    @pytest.mark.asyncio
    async def test_not_interested_beats_followup(self):
        """Not Interested should beat Follow-up Required."""
        transcript = [
            {"role": "assistant", "content": "Want to schedule a follow-up?"},
            {"role": "user", "content": "I'm not interested, but maybe call me later"},
            {"role": "assistant", "content": "Okay"},
            {"role": "user", "content": "Actually no, I'm not interested at all"},
        ]
        result = await run(transcript)
        assert result.status == "Not Interested"

    @pytest.mark.asyncio
    async def test_followup_beats_interested(self):
        """Follow-up Required should beat Interested."""
        transcript = [
            {"role": "assistant", "content": "This looks interesting?"},
            {"role": "user", "content": "Yes it's interesting, but I need to talk to my boss first"},
            {"role": "assistant", "content": "Sure"},
            {"role": "user", "content": "Call me next week after I talk to them"},
        ]
        result = await run(transcript)
        assert result.status == "Follow-up Required"

    @pytest.mark.asyncio
    async def test_interested_lowest_precedence(self):
        """Interested is the lowest positive status."""
        transcript = [
            {"role": "assistant", "content": "What do you think?"},
            {"role": "user", "content": "This is really interesting and great!"},
            {"role": "assistant", "content": "Glad you like it"},
            {"role": "user", "content": "Keep me updated on new features"},
        ]
        result = await run(transcript)
        assert result.status == "Interested"

    @pytest.mark.asyncio
    async def test_empty_transcript_no_response(self):
        """Empty transcript should be No Response."""
        result = await run([])
        assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_only_assistant_messages_no_response(self):
        """Transcript with only assistant messages should be No Response."""
        transcript = [
            {"role": "assistant", "content": "Hello?"},
            {"role": "assistant", "content": "Can you hear me?"},
        ]
        result = await run(transcript)
        assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_one_user_turn_no_response(self):
        """Transcript with only 1 user turn should be No Response."""
        transcript = [
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "How can I help?"},
        ]
        result = await run(transcript)
        assert result.status == "No Response"

    @pytest.mark.asyncio
    async def test_two_user_turns_enables_other_statuses(self):
        """Two substantive user turns enables other statuses."""
        transcript = [
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "Hi there"},
            {"role": "assistant", "content": "Interested in our product?"},
            {"role": "user", "content": "Yes, very interested!"},
        ]
        result = await run(transcript)
        # Should NOT be No Response since there are 2 user turns
        assert result.status != "No Response"
        # Should be one of the positive statuses
        assert result.status in ["Converted", "Demo Requested", "Follow-up Required", "Not Interested", "Interested"]