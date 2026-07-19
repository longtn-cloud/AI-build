import uuid
from datetime import datetime, timedelta, timezone
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


def _create_document_with_chunks(
    user_id: str,
    filename: str,
    chunk_vectors: list[list[float]],
    file_type: str = "txt",
    contents: list[str] | None = None,
    uploaded_at: datetime | None = None,
) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status, uploaded_at)
            VALUES (%s, %s, %s, %s, 'path/doc', 'ready', COALESCE(%s, now()))
            """,
            (document_id, user_id, filename, file_type, uploaded_at),
        )
        for index, vector in enumerate(chunk_vectors):
            content = contents[index] if contents else f"chunk {index} content"
            conn.execute(
                """
                INSERT INTO chunks (document_id, content, embedding, chunk_index)
                VALUES (%s, %s, %s, %s)
                """,
                (document_id, content, vector, index),
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


def test_search_rejects_invalid_file_type(monkeypatch):
    from app.routers import search as search_router

    embed_mock = MagicMock()
    monkeypatch.setattr(search_router, "embed_query", embed_mock)

    _, headers = _create_user()

    response = client.get(
        "/search", params={"q": "revenue", "file_type": "exe"}, headers=headers
    )

    assert response.status_code == 400
    embed_mock.assert_not_called()


def test_search_returns_empty_results_for_user_with_no_chunks(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    _, headers = _create_user()

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    assert response.status_code == 200
    assert response.json() == {"results": [], "has_more": False}


def test_search_file_type_filter_excludes_other_types(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "report.pdf", [TARGET_VEC], file_type="pdf")
    _create_document_with_chunks(user_id, "report.docx", [TARGET_VEC], file_type="docx")

    response = client.get(
        "/search", params={"q": "revenue", "file_type": "pdf"}, headers=headers
    )

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["report.pdf"]


def test_search_recent_filter_excludes_old_documents(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    old_timestamp = datetime.now(timezone.utc) - timedelta(days=60)
    _create_document_with_chunks(user_id, "old.txt", [TARGET_VEC], uploaded_at=old_timestamp)
    _create_document_with_chunks(user_id, "new.txt", [TARGET_VEC])

    response = client.get(
        "/search", params={"q": "revenue", "recent": "true"}, headers=headers
    )

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["new.txt"]


def test_search_paginates_with_offset_and_has_more(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    for i in range(15):
        _create_document_with_chunks(user_id, f"doc{i}.txt", [TARGET_VEC])

    first_page = client.get("/search", params={"q": "revenue"}, headers=headers).json()
    assert len(first_page["results"]) == 10
    assert first_page["has_more"] is True

    second_page = client.get(
        "/search", params={"q": "revenue", "offset": 10}, headers=headers
    ).json()
    assert len(second_page["results"]) == 5
    assert second_page["has_more"] is False


def test_search_surfaces_exact_keyword_match_despite_poor_vector_similarity(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    # 14 filler chunks with a perfect vector match but no keyword overlap.
    _create_document_with_chunks(
        user_id,
        "noise.txt",
        [TARGET_VEC] * 14,
        contents=[f"unrelated filler paragraph number {i}" for i in range(14)],
    )
    # One chunk with a terrible vector match but the exact query keyword.
    target_document_id = _create_document_with_chunks(
        user_id,
        "report.txt",
        [DISTRACTOR_VEC],
        contents=["the zyxqproj initiative launched in march"],
    )

    response = client.get("/search", params={"q": "zyxqproj"}, headers=headers)

    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["document_id"] == target_document_id
    assert results[0]["filename"] == "report.txt"
