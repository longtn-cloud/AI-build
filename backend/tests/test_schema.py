import uuid

import psycopg

from tests.conftest import TEST_DB_URL


def test_can_insert_and_read_document_with_chunk():
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'report.pdf', 'pdf', %s, 'ready')
            """,
            (document_id, user_id, f"{user_id}/{document_id}.pdf"),
        )
        embedding = [0.1] * 512
        conn.execute(
            """
            INSERT INTO chunks (document_id, content, embedding, chunk_index)
            VALUES (%s, 'hello world', %s, 0)
            """,
            (document_id, embedding),
        )
        row = conn.execute(
            "SELECT filename, status FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert row == ("report.pdf", "ready")
