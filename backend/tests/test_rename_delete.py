import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app, raise_server_exceptions=False)


def _create_user_with_document() -> tuple[dict, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'old.txt', 'txt', 'path/old.txt', 'ready')
            """,
            (document_id, user_id),
        )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return {"Authorization": f"Bearer {token}"}, document_id


def test_rename_updates_filename():
    headers, document_id = _create_user_with_document()

    response = client.patch(
        f"/documents/{document_id}", headers=headers, json={"filename": "new.txt"}
    )

    assert response.status_code == 200
    assert response.json()["filename"] == "new.txt"


def test_rename_other_users_document_returns_404():
    headers, document_id = _create_user_with_document()
    other_user_headers, _ = _create_user_with_document()

    response = client.patch(
        f"/documents/{document_id}", headers=other_user_headers, json={"filename": "hijacked.txt"}
    )

    assert response.status_code == 404


def test_delete_removes_document_and_storage_file(monkeypatch):
    from app.routers import documents as documents_router

    delete_mock = MagicMock()
    monkeypatch.setattr(documents_router, "delete_file", delete_mock)

    headers, document_id = _create_user_with_document()

    response = client.delete(f"/documents/{document_id}", headers=headers)

    assert response.status_code == 204
    delete_mock.assert_called_once_with("path/old.txt")

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        row = conn.execute(
            "SELECT id FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
    assert row is None


def test_delete_other_users_document_returns_404(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "delete_file", MagicMock())

    headers, document_id = _create_user_with_document()
    other_user_headers, _ = _create_user_with_document()

    response = client.delete(f"/documents/{document_id}", headers=other_user_headers)

    assert response.status_code == 404


def test_delete_does_not_remove_document_row_when_storage_delete_fails(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(
        documents_router, "delete_file", MagicMock(side_effect=RuntimeError("storage down"))
    )

    headers, document_id = _create_user_with_document()

    response = client.delete(f"/documents/{document_id}", headers=headers)

    assert response.status_code == 500
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        row = conn.execute(
            "SELECT id FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
    assert row is not None
