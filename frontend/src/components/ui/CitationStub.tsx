import { ReactNode } from 'react'

export function CitationStub({ children }: { children: ReactNode }) {
  return (
    <span className="motion-safe:animate-stamp inline-flex items-center gap-1.5 rounded-sm border border-dashed border-brass/50 bg-parchment px-2 py-1 font-mono text-xs text-ink dark:bg-parchment-dark dark:text-parchment">
      <span aria-hidden="true" className="text-oxblood dark:text-oxblood-dark">
        ✓
      </span>
      <span>{children}</span>
    </span>
  )
}
