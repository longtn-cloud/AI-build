# Chat Q&A (Plan 3 of 4) — Design

Extends the "Chat Q&A" section of `docs/superpowers/specs/2026-07-17-document-knowledge-assistant-design.md` (lines 58-63) with the concrete decisions needed to implement it. Builds on Foundation (Plan 1): `documents`/`chunks` tables, `embed_query` (Voyage AI), `get_conn`, `get_current_user_id`, and the per-user `WHERE user_id = %s` isolation pattern. Reuses Search's (Plan 2) retrieval approach but adds a similarity threshold (Search itself has none — see Search's design doc, "Result count/threshold") and an LLM generation layer.

## Scope

A dedicated `/chat` page where a user asks a question, the backend retrieves their own document chunks (same mechanism as Search), and — only if at least one chunk clears a minimum similarity threshold — Claude answers strictly from those chunks with citations back to source documents. If nothing clears the threshold, a fixed, non-LLM-generated message is returned instead, so grounding never depends on the model choosing to comply with an instruction. A per-message opt-in re-routes the turn to Claude with web search enabled instead of document retrieval, and that answer is flagged so the frontend can render it distinctly.

**Deliberately deferred (not in this plan):** a UI to list past chat sessions or reload a session's message history. `chat_sessions` and `chat_messages` are still fully persisted (satisfying the whole-app data model), but no `GET` endpoint is added to read them back — the frontend renders one session's conversation in memory during that page visit and starts a fresh session per visit. This mirrors Search's decision to defer page-number citations: the persisted data is there for a future plan to build a history view on top of, without speculatively building that history UI now.

## Decisions

### Similarity threshold: 0.5 cosine similarity

Search returns the top 10 chunks with no threshold because it displays raw ranked results — even a poor match is still useful as a "closest thing we found." Chat asserts an answer, so it needs a cutoff below which "no relevant chunk" is the honest answer.

`voyage-3-lite` cosine similarities (the same `1 - (embedding <=> query)` expression Search already uses) cluster roughly as follows in practice: near-duplicate or directly-answering passages score ~0.7-0.9; topically-related-but-not-answering passages ~0.4-0.6; unrelated passages ~0.0-0.3. **0.5** is chosen as the cutoff: it admits paraphrased or loosely-worded matches (avoiding false negatives on reasonable queries) while excluding passages that are merely topically adjacent. This is a starting value, not a tuned constant — revisit if manual testing shows too many false "not found" or too many weakly-related groundings. It is defined as a single module-level constant (`MIN_SIMILARITY_THRESHOLD` in `app/routers/chat.py`) so it's trivial to find and adjust.

### Retrieval query: threshold applied in SQL, same shape as Search

Search's query (`docs/superpowers/plans/2026-07-18-search.md`, Task 1) computes `score` as a `SELECT` alias and can't reference that alias in a `WHERE` clause directly (Postgres evaluates `WHERE` before the `SELECT` list). Chat wraps the same join in a subquery so the threshold filter can reference `score` by name:

```sql
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
```

Params: `(query_embedding, user_id, MIN_SIMILARITY_THRESHOLD)`. Same cross-user isolation guarantee as Search: `chunks` has no `user_id` column, so the join to `documents` and its `WHERE d.user_id = %s` is what scopes results — this is the single most important thing to get right and test, exactly as Search's design doc states.

### DB schema: `chat_sessions` / `chat_messages` (`backend/migrations/0002_chat.sql`)

The whole-app doc's rough shape (lines 29-30) is filled in below, following `0001_init.sql`'s style exactly: app-generated `uuid` primary keys (no `gen_random_uuid()` default — the app supplies the id, same as `documents`/`chunks`), RLS scoped through `auth.uid()`, and indexes on every foreign key used in a `WHERE`.

```sql
create table chat_sessions (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    created_at timestamptz not null default now()
);

create table chat_messages (
    id uuid primary key,
    session_id uuid not null references chat_sessions(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    citations jsonb not null default '[]'::jsonb,
    used_web_search boolean not null default false,
    created_at timestamptz not null default now()
);

create index chat_sessions_user_id_idx on chat_sessions (user_id);
create index chat_messages_session_id_idx on chat_messages (session_id);

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create policy "chat_sessions_owner" on chat_sessions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_messages_owner" on chat_messages
    for all using (
        exists (select 1 from chat_sessions s where s.id = chat_messages.session_id and s.user_id = auth.uid())
    );
```

Notes:
- `chat_messages` has no `user_id` column, same reasoning as `chunks`: ownership is derived through the `session_id` → `chat_sessions.user_id` join, both at the RLS layer (the policy above) and in application code (every query joins through `chat_sessions` and filters `user_id`).
- `title` has no default in SQL — the application always inserts the literal `'New Chat'` (see below), matching how `documents.status` defaults are set in application logic elsewhere in this codebase's conventions of explicit values.
- No `quiz_*` tables are touched or referenced by this migration — out of scope per the project brief.

### Citations representation: the full grounding set, not per-sentence attribution

`chat_messages.citations` is a `jsonb` array. For an assistant message, it holds the exact set of chunks that were fed to Claude as context for that turn — i.e., "these are the passages this answer is grounded in" — not an attempt to parse which specific sentence came from which chunk. Each entry has the same shape as a Search result (minus the chunk `content`, which isn't needed once the answer exists):

```json
[
  {
    "document_id": "0f5e...",
    "filename": "refund-policy.pdf",
    "chunk_index": 2,
    "total_chunks": 5,
    "score": 0.81
  }
]
```

Rationale: asking Claude to emit structured per-claim citations (e.g. via tool use or `output_config.format`) adds a second point of failure (malformed citation output, citations referencing chunks that weren't actually provided) for a benefit — sentence-level attribution — that the whole-app design doesn't ask for ("citations back to source document/chunk" is satisfied by "here are the documents this answer drew from"). Claude's prose is still instructed to mention filenames/passages inline where natural; the structured `citations` column is what the frontend renders as a "Sources" list regardless of what the prose says.

- User messages always have `citations: []` and `used_web_search: false`.
- The "not found" canned response (nothing cleared the threshold) has `citations: []`.
- A web-search-assisted answer has `citations: []` — web search results are not chunk citations, and mixing the two representations in one field risks exactly the "blended, never confused" violation the whole-app design prohibits. Anthropic's web-search tool results are not persisted as structured citations in this plan (deferred — see Error Handling).

### Web search opt-in: a boolean field on the send-message request, routes to a separate LLM call

Per the whole-app design: "If the user explicitly asks (in that message) for a web search, the backend invokes Claude with web search enabled for that turn only." This is implemented as an explicit `web_search: bool` field on `POST /chat/sessions/{id}/messages` — **not** inferred from the message text. Inferring intent from free text ("did they ask for a web search?") is a second LLM call or a fragile keyword match; an explicit checkbox/toggle in the UI that sets this field is unambiguous, cheap, and testable. This is a deliberate simplification the whole-app design doesn't rule out ("explicitly asks... in that message" is satisfied by an explicit per-message control in the UI, not necessarily NL parsing).

When `web_search: true`:
1. Document retrieval is skipped entirely for that turn — no `embed_query` call, no chunk query.
2. `answer_with_web_search(question)` (see `app/services/llm.py` below) is called with Claude's `web_search_20260209` server-side tool enabled.
3. The persisted assistant message has `used_web_search: true`, `citations: []`.

The frontend renders a "Web" badge on any message with `used_web_search: true`, and never renders that badge alongside a "Sources" citations list (citations is always empty when the badge is shown) — this is what keeps the two answer types "never confused," per the whole-app design's explicit requirement.

### Claude invocation: `app/services/llm.py`, model `claude-sonnet-5`

`backend/requirements.txt` has no `anthropic` entry today; add `anthropic==0.117.0` (current stable release as of this writing). `settings.anthropic_api_key` already exists in `app/config.py` — no config changes needed.

New file `backend/app/services/llm.py`, structured like `app/services/embeddings.py` (module-level client, monkeypatchable in tests via `llm._client`):

```python
import anthropic

from app.config import settings

_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

MODEL = "claude-sonnet-5"

SYSTEM_PROMPT = (
    "You are a document assistant. Answer the user's question using ONLY the "
    "document passages provided below. Mention the source filename when you "
    "draw on a passage. If the passages do not contain enough information to "
    "answer the question, say so directly instead of answering from general "
    "knowledge."
)


def answer_from_chunks(question: str, chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
        for c in chunks
    )
    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        thinking={"type": "disabled"},
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Document passages:\n\n{context}\n\nQuestion: {question}",
            }
        ],
    )
    return "".join(block.text for block in message.content if block.type == "text")


def answer_with_web_search(question: str) -> str:
    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[{"type": "web_search_20260209", "name": "web_search"}],
        messages=[{"role": "user", "content": question}],
    )
    return "".join(block.text for block in message.content if block.type == "text")
```

Decisions embedded above:
- **Model:** `claude-sonnet-5` — strong quality/cost balance for grounded Q&A over a handful of short passages; this isn't complex agentic or long-horizon work that would justify Opus-tier cost.
- **Thinking disabled for `answer_from_chunks`:** answering from a handful of already-retrieved passages doesn't benefit from extended reasoning; keeping it off keeps latency and cost down for a chat UI where users expect a quick reply. (Not disabled for `answer_with_web_search` — the server-side web search tool has its own internal loop and thinking interacts with it differently; omitting the field there lets the model decide.)
- **`max_tokens=2048`, non-streaming:** conversational answers over a few short passages don't need the 128K ceiling, and 2048 output tokens stays safely under the SDK's non-streaming timeout guard (~16K threshold) with no streaming-response handling needed in this plan.
- **Response text extraction:** join all `text`-type content blocks. For `answer_from_chunks` there's normally exactly one; for `answer_with_web_search`, Claude's server-side tool loop can interleave multiple text blocks around `web_search_tool_result` blocks, so joining preserves the full answer.

## Backend

Three endpoints, `backend/app/routers/chat.py`, mounted at `/chat`:

### `POST /chat/sessions`

- Gated by `Depends(get_current_user_id)`. No request body.
- Inserts a `chat_sessions` row with `title = 'New Chat'` (no user-supplied title, no rename endpoint — out of scope; a fixed default is simplest and this plan doesn't need per-session naming since there's no session-list UI to display it in).
- Response `201`:
  ```json
  {"id": "uuid", "title": "New Chat", "created_at": "2026-07-18T12:00:00+00:00"}
  ```

### `POST /chat/sessions/{session_id}/messages`

- Gated by `Depends(get_current_user_id)`.
- Request body: `{"content": "What is the refund window?", "web_search": false}` (`web_search` optional, defaults `false`).
- Steps:
  1. `400` if `content.strip()` is empty.
  2. `404` if no `chat_sessions` row with `id = session_id AND user_id = %s` exists (this is the cross-user isolation boundary — a session ID belonging to another user must 404, not leak existence).
  3. Insert the user's message (`role='user'`, the given `content`, `citations=[]`, `used_web_search=false`).
  4. If `web_search` is `true`: call `answer_with_web_search(content)`. Skip retrieval entirely. `used_web_search=true`, `citations=[]`.
  5. Else: `embed_query(content)` → run the thresholded retrieval query above (scoped to `user_id`). If it returns zero rows: assistant content is the fixed string `"I couldn't find relevant information in your uploaded documents to answer that question."`, `citations=[]`, **`answer_from_chunks` is not called** (grounding is enforced by never invoking the LLM when nothing qualifies, not by trusting a prompt). If it returns ≥1 row: call `answer_from_chunks(content, chunks)`; `citations` = the retrieved chunks (each minus `content`), `used_web_search=false`.
  6. Insert the assistant's message with the resulting `content`/`citations`/`used_web_search`.
- Response `201`:
  ```json
  {
    "user_message": {
      "id": "uuid", "role": "user", "content": "...",
      "citations": [], "used_web_search": false, "created_at": "..."
    },
    "assistant_message": {
      "id": "uuid", "role": "assistant", "content": "...",
      "citations": [{"document_id": "...", "filename": "...", "chunk_index": 2, "total_chunks": 5, "score": 0.81}],
      "used_web_search": false, "created_at": "..."
    }
  }
  ```
  Task 2's frontend API client calls this endpoint and consumes this exact response shape.

### Error handling

- Voyage AI embedding failure (`embed_query` raising) surfaces as a `502` — same precedent as Search's design ("Voyage AI embedding failures on the query surface as a 502/503-style error; no automatic retry").
- Claude API failure (`answer_from_chunks`/`answer_with_web_search` raising) also surfaces as a `502`. No retry, no fallback to a canned message — a Claude failure is a genuine backend error, distinct from "nothing was found," and should be visibly distinguishable in logs/monitoring.
- `answer_with_web_search`'s server-side tool loop hitting Anthropic's default iteration limit (`stop_reason: "pause_turn"`) is not handled in this plan — out of scope, matching this codebase's existing precedent of not adding retry/resumption logic for edge cases the design doesn't call out (see Search's "no automatic retry" and Foundation's "no automatic retry loop" for failed preprocessing). If it comes up in practice, the fix is confined to `llm.py`.

## Frontend

- New protected route `/chat` in `App.tsx`, same `<ProtectedRoute>` pattern as `/documents` and `/search`. Search's frontend work (`AppNav`, `SearchPage`, the `/search` route) is present in the working tree as this plan is being written, but is uncommitted, in-flight work from a concurrent task — this plan does not modify `AppNav.tsx` or `SearchPage.tsx`. `App.tsx` is a shared integration point every page's plan adds a route to; this plan adds its own `/chat` route additively alongside whatever Search has already added, without altering Search's routes/imports. It does not add a "Chat" entry to `AppNav` (that would mean editing a file mid-flight in another task) — `ChatPage` instead renders its own plain link back to `/documents` so it's reachable. A future integration pass can fold a Chat link into `AppNav` once both plans are committed.
- `frontend/src/lib/api.ts` additions:
  ```ts
  export type ChatSession = { id: string; title: string; created_at: string }

  export type ChatCitation = {
    document_id: string
    filename: string
    chunk_index: number
    total_chunks: number
    score: number
  }

  export type ChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    citations: ChatCitation[]
    used_web_search: boolean
    created_at: string
  }

  export async function createChatSession(): Promise<ChatSession> { ... }

  export async function sendChatMessage(
    sessionId: string,
    content: string,
    webSearch: boolean,
  ): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> { ... }
  ```
- `ChatPage.tsx`: on mount, calls `createChatSession()` once and stores the returned `id` in state; a single text input + "web search" checkbox + submit; sends via `sendChatMessage`; appends both the returned `user_message` and `assistant_message` to a local list rendered top-to-bottom. Each assistant message renders:
  - A `Web` badge (visible text, e.g. a `<span>Web</span>`) when `used_web_search` is `true`.
  - A "Sources" list (`filename` — "passage N of M") when `citations.length > 0`, using the same 1-indexed `chunk_index + 1` display convention Search uses.
  - Neither when it's the "not found" canned response (`citations` empty, `used_web_search` false).
- States: disable the input/submit while a request is in flight; `role="alert"` error message on request failure, matching `DocumentsPage`/`SearchPage`'s existing error pattern; no empty-state message needed (the chat log itself is the empty state before the first message).

## Error Handling & Edge Cases

- Empty/whitespace-only message rejected client-side (no-op, same as Search's query guard) and server-side (`400`), before any Voyage AI or Claude call.
- A `session_id` that doesn't exist, or belongs to another user, is `404` — verified explicitly in tests, since this is the chat-specific instance of the cross-user isolation requirement that applies to every table this plan touches (`chat_sessions`, `chat_messages`, and the `chunks`/`documents` join reused from Search).
- Nothing clearing the similarity threshold is not an error — it's a normal `201` response with the fixed "not found" message, exactly parallel to how Search's zero-result case is a normal `200` with an empty array, not a `404`.
- Web search opt-in and document-grounded answers are structurally exclusive per turn (step 4 vs. step 5 above) — never both in one message — so the frontend's "never blended" requirement is satisfied by the backend never producing a blended row, not just by frontend rendering choices.
- `quiz_*` tables are not created, migrated, or referenced anywhere in this plan.

## Testing Strategy

- **Backend** (real Postgres+pgvector, matching Search/Foundation's existing test patterns):
  - `POST /chat/sessions` creates a session scoped to the caller's `user_id`.
  - Sending a message with a query that has a chunk clearing the threshold calls `answer_from_chunks` with the expected chunks and persists an assistant message whose `citations` match those chunks and whose `used_web_search` is `false`.
  - Sending a message where no chunk clears the threshold does **not** call `answer_from_chunks` (asserted via mock `assert_not_called`) and persists the fixed "not found" message with empty `citations`.
  - Sending a message with `web_search: true` calls `answer_with_web_search` instead of `embed_query`/`answer_from_chunks`, and persists `used_web_search: true` with empty `citations`.
  - Empty/whitespace message content returns `400` before any embedding/LLM call.
  - A session ID belonging to another user (or a nonexistent one) returns `404`.
  - Retrieval never returns another user's chunks (same cross-user isolation test shape as Search's `test_search_excludes_other_users_chunks`).
  - `embed_query`, `answer_from_chunks`, and `answer_with_web_search` are all mocked at the same module-attribute boundary `embed_query` already is in Search's tests — no live Voyage or Anthropic calls in the regular suite.
- **Frontend**: submitting a message renders both the user's message and the assistant's reply; a response with `citations` renders a Sources list; a response with `used_web_search: true` renders the Web badge and no Sources list; a failed request shows the error message; the protected route wiring works.
- No end-to-end/Playwright tests in this plan — out of scope at the per-plan level, consistent with Foundation and Search.
