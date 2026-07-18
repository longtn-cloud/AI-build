import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <p className="flex min-h-screen items-center justify-center bg-app-bg font-sans text-sm text-muted">
        Loading...
      </p>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
