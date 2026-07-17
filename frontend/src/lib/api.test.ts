import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

import {
  deleteDocument,
  getDownloadUrl,
  getPreviewText,
  listDocuments,
  renameDocument,
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
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renameDocument sends a PATCH with the new filename', async () => {
    ;(globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: '1' }) })

    await renameDocument('1', 'new-name.txt')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/documents/1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ filename: 'new-name.txt' }) }),
    )
  })

  it('deleteDocument sends a DELETE request and throws on failure', async () => {
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
})
