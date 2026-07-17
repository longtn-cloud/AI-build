import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}))

import { listDocuments, uploadDocument } from '../lib/api'
import { DocumentsPage } from './DocumentsPage'

describe('DocumentsPage', () => {
  it('renders the list of documents', async () => {
    ;(listDocuments as any).mockResolvedValue([
      { id: '1', filename: 'report.pdf', file_type: 'pdf', status: 'ready', uploaded_at: '2026-01-01T00:00:00Z' },
    ])

    render(<DocumentsPage />)

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })
  })

  it('uploads a selected file and refreshes the list', async () => {
    ;(listDocuments as any).mockResolvedValue([])
    ;(uploadDocument as any).mockResolvedValue({
      id: '2',
      filename: 'notes.txt',
      file_type: 'txt',
      status: 'uploading',
      uploaded_at: '2026-01-01T00:00:00Z',
    })

    render(<DocumentsPage />)
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(1))

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const input = screen.getByLabelText('Upload document') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalledWith(file)
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })
})
