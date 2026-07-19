import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { listQuizAttempts } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const { t } = useTranslation('quiz')
  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-[980px] px-8 pb-12 pt-7">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/quiz" className="text-sm font-semibold text-accent-hover hover:underline">
          {t('takeQuiz')}
        </Link>
      </div>
      {attemptsQuery.isError && <Alert>{t('errors.loadHistory')}</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="text-sm text-muted">{t('noAttempts')}</p>
      )}
      {attempts !== null && attempts.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {attempts.map((a) => (
            <Card key={a.id} className="flex items-center justify-between gap-4">
              <span>
                {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} —{' '}
                {a.completed_at}
              </span>
              <Button variant="secondary" onClick={() => navigate(`/quiz/${a.quiz_id}/retake`)}>
                {t('retake')}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
