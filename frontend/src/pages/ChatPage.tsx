import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [webSearch, setWebSearch] = useState(false)

  const sessionQuery = useQuery({
    queryKey: queryKeys.chatSession,
    queryFn: createChatSession,
    staleTime: Infinity,
  })

  const sendMutation = useMutation({
    mutationFn: (vars: { sessionId: string; content: string; webSearch: boolean }) =>
      sendChatMessage(vars.sessionId, vars.content, vars.webSearch),
    onSuccess: ({ user_message, assistant_message }) => {
      setMessages((prev) => [...prev, user_message, assistant_message])
      setInput('')
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const sessionId = sessionQuery.data?.id
    if (!input.trim() || !sessionId) return
    sendMutation.mutate({ sessionId, content: input, webSearch })
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold text-parchment">Chat</h1>
      {sessionQuery.isError && <Alert>Failed to start chat session, try refreshing the page</Alert>}
      {sendMutation.isError && <Alert>Failed to send message, try again</Alert>}
      <ul className="space-y-3">
        {messages.map((message) => (
          <li key={message.id}>
            <Card
              className={
                message.role === 'user'
                  ? 'ml-auto max-w-lg bg-[#F4E8D0] dark:bg-[#2A2318]'
                  : 'max-w-lg'
              }
            >
              <p className="font-body text-ink dark:text-parchment">{message.content}</p>
              {message.used_web_search && (
                <div className="mt-2">
                  <Badge variant="amber">Web</Badge>
                </div>
              )}
              {message.citations.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {message.citations.map((citation) => (
                    <li key={`${citation.document_id}-${citation.chunk_index}`}>
                      <CitationStub>
                        {citation.filename} — passage {citation.chunk_index + 1} of{' '}
                        {citation.total_chunks}
                      </CitationStub>
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
            className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
          >
            Ask a question
          </label>
          <Input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 font-body text-sm text-parchment/70">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="h-4 w-4 rounded border-rule text-brass focus:ring-brass"
            />
            Search the web for this message
          </label>
          <Button type="submit" disabled={sendMutation.isPending || !sessionQuery.data}>
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
