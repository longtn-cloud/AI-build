import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AppNav } from './AppNav'

describe('AppNav', () => {
  it('renders links to Documents and Search', () => {
    render(
      <MemoryRouter>
        <AppNav />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
  })
})
