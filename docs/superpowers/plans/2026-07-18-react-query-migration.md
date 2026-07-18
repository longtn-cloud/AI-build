# React Query Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the frontend's hand-rolled `useState`/`useEffect`/try-catch data-fetching pattern with `@tanstack/react-query` (queries + mutations) across every page.

**Architecture:** One `QueryClient` wraps the app in `main.tsx`. Each page's server-state reads become `useQuery`, writes become `useMutation` with cache invalidation replacing manual `refresh()` calls. `frontend/src/lib/api.ts`'s functions are unchanged — they become the `queryFn`/`mutationFn`s passed into React Query, not rewritten.

**Tech Stack:** Adds `@tanstack/react-query` to the existing React 18 / Vite / TypeScript / Vitest + Testing Library frontend.

## Global Constraints

- Global `QueryClient` defaults: `queries: { retry: false, refetchOnWindowFocus: false }`, `mutations: { retry: false }`. Required, not optional: `apiFetch` (`frontend/src/lib/api.ts`) already signs the user out and throws on a 401; React Query's default retry-with-backoff would redundantly re-attempt (and redundantly re-trigger sign-out) up to 3 times before surfacing the error, changing today's "fails once, shows the error immediately" behavior.
- Query keys live in one place, `frontend/src/lib/queryKeys.ts` — never inline string arrays scattered across pages.
- `getDownloadUrl` and `getPreviewText` stay plain imperative async calls — out of scope, not forced into query/mutation shape.
- Every existing test's visible text, labels, roles, and call-argument assertions stay exactly as they are today — this is an internal-implementation migration, not a behavior change. No test's expected *outcome* changes in this plan; only the render helper (`renderWithQueryClient` instead of bare `render`) and, where noted, an assertion's wrapping (see Task 2) change.
- No task in this plan adds a new test case — this migrates existing coverage, it doesn't add new behavior to cover.

---

### Task 1: Install React Query, QueryClient setup, shared test helper

**Files:**
- Modify: `frontend/package.json` (via `npm install`)
- Create: `frontend/src/lib/queryKeys.ts`
- Modify: `frontend/src/main.tsx`
- Create: `frontend/tests/test-utils.tsx`

**Interfaces:**
- Produces: `queryKeys` object (`frontend/src/lib/queryKeys.ts`) with `documents`, `chatSession`, `quizAttempts` keys, consumed by every later task. `renderWithQueryClient(ui, options?)` (`frontend/tests/test-utils.tsx`), consumed by every page test file in later tasks.

No new/failing test in this task — nothing consumes React Query yet, so there's no new behavior to assert. Verification is: the app still builds and every existing test still passes with the new dependency and provider wired in but unused.

- [ ] **Step 1: Install the dependency**

Run: `cd frontend && npm install @tanstack/react-query`

This updates `package.json`/`package-lock.json` in place with whatever version npm resolves.

- [ ] **Step 2: Create the query key registry**

Create `frontend/src/lib/queryKeys.ts`:

```ts
export const queryKeys = {
  documents: ['documents'] as const,
  chatSession: ['chatSession'] as const,
  quizAttempts: ['quizAttempts'] as const,
}
```

- [ ] **Step 3: Wire QueryClientProvider into the app entry point**

Replace `frontend/src/main.tsx` in full:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import { ThemeProvider } from './contexts/ThemeContext'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
```

- [ ] **Step 4: Create the shared test render helper**

Create `frontend/tests/test-utils.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, RenderOptions } from '@testing-library/react'
import { ReactElement } from 'react'

export function renderWithQueryClient(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options)
}
```

- [ ] **Step 5: Verify nothing broke and the app still builds**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 66 tests, all passing (unchanged — nothing consumes React Query yet).

Run: `cd frontend && npm run build`
Expected: production build succeeds (confirms the new provider code compiles and bundles correctly even though no test exercises `main.tsx` directly — `App.test.tsx` renders `<App />` directly, bypassing `main.tsx`'s wrapping providers, same as it already does for `ThemeProvider` today).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/queryKeys.ts frontend/src/main.tsx frontend/tests/test-utils.tsx
git commit -m "chore: install React Query and wire up QueryClientProvider"
```

---

### Task 2: Migrate DocumentsPage

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Modify: `frontend/tests/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `queryKeys.documents` (Task 1), `renderWithQueryClient` (Task 1).

This is the highest-risk task in the plan: React Query's `refetchInterval` scheduling may behave subtly differently from the current hand-written `setInterval` under `vi.useFakeTimers()`. Treat the polling test's expected call counts as a hypothesis to verify, not a certainty — if `python -m pytest`-style exact counts don't match on the first run, diagnose why (log `documentsQuery.dataUpdatedAt`/call counts, check whether `refetchInterval` fired when expected) rather than guessing a different number blindly.

Also note: two assertions that were previously bare (immediately after a `waitFor` block, relying on same-tick timing) are wrapped in their own `waitFor` below. This isn't cosmetic — React Query's mutation-success → cache-invalidation → refetch chain has different microtask timing than the original code's single sequential `await uploadDocument(file); await refresh()`, and this codebase has hit exactly this class of flakiness before (see commit `b9ddcd2`, "wait for rendered document checkbox instead of mock-call in QuizPage tests"). Wrapping the follow-up count assertion in `waitFor` makes the test robust to that timing difference instead of assuming a specific microtask ordering.

- [ ] **Step 1: Replace DocumentsPage.tsx**

Replace `frontend/src/pages/DocumentsPage.tsx` in full:

```tsx
import { ChangeEvent, DragEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import {
  DocumentListItem,
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../lib/api'
import { PreviewModal } from '../components/PreviewModal'
import { queryKeys } from '../lib/queryKeys'

const STATUS_VARIANT = {
  uploading: 'gray',
  processing: 'blue',
  ready: 'green',
  failed: 'red',
} as const

export function DocumentsPage() {
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DocumentListItem | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
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

  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError('Failed to upload document'),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      renameDocument(id, filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError('Failed to rename document'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
    onError: () => setError('Failed to delete document'),
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
    const newName = window.prompt('New filename', doc.filename)
    if (!newName) return
    renameMutation.mutate({ id: doc.id, filename: newName })
  }

  function handleDelete(doc: DocumentListItem) {
    if (!window.confirm(`Delete ${doc.filename}?`)) return
    deleteMutation.mutate(doc.id)
  }

  async function handleDownload(doc: DocumentListItem) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError('Failed to download document')
    }
  }

  const displayError = documentsQuery.isError ? 'Failed to load documents' : error

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-parchment">Your Documents</h1>
      {displayError && <Alert>{displayError}</Alert>}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          isDraggingOver
            ? 'rounded-sm border-2 border-brass bg-brass/10 p-4'
            : 'rounded-sm border-2 border-dashed border-brass/40 p-4'
        }
      >
        <label
          htmlFor="upload-input"
          className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
        >
          Upload document
        </label>
        <p className="mb-2 font-body text-sm text-parchment/70">
          Drag a file here, or click to browse
        </p>
        <input
          id="upload-input"
          type="file"
          onChange={handleUpload}
          className="block font-body text-sm text-parchment file:mr-4 file:rounded-sm file:border file:border-brass/50 file:bg-transparent file:px-3 file:py-2 file:font-mono file:text-xs file:uppercase file:tracking-wide file:text-brass hover:file:bg-brass/10"
        />
      </div>
      <ul className="space-y-3">
        {documents.map((doc) => (
          <li key={doc.id}>
            <Card className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="font-body font-medium text-ink dark:text-parchment">
                  {doc.filename}
                </span>
                <Badge variant={STATUS_VARIANT[doc.status]}>({doc.status})</Badge>
              </div>
              <div className="flex gap-2">
                {doc.status === 'ready' && (
                  <>
                    <Button variant="secondary" onClick={() => setPreviewing(doc)}>
                      Preview
                    </Button>
                    <Button variant="secondary" onClick={() => handleDownload(doc)}>
                      Download
                    </Button>
                  </>
                )}
                <Button variant="secondary" onClick={() => handleRename(doc)}>
                  Rename
                </Button>
                <Button variant="danger" onClick={() => handleDelete(doc)}>
                  Delete
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Replace DocumentsPage.test.tsx**

Replace `frontend/tests/pages/DocumentsPage.test.tsx` in full:

```tsx
import { act, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDownloadUrl: vi.fn(),
}))

import {
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../../src/lib/api'
import { DocumentsPage } from '../../src/pages/DocumentsPage'

const readyDoc = {
  id: '1',
  filename: 'report.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  uploaded_at: '2026-01-01T00:00:00Z',
}

describe('DocumentsPage', () => {
  it('renders the list of documents', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])

    renderWithQueryClient(<DocumentsPage />)

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })
  })

  it('uploads a selected file and refreshes the list', async () => {
    ;(listDocuments as any).mockResolvedValue([])
    ;(uploadDocument as any).mockResolvedValue({
      id: '2',
      filename: 'notes.txt',
      file_type: 'txt',
      status: 'uploading',
      uploaded_at: '2026-01-01T00:00:00Z',
    })

    renderWithQueryClient(<DocumentsPage />)
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1))

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const input = screen.getByLabelText('Upload document') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalledWith(file)
    })
    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledTimes(2)
    })
  })

  it('uploads a dropped file and refreshes the list', async () => {
    ;(listDocuments as any).mockResolvedValue([])
    ;(uploadDocument as any).mockResolvedValue({
      id: '4',
      filename: 'dropped.pdf',
      file_type: 'pdf',
      status: 'uploading',
      uploaded_at: '2026-01-01T00:00:00Z',
    })

    renderWithQueryClient(<DocumentsPage />)
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1))

    const file = new File(['hello'], 'dropped.pdf', { type: 'application/pdf' })
    const input = screen.getByLabelText('Upload document')
    fireEvent.drop(input, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalledWith(file)
    })
    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledTimes(2)
    })
  })

  it('renames a document', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(renameDocument as any).mockResolvedValue({ ...readyDoc, filename: 'renamed.pdf' })
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('renamed.pdf'))

    renderWithQueryClient(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(renameDocument).toHaveBeenCalledWith('1', 'renamed.pdf')
    })
    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledTimes(2)
    })
  })

  it('deletes a document after confirmation', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(deleteDocument as any).mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    renderWithQueryClient(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteDocument).toHaveBeenCalledWith('1')
    })
    await waitFor(() => {
      expect(listDocuments).toHaveBeenCalledTimes(2)
    })
  })

  it('opens the download URL when Download is clicked', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.pdf')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderWithQueryClient(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://signed.example/file.pdf', '_blank')
    })
  })

  it('polls while a document is processing and stops once ready', async () => {
    vi.useFakeTimers()
    try {
      const processingDoc = { ...readyDoc, id: '3', status: 'processing' as const }
      ;(listDocuments as any)
        .mockResolvedValueOnce([processingDoc])
        .mockResolvedValueOnce([{ ...processingDoc, status: 'ready' as const }])

      const { unmount } = renderWithQueryClient(<DocumentsPage />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(listDocuments).toHaveBeenCalledTimes(1)
      expect(screen.getByText('(processing)')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(listDocuments).toHaveBeenCalledTimes(2)
      expect(screen.getByText('(ready)')).toBeInTheDocument()

      // No further polling once nothing is pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(listDocuments).toHaveBeenCalledTimes(2)

      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not poll when all documents are already ready', async () => {
    vi.useFakeTimers()
    try {
      ;(listDocuments as any).mockResolvedValue([readyDoc])

      renderWithQueryClient(<DocumentsPage />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(listDocuments).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(listDocuments).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/DocumentsPage.test.tsx`
Expected: 8 passed. If the polling tests fail on exact call counts, read the Task 2 preamble above before changing anything — diagnose the actual timing with `console.log`/inspection rather than guessing a new number.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 66 tests, all passing (no count change — same 8 tests in this file, migrated not added to).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/tests/pages/DocumentsPage.test.tsx
git commit -m "refactor: migrate DocumentsPage to React Query"
```

---

### Task 3: Migrate SearchPage

**Files:**
- Modify: `frontend/src/pages/SearchPage.tsx`
- Modify: `frontend/tests/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: `renderWithQueryClient` (Task 1). Search is modeled as a `useMutation`, not a query — see the spec's rationale (one-shot action on arbitrary text, not a cacheable-by-key resource).

- [ ] **Step 1: Replace SearchPage.tsx**

Replace `frontend/src/pages/SearchPage.tsx` in full:

```tsx
import { FormEvent, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
import { Input } from '../components/ui/Input'
import { search } from '../lib/api'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const searchMutation = useMutation({ mutationFn: search })
  const results = searchMutation.data ?? null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    searchMutation.mutate(query)
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-parchment">Search</h1>
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor="search-input"
            className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
          >
            Search your documents
          </label>
          <Input id="search-input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {searchMutation.isError && <Alert>Search failed, try again</Alert>}
      {searchMutation.isPending && (
        <p className="font-mono text-sm text-parchment/60">Searching...</p>
      )}
      {results !== null && !searchMutation.isPending && results.length === 0 && (
        <p className="font-mono text-sm text-parchment/60">No results found</p>
      )}
      {results !== null && !searchMutation.isPending && results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={`${r.document_id}-${r.chunk_index}`}>
              <Card className="space-y-2">
                <CitationStub>
                  {r.filename} — passage {r.chunk_index + 1} of {r.total_chunks}
                </CitationStub>
                <p className="font-body text-ink dark:text-parchment">{r.content}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace SearchPage.test.tsx**

Replace `frontend/tests/pages/SearchPage.test.tsx` in full:

```tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  search: vi.fn(),
}))

import { search } from '../../src/lib/api'
import { SearchPage } from '../../src/pages/SearchPage'

describe('SearchPage', () => {
  it('renders results after submitting a query', async () => {
    ;(search as any).mockResolvedValue([
      {
        document_id: '1',
        filename: 'report.pdf',
        chunk_index: 2,
        total_chunks: 5,
        content: 'quarterly revenue figures',
        score: 0.9,
      },
    ])

    renderWithQueryClient(<SearchPage />)
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('quarterly revenue figures')).toBeInTheDocument()
    })
    expect(screen.getByText('report.pdf — passage 3 of 5')).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue')
  })

  it('shows an empty state when no results are found', async () => {
    ;(search as any).mockResolvedValue([])

    renderWithQueryClient(<SearchPage />)
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'nothing matches' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })

  it('shows an error message when the search request fails', async () => {
    ;(search as any).mockRejectedValue(new Error('Search failed'))

    renderWithQueryClient(<SearchPage />)
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Search failed, try again')
    })
  })

  it('does not search on an empty query', () => {
    renderWithQueryClient(<SearchPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(search).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/SearchPage.test.tsx`
Expected: 4 passed.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 66 tests, all passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SearchPage.tsx frontend/tests/pages/SearchPage.test.tsx
git commit -m "refactor: migrate SearchPage to React Query"
```

---

### Task 4: Migrate ChatPage

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/tests/pages/ChatPage.test.tsx`

**Interfaces:**
- Consumes: `queryKeys.chatSession` (Task 1), `renderWithQueryClient` (Task 1).

- [ ] **Step 1: Replace ChatPage.tsx**

Replace `frontend/src/pages/ChatPage.tsx` in full:

```tsx
import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)

  const sessionQuery = useQuery({
    queryKey: queryKeys.chatSession,
    queryFn: createChatSession,
    staleTime: Infinity,
  })

  const sendMutation = useMutation({
    mutationFn: (vars: { sessionId: string; content: string; webSearch: boolean }) =>
      sendChatMessage(vars.sessionId, vars.content, vars.webSearch),
    onSuccess: ({ user_message, assistant_message }) => {
      setMessages((prev) => [...prev, user_message, assistant_message])
      setInput('')
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const sessionId = sessionQuery.data?.id
    if (!input.trim() || !sessionId) return
    sendMutation.mutate({ sessionId, content: input, webSearch })
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold text-parchment">Chat</h1>
      {sendMutation.isError && <Alert>Failed to send message, try again</Alert>}
      <ul className="space-y-3">
        {messages.map((message) => (
          <li key={message.id}>
            <Card
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-lg bg-[#F4E8D0] dark:bg-[#2A2318]'
                  : 'max-w-lg'
              }
            >
              <p className="font-body text-ink dark:text-parchment">{message.content}</p>
              {message.used_web_search && (
                <div className="mt-2">
                  <Badge variant="amber">Web</Badge>
                </div>
              )}
              {message.citations.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {message.citations.map((citation) => (
                    <li key={`${citation.document_id}-${citation.chunk_index}`}>
                      <CitationStub>
                        {citation.filename} — passage {citation.chunk_index + 1} of{' '}
                        {citation.total_chunks}
                      </CitationStub>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="chat-input"
            className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
          >
            Ask a question
          </label>
          <Input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 font-body text-sm text-parchment/70">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="h-4 w-4 rounded border-rule text-brass focus:ring-brass"
            />
            Search the web for this message
          </label>
          <Button type="submit" disabled={sendMutation.isPending}>
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Replace ChatPage.test.tsx**

Replace `frontend/tests/pages/ChatPage.test.tsx` in full:

```tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  createChatSession: vi.fn(),
  sendChatMessage: vi.fn(),
}))

import { createChatSession, sendChatMessage } from '../../src/lib/api'
import { ChatPage } from '../../src/pages/ChatPage'

function renderChatPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  )
}

describe('ChatPage', () => {
  it('creates a chat session on mount', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })

    renderChatPage()

    await waitFor(() => {
      expect(createChatSession).toHaveBeenCalledTimes(1)
    })
  })

  it('sends a message and renders the grounded reply with sources', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the refund window?',
        citations: [],
        used_web_search: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Refunds are available within 30 days.',
        citations: [
          { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3, score: 0.81 },
        ],
        used_web_search: false,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), {
      target: { value: 'What is the refund window?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText('Refunds are available within 30 days.')).toBeInTheDocument()
    })
    expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    expect(screen.getByText('policy.pdf — passage 2 of 3')).toBeInTheDocument()
    expect(screen.queryByText('Web')).not.toBeInTheDocument()
    expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'What is the refund window?', false)
  })

  it('renders a Web badge and no sources for a web-search-assisted reply', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: "What's the weather in Paris?",
        citations: [],
        used_web_search: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: "It's sunny in Paris today.",
        citations: [],
        used_web_search: true,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('Search the web for this message'))
    fireEvent.change(screen.getByLabelText('Ask a question'), {
      target: { value: "What's the weather in Paris?" },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText("It's sunny in Paris today.")).toBeInTheDocument()
    })
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(sendChatMessage).toHaveBeenCalledWith('session-1', "What's the weather in Paris?", true)
  })

  it('shows an error message when sending fails', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockRejectedValue(new Error('Failed to send message'))

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to send message, try again')
    })
  })

  it('does not send on an empty message', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(sendChatMessage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/ChatPage.test.tsx`
Expected: 5 passed.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 66 tests, all passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/tests/pages/ChatPage.test.tsx
git commit -m "refactor: migrate ChatPage to React Query"
```

---

### Task 5: Migrate QuizPage

**Files:**
- Modify: `frontend/src/pages/QuizPage.tsx`
- Modify: `frontend/tests/pages/QuizPage.test.tsx`

**Interfaces:**
- Consumes: `queryKeys.documents`, `queryKeys.quizAttempts` (Task 1), `renderWithQueryClient` (Task 1). Reuses the same `queryKeys.documents` query as `DocumentsPage` (Task 2) — same cache entry, no duplicate fetch if Documents was already visited.

Note: `submitMutation` is declared before `generateMutation` in the code below so `generateMutation`'s `onSuccess` can call `submitMutation.reset()` — clearing any previous submission's scored result when a *new* quiz is generated. The original code did this explicitly (`setResult(null)` inside `handleGenerate`'s success path); without the equivalent `reset()` call here, generating a second quiz after already scoring one would incorrectly keep showing the first quiz's stale result screen instead of the new quiz's question form. No existing test covers this scenario, but it's a real regression the migration must not introduce.

- [ ] **Step 1: Replace QuizPage.tsx**

Replace `frontend/src/pages/QuizPage.tsx` in full:

```tsx
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
import { Input } from '../components/ui/Input'
import { Quiz, generateQuiz, listDocuments, submitQuizAttempt } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const queryClient = useQueryClient()

  const documentsQuery = useQuery({ queryKey: queryKeys.documents, queryFn: listDocuments })
  const documents = documentsQuery.data ?? []

  const submitMutation = useMutation({
    mutationFn: (vars: {
      quizId: string
      answers: { question_id: string; selected_option: number }[]
    }) => submitQuizAttempt(vars.quizId, vars.answers),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts }),
  })

  const generateMutation = useMutation({
    mutationFn: (vars: { documentIds: string[]; numQuestions: number }) =>
      generateQuiz(vars.documentIds, vars.numQuestions),
    onSuccess: (generated) => {
      setQuiz(generated)
      setAnswers({})
      submitMutation.reset()
    },
  })

  function toggleDocument(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleGenerate(event: FormEvent) {
    event.preventDefault()
    if (selectedIds.length === 0) return
    generateMutation.mutate({ documentIds: selectedIds, numQuestions })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!quiz) return
    const submittedAnswers = quiz.questions
      .filter((q) => q.id in answers)
      .map((q) => ({ question_id: q.id, selected_option: answers[q.id] }))
    submitMutation.mutate({ quizId: quiz.id, answers: submittedAnswers })
  }

  const result = submitMutation.data ?? null
  const error = generateMutation.isError
    ? 'Failed to generate quiz, try again'
    : submitMutation.isError
      ? 'Failed to submit quiz, try again'
      : null
  const loading = generateMutation.isPending || submitMutation.isPending

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-parchment">Quiz</h1>
        <Link
          to="/quiz/history"
          className="font-mono text-xs uppercase tracking-wide text-brass hover:underline"
        >
          Past attempts
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}

      {!quiz && (
        <form onSubmit={handleGenerate} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="font-mono text-xs uppercase tracking-wide text-parchment/60">
              Select documents
            </legend>
            {documents
              .filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-2 rounded-sm border border-rule bg-parchment p-3 font-body text-sm text-ink dark:border-rule-dark dark:bg-parchment-dark dark:text-parchment"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => toggleDocument(doc.id)}
                    className="h-4 w-4 rounded border-rule text-brass focus:ring-brass"
                  />
                  {doc.filename}
                </label>
              ))}
          </fieldset>
          <div>
            <label
              htmlFor="num-questions"
              className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
            >
              Number of questions
            </label>
            <Input
              id="num-questions"
              type="number"
              min={5}
              max={20}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button type="submit" disabled={loading}>
            Generate Quiz
          </Button>
        </form>
      )}

      {quiz && !result && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {quiz.actual_count < quiz.requested_count && (
            <p className="font-body text-sm text-amber-400">
              Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
              selected documents didn't have enough distinct content for more.
            </p>
          )}
          {quiz.questions.map((q) => (
            <Card key={q.id}>
              <fieldset className="space-y-2">
                <legend className="font-display font-medium text-ink dark:text-parchment">
                  {q.question}
                </legend>
                {q.options.map((option, index) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 font-body text-sm text-ink dark:text-parchment"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={index}
                      checked={answers[q.id] === index}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: index }))}
                      className="h-4 w-4 border-rule text-brass focus:ring-brass"
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            </Card>
          ))}
          <Button type="submit" disabled={loading}>
            Submit
          </Button>
        </form>
      )}

      {result && (
        <Card className="space-y-4">
          <p className="font-display text-lg font-semibold text-ink dark:text-parchment">
            {result.score} / {result.total_questions}
          </p>
          <ul className="space-y-3">
            {result.results.map((r) => (
              <li
                key={r.question_id}
                className={
                  r.is_correct
                    ? 'rounded-sm border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950'
                    : 'rounded-sm border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950'
                }
              >
                <p className="font-body font-medium text-ink dark:text-parchment">{r.question}</p>
                <p className="font-body text-sm text-ink/80 dark:text-parchment/80">
                  your answer: {r.selected_option === null ? '(none)' : r.options[r.selected_option]}
                </p>
                <p className="font-body text-sm text-ink/80 dark:text-parchment/80">
                  correct answer: {r.options[r.correct_answer]}
                </p>
                <div className="mt-1">
                  <CitationStub>
                    {r.source_reference.filename} — passage {r.source_reference.chunk_index + 1} of{' '}
                    {r.source_reference.total_chunks}
                  </CitationStub>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace QuizPage.test.tsx**

Replace `frontend/tests/pages/QuizPage.test.tsx` in full:

```tsx
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  generateQuiz: vi.fn(),
  submitQuizAttempt: vi.fn(),
}))

import { generateQuiz, listDocuments, submitQuizAttempt } from '../../src/lib/api'
import { QuizPage } from '../../src/pages/QuizPage'

function renderQuizPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <QuizPage />
    </MemoryRouter>,
  )
}

const READY_DOCUMENT = {
  id: 'doc-1',
  user_id: 'user-1',
  filename: 'policy.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  error_reason: null,
  uploaded_at: '2026-07-18T00:00:00Z',
}

const QUIZ = {
  id: 'quiz-1',
  document_ids: ['doc-1'],
  requested_count: 2,
  actual_count: 2,
  created_at: '2026-07-18T00:00:00Z',
  questions: [
    { id: 'q-1', question: 'What is the refund window?', options: ['7 days', '30 days', '60 days', '90 days'] },
    { id: 'q-2', question: 'What is covered?', options: ['A', 'B', 'C', 'D'] },
  ],
}

describe('QuizPage', () => {
  it('lists ready documents as selectable checkboxes', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()

    await waitFor(() => {
      expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument()
    })
  })

  it('generates a quiz, submits answers, and shows scored results', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue(QUIZ)
    ;(submitQuizAttempt as any).mockResolvedValue({
      id: 'attempt-1',
      quiz_id: 'quiz-1',
      score: 1,
      total_questions: 2,
      completed_at: '2026-07-18T00:01:00Z',
      results: [
        {
          question_id: 'q-1',
          question: 'What is the refund window?',
          options: ['7 days', '30 days', '60 days', '90 days'],
          selected_option: 1,
          correct_answer: 1,
          is_correct: true,
          source_reference: { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3 },
        },
        {
          question_id: 'q-2',
          question: 'What is covered?',
          options: ['A', 'B', 'C', 'D'],
          selected_option: 0,
          correct_answer: 2,
          is_correct: false,
          source_reference: { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 2, total_chunks: 3 },
        },
      ],
    })

    renderQuizPage()
    await waitFor(() => expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    await waitFor(() => {
      expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    })
    expect(generateQuiz).toHaveBeenCalledWith(['doc-1'], 10)

    fireEvent.click(screen.getAllByLabelText('30 days')[0])
    fireEvent.click(screen.getByLabelText('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument()
    })
    expect(submitQuizAttempt).toHaveBeenCalledWith('quiz-1', [
      { question_id: 'q-1', selected_option: 1 },
      { question_id: 'q-2', selected_option: 0 },
    ])
  })

  it('shows a degraded-count banner when fewer questions were generated than requested', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue({ ...QUIZ, requested_count: 10, actual_count: 2 })

    renderQuizPage()
    await waitFor(() => expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Generated 2 of the requested 10 questions — the selected documents didn't have enough distinct content for more.",
        ),
      ).toBeInTheDocument()
    })
  })

  it('shows an error message when generation fails', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockRejectedValue(new Error('Failed to generate quiz'))

    renderQuizPage()
    await waitFor(() => expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to generate quiz, try again')
    })
  })

  it('does not generate when no documents are selected', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()
    await waitFor(() => expect(listDocuments).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    expect(generateQuiz).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/QuizPage.test.tsx`
Expected: 5 passed.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 66 tests, all passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QuizPage.tsx frontend/tests/pages/QuizPage.test.tsx
git commit -m "refactor: migrate QuizPage to React Query"
```

---

### Task 6: Migrate QuizHistoryPage and final verification

**Files:**
- Modify: `frontend/src/pages/QuizHistoryPage.tsx`
- Modify: `frontend/tests/pages/QuizHistoryPage.test.tsx`

**Interfaces:**
- Consumes: `queryKeys.quizAttempts` (Task 1), `renderWithQueryClient` (Task 1).

- [ ] **Step 1: Replace QuizHistoryPage.tsx**

Replace `frontend/src/pages/QuizHistoryPage.tsx` in full:

```tsx
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Card } from '../components/ui/Card'
import { listQuizAttempts } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-parchment">Past Quiz Attempts</h1>
        <Link
          to="/quiz"
          className="font-mono text-xs uppercase tracking-wide text-brass hover:underline"
        >
          Take a quiz
        </Link>
      </div>
      {attemptsQuery.isError && <Alert>Failed to load quiz history, try again</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="font-mono text-sm text-parchment/60">No quiz attempts yet</p>
      )}
      {attempts !== null && attempts.length > 0 && (
        <ul className="space-y-3">
          {attempts.map((a) => (
            <li key={a.id}>
              <Card className="font-body text-sm text-ink dark:text-parchment">
                {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} —{' '}
                {a.completed_at}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Replace QuizHistoryPage.test.tsx**

Replace `frontend/tests/pages/QuizHistoryPage.test.tsx` in full:

```tsx
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listQuizAttempts: vi.fn(),
}))

import { listQuizAttempts } from '../../src/lib/api'
import { QuizHistoryPage } from '../../src/pages/QuizHistoryPage'

function renderQuizHistoryPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <QuizHistoryPage />
    </MemoryRouter>,
  )
}

describe('QuizHistoryPage', () => {
  it('renders past attempts', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([
      {
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        score: 7,
        total_questions: 10,
        completed_at: '2026-07-18T12:05:00Z',
        document_filenames: ['policy.pdf'],
      },
    ])

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('7 / 10 — policy.pdf', { exact: false })).toBeInTheDocument()
    })
  })

  it('shows an empty state when there are no attempts', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('No quiz attempts yet')).toBeInTheDocument()
    })
  })

  it('shows an error message when the request fails', async () => {
    ;(listQuizAttempts as any).mockRejectedValue(new Error('Failed to load quiz history'))

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load quiz history, try again')
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/pages/QuizHistoryPage.test.tsx`
Expected: 3 passed.

- [ ] **Step 4: Run the full suite, typecheck, and production build (final verification for the whole migration)**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 66 tests, all passing — every page now backed by React Query, no test's expected outcome changed from the plan's baseline.

Run: `cd frontend && npm run build`
Expected: production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/QuizHistoryPage.tsx frontend/tests/pages/QuizHistoryPage.test.tsx
git commit -m "refactor: migrate QuizHistoryPage to React Query"
```

---

## Manual End-to-End Verification (after all tasks complete)

1. Start the backend and frontend against a real Supabase project.
2. On `/documents`: upload a file, confirm it appears immediately as `uploading` without a manual page refresh (mutation → invalidation → refetch), and confirm it transitions to `ready` via polling without a page refresh.
3. Rename and delete a document; confirm the list updates without a manual refresh in both cases.
4. On `/search`, submit a query; confirm results render and a failed/empty query shows the right state.
5. On `/chat`, send a message with and without the web-search checkbox; confirm the session is created once per page visit (not re-created per message).
6. On `/quiz`, generate a quiz using a document already visible on `/documents` (confirms the shared `queryKeys.documents` cache — should not re-fetch if visited Documents moments earlier), submit it, then confirm `/quiz/history` shows the new attempt without a manual reload (confirms the cross-page `quizAttempts` invalidation).
