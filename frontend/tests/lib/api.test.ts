import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}))

import {
  createChatSession,
  deleteDocument,
  generateQuiz,
  getDownloadUrl,
  getPreviewText,
  listDocuments,
  listQuizAttempts,
  renameDocument,
  search,
  sendChatMessage,
  submitQuizAttempt,
  uploadDocument,
} from '../../src/lib/api'
import { supabase } from '../../src/lib/supabaseClient'

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('api client', () => {
  it('listDocuments sends an authorized GET request', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => [] })

    await listDocuments()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  it('uploadDocument sends a POST with form data', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: '1', filename: 'a.txt' }),
    })
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' })

    await uploadDocument(file)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
  })

  it('renameDocument sends a PATCH with the new filename', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: '1' }) })

    await renameDocument('1', 'new-name.txt')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents/1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ filename: 'new-name.txt' }),
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      }),
    )
  })

  it('deleteDocument sends a DELETE request and throws on failure', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true })

    await deleteDocument('1')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents/1'),
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )

    ;(globalThis.fetch as any).mockResolvedValue({ ok: false })

    await expect(deleteDocument('1')).rejects.toThrow('Failed to delete document')
  })

  it('getDownloadUrl returns the signed url', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ url: 'https://x' }) })

    const url = await getDownloadUrl('1')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents/1/download'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(url).toBe('https://x')
  })

  it('getPreviewText sends an authorized GET request and returns the preview text', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ text: 'hello world' }) })

    const text = await getPreviewText('1')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents/1/preview'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(text).toBe('hello world')
  })

  it('search sends an authorized GET request and returns results', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            document_id: '1',
            filename: 'a.txt',
            chunk_index: 0,
            total_chunks: 1,
            content: 'hello',
            score: 0.9,
          },
        ],
        has_more: false,
      }),
    })

    const response = await search('hello world')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=hello%20world'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(response).toEqual({
      results: [
        {
          document_id: '1',
          filename: 'a.txt',
          chunk_index: 0,
          total_chunks: 1,
          content: 'hello',
          score: 0.9,
        },
      ],
      has_more: false,
    })
  })

  it('search appends file_type, recent, and offset params when provided', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], has_more: false }),
    })

    await search('hello', { fileType: 'pdf', recent: true, offset: 10 })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=hello&file_type=pdf&recent=true&offset=10'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  it('createChatSession sends an authorized POST request and returns the session', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' }),
    })

    const session = await createChatSession()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/sessions'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    expect(session).toEqual({ id: 'session-1', title: 'New Chat', created_at: '2026-07-18T00:00:00Z' })
  })

  it('sendChatMessage sends content and web_search in the request body', async () => {
    const userMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'What is the refund window?',
      citations: [],
      used_web_search: false,
      created_at: '2026-07-18T00:00:01Z',
    }
    const assistantMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Refunds are available within 30 days.',
      citations: [
        { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3, score: 0.81 },
      ],
      used_web_search: false,
      created_at: '2026-07-18T00:00:02Z',
    }
    ;(globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ user_message: userMessage, assistant_message: assistantMessage }),
    })

    const result = await sendChatMessage('session-1', 'What is the refund window?', false)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/sessions/session-1/messages'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'What is the refund window?', web_search: false }),
      }),
    )
    expect(result).toEqual({ user_message: userMessage, assistant_message: assistantMessage })
  })

  it('sendChatMessage fails when the request is not ok', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false })

    await expect(sendChatMessage('session-1', 'hello', false)).rejects.toThrow('Failed to send message')
  })

  it('generateQuiz sends document_ids and num_questions and returns the quiz', async () => {
    const quiz = {
      id: 'quiz-1',
      document_ids: ['doc-1'],
      requested_count: 5,
      actual_count: 5,
      created_at: '2026-07-18T00:00:00Z',
      questions: [{ id: 'q-1', question: 'What is the refund window?', options: ['7 days', '30 days', '60 days', '90 days'] }],
    }
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => quiz })

    const result = await generateQuiz(['doc-1'], 5)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quiz/generate'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: ['doc-1'], num_questions: 5 }),
      }),
    )
    expect(result).toEqual(quiz)
  })

  it('generateQuiz fails when the request is not ok', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false })

    await expect(generateQuiz(['doc-1'], 5)).rejects.toThrow('Failed to generate quiz')
  })

  it('submitQuizAttempt sends answers and returns the scored result', async () => {
    const result = {
      id: 'attempt-1',
      quiz_id: 'quiz-1',
      score: 1,
      total_questions: 1,
      completed_at: '2026-07-18T00:01:00Z',
      results: [
        {
          question_id: 'q-1',
          question: 'What is the refund window?',
          options: ['7 days', '30 days', '60 days', '90 days'],
          selected_option: 1,
          correct_answer: 1,
          is_correct: true,
          source_reference: { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3 },
        },
      ],
    }
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => result })

    const answers = [{ question_id: 'q-1', selected_option: 1 }]
    const returned = await submitQuizAttempt('quiz-1', answers)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quiz/quiz-1/attempts'),
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      }),
    )
    expect(returned).toEqual(result)
  })

  it('listQuizAttempts sends an authorized GET request and returns attempts', async () => {
    const attempts = [
      {
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        score: 1,
        total_questions: 1,
        completed_at: '2026-07-18T00:01:00Z',
        document_filenames: ['policy.pdf'],
      },
    ]
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ attempts }) })

    const result = await listQuizAttempts()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quiz/attempts'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(result).toEqual(attempts)
  })

  it('signs out a stale session when the API rejects the request with 401', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: false, status: 401 })

    await expect(listQuizAttempts()).rejects.toThrow('Failed to load quiz history')

    expect(supabase.auth.signOut).toHaveBeenCalled()
  })
})
