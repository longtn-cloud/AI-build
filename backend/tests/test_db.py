import uuid

from app.db import get_conn


def test_get_conn_commits_on_success():
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())

    with get_conn() as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'a.txt', 'txt', 'path/a.txt', 'ready')
            """,
            (document_id, user_id),
        )

    with get_conn() as conn:
        row = conn.execute(
            "SELECT filename FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert row["filename"] == "a.txt"


def test_get_conn_rolls_back_on_exception():
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())

    try:
        with get_conn() as conn:
            conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
            conn.execute(
                """
                INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
                VALUES (%s, %s, 'b.txt', 'txt', 'path/b.txt', 'ready')
                """,
                (document_id, user_id),
            )
            raise RuntimeError("boom")
    except RuntimeError:
        pass

    with get_conn() as conn:
        row = conn.execute(
            "SELECT filename FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert row is None
