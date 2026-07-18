import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ThemeProvider } from '../contexts/ThemeContext'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders the nav and its children', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <AppShell>
            <p>Page content</p>
          </AppShell>
        </ThemeProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })
})
