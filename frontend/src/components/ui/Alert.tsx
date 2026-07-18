import { ReactNode } from 'react'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[10px] border border-danger/30 bg-danger-bg px-3 py-2 font-sans text-sm text-danger"
    >
      {children}
    </p>
  )
}
