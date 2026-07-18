import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { App } from '../src/App'

vi.mock('../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

describe('App', () => {
  it('redirects to the login page by default', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it.each(['/documents', '/search', '/quiz', '/quiz/history', '/chat'])(
    'redirects unauthenticated visitors from %s to the login page',
    async (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      )
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    },
  )
})
