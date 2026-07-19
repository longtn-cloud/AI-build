import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/AppNav', () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}))

import { AppShell } from '../../src/components/AppShell'
import i18n from '../../src/i18n'

describe('AppShell', () => {
  afterEach(() => {
    i18n.changeLanguage('vi')
  })

  it('renders the Vietnamese title and subtitle for a known route', () => {
    render(
      <MemoryRouter initialEntries={['/documents']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Tài liệu' })).toBeInTheDocument()
    expect(screen.getByText('Cơ sở kiến thức đã lập chỉ mục của bạn')).toBeInTheDocument()
  })

  it('falls back to the app name for an unknown route', () => {
    render(
      <MemoryRouter initialEntries={['/unknown']}>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'DigiAgent' })).toBeInTheDocument()
  })
})
