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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Past Quiz Attempts
        </h1>
        <Link to="/quiz" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          Take a quiz
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {attempts !== null && attempts.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No quiz attempts yet</p>
      )}
      {attempts !== null && attempts.length > 0 && (
        <ul className="space-y-3">
          {attempts.map((a) => (
            <li key={a.id}>
              <Card className="text-sm text-gray-900 dark:text-gray-100">
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
