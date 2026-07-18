import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

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


def _create_document_with_chunks(user_id: str, filename: str, chunk_count: int) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, 'txt', 'path/doc.txt', 'ready')
            """,
            (document_id, user_id, filename),
        )
        for index in range(chunk_count):
            conn.execute(
                """
                INSERT INTO chunks (document_id, content, embedding, chunk_index)
                VALUES (%s, %s, %s, %s)
                """,
                (document_id, f"chunk {index} content", [0.0] * 384, index),
            )
    return document_id


def _valid_question(document_id: str, chunk_index: int = 0) -> dict:
    return {
        "question": "What is the refund window?",
        "options": ["7 days", "30 days", "60 days", "90 days"],
        "correct_answer": 1,
        "source_document_id": document_id,
        "source_chunk_index": chunk_index,
    }


def test_generate_quiz_persists_valid_questions_and_hides_answers(monkeypatch):
    from app.routers import quiz as quiz_router

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", 3)

    questions = [_valid_question(document_id, i % 3) for i in range(5)]
    generate_mock = MagicMock(return_value=questions)
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 5},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["document_ids"] == [document_id]
    assert body["requested_count"] == 5
    assert body["actual_count"] == 5
    assert len(body["questions"]) == 5
    for q in body["questions"]:
        assert set(q.keys()) == {"id", "question", "options"}
    generate_mock.assert_called_once()
    call_args = generate_mock.call_args[0]
    assert call_args[1] == 5
    assert call_args[0][0]["filename"] == "policy.txt"

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        count = conn.execute(
            "SELECT count(*) FROM quiz_questions qq JOIN quizzes q ON q.id = qq.quiz_id WHERE q.user_id = %s",
            (user_id,),
        ).fetchone()[0]
    assert count == 5


def test_generate_quiz_drops_malformed_questions_and_reports_actual_count(monkeypatch):
    from app.routers import quiz as quiz_router

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", 2)

    valid = _valid_question(document_id, 0)
    bad_option_count = {**_valid_question(document_id, 0), "options": ["only one"]}
    bad_answer_index = {**_valid_question(document_id, 0), "correct_answer": 7}
    bad_source_doc = {**_valid_question(document_id, 0), "source_document_id": "not-in-request"}
    bad_chunk_index = {**_valid_question(document_id, 0), "source_chunk_index": 99}
    generate_mock = MagicMock(
        return_value=[valid, bad_option_count, bad_answer_index, bad_source_doc, bad_chunk_index]
    )
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 5},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["requested_count"] == 5
    assert body["actual_count"] == 1
    assert len(body["questions"]) == 1


def test_generate_quiz_returns_502_when_no_valid_questions(monkeypatch):
    from app.routers import quiz as quiz_router

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", 1)

    generate_mock = MagicMock(return_value=[{**_valid_question(document_id), "correct_answer": 9}])
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 5},
        headers=headers,
    )

    assert response.status_code == 502
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        count = conn.execute(
            "SELECT count(*) FROM quizzes WHERE user_id = %s", (user_id,)
        ).fetchone()[0]
    assert count == 0


def test_generate_quiz_rejects_empty_document_ids():
    _, headers = _create_user()

    response = client.post("/quiz/generate", json={"document_ids": []}, headers=headers)

    assert response.status_code == 400


def test_generate_quiz_rejects_out_of_range_num_questions(monkeypatch):
    from app.routers import quiz as quiz_router

    generate_mock = MagicMock()
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", 1)

    too_few = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 4},
        headers=headers,
    )
    too_many = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 21},
        headers=headers,
    )

    assert too_few.status_code == 400
    assert too_many.status_code == 400
    generate_mock.assert_not_called()


def test_generate_quiz_returns_404_for_other_users_document(monkeypatch):
    from app.routers import quiz as quiz_router

    generate_mock = MagicMock()
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    other_user_id, _ = _create_user()
    other_document_id = _create_document_with_chunks(other_user_id, "theirs.txt", 1)

    _, headers = _create_user()
    response = client.post(
        "/quiz/generate",
        json={"document_ids": [other_document_id]},
        headers=headers,
    )

    assert response.status_code == 404
    generate_mock.assert_not_called()


def test_generate_quiz_returns_400_when_selection_has_no_chunks(monkeypatch):
    from app.routers import quiz as quiz_router

    generate_mock = MagicMock()
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    user_id, headers = _create_user()
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'empty.txt', 'txt', 'path/doc.txt', 'processing')
            """,
            (document_id, user_id),
        )

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id]},
        headers=headers,
    )

    assert response.status_code == 400
    generate_mock.assert_not_called()
