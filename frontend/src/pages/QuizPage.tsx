import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CitationStub } from '../components/ui/CitationStub'
import { Input } from '../components/ui/Input'
import { Quiz, generateQuiz, listDocuments, submitQuizAttempt } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const queryClient = useQueryClient()

  const documentsQuery = useQuery({ queryKey: queryKeys.documents, queryFn: listDocuments })
  const documents = documentsQuery.data ?? []

  const submitMutation = useMutation({
    mutationFn: (vars: {
      quizId: string
      answers: { question_id: string; selected_option: number }[]
    }) => submitQuizAttempt(vars.quizId, vars.answers),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts }),
  })

  const generateMutation = useMutation({
    mutationFn: (vars: { documentIds: string[]; numQuestions: number }) =>
      generateQuiz(vars.documentIds, vars.numQuestions),
    onSuccess: (generated) => {
      setQuiz(generated)
      setAnswers({})
      submitMutation.reset()
    },
  })

  function toggleDocument(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleGenerate(event: FormEvent) {
    event.preventDefault()
    if (selectedIds.length === 0) return
    generateMutation.mutate({ documentIds: selectedIds, numQuestions })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!quiz) return
    const submittedAnswers = quiz.questions
      .filter((q) => q.id in answers)
      .map((q) => ({ question_id: q.id, selected_option: answers[q.id] }))
    submitMutation.mutate({ quizId: quiz.id, answers: submittedAnswers })
  }

  const result = submitMutation.data ?? null
  const error = generateMutation.isError
    ? 'Failed to generate quiz, try again'
    : submitMutation.isError
      ? 'Failed to submit quiz, try again'
      : null
  const loading = generateMutation.isPending || submitMutation.isPending

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-parchment">Quiz</h1>
        <Link
          to="/quiz/history"
          className="font-mono text-xs uppercase tracking-wide text-brass hover:underline"
        >
          Past attempts
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}

      {!quiz && (
        <form onSubmit={handleGenerate} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="font-mono text-xs uppercase tracking-wide text-parchment/60">
              Select documents
            </legend>
            {documents
              .filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-2 rounded-sm border border-rule bg-parchment p-3 font-body text-sm text-ink dark:border-rule-dark dark:bg-parchment-dark dark:text-parchment"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(doc.id)}
                    onChange={() => toggleDocument(doc.id)}
                    className="h-4 w-4 rounded border-rule text-brass focus:ring-brass"
                  />
                  {doc.filename}
                </label>
              ))}
          </fieldset>
          <div>
            <label
              htmlFor="num-questions"
              className="mb-1 block font-mono text-xs uppercase tracking-wide text-parchment/60"
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
            <p className="font-body text-sm text-amber-400">
              Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
              selected documents didn't have enough distinct content for more.
            </p>
          )}
          {quiz.questions.map((q) => (
            <Card key={q.id}>
              <fieldset className="space-y-2">
                <legend className="font-display font-medium text-ink dark:text-parchment">
                  {q.question}
                </legend>
                {q.options.map((option, index) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 font-body text-sm text-ink dark:text-parchment"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={index}
                      checked={answers[q.id] === index}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: index }))}
                      className="h-4 w-4 border-rule text-brass focus:ring-brass"
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
          <p className="font-display text-lg font-semibold text-ink dark:text-parchment">
            {result.score} / {result.total_questions}
          </p>
          <ul className="space-y-3">
            {result.results.map((r) => (
              <li
                key={r.question_id}
                className={
                  r.is_correct
                    ? 'rounded-sm border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950'
                    : 'rounded-sm border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950'
                }
              >
                <p className="font-body font-medium text-ink dark:text-parchment">{r.question}</p>
                <p className="font-body text-sm text-ink/80 dark:text-parchment/80">
                  your answer: {r.selected_option === null ? '(none)' : r.options[r.selected_option]}
                </p>
                <p className="font-body text-sm text-ink/80 dark:text-parchment/80">
                  correct answer: {r.options[r.correct_answer]}
                </p>
                <div className="mt-1">
                  <CitationStub>
                    {r.source_reference.filename} — passage {r.source_reference.chunk_index + 1} of{' '}
                    {r.source_reference.total_chunks}
                  </CitationStub>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
