import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)

TARGET_VEC = [1.0] + [0.0] * 383
DISTRACTOR_VEC = [0.0, 1.0] + [0.0] * 382


def _create_user() -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document_with_chunks(user_id: str, filename: str, chunk_vectors: list[list[float]]) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, 'txt', 'path/doc.txt', 'ready')
            """,
            (document_id, user_id, filename),
        )
        for index, vector in enumerate(chunk_vectors):
            conn.execute(
                """
                INSERT INTO chunks (document_id, content, embedding, chunk_index)
                VALUES (%s, %s, %s, %s)
                """,
                (document_id, f"chunk {index} content", vector, index),
            )
    return document_id


def test_search_returns_best_matching_chunk_first(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(
        user_id, "report.txt", [DISTRACTOR_VEC, TARGET_VEC, DISTRACTOR_VEC]
    )

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["document_id"] == document_id
    assert results[0]["filename"] == "report.txt"
    assert results[0]["chunk_index"] == 1
    assert results[0]["content"] == "chunk 1 content"
    assert results[0]["total_chunks"] == 3
    assert results[0]["score"] > results[1]["score"]


def test_search_excludes_other_users_chunks(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "mine.txt", [TARGET_VEC])

    other_user_id, _ = _create_user()
    _create_document_with_chunks(other_user_id, "theirs.txt", [TARGET_VEC])

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["mine.txt"]


def test_search_rejects_empty_query(monkeypatch):
    from app.routers import search as search_router

    embed_mock = MagicMock()
    monkeypatch.setattr(search_router, "embed_query", embed_mock)

    _, headers = _create_user()

    response = client.get("/search", params={"q": "   "}, headers=headers)

    assert response.status_code == 400
    embed_mock.assert_not_called()


def test_search_returns_empty_results_for_user_with_no_chunks(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    _, headers = _create_user()

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    assert response.status_code == 200
    assert response.json() == {"results": []}
