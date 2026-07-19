# Team Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a team, have its admin add existing users directly by email search (no invite flow), and share individual documents/quizzes with that team — with search, chat, and quiz generation/taking all honoring team-shared access.

**Architecture:** New Postgres tables (`profiles`, `teams`, `team_members`, `document_shares`, `quiz_shares`) added via a numbered SQL migration, following this repo's existing raw-SQL/no-ORM FastAPI pattern. A single new `app/services/access.py` module centralizes the "owned OR shared-with-my-team" SQL fragment reused by quiz generation, chat retrieval, search, and the new share endpoints. Frontend adds a `TeamsPage`, a reusable `ShareTeamsModal`, and a "Shared with me" tab on the Documents and Quiz History pages.

**Tech Stack:** FastAPI + psycopg3 (raw SQL, `dict_row`), Supabase Postgres, pytest against a local pgvector container; React 18 + Vite + TypeScript, TanStack Query, react-i18next (default language: Vietnamese `vi`), Vitest + Testing Library.

## Global Constraints

- Every new/modified query must preserve the existing invariant: explicit `WHERE`/access-clause in application code, never relying on RLS alone (`README.md` "Core invariants").
- No ORM — raw SQL via `psycopg`, matching every existing router.
- Follow TDD: write the failing test, confirm failure, implement, confirm pass, commit.
- Default app language is Vietnamese (`i18n` `fallbackLng: 'vi'`) — frontend tests assert Vietnamese strings by default, matching every existing page test.
- `profiles.email` is nullable (not `not null`) — the local test fixture's `auth.users` stub doesn't always have an email (existing tests insert users without one), and real Supabase auth always populates it in production.

---

## Task 1: Migration, test fixture, and conftest wiring

**Files:**
- Create: `backend/migrations/0006_teams.sql`
- Modify: `backend/tests/fixtures/0000_test_auth_stub.sql`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_teams_schema.py`

**Interfaces:**
- Produces: tables `profiles(id, email, created_at)`, `teams(id, name, created_by, created_at)`, `team_members(team_id, user_id, role, added_at)`, `document_shares(document_id, team_id, shared_by, shared_at)`, `quiz_shares(quiz_id, team_id, shared_by, shared_at)`. A Postgres trigger `on_auth_user_created` auto-inserts a `profiles` row whenever a row is inserted into `auth.users`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_teams_schema.py
import uuid

import psycopg

from tests.conftest import TEST_DB_URL


def test_inserting_an_auth_user_auto_creates_a_profile():
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO auth.users (id, email) VALUES (%s, %s)", (user_id, "a@example.com")
        )
        row = conn.execute(
            "SELECT email FROM profiles WHERE id = %s", (user_id,)
        ).fetchone()

    assert row == ("a@example.com",)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_teams_schema.py -v`
Expected: FAIL — `relation "profiles" does not exist` (table/trigger don't exist yet).

- [ ] **Step 3: Add the `email` column to the test auth stub**

```sql
# backend/tests/fixtures/0000_test_auth_stub.sql
create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key
);

alter table auth.users add column if not exists email text;

create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select null::uuid $$;
```

- [ ] **Step 4: Write the migration**

```sql
# backend/migrations/0006_teams.sql
create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
    language plpgsql
    as $$
begin
    insert into profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();

create table teams (
    id uuid primary key,
    name text not null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now()
);

create table team_members (
    team_id uuid not null references teams(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('admin', 'member')),
    added_at timestamptz not null default now(),
    primary key (team_id, user_id)
);

create table document_shares (
    document_id uuid not null references documents(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    shared_by uuid not null references auth.users(id),
    shared_at timestamptz not null default now(),
    primary key (document_id, team_id)
);

create table quiz_shares (
    quiz_id uuid not null references quizzes(id) on delete cascade,
    team_id uuid not null references teams(id) on delete cascade,
    shared_by uuid not null references auth.users(id),
    shared_at timestamptz not null default now(),
    primary key (quiz_id, team_id)
);

create index team_members_user_id_idx on team_members (user_id);
create index document_shares_team_id_idx on document_shares (team_id);
create index quiz_shares_team_id_idx on quiz_shares (team_id);

alter table profiles enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table document_shares enable row level security;
alter table quiz_shares enable row level security;

create policy "profiles_self" on profiles
    for select using (auth.uid() = id);

create policy "teams_member" on teams
    for select using (
        exists (select 1 from team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid())
    );

create policy "team_members_member" on team_members
    for select using (
        exists (select 1 from team_members tm where tm.team_id = team_members.team_id and tm.user_id = auth.uid())
    );

create policy "document_shares_team_member" on document_shares
    for select using (
        exists (select 1 from team_members tm where tm.team_id = document_shares.team_id and tm.user_id = auth.uid())
    );

create policy "quiz_shares_team_member" on quiz_shares
    for select using (
        exists (select 1 from team_members tm where tm.team_id = quiz_shares.team_id and tm.user_id = auth.uid())
    );

create policy "documents_shared_with_team" on documents
    for select using (
        exists (
            select 1 from document_shares ds
            join team_members tm on tm.team_id = ds.team_id
            where ds.document_id = documents.id and tm.user_id = auth.uid()
        )
    );

create policy "quizzes_shared_with_team" on quizzes
    for select using (
        exists (
            select 1 from quiz_shares qs
            join team_members tm on tm.team_id = qs.team_id
            where qs.quiz_id = quizzes.id and tm.user_id = auth.uid()
        )
    );
```

- [ ] **Step 5: Wire the migration into `conftest.py`**

Modify `backend/tests/conftest.py`'s `apply_migrations` fixture — add the new migration to the read list, the DROP list (new tables first, FK-child-safe order not required since `CASCADE` is used), and execute it. Add the team-specific tables (not `profiles`, which — like `auth.users` — persists across tests within a session) to `clean_tables`'s TRUNCATE list.

```python
# backend/tests/conftest.py — apply_migrations, full replacement of the fixture body
@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    _assert_is_test_db(TEST_DB_URL)
    stub_sql = (BACKEND_ROOT / "tests" / "fixtures" / "0000_test_auth_stub.sql").read_text()
    init_sql = (BACKEND_ROOT / "migrations" / "0001_init.sql").read_text()
    chat_sql = (BACKEND_ROOT / "migrations" / "0002_chat.sql").read_text()
    quiz_sql = (BACKEND_ROOT / "migrations" / "0003_quiz.sql").read_text()
    search_fts_sql = (BACKEND_ROOT / "migrations" / "0004_search_fts.sql").read_text()
    chat_general_knowledge_sql = (
        BACKEND_ROOT / "migrations" / "0005_chat_general_knowledge.sql"
    ).read_text()
    teams_sql = (BACKEND_ROOT / "migrations" / "0006_teams.sql").read_text()
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "DROP TABLE IF EXISTS quiz_shares, document_shares, team_members, teams, profiles, "
            "quiz_attempts, quiz_questions, quizzes, "
            "chat_messages, chat_sessions, chunks, documents CASCADE"
        )
        conn.execute(stub_sql)
        conn.execute(init_sql)
        conn.execute(chat_sql)
        conn.execute(quiz_sql)
        conn.execute(search_fts_sql)
        conn.execute(chat_general_knowledge_sql)
        conn.execute(teams_sql)
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "TRUNCATE quiz_shares, document_shares, team_members, teams, "
            "quiz_attempts, quiz_questions, quizzes, "
            "chat_messages, chat_sessions, chunks, documents CASCADE"
        )
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_teams_schema.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite to confirm no regressions**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (existing tests insert `auth.users` with only `id`, which is still valid since `email` is nullable).

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/0006_teams.sql backend/tests/fixtures/0000_test_auth_stub.sql backend/tests/conftest.py backend/tests/test_teams_schema.py
git commit -m "feat: add teams/profiles schema with auto-populated profiles trigger"
```

---

## Task 2: Access-check helper

**Files:**
- Create: `backend/app/services/access.py`
- Test: `backend/tests/test_access.py`

**Interfaces:**
- Consumes: an open `psycopg` connection (as returned by `get_conn()`), a `user_id: str`.
- Produces: `DOCUMENT_ACCESS_CLAUSE: str` (SQL fragment referencing alias `d` for `documents`), `QUIZ_ACCESS_CLAUSE: str` (SQL fragment referencing alias `q` for `quizzes`), `access_params(user_id: str) -> tuple[str, str]`, `is_team_member(conn, team_id: str, user_id: str) -> bool`. These are consumed by Tasks 6, 7, and 8.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_access.py
import uuid

import psycopg

from tests.conftest import TEST_DB_URL


def _create_user() -> str:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    return user_id


def _create_document(user_id: str) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'a.txt', 'txt', 'path/a.txt', 'ready')
            """,
            (document_id, user_id),
        )
    return document_id


def test_document_access_clause_allows_owner_and_team_shared_and_excludes_others():
    from app.services.access import DOCUMENT_ACCESS_CLAUSE, access_params

    owner_id = _create_user()
    member_id = _create_user()
    stranger_id = _create_user()
    team_id = str(uuid.uuid4())
    owned_doc = _create_document(owner_id)
    unshared_doc = _create_document(owner_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO teams (id, name, created_by) VALUES (%s, 'Team', %s)",
            (team_id, owner_id),
        )
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES (%s, %s, 'admin'), (%s, %s, 'member')",
            (team_id, owner_id, team_id, member_id),
        )
        conn.execute(
            "INSERT INTO document_shares (document_id, team_id, shared_by) VALUES (%s, %s, %s)",
            (owned_doc, team_id, owner_id),
        )

        def accessible_ids(user_id: str) -> set[str]:
            rows = conn.execute(
                f"SELECT d.id FROM documents d WHERE {DOCUMENT_ACCESS_CLAUSE}",
                access_params(user_id),
            ).fetchall()
            return {str(r["id"]) for r in rows}

        assert accessible_ids(owner_id) == {owned_doc, unshared_doc}
        assert accessible_ids(member_id) == {owned_doc}
        assert accessible_ids(stranger_id) == set()


def test_is_team_member():
    from app.services.access import is_team_member

    owner_id = _create_user()
    stranger_id = _create_user()
    team_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO teams (id, name, created_by) VALUES (%s, 'Team', %s)",
            (team_id, owner_id),
        )
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES (%s, %s, 'admin')",
            (team_id, owner_id),
        )
        assert is_team_member(conn, team_id, owner_id) is True
        assert is_team_member(conn, team_id, stranger_id) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_access.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.access'`

- [ ] **Step 3: Implement the helper**

```python
# backend/app/services/access.py
DOCUMENT_ACCESS_CLAUSE = """(
    d.user_id = %s
    OR d.id IN (
        SELECT ds.document_id
        FROM document_shares ds
        JOIN team_members tm ON tm.team_id = ds.team_id
        WHERE tm.user_id = %s
    )
)"""

QUIZ_ACCESS_CLAUSE = """(
    q.user_id = %s
    OR q.id IN (
        SELECT qs.quiz_id
        FROM quiz_shares qs
        JOIN team_members tm ON tm.team_id = qs.team_id
        WHERE tm.user_id = %s
    )
)"""


def access_params(user_id: str) -> tuple[str, str]:
    return (user_id, user_id)


def is_team_member(conn, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = %s AND user_id = %s",
        (team_id, user_id),
    ).fetchone()
    return row is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_access.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/access.py backend/tests/test_access.py
git commit -m "feat: add centralized owned-or-team-shared access check helper"
```

---

## Task 3: Teams router — create and list teams

**Files:**
- Create: `backend/app/routers/teams.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_teams.py`

**Interfaces:**
- Produces: `router: APIRouter` with `POST /teams`, `GET /teams`; helper `_require_member(conn, team_id, user_id) -> str` (returns role, raises 404) and `_require_admin(conn, team_id, user_id) -> None` (raises 403), consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_teams.py
import uuid

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user(email: str | None = None) -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (user_id, email))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def test_create_team_makes_caller_the_admin():
    user_id, headers = _create_user("owner@example.com")

    response = client.post("/teams", json={"name": "Engineering"}, headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Engineering"
    assert body["role"] == "admin"


def test_create_team_rejects_empty_name():
    _, headers = _create_user("owner@example.com")

    response = client.post("/teams", json={"name": "   "}, headers=headers)

    assert response.status_code == 400


def test_list_teams_returns_only_teams_the_caller_belongs_to():
    _, headers_a = _create_user("a@example.com")
    _, headers_b = _create_user("b@example.com")
    client.post("/teams", json={"name": "A's Team"}, headers=headers_a)
    client.post("/teams", json={"name": "B's Team"}, headers=headers_b)

    response = client.get("/teams", headers=headers_a)

    assert response.status_code == 200
    names = [t["name"] for t in response.json()]
    assert names == ["A's Team"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_teams.py -v`
Expected: FAIL — 404 (no `/teams` route registered yet).

- [ ] **Step 3: Implement the router**

```python
# backend/app/routers/teams.py
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.db import get_conn

router = APIRouter(prefix="/teams", tags=["teams"])


class CreateTeamRequest(BaseModel):
    name: str


def _serialize_team(row) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "role": row["role"],
        "created_at": row["created_at"].isoformat(),
    }


@router.post("", status_code=201)
def create_team(body: CreateTeamRequest, user_id: str = Depends(get_current_user_id)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Team name must not be empty")

    team_id = str(uuid.uuid4())
    with get_conn() as conn:
        team_row = conn.execute(
            """
            INSERT INTO teams (id, name, created_by)
            VALUES (%s, %s, %s)
            RETURNING id, name, created_at
            """,
            (team_id, body.name, user_id),
        ).fetchone()
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES (%s, %s, 'admin')",
            (team_id, user_id),
        )

    return _serialize_team({**team_row, "role": "admin"})


@router.get("")
def list_teams(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.created_at, tm.role
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.user_id = %s
            ORDER BY t.created_at
            """,
            (user_id,),
        ).fetchall()
    return [_serialize_team(row) for row in rows]


def _require_member(conn, team_id: str, user_id: str) -> str:
    row = conn.execute(
        "SELECT role FROM team_members WHERE team_id = %s AND user_id = %s",
        (team_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return row["role"]


def _require_admin(conn, team_id: str, user_id: str) -> None:
    if _require_member(conn, team_id, user_id) != "admin":
        raise HTTPException(status_code=403, detail="Only the team admin can do this")
```

- [ ] **Step 4: Register the router**

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import chat, documents, quiz, search, teams

app = FastAPI(title="Document Knowledge Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(search.router)
app.include_router(chat.router)
app.include_router(quiz.router)
app.include_router(teams.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_teams.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/teams.py backend/app/main.py backend/tests/test_teams.py
git commit -m "feat: add create/list teams endpoints"
```

---

## Task 4: Teams router — members (list, search, add, remove)

**Files:**
- Modify: `backend/app/routers/teams.py`
- Modify: `backend/tests/test_teams.py`

**Interfaces:**
- Produces: `GET /teams/{team_id}/members`, `GET /teams/{team_id}/members/search?q=`, `POST /teams/{team_id}/members`, `DELETE /teams/{team_id}/members/{member_user_id}`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_teams.py — append
def _create_team(headers: dict, name: str = "Team") -> str:
    response = client.post("/teams", json={"name": name}, headers=headers)
    return response.json()["id"]


def test_list_members_includes_admin_and_email():
    admin_id, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)

    response = client.get(f"/teams/{team_id}/members", headers=admin_headers)

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {"user_id": admin_id, "email": "admin@example.com", "role": "admin", "added_at": body[0]["added_at"]}
    ]


def test_list_members_rejects_non_members():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    _, stranger_headers = _create_user("stranger@example.com")

    response = client.get(f"/teams/{team_id}/members", headers=stranger_headers)

    assert response.status_code == 404


def test_search_members_finds_by_email_and_excludes_existing_members():
    admin_id, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    colleague_id, _ = _create_user("colleague@example.com")

    response = client.get(
        f"/teams/{team_id}/members/search", params={"q": "colleague"}, headers=admin_headers
    )

    assert response.status_code == 200
    assert response.json() == [{"user_id": colleague_id, "email": "colleague@example.com"}]

    admin_search = client.get(
        f"/teams/{team_id}/members/search", params={"q": "admin"}, headers=admin_headers
    )
    assert admin_search.json() == []


def test_search_members_is_admin_only():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    member_id, member_headers = _create_user("member@example.com")
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)

    response = client.get(
        f"/teams/{team_id}/members/search", params={"q": "a"}, headers=member_headers
    )

    assert response.status_code == 403


def test_add_member_by_user_id():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    colleague_id, _ = _create_user("colleague@example.com")

    response = client.post(
        f"/teams/{team_id}/members", json={"user_id": colleague_id}, headers=admin_headers
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_id"] == colleague_id
    assert body["email"] == "colleague@example.com"
    assert body["role"] == "member"

    members = client.get(f"/teams/{team_id}/members", headers=admin_headers).json()
    assert len(members) == 2


def test_add_member_rejects_unknown_user():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)

    response = client.post(
        f"/teams/{team_id}/members", json={"user_id": str(uuid.uuid4())}, headers=admin_headers
    )

    assert response.status_code == 404


def test_add_member_is_admin_only():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    member_id, member_headers = _create_user("member@example.com")
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)
    other_id, _ = _create_user("other@example.com")

    response = client.post(
        f"/teams/{team_id}/members", json={"user_id": other_id}, headers=member_headers
    )

    assert response.status_code == 403


def test_remove_member():
    _, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)
    member_id, _ = _create_user("member@example.com")
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)

    response = client.delete(f"/teams/{team_id}/members/{member_id}", headers=admin_headers)

    assert response.status_code == 204
    members = client.get(f"/teams/{team_id}/members", headers=admin_headers).json()
    assert len(members) == 1


def test_remove_member_cannot_remove_the_admin():
    admin_id, admin_headers = _create_user("admin@example.com")
    team_id = _create_team(admin_headers)

    response = client.delete(f"/teams/{team_id}/members/{admin_id}", headers=admin_headers)

    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_teams.py -v`
Expected: FAIL — 404s for the new, not-yet-defined routes.

- [ ] **Step 3: Implement the endpoints**

```python
# backend/app/routers/teams.py — append
@router.get("/{team_id}/members")
def list_members(team_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        _require_member(conn, team_id, user_id)
        rows = conn.execute(
            """
            SELECT tm.user_id, p.email, tm.role, tm.added_at
            FROM team_members tm
            JOIN profiles p ON p.id = tm.user_id
            WHERE tm.team_id = %s
            ORDER BY tm.added_at
            """,
            (team_id,),
        ).fetchall()
    return [
        {
            "user_id": str(row["user_id"]),
            "email": row["email"],
            "role": row["role"],
            "added_at": row["added_at"].isoformat(),
        }
        for row in rows
    ]


@router.get("/{team_id}/members/search")
def search_members(team_id: str, q: str = "", user_id: str = Depends(get_current_user_id)):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query must not be empty")
    with get_conn() as conn:
        _require_admin(conn, team_id, user_id)
        rows = conn.execute(
            """
            SELECT id, email
            FROM profiles
            WHERE email ILIKE %s
              AND id NOT IN (SELECT user_id FROM team_members WHERE team_id = %s)
            ORDER BY email
            LIMIT 20
            """,
            (f"%{q}%", team_id),
        ).fetchall()
    return [{"user_id": str(row["id"]), "email": row["email"]} for row in rows]


class AddMemberRequest(BaseModel):
    user_id: str


@router.post("/{team_id}/members", status_code=201)
def add_member(team_id: str, body: AddMemberRequest, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        _require_admin(conn, team_id, user_id)
        profile_row = conn.execute(
            "SELECT id, email FROM profiles WHERE id = %s", (body.user_id,)
        ).fetchone()
        if profile_row is None:
            raise HTTPException(status_code=404, detail="User not found")

        row = conn.execute(
            """
            INSERT INTO team_members (team_id, user_id, role)
            VALUES (%s, %s, 'member')
            ON CONFLICT (team_id, user_id) DO NOTHING
            RETURNING role, added_at
            """,
            (team_id, body.user_id),
        ).fetchone()
        if row is None:
            row = conn.execute(
                "SELECT role, added_at FROM team_members WHERE team_id = %s AND user_id = %s",
                (team_id, body.user_id),
            ).fetchone()

    return {
        "user_id": body.user_id,
        "email": profile_row["email"],
        "role": row["role"],
        "added_at": row["added_at"].isoformat(),
    }


@router.delete("/{team_id}/members/{member_user_id}", status_code=204)
def remove_member(team_id: str, member_user_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        _require_admin(conn, team_id, user_id)
        if member_user_id == user_id:
            raise HTTPException(status_code=403, detail="Cannot remove the team admin")
        conn.execute(
            "DELETE FROM team_members WHERE team_id = %s AND user_id = %s",
            (team_id, member_user_id),
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_teams.py -v`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/teams.py backend/tests/test_teams.py
git commit -m "feat: add team member list/search/add/remove endpoints"
```

---

## Task 5: Documents — share, unshare, shared list, `shared_team_ids`

**Files:**
- Modify: `backend/app/routers/documents.py`
- Modify: `backend/app/models.py`
- Test: `backend/tests/test_document_share.py`

**Interfaces:**
- Consumes: `is_team_member` from `app.services.access` (Task 2).
- Produces: `POST /documents/{document_id}/share`, `DELETE /documents/{document_id}/share/{team_id}`, `GET /documents/shared`. `GET /documents` response items gain `shared_team_ids: list[str]`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_document_share.py
import uuid

import psycopg
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.conftest import TEST_DB_URL
from tests.helpers import make_token

client = TestClient(app)


def _create_user(email: str | None = None) -> tuple[str, dict]:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (user_id, email))
    token = make_token(user_id, settings.supabase_jwt_secret)
    return user_id, {"Authorization": f"Bearer {token}"}


def _create_document(user_id: str, filename: str = "policy.txt") -> str:
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


def _create_team_with_member(admin_headers: dict, member_id: str) -> str:
    team_id = client.post("/teams", json={"name": "Team"}, headers=admin_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)
    return team_id


def test_share_document_makes_it_visible_to_team_members():
    owner_id, owner_headers = _create_user("owner@example.com")
    member_id, member_headers = _create_user("member@example.com")
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_document(owner_id)

    share = client.post(
        f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers
    )
    assert share.status_code == 201

    shared = client.get("/documents/shared", headers=member_headers)
    assert shared.status_code == 200
    assert [d["id"] for d in shared.json()] == [document_id]

    mine = client.get("/documents", headers=owner_headers).json()
    assert mine[0]["shared_team_ids"] == [team_id]


def test_share_document_rejects_non_owner():
    owner_id, owner_headers = _create_user("owner@example.com")
    document_id = _create_document(owner_id)
    _, other_headers = _create_user("other@example.com")
    other_team_id = client.post("/teams", json={"name": "Other"}, headers=other_headers).json()["id"]

    response = client.post(
        f"/documents/{document_id}/share", json={"team_id": other_team_id}, headers=other_headers
    )

    assert response.status_code == 404


def test_share_document_rejects_team_owner_does_not_belong_to():
    owner_id, owner_headers = _create_user("owner@example.com")
    document_id = _create_document(owner_id)
    _, other_headers = _create_user("other@example.com")
    other_team_id = client.post("/teams", json={"name": "Other"}, headers=other_headers).json()["id"]

    response = client.post(
        f"/documents/{document_id}/share", json={"team_id": other_team_id}, headers=owner_headers
    )

    assert response.status_code == 403


def test_unshare_document_removes_visibility():
    owner_id, owner_headers = _create_user("owner@example.com")
    member_id, member_headers = _create_user("member@example.com")
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_document(owner_id)
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.delete(f"/documents/{document_id}/share/{team_id}", headers=owner_headers)

    assert response.status_code == 204
    assert client.get("/documents/shared", headers=member_headers).json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_document_share.py -v`
Expected: FAIL — 404s for undefined routes / missing `shared_team_ids` key.

- [ ] **Step 3: Add `shared_team_ids` to the response model**

```python
# backend/app/models.py — replace DocumentListItemOut
class DocumentListItemOut(BaseModel):
    id: str
    user_id: str
    filename: str
    file_type: str
    status: str
    error_reason: str | None = None
    uploaded_at: datetime
    shared_team_ids: list[str] = []

    @field_validator("id", "user_id", mode="before")
    @classmethod
    def _stringify_uuid(cls, value):
        if isinstance(value, UUID):
            return str(value)
        return value

    @field_validator("shared_team_ids", mode="before")
    @classmethod
    def _stringify_team_ids(cls, value):
        if value is None:
            return []
        return [str(v) for v in value]
```

- [ ] **Step 4: Update `list_documents` to include `shared_team_ids`**

```python
# backend/app/routers/documents.py — replace list_documents body
@router.get("", response_model=list[DocumentListItemOut])
def list_documents(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, filename, file_type, status,
                   error_reason, uploaded_at,
                   (SELECT array_agg(team_id) FROM document_shares WHERE document_id = documents.id)
                       AS shared_team_ids
            FROM documents
            WHERE user_id = %s
            ORDER BY uploaded_at DESC
            """,
            (user_id,),
        ).fetchall()
    return rows
```

- [ ] **Step 5: Add share/unshare/shared-list endpoints**

```python
# backend/app/routers/documents.py — add import at top
from app.services.access import is_team_member
```

```python
# backend/app/routers/documents.py — append
class ShareRequest(BaseModel):
    team_id: str


@router.post("/{document_id}/share", status_code=201)
def share_document(document_id: str, body: ShareRequest, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        doc_row = conn.execute(
            "SELECT id FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
        if doc_row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        if not is_team_member(conn, body.team_id, user_id):
            raise HTTPException(status_code=403, detail="You are not a member of this team")

        row = conn.execute(
            """
            INSERT INTO document_shares (document_id, team_id, shared_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (document_id, team_id) DO NOTHING
            RETURNING shared_at
            """,
            (document_id, body.team_id, user_id),
        ).fetchone()
        if row is None:
            row = conn.execute(
                "SELECT shared_at FROM document_shares WHERE document_id = %s AND team_id = %s",
                (document_id, body.team_id),
            ).fetchone()

    return {"document_id": document_id, "team_id": body.team_id, "shared_at": row["shared_at"].isoformat()}


@router.delete("/{document_id}/share/{team_id}", status_code=204)
def unshare_document(document_id: str, team_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        doc_row = conn.execute(
            "SELECT id FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
        if doc_row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        conn.execute(
            "DELETE FROM document_shares WHERE document_id = %s AND team_id = %s",
            (document_id, team_id),
        )


@router.get("/shared", response_model=list[DocumentListItemOut])
def list_shared_documents(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT d.id, d.user_id, d.filename, d.file_type, d.status,
                   d.error_reason, d.uploaded_at
            FROM documents d
            JOIN document_shares ds ON ds.document_id = d.id
            JOIN team_members tm ON tm.team_id = ds.team_id
            WHERE tm.user_id = %s
            ORDER BY d.uploaded_at DESC
            """,
            (user_id,),
        ).fetchall()
    return rows
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_document_share.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite for regressions**

Run: `cd backend && python -m pytest -q`
Expected: all pass — `DocumentListItemOut` is also used by `list_documents`'s existing consumers, which don't inspect `shared_team_ids`, so no other test should break.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/documents.py backend/app/models.py backend/tests/test_document_share.py
git commit -m "feat: add document share/unshare/shared-list endpoints"
```

---

## Task 6: Quiz — access clause wiring, share, unshare, shared list, `shared_team_ids`

**Files:**
- Modify: `backend/app/routers/quiz.py`
- Test: `backend/tests/test_quiz_share.py`
- Test: `backend/tests/test_quiz_generate.py` (extend)
- Test: `backend/tests/test_quiz_get.py` (extend)
- Test: `backend/tests/test_quiz_attempts.py` (extend)

**Interfaces:**
- Consumes: `DOCUMENT_ACCESS_CLAUSE`, `QUIZ_ACCESS_CLAUSE`, `access_params`, `is_team_member` from `app.services.access`.
- Produces: `POST /quiz/{quiz_id}/share`, `DELETE /quiz/{quiz_id}/share/{team_id}`, `GET /quiz/shared` → `{"quizzes": [{"id", "document_ids", "created_at"}]}`. `POST /quiz/generate` accepts shared documents. `GET /quiz/{quiz_id}` and `POST /quiz/{quiz_id}/attempts` accept shared quizzes. `GET /quiz/attempts` items gain `shared_team_ids: list[str]`.

- [ ] **Step 1: Write the failing test for generate-quiz-over-shared-documents**

```python
# backend/tests/test_quiz_generate.py — append
def _create_team_with_member(admin_headers: dict, member_id: str) -> str:
    team_id = client.post("/teams", json={"name": "Team"}, headers=admin_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=admin_headers)
    return team_id


def test_generate_quiz_allows_documents_shared_with_caller_team(monkeypatch):
    from app.routers import quiz as quiz_router

    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = _create_team_with_member(owner_headers, member_id)
    document_id = _create_document_with_chunks(owner_id, "shared.txt", 3)
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    questions = [_valid_question(document_id, i % 3) for i in range(5)]
    generate_mock = MagicMock(return_value=questions)
    monkeypatch.setattr(quiz_router, "generate_quiz_questions", generate_mock)

    response = client.post(
        "/quiz/generate",
        json={"document_ids": [document_id], "num_questions": 5},
        headers=member_headers,
    )

    assert response.status_code == 201
    assert response.json()["actual_count"] == 5
```

- [ ] **Step 2: Write the failing tests for taking a shared quiz**

`test_quiz_get.py` and `test_quiz_attempts.py` build quizzes directly via a `_create_quiz_with_questions(user_id, document_id, questions)` helper (bypassing `/quiz/generate`) rather than the `_create_document_with_chunks`/`_valid_question`/`monkeypatch` pattern used in `test_quiz_generate.py` — reuse each file's own existing helpers, already defined at the top of each file (`_create_user`, `_create_document`, `_create_quiz_with_questions`).

```python
# backend/tests/test_quiz_get.py — append at the end, using this file's existing helpers
def test_get_shared_quiz_is_accessible_to_team_members():
    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id, _ = _create_quiz_with_questions(
        owner_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.get(f"/quiz/{quiz_id}", headers=member_headers)

    assert response.status_code == 200
    assert response.json()["id"] == quiz_id
```

`test_get_quiz_returns_404_for_other_users_quiz` already exists in this file and covers the non-shared, non-owner case — no need to duplicate it.

```python
# backend/tests/test_quiz_attempts.py — append at the end, using this file's existing helpers
def test_submit_attempt_allows_team_member_on_shared_quiz():
    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        owner_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": question_ids[0], "selected_option": 0}]},
        headers=member_headers,
    )

    assert response.status_code == 201
    assert response.json()["score"] == 1


def test_list_attempts_reports_shared_team_ids():
    owner_id, owner_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id, question_ids = _create_quiz_with_questions(
        owner_id, document_id, [{"question": "Q1", "options": ["a", "b", "c", "d"], "correct_answer": 0}]
    )
    client.post(
        f"/quiz/{quiz_id}/attempts",
        json={"answers": [{"question_id": question_ids[0], "selected_option": 0}]},
        headers=owner_headers,
    )
    client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.get("/quiz/attempts", headers=owner_headers)

    assert response.status_code == 200
    assert response.json()["attempts"][0]["shared_team_ids"] == [team_id]
```

- [ ] **Step 3: Write the failing tests for share/unshare/shared-list**

```python
# backend/tests/test_quiz_share.py
import uuid

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


def _create_quiz(user_id: str, document_id: str) -> str:
    quiz_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO quizzes (id, user_id, document_ids) VALUES (%s, %s, %s)",
            (quiz_id, user_id, [document_id]),
        )
    return quiz_id


def test_share_quiz_and_list_shared():
    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id = _create_quiz(owner_id, document_id)

    share = client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)
    assert share.status_code == 201

    shared = client.get("/quiz/shared", headers=member_headers)
    assert shared.status_code == 200
    assert [q["id"] for q in shared.json()["quizzes"]] == [quiz_id]


def test_share_quiz_rejects_non_owner():
    owner_id, owner_headers = _create_user()
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id = _create_quiz(owner_id, document_id)
    _, other_headers = _create_user()
    other_team_id = client.post("/teams", json={"name": "Other"}, headers=other_headers).json()["id"]

    response = client.post(
        f"/quiz/{quiz_id}/share", json={"team_id": other_team_id}, headers=other_headers
    )

    assert response.status_code == 404


def test_unshare_quiz_removes_visibility():
    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document(owner_id, "policy.txt")
    quiz_id = _create_quiz(owner_id, document_id)
    client.post(f"/quiz/{quiz_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.delete(f"/quiz/{quiz_id}/share/{team_id}", headers=owner_headers)

    assert response.status_code == 204
    assert client.get("/quiz/shared", headers=member_headers).json() == {"quizzes": []}
```

- [ ] **Step 4: Run all new/extended tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_quiz_share.py tests/test_quiz_generate.py tests/test_quiz_get.py tests/test_quiz_attempts.py -v`
Expected: FAIL (routes/behavior not implemented yet).

- [ ] **Step 5: Add the access-clause import and rewrite the ownership checks in `generate_quiz`**

```python
# backend/app/routers/quiz.py — add import at top
from app.services.access import DOCUMENT_ACCESS_CLAUSE, QUIZ_ACCESS_CLAUSE, access_params, is_team_member
```

```python
# backend/app/routers/quiz.py — inside generate_quiz, replace the owned_rows query
        owned_rows = conn.execute(
            f"SELECT id FROM documents d WHERE d.id = ANY(%s) AND {DOCUMENT_ACCESS_CLAUSE}",
            (document_ids, *access_params(user_id)),
        ).fetchall()
```

```python
# backend/app/routers/quiz.py — inside generate_quiz, replace the chunk_rows query
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
```

- [ ] **Step 6: Run test to verify the generate-over-shared-docs test passes**

Run: `cd backend && python -m pytest tests/test_quiz_generate.py -v`
Expected: PASS (existing tests still pass — `test_generate_quiz_returns_404_for_other_users_document` still gets 404 since the stranger has no share).

- [ ] **Step 7: Rewrite `get_quiz` and `submit_attempt` ownership checks, and insert `GET /shared` before `get_quiz`**

Insert the new `list_shared_quizzes` route immediately after `list_attempts` and before `get_quiz` — FastAPI matches routes in registration order, and `/quiz/{quiz_id}` (registered first today) would otherwise swallow `/quiz/shared` as `quiz_id="shared"`.

```python
# backend/app/routers/quiz.py — insert between list_attempts and get_quiz
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
```

```python
# backend/app/routers/quiz.py — inside get_quiz, replace the ownership query
        quiz_row = conn.execute(
            f"SELECT id, document_ids, created_at FROM quizzes q WHERE q.id = %s AND {QUIZ_ACCESS_CLAUSE}",
            (quiz_id, *access_params(user_id)),
        ).fetchone()
```

```python
# backend/app/routers/quiz.py — inside submit_attempt, replace the ownership query
        quiz_row = conn.execute(
            f"SELECT id FROM quizzes q WHERE q.id = %s AND {QUIZ_ACCESS_CLAUSE}",
            (quiz_id, *access_params(user_id)),
        ).fetchone()
```

- [ ] **Step 8: Add `shared_team_ids` and fix filename resolution in `list_attempts`**

```python
# backend/app/routers/quiz.py — inside list_attempts, replace the attempt_rows query
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
```

```python
# backend/app/routers/quiz.py — inside list_attempts, replace the filename_rows query
        all_document_ids = {str(d) for row in attempt_rows for d in row["document_ids"]}
        filename_rows = conn.execute(
            f"SELECT id, filename FROM documents d WHERE d.id = ANY(%s) AND {DOCUMENT_ACCESS_CLAUSE}",
            (list(all_document_ids), *access_params(user_id)),
        ).fetchall()
        filename_by_id = {str(r["id"]): r["filename"] for r in filename_rows}
```

```python
# backend/app/routers/quiz.py — inside list_attempts' return statement, add shared_team_ids
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
```

- [ ] **Step 9: Add quiz share/unshare endpoints at the end of the file**

```python
# backend/app/routers/quiz.py — append
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
```

- [ ] **Step 10: Run all quiz tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_quiz_share.py tests/test_quiz_generate.py tests/test_quiz_get.py tests/test_quiz_attempts.py -v`
Expected: PASS

- [ ] **Step 11: Run the full backend suite for regressions**

Run: `cd backend && python -m pytest -q`
Expected: all pass

- [ ] **Step 12: Commit**

```bash
git add backend/app/routers/quiz.py backend/tests/test_quiz_share.py backend/tests/test_quiz_generate.py backend/tests/test_quiz_get.py backend/tests/test_quiz_attempts.py
git commit -m "feat: extend quiz generate/get/attempts to honor team-shared access, add quiz share endpoints"
```

---

## Task 7: Chat and search — include team-shared documents

**Files:**
- Modify: `backend/app/routers/chat.py`
- Modify: `backend/app/routers/search.py`
- Test: `backend/tests/test_chat.py` (extend)
- Test: `backend/tests/test_search.py` (extend)

**Interfaces:**
- Consumes: `DOCUMENT_ACCESS_CLAUSE`, `access_params` from `app.services.access`.

- [ ] **Step 1: Write the failing test for chat**

```python
# backend/tests/test_chat.py — append (reuses this file's existing _create_user/_create_document_with_chunks/_create_session helpers)
def test_chat_answers_from_documents_shared_with_caller_team(monkeypatch):
    from app.routers import chat as chat_router

    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document_with_chunks(owner_id, "policy.txt", [RELEVANT_VEC])
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    monkeypatch.setattr(chat_router, "embed_query", lambda q: RELEVANT_VEC)
    answer_mock = MagicMock(return_value={"answer": "From the shared doc", "used_general_knowledge": False})
    monkeypatch.setattr(chat_router, "answer_from_chunks", answer_mock)

    session_id = _create_session(member_headers)
    response = client.post(
        f"/chat/sessions/{session_id}/messages",
        json={"content": "What does the policy say?"},
        headers=member_headers,
    )

    assert response.status_code == 201
    chunks_passed = answer_mock.call_args[0][1]
    assert any(c["document_id"] == document_id for c in chunks_passed)
```

- [ ] **Step 2: Write the failing test for search**

```python
# backend/tests/test_search.py — append (reuses this file's existing _create_user/_create_document_with_chunks helpers)
def test_search_includes_documents_shared_with_caller_team(monkeypatch):
    from app.routers import search as search_router

    monkeypatch.setattr(search_router, "embed_query", lambda q: TARGET_VEC)

    owner_id, owner_headers = _create_user()
    member_id, member_headers = _create_user()
    team_id = client.post("/teams", json={"name": "Team"}, headers=owner_headers).json()["id"]
    client.post(f"/teams/{team_id}/members", json={"user_id": member_id}, headers=owner_headers)
    document_id = _create_document_with_chunks(owner_id, "shared.txt", [TARGET_VEC])
    client.post(f"/documents/{document_id}/share", json={"team_id": team_id}, headers=owner_headers)

    response = client.get("/search", params={"q": "revenue"}, headers=member_headers)

    filenames = [r["filename"] for r in response.json()["results"]]
    assert filenames == ["shared.txt"]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_chat.py tests/test_search.py -v`
Expected: FAIL — member sees no chunks from the owner's shared document.

- [ ] **Step 4: Wire the access clause into `chat.py`**

```python
# backend/app/routers/chat.py — add import at top
from app.services.access import DOCUMENT_ACCESS_CLAUSE, access_params
```

```python
# backend/app/routers/chat.py — replace the chunk_rows query inside send_message
            with get_conn() as conn:
                chunk_rows = conn.execute(
                    f"""
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
                        WHERE {DOCUMENT_ACCESS_CLAUSE}
                    ) sub
                    WHERE sub.score >= %s
                    ORDER BY sub.score DESC
                    LIMIT 10
                    """,
                    (query_embedding, *access_params(user_id), MIN_SIMILARITY_THRESHOLD),
                ).fetchall()
```

- [ ] **Step 5: Wire the access clause into `search.py`**

```python
# backend/app/routers/search.py — add import at top
from app.services.access import DOCUMENT_ACCESS_CLAUSE, access_params
```

```python
# backend/app/routers/search.py — inside search(), replace the two initializer lines
    filters_sql = DOCUMENT_ACCESS_CLAUSE
    filter_params: list = list(access_params(user_id))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_chat.py tests/test_search.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite for regressions**

Run: `cd backend && python -m pytest -q`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/chat.py backend/app/routers/search.py backend/tests/test_chat.py backend/tests/test_search.py
git commit -m "feat: include team-shared documents in chat retrieval and search"
```

---

## Task 8: README updates

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add the migration to the schema list**

```markdown
# README.md — inside "### Database schema" list, append
- `0006_teams.sql` — `profiles` (auth.users email mirror, auto-populated by trigger), `teams`,
  `team_members`, `document_shares`, `quiz_shares`
```

- [ ] **Step 2: Add the new endpoints to the API overview table**

```markdown
# README.md — inside the API overview table, append rows
| POST | `/documents/{id}/share` | Share a document with one of the caller's teams |
| DELETE | `/documents/{id}/share/{team_id}` | Unshare a document from a team |
| GET | `/documents/shared` | List documents shared with any team the caller belongs to |
| POST | `/quiz/{quiz_id}/share` | Share a quiz with one of the caller's teams |
| DELETE | `/quiz/{quiz_id}/share/{team_id}` | Unshare a quiz from a team |
| GET | `/quiz/shared` | List quizzes shared with any team the caller belongs to |
| POST | `/teams` | Create a team (caller becomes admin) |
| GET | `/teams` | List teams the caller belongs to |
| GET | `/teams/{id}/members` | List a team's members |
| GET | `/teams/{id}/members/search?q=` | Admin-only: search existing users by email |
| POST | `/teams/{id}/members` | Admin-only: add an existing user to the team |
| DELETE | `/teams/{id}/members/{user_id}` | Admin-only: remove a member |
```

- [ ] **Step 3: Add the new router/page to the project layout tree**

```markdown
# README.md — inside "## Project layout", update the routers and pages lines
    routers/       # documents, search, chat, quiz, teams — one file per feature
```

```markdown
    pages/           # one page per feature (Documents, Search, Chat, Quiz, QuizHistory, Teams, Login, Signup)
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document team sharing endpoints and schema"
```

---

## Task 9: Frontend API client and query keys

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/queryKeys.ts`
- Modify: `frontend/tests/lib/api.test.ts`

**Interfaces:**
- Produces: types `Team`, `TeamMember`, `UserSearchResult`, `SharedQuiz`; functions `createTeam`, `listTeams`, `listTeamMembers`, `searchTeamMembers`, `addTeamMember`, `removeTeamMember`, `shareDocument`, `unshareDocument`, `listSharedDocuments`, `shareQuiz`, `unshareQuiz`, `listSharedQuizzes`. `DocumentListItem` and `QuizAttemptSummary` gain `shared_team_ids: string[]`. `queryKeys` gains `teams`, `teamMembers(teamId)`, `sharedDocuments`, `sharedQuizzes`.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/tests/lib/api.test.ts — append to the existing import list
import {
  addTeamMember,
  createTeam,
  listSharedDocuments,
  listSharedQuizzes,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  searchTeamMembers,
  shareDocument,
  shareQuiz,
  unshareDocument,
  unshareQuiz,
} from '../../src/lib/api'
```

```typescript
// frontend/tests/lib/api.test.ts — append to the describe block
it('createTeam sends a POST with the team name', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({
    ok: true,
    json: async () => ({ id: 't1', name: 'Eng', role: 'admin', created_at: '2026-01-01T00:00:00Z' }),
  })

  await createTeam('Eng')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/teams'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Eng' }) }),
  )
})

it('listTeams sends an authorized GET request', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => [] })

  await listTeams()

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/teams'),
    expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
  )
})

it('listTeamMembers sends a GET to the team members endpoint', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => [] })

  await listTeamMembers('t1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/teams/t1/members'),
    expect.anything(),
  )
})

it('searchTeamMembers sends a GET with the query string', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => [] })

  await searchTeamMembers('t1', 'ann')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/teams/t1/members/search?q=ann'),
    expect.anything(),
  )
})

it('addTeamMember sends a POST with the user id', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({
    ok: true,
    json: async () => ({ user_id: 'u1', email: 'a@example.com', role: 'member', added_at: '2026-01-01T00:00:00Z' }),
  })

  await addTeamMember('t1', 'u1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/teams/t1/members'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ user_id: 'u1' }) }),
  )
})

it('removeTeamMember sends a DELETE request', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

  await removeTeamMember('t1', 'u1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/teams/t1/members/u1'),
    expect.objectContaining({ method: 'DELETE' }),
  )
})

it('shareDocument sends a POST with the team id', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

  await shareDocument('d1', 't1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/documents/d1/share'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ team_id: 't1' }) }),
  )
})

it('unshareDocument sends a DELETE request', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

  await unshareDocument('d1', 't1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/documents/d1/share/t1'),
    expect.objectContaining({ method: 'DELETE' }),
  )
})

it('listSharedDocuments sends a GET to /documents/shared', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => [] })

  await listSharedDocuments()

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/documents/shared'),
    expect.anything(),
  )
})

it('shareQuiz sends a POST with the team id', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

  await shareQuiz('q1', 't1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/quiz/q1/share'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ team_id: 't1' }) }),
  )
})

it('unshareQuiz sends a DELETE request', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })

  await unshareQuiz('q1', 't1')

  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/quiz/q1/share/t1'),
    expect.objectContaining({ method: 'DELETE' }),
  )
})

it('listSharedQuizzes sends a GET to /quiz/shared and unwraps quizzes', async () => {
  ;(globalThis.fetch as any).mockResolvedValue({
    ok: true,
    json: async () => ({ quizzes: [{ id: 'q1', document_ids: [], created_at: '2026-01-01T00:00:00Z' }] }),
  })

  const result = await listSharedQuizzes()

  expect(result).toEqual([{ id: 'q1', document_ids: [], created_at: '2026-01-01T00:00:00Z' }])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/lib/api.test.ts`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Add the types and functions**

```typescript
// frontend/src/lib/api.ts — update Document/DocumentListItem and QuizAttemptSummary types
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

// The list endpoint omits extracted_text and storage_path (not used by the list UI) to
// avoid shipping every document's full extracted text on every list call.
export type DocumentListItem = Omit<Document, 'extracted_text' | 'storage_path'> & {
  shared_team_ids: string[]
}
```

```typescript
// frontend/src/lib/api.ts — update QuizAttemptSummary
export type QuizAttemptSummary = {
  id: string
  quiz_id: string
  score: number
  total_questions: number
  completed_at: string
  document_filenames: string[]
  shared_team_ids: string[]
}
```

```typescript
// frontend/src/lib/api.ts — append at the end of the file
export type Team = {
  id: string
  name: string
  role: 'admin' | 'member'
  created_at: string
}

export async function createTeam(name: string): Promise<Team> {
  const res = await apiFetch(`${API_BASE}/teams`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create team')
  return res.json()
}

export async function listTeams(): Promise<Team[]> {
  const res = await apiFetch(`${API_BASE}/teams`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list teams')
  return res.json()
}

export type TeamMember = {
  user_id: string
  email: string
  role: 'admin' | 'member'
  added_at: string
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const res = await apiFetch(`${API_BASE}/teams/${teamId}/members`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list team members')
  return res.json()
}

export type UserSearchResult = { user_id: string; email: string }

export async function searchTeamMembers(teamId: string, query: string): Promise<UserSearchResult[]> {
  const res = await apiFetch(
    `${API_BASE}/teams/${teamId}/members/search?q=${encodeURIComponent(query)}`,
    { headers: await authHeader() },
  )
  if (!res.ok) throw new Error('Failed to search users')
  return res.json()
}

export async function addTeamMember(teamId: string, userId: string): Promise<TeamMember> {
  const res = await apiFetch(`${API_BASE}/teams/${teamId}/members`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  })
  if (!res.ok) throw new Error('Failed to add team member')
  return res.json()
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to remove team member')
}

export async function shareDocument(documentId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/documents/${documentId}/share`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId }),
  })
  if (!res.ok) throw new Error('Failed to share document')
}

export async function unshareDocument(documentId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/documents/${documentId}/share/${teamId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to unshare document')
}

export async function listSharedDocuments(): Promise<DocumentListItem[]> {
  const res = await apiFetch(`${API_BASE}/documents/shared`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list shared documents')
  return res.json()
}

export async function shareQuiz(quizId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}/share`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: teamId }),
  })
  if (!res.ok) throw new Error('Failed to share quiz')
}

export async function unshareQuiz(quizId: string, teamId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/quiz/${quizId}/share/${teamId}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('Failed to unshare quiz')
}

export type SharedQuiz = { id: string; document_ids: string[]; created_at: string }

export async function listSharedQuizzes(): Promise<SharedQuiz[]> {
  const res = await apiFetch(`${API_BASE}/quiz/shared`, { headers: await authHeader() })
  if (!res.ok) throw new Error('Failed to list shared quizzes')
  const data = await res.json()
  return data.quizzes
}
```

- [ ] **Step 4: Add the new query keys**

```typescript
// frontend/src/lib/queryKeys.ts — full replacement
export const queryKeys = {
  documents: ['documents'] as const,
  sharedDocuments: ['sharedDocuments'] as const,
  chatSession: ['chatSession'] as const,
  quizAttempts: ['quizAttempts'] as const,
  quiz: (quizId: string) => ['quiz', quizId] as const,
  teams: ['teams'] as const,
  teamMembers: (teamId: string) => ['teamMembers', teamId] as const,
  sharedQuizzes: ['sharedQuizzes'] as const,
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/queryKeys.ts frontend/tests/lib/api.test.ts
git commit -m "feat: add team and sharing API client functions"
```

---

## Task 10: i18n — `teams` namespace and nav strings

**Files:**
- Create: `frontend/src/i18n/locales/en/teams.json`
- Create: `frontend/src/i18n/locales/vi/teams.json`
- Modify: `frontend/src/i18n/index.ts`
- Modify: `frontend/src/i18n/locales/en/common.json`
- Modify: `frontend/src/i18n/locales/vi/common.json`
- Modify: `frontend/src/i18n/locales/en/documents.json`
- Modify: `frontend/src/i18n/locales/vi/documents.json`
- Modify: `frontend/src/i18n/locales/en/quiz.json`
- Modify: `frontend/src/i18n/locales/vi/quiz.json`
- Modify: `frontend/tests/i18n.test.ts`

**Interfaces:** none (data files consumed by react-i18next; namespace `teams` registered in `i18n/index.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/i18n.test.ts — append to the describe block
it('has a teams namespace with matching English and Vietnamese keys', () => {
  expect(i18n.getFixedT('vi', 'teams')('createTeam')).toBe('Tạo nhóm')
  expect(i18n.getFixedT('en', 'teams')('createTeam')).toBe('Create team')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/i18n.test.ts`
Expected: FAIL — `teams` namespace not registered.

- [ ] **Step 3: Create the locale files**

```json
// frontend/src/i18n/locales/en/teams.json
{
  "createPlaceholder": "New team name",
  "createTeam": "Create team",
  "searchPlaceholder": "Search by email…",
  "addMember": "Add",
  "removeMember": "Remove",
  "roles": { "admin": "Admin", "member": "Member" },
  "errors": {
    "loadTeams": "Failed to load teams, try again"
  }
}
```

```json
// frontend/src/i18n/locales/vi/teams.json
{
  "createPlaceholder": "Tên nhóm mới",
  "createTeam": "Tạo nhóm",
  "searchPlaceholder": "Tìm theo email…",
  "addMember": "Thêm",
  "removeMember": "Xoá",
  "roles": { "admin": "Quản trị viên", "member": "Thành viên" },
  "errors": {
    "loadTeams": "Tải danh sách nhóm thất bại, vui lòng thử lại"
  }
}
```

- [ ] **Step 4: Register the namespace**

```typescript
// frontend/src/i18n/index.ts — full replacement
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import authEn from './locales/en/auth.json'
import chatEn from './locales/en/chat.json'
import commonEn from './locales/en/common.json'
import documentsEn from './locales/en/documents.json'
import quizEn from './locales/en/quiz.json'
import searchEn from './locales/en/search.json'
import teamsEn from './locales/en/teams.json'
import authVi from './locales/vi/auth.json'
import chatVi from './locales/vi/chat.json'
import commonVi from './locales/vi/common.json'
import documentsVi from './locales/vi/documents.json'
import quizVi from './locales/vi/quiz.json'
import searchVi from './locales/vi/search.json'
import teamsVi from './locales/vi/teams.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      vi: {
        common: commonVi,
        auth: authVi,
        documents: documentsVi,
        search: searchVi,
        chat: chatVi,
        quiz: quizVi,
        teams: teamsVi,
      },
      en: {
        common: commonEn,
        auth: authEn,
        documents: documentsEn,
        search: searchEn,
        chat: chatEn,
        quiz: quizEn,
        teams: teamsEn,
      },
    },
    fallbackLng: 'vi',
    defaultNS: 'common',
    ns: ['common', 'auth', 'documents', 'search', 'chat', 'quiz', 'teams'],
    detection: { order: ['localStorage'], caches: ['localStorage'] },
    interpolation: { escapeValue: false },
  })

export default i18n
```

- [ ] **Step 5: Add nav/page strings, share strings, and tab strings to existing namespaces**

```json
// frontend/src/i18n/locales/en/common.json — inside "nav", add
"teams": "Teams"
```

```json
// frontend/src/i18n/locales/en/common.json — inside "pageInfo", add
"teams": { "title": "Teams", "subtitle": "Manage your teams and members" }
```

```json
// frontend/src/i18n/locales/en/common.json — top level, add
"share": { "title": "Share to team", "close": "Close" }
```

```json
// frontend/src/i18n/locales/vi/common.json — inside "nav", add
"teams": "Nhóm"
```

```json
// frontend/src/i18n/locales/vi/common.json — inside "pageInfo", add
"teams": { "title": "Nhóm", "subtitle": "Quản lý nhóm và thành viên của bạn" }
```

```json
// frontend/src/i18n/locales/vi/common.json — top level, add
"share": { "title": "Chia sẻ với nhóm", "close": "Đóng" }
```

```json
// frontend/src/i18n/locales/en/documents.json — top level, add
"share": "Share",
"tabs": { "mine": "My Documents", "shared": "Shared with me" }
```

```json
// frontend/src/i18n/locales/vi/documents.json — top level, add
"share": "Chia sẻ",
"tabs": { "mine": "Tài liệu của tôi", "shared": "Được chia sẻ" }
```

```json
// frontend/src/i18n/locales/en/quiz.json — top level, add
"share": "Share",
"tabs": { "mine": "My Attempts", "shared": "Shared with me" },
"takeSharedQuiz": "Take quiz"
```

```json
// frontend/src/i18n/locales/vi/quiz.json — top level, add
"share": "Chia sẻ",
"tabs": { "mine": "Lượt làm của tôi", "shared": "Được chia sẻ" },
"takeSharedQuiz": "Làm bài"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/i18n.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/i18n frontend/tests/i18n.test.ts
git commit -m "feat: add teams i18n namespace and sharing strings"
```

---

## Task 11: `TeamsPage` and navigation

**Files:**
- Create: `frontend/src/pages/TeamsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppNav.tsx`
- Test: `frontend/tests/pages/TeamsPage.test.tsx`
- Test: `frontend/tests/components/AppNav.test.tsx` (extend)

**Interfaces:**
- Consumes: `Team`, `TeamMember`, `createTeam`, `listTeams`, `listTeamMembers`, `searchTeamMembers`, `addTeamMember`, `removeTeamMember` from `lib/api` (Task 9); `queryKeys.teams`, `queryKeys.teamMembers` (Task 9).
- Produces: `TeamsPage` component, route `/teams`.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/pages/TeamsPage.test.tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listTeams: vi.fn(),
  createTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  searchTeamMembers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
}))

import {
  addTeamMember,
  createTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  searchTeamMembers,
} from '../../src/lib/api'
import { TeamsPage } from '../../src/pages/TeamsPage'

const adminTeam = { id: 't1', name: 'Engineering', role: 'admin' as const, created_at: '2026-01-01T00:00:00Z' }
const memberTeam = { id: 't2', name: 'Design', role: 'member' as const, created_at: '2026-01-01T00:00:00Z' }

describe('TeamsPage', () => {
  it('renders the list of teams', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam])

    renderWithQueryClient(<TeamsPage />)

    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument()
    })
  })

  it('creates a team and refreshes the list', async () => {
    ;(listTeams as any).mockResolvedValue([])
    ;(createTeam as any).mockResolvedValue(adminTeam)

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('Tên nhóm mới'), { target: { value: 'Engineering' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tạo nhóm' }))

    await waitFor(() => {
      expect(createTeam).toHaveBeenCalledWith('Engineering')
    })
    await waitFor(() => {
      expect(listTeams).toHaveBeenCalledTimes(2)
    })
  })

  it('shows the member search box only for an admin, and lists members on selection', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam, memberTeam])
    ;(listTeamMembers as any).mockResolvedValue([
      { user_id: 'u1', email: 'admin@example.com', role: 'admin', added_at: '2026-01-01T00:00:00Z' },
    ])
    ;(searchTeamMembers as any).mockResolvedValue([])

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => screen.getByText('Engineering'))

    fireEvent.click(screen.getByText('Engineering'))
    await waitFor(() => {
      expect(screen.getByText('admin@example.com', { exact: false })).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('Tìm theo email…')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Design'))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Tìm theo email…')).not.toBeInTheDocument()
    })
  })

  it('adds a member found via search', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam])
    ;(listTeamMembers as any).mockResolvedValue([])
    ;(searchTeamMembers as any).mockResolvedValue([{ user_id: 'u2', email: 'colleague@example.com' }])
    ;(addTeamMember as any).mockResolvedValue({
      user_id: 'u2',
      email: 'colleague@example.com',
      role: 'member',
      added_at: '2026-01-01T00:00:00Z',
    })

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => screen.getByText('Engineering'))
    fireEvent.click(screen.getByText('Engineering'))

    fireEvent.change(screen.getByPlaceholderText('Tìm theo email…'), { target: { value: 'colleague' } })
    await waitFor(() => screen.getByText('colleague@example.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }))

    await waitFor(() => {
      expect(addTeamMember).toHaveBeenCalledWith('t1', 'u2')
    })
  })

  it('removes a member as admin', async () => {
    ;(listTeams as any).mockResolvedValue([adminTeam])
    ;(listTeamMembers as any).mockResolvedValue([
      { user_id: 'u1', email: 'admin@example.com', role: 'admin', added_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u2', email: 'colleague@example.com', role: 'member', added_at: '2026-01-01T00:00:00Z' },
    ])
    ;(removeTeamMember as any).mockResolvedValue(undefined)

    renderWithQueryClient(<TeamsPage />)
    await waitFor(() => screen.getByText('Engineering'))
    fireEvent.click(screen.getByText('Engineering'))
    await waitFor(() => screen.getByText('colleague@example.com'))

    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }))

    await waitFor(() => {
      expect(removeTeamMember).toHaveBeenCalledWith('t1', 'u2')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/pages/TeamsPage.test.tsx`
Expected: FAIL — `TeamsPage` module doesn't exist.

- [ ] **Step 3: Implement `TeamsPage`**

```tsx
// frontend/src/pages/TeamsPage.tsx
import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import {
  Team,
  addTeamMember,
  createTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  searchTeamMembers,
} from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function TeamsPage() {
  const { t } = useTranslation('teams')
  const [name, setName] = useState('')
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()

  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: listTeams })
  const teams = teamsQuery.data ?? []

  const membersQuery = useQuery({
    queryKey: queryKeys.teamMembers(selectedTeam?.id ?? ''),
    queryFn: () => listTeamMembers(selectedTeam!.id),
    enabled: !!selectedTeam,
  })
  const members = membersQuery.data ?? []

  const searchQuery = useQuery({
    queryKey: ['memberSearch', selectedTeam?.id, search],
    queryFn: () => searchTeamMembers(selectedTeam!.id, search),
    enabled: !!selectedTeam && search.trim().length > 0,
  })
  const searchResults = searchQuery.data ?? []

  const createMutation = useMutation({
    mutationFn: (teamName: string) => createTeam(teamName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teams })
      setName('')
    },
  })

  const addMutation = useMutation({
    mutationFn: (userId: string) => addTeamMember(selectedTeam!.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(selectedTeam!.id) })
      setSearch('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeTeamMember(selectedTeam!.id, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.teamMembers(selectedTeam!.id) }),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    createMutation.mutate(name)
  }

  return (
    <div className="px-8 pb-12 pt-7">
      {teamsQuery.isError && <Alert>{t('errors.loadTeams')}</Alert>}

      <form onSubmit={handleCreate} className="mb-6 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('createPlaceholder')} />
        <Button type="submit" disabled={createMutation.isPending}>
          {t('createTeam')}
        </Button>
      </form>

      <div className="flex gap-6">
        <div className="flex flex-col gap-2.5">
          {teams.map((team) => (
            <Card key={team.id} onClick={() => setSelectedTeam(team)} className="cursor-pointer">
              <div className="font-bold">{team.name}</div>
              <div className="text-xs text-muted">{t(`roles.${team.role}`)}</div>
            </Card>
          ))}
        </div>

        {selectedTeam && (
          <div className="flex-1">
            <h2 className="mb-3 text-lg font-bold">{selectedTeam.name}</h2>

            {selectedTeam.role === 'admin' && (
              <div className="mb-4">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                />
                {searchResults.map((result) => (
                  <div key={result.user_id} className="mt-2 flex items-center justify-between">
                    <span>{result.email}</span>
                    <Button variant="secondary" onClick={() => addMutation.mutate(result.user_id)}>
                      {t('addMember')}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center justify-between">
                  <span>
                    {member.email} — {t(`roles.${member.role}`)}
                  </span>
                  {selectedTeam.role === 'admin' && member.role !== 'admin' && (
                    <Button variant="danger" onClick={() => removeMutation.mutate(member.user_id)}>
                      {t('removeMember')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire the route**

```tsx
// frontend/src/App.tsx — add import
import { TeamsPage } from './pages/TeamsPage'
```

```tsx
// frontend/src/App.tsx — add route, alongside the other <Route> entries
        <Route
          path="/teams"
          element={
            <ProtectedRoute>
              <AppShell>
                <TeamsPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
```

- [ ] **Step 5: Add the nav entry**

```tsx
// frontend/src/components/AppNav.tsx — replace LINK_PATHS and LINK_INFO
const LINK_PATHS = ['/documents', '/search', '/chat', '/quiz', '/quiz/history', '/teams'] as const

const LINK_INFO: Record<(typeof LINK_PATHS)[number], { labelKey: string; badge: boolean }> = {
  '/documents': { labelKey: 'nav.documents', badge: true },
  '/search': { labelKey: 'nav.search', badge: false },
  '/chat': { labelKey: 'nav.chat', badge: false },
  '/quiz': { labelKey: 'nav.quiz', badge: false },
  '/quiz/history': { labelKey: 'nav.quizHistory', badge: false },
  '/teams': { labelKey: 'nav.teams', badge: false },
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/TeamsPage.test.tsx tests/components/AppNav.test.tsx tests/App.test.tsx`
Expected: PASS — check `AppNav.test.tsx` for an existing assertion enumerating all nav links; if present, extend it to include `Nhóm` (see Step 7).

- [ ] **Step 7: Extend `AppNav.test.tsx` if it asserts a fixed link list**

Read `frontend/tests/components/AppNav.test.tsx` first. If a test asserts the exact set/count of rendered nav links, add `'Nhóm'` to the expected list so it doesn't break.

- [ ] **Step 8: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/TeamsPage.tsx frontend/src/App.tsx frontend/src/components/AppNav.tsx frontend/tests/pages/TeamsPage.test.tsx frontend/tests/components/AppNav.test.tsx
git commit -m "feat: add Teams page and navigation entry"
```

---

## Task 12: `ShareTeamsModal` component

**Files:**
- Create: `frontend/src/components/ShareTeamsModal.tsx`
- Test: `frontend/tests/components/ShareTeamsModal.test.tsx`

**Interfaces:**
- Consumes: `listTeams` from `lib/api`, `queryKeys.teams`.
- Produces: `ShareTeamsModal({ sharedTeamIds: string[], onShare: (teamId: string) => void, onUnshare: (teamId: string) => void, onClose: () => void })`, consumed by Tasks 13 and 14.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/components/ShareTeamsModal.test.tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listTeams: vi.fn(),
}))

import { listTeams } from '../../src/lib/api'
import { ShareTeamsModal } from '../../src/components/ShareTeamsModal'

describe('ShareTeamsModal', () => {
  it('shows a checked checkbox for already-shared teams and unchecked for others', async () => {
    ;(listTeams as any).mockResolvedValue([
      { id: 't1', name: 'Engineering', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { id: 't2', name: 'Design', role: 'member', created_at: '2026-01-01T00:00:00Z' },
    ])

    renderWithQueryClient(
      <ShareTeamsModal sharedTeamIds={['t1']} onShare={vi.fn()} onUnshare={vi.fn()} onClose={vi.fn()} />,
    )

    await waitFor(() => screen.getByText('Engineering'))
    expect(screen.getByLabelText('Engineering')).toBeChecked()
    expect(screen.getByLabelText('Design')).not.toBeChecked()
  })

  it('calls onShare when an unchecked team is clicked, onUnshare when a checked one is', async () => {
    ;(listTeams as any).mockResolvedValue([
      { id: 't1', name: 'Engineering', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { id: 't2', name: 'Design', role: 'member', created_at: '2026-01-01T00:00:00Z' },
    ])
    const onShare = vi.fn()
    const onUnshare = vi.fn()

    renderWithQueryClient(
      <ShareTeamsModal sharedTeamIds={['t1']} onShare={onShare} onUnshare={onUnshare} onClose={vi.fn()} />,
    )
    await waitFor(() => screen.getByText('Engineering'))

    fireEvent.click(screen.getByLabelText('Design'))
    expect(onShare).toHaveBeenCalledWith('t2')

    fireEvent.click(screen.getByLabelText('Engineering'))
    expect(onUnshare).toHaveBeenCalledWith('t1')
  })

  it('calls onClose when the close button is clicked', async () => {
    ;(listTeams as any).mockResolvedValue([])
    const onClose = vi.fn()

    renderWithQueryClient(
      <ShareTeamsModal sharedTeamIds={[]} onShare={vi.fn()} onUnshare={vi.fn()} onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/components/ShareTeamsModal.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/ShareTeamsModal.tsx
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { listTeams } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type ShareTeamsModalProps = {
  sharedTeamIds: string[]
  onShare: (teamId: string) => void
  onUnshare: (teamId: string) => void
  onClose: () => void
}

export function ShareTeamsModal({ sharedTeamIds, onShare, onUnshare, onClose }: ShareTeamsModalProps) {
  const { t } = useTranslation('common')
  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: listTeams })
  const teams = teamsQuery.data ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card className="w-[360px]">
        <h3 className="mb-3 text-base font-bold">{t('share.title')}</h3>
        <div className="flex flex-col gap-2">
          {teams.map((team) => {
            const isShared = sharedTeamIds.includes(team.id)
            return (
              <label key={team.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={team.name}
                  checked={isShared}
                  onChange={() => (isShared ? onUnshare(team.id) : onShare(team.id))}
                />
                {team.name}
              </label>
            )
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('share.close')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/components/ShareTeamsModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ShareTeamsModal.tsx frontend/tests/components/ShareTeamsModal.test.tsx
git commit -m "feat: add reusable ShareTeamsModal component"
```

---

## Task 13: `DocumentsPage` — Share button and "Shared with me" tab

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Modify: `frontend/tests/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `ShareTeamsModal` (Task 12), `shareDocument`, `unshareDocument`, `listSharedDocuments`, `queryKeys.sharedDocuments` (Task 9).

- [ ] **Step 1: Update the existing test file's mock and fixture, then write the failing tests**

```typescript
// frontend/tests/pages/DocumentsPage.test.tsx — replace the vi.mock call and import list
vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDownloadUrl: vi.fn(),
  shareDocument: vi.fn(),
  unshareDocument: vi.fn(),
  listSharedDocuments: vi.fn(),
}))

import {
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  listSharedDocuments,
  renameDocument,
  shareDocument,
  uploadDocument,
} from '../../src/lib/api'
import { DocumentsPage } from '../../src/pages/DocumentsPage'

const readyDoc = {
  id: '1',
  filename: 'report.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  uploaded_at: '2026-01-01T00:00:00Z',
  shared_team_ids: [] as string[],
}
```

> Every other `mockResolvedValue` object literal for a document in this file (e.g. in the upload/rename/drag tests) also needs `shared_team_ids: []` added for type consistency — add it alongside their existing `status`/`uploaded_at` fields.

```typescript
// frontend/tests/pages/DocumentsPage.test.tsx — append to the describe block
it('opens the share modal and shares a document with a team', async () => {
  ;(listDocuments as any).mockResolvedValue([readyDoc])
  ;(shareDocument as any).mockResolvedValue(undefined)

  renderWithQueryClient(<DocumentsPage />)
  await waitFor(() => screen.getByText('report.pdf'))

  fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }))

  await waitFor(() => {
    expect(screen.getByText('Chia sẻ với nhóm')).toBeInTheDocument()
  })
})

it('shows the Shared with me tab with shared documents', async () => {
  ;(listDocuments as any).mockResolvedValue([readyDoc])
  ;(listSharedDocuments as any).mockResolvedValue([
    { ...readyDoc, id: '2', filename: 'shared.pdf', user_id: 'other-user' },
  ])

  renderWithQueryClient(<DocumentsPage />)
  await waitFor(() => screen.getByText('report.pdf'))

  fireEvent.click(screen.getByText('Được chia sẻ'))

  await waitFor(() => {
    expect(screen.getByText('shared.pdf')).toBeInTheDocument()
  })
  expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/pages/DocumentsPage.test.tsx`
Expected: FAIL — no Share button, no tabs.

- [ ] **Step 3: Replace `DocumentsPage.tsx` in full**

This adds the `view` tab state, the shared-documents query, share/unshare mutations, the tab bar, a read-only shared-items grid, and a Share button — everything else (upload dropzone, drag/drop, filters, rename/delete) is unchanged from the current file.

```tsx
// frontend/src/pages/DocumentsPage.tsx — full replacement
import { ChangeEvent, DragEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import {
  DocumentListItem,
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  listSharedDocuments,
  renameDocument,
  shareDocument,
  unshareDocument,
  uploadDocument,
} from '../lib/api'
import { PreviewModal } from '../components/PreviewModal'
import { ShareTeamsModal } from '../components/ShareTeamsModal'
import { queryKeys } from '../lib/queryKeys'

const STATUS_VARIANT = {
  uploading: 'gray',
  processing: 'blue',
  ready: 'green',
  failed: 'red',
} as const

const FILTERS = [
  { id: 'all', labelKey: 'filters.all' },
  { id: 'pdf', labelKey: 'filters.pdf' },
  { id: 'docx', labelKey: 'filters.docx' },
  { id: 'other', labelKey: 'filters.other' },
] as const

function matchesFilter(fileType: string, filter: (typeof FILTERS)[number]['id']) {
  if (filter === 'all') return true
  if (filter === 'pdf') return fileType === 'pdf'
  if (filter === 'docx') return fileType === 'docx'
  return fileType !== 'pdf' && fileType !== 'docx'
}

export function DocumentsPage() {
  const { t } = useTranslation('documents')
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DocumentListItem | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [view, setView] = useState<'mine' | 'shared'>('mine')
  const [sharingDoc, setSharingDoc] = useState<DocumentListItem | null>(null)
  const queryClient = useQueryClient()

  const documentsQuery = useQuery({
    queryKey: queryKeys.documents,
    queryFn: listDocuments,
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'uploading' || d.status === 'processing')
        ? 3000
        : false,
  })
  const documents = documentsQuery.data ?? []
  const filtered = useMemo(
    () => documents.filter((d) => matchesFilter(d.file_type, filter)),
    [documents, filter],
  )

  const sharedDocumentsQuery = useQuery({
    queryKey: queryKeys.sharedDocuments,
    queryFn: listSharedDocuments,
    enabled: view === 'shared',
  })
  const sharedDocuments = sharedDocumentsQuery.data ?? []

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError(t('errors.upload')),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      renameDocument(id, filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError(t('errors.rename')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError(t('errors.delete')),
  })

  const shareMutation = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string }) => shareDocument(id, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  })

  const unshareMutation = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string }) => unshareDocument(id, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  })

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    event.target.value = ''
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingOver(true)
  }

  function handleDragLeave() {
    setIsDraggingOver(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
  }

  function handleRename(doc: DocumentListItem) {
    const newName = window.prompt(t('renamePromptLabel'), doc.filename)
    if (!newName) return
    renameMutation.mutate({ id: doc.id, filename: newName })
  }

  function handleDelete(doc: DocumentListItem) {
    if (!window.confirm(t('deleteConfirm', { filename: doc.filename }))) return
    deleteMutation.mutate(doc.id)
  }

  async function handleDownload(doc: DocumentListItem) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError(t('errors.download'))
    }
  }

  const displayError = documentsQuery.isError ? t('errors.load') : error

  return (
    <div className="px-8 pb-12 pt-7">
      {displayError && (
        <div className="mb-5">
          <Alert>{displayError}</Alert>
        </div>
      )}

      <div className="mb-5 flex w-fit gap-1 rounded-[10px] border border-line bg-white p-1">
        <button
          onClick={() => setView('mine')}
          className={
            view === 'mine'
              ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('tabs.mine')}
        </button>
        <button
          onClick={() => setView('shared')}
          className={
            view === 'shared'
              ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('tabs.shared')}
        </button>
      </div>

      {view === 'shared' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {sharedDocuments.map((doc) => (
            <Card key={doc.id} className="flex flex-col gap-3.5">
              <div className="line-clamp-2 text-[14.5px] font-bold leading-tight">{doc.filename}</div>
              <div className="flex flex-wrap gap-1.5 border-t border-[#EEF2F3] pt-3">
                {doc.status === 'ready' && (
                  <>
                    <Button variant="secondary" onClick={() => setPreviewing(doc)}>
                      {t('preview')}
                    </Button>
                    <Button variant="secondary" onClick={() => handleDownload(doc)}>
                      {t('download')}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={
              isDraggingOver
                ? 'mb-6 rounded-[14px] border-2 border-accent bg-accent/5 p-4'
                : 'mb-6 rounded-[14px] border-2 border-dashed border-line p-4'
            }
          >
            <label
              htmlFor="upload-input"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('uploadLabel')}
            </label>
            <p className="mb-2 text-sm text-muted">{t('dragHint')}</p>
            <input
              id="upload-input"
              type="file"
              onChange={handleUpload}
              className="block font-sans text-sm text-ink file:mr-4 file:rounded-[10px] file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-accent-hover hover:file:bg-app-bg"
            />
          </div>

          {documents.length === 0 && !documentsQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[22px] bg-ok-bg">
                <span className="text-4xl">📄</span>
              </div>
              <h2 className="mb-2 text-xl font-extrabold tracking-tight">{t('emptyTitle')}</h2>
              <p className="mb-6 max-w-[400px] text-[15px] leading-relaxed text-muted">
                {t('emptyBody')}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center gap-3">
                <div className="flex gap-1 rounded-[10px] border border-line bg-white p-1">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFilter(f.id)}
                      className={
                        filter === f.id
                          ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                          : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
                      }
                    >
                      {t(f.labelKey)}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                <span className="text-sm text-muted">{t('documentCount', { count: documents.length })}</span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                {filtered.map((doc) => (
                  <Card key={doc.id} className="flex flex-col gap-3.5 animate-fade-up">
                    <div className="flex gap-3">
                      <div className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[11px] bg-app-bg">
                        <span className="font-mono text-[11px] font-bold text-muted">
                          {doc.file_type.toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-[14.5px] font-bold leading-tight">
                          {doc.filename}
                        </div>
                        <div className="mt-1 text-xs text-faint">
                          {t('uploadedOn', { date: new Date(doc.uploaded_at).toLocaleDateString() })}
                        </div>
                      </div>
                    </div>
                    <div>
                      <Badge variant={STATUS_VARIANT[doc.status]}>{t(`status.${doc.status}`)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 border-t border-[#EEF2F3] pt-3">
                      {doc.status === 'ready' && (
                        <>
                          <Button variant="secondary" onClick={() => setPreviewing(doc)}>
                            {t('preview')}
                          </Button>
                          <Button variant="secondary" onClick={() => handleDownload(doc)}>
                            {t('download')}
                          </Button>
                        </>
                      )}
                      <Button variant="secondary" onClick={() => handleRename(doc)}>
                        {t('rename')}
                      </Button>
                      <Button variant="secondary" onClick={() => setSharingDoc(doc)}>
                        {t('share')}
                      </Button>
                      <Button variant="danger" onClick={() => handleDelete(doc)}>
                        {t('delete')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
      {sharingDoc && (
        <ShareTeamsModal
          sharedTeamIds={sharingDoc.shared_team_ids}
          onShare={(teamId) => shareMutation.mutate({ id: sharingDoc.id, teamId })}
          onUnshare={(teamId) => unshareMutation.mutate({ id: sharingDoc.id, teamId })}
          onClose={() => setSharingDoc(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/DocumentsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/tests/pages/DocumentsPage.test.tsx
git commit -m "feat: add document sharing UI (Share button + Shared with me tab)"
```

---

## Task 14: `QuizHistoryPage` — Share button and "Shared with me" tab

**Files:**
- Modify: `frontend/src/pages/QuizHistoryPage.tsx`
- Modify: `frontend/tests/pages/QuizHistoryPage.test.tsx`

**Interfaces:**
- Consumes: `ShareTeamsModal` (Task 12), `shareQuiz`, `unshareQuiz`, `listSharedQuizzes`, `queryKeys.sharedQuizzes` (Task 9).

- [ ] **Step 1: Update the existing test file's mock, then write the failing tests**

```typescript
// frontend/tests/pages/QuizHistoryPage.test.tsx — replace the vi.mock call and import list
vi.mock('../../src/lib/api', () => ({
  listQuizAttempts: vi.fn(),
  shareQuiz: vi.fn(),
  unshareQuiz: vi.fn(),
  listSharedQuizzes: vi.fn(),
}))

import { listQuizAttempts, listSharedQuizzes, shareQuiz } from '../../src/lib/api'
import { QuizHistoryPage } from '../../src/pages/QuizHistoryPage'
```

> Every existing `listQuizAttempts` mock resolution in this file (the four `it` blocks already present) needs `shared_team_ids: []` added to each attempt object literal, alongside `document_filenames`.

```typescript
// frontend/tests/pages/QuizHistoryPage.test.tsx — append to the describe block
it('opens the share modal for an attempt', async () => {
  ;(listQuizAttempts as any).mockResolvedValue([
    {
      id: 'attempt-1',
      quiz_id: 'quiz-1',
      score: 7,
      total_questions: 10,
      completed_at: '2026-07-18T12:05:00Z',
      document_filenames: ['policy.pdf'],
      shared_team_ids: [],
    },
  ])

  renderQuizHistoryPage()
  await waitFor(() => screen.getByRole('button', { name: 'Chia sẻ' }))
  fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }))

  await waitFor(() => {
    expect(screen.getByText('Chia sẻ với nhóm')).toBeInTheDocument()
  })
})

it('shows the Shared with me tab with shared quizzes', async () => {
  ;(listQuizAttempts as any).mockResolvedValue([])
  ;(listSharedQuizzes as any).mockResolvedValue([
    { id: 'quiz-9', document_ids: ['doc-1'], created_at: '2026-07-18T12:05:00Z' },
  ])

  renderQuizHistoryPage()
  await waitFor(() => screen.getByText('Chưa có lượt làm bài đố vui nào'))

  fireEvent.click(screen.getByText('Được chia sẻ'))

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Làm bài' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/pages/QuizHistoryPage.test.tsx`
Expected: FAIL — no Share button, no tabs.

- [ ] **Step 3: Implement the tabs, Share button, and shared quizzes list**

```tsx
// frontend/src/pages/QuizHistoryPage.tsx — full replacement
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ShareTeamsModal } from '../components/ShareTeamsModal'
import {
  QuizAttemptSummary,
  listQuizAttempts,
  listSharedQuizzes,
  shareQuiz,
  unshareQuiz,
} from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const { t } = useTranslation('quiz')
  const [view, setView] = useState<'mine' | 'shared'>('mine')
  const [sharingAttempt, setSharingAttempt] = useState<QuizAttemptSummary | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null

  const sharedQuizzesQuery = useQuery({
    queryKey: queryKeys.sharedQuizzes,
    queryFn: listSharedQuizzes,
    enabled: view === 'shared',
  })
  const sharedQuizzes = sharedQuizzesQuery.data ?? []

  const shareMutation = useMutation({
    mutationFn: ({ quizId, teamId }: { quizId: string; teamId: string }) => shareQuiz(quizId, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts }),
  })

  const unshareMutation = useMutation({
    mutationFn: ({ quizId, teamId }: { quizId: string; teamId: string }) => unshareQuiz(quizId, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts }),
  })

  return (
    <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/quiz" className="text-sm font-semibold text-accent-hover hover:underline">
          {t('takeQuiz')}
        </Link>
      </div>

      <div className="mb-5 flex w-fit gap-1 rounded-[10px] border border-line bg-white p-1">
        <button
          onClick={() => setView('mine')}
          className={
            view === 'mine'
              ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('tabs.mine')}
        </button>
        <button
          onClick={() => setView('shared')}
          className={
            view === 'shared'
              ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('tabs.shared')}
        </button>
      </div>

      {view === 'shared' ? (
        <div className="flex flex-col gap-2.5">
          {sharedQuizzes.map((quiz) => (
            <Card key={quiz.id} className="flex items-center justify-between gap-4">
              <span>{quiz.id}</span>
              <Button variant="secondary" onClick={() => navigate(`/quiz/${quiz.id}/retake`)}>
                {t('takeSharedQuiz')}
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {attemptsQuery.isError && <Alert>{t('errors.loadHistory')}</Alert>}
          {attempts !== null && attempts.length === 0 && <p className="text-sm text-muted">{t('noAttempts')}</p>}
          {attempts !== null && attempts.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {attempts.map((a) => (
                <Card key={a.id} className="flex items-center justify-between gap-4">
                  <span>
                    {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} — {a.completed_at}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setSharingAttempt(a)}>
                      {t('share')}
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/quiz/${a.quiz_id}/retake`)}>
                      {t('retake')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {sharingAttempt && (
        <ShareTeamsModal
          sharedTeamIds={sharingAttempt.shared_team_ids}
          onShare={(teamId) => shareMutation.mutate({ quizId: sharingAttempt.quiz_id, teamId })}
          onUnshare={(teamId) => unshareMutation.mutate({ quizId: sharingAttempt.quiz_id, teamId })}
          onClose={() => setSharingAttempt(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/QuizHistoryPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/QuizHistoryPage.tsx frontend/tests/pages/QuizHistoryPage.test.tsx
git commit -m "feat: add quiz sharing UI (Share button + Shared with me tab)"
```

---

## Final verification

- [ ] Run the full backend suite: `cd backend && python -m pytest -q` — all pass.
- [ ] Run the full frontend suite: `cd frontend && npx tsc --noEmit && npm test -- --run` — all pass.
- [ ] Manually smoke-test in the browser (per `run` skill or `npm run dev` from the repo root): sign up two users, create a team as user A, add user B by email search, upload a document as A, share it to the team, sign in as B and confirm it appears under "Shared with me" in Documents, and that chat/search/quiz-generation on B's account can use it.
