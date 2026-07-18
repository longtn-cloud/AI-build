import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Alert } from '../components/ui/Alert'
import { Card } from '../components/ui/Card'
import { QuizAttemptSummary, listQuizAttempts } from '../lib/api'

export function QuizHistoryPage() {
  const [attempts, setAttempts] = useState<QuizAttemptSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listQuizAttempts()
      .then(setAttempts)
      .catch(() => setError('Failed to load quiz history, try again'))
  }, [])

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
      {error && <Alert>{error}</Alert>}
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
