# Document Knowledge Assistant — Design

## Overview

A web application where users upload documents (PDF, DOCX, TXT, Markdown), which are preprocessed into a searchable, embedded knowledge base scoped per user. Users can:

- Manage their uploaded documents (list, preview, download, rename, delete)
- Search their documents for matching passages
- Ask an AI assistant questions that are answered strictly from their uploaded documents (no hallucination), with an explicit opt-in to web search for a given question
- Generate multiple-choice quizzes grounded in one or more of their documents, take them, and track scores over time

## Architecture & Tech Stack

- **Frontend:** React + Vite SPA
- **Backend:** Python + FastAPI — chosen over Node for the maturity of its document-parsing/chunking ecosystem (`pypdf`, `python-docx`, `unstructured`)
- **Database / Auth / File storage:** Supabase (free tier) — Postgres with the `pgvector` extension for embeddings, built-in user authentication, and object storage for uploaded files
- **Embeddings:** Voyage AI (Anthropic's recommended embeddings partner; has a free tier)
- **LLM:** Claude API (Anthropic) — chat Q&A, quiz generation, and optional per-turn web search
- **Hosting (free tier, demo-first):** frontend on Vercel/Netlify/Cloudflare Pages; backend on Render/Railway/Fly.io free tier; Supabase free tier for data/auth/storage

Data flow: Browser (React) → FastAPI backend → Supabase (Postgres/pgvector + Storage) for persistence, and → Voyage AI / Claude APIs for embeddings and generation.

## Data Model

User identity is provided entirely by Supabase Auth's `auth.users` (id, email, etc.) — no separate `profiles` table. All application tables reference `auth.users.id` as `user_id` and are protected by Postgres Row Level Security so a user can only ever read/write their own rows.

- **`documents`** — `id, user_id, filename, file_type, storage_path, status (uploading | processing | ready | failed), error_reason, uploaded_at`
- **`chunks`** — `id, document_id, content, embedding (vector), chunk_index, location_metadata (e.g. page number)` — the unit that search and retrieval operate on
- **`chat_sessions`** — `id, user_id, title, created_at`
- **`chat_messages`** — `id, session_id, role (user | assistant), content, citations (jsonb: doc/chunk refs), used_web_search (bool), created_at`
- **`quizzes`** — `id, user_id, document_ids (array), created_at`
- **`quiz_questions`** — `id, quiz_id, question, options (jsonb array), correct_answer, source_reference (doc/chunk)`
- **`quiz_attempts`** — `id, quiz_id, user_id, answers (jsonb), score, completed_at`

## Feature Flows

### Document Manager

- Flat list/grid of the user's documents: name, type, status, upload date. No folders/collections.
- Actions per document:
  - **Preview** — PDF and TXT/MD render natively in-browser; DOCX shows its extracted plain text (the same text used for search/chat), not a formatted rendering
  - **Download** — original file, streamed from Supabase Storage
  - **Rename**
  - **Delete** — also removes its `chunks`/embeddings

### Upload & Preprocessing (async)

1. User uploads a file (PDF/DOCX/TXT/MD, within a size limit) → validated (type + size) → stored in Supabase Storage → `documents` row created with `status=uploading`
2. Upload request returns immediately; a backend background task takes over: extract text → split into chunks → embed each chunk via Voyage AI → store chunks + embeddings → `status=processing` → `ready`, or `failed` with `error_reason` if parsing fails
3. Frontend reflects live status (Processing → Ready/Failed) without blocking other app usage

### Search (dedicated page)

- User enters a query → backend embeds it via Voyage AI → pgvector similarity search over that user's `chunks` only → returns ranked raw passages with source document + location
- No LLM generation involved — this is retrieval only, distinct from the chat feature
- Empty state shown when nothing matches

### Chat Q&A (dedicated page)

1. User asks a question → backend performs the same retrieval as Search → Claude is given only the retrieved chunks and instructed to answer strictly from them, including citations back to source document/chunk
2. Grounding is enforced structurally, not just via prompt instruction: retrieval results are filtered by a minimum similarity-score threshold. If nothing clears the threshold, Claude responds that the answer isn't found in the uploaded documents, rather than answering from general knowledge
3. If the user explicitly asks (in that message) for a web search, the backend invokes Claude with web search enabled for that turn only. The response is visually distinguished in the UI (e.g. a "Web" badge) from document-grounded answers, so the two are never confused

### Quiz

1. User selects one or more documents (or all) → backend gathers relevant chunks across the selection → Claude generates a default of 10 multiple-choice questions (user-adjustable within a 5–20 range) as structured output (question, 4 options, correct answer, source reference)
2. If the selected content can't support the requested number of quality questions, fewer are generated and the user is told how many
3. Generated questions are saved (`quizzes` + `quiz_questions`); the user takes the quiz in the UI, submits answers, and the backend scores it, saving a `quiz_attempts` row
4. A history page lists past quiz attempts with scores and timestamps

## Error Handling & Edge Cases

- **Unsupported/oversized files** rejected both client-side and server-side before storage/processing, with a clear message
- **Preprocessing failures** (corrupt/unparseable file) mark `documents.status=failed` with a visible reason; user deletes and re-uploads — no automatic retry loop
- **No relevant content found** — search shows an explicit empty state; chat explicitly states the answer isn't in the documents (threshold-enforced, see above)
- **Web search opt-in** is per-message and visually labeled, never silently blended with document-grounded answers
- **Insufficient content for quiz generation** — generate fewer questions rather than inventing filler ones, and communicate the actual count
- **Authorization** — Postgres Row Level Security scopes every table (`documents`, `chunks`, `chat_*`, `quiz_*`) to the authenticated user at the database layer, not only in application code

## Testing Strategy

- **Backend unit tests:** chunking boundaries, retrieval similarity-threshold behavior (relevant vs. irrelevant queries), quiz structured-output validation (shape, valid answer indices)
- **Backend integration tests:** full upload → preprocess → status transition → searchable pipeline against a real Postgres+pgvector instance; RLS policies verified to block cross-user access
- **API contract tests:** each FastAPI endpoint (upload, search, chat, quiz generate/submit, document CRUD) — happy path + validation errors
- **Frontend tests:** document manager states (list/preview/download/rename/delete), quiz-taking flow (answer selection → scoring)
- **End-to-end tests** (e.g. Playwright) covering the core journey: sign up → upload → wait for ready → search → ask a question → generate quiz → take quiz
- **Grounding verification:** at least a small set of tests hit the real Claude/Voyage APIs (or recorded fixtures) to confirm the "don't hallucinate outside the documents" behavior actually holds — this is the core trust guarantee of the app and shouldn't be fully mocked away
