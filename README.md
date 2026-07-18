# Document Knowledge Assistant

Upload documents (PDF, DOCX, TXT, Markdown), then search, chat, and generate quizzes grounded strictly in what you uploaded — no hallucination outside your own documents.

Full design rationale lives in `docs/superpowers/specs/` and `docs/superpowers/plans/` (one design/implementation-plan pair per feature: Foundation, Search, Chat Q&A, Quiz).

## Architecture

- **Frontend:** React 18 + Vite + TypeScript, Tailwind CSS, React Router, Vitest + Testing Library
- **Backend:** FastAPI + psycopg3, pytest
- **Database / Auth / Storage:** Supabase (Postgres + `pgvector`, Auth, object storage)
- **Embeddings:** Voyage AI (`voyage-3-lite`, 512-dim vectors)
- **LLM:** Claude API (`claude-sonnet-5`) — chat Q&A and quiz generation

Data flow: Browser → FastAPI → Supabase (Postgres/pgvector + Storage), and → Voyage AI / Claude APIs.

## Prerequisites

- Python 3.11+
- Node 20+
- Docker (for the local test database)
- A Supabase project (free tier is enough) with the `pgvector` extension available
- API keys: Voyage AI, Anthropic (Claude)

## Configuration

Copy the backend env template and fill in real values:

```bash
cd backend
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only, never expose to the frontend) |
| `SUPABASE_JWT_SECRET` | Used to verify user auth tokens on incoming requests |
| `SUPABASE_DB_URL` | Direct Postgres connection string for the same project |
| `VOYAGE_API_KEY` | Voyage AI API key (embeddings) |
| `ANTHROPIC_API_KEY` | Claude API key (chat + quiz generation) |
| `STORAGE_BUCKET` | Supabase Storage bucket name for uploaded files (default `documents`) |

The frontend talks to Supabase Auth directly and to the FastAPI backend. Copy its env template too:

```bash
cd frontend
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Same Supabase project URL as the backend |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (safe for the browser) |
| `VITE_API_BASE_URL` | Where the FastAPI backend is running (default `http://localhost:8000`) |

### Database schema

Migrations are plain SQL files in `backend/migrations/`, applied in order against your Supabase project's Postgres:

- `0001_init.sql` — `documents`, `chunks` (pgvector column, RLS scoped to `auth.uid()`)
- `0002_chat.sql` — `chat_sessions`, `chat_messages`
- `0003_quiz.sql` — `quizzes`, `quiz_questions`, `quiz_attempts`

Run them via the Supabase SQL editor or `psql "$SUPABASE_DB_URL" -f backend/migrations/000X_*.sql`, in numeric order.

## Running locally

Backend:

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

## Development workflow

Backend tests run against a real local Postgres+pgvector instance (RLS and pgvector behavior aren't meaningfully mockable):

```bash
cd backend
docker compose -f docker-compose.test.yml up -d   # starts pgvector/pgvector:pg16 on localhost:5433
python -m pytest -q
```

`tests/conftest.py` applies all migrations to the `test` database automatically before the suite runs and truncates tables between tests — no manual setup beyond having the container up. It refuses to run if `SUPABASE_DB_URL` doesn't point at `localhost:5433`/`test`, so it can never touch a real project by accident.

Frontend:

```bash
cd frontend
npx tsc --noEmit   # typecheck
npm test -- --run  # Vitest, single run
```

This project follows strict TDD (see `docs/superpowers/plans/`): for any change, write a failing test first, confirm it fails, implement, confirm it passes.

## Deployment

Backend on [Render](https://render.com) (free web service tier) and frontend on [Vercel](https://vercel.com) (free tier) — both free without a credit card.

### Backend (Render)

1. Push this repo to GitHub, then in Render click **New > Blueprint** and point it at the repo. Render reads `render.yaml` from the repo root and creates the `document-knowledge-assistant-api` web service (free plan, `backend/` as root, `uvicorn` start command, `/health` health check).
2. In the service's **Environment** tab, fill in the values Render left blank: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_DB_URL`, `VOYAGE_API_KEY`, `GEMINI_API_KEY` (same values as your local `backend/.env`).
3. Deploy, then note the public URL Render assigns (e.g. `https://document-knowledge-assistant-api.onrender.com`).

Free-tier caveat: the service spins down after 15 minutes of inactivity, so the first request after idle takes ~30-60s to wake up.

### Frontend (Vercel)

1. In Vercel, **Add New > Project**, import the same repo, and set **Root Directory** to `frontend`. Vercel auto-detects the Vite preset; `frontend/vercel.json` adds the SPA rewrite so React Router routes work on refresh/direct link.
2. Add the env vars from `frontend/.env.example` in the project's **Environment Variables** settings: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same as local), and `VITE_API_BASE_URL` set to the Render URL from above.
3. Deploy. The backend's CORS is already open (`allow_origins=["*"]`), so no backend change is needed for the new frontend origin.

## Project layout

```
backend/
  app/
    routers/       # documents, search, chat, quiz — one file per feature
    services/       # embeddings.py (Voyage), llm.py (Claude), extraction/chunking/processing/storage
    auth.py         # Supabase JWT verification -> get_current_user_id dependency
    db.py           # get_conn() -> psycopg connection
    config.py       # Settings (env vars)
  migrations/        # numbered SQL migrations, applied in order
  tests/
frontend/
  src/
    pages/           # one page per feature (Documents, Search, Chat, Quiz, QuizHistory, Login, Signup)
    components/       # AppNav, AppShell, ProtectedRoute
    components/ui/     # Button, Input, Card, and other shared UI primitives
    lib/api.ts         # typed fetch client for the backend
    contexts/           # AuthContext, ThemeContext
docs/superpowers/
  specs/             # one design doc per feature, extending the whole-app design
  plans/             # one TDD implementation plan per feature
```

## API overview

All endpoints below (except `/health`) require a Supabase auth token and are scoped to the authenticated user.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/documents` | Upload a document (async preprocessing: extract → chunk → embed) |
| GET | `/documents` | List the user's documents |
| PATCH | `/documents/{id}` | Rename a document |
| DELETE | `/documents/{id}` | Delete a document and its chunks |
| GET | `/documents/{id}/download` | Download the original file |
| GET | `/documents/{id}/preview` | Preview extracted text (or native render for PDF/TXT/MD) |
| GET | `/search?q=` | Pure retrieval: top-10 ranked passages, no LLM |
| POST | `/chat/sessions` | Create a chat session |
| POST | `/chat/sessions/{id}/messages` | Ask a question; grounded in retrieved chunks, or web search if opted in |
| POST | `/quiz/generate` | Generate a quiz (5-20 questions) from selected documents |
| POST | `/quiz/{quiz_id}/attempts` | Submit answers and get the attempt scored |
| GET | `/quiz/attempts` | List past quiz attempts |

## Core invariants

- **Per-user isolation:** every query touching `documents`/`chunks`/`chat_*`/`quiz_*` is scoped by `user_id`, enforced both by Postgres RLS and an explicit `WHERE` clause in application code — never rely on one alone.
- **No hallucination:** Chat Q&A only answers from retrieved chunks above a similarity threshold; if nothing clears it, it says so instead of falling back to general knowledge. Web-search-assisted answers are visually distinguished ("Web" badge), never blended silently with document-grounded ones.
- **No invented quiz content:** if selected documents can't support the requested question count, fewer are generated and the user is told the actual count — never filler questions.
