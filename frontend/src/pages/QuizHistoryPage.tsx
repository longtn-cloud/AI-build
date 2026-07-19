import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ShareTeamsModal } from '../components/ShareTeamsModal'
import {
  listQuizAttempts,
  listSharedQuizzes,
  shareQuiz,
  unshareQuiz,
} from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const { t } = useTranslation('quiz')
  const [view, setView] = useState<'mine' | 'shared'>('mine')
  const [sharingAttemptId, setSharingAttemptId] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null
  const sharingAttempt = attempts?.find((a) => a.id === sharingAttemptId) ?? null

  const sharedQuizzesQuery = useQuery({
    queryKey: queryKeys.sharedQuizzes,
    queryFn: listSharedQuizzes,
    enabled: view === 'shared',
  })
  const sharedQuizzes = sharedQuizzesQuery.data ?? []

  const shareMutation = useMutation({
    mutationFn: ({ quizId, teamId }: { quizId: string; teamId: string }) => shareQuiz(quizId, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts }),
  })

  const unshareMutation = useMutation({
    mutationFn: ({ quizId, teamId }: { quizId: string; teamId: string }) => unshareQuiz(quizId, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.quizAttempts }),
  })

  return (
    <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/quiz" className="text-sm font-semibold text-accent-hover hover:underline">
          {t('takeQuiz')}
        </Link>
      </div>

      <div className="mb-5 flex w-fit gap-1 rounded-[10px] border border-line bg-white p-1">
        <button
          onClick={() => setView('mine')}
          className={
            view === 'mine'
              ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('tabs.mine')}
        </button>
        <button
          onClick={() => setView('shared')}
          className={
            view === 'shared'
              ? 'rounded-md bg-sidebar px-3.5 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3.5 py-1.5 text-sm font-semibold text-muted'
          }
        >
          {t('tabs.shared')}
        </button>
      </div>

      {view === 'shared' ? (
        <div className="flex flex-col gap-2.5">
          {sharedQuizzes.map((quiz) => (
            <Card key={quiz.id} className="flex items-center justify-between gap-4">
              <span>{quiz.id}</span>
              <Button variant="secondary" onClick={() => navigate(`/quiz/${quiz.id}/retake`)}>
                {t('takeSharedQuiz')}
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {attemptsQuery.isError && <Alert>{t('errors.loadHistory')}</Alert>}
          {attempts !== null && attempts.length === 0 && <p className="text-sm text-muted">{t('noAttempts')}</p>}
          {attempts !== null && attempts.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {attempts.map((a) => (
                <Card key={a.id} className="flex items-center justify-between gap-4">
                  <span>
                    {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} — {a.completed_at}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setSharingAttemptId(a.id)}>
                      {t('share')}
                    </Button>
                    <Button variant="secondary" onClick={() => navigate(`/quiz/${a.quiz_id}/retake`)}>
                      {t('retake')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {sharingAttempt && (
        <ShareTeamsModal
          sharedTeamIds={sharingAttempt.shared_team_ids}
          onShare={(teamId) => shareMutation.mutate({ quizId: sharingAttempt.quiz_id, teamId })}
          onUnshare={(teamId) => unshareMutation.mutate({ quizId: sharingAttempt.quiz_id, teamId })}
          onClose={() => setSharingAttemptId(null)}
        />
      )}
    </div>
  )
}
