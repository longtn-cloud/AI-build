import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import i18n from '../i18n'
import { generateQuiz, getQuiz, listDocuments, listQuizAttempts, submitQuizAttempt, QuizAnswer } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const COUNT_OPTIONS = [5, 8, 10, 15]

type View = 'list' | 'config' | 'taking' | 'result'

export function QuizPage() {
  const { t } = useTranslation('quiz')
  const [view, setView] = useState<View>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [numQuestions, setNumQuestions] = useState(10)
  const [quiz, setQuiz] = useState<Awaited<ReturnType<typeof generateQuiz>> | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<(QuizAnswer | null)[]>([])
  const [result, setResult] = useState<Awaited<ReturnType<typeof submitQuizAttempt>> | null>(null)
  const queryClient = useQueryClient()
  const selected = answers[qIndex]?.selected_option ?? null

  const navigate = useNavigate()
  const { quizId: retakeQuizId } = useParams<{ quizId?: string }>()

  function goToList() {
    if (retakeQuizId) {
      navigate('/quiz')
      return
    }
    setView('list')
  }

  const retakeQuery = useQuery({
    queryKey: retakeQuizId ? queryKeys.quiz(retakeQuizId) : queryKeys.quiz('none'),
    queryFn: () => getQuiz(retakeQuizId as string),
    enabled: !!retakeQuizId,
  })

  useEffect(() => {
    if (retakeQuery.data) {
      startQuiz(retakeQuery.data)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retakeQuery.data])

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
      generateQuiz(vars.documentIds, vars.numQuestions, i18n.language),
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

  const generateError = generateMutation.isError ? t('errors.generateQuiz') : null

  if (retakeQuizId && !quiz) {
    return (
      <div className="mx-auto max-w-[680px] px-8 pb-12 pt-7">
        {retakeQuery.isError ? (
          <Alert>{t('errors.loadQuiz')}</Alert>
        ) : (
          <p className="text-sm text-muted">{t('loadingQuiz')}</p>
        )}
      </div>
    )
  }

  if (view === 'list') {
    return (
      <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
        <div className="mb-7 flex gap-4">
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">{t('stats.taken')}</div>
            <div className="text-3xl font-extrabold tracking-tight">{stats.count}</div>
          </div>
          <div className="flex-1 rounded-[14px] border border-line bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-muted">{t('stats.avgScore')}</div>
            <div className="text-3xl font-extrabold tracking-tight text-accent">{stats.avg}%</div>
          </div>
        </div>

        <div className="mb-7 flex items-center gap-5 rounded-2xl bg-gradient-to-r from-sidebar to-sidebar-panel p-6">
          <div className="flex-1">
            <h2 className="mb-1.5 text-lg font-extrabold text-white">{t('generateTitle')}</h2>
            <p className="text-sm leading-relaxed text-[#AEBBC2]">{t('generateBody')}</p>
          </div>
          <Button onClick={() => setView('config')}>{t('createQuiz')}</Button>
        </div>

        <div className="mb-3.5 text-xs font-bold uppercase tracking-wide text-faint">
          {t('recentAttempts')}
        </div>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">{t('noAttempts')}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {attempts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-4 rounded-[13px] border border-line bg-white px-5 py-4"
              >
                <div className="flex-1 text-sm font-bold">{a.document_filenames.join(', ')}</div>
                <div className="text-sm font-bold">
                  {t('scoreOf', { score: a.score, total: a.total_questions })}
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
          {t('backToQuizzes')}
        </button>
        <h2 className="mb-5 text-xl font-extrabold tracking-tight">{t('generateHeading')}</h2>
        {generateError && (
          <div className="mb-4">
            <Alert>{generateError}</Alert>
          </div>
        )}

        <div className="mb-2.5 text-xs font-bold text-muted">{t('step1')}</div>
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

        <div className="mb-2.5 text-xs font-bold text-muted">{t('step2')}</div>
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
          {t('generateButton', { count: numQuestions })}
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
          <button onClick={goToList} className="text-sm font-semibold text-faint">
            {t('exit')}
          </button>
          <span className="flex-1" />
          <span className="text-sm font-semibold text-muted">
            {t('questionOf', { index: qIndex + 1, total: quiz.questions.length })}
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
            {t('fewerGenerated', { actual: quiz.actual_count, requested: quiz.requested_count })}
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
            {t('previous')}
          </Button>
          <Button onClick={handleNext} disabled={!revealed}>
            {qIndex >= quiz.questions.length - 1 ? t('finishQuiz') : t('nextQuestion')}
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
          {pct >= 75 ? t('result.great') : pct >= 50 ? t('result.nice') : t('result.keep')}
        </h2>
        <p className="mb-6 text-[15px] text-muted">
          <Trans
            i18nKey="quiz:resultBody"
            values={{ score: result.score, total: result.total_questions }}
            components={{ strong: <strong className="text-ink" /> }}
          />
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => setView('config')}>
            {t('retakeQuiz')}
          </Button>
          <Button onClick={goToList}>{t('backToQuizzesButton')}</Button>
        </div>
      </div>
    )
  }

  return null
}
