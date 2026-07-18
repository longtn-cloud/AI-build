import { ReactNode } from 'react'

import { AppNav } from './AppNav'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  )
}
