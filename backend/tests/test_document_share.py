import uuid
from unittest.mock import MagicMock

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


def _create_document(user_id: str, filename: str = "policy.txt") -> str:
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


def _create_docx_document(user_id: str, filename: str = "notes.docx") -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents
                (id, user_id, filename, file_type, storage_path, status, extracted_text)
            VALUES (%s, %s, %s, 'docx', 'path/doc.docx', 'ready', 'Extracted paragraph text')
            """,
            (document_id, user_id, filename),
        )
    return document_id


def _create_team_with_member(admin_headers: dict, member_id: str) -> str:
    team_id = client.post("/teams", json={"name": "Team"}, headers=admin_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)
    return team_id


def test_share_document_makes_it_visible_to_team_members():
    owner_id, owner_headers = _create_user("owner@example.com")
    member_id, member_headers = _create_user("member@example.com")
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_document(owner_id)

    share = client.post(
        f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers
    )
    assert share.status_code == 201

    shared = client.get("/documents/shared", headers=member_headers)
    assert shared.status_code == 200
    assert [d["id"] for d in shared.json()] == [document_id]

    mine = client.get("/documents", headers=owner_headers).json()
    assert mine[0]["shared_team_ids"] == [team_id]


def test_share_document_rejects_non_owner():
    owner_id, owner_headers = _create_user("owner@example.com")
    document_id = _create_document(owner_id)
    _, other_headers = _create_user("other@example.com")
    other_team_id = client.post("/teams", json={"name": "Other"}, headers=other_headers).json()["id"]

    response = client.post(
        f"/documents/{document_id}/share", json={"team_id": other_team_id}, headers=other_headers
    )

    assert response.status_code == 404


def test_share_document_rejects_team_owner_does_not_belong_to():
    owner_id, owner_headers = _create_user("owner@example.com")
    document_id = _create_document(owner_id)
    _, other_headers = _create_user("other@example.com")
    other_team_id = client.post("/teams", json={"name": "Other"}, headers=other_headers).json()["id"]

    response = client.post(
        f"/documents/{document_id}/share", json={"team_id": other_team_id}, headers=owner_headers
    )

    assert response.status_code == 403


def test_unshare_document_removes_visibility():
    owner_id, owner_headers = _create_user("owner@example.com")
    member_id, member_headers = _create_user("member@example.com")
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_document(owner_id)
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.delete(f"/documents/{document_id}/share/{team_id}", headers=owner_headers)

    assert response.status_code == 204
    assert client.get("/documents/shared", headers=member_headers).json() == []


def test_team_member_can_download_shared_document(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(
        documents_router, "create_signed_url", MagicMock(return_value="https://signed.example/doc.txt")
    )

    owner_id, owner_headers = _create_user("owner@example.com")
    member_id, member_headers = _create_user("member@example.com")
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_document(owner_id)
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.get(f"/documents/{document_id}/download", headers=member_headers)

    assert response.status_code == 200
    assert response.json() == {"url": "https://signed.example/doc.txt"}


def test_non_member_cannot_download_unshared_document(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "create_signed_url", MagicMock())

    owner_id, owner_headers = _create_user("owner@example.com")
    _, other_headers = _create_user("other@example.com")
    document_id = _create_document(owner_id)

    response = client.get(f"/documents/{document_id}/download", headers=other_headers)

    assert response.status_code == 404


def test_team_member_can_preview_shared_docx_document():
    owner_id, owner_headers = _create_user("owner@example.com")
    member_id, member_headers = _create_user("member@example.com")
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_docx_document(owner_id)
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.get(f"/documents/{document_id}/preview", headers=member_headers)

    assert response.status_code == 200
    assert response.json() == {"text": "Extracted paragraph text"}


def test_non_member_cannot_preview_unshared_document():
    owner_id, owner_headers = _create_user("owner@example.com")
    _, other_headers = _create_user("other@example.com")
    document_id = _create_docx_document(owner_id)

    response = client.get(f"/documents/{document_id}/preview", headers=other_headers)

    assert response.status_code == 404
