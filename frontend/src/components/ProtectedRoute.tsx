import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <p className="flex min-h-screen items-center justify-center bg-felt font-mono text-sm text-parchment/70 dark:bg-felt-dark">
        Loading...
      </p>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
