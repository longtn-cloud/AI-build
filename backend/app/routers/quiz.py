import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from psycopg.types.json import Json

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.llm import generate_quiz_questions

router = APIRouter(prefix="/quiz", tags=["quiz"])

MAX_CHUNKS = 60
MIN_QUESTIONS = 5
MAX_QUESTIONS = 20


class GenerateQuizRequest(BaseModel):
    document_ids: list[str]
    num_questions: int = 10


def _validate_question(raw: dict, valid_document_ids: set[str], total_chunks_by_doc: dict[str, int]) -> dict | None:
    question = raw.get("question")
    options = raw.get("options")
    correct_answer = raw.get("correct_answer")
    source_document_id = raw.get("source_document_id")
    source_chunk_index = raw.get("source_chunk_index")

    if not isinstance(question, str) or not question.strip():
        return None
    if not isinstance(options, list) or len(options) != 4:
        return None
    if not all(isinstance(o, str) and o.strip() for o in options):
        return None
    if not isinstance(correct_answer, int) or isinstance(correct_answer, bool) or not (0 <= correct_answer <= 3):
        return None
    if not isinstance(source_document_id, str) or source_document_id not in valid_document_ids:
        return None
    total_chunks = total_chunks_by_doc.get(source_document_id)
    if not isinstance(source_chunk_index, int) or isinstance(source_chunk_index, bool):
        return None
    if total_chunks is None or not (0 <= source_chunk_index < total_chunks):
        return None

    return {
        "question": question,
        "options": options,
        "correct_answer": correct_answer,
        "source_document_id": source_document_id,
        "source_chunk_index": source_chunk_index,
    }


@router.post("/generate", status_code=201)
async def generate_quiz(body: GenerateQuizRequest, user_id: str = Depends(get_current_user_id)):
    document_ids = list(dict.fromkeys(body.document_ids))
    if not document_ids:
        raise HTTPException(status_code=400, detail="document_ids must not be empty")
    if not (MIN_QUESTIONS <= body.num_questions <= MAX_QUESTIONS):
        raise HTTPException(
            status_code=400,
            detail=f"num_questions must be between {MIN_QUESTIONS} and {MAX_QUESTIONS}",
        )

    with get_conn() as conn:
        owned_rows = conn.execute(
            "SELECT id FROM documents WHERE user_id = %s AND id = ANY(%s)",
            (user_id, document_ids),
        ).fetchall()
        if len(owned_rows) != len(document_ids):
            raise HTTPException(status_code=404, detail="One or more selected documents were not found")

        chunk_rows = conn.execute(
            """
            SELECT
                d.id AS document_id,
                d.filename,
                c.chunk_index,
                c.content,
                count(*) OVER (PARTITION BY c.document_id) AS total_chunks
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE d.user_id = %s AND d.id = ANY(%s)
            ORDER BY d.id, c.chunk_index
            """,
            (user_id, document_ids),
        ).fetchall()

        if not chunk_rows:
            raise HTTPException(
                status_code=400,
                detail="Selected documents have no content to generate a quiz from",
            )

        chunks = [
            {
                "document_id": str(r["document_id"]),
                "filename": r["filename"],
                "chunk_index": r["chunk_index"],
                "total_chunks": r["total_chunks"],
                "content": r["content"],
            }
            for r in chunk_rows[:MAX_CHUNKS]
        ]
        total_chunks_by_doc = {c["document_id"]: c["total_chunks"] for c in chunks}
        valid_document_ids = set(document_ids)

        raw_questions = generate_quiz_questions(chunks, body.num_questions)
        valid_questions = [
            q
            for raw in raw_questions
            if (q := _validate_question(raw, valid_document_ids, total_chunks_by_doc)) is not None
        ]

        if not valid_questions:
            raise HTTPException(status_code=502, detail="Failed to generate valid quiz questions")

        quiz_id = str(uuid.uuid4())
        quiz_row = conn.execute(
            """
            INSERT INTO quizzes (id, user_id, document_ids)
            VALUES (%s, %s, %s)
            RETURNING id, document_ids, created_at
            """,
            (quiz_id, user_id, document_ids),
        ).fetchone()

        question_rows = []
        for index, q in enumerate(valid_questions):
            question_id = str(uuid.uuid4())
            filename = next(c["filename"] for c in chunks if c["document_id"] == q["source_document_id"])
            source_reference = {
                "document_id": q["source_document_id"],
                "filename": filename,
                "chunk_index": q["source_chunk_index"],
                "total_chunks": total_chunks_by_doc[q["source_document_id"]],
            }
            row = conn.execute(
                """
                INSERT INTO quiz_questions
                    (id, quiz_id, question_index, question, options, correct_answer, source_reference)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, question, options
                """,
                (
                    question_id,
                    quiz_id,
                    index,
                    q["question"],
                    Json(q["options"]),
                    q["correct_answer"],
                    Json(source_reference),
                ),
            ).fetchone()
            question_rows.append(row)

    return {
        "id": str(quiz_row["id"]),
        "document_ids": [str(d) for d in quiz_row["document_ids"]],
        "requested_count": body.num_questions,
        "actual_count": len(valid_questions),
        "created_at": quiz_row["created_at"].isoformat(),
        "questions": [
            {"id": str(r["id"]), "question": r["question"], "options": r["options"]}
            for r in question_rows
        ],
    }
