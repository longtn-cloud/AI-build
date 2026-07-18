import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  DocumentListItem,
  Quiz,
  QuizAttemptResult,
  generateQuiz,
  listDocuments,
  submitQuizAttempt,
} from '../lib/api'

export function QuizPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<QuizAttemptResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    listDocuments().then(setDocuments)
  }, [])

  function toggleDocument(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault()
    if (selectedIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const generated = await generateQuiz(selectedIds, numQuestions)
      setQuiz(generated)
      setAnswers({})
      setResult(null)
    } catch {
      setError('Failed to generate quiz, try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!quiz) return
    setLoading(true)
    setError(null)
    try {
      const submittedAnswers = quiz.questions
        .filter((q) => q.id in answers)
        .map((q) => ({ question_id: q.id, selected_option: answers[q.id] }))
      const scored = await submitQuizAttempt(quiz.id, submittedAnswers)
      setResult(scored)
    } catch {
      setError('Failed to submit quiz, try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1>Quiz</h1>
      <Link to="/quiz/history">Past attempts</Link>
      {error && <p role="alert">{error}</p>}

      {!quiz && (
        <form onSubmit={handleGenerate}>
          <fieldset>
            <legend>Select documents</legend>
            {documents
              .filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <label key={doc.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => toggleDocument(doc.id)}
                  />
                  {doc.filename}
                </label>
              ))}
          </fieldset>
          <label htmlFor="num-questions">Number of questions</label>
          <input
            id="num-questions"
            type="number"
            min={5}
            max={20}
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
          />
          <button type="submit" disabled={loading}>
            Generate Quiz
          </button>
        </form>
      )}

      {quiz && !result && (
        <form onSubmit={handleSubmit}>
          {quiz.actual_count < quiz.requested_count && (
            <p>
              Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
              selected documents didn't have enough distinct content for more.
            </p>
          )}
          {quiz.questions.map((q) => (
            <fieldset key={q.id}>
              <legend>{q.question}</legend>
              {q.options.map((option, index) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={q.id}
                    value={index}
                    checked={answers[q.id] === index}
                    onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: index }))}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          ))}
          <button type="submit" disabled={loading}>
            Submit
          </button>
        </form>
      )}

      {result && (
        <div>
          <p>
            {result.score} / {result.total_questions}
          </p>
          <ul>
            {result.results.map((r) => (
              <li key={r.question_id}>
                <p>{r.question}</p>
                <p>your answer: {r.selected_option === null ? '(none)' : r.options[r.selected_option]}</p>
                <p>correct answer: {r.options[r.correct_answer]}</p>
                <p>
                  {r.source_reference.filename} — passage {r.source_reference.chunk_index + 1} of{' '}
                  {r.source_reference.total_chunks}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
