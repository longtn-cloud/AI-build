# React Query Migration — Design

Replaces the frontend's hand-rolled `useState`/`useEffect`/try-catch data-fetching pattern (repeated across every page) with `@tanstack/react-query` for all server-state interactions: queries (reads) and mutations (writes) alike.

## Scope

Every page's server-state handling (Documents, Search, Chat, Quiz, Quiz History) migrates to `useQuery`/`useMutation`. Out of scope: `getDownloadUrl` and `getPreviewText` stay plain imperative async calls (a one-off signed-URL fetch on click, and a one-shot preview fetch tied to a modal's open state) — neither is a cacheable server-state resource worth forcing into the query/mutation shape. The already-agreed-fine StrictMode double-fetch-in-dev behavior is unaffected either way and isn't part of this change.

## Decisions

**Package:** `@tanstack/react-query` (current maintained package; the old `react-query` npm name is deprecated). No devtools package included.

**QueryClient setup:** One `QueryClient` instance created in `frontend/src/main.tsx`, wrapping `<App>` in `QueryClientProvider` (nested inside `ThemeProvider`, outside `BrowserRouter` — order doesn't matter functionally between these three, but keeping `ThemeProvider` outermost matches its current position). Global `defaultOptions`: `queries: { retry: false }`, `mutations: { retry: false }`. This is required, not optional: `apiFetch` (`frontend/src/lib/api.ts`) already signs the user out and throws on a 401; React Query's default retry-with-backoff would redundantly re-attempt (and redundantly re-trigger sign-out logic) up to 3 times before surfacing the error, changing today's "fails once, shows the error immediately" behavior. `retry: false` preserves it exactly.

**Query keys** (single source of truth, avoid ad hoc string arrays scattered across files): a small `frontend/src/lib/queryKeys.ts` exporting:
```ts
export const queryKeys = {
  documents: ['documents'] as const,
  chatSession: ['chatSession'] as const,
  quizAttempts: ['quizAttempts'] as const,
}
```

**Per-page mapping:**

- **DocumentsPage** — `useQuery({ queryKey: queryKeys.documents, queryFn: listDocuments })`, with `refetchInterval: (query) => query.state.data?.some(d => d.status === 'uploading' || d.status === 'processing') ? 3000 : false`, replacing the current manual `setInterval` effect entirely (both the effect and its cleanup). `uploadDocument`, `renameDocument`, `deleteDocument` become `useMutation`s whose `onSuccess` calls `queryClient.invalidateQueries({ queryKey: queryKeys.documents })` — replacing every current manual `await refresh()` call after a mutation succeeds.
- **SearchPage** — `useMutation({ mutationFn: search })`, triggered via `mutate(query)` on form submit. Modeled as a mutation, not a query: this is a one-shot action on arbitrary user-typed text with no revisit-by-key caching value, matching today's explicit "click Search, get a result" interaction more directly than the query-key model would.
- **ChatPage** — `useQuery({ queryKey: queryKeys.chatSession, queryFn: createChatSession, staleTime: Infinity })` for the once-per-visit session (never silently refetched once obtained); `useMutation({ mutationFn: (vars) => sendChatMessage(vars.sessionId, vars.content, vars.webSearch) })` for sending a message.
- **QuizPage** — reuses `useQuery({ queryKey: queryKeys.documents, queryFn: listDocuments })` (same key as DocumentsPage — free cache sharing, no duplicate fetch if Documents was already visited this session). `generateQuiz` and `submitQuizAttempt` become `useMutation`s; a successful `submitQuizAttempt` also calls `queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts })` so Quiz History reflects the new attempt without a manual reload.
- **QuizHistoryPage** — `useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })`.

**`api.ts` functions are unchanged** — they remain the `queryFn`/`mutationFn`s passed into React Query, not rewritten. This migration only changes how pages *call* them and *hold their results*, not the functions themselves.

## Error Handling & Edge Cases

- Every page's existing error message text (`'Failed to load documents'`, `'Search failed, try again'`, etc.) is preserved exactly — surfaced via each `useQuery`/`useMutation`'s `error` state instead of a manually-managed `error` `useState`, rendered through the same `<Alert>` component as today.
- The existing 401 → sign-out behavior in `apiFetch` is unchanged; `retry: false` (above) ensures it still fires on the very first failure, not after retries.
- Mutation loading state (`isPending`) replaces each page's manual `loading`/`sending` `useState`, disabling the relevant submit button identically to today.

## Testing Strategy

- New shared test helper, `frontend/src/test-utils.tsx`, exporting a `renderWithQueryClient` wrapping Testing Library's `render` with a fresh `QueryClientProvider` per call (`retry: false` on both queries and mutations, matching production defaults) — used by every page test file in place of a bare `render()`.
- Existing `vi.mock('../lib/api', ...)` mocks are unchanged and continue to work — they're still the underlying `queryFn`/`mutationFn`s; only the render call changes.
- Every existing test assertion (button names, label text, error text, result text) stays the same — this is an internal-implementation change, not a behavior change, so no test's expected outcome changes.
- The `DocumentsPage` polling test (fake timers + interval) needs explicit verification that `vi.useFakeTimers()`/`vi.advanceTimersByTimeAsync()` drives React Query's `refetchInterval` scheduling the same way it drove the old manual `setInterval` — this is flagged as a real risk to verify during implementation, not assumed to just work.
