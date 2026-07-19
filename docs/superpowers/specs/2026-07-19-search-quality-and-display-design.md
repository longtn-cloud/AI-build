# Search Quality & Result Display — Design

Extends `docs/superpowers/specs/2026-07-18-search-design.md`. That plan shipped pure vector-only retrieval with a fixed top-10, a naive substring highlight, and two scope pills ("PDFs only" / "Recent") that were never wired to real filtering. This plan replaces vector-only ranking with hybrid (keyword + vector) ranking, makes filters real and server-side, and reworks result display (grouping, multi-term highlighting, pagination, relevance indicator).

## Scope

Still pure retrieval only — no LLM generation, no new tables beyond one added column. Builds on the existing `documents`/`chunks` schema and `embed_query` (Gemini, 384-dim).

## Decisions

**Hybrid ranking via Reciprocal Rank Fusion (RRF):** Vector-only search ranks by semantic closeness, so a chunk containing an exact rare term, ID, or acronym can rank poorly if its embedding isn't semantically close to the query embedding. Fix: rank chunks independently by full-text search (`ts_rank_cd` over a new `tsvector` column) and by vector distance, each capped at a candidate pool of 50, then fuse with `1/(60+rank_fts) + 1/(60+rank_vec)` (0 contribution if a chunk is absent from that pool). This was chosen over a weighted normalized-score blend (fragile — the two signals have unrelated scales, weights are arbitrary to tune) and over reranking-vector's-own-top-N (doesn't solve the actual problem, since a strong keyword-only match that never lands in vector's top-N can't be reranked in).

**Relevance score normalization:** RRF's raw score has a fixed theoretical max (`2/61 ≈ 0.0328`, when a chunk ranks #1 on both signals). Divide by that constant to get a stable 0–100% "match strength" that means the same thing across pages and across queries (unlike per-page min-max normalization, which would shift meaning as the result set changes).

**Filters become real and server-side:** `file_type` (pdf/docx/txt/md, or all) and `recent` (uploaded within the last 30 days) are applied in the SQL `WHERE` clause, before ranking — not as a client-side trim of an already-limited result set (today's bug: "PDFs only" can hide results that exist beyond the top 10 fetched). The two filters are independent, not mutually exclusive scopes — a user can want recent PDFs — so the frontend replaces the single scope-pill row with two separate controls (file-type selector + a "Recent" toggle).

**Pagination:** Fixed page size of 10. Since the fused candidate pool is capped at ~100 unique chunks (50 FTS + 50 vector, deduplicated), pagination operates within that pool via `offset`. Response includes `has_more` so the frontend can render a "Load more" button instead of a numbered pager.

**Grouping by document:** Results are grouped by `document_id`, ordered by each document's best-scoring chunk. Each card shows up to 3 passages for that document with a "+N more passages" indicator if more matched within the current page's results. No cross-page re-grouping — grouping only applies within one fetched page.

**Highlighting:** Query is tokenized into whitespace-separated terms (deduplicated, length ≥ 2). Every case-insensitive occurrence of every term is highlighted in each snippet via a single combined regex, replacing today's "first literal full-query substring" match. No stemming/fuzzy matching — highlighting is cosmetic, not tied to what FTS actually matched internally.

**No relevance floor:** Consistent with the original Search plan, weak matches are still shown (no minimum-score cutoff) — the pagination + relevance indicator communicate match strength instead of hiding results.

## Backend

- **Migration** (`0004_search_fts.sql`): add `content_tsv tsvector generated always as (to_tsvector('english', content)) stored` to `chunks`, plus a GIN index on it.
- **`GET /search`** query params: `q` (required, non-empty), `file_type` (optional: `pdf`|`docx`|`txt`|`md`; omitted = all), `recent` (optional bool), `offset` (default 0, page size fixed at 10 server-side).
- Query shape (single SQL statement, CTEs):
  1. `filtered`: `chunks` joined to `documents`, filtered by `documents.user_id = %s` plus optional `file_type`/`uploaded_at >= now() - interval '30 days'`.
  2. `vec_candidates`: from `filtered`, top 50 by `embedding <=> query_embedding`, with `row_number()` as `vec_rank`.
  3. `fts_candidates`: from `filtered`, where `content_tsv @@ websearch_to_tsquery('english', q)`, top 50 by `ts_rank_cd(content_tsv, websearch_to_tsquery('english', q))` desc, with `row_number()` as `fts_rank`.
  4. Full outer join `vec_candidates`/`fts_candidates` on chunk id → `fused_score = coalesce(1.0/(60+vec_rank),0) + coalesce(1.0/(60+fts_rank),0)`.
  5. Order by `fused_score` desc, `LIMIT 10 OFFSET %s`; a second lightweight query (or `count(*) over()`) determines `has_more`.
  - `websearch_to_tsquery` is used (not `plainto_tsquery`) so the query box behaves intuitively with quoted phrases/`OR`.
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
        "score": 0.71
      }
    ],
    "has_more": true
  }
  ```
  `score` is the fused score divided by `2/61`, clamped to `[0, 1]`.
- Gemini embedding failures on the query still surface as a `502`/`503`-style error, matching current behavior — unchanged.

## Frontend

- Filter controls: a file-type selector (All / PDF / DOCX / Text — "Text" covers both `txt` and `md`) and an independent "Recent" toggle, both replacing the current single-select `SCOPES` pill row. Changing either triggers a real refetch (both are part of the React Query key alongside `q`).
- `search()` in `frontend/src/lib/api.ts` gains `fileType`/`recent`/`offset` params and returns `{ results, has_more }` instead of a bare array.
- Results are grouped client-side by `document_id` (grouping only within the currently-loaded page, appended page-by-page on "Load more" — no cross-page re-sort). Each group renders as one card: filename heading, up to 3 passages, "+N more passages in this document" text if the page contains more.
- Highlighting: replace `highlight()`'s first-substring logic with tokenization + a single combined case-insensitive regex over all query terms, wrapping every match in the existing `<mark>` styling.
- Relevance indicator: a small bar/badge per document card sized from that document's best passage's `score` (0–100%).
- "Load more" button appended below results when `has_more` is true; clicking fetches the next `offset` and appends (not replaces) results, re-grouping the combined set by document.

## Error Handling & Edge Cases

- Empty/whitespace query: unchanged — rejected client-side as a no-op, `400` server-side before any embedding/DB call.
- Zero results (no matches in either FTS or vector pool, or user has no chunks): unchanged empty-state message, now also implies `has_more: false`.
- A document with no chunks in the *current page* but present in a later page: grouping is page-local, so the same document could theoretically appear as a second group after "Load more" if its remaining passages fall on a later page — acceptable, not deduplicated across pages (documented here rather than silently working around it, since doing otherwise requires carrying cross-page state).
- `recent`/`file_type` filters combine with `AND` (e.g. "recent" + "pdf" = recent PDFs only), consistent with them being independent controls rather than mutually exclusive scopes.
- Cross-user isolation (`documents.user_id = %s`) remains the single most important invariant, applied in the shared `filtered` CTE before both ranking branches.

## Testing Strategy

- **Backend** (real Postgres+pgvector+FTS, matching existing test patterns):
  - A chunk with a strong exact-term/keyword match but a poor embedding similarity still surfaces in results (the core hybrid-ranking regression test — proves this isn't just vector-only with extra steps).
  - A chunk with strong embedding similarity but no keyword overlap still surfaces (proves FTS-only isn't now the sole signal).
  - `file_type` filter excludes non-matching documents; `recent` filter excludes documents older than 30 days; both combine with `AND`.
  - Pagination: `offset`/`has_more` behave correctly across a result set larger than one page.
  - Cross-user isolation, empty query rejection, zero-chunks empty state: unchanged from the existing suite, kept passing.
- **Frontend**:
  - The two filter controls each independently trigger a refetch with the right params, and can be combined.
  - Grouping renders multiple passages under one document heading with correct "+N more" counts.
  - Highlighting marks every occurrence of every query term, not just the first literal substring.
  - "Load more" appends rather than replaces, and disappears when `has_more` is false.
