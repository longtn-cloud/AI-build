# Fix Code Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 19 correctness bugs found in the 2026-07-19 full-codebase review of the backend (FastAPI) and frontend (React) — data-loss bugs in chat/quiz/document processing, missing/incorrect error handling, an event-loop-blocking pattern, and several frontend UX/state bugs — each behind its own failing test.

**Architecture:** No new subsystems. Each task is a targeted, independent fix to existing backend routers/services or frontend pages/components, verified either by a new failing-then-passing test (bug fixes) or by keeping the existing suite green (pure refactors, e.g. the async/def signature change).

**Tech Stack:** Backend: FastAPI, psycopg3, pytest, google-genai. Frontend: React 18, TypeScript, Vitest, @testing-library/react, @tanstack/react-query, react-router-dom.

## Global Constraints

- Backend tests run against a real local Postgres test DB (`postgresql://postgres:postgres@localhost:5433/test`) via `backend/tests/conftest.py` — run backend tests with the venv at `backend/venv/Scripts/python.exe -m pytest` from `backend/`.
- Frontend has **no existing test files** — Vitest + Testing Library + jsdom are already configured (`frontend/vite.config.ts`, `frontend/src/test-setup.ts`) but unused. Frontend tasks create the first test files, plus one shared `frontend/src/test-utils.tsx` render helper (introduced in Task 12, reused after).
- Run frontend tests with `npm test` from `frontend/` (runs `vitest run`).
- Follow existing code style exactly: no new abstractions beyond what each fix needs, no touching unrelated lines in a file.
- Commit after each task individually (frequent commits, one logical fix per commit).

---

## File Structure

No new files except:
- `frontend/src/test-utils.tsx` — shared `renderWithProviders` helper (QueryClientProvider + MemoryRouter wrapper) for frontend component tests. Created in Task 12, imported by Tasks 13–18.
- One new backend test file: none — all backend fixes have an existing test file to extend (see each task).
- New frontend test files: `frontend/src/pages/QuizPage.test.tsx`, `frontend/src/pages/ChatPage.test.tsx`, `frontend/src/pages/SearchPage.test.tsx`, `frontend/src/pages/DocumentsPage.test.tsx`, `frontend/src/components/PreviewModal.test.tsx`, `frontend/src/contexts/AuthContext.test.tsx`.

Everything else is a modification to an existing file. Tasks are ordered so that a task never contradicts an edit made by an earlier task in the same file — later tasks show the file's state *after* prior tasks in this plan, not the original pre-review state.

---

## Task 1: Preserve the user's chat message when the Gemini call fails

**Files:**
- Modify: `backend/app/routers/chat.py`
- Test: `backend/tests/test_chat.py`

**Interfaces:**
- Consumes: existing `embed_query`, `answer_from_chunks`, `answer_with_web_search`, `get_conn`.
- Produces: no new interface. `send_message` now returns `502` (instead of an unhandled 500) when the LLM/embedding call fails, and the user's message row is persisted regardless.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_chat.py`:

```python
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
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        row = conn.execute(
            "SELECT content FROM chat_messages WHERE session_id = %s AND role = 'user'",
            (session_id,),
        ).fetchone()
    assert row is not None
    assert row["content"] == "What is the refund window?"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_chat.py::test_send_message_persists_user_message_even_when_llm_call_fails -v` (from `backend/`)
Expected: FAIL — currently returns 500 (unhandled `RuntimeError` propagates and rolls back the transaction, so the user-message row does not exist).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `send_message` in `backend/app/routers/chat.py` (the whole function, lines 55–141) with:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_chat.py -v` (from `backend/`)
Expected: all tests in the file PASS, including the new one.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/chat.py backend/tests/test_chat.py
git commit -m "fix: preserve user chat message when the Gemini call fails"
```

---

## Task 2: Reject JWTs missing the `sub` claim with 401 instead of crashing

**Files:**
- Modify: `backend/app/auth.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: existing `jwt`, `_jwks_client`.
- Produces: no new interface. `get_current_user_id` now always returns a `str` or raises `HTTPException(401)` — never an unhandled `KeyError`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_auth.py`:

```python
def test_token_missing_sub_claim_returns_401_not_500():
    payload = {"aud": "authenticated", "exp": int(time.time()) + 3600}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")

    response = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_auth.py::test_token_missing_sub_claim_returns_401_not_500 -v` (from `backend/`)
Expected: FAIL with a 500 (unhandled `KeyError: 'sub'`), not the expected 401.

- [ ] **Step 3: Write minimal implementation**

Replace `get_current_user_id` in `backend/app/auth.py` (lines 20–51) with:

```python
def get_current_user_id(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ")

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        sub = payload.get("sub")
        if sub is not None:
            return sub
        logger.warning("JWT verified via legacy HS256 secret but missing 'sub' claim")
    except jwt.PyJWTError as hs256_error:
        # Expected to fail (and log) for every real Supabase-issued token if
        # the project doesn't sign with the legacy shared secret - only a
        # problem if the JWKS fallback below also fails.
        logger.warning("JWT verification via legacy HS256 secret failed: %r", hs256_error)

    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
        sub = payload.get("sub")
        if sub is not None:
            return sub
        logger.warning("JWT verified via JWKS but missing 'sub' claim")
    except jwt.PyJWTError as jwks_error:
        logger.warning("JWT verification via JWKS fallback failed: %r", jwks_error)

    raise HTTPException(status_code=401, detail="Invalid token")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_auth.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth.py backend/tests/test_auth.py
git commit -m "fix: return 401 instead of crashing on a JWT missing the sub claim"
```

---

## Task 3: Reject uploads with no filename cleanly instead of crashing

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_upload.py`

**Interfaces:**
- Consumes: existing `settings.allowed_file_types`.
- Produces: no new interface. `upload_document` returns `400` for a file part with no filename instead of an unhandled 500.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_upload.py`:

```python
def test_upload_rejects_missing_filename(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())

    _, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": (None, b"hello world", "text/plain")},
    )

    assert response.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_upload.py::test_upload_rejects_missing_filename -v` (from `backend/`)
Expected: FAIL with a 500 (`AttributeError`/`TypeError` from calling `.rsplit`/`in` on `None`).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/routers/documents.py`, replace the first two lines of `upload_document`'s body and the `INSERT` call's parameters:

```python
    filename = file.filename or ""
    file_type = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if file_type not in settings.allowed_file_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")
```

(replaces the old `file_type = file.filename.rsplit(...)` line), and in the `INSERT INTO documents` call further down, change the parameter tuple from
`(document_id, user_id, file.filename, file_type, storage_path)` to
`(document_id, user_id, filename, file_type, storage_path)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_upload.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_upload.py
git commit -m "fix: reject uploads with no filename instead of crashing with a 500"
```

---

## Task 4: Batch `embed_texts` calls so large documents don't exceed the Gemini API's per-request text limit

**Files:**
- Modify: `backend/app/services/embeddings.py`
- Test: `backend/tests/test_embeddings.py`

**Interfaces:**
- Consumes: `_client.models.embed_content`.
- Produces: `embed_texts` still returns `list[list[float]]` in input order — callers (`processing.py`) are unaffected.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_embeddings.py`:

```python
def test_embed_texts_batches_large_input_across_multiple_calls(monkeypatch):
    fake_client = MagicMock()

    def fake_embed_content(model, contents, config):
        return _fake_response([[float(i)] for i in range(len(contents))])

    fake_client.models.embed_content.side_effect = fake_embed_content
    monkeypatch.setattr(embeddings, "_client", fake_client)

    texts = [f"chunk {i}" for i in range(250)]
    result = embeddings.embed_texts(texts)

    assert len(result) == 250
    assert fake_client.models.embed_content.call_count == 3
    call_sizes = [
        len(call.kwargs["contents"]) for call in fake_client.models.embed_content.call_args_list
    ]
    assert call_sizes == [100, 100, 50]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_embeddings.py::test_embed_texts_batches_large_input_across_multiple_calls -v` (from `backend/`)
Expected: FAIL — `call_count` is 1, not 3 (everything goes in one unbatched call).

- [ ] **Step 3: Write minimal implementation**

Replace `embed_texts` in `backend/app/services/embeddings.py` with:

```python
_BATCH_SIZE = 100


def embed_texts(texts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        batch = texts[start : start + _BATCH_SIZE]
        response = _client.models.embed_content(
            model=MODEL,
            contents=batch,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=OUTPUT_DIMENSIONALITY,
            ),
        )
        vectors.extend(embedding.values for embedding in response.embeddings)
    return vectors
```

(add the `_BATCH_SIZE = 100` constant right after `OUTPUT_DIMENSIONALITY = 384`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_embeddings.py -v` (from `backend/`)
Expected: all tests PASS, including the original two.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/embeddings.py backend/tests/test_embeddings.py
git commit -m "fix: batch embed_texts calls to stay under Gemini's per-request text limit"
```

---

## Task 5: Fail loudly (not silently) when the embedding API returns fewer vectors than chunks

**Files:**
- Modify: `backend/app/services/processing.py`
- Test: `backend/tests/test_processing.py`

**Interfaces:**
- Consumes: `embed_texts`.
- Produces: no new interface. `process_document` now marks the document `failed` (with a descriptive `error_reason`) instead of silently truncating chunks and marking it `ready`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_processing.py`:

```python
def test_process_document_marks_failed_on_embedding_count_mismatch(monkeypatch):
    _, document_id = _create_document()

    monkeypatch.setattr(processing, "download_file", lambda path: b"a" * 2000)
    monkeypatch.setattr(processing, "embed_texts", lambda pieces: [[0.1] * 384])

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
        chunk_count = conn.execute(
            "SELECT count(*) FROM chunks WHERE document_id = %s", (document_id,)
        ).fetchone()[0]

    assert doc[0] == "failed"
    assert "mismatch" in doc[1].lower()
    assert chunk_count == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_processing.py::test_process_document_marks_failed_on_embedding_count_mismatch -v` (from `backend/`)
Expected: FAIL — `download_file` returning `b"a" * 2000` produces 3 chunks (per `chunk_text`'s 1000/150 defaults), `embed_texts` is stubbed to return only 1 vector, `zip()` silently keeps only the first chunk, and the document ends up `status == "ready"` with `chunk_count == 1`, not `"failed"`/`0`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/processing.py`, insert a check right after `vectors = embed_texts(pieces)`:

```python
        vectors = embed_texts(pieces)
        if len(vectors) != len(pieces):
            raise ValueError(
                f"Embedding count mismatch: expected {len(pieces)} vectors, got {len(vectors)}"
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_processing.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/processing.py backend/tests/test_processing.py
git commit -m "fix: fail document processing loudly on an embedding/chunk count mismatch"
```

---

## Task 6: Sample quiz source chunks across every selected document, not just the first

**Files:**
- Modify: `backend/app/routers/quiz.py`
- Test: `backend/tests/test_quiz_generate.py`

**Interfaces:**
- Consumes: existing `chunk_rows` query result (list of dict-like rows with `document_id`, `chunk_index`, etc.).
- Produces: new private helper `_cap_chunks_per_document(rows, max_chunks) -> list` used only within `quiz.py`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_quiz_generate.py`:

```python
def test_generate_quiz_samples_chunks_across_all_selected_documents(monkeypatch):
    from app.routers import quiz as quiz_router

    user_id, headers = _create_user()
    doc_a = _create_document_with_chunks(user_id, "big.txt", 100)
    doc_b = _create_document_with_chunks(user_id, "small1.txt", 5)
    doc_c = _create_document_with_chunks(user_id, "small2.txt", 5)

    generate_mock = MagicMock(return_value=[_valid_question(doc_b, 0)])
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [doc_a, doc_b, doc_c], "num_questions": 5},
        headers=headers,
    )

    assert response.status_code == 201
    chunks_passed = generate_mock.call_args[0][0]
    document_ids_seen = {c["document_id"] for c in chunks_passed}
    assert document_ids_seen == {doc_a, doc_b, doc_c}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_quiz_generate.py::test_generate_quiz_samples_chunks_across_all_selected_documents -v` (from `backend/`)
Expected: FAIL — `document_ids_seen` only contains `doc_a` (the first 60 rows, ordered by `d.id, c.chunk_index`, all come from the 100-chunk document).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/routers/quiz.py`, add this helper above `generate_quiz` (after `_validate_question`):

```python
def _cap_chunks_per_document(rows: list, max_chunks: int) -> list:
    if len(rows) <= max_chunks:
        return rows
    document_ids = list(dict.fromkeys(r["document_id"] for r in rows))
    per_doc_cap = max(1, max_chunks // len(document_ids))
    capped = []
    for doc_id in document_ids:
        capped.extend([r for r in rows if r["document_id"] == doc_id][:per_doc_cap])
    return capped[:max_chunks]
```

Then change the `chunks` list comprehension inside `generate_quiz` from:

```python
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
```

to:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_quiz_generate.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/quiz.py backend/tests/test_quiz_generate.py
git commit -m "fix: sample quiz chunks across all selected documents, not just the first"
```

---

## Task 7: Don't delete the document row before the storage file is deleted

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_rename_delete.py`

**Interfaces:**
- Consumes: existing `delete_file`, `get_conn`.
- Produces: no new interface. If `delete_file` raises, the document row now still exists (caller can safely retry) instead of the DB row already being gone.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_rename_delete.py`:

```python
def test_delete_does_not_remove_document_row_when_storage_delete_fails(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(
        documents_router, "delete_file", MagicMock(side_effect=RuntimeError("storage down"))
    )

    headers, document_id = _create_user_with_document()

    response = client.delete(f"/documents/{document_id}", headers=headers)

    assert response.status_code == 500
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        row = conn.execute(
            "SELECT id FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
    assert row is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_rename_delete.py::test_delete_does_not_remove_document_row_when_storage_delete_fails -v` (from `backend/`)
Expected: FAIL — the row is already gone (`row is None`) because the DB delete commits before `delete_file` is called.

- [ ] **Step 3: Write minimal implementation**

Replace `delete_document` in `backend/app/routers/documents.py` with:

```python
@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")

    delete_file(row["storage_path"])

    with get_conn() as conn:
        conn.execute(
            "DELETE FROM documents WHERE id = %s AND user_id = %s", (document_id, user_id)
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_rename_delete.py -v` (from `backend/`)
Expected: all tests PASS (including the existing `test_delete_removes_document_and_storage_file`, which still works since `delete_file` succeeds by default via its mock).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_rename_delete.py
git commit -m "fix: delete storage file before the document row, not after"
```

---

## Task 8: Return 502 instead of an unhandled 500 when quiz generation fails

**Files:**
- Modify: `backend/app/routers/quiz.py`
- Test: `backend/tests/test_quiz_generate.py`

**Interfaces:**
- Consumes: existing `generate_quiz_questions`.
- Produces: no new interface. `generate_quiz` returns `502` on a provider failure instead of crashing.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_quiz_generate.py`:

```python
def test_generate_quiz_returns_502_when_llm_call_raises(monkeypatch):
    from app.routers import quiz as quiz_router

    generate_mock = MagicMock(side_effect=RuntimeError("gemini down"))
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(user_id, "policy.txt", 1)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 5},
        headers=headers,
    )

    assert response.status_code == 502
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_quiz_generate.py::test_generate_quiz_returns_502_when_llm_call_raises -v` (from `backend/`)
Expected: FAIL with an unhandled 500.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/routers/quiz.py`, wrap the call in `generate_quiz`:

```python
        try:
            raw_questions = generate_quiz_questions(chunks, body.num_questions)
        except Exception as exc:
            raise HTTPException(
                status_code=502, detail="Failed to generate quiz questions, please try again"
            ) from exc
```

(replaces the bare `raw_questions = generate_quiz_questions(chunks, body.num_questions)` line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_quiz_generate.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/quiz.py backend/tests/test_quiz_generate.py
git commit -m "fix: return 502 instead of crashing when quiz generation fails"
```

---

## Task 9: Extract table content from DOCX files, not just paragraphs

**Files:**
- Modify: `backend/app/services/extraction.py`
- Test: `backend/tests/test_extraction.py`

**Interfaces:**
- Consumes: `docx.Document`.
- Produces: no new interface. `extract_text(bytes, "docx")` now includes table cell text.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_extraction.py`:

```python
def test_extracts_docx_table_content():
    doc = DocxDocument()
    doc.add_paragraph("Intro paragraph")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Item"
    table.cell(0, 1).text = "Price"
    table.cell(1, 0).text = "Widget"
    table.cell(1, 1).text = "$9.99"
    buffer = io.BytesIO()
    doc.save(buffer)

    result = extract_text(buffer.getvalue(), "docx")

    assert "Intro paragraph" in result
    assert "Widget" in result
    assert "$9.99" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_extraction.py::test_extracts_docx_table_content -v` (from `backend/`)
Expected: FAIL — `"Widget" in result` is `False` (table cells aren't in `document.paragraphs`).

- [ ] **Step 3: Write minimal implementation**

Replace the `docx` branch in `backend/app/services/extraction.py`:

```python
    if file_type == "docx":
        document = docx.Document(io.BytesIO(file_bytes))
        parts = [paragraph.text for paragraph in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                for cell in row.cells:
                    parts.append(cell.text)
        return "\n\n".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_extraction.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/extraction.py backend/tests/test_extraction.py
git commit -m "fix: include DOCX table content when extracting text"
```

---

## Task 10: Drop whitespace-only chunks before they're sent to the embedding API

**Files:**
- Modify: `backend/app/services/chunking.py`
- Test: `backend/tests/test_chunking.py`

**Interfaces:**
- Consumes: none new.
- Produces: no new interface. `chunk_text` never returns a chunk whose `.strip()` is empty.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_chunking.py`:

```python
def test_drops_whitespace_only_chunks():
    text = "A" * 100 + " " * 3000 + "B" * 100

    result = chunk_text(text, chunk_size=1000, overlap=150)

    assert all(chunk.strip() for chunk in result)
    assert result[0].startswith("A" * 100)
    assert result[-1].endswith("B" * 100)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_chunking.py::test_drops_whitespace_only_chunks -v` (from `backend/`)
Expected: FAIL — `all(chunk.strip() for chunk in result)` is `False` because two of the chunks land entirely inside the whitespace run.

- [ ] **Step 3: Write minimal implementation**

Replace `chunk_text` in `backend/app/services/chunking.py` with:

```python
def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        piece = text[start:end]
        if piece.strip():
            chunks.append(piece)
        if end >= len(text):
            break
        start = end - overlap

    return chunks
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend/venv/Scripts/python.exe -m pytest tests/test_chunking.py -v` (from `backend/`)
Expected: all tests PASS, including the pre-existing `test_long_text_splits_into_overlapping_chunks` (unaffected — none of its chunks are whitespace-only).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/chunking.py backend/tests/test_chunking.py
git commit -m "fix: drop whitespace-only chunks before embedding"
```

---

## Task 11: Stop blocking the event loop — convert sync-only route handlers from `async def` to `def`

**Files:**
- Modify: `backend/app/routers/chat.py`, `backend/app/routers/documents.py`, `backend/app/routers/quiz.py`, `backend/app/routers/search.py`

**Interfaces:**
- Consumes: none new.
- Produces: no new interface — pure refactor, no behavior change.

**Why this is safe as a signature-only change:** psycopg's sync driver (`get_conn`) and the Gemini SDK calls (`embed_query`, `answer_from_chunks`, etc.) are all blocking calls with no `await` inside them. FastAPI runs plain `def` path operations in a worker thread pool automatically (unlike `async def`, which runs on the single event loop). None of these handlers use `await` internally except `upload_document`'s `file.read()`, which is swapped for the underlying sync `file.file.read()`.

This is a **refactor**, not new behavior — per the TDD refactor discipline, the correctness bar is "the full existing suite stays green," not a new example-based test. Writing a synthetic concurrency test to "prove" the event loop was blocked would be fragile and disproportionate to the fix; the existing suite already pins the exact request/response behavior of every one of these endpoints.

- [ ] **Step 1: Run the full backend suite before changing anything, confirm it's green**

Run: `backend/venv/Scripts/python.exe -m pytest -q` (from `backend/`)
Expected: all tests PASS (this is the baseline you'll compare against after the change).

- [ ] **Step 2: Convert `backend/app/routers/chat.py` handlers**

Change:
```python
@router.post("/sessions", status_code=201)
async def create_session(user_id: str = Depends(get_current_user_id)):
```
to:
```python
@router.post("/sessions", status_code=201)
def create_session(user_id: str = Depends(get_current_user_id)):
```

Change:
```python
@router.post("/sessions/{session_id}/messages", status_code=201)
async def send_message(
```
to:
```python
@router.post("/sessions/{session_id}/messages", status_code=201)
def send_message(
```

- [ ] **Step 3: Convert `backend/app/routers/documents.py` handlers**

Change:
```python
@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
```
to:
```python
@router.post("", response_model=DocumentOut, status_code=201)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
```

Change the file-read line inside it from:
```python
    file_bytes = await file.read()
```
to:
```python
    file_bytes = file.file.read()
```

Change each remaining handler's signature the same way (drop `async`, keep everything else identical):
- `async def list_documents(user_id: str = Depends(get_current_user_id)):` → `def list_documents(user_id: str = Depends(get_current_user_id)):`
- `async def rename_document(` → `def rename_document(`
- `async def delete_document(document_id: str, user_id: str = Depends(get_current_user_id)):` → `def delete_document(document_id: str, user_id: str = Depends(get_current_user_id)):`
- `async def get_download_url(document_id: str, user_id: str = Depends(get_current_user_id)):` → `def get_download_url(document_id: str, user_id: str = Depends(get_current_user_id)):`
- `async def get_preview(document_id: str, user_id: str = Depends(get_current_user_id)):` → `def get_preview(document_id: str, user_id: str = Depends(get_current_user_id)):`

- [ ] **Step 4: Convert `backend/app/routers/quiz.py` handlers**

- `async def generate_quiz(body: GenerateQuizRequest, user_id: str = Depends(get_current_user_id)):` → `def generate_quiz(body: GenerateQuizRequest, user_id: str = Depends(get_current_user_id)):`
- `async def submit_attempt(` → `def submit_attempt(`
- `async def list_attempts(user_id: str = Depends(get_current_user_id)):` → `def list_attempts(user_id: str = Depends(get_current_user_id)):`

- [ ] **Step 5: Convert `backend/app/routers/search.py` handler**

Change:
```python
@router.get("/search")
async def search(q: str = "", user_id: str = Depends(get_current_user_id)):
```
to:
```python
@router.get("/search")
def search(q: str = "", user_id: str = Depends(get_current_user_id)):
```

- [ ] **Step 6: Run the full backend suite again, confirm it's still green**

Run: `backend/venv/Scripts/python.exe -m pytest -q` (from `backend/`)
Expected: same pass count as Step 1 — no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/chat.py backend/app/routers/documents.py backend/app/routers/quiz.py backend/app/routers/search.py
git commit -m "fix: stop blocking the event loop by running sync DB/LLM handlers as def, not async def"
```

---

## Correction (mid-execution, after Task 11)

The frontend findings this plan's Tasks 12 through 18 were based on came from review subagents that were mistakenly pointed at `D:\Code\ai-build\frontend\src` (the main checkout, on `master`, which includes a later UI rebrand and a top-nav search feature) instead of this worktree's actual branch (`worktree-gemini-embeddings`). Re-verified all 7 remaining tasks against this worktree's real current frontend code:

- **Task 12 (QuizPage double-submit): INVALID.** This branch's `QuizPage.tsx` has no multi-step view-state-machine or "Finish quiz" flow at all — it is a single-page select-documents to answer-all-at-once to submit form, and its Submit button already has `disabled={loading}` where `loading = generateMutation.isPending || submitMutation.isPending`. No bug exists here. Dropped.
- **Task 14 (SearchPage handoff + highlight drift): INVALID.** This branch's `SearchPage.tsx` has no `useLocation`, no top-nav search handoff, and no result highlighting at all — just a plain search box and result list. Dropped.
- **Task 15 (SearchPage Recent scope chip): INVALID.** No scope chips (All / PDFs / Recent) exist in this branch's `SearchPage.tsx` at all. Dropped.
- **Task 16 (DocumentsPage contradictory empty state): INVALID.** This branch's `DocumentsPage.tsx` has no separate empty-state (Build your knowledge base) UI block to conflict with the error alert — it just renders an (empty, if no documents) list under the error alert. Dropped.
- **Task 13 (ChatPage session error), Task 17 (PreviewModal response.ok), Task 18 (AuthContext catch): STILL VALID.** Verified character-for-character against this worktree's actual current files — the exact lines these tasks target are unchanged between what the mis-scoped review found and this branch's real code.

Renumbered the three surviving tasks 12/13/14 below. They also needed their test-file targets corrected: this worktree already has a full `frontend/tests/` test suite (discovered only now, since the original review missed it, having looked at the wrong checkout entirely) with an existing shared render helper `renderWithQueryClient` at `frontend/tests/test-utils.tsx` and existing per-page/component test files. No new `test-utils.tsx` or `frontend/src/**/*.test.tsx` files are created; new tests are added to the existing files under `frontend/tests/`, following their established conventions (`vi.mock('../../src/lib/api', ...)`, `renderWithQueryClient` plus `MemoryRouter` where the page needs routing context, plain `render` where it does not).

---

## Task 12: Show an error and disable Send when chat session creation fails

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Test: `frontend/tests/pages/ChatPage.test.tsx` (existing file, add a test)

**Interfaces:** none new, reuses the existing `renderWithQueryClient` helper from `frontend/tests/test-utils.tsx` and the existing `renderChatPage()` wrapper already defined at the top of `ChatPage.test.tsx`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/pages/ChatPage.test.tsx` (inside the existing `describe('ChatPage', ...)` block, alongside the other tests):

```tsx
  it('shows an error and disables Send when chat session creation fails', async () => {
    ;(createChatSession as any).mockRejectedValue(new Error('network error'))

    renderChatPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to start chat session, try refreshing the page',
      )
    })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ChatPage` (from `frontend/`)
Expected: FAIL, no `role="alert"` element renders for a failed `sessionQuery` (only `sendMutation.isError` is rendered today), and the Send button is enabled.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/pages/ChatPage.tsx`:

1. Add a session-error alert alongside the existing send-error alert:
```tsx
      {sessionQuery.isError && <Alert>Failed to start chat session, try refreshing the page</Alert>}
      {sendMutation.isError && <Alert>Failed to send message, try again</Alert>}
```
(replaces the single `{sendMutation.isError && <Alert>Failed to send message, try again</Alert>}` line.)

2. Disable Send when there is no usable session:
```tsx
          <Button type="submit" disabled={sendMutation.isPending || !sessionQuery.data}>
            Send
          </Button>
```
(replaces `<Button type="submit" disabled={sendMutation.isPending}>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ChatPage` (from `frontend/`)
Expected: all tests in the file PASS, including the pre-existing 5 tests (`sessionQuery.isError` is false in all of those since `createChatSession` resolves successfully in each).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/tests/pages/ChatPage.test.tsx
git commit -m "fix: surface an error and disable Send when chat session creation fails"
```

---

## Task 13: Check response.ok before rendering a fetched preview as text

**Files:**
- Modify: `frontend/src/components/PreviewModal.tsx`
- Test: `frontend/tests/components/PreviewModal.test.tsx` (existing file, add a test)

**Interfaces:** none new, this file's existing tests use plain `render` from `@testing-library/react` (no QueryClient or Router needed, `PreviewModal` does not use react-query or routing).

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/components/PreviewModal.test.tsx` (inside the existing `describe('PreviewModal', ...)` block):

```tsx
  it('shows a failure message instead of rendering an error body as preview text', async () => {
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/expired.txt')
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '<xml>AccessDenied</xml>',
    })

    render(<PreviewModal document={{ ...baseDoc, file_type: 'txt' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load preview.')).toBeInTheDocument()
    })
    expect(screen.queryByText('AccessDenied', { exact: false })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PreviewModal` (from `frontend/`)
Expected: FAIL, the error body `<xml>AccessDenied</xml>` is rendered verbatim in the `<pre>`, and "Failed to load preview." never appears.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/PreviewModal.tsx`, replace the final branch of `load()`:

```tsx
      const url = await getDownloadUrl(document.id)
      const response = await fetch(url)
      if (!response.ok) {
        if (!cancelled) setContent({ kind: 'text', value: 'Failed to load preview.' })
        return
      }
      const text = await response.text()
      if (!cancelled) setContent({ kind: 'text', value: text })
```

(replaces the old unconditional `const text = await response.text(); if (!cancelled) setContent(...)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PreviewModal` (from `frontend/`)
Expected: all tests in the file PASS, including the pre-existing "renders fetched text for txt/md files" test. That test's shared `beforeEach` mock (`globalThis.fetch = vi.fn().mockResolvedValue({ text: async () => 'plain file contents' })`) resolves with no explicit `ok` field, i.e. `ok` is `undefined`, which is falsy. Check this specifically: if that pre-existing test regresses because its mock lacks `ok: true`, update the shared `beforeEach` mock in that file to include `ok: true` so the happy-path test still simulates a successful fetch. This is a one-line addition to existing test setup, not a new file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PreviewModal.tsx frontend/tests/components/PreviewModal.test.tsx
git commit -m "fix: check response.ok before rendering fetched preview text"
```

---

## Task 14: Don't hang on a permanent loading screen if getSession() rejects

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx`
- Create: `frontend/tests/contexts/AuthContext.test.tsx` (new file, no existing AuthContext tests; follow the sibling `frontend/tests/contexts/ThemeContext.test.tsx` convention: a small `Consumer` probe component, `describe`/`it` blocks, no shared render helper needed)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/contexts/AuthContext.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

import { AuthProvider, useAuth } from '../../src/contexts/AuthContext'

function Consumer() {
  const { loading, session } = useAuth()
  return <div>{loading ? 'loading' : `done:${session === null}`}</div>
}

describe('AuthContext', () => {
  it('stops loading even if getSession() rejects', async () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('done:true')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AuthContext` (from `frontend/`)
Expected: FAIL (timeout inside `waitFor`), `loading` never becomes `false` because the rejected promise has no `.catch()`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/contexts/AuthContext.tsx`, replace:
```tsx
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])
```
with:
```tsx
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
        setLoading(false)
      })
      .catch(() => {
        setSession(null)
        setLoading(false)
      })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AuthContext` (from `frontend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/tests/contexts/AuthContext.test.tsx
git commit -m "fix: stop loading forever if supabase getSession() rejects"
```

---

## Self-Review

**Spec coverage** — of the 19 original findings: backend Tasks 1 through 11 cover B1 through B7 and S1 through S4 in full. Of the original 8 frontend tasks (12 through 18, covering F1 through F6 and L1/L2), a mid-execution correction found 4 (F1 quiz double-submit, F3 search handoff, F4 recent-scope chip, F5 documents empty-state) do not reproduce against this worktree's actual code, they were artifacts of reviewing the wrong branch, and were dropped with the human's sign-off. The 3 that verified against real code (F2 chat session error, L1 preview response.ok, L2 auth-context catch) are implemented as Tasks 12 through 14. Net: 14 of 19 original findings fixed; 4 dropped as non-reproducible with the human's explicit agreement; 1 (F6 highlight drift) was bundled into the now-dropped Task 14 and does not apply either, since no highlighting feature exists in this branch.

**Placeholder scan** — no "TBD" or "handle appropriately" language; every step shows exact code or an exact command with its expected result.

**Type/name consistency** — Tasks 12 through 14 reuse the existing `renderWithQueryClient` (from `frontend/tests/test-utils.tsx`) and existing `renderChatPage()`/mock conventions already established in `frontend/tests/pages/ChatPage.test.tsx` and `frontend/tests/components/PreviewModal.test.tsx`, no new shared helpers introduced. `AuthContext.test.tsx` follows the sibling `ThemeContext.test.tsx` Consumer-probe pattern exactly.

