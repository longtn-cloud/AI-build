import uuid
from datetime import datetime, timezone

from app.db import get_conn
from app.models import DocumentOut


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


def test_document_out_accepts_uuid_objects_from_dict_row():
    document_id = uuid.uuid4()
    user_id = uuid.uuid4()

    row = {
        "id": document_id,
        "user_id": user_id,
        "filename": "a.txt",
        "file_type": "txt",
        "storage_path": "path/a.txt",
        "status": "ready",
        "error_reason": None,
        "extracted_text": None,
        "uploaded_at": datetime.now(timezone.utc),
    }

    result = DocumentOut(**row)

    assert isinstance(result.id, str)
    assert isinstance(result.user_id, str)
    assert result.id == str(document_id)
    assert result.user_id == str(user_id)
