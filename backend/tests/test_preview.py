import uuid

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_document(file_type: str, status: str, extracted_text: str | None) -> tuple[dict, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents
                (id, user_id, filename, file_type, storage_path, status, extracted_text)
            VALUES (%s, %s, 'file', %s, 'path/file', %s, %s)
            """,
            (document_id, user_id, file_type, status, extracted_text),
        )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return {"Authorization": f"Bearer {token}"}, document_id


def test_preview_returns_extracted_text_for_ready_docx():
    headers, document_id = _create_document("docx", "ready", "Extracted paragraph text")

    response = client.get(f"/documents/{document_id}/preview", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"text": "Extracted paragraph text"}


def test_preview_rejects_non_docx_types():
    headers, document_id = _create_document("pdf", "ready", "some text")

    response = client.get(f"/documents/{document_id}/preview", headers=headers)

    assert response.status_code == 400


def test_preview_rejects_not_ready_document():
    headers, document_id = _create_document("docx", "processing", None)

    response = client.get(f"/documents/{document_id}/preview", headers=headers)

    assert response.status_code == 409
