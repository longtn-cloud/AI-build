from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.embeddings import embed_query

router = APIRouter(tags=["search"])

PAGE_SIZE = 10

FILE_TYPE_GROUPS = {
    "pdf": ("pdf",),
    "docx": ("docx",),
    "text": ("txt", "md"),
}


@router.get("/search")
def search(
    q: str = "",
    file_type: str | None = None,
    recent: bool = False,
    offset: int = 0,
    user_id: str = Depends(get_current_user_id),
):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query must not be empty")

    if file_type is not None and file_type not in FILE_TYPE_GROUPS:
        raise HTTPException(status_code=400, detail=f"Unsupported file_type: {file_type}")

    query_embedding = embed_query(q)

    filters_sql = "d.user_id = %s"
    params: list = [query_embedding, user_id]

    if file_type is not None:
        types = FILE_TYPE_GROUPS[file_type]
        placeholders = ", ".join(["%s"] * len(types))
        filters_sql += f" AND d.file_type IN ({placeholders})"
        params.extend(types)

    if recent:
        filters_sql += " AND d.uploaded_at >= now() - interval '30 days'"

    sql = f"""
        SELECT
            d.id AS document_id,
            d.filename,
            c.chunk_index,
            c.content,
            1 - (c.embedding <=> %s::vector) AS score,
            count(*) OVER (PARTITION BY c.document_id) AS total_chunks,
            count(*) OVER () AS total_matches
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE {filters_sql}
        ORDER BY c.embedding <=> %s::vector
        LIMIT {PAGE_SIZE} OFFSET %s
    """

    params.append(query_embedding)
    params.append(offset)

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    total_matches = rows[0]["total_matches"] if rows else 0
    has_more = offset + PAGE_SIZE < total_matches

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
        ],
        "has_more": has_more,
    }
