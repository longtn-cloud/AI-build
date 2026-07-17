import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../lib/api', () => ({
  getDownloadUrl: vi.fn(),
  getPreviewText: vi.fn(),
}))

import { getDownloadUrl, getPreviewText } from '../lib/api'
import { PreviewModal } from './PreviewModal'

const baseDoc = {
  id: '1',
  user_id: 'u1',
  filename: 'file',
  storage_path: 'path',
  error_reason: null,
  extracted_text: null,
  uploaded_at: '2026-01-01T00:00:00Z',
  status: 'ready' as const,
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ text: async () => 'plain file contents' })
})

describe('PreviewModal', () => {
  it('renders a PDF preview using an iframe with the signed URL', async () => {
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.pdf')

    render(<PreviewModal document={{ ...baseDoc, file_type: 'pdf' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByTitle('Document preview')).toHaveAttribute(
        'src',
        'https://signed.example/file.pdf',
      )
    })
  })

  it('renders extracted text for docx files', async () => {
    ;(getPreviewText as any).mockResolvedValue('Extracted docx content')

    render(<PreviewModal document={{ ...baseDoc, file_type: 'docx' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('Extracted docx content')).toBeInTheDocument()
    })
  })

  it('renders fetched text for txt/md files', async () => {
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.txt')

    render(<PreviewModal document={{ ...baseDoc, file_type: 'txt' }} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText('plain file contents')).toBeInTheDocument()
    })
  })
})
