import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  createChatSession: vi.fn(),
  sendChatMessage: vi.fn(),
}))

import { createChatSession, sendChatMessage } from '../../src/lib/api'
import { ChatPage } from '../../src/pages/ChatPage'
import i18n from '../../src/i18n'

function renderChatPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  )
}

describe('ChatPage', () => {
  afterEach(() => {
    i18n.changeLanguage('vi')
  })

  it('creates a chat session on mount', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })

    renderChatPage()

    await waitFor(() => {
      expect(createChatSession).toHaveBeenCalledTimes(1)
    })
  })

  it('sends a message and renders the grounded reply with sources', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the refund window?',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
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
        used_general_knowledge: false,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Đặt câu hỏi'), {
      target: { value: 'What is the refund window?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))

    await waitFor(() => {
      expect(screen.getByText('Refunds are available within 30 days.')).toBeInTheDocument()
    })
    expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    expect(screen.getByText('policy.pdf — đoạn 2 trên 3')).toBeInTheDocument()
    expect(screen.queryByText('Web')).not.toBeInTheDocument()
    expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'What is the refund window?', false, 'vi')
  })

  it('renders a Web badge and no sources for a web-search-assisted reply', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: "What's the weather in Paris?",
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: "It's sunny in Paris today.",
        citations: [],
        used_web_search: true,
        used_general_knowledge: false,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('Tìm kiếm trên web cho tin nhắn này'))
    fireEvent.change(screen.getByLabelText('Đặt câu hỏi'), {
      target: { value: "What's the weather in Paris?" },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))

    await waitFor(() => {
      expect(screen.getByText("It's sunny in Paris today.")).toBeInTheDocument()
    })
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(sendChatMessage).toHaveBeenCalledWith('session-1', "What's the weather in Paris?", true, 'vi')
  })

  it('shows an error message when sending fails', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockRejectedValue(new Error('Failed to send message'))

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Đặt câu hỏi'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Gửi tin nhắn thất bại, vui lòng thử lại')
    })
  })

  it('does not send on an empty message', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))

    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('shows an error and disables Send when chat session creation fails', async () => {
    ;(createChatSession as any).mockRejectedValue(new Error('network error'))

    renderChatPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Không thể bắt đầu phiên trò chuyện, vui lòng tải lại trang',
      )
    })
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled()
  })

  it('renders a General knowledge badge when the answer has no document grounding', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the capital of France?',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-19T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Paris is the capital of France.',
        citations: [],
        used_web_search: false,
        used_general_knowledge: true,
        created_at: '2026-07-19T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Đặt câu hỏi'), {
      target: { value: 'What is the capital of France?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))

    await waitFor(() => {
      expect(screen.getByText('Paris is the capital of France.')).toBeInTheDocument()
    })
    expect(screen.getByText('Kiến thức chung')).toBeInTheDocument()
    expect(screen.queryByText('Web')).not.toBeInTheDocument()
  })

  it('renders a Documents + General knowledge badge when an answer blends both', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'What is the refund window and is that typical?',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-19T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'Refunds are available within 30 days, which is fairly typical for retailers.',
        citations: [
          { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3, score: 0.81 },
        ],
        used_web_search: false,
        used_general_knowledge: true,
        created_at: '2026-07-19T00:00:02Z',
      },
    })

    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Đặt câu hỏi'), {
      target: { value: 'What is the refund window and is that typical?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi' }))

    await waitFor(() => {
      expect(
        screen.getByText('Refunds are available within 30 days, which is fairly typical for retailers.'),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Tài liệu + Kiến thức chung')).toBeInTheDocument()
    expect(screen.getByText('policy.pdf — đoạn 2 trên 3')).toBeInTheDocument()
  })

  it('sends the currently selected UI language with the message', async () => {
    ;(createChatSession as any).mockResolvedValue({
      id: 'session-1',
      title: 'New Chat',
      created_at: '2026-07-18T00:00:00Z',
    })
    ;(sendChatMessage as any).mockResolvedValue({
      user_message: {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        citations: [],
        used_web_search: false,
        used_general_knowledge: false,
        created_at: '2026-07-18T00:00:01Z',
      },
      assistant_message: {
        id: 'msg-2',
        role: 'assistant',
        content: 'hi',
        citations: [],
        used_web_search: false,
        used_general_knowledge: true,
        created_at: '2026-07-18T00:00:02Z',
      },
    })

    i18n.changeLanguage('en')
    renderChatPage()
    await waitFor(() => expect(createChatSession).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Ask a question'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith('session-1', 'hello', false, 'en')
    })
  })
})
