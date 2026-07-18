# UI Styling Pass — Design

The frontend (Foundation, Search, Chat Q&A, Quiz) currently has zero styling — plain unstyled HTML across every page. This adds a Tailwind CSS-based visual design system: neutral grays with an indigo accent, light/dark theme with a toggle, and a small shared component layer, applied consistently across all existing pages without changing any page's behavior, copy, or accessible structure.

## Scope

Purely visual/presentational. No new routes, no new backend calls, no changes to component logic, state, or data flow. Every existing test's `getByRole`/`getByLabelText`/`getByText` query must keep matching identical visible text, labels, and roles — this is a markup/class-wrapper change, not a rewrite.

Two pre-existing navigation gaps are fixed as part of this pass, since they live in the exact components (`AppNav`, `App.tsx`'s route wrapping) being restyled:
- `AppNav` has no links to `/chat` or `/quiz/history` — only reachable by typing the URL.
- The `/chat` route in `App.tsx` doesn't render `<AppNav />` at all (every other protected route does); `ChatPage` compensates with its own hardcoded `<Link to="/documents">`.

## Decisions

**Setup:** `tailwindcss`, `postcss`, `autoprefixer` added as frontend dev dependencies. Standard Vite + PostCSS integration: `tailwind.config.js` (`darkMode: 'class'`, `content` globbing `src/**/*.{ts,tsx}`), `postcss.config.js`, and a new `src/index.css` with the three `@tailwind` directives, imported once in `src/main.tsx`. No other new runtime dependency — no headless UI library, no CSS-in-JS, no icon package (inline SVG or text where needed).

**Component layer** (`src/components/ui/`): thin, stateless, Tailwind-class-only wrappers, each doing exactly one thing:
- `Button` — variants `primary` (indigo, filled) / `secondary` (gray, outline) / `danger` (red, for delete actions); renders a native `<button>`, forwards `type`/`disabled`/`onClick`/children untouched so existing `getByRole('button', { name })` queries keep matching.
- `Input` — styled `<input>`, forwards all props; paired with existing `<label htmlFor>` markup as-is (no change to label/id wiring).
- `Card` — padded, bordered, rounded container (`bg-white dark:bg-gray-900`) used for list items, form containers, message bubbles.
- `Badge` — small colored pill, variant per document status (`uploading`/`processing`/`ready`/`failed` → gray/blue/green/red) and reused for chat's "Web" indicator (amber).
- `Alert` — wraps the existing `<p role="alert">` error pattern with red styling; role and text content unchanged.

None of these introduce new behavior or new test surface beyond trivial rendering — they're styling wrappers around markup that already exists inline in each page today.

**Dark mode:** A new `ThemeContext` (`src/contexts/ThemeContext.tsx`) holds `theme: 'light' | 'dark'` and a `toggleTheme` function. On mount, it reads `localStorage.getItem('theme')`; if absent, it falls back to `window.matchMedia('(prefers-color-scheme: dark)')`. Whenever `theme` changes, it sets/removes the `dark` class on `document.documentElement` and writes the explicit choice to `localStorage`. Every styled component pairs light/dark utilities directly (`bg-white dark:bg-gray-900`, `text-gray-900 dark:text-gray-100`, etc.) — no CSS custom properties layer, since Tailwind's `class` strategy already covers this natively. A toggle button (sun/moon icon, inline SVG) lives in the navbar.

**Layout & navigation:** A new `AppShell` component (`src/components/AppShell.tsx`) renders the navbar (via `AppNav`) plus a centered, max-width (`max-w-4xl mx-auto px-4 py-8`) content area, and wraps `{children}`. `App.tsx` is updated so every protected route renders `<AppShell><PageComponent /></AppShell>` instead of manually repeating `<AppNav />` next to each page element — this is what fixes the `/chat` route's missing nav, as a natural consequence of consolidating the wrapping rather than as a special-cased patch. `AppNav` gains `Chat` (`/chat`) and `Quiz History` (`/quiz/history`) links alongside the existing three, plus indigo-accented active-link styling (`useLocation` to compare against `pathname`). `ChatPage`'s own hardcoded `<Link to="/documents">Documents</Link>` is removed since `AppShell`'s nav now covers every protected page uniformly.

## Page treatments

- **Login / Signup:** centered `Card` containing the existing form; inputs/buttons use the new `Input`/`Button` components; error `Alert` above the fields; the existing "No account? Sign up" / "Already have an account? Log in" links keep their exact text.
- **Documents:** each document renders as a `Card` row: filename, a `Badge` for status, and action `Button`s (Preview/Download shown only when ready, Rename/Delete always) — matching today's conditional rendering exactly. Upload input keeps its existing label/id.
- **Search:** query `Input` + `Button` in a row; each result renders as a `Card` (filename — "passage N of M" as a small muted heading, content as body text); loading/empty/error states keep their exact existing text, just styled.
- **Chat:** message thread as stacked `Card`s distinguishing user vs. assistant (alignment/color), citations rendered as a small muted list under the assistant message, the "Web" `Badge` in amber to visually separate web-sourced answers from document-grounded ones per the whole-app design's requirement that the two are "never confused". Input row pinned below the thread with the existing checkbox label preserved.
- **Quiz:** document selection checkboxes rendered as selectable `Card`s (existing `<label>`/`<input type="checkbox">` pairing unchanged so `getByLabelText(doc.filename)` keeps working); each question as a `Card` with radio options as selectable rows; submitted results color-code each question's row (green if correct, red if incorrect) while keeping the exact existing text content (`"{score} / {total_questions}"`, "your answer:", "correct answer:", the source-reference line).
- **Quiz History:** each attempt as a simple `Card` row; existing joined text line (`"{score} / {total_questions} — {filenames} — {completed_at}"`) unchanged, just styled.

## Error Handling & Edge Cases

- No behavioral error handling changes anywhere — every `catch`/error-state path already present keeps its exact message text; only the `Alert` wrapper's visual treatment is new.
- Theme detection has no failure mode worth handling: `localStorage` and `matchMedia` are both always available in the supported browser target; no fallback logic beyond the default light/dark check already described.
- No new loading/empty states are introduced — all existing ones (`Searching...`, `No results found`, `No quiz attempts yet`, `Loading...` in `ProtectedRoute`) are restyled in place, not replaced.

## Testing Strategy

- **No existing test file changes required.** Every current test queries by role, label, or exact visible text, none of which change — Tailwind classes and wrapper components are invisible to Testing Library's accessibility-tree queries.
- **New tests:**
  - `AppNav.test.tsx` gains assertions for the two new links (`Chat` → `/chat`, `Quiz History` → `/quiz/history`).
  - A new `ThemeContext`/toggle test: default theme follows `prefers-color-scheme` when no stored preference exists; toggling flips the `dark` class on `<html>` and persists to `localStorage`.
  - A new `AppShell` test (or folded into an `App.tsx` routing test): confirms `/chat` now renders the nav alongside `ChatPage`.
- **Verification:** `cd frontend && npx tsc --noEmit && npm test -- --run` must pass in full (all pre-existing tests unchanged, plus the small set of new ones above) before this is considered done. No visual/screenshot testing — out of scope.
