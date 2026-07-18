# Quiz (Plan 4 of 4) — Design

Extends the "Quiz" section of `docs/superpowers/specs/2026-07-17-document-knowledge-assistant-design.md` (lines 64-69) with the concrete decisions needed to implement it, and fills in the `quizzes`/`quiz_questions`/`quiz_attempts` schema sketch (lines 31-33). Builds on Foundation (Plan 1): `documents`/`chunks` tables and the per-user `WHERE user_id = %s` isolation pattern. Builds on Chat Q&A (Plan 3): `app/services/llm.py`'s `anthropic` SDK wrapper pattern (module-level `_client`, `MODEL = "claude-sonnet-5"`, monkeypatchable in tests) and `app/routers/chat.py`'s router conventions (`Depends(get_current_user_id)`, `get_conn()`, plain-dict JSON responses rather than `response_model`).

This is the last of the four plans — there is no future plan to defer work to, so the manual end-to-end verification section in the implementation plan is the final check for the whole application.

## Scope

Three backend endpoints and three frontend surfaces:

1. **Generate** — the user selects one or more of their own documents and a question count (5-20, default 10); the backend gathers that selection's chunks, asks Claude for a structured multiple-choice quiz grounded strictly in those chunks, validates the structured output, and persists a `quizzes` row plus its `quiz_questions` rows.
2. **Take & submit** — the frontend renders the generated questions from the generate response (no extra fetch — the same "render what's already in hand, don't add a reload endpoint" simplification Chat Q&A made for its message history) and, on submit, posts the user's answers to be scored server-side; the backend persists a `quiz_attempts` row.
3. **History** — a dedicated endpoint lists the user's past attempts (score, total, timestamp, which documents the quiz drew from) for a history page.

**Deliberately deferred (not in this plan), mirroring Chat Q&A's precedent of not over-building around a single-visit flow:**
- No `GET /quiz/{id}` to reload a quiz's questions later — a quiz is taken once, in the same page visit it was generated in. `quiz_questions` is still fully persisted (satisfying the whole-app data model and the history/results view), just not re-servable as a fresh take.
- No re-take / retry flow beyond generating a new quiz.
- No per-document quiz analytics (e.g. "your weakest topic") beyond the plain attempt list.

## Decisions

### No Voyage AI / embedding step in quiz generation

Search and Chat both embed a *user's query* and rank chunks by similarity to it. Quiz generation has no query to embed — the user names the documents directly ("quiz me on these") rather than asking a question. So generation simply pulls **all** chunks belonging to the selected documents (scoped to the user), in `(document_id, chunk_index)` order, and hands them to Claude. This is simpler than reusing Search/Chat's similarity query and avoids a Voyage AI call and its failure mode entirely for this endpoint.

### Document ownership validation: all-or-nothing 404, like Chat's session check

`POST /quiz/generate` requires every `document_id` in the request to belong to the caller. The backend runs `SELECT id FROM documents WHERE user_id = %s AND id = ANY(%s)` and compares the row count to the (de-duplicated) requested ID count; any mismatch — a nonexistent ID, or one belonging to another user — is a `404`, not a partial success. This mirrors Chat's `session_id` ownership check (a foreign ID that isn't yours doesn't leak whether it exists elsewhere, it's just "not found") and keeps the isolation guarantee unambiguous: a request either operates entirely on the caller's own documents, or it's rejected outright.

### No explicit "document must be `ready`" check — it falls out of the chunks join

A `documents.status` of `uploading`/`processing`/`failed` never has associated `chunks` rows (Foundation's pipeline only writes chunks after successful processing). So a request that includes a not-yet-ready document alongside ready ones doesn't need a special case — that document simply contributes zero chunks, and the aggregate "no content at all" check (below) is what fires if *nothing* in the selection has usable content. This is simpler than adding a parallel status check that would just re-derive the same fact the chunks join already encodes.

### Zero content is a `400`, not a degraded quiz

If the combined chunk set for the selected documents is empty (all selected documents are unready, or have no chunks for any other reason), the backend returns `400 Bad Request` with a message telling the user to select documents with processed content, and never calls Claude. This is distinct from "fewer questions than requested" (below): zero content means there is nothing to ground *any* question in, which is a request-validation failure, not a content-quantity tradeoff.

### Chunk cap: first 60 chunks in `(document_id, chunk_index)` order

An unbounded chunk set (e.g. a user selecting ten large documents) could blow up the prompt size and cost unpredictably. The backend caps the chunks sent to Claude at **60**, taking them in the same deterministic `(document_id, chunk_index)` order the query already returns — not a random sample — so behavior is reproducible and the earliest content in each document is favored over later content when a selection is large. 60 is a generation-time bound distinct from Search/Chat's *result* limit of 10; it's chosen to comfortably cover the default 10-question / max 20-question range with multiple source passages per question while keeping the prompt bounded. This is a starting value, not a tuned constant — revisit if manual testing shows quizzes skewed toward only the first few documents in a large selection.

### Structured output: a forced tool call, not free-text JSON parsing

Claude is asked to *call* a tool (`tool_choice` forced to a specific tool) rather than asked to emit JSON in prose and have the backend parse it out of a text block. A forced tool call is validated against a JSON Schema by the API itself and arrives as a native Python `dict` (`tool_use` block's `input`) — no braces-in-prose parsing, no risk of Claude wrapping the JSON in markdown fences or explanatory text around it. This is a stronger structural guarantee than Chat's plain-text `answer_from_chunks`, which is appropriate here because quiz generation's output *is* structured data (question/options/answer/citation), whereas Chat's output is prose.

Tool schema (`QUIZ_TOOL` in `app/services/llm.py`):

```python
QUIZ_TOOL = {
    "name": "return_quiz_questions",
    "description": "Return the generated multiple-choice quiz questions.",
    "input_schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 4,
                            "maxItems": 4,
                        },
                        "correct_answer": {"type": "integer", "minimum": 0, "maximum": 3},
                        "source_document_id": {"type": "string"},
                        "source_chunk_index": {"type": "integer"},
                    },
                    "required": [
                        "question",
                        "options",
                        "correct_answer",
                        "source_document_id",
                        "source_chunk_index",
                    ],
                },
            }
        },
        "required": ["questions"],
    },
}
```

`app/services/llm.py` adds `generate_quiz_questions(chunks: list[dict], num_questions: int) -> list[dict]`, structured exactly like `answer_from_chunks`: it builds a context string from the chunks (same `[Source: {filename}, passage {chunk_index+1} of {total_chunks}]` framing, plus the chunk's `document_id` so Claude can cite it back), calls `_client.messages.create` with `tools=[QUIZ_TOOL]` and `tool_choice={"type": "tool", "name": "return_quiz_questions"}`, and returns the `questions` array from the matching `tool_use` block's `input` — **unvalidated**. Validation (shape correctness, in-range answer index, citation actually referring to a chunk that was really provided) is the router's job, not the LLM service's, exactly as Chat keeps "call Claude" (`llm.py`) and "decide what the retrieved/generated content means for the response" (`routers/chat.py`) in separate layers.

The system prompt is built per-call (interpolating `num_questions`), unlike Chat's static module-level `SYSTEM_PROMPT`, because the requested count is a parameter, not a constant:

```python
def _quiz_system_prompt(num_questions: int) -> str:
    return (
        f"You are a quiz generator. Using ONLY the document passages provided, "
        f"generate up to {num_questions} multiple-choice questions that test "
        f"understanding of their content. Each question must have exactly 4 "
        f"options with exactly one correct answer, and must cite the passage "
        f"(source_document_id and source_chunk_index) it is based on. If the "
        f"passages cannot support {num_questions} good, clearly-grounded "
        f"questions, generate fewer rather than inventing questions not "
        f"supported by the passages. Do not ask about anything not present "
        f"in the passages."
    )
```

**Thinking disabled** (`thinking={"type": "disabled"}`), consistent with `answer_from_chunks`'s rationale: generating questions from a bounded, already-retrieved set of passages doesn't need extended reasoning, and disabling it keeps forced-tool-call behavior simple and predictable. **`max_tokens=8192`** (vs. Chat's 2048): up to 20 questions with 4 options each is meaningfully larger output than a conversational answer, but stays safely under the SDK's non-streaming timeout guard Chat's design doc notes (~16K threshold).

### Validation before persisting: drop malformed questions, count what survives

After `generate_quiz_questions` returns, the router validates each raw question dict independently and keeps only the ones that pass **all** of:

- `question` is a non-empty string (after `.strip()`).
- `options` is a list of exactly 4 items, every item a non-empty string (after `.strip()`).
- `correct_answer` is an `int` with `0 <= correct_answer <= 3`.
- `source_document_id` matches one of the `document_id`s actually in the request (never trust Claude to only cite what it was given).
- `source_chunk_index` is an `int` that is `>= 0` and `< total_chunks` for that document (i.e. it must refer to a chunk that was actually part of the context Claude saw — see "Chunk cap" above; a chunk index beyond the cap sent to Claude, or beyond the document's real chunk count, is a hallucinated citation and the question is dropped, not repaired).

A question failing any check is silently dropped (not persisted, not repaired, not surfaced as a partial/edited version) — this is the same "never invent/patch, just don't use it" posture the whole-app design requires for content generation.

- If **zero** questions survive validation, the request fails with `502 Bad Gateway` ("Failed to generate valid quiz questions") and nothing is persisted — an LLM producing no usable output is a genuine backend/upstream failure, not a content-quantity tradeoff, mirroring Chat's "a Claude failure is a genuine backend error" stance for `answer_from_chunks`/`answer_with_web_search`.
- If **some but fewer than `num_questions`** survive, that's the whole-app design's explicitly-required graceful degradation: persist what's valid and report the true count via `actual_count` in the response (see Backend contracts below) — never top up with invented questions.
- Claude is also *asked* (in the system prompt) to self-limit to what the content supports, so under-generation is expected to be the common path for thin content, with the backend's validation as the second, independent safety net — exactly the two-layer posture ("ask nicely, then verify structurally") Chat's design uses for grounding.

### Schema: `quizzes` / `quiz_questions` / `quiz_attempts` (`backend/migrations/0003_quiz.sql`)

Following `0001_init.sql`/`0002_chat.sql`'s style exactly: app-generated `uuid` primary keys, RLS scoped through `auth.uid()`, indexes on every foreign key used in a `WHERE`.

```sql
create table quizzes (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    document_ids uuid[] not null,
    created_at timestamptz not null default now()
);

create table quiz_questions (
    id uuid primary key,
    quiz_id uuid not null references quizzes(id) on delete cascade,
    question_index integer not null,
    question text not null,
    options jsonb not null check (jsonb_array_length(options) = 4),
    correct_answer integer not null check (correct_answer between 0 and 3),
    source_reference jsonb not null
);

create table quiz_attempts (
    id uuid primary key,
    quiz_id uuid not null references quizzes(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    answers jsonb not null,
    score integer not null,
    completed_at timestamptz not null default now()
);

create index quizzes_user_id_idx on quizzes (user_id);
create index quiz_questions_quiz_id_idx on quiz_questions (quiz_id);
create index quiz_attempts_quiz_id_idx on quiz_attempts (quiz_id);
create index quiz_attempts_user_id_idx on quiz_attempts (user_id);

alter table quizzes enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;

create policy "quizzes_owner" on quizzes
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "quiz_questions_owner" on quiz_questions
    for all using (
        exists (select 1 from quizzes q where q.id = quiz_questions.quiz_id and q.user_id = auth.uid())
    );

create policy "quiz_attempts_owner" on quiz_attempts
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Notes:
- `quiz_questions.question_index` (0-based) gives a stable, deterministic ordering for rendering the quiz and for matching submitted answers back to questions — the same role `chunks.chunk_index` plays for passage ordering. Without it, row order would depend on `uuid` primary keys, which carry no ordering guarantee.
- `options jsonb not null check (jsonb_array_length(options) = 4)` and `correct_answer ... check (correct_answer between 0 and 3)` are defense-in-depth at the database layer for the same invariant the router already validates in application code before persisting — belt and suspenders, matching this schema's existing style of encoding real invariants as `check` constraints (see `documents.status`'s check in `0001_init.sql`).
- `quiz_attempts` has its own `user_id` column (per the whole-app design's schema sketch, unlike `chat_messages`, which derives ownership only through `chat_sessions`) — RLS is a direct `auth.uid() = user_id` policy, and application code still explicitly filters `WHERE user_id = %s` on every query, not only through a `quiz_id` join. `total_questions` is deliberately **not** a stored column — it's derived at read time via `count(*)` over `quiz_questions` for that `quiz_id` (see Backend contracts), avoiding a denormalized value that could drift from the actual question count.
- `quiz_questions.source_reference` is a `jsonb` object, shaped like Chat's `citations` entries for consistency: `{"document_id": "...", "filename": "...", "chunk_index": 2, "total_chunks": 5}`.
- No changes to `documents`/`chunks`/`chat_*` tables.

## Backend

Three endpoints, `backend/app/routers/quiz.py`, mounted with `prefix="/quiz"`.

### `POST /quiz/generate`

Request:
```json
{"document_ids": ["uuid1", "uuid2"], "num_questions": 10}
```
`num_questions` optional, default `10`.

Steps:
1. `400` if `document_ids` is empty.
2. `400` if `num_questions` (after defaulting) is outside `5..20` inclusive.
3. De-duplicate `document_ids`. `SELECT id FROM documents WHERE user_id = %s AND id = ANY(%s)`; if the returned row count != the de-duplicated request count, `404` ("One or more selected documents were not found").
4. Fetch chunks for the selection scoped to the user (the ownership check in step 3 already proved the documents are the caller's, but the chunk query still filters by `d.user_id = %s` directly — never rely solely on a prior check in a different query):
   ```sql
   SELECT
       d.id AS document_id,
       d.filename,
       c.chunk_index,
       c.content,
       count(*) OVER (PARTITION BY c.document_id) AS total_chunks
   FROM chunks c
   JOIN documents d ON d.id = c.document_id
   WHERE d.user_id = %s AND d.id = ANY(%s)
   ORDER BY d.id, c.chunk_index
   ```
5. If zero chunks returned: `400` ("Selected documents have no content to generate a quiz from").
6. Cap to the first 60 chunks (see "Chunk cap" above).
7. `generate_quiz_questions(chunks, num_questions)` → validate each item (see "Validation before persisting" above) → `valid_questions`.
8. If `len(valid_questions) == 0`: `502` ("Failed to generate valid quiz questions"). Nothing persisted.
9. Insert `quizzes` row (`id`, `user_id`, `document_ids` = the de-duplicated list, `created_at`). Insert one `quiz_questions` row per `valid_questions` entry, `question_index` = its position (0-based) in `valid_questions`.
10. Response `201`:
    ```json
    {
      "id": "quiz-uuid",
      "document_ids": ["uuid1", "uuid2"],
      "requested_count": 10,
      "actual_count": 7,
      "created_at": "2026-07-18T12:00:00+00:00",
      "questions": [
        {"id": "question-uuid", "question": "What is the refund window?", "options": ["7 days", "30 days", "60 days", "90 days"]}
      ]
    }
    ```
    Questions in the response **omit `correct_answer` and `source_reference`** — the point of a quiz is that the taker doesn't already know the answer; those fields are only revealed in the submit response, after scoring. `actual_count` always equals `requested_count` unless degradation happened; the frontend uses `actual_count < requested_count` to decide whether to tell the user fewer questions were generated than asked for.

### `POST /quiz/{quiz_id}/attempts`

Request:
```json
{"answers": [{"question_id": "question-uuid", "selected_option": 1}]}
```
An array rather than an object keyed by ID — matches this codebase's existing preference for arrays-of-objects over ID-keyed maps in request bodies (e.g. Chat's message list). Not every question needs an entry (unanswered = incorrect, not an error).

Steps:
1. `404` if no `quizzes` row with `id = quiz_id AND user_id = %s` exists.
2. `SELECT id, question_index, question, options, correct_answer, source_reference FROM quiz_questions WHERE quiz_id = %s ORDER BY question_index` — always non-empty for a quiz that reached step 9 of generation.
3. Build a `{question_id: submitted_row}` map from the request. `400` if any submitted `question_id` doesn't belong to this quiz's question set, or if any `question_id` appears more than once, or if any `selected_option` is not an `int` in `0..3`.
4. For each question (in `question_index` order): look up its submitted answer, if any. `is_correct = (selected_option == correct_answer)` when answered, else `False`. `score` = count of `is_correct` across all questions.
5. Insert `quiz_attempts` row (`id`, `quiz_id`, `user_id`, `answers` = the request body's `answers` array verbatim, `score`, `completed_at`).
6. Response `201`:
   ```json
   {
     "id": "attempt-uuid",
     "quiz_id": "quiz-uuid",
     "score": 7,
     "total_questions": 10,
     "completed_at": "2026-07-18T12:05:00+00:00",
     "results": [
       {
         "question_id": "question-uuid",
         "question": "What is the refund window?",
         "options": ["7 days", "30 days", "60 days", "90 days"],
         "selected_option": 1,
         "correct_answer": 1,
         "is_correct": true,
         "source_reference": {"document_id": "...", "filename": "policy.pdf", "chunk_index": 2, "total_chunks": 5}
       }
     ]
   }
   ```
   `selected_option` is `null` for a question the user didn't answer. `results` is ordered by `question_index`, matching the order the quiz was originally rendered in.

### `GET /quiz/attempts`

- `SELECT a.id, a.quiz_id, a.score, a.completed_at, q.document_ids, (SELECT count(*) FROM quiz_questions qq WHERE qq.quiz_id = a.quiz_id) AS total_questions FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.user_id = %s ORDER BY a.completed_at DESC`.
- Collect the distinct set of `document_ids` across all rows, then `SELECT id, filename FROM documents WHERE user_id = %s AND id = ANY(%s)` once to build an `{id: filename}` map. A document referenced by an old quiz may since have been deleted (Document Manager supports delete); any `document_id` missing from the map renders as the literal string `"(deleted document)"` rather than erroring — attempt history must survive a source document being deleted later, since the whole-app design's Document Manager already allows delete independent of what quizzes reference it.
- Response `200`:
  ```json
  {
    "attempts": [
      {
        "id": "attempt-uuid",
        "quiz_id": "quiz-uuid",
        "score": 7,
        "total_questions": 10,
        "completed_at": "2026-07-18T12:05:00+00:00",
        "document_filenames": ["policy.pdf", "(deleted document)"]
      }
    ]
  }
  ```
- No pagination — consistent with Search/Chat not paginating either at this app's expected scale.

### Error handling

- `document_ids` empty, `num_questions` out of `5..20`, or an unknown/duplicate `question_id`/out-of-range `selected_option` on submit: `400`.
- Selected documents not found or not owned by the caller (`generate`), or `quiz_id` not found/not owned (`attempts` submit): `404`.
- Zero chunks available for the selection: `400` (a request-shape problem — nothing to ground on).
- Zero valid questions survive validation: `502` (an upstream generation failure — Claude produced nothing usable), nothing persisted.
- Fewer valid questions than requested (but at least one): not an error — `201` with `actual_count < requested_count`, exactly the whole-app design's required graceful degradation.
- A deleted document referenced by a historical quiz: not an error — renders as `"(deleted document)"` in the history list, per above.

## Frontend

- `frontend/src/lib/api.ts` additions:
  ```ts
  export type QuizQuestion = { id: string; question: string; options: string[] }

  export type Quiz = {
    id: string
    document_ids: string[]
    requested_count: number
    actual_count: number
    created_at: string
    questions: QuizQuestion[]
  }

  export async function generateQuiz(documentIds: string[], numQuestions: number): Promise<Quiz> { ... }

  export type QuizAnswer = { question_id: string; selected_option: number }

  export type QuizResult = {
    question_id: string
    question: string
    options: string[]
    selected_option: number | null
    correct_answer: number
    is_correct: boolean
    source_reference: { document_id: string; filename: string; chunk_index: number; total_chunks: number }
  }

  export type QuizAttemptResult = {
    id: string
    quiz_id: string
    score: number
    total_questions: number
    completed_at: string
    results: QuizResult[]
  }

  export async function submitQuizAttempt(quizId: string, answers: QuizAnswer[]): Promise<QuizAttemptResult> { ... }

  export type QuizAttemptSummary = {
    id: string
    quiz_id: string
    score: number
    total_questions: number
    completed_at: string
    document_filenames: string[]
  }

  export async function listQuizAttempts(): Promise<QuizAttemptSummary[]> { ... }
  ```
- **`QuizPage.tsx`** (route `/quiz`), a single page managing three local phases in component state (no extra routes/reload needed, per the "render what's in hand" decision above):
  1. **Config** — on mount, calls `listDocuments()` (existing) and renders a checkbox per document (only those with `status === 'ready'` are selectable — documents not yet processed have no chunks to quiz on) plus a number input for question count (bounds `5`-`20`, default `10`). "Generate Quiz" button calls `generateQuiz`.
  2. **Taking** — renders each returned question with its 4 options as a radio group. Per the backend contract an unanswered question is allowed (it simply counts as incorrect), so the "Submit" button is enabled as soon as the quiz has loaded, not gated on every question being answered; it calls `submitQuizAttempt(quiz.id, answers)` with whatever's been selected so far.
  3. **Results** — renders the score (`"7 / 10"`), and per question: the question text, all 4 options with the user's selection and the correct answer visually distinguished (e.g. "your answer" / "correct answer" text labels — no color-only signaling), and the source filename + "passage N of M". If `actual_count < requested_count` was true for the quiz, a banner reading `"Generated 7 of the requested 10 questions — the selected documents didn't have enough distinct content for more."` is shown during the Taking phase.
  - States: disable Generate/Submit while a request is in flight; `role="alert"` error text on request failure, matching every other page's existing error pattern.
- **`QuizHistoryPage.tsx`** (route `/quiz/history`): on mount, calls `listQuizAttempts()`; renders a list of `"{score} / {total_questions} — {document_filenames.join(', ')} — {completed_at}"`. Empty state: `"No quiz attempts yet"` shown only after the list call resolves to `[]` (matching Search's "only show empty state after a real empty response" pattern).
- `AppNav.tsx` gets a `Quiz` link (`/quiz`) added alongside the existing `Documents`/`Search` links — unlike Chat (deferred adding itself to `AppNav` because Search's work was uncommitted/in-flight at the time), both Search and Chat are now committed, so Quiz's plan is free to extend the shared nav. A link to the history page is rendered inside `QuizPage` itself (`<Link to="/quiz/history">Past attempts</Link>`), not added to the global nav, keeping `AppNav` to top-level sections only.
- `App.tsx` gets two new additive routes, `/quiz` and `/quiz/history`, both wrapped in `<ProtectedRoute>` + `<AppNav>` like `/documents` and `/search`.

## Error Handling & Edge Cases

- Selecting zero documents is a client-side no-op (Generate button does nothing / is disabled) mirroring Search's empty-query guard, and is also enforced server-side (`400`).
- A document selected while still `processing` is prevented client-side (only `ready` documents are selectable), and if somehow submitted anyway, server-side validation naturally falls through the "documents with no chunks contribute nothing" path — if it's the *only* selection, that's the zero-chunk `400`.
- Insufficient content for the requested question count → fewer questions generated, actual count communicated in the UI banner described above — never invented filler questions, per the whole-app design's explicit requirement.
- No LLM call can result in a persisted question whose `correct_answer` index is outside `0..3` or whose citation wasn't actually part of the provided context — enforced by validate-before-persist (above) and the database's own `check` constraints as a second layer.
- A quiz whose source document was later deleted still appears correctly in history, rendering `"(deleted document)"` for the missing filename.
- Every query touching `quizzes`/`quiz_questions`/`quiz_attempts` (as well as the reused `chunks`/`documents`) is scoped to the authenticated user via RLS and an explicit `WHERE`/`JOIN` filter in application code — no exceptions.

## Testing Strategy

- **Backend** (real Postgres+pgvector, matching Foundation/Search/Chat's existing test patterns; `generate_quiz_questions` mocked at the same module-attribute boundary `answer_from_chunks`/`answer_with_web_search` already are in Chat's tests — no live Anthropic calls in the regular suite):
  - `POST /quiz/generate` with a mocked `generate_quiz_questions` returning 10 valid questions persists a `quizzes` row and 10 `quiz_questions`, and the response omits `correct_answer`/`source_reference`.
  - A mocked response with some malformed questions (bad option count, out-of-range `correct_answer`, a `source_document_id` not in the request, a `source_chunk_index` beyond that document's chunk count) drops exactly those and persists/returns only the valid ones, with `actual_count` reflecting the survivors.
  - A mocked response where every question is malformed returns `502` and persists nothing (`quizzes` table unchanged).
  - An empty `document_ids` list returns `400` without calling `generate_quiz_questions`.
  - `num_questions` of `4` or `21` returns `400` without calling `generate_quiz_questions`.
  - A `document_ids` list containing another user's document (or a nonexistent ID) returns `404`.
  - A selection whose documents have zero chunks returns `400` without calling `generate_quiz_questions`.
  - `POST /quiz/{quiz_id}/attempts` scores correctly against a mix of correct/incorrect/unanswered questions, persists a `quiz_attempts` row, and returns per-question `is_correct`/`correct_answer`/`source_reference`.
  - Submitting an unknown `question_id`, a duplicate `question_id`, or an out-of-range `selected_option` returns `400`.
  - Submitting to a `quiz_id` belonging to another user (or nonexistent) returns `404`.
  - `GET /quiz/attempts` returns only the caller's attempts (cross-user isolation), ordered newest-first, with correct `total_questions` and `document_filenames`, including the `"(deleted document)"` fallback when a referenced document row no longer exists.
- **Frontend**: generating a quiz renders its questions; selecting options and submitting renders the results view with scores and correct/incorrect labeling; a degraded `actual_count` shows the banner; a failed generate/submit request shows the error message; the history page renders past attempts and its empty state; protected route/nav wiring works.
- No end-to-end/Playwright tests in this plan — out of scope at the per-plan level, consistent with Foundation/Search/Chat.
