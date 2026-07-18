# Drag-and-Drop File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a file onto the Documents page to upload it, reusing the exact same upload path as the existing click-to-browse input.

**Architecture:** `DocumentsPage`'s `handleUpload` is refactored into a shared `uploadFile(file: File)` helper. The existing label+input pair is wrapped in a new container `<div>` carrying `onDragOver`/`onDragLeave`/`onDrop` handlers; the drop handler calls the same `uploadFile` helper with `event.dataTransfer.files[0]`. A boolean `isDraggingOver` state toggles the container's visual state (dashed brass border → solid/brightened on drag-over).

**Tech Stack:** Same as existing frontend — React 18 / Vite / TypeScript / Vitest + Testing Library, Tailwind CSS.

## Global Constraints

- Single file only — matches the current input's behavior (no `multiple` attribute). Extra files in a multi-file drop are silently ignored.
- No new client-side file-type/size validation — a dropped file goes through the identical `uploadDocument()` call and error handling as a browsed file. The backend remains the sole validator.
- The existing `<label htmlFor="upload-input">Upload document</label>` and `<input id="upload-input" type="file">` keep their exact text/id/htmlFor/onChange — `DocumentsPage.test.tsx`'s existing assertions (`getByLabelText('Upload document')`, rename/delete/download/polling tests) must pass unmodified.
- `onDragOver` and `onDrop` must call `event.preventDefault()` (required for `onDrop` to fire at all, and prevents the browser from navigating away if a file is dropped just outside the zone).

---

### Task 1: Drop zone on DocumentsPage

**Files:**
- Modify: `frontend/src/pages/DocumentsPage.tsx`
- Test: `frontend/src/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `uploadDocument(file: File)` (`frontend/src/lib/api.ts`, existing, unchanged).
- Produces: no new exports — this is an internal refactor + additive UI within `DocumentsPage`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/DocumentsPage.test.tsx`, inside the existing `describe('DocumentsPage', ...)` block, directly after the `'uploads a selected file and refreshes the list'` test:

```tsx
  it('uploads a dropped file and refreshes the list', async () => {
    ;(listDocuments as any).mockResolvedValue([])
    ;(uploadDocument as any).mockResolvedValue({
      id: '4',
      filename: 'dropped.pdf',
      file_type: 'pdf',
      status: 'uploading',
      uploaded_at: '2026-01-01T00:00:00Z',
    })

    render(<DocumentsPage />)
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1))

    const file = new File(['hello'], 'dropped.pdf', { type: 'application/pdf' })
    const input = screen.getByLabelText('Upload document')
    fireEvent.drop(input, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalledWith(file)
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })
```

(`fireEvent.drop` dispatches a real, bubbling DOM `drop` event — firing it on the `input` bubbles up to the wrapping drop-zone `<div>`'s `onDrop` handler, so this doesn't depend on the exact DOM nesting.)

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `cd frontend && npx vitest run src/pages/DocumentsPage.test.tsx`
Expected: FAIL on the new test — no `onDrop` handler exists yet, so `uploadDocument` is never called. The other existing tests in this file still pass.

- [ ] **Step 3: Refactor the upload handler and add the drop zone**

Replace `frontend/src/pages/DocumentsPage.tsx` in full:

```tsx
import { ChangeEvent, DragEvent, useEffect, useState } from 'react'

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

const STATUS_VARIANT = {
  uploading: 'gray',
  processing: 'blue',
  ready: 'green',
  failed: 'red',
} as const

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DocumentListItem | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  async function refresh() {
    try {
      const docs = await listDocuments()
      setDocuments(docs)
    } catch {
      setError('Failed to load documents')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === 'uploading' || d.status === 'processing',
    )
    if (!hasPending) return
    const intervalId = setInterval(refresh, 3000)
    return () => clearInterval(intervalId)
  }, [documents])

  async function uploadFile(file: File) {
    try {
      await uploadDocument(file)
      await refresh()
    } catch {
      setError('Failed to upload document')
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    await uploadFile(file)
    event.target.value = ''
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingOver(true)
  }

  function handleDragLeave() {
    setIsDraggingOver(false)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDraggingOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    await uploadFile(file)
  }

  async function handleRename(doc: DocumentListItem) {
    const newName = window.prompt('New filename', doc.filename)
    if (!newName) return
    try {
      await renameDocument(doc.id, newName)
      await refresh()
    } catch {
      setError('Failed to rename document')
    }
  }

  async function handleDelete(doc: DocumentListItem) {
    if (!window.confirm(`Delete ${doc.filename}?`)) return
    try {
      await deleteDocument(doc.id)
      await refresh()
    } catch {
      setError('Failed to delete document')
    }
  }

  async function handleDownload(doc: DocumentListItem) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError('Failed to download document')
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-semibold text-parchment">Your Documents</h1>
      {error && <Alert>{error}</Alert>}
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/DocumentsPage.test.tsx`
Expected: 8 passed (7 existing + 1 new).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: `tsc` reports no errors; 18 test files, 60 tests, all passing (59 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/DocumentsPage.tsx frontend/src/pages/DocumentsPage.test.tsx
git commit -m "feat: add drag-and-drop file upload to Documents page"
```

---

## Manual End-to-End Verification (after the task completes)

1. Start the backend and frontend (`cd backend && uvicorn app.main:app --reload`, `cd frontend && npm run dev`) against a real Supabase project.
2. On `/documents`, drag a valid file (PDF/DOCX/TXT/MD) from the desktop onto the drop zone — confirm the box brightens while dragging over it, and the file appears in the list as `uploading` after dropping.
3. Drag an unsupported file type or an oversized file — confirm the existing "Failed to upload document" alert appears, identical to what a rejected click-to-browse upload shows.
4. Confirm click-to-browse still works exactly as before (unaffected by this change).
5. Drag a file and drop it elsewhere on the page (outside the box) — confirm the browser does not navigate away to display the file.
