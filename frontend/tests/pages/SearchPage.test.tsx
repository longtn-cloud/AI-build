import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  search: vi.fn(),
}))

import { search } from '../../src/lib/api'
import { SearchPage } from '../../src/pages/SearchPage'

describe('SearchPage', () => {
  it('renders results after submitting a query', async () => {
    ;(search as any).mockResolvedValue([
      {
        document_id: '1',
        filename: 'report.pdf',
        chunk_index: 2,
        total_chunks: 5,
        content: 'quarterly revenue figures',
        score: 0.9,
      },
    ])

    renderWithQueryClient(<SearchPage />)
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('quarterly revenue figures')).toBeInTheDocument()
    })
    expect(screen.getByText('report.pdf — passage 3 of 5')).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue')
  })

  it('shows an empty state when no results are found', async () => {
    ;(search as any).mockResolvedValue([])

    renderWithQueryClient(<SearchPage />)
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'nothing matches' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })

  it('shows an error message when the search request fails', async () => {
    ;(search as any).mockRejectedValue(new Error('Search failed'))

    renderWithQueryClient(<SearchPage />)
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Search failed, try again')
    })
  })

  it('does not search on an empty query', () => {
    renderWithQueryClient(<SearchPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(search).not.toHaveBeenCalled()
  })
})
