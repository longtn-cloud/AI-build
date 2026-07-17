import uuid
from unittest.mock import MagicMock

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


def test_upload_creates_document_row(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())

    user_id, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "notes.txt"
    assert body["file_type"] == "txt"
    assert body["status"] == "uploading"
    assert body["user_id"] == user_id


def test_upload_rejects_unsupported_file_type(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())

    _, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": ("virus.exe", b"data", "application/octet-stream")},
    )

    assert response.status_code == 400


def test_upload_rejects_oversized_file(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())
    monkeypatch.setattr(settings, "max_upload_bytes", 10)

    _, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": ("notes.txt", b"more than ten bytes", "text/plain")},
    )

    assert response.status_code == 400


def test_upload_requires_auth():
    response = client.post(
        "/documents", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 401
