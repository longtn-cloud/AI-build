import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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
    <div>
      <Link to="/documents">Documents</Link>
      <h1>Chat</h1>
      {error && <p role="alert">{error}</p>}
      <ul>
        {messages.map((message) => (
          <li key={message.id}>
            <p>{message.content}</p>
            {message.used_web_search && <span>Web</span>}
            {message.citations.length > 0 && (
              <ul>
                {message.citations.map((citation) => (
                  <li key={`${citation.document_id}-${citation.chunk_index}`}>
                    {citation.filename} — passage {citation.chunk_index + 1} of {citation.total_chunks}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <label htmlFor="chat-input">Ask a question</label>
        <input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} />
        <label htmlFor="web-search-toggle">Search the web for this message</label>
        <input
          id="web-search-toggle"
          type="checkbox"
          checked={webSearch}
          onChange={(e) => setWebSearch(e.target.checked)}
        />
        <button type="submit" disabled={sending}>
          Send
        </button>
      </form>
    </div>
  )
}
