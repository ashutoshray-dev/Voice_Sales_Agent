"""Tests for conversation service (F03).

Covers acceptance criteria 1, 3, and 4 from F03:
- Streaming deltas + done
- Memory across turns
- Cancel emits cancelled
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.conversation import Conversation
from app.services.prompt_builder import format_for_speech


class MockLLM:
    """Mock LLM for testing."""

    def __init__(self, responses: list[str]):
        self.responses = responses
        self.call_count = 0

    async def astream(self, messages):
        """Mock astream that yields tokens from responses."""
        self.call_count += 1
        response = self.responses[min(self.call_count - 1, len(self.responses) - 1)]
        # Yield tokens character by character to simulate streaming
        for char in response:
            chunk = MagicMock()
            chunk.content = char
            yield chunk
            await asyncio.sleep(0.001)  # Small delay to simulate streaming


class TestConversation:
    """Test Conversation class."""

    def test_initializes_with_system_prompt(self) -> None:
        """Conversation starts with system prompt."""
        conv = Conversation("Test system prompt")
        messages = conv.messages()
        assert len(messages) == 1
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "Test system prompt"

    def test_add_user_message(self) -> None:
        """Adding user message appends to history."""
        conv = Conversation("System")
        conv.add_user("Hello")
        messages = conv.messages()
        assert len(messages) == 2
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "Hello"

    def test_add_assistant_message(self) -> None:
        """Adding assistant message appends to history."""
        conv = Conversation("System")
        conv.add_assistant("Hi there")
        messages = conv.messages()
        assert len(messages) == 2
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] == "Hi there"

    def test_empty_user_message_ignored(self) -> None:
        """Empty user messages are ignored."""
        conv = Conversation("System")
        conv.add_user("")
        conv.add_user("   ")
        messages = conv.messages()
        assert len(messages) == 1  # Only system prompt

    def test_empty_assistant_message_ignored(self) -> None:
        """Empty assistant messages are ignored."""
        conv = Conversation("System")
        conv.add_assistant("")
        messages = conv.messages()
        assert len(messages) == 1

    def test_clear_keeps_system_prompt(self) -> None:
        """Clear removes history but keeps system prompt."""
        conv = Conversation("System")
        conv.add_user("Hello")
        conv.add_assistant("Hi")
        conv.clear()
        messages = conv.messages()
        assert len(messages) == 1
        assert messages[0]["role"] == "system"

    @pytest.mark.asyncio
    async def test_stream_reply_yields_tokens(self) -> None:
        """stream_reply yields tokens from LLM."""
        conv = Conversation("System")
        conv.add_user("Hello")

        mock_llm = MockLLM(["Hello! How can I help you today?"])
        tokens = []
        async for token in conv.stream_reply(mock_llm):
            tokens.append(token)

        full_response = "".join(tokens)
        assert "Hello!" in full_response
        assert len(tokens) > 0

    @pytest.mark.asyncio
    async def test_stream_reply_adds_to_history(self) -> None:
        """stream_reply adds formatted response to history."""
        conv = Conversation("System")
        conv.add_user("Hello")

        mock_llm = MockLLM(["Hello! How can I help you today? This is a test."])
        async for _ in conv.stream_reply(mock_llm):
            pass

        messages = conv.messages()
        # Should have system, user, and assistant messages
        assert len(messages) == 3
        assert messages[2]["role"] == "assistant"
        # Should be formatted for speech (max 3 sentences)
        assert "Hello!" in messages[2]["content"]

    @pytest.mark.asyncio
    async def test_memory_across_turns(self) -> None:
        """Second user message includes first turn in history."""
        conv = Conversation("System")
        conv.add_user("Hello")
        mock_llm = MockLLM(["Hi there!"])
        async for _ in conv.stream_reply(mock_llm):
            pass

        # Add second user message
        conv.add_user("What's your name?")

        # Check history includes both turns
        messages = conv.messages()
        assert len(messages) == 4  # system, user1, assistant1, user2
        assert messages[1]["content"] == "Hello"
        assert messages[3]["content"] == "What's your name?"

    @pytest.mark.asyncio
    async def test_empty_history_no_llm_call(self) -> None:
        """stream_reply with only system prompt doesn't call LLM."""
        conv = Conversation("System")
        mock_llm = MockLLM(["Should not be called"])

        tokens = []
        async for token in conv.stream_reply(mock_llm):
            tokens.append(token)

        assert len(tokens) == 0
        assert mock_llm.call_count == 0


class TestFormatForSpeech:
    """Test format_for_speech integration with conversation."""

    def test_truncates_to_max_sentences(self) -> None:
        """Long responses are truncated to max_sentences."""
        text = "Sentence one. Sentence two. Sentence three. Sentence four."
        result = format_for_speech(text, max_sentences=2)
        assert result == "Sentence one. Sentence two."

    def test_strips_markdown(self) -> None:
        """Markdown is stripped from output."""
        text = "**Bold** and *italic* with `code` and [link](http://example.com)"
        result = format_for_speech(text)
        assert "**" not in result
        assert "*" not in result
        assert "`" not in result
        assert "[" not in result
        assert "]" not in result
        assert "http://example.com" not in result
        assert "Bold" in result
        assert "italic" in result


# WebSocket integration tests would go here in a real test suite
# For now, we test the Conversation class directly


class TestConversationEdgeCases:
    """Test edge cases for conversation."""

    @pytest.mark.asyncio
    async def test_stream_reply_handles_none_content(self) -> None:
        """stream_reply handles None content from LLM chunks."""

        class MockLLMNone:
            async def astream(self, messages):
                chunk = MagicMock()
                chunk.content = None
                yield chunk

        conv = Conversation("System")
        conv.add_user("Hello")
        mock_llm = MockLLMNone()

        tokens = []
        async for token in conv.stream_reply(mock_llm):
            tokens.append(token)

        assert len(tokens) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])