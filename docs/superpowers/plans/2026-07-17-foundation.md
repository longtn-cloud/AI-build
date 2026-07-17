# Foundation (Auth, DB, Upload/Preprocessing Pipeline, Document Manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full-stack foundation — Supabase-backed auth, the document upload/preprocessing pipeline (extract → chunk → embed), and a document manager UI (list/preview/download/rename/delete) — that Search, Chat Q&A, and Quiz (later plans) will all build on.

**Architecture:** React + Vite SPA talks to a FastAPI backend over a REST API. The backend verifies Supabase-issued JWTs itself, stores files in Supabase Storage, and stores document/chunk metadata + embeddings in Supabase Postgres (pgvector). Document preprocessing runs as a FastAPI `BackgroundTasks` job kicked off right after upload.

**Tech Stack:** Python 3.11+ / FastAPI / psycopg3 / pytest (backend); React 18 / Vite / TypeScript / React Router / Vitest + Testing Library (frontend); Supabase (Postgres+pgvector, Auth, Storage); Voyage AI (embeddings).

## Global Constraints

- This is **Plan 1 of 4** (Foundation). Search, Chat Q&A, and Quiz are out of scope — later plans build on what this one produces.
- Allowed upload file types: `pdf`, `docx`, `txt`, `md` only. Max upload size: 20 MB (`20 * 1024 * 1024` bytes).
- Embeddings: Voyage AI model `voyage-3-lite`, 512-dimensional vectors. **Verify this model name/dimension against Voyage AI's current docs before implementing** — model lineups change; if it's changed, update the vector column dimension in the migration (Task 2) and the `embed_texts`/`embed_query` calls (Task 6) to match.
- User identity is Supabase Auth's `auth.users` — no separate `profiles` table.
- **RLS deviation, read before Task 2:** the schema defines Row Level Security policies as defense-in-depth (they matter if these tables are ever queried directly via Supabase's PostgREST/anon key). However, the FastAPI backend connects to Postgres with a privileged connection string (via `SUPABASE_DB_URL`), which bypasses RLS. The actual, load-bearing enforcement of "users only see their own data" is the explicit `WHERE user_id = %s` (or `WHERE user_id = %s AND ...`) clause the backend includes in every query. Every task that touches `documents`/`chunks` must include that filter — this is not optional defense-in-depth at the application layer, it's the only layer that's actually enforcing anything for backend-driven access.
- Quiz question count defaults (10, adjustable 5–20) belong to Plan 4 — not used here.

---

### Task 1: Backend project scaffolding + health check

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/main.py`
- Test: `backend/tests/__init__.py`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Produces: `app.config.settings` (a `Settings` instance with fields `supabase_url, supabase_service_role_key, supabase_jwt_secret, supabase_db_url, voyage_api_key, anthropic_api_key, storage_bucket, max_upload_bytes, allowed_file_types`); `app.main.app` (the FastAPI instance), reused by every later backend task.

- [ ] **Step 1: Create backend directory structure and dependency list**

Create `backend/requirements.txt`:

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
psycopg[binary]==3.2.3
pydantic-settings==2.6.0
pyjwt==2.9.0
supabase==2.9.1
pypdf==5.1.0
python-docx==1.1.2
voyageai==0.3.1
python-multipart==0.0.12
pytest==8.3.3
httpx==0.27.2
```

Create `backend/.env.example`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
SUPABASE_DB_URL=postgresql://postgres:password@your-db-host:5432/postgres
VOYAGE_API_KEY=your-voyage-key
ANTHROPIC_API_KEY=your-anthropic-key
STORAGE_BUCKET=documents
```

Create empty `backend/app/__init__.py`.

- [ ] **Step 2: Write config.py**

Create `backend/app/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    supabase_db_url: str
    voyage_api_key: str
    anthropic_api_key: str
    storage_bucket: str = "documents"
    max_upload_bytes: int = 20 * 1024 * 1024
    allowed_file_types: set[str] = {"pdf", "docx", "txt", "md"}

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
```

- [ ] **Step 3: Write the failing test for the health check**

Create empty `backend/tests/__init__.py`.

Create `backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it fails**

Run (from `backend/`): `pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'` (also set env vars first, see Step 6).

- [ ] **Step 5: Write main.py**

Create `backend/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Document Knowledge Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run test to verify it passes**

From `backend/`, set required env vars for `Settings` to load (a `.env` file works too — copy `.env.example` to `.env` and fill in dummy values for now):

```bash
cp .env.example .env
pytest tests/test_health.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/.env.example backend/app backend/tests
git commit -m "feat: scaffold FastAPI backend with health check"
```

---

### Task 2: Database schema + local test Postgres

**Files:**
- Create: `backend/migrations/0001_init.sql`
- Create: `backend/tests/fixtures/0000_test_auth_stub.sql`
- Create: `backend/docker-compose.test.yml`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_schema.py`

**Interfaces:**
- Produces: `documents` table (`id, user_id, filename, file_type, storage_path, status, error_reason, extracted_text, uploaded_at`) and `chunks` table (`id, document_id, content, embedding, chunk_index`), used by every later backend task. `tests/conftest.py` provides an autouse fixture that applies migrations once per test session and truncates tables after each test.

- [ ] **Step 1: Write the production schema migration**

Create `backend/migrations/0001_init.sql`:

```sql
create extension if not exists vector;

create table documents (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    filename text not null,
    file_type text not null,
    storage_path text not null,
    status text not null default 'uploading'
        check (status in ('uploading', 'processing', 'ready', 'failed')),
    error_reason text,
    extracted_text text,
    uploaded_at timestamptz not null default now()
);

create table chunks (
    id bigserial primary key,
    document_id uuid not null references documents(id) on delete cascade,
    content text not null,
    embedding vector(512) not null,
    chunk_index integer not null
);

create index chunks_embedding_idx on chunks using ivfflat (embedding vector_cosine_ops);
create index documents_user_id_idx on documents (user_id);
create index chunks_document_id_idx on chunks (document_id);

alter table documents enable row level security;
alter table chunks enable row level security;

create policy "documents_owner" on documents
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chunks_owner" on chunks
    for all using (
        exists (select 1 from documents d where d.id = chunks.document_id and d.user_id = auth.uid())
    );
```

- [ ] **Step 2: Write a test-only stub for Supabase's `auth.users` table**

Local Postgres doesn't have Supabase's `auth` schema, but the migration's foreign key needs it. This stub is applied ONLY in tests, never against real Supabase (which already has `auth.users`).

Create `backend/tests/fixtures/0000_test_auth_stub.sql`:

```sql
create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key
);
```

- [ ] **Step 3: Write docker-compose for the local test database**

Create `backend/docker-compose.test.yml`:

```yaml
services:
  test-db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: test
    ports:
      - "5433:5432"
```

- [ ] **Step 4: Write the failing schema test**

Create `backend/tests/conftest.py`:

```python
import os
import pathlib

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://postgres:postgres@localhost:5433/test")
os.environ.setdefault("VOYAGE_API_KEY", "test-voyage-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")

import psycopg
import pytest

TEST_DB_URL = os.environ["SUPABASE_DB_URL"]
BACKEND_ROOT = pathlib.Path(__file__).parent.parent


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    stub_sql = (BACKEND_ROOT / "tests" / "fixtures" / "0000_test_auth_stub.sql").read_text()
    init_sql = (BACKEND_ROOT / "migrations" / "0001_init.sql").read_text()
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(stub_sql)
        conn.execute(init_sql)
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("TRUNCATE chunks, documents CASCADE")
```

Create `backend/tests/test_schema.py`:

```python
import uuid

import psycopg

from tests.conftest import TEST_DB_URL


def test_can_insert_and_read_document_with_chunk():
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'report.pdf', 'pdf', %s, 'ready')
            """,
            (document_id, user_id, f"{user_id}/{document_id}.pdf"),
        )
        embedding = [0.1] * 512
        conn.execute(
            """
            INSERT INTO chunks (document_id, content, embedding, chunk_index)
            VALUES (%s, 'hello world', %s, 0)
            """,
            (document_id, embedding),
        )
        row = conn.execute(
            "SELECT filename, status FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert row == ("report.pdf", "ready")
```

- [ ] **Step 5: Run test to verify it fails, then start the test DB**

```bash
docker compose -f backend/docker-compose.test.yml up -d
cd backend
pytest tests/test_schema.py -v
```

Expected on first run before the DB is up: connection refused. After `docker compose up -d` and giving the container a few seconds to accept connections, re-run — it should now reach the DB and apply migrations automatically via the `apply_migrations` fixture.

- [ ] **Step 6: Run test to verify it passes**

```bash
pytest tests/test_schema.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations backend/tests/fixtures backend/tests/conftest.py backend/tests/test_schema.py backend/docker-compose.test.yml
git commit -m "feat: add documents/chunks schema and local test database"
```

---

### Task 3: Auth verification dependency

**Files:**
- Create: `backend/app/auth.py`
- Create: `backend/tests/helpers.py`
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `app.config.settings.supabase_jwt_secret` (Task 1).
- Produces: `app.auth.get_current_user_id(authorization: str) -> str` — a FastAPI dependency every protected endpoint in later tasks depends on via `Depends(get_current_user_id)`, returning the caller's `user_id` as a string or raising `HTTPException(401)`.

- [ ] **Step 1: Write the test helper for minting test JWTs**

Create `backend/tests/helpers.py`:

```python
import time

import jwt


def make_token(user_id: str, secret: str) -> str:
    payload = {
        "sub": user_id,
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_auth.py`:

```python
import uuid

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.config import settings
from tests.helpers import make_token

test_app = FastAPI()


@test_app.get("/whoami")
def whoami(user_id: str = Depends(get_current_user_id)):
    return {"user_id": user_id}


client = TestClient(test_app)


def test_valid_token_returns_user_id():
    user_id = str(uuid.uuid4())
    token = make_token(user_id, settings.supabase_jwt_secret)

    response = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": user_id}


def test_missing_header_returns_401():
    response = client.get("/whoami")
    assert response.status_code == 401


def test_invalid_token_returns_401():
    response = client.get("/whoami", headers={"Authorization": "Bearer garbage"})
    assert response.status_code == 401
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 4: Write auth.py**

Create `backend/app/auth.py`:

```python
import jwt
from fastapi import Header, HTTPException

from app.config import settings


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
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    return payload["sub"]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_auth.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/auth.py backend/tests/helpers.py backend/tests/test_auth.py
git commit -m "feat: add Supabase JWT verification dependency"
```

---

### Task 4: Text extraction service

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/extraction.py`
- Test: `backend/tests/test_extraction.py`

**Interfaces:**
- Produces: `app.services.extraction.extract_text(file_bytes: bytes, file_type: str) -> str`, used by Task 9's processing orchestration. Raises `ValueError` for unsupported `file_type`.

- [ ] **Step 1: Write the failing tests**

Create empty `backend/app/services/__init__.py`.

Create `backend/tests/test_extraction.py`:

```python
import io

import pytest
from docx import Document as DocxDocument

from app.services.extraction import extract_text


def test_extracts_plain_text():
    result = extract_text(b"hello world", "txt")
    assert result == "hello world"


def test_extracts_markdown_as_plain_text():
    result = extract_text(b"# Title\n\nBody text", "md")
    assert result == "# Title\n\nBody text"


def test_extracts_docx_paragraphs():
    doc = DocxDocument()
    doc.add_paragraph("First paragraph")
    doc.add_paragraph("Second paragraph")
    buffer = io.BytesIO()
    doc.save(buffer)

    result = extract_text(buffer.getvalue(), "docx")

    assert "First paragraph" in result
    assert "Second paragraph" in result


def test_unsupported_type_raises():
    with pytest.raises(ValueError):
        extract_text(b"data", "exe")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_extraction.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.extraction'`.

- [ ] **Step 3: Write extraction.py**

Create `backend/app/services/extraction.py`:

```python
import io

import docx
from pypdf import PdfReader


def extract_text(file_bytes: bytes, file_type: str) -> str:
    if file_type == "pdf":
        reader = PdfReader(io.BytesIO(file_bytes))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)

    if file_type == "docx":
        document = docx.Document(io.BytesIO(file_bytes))
        return "\n\n".join(paragraph.text for paragraph in document.paragraphs)

    if file_type in ("txt", "md"):
        return file_bytes.decode("utf-8", errors="replace")

    raise ValueError(f"Unsupported file type: {file_type}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_extraction.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/__init__.py backend/app/services/extraction.py backend/tests/test_extraction.py
git commit -m "feat: add document text extraction service"
```

---

### Task 5: Chunking service

**Files:**
- Create: `backend/app/services/chunking.py`
- Test: `backend/tests/test_chunking.py`

**Interfaces:**
- Produces: `app.services.chunking.chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> list[str]`, used by Task 9's processing orchestration.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_chunking.py`:

```python
from app.services.chunking import chunk_text


def test_empty_text_returns_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("   ") == []


def test_short_text_returns_single_chunk():
    result = chunk_text("hello world", chunk_size=1000, overlap=150)
    assert result == ["hello world"]


def test_long_text_splits_into_overlapping_chunks():
    text = "a" * 2500
    result = chunk_text(text, chunk_size=1000, overlap=150)

    assert len(result) == 3
    assert result[0] == "a" * 1000
    # second chunk starts 150 chars before the end of the first
    assert result[1] == text[850:1850]
    assert result[2] == text[1700:2500]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_chunking.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.chunking'`.

- [ ] **Step 3: Write chunking.py**

Create `backend/app/services/chunking.py`:

```python
def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap

    return chunks
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_chunking.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/chunking.py backend/tests/test_chunking.py
git commit -m "feat: add text chunking service"
```

---

### Task 6: Embeddings service (Voyage AI)

**Files:**
- Create: `backend/app/services/embeddings.py`
- Test: `backend/tests/test_embeddings.py`

**Interfaces:**
- Consumes: `app.config.settings.voyage_api_key` (Task 1).
- Produces: `app.services.embeddings.embed_texts(texts: list[str]) -> list[list[float]]` and `embed_query(text: str) -> list[float]`, used by Task 9 (`embed_texts`) and later by the Search/Chat plans (`embed_query`).

- [ ] **Step 1: Write the failing tests (mocking the Voyage client)**

Create `backend/tests/test_embeddings.py`:

```python
from unittest.mock import MagicMock

from app.services import embeddings


def test_embed_texts_calls_voyage_with_document_input_type(monkeypatch):
    fake_client = MagicMock()
    fake_client.embed.return_value = MagicMock(embeddings=[[0.1, 0.2], [0.3, 0.4]])
    monkeypatch.setattr(embeddings, "_client", fake_client)

    result = embeddings.embed_texts(["chunk one", "chunk two"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]
    fake_client.embed.assert_called_once_with(
        ["chunk one", "chunk two"], model="voyage-3-lite", input_type="document"
    )


def test_embed_query_calls_voyage_with_query_input_type(monkeypatch):
    fake_client = MagicMock()
    fake_client.embed.return_value = MagicMock(embeddings=[[0.5, 0.6]])
    monkeypatch.setattr(embeddings, "_client", fake_client)

    result = embeddings.embed_query("what is the refund policy?")

    assert result == [0.5, 0.6]
    fake_client.embed.assert_called_once_with(
        ["what is the refund policy?"], model="voyage-3-lite", input_type="query"
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_embeddings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.embeddings'`.

- [ ] **Step 3: Write embeddings.py**

Create `backend/app/services/embeddings.py`:

```python
import voyageai

from app.config import settings

_client = voyageai.Client(api_key=settings.voyage_api_key)

MODEL = "voyage-3-lite"


def embed_texts(texts: list[str]) -> list[list[float]]:
    result = _client.embed(texts, model=MODEL, input_type="document")
    return result.embeddings


def embed_query(text: str) -> list[float]:
    result = _client.embed([text], model=MODEL, input_type="query")
    return result.embeddings[0]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_embeddings.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/embeddings.py backend/tests/test_embeddings.py
git commit -m "feat: add Voyage AI embeddings service"
```

---

### Task 7: Supabase Storage service

**Files:**
- Create: `backend/app/services/storage.py`
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Consumes: `app.config.settings.supabase_url, supabase_service_role_key, storage_bucket` (Task 1).
- Produces: `app.services.storage.upload_file(storage_path, file_bytes, content_type) -> None`, `download_file(storage_path) -> bytes`, `delete_file(storage_path) -> None`, `create_signed_url(storage_path, expires_in=3600) -> str`. Used by Task 8 (upload), Task 9 (download during processing), Task 12 (delete), Task 13 (signed URL).

- [ ] **Step 1: Write the failing tests (mocking the Supabase client)**

Create `backend/tests/test_storage.py`:

```python
from unittest.mock import MagicMock

from app.services import storage


def test_upload_file_calls_supabase_storage(monkeypatch):
    fake_bucket = MagicMock()
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    storage.upload_file("user1/doc1.pdf", b"file bytes", "application/pdf")

    fake_client.storage.from_.assert_called_once_with(storage.settings.storage_bucket)
    fake_bucket.upload.assert_called_once_with(
        "user1/doc1.pdf", b"file bytes", {"content-type": "application/pdf"}
    )


def test_download_file_returns_bytes(monkeypatch):
    fake_bucket = MagicMock()
    fake_bucket.download.return_value = b"file bytes"
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    result = storage.download_file("user1/doc1.pdf")

    assert result == b"file bytes"


def test_delete_file_calls_remove(monkeypatch):
    fake_bucket = MagicMock()
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    storage.delete_file("user1/doc1.pdf")

    fake_bucket.remove.assert_called_once_with(["user1/doc1.pdf"])


def test_create_signed_url_returns_url(monkeypatch):
    fake_bucket = MagicMock()
    fake_bucket.create_signed_url.return_value = {"signedURL": "https://example.com/signed"}
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    result = storage.create_signed_url("user1/doc1.pdf")

    assert result == "https://example.com/signed"
    fake_bucket.create_signed_url.assert_called_once_with("user1/doc1.pdf", 3600)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.storage'`.

- [ ] **Step 3: Write storage.py**

Create `backend/app/services/storage.py`:

```python
from supabase import Client, create_client

from app.config import settings

_client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)


def upload_file(storage_path: str, file_bytes: bytes, content_type: str) -> None:
    _client.storage.from_(settings.storage_bucket).upload(
        storage_path, file_bytes, {"content-type": content_type}
    )


def download_file(storage_path: str) -> bytes:
    return _client.storage.from_(settings.storage_bucket).download(storage_path)


def delete_file(storage_path: str) -> None:
    _client.storage.from_(settings.storage_bucket).remove([storage_path])


def create_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    result = _client.storage.from_(settings.storage_bucket).create_signed_url(
        storage_path, expires_in
    )
    return result["signedURL"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_storage.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/storage.py backend/tests/test_storage.py
git commit -m "feat: add Supabase Storage service"
```

---

### Task 8: Database connection helper + document models

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/app/models.py`
- Test: `backend/tests/test_db.py`

**Interfaces:**
- Consumes: `app.config.settings.supabase_db_url` (Task 1).
- Produces: `app.db.get_conn()` (a context manager yielding a `psycopg.Connection` with `dict_row` factory, committing on success / rolling back on exception), and `app.models.DocumentOut` (Pydantic schema with fields `id, user_id, filename, file_type, storage_path, status, error_reason, extracted_text, uploaded_at`). Used by every endpoint task (9, 10, 11, 12, 13, 14).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_db.py`:

```python
import uuid

from app.db import get_conn


def test_get_conn_commits_on_success():
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())

    with get_conn() as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'a.txt', 'txt', 'path/a.txt', 'ready')
            """,
            (document_id, user_id),
        )

    with get_conn() as conn:
        row = conn.execute(
            "SELECT filename FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert row["filename"] == "a.txt"


def test_get_conn_rolls_back_on_exception():
    document_id = str(uuid.uuid4())

    try:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
                VALUES (%s, %s, 'b.txt', 'txt', 'path/b.txt', 'ready')
                """,
                (document_id, str(uuid.uuid4())),
            )
            raise RuntimeError("boom")
    except RuntimeError:
        pass

    with get_conn() as conn:
        row = conn.execute(
            "SELECT filename FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert row is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.db'`.

- [ ] **Step 3: Write db.py and models.py**

Create `backend/app/db.py`:

```python
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from app.config import settings


@contextmanager
def get_conn():
    conn = psycopg.connect(settings.supabase_db_url, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

Create `backend/app/models.py`:

```python
from datetime import datetime

from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: str
    user_id: str
    filename: str
    file_type: str
    storage_path: str
    status: str
    error_reason: str | None = None
    extracted_text: str | None = None
    uploaded_at: datetime
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_db.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/app/models.py backend/tests/test_db.py
git commit -m "feat: add DB connection helper and document models"
```

---

### Task 9: Document upload endpoint

**Files:**
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/documents.py`
- Modify: `backend/app/main.py` (register the router)
- Test: `backend/tests/test_upload.py`

**Interfaces:**
- Consumes: `get_current_user_id` (Task 3), `settings` (Task 1), `get_conn` (Task 8), `DocumentOut` (Task 8), `storage.upload_file` (Task 7).
- Produces: `POST /documents` — accepts `multipart/form-data` with a `file` field, returns a `DocumentOut` with `status="uploading"`, `201`. Registers `background_tasks.add_task(process_document, document_id)` — Task 10 defines `process_document`; until Task 10 exists, import it as a stub (see Step 3) and replace in Task 10.

- [ ] **Step 1: Write the failing test**

Create empty `backend/app/routers/__init__.py`.

Create `backend/tests/test_upload.py`:

```python
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


def test_upload_creates_document_row(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())

    user_id, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "notes.txt"
    assert body["file_type"] == "txt"
    assert body["status"] == "uploading"
    assert body["user_id"] == user_id


def test_upload_rejects_unsupported_file_type(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())

    _, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": ("virus.exe", b"data", "application/octet-stream")},
    )

    assert response.status_code == 400


def test_upload_rejects_oversized_file(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "upload_file", MagicMock())
    monkeypatch.setattr(documents_router, "process_document", MagicMock())
    monkeypatch.setattr(settings, "max_upload_bytes", 10)

    _, headers = _create_user()

    response = client.post(
        "/documents",
        headers=headers,
        files={"file": ("notes.txt", b"more than ten bytes", "text/plain")},
    )

    assert response.status_code == 400


def test_upload_requires_auth():
    response = client.post(
        "/documents", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_upload.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.documents'`.

- [ ] **Step 3: Write documents.py with a temporary `process_document` stub**

Task 10 defines the real `process_document`. To keep this task's tests isolated and passing on their own, add a minimal stub now; Task 10 will replace the import with the real implementation from `app.services.processing`.

Create `backend/app/routers/documents.py`:

```python
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile

from app.auth import get_current_user_id
from app.config import settings
from app.db import get_conn
from app.models import DocumentOut
from app.services.storage import upload_file

router = APIRouter(prefix="/documents", tags=["documents"])


def process_document(document_id: str) -> None:  # placeholder, replaced in Task 10
    pass


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    file_type = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if file_type not in settings.allowed_file_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")

    file_bytes = await file.read()
    if len(file_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=400, detail="File exceeds maximum size")

    document_id = str(uuid.uuid4())
    storage_path = f"{user_id}/{document_id}.{file_type}"
    upload_file(storage_path, file_bytes, file.content_type or "application/octet-stream")

    with get_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, %s, %s, 'uploading')
            RETURNING id, user_id, filename, file_type, storage_path, status,
                      error_reason, extracted_text, uploaded_at
            """,
            (document_id, user_id, file.filename, file_type, storage_path),
        ).fetchone()

    background_tasks.add_task(process_document, document_id)
    return row
```

Modify `backend/app/main.py` to register the router:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import documents

app = FastAPI(title="Document Knowledge Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_upload.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers backend/app/main.py backend/tests/test_upload.py
git commit -m "feat: add document upload endpoint"
```

---

### Task 10: Background processing orchestration

**Files:**
- Create: `backend/app/services/processing.py`
- Modify: `backend/app/routers/documents.py` (replace the placeholder `process_document` with the real one)
- Test: `backend/tests/test_processing.py`

**Interfaces:**
- Consumes: `get_conn` (Task 8), `storage.download_file` (Task 7), `extraction.extract_text` (Task 4), `chunking.chunk_text` (Task 5), `embeddings.embed_texts` (Task 6).
- Produces: `app.services.processing.process_document(document_id: str) -> None` — extracts, chunks, embeds, writes `chunks` rows, and sets `documents.status` to `ready` (with `extracted_text` populated) or `failed` (with `error_reason` populated). Used by Task 9's upload endpoint.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_processing.py`:

```python
import uuid
from unittest.mock import MagicMock

import psycopg

from app.services import processing
from tests.conftest import TEST_DB_URL


def _create_document(file_type: str = "txt") -> tuple[str, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'doc.txt', %s, 'path/doc.txt', 'uploading')
            """,
            (document_id, user_id, file_type),
        )
    return user_id, document_id


def test_process_document_success(monkeypatch):
    _, document_id = _create_document()

    monkeypatch.setattr(processing, "download_file", lambda path: b"hello world, this is content")
    monkeypatch.setattr(processing, "embed_texts", lambda pieces: [[0.1] * 512 for _ in pieces])

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, extracted_text FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
        chunk_count = conn.execute(
            "SELECT count(*) FROM chunks WHERE document_id = %s", (document_id,)
        ).fetchone()[0]

    assert doc[0] == "ready"
    assert doc[1] == "hello world, this is content"
    assert chunk_count == 1


def test_process_document_marks_failed_on_extraction_error(monkeypatch):
    _, document_id = _create_document(file_type="exe")

    monkeypatch.setattr(processing, "download_file", lambda path: b"data")

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert doc[0] == "failed"
    assert doc[1] is not None


def test_process_document_marks_failed_on_no_extractable_text(monkeypatch):
    _, document_id = _create_document()

    monkeypatch.setattr(processing, "download_file", lambda path: b"   ")

    processing.process_document(document_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        doc = conn.execute(
            "SELECT status, error_reason FROM documents WHERE id = %s", (document_id,)
        ).fetchone()

    assert doc[0] == "failed"
    assert "No extractable text" in doc[1]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_processing.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.processing'`.

- [ ] **Step 3: Write processing.py**

Create `backend/app/services/processing.py`:

```python
from app.db import get_conn
from app.services.chunking import chunk_text
from app.services.embeddings import embed_texts
from app.services.extraction import extract_text
from app.services.storage import download_file


def process_document(document_id: str) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path, file_type FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
    if row is None:
        return

    with get_conn() as conn:
        conn.execute("UPDATE documents SET status = 'processing' WHERE id = %s", (document_id,))

    try:
        file_bytes = download_file(row["storage_path"])
        text = extract_text(file_bytes, row["file_type"])
        pieces = chunk_text(text)
        if not pieces:
            raise ValueError("No extractable text found in document")

        vectors = embed_texts(pieces)

        with get_conn() as conn:
            for index, (content, embedding) in enumerate(zip(pieces, vectors)):
                conn.execute(
                    """
                    INSERT INTO chunks (document_id, content, embedding, chunk_index)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (document_id, content, embedding, index),
                )
            conn.execute(
                "UPDATE documents SET status = 'ready', extracted_text = %s WHERE id = %s",
                (text, document_id),
            )
    except Exception as exc:
        with get_conn() as conn:
            conn.execute(
                "UPDATE documents SET status = 'failed', error_reason = %s WHERE id = %s",
                (str(exc), document_id),
            )
```

Modify `backend/app/routers/documents.py`: remove the placeholder `process_document` function and its blank line, and replace:

```python
from app.services.storage import upload_file
```

with:

```python
from app.services.processing import process_document
from app.services.storage import upload_file
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_processing.py -v`
Expected: PASS (3 passed). Then re-run the full suite to confirm Task 9's tests still pass with the real `process_document` wired in:

```bash
pytest -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/processing.py backend/app/routers/documents.py backend/tests/test_processing.py
git commit -m "feat: wire up document preprocessing pipeline"
```

---

### Task 11: Document list endpoint

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_list_documents.py`

**Interfaces:**
- Produces: `GET /documents` — returns `list[DocumentOut]` for the authenticated user only, newest first.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_list_documents.py`:

```python
import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user_with_documents(count: int) -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        for i in range(count):
            conn.execute(
                """
                INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
                VALUES (%s, %s, %s, 'txt', %s, 'ready')
                """,
                (str(uuid.uuid4()), user_id, f"doc{i}.txt", f"path/doc{i}.txt"),
            )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def test_list_documents_returns_only_own_documents():
    _, headers_a = _create_user_with_documents(2)
    _, headers_b = _create_user_with_documents(1)

    response_a = client.get("/documents", headers=headers_a)
    response_b = client.get("/documents", headers=headers_b)

    assert response_a.status_code == 200
    assert len(response_a.json()) == 2
    assert response_b.status_code == 200
    assert len(response_b.json()) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_list_documents.py -v`
Expected: FAIL — `404 Not Found` (no `GET /documents` route yet).

- [ ] **Step 3: Add the list endpoint**

Modify `backend/app/routers/documents.py`, add below `upload_document`:

```python
@router.get("", response_model=list[DocumentOut])
async def list_documents(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, filename, file_type, storage_path, status,
                   error_reason, extracted_text, uploaded_at
            FROM documents
            WHERE user_id = %s
            ORDER BY uploaded_at DESC
            """,
            (user_id,),
        ).fetchall()
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_list_documents.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_list_documents.py
git commit -m "feat: add document list endpoint scoped to the authenticated user"
```

---

### Task 12: Document rename and delete endpoints

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_rename_delete.py`

**Interfaces:**
- Consumes: `storage.delete_file` (Task 7).
- Produces: `PATCH /documents/{document_id}` (body `{"filename": str}`, returns updated `DocumentOut`, `404` if not found/not owned) and `DELETE /documents/{document_id}` (`204`, `404` if not found/not owned).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_rename_delete.py`:

```python
import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user_with_document() -> tuple[dict, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'old.txt', 'txt', 'path/old.txt', 'ready')
            """,
            (document_id, user_id),
        )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return {"Authorization": f"Bearer {token}"}, document_id


def test_rename_updates_filename():
    headers, document_id = _create_user_with_document()

    response = client.patch(
        f"/documents/{document_id}", headers=headers, json={"filename": "new.txt"}
    )

    assert response.status_code == 200
    assert response.json()["filename"] == "new.txt"


def test_rename_other_users_document_returns_404():
    headers, document_id = _create_user_with_document()
    other_user_headers, _ = _create_user_with_document()

    response = client.patch(
        f"/documents/{document_id}", headers=other_user_headers, json={"filename": "hijacked.txt"}
    )

    assert response.status_code == 404


def test_delete_removes_document_and_storage_file(monkeypatch):
    from app.routers import documents as documents_router

    delete_mock = MagicMock()
    monkeypatch.setattr(documents_router, "delete_file", delete_mock)

    headers, document_id = _create_user_with_document()

    response = client.delete(f"/documents/{document_id}", headers=headers)

    assert response.status_code == 204
    delete_mock.assert_called_once_with("path/old.txt")

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        row = conn.execute(
            "SELECT id FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
    assert row is None


def test_delete_other_users_document_returns_404(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "delete_file", MagicMock())

    headers, document_id = _create_user_with_document()
    other_user_headers, _ = _create_user_with_document()

    response = client.delete(f"/documents/{document_id}", headers=other_user_headers)

    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_rename_delete.py -v`
Expected: FAIL — `404`/`405` (routes don't exist yet).

- [ ] **Step 3: Add rename and delete endpoints**

Modify `backend/app/routers/documents.py`. Add the import:

```python
from pydantic import BaseModel

from app.services.storage import delete_file, upload_file
```

(replace the existing `from app.services.storage import upload_file` line with the combined import above)

Add below the list endpoint:

```python
class RenameRequest(BaseModel):
    filename: str


@router.patch("/{document_id}", response_model=DocumentOut)
async def rename_document(
    document_id: str,
    body: RenameRequest,
    user_id: str = Depends(get_current_user_id),
):
    with get_conn() as conn:
        row = conn.execute(
            """
            UPDATE documents SET filename = %s
            WHERE id = %s AND user_id = %s
            RETURNING id, user_id, filename, file_type, storage_path, status,
                      error_reason, extracted_text, uploaded_at
            """,
            (body.filename, document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return row


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        conn.execute(
            "DELETE FROM documents WHERE id = %s AND user_id = %s", (document_id, user_id)
        )
    delete_file(row["storage_path"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_rename_delete.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_rename_delete.py
git commit -m "feat: add document rename and delete endpoints"
```

---

### Task 13: Document download endpoint

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_download.py`

**Interfaces:**
- Consumes: `storage.create_signed_url` (Task 7).
- Produces: `GET /documents/{document_id}/download` — returns `{"url": str}`, `404` if not found/not owned.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_download.py`:

```python
import uuid
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user_with_document() -> tuple[dict, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'file.pdf', 'pdf', 'path/file.pdf', 'ready')
            """,
            (document_id, user_id),
        )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return {"Authorization": f"Bearer {token}"}, document_id


def test_download_returns_signed_url(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(
        documents_router, "create_signed_url", MagicMock(return_value="https://signed.example/file.pdf")
    )

    headers, document_id = _create_user_with_document()

    response = client.get(f"/documents/{document_id}/download", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"url": "https://signed.example/file.pdf"}


def test_download_other_users_document_returns_404(monkeypatch):
    from app.routers import documents as documents_router

    monkeypatch.setattr(documents_router, "create_signed_url", MagicMock())

    headers, document_id = _create_user_with_document()
    other_user_headers, _ = _create_user_with_document()

    response = client.get(f"/documents/{document_id}/download", headers=other_user_headers)

    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_download.py -v`
Expected: FAIL — `404` route not found.

- [ ] **Step 3: Add the download endpoint**

Modify `backend/app/routers/documents.py`. Replace:

```python
from app.services.storage import delete_file, upload_file
```

with:

```python
from app.services.storage import create_signed_url, delete_file, upload_file
```

Add below the delete endpoint:

```python
@router.get("/{document_id}/download")
async def get_download_url(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"url": create_signed_url(row["storage_path"])}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_download.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_download.py
git commit -m "feat: add document download endpoint"
```

---

### Task 14: Document preview endpoint (DOCX text preview)

**Files:**
- Modify: `backend/app/routers/documents.py`
- Test: `backend/tests/test_preview.py`

**Interfaces:**
- Produces: `GET /documents/{document_id}/preview` — for `file_type == "docx"` and `status == "ready"`, returns `{"text": str}` (the stored `extracted_text`); `400` for non-docx types (frontend uses the download URL + native rendering instead, per Task 19); `409` if not yet `ready`; `404` if not found/not owned.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_preview.py`:

```python
import uuid

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_document(file_type: str, status: str, extracted_text: str | None) -> tuple[dict, str]:
    user_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
        conn.execute(
            """
            INSERT INTO documents
                (id, user_id, filename, file_type, storage_path, status, extracted_text)
            VALUES (%s, %s, 'file', %s, 'path/file', %s, %s)
            """,
            (document_id, user_id, file_type, status, extracted_text),
        )
    token = make_token(user_id, settings.supabase_jwt_secret)
    return {"Authorization": f"Bearer {token}"}, document_id


def test_preview_returns_extracted_text_for_ready_docx():
    headers, document_id = _create_document("docx", "ready", "Extracted paragraph text")

    response = client.get(f"/documents/{document_id}/preview", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"text": "Extracted paragraph text"}


def test_preview_rejects_non_docx_types():
    headers, document_id = _create_document("pdf", "ready", "some text")

    response = client.get(f"/documents/{document_id}/preview", headers=headers)

    assert response.status_code == 400


def test_preview_rejects_not_ready_document():
    headers, document_id = _create_document("docx", "processing", None)

    response = client.get(f"/documents/{document_id}/preview", headers=headers)

    assert response.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_preview.py -v`
Expected: FAIL — `404` route not found.

- [ ] **Step 3: Add the preview endpoint**

Modify `backend/app/routers/documents.py`, add below the download endpoint:

```python
@router.get("/{document_id}/preview")
async def get_preview(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT file_type, status, extracted_text FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if row["file_type"] != "docx":
        raise HTTPException(
            status_code=400,
            detail="Preview endpoint only applies to docx files; use the download URL for other types",
        )
    if row["status"] != "ready":
        raise HTTPException(status_code=409, detail="Document is not ready yet")
    return {"text": row["extracted_text"]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_preview.py -v`
Expected: PASS (3 passed). Then run the full backend suite:

```bash
pytest -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_preview.py
git commit -m "feat: add docx preview endpoint"
```

---

### Task 15: Frontend scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/lib/supabaseClient.ts`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `frontend/src/lib/supabaseClient.ts` exporting `supabase` (a configured `@supabase/supabase-js` client), used by every later frontend task.

- [ ] **Step 1: Create package.json and config files**

Create `frontend/package.json`:

```json
{
  "name": "document-knowledge-assistant-frontend",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

Create `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
})
```

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Document Knowledge Assistant</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/.env.example`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=http://localhost:8000
```

Create `frontend/src/test-setup.ts`:

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 2: Write the failing smoke test**

Create `frontend/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByText('Document Knowledge Assistant')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd frontend
npm install
npm test
```

Expected: FAIL — `Cannot find module './App'` (or similar).

- [ ] **Step 4: Write supabaseClient.ts, App.tsx, main.tsx**

Create `frontend/src/lib/supabaseClient.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

Create `frontend/src/App.tsx`:

```tsx
export function App() {
  return (
    <div>
      <h1>Document Knowledge Assistant</h1>
    </div>
  )
}
```

Create `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cp .env.example .env
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/vite.config.ts frontend/tsconfig.json frontend/index.html frontend/.env.example frontend/src/main.tsx frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/lib/supabaseClient.ts frontend/src/test-setup.ts
git commit -m "feat: scaffold React + Vite frontend"
```

---

### Task 16: Auth context, login/signup pages, protected route

**Files:**
- Create: `frontend/src/contexts/AuthContext.tsx`
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/SignupPage.tsx`
- Modify: `frontend/src/App.tsx` (add routing)
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 15).
- Produces: `useAuth()` hook (returns `{ session, loading, signIn, signUp, signOut }`) via `<AuthProvider>`, and `<ProtectedRoute>` — used by Task 18's `DocumentsPage` route.

- [ ] **Step 1: Write the failing test for LoginPage**

Create `frontend/src/pages/LoginPage.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '../contexts/AuthContext'
import { LoginPage } from './LoginPage'
import { supabase } from '../lib/supabaseClient'

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

describe('LoginPage', () => {
  it('calls signInWithPassword with entered credentials', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password123',
      })
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../contexts/AuthContext'`.

- [ ] **Step 3: Write AuthContext.tsx, ProtectedRoute.tsx, LoginPage.tsx, SignupPage.tsx**

Create `frontend/src/contexts/AuthContext.tsx`:

```tsx
import { Session } from '@supabase/supabase-js'
import { ReactNode, createContext, useContext, useEffect, useState } from 'react'

import { supabase } from '../lib/supabaseClient'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

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

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
```

Create `frontend/src/components/ProtectedRoute.tsx`:

```tsx
import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <p>Loading...</p>
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

Create `frontend/src/pages/LoginPage.tsx`:

```tsx
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { error } = await signIn(email, password)
    if (error) {
      setError(error)
      return
    }
    navigate('/documents')
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log in</h1>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Log in</button>
      <p>
        No account? <Link to="/signup">Sign up</Link>
      </p>
    </form>
  )
}
```

Create `frontend/src/pages/SignupPage.tsx`:

```tsx
import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function SignupPage() {
  const { signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { error } = await signUp(email, password)
    if (error) {
      setError(error)
      return
    }
    navigate('/documents')
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign up</h1>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="signup-email">Email</label>
      <input
        id="signup-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="signup-password">Password</label>
      <input
        id="signup-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Sign up</button>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  )
}
```

Modify `frontend/src/App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './contexts/AuthContext'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  )
}
```

Update `frontend/src/App.test.tsx` since the app no longer renders a static title at `/` (it redirects to `/login`):

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { App } from './App'

vi.mock('./lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

describe('App', () => {
  it('redirects to the login page by default', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText('Log in')).toBeInTheDocument()
  })
})
```

Also wrap `main.tsx`'s `<App />` in a router. Modify `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/contexts frontend/src/components frontend/src/pages frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx
git commit -m "feat: add auth context, login/signup pages, and protected routing"
```

---

### Task 17: Frontend API client module

**Files:**
- Create: `frontend/src/lib/api.ts`
- Test: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 15).
- Produces: `Document` type and `listDocuments()`, `uploadDocument(file)`, `renameDocument(id, filename)`, `deleteDocument(id)`, `getDownloadUrl(id)`, `getPreviewText(id)` — used by Tasks 18–20's Document Manager UI.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/api.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

import { deleteDocument, getDownloadUrl, listDocuments, renameDocument, uploadDocument } from './api'

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
})

afterAll(() => {
  global.fetch = originalFetch
})

describe('api client', () => {
  it('listDocuments sends an authorized GET request', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => [] })

    await listDocuments()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  it('uploadDocument sends a POST with form data', async () => {
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1', filename: 'a.txt' }),
    })
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' })

    await uploadDocument(file)

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renameDocument sends a PATCH with the new filename', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: '1' }) })

    await renameDocument('1', 'new-name.txt')

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents/1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ filename: 'new-name.txt' }) }),
    )
  })

  it('deleteDocument sends a DELETE request and throws on failure', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: false })

    await expect(deleteDocument('1')).rejects.toThrow('Failed to delete document')
  })

  it('getDownloadUrl returns the signed url', async () => {
    ;(global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ url: 'https://x' }) })

    const url = await getDownloadUrl('1')

    expect(url).toBe('https://x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './api'`.

- [ ] **Step 3: Write api.ts**

Create `frontend/src/lib/api.ts`:

```typescript
import { supabase } from './supabaseClient'

const API_BASE = import.meta.env.VITE_API_BASE_URL

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export type Document = {
  id: string
  user_id: string
  filename: string
  file_type: string
  storage_path: string
  status: DocumentStatus
  error_reason: string | null
  extracted_text: string | null
  uploaded_at: string
}

export async function listDocuments(): Promise<Document[]> {
  const res = await fetch(`${API_BASE}/documents`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list documents')
  return res.json()
}

export async function uploadDocument(file: File): Promise<Document> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    headers: await authHeader(),
    body: formData,
  })
  if (!res.ok) throw new Error('Failed to upload document')
  return res.json()
}

export async function renameDocument(id: string, filename: string): Promise<Document> {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
  if (!res.ok) throw new Error('Failed to rename document')
  return res.json()
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to delete document')
}

export async function getDownloadUrl(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/documents/${id}/download`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to get download URL')
  const data = await res.json()
  return data.url
}

export async function getPreviewText(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/documents/${id}/preview`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to get preview')
  const data = await res.json()
  return data.text
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat: add frontend API client for document endpoints"
```

---

### Task 18: Document Manager UI — list and upload

**Files:**
- Create: `frontend/src/pages/DocumentsPage.tsx`
- Modify: `frontend/src/App.tsx` (register the `/documents` protected route)
- Test: `frontend/src/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `listDocuments`, `uploadDocument` (Task 17), `useAuth` (Task 16).
- Produces: `<DocumentsPage>`, mounted at `/documents` behind `<ProtectedRoute>`. Later tasks (19, 20) extend this same component with preview/download/rename/delete actions.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/DocumentsPage.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}))

import { listDocuments, uploadDocument } from '../lib/api'
import { DocumentsPage } from './DocumentsPage'

describe('DocumentsPage', () => {
  it('renders the list of documents', async () => {
    ;(listDocuments as any).mockResolvedValue([
      { id: '1', filename: 'report.pdf', file_type: 'pdf', status: 'ready', uploaded_at: '2026-01-01T00:00:00Z' },
    ])

    render(<DocumentsPage />)

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })
  })

  it('uploads a selected file and refreshes the list', async () => {
    ;(listDocuments as any).mockResolvedValue([])
    ;(uploadDocument as any).mockResolvedValue({
      id: '2',
      filename: 'notes.txt',
      file_type: 'txt',
      status: 'uploading',
      uploaded_at: '2026-01-01T00:00:00Z',
    })

    render(<DocumentsPage />)
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1))

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const input = screen.getByLabelText('Upload document') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalledWith(file)
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './DocumentsPage'`.

- [ ] **Step 3: Write DocumentsPage.tsx**

Create `frontend/src/pages/DocumentsPage.tsx`:

```tsx
import { ChangeEvent, useEffect, useState } from 'react'

import { Document, listDocuments, uploadDocument } from '../lib/api'

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const docs = await listDocuments()
      setDocuments(docs)
    } catch {
      setError('Failed to load documents')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadDocument(file)
      await refresh()
    } catch {
      setError('Failed to upload document')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div>
      <h1>Your Documents</h1>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="upload-input">Upload document</label>
      <input id="upload-input" type="file" onChange={handleUpload} />
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            <span>{doc.filename}</span>
            <span> ({doc.status})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Modify `frontend/src/App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'

import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import { DocumentsPage } from './pages/DocumentsPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/documents"
          element={
            <ProtectedRoute>
              <DocumentsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </AuthProvider>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/src/pages/DocumentsPage.test.tsx frontend/src/App.tsx
git commit -m "feat: add document manager list and upload UI"
```

---

### Task 19: Document Manager UI — preview modal

**Files:**
- Create: `frontend/src/components/PreviewModal.tsx`
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Test: `frontend/src/components/PreviewModal.test.tsx`

**Interfaces:**
- Consumes: `getDownloadUrl`, `getPreviewText` (Task 17).
- Produces: `<PreviewModal document={doc} onClose={fn} />` — renders a native `<iframe>` for `pdf`, a `<pre>` of fetched text for `txt`/`md` (fetched from the signed download URL), and a `<pre>` of `getPreviewText()` for `docx`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/PreviewModal.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../lib/api', () => ({
  getDownloadUrl: vi.fn(),
  getPreviewText: vi.fn(),
}))

import { getDownloadUrl, getPreviewText } from '../lib/api'
import { PreviewModal } from './PreviewModal'

const baseDoc = {
  id: '1',
  user_id: 'u1',
  filename: 'file',
  storage_path: 'path',
  error_reason: null,
  extracted_text: null,
  uploaded_at: '2026-01-01T00:00:00Z',
  status: 'ready' as const,
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ text: async () => 'plain file contents' })
})

describe('PreviewModal', () => {
  it('renders a PDF preview using an iframe with the signed URL', async () => {
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.pdf')

    render(<PreviewModal document={{ ...baseDoc, file_type: 'pdf' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTitle('Document preview')).toHaveAttribute(
        'src',
        'https://signed.example/file.pdf',
      )
    })
  })

  it('renders extracted text for docx files', async () => {
    ;(getPreviewText as any).mockResolvedValue('Extracted docx content')

    render(<PreviewModal document={{ ...baseDoc, file_type: 'docx' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('Extracted docx content')).toBeInTheDocument()
    })
  })

  it('renders fetched text for txt/md files', async () => {
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.txt')

    render(<PreviewModal document={{ ...baseDoc, file_type: 'txt' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('plain file contents')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module './PreviewModal'`.

- [ ] **Step 3: Write PreviewModal.tsx**

Create `frontend/src/components/PreviewModal.tsx`:

```tsx
import { useEffect, useState } from 'react'

import { Document, getDownloadUrl, getPreviewText } from '../lib/api'

export function PreviewModal({ document, onClose }: { document: Document; onClose: () => void }) {
  const [content, setContent] = useState<{ kind: 'pdf' | 'text'; value: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (document.file_type === 'pdf') {
        const url = await getDownloadUrl(document.id)
        if (!cancelled) setContent({ kind: 'pdf', value: url })
        return
      }
      if (document.file_type === 'docx') {
        const text = await getPreviewText(document.id)
        if (!cancelled) setContent({ kind: 'text', value: text })
        return
      }
      const url = await getDownloadUrl(document.id)
      const response = await fetch(url)
      const text = await response.text()
      if (!cancelled) setContent({ kind: 'text', value: text })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [document])

  return (
    <div role="dialog">
      <button onClick={onClose}>Close</button>
      {content?.kind === 'pdf' && (
        <iframe title="Document preview" src={content.value} width="100%" height="600" />
      )}
      {content?.kind === 'text' && <pre>{content.value}</pre>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Wire the modal into DocumentsPage**

Modify `frontend/src/pages/DocumentsPage.tsx`:

```tsx
import { ChangeEvent, useEffect, useState } from 'react'

import { Document, listDocuments, uploadDocument } from '../lib/api'
import { PreviewModal } from '../components/PreviewModal'

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<Document | null>(null)

  async function refresh() {
    try {
      const docs = await listDocuments()
      setDocuments(docs)
    } catch {
      setError('Failed to load documents')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadDocument(file)
      await refresh()
    } catch {
      setError('Failed to upload document')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div>
      <h1>Your Documents</h1>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="upload-input">Upload document</label>
      <input id="upload-input" type="file" onChange={handleUpload} />
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            <span>{doc.filename}</span>
            <span> ({doc.status})</span>
            {doc.status === 'ready' && (
              <button onClick={() => setPreviewing(doc)}>Preview</button>
            )}
          </li>
        ))}
      </ul>
      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
```

Run `npm test` again to confirm `DocumentsPage.test.tsx` (Task 18) still passes with the added import.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PreviewModal.tsx frontend/src/components/PreviewModal.test.tsx frontend/src/pages/DocumentsPage.tsx
git commit -m "feat: add document preview modal"
```

---

### Task 20: Document Manager UI — rename, delete, download

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Test: `frontend/src/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `renameDocument`, `deleteDocument`, `getDownloadUrl` (Task 17).

- [ ] **Step 1: Write the failing tests**

Modify `frontend/src/pages/DocumentsPage.test.tsx`, update the mock and add tests:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDownloadUrl: vi.fn(),
}))

import {
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../lib/api'
import { DocumentsPage } from './DocumentsPage'

const readyDoc = {
  id: '1',
  filename: 'report.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  uploaded_at: '2026-01-01T00:00:00Z',
}

describe('DocumentsPage', () => {
  it('renders the list of documents', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])

    render(<DocumentsPage />)

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })
  })

  it('uploads a selected file and refreshes the list', async () => {
    ;(listDocuments as any).mockResolvedValue([])
    ;(uploadDocument as any).mockResolvedValue({
      id: '2',
      filename: 'notes.txt',
      file_type: 'txt',
      status: 'uploading',
      uploaded_at: '2026-01-01T00:00:00Z',
    })

    render(<DocumentsPage />)
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1))

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const input = screen.getByLabelText('Upload document') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalledWith(file)
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('renames a document', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(renameDocument as any).mockResolvedValue({ ...readyDoc, filename: 'renamed.pdf' })
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('renamed.pdf'))

    render(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(renameDocument).toHaveBeenCalledWith('1', 'renamed.pdf')
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('deletes a document after confirmation', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(deleteDocument as any).mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteDocument).toHaveBeenCalledWith('1')
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('opens the download URL when Download is clicked', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.pdf')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://signed.example/file.pdf', '_blank')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — no "Rename"/"Delete"/"Download" buttons exist yet.

- [ ] **Step 3: Add rename/delete/download actions**

Modify `frontend/src/pages/DocumentsPage.tsx`:

```tsx
import { ChangeEvent, useEffect, useState } from 'react'

import {
  Document,
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../lib/api'
import { PreviewModal } from '../components/PreviewModal'

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<Document | null>(null)

  async function refresh() {
    try {
      const docs = await listDocuments()
      setDocuments(docs)
    } catch {
      setError('Failed to load documents')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadDocument(file)
      await refresh()
    } catch {
      setError('Failed to upload document')
    } finally {
      event.target.value = ''
    }
  }

  async function handleRename(doc: Document) {
    const newName = window.prompt('New filename', doc.filename)
    if (!newName) return
    try {
      await renameDocument(doc.id, newName)
      await refresh()
    } catch {
      setError('Failed to rename document')
    }
  }

  async function handleDelete(doc: Document) {
    if (!window.confirm(`Delete ${doc.filename}?`)) return
    try {
      await deleteDocument(doc.id)
      await refresh()
    } catch {
      setError('Failed to delete document')
    }
  }

  async function handleDownload(doc: Document) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError('Failed to download document')
    }
  }

  return (
    <div>
      <h1>Your Documents</h1>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="upload-input">Upload document</label>
      <input id="upload-input" type="file" onChange={handleUpload} />
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            <span>{doc.filename}</span>
            <span> ({doc.status})</span>
            {doc.status === 'ready' && (
              <>
                <button onClick={() => setPreviewing(doc)}>Preview</button>
                <button onClick={() => handleDownload(doc)}>Download</button>
              </>
            )}
            <button onClick={() => handleRename(doc)}>Rename</button>
            <button onClick={() => handleDelete(doc)}>Delete</button>
          </li>
        ))}
      </ul>
      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/src/pages/DocumentsPage.test.tsx
git commit -m "feat: add rename, delete, and download actions to document manager"
```

---

## Manual End-to-End Verification (after all tasks complete)

1. Create a Supabase project; run `backend/migrations/0001_init.sql` in its SQL editor; create a `documents` Storage bucket.
2. Fill in real `backend/.env` and `frontend/.env` values (Supabase URL/keys, Voyage/Anthropic keys).
3. Start the backend: `cd backend && uvicorn app.main:app --reload`.
4. Start the frontend: `cd frontend && npm run dev`.
5. In the browser: sign up, log in, upload a real PDF and a real DOCX, watch status move from Processing to Ready, preview both, download both, rename one, delete one — confirm each action reflects correctly in the list.
