import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}))

import { AuthProvider, useAuth } from '../../src/contexts/AuthContext'

function Consumer() {
  const { loading, session } = useAuth()
  return <div>{loading ? 'loading' : `done:${session === null}`}</div>
}

describe('AuthContext', () => {
  it('stops loading even if getSession() rejects', async () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('done:true')).toBeInTheDocument()
    })
  })
})
