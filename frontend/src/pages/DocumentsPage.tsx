import { ChangeEvent, useEffect, useState } from 'react'

import {
  Document,
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../lib/api'
import { PreviewModal } from '../components/PreviewModal'

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<Document | null>(null)

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

  async function handleRename(doc: Document) {
    const newName = window.prompt('New filename', doc.filename)
    if (!newName) return
    try {
      await renameDocument(doc.id, newName)
      await refresh()
    } catch {
      setError('Failed to rename document')
    }
  }

  async function handleDelete(doc: Document) {
    if (!window.confirm(`Delete ${doc.filename}?`)) return
    try {
      await deleteDocument(doc.id)
      await refresh()
    } catch {
      setError('Failed to delete document')
    }
  }

  async function handleDownload(doc: Document) {
    try {
      const url = await getDownloadUrl(doc.id)
      window.open(url, '_blank')
    } catch {
      setError('Failed to download document')
    }
  }

  return (
    <div>
      <h1>Your Documents</h1>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="upload-input">Upload document</label>
      <input id="upload-input" type="file" onChange={handleUpload} />
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            <span>{doc.filename}</span>
            <span> ({doc.status})</span>
            {doc.status === 'ready' && (
              <>
                <button onClick={() => setPreviewing(doc)}>Preview</button>
                <button onClick={() => handleDownload(doc)}>Download</button>
              </>
            )}
            <button onClick={() => handleRename(doc)}>Rename</button>
            <button onClick={() => handleDelete(doc)}>Delete</button>
          </li>
        ))}
      </ul>
      {previewing && <PreviewModal document={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
