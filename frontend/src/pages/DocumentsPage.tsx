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
