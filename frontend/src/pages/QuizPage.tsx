import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Quiz</h1>
        <Link
          to="/quiz/history"
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Past attempts
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}

      {!quiz && (
        <form onSubmit={handleGenerate} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Select documents
            </legend>
            {documents
              .filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-2 rounded-md border border-gray-200 p-3 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => toggleDocument(doc.id)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {doc.filename}
                </label>
              ))}
          </fieldset>
          <div>
            <label
              htmlFor="num-questions"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Number of questions
            </label>
            <Input
              id="num-questions"
              type="number"
              min={5}
              max={20}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button type="submit" disabled={loading}>
            Generate Quiz
          </Button>
        </form>
      )}

      {quiz && !result && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {quiz.actual_count < quiz.requested_count && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
              selected documents didn't have enough distinct content for more.
            </p>
          )}
          {quiz.questions.map((q) => (
            <Card key={q.id}>
              <fieldset className="space-y-2">
                <legend className="font-medium text-gray-900 dark:text-gray-100">
                  {q.question}
                </legend>
                {q.options.map((option, index) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={index}
                      checked={answers[q.id] === index}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: index }))}
                      className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            </Card>
          ))}
          <Button type="submit" disabled={loading}>
            Submit
          </Button>
        </form>
      )}

      {result && (
        <Card className="space-y-4">
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {result.score} / {result.total_questions}
          </p>
          <ul className="space-y-3">
            {result.results.map((r) => (
              <li
                key={r.question_id}
                className={
                  r.is_correct
                    ? 'rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950'
                    : 'rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950'
                }
              >
                <p className="font-medium text-gray-900 dark:text-gray-100">{r.question}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  your answer: {r.selected_option === null ? '(none)' : r.options[r.selected_option]}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  correct answer: {r.options[r.correct_answer]}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {r.source_reference.filename} — passage {r.source_reference.chunk_index + 1} of{' '}
                  {r.source_reference.total_chunks}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
