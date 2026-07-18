import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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
    <div>
      <h1>Past Quiz Attempts</h1>
      <Link to="/quiz">Take a quiz</Link>
      {error && <p role="alert">{error}</p>}
      {attempts !== null && attempts.length === 0 && <p>No quiz attempts yet</p>}
      {attempts !== null && attempts.length > 0 && (
        <ul>
          {attempts.map((a) => (
            <li key={a.id}>
              {a.score} / {a.total_questions} — {a.document_filenames.join(', ')} — {a.completed_at}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
