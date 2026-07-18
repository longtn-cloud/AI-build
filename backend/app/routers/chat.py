import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from psycopg.types.json import Json

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.embeddings import embed_query
from app.services.llm import answer_from_chunks, answer_with_web_search

router = APIRouter(prefix="/chat", tags=["chat"])

MIN_SIMILARITY_THRESHOLD = 0.5
NOT_FOUND_MESSAGE = (
    "I couldn't find relevant information in your uploaded documents to answer that question."
)


@router.post("/sessions", status_code=201)
async def create_session(user_id: str = Depends(get_current_user_id)):
    session_id = str(uuid.uuid4())
    with get_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO chat_sessions (id, user_id, title)
            VALUES (%s, %s, 'New Chat')
            RETURNING id, title, created_at
            """,
            (session_id, user_id),
        ).fetchone()
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "created_at": row["created_at"].isoformat(),
    }


class SendMessageRequest(BaseModel):
    content: str
    web_search: bool = False


def _serialize_message(row) -> dict:
    return {
        "id": str(row["id"]),
        "role": row["role"],
        "content": row["content"],
        "citations": row["citations"],
        "used_web_search": row["used_web_search"],
        "created_at": row["created_at"].isoformat(),
    }


@router.post("/sessions/{session_id}/messages", status_code=201)
async def send_message(
    session_id: str,
    body: SendMessageRequest,
    user_id: str = Depends(get_current_user_id),
):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Message content must not be empty")

    with get_conn() as conn:
        session_row = conn.execute(
            "SELECT id FROM chat_sessions WHERE id = %s AND user_id = %s",
            (session_id, user_id),
        ).fetchone()
        if session_row is None:
            raise HTTPException(status_code=404, detail="Chat session not found")

        user_message_id = str(uuid.uuid4())
        user_row = conn.execute(
            """
            INSERT INTO chat_messages (id, session_id, role, content, citations, used_web_search)
            VALUES (%s, %s, 'user', %s, '[]'::jsonb, false)
            RETURNING id, role, content, citations, used_web_search, created_at
            """,
            (user_message_id, session_id, body.content),
        ).fetchone()

    try:
        if body.web_search:
            answer_text = answer_with_web_search(body.content)
            citations: list[dict] = []
            used_web_search = True
        else:
            query_embedding = embed_query(body.content)
            with get_conn() as conn:
                chunk_rows = conn.execute(
                    """
                    SELECT * FROM (
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
                    ) sub
                    WHERE sub.score >= %s
                    ORDER BY sub.score DESC
                    LIMIT 10
                    """,
                    (query_embedding, user_id, MIN_SIMILARITY_THRESHOLD),
                ).fetchall()

            if not chunk_rows:
                answer_text = NOT_FOUND_MESSAGE
                citations = []
            else:
                chunks = [
                    {
                        "document_id": str(r["document_id"]),
                        "filename": r["filename"],
                        "chunk_index": r["chunk_index"],
                        "total_chunks": r["total_chunks"],
                        "content": r["content"],
                        "score": r["score"],
                    }
                    for r in chunk_rows
                ]
                answer_text = answer_from_chunks(body.content, chunks)
                citations = [{k: v for k, v in c.items() if k != "content"} for c in chunks]
            used_web_search = False
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail="Failed to generate a response, please try again"
        ) from exc

    with get_conn() as conn:
        assistant_message_id = str(uuid.uuid4())
        assistant_row = conn.execute(
            """
            INSERT INTO chat_messages (id, session_id, role, content, citations, used_web_search)
            VALUES (%s, %s, 'assistant', %s, %s, %s)
            RETURNING id, role, content, citations, used_web_search, created_at
            """,
            (assistant_message_id, session_id, answer_text, Json(citations), used_web_search),
        ).fetchone()

    return {
        "user_message": _serialize_message(user_row),
        "assistant_message": _serialize_message(assistant_row),
    }
