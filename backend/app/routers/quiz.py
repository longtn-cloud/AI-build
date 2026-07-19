import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from psycopg.types.json import Json

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.access import DOCUMENT_ACCESS_CLAUSE, QUIZ_ACCESS_CLAUSE, access_params, is_team_member
from app.services.llm import generate_quiz_questions, llm_error_response

router = APIRouter(prefix="/quiz", tags=["quiz"])

MAX_CHUNKS = 60
MIN_QUESTIONS = 5
MAX_QUESTIONS = 20


class GenerateQuizRequest(BaseModel):
    document_ids: list[str]
    num_questions: int = 10
    language: Literal["vi", "en"] = "vi"


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


def _cap_chunks_per_document(rows: list, max_chunks: int) -> list:
    if len(rows) <= max_chunks:
        return rows
    document_ids = list(dict.fromkeys(r["document_id"] for r in rows))
    per_doc_cap = max(1, max_chunks // len(document_ids))
    capped = []
    for doc_id in document_ids:
        capped.extend([r for r in rows if r["document_id"] == doc_id][:per_doc_cap])
    return capped[:max_chunks]


@router.post("/generate", status_code=201)
def generate_quiz(body: GenerateQuizRequest, user_id: str = Depends(get_current_user_id)):
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
            f"SELECT id FROM documents d WHERE d.id = ANY(%s) AND {DOCUMENT_ACCESS_CLAUSE}",
            (document_ids, *access_params(user_id)),
        ).fetchall()
        if len(owned_rows) != len(document_ids):
            raise HTTPException(status_code=404, detail="One or more selected documents were not found")

        chunk_rows = conn.execute(
            f"""
            SELECT
                d.id AS document_id,
                d.filename,
                c.chunk_index,
                c.content,
                count(*) OVER (PARTITION BY c.document_id) AS total_chunks
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE d.id = ANY(%s) AND {DOCUMENT_ACCESS_CLAUSE}
            ORDER BY d.id, c.chunk_index
            """,
            (document_ids, *access_params(user_id)),
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
            for r in _cap_chunks_per_document(chunk_rows, MAX_CHUNKS)
        ]
        total_chunks_by_doc = {c["document_id"]: c["total_chunks"] for c in chunks}
        valid_document_ids = set(document_ids)

        try:
            raw_questions = generate_quiz_questions(chunks, body.num_questions, body.language)
        except Exception as exc:
            status_code, detail = llm_error_response(
                exc, "Failed to generate quiz questions, please try again"
            )
            raise HTTPException(status_code=status_code, detail=detail) from exc
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


class SubmitAnswer(BaseModel):
    question_id: str
    selected_option: int


class SubmitAttemptRequest(BaseModel):
    answers: list[SubmitAnswer]


@router.post("/{quiz_id}/attempts", status_code=201)
def submit_attempt(
    quiz_id: str,
    body: SubmitAttemptRequest,
    user_id: str = Depends(get_current_user_id),
):
    with get_conn() as conn:
        quiz_row = conn.execute(
            f"SELECT id FROM quizzes q WHERE q.id = %s AND {QUIZ_ACCESS_CLAUSE}",
            (quiz_id, *access_params(user_id)),
        ).fetchone()
        if quiz_row is None:
            raise HTTPException(status_code=404, detail="Quiz not found")

        question_rows = conn.execute(
            """
            SELECT id, question_index, question, options, correct_answer, source_reference
            FROM quiz_questions
            WHERE quiz_id = %s
            ORDER BY question_index
            """,
            (quiz_id,),
        ).fetchall()

        question_ids = {str(r["id"]) for r in question_rows}
        submitted_ids = [a.question_id for a in body.answers]
        if len(submitted_ids) != len(set(submitted_ids)):
            raise HTTPException(status_code=400, detail="Duplicate question_id in answers")
        for answer in body.answers:
            if answer.question_id not in question_ids:
                raise HTTPException(status_code=400, detail="Unknown question_id")
            if not (0 <= answer.selected_option <= 3):
                raise HTTPException(status_code=400, detail="selected_option out of range")

        answer_by_question = {a.question_id: a.selected_option for a in body.answers}

        results = []
        score = 0
        for row in question_rows:
            question_id = str(row["id"])
            selected_option = answer_by_question.get(question_id)
            is_correct = selected_option is not None and selected_option == row["correct_answer"]
            if is_correct:
                score += 1
            results.append(
                {
                    "question_id": question_id,
                    "question": row["question"],
                    "options": row["options"],
                    "selected_option": selected_option,
                    "correct_answer": row["correct_answer"],
                    "is_correct": is_correct,
                    "source_reference": row["source_reference"],
                }
            )

        attempt_id = str(uuid.uuid4())
        attempt_row = conn.execute(
            """
            INSERT INTO quiz_attempts (id, quiz_id, user_id, answers, score)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, completed_at
            """,
            (
                attempt_id,
                quiz_id,
                user_id,
                Json([a.model_dump() for a in body.answers]),
                score,
            ),
        ).fetchone()

    return {
        "id": str(attempt_row["id"]),
        "quiz_id": quiz_id,
        "score": score,
        "total_questions": len(question_rows),
        "completed_at": attempt_row["completed_at"].isoformat(),
        "results": results,
    }


@router.get("/attempts")
def list_attempts(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        attempt_rows = conn.execute(
            """
            SELECT
                a.id,
                a.quiz_id,
                a.score,
                a.completed_at,
                q.document_ids,
                (SELECT count(*) FROM quiz_questions qq WHERE qq.quiz_id = a.quiz_id) AS total_questions,
                (SELECT array_agg(team_id) FROM quiz_shares WHERE quiz_id = a.quiz_id) AS shared_team_ids
            FROM quiz_attempts a
            JOIN quizzes q ON q.id = a.quiz_id
            WHERE a.user_id = %s
            ORDER BY a.completed_at DESC
            """,
            (user_id,),
        ).fetchall()

        all_document_ids = {str(d) for row in attempt_rows for d in row["document_ids"]}
        filename_rows = conn.execute(
            f"SELECT id, filename FROM documents d WHERE d.id = ANY(%s) AND {DOCUMENT_ACCESS_CLAUSE}",
            (list(all_document_ids), *access_params(user_id)),
        ).fetchall()
        filename_by_id = {str(r["id"]): r["filename"] for r in filename_rows}

    return {
        "attempts": [
            {
                "id": str(row["id"]),
                "quiz_id": str(row["quiz_id"]),
                "score": row["score"],
                "total_questions": row["total_questions"],
                "completed_at": row["completed_at"].isoformat(),
                "document_filenames": [
                    filename_by_id.get(str(d), "(deleted document)") for d in row["document_ids"]
                ],
                "shared_team_ids": [str(t) for t in (row["shared_team_ids"] or [])],
            }
            for row in attempt_rows
        ]
    }


@router.get("/shared")
def list_shared_quizzes(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT q.id, q.document_ids, q.created_at
            FROM quizzes q
            JOIN quiz_shares qs ON qs.quiz_id = q.id
            JOIN team_members tm ON tm.team_id = qs.team_id
            WHERE tm.user_id = %s
            ORDER BY q.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return {
        "quizzes": [
            {
                "id": str(row["id"]),
                "document_ids": [str(d) for d in row["document_ids"]],
                "created_at": row["created_at"].isoformat(),
            }
            for row in rows
        ]
    }


@router.get("/{quiz_id}")
def get_quiz(quiz_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        quiz_row = conn.execute(
            f"SELECT id, document_ids, created_at FROM quizzes q WHERE q.id = %s AND {QUIZ_ACCESS_CLAUSE}",
            (quiz_id, *access_params(user_id)),
        ).fetchone()
        if quiz_row is None:
            raise HTTPException(status_code=404, detail="Quiz not found")

        question_rows = conn.execute(
            """
            SELECT id, question, options
            FROM quiz_questions
            WHERE quiz_id = %s
            ORDER BY question_index
            """,
            (quiz_id,),
        ).fetchall()

    return {
        "id": str(quiz_row["id"]),
        "document_ids": [str(d) for d in quiz_row["document_ids"]],
        "requested_count": len(question_rows),
        "actual_count": len(question_rows),
        "created_at": quiz_row["created_at"].isoformat(),
        "questions": [
            {"id": str(r["id"]), "question": r["question"], "options": r["options"]}
            for r in question_rows
        ],
    }


class ShareRequest(BaseModel):
    team_id: str


@router.post("/{quiz_id}/share", status_code=201)
def share_quiz(quiz_id: str, body: ShareRequest, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        quiz_row = conn.execute(
            "SELECT id FROM quizzes WHERE id = %s AND user_id = %s",
            (quiz_id, user_id),
        ).fetchone()
        if quiz_row is None:
            raise HTTPException(status_code=404, detail="Quiz not found")
        if not is_team_member(conn, body.team_id, user_id):
            raise HTTPException(status_code=403, detail="You are not a member of this team")

        row = conn.execute(
            """
            INSERT INTO quiz_shares (quiz_id, team_id, shared_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (quiz_id, team_id) DO NOTHING
            RETURNING shared_at
            """,
            (quiz_id, body.team_id, user_id),
        ).fetchone()
        if row is None:
            row = conn.execute(
                "SELECT shared_at FROM quiz_shares WHERE quiz_id = %s AND team_id = %s",
                (quiz_id, body.team_id),
            ).fetchone()

    return {"quiz_id": quiz_id, "team_id": body.team_id, "shared_at": row["shared_at"].isoformat()}


@router.delete("/{quiz_id}/share/{team_id}", status_code=204)
def unshare_quiz(quiz_id: str, team_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        quiz_row = conn.execute(
            "SELECT id FROM quizzes WHERE id = %s AND user_id = %s",
            (quiz_id, user_id),
        ).fetchone()
        if quiz_row is None:
            raise HTTPException(status_code=404, detail="Quiz not found")
        conn.execute(
            "DELETE FROM quiz_shares WHERE quiz_id = %s AND team_id = %s",
            (quiz_id, team_id),
        )
