import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <p className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</p>
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
