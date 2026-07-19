import { ReactNode } from 'react'

export function CitationStub({ children }: { children: ReactNode }) {
  return (
    <span className="motion-safe:animate-stamp inline-flex items-center gap-1.5 rounded-lg border border-l-[3px] border-line border-l-accent bg-[#FBFDFB] px-2.5 py-1.5 font-mono text-xs text-muted">
      <span aria-hidden="true" className="text-accent-hover">
        ✓
      </span>
      <span>{children}</span>
    </span>
  )
}
