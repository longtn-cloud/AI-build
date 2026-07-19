import uuid

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user() -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document(user_id: str, filename: str) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, 'txt', 'path/doc.txt', 'ready')
            """,
            (document_id, user_id, filename),
        )
    return document_id


def _create_quiz(user_id: str, document_id: str) -> str:
    quiz_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO quizzes (id, user_id, document_ids) VALUES (%s, %s, %s)",
            (quiz_id, user_id, [document_id]),
        )
    return quiz_id


def test_share_quiz_and_list_shared():
    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id = _create_quiz(owner_id, document_id)

    share = client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)
    assert share.status_code == 201

    shared = client.get("/quiz/shared", headers=member_headers)
    assert shared.status_code == 200
    assert [q["id"] for q in shared.json()["quizzes"]] == [quiz_id]


def test_share_quiz_rejects_non_owner():
    owner_id, owner_headers = _create_user()
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id = _create_quiz(owner_id, document_id)
    _, other_headers = _create_user()
    other_team_id = client.post("/teams", json={"name": "Other"}, headers=other_headers).json()["id"]

    response = client.post(
        f"/quiz/{quiz_id}/share", json={"team_id": other_team_id}, headers=other_headers
    )

    assert response.status_code == 404


def test_unshare_quiz_removes_visibility():
    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id = _create_quiz(owner_id, document_id)
    client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.delete(f"/quiz/{quiz_id}/share/{team_id}", headers=owner_headers)

    assert response.status_code == 204
    assert client.get("/quiz/shared", headers=member_headers).json() == {"quizzes": []}
