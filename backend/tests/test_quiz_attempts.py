import uuid

import psycopg
from fastapi.testclient import TestClient
from psycopg.types.json import Json

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user() -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document(user_id: str, filename: str) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, 'txt', 'path/doc.txt', 'ready')
            """,
            (document_id, user_id, filename),
        )
    return document_id


def _create_quiz_with_questions(user_id: str, document_id: str, questions: list[dict]) -> tuple[str, list[str]]:
    quiz_id = str(uuid.uuid4())
    question_ids = []
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO quizzes (id, user_id, document_ids) VALUES (%s, %s, %s)",
            (quiz_id, user_id, [document_id]),
        )
        for index, q in enumerate(questions):
            question_id = str(uuid.uuid4())
            question_ids.append(question_id)
            conn.execute(
                """
                INSERT INTO quiz_questions
                    (id, quiz_id, question_index, question, options, correct_answer, source_reference)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    question_id,
                    quiz_id,
                    index,
                    q["question"],
                    Json(q["options"]),
                    q["correct_answer"],
                    Json(
                        {"document_id": document_id, "filename": "doc.txt", "chunk_index": 0, "total_chunks": 1}
                    ),
                ),
            )
    return quiz_id, question_ids


def test_submit_attempt_scores_correct_incorrect_and_unanswered():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id,
        document_id,
        [
            {"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 1},
            {"question": "Q2", "options": ["a", "b", "c", "d"], "correct_answer": 2},
            {"question": "Q3", "options": ["a", "b", "c", "d"], "correct_answer": 0},
        ],
    )

    response = client.post(
        f"/quiz/{quiz_id}/attempts",
        json={
            "answers": [
                {"question_id": question_ids[0], "selected_option": 1},
                {"question_id": question_ids[1], "selected_option": 3},
            ]
        },
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["quiz_id"] == quiz_id
    assert body["score"] == 1
    assert body["total_questions"] == 3
    results_by_question = {r["question_id"]: r for r in body["results"]}
    assert results_by_question[question_ids[0]]["is_correct"] is True
    assert results_by_question[question_ids[0]]["selected_option"] == 1
    assert results_by_question[question_ids[1]]["is_correct"] is False
    assert results_by_question[question_ids[1]]["correct_answer"] == 2
    assert results_by_question[question_ids[2]]["is_correct"] is False
    assert results_by_question[question_ids[2]]["selected_option"] is None

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        row = conn.execute(
            "SELECT score FROM quiz_attempts WHERE quiz_id = %s", (quiz_id,)
        ).fetchone()
    assert row[0] == 1


def test_submit_attempt_rejects_unknown_question_id():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, _ = _create_quiz_with_questions(
        user_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )

    response = client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": str(uuid.uuid4()), "selected_option": 0}]},
        headers=headers,
    )

    assert response.status_code == 400


def test_submit_attempt_rejects_duplicate_question_id():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )

    response = client.post(
        f"/quiz/{quiz_id}/attempts",
        json={
            "answers": [
                {"question_id": question_ids[0], "selected_option": 0},
                {"question_id": question_ids[0], "selected_option": 1},
            ]
        },
        headers=headers,
    )

    assert response.status_code == 400


def test_submit_attempt_rejects_out_of_range_selected_option():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )

    response = client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": question_ids[0], "selected_option": 4}]},
        headers=headers,
    )

    assert response.status_code == 400


def test_submit_attempt_returns_404_for_other_users_quiz():
    owner_id, _ = _create_user()
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id, _ = _create_quiz_with_questions(
        owner_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )

    _, other_headers = _create_user()
    response = client.post(f"/quiz/{quiz_id}/attempts", json={"answers": []}, headers=other_headers)

    assert response.status_code == 404


def test_list_attempts_returns_only_callers_attempts_newest_first():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": question_ids[0], "selected_option": 0}]},
        headers=headers,
    )

    other_user_id, other_headers = _create_user()
    other_document_id = _create_document(other_user_id, "theirs.txt")
    other_quiz_id, other_question_ids = _create_quiz_with_questions(
        other_user_id, other_document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(
        f"/quiz/{other_quiz_id}/attempts",
        json={"answers": [{"question_id": other_question_ids[0], "selected_option": 0}]},
        headers=other_headers,
    )

    response = client.get("/quiz/attempts", headers=headers)

    assert response.status_code == 200
    attempts = response.json()["attempts"]
    assert len(attempts) == 1
    assert attempts[0]["quiz_id"] == quiz_id
    assert attempts[0]["score"] == 1
    assert attempts[0]["total_questions"] == 1
    assert attempts[0]["document_filenames"] == ["policy.txt"]


def test_list_attempts_shows_deleted_document_placeholder():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": question_ids[0], "selected_option": 0}]},
        headers=headers,
    )
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("DELETE FROM documents WHERE id = %s", (document_id,))

    response = client.get("/quiz/attempts", headers=headers)

    assert response.status_code == 200
    attempts = response.json()["attempts"]
    assert attempts[0]["document_filenames"] == ["(deleted document)"]
