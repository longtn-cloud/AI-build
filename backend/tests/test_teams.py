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


def _create_team(headers: dict, name: str = "Team") -> str:
    response = client.post("/teams", json={"name": name}, headers=headers)
    return response.json()["id"]


def test_list_members_includes_admin_and_email():
    admin_id, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)

    response = client.get(f"/teams/{team_id}/members", headers=admin_headers)

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {"user_id": admin_id, "email": "admin@example.com", "role": "admin", "added_at": body[0]["added_at"]}
    ]


def test_list_members_rejects_non_members():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    _, stranger_headers = _create_user("stranger@example.com")

    response = client.get(f"/teams/{team_id}/members", headers=stranger_headers)

    assert response.status_code == 404


def test_search_members_finds_by_email_and_excludes_existing_members():
    admin_id, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    colleague_id, _ = _create_user("colleague@example.com")

    response = client.get(
        f"/teams/{team_id}/members/search", params={"q": "colleague"}, headers=admin_headers
    )

    assert response.status_code == 200
    assert response.json() == [{"user_id": colleague_id, "email": "colleague@example.com"}]

    admin_search = client.get(
        f"/teams/{team_id}/members/search", params={"q": "admin"}, headers=admin_headers
    )
    assert admin_search.json() == []


def test_search_members_is_admin_only():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    member_id, member_headers = _create_user("member@example.com")
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)

    response = client.get(
        f"/teams/{team_id}/members/search", params={"q": "a"}, headers=member_headers
    )

    assert response.status_code == 403


def test_add_member_by_user_id():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    colleague_id, _ = _create_user("colleague@example.com")

    response = client.post(
        f"/teams/{team_id}/members", json={"user_id": colleague_id}, headers=admin_headers
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_id"] == colleague_id
    assert body["email"] == "colleague@example.com"
    assert body["role"] == "member"

    members = client.get(f"/teams/{team_id}/members", headers=admin_headers).json()
    assert len(members) == 2


def test_add_member_rejects_unknown_user():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)

    response = client.post(
        f"/teams/{team_id}/members", json={"user_id": str(uuid.uuid4())}, headers=admin_headers
    )

    assert response.status_code == 404


def test_add_member_is_admin_only():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    member_id, member_headers = _create_user("member@example.com")
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)
    other_id, _ = _create_user("other@example.com")

    response = client.post(
        f"/teams/{team_id}/members", json={"user_id": other_id}, headers=member_headers
    )

    assert response.status_code == 403


def test_remove_member():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    member_id, _ = _create_user("member@example.com")
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)

    response = client.delete(f"/teams/{team_id}/members/{member_id}", headers=admin_headers)

    assert response.status_code == 204
    members = client.get(f"/teams/{team_id}/members", headers=admin_headers).json()
    assert len(members) == 1


def test_remove_member_cannot_remove_the_admin():
    admin_id, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)

    response = client.delete(f"/teams/{team_id}/members/{admin_id}", headers=admin_headers)

    assert response.status_code == 403
