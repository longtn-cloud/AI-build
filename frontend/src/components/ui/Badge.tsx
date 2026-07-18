import { ReactNode } from 'react'

type BadgeVariant = 'gray' | 'blue' | 'green' | 'red' | 'amber'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gray: 'border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300',
  blue: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300',
  green:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  red: 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  amber:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-sm border px-2 py-0.5 font-mono text-xs tracking-tight ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  )
}
