import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({
  listDocuments: vi.fn(),
  generateQuiz: vi.fn(),
  submitQuizAttempt: vi.fn(),
}))

import { generateQuiz, listDocuments, submitQuizAttempt } from '../../src/lib/api'
import { QuizPage } from '../../src/pages/QuizPage'

function renderQuizPage() {
  return render(
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
    { id: 'q-1', question: 'What is the refund window?', options: ['7 days', '30 days', '60 days', '90 days'] },
    { id: 'q-2', question: 'What is covered?', options: ['A', 'B', 'C', 'D'] },
  ],
}

describe('QuizPage', () => {
  it('lists ready documents as selectable checkboxes', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()

    await waitFor(() => {
      expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument()
    })
  })

  it('generates a quiz, submits answers, and shows scored results', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue(QUIZ)
    ;(submitQuizAttempt as any).mockResolvedValue({
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
          source_reference: { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 1, total_chunks: 3 },
        },
        {
          question_id: 'q-2',
          question: 'What is covered?',
          options: ['A', 'B', 'C', 'D'],
          selected_option: 0,
          correct_answer: 2,
          is_correct: false,
          source_reference: { document_id: 'doc-1', filename: 'policy.pdf', chunk_index: 2, total_chunks: 3 },
        },
      ],
    })

    renderQuizPage()
    await waitFor(() => expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    await waitFor(() => {
      expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    })
    expect(generateQuiz).toHaveBeenCalledWith(['doc-1'], 10)

    fireEvent.click(screen.getAllByLabelText('30 days')[0])
    fireEvent.click(screen.getByLabelText('A'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument()
    })
    expect(submitQuizAttempt).toHaveBeenCalledWith('quiz-1', [
      { question_id: 'q-1', selected_option: 1 },
      { question_id: 'q-2', selected_option: 0 },
    ])
  })

  it('shows a degraded-count banner when fewer questions were generated than requested', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockResolvedValue({ ...QUIZ, requested_count: 10, actual_count: 2 })

    renderQuizPage()
    await waitFor(() => expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Generated 2 of the requested 10 questions — the selected documents didn't have enough distinct content for more.",
        ),
      ).toBeInTheDocument()
    })
  })

  it('shows an error message when generation fails', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])
    ;(generateQuiz as any).mockRejectedValue(new Error('Failed to generate quiz'))

    renderQuizPage()
    await waitFor(() => expect(screen.getByLabelText('policy.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('policy.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to generate quiz, try again')
    })
  })

  it('does not generate when no documents are selected', async () => {
    ;(listDocuments as any).mockResolvedValue([READY_DOCUMENT])

    renderQuizPage()
    await waitFor(() => expect(listDocuments).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))

    expect(generateQuiz).not.toHaveBeenCalled()
  })
})
