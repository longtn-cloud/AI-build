import { FormEvent, useEffect, useState } from 'react'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'

export function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    createChatSession().then((session) => setSessionId(session.id))
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || !sessionId) return
    setSending(true)
    setError(null)
    try {
      const { user_message, assistant_message } = await sendChatMessage(sessionId, input, webSearch)
      setMessages((prev) => [...prev, user_message, assistant_message])
      setInput('')
    } catch {
      setError('Failed to send message, try again')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Chat</h1>
      {error && <Alert>{error}</Alert>}
      <ul className="space-y-3">
        {messages.map((message) => (
          <li key={message.id}>
            <Card
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-lg bg-indigo-50 dark:bg-indigo-950'
                  : 'max-w-lg'
              }
            >
              <p className="text-gray-900 dark:text-gray-100">{message.content}</p>
              {message.used_web_search && (
                <div className="mt-2">
                  <Badge variant="amber">Web</Badge>
                </div>
              )}
              {message.citations.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                  {message.citations.map((citation) => (
                    <li key={`${citation.document_id}-${citation.chunk_index}`}>
                      {citation.filename} — passage {citation.chunk_index + 1} of{' '}
                      {citation.total_chunks}
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
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Ask a question
          </label>
          <Input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Search the web for this message
          </label>
          <Button type="submit" disabled={sending}>
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
