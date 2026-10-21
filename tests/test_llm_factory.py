"""Tests for LLM factory (F03).

Covers acceptance criteria 2 from F03:
- get_chat_model() with LLM_PROVIDER=groq returns a ChatGroq instance
- get_chat_model() with LLM_PROVIDER=gemini returns a ChatGoogleGenerativeAI instance
"""

import os
from unittest.mock import patch

import pytest


class TestLLMFactory:
    """Test the get_chat_model factory function."""

    def _reload_modules(self, mock_load_dotenv):
        """Reload config and llm modules to pick up env changes."""
        import importlib
        import app.config
        importlib.reload(app.config)
        import app.services.llm
        importlib.reload(app.services.llm)
        return app.config, app.services.llm

    def test_groq_provider_returns_chatgroq(self) -> None:
        """LLM_PROVIDER=groq returns ChatGroq instance."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "groq", "GROQ_API_KEY": "test-key"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                model = llm_module.get_chat_model()
                assert model.__class__.__name__ == "ChatGroq"
                # Model updated to available one on Groq
                assert model.model_name == "openai/gpt-oss-20b"

    def test_gemini_provider_returns_chatgoogle(self) -> None:
        """LLM_PROVIDER=gemini returns ChatGoogleGenerativeAI instance."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "gemini", "GOOGLE_API_KEY": "test-key"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                model = llm_module.get_chat_model()
                assert model.__class__.__name__ == "ChatGoogleGenerativeAI"
                assert model.model == "gemini-1.5-flash"

    def test_ollama_provider_returns_chatollama(self) -> None:
        """LLM_PROVIDER=ollama returns ChatOllama instance."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "ollama"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                model = llm_module.get_chat_model()
                assert model.__class__.__name__ == "ChatOllama"
                assert model.model == "llama3.1"

    def test_groq_missing_key_raises_error(self) -> None:
        """Missing GROQ_API_KEY raises RuntimeError."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "groq"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                with pytest.raises(RuntimeError, match="GROQ_API_KEY is required"):
                    llm_module.get_chat_model()

    def test_gemini_missing_key_raises_error(self) -> None:
        """Missing GOOGLE_API_KEY raises RuntimeError."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "gemini"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                with pytest.raises(RuntimeError, match="GOOGLE_API_KEY is required"):
                    llm_module.get_chat_model()

    def test_unknown_provider_raises_error(self) -> None:
        """Unknown LLM_PROVIDER raises ValueError."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "unknown"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
                    llm_module.get_chat_model()

    def test_case_insensitive_provider(self) -> None:
        """Provider names should be case-insensitive."""
        with patch.dict(os.environ, {"LLM_PROVIDER": "GROQ", "GROQ_API_KEY": "test-key"}, clear=True):
            with patch("dotenv.load_dotenv") as mock_load_dotenv:
                _, llm_module = self._reload_modules(mock_load_dotenv)
                model = llm_module.get_chat_model()
                assert model.__class__.__name__ == "ChatGroq"