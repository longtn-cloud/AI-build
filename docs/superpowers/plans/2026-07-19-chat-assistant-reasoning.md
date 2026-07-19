# Chat Assistant Reasoning & General-Knowledge Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chat Q&A reason across retrieved document passages and answer conversationally instead of behaving like a literal-match search tool, while falling back to clearly-flagged general knowledge when documents don't fully cover a question.

**Architecture:** `backend/app/services/llm.py` gains two system prompts (documents-present vs. no-match) and a forced `provide_answer` tool call that returns `{answer, used_general_knowledge}` instead of a bare string; Gemini's thinking is re-enabled (`thinking_budget=-1`). `backend/app/routers/chat.py` removes its hard "zero chunks → canned refusal, no LLM call" bypass — it always calls the LLM now — and passes the session's recent message history for conversational continuity. A new `chat_messages.used_general_knowledge` column and matching frontend badge surface the flag to users.

**Tech Stack:** FastAPI + psycopg3 (backend), Gemini API via `google-genai` (`gemini-2.5-flash`), Postgres/pgvector, React + TypeScript + Vitest/Testing Library (frontend).

## Global Constraints

- Retrieval mechanics are unchanged: 0.5 cosine-similarity threshold, top-10 chunk limit, per-user `WHERE d.user_id = %s` isolation. Do not touch `MIN_SIMILARITY_THRESHOLD` or the retrieval SQL's shape.
- Quiz generation (`generate_quiz_questions`, `_quiz_system_prompt`, `QUIZ_TOOL`) and the `/search` endpoint are out of scope — do not modify them. `generate_quiz_questions` keeps `thinking_budget=0`.
- Citation granularity stays whole-message (matching existing `used_web_search`) — no per-sentence attribution.
- Conversation history is the last 10 `chat_messages` rows (5 user/assistant pairs) per session, applied to both the document-grounded and web-search paths.
- No live Gemini API calls in the test suite — mock at the same module-attribute boundary (`llm._client`, `chat_router.answer_from_chunks`/`embed_query`/`answer_with_web_search`) the existing tests already use.
- Backend tests run against real Postgres+pgvector per `backend/tests/conftest.py`'s existing pattern — every new/changed migration must be wired into `apply_migrations()` there, since it lists migration files explicitly rather than globbing the directory.

---

### Task 1: `used_general_knowledge` column migration

**Files:**
- Create: `backend/migrations/0005_chat_general_knowledge.sql`
- Modify: `backend/tests/conftest.py:29-38` (add the new migration to `apply_migrations`)
- Test: `backend/tests/test_chat.py` (new test appended)

**Interfaces:**
- Produces: `chat_messages.used_general_knowledge` column (`boolean not null default false`), available to Task 3's router code and Task 4's API response shape.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_chat.py`:

```python
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
```

`uuid`, `psycopg`, `dict_row`, `TEST_DB_URL`, `_create_user`, `_create_session` are all already imported/defined at the top of `test_chat.py` — no new imports needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_chat.py::test_chat_messages_used_general_knowledge_defaults_to_false -v`
Expected: FAIL — `psycopg.errors.UndefinedColumn: column "used_general_knowledge" does not exist`

- [ ] **Step 3: Create the migration**

Create `backend/migrations/0005_chat_general_knowledge.sql`:

```sql
alter table chat_messages
    add column used_general_knowledge boolean not null default false;
```

- [ ] **Step 4: Wire the migration into the test fixture**

In `backend/tests/conftest.py`, in `apply_migrations()`:

```python
    search_fts_sql = (BACKEND_ROOT / "migrations" / "0004_search_fts.sql").read_text()
    chat_general_knowledge_sql = (
        BACKEND_ROOT / "migrations" / "0005_chat_general_knowledge.sql"
    ).read_text()
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "DROP TABLE IF EXISTS quiz_attempts, quiz_questions, quizzes, "
            "chat_messages, chat_sessions, chunks, documents CASCADE"
        )
        conn.execute(stub_sql)
        conn.execute(init_sql)
        conn.execute(chat_sql)
        conn.execute(quiz_sql)
        conn.execute(search_fts_sql)
        conn.execute(chat_general_knowledge_sql)
    yield
```

(Only the two new lines — `chat_general_knowledge_sql = ...` and `conn.execute(chat_general_knowledge_sql)` — are additions; everything else in that function is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_chat.py::test_chat_messages_used_general_knowledge_defaults_to_false -v`
Expected: PASS

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (same count as before, plus this new one)

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/0005_chat_general_knowledge.sql backend/tests/conftest.py backend/tests/test_chat.py
git commit -m "feat: add used_general_knowledge column to chat_messages"
```

---

### Task 2: Rewrite `llm.py` — reasoning prompts, forced-tool answer, dynamic thinking, history

**Files:**
- Modify: `backend/app/services/llm.py:1-42` (everything above `QUIZ_TOOL`, which is untouched)
- Test: `backend/tests/test_llm.py:1-61` (everything above the quiz tests, which are untouched)

**Interfaces:**
- Consumes: `google.genai` `types.Content`, `types.Part`, `types.FunctionDeclaration`, `types.Schema`, `types.Tool`, `types.ToolConfig`, `types.FunctionCallingConfig`, `types.ThinkingConfig`, `types.GenerateContentConfig` (all already used elsewhere in this file for the quiz function).
- Produces (consumed by Task 3):
  - `answer_from_chunks(question: str, chunks: list[dict], history: list[dict] | None = None) -> dict` returning `{"answer": str, "used_general_knowledge": bool}`. `chunks` may be empty. `history` is a list of `{"role": "user" | "assistant", "content": str}`, oldest-first.
  - `answer_with_web_search(question: str, history: list[dict] | None = None) -> str` (same history shape).
  - Raises `RuntimeError` if Gemini doesn't return the expected `provide_answer` tool call.

- [ ] **Step 1: Write the failing tests**

Replace `backend/tests/test_llm.py` lines 1-61 (everything before `test_generate_quiz_questions_calls_gemini_with_forced_tool_and_context`) with:

```python
from unittest.mock import MagicMock

import pytest

from app.services import llm


def test_answer_from_chunks_calls_gemini_with_context_and_dynamic_thinking(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "Refunds are available within 30 days.", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    chunks = [
        {
            "document_id": "doc-1",
            "filename": "policy.pdf",
            "chunk_index": 1,
            "total_chunks": 3,
            "content": "Refunds must be requested within 30 days of purchase.",
            "score": 0.81,
        }
    ]

    result = llm.answer_from_chunks("What is the refund window?", chunks)

    assert result == {"answer": "Refunds are available within 30 days.", "used_general_knowledge": False}
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == llm.MODEL
    assert kwargs["config"].thinking_config.thinking_budget == -1
    assert kwargs["config"].system_instruction == llm.DOCUMENTS_SYSTEM_PROMPT
    assert kwargs["config"].tools[0].function_declarations == [llm.ANSWER_TOOL]
    tool_config = kwargs["config"].tool_config
    assert tool_config.function_calling_config.mode == "ANY"
    assert tool_config.function_calling_config.allowed_function_names == ["provide_answer"]

    contents = kwargs["contents"]
    assert len(contents) == 1
    turn_text = contents[0].parts[0].text
    assert "policy.pdf" in turn_text
    assert "passage 2 of 3" in turn_text
    assert "Refunds must be requested within 30 days" in turn_text
    assert "What is the refund window?" in turn_text


def test_answer_from_chunks_uses_general_knowledge_prompt_when_no_chunks(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "Paris is the capital of France.", "used_general_knowledge": True}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_from_chunks("What is the capital of France?", [])

    assert result == {"answer": "Paris is the capital of France.", "used_general_knowledge": True}
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["config"].system_instruction == llm.GENERAL_KNOWLEDGE_SYSTEM_PROMPT
    turn_text = kwargs["contents"][-1].parts[0].text
    assert turn_text == "What is the capital of France?"
    assert "Document passages" not in turn_text


def test_answer_from_chunks_includes_conversation_history(monkeypatch):
    fake_client = MagicMock()
    fake_call = MagicMock()
    fake_call.name = "provide_answer"
    fake_call.args = {"answer": "The second one is a laptop.", "used_general_knowledge": False}
    fake_client.models.generate_content.return_value = MagicMock(function_calls=[fake_call])
    monkeypatch.setattr(llm, "_client", fake_client)

    history = [
        {"role": "user", "content": "What products do you have?"},
        {"role": "assistant", "content": "A phone and a laptop."},
    ]

    llm.answer_from_chunks("What about the second one?", [], history=history)

    _, kwargs = fake_client.models.generate_content.call_args
    contents = kwargs["contents"]
    assert len(contents) == 3
    assert contents[0].role == "user"
    assert contents[0].parts[0].text == "What products do you have?"
    assert contents[1].role == "model"
    assert contents[1].parts[0].text == "A phone and a laptop."
    assert contents[2].role == "user"
    assert contents[2].parts[0].text == "What about the second one?"


def test_answer_from_chunks_raises_when_no_tool_call(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(function_calls=None)
    monkeypatch.setattr(llm, "_client", fake_client)

    with pytest.raises(RuntimeError):
        llm.answer_from_chunks("question", [])


def test_answer_with_web_search_calls_gemini_with_search_tool(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="It's sunny today.")
    monkeypatch.setattr(llm, "_client", fake_client)

    result = llm.answer_with_web_search("What's the weather?")

    assert result == "It's sunny today."
    _, kwargs = fake_client.models.generate_content.call_args
    assert kwargs["model"] == llm.MODEL
    contents = kwargs["contents"]
    assert len(contents) == 1
    assert contents[0].parts[0].text == "What's the weather?"
    tools = kwargs["config"].tools
    assert len(tools) == 1
    assert tools[0].google_search is not None


def test_answer_with_web_search_includes_conversation_history(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.generate_content.return_value = MagicMock(text="Still sunny tomorrow.")
    monkeypatch.setattr(llm, "_client", fake_client)

    history = [
        {"role": "user", "content": "What's the weather in Paris?"},
        {"role": "assistant", "content": "It's sunny today."},
    ]

    llm.answer_with_web_search("And tomorrow?", history=history)

    _, kwargs = fake_client.models.generate_content.call_args
    contents = kwargs["contents"]
    assert len(contents) == 3
    assert contents[0].parts[0].text == "What's the weather in Paris?"
    assert contents[1].role == "model"
    assert contents[2].parts[0].text == "And tomorrow?"
```

Leave everything from `QUIZ_TOOL = types.FunctionDeclaration(` (the quiz test section) onward in `test_llm.py` exactly as-is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_llm.py -v`
Expected: FAIL — `AttributeError: module 'app.services.llm' has no attribute 'DOCUMENTS_SYSTEM_PROMPT'` (and similar) for the new tests; existing quiz tests still pass.

- [ ] **Step 3: Rewrite `llm.py`'s answer-generation section**

Replace `backend/app/services/llm.py` lines 1-42 (from the top through the end of `answer_with_web_search`) with:

```python
from google import genai
from google.genai import types

from app.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)

MODEL = "gemini-2.5-flash"

DOCUMENTS_SYSTEM_PROMPT = (
    "You are a knowledgeable assistant helping the user understand their uploaded "
    "documents. Treat the document passages below as your primary source: reason "
    "across them, connect related points, and answer in your own words — don't "
    "simply refuse just because no single sentence states the answer verbatim. "
    "Cite the source filename when you draw on a passage. If the passages only "
    "partially answer the question, or don't cover it at all, you may fill the "
    "gap with your own general knowledge — but never invent specifics about the "
    "documents themselves (numbers, names, policies) that aren't actually there. "
    "Call provide_answer with used_general_knowledge=true whenever any part of "
    "your answer relies on something not present in the passages."
)

GENERAL_KNOWLEDGE_SYSTEM_PROMPT = (
    "You are a helpful assistant. None of the user's uploaded documents contain "
    "content relevant to this question, so answer from your own general "
    "knowledge as best you can. Always call provide_answer with "
    "used_general_knowledge=true."
)

ANSWER_TOOL = types.FunctionDeclaration(
    name="provide_answer",
    description="Return the final answer to the user's question.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "answer": types.Schema(
                type="STRING",
                description="The answer, addressed directly to the user.",
            ),
            "used_general_knowledge": types.Schema(
                type="BOOLEAN",
                description=(
                    "True if any part of the answer relies on information not "
                    "present in the provided document passages."
                ),
            ),
        },
        required=["answer", "used_general_knowledge"],
    ),
)

_ANSWER_TOOL_CONFIG = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(
        mode="ANY",
        allowed_function_names=["provide_answer"],
    )
)


def _history_contents(history: list[dict] | None) -> list[types.Content]:
    if not history:
        return []
    return [
        types.Content(
            role="model" if turn["role"] == "assistant" else "user",
            parts=[types.Part.from_text(text=turn["content"])],
        )
        for turn in history
    ]


def _extract_answer(response) -> dict:
    for call in response.function_calls or []:
        if call.name == "provide_answer":
            return {
                "answer": call.args["answer"],
                "used_general_knowledge": call.args["used_general_knowledge"],
            }
    raise RuntimeError("Gemini did not call provide_answer")


def answer_from_chunks(question: str, chunks: list[dict], history: list[dict] | None = None) -> dict:
    if chunks:
        context = "\n\n".join(
            f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
            for c in chunks
        )
        turn_text = f"Document passages:\n\n{context}\n\nQuestion: {question}"
        system_prompt = DOCUMENTS_SYSTEM_PROMPT
    else:
        turn_text = question
        system_prompt = GENERAL_KNOWLEDGE_SYSTEM_PROMPT

    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=turn_text)])
    ]

    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            thinking_config=types.ThinkingConfig(thinking_budget=-1),
            tools=[types.Tool(function_declarations=[ANSWER_TOOL])],
            tool_config=_ANSWER_TOOL_CONFIG,
        ),
    )
    return _extract_answer(response)


def answer_with_web_search(question: str, history: list[dict] | None = None) -> str:
    contents = _history_contents(history) + [
        types.Content(role="user", parts=[types.Part.from_text(text=question)])
    ]
    response = _client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]),
    )
    return response.text
```

Leave `QUIZ_TOOL`, `_quiz_system_prompt`, and `generate_quiz_questions` (everything currently below `answer_with_web_search`) completely untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_llm.py -v`
Expected: PASS (all tests, including the untouched quiz tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: `test_chat.py` failures are expected here (it still calls the old string-returning `answer_from_chunks` contract) — Task 3 fixes those. Confirm the failures are only in `test_chat.py` and only in the ways Task 3 will address (assertions on a plain string return, or on `answer_mock.assert_not_called()`), not unrelated breakage.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/llm.py backend/tests/test_llm.py
git commit -m "feat: reason across passages with forced-tool answers and dynamic thinking"
```

---

### Task 3: Update `chat.py` — always call the LLM, add history, persist the flag

**Files:**
- Modify: `backend/app/routers/chat.py` (entire file)
- Test: `backend/tests/test_chat.py` (rewrite specific tests, others untouched)

**Interfaces:**
- Consumes: `answer_from_chunks(question, chunks, history) -> dict` and `answer_with_web_search(question, history) -> str` from Task 2; `chat_messages.used_general_knowledge` column from Task 1.
- Produces (consumed by Task 4): response JSON for both `user_message` and `assistant_message` now includes `"used_general_knowledge": bool`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_chat.py`, replace `test_send_message_grounds_answer_in_relevant_chunk` with:

```python
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
```

Replace `test_send_message_returns_not_found_message_when_nothing_clears_threshold` with:

```python
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
```

Replace `test_send_message_with_web_search_skips_retrieval` with:

```python
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
```

Replace `test_send_message_excludes_other_users_chunks` with:

```python
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
```

Append a new test for conversation history:

```python
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
```

`test_send_message_rejects_empty_content`, `test_send_message_returns_404_for_other_users_session`, and `test_send_message_persists_user_message_even_when_llm_call_fails` are unchanged — leave them exactly as-is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_chat.py -v`
Expected: FAIL on the rewritten/new tests — `chat.py` still returns the old bare-string-based, threshold-bypassing behavior.

- [ ] **Step 3: Rewrite `chat.py`**

Replace `backend/app/routers/chat.py` entirely with:

```python
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
HISTORY_LIMIT = 10


@router.post("/sessions", status_code=201)
def create_session(user_id: str = Depends(get_current_user_id)):
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
        "used_general_knowledge": row["used_general_knowledge"],
        "created_at": row["created_at"].isoformat(),
    }


@router.post("/sessions/{session_id}/messages", status_code=201)
def send_message(
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

        history_rows = conn.execute(
            """
            SELECT role, content FROM chat_messages
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (session_id, HISTORY_LIMIT),
        ).fetchall()
        history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]

        user_message_id = str(uuid.uuid4())
        user_row = conn.execute(
            """
            INSERT INTO chat_messages
                (id, session_id, role, content, citations, used_web_search, used_general_knowledge)
            VALUES (%s, %s, 'user', %s, '[]'::jsonb, false, false)
            RETURNING id, role, content, citations, used_web_search, used_general_knowledge, created_at
            """,
            (user_message_id, session_id, body.content),
        ).fetchone()

    try:
        if body.web_search:
            answer_text = answer_with_web_search(body.content, history)
            citations: list[dict] = []
            used_web_search = True
            used_general_knowledge = False
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
            result = answer_from_chunks(body.content, chunks, history)
            answer_text = result["answer"]
            used_general_knowledge = result["used_general_knowledge"]
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
            INSERT INTO chat_messages
                (id, session_id, role, content, citations, used_web_search, used_general_knowledge)
            VALUES (%s, %s, 'assistant', %s, %s, %s, %s)
            RETURNING id, role, content, citations, used_web_search, used_general_knowledge, created_at
            """,
            (
                assistant_message_id,
                session_id,
                answer_text,
                Json(citations),
                used_web_search,
                used_general_knowledge,
            ),
        ).fetchone()

    return {
        "user_message": _serialize_message(user_row),
        "assistant_message": _serialize_message(assistant_row),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_chat.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/chat.py backend/tests/test_chat.py
git commit -m "feat: always answer chat messages, adding history and general-knowledge flag"
```

---

### Task 4: Frontend — `used_general_knowledge` type, badge rendering, tests

**Files:**
- Modify: `frontend/src/lib/api.ts:134-141` (`ChatMessage` type)
- Modify: `frontend/src/pages/ChatPage.tsx:57-81` (badge rendering)
- Modify: `frontend/tests/lib/api.test.ts:197-232` (mock message objects)
- Modify: `frontend/tests/pages/ChatPage.test.tsx` (mock message objects, two new tests)

**Interfaces:**
- Consumes: API response shape from Task 3 — `assistant_message.used_general_knowledge: boolean`.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/pages/ChatPage.test.tsx`, add `used_general_knowledge: false` to every existing `user_message`/`assistant_message` mock object (5 objects total: the grounded-reply test's two messages, and the web-search test's two messages — the empty-message and session-creation-failure tests don't construct message objects). For example, the grounded-reply test's `assistant_message` becomes:

```tsx
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Refunds are available within 30 days.',
        citations: [
          { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3, score: 0.81 },
        ],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-18T00:00:02Z',
      },
```

Then append two new test cases at the end of the `describe('ChatPage', ...)` block, before the final closing `})`:

```tsx
  it('renders a General knowledge badge when the answer has no document grounding', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the capital of France?',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-19T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Paris is the capital of France.',
        citations: [],
        used_web_search: false,
        used_general_knowledge: true,
        created_at: '2026-07-19T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), {
      target: { value: 'What is the capital of France?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText('Paris is the capital of France.')).toBeInTheDocument()
    })
    expect(screen.getByText('General knowledge')).toBeInTheDocument()
    expect(screen.queryByText('Web')).not.toBeInTheDocument()
  })

  it('renders a Documents + General knowledge badge when an answer blends both', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the refund window and is that typical?',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-19T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Refunds are available within 30 days, which is fairly typical for retailers.',
        citations: [
          { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3, score: 0.81 },
        ],
        used_web_search: false,
        used_general_knowledge: true,
        created_at: '2026-07-19T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), {
      target: { value: 'What is the refund window and is that typical?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(
        screen.getByText('Refunds are available within 30 days, which is fairly typical for retailers.'),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Documents + General knowledge')).toBeInTheDocument()
    expect(screen.getByText('policy.pdf — passage 2 of 3')).toBeInTheDocument()
  })
```

In `frontend/tests/lib/api.test.ts`, add `used_general_knowledge: false` to the `userMessage` and `assistantMessage` objects inside `it('sendChatMessage sends content and web_search in the request body', ...)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/pages/ChatPage.test.tsx`
Expected: FAIL on the two new tests — no "General knowledge" or "Documents + General knowledge" text is rendered yet.

- [ ] **Step 3: Add the type field**

In `frontend/src/lib/api.ts`, update the `ChatMessage` type (currently lines 134-141):

```ts
export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: ChatCitation[]
  used_web_search: boolean
  used_general_knowledge: boolean
  created_at: string
}
```

- [ ] **Step 4: Render the new badge states**

In `frontend/src/pages/ChatPage.tsx`, replace the existing badge block (currently):

```tsx
                  {message.used_web_search && (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">Web</Badge>
                    </div>
                  )}
```

with:

```tsx
                  {message.used_web_search ? (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">Web</Badge>
                    </div>
                  ) : message.used_general_knowledge ? (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">
                        {message.citations.length > 0
                          ? 'Documents + General knowledge'
                          : 'General knowledge'}
                      </Badge>
                    </div>
                  ) : null}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/ChatPage.test.tsx tests/lib/api.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Typecheck and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; all tests pass

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ChatPage.tsx frontend/tests/lib/api.test.ts frontend/tests/pages/ChatPage.test.tsx
git commit -m "feat: render General knowledge badge for chat answers"
```

---

### Task 5: Update README's chat description and core invariant

**Files:**
- Modify: `README.md` (lines 3, 172, 180-181)

**Interfaces:**
- None — documentation only, no code interfaces.

- [ ] **Step 1: Update the tagline**

In `README.md` line 3, replace:

```
Upload documents (PDF, DOCX, TXT, Markdown), then search, chat, and generate quizzes grounded strictly in what you uploaded — no hallucination outside your own documents.
```

with:

```
Upload documents (PDF, DOCX, TXT, Markdown), then search, chat, and generate quizzes grounded in what you uploaded — chat answers prefer your documents and reason across them, clearly flagging any general knowledge used to fill a gap.
```

- [ ] **Step 2: Update the API overview table row**

In `README.md` line 172, replace:

```
| POST | `/chat/sessions/{id}/messages` | Ask a question; grounded in retrieved chunks, or web search if opted in |
```

with:

```
| POST | `/chat/sessions/{id}/messages` | Ask a question; answered from retrieved chunks (falling back to flagged general knowledge), or web search if opted in |
```

- [ ] **Step 3: Update the core invariant**

In `README.md` lines 180-181, replace:

```
- **No hallucination:** Chat Q&A only answers from retrieved chunks above a similarity threshold; if nothing clears it, it says so instead of falling back to general knowledge. Web-search-assisted answers are visually distinguished ("Web" badge), never blended silently with document-grounded ones.
```

with:

```
- **Documents first, flagged fallback:** Chat Q&A reasons over retrieved chunks above a similarity threshold and prefers them; when they don't fully cover a question it may supplement with general knowledge, but that answer is clearly flagged ("General knowledge" / "Documents + General knowledge" badge) — never blended silently. Web-search-assisted answers are visually distinguished ("Web" badge) the same way.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe chat's documents-first, flagged-fallback behavior"
```
