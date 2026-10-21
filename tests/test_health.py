"""Tests for the /health endpoint (F01 + F03).

Covers acceptance criteria:
- GET /health returns HTTP 200.
- Body contains status:"ok", env, and a boolean supabase_ok.
- F03: Body contains llm_ok (bool) and llm_provider (str).
"""

from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_200_with_expected_schema() -> None:
    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "ok"
    assert body["env"] in {"dev", "prod"}
    assert isinstance(body["supabase_ok"], bool)
    assert "timestamp" in body

    # F03: LLM health check
    assert isinstance(body["llm_ok"], bool)
    assert isinstance(body["llm_provider"], str)
    assert body["llm_provider"] in {"groq", "gemini", "ollama"}