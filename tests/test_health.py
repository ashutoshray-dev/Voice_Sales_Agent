"""Tests for the /health endpoint (F01).

Covers acceptance criteria 3 and 6 from F01:
- GET /health returns HTTP 200.
- Body contains status:"ok", env, and a boolean supabase_ok.
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