import { ReactNode } from 'react'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-body text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      {children}
    </p>
  )
}
