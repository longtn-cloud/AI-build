# Search (Plan 2 of 4) — Design

Extends the "Search" section of `docs/superpowers/specs/2026-07-17-document-knowledge-assistant-design.md` with the concrete decisions needed to implement it. Builds directly on Foundation (Plan 1): `documents`/`chunks` tables, `embed_query`/`embed_texts` (Voyage AI), and the per-user `WHERE user_id = %s` isolation pattern.

## Scope

Pure retrieval only — no LLM generation, no new tables. A dedicated `/search` page where a user queries their own documents and gets back ranked raw passages. Chat Q&A (Plan 3) will reuse this same retrieval but add an LLM layer and a minimum-similarity threshold for grounding; Search does not need a threshold since it displays raw ranked results rather than asserting an answer.

## Decisions

**Location/citation granularity:** The `chunks` table has no `location_metadata` column — no page-number tracking exists anywhere in extraction today. Rather than reworking Foundation's extraction/chunking to preserve page boundaries, Search shows a coarse position instead: `chunk_index` (1-based) out of the document's total chunk count, e.g. "passage 3 of 12". Real page numbers are deferred as a future enhancement, not part of this plan.

**Result count/threshold:** Always return the top 10 chunks by cosine similarity, ranked best-first, no minimum-similarity cutoff. A user with zero ready documents/chunks simply gets an empty `results` array — the same empty state serves "no documents yet" and "no relevant matches," since the plan doesn't need to distinguish them.

## Backend

- `GET /search?q=<query>`, gated by `Depends(get_current_user_id)` (same as every `/documents` route).
- Steps: validate `q` is non-empty (`400` otherwise) → `embed_query(q)` → pgvector cosine-similarity query over `chunks` joined to `documents` filtered by `documents.user_id = %s` (the join is required because `chunks` itself has no `user_id` column) → `ORDER BY embedding <=> %s LIMIT 10`.
- Response shape:
  ```json
  {
    "results": [
      {
        "document_id": "uuid",
        "filename": "report.pdf",
        "chunk_index": 2,
        "total_chunks": 12,
        "content": "...chunk text...",
        "score": 0.83
      }
    ]
  }
  ```
  `total_chunks` is a per-document chunk count needed to render "passage N of M" — computed alongside the ranked query (e.g. a window function or a small per-document count map), not a stored column.
- Voyage AI embedding failures on the query surface as a `502`/`503`-style error; no automatic retry (matches Foundation's preprocessing precedent).

## Frontend

- New protected route `/search` (same `<ProtectedRoute>` pattern as `/documents`), with a nav link added alongside Documents.
- Single text input + submit (Enter or a button) — no live-as-you-type, no filters/facets.
- Results render as cards: filename, "passage N of M", and the chunk's text content, in ranked order.
- States: nothing shown before the first search; loading indicator while in flight; `role="alert"` error message on request failure (matching `DocumentsPage`'s existing error pattern); explicit empty-state message ("No results found") only after a search has actually run and returned zero results.
- New `frontend/src/lib/api.ts` function: `search(query: string): Promise<SearchResult[]>`.

## Error Handling & Edge Cases

- Empty/whitespace-only query rejected client-side (no-op) and server-side (`400`), before any Voyage AI or DB call.
- No documents/chunks yet is not a distinct backend case — query naturally returns zero rows; frontend's single empty-state message covers it.
- Voyage AI failure on the query embed surfaces a generic "Search failed, try again" message; no retry logic.
- Cross-user isolation via the `documents.user_id = %s` join filter is the single most important thing to get right and verify — same as every prior task touching `chunks`/`documents`.
- No explicit query length cap; Voyage AI's own input limits apply, and any failure there falls into the generic embedding-failure case.

## Testing Strategy

- **Backend** (real Postgres+pgvector, matching existing test patterns): a query with a real matching chunk is returned and ranked first; a user's search never returns another user's chunks (cross-user isolation); empty/whitespace query returns `400`; a user with zero chunks gets an empty `results` array. `embed_query` is mocked at the same boundary `embed_texts` already is in upload/processing tests — no live Voyage calls in the regular suite.
- **Frontend**: submitting a query renders returned results; zero results shows the empty state; a failed request shows the error message; the protected route/nav wiring works.
- No end-to-end/Playwright tests in this plan — out of scope at the per-plan level, consistent with Foundation.
