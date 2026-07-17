import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user_with_documents(count: int) -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        for i in range(count):
            conn.execute(
                """
                INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
                VALUES (%s, %s, %s, 'txt', %s, 'ready')
                """,
                (str(uuid.uuid4()), user_id, f"doc{i}.txt", f"path/doc{i}.txt"),
            )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def test_list_documents_returns_only_own_documents():
    _, headers_a = _create_user_with_documents(2)
    _, headers_b = _create_user_with_documents(1)

    response_a = client.get("/documents", headers=headers_a)
    response_b = client.get("/documents", headers=headers_b)

    assert response_a.status_code == 200
    assert len(response_a.json()) == 2
    assert response_b.status_code == 200
    assert len(response_b.json()) == 1


def test_list_documents_omits_extracted_text_and_storage_path():
    _, headers = _create_user_with_documents(1)

    response = client.get("/documents", headers=headers)

    assert response.status_code == 200
    doc = response.json()[0]
    assert "extracted_text" not in doc
    assert "storage_path" not in doc
    assert "filename" in doc
    assert "status" in doc
