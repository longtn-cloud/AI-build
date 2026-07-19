import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ChatMessage, createChatSession, sendChatMessage } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function ChatPage() {
  const { t } = useTranslation('chat')
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
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto py-7">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-8">
          {sessionQuery.isError && <Alert>{t('errors.sessionStart')}</Alert>}
          {sendMutation.isError && <Alert>{t('errors.sendFailed')}</Alert>}
          {messages.map((message) =>
            message.role === 'user' ? (
              <div
                key={message.id}
                className="ml-auto max-w-[78%] rounded-[16px_16px_4px_16px] bg-sidebar px-4 py-3 text-[14.5px] leading-relaxed text-white animate-fade-up"
              >
                {message.content}
              </div>
            ) : (
              <div key={message.id} className="flex gap-3 animate-fade-up">
                <div className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] border border-accent/20 bg-ok-bg">
                  <span className="h-1 w-1 rounded-full bg-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-3.5 text-[15px] leading-relaxed text-sidebar">
                    {message.content}
                  </p>
                  {message.used_web_search ? (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">{t('badges.web')}</Badge>
                    </div>
                  ) : message.used_general_knowledge ? (
                    <div className="mb-3 inline-flex">
                      <Badge variant="blue">
                        {message.citations.length > 0
                          ? t('badges.documentsAndGeneral')
                          : t('badges.general')}
                      </Badge>
                    </div>
                  ) : null}
                  {message.citations.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {message.citations.map((citation) => (
                        <div
                          key={`${citation.document_id}-${citation.chunk_index}`}
                          className="rounded-lg border border-line border-l-[3px] border-l-accent bg-[#FBFDFB] px-3.5 py-3"
                        >
                          <span className="text-xs font-bold text-sidebar">
                            {t('citation', {
                              filename: citation.filename,
                              index: citation.chunk_index + 1,
                              total: citation.total_chunks,
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-line bg-white px-8 py-5">
        <form onSubmit={handleSubmit} className="mx-auto max-w-[760px] space-y-3">
          <div>
            <label
              htmlFor="chat-input"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted"
            >
              {t('inputLabel')}
            </label>
            <Input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('inputPlaceholder')}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={webSearch}
                onChange={(e) => setWebSearch(e.target.checked)}
                className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
              />
              {t('webSearchLabel')}
            </label>
            <Button type="submit" disabled={sendMutation.isPending || !sessionQuery.data}>
              {t('send')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
