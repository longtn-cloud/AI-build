import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

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
  const [content, setContent] = useState<{ kind: 'pdf' | 'markdown' | 'text'; value: string } | null>(
    null,
  )

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
      if (!response.ok) {
        if (!cancelled) setContent({ kind: 'text', value: 'Failed to load preview.' })
        return
      }
      const text = await response.text()
      if (!cancelled) {
        setContent({ kind: document.file_type === 'md' ? 'markdown' : 'text', value: text })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [document])

  return (
    <div role="dialog" className="fixed inset-0 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-[14px] border border-line bg-white">
        <div className="flex shrink-0 justify-end border-b border-line p-4">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="overflow-auto p-4">
          {content?.kind === 'pdf' && (
            <iframe title="Document preview" src={content.value} width="100%" height="600" />
          )}
          {content?.kind === 'markdown' && (
            <div className="prose prose-sm max-w-none text-ink">
              <ReactMarkdown>{content.value}</ReactMarkdown>
            </div>
          )}
          {content?.kind === 'text' && (
            <pre className="whitespace-pre-wrap font-mono text-sm text-ink">{content.value}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
