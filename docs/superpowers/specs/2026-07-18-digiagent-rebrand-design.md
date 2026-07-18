# DigiAgent Rebrand — Design

A full visual and UX restyle of the existing frontend to match the "DigiAgent" mockup (imported from a Claude Design project, `DigiAgent.dc.html`): a clean, modern SaaS look (dark green sidebar, `Plus Jakarta Sans` font, green accent) replacing the current "vintage reading room" theme (serif fonts, brass/parchment/felt palette). This is a rebrand, not new functionality — the mockup's information architecture (Documents / Search / AI Assistant / Quiz) already matches the app's existing pages 1:1. No backend changes.

## Scope

- Full UX restructuring where the mockup's patterns differ meaningfully from today's (Documents: list → card grid; Chat: plain cards → message bubbles; Quiz: single long form → list/config/flashcard-taking/result flow).
- Dark mode is removed entirely: `ThemeContext`, its toggle, and all `dark:` Tailwind variants are deleted. DigiAgent ships as a single light theme, matching the mockup.
- Login, Signup, and Quiz History are restyled (fonts/colors/buttons) but keep their current structure and routes — the mockup doesn't redesign them.
- Every page keeps its existing data source, mutations, and API contract from `frontend/src/lib/api.ts` — this is a presentation-layer change only.

## Data-honesty adjustments

The mockup includes several pieces of mock data/features with no backing API. These are adapted rather than faked:

- **Storage quota widget** ("6.2 / 20 GB") and static profile ("Sarah Kim / Pro workspace") — no such endpoint exists. Dropped. The sidebar's user block shows the real authenticated user's email (from `AuthContext`) with an initials avatar derived from it; no invented workspace label.
- **File size / page count** on document cards — not present on the `Document` type (`id, user_id, filename, file_type, storage_path, status, error_reason, extracted_text, uploaded_at`). Cards show filename, extension badge, status pill, and upload date only.
- **Upload progress percentage** — `uploadDocument` has no progress callback; processing status is only known via polling (`listDocuments` with `refetchInterval`). The upload queue shows status-labeled rows (Uploading… / Processing… / Indexed / Failed) with an indeterminate animated bar, not a fake numeric percentage.
- **Quiz difficulty picker** (Easy/Medium/Hard) — `generateQuiz(documentIds, numQuestions)` has no difficulty parameter. Dropped from quiz config; only document selection and question-count chips (5/8/10/15) remain.
- **Nav "Documents" badge** — shows the real live document count (`documents.length`), not the mockup's static "4".
- **Search "scope" chips** (All / PDFs only / Recent) — computed client-side from already-fetched results (`file_type`, `uploaded_at` sort), no backend query param added.

## Design tokens

Replaces `frontend/tailwind.config.js`'s `felt/parchment/brass/ink/oxblood/rule` palette and `Fraunces/Work Sans/IBM Plex Mono` fonts with:

- Colors: sidebar `#26333D` (panel `#2F3E49`), accent `#3DA94B` (hover `#2E8F3B`), app background `#F5F7F8`, card border `#E5EAEC`, primary text `#1D2831`, secondary text `#6C7781` / `#8B969D`, danger `#C0392B`, warning `#E0A62E` / `#B4791A`, info-blue `#3161B4` (web-search badge).
- Fonts: `Plus Jakarta Sans` (UI text, replaces both `display`/`body`), `JetBrains Mono` (extension badges, scores, mono labels, replaces `IBM Plex Mono`). Google Fonts `<link>` tags in `frontend/index.html` updated accordingly.
- Radius: buttons ~10px, cards ~14px, large panels ~18px (replacing the flat `rounded-sm` used everywhere today).
- No new runtime dependency — same Tailwind-utility-classes approach as today, just new token values. `tailwind-merge` usage in `ui/` components is unchanged.

## Shared component layer (`frontend/src/components/ui/`)

`Button`, `Card`, `Badge`, `Input`, `Alert`, `CitationStub` are restyled in place (same props/exports, same variants) to the new tokens, with `dark:` variants stripped. No new primitives are introduced except where a page section needs one reused 3+ times (e.g., a `Toggle` switch for the chat web-search control, since the mockup's pill-switch pattern is used only there — kept inline in `ChatPage` rather than promoted to `ui/`, per YAGNI).

## Shell / Navigation

- `ThemeContext.tsx` and its test are deleted; `AppNav`'s theme toggle button is removed.
- `AppNav.tsx`: solid `#26333D` sidebar. Logo mark + "DigiAgent" wordmark at top, "Upload documents" primary button (navigates to `/documents` and opens the upload affordance — see Documents page below), nav list (Documents with live count badge, Search, AI Assistant, Quiz — Quiz History keeps its own link, styled consistently but not merged into Quiz per the approved design), and a bottom user block (initials avatar from email, email text, sign-out button replacing the current no-op chevron).
- `AppShell.tsx`: adds a header bar above `{children}` (page title + subtitle, derived per-route, matching the mockup's header) and a persistent search box that navigates to `/search?q=...` on Enter (reuses the existing `/search` page, just gives it a global entry point). Content area padding/typography updated to the new tokens; the `max-w-3xl` centering is kept per-page rather than global, since Chat and Documents need different widths (matches mockup).
- Login/Signup remain outside `AppShell` (no sidebar), restyled standalone with the new tokens.

## Page treatments

**Documents** (`DocumentsPage.tsx`): card grid replacing the current `<ul>` list — each card shows extension icon-tile, filename, status pill, upload date, and the same 4 action buttons (Preview/Download shown only when `ready`, Rename/Delete always) with identical handlers/confirm dialogs as today. Filter chips (All/PDF/Docs/Text) computed client-side from `file_type`. Drag-and-drop upload zone restyled; when documents are empty, shows the mockup's "Build your knowledge base" empty state instead of just an empty list.

**Upload queue**: documents currently `uploading`/`processing` render as queue rows above/within the grid (same polled data source), with status-label bars per the Data-honesty section above.

**Search** (`SearchPage.tsx`): restyled input/button row, scope chips (client-side filter over already-fetched results), result cards with a mono score badge, and the query term highlighted (`<mark>`) in the passage via a simple case-insensitive substring split — a small enhancement over today's plain text, no backend change.

**Chat** (`ChatPage.tsx`): user messages as right-aligned dark bubbles, assistant messages left-aligned with a small "assistant" icon tile, citation cards per source, and a "Web" badge when `used_web_search` is true — all directly mapped from existing `ChatMessage`/`ChatCitation` fields. Web-search toggle restyled as a pill switch. No streaming (backend sends the full response synchronously, same as today).

**Quiz** (`QuizPage.tsx`, restructured; `QuizHistoryPage.tsx` restyled only): today's linear "select docs → answer all on one page → results" form becomes a 4-view local state machine, still built on the same 3 mutations (`generateQuiz`, `submitQuizAttempt`, `listQuizAttempts`):
- **List** (new default `/quiz` view): stats computed client-side from `listQuizAttempts` (attempts count, average score %, best streak of scores ≥ 80%), a "Generate a new quiz" panel, and a recent-attempts list (same data `QuizHistoryPage` already fetches).
- **Config**: document checklist (same `ready`-only filter as today) + question-count chips (5/8/10/15, replacing the free-number `Input`). No difficulty step.
- **Taking**: one question at a time (flashcard), lettered options, reveal-on-select (colors correct/incorrect immediately, matching today's instant-feedback data but changing the pacing from "all questions visible" to "one at a time"), explanation panel sourced from `source_reference`, progress bar. Answers accumulate locally; `submitQuizAttempt` fires once, after the last question, exactly as today.
- **Result**: score ring (conic-gradient) computed from the same `submitQuizAttempt` response, retake (regenerate same config) / back-to-list actions.

`/quiz/history` keeps its own route showing the full attempts list (same data, restyled), reachable from the sidebar and from the Quiz list view's "see all" if added — not required by the mockup, so only added if trivial.

**Login / Signup**: existing form structure, restyled `Card`/`Input`/`Button`/`Alert` with new tokens; no dark mode.

## Testing strategy

- Existing tests that query by role/label/exact visible text and don't depend on removed structure (list markup, dark-mode classes) continue to pass unchanged — accessible names for buttons/labels/status text are preserved even where visual layout changes (e.g., "Preview", "Download", "Rename", "Delete", status text, error messages).
- `ThemeContext.test.tsx` and any dark-mode-toggle assertions in `AppNav.test.tsx` are removed (feature deleted).
- `QuizPage.test.tsx` is substantially rewritten: the flow changes from "all questions on one page" to "one question at a time with reveal-then-next", so tests are restructured to drive the new step-by-step interaction while asserting the same underlying data (question text, options, correct/incorrect marking, citation/source text, final score) at each step.
- `DocumentsPage.test.tsx`, `SearchPage.test.tsx`, `ChatPage.test.tsx`, `AppNav.test.tsx`, `AppShell.test.tsx` get targeted updates for new markup/queries (e.g., grid instead of list, scope chips, bubble roles) while keeping assertions on unchanged data/copy.
- New tests added only for genuinely new interactive behavior: quiz view-state transitions (list→config→taking→result→back), search term highlighting, client-side filter chips.
- Verification gate: `cd frontend && npx tsc --noEmit && npm test -- --run` must pass in full before this is considered done. No visual/screenshot testing.
