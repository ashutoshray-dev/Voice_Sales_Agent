"""Conversation management for the AI Voice Sales Bot (F03).

Provides:
- Conversation class: holds message history and provides streaming replies.
"""

from __future__ import annotations

from typing import Any

from app.services.prompt_builder import build_system_prompt, format_for_speech


class Conversation:
    """Manages a conversation with message history and streaming replies."""

    def __init__(self, system_prompt: str | None = None):
        """Initialize conversation with optional system prompt.

        Args:
            system_prompt: System prompt to prepend. If None, uses build_system_prompt().
        """
        self._messages: list[dict[str, str]] = []

        if system_prompt is None:
            system_prompt = build_system_prompt()

        self._messages.append({"role": "system", "content": system_prompt})

    def add_user(self, text: str) -> None:
        """Add a user message to the conversation.

        Args:
            text: User's message text.
        """
        if text and text.strip():
            self._messages.append({"role": "user", "content": text.strip()})

    def add_assistant(self, text: str) -> None:
        """Add an assistant message to the conversation.

        Args:
            text: Assistant's message text.
        """
        if text and text.strip():
            self._messages.append({"role": "assistant", "content": text.strip()})

    def messages(self) -> list[dict[str, str]]:
        """Get a copy of the conversation messages.

        Returns:
            List of message dicts with 'role' and 'content' keys.
        """
        return self._messages.copy()

    def clear(self) -> None:
        """Clear conversation history, keeping only the system prompt."""
        system_msg = self._messages[0] if self._messages else None
        self._messages = []
        if system_msg:
            self._messages.append(system_msg)

    async def stream_reply(
        self, llm: Any, max_sentences: int = 3
    ):
        """Stream reply tokens from the LLM.

        Args:
            llm: LangChain chat model with astream method.
            max_sentences: Maximum sentences per turn (default 3).

        Yields:
            Text tokens as they arrive from the LLM.
        """
        if not self._messages or len(self._messages) <= 1:
            # Only system prompt, no user message
            return

        buffer = ""
        sentence_buffer = ""

        async for chunk in llm.astream(self._messages):
            if chunk.content:
                token = chunk.content
                buffer += token
                sentence_buffer += token
                yield token

        # After streaming completes, format the full reply for speech
        # and add to conversation history
        formatted = format_for_speech(buffer, max_sentences=max_sentences)
        if formatted:
            self.add_assistant(formatted)