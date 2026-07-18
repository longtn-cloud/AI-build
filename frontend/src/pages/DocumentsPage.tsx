import { ChangeEvent, useEffect, useState } from 'react'

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

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadDocument(file)
      await refresh()
    } catch {
      setError('Failed to upload document')
    } finally {
      event.target.value = ''
    }
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
      <div>
        <label
          htmlFor="upload-input"
          className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
        >
          Upload document
        </label>
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
