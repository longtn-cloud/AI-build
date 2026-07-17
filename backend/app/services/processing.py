from app.db import get_conn
from app.services.chunking import chunk_text
from app.services.embeddings import embed_texts
from app.services.extraction import extract_text
from app.services.storage import download_file


def process_document(document_id: str) -> None:
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT storage_path, file_type FROM documents WHERE id = %s", (document_id,)
            ).fetchone()
        if row is None:
            return

        with get_conn() as conn:
            conn.execute("UPDATE documents SET status = 'processing' WHERE id = %s", (document_id,))

        file_bytes = download_file(row["storage_path"])
        text = extract_text(file_bytes, row["file_type"])
        pieces = chunk_text(text)
        if not pieces:
            raise ValueError("No extractable text found in document")

        vectors = embed_texts(pieces)

        with get_conn() as conn:
            for index, (content, embedding) in enumerate(zip(pieces, vectors)):
                conn.execute(
                    """
                    INSERT INTO chunks (document_id, content, embedding, chunk_index)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (document_id, content, embedding, index),
                )
            conn.execute(
                "UPDATE documents SET status = 'ready', extracted_text = %s WHERE id = %s",
                (text, document_id),
            )
    except Exception as exc:
        with get_conn() as conn:
            conn.execute(
                "UPDATE documents SET status = 'failed', error_reason = %s WHERE id = %s",
                (str(exc), document_id),
            )
