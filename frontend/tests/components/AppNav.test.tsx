import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ThemeProvider } from '../../src/contexts/ThemeContext'
import { AppNav } from '../../src/components/AppNav'

function renderAppNav() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AppNav />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('AppNav', () => {
  it('renders links to Documents, Search, Chat, Quiz, and Quiz History', () => {
    renderAppNav()

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Quiz' })).toHaveAttribute('href', '/quiz')
    expect(screen.getByRole('link', { name: 'Quiz History' })).toHaveAttribute(
      'href',
      '/quiz/history',
    )
  })

  it('renders a theme toggle button', () => {
    renderAppNav()

    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })
})
