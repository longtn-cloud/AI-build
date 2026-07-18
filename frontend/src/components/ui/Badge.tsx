import { ReactNode } from 'react'

type BadgeVariant = 'gray' | 'blue' | 'green' | 'red' | 'amber'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gray: 'border-line bg-app-bg text-muted',
  blue: 'border-info/30 bg-info-bg text-info',
  green: 'border-accent/30 bg-ok-bg text-accent-hover',
  red: 'border-danger/30 bg-danger-bg text-danger',
  amber: 'border-warn/30 bg-warn-bg text-warn',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  )
}
