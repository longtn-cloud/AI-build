import uuid
from unittest.mock import MagicMock

import psycopg

from app.services import processing
from tests.conftest import TEST_DB_URL


def _create_document(file_type: str = "txt") -> tuple[str, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'doc.txt', %s, 'path/doc.txt', 'uploading')
            """,
            (document_id, user_id, file_type),
        )
    return user_id, document_id


def test_process_document_success(monkeypatch):
    _, document_id = _create_document()

    monkeypatch.setattr(processing, "download_file", lambda path: b"hello world, this is content")
    monkeypatch.setattr(processing, "embed_texts", lambda pieces: [[0.1] * 384 for _ in pieces])

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, extracted_text FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
        chunk_count = conn.execute(
            "SELECT count(*) FROM chunks WHERE document_id = %s", (document_id,)
        ).fetchone()[0]

    assert doc[0] == "ready"
    assert doc[1] == "hello world, this is content"
    assert chunk_count == 1


def test_process_document_marks_failed_on_extraction_error(monkeypatch):
    _, document_id = _create_document(file_type="exe")

    monkeypatch.setattr(processing, "download_file", lambda path: b"data")

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert doc[0] == "failed"
    assert doc[1] is not None


def test_process_document_marks_failed_on_no_extractable_text(monkeypatch):
    _, document_id = _create_document()

    monkeypatch.setattr(processing, "download_file", lambda path: b"   ")

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert doc[0] == "failed"
    assert "No extractable text" in doc[1]


def test_process_document_marks_failed_on_early_db_error(monkeypatch):
    _, document_id = _create_document()

    real_get_conn = processing.get_conn
    call_count = {"n": 0}

    def flaky_get_conn():
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated DB error during status='processing' update")
        return real_get_conn()

    monkeypatch.setattr(processing, "get_conn", flaky_get_conn)

    # Should not raise, even though the failure happens before the try/except
    # used to start (the initial SELECT / status='processing' update).
    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert doc[0] == "failed"
    assert doc[1] is not None


def test_process_document_marks_failed_on_embedding_count_mismatch(monkeypatch):
    _, document_id = _create_document()

    monkeypatch.setattr(processing, "download_file", lambda path: b"a" * 2000)
    monkeypatch.setattr(processing, "embed_texts", lambda pieces: [[0.1] * 384])

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
        chunk_count = conn.execute(
            "SELECT count(*) FROM chunks WHERE document_id = %s", (document_id,)
        ).fetchone()[0]

    assert doc[0] == "failed"
    assert "mismatch" in doc[1].lower()
    assert chunk_count == 0
