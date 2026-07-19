import uuid

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user(email: str | None = None) -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (user_id, email))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def test_create_team_makes_caller_the_admin():
    user_id, headers = _create_user("owner@example.com")

    response = client.post("/teams", json={"name": "Engineering"}, headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Engineering"
    assert body["role"] == "admin"


def test_create_team_rejects_empty_name():
    _, headers = _create_user("owner@example.com")

    response = client.post("/teams", json={"name": "   "}, headers=headers)

    assert response.status_code == 400


def test_list_teams_returns_only_teams_the_caller_belongs_to():
    _, headers_a = _create_user("a@example.com")
    _, headers_b = _create_user("b@example.com")
    client.post("/teams", json={"name": "A's Team"}, headers=headers_a)
    client.post("/teams", json={"name": "B's Team"}, headers=headers_b)

    response = client.get("/teams", headers=headers_a)

    assert response.status_code == 200
    names = [t["name"] for t in response.json()]
    assert names == ["A's Team"]
