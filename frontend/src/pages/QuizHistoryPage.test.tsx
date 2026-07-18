import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  listQuizAttempts: vi.fn(),
}))

import { listQuizAttempts } from '../lib/api'
import { QuizHistoryPage } from './QuizHistoryPage'

function renderQuizHistoryPage() {
  return render(
    <MemoryRouter>
      <QuizHistoryPage />
    </MemoryRouter>,
  )
}

describe('QuizHistoryPage', () => {
  it('renders past attempts', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([
      {
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        score: 7,
        total_questions: 10,
        completed_at: '2026-07-18T12:05:00Z',
        document_filenames: ['policy.pdf'],
      },
    ])

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('7 / 10 — policy.pdf', { exact: false })).toBeInTheDocument()
    })
  })

  it('shows an empty state when there are no attempts', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByText('No quiz attempts yet')).toBeInTheDocument()
    })
  })

  it('shows an error message when the request fails', async () => {
    ;(listQuizAttempts as any).mockRejectedValue(new Error('Failed to load quiz history'))

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load quiz history, try again')
    })
  })
})
