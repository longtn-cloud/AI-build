import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Alert } from '../components/ui/Alert'
import { Card } from '../components/ui/Card'
import { listQuizAttempts } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

export function QuizHistoryPage() {
  const attemptsQuery = useQuery({ queryKey: queryKeys.quizAttempts, queryFn: listQuizAttempts })
  const attempts = attemptsQuery.data ?? null

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-parchment">Past Quiz Attempts</h1>
        <Link
          to="/quiz"
          className="font-mono text-xs uppercase tracking-wide text-brass hover:underline"
        >
          Take a quiz
        </Link>
      </div>
      {attemptsQuery.isError && <Alert>Failed to load quiz history, try again</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="font-mono text-sm text-parchment/60">No quiz attempts yet</p>
      )}
      {attempts !== null && attempts.length > 0 && (
        <ul className="space-y-3">
          {attempts.map((a) => (
            <li key={a.id}>
              <Card className="font-body text-sm text-ink dark:text-parchment">
                {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} —{' '}
                {a.completed_at}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
