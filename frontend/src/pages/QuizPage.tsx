import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { generateQuiz, listDocuments, listQuizAttempts, submitQuizAttempt, QuizAnswer } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const COUNT_OPTIONS = [5, 8, 10, 15]

type View = 'list' | 'config' | 'taking' | 'result'

export function QuizPage() {
  const [view, setView] = useState<View>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Awaited<ReturnType<typeof generateQuiz>> | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<(QuizAnswer | null)[]>([])
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitQuizAttempt>> | null>(null)
  const queryClient = useQueryClient()
  const selected = answers[qIndex]?.selected_option ?? null

  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? []
  const stats = useMemo(() => {
    if (attempts.length === 0) return { count: 0, avg: 0 }
    const avg = Math.round(
      (attempts.reduce((sum, a) => sum + a.score / a.total_questions, 0) / attempts.length) * 100,
    )
    return { count: attempts.length, avg }
  }, [attempts])

  const documentsQuery = useQuery({
    queryKey: queryKeys.documents,
    queryFn: listDocuments,
    enabled: view === 'config',
  })
  const readyDocuments = (documentsQuery.data ?? []).filter((d) => d.status === 'ready')

  function startQuiz(loaded: Awaited<ReturnType<typeof generateQuiz>>) {
    setQuiz(loaded)
    setQIndex(0)
    setAnswers(Array(loaded.questions.length).fill(null))
    setResult(null)
    setView('taking')
  }

  const generateMutation = useMutation({
    mutationFn: (vars: { documentIds: string[]; numQuestions: number }) =>
      generateQuiz(vars.documentIds, vars.numQuestions),
    onSuccess: (generated) => startQuiz(generated),
  })

  const submitMutation = useMutation({
    mutationFn: (vars: { quizId: string; answers: QuizAnswer[] }) =>
      submitQuizAttempt(vars.quizId, vars.answers),
    onSuccess: (attemptResult) => {
      setResult(attemptResult)
      setView('result')
      queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts })
    },
  })

  function toggleDocument(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleGenerate() {
    if (selectedIds.length === 0) return
    generateMutation.mutate({ documentIds: selectedIds, numQuestions })
  }

  function pickOption(index: number) {
    if (!quiz) return
    const question = quiz.questions[qIndex]
    setAnswers((prev) => {
      const next = [...prev]
      next[qIndex] = { question_id: question.id, selected_option: index }
      return next
    })
  }

  function handlePrevious() {
    if (qIndex === 0) return
    setQIndex(qIndex - 1)
  }

  function handleNext() {
    if (selected === null || !quiz) return
    if (qIndex >= quiz.questions.length - 1) {
      const finalAnswers = answers.filter((a): a is QuizAnswer => a !== null)
      submitMutation.mutate({ quizId: quiz.id, answers: finalAnswers })
      return
    }
    setQIndex(qIndex + 1)
  }

  const generateError = generateMutation.isError ? 'Failed to generate quiz, try again' : null

  if (view === 'list') {
    return (
      <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
        <div className="mb-7 flex gap-4">
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">Quizzes taken</div>
            <div className="text-3xl font-extrabold tracking-tight">{stats.count}</div>
          </div>
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">Average score</div>
            <div className="text-3xl font-extrabold tracking-tight text-accent">{stats.avg}%</div>
          </div>
        </div>

        <div className="mb-7 flex items-center gap-5 rounded-2xl bg-gradient-to-r from-sidebar to-sidebar-panel p-6">
          <div className="flex-1">
            <h2 className="mb-1.5 text-lg font-extrabold text-white">Generate a new quiz</h2>
            <p className="text-sm leading-relaxed text-[#AEBBC2]">
              Pick one or more documents and we&apos;ll build multiple-choice questions grounded
              strictly in their content.
            </p>
          </div>
          <Button onClick={() => setView('config')}>Create quiz</Button>
        </div>

        <div className="mb-3.5 text-xs font-bold uppercase tracking-wide text-faint">
          Recent attempts
        </div>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">No quiz attempts yet</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {attempts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-[13px] border border-line bg-white px-5 py-4"
              >
                <div className="flex-1 text-sm font-bold">{a.document_filenames.join(', ')}</div>
                <div className="text-sm font-bold">
                  {a.score} / {a.total_questions}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (view === 'config') {
    return (
      <div className="mx-auto max-w-[720px] px-8 pb-12 pt-7">
        <button onClick={() => setView('list')} className="mb-4 text-sm font-semibold text-muted">
          ← Back to quizzes
        </button>
        <h2 className="mb-5 text-xl font-extrabold tracking-tight">Generate a quiz</h2>
        {generateError && (
          <div className="mb-4">
            <Alert>{generateError}</Alert>
          </div>
        )}

        <div className="mb-2.5 text-xs font-bold text-muted">1 · Choose source documents</div>
        <div className="mb-6 flex flex-col gap-2">
          {readyDocuments.map((doc) => {
            const checked = selectedIds.includes(doc.id)
            return (
              <label
                key={doc.id}
                className={
                  checked
                    ? 'flex items-center gap-3 rounded-[11px] border-[1.5px] border-accent bg-white px-4 py-3.5'
                    : 'flex items-center gap-3 rounded-[11px] border-[1.5px] border-line bg-white px-4 py-3.5'
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDocument(doc.id)}
                  aria-label={doc.filename}
                  className="h-5 w-5 rounded border-line text-accent focus:ring-accent"
                />
                <span className="flex-1 text-sm font-semibold">{doc.filename}</span>
              </label>
            )
          })}
        </div>

        <div className="mb-2.5 text-xs font-bold text-muted">2 · Number of questions</div>
        <div className="mb-8 flex gap-2">
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setNumQuestions(n)}
              className={
                numQuestions === n
                  ? 'rounded-[10px] border-[1.5px] border-accent bg-ok-bg px-5 py-2.5 text-sm font-semibold text-accent-hover'
                  : 'rounded-[10px] border-[1.5px] border-line bg-white px-5 py-2.5 text-sm font-semibold text-muted'
              }
            >
              {n}
            </button>
          ))}
        </div>

        <Button onClick={handleGenerate} className="w-full" disabled={generateMutation.isPending}>
          Generate {numQuestions} questions
        </Button>
      </div>
    )
  }

  if (view === 'taking' && quiz) {
    const question = quiz.questions[qIndex]
    const revealed = selected !== null
    return (
      <div className="mx-auto max-w-[680px] px-8 pb-12 pt-7">
        <div className="mb-2 flex items-center gap-3.5">
          <button onClick={() => setView('list')} className="text-sm font-semibold text-faint">
            ✕ Exit
          </button>
          <span className="flex-1" />
          <span className="text-sm font-semibold text-muted">
            Question {qIndex + 1} of {quiz.questions.length}
          </span>
        </div>
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: `${Math.round(((qIndex + (revealed ? 1 : 0)) / quiz.questions.length) * 100)}%`,
            }}
          />
        </div>

        {qIndex === 0 && quiz.actual_count < quiz.requested_count && (
          <p className="mb-4 text-sm text-warn">
            Generated {quiz.actual_count} of the requested {quiz.requested_count} questions — the
            selected documents didn&apos;t have enough distinct content for more.
          </p>
        )}

        <div className="rounded-[18px] border border-line bg-white p-7 shadow-sm">
          <h2 className="mb-6 text-xl font-bold leading-snug">{question.question}</h2>
          <div className="flex flex-col gap-2.5">
            {question.options.map((option, index) => {
              const isSelected = selected === index
              const style = !revealed
                ? isSelected
                  ? 'border-[1.5px] border-accent bg-ok-bg'
                  : 'border-[1.5px] border-line bg-white'
                : isSelected
                  ? 'border-[1.5px] border-accent bg-ok-bg'
                  : 'border-[1.5px] border-line bg-white opacity-60'
              return (
                <button
                  key={option}
                  onClick={() => pickOption(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[14.5px] font-medium ${style}`}
                >
                  <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg bg-app-bg text-sm font-bold">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className="flex-1">{option}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5 flex justify-between">
          <Button variant="secondary" onClick={handlePrevious} disabled={qIndex === 0}>
            Previous
          </Button>
          <Button onClick={handleNext} disabled={!revealed}>
            {qIndex >= quiz.questions.length - 1 ? 'Finish quiz' : 'Next question'}
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'result' && result) {
    const pct = Math.round((result.score / result.total_questions) * 100)
    return (
      <div className="mx-auto max-w-[560px] px-8 pb-12 pt-10 text-center">
        <div className="mx-auto mb-6 flex h-[118px] w-[118px] items-center justify-center rounded-full bg-app-bg">
          <span className="text-3xl font-extrabold tracking-tight">{result.score}</span>
        </div>
        <h2 className="mb-2 text-2xl font-extrabold tracking-tight">
          {pct >= 75 ? 'Great work!' : pct >= 50 ? 'Nice effort' : 'Keep practicing'}
        </h2>
        <p className="mb-6 text-[15px] text-muted">
          You answered <strong className="text-ink">{result.score}</strong> of{' '}
          {result.total_questions} questions correctly.
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => setView('config')}>
            Retake quiz
          </Button>
          <Button onClick={() => setView('list')}>Back to quizzes</Button>
        </div>
      </div>
    )
  }

  return null
}
