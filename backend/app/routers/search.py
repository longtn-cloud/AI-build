from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.embeddings import embed_query

router = APIRouter(tags=["search"])


@router.get("/search")
def search(q: str = "", user_id: str = Depends(get_current_user_id)):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query must not be empty")

    query_embedding = embed_query(q)

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
                d.id AS document_id,
                d.filename,
                c.chunk_index,
                c.content,
                1 - (c.embedding <=> %s::vector) AS score,
                count(*) OVER (PARTITION BY c.document_id) AS total_chunks
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE d.user_id = %s
            ORDER BY c.embedding <=> %s::vector
            LIMIT 10
            """,
            (query_embedding, user_id, query_embedding),
        ).fetchall()

    return {
        "results": [
            {
                "document_id": str(row["document_id"]),
                "filename": row["filename"],
                "chunk_index": row["chunk_index"],
                "total_chunks": row["total_chunks"],
                "content": row["content"],
                "score": row["score"],
            }
            for row in rows
        ]
    }
