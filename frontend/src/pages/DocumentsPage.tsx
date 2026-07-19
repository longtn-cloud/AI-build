import { ChangeEvent, DragEvent, useMemo, useState } from 'react'
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

const STATUS_LABEL: Record<DocumentListItem['status'], string> = {
  uploading: 'Uploading…',
  processing: 'Processing…',
  ready: 'Indexed',
  failed: 'Failed',
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Docs' },
  { id: 'other', label: 'Text' },
] as const

function matchesFilter(fileType: string, filter: (typeof FILTERS)[number]['id']) {
  if (filter === 'all') return true
  if (filter === 'pdf') return fileType === 'pdf'
  if (filter === 'docx') return fileType === 'docx'
  return fileType !== 'pdf' && fileType !== 'docx'
}

export function DocumentsPage() {
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<DocumentListItem | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
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
  const filtered = useMemo(
    () => documents.filter((d) => matchesFilter(d.file_type, filter)),
    [documents, filter],
  )

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file),
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
    <div className="px-8 pb-12 pt-7">
      {displayError && (
        <div className="mb-5">
          <Alert>{displayError}</Alert>
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          isDraggingOver
            ? 'mb-6 rounded-[14px] border-2 border-accent bg-accent/5 p-4'
            : 'mb-6 rounded-[14px] border-2 border-dashed border-line p-4'
        }
      >
        <label
          htmlFor="upload-input"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Upload document
        </label>
        <p className="mb-2 text-sm text-muted">Drag a file here, or click to browse</p>
        <input
          id="upload-input"
          type="file"
          onChange={handleUpload}
          className="block font-sans text-sm text-ink file:mr-4 file:rounded-[10px] file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-accent-hover hover:file:bg-app-bg"
        />
      </div>

      {documents.length === 0 && !documentsQuery.isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[22px] bg-ok-bg">
            <span className="text-4xl">📄</span>
          </div>
          <h2 className="mb-2 text-xl font-extrabold tracking-tight">Build your knowledge base</h2>
          <p className="mb-6 max-w-[400px] text-[15px] leading-relaxed text-muted">
            Upload PDFs, Word docs, text or Markdown files. We&apos;ll index every passage so you
            can search, ask, and quiz — all grounded in your own material.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex gap-1 rounded-[10px] border border-line bg-white p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={
                    filter === f.id
                      ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
                      : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <span className="text-sm text-muted">{documents.length} documents</span>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {filtered.map((doc) => (
              <Card key={doc.id} className="flex flex-col gap-3.5 animate-fade-up">
                <div className="flex gap-3">
                  <div className="flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-[11px] bg-app-bg">
                    <span className="font-mono text-[11px] font-bold text-muted">
                      {doc.file_type.toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[14.5px] font-bold leading-tight">
                      {doc.filename}
                    </div>
                    <div className="mt-1 text-xs text-faint">
                      Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div>
                  <Badge variant={STATUS_VARIANT[doc.status]}>{STATUS_LABEL[doc.status]}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-[#EEF2F3] pt-3">
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
            ))}
          </div>
        </>
      )}

      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
