import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  createChatSession: vi.fn(),
  sendChatMessage: vi.fn(),
}))

import { createChatSession, sendChatMessage } from '../../src/lib/api'
import { ChatPage } from '../../src/pages/ChatPage'

function renderChatPage() {
  return render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  )
}

describe('ChatPage', () => {
  it('creates a chat session on mount', async () => {
    ;(createChatSession as any).mockResolvedValue({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' })

    renderChatPage()

    await waitFor(() => {
      expect(createChatSession).toHaveBeenCalledTimes(1)
    })
  })

  it('sends a message and renders the grounded reply with sources', async () => {
    ;(createChatSession as any).mockResolvedValue({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the refund window?',
        citations: [],
        used_web_search: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Refunds are available within 30 days.',
        citations: [
          { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3, score: 0.81 },
        ],
        used_web_search: false,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), {
      target: { value: 'What is the refund window?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText('Refunds are available within 30 days.')).toBeInTheDocument()
    })
    expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    expect(screen.getByText('policy.pdf — passage 2 of 3')).toBeInTheDocument()
    expect(screen.queryByText('Web')).not.toBeInTheDocument()
    expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'What is the refund window?', false)
  })

  it('renders a Web badge and no sources for a web-search-assisted reply', async () => {
    ;(createChatSession as any).mockResolvedValue({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: "What's the weather in Paris?",
        citations: [],
        used_web_search: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: "It's sunny in Paris today.",
        citations: [],
        used_web_search: true,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('Search the web for this message'))
    fireEvent.change(screen.getByLabelText('Ask a question'), {
      target: { value: "What's the weather in Paris?" },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByText("It's sunny in Paris today.")).toBeInTheDocument()
    })
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(sendChatMessage).toHaveBeenCalledWith('session-1', "What's the weather in Paris?", true)
  })

  it('shows an error message when sending fails', async () => {
    ;(createChatSession as any).mockResolvedValue({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' })
    ;(sendChatMessage as any).mockRejectedValue(new Error('Failed to send message'))

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to send message, try again')
    })
  })

  it('does not send on an empty message', async () => {
    ;(createChatSession as any).mockResolvedValue({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(sendChatMessage).not.toHaveBeenCalled()
  })
})
