import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)

RELEVANT_VEC = [1.0] + [0.0] * 383
IRRELEVANT_VEC = [0.0, 1.0] + [0.0] * 382


def _create_user() -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document_with_chunks(user_id: str, filename: str, chunk_vectors: list[list[float]]) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, 'txt', 'path/doc.txt', 'ready')
            """,
            (document_id, user_id, filename),
        )
        for index, vector in enumerate(chunk_vectors):
            conn.execute(
                """
                INSERT INTO chunks (document_id, content, embedding, chunk_index)
                VALUES (%s, %s, %s, %s)
                """,
                (document_id, f"chunk {index} content", vector, index),
            )
    return document_id


def _create_session(headers: dict) -> str:
    response = client.post("/chat/sessions", headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


def test_create_session_returns_new_chat_session():
    _, headers = _create_user()

    response = client.post("/chat/sessions", headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "New Chat"
    assert "id" in body
    assert "created_at" in body


def test_send_message_grounds_answer_in_relevant_chunk(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(
        return_value={"answer": "Refunds are available within 30 days.", "used_general_knowledge": False}
    )
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", [RELEVANT_VEC])
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What is the refund window?"},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_message"]["role"] == "user"
    assert body["user_message"]["content"] == "What is the refund window?"
    assert body["assistant_message"]["role"] == "assistant"
    assert body["assistant_message"]["content"] == "Refunds are available within 30 days."
    assert body["assistant_message"]["used_web_search"] is False
    assert body["assistant_message"]["used_general_knowledge"] is False
    assert body["assistant_message"]["citations"] == [
        {
            "document_id": document_id,
            "filename": "policy.txt",
            "chunk_index": 0,
            "total_chunks": 1,
            "score": 1.0,
        }
    ]
    answer_mock.assert_called_once()
    call_args = answer_mock.call_args[0]
    assert call_args[0] == "What is the refund window?"
    assert call_args[1][0]["filename"] == "policy.txt"
    assert call_args[2] == []


def test_send_message_answers_from_general_knowledge_when_nothing_clears_threshold(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(
        return_value={"answer": "Paris is the capital of France.", "used_general_knowledge": True}
    )
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "unrelated.txt", [IRRELEVANT_VEC])
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What is the capital of France?"},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["assistant_message"]["content"] == "Paris is the capital of France."
    assert body["assistant_message"]["citations"] == []
    assert body["assistant_message"]["used_web_search"] is False
    assert body["assistant_message"]["used_general_knowledge"] is True
    answer_mock.assert_called_once_with("What is the capital of France?", [], [])


def test_send_message_flags_general_knowledge_when_chunks_empty_even_if_model_says_false(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(return_value={"answer": "some answer", "used_general_knowledge": False})
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "unrelated.txt", [IRRELEVANT_VEC])
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What is the capital of France?"},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["assistant_message"]["content"] == "some answer"
    assert body["assistant_message"]["used_general_knowledge"] is True


def test_send_message_with_web_search_skips_retrieval(monkeypatch):
    from app.routers import chat as chat_router

    embed_mock = MagicMock()
    monkeypatch.setattr(chat_router, "embed_query", embed_mock)
    web_search_mock = MagicMock(return_value="It's sunny in Paris today.")
    monkeypatch.setattr(chat_router, "answer_with_web_search", web_search_mock)

    _, headers = _create_user()
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What's the weather in Paris?", "web_search": True},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["assistant_message"]["content"] == "It's sunny in Paris today."
    assert body["assistant_message"]["used_web_search"] is True
    assert body["assistant_message"]["used_general_knowledge"] is False
    assert body["assistant_message"]["citations"] == []
    embed_mock.assert_not_called()
    web_search_mock.assert_called_once_with("What's the weather in Paris?", [])


def test_send_message_rejects_empty_content():
    _, headers = _create_user()
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "   "},
        headers=headers,
    )

    assert response.status_code == 400


def test_send_message_returns_404_for_other_users_session(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)

    _, owner_headers = _create_user()
    session_id = _create_session(owner_headers)

    _, other_headers = _create_user()
    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "hello"},
        headers=other_headers,
    )

    assert response.status_code == 404


def test_send_message_persists_user_message_even_when_llm_call_fails(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    monkeypatch.setattr(
        chat_router, "answer_from_chunks", MagicMock(side_effect=RuntimeError("gemini down"))
    )

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "policy.txt", [RELEVANT_VEC])
    session_id = _create_session(headers)

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What is the refund window?"},
        headers=headers,
    )

    assert response.status_code == 502
    with psycopg.connect(TEST_DB_URL, autocommit=True, row_factory=dict_row) as conn:
        row = conn.execute(
            "SELECT content FROM chat_messages WHERE session_id = %s AND role = 'user'",
            (session_id,),
        ).fetchone()
    assert row is not None
    assert row["content"] == "What is the refund window?"


def test_send_message_excludes_other_users_chunks(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(return_value={"answer": "answer", "used_general_knowledge": True})
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    user_id, headers = _create_user()
    session_id = _create_session(headers)

    other_user_id, _ = _create_user()
    _create_document_with_chunks(other_user_id, "theirs.txt", [RELEVANT_VEC])

    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "hello"},
        headers=headers,
    )

    assert response.status_code == 201
    assert response.json()["assistant_message"]["content"] == "answer"
    answer_mock.assert_called_once_with("hello", [], [])


def test_send_message_includes_prior_turns_as_history(monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(
        side_effect=[
            {"answer": "A phone and a laptop.", "used_general_knowledge": False},
            {"answer": "The laptop is the second one.", "used_general_knowledge": False},
        ]
    )
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "catalog.txt", [RELEVANT_VEC])
    session_id = _create_session(headers)

    client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What products do you have?"},
        headers=headers,
    )
    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What about the second one?"},
        headers=headers,
    )

    assert response.status_code == 201
    second_call_history = answer_mock.call_args_list[1][0][2]
    assert second_call_history == [
        {"role": "user", "content": "What products do you have?"},
        {"role": "assistant", "content": "A phone and a laptop."},
    ]


def test_chat_messages_used_general_knowledge_defaults_to_false():
    _, headers = _create_user()
    session_id = _create_session(headers)

    with psycopg.connect(TEST_DB_URL, autocommit=True, row_factory=dict_row) as conn:
        conn.execute(
            """
            INSERT INTO chat_messages (id, session_id, role, content, citations, used_web_search)
            VALUES (%s, %s, 'user', 'hello', '[]'::jsonb, false)
            """,
            (str(uuid.uuid4()), session_id),
        )
        row = conn.execute(
            "SELECT used_general_knowledge FROM chat_messages WHERE session_id = %s",
            (session_id,),
        ).fetchone()

    assert row["used_general_knowledge"] is False
