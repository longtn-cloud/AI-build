import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user_with_document() -> tuple[dict, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'file.pdf', 'pdf', 'path/file.pdf', 'ready')
            """,
            (document_id, user_id),
        )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return {"Authorization": f"Bearer {token}"}, document_id


def test_download_returns_signed_url(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(
        documents_router, "create_signed_url", MagicMock(return_value="https://signed.example/file.pdf")
    )

    headers, document_id = _create_user_with_document()

    response = client.get(f"/documents/{document_id}/download", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"url": "https://signed.example/file.pdf"}


def test_download_other_users_document_returns_404(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "create_signed_url", MagicMock())

    headers, document_id = _create_user_with_document()
    other_user_headers, _ = _create_user_with_document()

    response = client.get(f"/documents/{document_id}/download", headers=other_user_headers)

    assert response.status_code == 404
