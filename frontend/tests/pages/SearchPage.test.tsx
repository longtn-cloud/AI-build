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

function byText(tag: string, text: string) {
  return (_: string, element: Element | null) =>
    element?.tagName.toLowerCase() === tag && element.textContent === text
}

describe('SearchPage', () => {
  it('renders results after submitting a query', async () => {
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 2,
          total_chunks: 5,
          content: 'quarterly revenue figures',
          score: 0.9,
        },
      ],
      has_more: false,
    })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText(byText('p', 'quarterly revenue figures'))).toBeInTheDocument()
    })
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText(byText('p', 'passage 3 of 5'))).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: false, offset: 0 })
  })

  it('groups multiple passages from the same document under one card', async () => {
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 0,
          total_chunks: 5,
          content: 'revenue passage one',
          score: 0.9,
        },
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 1,
          total_chunks: 5,
          content: 'revenue passage two',
          score: 0.8,
        },
      ],
      has_more: false,
    })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getAllByText('report.pdf')).toHaveLength(1)
    })
    expect(screen.getByText(byText('p', 'revenue passage one'))).toBeInTheDocument()
    expect(screen.getByText(byText('p', 'revenue passage two'))).toBeInTheDocument()
  })

  it('highlights every occurrence of every query term, not just the first literal match', async () => {
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 0,
          total_chunks: 1,
          content: 'revenue grew and revenue figures improved',
          score: 0.9,
        },
      ],
      has_more: false,
    })

    const { container } = renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue figures' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(container.querySelectorAll('mark')).toHaveLength(3)
    })
    const marks = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent)
    expect(marks).toEqual(['revenue', 'revenue', 'figures'])
  })

  it('shows an empty state when no results are found', async () => {
    ;(search as any).mockResolvedValue({ results: [], has_more: false })

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
    ;(search as any).mockResolvedValue({
      results: [
        {
          document_id: '1',
          filename: 'report.pdf',
          chunk_index: 0,
          total_chunks: 2,
          content: 'annual revenue summary',
          score: 0.7,
        },
      ],
      has_more: false,
    })

    renderSearchPage([{ pathname: '/search', state: { query: 'revenue' } }])

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: false, offset: 0 })
    })
    expect(screen.getByLabelText('Search your documents')).toHaveValue('revenue')
  })

  it('refetches with the selected file type filter', async () => {
    ;(search as any).mockResolvedValue({ results: [], has_more: false })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'PDF' }))

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue', { fileType: 'pdf', recent: false, offset: 0 })
    })
  })

  it('refetches with the recent toggle applied', async () => {
    ;(search as any).mockResolvedValue({ results: [], has_more: false })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))

    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: true, offset: 0 })
    })
  })

  it('loads more results and appends them', async () => {
    ;(search as any)
      .mockResolvedValueOnce({
        results: [
          {
            document_id: '1',
            filename: 'a.pdf',
            chunk_index: 0,
            total_chunks: 1,
            content: 'revenue alpha',
            score: 0.9,
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        results: [
          {
            document_id: '2',
            filename: 'b.pdf',
            chunk_index: 0,
            total_chunks: 1,
            content: 'revenue beta',
            score: 0.5,
          },
        ],
        has_more: false,
      })

    renderSearchPage()
    fireEvent.change(screen.getByLabelText('Search your documents'), {
      target: { value: 'revenue' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('a.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(screen.getByText('b.pdf')).toBeInTheDocument()
    })
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('revenue', { fileType: undefined, recent: false, offset: 1 })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
