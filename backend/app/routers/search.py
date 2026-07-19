from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.embeddings import embed_query

router = APIRouter(tags=["search"])

PAGE_SIZE = 10
CANDIDATE_POOL = 50
RRF_K = 60
MAX_FUSED_SCORE = (1.0 / (RRF_K + 1)) * 2

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
    filter_params: list = [user_id]

    if file_type is not None:
        types = FILE_TYPE_GROUPS[file_type]
        placeholders = ", ".join(["%s"] * len(types))
        filters_sql += f" AND d.file_type IN ({placeholders})"
        filter_params.extend(types)

    if recent:
        filters_sql += " AND d.uploaded_at >= now() - interval '30 days'"

    sql = f"""
        WITH doc_chunk_counts AS (
            SELECT c.document_id, count(*) AS total_chunks
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE {filters_sql}
            GROUP BY c.document_id
        ),
        vec_candidates AS (
            SELECT
                c.id, c.document_id, c.content, c.chunk_index, d.filename,
                row_number() OVER (ORDER BY c.embedding <=> %s::vector) AS vec_rank
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE {filters_sql}
            ORDER BY c.embedding <=> %s::vector
            LIMIT {CANDIDATE_POOL}
        ),
        fts_candidates AS (
            SELECT
                c.id, c.document_id, c.content, c.chunk_index, d.filename,
                row_number() OVER (
                    ORDER BY ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', %s)) DESC
                ) AS fts_rank
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE {filters_sql} AND c.content_tsv @@ websearch_to_tsquery('english', %s)
            ORDER BY ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', %s)) DESC
            LIMIT {CANDIDATE_POOL}
        ),
        fused AS (
            SELECT
                COALESCE(v.id, f.id) AS id,
                COALESCE(v.document_id, f.document_id) AS document_id,
                COALESCE(v.filename, f.filename) AS filename,
                COALESCE(v.chunk_index, f.chunk_index) AS chunk_index,
                COALESCE(v.content, f.content) AS content,
                COALESCE(1.0 / ({RRF_K} + v.vec_rank), 0)
                    + COALESCE(1.0 / ({RRF_K} + f.fts_rank), 0) AS fused_score
            FROM vec_candidates v
            FULL OUTER JOIN fts_candidates f ON v.id = f.id
        )
        SELECT
            fused.document_id, fused.filename, fused.chunk_index,
            doc_chunk_counts.total_chunks,
            fused.content, fused.fused_score,
            count(*) OVER () AS total_matches
        FROM fused
        JOIN doc_chunk_counts ON doc_chunk_counts.document_id = fused.document_id
        ORDER BY fused.fused_score DESC
        LIMIT {PAGE_SIZE} OFFSET %s
    """

    params = (
        filter_params
        + [query_embedding]
        + filter_params
        + [query_embedding, q]
        + filter_params
        + [q, q, offset]
    )

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
                "score": min(float(row["fused_score"]) / MAX_FUSED_SCORE, 1.0),
            }
            for row in rows
        ],
        "has_more": has_more,
    }
