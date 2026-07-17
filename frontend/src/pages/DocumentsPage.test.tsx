import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDownloadUrl: vi.fn(),
}))

import {
  deleteDocument,
  getDownloadUrl,
  listDocuments,
  renameDocument,
  uploadDocument,
} from '../lib/api'
import { DocumentsPage } from './DocumentsPage'

const readyDoc = {
  id: '1',
  filename: 'report.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  uploaded_at: '2026-01-01T00:00:00Z',
}

describe('DocumentsPage', () => {
  it('renders the list of documents', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])

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

  it('renames a document', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(renameDocument as any).mockResolvedValue({ ...readyDoc, filename: 'renamed.pdf' })
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('renamed.pdf'))

    render(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(renameDocument).toHaveBeenCalledWith('1', 'renamed.pdf')
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('deletes a document after confirmation', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(deleteDocument as any).mockResolvedValue(undefined)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteDocument).toHaveBeenCalledWith('1')
    })
    expect(listDocuments).toHaveBeenCalledTimes(2)
  })

  it('opens the download URL when Download is clicked', async () => {
    ;(listDocuments as any).mockResolvedValue([readyDoc])
    ;(getDownloadUrl as any).mockResolvedValue('https://signed.example/file.pdf')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<DocumentsPage />)
    await waitFor(() => screen.getByText('report.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://signed.example/file.pdf', '_blank')
    })
  })

  it('polls while a document is processing and stops once ready', async () => {
    vi.useFakeTimers()
    try {
      const processingDoc = { ...readyDoc, id: '3', status: 'processing' as const }
      ;(listDocuments as any)
        .mockResolvedValueOnce([processingDoc])
        .mockResolvedValueOnce([{ ...processingDoc, status: 'ready' as const }])

      const { unmount } = render(<DocumentsPage />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(listDocuments).toHaveBeenCalledTimes(1)
      expect(screen.getByText('(processing)')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(listDocuments).toHaveBeenCalledTimes(2)
      expect(screen.getByText('(ready)')).toBeInTheDocument()

      // No further polling once nothing is pending.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(listDocuments).toHaveBeenCalledTimes(2)

      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not poll when all documents are already ready', async () => {
    vi.useFakeTimers()
    try {
      ;(listDocuments as any).mockResolvedValue([readyDoc])

      render(<DocumentsPage />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(listDocuments).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(listDocuments).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
