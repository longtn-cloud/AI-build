import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

import {
  createChatSession,
  deleteDocument,
  getDownloadUrl,
  getPreviewText,
  listDocuments,
  renameDocument,
  search,
  sendChatMessage,
  uploadDocument,
} from './api'

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
      }),
    })

    const results = await search('hello world')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q=hello%20world'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
    expect(results).toEqual([
      {
        document_id: '1',
        filename: 'a.txt',
        chunk_index: 0,
        total_chunks: 1,
        content: 'hello',
        score: 0.9,
      },
    ])
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
})
