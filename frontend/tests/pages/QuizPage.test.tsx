import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../test-utils'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  listQuizAttempts: vi.fn(),
  generateQuiz: vi.fn(),
  submitQuizAttempt: vi.fn(),
}))

import {
  generateQuiz,
  listDocuments,
  listQuizAttempts,
  submitQuizAttempt,
} from '../../src/lib/api'
import { QuizPage } from '../../src/pages/QuizPage'

function renderQuizPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <QuizPage />
    </MemoryRouter>,
  )
}

const READY_DOCUMENT = {
  id: 'doc-1',
  user_id: 'user-1',
  filename: 'policy.pdf',
  file_type: 'pdf',
  status: 'ready' as const,
  error_reason: null,
  uploaded_at: '2026-07-18T00:00:00Z',
}

const QUIZ = {
  id: 'quiz-1',
  document_ids: ['doc-1'],
  requested_count: 2,
  actual_count: 2,
  created_at: '2026-07-18T00:00:00Z',
  questions: [
    {
      id: 'q-1',
      question: 'What is the refund window?',
      options: ['7 days', '30 days', '60 days', '90 days'],
    },
    {
      id: 'q-2',
      question: 'What is covered?',
      options: ['Data breaches', 'Service outages', 'Billing errors', 'Support delays'],
    },
  ],
}

const RESULT = {
  id: 'attempt-1',
  quiz_id: 'quiz-1',
  score: 1,
  total_questions: 2,
  completed_at: '2026-07-18T00:01:00Z',
  results: [
    {
      question_id: 'q-1',
      question: 'What is the refund window?',
      options: ['7 days', '30 days', '60 days', '90 days'],
      selected_option: 1,
      correct_answer: 1,
      is_correct: true,
      source_reference: {
        document_id: 'doc-1',
        filename: 'policy.pdf',
        chunk_index: 1,
        total_chunks: 3,
      },
    },
    {
      question_id: 'q-2',
      question: 'What is covered?',
      options: ['Data breaches', 'Service outages', 'Billing errors', 'Support delays'],
      selected_option: 0,
      correct_answer: 2,
      is_correct: false,
      source_reference: {
        document_id: 'doc-1',
        filename: 'policy.pdf',
        chunk_index: 2,
        total_chunks: 3,
      },
    },
  ],
}

describe('QuizPage', () => {
  it('shows the quiz list view by default with a Create quiz action', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])

    renderQuizPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create quiz' })).toBeInTheDocument()
    })
  })

  it('goes to config, lists ready documents as selectable checkboxes', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))

    await waitFor(() => {
      expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument()
    })
  })

  it('walks through config -> one question at a time -> result, submitting once at the end', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue(QUIZ)
    ;(submitQuizAttempt as any).mockResolvedValue(RESULT)

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: '8' }))
    fireEvent.click(screen.getByRole('button', { name: /Generate 8 questions/ }))

    await waitFor(() => {
      expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    })
    expect(generateQuiz).toHaveBeenCalledWith(['doc-1'], 8)
    expect(screen.queryByText('What is covered?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('30 days'))
    expect(submitQuizAttempt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))

    await waitFor(() => {
      expect(screen.getByText('What is covered?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Data breaches'))
    fireEvent.click(screen.getByRole('button', { name: 'Finish quiz' }))

    await waitFor(() => {
      expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument()
    })
    expect(submitQuizAttempt).toHaveBeenCalledWith('quiz-1', [
      { question_id: 'q-1', selected_option: 1 },
      { question_id: 'q-2', selected_option: 0 },
    ])
  })

  it('shows a degraded-count message on the first question when generation returns fewer questions than requested', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue({ ...QUIZ, requested_count: 10, actual_count: 2 })

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Generated 2 of the requested 10 questions — the selected documents didn't have enough distinct content for more.",
        ),
      ).toBeInTheDocument()
    })
  })

  it('shows an error message when generation fails', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockRejectedValue(new Error('Failed to generate quiz'))

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to generate quiz, try again')
    })
  })

  it('does not generate when no documents are selected', async () => {
    ;(listQuizAttempts as any).mockResolvedValue([])
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()
    await waitFor(() => screen.getByRole('button', { name: 'Create quiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create quiz' }))
    await waitFor(() => screen.getByLabelText('policy.pdf'))

    fireEvent.click(screen.getByRole('button', { name: /Generate 10 questions/ }))

    expect(generateQuiz).not.toHaveBeenCalled()
  })
})
