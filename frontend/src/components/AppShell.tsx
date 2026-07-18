import { ReactNode } from 'react'

import { AppNav } from './AppNav'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-felt dark:bg-felt-dark">
      <AppNav />
      <main className="flex-1 px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  )
}
