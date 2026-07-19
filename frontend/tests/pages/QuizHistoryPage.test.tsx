import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listQuizAttempts: vi.fn(),
  shareQuiz: vi.fn(),
  unshareQuiz: vi.fn(),
  listSharedQuizzes: vi.fn(),
  listTeams: vi.fn(),
}))

import { listQuizAttempts, listSharedQuizzes, listTeams } from '../../src/lib/api'
import { QuizHistoryPage } from '../../src/pages/QuizHistoryPage'

function RetakeRouteProbe() {
  const location = useLocation()
  return <div>retake page for {location.pathname}</div>
}

function renderQuizHistoryPage() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={['/quiz/history']}>
      <Routes>
        <Route path="/quiz/history" element={<QuizHistoryPage />} />
        <Route path="/quiz/:quizId/retake" element={<RetakeRouteProbe />} />
      </Routes>
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
        shared_team_ids: [],
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
      expect(screen.getByText('Chưa có lượt làm bài đố vui nào')).toBeInTheDocument()
    })
  })

  it('shows an error message when the request fails', async () => {
    ;(listQuizAttempts as any).mockRejectedValue(new Error('Failed to load quiz history'))

    renderQuizHistoryPage()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Tải lịch sử đố vui thất bại, vui lòng thử lại')
    })
  })

  it('navigates to the retake route when Retake is clicked', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([
      {
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        score: 7,
        total_questions: 10,
        completed_at: '2026-07-18T12:05:00Z',
        document_filenames: ['policy.pdf'],
        shared_team_ids: [],
      },
    ])

    renderQuizHistoryPage()
    await waitFor(() => screen.getByRole('button', { name: 'Làm lại' }))
    fireEvent.click(screen.getByRole('button', { name: 'Làm lại' }))

    await waitFor(() => {
      expect(screen.getByText('retake page for /quiz/quiz-1/retake')).toBeInTheDocument()
    })
  })

  it('opens the share modal for an attempt', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([
      {
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        score: 7,
        total_questions: 10,
        completed_at: '2026-07-18T12:05:00Z',
        document_filenames: ['policy.pdf'],
        shared_team_ids: [],
      },
    ])
    ;(listTeams as any).mockResolvedValue([])

    renderQuizHistoryPage()
    await waitFor(() => screen.getByRole('button', { name: 'Chia sẻ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }))

    await waitFor(() => {
      expect(screen.getByText('Chia sẻ với nhóm')).toBeInTheDocument()
    })
  })

  it('shows the Shared with me tab with shared quizzes', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listSharedQuizzes as any).mockResolvedValue([
      { id: 'quiz-9', document_ids: ['doc-1'], created_at: '2026-07-18T12:05:00Z' },
    ])

    renderQuizHistoryPage()
    await waitFor(() => screen.getByText('Chưa có lượt làm bài đố vui nào'))

    fireEvent.click(screen.getByText('Được chia sẻ'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Làm bài' })).toBeInTheDocument()
    })
  })
})
