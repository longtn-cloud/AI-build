import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  search: vi.fn(),
}))

import { search } from '../../src/lib/api'
import { SearchPage } from '../../src/pages/SearchPage'

function renderSearchPage(initialEntries?: { pathname: string; state?: unknown }[]) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={initialEntries}>
      <SearchPage />
    </MemoryRouter>,
  )
}

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

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      // The matched query term renders inside a <mark>, so the passage text is split
      // across sibling text nodes — match on the paragraph's full textContent instead
      // of an exact getByText string (which only matches a node's direct text children).
      expect(
        screen.getByText(
          (_, element) => element?.tagName.toLowerCase() === 'p' &&
            element.textContent === 'quarterly revenue figures',
        ),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('report.pdf — passage 3 of 5')).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue')
  })

  it('shows an empty state when no results are found', async () => {
    ;(search as any).mockResolvedValue([])

    renderSearchPage()
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

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Search failed, try again')
    })
  })

  it('does not search on an empty query', () => {
    renderSearchPage()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(search).not.toHaveBeenCalled()
  })

  it('pre-fills and runs the query passed via router location state', async () => {
    ;(search as any).mockResolvedValue([
      {
        document_id: '1',
        filename: 'report.pdf',
        chunk_index: 0,
        total_chunks: 2,
        content: 'annual revenue summary',
        score: 0.7,
      },
    ])

    renderSearchPage([{ pathname: '/search', state: { query: 'revenue' } }])

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue')
    })
    expect(screen.getByLabelText('Search your documents')).toHaveValue('revenue')
  })
})
