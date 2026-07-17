import { useEffect, useState } from 'react'

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
    <div role="dialog">
      <button onClick={onClose}>Close</button>
      {content?.kind === 'pdf' && (
        <iframe title="Document preview" src={content.value} width="100%" height="600" />
      )}
      {content?.kind === 'text' && <pre>{content.value}</pre>}
    </div>
  )
}
