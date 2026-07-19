import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
import i18n from '../../src/i18n'
import { renderWithQueryClient } from '../test-utils'

function renderAppNav() {
  return renderWithQueryClient(
    <MemoryRouter>
      <AppNav />
    </MemoryRouter>,
  )
}

describe('AppNav', () => {
  afterEach(() => {
    i18n.changeLanguage('vi')
    window.localStorage.clear()
  })

  it('renders links to Documents, Search, AI Assistant, Quiz, and Quiz History in Vietnamese by default', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    expect(screen.getByRole('link', { name: 'Tài liệu' })).toHaveAttribute('href', '/documents')
    expect(screen.getByRole('link', { name: 'Tìm kiếm' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Trợ lý AI' })).toHaveAttribute('href', '/chat')
    expect(screen.getByRole('link', { name: 'Đố vui' })).toHaveAttribute('href', '/quiz')
    expect(screen.getByRole('link', { name: 'Lịch sử đố vui' })).toHaveAttribute(
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

  it('switches nav labels to English when the English toggle is clicked', () => {
    ;(listDocuments as any).mockResolvedValue([])
    renderAppNav()

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/documents')
  })
})
