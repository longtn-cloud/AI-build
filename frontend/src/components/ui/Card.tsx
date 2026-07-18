import { HTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        'rounded-sm border border-rule bg-parchment p-4 text-ink shadow-sm dark:border-rule-dark dark:bg-parchment-dark dark:text-parchment',
        className,
      )}
      {...props}
    />
  )
}
