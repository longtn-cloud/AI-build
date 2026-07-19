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


def test_get_quiz_returns_questions_without_correct_answers():
    user_id, headers = _create_user()
    document_id = _create_document(user_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        user_id,
        document_id,
        [
            {"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 1},
            {"question": "Q2", "options": ["a", "b", "c", "d"], "correct_answer": 2},
        ],
    )

    response = client.get(f"/quiz/{quiz_id}", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == quiz_id
    assert body["document_ids"] == [document_id]
    assert body["actual_count"] == 2
    assert body["requested_count"] == 2
    assert body["questions"] == [
        {"id": question_ids[0], "question": "Q1", "options": ["a", "b", "c", "d"]},
        {"id": question_ids[1], "question": "Q2", "options": ["a", "b", "c", "d"]},
    ]
    for q in body["questions"]:
        assert "correct_answer" not in q
        assert "source_reference" not in q


def test_get_quiz_returns_404_for_missing_quiz():
    _, headers = _create_user()

    response = client.get(f"/quiz/{uuid.uuid4()}", headers=headers)

    assert response.status_code == 404


def test_get_quiz_returns_404_for_other_users_quiz():
    owner_id, _ = _create_user()
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id, _ = _create_quiz_with_questions(
        owner_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )

    _, other_headers = _create_user()
    response = client.get(f"/quiz/{quiz_id}", headers=other_headers)

    assert response.status_code == 404


def test_get_quiz_still_allows_get_attempts_route_to_match():
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

    response = client.get("/quiz/attempts", headers=headers)

    assert response.status_code == 200
    assert response.json()["attempts"][0]["quiz_id"] == quiz_id
