# Search Quality & Result Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/search`'s vector-only ranking with hybrid (keyword + vector) ranking via Reciprocal Rank Fusion, make the "PDFs only"/"Recent" filters real and server-side, and rework result display (document grouping, multi-term highlighting, pagination, relevance indicator).

**Architecture:** One new generated `tsvector` column + GIN index on `chunks`. `/search` computes vector-distance and full-text rank as two independent candidate pools (top 50 each) inside one SQL query, fuses them via RRF, and returns a normalized 0–1 score plus a `has_more` flag for offset-based pagination. The frontend replaces the single scope-pill row with two independent filter controls, groups flat chunk results into per-document cards, and highlights every query term instead of the first literal substring.

**Tech Stack:** FastAPI + psycopg3 + pgvector + Postgres full-text search (backend); React + TanStack Query (frontend). No new dependencies.

## Global Constraints

- Page size is fixed at 10 (`PAGE_SIZE`), not user-configurable.
- Candidate pool per ranking signal is capped at 50 (`CANDIDATE_POOL`).
- RRF constant `k = 60` (`RRF_K`).
- `file_type` filter values from the API are `pdf`, `docx`, `text` (where `text` covers both `txt` and `md` documents) — not the raw `documents.file_type` values.
- `recent` means `documents.uploaded_at >= now() - interval '30 days'`.
- No minimum relevance floor — weak matches still return, consistent with the original Search plan (`docs/superpowers/specs/2026-07-18-search-design.md`).
- Spec: `docs/superpowers/specs/2026-07-19-search-quality-and-display-design.md`.

---

### Task 1: `content_tsv` migration

**Files:**
- Create: `backend/migrations/0004_search_fts.sql`
- Modify: `backend/tests/conftest.py`

**Interfaces:**
- Produces: `chunks.content_tsv` (generated `tsvector` column), used by Task 3's full-text ranking query.

- [ ] **Step 1: Write the migration**

```sql
alter table chunks add column content_tsv tsvector
    generated always as (to_tsvector('english', content)) stored;

create index chunks_content_tsv_idx on chunks using gin (content_tsv);
```

- [ ] **Step 2: Wire the migration into the test fixture**

In `backend/tests/conftest.py`, add the new migration's SQL alongside the existing three, and execute it in the same `autouse` session fixture:

```python
@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    _assert_is_test_db(TEST_DB_URL)
    stub_sql = (BACKEND_ROOT / "tests" / "fixtures" / "0000_test_auth_stub.sql").read_text()
    init_sql = (BACKEND_ROOT / "migrations" / "0001_init.sql").read_text()
    chat_sql = (BACKEND_ROOT / "migrations" / "0002_chat.sql").read_text()
    quiz_sql = (BACKEND_ROOT / "migrations" / "0003_quiz.sql").read_text()
    search_fts_sql = (BACKEND_ROOT / "migrations" / "0004_search_fts.sql").read_text()
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
    yield
```

- [ ] **Step 3: Run the full backend suite to confirm the migration applies cleanly and nothing regresses**

Run (from `backend/`, with the test Postgres container up — `docker compose -f docker-compose.test.yml up -d` if not already running):
```bash
python -m pytest -q
```
Expected: all existing tests still PASS (this step only adds a column + index; no behavior changed yet).

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/0004_search_fts.sql backend/tests/conftest.py
git commit -m "feat: add tsvector column for full-text search on chunks"
```

---

### Task 2: Server-side file-type/recent filters + pagination (vector ranking unchanged)

Keeps ranking as pure vector similarity for now — this task only makes filters real and adds pagination, isolating that change from the ranking-algorithm swap in Task 3.

**Files:**
- Modify: `backend/app/routers/search.py`
- Modify: `backend/tests/test_search.py`

**Interfaces:**
- Produces: `GET /search` now accepts `file_type` (`pdf`|`docx`|`text`), `recent` (bool), `offset` (int) query params; response becomes `{"results": [...], "has_more": bool}` (was `{"results": [...]}`).

- [ ] **Step 1: Extend the test helper and write the failing filter/pagination tests**

Replace `_create_document_with_chunks` in `backend/tests/test_search.py` and add the new tests (keep all existing tests in the file as-is below this):

```python
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)

TARGET_VEC = [1.0] + [0.0] * 383
DISTRACTOR_VEC = [0.0, 1.0] + [0.0] * 382


def _create_user() -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document_with_chunks(
    user_id: str,
    filename: str,
    chunk_vectors: list[list[float]],
    file_type: str = "txt",
    contents: list[str] | None = None,
    uploaded_at: datetime | None = None,
) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status, uploaded_at)
            VALUES (%s, %s, %s, %s, 'path/doc', 'ready', COALESCE(%s, now()))
            """,
            (document_id, user_id, filename, file_type, uploaded_at),
        )
        for index, vector in enumerate(chunk_vectors):
            content = contents[index] if contents else f"chunk {index} content"
            conn.execute(
                """
                INSERT INTO chunks (document_id, content, embedding, chunk_index)
                VALUES (%s, %s, %s, %s)
                """,
                (document_id, content, vector, index),
            )
    return document_id


def test_search_returns_best_matching_chunk_first(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    document_id = _create_document_with_chunks(
        user_id, "report.txt", [DISTRACTOR_VEC, TARGET_VEC, DISTRACTOR_VEC]
    )

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["document_id"] == document_id
    assert results[0]["filename"] == "report.txt"
    assert results[0]["chunk_index"] == 1
    assert results[0]["content"] == "chunk 1 content"
    assert results[0]["total_chunks"] == 3
    assert results[0]["score"] > results[1]["score"]


def test_search_excludes_other_users_chunks(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "mine.txt", [TARGET_VEC])

    other_user_id, _ = _create_user()
    _create_document_with_chunks(other_user_id, "theirs.txt", [TARGET_VEC])

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["mine.txt"]


def test_search_rejects_empty_query(monkeypatch):
    from app.routers import search as search_router

    embed_mock = MagicMock()
    monkeypatch.setattr(search_router, "embed_query", embed_mock)

    _, headers = _create_user()

    response = client.get("/search", params={"q": "   "}, headers=headers)

    assert response.status_code == 400
    embed_mock.assert_not_called()


def test_search_rejects_invalid_file_type(monkeypatch):
    from app.routers import search as search_router

    embed_mock = MagicMock()
    monkeypatch.setattr(search_router, "embed_query", embed_mock)

    _, headers = _create_user()

    response = client.get(
        "/search", params={"q": "revenue", "file_type": "exe"}, headers=headers
    )

    assert response.status_code == 400
    embed_mock.assert_not_called()


def test_search_returns_empty_results_for_user_with_no_chunks(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    _, headers = _create_user()

    response = client.get("/search", params={"q": "revenue"}, headers=headers)

    assert response.status_code == 200
    assert response.json() == {"results": [], "has_more": False}


def test_search_file_type_filter_excludes_other_types(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    _create_document_with_chunks(user_id, "report.pdf", [TARGET_VEC], file_type="pdf")
    _create_document_with_chunks(user_id, "report.docx", [TARGET_VEC], file_type="docx")

    response = client.get(
        "/search", params={"q": "revenue", "file_type": "pdf"}, headers=headers
    )

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["report.pdf"]


def test_search_recent_filter_excludes_old_documents(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    old_timestamp = datetime.now(timezone.utc) - timedelta(days=60)
    _create_document_with_chunks(user_id, "old.txt", [TARGET_VEC], uploaded_at=old_timestamp)
    _create_document_with_chunks(user_id, "new.txt", [TARGET_VEC])

    response = client.get(
        "/search", params={"q": "revenue", "recent": "true"}, headers=headers
    )

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["new.txt"]


def test_search_paginates_with_offset_and_has_more(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    for i in range(15):
        _create_document_with_chunks(user_id, f"doc{i}.txt", [TARGET_VEC])

    first_page = client.get("/search", params={"q": "revenue"}, headers=headers).json()
    assert len(first_page["results"]) == 10
    assert first_page["has_more"] is True

    second_page = client.get(
        "/search", params={"q": "revenue", "offset": 10}, headers=headers
    ).json()
    assert len(second_page["results"]) == 5
    assert second_page["has_more"] is False
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `python -m pytest tests/test_search.py -v` (from `backend/`)
Expected: `test_search_rejects_invalid_file_type`, `test_search_file_type_filter_excludes_other_types`, `test_search_recent_filter_excludes_old_documents`, and `test_search_paginates_with_offset_and_has_more` FAIL (unknown query params / no `has_more` key). `test_search_returns_empty_results_for_user_with_no_chunks` FAILS on the updated assertion.

- [ ] **Step 3: Implement filters + pagination (vector ranking unchanged)**

Replace all of `backend/app/routers/search.py`:

```python
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user_id
from app.db import get_conn
from app.services.embeddings import embed_query

router = APIRouter(tags=["search"])

PAGE_SIZE = 10

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
    params: list = [query_embedding, user_id]

    if file_type is not None:
        types = FILE_TYPE_GROUPS[file_type]
        placeholders = ", ".join(["%s"] * len(types))
        filters_sql += f" AND d.file_type IN ({placeholders})"
        params.extend(types)

    if recent:
        filters_sql += " AND d.uploaded_at >= now() - interval '30 days'"

    sql = f"""
        SELECT
            d.id AS document_id,
            d.filename,
            c.chunk_index,
            c.content,
            1 - (c.embedding <=> %s::vector) AS score,
            count(*) OVER (PARTITION BY c.document_id) AS total_chunks,
            count(*) OVER () AS total_matches
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE {filters_sql}
        ORDER BY c.embedding <=> %s::vector
        LIMIT {PAGE_SIZE} OFFSET %s
    """

    params.append(query_embedding)
    params.append(offset)

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
                "score": row["score"],
            }
            for row in rows
        ],
        "has_more": has_more,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_search.py -v` (from `backend/`)
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/search.py backend/tests/test_search.py
git commit -m "feat: make search file-type/recent filters server-side, add pagination"
```

---

### Task 3: Hybrid RRF ranking

**Files:**
- Modify: `backend/app/routers/search.py`
- Modify: `backend/tests/test_search.py`

**Interfaces:**
- Consumes: `chunks.content_tsv` from Task 1.
- Produces: `score` in each result is now `fused_score / MAX_FUSED_SCORE` (0–1), not raw cosine similarity.

- [ ] **Step 1: Write the failing hybrid-ranking regression test**

Add to `backend/tests/test_search.py`:

```python
def test_search_surfaces_exact_keyword_match_despite_poor_vector_similarity(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    user_id, headers = _create_user()
    # 14 filler chunks with a perfect vector match but no keyword overlap.
    _create_document_with_chunks(
        user_id,
        "noise.txt",
        [TARGET_VEC] * 14,
        contents=[f"unrelated filler paragraph number {i}" for i in range(14)],
    )
    # One chunk with a terrible vector match but the exact query keyword.
    target_document_id = _create_document_with_chunks(
        user_id,
        "report.txt",
        [DISTRACTOR_VEC],
        contents=["the zyxqproj initiative launched in march"],
    )

    response = client.get("/search", params={"q": "zyxqproj"}, headers=headers)

    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["document_id"] == target_document_id
    assert results[0]["filename"] == "report.txt"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_search.py::test_search_surfaces_exact_keyword_match_despite_poor_vector_similarity -v` (from `backend/`)
Expected: FAIL — `report.txt`'s chunk has the worst vector similarity of the 15 candidates, so pure vector ranking puts it last (`results[0]` is a `noise.txt` chunk, not `report.txt`).

- [ ] **Step 3: Implement hybrid RRF ranking**

Replace all of `backend/app/routers/search.py`:

```python
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
    params: list = [query_embedding, q, user_id]

    if file_type is not None:
        types = FILE_TYPE_GROUPS[file_type]
        placeholders = ", ".join(["%s"] * len(types))
        filters_sql += f" AND d.file_type IN ({placeholders})"
        params.extend(types)

    if recent:
        filters_sql += " AND d.uploaded_at >= now() - interval '30 days'"

    sql = f"""
        WITH filtered AS (
            SELECT
                c.id, c.document_id, c.content, c.chunk_index,
                d.filename,
                count(*) OVER (PARTITION BY c.document_id) AS total_chunks,
                c.embedding <=> %s::vector AS vec_distance,
                ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', %s)) AS fts_score
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE {filters_sql}
        ),
        vec_candidates AS (
            SELECT id, row_number() OVER (ORDER BY vec_distance) AS vec_rank
            FROM filtered
            ORDER BY vec_distance
            LIMIT {CANDIDATE_POOL}
        ),
        fts_candidates AS (
            SELECT id, row_number() OVER (ORDER BY fts_score DESC) AS fts_rank
            FROM filtered
            WHERE fts_score > 0
            ORDER BY fts_score DESC
            LIMIT {CANDIDATE_POOL}
        ),
        fused AS (
            SELECT
                COALESCE(v.id, f.id) AS id,
                COALESCE(1.0 / ({RRF_K} + v.vec_rank), 0)
                    + COALESCE(1.0 / ({RRF_K} + f.fts_rank), 0) AS fused_score
            FROM vec_candidates v
            FULL OUTER JOIN fts_candidates f ON v.id = f.id
        )
        SELECT
            filtered.document_id, filtered.filename, filtered.chunk_index, filtered.total_chunks,
            filtered.content, fused.fused_score,
            count(*) OVER () AS total_matches
        FROM fused
        JOIN filtered ON filtered.id = fused.id
        ORDER BY fused.fused_score DESC
        LIMIT {PAGE_SIZE} OFFSET %s
    """

    params.append(offset)

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
                "score": min(row["fused_score"] / MAX_FUSED_SCORE, 1.0),
            }
            for row in rows
        ],
        "has_more": has_more,
    }
```

- [ ] **Step 4: Run the full search test suite to verify everything passes**

Run: `python -m pytest tests/test_search.py -v` (from `backend/`)
Expected: all tests PASS, including `test_search_returns_best_matching_chunk_first` (its query "revenue" has no keyword overlap with "chunk N content", so it stays effectively vector-only and is unaffected by fusion) and the new hybrid test.

- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest -q` (from `backend/`)
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/search.py backend/tests/test_search.py
git commit -m "feat: rank search results via reciprocal rank fusion of full-text and vector search"
```

---

### Task 4: Frontend `search()` API client

**Files:**
- Modify: `frontend/src/lib/api.ts:88-104`
- Modify: `frontend/tests/lib/api.test.ts`

**Interfaces:**
- Produces: `SearchResult` (unchanged shape), `SearchResponse = { results: SearchResult[]; has_more: boolean }`, `SearchFileType = 'pdf' | 'docx' | 'text'`, `SearchOptions = { fileType?: SearchFileType; recent?: boolean; offset?: number }`, `search(query: string, options?: SearchOptions): Promise<SearchResponse>` — used by Task 5's `SearchPage`.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/lib/api.test.ts`, replace the existing `'search sends an authorized GET request and returns results'` test with:

```typescript
  it('search sends an authorized GET request and returns results', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            document_id: '1',
            filename: 'a.txt',
            chunk_index: 0,
            total_chunks: 1,
            content: 'hello',
            score: 0.9,
          },
        ],
        has_more: false,
      }),
    })

    const response = await search('hello world')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=hello%20world'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(response).toEqual({
      results: [
        {
          document_id: '1',
          filename: 'a.txt',
          chunk_index: 0,
          total_chunks: 1,
          content: 'hello',
          score: 0.9,
        },
      ],
      has_more: false,
    })
  })

  it('search appends file_type, recent, and offset params when provided', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], has_more: false }),
    })

    await search('hello', { fileType: 'pdf', recent: true, offset: 10 })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=hello&file_type=pdf&recent=true&offset=10'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run tests/lib/api.test.ts`
Expected: FAIL — current `search()` returns a bare array and takes no options.

- [ ] **Step 3: Implement**

In `frontend/src/lib/api.ts`, replace lines 88-104 (the `SearchResult` type through the end of `search()`) with:

```typescript
export type SearchResult = {
  document_id: string
  filename: string
  chunk_index: number
  total_chunks: number
  content: string
  score: number
}

export type SearchResponse = {
  results: SearchResult[]
  has_more: boolean
}

export type SearchFileType = 'pdf' | 'docx' | 'text'

export type SearchOptions = {
  fileType?: SearchFileType
  recent?: boolean
  offset?: number
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  let url = `${API_BASE}/search?q=${encodeURIComponent(query)}`
  if (options.fileType) url += `&file_type=${encodeURIComponent(options.fileType)}`
  if (options.recent) url += '&recent=true'
  if (options.offset) url += `&offset=${options.offset}`
  const res = await apiFetch(url, { headers: await authHeader() })
  if (!res.ok) throw new Error('Search failed')
  return res.json()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npx vitest run tests/lib/api.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/tests/lib/api.test.ts
git commit -m "feat: extend search API client with filters, pagination, has_more"
```

---

### Task 5: `SearchPage` — independent filters, grouping, highlighting, load more, relevance badge

**Files:**
- Modify: `frontend/src/pages/SearchPage.tsx`
- Modify: `frontend/tests/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: `search`, `SearchResult`, `SearchFileType` from `frontend/src/lib/api.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

Replace all of `frontend/tests/pages/SearchPage.test.tsx`:

```typescript
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  search: vi.fn(),
}))

import { search } from '../../src/lib/api'
import { SearchPage } from '../../src/pages/SearchPage'

function renderSearchPage(initialEntries?: { pathname: string; state?: unknown }[]) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={initialEntries}>
      <SearchPage />
    </MemoryRouter>,
  )
}

function byText(tag: string, text: string) {
  return (_: string, element: Element | null) =>
    element?.tagName.toLowerCase() === tag && element.textContent === text
}

describe('SearchPage', () => {
  it('renders results after submitting a query', async () => {
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 2,
          total_chunks: 5,
          content: 'quarterly revenue figures',
          score: 0.9,
        },
      ],
      has_more: false,
    })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText(byText('p', 'quarterly revenue figures'))).toBeInTheDocument()
    })
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText(byText('p', 'passage 3 of 5'))).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: false, offset: 0 })
  })

  it('groups multiple passages from the same document under one card', async () => {
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 0,
          total_chunks: 5,
          content: 'revenue passage one',
          score: 0.9,
        },
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 1,
          total_chunks: 5,
          content: 'revenue passage two',
          score: 0.8,
        },
      ],
      has_more: false,
    })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getAllByText('report.pdf')).toHaveLength(1)
    })
    expect(screen.getByText(byText('p', 'revenue passage one'))).toBeInTheDocument()
    expect(screen.getByText(byText('p', 'revenue passage two'))).toBeInTheDocument()
  })

  it('shows an empty state when no results are found', async () => {
    ;(search as any).mockResolvedValue({ results: [], has_more: false })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'nothing matches' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })

  it('shows an error message when the search request fails', async () => {
    ;(search as any).mockRejectedValue(new Error('Search failed'))

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Search failed, try again')
    })
  })

  it('does not search on an empty query', () => {
    renderSearchPage()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(search).not.toHaveBeenCalled()
  })

  it('pre-fills and runs the query passed via router location state', async () => {
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 0,
          total_chunks: 2,
          content: 'annual revenue summary',
          score: 0.7,
        },
      ],
      has_more: false,
    })

    renderSearchPage([{ pathname: '/search', state: { query: 'revenue' } }])

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: false, offset: 0 })
    })
    expect(screen.getByLabelText('Search your documents')).toHaveValue('revenue')
  })

  it('refetches with the selected file type filter', async () => {
    ;(search as any).mockResolvedValue({ results: [], has_more: false })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue', { fileType: 'pdf', recent: false, offset: 0 })
    })
  })

  it('refetches with the recent toggle applied', async () => {
    ;(search as any).mockResolvedValue({ results: [], has_more: false })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: true, offset: 0 })
    })
  })

  it('loads more results and appends them', async () => {
    ;(search as any)
      .mockResolvedValueOnce({
        results: [
          {
            document_id: '1',
            filename: 'a.pdf',
            chunk_index: 0,
            total_chunks: 1,
            content: 'revenue alpha',
            score: 0.9,
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        results: [
          {
            document_id: '2',
            filename: 'b.pdf',
            chunk_index: 0,
            total_chunks: 1,
            content: 'revenue beta',
            score: 0.5,
          },
        ],
        has_more: false,
      })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(screen.getByText('b.pdf')).toBeInTheDocument()
    })
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: false, offset: 1 })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `npx vitest run tests/pages/SearchPage.test.tsx`
Expected: FAIL — current component has no file-type/recent controls, no grouping, no "Load more", and calls `search(query)` with one argument.

- [ ] **Step 3: Implement**

Replace all of `frontend/src/pages/SearchPage.tsx`:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { search, SearchFileType, SearchResult } from '../lib/api'

const FILE_TYPES: { id: SearchFileType | ''; label: string }[] = [
  { id: '', label: 'All types' },
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'DOCX' },
  { id: 'text', label: 'Text' },
]

const PASSAGES_SHOWN = 3

function highlight(content: string, query: string) {
  const terms = [...new Set(query.trim().split(/\s+/).filter((t) => t.length >= 2))]
  if (terms.length === 0) return content
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`(${pattern})`, 'gi')
  return content.split(regex).map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-[#FFF1B8] px-0.5 font-semibold text-ink">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

type SearchResultGroup = {
  document_id: string
  filename: string
  score: number
  passages: SearchResult[]
}

function groupByDocument(results: SearchResult[]): SearchResultGroup[] {
  const groups: SearchResultGroup[] = []
  const byId = new Map<string, SearchResultGroup>()
  for (const result of results) {
    let group = byId.get(result.document_id)
    if (!group) {
      group = { document_id: result.document_id, filename: result.filename, score: result.score, passages: [] }
      byId.set(result.document_id, group)
      groups.push(group)
    }
    group.passages.push(result)
  }
  return groups
}

export function SearchPage() {
  const location = useLocation()
  const initialQuery = (location.state as { query?: string } | null)?.query ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [fileType, setFileType] = useState<SearchFileType | ''>('')
  const [recent, setRecent] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const searchMutation = useMutation({
    mutationFn: (vars: { q: string; fileType: SearchFileType | ''; recent: boolean; offset: number }) =>
      search(vars.q, { fileType: vars.fileType || undefined, recent: vars.recent, offset: vars.offset }),
  })

  function runSearch(q: string, ft: SearchFileType | '', rec: boolean) {
    searchMutation.mutate(
      { q, fileType: ft, recent: rec, offset: 0 },
      {
        onSuccess: (response) => {
          setResults(response.results)
          setHasMore(response.has_more)
        },
      },
    )
  }

  function loadMore() {
    if (!results) return
    searchMutation.mutate(
      { q: query, fileType, recent, offset: results.length },
      {
        onSuccess: (response) => {
          setResults([...results, ...response.results])
          setHasMore(response.has_more)
        },
      },
    )
  }

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery, '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    runSearch(query, fileType, recent)
  }

  function handleFileTypeChange(id: SearchFileType | '') {
    setFileType(id)
    if (query.trim()) runSearch(query, id, recent)
  }

  function handleRecentToggle() {
    const next = !recent
    setRecent(next)
    if (query.trim()) runSearch(query, fileType, next)
  }

  const groups = results ? groupByDocument(results) : []

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-12 pt-7">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-3 rounded-[13px] border border-line bg-white py-1 pl-4 pr-1 shadow-sm"
      >
        <div className="flex-1">
          <label htmlFor="search-input" className="sr-only">
            Search your documents
          </label>
          <Input
            id="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all your documents…"
            className="border-none bg-transparent py-3 shadow-none focus:ring-0"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <div className="my-4 flex flex-wrap items-center gap-2">
        {FILE_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleFileTypeChange(t.id)}
            className={
              fileType === t.id
                ? 'rounded-full border border-sidebar bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-muted'
            }
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={handleRecentToggle}
          aria-pressed={recent}
          className={
            recent
              ? 'rounded-full border border-sidebar bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          Recent
        </button>
      </div>

      {searchMutation.isError && <Alert>Search failed, try again</Alert>}
      {searchMutation.isPending && <p className="text-sm text-muted">Searching...</p>}
      {results !== null && !searchMutation.isPending && groups.length === 0 && (
        <p className="text-sm text-muted">No results found</p>
      )}
      {groups.length > 0 && (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.document_id}>
              <Card className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-muted">{group.filename}</span>
                  <span className="rounded-full bg-app-bg px-2 py-0.5 text-xs font-semibold text-muted">
                    {Math.round(group.score * 100)}% match
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.passages.slice(0, PASSAGES_SHOWN).map((passage) => (
                    <li key={passage.chunk_index}>
                      <p className="text-xs text-faint">
                        passage {passage.chunk_index + 1} of {passage.total_chunks}
                      </p>
                      <p className="text-[14.5px] leading-relaxed text-ink">
                        {highlight(passage.content, query)}
                      </p>
                    </li>
                  ))}
                </ul>
                {group.passages.length > PASSAGES_SHOWN && (
                  <p className="text-xs text-faint">
                    +{group.passages.length - PASSAGES_SHOWN} more passages in this document
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {hasMore && !searchMutation.isPending && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
```

Note: `groupByDocument` recomputes across the *entire* accumulated `results` array (including previously loaded pages) on every render, so a document whose passages span two fetched pages merges into one group rather than appearing as two separate cards.

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `npx vitest run tests/pages/SearchPage.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx frontend/tests/pages/SearchPage.test.tsx
git commit -m "feat: group search results by document, highlight all matched terms, add filters and load more"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run (from `backend/`): `python -m pytest -q`
Expected: all PASS.

- [ ] **Step 2: Run the full frontend suite**

Run (from `frontend/`): `npm test`
Expected: all PASS.

- [ ] **Step 3: Manually verify in the browser**

Start the app (`npm run dev` from the repo root), upload a couple of documents of different types, and confirm: the file-type/recent controls each refetch independently, results are grouped by document with a match-strength badge, every occurrence of every query term is highlighted, and "Load more" appends additional results when present.
