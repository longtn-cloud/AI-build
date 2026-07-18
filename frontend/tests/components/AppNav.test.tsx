import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { email: 'sarah@example.com' } },
    signOut: vi.fn(),
  }),
}))

import { listDocuments } from '../../src/lib/api'
import { AppNav } from '../../src/components/AppNav'
import { renderWithQueryClient } from '../test-utils'

function renderAppNav() {
  return renderWithQueryClient(
    <MemoryRouter>
      <AppNav />
    </MemoryRouter>,
  )
}

describe('AppNav', () => {
  it('renders links to Documents, Search, AI Assistant, Quiz, and Quiz History', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'AI Assistant' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Quiz' })).toHaveAttribute('href', '/quiz')
    expect(screen.getByRole('link', { name: 'Quiz History' })).toHaveAttribute(
      'href',
      '/quiz/history',
    )
  })

  it('shows the live document count next to Documents', async () => {
    ;(listDocuments as any).mockResolvedValue([{ id: '1' }, { id: '2' }])
    renderAppNav()

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('shows the signed-in user email', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    expect(screen.getByText('sarah@example.com')).toBeInTheDocument()
  })
})
