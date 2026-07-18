import { useEffect, useState } from 'react'

import { Button } from './ui/Button'
import { Document, getDownloadUrl, getPreviewText } from '../lib/api'

type PreviewableDocument = Pick<Document, 'id' | 'file_type'>

export function PreviewModal({
  document,
  onClose,
}: {
  document: PreviewableDocument
  onClose: () => void
}) {
  const [content, setContent] = useState<{ kind: 'pdf' | 'text'; value: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (document.file_type === 'pdf') {
        const url = await getDownloadUrl(document.id)
        if (!cancelled) setContent({ kind: 'pdf', value: url })
        return
      }
      if (document.file_type === 'docx') {
        const text = await getPreviewText(document.id)
        if (!cancelled) setContent({ kind: 'text', value: text })
        return
      }
      const url = await getDownloadUrl(document.id)
      const response = await fetch(url)
      const text = await response.text()
      if (!cancelled) setContent({ kind: 'text', value: text })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [document])

  return (
    <div role="dialog" className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 dark:bg-gray-900">
        <div className="mb-2 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {content?.kind === 'pdf' && (
          <iframe title="Document preview" src={content.value} width="100%" height="600" />
        )}
        {content?.kind === 'text' && (
          <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">
            {content.value}
          </pre>
        )}
      </div>
    </div>
  )
}
