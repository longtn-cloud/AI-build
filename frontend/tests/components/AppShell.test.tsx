import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user: { email: 'sarah@example.com' } }, signOut: vi.fn() }),
}))

import { AppShell } from '../../src/components/AppShell'
import { renderWithQueryClient } from '../test-utils'

describe('AppShell', () => {
  it('renders the nav and its children', () => {
    renderWithQueryClient(
      <MemoryRouter>
        <AppShell>
          <p>Page content</p>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })
})
